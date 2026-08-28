# Plano de integração do EMPS Charge

## Estado desta entrega

O aplicativo está completo como protótipo navegável e usa um adaptador demonstrativo local. O site administrativo e a API NestJS existentes permanecem inalterados. Isso respeita a decisão de não conectar o app ao backend agora, sem criar uma falsa integração que liberaria carregadores ou aprovaria pagamentos apenas no frontend.

O contrato que o backend móvel deve implementar está tipado em `src/services/mobile-api.ts` sob o prefixo proposto `/mobile/v1`.

## Arquitetura operacional

```text
Aplicativo Android/iOS
        │ HTTPS + JWT + idempotência
        ▼
API móvel EMPS
   ├── Conta do consumidor
   ├── Estações, EVSEs, conectores e tarifas
   ├── Vinculação/validação do QR
   ├── Intenção e conciliação de pagamento
   ├── Sessões, medidores e recibos
   └── WebSocket/SSE/push
        │
        ├────────► PSP/gateway (PIX, cartão, Apple Pay, Google Pay)
        │                 │ webhooks assinados
        │                 ▼
        └────────► CSMS/servidor de recarga ── OCPP/TLS ──► carregador
```

O app nunca deve conversar diretamente com a bomba. Ele solicita a operação à API; a API autoriza o pagamento, reserva atomicamente o conector e envia o comando ao CSMS. A tela só mostra “recarga iniciada” depois da confirmação do equipamento.

OCPI só é necessário quando houver roaming ou operadores externos. Para a rede própria, OCPP entre o CSMS e os carregadores é suficiente no primeiro produto.

## Endpoints móveis propostos

### Conta

```text
POST /mobile/v1/auth/register
POST /mobile/v1/auth/login
POST /mobile/v1/auth/refresh
POST /mobile/v1/auth/logout
POST /mobile/v1/auth/forgot-password
GET  /mobile/v1/me
PATCH /mobile/v1/me
DELETE /mobile/v1/me
```

O access token deve ser curto. O refresh token deve ser rotacionado, revogável e guardado no Keychain/Keystore. O usuário do token deve ser o proprietário obrigatório das sessões, pagamentos e recibos consultados.

### Mapa e carregadores

```text
GET /mobile/v1/stations/nearby?lat=&lng=&radiusKm=
GET /mobile/v1/stations/:stationId
GET /mobile/v1/chargers/:chargerId
GET /mobile/v1/qr/:publicToken
```

`/qr/:publicToken` resolve um identificador público opaco para estação, EVSE e conector, retornando o status e uma tarifa temporariamente bloqueada. O token público não contém comando, segredo, preço ou autorização.

QR recomendado:

```text
https://app.emps.com.br/c/<id-publico-opaco>
```

O domínio deve publicar `apple-app-site-association` e `/.well-known/assetlinks.json` para Universal Links/App Links verificados. O adesivo físico deve ser anti-violação e mostrar também o domínio e um código curto legível.

### Pagamento e recarga

```text
POST /mobile/v1/payment-intents
GET  /mobile/v1/payment-intents/:id
POST /mobile/v1/charging-sessions/start
GET  /mobile/v1/charging-sessions/active
GET  /mobile/v1/charging-sessions/:id
POST /mobile/v1/charging-sessions/:id/stop
GET  /mobile/v1/charging-sessions
GET  /mobile/v1/charging-sessions/:id/receipt
```

Todas as operações mutáveis recebem `Idempotency-Key`. A chave deve ter unicidade por usuário/operação e o servidor deve devolver o mesmo resultado em repetição, impedindo cobrança ou sessão duplicada.

## Máquina de estados

```text
QR_VALIDATED
→ AWAITING_CABLE
→ PAYMENT_AUTHORIZING
→ PAYMENT_AUTHORIZED
→ START_REQUESTED
→ STARTING
→ CHARGING
→ STOP_REQUESTED
→ STOPPING
→ FINALIZING_METER
→ PAYMENT_CAPTURING
→ COMPLETED
```

Estados de recuperação necessários:

```text
PAYMENT_REJECTED
PAYMENT_PENDING
START_FAILED
CHARGER_TIMEOUT
INTERRUPTED
REFUND_PENDING
REFUNDED
DISPUTED
```

O frontend não inventa transições. Cada estado vem de uma fonte autoritativa da API, que por sua vez correlaciona pagamento, comando OCPP e telemetria.

## Banco de dados

O Prisma atual precisa separar usuário administrativo de consumidor e adicionar pelo menos:

- `ConsumerAccount`: nome, e-mail, hash, verificação, estado e consentimentos.
- `RefreshToken` e `ConsumerDevice`: rotação, revogação e push.
- `Station`: endereço, latitude/longitude, fuso, horários e comodidades.
- `Evse`: identificador operacional dentro da estação.
- `Connector`: conector físico, padrão, potência, estado e número da vaga.
- `QrBinding`: token público, versão, conector, validade e revogação.
- `Tariff`: preço/kWh, taxas, vigência e moeda.
- `PaymentIntent` e `PaymentAttempt`: PSP, status, idempotência e IDs externos.
- `ChargingCommand`: tipo, correlação OCPP, tentativas, timeout e resposta.
- `ChargingSession`: consumidor proprietário, medidores inicial/final e tarifa congelada.
- `MeterValue`: telemetria real recebida do carregador.
- `Receipt`, `Refund` e `WebhookEvent`: documento, devolução, assinatura e deduplicação.

Use índice geográfico para busca por raio. Energia faturada deve vir do medidor homologado, nunca de potência nominal multiplicada pelo tempo.

## Pagamento

- Cartão/carteira: usar SDK ou página hospedada do PSP, tokenização PCI, pré-autorização e captura do valor real no final.
- PIX: definir produto explicitamente — saldo pré-pago com devolução do não utilizado ou carteira EMPS. PIX não funciona como captura variável de cartão.
- Confirmar pagamento somente por webhook assinado no servidor.
- Persistir todos os eventos, conciliar valores e tratar captura, reembolso, chargeback e duplicidade.
- PAN e CVV nunca passam pelo backend EMPS nem são guardados no app.

## Carregadores

- OCPP 1.6J usa `RemoteStartTransaction`; OCPP 2.0.1 usa `RequestStartTransaction`.
- O comando deve conter ID de correlação e timeout; “enviado” não significa “iniciado”.
- Revalidar disponibilidade e reservar o conector dentro de uma transação atômica.
- Usar TLS e preferir os perfis de segurança OCPP 2/3 com credenciais/certificados por equipamento.
- Receber medições, estado do cabo, encerramento inesperado e falhas como eventos idempotentes.

## Mapa e rota

- Os marcadores e a disponibilidade vêm da API EMPS; OpenFreeMap fornece apenas o mapa-base.
- A localização é foreground e opcional. Negá-la não bloqueia busca manual.
- “Como chegar” abre Apple/Google Maps sem chave.
- Para desenhar rota no app futuramente, o backend pode chamar o endpoint atual do HeiGIT/openrouteservice e devolver GeoJSON. A chave nunca entra no APK/IPA.

## Troca do modo demonstrativo pela API

1. Implemente e teste `/mobile/v1` atrás de HTTPS.
2. Faça o backend retornar exatamente os contratos de `src/services/mobile-api.ts` ou gere tipos OpenAPI.
3. Configure `EXPO_PUBLIC_EMPS_API_URL` e desative `EXPO_PUBLIC_EMPS_DEMO_MODE`.
4. Substitua os métodos locais de `AppProvider` pelo cliente `createMobileApi`.
5. Sincronize sessão ativa ao abrir o app e assine WebSocket/SSE para telemetria.
6. Teste pagamento e OCPP em sandbox com simulador de carregador antes de qualquer equipamento público.
7. Execute testes em aparelhos reais, perda de internet, app encerrado, QR adulterado, cobrança repetida e timeout do carregador.

## Antes de publicar nas lojas

- Confirmar direitos de uso das marcas e imagens GoodWe/SEMS+; o app atual usa somente a marca EMPS.
- Hospedar termos, política de privacidade e exclusão de conta.
- Configurar e verificar o domínio de deep link.
- Integrar crash reporting, observabilidade, consentimento de analytics e suporte emergencial.
- Validar acessibilidade, textos de permissão e fichas de privacidade das lojas.
- Gerar builds assinados, testar em aparelhos Android/iOS e cumprir revisão financeira da Apple/Google/PSP.
