"use client";

import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CheckCircle2,
  CircleDollarSign,
  Gauge,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/AppShell";
import { ChargerVisualBoard } from "@/components/ChargerVisualBoard";
import { StatusBadge } from "@/components/StatusBadge";
import { DashboardData } from "@/lib/domain";
import {
  formatCurrency,
  formatDateTime,
  formatKwh,
  formatMinutes,
  formatPercent,
} from "@/lib/formatters";
import { api } from "@/services/api";

type MetricCard = {
  label: string;
  value: string;
  detail: string;
  tone: string;
  icon: LucideIcon;
};

function Metric({
  label,
  value,
  detail,
  tone,
  icon: Icon,
}: MetricCard) {
  return (
    <article className="metric-card">
      <span className={`metric-icon metric-icon--${tone}`}>
        <Icon size={19} aria-hidden="true" />
      </span>
      <small>{label}</small>
      <strong>{value}</strong>
      <em>{detail}</em>
    </article>
  );
}

function DashboardSkeleton() {
  return (
    <div className="loading-panel">
      <RefreshCw className="spin" size={20} aria-hidden="true" />
      Carregando painel EMPS
    </div>
  );
}

export function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    try {
      setData(await api.dashboard());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const metrics = useMemo<MetricCard[]>(() => {
    if (!data) return [];
    const resumo = data.resumo;
    return [
      {
        label: "Receita hoje",
        value: formatCurrency(resumo.receitaHoje),
        detail: "Pagamentos aprovados",
        tone: "coral",
        icon: Banknote,
      },
      {
        label: "Receita no mes",
        value: formatCurrency(resumo.receitaMes),
        detail: "Base operacional",
        tone: "violet",
        icon: CircleDollarSign,
      },
      {
        label: "Energia hoje",
        value: formatKwh(resumo.energiaHojeKwh),
        detail: "Numero puro da API",
        tone: "cyan",
        icon: Zap,
      },
      {
        label: "Sessoes hoje",
        value: String(resumo.sessoesHoje),
        detail: `${resumo.sessoesAtivas} em andamento`,
        tone: "blue",
        icon: Users,
      },
      {
        label: "Disponiveis",
        value: String(resumo.carregadoresDisponiveis),
        detail: "Prontos para iniciar",
        tone: "green",
        icon: PlugZap,
      },
      {
        label: "Offline",
        value: String(resumo.carregadoresOffline),
        detail: "Exige verificacao",
        tone: "red",
        icon: AlertTriangle,
      },
      {
        label: "Ocupacao",
        value: formatPercent(resumo.taxaOcupacao),
        detail: "Uso da rede",
        tone: "orange",
        icon: Gauge,
      },
      {
        label: "Ticket medio",
        value: formatCurrency(resumo.ticketMedio),
        detail: "Transacao aprovada",
        tone: "yellow",
        icon: TrendingUp,
      },
    ];
  }, [data]);

  function refresh() {
    load();
    setNotice("Dados simulados recarregados no contrato do front.");
    window.setTimeout(() => setNotice(""), 2200);
  }

  return (
    <AppShell
      eyebrow="EMPS / Operacao"
      title="Painel do Eletroposto"
      description="Front administrativo pronto para plugar na API EMPS oficial."
      actions={
        <button className="button button--ghost" onClick={refresh}>
          <RefreshCw size={15} aria-hidden="true" />
          Atualizar
        </button>
      }
    >
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={16} aria-hidden="true" />
          {notice}
        </div>
      )}

      {loading || !data ? (
        <DashboardSkeleton />
      ) : (
        <>
          <section className="metric-grid" aria-label="Indicadores principais">
            {metrics.map((metric) => (
              <Metric key={metric.label} {...metric} />
            ))}
          </section>

          <section className="flow-strip">
            <div className="section-heading">
              <div>
                <span>Fluxo de monetizacao</span>
                <h2>Sessao ativa mais recente</h2>
              </div>
              <StatusBadge status="ativa" />
            </div>

            {data.sessoes[0] && (
              <div className="flow-grid">
                {[
                  ["Cliente", data.sessoes[0].usuarioNome, Users, "violet"],
                  ["Carregador", data.sessoes[0].carregadorNome, PlugZap, "blue"],
                  ["Energia", formatKwh(data.sessoes[0].energiaKwh), Zap, "cyan"],
                  ["Valor", formatCurrency(data.sessoes[0].valorTotal), Banknote, "orange"],
                  ["Pagamento", "Pendente", ShieldCheck, "yellow"],
                ].map(([label, value, Icon, tone], index) => (
                  <div className="flow-step" key={String(label)}>
                    <span className={`metric-icon metric-icon--${tone}`}>
                      <Icon size={18} aria-hidden="true" />
                    </span>
                    <small>{String(label)}</small>
                    <strong>{String(value)}</strong>
                    {index < 4 && <ArrowRight size={14} aria-hidden="true" />}
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="dashboard-grid">
            <section className="chart-panel">
              <div className="section-heading">
                <div>
                  <span>Financeiro</span>
                  <h2>Receita por hora</h2>
                </div>
              </div>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.receitaPorHora} margin={{ top: 12, right: 16, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ff5c66" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#ff5c66" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,.08)" vertical={false} />
                    <XAxis dataKey="hora" axisLine={false} tickLine={false} tick={{ fill: "#87919c", fontSize: 12 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "#87919c", fontSize: 12 }} />
                    <Tooltip contentStyle={{ background: "#111820", border: "1px solid #26323d", color: "#fff" }} />
                    <Area type="monotone" dataKey="receita" stroke="#ff5c66" fill="url(#revenueFill)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="chart-panel">
              <div className="section-heading">
                <div>
                  <span>Energia</span>
                  <h2>kWh comercializados</h2>
                </div>
              </div>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.energiaPorHora} margin={{ top: 12, right: 16, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(255,255,255,.08)" vertical={false} />
                    <XAxis dataKey="hora" axisLine={false} tickLine={false} tick={{ fill: "#87919c", fontSize: 12 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "#87919c", fontSize: 12 }} />
                    <Tooltip contentStyle={{ background: "#111820", border: "1px solid #26323d", color: "#fff" }} />
                    <Bar dataKey="energiaKwh" fill="#55d6e8" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>

          <div className="dashboard-grid dashboard-grid--wide">
            <section className="panel">
              <div className="section-heading">
                <div>
                  <span>Infraestrutura</span>
                  <h2>Status dos carregadores</h2>
                </div>
              </div>
              <ChargerVisualBoard chargers={data.carregadores} />
            </section>

            <section className="panel side-stack">
              <div className="section-heading">
                <div>
                  <span>Governanca</span>
                  <h2>Prontidao de integracao</h2>
                </div>
              </div>
              {data.integracoes.map((item) => (
                <article className="integration-row" key={item.nome}>
                  <StatusBadge status={item.estado} />
                  <div>
                    <strong>{item.nome}</strong>
                    <small>{item.detalhe}</small>
                  </div>
                </article>
              ))}
            </section>
          </div>

          <div className="dashboard-grid dashboard-grid--wide">
            <section className="panel table-panel">
              <div className="section-heading">
                <div>
                  <span>Monitoramento</span>
                  <h2>Sessoes recentes</h2>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Sessao</th>
                      <th>Cliente</th>
                      <th>Carregador</th>
                      <th>Duracao</th>
                      <th>Energia</th>
                      <th>Valor</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sessoes.slice(0, 5).map((session) => (
                      <tr key={session.sessaoId}>
                        <td>{session.sessaoId}</td>
                        <td>{session.usuarioNome}</td>
                        <td>{session.carregadorNome}</td>
                        <td>{formatMinutes(session.duracaoMinutos)}</td>
                        <td>{formatKwh(session.energiaKwh)}</td>
                        <td>{formatCurrency(session.valorTotal)}</td>
                        <td>
                          <StatusBadge status={session.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel side-stack">
              <div className="section-heading">
                <div>
                  <span>Atencao</span>
                  <h2>Alertas abertos</h2>
                </div>
              </div>
              {data.alertas.slice(0, 4).map((alert) => (
                <article className="alert-row" key={alert.alertaId}>
                  <AlertTriangle size={17} aria-hidden="true" />
                  <div>
                    <strong>{alert.titulo}</strong>
                    <small>
                      {alert.carregadorNome ?? alert.origem} · {formatDateTime(alert.dataCriacao)}
                    </small>
                  </div>
                  <StatusBadge status={alert.severidade} />
                </article>
              ))}
            </section>
          </div>
        </>
      )}
    </AppShell>
  );
}
