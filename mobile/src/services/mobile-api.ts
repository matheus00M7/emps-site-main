import type {
  ChargingSession,
  Charger,
  ConsumerUser,
  Coordinate,
  PaymentMethod,
  Station,
} from '@/domain/models';

export type AuthResult = {
  user: ConsumerUser;
  accessToken: string;
  refreshToken: string;
};

export type ResolvedQr = {
  station: Station;
  charger: Charger;
  tariffLockedUntil: string;
};

export type PaymentIntent = {
  id: string;
  status: 'requires_action' | 'authorized' | 'rejected';
  method: PaymentMethod;
  providerClientSecret?: string;
};

export type StartChargingInput = {
  qrBindingId: string;
  paymentIntentId: string;
  spendingLimit: number | null;
  idempotencyKey: string;
};

export interface MobileApi {
  login(email: string, password: string): Promise<AuthResult>;
  register(name: string, email: string, password: string): Promise<AuthResult>;
  nearbyStations(position: Coordinate, radiusKm?: number): Promise<Station[]>;
  resolveQr(publicToken: string): Promise<ResolvedQr>;
  createPaymentIntent(
    chargerId: string,
    method: PaymentMethod,
    spendingLimit: number | null,
    idempotencyKey: string,
  ): Promise<PaymentIntent>;
  startCharging(input: StartChargingInput): Promise<ChargingSession>;
  activeSession(): Promise<ChargingSession | null>;
  stopCharging(sessionId: string, idempotencyKey: string): Promise<ChargingSession>;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

type ClientOptions = {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
};

export function createMobileApi({ baseUrl, getAccessToken }: ClientOptions): MobileApi {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const accessToken = await getAccessToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...init.headers,
        },
        signal: controller.signal,
      });

      const payload = (await response.json().catch(() => ({}))) as {
        data?: T;
        message?: string;
        code?: string;
      };

      if (!response.ok) {
        throw new ApiRequestError(
          payload.message ?? 'Não foi possível concluir a solicitação.',
          response.status,
          payload.code,
        );
      }

      return (payload.data ?? payload) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    login: (email, password) =>
      request<AuthResult>('/mobile/v1/auth/login', {
        body: JSON.stringify({ email, password }),
        method: 'POST',
      }),
    register: (name, email, password) =>
      request<AuthResult>('/mobile/v1/auth/register', {
        body: JSON.stringify({ name, email, password }),
        method: 'POST',
      }),
    nearbyStations: (position, radiusKm = 25) =>
      request<Station[]>(
        `/mobile/v1/stations/nearby?lat=${position.latitude}&lng=${position.longitude}&radiusKm=${radiusKm}`,
      ),
    resolveQr: (publicToken) => request<ResolvedQr>(`/mobile/v1/qr/${encodeURIComponent(publicToken)}`),
    createPaymentIntent: (chargerId, method, spendingLimit, idempotencyKey) =>
      request<PaymentIntent>('/mobile/v1/payment-intents', {
        body: JSON.stringify({ chargerId, method, spendingLimit }),
        headers: { 'Idempotency-Key': idempotencyKey },
        method: 'POST',
      }),
    startCharging: (input) =>
      request<ChargingSession>('/mobile/v1/charging-sessions/start', {
        body: JSON.stringify(input),
        headers: { 'Idempotency-Key': input.idempotencyKey },
        method: 'POST',
      }),
    activeSession: () => request<ChargingSession | null>('/mobile/v1/charging-sessions/active'),
    stopCharging: (sessionId, idempotencyKey) =>
      request<ChargingSession>(`/mobile/v1/charging-sessions/${sessionId}/stop`, {
        headers: { 'Idempotency-Key': idempotencyKey },
        method: 'POST',
      }),
  };
}
