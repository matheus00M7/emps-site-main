"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import Image from "next/image";
import type { LucideIcon } from "lucide-react";
import {
  Banknote,
  CalendarClock,
  ChevronDown,
  ClipboardCheck,
  Gauge,
  Info,
  Loader2,
  Power,
  RefreshCw,
  RotateCcw,
  Unplug,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import type { Charger, ChargerCommand } from "@/domain/emps";
import {
  formatCurrency,
  formatDateTime,
  formatKwh,
  formatKw,
} from "@/utils/formatters";
import { StatusBadge } from "@/components/status/StatusBadge";
import { chargerVisualStates } from "@/components/chargers/charger-visual-state";
import { api } from "@/services/emps-api";

const MANUAL_RELEASE_TARIFF_PER_KWH = 3;

type CashReleaseMode = "prepaid" | "postpaid";

type ManualReleaseDraft = {
  chargerId: string;
  mode: CashReleaseMode;
  value: string;
};

type PostpaidCashSession = {
  chargerId: string;
  sessionId: string;
  startedAt: string;
  tariffKwh: number;
};

type PostpaidSettlementDraft = {
  chargerId: string;
  value: string;
};

type ManualReleaseMessage = {
  chargerId: string;
  text: string;
};

type ChargerCardAction = {
  className?: string;
  disabled?: boolean;
  icon: LucideIcon;
  isActive?: boolean;
  key: string;
  label: string;
  loading?: boolean;
  onClick: () => void;
  title: string;
};

function parseMoneyInput(value: string) {
  const cleanValue = value.trim().replace(/\s/g, "");
  const normalizedValue = cleanValue.includes(",")
    ? cleanValue.replace(/\./g, "").replace(",", ".")
    : cleanValue;

  return Number(normalizedValue);
}

function formatMoneyInput(value: number) {
  return value.toLocaleString("pt-BR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

function calculatePostpaidUsage(
  session: PostpaidCashSession,
  charger: Charger,
  nowMs: number
) {
  const startedAtMs = Date.parse(session.startedAt);
  const elapsedMinutes = Number.isFinite(startedAtMs)
    ? Math.max(1, Math.ceil((nowMs - startedAtMs) / 60_000))
    : 1;
  const activePowerKw =
    charger.potenciaAtualKw > 0
      ? charger.potenciaAtualKw
      : Math.min(charger.potenciaMaximaKw, Math.max(3.7, charger.potenciaMaximaKw * 0.7));
  const energiaConsumidaKwh = Number(
    Math.max(0.1, (activePowerKw * elapsedMinutes) / 60).toFixed(2)
  );
  const valorCobrado = Number(
    (energiaConsumidaKwh * session.tariffKwh).toFixed(2)
  );

  return {
    elapsedMinutes,
    energiaConsumidaKwh,
    valorCobrado,
  };
}

function chargerDetailReason(charger: Charger) {
  if (charger.status === "offline" || charger.status === "erro") {
    return {
      label: "Motivo da falha",
      value: charger.motivoFalha ?? "Falha operacional em verificacao.",
    };
  }

  if (charger.status === "manutencao") {
    return {
      label: "Motivo da atencao",
      value: charger.motivoAtencao ?? "Manutencao preventiva em andamento.",
    };
  }

  if (charger.motivoAtencao) {
    return {
      label: "Observacao",
      value: charger.motivoAtencao,
    };
  }

  return {
    label: "Operacao",
    value: "Sem ocorrencia operacional ativa.",
  };
}

function chargerOperationalLine(charger: Charger) {
  if (charger.status === "em_uso") return "Em progresso...";
  if (charger.status === "offline" || charger.status === "erro") return "Inoperante...";
  if (charger.status === "manutencao") return "Em espera...";
  return "Pronto para uso...";
}

function chargerEnergySource(charger: Charger) {
  if (charger.status === "em_uso") return "Solar + bateria + rede";
  if (charger.status === "disponivel") return "Rede pronta";
  if (charger.status === "manutencao") return "Circuito em verificacao";
  return "Fonte indisponivel";
}

function chargerMetricFallback(value: number | null, suffix = "") {
  if (value === null) return "--";
  return `${value}${suffix}`;
}

function ChargerScene({ charger }: { charger: Charger }) {
  const visual = chargerVisualStates[charger.status];

  return (
    <div className="charger-scene" aria-hidden="true">
      <div className="status-orbit">
        <span className="status-light status-light--free" />
        <span className="status-light status-light--busy" />
        <span className="status-light status-light--warning" />
        <span className="status-light status-light--danger" />
      </div>
      <Image
        alt=""
        className={visual.asset.className}
        draggable={false}
        height={visual.asset.height}
        src={visual.asset.src}
        width={visual.asset.width}
      />
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
  const [visibleChargers, setVisibleChargers] = useState<Charger[]>(chargers);
  const [manualReleaseDraft, setManualReleaseDraft] =
    useState<ManualReleaseDraft | null>(null);
  const [postpaidSettlementDraft, setPostpaidSettlementDraft] =
    useState<PostpaidSettlementDraft | null>(null);
  const [manualReleaseMessage, setManualReleaseMessage] =
    useState<ManualReleaseMessage | null>(null);
  const [manualReleaseLoadingId, setManualReleaseLoadingId] = useState<
    string | null
  >(null);
  const [postpaidSessions, setPostpaidSessions] = useState<
    Record<string, PostpaidCashSession>
  >({});
  const [chargerCommandLoadingKey, setChargerCommandLoadingKey] = useState<
    string | null
  >(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setVisibleChargers(chargers);
  }, [chargers]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 15_000);

    return () => window.clearInterval(intervalId);
  }, []);

  const available = visibleChargers.filter(
    (item) => item.status === "disponivel"
  ).length;
  const occupied = visibleChargers.filter((item) => item.status === "em_uso").length;
  const warning = visibleChargers.filter(
    (item) => item.status === "manutencao"
  ).length;
  const broken = visibleChargers.filter((item) =>
    ["offline", "erro"].includes(item.status)
  ).length;

  function openManualRelease(charger: Charger) {
    if (charger.status !== "disponivel") return;

    setManualReleaseMessage(null);
    setPostpaidSettlementDraft(null);
    setManualReleaseDraft({
      chargerId: charger.carregadorId,
      mode: "prepaid",
      value: "",
    });
  }

  function closeManualRelease() {
    setManualReleaseDraft(null);
  }

  function setManualReleaseMode(mode: CashReleaseMode, charger: Charger) {
    setManualReleaseDraft({
      chargerId: charger.carregadorId,
      mode,
      value: "",
    });
    setManualReleaseMessage(null);
  }

  function getPostpaidUsage(charger: Charger) {
    const session = postpaidSessions[charger.carregadorId];

    if (!session) return null;

    return calculatePostpaidUsage(session, charger, nowMs);
  }

  function openPostpaidSettlement(charger: Charger) {
    const usage = getPostpaidUsage(charger);

    if (!usage) return;

    setManualReleaseDraft(null);
    setManualReleaseMessage(null);
    setPostpaidSettlementDraft({
      chargerId: charger.carregadorId,
      value: formatMoneyInput(usage.valorCobrado),
    });
  }

  function closePostpaidSettlement() {
    setPostpaidSettlementDraft(null);
  }

  async function submitManualRelease(
    event: FormEvent<HTMLFormElement>,
    charger: Charger
  ) {
    event.preventDefault();

    if (!manualReleaseDraft || manualReleaseDraft.chargerId !== charger.carregadorId) {
      return;
    }

    if (manualReleaseDraft.mode === "postpaid") {
      try {
        setManualReleaseLoadingId(charger.carregadorId);
        const result = await api.startPostpaidCashSession({
          carregadorId: charger.carregadorId,
          motivo: "pagamento_no_encerramento",
          operadorId: "usr_admin_front",
          origem: "caixa",
          tarifaKwh: MANUAL_RELEASE_TARIFF_PER_KWH,
        });

        setPostpaidSessions((currentSessions) => ({
          ...currentSessions,
          [charger.carregadorId]: {
            chargerId: charger.carregadorId,
            sessionId: result.sessaoId,
            startedAt: result.startedAt,
            tariffKwh: result.tarifaKwh,
          },
        }));

        setVisibleChargers((currentChargers) =>
          currentChargers.map((currentCharger) => {
            if (currentCharger.carregadorId !== charger.carregadorId) {
              return currentCharger;
            }

            return {
              ...currentCharger,
              motivoAtencao: "Conta aberta em caixa para acerto no encerramento.",
              potenciaAtualKw: Math.min(
                currentCharger.potenciaMaximaKw,
                Math.max(3.7, currentCharger.potenciaMaximaKw * 0.72)
              ),
              status: result.chargerStatus,
              ultimaComunicacao: result.startedAt,
              usuarioAtualId: "usr_caixa_pos_pago",
            };
          })
        );

        setManualReleaseMessage(null);
        setManualReleaseDraft(null);
      } catch (error) {
        setManualReleaseMessage({
          chargerId: charger.carregadorId,
          text:
            error instanceof Error
              ? error.message
              : "Nao foi possivel iniciar a conta aberta.",
        });
      } finally {
        setManualReleaseLoadingId(null);
      }

      return;
    }

    const receivedValue = parseMoneyInput(manualReleaseDraft.value);

    if (!Number.isFinite(receivedValue) || receivedValue <= 0) {
      setManualReleaseMessage({
        chargerId: charger.carregadorId,
        text: "Informe um valor recebido valido.",
      });
      return;
    }

    try {
      setManualReleaseLoadingId(charger.carregadorId);
      const result = await api.releaseChargerManually({
        carregadorId: charger.carregadorId,
        motivo: "fallback_qr_code",
        modo: "pre_pago",
        operadorId: "usr_admin_front",
        origem: "caixa",
        tarifaKwh: MANUAL_RELEASE_TARIFF_PER_KWH,
        valorRecebido: receivedValue,
      });

      setVisibleChargers((currentChargers) =>
        currentChargers.map((currentCharger) => {
          if (currentCharger.carregadorId !== charger.carregadorId) {
            return currentCharger;
          }

          return {
            ...currentCharger,
            energiaHojeKwh:
              currentCharger.energiaHojeKwh + result.energiaLiberadaKwh,
            potenciaAtualKw: Math.min(
              currentCharger.potenciaMaximaKw,
              Math.max(3.7, currentCharger.potenciaMaximaKw * 0.72)
            ),
            receitaHoje: currentCharger.receitaHoje + result.valorRecebido,
            status: result.chargerStatus,
            ultimaComunicacao: new Date().toISOString(),
            usuarioAtualId: "usr_caixa_manual",
          };
        })
      );

      setManualReleaseMessage(null);
      setManualReleaseDraft(null);
    } catch (error) {
      setManualReleaseMessage({
        chargerId: charger.carregadorId,
        text:
          error instanceof Error
            ? error.message
            : "Nao foi possivel liberar o carregador.",
      });
    } finally {
      setManualReleaseLoadingId(null);
    }
  }

  async function submitPostpaidSettlement(
    event: FormEvent<HTMLFormElement>,
    charger: Charger
  ) {
    event.preventDefault();

    const session = postpaidSessions[charger.carregadorId];
    const usage = getPostpaidUsage(charger);

    if (!session || !usage || postpaidSettlementDraft?.chargerId !== charger.carregadorId) {
      return;
    }

    const receivedValue = parseMoneyInput(postpaidSettlementDraft.value);

    if (!Number.isFinite(receivedValue) || receivedValue < usage.valorCobrado) {
      setManualReleaseMessage({
        chargerId: charger.carregadorId,
        text: "Valor recebido menor que o total da sessao.",
      });
      return;
    }

    try {
      setManualReleaseLoadingId(charger.carregadorId);
      const result = await api.settlePostpaidCashSession({
        carregadorId: charger.carregadorId,
        energiaConsumidaKwh: usage.energiaConsumidaKwh,
        operadorId: "usr_admin_front",
        origem: "caixa",
        sessaoId: session.sessionId,
        valorCobrado: usage.valorCobrado,
        valorRecebido: receivedValue,
      });

      setVisibleChargers((currentChargers) =>
        currentChargers.map((currentCharger) => {
          if (currentCharger.carregadorId !== charger.carregadorId) {
            return currentCharger;
          }

          return {
            ...currentCharger,
            energiaHojeKwh:
              currentCharger.energiaHojeKwh + result.energiaConsumidaKwh,
            motivoAtencao: null,
            potenciaAtualKw: 0,
            receitaHoje: currentCharger.receitaHoje + result.valorCobrado,
            sessoesHoje: currentCharger.sessoesHoje + 1,
            status: result.chargerStatus,
            ultimaComunicacao: result.processedAt,
            usuarioAtualId: null,
          };
        })
      );

      setPostpaidSessions((currentSessions) => {
        const nextSessions = { ...currentSessions };
        delete nextSessions[charger.carregadorId];
        return nextSessions;
      });
      setManualReleaseMessage(null);
      setPostpaidSettlementDraft(null);
    } catch (error) {
      setManualReleaseMessage({
        chargerId: charger.carregadorId,
        text:
          error instanceof Error
            ? error.message
            : "Nao foi possivel concluir o acerto.",
      });
    } finally {
      setManualReleaseLoadingId(null);
    }
  }

  async function handleChargerCommand(charger: Charger, command: ChargerCommand) {
    const loadingKey = `${charger.carregadorId}:${command}`;

    if (
      postpaidSessions[charger.carregadorId] &&
      (command === "encerrar_carga" || command === "liberar_conector")
    ) {
      openPostpaidSettlement(charger);
      return;
    }

    try {
      setChargerCommandLoadingKey(loadingKey);
      const result = await api.sendChargerCommand(charger.carregadorId, command);

      setVisibleChargers((currentChargers) =>
        currentChargers.map((currentCharger) => {
          if (currentCharger.carregadorId !== charger.carregadorId) {
            return currentCharger;
          }

          if (command === "encerrar_carga" || command === "liberar_conector") {
            return {
              ...currentCharger,
              motivoAtencao: null,
              potenciaAtualKw: 0,
              status: "disponivel",
              ultimaComunicacao: result.processedAt,
              usuarioAtualId: null,
            };
          }

          if (command === "sincronizar_status") {
            return {
              ...currentCharger,
              ultimaComunicacao: result.processedAt,
            };
          }

          if (command === "solicitar_manutencao") {
            return {
              ...currentCharger,
              motivoAtencao: "Manutencao solicitada para equipe tecnica.",
              potenciaAtualKw: 0,
              status: "manutencao",
              ultimaComunicacao: result.processedAt,
              usuarioAtualId: null,
            };
          }

          if (command === "executar_checklist") {
            return {
              ...currentCharger,
              motivoAtencao: "Checklist operacional executado.",
              ultimaComunicacao: result.processedAt,
            };
          }

          if (command === "agendar_teste") {
            return {
              ...currentCharger,
              motivoAtencao: "Teste operacional agendado.",
              ultimaComunicacao: result.processedAt,
            };
          }

          return {
            ...currentCharger,
            motivoAtencao:
              currentCharger.status === "manutencao"
                ? null
                : "Reinicio remoto em andamento.",
            potenciaAtualKw: 0,
            status:
              currentCharger.status === "manutencao" ? "disponivel" : "manutencao",
            ultimaComunicacao: result.processedAt,
            usuarioAtualId: null,
          };
        })
      );
    } finally {
      setChargerCommandLoadingKey(null);
    }
  }

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
            {warning} atencao
          </span>
          <span className="charger-legend__item charger-legend__item--danger">
            {broken} quebrados
          </span>
        </div>
      </div>

      <div className="charger-map">
        {visibleChargers.map((charger) => {
          const visual = chargerVisualStates[charger.status];
          const postpaidSession = postpaidSessions[charger.carregadorId] ?? null;
          const postpaidUsage = postpaidSession
            ? calculatePostpaidUsage(postpaidSession, charger, nowMs)
            : null;
          const detailReason = postpaidSession
            ? {
                label: "Pagamento",
                value: "Conta aberta em caixa, cobrar no encerramento.",
              }
            : chargerDetailReason(charger);
          const canManualRelease = charger.status === "disponivel";
          const isManualReleaseOpen =
            manualReleaseDraft?.chargerId === charger.carregadorId;
          const isPostpaidSettlementOpen =
            postpaidSettlementDraft?.chargerId === charger.carregadorId;
          const manualReleaseValue = isManualReleaseOpen
            ? manualReleaseDraft.value
            : "";
          const manualReleaseMode = isManualReleaseOpen
            ? manualReleaseDraft.mode
            : "prepaid";
          const manualReleaseAmount = parseMoneyInput(manualReleaseValue);
          const manualReleaseKwh =
            Number.isFinite(manualReleaseAmount) && manualReleaseAmount > 0
              ? manualReleaseAmount / MANUAL_RELEASE_TARIFF_PER_KWH
              : 0;
          const postpaidSettlementValue = isPostpaidSettlementOpen
            ? postpaidSettlementDraft.value
            : "";
          const postpaidSettlementReceived = parseMoneyInput(postpaidSettlementValue);
          const isManualReleaseLoading =
            manualReleaseLoadingId === charger.carregadorId;
          const currentManualReleaseMessage =
            manualReleaseMessage?.chargerId === charger.carregadorId
              ? manualReleaseMessage
              : null;
          const isAnyChargerCommandLoading =
            chargerCommandLoadingKey?.startsWith(`${charger.carregadorId}:`) ??
            false;
          const commandKey = (command: ChargerCommand) =>
            `${charger.carregadorId}:${command}`;
          const displayedEnergyToday =
            charger.energiaHojeKwh + (postpaidUsage?.energiaConsumidaKwh ?? 0);
          const displayedRevenue =
            charger.receitaHoje + (postpaidUsage?.valorCobrado ?? 0);
          const detailAction: ChargerCardAction = {
            className: "charger-card-action--details",
            icon: Info,
            key: "detalhes",
            label: "Detalhes",
            onClick: () => undefined,
            title: "Mostrar detalhes do carregador",
          };
          const cardActions: ChargerCardAction[] =
            charger.status === "disponivel"
              ? [
                  {
                    disabled: !canManualRelease || isManualReleaseLoading,
                    icon: Banknote,
                    isActive: isManualReleaseOpen,
                    key: "caixa",
                    label: "Caixa",
                    loading: isManualReleaseLoading,
                    onClick: () => openManualRelease(charger),
                    title: "Liberar energia com pagamento recebido no caixa",
                  },
                  {
                    disabled: isAnyChargerCommandLoading,
                    icon: RefreshCw,
                    key: "sincronizar",
                    label: "Sincronizar",
                    loading:
                      chargerCommandLoadingKey ===
                      commandKey("sincronizar_status"),
                    onClick: () =>
                      void handleChargerCommand(charger, "sincronizar_status"),
                    title: "Atualizar status do carregador",
                  },
                  detailAction,
                ]
              : charger.status === "em_uso"
                ? postpaidSession
                  ? [
                      {
                        disabled: isManualReleaseLoading,
                        icon: Banknote,
                        isActive: isPostpaidSettlementOpen,
                        key: "cobrar",
                        label: "Cobrar",
                        loading: isManualReleaseLoading,
                        onClick: () => openPostpaidSettlement(charger),
                        title: "Cobrar a conta aberta no caixa",
                      },
                      {
                        disabled: isManualReleaseLoading,
                        icon: Unplug,
                        isActive: isPostpaidSettlementOpen,
                        key: "desplugar",
                        label: "Desplugar",
                        loading: isManualReleaseLoading,
                        onClick: () => openPostpaidSettlement(charger),
                        title: "Abrir acerto antes de liberar o conector",
                      },
                      detailAction,
                    ]
                  : [
                      {
                        className: "charger-card-action--danger",
                        disabled: isAnyChargerCommandLoading,
                        icon: Power,
                        key: "parar",
                        label: "Parar",
                        loading:
                          chargerCommandLoadingKey === commandKey("encerrar_carga"),
                        onClick: () =>
                          void handleChargerCommand(charger, "encerrar_carga"),
                        title: "Finalizar a carga em andamento",
                      },
                      {
                        disabled: isAnyChargerCommandLoading,
                        icon: Unplug,
                        key: "desplugar",
                        label: "Desplugar",
                        loading:
                          chargerCommandLoadingKey === commandKey("liberar_conector"),
                        onClick: () =>
                          void handleChargerCommand(charger, "liberar_conector"),
                        title: "Liberar o conector para retirada do cabo",
                      },
                      detailAction,
                    ]
                : charger.status === "manutencao"
                  ? [
                      {
                        disabled: isAnyChargerCommandLoading,
                        icon: ClipboardCheck,
                        key: "checklist",
                        label: "Checklist",
                        loading:
                          chargerCommandLoadingKey ===
                          commandKey("executar_checklist"),
                        onClick: () =>
                          void handleChargerCommand(charger, "executar_checklist"),
                        title: "Executar checklist operacional",
                      },
                      {
                        disabled: isAnyChargerCommandLoading,
                        icon: CalendarClock,
                        key: "teste",
                        label: "Teste",
                        loading:
                          chargerCommandLoadingKey === commandKey("agendar_teste"),
                        onClick: () =>
                          void handleChargerCommand(charger, "agendar_teste"),
                        title: "Agendar teste do carregador",
                      },
                      detailAction,
                    ]
                  : [
                      {
                        disabled: isAnyChargerCommandLoading,
                        icon: RotateCcw,
                        key: "reiniciar",
                        label: "Reiniciar",
                        loading:
                          chargerCommandLoadingKey ===
                          commandKey("reiniciar_equipamento"),
                        onClick: () =>
                          void handleChargerCommand(
                            charger,
                            "reiniciar_equipamento"
                          ),
                        title: "Reiniciar equipamento remotamente",
                      },
                      {
                        disabled: isAnyChargerCommandLoading,
                        icon: Wrench,
                        key: "manutencao",
                        label: "Manutencao",
                        loading:
                          chargerCommandLoadingKey ===
                          commandKey("solicitar_manutencao"),
                        onClick: () =>
                          void handleChargerCommand(
                            charger,
                            "solicitar_manutencao"
                          ),
                        title: "Solicitar manutencao tecnica",
                      },
                      detailAction,
                    ];

          return (
            <article
              className={`charger-bay charger-bay--${visual.tone}${
                isManualReleaseOpen || isPostpaidSettlementOpen
                  ? " charger-bay--manual-open"
                  : ""
              }`}
              key={charger.carregadorId}
            >
              <div className="charger-bay__top">
                <div>
                  <strong>
                    {charger.nome} <span>({charger.localizacao})</span>
                  </strong>
                </div>
                <StatusBadge status={charger.status} label={visual.label} />
              </div>

              <div className="charger-card-main">
                <div className="charger-bay__metrics">
                  <div className="charger-metric charger-metric--power">
                    <Zap size={13} aria-hidden="true" />
                    <span>
                      <strong>{formatKw(charger.potenciaAtualKw)}</strong>
                      <small>Potencia</small>
                    </span>
                  </div>
                  <div className="charger-metric">
                    <Gauge size={13} aria-hidden="true" />
                    <span>
                      <strong>{chargerMetricFallback(charger.temperaturaC, " °C")}</strong>
                      <small>
                        {charger.temperaturaC === null ? "Sem dados" : "Temperatura"}
                      </small>
                    </span>
                  </div>
                  <div className="charger-metric charger-metric--energy">
                    <Zap size={13} aria-hidden="true" />
                    <span>
                      <strong>{formatKwh(displayedEnergyToday)}</strong>
                      <small>Total</small>
                    </span>
                  </div>
                  <div className="charger-metric">
                    <Info size={13} aria-hidden="true" />
                    <span>
                      <strong>
                        {charger.status === "em_uso"
                          ? `${charger.tempoMedioSessaoMinutos} min`
                          : "--"}
                      </strong>
                      <small>
                        {charger.status === "em_uso" ? "Media" : "Sessao"}
                      </small>
                    </span>
                  </div>
                </div>
                <ChargerScene charger={charger} />
              </div>

              <div className="charger-state-line">
                <span>{chargerOperationalLine(charger)}</span>
                <strong>{formatCurrency(displayedRevenue)}</strong>
              </div>
              <div className="charger-card-actions">
                {cardActions.map((action) => {
                  const ActionIcon = action.icon;

                  return (
                    <button
                      aria-expanded={action.isActive}
                      className={`charger-card-action${
                        action.className ? ` ${action.className}` : ""
                      }`}
                      disabled={action.disabled || action.loading}
                      key={action.key}
                      onClick={action.onClick}
                      title={action.title}
                      type="button"
                    >
                      {action.loading ? (
                        <Loader2 className="spin-icon" size={13} aria-hidden="true" />
                      ) : (
                        <ActionIcon size={13} aria-hidden="true" />
                      )}
                      {action.label}
                      {action.key === "detalhes" && (
                        <ChevronDown size={12} aria-hidden="true" />
                      )}
                    </button>
                  );
                })}
              </div>
              {isManualReleaseOpen && (
                <form
                  className="manual-release-panel"
                  onSubmit={(event) => submitManualRelease(event, charger)}
                >
                  <div className="manual-release-panel__head">
                    <Banknote size={16} aria-hidden="true" />
                    <div>
                      <strong>Pagamento em caixa</strong>
                      <small>Escolha limite por valor ou conta aberta.</small>
                    </div>
                    <button
                      aria-label="Fechar liberacao por caixa"
                      className="manual-release-close"
                      onClick={closeManualRelease}
                      type="button"
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="manual-release-mode" aria-label="Modo de caixa">
                    <button
                      aria-pressed={manualReleaseMode === "prepaid"}
                      className={manualReleaseMode === "prepaid" ? "active" : ""}
                      onClick={() => setManualReleaseMode("prepaid", charger)}
                      type="button"
                    >
                      Valor definido
                    </button>
                    <button
                      aria-pressed={manualReleaseMode === "postpaid"}
                      className={manualReleaseMode === "postpaid" ? "active" : ""}
                      onClick={() => setManualReleaseMode("postpaid", charger)}
                      type="button"
                    >
                      Conta aberta
                    </button>
                  </div>
                  {manualReleaseMode === "prepaid" ? (
                    <>
                      <label
                        className="manual-release-field"
                        htmlFor={`manual-release-${charger.carregadorId}`}
                      >
                        Valor recebido
                        <span className="manual-release-input">
                          <span>R$</span>
                          <input
                            autoComplete="off"
                            id={`manual-release-${charger.carregadorId}`}
                            inputMode="decimal"
                            onChange={(event) => {
                              setManualReleaseDraft({
                                chargerId: charger.carregadorId,
                                mode: "prepaid",
                                value: event.currentTarget.value,
                              });
                              setManualReleaseMessage(null);
                            }}
                            placeholder="0,00"
                            value={manualReleaseValue}
                          />
                        </span>
                      </label>
                      <div className="manual-release-summary">
                        <span>
                          Tarifa {formatCurrency(MANUAL_RELEASE_TARIFF_PER_KWH)}/kWh
                        </span>
                        <strong>{formatKwh(manualReleaseKwh)} liberados</strong>
                      </div>
                    </>
                  ) : (
                    <div className="manual-release-summary manual-release-summary--open">
                      <span>Sem limite pre-definido</span>
                      <strong>Pagamento no encerramento</strong>
                    </div>
                  )}
                  <div className="manual-release-actions">
                    <button
                      className="manual-release-secondary"
                      onClick={closeManualRelease}
                      type="button"
                    >
                      Cancelar
                    </button>
                    <button
                      className="manual-release-primary"
                      disabled={
                        (manualReleaseMode === "prepaid" && manualReleaseKwh <= 0) ||
                        isManualReleaseLoading
                      }
                      type="submit"
                    >
                      {isManualReleaseLoading
                        ? "Processando"
                        : manualReleaseMode === "prepaid"
                          ? "Liberar"
                          : "Iniciar"}
                    </button>
                  </div>
                </form>
              )}
              {isPostpaidSettlementOpen && postpaidUsage && postpaidSession && (
                <form
                  className="manual-release-panel manual-release-panel--settlement"
                  onSubmit={(event) => submitPostpaidSettlement(event, charger)}
                >
                  <div className="manual-release-panel__head">
                    <Banknote size={16} aria-hidden="true" />
                    <div>
                      <strong>Acerto no caixa</strong>
                      <small>Conta aberta desde {formatDateTime(postpaidSession.startedAt)}.</small>
                    </div>
                    <button
                      aria-label="Fechar acerto no caixa"
                      className="manual-release-close"
                      onClick={closePostpaidSettlement}
                      type="button"
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="manual-release-summary manual-release-summary--split">
                    <span>
                      Energia <strong>{formatKwh(postpaidUsage.energiaConsumidaKwh)}</strong>
                    </span>
                    <span>
                      Total <strong>{formatCurrency(postpaidUsage.valorCobrado)}</strong>
                    </span>
                  </div>
                  <label
                    className="manual-release-field"
                    htmlFor={`postpaid-settlement-${charger.carregadorId}`}
                  >
                    Valor recebido
                    <span className="manual-release-input">
                      <span>R$</span>
                      <input
                        autoComplete="off"
                        id={`postpaid-settlement-${charger.carregadorId}`}
                        inputMode="decimal"
                        onChange={(event) => {
                          setPostpaidSettlementDraft({
                            chargerId: charger.carregadorId,
                            value: event.currentTarget.value,
                          });
                          setManualReleaseMessage(null);
                        }}
                        value={postpaidSettlementValue}
                      />
                    </span>
                  </label>
                  <div className="manual-release-actions">
                    <button
                      className="manual-release-secondary"
                      onClick={closePostpaidSettlement}
                      type="button"
                    >
                      Cancelar
                    </button>
                    <button
                      className="manual-release-primary"
                      disabled={
                        !Number.isFinite(postpaidSettlementReceived) ||
                        postpaidSettlementReceived < postpaidUsage.valorCobrado ||
                        isManualReleaseLoading
                      }
                      type="submit"
                    >
                      {isManualReleaseLoading ? "Recebendo" : "Receber"}
                    </button>
                  </div>
                </form>
              )}
              {currentManualReleaseMessage && (
                <p
                  className="manual-release-message manual-release-message--error"
                >
                  <Info size={14} aria-hidden="true" />
                  {currentManualReleaseMessage.text}
                </p>
              )}
              <div className="charger-detail-panel">
                <dl>
                  <div>
                    <dt>Sessoes hoje</dt>
                    <dd>{charger.sessoesHoje}</dd>
                  </div>
                  <div>
                    <dt>Ocupacao</dt>
                    <dd>{charger.ocupacaoHojePercent}%</dd>
                  </div>
                  <div>
                    <dt>Media por sessao</dt>
                    <dd>{charger.tempoMedioSessaoMinutos} min</dd>
                  </div>
                  <div>
                    <dt>Conector</dt>
                    <dd>{charger.tipoConector}</dd>
                  </div>
                  <div>
                    <dt>Pico</dt>
                    <dd>{formatKw(charger.potenciaMaximaKw)}</dd>
                  </div>
                  <div>
                    <dt>Fonte</dt>
                    <dd>{chargerEnergySource(charger)}</dd>
                  </div>
                  <div className="charger-detail-panel__wide">
                    <dt>{detailReason.label}</dt>
                    <dd>{detailReason.value}</dd>
                  </div>
                </dl>
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

