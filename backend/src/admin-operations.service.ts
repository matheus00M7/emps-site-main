import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ChargerAdministrativeStatus,
  ChargerOperationalStatus,
  ChargerStatus,
  ChargingCommandStatus,
  ChargingCommandType,
  PaymentMethod,
  PaymentStatus,
  SessionStatus,
} from "@prisma/client";
import { randomBytes } from "node:crypto";
import { ChargingGatewayService } from "./charging-gateway.service";
import type {
  AdminChargerCommand,
  CashSettlementDto,
  ManualReleaseDto,
  PostpaidReleaseDto,
} from "./dtos";
import { PrismaService } from "./prisma.service";

const CASH_CLIENT_ID = "client_cash_walkin";

function operationCode(prefix: "EMP" | "PAY") {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
}

function commandType(command: AdminChargerCommand) {
  if (command === "encerrar_carga") return ChargingCommandType.STOP_CHARGING;
  if (command === "liberar_conector") return ChargingCommandType.UNLOCK_CONNECTOR;
  if (command === "reiniciar_equipamento") return ChargingCommandType.RESET;
  return ChargingCommandType.SYNC_STATUS;
}

function gatewayCommand(type: ChargingCommandType) {
  if (type === ChargingCommandType.STOP_CHARGING) return "STOP" as const;
  if (type === ChargingCommandType.UNLOCK_CONNECTOR) return "UNLOCK" as const;
  if (type === ChargingCommandType.RESET) return "RESET" as const;
  return "STATUS" as const;
}

@Injectable()
export class AdminOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly charging: ChargingGatewayService,
  ) {}

  async sendCommand(chargerId: string, requested: AdminChargerCommand) {
    const charger = await this.prisma.charger.findUnique({
      include: {
        sessions: {
          orderBy: { startTime: "desc" },
          take: 1,
          where: { status: SessionStatus.ACTIVE },
        },
      },
      where: { id: chargerId },
    });
    if (!charger) throw new NotFoundException("Carregador não encontrado");

    if (requested === "solicitar_manutencao") {
      if (charger.sessions.length > 0) {
        throw new ConflictException("Encerre a recarga ativa antes de solicitar manutenção");
      }
      const processedAt = new Date();
      await this.prisma.$transaction([
        this.prisma.charger.update({
          data: {
            administrativeStatus: ChargerAdministrativeStatus.MAINTENANCE,
            status: ChargerStatus.MAINTENANCE,
          },
          where: { id: chargerId },
        }),
        this.prisma.chargerLiveStatus.upsert({
          create: {
            chargerId,
            currentPowerKw: 0,
            operationalStatus: ChargerOperationalStatus.UNAVAILABLE,
          },
          update: {
            currentPowerKw: 0,
            operationalStatus: ChargerOperationalStatus.UNAVAILABLE,
          },
          where: { chargerId },
        }),
        this.prisma.alert.create({
          data: {
            chargerId,
            description: `Manutenção solicitada para ${charger.name} pelo painel administrativo.`,
            severity: "MEDIUM",
            title: "Manutenção solicitada",
          },
        }),
      ]);
      return { chargerId, command: requested, processedAt, status: "COMPLETED" };
    }

    const type = commandType(requested);
    const activeSession = charger.sessions[0];
    if (type === ChargingCommandType.STOP_CHARGING && !activeSession) {
      throw new BadRequestException("Não existe recarga ativa neste carregador");
    }
    const command = await this.prisma.chargingCommand.create({
      data: {
        chargerId,
        idempotencyKey: `admin-${requested}-${Date.now()}-${randomBytes(3).toString("hex")}`,
        requestPayload: { command: requested, source: "admin-dashboard" },
        sessionId: activeSession?.id,
        status: ChargingCommandStatus.PENDING,
        timeoutAt: new Date(Date.now() + 30_000),
        type,
      },
    });
    let result;
    try {
      result = await this.charging.dispatch({
        chargerId,
        commandId: command.id,
        ocppIdentity: charger.ocppIdentity,
        ocppVersion: charger.ocppVersion,
        sessionId: activeSession?.id,
        type: gatewayCommand(type),
      });
    } catch (error) {
      await this.prisma.chargingCommand.update({
        data: {
          attempts: { increment: 1 },
          lastError: error instanceof Error ? error.message : "Falha no gateway OCPP",
          status: ChargingCommandStatus.FAILED,
        },
        where: { id: command.id },
      });
      throw error;
    }
    if (!result.accepted) {
      await this.prisma.chargingCommand.update({
        data: {
          attempts: { increment: 1 },
          lastError: result.message ?? "Comando recusado",
          responsePayload: result,
          status: ChargingCommandStatus.REJECTED,
        },
        where: { id: command.id },
      });
      throw new BadGatewayException("O equipamento recusou o comando");
    }

    const processedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.chargingCommand.update({
        data: {
          acknowledgedAt: processedAt,
          attempts: { increment: 1 },
          completedAt: result.mode === "sandbox" ? processedAt : undefined,
          ocppMessageId: result.correlationId,
          responsePayload: result,
          sentAt: processedAt,
          status:
            result.mode === "sandbox"
              ? ChargingCommandStatus.COMPLETED
              : ChargingCommandStatus.ACCEPTED,
        },
        where: { id: command.id },
      });

      if (requested === "sincronizar_status") {
        await tx.chargerLiveStatus.upsert({
          create: { chargerId, lastSeenAt: processedAt },
          update: { lastSeenAt: processedAt },
          where: { chargerId },
        });
      }
      if (requested === "encerrar_carga" && activeSession) {
        const seconds = Math.max(
          0,
          Math.round((processedAt.getTime() - activeSession.startTime.getTime()) / 1_000),
        );
        const energyKwh = Number(charger.powerKw) * (seconds / 3_600);
        const totalPrice = energyKwh * Number(
          activeSession.pricePerKwhSnapshot ?? charger.pricePerKwh,
        );
        await tx.chargingSession.update({
          data: {
            durationMinutes: Math.max(1, Math.ceil(seconds / 60)),
            endTime: processedAt,
            energyKwh,
            status: SessionStatus.WAITING_PAYMENT,
            stopRequestedAt: processedAt,
            totalPrice,
          },
          where: { id: activeSession.id },
        });
        await tx.payment.upsert({
          create: {
            amount: totalPrice,
            code: operationCode("PAY"),
            method: PaymentMethod.SIMULATED,
            provider: "ADMIN",
            sessionId: activeSession.id,
            status: PaymentStatus.PENDING,
          },
          update: { amount: totalPrice, status: PaymentStatus.PENDING },
          where: { sessionId: activeSession.id },
        });
        await tx.charger.update({
          data: { status: ChargerStatus.AVAILABLE },
          where: { id: chargerId },
        });
        await tx.chargerLiveStatus.upsert({
          create: {
            chargerId,
            currentPowerKw: 0,
            lastSeenAt: processedAt,
            operationalStatus: ChargerOperationalStatus.AVAILABLE,
          },
          update: {
            currentPowerKw: 0,
            lastSeenAt: processedAt,
            operationalStatus: ChargerOperationalStatus.AVAILABLE,
          },
          where: { chargerId },
        });
      }
    });
    return { chargerId, command: requested, processedAt, status: "COMPLETED" };
  }

  private async startCashSession(
    chargerId: string,
    _requestedTariff: number,
    prepaidAmount: number | null,
  ) {
    const charger = await this.prisma.charger.findUnique({
      include: { liveStatus: true },
      where: { id: chargerId },
    });
    if (!charger) throw new NotFoundException("Carregador não encontrado");
    if (
      charger.status !== ChargerStatus.AVAILABLE ||
      charger.administrativeStatus !== ChargerAdministrativeStatus.ENABLED
    ) {
      throw new ConflictException("Carregador indisponível para liberação");
    }
    const tariff = Number(charger.pricePerKwh);
    const startedAt = new Date();
    const created = await this.prisma.$transaction(async (tx) => {
      const reserved = await tx.charger.updateMany({
        data: { status: ChargerStatus.IN_USE },
        where: {
          administrativeStatus: ChargerAdministrativeStatus.ENABLED,
          id: chargerId,
          status: ChargerStatus.AVAILABLE,
        },
      });
      if (reserved.count !== 1) throw new ConflictException("A vaga acabou de ser ocupada");
      const client = await tx.client.upsert({
        create: { id: CASH_CLIENT_ID, name: "Cliente avulso (caixa)" },
        update: { name: "Cliente avulso (caixa)" },
        where: { id: CASH_CLIENT_ID },
      });
      const session = await tx.chargingSession.create({
        data: {
          chargerId,
          clientId: client.id,
          code: operationCode("EMP"),
          lastMeterKwh: charger.liveStatus?.meterTotalKwh,
          meterStartKwh: charger.liveStatus?.meterTotalKwh,
          pricePerKwhSnapshot: tariff,
          spendingLimit: prepaidAmount,
          startTime: startedAt,
          stationId: charger.stationId,
          status: SessionStatus.ACTIVE,
          tariffLockedAt: startedAt,
        },
      });
      if (prepaidAmount !== null) {
        await tx.payment.create({
          data: {
            amount: prepaidAmount,
            code: operationCode("PAY"),
            method: PaymentMethod.CASH,
            paidAt: startedAt,
            provider: "CASH_REGISTER",
            sessionId: session.id,
            status: PaymentStatus.APPROVED,
          },
        });
      }
      const command = await tx.chargingCommand.create({
        data: {
          chargerId,
          clientId: client.id,
          idempotencyKey: `cash-start-${session.id}`,
          requestPayload: { prepaidAmount, tariff },
          sessionId: session.id,
          status: ChargingCommandStatus.PENDING,
          timeoutAt: new Date(Date.now() + 30_000),
          type: ChargingCommandType.START_CHARGING,
        },
      });
      await tx.chargerLiveStatus.upsert({
        create: {
          chargerId,
          lastSeenAt: startedAt,
          operationalStatus: ChargerOperationalStatus.PREPARING,
        },
        update: {
          lastSeenAt: startedAt,
          operationalStatus: ChargerOperationalStatus.PREPARING,
        },
        where: { chargerId },
      });
      return { command, session };
    });

    try {
      const result = await this.charging.dispatch({
        chargerId,
        commandId: created.command.id,
        ocppIdentity: charger.ocppIdentity,
        ocppVersion: charger.ocppVersion,
        sessionId: created.session.id,
        type: "START",
      });
      if (!result.accepted) throw new BadGatewayException("O carregador recusou a liberação");
      await this.prisma.$transaction([
        this.prisma.chargingCommand.update({
          data: {
            acknowledgedAt: new Date(),
            attempts: { increment: 1 },
            completedAt: result.mode === "sandbox" ? new Date() : undefined,
            ocppMessageId: result.correlationId,
            responsePayload: result,
            sentAt: new Date(),
            status:
              result.mode === "sandbox"
                ? ChargingCommandStatus.COMPLETED
                : ChargingCommandStatus.ACCEPTED,
          },
          where: { id: created.command.id },
        }),
        this.prisma.chargingSession.update({
          data: { transactionId: result.correlationId },
          where: { id: created.session.id },
        }),
        this.prisma.chargerLiveStatus.update({
          data: {
            currentPowerKw: Number(charger.powerKw) * 0.82,
            lastSeenAt: new Date(),
            operationalStatus: ChargerOperationalStatus.CHARGING,
          },
          where: { chargerId },
        }),
      ]);
    } catch (error) {
      await this.prisma.$transaction(async (tx) => {
        await tx.chargingCommand.update({
          data: {
            attempts: { increment: 1 },
            lastError: error instanceof Error ? error.message : "Falha no gateway OCPP",
            status: ChargingCommandStatus.FAILED,
          },
          where: { id: created.command.id },
        });
        await tx.chargingSession.update({
          data: { endTime: new Date(), status: SessionStatus.CANCELED },
          where: { id: created.session.id },
        });
        await tx.payment.updateMany({
          data: { status: PaymentStatus.REJECTED },
          where: { sessionId: created.session.id },
        });
        await tx.charger.update({
          data: { status: ChargerStatus.AVAILABLE },
          where: { id: chargerId },
        });
        await tx.chargerLiveStatus.update({
          data: { currentPowerKw: 0, operationalStatus: ChargerOperationalStatus.AVAILABLE },
          where: { chargerId },
        });
      });
      throw error;
    }
    return { session: created.session, startedAt };
  }

  async manualRelease(chargerId: string, dto: ManualReleaseDto) {
    const { session, startedAt } = await this.startCashSession(
      chargerId,
      dto.tarifaKwh,
      dto.valorRecebido,
    );
    return {
      carregadorId: chargerId,
      chargerStatus: "IN_USE",
      energiaLiberadaKwh: Number((dto.valorRecebido / dto.tarifaKwh).toFixed(3)),
      liberacaoId: session.id,
      processedAt: startedAt,
      sessaoId: session.id,
      valorRecebido: dto.valorRecebido,
    };
  }

  async startPostpaid(chargerId: string, dto: PostpaidReleaseDto) {
    const { session, startedAt } = await this.startCashSession(
      chargerId,
      dto.tarifaKwh,
      null,
    );
    return {
      carregadorId: chargerId,
      chargerStatus: "IN_USE",
      liberacaoId: session.id,
      sessaoId: session.id,
      startedAt,
      tarifaKwh: Number(session.pricePerKwhSnapshot),
    };
  }

  async settleCash(sessionId: string, dto: CashSettlementDto) {
    const session = await this.prisma.chargingSession.findUnique({
      include: { charger: true },
      where: { id: sessionId },
    });
    if (!session || session.status !== SessionStatus.ACTIVE) {
      throw new BadRequestException("Sessão ativa não encontrada");
    }
    const authoritativeAmount = Number(
      (dto.energiaConsumidaKwh * Number(session.pricePerKwhSnapshot ?? session.charger.pricePerKwh)).toFixed(2),
    );
    if (Math.abs(authoritativeAmount - dto.valorCobrado) > 0.05) {
      throw new BadRequestException(
        `O valor correto para ${dto.energiaConsumidaKwh.toFixed(3)} kWh é R$ ${authoritativeAmount.toFixed(2)}`,
      );
    }
    if (dto.valorRecebido < authoritativeAmount) {
      throw new BadRequestException("O valor recebido é menor que o total da sessão");
    }

    const command = await this.prisma.chargingCommand.create({
      data: {
        chargerId: session.chargerId,
        clientId: session.clientId,
        idempotencyKey: `cash-stop-${session.id}`,
        sessionId: session.id,
        status: ChargingCommandStatus.PENDING,
        type: ChargingCommandType.STOP_CHARGING,
      },
    });
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
        data: { lastError: result.message ?? "Comando recusado", status: ChargingCommandStatus.REJECTED },
        where: { id: command.id },
      });
      throw new BadGatewayException("O carregador não confirmou o encerramento");
    }

    const processedAt = new Date();
    const durationMinutes = Math.max(
      1,
      Math.ceil((processedAt.getTime() - session.startTime.getTime()) / 60_000),
    );
    await this.prisma.$transaction([
      this.prisma.chargingSession.update({
        data: {
          durationMinutes,
          endTime: processedAt,
          energyKwh: dto.energiaConsumidaKwh,
          status: SessionStatus.FINISHED,
          stopRequestedAt: processedAt,
          totalPrice: authoritativeAmount,
          transactionId: session.transactionId ?? result.correlationId,
        },
        where: { id: sessionId },
      }),
      this.prisma.payment.upsert({
        create: {
          amount: authoritativeAmount,
          capturedAt: processedAt,
          code: operationCode("PAY"),
          method: PaymentMethod.CASH,
          paidAt: processedAt,
          provider: "CASH_REGISTER",
          sessionId,
          status: PaymentStatus.APPROVED,
        },
        update: {
          amount: authoritativeAmount,
          capturedAt: processedAt,
          method: PaymentMethod.CASH,
          paidAt: processedAt,
          provider: "CASH_REGISTER",
          status: PaymentStatus.APPROVED,
        },
        where: { sessionId },
      }),
      this.prisma.charger.update({
        data: { status: ChargerStatus.AVAILABLE },
        where: { id: session.chargerId },
      }),
      this.prisma.chargerLiveStatus.upsert({
        create: {
          chargerId: session.chargerId,
          currentPowerKw: 0,
          lastSeenAt: processedAt,
          operationalStatus: ChargerOperationalStatus.AVAILABLE,
        },
        update: {
          currentPowerKw: 0,
          lastSeenAt: processedAt,
          operationalStatus: ChargerOperationalStatus.AVAILABLE,
        },
        where: { chargerId: session.chargerId },
      }),
      this.prisma.chargingCommand.update({
        data: {
          acknowledgedAt: processedAt,
          attempts: { increment: 1 },
          completedAt: processedAt,
          ocppMessageId: result.correlationId,
          responsePayload: result,
          sentAt: processedAt,
          status: ChargingCommandStatus.COMPLETED,
        },
        where: { id: command.id },
      }),
    ]);
    return {
      carregadorId: session.chargerId,
      chargerStatus: "AVAILABLE",
      energiaConsumidaKwh: dto.energiaConsumidaKwh,
      processedAt,
      sessaoId: sessionId,
      troco: Number((dto.valorRecebido - authoritativeAmount).toFixed(2)),
      valorCobrado: authoritativeAmount,
      valorRecebido: dto.valorRecebido,
    };
  }

  async approvePayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException("Pagamento não encontrado");
    if (payment.status === PaymentStatus.REJECTED) {
      throw new BadRequestException("Pagamento rejeitado não pode ser aprovado manualmente");
    }
    if (payment.status === PaymentStatus.APPROVED) return payment;
    const paidAt = new Date();
    return this.prisma.$transaction(async (tx) => {
      const approved = await tx.payment.update({
        data: { capturedAt: paidAt, paidAt, status: PaymentStatus.APPROVED },
        where: { id: paymentId },
      });
      await tx.chargingSession.updateMany({
        data: { status: SessionStatus.FINISHED },
        where: { id: payment.sessionId, status: SessionStatus.WAITING_PAYMENT },
      });
      return approved;
    });
  }
}
