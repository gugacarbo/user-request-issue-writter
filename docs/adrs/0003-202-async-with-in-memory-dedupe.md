# ADR-0003: Resposta 202 + dedupe em memória por delivery

## Status
Accepted

## Context
O GitHub reenvia um webhook quando o endpoint demora a responder ou retorna
falha, com timeout de entrega da ordem de ~10 segundos. O fluxo aqui envolve
um **loop de function calling** de LLM que pode fazer várias chamadas a
`list_files`/`read_file` antes de `submit_issue`, ultrapassando facilmente
esse limite. Processar de forma síncrona e responder só ao final causaria:

- timeouts do GitHub → reenvios;
- reenvios processados novamente → **issues duplicadas** no repositório;
- consumo duplicado de tokens de LLM.

## Decision
Responder **202 Accepted** imediatamente após validação HMAC + filtro de
evento + extração do contexto, e processar `generateIssue` + `createIssue`
em background (dentro do mesmo processo, sem fila externa).

- Dedupe por **`X-GitHub-Delivery`**: manter um `Set`/`Map` em memória com
  TTL curto (10–15 min) das deliveries já aceitas.
- Reentregas do mesmo delivery ID retornam 200 no-op (loga
  "duplicate delivery ignored"), sem disparar novo processamento.
- Erros pré-202 (HMAC, parsing) respondem 401/422/500 normalmente; erros
  pós-202 ficam só no log estruturado (não há como responder ao GitHub).

## Consequences
- **Positivo:** elimina issues duplicadas causadas por reenvio do GitHub.
- **Positivo:** o GitHub não reenvia por timeout, reduzindo custo de LLM.
- **Negativo:** sem resposta de sucesso/falha da criação da issue para o
  remetente do comentário (aceitável: o resultado é a issue no repo).
- **Negativo:** dedupe em memória **não sobrevive a restarts**; se o processo
  reiniciar dentro da janela de reenvio do GitHub, pode haver duplicação
  rara. Aceitável para volume baixo.
- **Negativo:** perda de jobs em processamento no restart (sem persistência).
  Fora de escopo por enquanto.

## Alternatives considered
- **Síncrono respondendo 201 ao final:** simples, mas praticamente garante
  timeout do GitHub e duplicação de issues.
- **Fila persistente (Redis/BullMQ) + ack:** resolve restart e dedupe
  durável, porém adiciona infraestrutura (Redis) e dependências —
  desproporcional ao volume baixo atual. Deixado explicitamente fora do
  escopo; reavaliar se o volume crescer (ver "O que NÃO está no escopo" no
  `PLAN.md`).
- **Idempotência por issue existente (cheque antes de criar):** frágil porque
  depende de heurística de título/conteúdo; o `X-GitHub-Delivery` é a chave
  determinística correta.