# ADR-0003: Resposta 202 + dedupe em memória por hash do corpo

## Status
Accepted

## Context
O remetente do webhook pode reenviar uma requisição quando o endpoint demora
a responder ou retorna falha. O fluxo aqui envolve um **loop de function
calling** de LLM que pode fazer várias chamadas a `list_files`/`read_file`
antes de `submit_issue`, ultrapassando facilmente o limite de timeout.
Processar de forma síncrona e responder só ao final causaria:

- timeouts → reenvios;
- reenvios processados novamente → **issues duplicadas** no repositório;
- consumo duplicado de tokens de LLM.

## Decision
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

## Consequences
- **Positivo:** elimina issues duplicadas causadas por reenvio.
- **Positivo:** o remetente não reenvia por timeout, reduzindo custo de LLM.
- **Negativo:** sem resposta de sucesso/falha da criação da issue para o
  remetente (aceitável: o resultado é a issue no repo).
- **Negativo:** dedupe em memória **não sobrevive a restarts**; se o processo
  reiniciar dentro da janela de reenvio, pode haver duplicação
  rara. Aceitável para volume baixo.
- **Negativo:** perda de jobs em processamento no restart (sem persistência).
  Fora de escopo por enquanto.

## Alternatives considered
- **Síncrono respondendo 201 ao final:** simples, mas praticamente garante
  timeout e duplicação de issues.
- **Fila persistente (Redis/BullMQ) + ack:** resolve restart e dedupe
  durável, porém adiciona infraestrutura (Redis) e dependências —
  desproporcional ao volume baixo atual. Deixado explicitamente fora do
  escopo; reavaliar se o volume crescer (ver "O que NÃO está no escopo" no
  `PLAN.md`).
- **Idempotência por issue existente (cheque antes de criar):** frágil porque
  depende de heurística de título/conteúdo; o hash do corpo é a chave
  determinística correta para reenvios idênticos.
- **`X-GitHub-Delivery`:** usada inicialmente, mas inadequada para payloads
  custom de ticket; substituída pelo hash SHA-256 do corpo.