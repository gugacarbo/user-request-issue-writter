# user-request-issue-writter

Servidor Node.js/Fastify (TypeScript) para VPS que recebe webhooks
`issue_comment` do GitHub, valida a assinatura HMAC, usa um LLM
(OpenAI-compatible) com *function calling* para analisar o repositório sob
demanda, e cria uma issue no GitHub a partir do comentário.

Consulte [`PLAN.md`](PLAN.md) e [`docs/adrs/`](docs/adrs/README.md) para o
detalhamento de arquitetura.

## Pré-requisitos

- Node.js 20+ (LTS)
- pnpm
- Um PAT GitHub com escopo `repo`
- Uma chave de API de um provedor LLM OpenAI-compatible
- (Produção) Um reverse proxy HTTPS (Caddy/Nginx) na frente

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

| Variável | Obrigatório | Padrão | Descrição |
| --- | --- | --- | --- |
| `PORT` | não | `8080` | Porta HTTP |
| `WEBHOOK_SECRET` | sim | — | Segredo do webhook GitHub (HMAC SHA256) |
| `GITHUB_TOKEN` | sim | — | PAT com `repo` (ler arquivos + criar issue) |
| `LLM_BASE_URL` | sim | — | Ex.: `https://api.openai.com/v1` |
| `LLM_API_KEY` | sim | — | Chave da API LLM |
| `LLM_MODEL` | sim | — | Ex.: `gpt-4o-mini` |
| `TRIGGER_PREFIX` | não | vazio | Se definido (ex.: `/issue`), só processa comentários com esse prefixo |
| `LOG_LEVEL` | não | `info` | Nível do pino |

## Configurando o webhook GitHub

1. Crie um PAT GitHub com escopo `repo`.
2. No repositório, em **Settings → Webhooks → Add webhook**:
   - **Payload URL**: `http://VPS:PORT/webhook/github`
   - **Content type**: `application/json`
   - **Secret**: o valor de `WEBHOOK_SECRET`
   - **Events**: `Issue comments`
3. (Opcional) Defina `TRIGGER_PREFIX=/issue` para só processar comentários
   que comecem com `/issue`.

## Como rodar

### Desenvolvimento

```sh
pnpm install
pnpm run dev
```

### Produção (Docker)

```sh
cp .env.example .env  # preencha
docker compose up -d --build
```

Alternativa sem Docker:

```sh
pnpm install
pnpm run build
node --env-file=.env dist/index.js
```

## Healthcheck

```sh
curl http://localhost:8080/health
# {"status":"ok"}
```

## Fluxo

1. `POST /webhook/github` chega GitHub.
2. Valida assinatura HMAC (`timingSafeEqual`); 401 se divergir.
3. Filtra `X-GitHub-Event === 'issue_comment'` e `action === 'created'`.
4. Aplica `TRIGGER_PREFIX` se configurado.
5. Responde **202** imediatamente e processa em background.
6. Loop de function calling do LLM (`list_files`, `read_file`,
   `get_repo_info`) até chamar `submit_issue`.
7. Cria a issue via GitHub API (com fallback de labels se 422).
8. Loga o resultado via pino.

## Scripts

```sh
pnpm run dev        # desenvolvimento com watch
pnpm run build      # compila TypeScript
pnpm run start      # executa dist/index.js
pnpm run test       # roda o Vitest
pnpm run lint       # Biome check
pnpm run format     # Biome check --write
pnpm run typecheck  # tsc --noEmit
pnpm run knip       # análise de código morto
```

## Notas operacionais

- O GitHub reenvia webhooks em caso de timeout/falha. O servidor responde
  202 cedo e deduplica por `X-GitHub-Delivery` (em memória, TTL ~10 min) para
  evitar issues duplicadas. Veja
  [ADR-0003](docs/adrs/0003-202-async-with-in-memory-dedupe.md).
- O servidor nunca clona repositórios: lê via GitHub API com o PAT. Veja
  [ADR-0005](docs/adrs/0005-read-repo-via-github-api-no-clone.md).
- Para HTTPS, use um reverse proxy (Caddy/Nginx) na frente do servidor.

## Licença

MIT
