---
status: accepted
date: 2026-07-24
builds-on: ["ADR-0007", "ADR-0008"]
superseded-by: null
deciders: ["gustavo_carbonera"]
---

<!-- id é DERIVADO do filename (docs/adr/NNNN-titulo-kebab.md → ADR-NNNN);
     title é DERIVADO do H1 abaixo. Não existem no frontmatter de propósito.

     ⚠️ Bloco VERDADE ATUAL — obrigatório quando este ADR for superado.
     Única edição substantiva permitida em ADR aceito. Máximo 3 linhas:

> ⚠️ VERDADE ATUAL: <o que ainda vale; o que foi revogado; ADR fonte atual>
-->

# Painel React servido pelo Fastify com SSE para observabilidade da fila

## Contexto e problema
O sistema agora persiste `requests`/`queue`/`llm_logs` em SQLite (ADRs
0007/0008), mas só há acesso via SQL/CLI — nenhuma visualização em runtime.
Para acompanhar o fluxo (status das solicitações, andamento do worker, o que
o agente LLM está "pensando") é necessário um painel web de observabilidade
que se atualize em **tempo real**.

Definição material pendente: tecnologia do front, mecanismo de real-time e
onde servir em produção.

## Direcionadores da decisão
- **Sem novo processo em produção:** o binário/container único (já adotado)
  deve continuar servindo tudo; não introduzir um segundo servidor.
- **Real-time barato:** volume de eventos baixo (algumas linhas por segundo);
  a solução não precisa de filas/brokers.
- **Fonte única de verdade:** as `llm_logs`/`queue` já estão no SQLite; o
  painel lê diretamente.
- **DX:** TypeScript end-to-end (já é TS estrito no repo).

## Opções consideradas

### Opção 1 — Vite + React + TS + SSE via `@fastify/sse`
**Prós:**
- SSE é unidirecional (servidor→cliente); ideal para um dashboard só de
  observação; sem handshake/upgrade do WebSocket; NAT/proxy friendly.
- `@fastify/sse` dá API declarativa (`reply.sse.send`, `keepAlive`,
  `onClose`) e é oficial do ecossistema Fastify.
- Vite/React/TS reutiliza o conhecimento do stack; `tsx` já usado para dev;
  build estático servido pelo próprio Fastify em prod (uma só binary).
**Contras:**
- Adiciona `@fastify/sse` (runtime) e devDeps do Vite (build-time).
- SSE mantém conexões abertas (uma por aba); para muitos viewers precisaria
  de buffer/compaction (fora de escopo deste volume).

### Opção 2 — WebSocket com `@fastify/websocket`
**Prós:** bidirecional (over-engineering), padronizado.
**Contras:** upgrade HTTP, infra extra; não há fluxo cliente→servidor
necessário; mais código p/ lifecycle.

### Opção 3 — Polling HTTP no cliente
**Prós:** sem dependência extra; simplest.
**Contras:** latência de N segundos fixa; ineficiente (muitos GETs ociosos);
"tempo real" grosseiro.

### Opção 4 — Vite/React servido como servidor separado
**Contras:** dois processos em prod, dois binários/container; quebra o
princípio de implantação única.

## Decisão
Adotar **Vite + React + TS** como app em `src/app/`, empacotado para estático
e **servido pelo próprio Fastify** em produção (`/app/*`); a atualização em
tempo real via **Server-Sent Events** com o plugin oficial `@fastify/sse`.

- Endpoints SSE no Fastify (somente leitura, sem mutação):
  - `GET /app/events/queue` — snapshot + deltas do estado da fila/requests.
  - `GET /app/events/llm-logs` — stream das linhas novas de `llm_logs`.
- Os eventos são gerados por um **ticker no servidor**: o worker não foi
  modificado para emitir eventos; o poller SSE lê o SQLite em um intervalo
  curto (default 1s) e publica o diff para os clientes conectados.
- Servir estáticos: em dev o Vite roda em porta própria; em produção o
  Fastify responde `/app/*` (e `/`) com `dist/app/` (gerado em `pnpm app:build`).
- O endpoint SSE é interno; **sem** autenticação proposta neste ADR
  (painel de observabilidade local; autenticação pode virar ADR se exposto).

## Consequências
- **Positivo:** painel de observabilidade real-time sem novo processo em prod.
- **Positivo:** SSE é o mínimo viável para stream unidirecional; sem upgrade
  do WebSocket.
- **Negativo:** uma dependência de runtime extra (`@fastify/sse`) e
  devDeps Vite/React/TS; build do front é um passo a mais (`pnpm app:build`).
- **Negativo:** SSE mantém conexão por cliente; se muitos viewers, há custo
  de FDs (aceitável no volume baixo atual).
- **Negativo:** ausência de auth no SSE — só aceitável enquanto o painel
  for local; expor publicamente exigirá nova ADR.

## Confirmação
```bash
# plugin registrado
grep -q "@fastify/sse" package.json
# app existe
test -f src/app/index.html
# prod serve usa a build estática
grep -rn "dist/app" src/server.ts
# SSE endpoints declarados
grep -n "app/events" src/dashboardApi.ts
```

## Notas
- O ticker SSE lê só com `SELECT` (read-only); não altera estado. As fontes
  de mutação seguem sendo o webhook (enqueue) e o worker (claim/finalize).
- Para múltiplos clientes, cada SSE mantém seu próprio cursor (último
  `id` visto) para enviar só o delta.
- A build do front é independente do build do backend (`esbuild`); o
  `prepublish` ou CI deve rodar `pnpm app:build` p/ garantir `dist/app`.
