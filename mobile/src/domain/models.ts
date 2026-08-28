export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type ChargerStatus = 'available' | 'in_use' | 'offline' | 'maintenance';
export type ConnectorType = 'CCS2' | 'Tipo 2' | 'CHAdeMO';
export type PaymentMethod = 'pix' | 'card' | 'wallet';
export type SessionStatus = 'starting' | 'charging' | 'stopping' | 'completed' | 'payment_pending';

export type Charger = {
  id: string;
  publicCode: string;
  qrToken: string;
  stationId: string;
  label: string;
  bay: string;
  connectorType: ConnectorType;
  powerKw: number;
  pricePerKwh: number;
  status: ChargerStatus;
  lastUpdatedAt: string;
};

export type Station = {
  id: string;
  name: string;
  address: string;
  neighborhood: string;
  city: string;
  coordinates: Coordinate;
  openingHours: string;
  amenities: string[];
  chargerIds: string[];
  featured?: boolean;
};

export type ConsumerUser = {
  id: string;
  name: string;
  email: string;
};

export type ChargingSession = {
  id: string;
  stationId: string;
  chargerId: string;
  startedAt: string;
  endedAt?: string;
  status: SessionStatus;
  paymentMethod: PaymentMethod;
  spendingLimit: number | null;
  energyKwh: number;
  totalCost: number;
  powerKw: number;
  durationSeconds: number;
  simulatedSecondsOffset: number;
  transactionId?: string;
};

export type LiveSessionMetrics = {
  durationSeconds: number;
  energyKwh: number;
  totalCost: number;
  powerKw: number;
};
