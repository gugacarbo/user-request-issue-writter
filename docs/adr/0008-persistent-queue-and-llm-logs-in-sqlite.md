---
status: accepted
date: 2026-07-24
builds-on: ["ADR-0003", "ADR-0007"]
superseded-by: null
deciders: ["gustavo_carbonera"]
---

# ADR-0008: Fila de processamento persistente em SQLite + logs do agente LLM

## Contexto e problema
O ADR-0003 definiu resposta 202 + dedupe em memória e registrou como
consequências negativas: **(a) jobs em processamento são perdidos no restart**
e **(b) sem persistência de estado/resultado da criação da issue**. O
processamento da LLM (loop de function calling, ADR-0004) também é opaco: só
há logs efêmeros no `console`/pino. Precisamos:

1. Salvar a solicitação no banco **antes** do 202 e deixá-la na fila.
2. Worker processa itens `pending` da fila; reincorporação automática após
   restart (sem perda de job).
3. Persistir cada evento (iteração, chamada de tool, resposta) do agente LLM
   para auditoria/debug.

## Direcionadores da decisão
- **Durabilidade mínima viável:** sobreviver a restart sem adicionar Redis
  (fora de escopo, `PLAN.md`).
- **Observabilidade:** o debug atual (`onDebug`) é volátil; precisamos de
  histórico persistente por requisição.
- **Simplicidade operacional:** um único arquivo SQLite resolve fila + logs,
  sem operação adicional.
- **Coerência com ADR-0003:** o dedupe por hash do corpo continua existindo
  como controle de reenvio rápido; a fila agora é a fonte de verdade do
  *status* do processamento.

## Opções consideradas

### Opção 1 — Tabelas `requests`/`queue`/`llm_logs` em SQLite (este app)
**Prós:**
- Sem dependências externas além do já decidido no ADR-0007.
- Worker poll dentro do mesmo processo (sem infra de fila externa).
- Auditoria completa em `llm_logs` por `request_id`.
**Contras:**
- Worker poll (intervalo fixo) adiciona latência relativa; aceitável no volume.
- Concorrência: workers paralelos precisam de `UPDATE … WHERE status='pending'
  RETURNING` para claim atômico.

### Opção 2 — BullMQ + Redis
**Prós:** fila madura, retries, backoff, prioridades.
**Contras:** introduz Redis (explicitamente fora de escopo no `PLAN.md`),
infraestrutura extra desproporcional ao volume.

### Opção 3 — Persistir só resultado final (`requests.status`), sem `llm_logs`
**Prós:** schema mínimo.
**Contras:** perde observabilidade do loop (decisão explícita do usuário:
"logging do agente de LLM no banco"); não atende ao requisito.

### Opção 4 — Fila em arquivo/JSONL
**Prós:** zero dependência.
**Contras:** concorrência frágil, sem queries; rejeitado pelo ADR-0007.

## Decisão
Persistir o processamento em **três tabelas SQLite** (via Drizzle, ADR-0007):

- `requests` — registro imutável do webhook recebido, com `body_hash` único,
  `payload` (JSON), `requester`, `repo` e status (`pending` | `processing` |
  `done` | `failed`). Inserido **antes** do 202.
- `queue` — item de fila apontando para `request_id`, com `status`,
  `attempts`, `last_error`, `next_run_at`. Worker faz `SELECT … FOR UPDATE`
  semântico (claim atômico via `UPDATE … RETURNING`) para processar `pending`.
- `llm_logs` — linha por evento do agente (`request_id`, `iteration`,
  `event`, `tool_name`, `data` JSON, `created_at`). Gravado a partir do
  callback `onDebug` em `generateIssue`.

Fluxo do webhook:
1. Validação HMAC + parse + allowlist (síncrono, inalterado).
2. **Inserir** em `requests` (status `pending`) **e** em `queue` numa
   transação — antes do 202.
3. Responder **202** com `{ accepted: true, requestId, bodyHash, delivery }`.
4. Worker (mesmo processo, boot em `index.ts`) varre `queue` em intervalo curto
   e processa `pending` → chama `generateIssue` (com logging em `llm_logs`)
   → `createIssue` → marca `done`/`failed` com `attempts++` em `requests`/`queue`.

O dedupe por hash do ADR-0003 é promovido a **constraint** `UNIQUE` em
`requests.body_hash` (fallback além do dedupe em memória; tentar inserir
duplicado gera 200 no-op com `duplicate: true`).

## Consequências
- **Positivo (supera ADR-0003):** jobs sobrevivem a restart; o worker
  reprocessa `pending` no boot.
- **Positivo:** observabilidade completa do agente LLM via `llm_logs`
  (`SELECT … WHERE request_id = ? ORDER BY created_at`).
- **Positivo:** status consultável por request; permite responder a um
  futuro endpoint de status (não implementado aqui).
- **Negativo:** o `202` agora depende de uma escrita síncrona no SQLite
  (latência pequena, mas não nula; melhor que timeframe de timeout).
- **Negativo:** necessidade de claim atômico para múltiplos workers; no
  escopo atual (worker único) basta `UPDATE … RETURNING`, mas documentado
  para evolução.
- **Negativo:** o `llm_logs` pode crescer; necessidade de retenção/purge
  futura (feature fora deste ADR).

## Confirmação
```bash
# fila e logs têm tabelas no schema Drizzle
grep -E "requests|queue|llm_logs" src/db/schema.ts
# o 202 só é respondido após inserção em requests/queue
grep -n "202" src/server.ts   # deve estar depois de tx de insert
# worker lê pending no boot
grep -n "queue\|pending" src/index.ts
```

## Notas
- O `body_hash` continua SHA-256 do corpo cru (igual ADR-0003); apenas muda
  o local de armazenamento (memory → SQLite com UNIQUE).
- Retries: `attempts < N` re-enfileira com `next_run_at = now + backoff`;
  `failed` permanente após esgotar. Política detalhada pode virar Spec se
  evoluir.
- Logs do agente: cada chamada de `onDebug(message, data)` vira linha em
  `llm_logs` com `event=message` e `data` JSON.
