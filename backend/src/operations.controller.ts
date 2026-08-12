import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ChargerStatus, PaymentMethod, PaymentStatus, SessionStatus } from "@prisma/client";
import { JwtGuard } from "./auth";
import { CreateChargerDto, CreateClientDto, FinishChargingSessionDto, SimulatePaymentDto, StartChargingSessionDto, UpdateAlertStatusDto, UpdateChargerStatusDto, UpdateClientDto } from "./dtos";
import { PrismaService } from "./prisma.service";

@UseGuards(JwtGuard)
@Controller()
export class OperationsController {
  constructor(private prisma: PrismaService) {}

  @Get("clients") clients() { return this.prisma.client.findMany({ include: { sessions: true }, orderBy: { name: "asc" } }); }
  @Get("clients/:id") client(@Param("id") id: string) { return this.prisma.client.findUnique({ where: { id }, include: { sessions: true } }); }
  @Post("clients") createClient(@Body() dto: CreateClientDto) { return this.prisma.client.create({ data: dto }); }
  @Patch("clients/:id") updateClient(@Param("id") id: string, @Body() dto: UpdateClientDto) { return this.prisma.client.update({ where: { id }, data: dto }); }
  @Delete("clients/:id") deleteClient(@Param("id") id: string) { return this.prisma.client.delete({ where: { id } }); }

  @Get("chargers") chargers() { return this.prisma.charger.findMany({ include: { sessions: { where: { status: SessionStatus.ACTIVE }, include: { client: true } } }, orderBy: { location: "asc" } }); }
  @Get("chargers/:id") charger(@Param("id") id: string) { return this.prisma.charger.findUnique({ where: { id }, include: { sessions: true, alerts: true } }); }
  @Post("chargers") createCharger(@Body() dto: CreateChargerDto) { return this.prisma.charger.create({ data: { ...dto, status: dto.status ?? ChargerStatus.AVAILABLE } }); }
  @Patch("chargers/:id") updateCharger(@Param("id") id: string, @Body() dto: Partial<CreateChargerDto>) { return this.prisma.charger.update({ where: { id }, data: dto }); }
  @Patch("chargers/:id/status") updateChargerStatus(@Param("id") id: string, @Body() dto: UpdateChargerStatusDto) { return this.prisma.charger.update({ where: { id }, data: { status: dto.status } }); }
  @Delete("chargers/:id") deleteCharger(@Param("id") id: string) { return this.prisma.charger.delete({ where: { id } }); }

  @Get("charging-sessions")
  sessions(@Query("status") status?: SessionStatus) {
    return this.prisma.chargingSession.findMany({ where: status ? { status } : {}, include: { client: true, charger: true, payment: true }, orderBy: { startTime: "desc" } });
  }
  @Get("charging-sessions/:id") session(@Param("id") id: string) { return this.prisma.chargingSession.findUnique({ where: { id }, include: { client: true, charger: true, payment: true } }); }
  @Post("charging-sessions/start")
  async start(@Body() dto: StartChargingSessionDto) {
    const charger = await this.prisma.charger.findUnique({ where: { id: dto.chargerId } });
    if (!charger) throw new NotFoundException("Carregador não encontrado");
    if (charger.status !== ChargerStatus.AVAILABLE) throw new BadRequestException("Somente carregadores disponíveis podem iniciar sessões");
    return this.prisma.$transaction(async tx => {
      const count = await tx.chargingSession.count();
      const session = await tx.chargingSession.create({ data: { code: `EMP-${1100 + count}`, clientId: dto.clientId, chargerId: dto.chargerId, startTime: new Date(), status: SessionStatus.ACTIVE }, include: { client: true, charger: true } });
      await tx.charger.update({ where: { id: dto.chargerId }, data: { status: ChargerStatus.IN_USE } });
      return session;
    });
  }
  @Post("charging-sessions/:id/finish")
  async finish(@Param("id") id: string, @Body() dto: FinishChargingSessionDto) {
    const session = await this.prisma.chargingSession.findUnique({ where: { id }, include: { charger: true } });
    if (!session || session.status !== SessionStatus.ACTIVE) throw new BadRequestException("Sessão ativa não encontrada");
    const endTime = new Date();
    const durationMinutes = Math.max(1, dto.durationMinutes ?? Math.round((endTime.getTime() - session.startTime.getTime()) / 60000));
    const energyKwh = Number(session.charger.powerKw) * durationMinutes / 60;
    const totalPrice = energyKwh * Number(session.charger.pricePerKwh);
    return this.prisma.$transaction(async tx => {
      const finished = await tx.chargingSession.update({ where: { id }, data: { endTime, durationMinutes, energyKwh, totalPrice, status: SessionStatus.FINISHED }, include: { client: true, charger: true } });
      await tx.charger.update({ where: { id: session.chargerId }, data: { status: ChargerStatus.AVAILABLE } });
      await tx.payment.create({ data: { code: `PAY-${Date.now()}`, sessionId: id, method: PaymentMethod.SIMULATED, amount: totalPrice, status: PaymentStatus.APPROVED, paidAt: endTime } });
      return finished;
    });
  }
  @Post("charging-sessions/:id/cancel")
  async cancel(@Param("id") id: string) {
    const session = await this.prisma.chargingSession.findUnique({ where: { id } });
    if (!session || session.status !== SessionStatus.ACTIVE) throw new BadRequestException("Sessão ativa não encontrada");
    return this.prisma.$transaction(async tx => {
      const canceled = await tx.chargingSession.update({ where: { id }, data: { status: SessionStatus.CANCELED, endTime: new Date() } });
      await tx.charger.update({ where: { id: session.chargerId }, data: { status: ChargerStatus.AVAILABLE } });
      return canceled;
    });
  }

  @Get("payments") payments() { return this.prisma.payment.findMany({ include: { session: { include: { client: true, charger: true } } }, orderBy: { createdAt: "desc" } }); }
  @Get("payments/:id") payment(@Param("id") id: string) { return this.prisma.payment.findUnique({ where: { id }, include: { session: true } }); }
  @Post("payments/simulate") async simulate(@Body() dto: SimulatePaymentDto) {
    const session = await this.prisma.chargingSession.findUnique({ where: { id: dto.sessionId } });
    if (!session?.totalPrice) throw new BadRequestException("Finalize a sessão antes do pagamento");
    return this.prisma.payment.upsert({ where: { sessionId: dto.sessionId }, update: { status: PaymentStatus.APPROVED, paidAt: new Date() }, create: { code: `PAY-${Date.now()}`, sessionId: dto.sessionId, method: dto.method ?? PaymentMethod.SIMULATED, amount: session.totalPrice, status: PaymentStatus.APPROVED, paidAt: new Date() } });
  }

  @Get("alerts") alerts() { return this.prisma.alert.findMany({ include: { charger: true }, orderBy: { createdAt: "desc" } }); }
  @Patch("alerts/:id/status") updateAlert(@Param("id") id: string, @Body() dto: UpdateAlertStatusDto) { return this.prisma.alert.update({ where: { id }, data: { status: dto.status } }); }
}
