"use client";

import {
  AlertTriangle,
  BatteryCharging,
  CheckCircle2,
  CreditCard,
  Filter,
  PlugZap,
  RefreshCw,
  Search,
  Settings2,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ChargerVisualBoard } from "@/components/ChargerVisualBoard";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Alert,
  ApiResource,
  Charger,
  ChargingSession,
  Client,
  Payment,
  ResourceRow,
} from "@/lib/domain";
import {
  formatCurrency,
  formatDateTime,
  formatKwh,
  formatKw,
  formatMinutes,
  normalizeText,
} from "@/lib/formatters";
import { api } from "@/services/api";

type ResourceConfig = {
  title: string;
  eyebrow: string;
  description: string;
  icon: LucideIcon;
  filters: Array<{ label: string; value: string }>;
};

type Column = {
  label: string;
  className?: string;
  render: (row: ResourceRow) => ReactNode;
};

const configs: Record<ApiResource, ResourceConfig> = {
  carregadores: {
    title: "Carregadores",
    eyebrow: "EMPS / Infraestrutura",
    description: "Rede de equipamentos com status canonico e telemetria basica.",
    icon: PlugZap,
    filters: [
      { label: "Todos", value: "todos" },
      { label: "Disponiveis", value: "disponivel" },
      { label: "Em uso", value: "em_uso" },
      { label: "Offline", value: "offline" },
      { label: "Manutencao", value: "manutencao" },
    ],
  },
  sessoes: {
    title: "Sessoes",
    eyebrow: "EMPS / Operacao",
    description: "Ciclo de recarga com duracao, energia e valor em dados puros.",
    icon: BatteryCharging,
    filters: [
      { label: "Todas", value: "todos" },
      { label: "Ativas", value: "ativa" },
      { label: "Finalizadas", value: "finalizada" },
      { label: "Aguardando pagamento", value: "aguardando_pagamento" },
      { label: "Canceladas", value: "cancelada" },
    ],
  },
  pagamentos: {
    title: "Pagamentos",
    eyebrow: "EMPS / Financeiro",
    description: "Transacoes vinculadas a sessoes, sem formatacao monetaria na origem.",
    icon: CreditCard,
    filters: [
      { label: "Todos", value: "todos" },
      { label: "Aprovados", value: "aprovado" },
      { label: "Pendentes", value: "pendente" },
      { label: "Recusados", value: "recusado" },
      { label: "Estornados", value: "estornado" },
    ],
  },
  alertas: {
    title: "Alertas",
    eyebrow: "EMPS / Confiabilidade",
    description: "Eventos operacionais normalizados pela API antes de chegar ao site.",
    icon: AlertTriangle,
    filters: [
      { label: "Todos", value: "todos" },
      { label: "Abertos", value: "aberto" },
      { label: "Verificando", value: "verificando" },
      { label: "Resolvidos", value: "resolvido" },
      { label: "Criticos", value: "critica" },
    ],
  },
  clientes: {
    title: "Clientes",
    eyebrow: "EMPS / Relacionamento",
    description: "Usuarios finais identificados por ID, com nome apenas para exibicao.",
    icon: Users,
    filters: [
      { label: "Todos", value: "todos" },
      { label: "Ativos", value: "ativo" },
      { label: "Inativos", value: "inativo" },
    ],
  },
};

const columns: Record<ApiResource, Column[]> = {
  carregadores: [
    {
      label: "Carregador",
      render: (row) => {
        const charger = row as Charger;
        return (
          <div className="entity-cell">
            <strong>{charger.nome}</strong>
            <small>{charger.carregadorId}</small>
          </div>
        );
      },
    },
    {
      label: "Status",
      render: (row) => <StatusBadge status={(row as Charger).status} />,
    },
    {
      label: "Local",
      render: (row) => {
        const charger = row as Charger;
        return `${charger.estacaoNome} · ${charger.localizacao}`;
      },
    },
    {
      label: "Potencia",
      render: (row) => {
        const charger = row as Charger;
        return `${formatKw(charger.potenciaAtualKw)} / ${formatKw(
          charger.potenciaMaximaKw
        )}`;
      },
    },
    {
      label: "Energia hoje",
      render: (row) => formatKwh((row as Charger).energiaHojeKwh),
    },
    {
      label: "Ultima comunicacao",
      render: (row) => formatDateTime((row as Charger).ultimaComunicacao),
    },
  ],
  sessoes: [
    {
      label: "Sessao",
      render: (row) => {
        const session = row as ChargingSession;
        return (
          <div className="entity-cell">
            <strong>{session.sessaoId}</strong>
            <small>{session.usuarioNome}</small>
          </div>
        );
      },
    },
    {
      label: "Status",
      render: (row) => <StatusBadge status={(row as ChargingSession).status} />,
    },
    {
      label: "Carregador",
      render: (row) => (row as ChargingSession).carregadorNome,
    },
    {
      label: "Inicio",
      render: (row) => formatDateTime((row as ChargingSession).dataInicio),
    },
    {
      label: "Duracao",
      render: (row) => formatMinutes((row as ChargingSession).duracaoMinutos),
    },
    {
      label: "Energia",
      render: (row) => formatKwh((row as ChargingSession).energiaKwh),
    },
    {
      label: "Valor",
      render: (row) => formatCurrency((row as ChargingSession).valorTotal),
    },
  ],
  pagamentos: [
    {
      label: "Pagamento",
      render: (row) => {
        const payment = row as Payment;
        return (
          <div className="entity-cell">
            <strong>{payment.pagamentoId}</strong>
            <small>{payment.sessaoId}</small>
          </div>
        );
      },
    },
    {
      label: "Status",
      render: (row) => <StatusBadge status={(row as Payment).status} />,
    },
    {
      label: "Cliente",
      render: (row) => (row as Payment).usuarioNome,
    },
    {
      label: "Metodo",
      render: (row) => (row as Payment).metodo,
    },
    {
      label: "Valor",
      render: (row) => formatCurrency((row as Payment).valorTotal),
    },
    {
      label: "Confirmacao",
      render: (row) => formatDateTime((row as Payment).dataPagamento),
    },
  ],
  alertas: [
    {
      label: "Alerta",
      render: (row) => {
        const alert = row as Alert;
        return (
          <div className="entity-cell">
            <strong>{alert.titulo}</strong>
            <small>{alert.descricao}</small>
          </div>
        );
      },
    },
    {
      label: "Status",
      render: (row) => <StatusBadge status={(row as Alert).status} />,
    },
    {
      label: "Severidade",
      render: (row) => <StatusBadge status={(row as Alert).severidade} />,
    },
    {
      label: "Origem",
      render: (row) => (row as Alert).origem,
    },
    {
      label: "Carregador",
      render: (row) => (row as Alert).carregadorNome ?? "Geral",
    },
    {
      label: "Criado em",
      render: (row) => formatDateTime((row as Alert).dataCriacao),
    },
  ],
  clientes: [
    {
      label: "Cliente",
      render: (row) => {
        const client = row as Client;
        return (
          <div className="entity-cell">
            <strong>{client.nome}</strong>
            <small>{client.usuarioId}</small>
          </div>
        );
      },
    },
    {
      label: "Status",
      render: (row) => <StatusBadge status={(row as Client).status} />,
    },
    {
      label: "Contato",
      render: (row) => (row as Client).email,
    },
    {
      label: "Veiculo",
      render: (row) => {
        const client = row as Client;
        return `${client.veiculo} · ${client.placa}`;
      },
    },
    {
      label: "Sessoes",
      render: (row) => (row as Client).totalSessoes,
    },
    {
      label: "Total gasto",
      render: (row) => formatCurrency((row as Client).totalGasto),
    },
  ],
};

function rowStatus(resource: ApiResource, row: ResourceRow) {
  if (resource === "carregadores") return (row as Charger).status;
  if (resource === "sessoes") return (row as ChargingSession).status;
  if (resource === "pagamentos") return (row as Payment).status;
  if (resource === "alertas") {
    const alert = row as Alert;
    return `${alert.status} ${alert.severidade}`;
  }
  return (row as Client).status;
}

function rowKey(resource: ApiResource, row: ResourceRow) {
  if (resource === "carregadores") return (row as Charger).carregadorId;
  if (resource === "sessoes") return (row as ChargingSession).sessaoId;
  if (resource === "pagamentos") return (row as Payment).pagamentoId;
  if (resource === "alertas") return (row as Alert).alertaId;
  return (row as Client).usuarioId;
}

function rowSearchText(row: ResourceRow) {
  return normalizeText(Object.values(row).join(" "));
}

function actionLabel(resource: ApiResource, row: ResourceRow) {
  if (resource === "carregadores") return "Solicitar leitura";
  if (resource === "sessoes" && (row as ChargingSession).status === "ativa") {
    return "Finalizar";
  }
  if (resource === "pagamentos" && (row as Payment).status === "pendente") {
    return "Aprovar";
  }
  if (resource === "alertas" && (row as Alert).status !== "resolvido") {
    return "Resolver";
  }
  return null;
}

export function OperationalPage({ resource }: { resource: ApiResource }) {
  const config = configs[resource];
  const Icon = config.icon;
  const [rows, setRows] = useState<ResourceRow[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("todos");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    setRows(await api.list(resource));
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [resource]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = normalizeText(query);
    return rows.filter((row) => {
      const matchesFilter =
        filter === "todos" || normalizeText(rowStatus(resource, row)).includes(filter);
      const matchesQuery = !normalizedQuery || rowSearchText(row).includes(normalizedQuery);
      return matchesFilter && matchesQuery;
    });
  }, [filter, query, resource, rows]);

  async function runAction(row: ResourceRow) {
    const key = rowKey(resource, row);

    if (resource === "carregadores") {
      await api.requestChargerStatus(key);
      setNotice("Leitura do carregador adicionada a fila do backend.");
    }

    if (resource === "sessoes") {
      await api.finishSession(key);
      setRows((current) =>
        current.map((item) =>
          rowKey(resource, item) === key
            ? ({ ...item, status: "finalizada", dataFim: new Date().toISOString() } as ResourceRow)
            : item
        )
      );
      setNotice("Sessao finalizada no modo visual.");
    }

    if (resource === "pagamentos") {
      await api.registerPayment(key);
      setRows((current) =>
        current.map((item) =>
          rowKey(resource, item) === key
            ? ({ ...item, status: "aprovado", dataPagamento: new Date().toISOString() } as ResourceRow)
            : item
        )
      );
      setNotice("Pagamento aprovado no modo visual.");
    }

    if (resource === "alertas") {
      await api.resolveAlert(key);
      setRows((current) =>
        current.map((item) =>
          rowKey(resource, item) === key
            ? ({ ...item, status: "resolvido" } as ResourceRow)
            : item
        )
      );
      setNotice("Alerta resolvido no modo visual.");
    }

    window.setTimeout(() => setNotice(""), 2200);
  }

  return (
    <AppShell
      eyebrow={config.eyebrow}
      title={config.title}
      description={config.description}
      actions={
        <button className="button button--ghost" onClick={load}>
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

      <section className="resource-toolbar" aria-label={`Filtros de ${config.title}`}>
        <div className="resource-title">
          <span className="metric-icon metric-icon--cyan">
            <Icon size={19} aria-hidden="true" />
          </span>
          <div>
            <strong>{rows.length} registros</strong>
            <small>Contrato canônico do front EMPS</small>
          </div>
        </div>

        <label className="search-field">
          <Search size={16} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por ID, nome, status ou origem"
          />
        </label>

        <div className="filter-tabs" role="tablist" aria-label="Filtro de status">
          <Filter size={15} aria-hidden="true" />
          {config.filters.map((item) => (
            <button
              key={item.value}
              className={filter === item.value ? "active" : ""}
              onClick={() => setFilter(item.value)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      {resource === "carregadores" && !loading && (
        <ChargerVisualBoard chargers={filteredRows as Charger[]} compact />
      )}

      <section className="panel table-panel">
        {loading ? (
          <div className="loading-panel">
            <RefreshCw className="spin" size={20} aria-hidden="true" />
            Carregando {config.title.toLowerCase()}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="empty-state">
            <Settings2 size={22} aria-hidden="true" />
            <strong>Nenhum registro encontrado</strong>
            <small>Ajuste a busca ou selecione outro filtro.</small>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {columns[resource].map((column) => (
                    <th key={column.label}>{column.label}</th>
                  ))}
                  <th>Acao</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const action = actionLabel(resource, row);
                  return (
                    <tr key={rowKey(resource, row)}>
                      {columns[resource].map((column) => (
                        <td key={column.label} className={column.className}>
                          {column.render(row)}
                        </td>
                      ))}
                      <td>
                        {action ? (
                          <button className="table-action" onClick={() => runAction(row)}>
                            <CheckCircle2 size={14} aria-hidden="true" />
                            {action}
                          </button>
                        ) : (
                          <span className="muted-text">Sem acao</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
