import { chargers } from '@/data/mock-data';

const ALLOWED_HOSTS = new Set(['app.emps.com.br', 'emps.com.br', 'www.emps.com.br']);

export type QrResolution =
  | { ok: true; chargerId: string }
  | { ok: false; message: string };

export function resolveEmpsQr(rawValue: string): QrResolution {
  const value = rawValue.trim();

  if (!value) {
    return { ok: false, message: 'Digite ou escaneie um código EMPS.' };
  }

  const directMatch = chargers.find(
    (charger) =>
      charger.publicCode.toLowerCase() === value.toLowerCase() ||
      charger.id.toLowerCase() === value.toLowerCase() ||
      charger.qrToken.toLowerCase() === value.toLowerCase(),
  );

  if (directMatch) return { ok: true, chargerId: directMatch.id };

  try {
    const url = new URL(value);
    if (url.protocol.startsWith('exp')) {
      return {
        ok: false,
        message:
          'Esse é o QR do Expo, usado apenas para abrir o aplicativo. Escaneie o QR EMPS da vaga.',
      };
    }

    const isEmpsScheme = url.protocol === 'emps:';
    const isTrustedWebLink = url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname);

    if (!isEmpsScheme && !isTrustedWebLink) {
      return { ok: false, message: 'Este QR code não pertence à rede EMPS.' };
    }

    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const candidates = [
      url.searchParams.get('token'),
      url.searchParams.get('charger'),
      segments.at(-1),
      isEmpsScheme ? url.hostname : null,
    ].filter((candidate): candidate is string => Boolean(candidate));

    const charger = chargers.find((item) =>
      candidates.some(
        (candidate) =>
          item.id.toLowerCase() === candidate.toLowerCase() ||
          item.publicCode.toLowerCase() === candidate.toLowerCase() ||
          item.qrToken.toLowerCase() === candidate.toLowerCase(),
      ),
    );

    if (charger) return { ok: true, chargerId: charger.id };
  } catch {
    // A manual station code is handled above. Anything else is invalid.
  }

  return {
    ok: false,
    message: 'Código inválido, expirado ou ainda não cadastrado. Confira o adesivo da vaga.',
  };
}
