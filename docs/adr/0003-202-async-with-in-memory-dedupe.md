---
status: accepted
date: 2026-07-24
builds-on: []
superseded-by: null
deciders: ["gustavo_carbonera"]
---

# ADR-0003: Resposta 202 + dedupe em memória por hash do corpo

## Contexto e problema
O remetente do webhook pode reenviar uma requisição quando o endpoint demora
a responder ou retorna falha. O fluxo aqui envolve um **loop de function
calling** de LLM que pode fazer várias chamadas a `list_files`/`read_file`
antes de `submit_issue`, ultrapassando facilmente o limite de timeout.
Processar de forma síncrona e responder só ao final causaria:

- timeouts → reenvios;
- reenvios processados novamente → **issues duplicadas** no repositório;
- consumo duplicado de tokens de LLM.

## Direcionadores da decisão
- **Latência do fluxo:** loop de function calling excede timeouts de webhook.
- **Idempotência:** evitar issues duplicadas por reenvio.
- **Custo:** evitar consumo duplicado de tokens de LLM.
- **Minimalismo:** sem infraestrutura externa (Redis) por enquanto.

## Opções consideradas

### Opção 1 — Resposta 202 + dedupe em memória por hash SHA-256 (escolhida)
**Prós:**
- Elimina issues duplicadas causadas por reenvio.
- O remetente não reenvia por timeout, reduzindo custo de LLM.
**Contras:**
- Sem resposta de sucesso/falha da criação da issue para o remetente.
- Dedupe em memória não sobrevive a restarts; perda de jobs em processamento
  no restart.

### Opção 2 — Síncrono respondendo 201 ao final
**Prós:** simples.
**Contras:** praticamente garante timeout e duplicação de issues.

### Opção 3 — Fila persistente (Redis/BullMQ) + ack
**Prós:** resolve restart e dedupe durável.
**Contras:** adiciona infraestrutura (Redis) e dependências — desproporcional
ao volume baixo atual. Deixado explicitamente fora do escopo; reavaliar se o
volume crescer (ver "O que NÃO está no escopo" no `PLAN.md`).

### Opção 4 — Idempotência por issue existente (cheque antes de criar)
**Prós:** sem estado.
**Contras:** frágil porque depende de heurística de título/conteúdo; o hash
do corpo é a chave determinística correta para reenvios idênticos.

### Opção 5 — `X-GitHub-Delivery`
**Prós:** header dedicado.
**Contras:** usado inicialmente, mas inadequado para payloads custom de
ticket; substituído pelo hash SHA-256 do corpo.

## Decisão
Responder **202 Accepted** imediatamente após validação HMAC + extração do
contexto, e processar `generateIssue` + `createIssue` em background (dentro
do mesmo processo, sem fila externa).

- Dedupe por **hash SHA-256 do corpo da requisição**: manter um `Map` em
  memória com TTL curto (10 min) dos hashes já aceitos.
- Reentregas do mesmo corpo retornam 200 no-op (com `duplicate: true`),
  sem disparar novo processamento.
- Erros pré-202 (HMAC, parsing) respondem 401/422/400 normalmente; erros
  pós-202 ficam só no log estruturado (não há como responder ao remetente).

> Observação: originalmente o dedupe usava `X-GitHub-Delivery`. Como o
> payload é um ticket custom (não o webhook nativo do GitHub), a chave
> determinística passou a ser o hash do corpo.

## Consequências
- **Positivo:** elimina issues duplicadas causadas por reenvio.
- **Positivo:** o remetente não reenvia por timeout, reduzindo custo de LLM.
- **Negativo:** sem resposta de sucesso/falha da criação da issue para o
  remetente (aceitável: o resultado é a issue no repo).
- **Negativo:** dedupe em memória **não sobrevive a restarts**; se o processo
  reiniciar dentro da janela de reenvio, pode haver duplicação
  rara. Aceitável para volume baixo.
- **Negativo:** perda de jobs em processamento no restart (sem persistência).
  Fora de escopo por enquanto (ver ADR-0008 para a evolução).

## Confirmação
```bash
grep -n "202" src/server.ts
grep -n "createHash\|sha256" src/server.ts
```

## Notas
- A persistência da fila e dos logs do agente LLM evoluiu no ADR-0008,
  que promove o `body_hash` a constraint `UNIQUE` em SQLite.
