import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta
          name="description"
          content="Encontre eletropostos, escaneie o QR Code e acompanhe sua recarga com o EMPS Charge."
        />
        <meta name="theme-color" content="#0B0C0F" />
        <title>EMPS Charge</title>
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: 'body { background-color: #0B0C0F; }' }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
