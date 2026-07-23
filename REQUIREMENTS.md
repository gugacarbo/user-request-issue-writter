# Project requirements

## Tools

- Git for version control.
- An editor with EditorConfig support.

## Base files

- `.editorconfig` for editor defaults.
- `.gitignore` for common dependencies, environment files, outputs, caches, and logs.
- `AGENTS.md` for composed project conventions.
- `REQUIREMENTS.md` for composed project requirements.

## Core Dependencies

- `typescript` and `@types/node` for the Node.js type boundary.

## Dev Dependencies

- `vitest`, `@biomejs/biome`, `tsx`, `knip`, and `husky`.

## CI/CD

- Run `tsc --noEmit`, Vitest, Biome, Knip, and the production build.

## Skills

- `project-init` for convention overlays on fresh projects.
- `commit-changes` for commits.
- `code-flow` for multi-step delivery.
