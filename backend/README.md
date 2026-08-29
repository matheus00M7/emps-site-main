# EMPS API

API central da plataforma EMPS. Foi construída com NestJS, Prisma e PostgreSQL e atende tanto o painel administrativo quanto o aplicativo Android/iOS.

## Responsabilidades

- autenticação JWT para administradores, operadores e motoristas;
- refresh token rotativo para o aplicativo;
- cadastro e consulta de eletropostos, carregadores e status ao vivo;
- resolução autoritativa do QR de cada carregador;
- intenção, confirmação e conciliação de pagamento;
- início, acompanhamento e encerramento idempotente de sessões;
- envio de comandos a um gateway CSMS/OCPP;
- dashboard, clientes, alertas e ações do painel administrativo.

## Banco de dados

O banco executado pela aplicação é PostgreSQL 16. O Prisma é a fonte de verdade:

```text
prisma/schema.prisma
prisma/migrations/
prisma/seed.ts
```

O arquivo `../database/Emps_DataBase.mysql.sql` preserva o SQL MySQL recebido apenas como referência. Seus conceitos foram traduzidos para o modelo PostgreSQL; não execute dois bancos em paralelo.

Para iniciar o PostgreSQL da raiz do monorepo:

```powershell
docker compose up -d
```

Depois, nesta pasta:

```powershell
Copy-Item .env.example .env
npm install
npx prisma generate
npx prisma migrate deploy
npm run prisma:seed
npm run start:dev
```

A API responde em `http://localhost:3001`. Verifique sem autenticação:

```powershell
Invoke-RestMethod http://localhost:3001/auth/health
```

## Variáveis de ambiente

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | Conexão PostgreSQL usada pelo Prisma |
| `JWT_SECRET` | Segredo de assinatura; use pelo menos 32 caracteres aleatórios e nunca publique o valor |
| `JWT_EXPIRES_IN` | Vida do access token, por exemplo `15m` |
| `REFRESH_TOKEN_DAYS` | Vida máxima do refresh token móvel |
| `PORT` | Porta HTTP da API, padrão `3001` |
| `CORS_ORIGINS` | Origens web permitidas, separadas por vírgula |
| `PAYMENT_PROVIDER` | `sandbox` ou `stripe` |
| `STRIPE_SECRET_KEY` | Chave secreta da Stripe quando o provedor for `stripe` |
| `STRIPE_WEBHOOK_SECRET` | Segredo de assinatura de `POST /webhooks/stripe` |
| `OCPP_GATEWAY_URL` | URL do adaptador/CSMS que recebe comandos da EMPS |
| `OCPP_GATEWAY_TOKEN` | Bearer token desse gateway |

No painel aberto por outro computador da rede, acrescente sua origem a `CORS_ORIGINS`, por exemplo:

```dotenv
CORS_ORIGINS="http://localhost:3000,http://192.168.1.42:3000"
```

O app React Native não deve usar `localhost` em celular físico. A variável do app deve apontar para `http://IP-DO-COMPUTADOR:3001` durante o desenvolvimento ou para a URL HTTPS publicada da API.

## Seed de desenvolvimento

O seed é repetível e cria:

| Perfil | E-mail | Senha |
| --- | --- | --- |
| Administrador | `admin@emps.com` | `admin123` |
| Motorista | `motorista@emps.com` | `emps123` |

Também cria o eletroposto `EMPS Paulista`, o carregador `chg_001` e o vínculo de QR:

```text
Token público: paulista-a01-demo
Código curto:  EMPS-PAULISTA-A01
URL:           https://app.emps.com.br/c/paulista-a01-demo
```

Essas credenciais são somente para desenvolvimento. Troque-as ou remova-as antes de publicar.

## Rotas principais

### Painel administrativo

```text
POST /auth/login
GET  /auth/me
GET  /auth/health
GET  /dashboard/summary
GET  /clients
GET  /chargers
GET  /charging-sessions
GET  /payments
GET  /alerts
```

As rotas operacionais protegidas permitem enviar comandos ao carregador, fazer liberação manual, iniciar e receber sessões pós-pagas, finalizar sessões, aprovar pagamentos e resolver alertas.

### Aplicativo

```text
POST /mobile/v1/auth/register
POST /mobile/v1/auth/login
POST /mobile/v1/auth/refresh
POST /mobile/v1/auth/logout
GET  /mobile/v1/auth/me

GET  /mobile/v1/stations/nearby?lat=&lng=&radiusKm=
GET  /mobile/v1/stations/:id
GET  /mobile/v1/chargers/:id
GET  /mobile/v1/qr/:publicToken

POST /mobile/v1/payment-intents
GET  /mobile/v1/payment-intents/:id
POST /mobile/v1/charging-sessions/start
GET  /mobile/v1/charging-sessions/active
GET  /mobile/v1/charging-sessions
GET  /mobile/v1/charging-sessions/:id
POST /mobile/v1/charging-sessions/:id/stop
```

As operações mutáveis de pagamento e recarga recebem `Idempotency-Key`. Repetir a mesma operação com a mesma chave não deve criar cobrança ou sessão duplicada.

## Atualizações em tempo real

O Socket.IO usa o mesmo servidor e JWT da API no namespace `/realtime`. O cliente deve enviar o access token em `auth.token` ou no header `Authorization: Bearer <token>`. Conexões sem JWT válido são recusadas antes de entrar nas salas.

O servidor envia `emps:change` com um contrato mínimo, sem nomes, e-mails ou dados financeiros:

```json
{
  "eventId": "uuid",
  "topic": "session.updated",
  "entityId": "session-id",
  "occurredAt": "2026-08-28T18:30:00.000Z",
  "customerId": "user-id-quando-aplicável"
}
```

Os tópicos são `session.created`, `session.updated`, `payment.updated`, `charger.updated`, `station.updated`, `alert.updated`, `customer.updated` e `dashboard.updated`. O evento é apenas um sinal para o cliente refazer a consulta REST; ele não replica registros do banco.

Todo usuário autenticado entra em `authenticated`. Administradores e operadores também entram em `operations`; motoristas entram somente em sua sala `customer:<sub>`. Mudanças específicas de um motorista são entregues apenas à sala dele e à operação. O servidor só confirma a inscrição nas salas com `emps:ready`; até esse evento, o cliente mantém a reconciliação REST ativa.

O emissor atual atende uma única instância da API. Antes de executar mais de uma réplica, configure um adaptador Socket.IO compartilhado (por exemplo, Redis) e uma entrega durável/outbox para os eventos. O polling de segurança dos clientes continua reconciliando o estado, mas não substitui essa configuração de escala.

## Pagamentos

O padrão é seguro para desenvolvimento:

```dotenv
PAYMENT_PROVIDER="sandbox"
```

Nesse modo, o fluxo é persistido no banco, mas nenhum dinheiro é movimentado. Para Stripe, configure o provedor, as duas credenciais e o webhook assinado. Cartão/carteira usa autorização e captura; PIX é assíncrono e exige confirmação por webhook. O app e a API nunca devem armazenar PAN ou CVV.

Ter as variáveis no `.env` não basta para produção: também é necessário configurar o método de pagamento no cliente, registrar o webhook público HTTPS na Stripe e validar reembolso, duplicidade, falha e conciliação em sandbox.

## Comandos de recarga

Sem `OCPP_GATEWAY_URL`, o adaptador local aceita comandos em modo sandbox e registra o fluxo, mas não libera equipamento físico.

Com as variáveis OCPP configuradas, a API envia `POST {OCPP_GATEWAY_URL}/commands` com autenticação Bearer. Esse gateway deve traduzir o contrato EMPS para o CSMS/OCPP compatível com o equipamento. OCPP 1.6J e 2.0.1 usam comandos diferentes e não são compatíveis entre si.

Uma resposta HTTP aceita confirma somente que o gateway recebeu o comando. A sessão deve ser considerada fisicamente iniciada ou encerrada após o evento autoritativo do carregador e sua telemetria.

## Segurança e produção

- execute API, painel, app e webhooks somente por HTTPS;
- guarde segredos fora do Git e use valores distintos por ambiente;
- restrinja `CORS_ORIGINS` aos domínios reais;
- mantenha access token curto e refresh tokens revogáveis;
- valide assinatura e deduplique eventos de webhook;
- aplique migrations com `prisma migrate deploy`, não com sincronização destrutiva;
- faça backup do PostgreSQL antes de qualquer atualização de produção.

## Verificação

```powershell
npm run check
```

Esse comando gera o cliente Prisma, compila a API e executa os testes automatizados. Para inspecionar os dados locais:

```powershell
npx prisma studio
```
