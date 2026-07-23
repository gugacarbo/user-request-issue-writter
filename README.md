# user-request-issue-writter

Servidor Node.js/Fastify (TypeScript) para VPS que recebe webhooks
com assinatura HMAC (formato GitHub: `x-hub-signature-256`), valida a
assinatura, usa um LLM (OpenAI-compatible) com *function calling* para
analisar o repositório sob demanda, e cria uma issue no GitHub a partir
do ticket enviado.

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
| `LOG_LEVEL` | não | `info` | Nível do pino |

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
5. Deduplica por **hash SHA-256 do corpo** (em memória, TTL ~10 min).
6. Responde **202** imediatamente e processa em background
   (`?dryRun=true` executa de forma síncrona e devolve a proposta sem criar).
7. Loop de function calling do LLM (`list_files`, `read_file`,
   `get_repo_info`) até chamar `submit_issue`.
8. Cria a issue via GitHub API (com fallback de labels se 422).
9. Loga o resultado via pino.

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
  202 cedo e deduplica por **hash SHA-256 do corpo da requisição** (em
  memória, TTL ~10 min) para evitar issues duplicadas. Veja
  [ADR-0003](docs/adrs/0003-202-async-with-in-memory-dedupe.md).
- O servidor nunca clona repositórios: lê via GitHub API com o PAT. Veja
  [ADR-0005](docs/adrs/0005-read-repo-via-github-api-no-clone.md).
- Para HTTPS, use um reverse proxy (Caddy/Nginx) na frente do servidor.

## Licença

MIT
