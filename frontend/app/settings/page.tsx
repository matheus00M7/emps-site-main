import {
  Clock3,
  DatabaseZap,
  KeyRound,
  PlugZap,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { StatusBadge } from "@/components/status/StatusBadge";

const settings = [
  {
    icon: DatabaseZap,
    label: "Fonte de dados",
    value: "Front-only mock",
    status: "pendente" as const,
    detail: "Preparado para uma unica API EMPS.",
  },
  {
    icon: KeyRound,
    label: "Autenticacao",
    value: "Sessao local visual",
    status: "pendente" as const,
    detail: "Trocar por POST /api/login e JWT real.",
  },
  {
    icon: ShieldCheck,
    label: "SEMS+",
    value: "Bloqueado no front",
    status: "pronto" as const,
    detail: "Credenciais e assinatura apenas no backend.",
  },
  {
    icon: PlugZap,
    label: "Status canonicos",
    value: "Ativos",
    status: "pronto" as const,
    detail: "Carregadores, sessoes, pagamentos e alertas padronizados.",
  },
  {
    icon: WalletCards,
    label: "Moeda e energia",
    value: "Formatacao visual",
    status: "pronto" as const,
    detail: "A origem usa numeros puros; a tela formata para pt-BR.",
  },
  {
    icon: Clock3,
    label: "Tempo real",
    value: "Aguardando API",
    status: "pendente" as const,
    detail: "Pode evoluir para polling, SSE ou WebSocket EMPS.",
  },
];

export default function SettingsPage() {
  return (
    <AppShell
      eyebrow="SEMS+ / EMPS"
      title="Configuracoes do Eletroposto"
      description="Modulo EMPS dentro do SEMS+ para governanca, integracao e operacao do eletroposto."
    >
      <section className="settings-grid">
        {settings.map((item) => {
          const Icon = item.icon;
          return (
            <article className="setting-card" key={item.label}>
              <div className="setting-card__top">
                <span className="metric-icon metric-icon--cyan">
                  <Icon size={19} aria-hidden="true" />
                </span>
                <StatusBadge status={item.status} />
              </div>
              <small>{item.label}</small>
              <strong>{item.value}</strong>
              <p>{item.detail}</p>
            </article>
          );
        })}
      </section>
    </AppShell>
  );
}

