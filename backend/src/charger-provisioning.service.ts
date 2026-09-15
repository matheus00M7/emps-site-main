import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ChargerAdministrativeStatus,
  ChargerOperationalStatus,
  ChargerProvisioningStatus,
  ChargerStatus,
  Prisma,
  Role,
  StationStatus,
} from "@prisma/client";
import { randomBytes } from "node:crypto";
import type { AuthUser } from "./auth";
import type {
  ClaimChargerProvisioningDto,
  CreateChargerProvisioningDto,
  RejectChargerProvisioningDto,
} from "./charger-provisioning.dtos";
import { createOpaqueToken, hashOpaqueToken } from "./mobile.utils";
import { PrismaService } from "./prisma.service";
import { RealtimeService } from "./realtime.service";

const provisioningSelect = {
  activationExpiresAt: true,
  activationTokenLastFour: true,
  approvedAt: true,
  canceledAt: true,
  charger: {
    select: {
      administrativeStatus: true,
      id: true,
      publicCode: true,
      qrBindings: {
        orderBy: { createdAt: "desc" as const },
        select: { code: true, createdAt: true, publicToken: true },
        take: 1,
        where: { revokedAt: null },
      },
      status: true,
    },
  },
  chargerId: true,
  connectionVerifiedAt: true,
  connectorType: true,
  createdAt: true,
  firmwareVersion: true,
  id: true,
  location: true,
  manufacturer: true,
  model: true,
  name: true,
  ocppIdentity: true,
  ocppVersion: true,
  phaseCount: true,
  powerKw: true,
  powerType: true,
  pricePerKwh: true,
  rejectedAt: true,
  rejectionReason: true,
  requestedBy: { select: { email: true, id: true, name: true } },
  reviewedBy: { select: { email: true, id: true, name: true } },
  serialNumber: true,
  station: {
    select: { city: true, code: true, id: true, name: true, state: true, status: true },
  },
  stationId: true,
  status: true,
  updatedAt: true,
} satisfies Prisma.ChargerProvisioningSelect;

const terminalProvisioningStatuses: ChargerProvisioningStatus[] = [
  ChargerProvisioningStatus.REJECTED,
  ChargerProvisioningStatus.CANCELED,
  ChargerProvisioningStatus.EXPIRED,
];

function cleanText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeIdentifier(value: string) {
  return cleanText(value).toUpperCase();
}

function normalizeActivationCode(value: string) {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

function newActivationCode() {
  const value = randomBytes(8).toString("hex").toUpperCase();
  return `EMPS-${value.match(/.{4}/g)!.join("-")}`;
}

function publicSuffix() {
  return randomBytes(8).toString("hex").toUpperCase();
}

function isStationScopedUser(user: AuthUser) {
  return user.role === Role.ADMIN || user.role === Role.STATION_OWNER;
}

@Injectable()
export class ChargerProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  private activationExpiresAt() {
    const configured = Number(process.env.CHARGER_ACTIVATION_DAYS ?? 7);
    const days = Number.isFinite(configured)
      ? Math.min(30, Math.max(1, configured))
      : 7;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1_000);
  }

  private async expireStaleRequests() {
    await this.prisma.chargerProvisioning.updateMany({
      data: { status: ChargerProvisioningStatus.EXPIRED },
      where: {
        activationExpiresAt: { lte: new Date() },
        status: ChargerProvisioningStatus.PENDING_CONNECTION,
      },
    });
  }

  private async result(id: string) {
    const provisioning = await this.prisma.chargerProvisioning.findUnique({
      select: provisioningSelect,
      where: { id },
    });
    if (!provisioning) throw new NotFoundException("Solicitação de carregador não encontrada");
    return provisioning;
  }

  async stationOptions(user: AuthUser) {
    return this.prisma.station.findMany({
      orderBy: { name: "asc" },
      select: {
        _count: { select: { chargers: true, provisionings: true } },
        city: true,
        code: true,
        id: true,
        name: true,
        state: true,
        status: true,
      },
      where: {
        ...(isStationScopedUser(user) ? { adminId: user.sub } : {}),
        status: StationStatus.ACTIVE,
      },
    });
  }

  async list(user: AuthUser) {
    await this.expireStaleRequests();
    return this.prisma.chargerProvisioning.findMany({
      orderBy: { createdAt: "desc" },
      select: provisioningSelect,
      where: isStationScopedUser(user) ? { station: { adminId: user.sub } } : {},
    });
  }

  async create(user: AuthUser, dto: CreateChargerProvisioningDto) {
    const station = await this.prisma.station.findFirst({
      select: { code: true, id: true },
      where: {
        ...(isStationScopedUser(user) ? { adminId: user.sub } : {}),
        id: dto.stationId,
        status: StationStatus.ACTIVE,
      },
    });
    if (!station) {
      throw new ForbiddenException("Eletroposto ativo não encontrado para esta conta");
    }

    await this.expireStaleRequests();
    const name = cleanText(dto.name);
    const location = cleanText(dto.location);
    const connectorType = cleanText(dto.connectorType).toUpperCase();
    const manufacturer = cleanText(dto.manufacturer);
    const model = cleanText(dto.model);
    const serialNumber = normalizeIdentifier(dto.serialNumber);
    const ocppIdentity = normalizeIdentifier(dto.ocppIdentity);
    if (
      !name ||
      !location ||
      !connectorType ||
      !manufacturer ||
      !model ||
      !serialNumber ||
      !ocppIdentity
    ) {
      throw new BadRequestException("Os dados de identificação da bomba são obrigatórios");
    }
    const duplicate = await this.prisma.chargerProvisioning.findFirst({
      select: { id: true, status: true },
      where: {
        OR: [{ serialNumber }, { ocppIdentity }],
        status: {
          notIn: terminalProvisioningStatuses,
        },
      },
    });
    if (duplicate) {
      throw new ConflictException(
        duplicate.status === ChargerProvisioningStatus.ENABLED
          ? "Esta bomba física já está cadastrada e habilitada"
          : "Já existe uma solicitação ativa para este número de série ou identidade OCPP",
      );
    }

    const activationCode = newActivationCode();
    try {
      const created = await this.prisma.chargerProvisioning.create({
        data: {
          activationExpiresAt: this.activationExpiresAt(),
          activationTokenHash: hashOpaqueToken(normalizeActivationCode(activationCode)),
          activationTokenLastFour: activationCode.slice(-4),
          connectorType,
          location,
          manufacturer,
          model,
          name,
          ocppIdentity,
          ocppVersion: dto.ocppVersion,
          phaseCount: dto.phaseCount,
          powerKw: dto.powerKw,
          powerType: dto.powerType,
          pricePerKwh: dto.pricePerKwh,
          requestedById: user.sub,
          serialNumber,
          stationId: station.id,
        },
        select: { id: true },
      });
      this.realtime.publishToOperations({ entityId: created.id, topic: "station.updated" });
      return { ...(await this.result(created.id)), activationCode };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException(
          "Já existe uma solicitação ativa para este número de série ou identidade OCPP",
        );
      }
      throw error;
    }
  }

  async claim(dto: ClaimChargerProvisioningDto) {
    const activationCode = normalizeActivationCode(dto.activationCode);
    const record = await this.prisma.chargerProvisioning.findUnique({
      select: {
        activationExpiresAt: true,
        connectionVerifiedAt: true,
        id: true,
        ocppIdentity: true,
        serialNumber: true,
        status: true,
      },
      where: { activationTokenHash: hashOpaqueToken(activationCode) },
    });
    if (!record) throw new NotFoundException("Código de ativação inválido");
    if (record.status === ChargerProvisioningStatus.PENDING_APPROVAL) {
      return {
        id: record.id,
        message: "Bomba física já validada. Aguardando aprovação da equipe EMPS.",
        status: ChargerProvisioningStatus.PENDING_APPROVAL,
        verifiedAt: record.connectionVerifiedAt?.toISOString() ?? null,
      };
    }
    if (record.status !== ChargerProvisioningStatus.PENDING_CONNECTION) {
      throw new ConflictException("Este código de ativação já foi utilizado ou cancelado");
    }
    if (record.activationExpiresAt <= new Date()) {
      await this.prisma.chargerProvisioning.updateMany({
        data: { status: ChargerProvisioningStatus.EXPIRED },
        where: { id: record.id, status: ChargerProvisioningStatus.PENDING_CONNECTION },
      });
      throw new GoneException("Código de ativação expirado");
    }
    if (
      normalizeIdentifier(dto.serialNumber) !== record.serialNumber ||
      normalizeIdentifier(dto.ocppIdentity) !== record.ocppIdentity
    ) {
      throw new BadRequestException(
        "O número de série ou a identidade OCPP não correspondem à solicitação",
      );
    }

    const verifiedAt = new Date();
    const updated = await this.prisma.chargerProvisioning.updateMany({
      data: {
        connectionVerifiedAt: verifiedAt,
        firmwareVersion: dto.firmwareVersion ? cleanText(dto.firmwareVersion) : undefined,
        status: ChargerProvisioningStatus.PENDING_APPROVAL,
      },
      where: {
        activationExpiresAt: { gt: verifiedAt },
        id: record.id,
        status: ChargerProvisioningStatus.PENDING_CONNECTION,
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException("A solicitação mudou de estado; atualize e tente novamente");
    }
    this.realtime.publishToOperations({ entityId: record.id, topic: "station.updated" });
    return {
      id: record.id,
      message: "Bomba física validada. Aguardando aprovação da equipe EMPS.",
      status: ChargerProvisioningStatus.PENDING_APPROVAL,
      verifiedAt: verifiedAt.toISOString(),
    };
  }

  async approve(user: AuthUser, id: string) {
    const request = await this.prisma.chargerProvisioning.findUnique({
      include: { station: { select: { code: true, id: true, status: true } } },
      where: { id },
    });
    if (!request) throw new NotFoundException("Solicitação de carregador não encontrada");
    if (request.status !== ChargerProvisioningStatus.PENDING_APPROVAL) {
      throw new ConflictException("Somente bombas físicas validadas podem ser aprovadas");
    }
    if (!request.connectionVerifiedAt) {
      throw new ConflictException("A conexão física precisa ser validada antes da aprovação");
    }
    if (request.station.status !== StationStatus.ACTIVE) {
      throw new ConflictException("O eletroposto precisa estar ativo antes da aprovação");
    }

    const approvedAt = new Date();
    const publicCode = `${request.station.code}-${publicSuffix()}`;
    const qrPublicToken = createOpaqueToken(24);

    const chargerId = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.chargerProvisioning.updateMany({
        data: {
          approvedAt,
          reviewedById: user.sub,
          status: ChargerProvisioningStatus.ENABLED,
        },
        where: {
          chargerId: null,
          id,
          status: ChargerProvisioningStatus.PENDING_APPROVAL,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException("Esta solicitação já foi analisada por outro operador");
      }

      const charger = await tx.charger.create({
        data: {
          administrativeStatus: ChargerAdministrativeStatus.ENABLED,
          configuredPowerLimitKw: request.powerKw,
          connectorType: request.connectorType,
          firmwareVersion: request.firmwareVersion,
          liveStatus: {
            create: {
              lastSeenAt: request.connectionVerifiedAt ?? approvedAt,
              operationalStatus: ChargerOperationalStatus.AVAILABLE,
            },
          },
          location: request.location,
          manufacturer: request.manufacturer,
          model: request.model,
          name: request.name,
          ocppIdentity: request.ocppIdentity,
          ocppVersion: request.ocppVersion,
          phaseCount: request.phaseCount,
          powerKw: request.powerKw,
          powerType: request.powerType,
          pricePerKwh: request.pricePerKwh,
          provisionedAt: approvedAt,
          publicCode,
          qrBindings: {
            create: { code: publicCode, publicToken: qrPublicToken },
          },
          serialNumber: request.serialNumber,
          stationId: request.stationId,
          status: ChargerStatus.AVAILABLE,
        },
        select: { id: true },
      });
      await tx.chargerProvisioning.update({
        data: { chargerId: charger.id },
        where: { id },
      });
      return charger.id;
    });

    this.realtime.publish({ entityId: chargerId, topic: "charger.updated" });
    this.realtime.publishToOperations({ entityId: id, topic: "station.updated" });
    this.realtime.publishToOperations({ entityId: "summary", topic: "dashboard.updated" });
    return this.result(id);
  }

  async reject(user: AuthUser, id: string, dto: RejectChargerProvisioningDto) {
    const rejectionReason = cleanText(dto.reason);
    if (rejectionReason.length < 5) {
      throw new BadRequestException("Informe um motivo de rejeição com pelo menos 5 caracteres");
    }
    const now = new Date();
    const updated = await this.prisma.chargerProvisioning.updateMany({
      data: {
        rejectedAt: now,
        rejectionReason,
        reviewedById: user.sub,
        status: ChargerProvisioningStatus.REJECTED,
      },
      where: {
        id,
        status: {
          in: [
            ChargerProvisioningStatus.PENDING_CONNECTION,
            ChargerProvisioningStatus.PENDING_APPROVAL,
          ],
        },
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException("Somente solicitações pendentes podem ser rejeitadas");
    }
    this.realtime.publishToOperations({ entityId: id, topic: "station.updated" });
    return this.result(id);
  }

  async cancel(user: AuthUser, id: string) {
    const now = new Date();
    const updated = await this.prisma.chargerProvisioning.updateMany({
      data: { canceledAt: now, status: ChargerProvisioningStatus.CANCELED },
      where: {
        id,
        ...(isStationScopedUser(user)
          ? { station: { adminId: user.sub } }
          : {}),
        status: {
          in: [
            ChargerProvisioningStatus.PENDING_CONNECTION,
            ChargerProvisioningStatus.PENDING_APPROVAL,
          ],
        },
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException("Solicitação não encontrada ou não pode mais ser cancelada");
    }
    this.realtime.publishToOperations({ entityId: id, topic: "station.updated" });
    return this.result(id);
  }

  async remove(user: AuthUser, id: string) {
    const request = await this.prisma.chargerProvisioning.findFirst({
      select: { chargerId: true, id: true, status: true },
      where: {
        id,
        ...(isStationScopedUser(user)
          ? { station: { adminId: user.sub } }
          : {}),
      },
    });
    if (!request) {
      throw new NotFoundException("Solicitação de carregador não encontrada");
    }
    if (
      request.chargerId ||
      !terminalProvisioningStatuses.includes(request.status)
    ) {
      throw new ConflictException(
        "Somente solicitações canceladas, rejeitadas ou expiradas e sem carregador liberado podem ser excluídas",
      );
    }

    const removed = await this.prisma.chargerProvisioning.deleteMany({
      where: {
        chargerId: null,
        id,
        ...(isStationScopedUser(user)
          ? { station: { adminId: user.sub } }
          : {}),
        status: { in: terminalProvisioningStatuses },
      },
    });
    if (removed.count !== 1) {
      throw new ConflictException(
        "A solicitação mudou de estado; atualize e tente novamente",
      );
    }

    this.realtime.publishToOperations({ entityId: id, topic: "station.updated" });
    return { deleted: true, id };
  }
}
