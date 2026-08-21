"use client";

import {
  alerts,
  chargers,
  clients,
  dashboardData,
  payments,
  sessions,
} from "@/data/mock/emps-mock-data";
import {
  ApiResource,
  ChargerCommand,
  DashboardData,
  FrontSession,
  ManualReleaseRequest,
  ManualReleaseResult,
  PostpaidReleaseRequest,
  PostpaidReleaseResult,
  PostpaidSettlementRequest,
  PostpaidSettlementResult,
  ResourceRow,
} from "@/domain/emps";

const SESSION_KEY = "emps_front_session";

const wait = (ms = 180) => new Promise((resolve) => window.setTimeout(resolve, ms));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function hasBrowserStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

export const frontSession = {
  get(): FrontSession | null {
    if (!hasBrowserStorage()) return null;
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as FrontSession;
    } catch {
      window.localStorage.removeItem(SESSION_KEY);
      return null;
    }
  },
  set(session: FrontSession) {
    if (!hasBrowserStorage()) return;
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  },
  clear() {
    if (!hasBrowserStorage()) return;
    window.localStorage.removeItem(SESSION_KEY);
  },
};

function rowsFor(resource: ApiResource): ResourceRow[] {
  const resources: Record<ApiResource, ResourceRow[]> = {
    carregadores: chargers,
    sessoes: sessions,
    pagamentos: payments,
    alertas: alerts,
    clientes: clients,
  };
  return resources[resource];
}

export const api = {
  async login(email: string, password: string) {
    await wait();

    if (!email.includes("@") || password.trim().length < 6) {
      throw new Error("Informe e-mail valido e senha com pelo menos 6 caracteres.");
    }

    const session: FrontSession = {
      usuarioId: "usr_admin_front",
      nome: "Administrador EMPS",
      email,
      role: "admin",
      modo: "front-only",
    };

    frontSession.set(session);
    return session;
  },

  async dashboard(): Promise<DashboardData> {
    await wait();
    return clone(dashboardData);
  },

  async list<T extends ResourceRow>(resource: ApiResource): Promise<T[]> {
    await wait();
    return clone(rowsFor(resource)) as T[];
  },

  async resolveAlert(alertaId: string) {
    await wait(120);
    return { ok: true, alertaId, status: "resolvido" as const };
  },

  async finishSession(sessaoId: string) {
    await wait(120);
    return { ok: true, sessaoId, status: "finalizada" as const };
  },

  async requestChargerStatus(carregadorId: string) {
    await wait(120);
    return { ok: true, carregadorId, queued: true };
  },

  async sendChargerCommand(carregadorId: string, command: ChargerCommand) {
    await wait(140);
    return { ok: true, carregadorId, command, processedAt: new Date().toISOString() };
  },

  async registerPayment(pagamentoId: string) {
    await wait(120);
    return { ok: true, pagamentoId, status: "aprovado" as const };
  },

  async releaseChargerManually(
    request: ManualReleaseRequest
  ): Promise<ManualReleaseResult> {
    await wait(180);

    if (request.valorRecebido <= 0 || request.tarifaKwh <= 0) {
      throw new Error("Informe um valor recebido valido para liberar energia.");
    }

    return {
      ok: true,
      liberacaoId: `manual_${Date.now()}`,
      sessaoId: `ses_manual_${Date.now()}`,
      carregadorId: request.carregadorId,
      chargerStatus: "em_uso",
      valorRecebido: request.valorRecebido,
      energiaLiberadaKwh: Number(
        (request.valorRecebido / request.tarifaKwh).toFixed(2)
      ),
      status: "liberacao_manual_confirmada",
    };
  },

  async startPostpaidCashSession(
    request: PostpaidReleaseRequest
  ): Promise<PostpaidReleaseResult> {
    await wait(180);

    if (request.tarifaKwh <= 0) {
      throw new Error("Tarifa invalida para iniciar conta em aberto.");
    }

    const startedAt = new Date().toISOString();

    return {
      ok: true,
      liberacaoId: `postpaid_${Date.now()}`,
      sessaoId: `ses_postpaid_${Date.now()}`,
      carregadorId: request.carregadorId,
      chargerStatus: "em_uso",
      tarifaKwh: request.tarifaKwh,
      startedAt,
      status: "sessao_pos_paga_iniciada",
    };
  },

  async settlePostpaidCashSession(
    request: PostpaidSettlementRequest
  ): Promise<PostpaidSettlementResult> {
    await wait(180);

    if (request.valorRecebido < request.valorCobrado) {
      throw new Error("Valor recebido menor que o total da sessao.");
    }

    return {
      ok: true,
      sessaoId: request.sessaoId,
      carregadorId: request.carregadorId,
      chargerStatus: "disponivel",
      energiaConsumidaKwh: request.energiaConsumidaKwh,
      valorCobrado: request.valorCobrado,
      valorRecebido: request.valorRecebido,
      troco: Number((request.valorRecebido - request.valorCobrado).toFixed(2)),
      processedAt: new Date().toISOString(),
      status: "sessao_pos_paga_finalizada",
    };
  },
};

