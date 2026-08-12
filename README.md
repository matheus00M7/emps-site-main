# EMPS — Energy Monetization Platform

MVP full-stack para administrar e monetizar carregadores de veículos elétricos. Contém painel responsivo, login JWT, API NestJS, PostgreSQL com Prisma e dados iniciais.

## Executar

```bash
docker compose up -d
cd backend
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run prisma:seed
npm run start:dev
```

Em outro terminal:

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Acesse `http://localhost:3000/login`. A API responde em `http://localhost:3001`.

Credenciais: `admin@emps.com` / `admin123`.

## Fluxo

O sistema permite consultar clientes, carregadores, sessões, pagamentos e alertas. Ao iniciar uma sessão, o carregador muda para `IN_USE`. Ao finalizar, a API calcula duração, kWh e valor, devolve o carregador para `AVAILABLE` e cria automaticamente um pagamento simulado aprovado.

> Modo simulado: nenhuma transação real é processada nesta versão.
