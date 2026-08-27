import Image from "next/image";
import {
  BatteryCharging,
  SunMedium,
  UtilityPole,
  Zap,
} from "lucide-react";
import type { Charger, EnergyFlowTelemetry } from "@/domain/emps";

const routes = {
  grid: "M 0 181 L 207 178 L 570 309 V 445 H 438 V 576",
  solar: "M 1515 492 H 1350 V 680 H 1260 V 742",
  battery: "M 1260 742 V 820 H 438 V 576",
  chargerBus: "M 438 576 H 540 V 650 H 835 V 590",
  chargerAlpha: "M 835 590 H 720 V 548",
  chargerBeta: "M 835 590 H 952 V 549",
};

function EnergyRoute({
  active,
  className,
  path,
}: {
  active: boolean;
  className: string;
  path: string;
}) {
  return (
    <g
      className={`energy-route energy-route--${className} energy-route--${
        active ? "active" : "inactive"
      }`}
    >
      <path className="energy-route__track" d={path} />
      <path className="energy-route__flow" d={path} />
    </g>
  );
}

function formatPower(value: number | null) {
  if (value === null) return "-- kW";

  return `${value.toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  })} kW`;
}

export function EnergyFlowStation({
  chargers,
  telemetry,
}: {
  chargers: Charger[];
  telemetry: EnergyFlowTelemetry;
}) {
  const activeChargerCount = chargers.filter(
    (charger) => charger.status === "em_uso"
  ).length;
  const hasActiveCharging =
    activeChargerCount > 0 || (telemetry.chargerPowerKw ?? 0) > 0;
  const gridActive = telemetry.chargerSources.includes("grid");
  const solarActive =
    telemetry.solarChargingBattery || telemetry.chargerSources.includes("solar");
  const batteryActive =
    telemetry.chargerSources.includes("battery") ||
    telemetry.chargerSources.includes("solar");

  return (
    <section className="energy-flow" aria-labelledby="energy-flow-title">
      <header className="energy-flow__header">
        <div className="energy-flow__title">
          <span className="energy-flow__title-icon">
            <Zap size={15} aria-hidden="true" />
          </span>
          <div>
            <span>Distribuicao inteligente</span>
            <h3 id="energy-flow-title">Fluxo de energia do eletroposto</h3>
          </div>
        </div>
        <span aria-live="polite" className="energy-flow__activity">
          <i aria-hidden="true" />
          Fluxo monitorado
        </span>
      </header>

      <div className="energy-flow__scene">
        <Image
          alt="Eletroposto com rede publica, sala eletrica, carregadores e geracao solar"
          className="energy-flow__image"
          fill
          loading="eager"
          sizes="(max-width: 820px) 100vw, calc(100vw - 110px)"
          src="/emps-energy-station.png"
        />
        <div className="energy-flow__contrast" aria-hidden="true" />

        <svg
          aria-hidden="true"
          className="energy-flow__routes"
          preserveAspectRatio="xMidYMid meet"
          viewBox="0 0 1664 941"
        >
          <EnergyRoute active={gridActive} className="grid" path={routes.grid} />
          <EnergyRoute active={solarActive} className="solar" path={routes.solar} />
          <EnergyRoute
            active={batteryActive}
            className="battery"
            path={routes.battery}
          />
          <EnergyRoute
            active={hasActiveCharging}
            className="charger"
            path={routes.chargerBus}
          />
          <EnergyRoute
            active={hasActiveCharging}
            className="charger"
            path={routes.chargerAlpha}
          />
          <EnergyRoute
            active={hasActiveCharging}
            className="charger"
            path={routes.chargerBeta}
          />

          <rect
            className={`energy-terminal energy-terminal--charger${
              hasActiveCharging ? " energy-terminal--active" : ""
            }`}
            height="16"
            width="16"
            x="712"
            y="540"
          />
          <rect
            className={`energy-terminal energy-terminal--charger${
              hasActiveCharging ? " energy-terminal--active" : ""
            }`}
            height="16"
            width="16"
            x="944"
            y="541"
          />
        </svg>

        <Image
          alt="Inversor solar GoodWe"
          className="energy-inverter"
          draggable={false}
          height={920}
          src="/sems-inverter-dark.png"
          width={1240}
        />

        <div
          className={`energy-source energy-source--grid energy-source--${
            gridActive ? "active" : "inactive"
          }`}
        >
          <UtilityPole size={15} aria-hidden="true" />
          <span>Rede</span>
          <small>{formatPower(telemetry.gridPowerKw)}</small>
        </div>
        <div
          className={`energy-source energy-source--solar energy-source--${
            solarActive ? "active" : "inactive"
          }`}
        >
          <SunMedium size={15} aria-hidden="true" />
          <span>Solar</span>
          <small>{formatPower(telemetry.solarPowerKw)}</small>
        </div>
        <div
          className={`energy-source energy-source--battery energy-source--${
            batteryActive || solarActive ? "active" : "inactive"
          }`}
        >
          <BatteryCharging size={15} aria-hidden="true" />
          <span>Bateria</span>
          <small>{formatPower(telemetry.batteryPowerKw)}</small>
        </div>
      </div>
    </section>
  );
}
