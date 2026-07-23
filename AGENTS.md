# AGENTS.md

```yaml
casa-repo-id: user-request-issue-writter   # usado em referências cross-repo (repo:ADR-0001)
casa-tier: T1                            # T0 (leve) | T1 (padrão) — STANDARD §3
casa-version: 1.8                        # versão do contrato CASA adotado (promessa do repo, ADR-0010)
casa-standard-ref: 7cdb964                 # versão do casa-standard de origem — o casa-init carimba
```

> Padrão: https://github.com/atplus-digital/casa-standard (STANDARD.md)
> ROUTER (CASA §4): carga sempre, teto ~150 linhas. Só alto-ROI transversal.
> Estourou o teto → conteúdo desce para docs/context/, fica o ponteiro.
> ⚠️ NÃO usar @import para colar capítulos: @import expande tudo no launch.
> Regras de um pacote específico → <subdir>/AGENTS.md (lazy nativo, nearest-wins).

## Contexto em 5 linhas
<!-- O que este sistema é, pra quem, e qual o stack principal. Máximo 5 linhas. -->

## Infra & ambientes
<!-- Onde roda; o que é self-hosted. ⚠️ Liste ferramentas que NUNCA usar
     (ex.: "Supabase self-hosted → nunca usar o supabase CLI").
     Detalhe extenso → docs/context/INFRA.md (ponteiro no mapa abaixo). -->

## Como rodar localmente
```bash
# comandos exatos, copiáveis
```

## Como validar (DoD global do repo)
```bash
npm run typecheck        # exit 0
npm test                 # tudo verde
```

## Como deployar
<!-- Ferramenta/script oficial, ordem, e o que NÃO fazer. -->

## Git & PRs
<!-- Convenções; quando commitar; se há remote; se o agente abre PR sem ser pedido. -->

## Gotchas
<!-- Conhecimento NÃO-INFERÍVEL que já custou tentativas falhas. Todo gotcha
     descoberto pelo agente DEVE ser registrado aqui. -->

-

## Mapa de contexto
<!-- Índice dos capítulos (docs/context/), cada um com QUANDO carregar.
     Capítulo = estado atual, imperativo, atemporal. Decisão datada = ADR. -->

| Capítulo       | Quando carregar |
| -------------- | --------------- |
| (nenhum ainda) | —               |

## Mapa de docs
- Decisões: `docs/adr/` · Comportamento: `docs/specs/` (READMEs GERADOS — não editar)
- Validar: `scripts/docs-check` · Regenerar índices: `scripts/docs-check --emit-index`

## Project conventions

### General

- Use English for code, comments, and durable project documentation.
- Keep the README current with setup, usage, validation, and contribution guidance.
- Prefer the smallest change that satisfies the project contract.

### Code Style

- Use spaces, LF line endings, no trailing whitespace, and one final newline.
- Follow repository-local formatter and linter configuration when present.

### Git

- Use Conventional Commits.
- Use descriptive branches such as `feature/<name>`, `fix/<name>`, and `chore/<name>`.
- Never commit secrets or `.env` files.

### CI/CD

- Run the project's lint, typecheck, test, and build scripts on pull requests when they exist.
- Keep CI commands aligned with the package scripts used locally.

### Agent Behavior

- Inspect existing files before changing them.
- Request explicit approval before overwriting user-authored files or performing irreversible actions.
- Report focused verification and any checks that could not run.

### Project Structure

- Keep source under `src/`, tests under `tests/`, and compiled output under `dist/`.

### Skills

- `commit-changes` for Conventional Commit workflows.
- `code-flow` for multi-step repository deliveries.

### Runtime

- Target the current Node.js LTS release.

### Package manager

- Use pnpm.

### Module system

- Use ESM with `"type": "module"` in `package.json`.

### Env contract

- Read `process.env` only in a centralized module such as `src/env.ts`.
- Validate and normalize values before exporting them to application code.

### Scripts contract

- Provide `dev`, `build`, `test`, `lint`, `format`, `typecheck`, and `knip` scripts.
- Add `prepare` when Husky installs hooks after dependency setup.

### Test runner

- Use Vitest unless the selected runtime provides the project test runner.

### Lint & Format

- Use Biome from the `@biomejs/biome` package.

### Type checking

- Run `tsc --noEmit` without emitting build artifacts.

### Dead code

- Use Knip with the generic project configuration from the overlay.
- Add project-specific workspaces and exceptions only when the repository actually needs them.

### Git hooks

- Husky delegates to repository scripts.
- Pre-commit runs lint and typecheck; pre-push runs tests.

### Commands

```sh
pnpm run dev
pnpm run build
pnpm run start
pnpm run test
pnpm run lint
pnpm run format
pnpm run typecheck
pnpm run knip
```

### Entry point

- Use `src/index.ts` as the default application or CLI entry point.
