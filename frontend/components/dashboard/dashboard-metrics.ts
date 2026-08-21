import {
  AlertTriangle,
  Banknote,
  CircleDollarSign,
  Gauge,
  PlugZap,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DashboardData } from "@/domain/emps";
import {
  formatCurrency,
  formatKwh,
  formatPercent,
} from "@/utils/formatters";

export type DashboardMetric = {
  detail: string;
  icon: LucideIcon;
  label: string;
  tone: string;
  value: string;
};

export function getDashboardMetrics(data: DashboardData): DashboardMetric[] {
  const resumo = data.resumo;

  return [
    {
      detail: "Pagamentos aprovados",
      icon: Banknote,
      label: "Receita hoje",
      tone: "coral",
      value: formatCurrency(resumo.receitaHoje),
    },
    {
      detail: "Base operacional",
      icon: CircleDollarSign,
      label: "Receita no mes",
      tone: "violet",
      value: formatCurrency(resumo.receitaMes),
    },
    {
      detail: "Numero puro da API",
      icon: Zap,
      label: "Energia hoje",
      tone: "cyan",
      value: formatKwh(resumo.energiaHojeKwh),
    },
    {
      detail: `${resumo.sessoesAtivas} em andamento`,
      icon: Users,
      label: "Sessoes hoje",
      tone: "blue",
      value: String(resumo.sessoesHoje),
    },
    {
      detail: "Prontos para iniciar",
      icon: PlugZap,
      label: "Disponiveis",
      tone: "green",
      value: String(resumo.carregadoresDisponiveis),
    },
    {
      detail: "Exige verificacao",
      icon: AlertTriangle,
      label: "Offline",
      tone: "red",
      value: String(resumo.carregadoresOffline),
    },
    {
      detail: "Uso da rede",
      icon: Gauge,
      label: "Ocupacao",
      tone: "orange",
      value: formatPercent(resumo.taxaOcupacao),
    },
    {
      detail: "Transacao aprovada",
      icon: TrendingUp,
      label: "Ticket medio",
      tone: "yellow",
      value: formatCurrency(resumo.ticketMedio),
    },
  ];
}
