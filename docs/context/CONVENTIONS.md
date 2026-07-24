# Conventions

<!-- Capítulo de contexto (CASA §4): estado atual, imperativo, atemporal.
     Carregar quando for criar/editar código, scripts, ou configuração do repo. -->

Project conventions for `user-request-issue-writter`.

## General

- Use English for code, comments, and durable project documentation.
- Keep the README current with setup, usage, validation, and contribution guidance.
- Prefer the smallest change that satisfies the project contract.

## Code Style

- Use spaces, LF line endings, no trailing whitespace, and one final newline.
- Follow repository-local formatter and linter configuration when present.

## Git

- Use Conventional Commits.
- Use descriptive branches such as `feature/<name>`, `fix/<name>`, and `chore/<name>`.
- Never commit secrets or `.env` files.

## CI/CD

- Run the project's lint, typecheck, test, and build scripts on pull requests when they exist.
- Keep CI commands aligned with the package scripts used locally.

## Agent Behavior

- Inspect existing files before changing them.
- Request explicit approval before overwriting user-authored files or performing irreversible actions.
- Report focused verification and any checks that could not run.

## Project Structure

- Keep source under `src/`, tests under `tests/`, and compiled output under `dist/`.

## Skills

- `commit-changes` for Conventional Commit workflows.
- `code-flow` for multi-step repository deliveries.

## Runtime

- Target the current Node.js LTS release.

## Package manager

- Use pnpm.

## Module system

- Use ESM with `"type": "module"` in `package.json`.

## Env contract

- Read `process.env` only in a centralized module such as `src/env.ts`.
- Validate and normalize values before exporting them to application code.

## Scripts contract

- Provide `dev`, `build`, `test`, `lint`, `format`, `typecheck`, and `knip` scripts.
- Add `prepare` when Husky installs hooks after dependency setup.

## Test runner

- Use Vitest unless the selected runtime provides the project test runner.

## Lint & Format

- Use Biome from the `@biomejs/biome` package.

## Type checking

- Run `tsc --noEmit` without emitting build artifacts.

## Dead code

- Use Knip with the generic project configuration from the overlay.
- Add project-specific workspaces and exceptions only when the repository actually needs them.

## Git hooks

- Husky delegates to repository scripts.
- Pre-commit runs lint and typecheck; pre-push runs tests.

## Commands

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

## Entry point

- Use `src/index.ts` as the default application or CLI entry point.
