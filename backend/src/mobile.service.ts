import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  ChargerAdministrativeStatus,
  ChargerOperationalStatus,
  ChargerStatus,
  ChargingCommandStatus,
  ChargingCommandType,
  PaymentIntentStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  Role,
  SessionStatus,
  StationStatus,
} from "@prisma/client";
import * as bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import type Stripe from "stripe";
import { ChargingGatewayService } from "./charging-gateway.service";
import type {
  CreatePaymentIntentDto,
  MobileLoginDto,
  MobilePaymentMethod,
  MobileRegisterDto,
  NearbyStationsQueryDto,
  StartMobileChargingDto,
} from "./mobile.dtos";
import {
  createOpaqueToken,
  elapsedSeconds,
  hashOpaqueToken,
  haversineDistanceKm,
  normalizeEmail,
  resolveIdempotencyKey,
} from "./mobile.utils";
import { PaymentGatewayService } from "./payment-gateway.service";
import { PrismaService } from "./prisma.service";
import { RealtimeService } from "./realtime.service";

const activeQrWhere = (now = new Date()): Prisma.QrBindingWhereInput => ({
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  revokedAt: null,
  validFrom: { lte: now },
});

const chargerRelations = {
  liveStatus: true,
  qrBindings: { orderBy: { createdAt: "desc" as const }, take: 1 },
  station: true,
} as const;

const stationRelations = {
  chargers: {
    include: {
      liveStatus: true,
      qrBindings: { orderBy: { createdAt: "desc" as const }, take: 1 },
    },
    orderBy: { name: "asc" as const },
  },
} as const;

const sessionRelations = {
  charger: { include: { liveStatus: true } },
  payment: true,
  paymentIntent: true,
  station: true,
} as const;

type ChargerRecord = Prisma.ChargerGetPayload<{ include: typeof chargerRelations }>;
type StationRecord = Prisma.StationGetPayload<{ include: typeof stationRelations }>;
type SessionRecord = Prisma.ChargingSessionGetPayload<{ include: typeof sessionRelations }>;
type CustomerRecord = Prisma.UserGetPayload<{ include: { client: true } }>;

const paymentMethodFromMobile: Record<MobilePaymentMethod, PaymentMethod> = {
  card: PaymentMethod.CARD,
  pix: PaymentMethod.PIX,
  wallet: PaymentMethod.DIGITAL_WALLET,
};

function mobilePaymentMethod(method: PaymentMethod): MobilePaymentMethod {
  if (method === PaymentMethod.PIX) return "pix";
  if (method === PaymentMethod.DIGITAL_WALLET) return "wallet";
  return "card";
}

function mobileChargerStatus(status: ChargerStatus) {
  if (status === ChargerStatus.AVAILABLE) return "available" as const;
  if (status === ChargerStatus.IN_USE) return "in_use" as const;
  if (status === ChargerStatus.MAINTENANCE) return "maintenance" as const;
  return "offline" as const;
}

function paymentIntentStatus(status: PaymentIntentStatus) {
  if (status === PaymentIntentStatus.REJECTED || status === PaymentIntentStatus.CANCELED) {
    return "rejected" as const;
  }
  if (status === PaymentIntentStatus.AUTHORIZED || status === PaymentIntentStatus.CAPTURED) {
    return "authorized" as const;
  }
  return "requires_action" as const;
}

function sessionCode(prefix: "EMP" | "PAY") {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

@Injectable()
export class MobileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly payments: PaymentGatewayService,
    private readonly charging: ChargingGatewayService,
    private readonly realtime: RealtimeService,
  ) {}

  private refreshTokenExpiry() {
    const configured = Number(process.env.REFRESH_TOKEN_DAYS ?? 30);
    const days = Number.isFinite(configured) ? Math.min(365, Math.max(1, configured)) : 30;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1_000);
  }

  private publicUser(user: Pick<CustomerRecord, "id" | "name" | "email">) {
    return { email: user.email, id: user.id, name: user.name };
  }

  private async issueAuthentication(user: CustomerRecord, familyId?: string) {
    const refreshToken = createOpaqueToken();
    await this.prisma.refreshToken.create({
      data: {
        expiresAt: this.refreshTokenExpiry(),
        familyId,
        tokenHash: hashOpaqueToken(refreshToken),
        userId: user.id,
      },
    });
    const accessToken = await this.jwt.signAsync({
      email: user.email,
      role: user.role,
      sub: user.id,
    });
    return { accessToken, refreshToken, user: this.publicUser(user) };
  }

  private async customer(userId: string) {
    const user = await this.prisma.user.findUnique({
      include: { client: true },
      where: { id: userId },
    });
    if (!user || user.role !== Role.CUSTOMER || !user.client) {
      throw new UnauthorizedException("Conta de motorista inválida");
    }
    return user as CustomerRecord & { client: NonNullable<CustomerRecord["client"]> };
  }

  private requireIdempotency(headerValue: string | undefined, bodyValue?: string) {
    try {
      return resolveIdempotencyKey(headerValue, bodyValue);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Chave inválida");
    }
  }

  async register(dto: MobileRegisterDto) {
    const email = normalizeEmail(dto.email);
    const passwordHash = await bcrypt.hash(dto.password, 12);
    let user: CustomerRecord;
    try {
      user = await this.prisma.user.create({
        data: {
          client: { create: { name: dto.name.trim() } },
          email,
          name: dto.name.trim(),
          passwordHash,
          role: Role.CUSTOMER,
        },
        include: { client: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Já existe uma conta com este e-mail");
      }
      throw error;
    }
    const authentication = await this.issueAuthentication(user);
    this.realtime.publish({
      customerId: user.id,
      entityId: user.client!.id,
      operational: true,
      topic: "customer.updated",
    });
    return authentication;
  }

  async login(dto: MobileLoginDto) {
    const user = await this.prisma.user.findUnique({
      include: { client: true },
      where: { email: normalizeEmail(dto.email) },
    });
    const valid = user ? await bcrypt.compare(dto.password, user.passwordHash) : false;
    if (!valid || user?.role !== Role.CUSTOMER || !user.client) {
      throw new UnauthorizedException("E-mail ou senha inválidos");
    }
    return this.issueAuthentication(user);
  }

  async refresh(refreshToken: string) {
    const tokenHash = hashOpaqueToken(refreshToken);
    const current = await this.prisma.refreshToken.findUnique({
      include: { user: { include: { client: true } } },
      where: { tokenHash },
    });
    if (!current || current.expiresAt <= new Date()) {
      throw new UnauthorizedException("Sessão expirada. Entre novamente");
    }
    if (current.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        data: { revokedAt: new Date(), revokedReason: "possible_token_reuse" },
        where: { familyId: current.familyId, revokedAt: null },
      });
      throw new UnauthorizedException("Sessão inválida. Entre novamente");
    }
    if (current.user.role !== Role.CUSTOMER || !current.user.client) {
      throw new UnauthorizedException("Conta de motorista inválida");
    }

    const nextRawToken = createOpaqueToken();
    const rotated = await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.refreshToken.updateMany({
        data: {
          lastUsedAt: new Date(),
          revokedAt: new Date(),
          revokedReason: "rotated",
        },
        where: { id: current.id, revokedAt: null },
      });
      if (revoked.count !== 1) return false;
      await tx.refreshToken.create({
        data: {
          expiresAt: this.refreshTokenExpiry(),
          familyId: current.familyId,
          tokenHash: hashOpaqueToken(nextRawToken),
          userId: current.userId,
        },
      });
      return true;
    });
    if (!rotated) throw new UnauthorizedException("Sessão já renovada. Entre novamente");

    const accessToken = await this.jwt.signAsync({
      email: current.user.email,
      role: current.user.role,
      sub: current.user.id,
    });
    return {
      accessToken,
      refreshToken: nextRawToken,
      user: this.publicUser(current.user),
    };
  }

  async logout(userId: string, refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      data: { revokedAt: new Date(), revokedReason: "logout" },
      where: { tokenHash: hashOpaqueToken(refreshToken), userId, revokedAt: null },
    });
  }

  async me(userId: string) {
    return this.publicUser(await this.customer(userId));
  }

  private presentStation(station: StationRecord) {
    if (station.latitude === null || station.longitude === null) {
      throw new BadRequestException("Eletroposto ainda não possui coordenadas válidas");
    }
    return {
      address: `${station.street}, ${station.addressNumber}${station.complement ? ` - ${station.complement}` : ""}`,
      amenities: station.amenities,
      chargerIds: station.chargers.map((charger) => charger.id),
      city: `${station.city} · ${station.state}`,
      coordinates: {
        latitude: Number(station.latitude),
        longitude: Number(station.longitude),
      },
      featured: station.featured,
      id: station.id,
      name: station.name,
      neighborhood: station.neighborhood,
      openingHours: station.openingHours ?? "Consulte o horário no local",
    };
  }

  private presentCharger(charger: ChargerRecord) {
    const now = new Date();
    const qr = charger.qrBindings.find(
      (binding) =>
        !binding.revokedAt && binding.validFrom <= now && (!binding.expiresAt || binding.expiresAt > now),
    );
    return {
      bay: charger.location,
      connectorType: charger.connectorType,
      id: charger.id,
      label: charger.name,
      lastUpdatedAt: (charger.liveStatus?.updatedAt ?? charger.updatedAt).toISOString(),
      powerKw: Number(charger.powerKw),
      pricePerKwh: Number(charger.pricePerKwh),
      publicCode: charger.publicCode ?? charger.id,
      qrToken: qr?.publicToken ?? "",
      stationId: charger.stationId ?? "",
      status: mobileChargerStatus(charger.status),
    };
  }

  async nearbyStations(query: NearbyStationsQueryDto) {
    const stations = await this.prisma.station.findMany({
      include: stationRelations,
      where: {
        latitude: { not: null },
        longitude: { not: null },
        status: StationStatus.ACTIVE,
      },
    });
    return stations
      .map((station) => ({
        distance: haversineDistanceKm(
          { latitude: query.lat, longitude: query.lng },
          { latitude: Number(station.latitude), longitude: Number(station.longitude) },
        ),
        station,
      }))
      .filter(({ distance }) => distance <= query.radiusKm)
      .sort((first, second) => first.distance - second.distance)
      .map(({ station }) => this.presentStation(station));
  }

  async station(stationId: string) {
    const station = await this.prisma.station.findFirst({
      include: stationRelations,
      where: { id: stationId, status: StationStatus.ACTIVE },
    });
    if (!station) throw new NotFoundException("Eletroposto não encontrado");
    return this.presentStation(station);
  }

  async charger(chargerId: string) {
    const charger = await this.prisma.charger.findUnique({
      include: chargerRelations,
      where: { id: chargerId },
    });
    if (!charger) throw new NotFoundException("Carregador não encontrado");
    return this.presentCharger(charger);
  }

  async resolveQr(publicToken: string) {
    const now = new Date();
    const binding = await this.prisma.qrBinding.findFirst({
      include: { charger: { include: chargerRelations } },
      where: {
        AND: [activeQrWhere(now)],
        OR: [
          { publicToken },
          { code: publicToken },
          { charger: { publicCode: publicToken } },
        ],
      },
    });
    if (!binding || !binding.charger.station) {
      throw new NotFoundException("QR inválido, expirado ou ainda não cadastrado");
    }
    if (
      binding.charger.administrativeStatus !== ChargerAdministrativeStatus.ENABLED ||
      binding.charger.station.status !== StationStatus.ACTIVE
    ) {
      throw new ConflictException("Este carregador não está habilitado para recarga");
    }

    const station = await this.prisma.station.findUnique({
      include: stationRelations,
      where: { id: binding.charger.station.id },
    });
    if (!station) throw new NotFoundException("Eletroposto não encontrado");
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60_000);
    const tariffLockedUntil =
      binding.expiresAt && binding.expiresAt < fiveMinutesFromNow
        ? binding.expiresAt
        : fiveMinutesFromNow;
    return {
      charger: this.presentCharger(binding.charger),
      qrBindingId: binding.id,
      station: this.presentStation(station),
      tariffLockedUntil: tariffLockedUntil.toISOString(),
    };
  }

  private presentPaymentIntent(intent: {
    id: string;
    method: PaymentMethod;
    providerIntentId: string | null;
    status: PaymentIntentStatus;
  }, clientSecret?: string) {
    return {
      id: intent.id,
      method: mobilePaymentMethod(intent.method),
      ...(clientSecret ? { providerClientSecret: clientSecret } : {}),
      status: paymentIntentStatus(intent.status),
    };
  }

  async createPaymentIntent(
    userId: string,
    dto: CreatePaymentIntentDto,
    headerIdempotencyKey?: string,
  ) {
    const user = await this.customer(userId);
    const idempotencyKey = this.requireIdempotency(headerIdempotencyKey);
    const existing = await this.prisma.paymentIntent.findUnique({
      where: {
        clientId_idempotencyKey: { clientId: user.client.id, idempotencyKey },
      },
    });
    if (existing?.providerIntentId) return this.presentPaymentIntent(existing);

    const charger = await this.prisma.charger.findUnique({ where: { id: dto.chargerId } });
    if (!charger) throw new NotFoundException("Carregador não encontrado");
    if (
      charger.status !== ChargerStatus.AVAILABLE ||
      charger.administrativeStatus !== ChargerAdministrativeStatus.ENABLED
    ) {
      throw new ConflictException("Carregador indisponível para uma nova recarga");
    }

    const intent =
      existing ??
      (await this.prisma.paymentIntent.create({
        data: {
          chargerId: charger.id,
          clientId: user.client.id,
          idempotencyKey,
          method: paymentMethodFromMobile[dto.method],
          provider: "PENDING",
          spendingLimit: dto.spendingLimit,
          status: PaymentIntentStatus.REQUIRES_ACTION,
        },
      }));
    if (intent.chargerId !== charger.id || intent.method !== paymentMethodFromMobile[dto.method]) {
      throw new ConflictException("A chave de idempotência já foi usada em outra operação");
    }

    const gateway = await this.payments.createIntent({
      idempotencyKey,
      internalIntentId: intent.id,
      method: dto.method,
      spendingLimit: dto.spendingLimit,
    });
    const status =
      gateway.status === "authorized"
        ? PaymentIntentStatus.AUTHORIZED
        : gateway.status === "rejected"
          ? PaymentIntentStatus.REJECTED
          : PaymentIntentStatus.REQUIRES_ACTION;
    const updated = await this.prisma.paymentIntent.update({
      data: {
        authorizedAmount:
          status === PaymentIntentStatus.AUTHORIZED ? dto.spendingLimit : undefined,
        authorizedAt: status === PaymentIntentStatus.AUTHORIZED ? new Date() : undefined,
        provider: gateway.provider,
        providerIntentId: gateway.externalId,
        status,
      },
      where: { id: intent.id },
    });
    this.realtime.publish({
      customerId: userId,
      entityId: updated.id,
      operational: true,
      topic: "payment.updated",
    });
    return this.presentPaymentIntent(updated, gateway.clientSecret);
  }

  async paymentIntent(userId: string, intentId: string) {
    const user = await this.customer(userId);
    const intent = await this.prisma.paymentIntent.findFirst({
      where: { clientId: user.client.id, id: intentId },
    });
    if (!intent) throw new NotFoundException("Autorização de pagamento não encontrada");
    return this.presentPaymentIntent(intent);
  }

  private async fetchSession(sessionId: string, clientId: string) {
    const session = await this.prisma.chargingSession.findFirst({
      include: sessionRelations,
      where: { clientId, id: sessionId },
    });
    if (!session) throw new NotFoundException("Recarga não encontrada");
    return session;
  }

  private presentSession(session: SessionRecord) {
    const duration =
      session.durationMinutes !== null
        ? session.durationMinutes * 60
        : elapsedSeconds(session.startTime, session.endTime ?? new Date());
    const livePower = Number(session.charger.liveStatus?.currentPowerKw ?? 0);
    const powerKw = livePower > 0 ? livePower : Number(session.charger.powerKw);
    const measuredEnergy =
      session.lastMeterKwh !== null && session.meterStartKwh !== null
        ? Math.max(0, Number(session.lastMeterKwh) - Number(session.meterStartKwh))
        : 0;
    const energyKwh =
      session.energyKwh !== null
        ? Number(session.energyKwh)
        : measuredEnergy > 0
          ? measuredEnergy
          : (powerKw * duration) / 3_600;
    const price = Number(session.pricePerKwhSnapshot ?? session.charger.pricePerKwh);
    const method = session.paymentIntent?.method ?? session.payment?.method ?? PaymentMethod.CARD;
    const status =
      session.status === SessionStatus.ACTIVE
        ? "charging"
        : session.status === SessionStatus.FINISHED
          ? "completed"
          : session.status === SessionStatus.WAITING_PAYMENT
            ? "payment_pending"
            : "stopping";
    return {
      chargerId: session.chargerId,
      durationSeconds: duration,
      ...(session.endTime ? { endedAt: session.endTime.toISOString() } : {}),
      energyKwh: Number(energyKwh.toFixed(3)),
      id: session.id,
      paymentMethod: mobilePaymentMethod(method),
      powerKw: Number(powerKw.toFixed(3)),
      simulatedSecondsOffset: 0,
      spendingLimit:
        session.spendingLimit === null ? null : Number(session.spendingLimit),
      startedAt: session.startTime.toISOString(),
      stationId: session.stationId ?? session.charger.stationId ?? "",
      status,
      totalCost: Number((session.totalPrice === null ? energyKwh * price : Number(session.totalPrice)).toFixed(2)),
      ...(session.transactionId ? { transactionId: session.transactionId } : {}),
    };
  }

  async startCharging(
    userId: string,
    dto: StartMobileChargingDto,
    headerIdempotencyKey?: string,
  ) {
    const user = await this.customer(userId);
    const idempotencyKey = this.requireIdempotency(headerIdempotencyKey, dto.idempotencyKey);
    const existing = await this.prisma.chargingSession.findUnique({
      include: sessionRelations,
      where: {
        clientId_startIdempotencyKey: {
          clientId: user.client.id,
          startIdempotencyKey: idempotencyKey,
        },
      },
    });
    if (existing) return this.presentSession(existing);

    const now = new Date();
    const [binding, intent, activeSession] = await Promise.all([
      this.prisma.qrBinding.findFirst({
        include: { charger: { include: { liveStatus: true, station: true } } },
        where: { AND: [{ id: dto.qrBindingId }, activeQrWhere(now)] },
      }),
      this.prisma.paymentIntent.findFirst({
        where: { clientId: user.client.id, id: dto.paymentIntentId },
      }),
      this.prisma.chargingSession.findFirst({
        where: { clientId: user.client.id, status: SessionStatus.ACTIVE },
      }),
    ]);
    if (activeSession) throw new ConflictException("Você já possui uma recarga em andamento");
    if (!binding) throw new BadRequestException("O vínculo do QR expirou ou foi revogado");
    if (!intent || intent.chargerId !== binding.chargerId) {
      throw new BadRequestException("Pagamento e QR não pertencem ao mesmo carregador");
    }
    if (
      intent.status !== PaymentIntentStatus.AUTHORIZED &&
      intent.status !== PaymentIntentStatus.CAPTURED
    ) {
      throw new BadRequestException("O pagamento ainda não foi autorizado");
    }
    if (
      binding.charger.status !== ChargerStatus.AVAILABLE ||
      binding.charger.administrativeStatus !== ChargerAdministrativeStatus.ENABLED
    ) {
      throw new ConflictException("Carregador indisponível");
    }

    let createdId: string;
    try {
      createdId = await this.prisma.$transaction(async (tx) => {
        const reserved = await tx.charger.updateMany({
          data: { status: ChargerStatus.IN_USE },
          where: {
            administrativeStatus: ChargerAdministrativeStatus.ENABLED,
            id: binding.chargerId,
            status: ChargerStatus.AVAILABLE,
          },
        });
        if (reserved.count !== 1) throw new ConflictException("A vaga acabou de ser ocupada");
        const session = await tx.chargingSession.create({
          data: {
            chargerId: binding.chargerId,
            clientId: user.client.id,
            code: sessionCode("EMP"),
            meterStartKwh: binding.charger.liveStatus?.meterTotalKwh,
            lastMeterKwh: binding.charger.liveStatus?.meterTotalKwh,
            paymentIntentId: intent.id,
            pricePerKwhSnapshot: binding.charger.pricePerKwh,
            qrBindingId: binding.id,
            spendingLimit: dto.spendingLimit ?? intent.spendingLimit,
            startIdempotencyKey: idempotencyKey,
            startTime: now,
            stationId: binding.charger.stationId,
            status: SessionStatus.ACTIVE,
            tariffLockedAt: now,
            tariffLockedUntil: new Date(now.getTime() + 5 * 60_000),
          },
        });
        await tx.chargingCommand.create({
          data: {
            chargerId: binding.chargerId,
            clientId: user.client.id,
            idempotencyKey,
            requestPayload: { paymentIntentId: intent.id, qrBindingId: binding.id },
            sessionId: session.id,
            status: ChargingCommandStatus.PENDING,
            timeoutAt: new Date(Date.now() + 30_000),
            type: ChargingCommandType.START_CHARGING,
          },
        });
        await tx.chargerLiveStatus.upsert({
          create: {
            chargerId: binding.chargerId,
            lastSeenAt: now,
            operationalStatus: ChargerOperationalStatus.PREPARING,
          },
          update: {
            lastSeenAt: now,
            operationalStatus: ChargerOperationalStatus.PREPARING,
          },
          where: { chargerId: binding.chargerId },
        });
        return session.id;
      });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Já existe uma recarga ativa para este cliente ou carregador");
      }
      throw error;
    }

    const command = await this.prisma.chargingCommand.findFirstOrThrow({
      where: { sessionId: createdId, type: ChargingCommandType.START_CHARGING },
    });
    try {
      const result = await this.charging.dispatch({
        chargerId: binding.chargerId,
        commandId: command.id,
        ocppIdentity: binding.charger.ocppIdentity,
        ocppVersion: binding.charger.ocppVersion,
        sessionId: createdId,
        type: "START",
      });
      if (!result.accepted) {
        throw new BadGatewayException("O carregador recusou o início da recarga");
      }
      await this.prisma.$transaction([
        this.prisma.chargingCommand.update({
          data: {
            acknowledgedAt: new Date(),
            attempts: { increment: 1 },
            completedAt: result.mode === "sandbox" ? new Date() : undefined,
            ocppMessageId: result.correlationId,
            responsePayload: asJson(result),
            sentAt: new Date(),
            status:
              result.mode === "sandbox"
                ? ChargingCommandStatus.COMPLETED
                : ChargingCommandStatus.ACCEPTED,
          },
          where: { id: command.id },
        }),
        this.prisma.chargingSession.update({
          data: { transactionId: result.correlationId },
          where: { id: createdId },
        }),
        this.prisma.chargerLiveStatus.update({
          data: {
            currentPowerKw: Number(binding.charger.powerKw) * 0.82,
            lastSeenAt: new Date(),
            operationalStatus: ChargerOperationalStatus.CHARGING,
          },
          where: { chargerId: binding.chargerId },
        }),
      ]);
    } catch (error) {
      await this.failStart(
        createdId,
        command.id,
        error instanceof BadGatewayException
          ? error.message
          : "Falha de comunicação com o carregador",
        userId,
      );
      throw error;
    }
    const created = this.presentSession(await this.fetchSession(createdId, user.client.id));
    this.realtime.publish({
      customerId: userId,
      entityId: createdId,
      operational: true,
      topic: "session.created",
    });
    this.realtime.publish({
      entityId: binding.chargerId,
      topic: "charger.updated",
    });
    this.realtime.publish({ entityId: "summary", operational: true, topic: "dashboard.updated" });
    return created;
  }

  private async failStart(
    sessionId: string,
    commandId: string,
    reason: string,
    customerId: string,
  ) {
    const session = await this.prisma.chargingSession.findUnique({ where: { id: sessionId } });
    if (!session) return;
    await this.prisma.$transaction([
      this.prisma.chargingCommand.update({
        data: {
          attempts: { increment: 1 },
          lastError: reason,
          status: ChargingCommandStatus.FAILED,
        },
        where: { id: commandId },
      }),
      this.prisma.chargingSession.update({
        data: { endTime: new Date(), status: SessionStatus.CANCELED },
        where: { id: sessionId },
      }),
      this.prisma.charger.update({
        data: { status: ChargerStatus.AVAILABLE },
        where: { id: session.chargerId },
      }),
      this.prisma.chargerLiveStatus.update({
        data: { currentPowerKw: 0, operationalStatus: ChargerOperationalStatus.AVAILABLE },
        where: { chargerId: session.chargerId },
      }),
    ]);
    this.realtime.publish({
      customerId,
      entityId: sessionId,
      operational: true,
      topic: "session.updated",
    });
    this.realtime.publish({
      entityId: session.chargerId,
      topic: "charger.updated",
    });
    this.realtime.publish({ entityId: "summary", operational: true, topic: "dashboard.updated" });
  }

  async activeSession(userId: string) {
    const user = await this.customer(userId);
    const session = await this.prisma.chargingSession.findFirst({
      include: sessionRelations,
      orderBy: { startTime: "desc" },
      where: { clientId: user.client.id, status: SessionStatus.ACTIVE },
    });
    return session ? this.presentSession(session) : null;
  }

  async sessionHistory(userId: string) {
    const user = await this.customer(userId);
    const sessions = await this.prisma.chargingSession.findMany({
      include: sessionRelations,
      orderBy: { startTime: "desc" },
      take: 100,
      where: { clientId: user.client.id, status: { not: SessionStatus.ACTIVE } },
    });
    return sessions.map((session) => this.presentSession(session));
  }

  async session(userId: string, sessionId: string) {
    const user = await this.customer(userId);
    return this.presentSession(await this.fetchSession(sessionId, user.client.id));
  }

  async stopCharging(userId: string, sessionId: string, headerIdempotencyKey?: string) {
    const user = await this.customer(userId);
    const idempotencyKey = this.requireIdempotency(headerIdempotencyKey);
    let session = await this.fetchSession(sessionId, user.client.id);
    if (session.status !== SessionStatus.ACTIVE) {
      if (session.stopIdempotencyKey === idempotencyKey) return this.presentSession(session);
      throw new BadRequestException("Esta recarga já foi encerrada");
    }

    let command = await this.prisma.chargingCommand.findFirst({
      where: {
        clientId: user.client.id,
        idempotencyKey,
        type: ChargingCommandType.STOP_CHARGING,
      },
    });
    if (!command) {
      command = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.chargingSession.updateMany({
          data: { stopIdempotencyKey: idempotencyKey, stopRequestedAt: new Date() },
          where: {
            id: sessionId,
            OR: [{ stopIdempotencyKey: null }, { stopIdempotencyKey: idempotencyKey }],
            status: SessionStatus.ACTIVE,
          },
        });
        if (claimed.count !== 1) throw new ConflictException("O encerramento já está em andamento");
        return tx.chargingCommand.create({
          data: {
            chargerId: session.chargerId,
            clientId: user.client.id,
            idempotencyKey,
            sessionId,
            status: ChargingCommandStatus.PENDING,
            timeoutAt: new Date(Date.now() + 30_000),
            type: ChargingCommandType.STOP_CHARGING,
          },
        });
      });
    }

    const result = await this.charging.dispatch({
      chargerId: session.chargerId,
      commandId: command.id,
      ocppIdentity: session.charger.ocppIdentity,
      ocppVersion: session.charger.ocppVersion,
      sessionId,
      type: "STOP",
    });
    if (!result.accepted) {
      await this.prisma.chargingCommand.update({
        data: {
          attempts: { increment: 1 },
          lastError: result.message ?? "Comando de parada recusado",
          responsePayload: asJson(result),
          status: ChargingCommandStatus.REJECTED,
        },
        where: { id: command.id },
      });
      throw new BadGatewayException("O carregador não confirmou o encerramento");
    }

    const endedAt = new Date();
    const seconds = elapsedSeconds(session.startTime, endedAt);
    const livePower = Number(session.charger.liveStatus?.currentPowerKw ?? 0);
    const effectivePower = livePower > 0 ? livePower : Number(session.charger.powerKw) * 0.82;
    const meterStart = Number(session.meterStartKwh ?? 0);
    const liveMeter = Number(session.charger.liveStatus?.meterTotalKwh ?? 0);
    const energyFromMeter = meterStart > 0 && liveMeter >= meterStart ? liveMeter - meterStart : 0;
    const energyKwh = Math.max(0, energyFromMeter || (effectivePower * seconds) / 3_600);
    const calculatedPrice = energyKwh * Number(session.pricePerKwhSnapshot ?? session.charger.pricePerKwh);
    const spendingLimit = session.spendingLimit === null ? null : Number(session.spendingLimit);
    const totalPrice = Number(
      Math.max(0.01, spendingLimit === null ? calculatedPrice : Math.min(calculatedPrice, spendingLimit)).toFixed(2),
    );
    if (!session.paymentIntent?.providerIntentId) {
      throw new BadRequestException("A autorização de pagamento está incompleta");
    }
    const settlement = await this.payments.settleIntent({
      amount: totalPrice,
      externalId: session.paymentIntent.providerIntentId,
      method: mobilePaymentMethod(session.paymentIntent.method),
      provider: session.paymentIntent.provider,
    });
    const approved = settlement.status === "approved";
    const paymentStatus = approved
      ? PaymentStatus.APPROVED
      : settlement.status === "rejected"
        ? PaymentStatus.REJECTED
        : PaymentStatus.PENDING;
    const nextMeter = meterStart > 0 ? meterStart + energyKwh : liveMeter || energyKwh;

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.upsert({
        create: {
          amount: totalPrice,
          capturedAt: approved ? endedAt : null,
          code: sessionCode("PAY"),
          currency: session.currency,
          idempotencyKey: `settle-${idempotencyKey}`,
          method: session.paymentIntent!.method,
          paidAt: approved ? endedAt : null,
          paymentIntentId: session.paymentIntentId,
          provider: settlement.provider,
          providerPaymentId: settlement.externalPaymentId,
          sessionId,
          status: paymentStatus,
        },
        update: {
          amount: totalPrice,
          capturedAt: approved ? endedAt : null,
          paidAt: approved ? endedAt : null,
          provider: settlement.provider,
          providerPaymentId: settlement.externalPaymentId,
          status: paymentStatus,
        },
        where: { sessionId },
      });
      await tx.paymentIntent.update({
        data: {
          capturedAmount: approved ? settlement.capturedAmount : undefined,
          status: approved ? PaymentIntentStatus.CAPTURED : session.paymentIntent!.status,
        },
        where: { id: session.paymentIntentId! },
      });
      await tx.chargingSession.update({
        data: {
          durationMinutes: Math.max(1, Math.ceil(seconds / 60)),
          endTime: endedAt,
          energyKwh,
          lastMeterKwh: nextMeter,
          meterEndKwh: nextMeter,
          status: approved ? SessionStatus.FINISHED : SessionStatus.WAITING_PAYMENT,
          totalPrice,
          transactionId: session.transactionId ?? result.correlationId,
        },
        where: { id: sessionId },
      });
      await tx.charger.update({
        data: { status: ChargerStatus.AVAILABLE },
        where: { id: session.chargerId },
      });
      await tx.chargerLiveStatus.upsert({
        create: {
          chargerId: session.chargerId,
          currentPowerKw: 0,
          lastSeenAt: endedAt,
          meterTotalKwh: nextMeter,
          operationalStatus: ChargerOperationalStatus.AVAILABLE,
        },
        update: {
          currentPowerKw: 0,
          lastSeenAt: endedAt,
          meterTotalKwh: nextMeter,
          operationalStatus: ChargerOperationalStatus.AVAILABLE,
        },
        where: { chargerId: session.chargerId },
      });
      await tx.chargingCommand.update({
        data: {
          acknowledgedAt: endedAt,
          attempts: { increment: 1 },
          completedAt: endedAt,
          ocppMessageId: result.correlationId,
          responsePayload: asJson(result),
          sentAt: endedAt,
          status: ChargingCommandStatus.COMPLETED,
        },
        where: { id: command.id },
      });
    });
    session = await this.fetchSession(sessionId, user.client.id);
    this.realtime.publish({
      customerId: userId,
      entityId: session.id,
      operational: true,
      topic: "session.updated",
    });
    if (session.payment?.id) {
      this.realtime.publish({
        customerId: userId,
        entityId: session.payment.id,
        operational: true,
        topic: "payment.updated",
      });
    }
    this.realtime.publish({
      entityId: session.chargerId,
      topic: "charger.updated",
    });
    this.realtime.publish({ entityId: "summary", operational: true, topic: "dashboard.updated" });
    return this.presentSession(session);
  }

  async processStripeWebhook(event: Stripe.Event) {
    let record = await this.prisma.webhookEvent.findUnique({
      where: {
        provider_providerEventId: { provider: "STRIPE", providerEventId: event.id },
      },
    });
    if (!record) {
      try {
        record = await this.prisma.webhookEvent.create({
          data: {
            eventType: event.type,
            payload: asJson(event.data.object),
            provider: "STRIPE",
            providerEventId: event.id,
          },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
          throw error;
        }
        record = await this.prisma.webhookEvent.findUniqueOrThrow({
          where: {
            provider_providerEventId: { provider: "STRIPE", providerEventId: event.id },
          },
        });
      }
    }
    if (record.processedAt) return { duplicate: true, received: true };

    const object = event.data.object as Stripe.PaymentIntent;
    let status: PaymentIntentStatus | undefined;
    if (event.type === "payment_intent.amount_capturable_updated") {
      status = PaymentIntentStatus.AUTHORIZED;
    } else if (event.type === "payment_intent.succeeded") {
      status = PaymentIntentStatus.CAPTURED;
    } else if (event.type === "payment_intent.payment_failed") {
      status = PaymentIntentStatus.REJECTED;
    } else if (event.type === "payment_intent.canceled") {
      status = PaymentIntentStatus.CANCELED;
    }
    await this.prisma.$transaction(async (tx) => {
      if (status) {
        await tx.paymentIntent.updateMany({
          data: {
            authorizedAt: status === PaymentIntentStatus.AUTHORIZED ? new Date() : undefined,
            capturedAmount:
              status === PaymentIntentStatus.CAPTURED ? object.amount_received / 100 : undefined,
            status,
          },
          where: { provider: "STRIPE", providerIntentId: object.id },
        });
      }
      await tx.webhookEvent.update({
        data: { processedAt: new Date() },
        where: { id: record!.id },
      });
    });
    const linkedIntent = await this.prisma.paymentIntent.findFirst({
      include: { client: { select: { userId: true } } },
      where: { provider: "STRIPE", providerIntentId: object.id },
    });
    if (linkedIntent) {
      this.realtime.publish({
        customerId: linkedIntent.client.userId ?? undefined,
        entityId: linkedIntent.id,
        operational: true,
        topic: "payment.updated",
      });
      this.realtime.publish({ entityId: "summary", operational: true, topic: "dashboard.updated" });
    }
    return { received: true };
  }
}
