"use client";

import {
  alerts,
  chargers,
  clients,
  dashboardData,
  payments,
  sessions,
} from "@/lib/mock-data";
import {
  ApiResource,
  DashboardData,
  FrontSession,
  ResourceRow,
} from "@/lib/domain";

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

  async registerPayment(pagamentoId: string) {
    await wait(120);
    return { ok: true, pagamentoId, status: "aprovado" as const };
  },
};
