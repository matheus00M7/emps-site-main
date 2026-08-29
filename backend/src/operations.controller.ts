import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ChargerStatus, PaymentMethod, PaymentStatus, Role, SessionStatus } from "@prisma/client";
import { AdminOperationsService } from "./admin-operations.service";
import { JwtGuard, Roles, RolesGuard } from "./auth";
import { CashSettlementDto, ChargerCommandDto, CreateChargerDto, CreateClientDto, FinishChargingSessionDto, ManualReleaseDto, PostpaidReleaseDto, SimulatePaymentDto, StartChargingSessionDto, UpdateAlertStatusDto, UpdateChargerStatusDto, UpdateClientDto } from "./dtos";
import { PrismaService } from "./prisma.service";
import { RealtimeService } from "./realtime.service";

@UseGuards(JwtGuard, RolesGuard)
@Roles(Role.ADMIN, Role.OPERATOR)
@Controller()
export class OperationsController {
  constructor(
    private prisma: PrismaService,
    private adminOperations: AdminOperationsService,
    private realtime: RealtimeService,
  ) {}

  @Get("clients") clients() { return this.prisma.client.findMany({ include: { sessions: true }, orderBy: { name: "asc" } }); }
  @Get("clients/:id") client(@Param("id") id: string) { return this.prisma.client.findUnique({ where: { id }, include: { sessions: true } }); }
  @Post("clients") async createClient(@Body() dto: CreateClientDto) {
    const client = await this.prisma.client.create({ data: dto });
    this.realtime.publish({ entityId: client.id, operational: true, topic: "customer.updated" });
    return client;
  }
  @Patch("clients/:id") async updateClient(@Param("id") id: string, @Body() dto: UpdateClientDto) {
    const client = await this.prisma.client.update({ where: { id }, data: dto });
    this.realtime.publish({ customerId: client.userId ?? undefined, entityId: client.id, operational: true, topic: "customer.updated" });
    return client;
  }
  @Delete("clients/:id") async deleteClient(@Param("id") id: string) {
    const client = await this.prisma.client.delete({ where: { id } });
    this.realtime.publish({ customerId: client.userId ?? undefined, entityId: client.id, operational: true, topic: "customer.updated" });
    return client;
  }

  @Get("chargers") chargers() { return this.prisma.charger.findMany({ include: { station: true, liveStatus: true, sessions: { where: { status: SessionStatus.ACTIVE }, include: { client: true } } }, orderBy: { location: "asc" } }); }
  @Get("chargers/:id") charger(@Param("id") id: string) { return this.prisma.charger.findUnique({ where: { id }, include: { station: true, liveStatus: true, sessions: true, alerts: true } }); }
  @Post("chargers") async createCharger(@Body() dto: CreateChargerDto) {
    const charger = await this.prisma.charger.create({ data: { ...dto, status: dto.status ?? ChargerStatus.AVAILABLE } });
    this.publishChargerChange(charger.id);
    return charger;
  }
  @Patch("chargers/:id") async updateCharger(@Param("id") id: string, @Body() dto: Partial<CreateChargerDto>) {
    const charger = await this.prisma.charger.update({ where: { id }, data: dto });
    this.publishChargerChange(charger.id);
    return charger;
  }
  @Patch("chargers/:id/status") async updateChargerStatus(@Param("id") id: string, @Body() dto: UpdateChargerStatusDto) {
    const charger = await this.prisma.charger.update({ where: { id }, data: { status: dto.status } });
    this.publishChargerChange(charger.id);
    return charger;
  }
  @Post("chargers/:id/commands") command(@Param("id") id: string, @Body() dto: ChargerCommandDto) { return this.adminOperations.sendCommand(id, dto.command); }
  @Post("chargers/:id/manual-release") manualRelease(@Param("id") id: string, @Body() dto: ManualReleaseDto) { return this.adminOperations.manualRelease(id, dto); }
  @Post("chargers/:id/postpaid-sessions") postpaidSession(@Param("id") id: string, @Body() dto: PostpaidReleaseDto) { return this.adminOperations.startPostpaid(id, dto); }
  @Delete("chargers/:id") async deleteCharger(@Param("id") id: string) {
    const charger = await this.prisma.charger.delete({ where: { id } });
    this.publishChargerChange(charger.id);
    return charger;
  }

  @Get("charging-sessions")
  sessions(@Query("status") status?: SessionStatus) {
    return this.prisma.chargingSession.findMany({ where: status ? { status } : {}, include: { client: true, charger: { include: { station: true, liveStatus: true } }, payment: true }, orderBy: { startTime: "desc" } });
  }
  @Get("charging-sessions/:id") session(@Param("id") id: string) { return this.prisma.chargingSession.findUnique({ where: { id }, include: { client: true, charger: true, payment: true } }); }
  @Post("charging-sessions/start")
  async start(@Body() dto: StartChargingSessionDto) {
    const charger = await this.prisma.charger.findUnique({ where: { id: dto.chargerId } });
    if (!charger) throw new NotFoundException("Carregador não encontrado");
    if (charger.status !== ChargerStatus.AVAILABLE) throw new BadRequestException("Somente carregadores disponíveis podem iniciar sessões");
    const session = await this.prisma.$transaction(async tx => {
      const count = await tx.chargingSession.count();
      const session = await tx.chargingSession.create({ data: { code: `EMP-${1100 + count}`, clientId: dto.clientId, chargerId: dto.chargerId, startTime: new Date(), status: SessionStatus.ACTIVE }, include: { client: true, charger: true } });
      await tx.charger.update({ where: { id: dto.chargerId }, data: { status: ChargerStatus.IN_USE } });
      return session;
    });
    this.realtime.publish({ customerId: session.client.userId ?? undefined, entityId: session.id, operational: true, topic: "session.created" });
    this.publishChargerChange(dto.chargerId);
    return session;
  }
  @Post("charging-sessions/:id/finish")
  async finish(@Param("id") id: string, @Body() dto: FinishChargingSessionDto) {
    const session = await this.prisma.chargingSession.findUnique({ where: { id }, include: { charger: true } });
    if (!session || session.status !== SessionStatus.ACTIVE) throw new BadRequestException("Sessão ativa não encontrada");
    const endTime = new Date();
    const durationMinutes = Math.max(1, dto.durationMinutes ?? Math.round((endTime.getTime() - session.startTime.getTime()) / 60000));
    const energyKwh = Number(session.charger.powerKw) * durationMinutes / 60;
    const totalPrice = energyKwh * Number(session.charger.pricePerKwh);
    const result = await this.prisma.$transaction(async tx => {
      const finished = await tx.chargingSession.update({ where: { id }, data: { endTime, durationMinutes, energyKwh, totalPrice, status: SessionStatus.FINISHED }, include: { client: true, charger: true } });
      await tx.charger.update({ where: { id: session.chargerId }, data: { status: ChargerStatus.AVAILABLE } });
      const payment = await tx.payment.create({ data: { code: `PAY-${Date.now()}`, sessionId: id, method: PaymentMethod.SIMULATED, amount: totalPrice, status: PaymentStatus.APPROVED, paidAt: endTime } });
      return { finished, payment };
    });
    const customerId = result.finished.client.userId ?? undefined;
    this.realtime.publish({ customerId, entityId: id, operational: true, topic: "session.updated" });
    this.realtime.publish({ customerId, entityId: result.payment.id, operational: true, topic: "payment.updated" });
    this.publishChargerChange(session.chargerId);
    return result.finished;
  }
  @Post("charging-sessions/:id/cancel")
  async cancel(@Param("id") id: string) {
    const session = await this.prisma.chargingSession.findUnique({ include: { client: { select: { userId: true } } }, where: { id } });
    if (!session || session.status !== SessionStatus.ACTIVE) throw new BadRequestException("Sessão ativa não encontrada");
    const canceled = await this.prisma.$transaction(async tx => {
      const canceled = await tx.chargingSession.update({ where: { id }, data: { status: SessionStatus.CANCELED, endTime: new Date() } });
      await tx.charger.update({ where: { id: session.chargerId }, data: { status: ChargerStatus.AVAILABLE } });
      return canceled;
    });
    this.realtime.publish({ customerId: session.client.userId ?? undefined, entityId: id, operational: true, topic: "session.updated" });
    this.publishChargerChange(session.chargerId);
    return canceled;
  }
  @Post("charging-sessions/:id/settle-cash") settleCash(@Param("id") id: string, @Body() dto: CashSettlementDto) { return this.adminOperations.settleCash(id, dto); }

  @Get("payments") payments() { return this.prisma.payment.findMany({ include: { session: { include: { client: true, charger: { include: { station: true, liveStatus: true } } } } }, orderBy: { createdAt: "desc" } }); }
  @Get("payments/:id") payment(@Param("id") id: string) { return this.prisma.payment.findUnique({ where: { id }, include: { session: true } }); }
  @Post("payments/simulate") async simulate(@Body() dto: SimulatePaymentDto) {
    const session = await this.prisma.chargingSession.findUnique({ include: { client: { select: { userId: true } } }, where: { id: dto.sessionId } });
    if (!session?.totalPrice) throw new BadRequestException("Finalize a sessão antes do pagamento");
    const payment = await this.prisma.payment.upsert({ where: { sessionId: dto.sessionId }, update: { status: PaymentStatus.APPROVED, paidAt: new Date() }, create: { code: `PAY-${Date.now()}`, sessionId: dto.sessionId, method: dto.method ?? PaymentMethod.SIMULATED, amount: session.totalPrice, status: PaymentStatus.APPROVED, paidAt: new Date() } });
    this.realtime.publish({ customerId: session.client.userId ?? undefined, entityId: payment.id, operational: true, topic: "payment.updated" });
    this.realtime.publish({ entityId: "summary", operational: true, topic: "dashboard.updated" });
    return payment;
  }
  @Post("payments/:id/approve") approvePayment(@Param("id") id: string) { return this.adminOperations.approvePayment(id); }

  @Get("alerts") alerts() { return this.prisma.alert.findMany({ include: { charger: true }, orderBy: { createdAt: "desc" } }); }
  @Patch("alerts/:id/status") async updateAlert(@Param("id") id: string, @Body() dto: UpdateAlertStatusDto) {
    const alert = await this.prisma.alert.update({ where: { id }, data: { status: dto.status } });
    this.realtime.publish({ entityId: alert.id, operational: true, topic: "alert.updated" });
    this.realtime.publish({ entityId: "summary", operational: true, topic: "dashboard.updated" });
    return alert;
  }

  private publishChargerChange(chargerId: string) {
    this.realtime.publish({ entityId: chargerId, topic: "charger.updated" });
    this.realtime.publish({ entityId: "summary", operational: true, topic: "dashboard.updated" });
  }
}
