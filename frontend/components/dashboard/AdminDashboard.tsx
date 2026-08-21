"use client";

import {
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
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
  label,
  value,
  detail,
  tone,
  icon: Icon,
}: DashboardMetric) {
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
      title="Painel do Eletroposto"
    >
      {loading || !data ? (
        <DashboardSkeleton />
      ) : (
        <>
          <section className="panel dashboard-chargers-panel">
            <div className="section-heading">
              <div>
                <h2>Infraestrutura - Status dos carregadores</h2>
              </div>
            </div>
            <ChargerVisualBoard chargers={data.carregadores} />
          </section>

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

          <section className="metric-grid" aria-label="Indicadores principais">
            {metrics.map((metric) => (
              <Metric key={metric.label} {...metric} />
            ))}
          </section>

          <div className="dashboard-grid dashboard-grid--charts">
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
        </>
      )}
    </AppShell>
  );
}

