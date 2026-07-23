# Plano: Servidor Webhook → LLM → Issue GitHub

> **Nota:** este documento descreve o plano original (modelo de webhook
> `issue_comment` do GitHub). O sistema evoluiu para um **ticket custom**
> assinado com HMAC; consulte o `README.md` para o fluxo atual e
> `docs/adrs/` para as decisões vigentes.

## Resumo
Servidor Node.js/Fastify (TypeScript) para VPS que recebe webhooks
`issue_comment` do GitHub, valida a assinatura HMAC, usa um LLM (API
OpenAI-compatible) com *function calling* para avaliar o contexto do
repositório sob demanda, e cria uma issue no GitHub com o resultado.

## Stack
- **Runtime:** Node.js 20+ (fetch e crypto nativos).
- **Linguagem:** TypeScript (modo estrito); ESM (`import`/`export`).
- **Web framework:** Fastify (logging pino embutido).
- **Dependência de runtime:** apenas `fastify`. Sem SDKs de GitHub/LLM —
  chamadas REST via `fetch`, mantendo o binário/imagem enxuto. Carregar `.env`
  via `node --env-file=.env` (Node 20+), sem `dotenv`.
- **LLM:** OpenAI-compatible (`POST {base_url}/chat/completions` com `tools`).
- **Dev tooling (já instalado):** Vitest, Biome, Knip, Husky, tsx, TypeScript.

> Decisões de arquitetura com contexto e alternativas estão em
> [`docs/adrs/`](docs/adrs/).

## Configuração (env)
Variáveis em `.env` (ver `.env.example`):
- `PORT` (default 8080)
- `WEBHOOK_SECRET` — segredo do webhook GitHub (HMAC SHA256)
- `GITHUB_TOKEN` — PAT com `repo` (ler arquivos + criar issue)
- `LLM_BASE_URL` — ex. `https://api.openai.com/v1`
- `LLM_API_KEY`
- `LLM_MODEL` — ex. `gpt-4o-mini`
- `TRIGGER_PREFIX` (opcional) — se definido (ex. `/issue`), só processa
  comentários que comecem com o prefixo. Se vazio, processa todos os
  comentários (custo maior de LLM).
- `LOG_LEVEL` (default `info`)

### Contrato de env
> Ver [ADR-0006](docs/adrs/0006-centralized-typed-env-module.md).
- Centralizar toda leitura de `process.env` em `src/env.ts`.
- Validar obrigatórios no boot (lança cedo se faltar).
- Exportar um objeto **tipado** `Env` (não passar strings não validadas pelos
  módulos). Demais módulos recebem o `Env` resolvido, nunca `process.env`.

## Estrutura de arquivos
```
package.json
tsconfig.json
.env.example
README.md
Dockerfile
docker-compose.yml
src/
  index.ts      # entry point: lê .env, carrega env, instancia logger e sobe server
  env.ts        # lê/valida process.env, exporta objeto tipado Env
  logger.ts     # wrapper de pino (quando necessário fora do request; caso contrário usa fastify.log)
  server.ts     # app Fastify + rota POST /webhook/github + healthcheck (function factory para testes)
  webhook.ts    # verifySignature (HMAC) + parseEvento + filtro de trigger
  github.ts     # cliente GitHub REST tipado: getRepoTree, getFileContent,
                #   getRepoInfo, createIssue (com fallback de labels)
  tools.ts      # schemas (JSON) das tools + dispatchers que chamam github.ts
  llm.ts        # loop de chat com tools até submit_issue ser chamado
tests/
  webhook.test.ts
  env.test.ts
  tools.test.ts
  llm.test.ts
  github.test.ts
  server.test.ts
```

## Fluxo de uma requisição
1. `POST /webhook/github` chega.
2. `webhook.verifySignature(rawBody, signature, secret)` —
   `sha256=...` comparado com `crypto.timingSafeEqual`. Rejeita 401 se divergir.
3. Filtra header `X-GitHub-Event === 'issue_comment'` e
   `body.action === 'created'` (ignora edits/deletes). Caso contrário 200 no-op.
4. Aplica `TRIGGER_PREFIX` se configurado.
5. Extrai: `owner/repo`, `comment.body`, `comment.user.login`, issue original
   (`number`, `title`, `body`), URL do comentário, `X-GitHub-Delivery`.
6. **Resposta imediata 202** com `{accepted: true, delivery}` e processamento
   em background (ver "Entrega assíncrona / idempotência" abaixo).
7. Chama `llm.generateIssue(context)`.
8. `llm.ts` executa o **tool loop**:
   - Mensagem de sistema: "Você é um engenheiro que analisa um repositório
     via tools e redige uma issue a partir de um comentário de usuário.
     Use as tools para entender o contexto antes de submeter."
   - Tools disponíveis:
     - `list_files(path?)` → chama `github.getRepoTree`
     - `read_file(path)` → chama `github.getFileContent` (limite de tamanho,
       trunca arquivos muito grandes)
     - `get_repo_info()` → descrição, linguagens, README
     - `submit_issue(title, body, labels?)` → **tool terminal**: ao ser
       chamada, interrompe o loop e retorna os argumentos estruturados
       (não executa ainda; o handler externo cria a issue de fato).
   - Loop: enquanto o modelo retornar `tool_calls`, executa os dispatchers
     (exceto `submit_issue`, que encerra) e adiciona os resultados como
     mensagens `tool`. Limite de iterações (ex. 15) por segurança.
9. De posse de `{title, body, labels}` (do `submit_issue`), `server.ts`
   chama `github.createIssue(owner, repo, ...)`. O `body` inclui um rodapé
   creditando o autor + link para o comentário original.
10. Loga o resultado (`issue_number, url`) via pino.

Erros em qualquer etapa → log estruturado, sem crashar o processo.
Erros síncronos pré-202 respondem 401/422/500; pós-202 ficam só no log.

## Entrega assíncrona / idempotência
> Ver [ADR-0003](docs/adrs/0003-202-async-with-in-memory-dedupe.md).
O GitHub reenvia o webhook se o endpoint demorar ou responder falha, e loops
de LLM com várias tools ultrapassam facilmente o timeout de entrega do GitHub
(~10s), o que causaria **issues duplicadas**. Para evitar isso:
- Responder **202 Accepted** imediatamente após validação HMAC + extração do
  contexto, antes de chamar o LLM.
- Processar o `generateIssue` + `createIssue` em background.
- **Dedupe por `X-GitHub-Delivery`**: manter um Set/Map em memória (TTL curto,
  ex. 10–15 min) das deliveries já aceitas; reentregas do mesmo ID viram
  200 no-op duplicado (loga "duplicate delivery ignored"). Adequado ao volume
  baixo de webhooks; para volume alto, trocar por Redis/queue em memória
  persistente posteriormente (fora de escopo agora).
- Observação: processamento síncrono por requisição permanece aceitável no
  *fluxo* (não há fila entre jobs), desde que a resposta ao GitHub seja 202.

## Segurança / robustez
- Verificação HMAC com `timingSafeEqual` (timing-safe).
- `GITHUB_TOKEN` lê arquivos via API; nunca clona o repo (evita custo de
  disk/git no VPS e funcionamento em repositórios privados com PAT).
- Truncamento de conteúdo de arquivos grandes antes de mandar ao LLM.
- Cap de iterações do tool loop.
- Validação de env tipado no boot (`env.ts` lança se obrigatórios faltam).
- As tools só operam no `owner/repo` extraído do webhook (não permite
  path traversal fora do repo — é só o contexto do próprio repo).
- **Fallback de labels**: `createIssue` com `labels` retorna 422 se alguma
  label não existir no repo. Tratar o 422 criando a issue **sem labels** e
  logar as labels rejeitadas, em vez de falhar a issue inteira.

## Testes (Vitest)
Cobertura mínima por módulo, intercalada com a implementação:
- `webhook.test.ts`: `verifySignature` (caso ok, assinatura divergente,
  signature ausente) e filtro de trigger com `TRIGGER_PREFIX`.
- `env.test.ts`: carregamento com env completo; lança quando falta cada
  obrigatório; aplica defaults (`PORT`, `LOG_LEVEL`).
- `github.test.ts`: `getFileContent` com truncamento de arquivos grandes;
  `createIssue` com fallback de labels ao receber 422 (mock de `fetch`).
- `tools.test.ts`: dispatchers chamam `github.*` corretamente;
  `submit_issue` é terminal (interrompe o loop sem chamar GitHub).
- `llm.test.ts`: loop com duas rodadas de `tool_calls` + `submit_issue`
  final (mock do endpoint LLM retornando respostas pré-gravadas); cap de
  iterações encerra com erro controlado.
- `server.test.ts`: rota 200 no-op para evento não-`issue_comment`;
  401 HMAC inválido; 202 + dedupe por delivery duplicado; healthcheck.

## Deploy VPS
- `Dockerfile` multi-stage leve (node:20-alpine).
- `docker-compose.yml` com restart policy + env_file.
- `README.md` com passo a passo:
  1. Criar PAT GitHub (`repo`).
  2. Configurar webhook no repo (URL `http://VPS:PORT/webhook/github`,
     `application/json`, secret).
  3. Copiar `.env.example` → `.env` e preencher.
  4. Rodar via docker compose (ou pm2/systemd como alternativa).
- Observação: HTTPS recomendado via reverse proxy (Caddy/Nginx) na frente.

## O que NÃO está no escopo (pode entrar depois)
- Múltiplos provedores LLM (Anthropic/Gemini) — só OpenAI-compatible por ora.
- Outros eventos além de `issue_comment`.
- Suporte a GitLab/Gitea.
- Fila persistente/Redis (dedupe em memória atende ao volume baixo atual).

## Ordem de implementação
1. Adicionar `fastify` ao `package.json`; `env.ts` + `logger.ts` + testes.
2. `github.ts` (clientes REST tipados) + `github.test.ts`.
3. `tools.ts` (schemas + dispatchers) + `tools.test.ts`.
4. `llm.ts` (tool loop) + `llm.test.ts`.
5. `webhook.ts` (HMAC + parse + filtro) + `webhook.test.ts`.
6. `server.ts` (+ `index.ts` bootstrap: rota, orquestração, 202 + dedupe,
   fallback de labels) + `server.test.ts`.
7. `.env.example`, `Dockerfile`, `docker-compose.yml`, `README.md`.

## Critério de entrega (done-gate)
Antes de considerar fechado, executar e validar:
```sh
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run knip
pnpm run build
```
Todos devem passar (alinhado ao `AGENTS.md`: Scripts contract + CI/CD).
