# user-request-issue-writter

Servidor Node.js/Fastify (TypeScript) para VPS que recebe webhooks
com assinatura HMAC (formato GitHub: `x-hub-signature-256`), valida a
assinatura, usa um LLM (OpenAI-compatible) com *function calling* para
analisar o repositório sob demanda, e cria uma issue no GitHub a partir
do ticket enviado.

Consulte [`PLAN.md`](PLAN.md) e [`docs/adr/`](docs/adr/README.md) para o
detalhamento de arquitetura.

## Pré-requisitos

- Node.js 20+ (LTS)
- pnpm
- Um PAT GitHub com escopo `repo`
- Uma chave de API de um provedor LLM OpenAI-compatible
- (Produção) Um reverse proxy HTTPS (Caddy/Nginx) na frente

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

| Variável         | Obrigatório | Padrão          | Descrição                                                                                                           |
| ---------------- | ----------- | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `PORT`           | não         | `8080`          | Porta HTTP                                                                                                          |
| `WEBHOOK_SECRET` | sim         | —               | Segredo do webhook GitHub (HMAC SHA256)                                                                             |
| `GITHUB_TOKEN`   | sim         | —               | PAT com `repo` (ler arquivos + criar issue)                                                                         |
| `LLM_BASE_URL`   | sim         | —               | Ex.: `https://api.openai.com/v1`                                                                                    |
| `LLM_API_KEY`    | sim         | —               | Chave da API LLM                                                                                                    |
| `LLM_MODEL`      | sim         | —               | Ex.: `gpt-4o-mini`                                                                                                  |
| `LOG_LEVEL`      | não         | `info`          | Nível do pino                                                                                                       |
| `DATABASE_PATH`  | não         | `./data/app.db` | Caminho do SQLite (ou `:memory:`). Veja [ADR-0007](docs/adr/0007-sqlite-via-drizzle-orm-migrations-by-orm-only.md). |

## Enviando um ticket

O endpoint `POST /webhook/github` recebe um JSON com um **ticket** (não o
payload nativo de `issue_comment` do GitHub) e exige a assinatura HMAC
SHA256 no header `X-Hub-Signature-256`, no mesmo formato que o GitHub usa.

Formato do corpo:

```json
{
  "repo": "owner/repo",
  "requester": { "name": "Alice", "email": "alice@example.com" },
  "payload": {
    "descricao": "The login button is broken.",
    "url_atual": "https://app.example.com/login",
    "categoria": "bug",
    "contexto_da_sessao": "Chrome 120 on macOS",
    "logs_do_console": "TypeError: ...",
    "logs_de_rede": "POST /api/login 500",
    "screenshot": "https://..."
  }
}
```

Somente `repo` (no formato `owner/repo`) e `payload.descricao` são
obrigatórios; os demais campos são opcionais e enriquecem o contexto
enviado ao LLM. O `repo` precisa estar no allowlist (`repos.json`).

Para assinar (ex.: com o `WEBHOOK_SECRET`):

```sh
printf '%s' '<compact-json>' | openssl dgst -sha256 -hmac "seu-webhook-secret"
# header: X-Hub-Signature-256: sha256=<hex>
```

Exemplos prontos (com segredo `dev-secret-changeme`) estão em
`requests.http`.

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

#### Easypanel

O app escuta em `0.0.0.0` na porta definida por `PORT` (padrão **8080**). No
painel do serviço:

1. **Environment** — defina `PORT=8080` (ou omita e use o padrão) e as demais
   variáveis do `.env.example`.
2. **Domains → proxy port** — use a **mesma** porta que `PORT` (ex.: `8080`).
   Se o proxy apontar para outra porta, o Traefik retorna 502 e o app pode
   logar requisições internas sem responder ao domínio público.
3. **Volume** — monte `/app/data` para persistir o SQLite entre deploys.

Valide após o deploy:

```sh
curl https://seu-dominio.easypanel.host/health
# {"status":"ok"}
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

1. `POST /webhook/github` chega com um ticket assinado.
2. Valida assinatura HMAC (`timingSafeEqual`); 401 se divergir.
3. Faz parse do JSON e extrai `repo` + `payload.descricao`; 400/422 se inválido.
4. Verifica se o `repo` está no allowlist (`repos.json`); 403 se não estiver.
5. Calcula o **hash SHA-256 do corpo**.
6. **Persiste** a solicitação + item de fila no SQLite (transação)
   [`requests`/`queue` — ADR-0008]; o `UNIQUE(body_hash)` é o dedupe durável:
   reenvios idênticos respondem **200 no-op** (`duplicate: true`).
7. Responde **202** imediatamente com `requestId`/`bodyHash`.
8. Worker (mesmo processo, iniciado no boot) claims `pending` da fila e
   processa em background (`?dryRun=true` executa de forma síncrona e
   devolve a proposta sem enfileirar/criar).
9. Loop de function calling do LLM (`list_files`, `read_file`,
   `get_repo_info`) até chamar `submit_issue`; cada `onDebug` é gravado em
   `llm_logs` para auditoria.
10. Cria a issue via GitHub API (com fallback de labels se 422) e marca a
    fila como `done`/`failed`.

## Scripts

```sh
pnpm run dev        # desenvolvimento com watch
pnpm run build      # compila TypeScript (esbuild)
pnpm run start      # executa dist/index.js
pnpm run test       # roda o Vitest
pnpm run lint       # Biome check
pnpm run format     # Biome check --write
pnpm run typecheck  # tsc
pnpm run knip       # análise de código morto
pnpm run db:generate # drizzle-kit generate --name <slug> (ADR-0007)
pnpm run db:migrate  # drizzle-kit migrate
```

## Notas operacionais

- O GitHub reenvia webhooks em caso de timeout/falha. O servidor responde
  202 cedo (após persistir) e deduplica por **hash SHA-256 do corpo da
  requisição** com `UNIQUE` no SQLite (substitui o dedupe em memória do
  ADR-0003; ver [ADR-0008](docs/adr/0008-persistent-queue-and-llm-logs-in-sqlite.md)).
- Jobs em processamento sobrevivem a restarts: o worker reenfileira linhas
  deixadas em `processing` no boot (ver ADR-0008).
- Migrations são **geradas somente pelo ORM** (`drizzle-kit generate --name`),
  uma tabela por arquivo, e nunca editadas manualmente (ver
  [ADR-0007](docs/adr/0007-sqlite-via-drizzle-orm-migrations-by-orm-only.md)).
- O servidor nunca clona repositórios: lê via GitHub API com o PAT. Veja
  [ADR-0005](docs/adr/0005-read-repo-via-github-api-no-clone.md).
- Para HTTPS, use um reverse proxy (Caddy/Nginx) na frente do servidor.
- Em Docker, o SQLite vive no volume `/app/data` (ver `docker-compose.yml`).

## Licença

MIT
