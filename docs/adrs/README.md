# Architecture Decision Records (ADRs)

Decisões de arquitetura que afetam a estrutura e o comportamento do código.
Cada ADR registra contexto, decisão, consequências e alternativas consideradas.

## Index

| ADR | Título | Status |
| --- | --- | --- |
| [0001](0001-fastify-as-web-framework.md) | Fastify como web framework | Accepted |
| [0002](0002-raw-fetch-over-sdks.md) | `fetch` direto em vez de SDKs de GitHub/LLM | Accepted |
| [0003](0003-202-async-with-in-memory-dedupe.md) | Resposta 202 + dedupe em memória por hash do corpo | Accepted |
| [0004](0004-llm-function-calling-tool-loop.md) | Loop de function calling com `submit_issue` terminal | Accepted |
| [0005](0005-read-repo-via-github-api-no-clone.md) | Ler repo via GitHub API, nunca clonar | Accepted |
| [0006](0006-centralized-typed-env-module.md) | Env centralizado e tipado em `src/env.ts` | Accepted |

## Convenções

- Nomear arquivos `NNNN-kebab-case-title.md` (NNNN sequencial).
- Cabeçalho: `# ADR-NNNN: Título`.
- Seções: Status, Context, Decision, Consequences, Alternatives considered.
- Quando uma decisão for revertida ou substituída, criar um novo ADR e marcar
  o anterior como `Superseded by ADR-NNNN`, sem apagar o histórico.