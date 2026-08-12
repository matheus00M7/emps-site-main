import type { CSSProperties } from "react";
import { AlertTriangle, Gauge, PlugZap, Zap } from "lucide-react";
import type { Charger, ChargerStatus } from "@/lib/domain";
import {
  clampPercent,
  formatCurrency,
  formatDateTime,
  formatKwh,
  formatKw,
} from "@/lib/formatters";
import { StatusBadge } from "@/components/StatusBadge";

type VisualTone = "free" | "busy" | "warning" | "danger";

const visualStatus: Record<
  ChargerStatus,
  { tone: VisualTone; label: string; hint: string }
> = {
  disponivel: {
    tone: "free",
    label: "Liberado",
    hint: "Pronto para carregar",
  },
  em_uso: {
    tone: "busy",
    label: "Ocupado",
    hint: "Carro conectado",
  },
  manutencao: {
    tone: "warning",
    label: "Atencao",
    hint: "Equipe acionada",
  },
  offline: {
    tone: "danger",
    label: "Quebrado",
    hint: "Sem comunicacao",
  },
  erro: {
    tone: "danger",
    label: "Quebrado",
    hint: "Falha operacional",
  },
};

function performanceFor(charger: Charger) {
  if (charger.status === "offline" || charger.status === "erro") return 16;
  if (charger.status === "manutencao") return 42;

  const powerRatio = clampPercent(
    (charger.potenciaAtualKw / Math.max(charger.potenciaMaximaKw, 1)) * 100
  );

  if (charger.status === "em_uso") {
    return clampPercent(58 + powerRatio * 0.34);
  }

  const temperaturePenalty =
    charger.temperaturaC && charger.temperaturaC > 36
      ? (charger.temperaturaC - 36) * 1.5
      : 0;

  return clampPercent(92 - temperaturePenalty);
}

function ChargerScene({ charger }: { charger: Charger }) {
  const visual = visualStatus[charger.status];
  const isOccupied = charger.status === "em_uso";

  return (
    <div className="charger-scene" aria-hidden="true">
      <div className="bay-floor" />
      <div className="status-orbit">
        <span className="status-light status-light--free" />
        <span className="status-light status-light--busy" />
        <span className="status-light status-light--warning" />
      </div>
      <div className={`charger-pillar charger-pillar--${visual.tone}`}>
        <span className="charger-pillar__screen">
          <PlugZap size={15} />
        </span>
        <span className="charger-pillar__slot" />
        <span className="charger-pillar__base" />
      </div>

      {isOccupied ? (
        <>
          <span className="charger-cable" />
          <div className="ev-car">
            <span className="ev-car__roof" />
            <span className="ev-car__plug" />
            <span className="ev-car__wheel ev-car__wheel--front" />
            <span className="ev-car__wheel ev-car__wheel--back" />
          </div>
        </>
      ) : null}

      {!isOccupied && visual.tone === "danger" ? (
        <span className="scene-alert">
          <AlertTriangle size={18} />
        </span>
      ) : null}
    </div>
  );
}

export function ChargerVisualBoard({
  chargers,
  compact = false,
}: {
  chargers: Charger[];
  compact?: boolean;
}) {
  const available = chargers.filter((item) => item.status === "disponivel").length;
  const occupied = chargers.filter((item) => item.status === "em_uso").length;
  const attention = chargers.length - available - occupied;

  return (
    <div
      className={`charger-visual-board${
        compact ? " charger-visual-board--compact" : ""
      }`}
    >
      <div className="charger-visual-header">
        <div className="charger-legend" aria-label="Resumo de status">
          <span className="charger-legend__item charger-legend__item--free">
            {available} liberados
          </span>
          <span className="charger-legend__item charger-legend__item--busy">
            {occupied} ocupados
          </span>
          <span className="charger-legend__item charger-legend__item--warning">
            {attention} atencao
          </span>
        </div>
      </div>

      <div className="charger-map">
        {chargers.map((charger) => {
          const visual = visualStatus[charger.status];
          const performance = Math.round(performanceFor(charger));
          const meterStyle = { width: `${performance}%` } as CSSProperties;

          return (
            <article
              className={`charger-bay charger-bay--${visual.tone}`}
              key={charger.carregadorId}
            >
              <div className="charger-bay__top">
                <div>
                  <strong>{charger.nome}</strong>
                  <small>{charger.localizacao}</small>
                </div>
                <StatusBadge status={charger.status} label={visual.label} />
              </div>

              <ChargerScene charger={charger} />

              <div className="charger-bay__metrics">
                <span>
                  <Zap size={14} aria-hidden="true" />
                  {formatKw(charger.potenciaAtualKw)}
                </span>
                <span>
                  <Gauge size={14} aria-hidden="true" />
                  {charger.temperaturaC === null ? "--" : `${charger.temperaturaC}C`}
                </span>
              </div>

              <div className="liquid-row">
                <div>
                  <small>Desempenho</small>
                  <strong>{performance}%</strong>
                </div>
                <div className="liquid-meter" aria-label={`Desempenho ${performance}%`}>
                  <span style={meterStyle} />
                </div>
              </div>

              <div className="charger-bay__footer">
                <span>{visual.hint}</span>
                <span>{formatKwh(charger.energiaHojeKwh)}</span>
                <span>{formatCurrency(charger.receitaHoje)}</span>
              </div>
              <small className="charger-bay__sync">
                Sync {formatDateTime(charger.ultimaComunicacao)}
              </small>
            </article>
          );
        })}
      </div>
    </div>
  );
}
