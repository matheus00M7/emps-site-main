"use client";

import {
  Activity,
  AlertTriangle,
  BatteryCharging,
  CircleDollarSign,
  RefreshCw,
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
import { AppShell } from "@/components/shell/AppShell";
import { ChargerVisualBoard } from "@/components/chargers/ChargerVisualBoard";
import { StatusBadge } from "@/components/status/StatusBadge";
import {
  getDashboardMetrics,
  type DashboardMetric,
} from "@/components/dashboard/dashboard-metrics";
import { DashboardData } from "@/domain/emps";
import {
  formatCurrency,
  formatDateTime,
  formatKwh,
  formatMinutes,
} from "@/utils/formatters";
import { api } from "@/services/emps-api";

function Metric({
  bars,
  label,
  progress,
  sideLabel,
  sideValue,
  value,
  detail,
  tone,
  icon: Icon,
}: DashboardMetric) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <div className="metric-card__head">
        <span className={`metric-icon metric-icon--${tone}`}>
          <Icon size={18} aria-hidden="true" />
        </span>
        <small>{label}</small>
      </div>

      <div className="metric-card__body">
        <div className="metric-card__main">
          <strong>{value}</strong>
          <em>{detail}</em>
        </div>

        <div className="metric-card__insight">
          <span>{sideValue}</span>
          <small>{sideLabel}</small>
          <div className="metric-card__bars" aria-hidden="true">
            {bars.map((bar, index) => (
              <i
                key={`${label}-${index}`}
                style={{ height: `${bar}%` }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="metric-card__progress" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
    </article>
  );
}

function SectionHeading({
  eyebrow,
  icon: Icon,
  title,
  tone,
}: {
  eyebrow: string;
  icon: LucideIcon;
  title: string;
  tone: "infra" | "monitor" | "alert" | "money" | "energy";
}) {
  return (
    <div className={`section-heading section-heading--${tone}`}>
      <span className="section-heading__marker">
        <Icon size={15} aria-hidden="true" />
      </span>
      <div className="section-heading__copy">
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
    </div>
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

  const metrics = useMemo<DashboardMetric[]>(() => {
    if (!data) return [];
    return getDashboardMetrics(data);
  }, [data]);

  return (
    <AppShell
      eyebrow="EMPS / Operacao"
      showEmpsHeaderLogo
      title="Painel do Eletroposto"
    >
      {loading || !data ? (
        <DashboardSkeleton />
      ) : (
        <>
          <section className="panel dashboard-chargers-panel">
            <SectionHeading
              eyebrow="Infraestrutura"
              icon={BatteryCharging}
              title="Status dos carregadores"
              tone="infra"
            />
            <ChargerVisualBoard chargers={data.carregadores} />
          </section>

          <div className="dashboard-grid dashboard-grid--wide">
            <section className="panel table-panel">
              <SectionHeading
                eyebrow="Monitoramento"
                icon={Activity}
                title="Sessoes recentes"
                tone="monitor"
              />
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
              <SectionHeading
                eyebrow="Atencao"
                icon={AlertTriangle}
                title="Alertas abertos"
                tone="alert"
              />
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

          <section className="metric-grid" aria-label="Indicadores principais">
            {metrics.map((metric) => (
              <Metric key={metric.label} {...metric} />
            ))}
          </section>

          <div className="dashboard-grid dashboard-grid--charts">
            <section className="chart-panel">
              <SectionHeading
                eyebrow="Financeiro"
                icon={CircleDollarSign}
                title="Receita por hora"
                tone="money"
              />
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
              <SectionHeading
                eyebrow="Energia"
                icon={Zap}
                title="kWh comercializados"
                tone="energy"
              />
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
        </>
      )}
    </AppShell>
  );
}

