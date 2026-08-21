# EMPS Frontend

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Organização

- `app/`: rotas do Next.js e layout global.
- `components/shell/`: interface SEMS+ e entrada lateral do módulo EMPS.
- `components/dashboard/`: painel do eletroposto e métricas.
- `components/chargers/`: visual dos carregadores e imagens por status.
- `components/operations/`: páginas operacionais de listas, filtros e ações.
- `components/status/`: badges de status canônicos.
- `domain/`: tipos do contrato EMPS.
- `data/mock/`: dados simulados no formato esperado pela API EMPS.
- `services/`: camada de acesso à API EMPS. Hoje usa mock local.
- `styles/`: CSS separado por área visual.
- `utils/`: formatadores de valores, datas, energia e status.

## Regras de integração

O front deve conversar apenas com a API EMPS. Credenciais, tokens e integrações SEMS+ ficam no backend/adaptador, nunca no navegador. Os campos e status canônicos seguem os documentos do projeto, como `carregadorId`, `sessaoId`, `energiaKwh`, `disponivel`, `em_uso`, `manutencao`, `erro`, `ativa`, `finalizada`, `pendente` e `aprovado`.
