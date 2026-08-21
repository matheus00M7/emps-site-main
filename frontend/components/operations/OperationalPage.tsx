"use client";

import { CheckCircle2, Filter, RefreshCw, Search, Settings2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { ChargerVisualBoard } from "@/components/chargers/ChargerVisualBoard";
import type { ApiResource, Charger, ResourceRow } from "@/domain/emps";
import { normalizeText } from "@/utils/formatters";
import { api } from "@/services/emps-api";
import {
  getActionLabel,
  getRowKey,
  getRowSearchText,
  getRowStatus,
  operationColumns,
  operationConfigs,
} from "@/components/operations/operation-config";

export function OperationalPage({ resource }: { resource: ApiResource }) {
  const config = operationConfigs[resource];
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
        filter === "todos" || normalizeText(getRowStatus(resource, row)).includes(filter);
      const matchesQuery = !normalizedQuery || getRowSearchText(row).includes(normalizedQuery);
      return matchesFilter && matchesQuery;
    });
  }, [filter, query, resource, rows]);

  async function runAction(row: ResourceRow) {
    const key = getRowKey(resource, row);

    if (resource === "carregadores") {
      await api.requestChargerStatus(key);
      setNotice("Leitura do carregador adicionada a fila do backend.");
    }

    if (resource === "sessoes") {
      await api.finishSession(key);
      setRows((current) =>
        current.map((item) =>
          getRowKey(resource, item) === key
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
          getRowKey(resource, item) === key
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
          getRowKey(resource, item) === key
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
                  {operationColumns[resource].map((column) => (
                    <th key={column.label}>{column.label}</th>
                  ))}
                  <th>Acao</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const action = getActionLabel(resource, row);
                  return (
                    <tr key={getRowKey(resource, row)}>
                      {operationColumns[resource].map((column) => (
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

