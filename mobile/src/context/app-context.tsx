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
  useState,
} from 'react';

import { getCharger, initialHistory } from '@/data/mock-data';
import type {
  ChargingSession,
  ConsumerUser,
  LiveSessionMetrics,
  PaymentMethod,
} from '@/domain/models';

const STORAGE = {
  user: '@emps/user',
  activeSession: '@emps/active-session',
  history: '@emps/history',
  token: '@emps/access-token',
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
  isHydrated: boolean;
  user: ConsumerUser | null;
  activeSession: ChargingSession | null;
  history: ChargingSession[];
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  startSession: (input: StartSessionInput) => Promise<ChargingSession>;
  finishSession: () => Promise<ChargingSession>;
};

const AppContext = createContext<AppContextValue | null>(null);

async function storeToken(value: string | null) {
  if (Platform.OS === 'web') {
    if (value) await AsyncStorage.setItem(STORAGE.token, value);
    else await AsyncStorage.removeItem(STORAGE.token);
    return;
  }

  if (value) await SecureStore.setItemAsync(STORAGE.token, value);
  else await SecureStore.deleteItemAsync(STORAGE.token);
}

function parseStoredValue<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function getLiveSessionMetrics(
  session: ChargingSession,
  now = Date.now(),
): LiveSessionMetrics {
  const elapsedRealSeconds = Math.max(0, (now - new Date(session.startedAt).getTime()) / 1000);
  const durationSeconds = session.simulatedSecondsOffset + elapsedRealSeconds;
  const energyKwh = session.energyKwh + (session.powerKw * elapsedRealSeconds) / 3600;
  const charger = getCharger(session.chargerId);
  const totalCost = energyKwh * (charger?.pricePerKwh ?? 0);

  return {
    durationSeconds,
    energyKwh,
    totalCost,
    powerKw: session.powerKw,
  };
}

export function AppProvider({ children }: PropsWithChildren) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [user, setUser] = useState<ConsumerUser | null>(null);
  const [activeSession, setActiveSession] = useState<ChargingSession | null>(null);
  const [history, setHistory] = useState<ChargingSession[]>(initialHistory);

  useEffect(() => {
    let mounted = true;

    AsyncStorage.multiGet([STORAGE.user, STORAGE.activeSession, STORAGE.history])
      .then((entries) => {
        if (!mounted) return;
        const stored = Object.fromEntries(entries);
        setUser(parseStoredValue(stored[STORAGE.user], null));
        setActiveSession(parseStoredValue(stored[STORAGE.activeSession], null));
        setHistory(parseStoredValue(stored[STORAGE.history], initialHistory));
      })
      .finally(() => mounted && setIsHydrated(true));

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;

    const writes: [string, string][] = [[STORAGE.history, JSON.stringify(history)]];
    if (user) writes.push([STORAGE.user, JSON.stringify(user)]);
    if (activeSession) writes.push([STORAGE.activeSession, JSON.stringify(activeSession)]);

    AsyncStorage.multiSet(writes).then(async () => {
      if (!user) await AsyncStorage.removeItem(STORAGE.user);
      if (!activeSession) await AsyncStorage.removeItem(STORAGE.activeSession);
    });
  }, [activeSession, history, isHydrated, user]);

  const login = useCallback(async (email: string, password: string) => {
    await new Promise((resolve) => setTimeout(resolve, 450));
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail.includes('@')) throw new Error('Informe um e-mail válido.');
    if (password.length < 6) throw new Error('A senha precisa ter pelo menos 6 caracteres.');

    const nextUser =
      normalizedEmail === demoUser.email
        ? demoUser
        : {
            id: `consumer_${Date.now()}`,
            name: normalizedEmail.split('@')[0].replace(/[._-]/g, ' '),
            email: normalizedEmail,
          };

    setUser(nextUser);
    await storeToken(`demo-token-${nextUser.id}`);
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    await new Promise((resolve) => setTimeout(resolve, 550));
    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();

    if (normalizedName.split(/\s+/).length < 2) throw new Error('Informe seu nome completo.');
    if (!normalizedEmail.includes('@')) throw new Error('Informe um e-mail válido.');
    if (password.length < 8) throw new Error('Crie uma senha com pelo menos 8 caracteres.');

    const nextUser = { id: `consumer_${Date.now()}`, name: normalizedName, email: normalizedEmail };
    setUser(nextUser);
    await storeToken(`demo-token-${nextUser.id}`);
  }, []);

  const logout = useCallback(async () => {
    setUser(null);
    await storeToken(null);
    await AsyncStorage.removeItem(STORAGE.user);
  }, []);

  const startSession = useCallback(
    async ({ chargerId, paymentMethod, spendingLimit }: StartSessionInput) => {
      if (activeSession) throw new Error('Você já tem uma recarga em andamento.');
      const charger = getCharger(chargerId);
      if (!charger || charger.status !== 'available') {
        throw new Error('Este carregador não está disponível neste momento.');
      }

      await new Promise((resolve) => setTimeout(resolve, 900));
      const simulatedSecondsOffset = 12 * 60 + 34;
      const powerKw = Math.min(charger.powerKw * 0.82, 74.6);
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
        powerKw,
        durationSeconds: simulatedSecondsOffset,
        simulatedSecondsOffset: 0,
      };

      setActiveSession(session);
      return session;
    },
    [activeSession],
  );

  const finishSession = useCallback(async () => {
    if (!activeSession) throw new Error('Nenhuma recarga em andamento.');
    await new Promise((resolve) => setTimeout(resolve, 850));

    const metrics = getLiveSessionMetrics(activeSession);
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
  }, [activeSession]);

  const value = useMemo<AppContextValue>(
    () => ({
      isHydrated,
      user,
      activeSession,
      history,
      login,
      register,
      logout,
      startSession,
      finishSession,
    }),
    [activeSession, finishSession, history, isHydrated, login, logout, register, startSession, user],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
