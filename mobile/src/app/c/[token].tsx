import { Redirect, useLocalSearchParams } from 'expo-router';

import { useApp } from '@/context/app-context';
import { resolveEmpsQr } from '@/utils/qr';

export default function ChargerDeepLinkScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { user } = useApp();
  const resolution = resolveEmpsQr(
    typeof token === 'string'
      ? `https://app.emps.com.br/c/${encodeURIComponent(token)}`
      : '',
  );

  if (!resolution.ok) return <Redirect href={user ? '/' : '/login'} />;
  if (!user) {
    return <Redirect href={{ pathname: '/login', params: { chargerId: resolution.chargerId } }} />;
  }
  return <Redirect href={`/charger/${resolution.chargerId}`} />;
}
