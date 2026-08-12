export type ChargerStatus =
  | "disponivel"
  | "em_uso"
  | "offline"
  | "manutencao"
  | "erro";

export type SessionStatus =
  | "ativa"
  | "finalizada"
  | "cancelada"
  | "aguardando_pagamento";

export type PaymentStatus = "pendente" | "aprovado" | "recusado" | "estornado";
export type AlertStatus = "aberto" | "verificando" | "resolvido";
export type AlertSeverity = "baixa" | "media" | "alta" | "critica";

export type UserRole = "admin" | "operador";

export type Client = {
  usuarioId: string;
  nome: string;
  email: string;
  telefone: string;
  veiculo: string;
  placa: string;
  status: "ativo" | "inativo";
  totalSessoes: number;
  totalGasto: number;
  criadoEm: string;
};

export type Charger = {
  carregadorId: string;
  nome: string;
  status: ChargerStatus;
  potenciaMaximaKw: number;
  potenciaAtualKw: number;
  tipoConector: string;
  estacaoId: string;
  estacaoNome: string;
  localizacao: string;
  serialNumber: string;
  ultimaComunicacao: string;
  temperaturaC: number | null;
  energiaHojeKwh: number;
  receitaHoje: number;
  usuarioAtualId: string | null;
};

export type ChargingSession = {
  sessaoId: string;
  usuarioId: string;
  usuarioNome: string;
  carregadorId: string;
  carregadorNome: string;
  status: SessionStatus;
  dataInicio: string;
  dataFim: string | null;
  duracaoMinutos: number;
  energiaKwh: number;
  valorTotal: number;
  statusPagamento: PaymentStatus;
};

export type Payment = {
  pagamentoId: string;
  sessaoId: string;
  usuarioId: string;
  usuarioNome: string;
  carregadorId: string;
  valorTotal: number;
  status: PaymentStatus;
  metodo: "PIX" | "cartao" | "carteira" | "simulado";
  dataPagamento: string | null;
  transactionId: string | null;
};

export type Alert = {
  alertaId: string;
  carregadorId: string | null;
  carregadorNome: string | null;
  titulo: string;
  descricao: string;
  severidade: AlertSeverity;
  status: AlertStatus;
  origem: "EMPS" | "SEMS+" | "regra interna";
  dataCriacao: string;
};

export type TelemetryPoint = {
  hora: string;
  receita: number;
  energiaKwh: number;
  sessoes: number;
};

export type DashboardSummary = {
  receitaHoje: number;
  receitaMes: number;
  energiaHojeKwh: number;
  sessoesHoje: number;
  sessoesAtivas: number;
  carregadoresDisponiveis: number;
  carregadoresOffline: number;
  taxaOcupacao: number;
  ticketMedio: number;
  alertasCriticos: number;
};

export type IntegrationHealth = {
  nome: string;
  estado: "pronto" | "pendente" | "bloqueado";
  detalhe: string;
};

export type DashboardData = {
  resumo: DashboardSummary;
  receitaPorHora: TelemetryPoint[];
  energiaPorHora: TelemetryPoint[];
  carregadores: Charger[];
  sessoes: ChargingSession[];
  pagamentos: Payment[];
  alertas: Alert[];
  integracoes: IntegrationHealth[];
};

export type ApiResource =
  | "carregadores"
  | "sessoes"
  | "pagamentos"
  | "alertas"
  | "clientes";

export type ResourceRow = Charger | ChargingSession | Payment | Alert | Client;

export type FrontSession = {
  usuarioId: string;
  nome: string;
  email: string;
  role: UserRole;
  modo: "front-only";
};
