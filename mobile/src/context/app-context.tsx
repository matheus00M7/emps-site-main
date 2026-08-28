import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { EMPS_API_URL, EMPS_DEMO_MODE } from '@/config/runtime';
import {
  chargers as demoChargers,
  getCharger as getDemoCharger,
  getStation as getDemoStation,
  initialHistory,
  stations as demoStations,
} from '@/data/mock-data';
import type {
  ChargingSession,
  Charger,
  ConsumerUser,
  Coordinate,
  LiveSessionMetrics,
  PaymentMethod,
  Station,
} from '@/domain/models';
import {
  type AuthResult,
  type AuthTokens,
  createMobileApi,
  type ResolvedQr,
} from '@/services/mobile-api';
import { parseEmpsQrPublicToken, resolveEmpsQr } from '@/utils/qr';

const STORAGE = EMPS_DEMO_MODE
  ? {
      accessToken: '@emps/demo/access-token',
      activeSession: '@emps/demo/active-session',
      history: '@emps/demo/history',
      refreshToken: '@emps/demo/refresh-token',
      user: '@emps/demo/user',
    }
  : {
      accessToken: '@emps/real/access-token',
      activeSession: '@emps/real/active-session',
      history: '@emps/real/history',
      refreshToken: '@emps/real/refresh-token',
      user: '@emps/real/user',
    };

const demoUser: ConsumerUser = {
  id: 'consumer_demo_001',
  name: 'Matheus',
  email: 'motorista@emps.com',
};

type StartSessionInput = {
  chargerId: string;
  paymentMethod: PaymentMethod;
  spendingLimit: number | null;
};

type AppContextValue = {
  isDemoMode: boolean;
  isHydrated: boolean;
  isStationsLoading: boolean;
  user: ConsumerUser | null;
  activeSession: ChargingSession | null;
  history: ChargingSession[];
  stations: Station[];
  chargers: Charger[];
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  getStation: (stationId: string) => Station | undefined;
  getCharger: (chargerId: string) => Charger | undefined;
  getStationChargers: (stationId: string) => Charger[];
  loadNearbyStations: (position: Coordinate, radiusKm?: number) => Promise<Station[]>;
  loadStation: (stationId: string) => Promise<Station>;
  loadCharger: (chargerId: string) => Promise<Charger>;
  resolveQrCode: (rawValue: string) => Promise<ResolvedQr>;
  hasQrBinding: (chargerId: string) => boolean;
  startSession: (input: StartSessionInput) => Promise<ChargingSession>;
  refreshActiveSession: () => Promise<ChargingSession | null>;
  refreshHistory: () => Promise<ChargingSession[]>;
  finishSession: () => Promise<ChargingSession>;
};

type PendingStart = {
  signature: string;
  paymentKey: string;
  startKey: string;
};

const AppContext = createContext<AppContextValue | null>(null);

async function readSecret(key: string) {
  if (Platform.OS === 'web') return AsyncStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

async function writeSecret(key: string, value: string | null) {
  if (Platform.OS === 'web') {
    if (value) await AsyncStorage.setItem(key, value);
    else await AsyncStorage.removeItem(key);
    return;
  }

  if (value) await SecureStore.setItemAsync(key, value);
  else await SecureStore.deleteItemAsync(key);
}

async function storeTokens(tokens: AuthTokens | null) {
  await Promise.all([
    writeSecret(STORAGE.accessToken, tokens?.accessToken ?? null),
    writeSecret(STORAGE.refreshToken, tokens?.refreshToken ?? null),
  ]);
}

function parseStoredValue<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]) {
  const merged = new Map(current.map((item) => [item.id, item]));
  incoming.forEach((item) => merged.set(item.id, item));
  return [...merged.values()];
}

function createIdempotencyKey(scope: string, userId?: string) {
  const randomPart = Math.random().toString(36).slice(2, 12);
  return `${scope}_${userId ?? 'anonymous'}_${Date.now()}_${randomPart}`;
}

export function getLiveSessionMetrics(
  session: ChargingSession,
  demoPricePerKwh?: number,
  now = Date.now(),
): LiveSessionMetrics {
  if (demoPricePerKwh === undefined) {
    return {
      durationSeconds: session.durationSeconds,
      energyKwh: session.energyKwh,
      totalCost: session.totalCost,
      powerKw: session.powerKw,
    };
  }

  const elapsedRealSeconds = Math.max(0, (now - new Date(session.startedAt).getTime()) / 1000);
  const durationSeconds = session.simulatedSecondsOffset + elapsedRealSeconds;
  const energyKwh = session.energyKwh + (session.powerKw * elapsedRealSeconds) / 3600;

  return {
    durationSeconds,
    energyKwh,
    totalCost: energyKwh * demoPricePerKwh,
    powerKw: session.powerKw,
  };
}

export function AppProvider({ children }: PropsWithChildren) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [isStationsLoading, setIsStationsLoading] = useState(false);
  const [user, setUser] = useState<ConsumerUser | null>(null);
  const [activeSession, setActiveSession] = useState<ChargingSession | null>(null);
  const [history, setHistory] = useState<ChargingSession[]>(EMPS_DEMO_MODE ? initialHistory : []);
  const [stations, setStations] = useState<Station[]>(EMPS_DEMO_MODE ? demoStations : []);
  const [chargers, setChargers] = useState<Charger[]>(EMPS_DEMO_MODE ? demoChargers : []);
  const [qrBindings, setQrBindings] = useState<Record<string, string>>({});
  const activeSessionRef = useRef<ChargingSession | null>(null);
  const historyRef = useRef<ChargingSession[]>(EMPS_DEMO_MODE ? initialHistory : []);
  const pendingStart = useRef<PendingStart | null>(null);
  const pendingStopKey = useRef<string | null>(null);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  const clearAuthentication = useCallback(async () => {
    await storeTokens(null);
    await AsyncStorage.multiRemove([STORAGE.user, STORAGE.activeSession, STORAGE.history]);
    setUser(null);
    setActiveSession(null);
    setHistory([]);
    setQrBindings({});
  }, []);

  const api = useMemo(
    () =>
      createMobileApi({
        baseUrl: EMPS_API_URL,
        getAccessToken: () => readSecret(STORAGE.accessToken),
        getRefreshToken: () => readSecret(STORAGE.refreshToken),
        onAuthenticationLost: clearAuthentication,
        onTokensChanged: storeTokens,
      }),
    [clearAuthentication],
  );

  const cacheEntitiesForSessions = useCallback(
    async (sessions: ChargingSession[]) => {
      if (EMPS_DEMO_MODE || sessions.length === 0) return;

      const chargerIds = [...new Set(sessions.map((session) => session.chargerId))];
      const stationIds = [...new Set(sessions.map((session) => session.stationId))];
      const [chargerResults, stationResults] = await Promise.all([
        Promise.allSettled(chargerIds.map((id) => api.charger(id))),
        Promise.allSettled(stationIds.map((id) => api.station(id))),
      ]);
      const nextChargers = chargerResults.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      const nextStations = stationResults.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      if (nextChargers.length > 0) setChargers((current) => mergeById(current, nextChargers));
      if (nextStations.length > 0) setStations((current) => mergeById(current, nextStations));
    },
    [api],
  );

  const synchronizeSessions = useCallback(async () => {
    if (EMPS_DEMO_MODE) return;
    const [nextActiveSession, nextHistory] = await Promise.all([
      api.activeSession(),
      api.sessionHistory(),
    ]);
    setActiveSession(nextActiveSession);
    setHistory(nextHistory);
    await cacheEntitiesForSessions([
      ...(nextActiveSession ? [nextActiveSession] : []),
      ...nextHistory,
    ]);
  }, [api, cacheEntitiesForSessions]);

  useEffect(() => {
    let mounted = true;

    async function hydrate() {
      const entries = await AsyncStorage.multiGet([
        STORAGE.user,
        STORAGE.activeSession,
        STORAGE.history,
      ]);
      if (!mounted) return;

      const stored = Object.fromEntries(entries);
      const cachedUser = parseStoredValue<ConsumerUser | null>(stored[STORAGE.user], null);
      const cachedSession = parseStoredValue<ChargingSession | null>(
        stored[STORAGE.activeSession],
        null,
      );
      const cachedHistory = parseStoredValue<ChargingSession[]>(
        stored[STORAGE.history],
        EMPS_DEMO_MODE ? initialHistory : [],
      );

      if (EMPS_DEMO_MODE) {
        setUser(cachedUser);
        setActiveSession(cachedSession);
        setHistory(cachedHistory);
        return;
      }

      const [accessToken, refreshToken] = await Promise.all([
        readSecret(STORAGE.accessToken),
        readSecret(STORAGE.refreshToken),
      ]);
      if (!mounted) return;

      if (!cachedUser || !accessToken || !refreshToken) {
        await clearAuthentication();
        return;
      }

      setUser(cachedUser);
      setActiveSession(cachedSession);
      setHistory(cachedHistory);
      try {
        await synchronizeSessions();
      } catch (error) {
        // Caches keep the authenticated app usable during a temporary outage.
        console.warn('[emps-api] sincronização inicial indisponível', error);
      }
    }

    hydrate()
      .catch((error) => console.error('[emps-app] falha ao restaurar sessão', error))
      .finally(() => mounted && setIsHydrated(true));

    return () => {
      mounted = false;
    };
  }, [clearAuthentication, synchronizeSessions]);

  useEffect(() => {
    if (!isHydrated) return;

    const writes: [string, string][] = [[STORAGE.history, JSON.stringify(history)]];
    if (user) writes.push([STORAGE.user, JSON.stringify(user)]);
    if (activeSession) writes.push([STORAGE.activeSession, JSON.stringify(activeSession)]);

    AsyncStorage.multiSet(writes)
      .then(async () => {
        if (!user) await AsyncStorage.removeItem(STORAGE.user);
        if (!activeSession) await AsyncStorage.removeItem(STORAGE.activeSession);
      })
      .catch((error) => console.warn('[emps-app] não foi possível salvar o cache local', error));
  }, [activeSession, history, isHydrated, user]);

  const applyAuthentication = useCallback(
    async (result: AuthResult) => {
      await storeTokens(result);
      await AsyncStorage.setItem(STORAGE.user, JSON.stringify(result.user));
      setUser(result.user);
      setActiveSession(null);
      setHistory([]);
      if (!EMPS_DEMO_MODE) {
        try {
          await synchronizeSessions();
        } catch (error) {
          console.warn('[emps-api] login concluído, mas a sincronização ficou pendente', error);
        }
      }
    },
    [synchronizeSessions],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail.includes('@')) throw new Error('Informe um e-mail válido.');
      if (password.length < 6) throw new Error('A senha precisa ter pelo menos 6 caracteres.');

      if (EMPS_DEMO_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 450));
        const nextUser =
          normalizedEmail === demoUser.email
            ? demoUser
            : {
                id: `consumer_${Date.now()}`,
                name: normalizedEmail.split('@')[0].replace(/[._-]/g, ' '),
                email: normalizedEmail,
              };
        await applyAuthentication({
          accessToken: `demo-access-${nextUser.id}`,
          refreshToken: `demo-refresh-${nextUser.id}`,
          user: nextUser,
        });
        setHistory(initialHistory);
        return;
      }

      await applyAuthentication(await api.login(normalizedEmail, password));
    },
    [api, applyAuthentication],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const normalizedName = name.trim();
      const normalizedEmail = email.trim().toLowerCase();
      if (normalizedName.split(/\s+/).length < 2) throw new Error('Informe seu nome completo.');
      if (!normalizedEmail.includes('@')) throw new Error('Informe um e-mail válido.');
      if (password.length < 8) throw new Error('Crie uma senha com pelo menos 8 caracteres.');

      if (EMPS_DEMO_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 550));
        const nextUser = {
          id: `consumer_${Date.now()}`,
          name: normalizedName,
          email: normalizedEmail,
        };
        await applyAuthentication({
          accessToken: `demo-access-${nextUser.id}`,
          refreshToken: `demo-refresh-${nextUser.id}`,
          user: nextUser,
        });
        setHistory(initialHistory);
        return;
      }

      await applyAuthentication(await api.register(normalizedName, normalizedEmail, password));
    },
    [api, applyAuthentication],
  );

  const logout = useCallback(async () => {
    if (!EMPS_DEMO_MODE) {
      const refreshToken = await readSecret(STORAGE.refreshToken);
      if (refreshToken) {
        try {
          await api.logout(refreshToken);
        } catch (error) {
          console.warn('[emps-api] logout remoto não confirmado; credenciais locais removidas', error);
        }
      }
    }
    await clearAuthentication();
  }, [api, clearAuthentication]);

  const getStation = useCallback(
    (stationId: string) => stations.find((station) => station.id === stationId),
    [stations],
  );
  const getCharger = useCallback(
    (chargerId: string) => chargers.find((charger) => charger.id === chargerId),
    [chargers],
  );
  const getStationChargers = useCallback(
    (stationId: string) => chargers.filter((charger) => charger.stationId === stationId),
    [chargers],
  );

  const loadNearbyStations = useCallback(
    async (position: Coordinate, radiusKm = 25) => {
      if (EMPS_DEMO_MODE) {
        setStations(demoStations);
        setChargers(demoChargers);
        return demoStations;
      }

      setIsStationsLoading(true);
      try {
        const nearby = await api.nearbyStations(position, radiusKm);
        setStations((current) => mergeById(current, nearby));
        const chargerIds = [...new Set(nearby.flatMap((station) => station.chargerIds))];
        const results = await Promise.allSettled(chargerIds.map((id) => api.charger(id)));
        const nearbyChargers = results.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : [],
        );
        if (nearbyChargers.length > 0) {
          setChargers((current) => mergeById(current, nearbyChargers));
        }
        return nearby;
      } finally {
        setIsStationsLoading(false);
      }
    },
    [api],
  );

  const loadStation = useCallback(
    async (stationId: string) => {
      if (EMPS_DEMO_MODE) {
        const station = getDemoStation(stationId);
        if (!station) throw new Error('Eletroposto não encontrado.');
        return station;
      }

      const station = await api.station(stationId);
      setStations((current) => mergeById(current, [station]));
      const results = await Promise.allSettled(station.chargerIds.map((id) => api.charger(id)));
      const stationChargers = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      if (stationChargers.length > 0) {
        setChargers((current) => mergeById(current, stationChargers));
      }
      return station;
    },
    [api],
  );

  const loadCharger = useCallback(
    async (chargerId: string) => {
      if (EMPS_DEMO_MODE) {
        const charger = getDemoCharger(chargerId);
        if (!charger) throw new Error('Carregador não encontrado.');
        return charger;
      }

      const charger = await api.charger(chargerId);
      setChargers((current) => mergeById(current, [charger]));
      const station = await api.station(charger.stationId);
      setStations((current) => mergeById(current, [station]));
      return charger;
    },
    [api],
  );

  const resolveQrCode = useCallback(
    async (rawValue: string) => {
      if (EMPS_DEMO_MODE) {
        const resolution = resolveEmpsQr(rawValue);
        if (!resolution.ok) throw new Error(resolution.message);
        const charger = getDemoCharger(resolution.chargerId);
        const station = charger ? getDemoStation(charger.stationId) : undefined;
        if (!charger || !station) throw new Error('Carregador não encontrado.');
        const resolved = {
          charger,
          qrBindingId: `demo-binding-${charger.id}`,
          station,
          tariffLockedUntil: new Date(Date.now() + 5 * 60_000).toISOString(),
        };
        setQrBindings((current) => ({ ...current, [charger.id]: resolved.qrBindingId }));
        return resolved;
      }

      const parsed = parseEmpsQrPublicToken(rawValue);
      if (!parsed.ok) throw new Error(parsed.message);
      const resolved = await api.resolveQr(parsed.publicToken);
      if (resolved.charger.stationId !== resolved.station.id) {
        throw new Error('O QR retornou um vínculo inconsistente. Não inicie a recarga.');
      }
      setStations((current) => mergeById(current, [resolved.station]));
      setChargers((current) => mergeById(current, [resolved.charger]));
      setQrBindings((current) => ({
        ...current,
        [resolved.charger.id]: resolved.qrBindingId,
      }));
      return resolved;
    },
    [api],
  );

  const hasQrBinding = useCallback(
    (chargerId: string) => Boolean(qrBindings[chargerId]),
    [qrBindings],
  );

  const startSession = useCallback(
    async ({ chargerId, paymentMethod, spendingLimit }: StartSessionInput) => {
      if (activeSession) throw new Error('Você já tem uma recarga em andamento.');
      const charger = EMPS_DEMO_MODE ? getDemoCharger(chargerId) : getCharger(chargerId);
      if (!charger || charger.status !== 'available') {
        throw new Error('Este carregador não está disponível neste momento.');
      }

      if (EMPS_DEMO_MODE) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        const simulatedSecondsOffset = 12 * 60 + 34;
        const session: ChargingSession = {
          id: `ses_${Date.now()}`,
          stationId: charger.stationId,
          chargerId: charger.id,
          startedAt: new Date(Date.now() - simulatedSecondsOffset * 1000).toISOString(),
          status: 'charging',
          paymentMethod,
          spendingLimit,
          energyKwh: 0,
          totalCost: 0,
          powerKw: Math.min(charger.powerKw * 0.82, 74.6),
          durationSeconds: simulatedSecondsOffset,
          simulatedSecondsOffset: 0,
        };
        setActiveSession(session);
        return session;
      }

      const qrBindingId = qrBindings[chargerId];
      if (!qrBindingId) {
        throw new Error('Escaneie o QR desta vaga antes de autorizar o pagamento.');
      }

      const signature = `${chargerId}:${paymentMethod}:${spendingLimit ?? 'none'}`;
      if (!pendingStart.current || pendingStart.current.signature !== signature) {
        pendingStart.current = {
          signature,
          paymentKey: createIdempotencyKey('payment', user?.id),
          startKey: createIdempotencyKey('start', user?.id),
        };
      }

      const operation = pendingStart.current;
      const paymentIntent = await api.createPaymentIntent(
        chargerId,
        paymentMethod,
        spendingLimit,
        operation.paymentKey,
      );
      if (paymentIntent.status === 'rejected') {
        pendingStart.current = null;
        throw new Error('O pagamento foi recusado. Escolha outra forma de pagamento.');
      }
      if (paymentIntent.status === 'requires_action') {
        throw new Error('O provedor de pagamento solicitou uma confirmação adicional.');
      }

      const session = await api.startCharging({
        idempotencyKey: operation.startKey,
        paymentIntentId: paymentIntent.id,
        qrBindingId,
        spendingLimit,
      });
      pendingStart.current = null;
      setActiveSession(session);
      return session;
    },
    [activeSession, api, getCharger, qrBindings, user?.id],
  );

  const refreshActiveSession = useCallback(async () => {
    if (EMPS_DEMO_MODE) return activeSessionRef.current;
    const nextSession = await api.activeSession();
    setActiveSession(nextSession);
    if (nextSession) await cacheEntitiesForSessions([nextSession]);
    return nextSession;
  }, [api, cacheEntitiesForSessions]);

  const refreshHistory = useCallback(async () => {
    if (EMPS_DEMO_MODE) return historyRef.current;
    const nextHistory = await api.sessionHistory();
    setHistory(nextHistory);
    await cacheEntitiesForSessions(nextHistory);
    return nextHistory;
  }, [api, cacheEntitiesForSessions]);

  const finishSession = useCallback(async () => {
    if (!activeSession) throw new Error('Nenhuma recarga em andamento.');

    if (EMPS_DEMO_MODE) {
      await new Promise((resolve) => setTimeout(resolve, 850));
      const charger = getDemoCharger(activeSession.chargerId);
      const metrics = getLiveSessionMetrics(activeSession, charger?.pricePerKwh ?? 0);
      const completed: ChargingSession = {
        ...activeSession,
        ...metrics,
        status: 'completed',
        endedAt: new Date().toISOString(),
        transactionId: `EMPS-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${String(
          Date.now(),
        ).slice(-5)}`,
      };
      setHistory((current) => [completed, ...current]);
      setActiveSession(null);
      return completed;
    }

    if (!pendingStopKey.current) {
      pendingStopKey.current = createIdempotencyKey('stop', user?.id);
    }
    const completed = await api.stopCharging(activeSession.id, pendingStopKey.current);
    pendingStopKey.current = null;
    setHistory((current) => [completed, ...current.filter((item) => item.id !== completed.id)]);
    setActiveSession(null);
    return completed;
  }, [activeSession, api, user?.id]);

  const value = useMemo<AppContextValue>(
    () => ({
      isDemoMode: EMPS_DEMO_MODE,
      isHydrated,
      isStationsLoading,
      user,
      activeSession,
      history,
      stations,
      chargers,
      login,
      register,
      logout,
      getStation,
      getCharger,
      getStationChargers,
      loadNearbyStations,
      loadStation,
      loadCharger,
      resolveQrCode,
      hasQrBinding,
      startSession,
      refreshActiveSession,
      refreshHistory,
      finishSession,
    }),
    [
      activeSession,
      chargers,
      finishSession,
      getCharger,
      getStation,
      getStationChargers,
      hasQrBinding,
      history,
      isHydrated,
      isStationsLoading,
      loadCharger,
      loadNearbyStations,
      loadStation,
      login,
      logout,
      refreshActiveSession,
      refreshHistory,
      register,
      resolveQrCode,
      startSession,
      stations,
      user,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
