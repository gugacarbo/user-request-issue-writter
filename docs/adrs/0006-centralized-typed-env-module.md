# ADR-0006: Env centralizado e tipado em `src/env.ts`

## Status
Accepted

## Context
O servidor depende de várias variáveis de ambiente obrigatórias
(`WEBHOOK_SECRET`, `GITHUB_TOKEN`, `LLM_BASE_URL`, `LLM_API_KEY`,
`LLM_MODEL`) e opcionais/com default (`PORT`, `LOG_LEVEL`).
Ler `process.env` espalhado pelos módulos gera:

- strings não validadas propagadas pelo código (bugs em runtime, não em boot);
- default implícitos espalhados;
- dificuldade de testar (módulos acoplados a `process.env`).

## Decision
Centralizar **toda** leitura de `process.env` em **`src/env.ts`**:

- Validar obrigatórios no boot (lança cedo se faltar).
- Aplicar defaults e normalizar (`PORT` numérico, `LOG_LEVEL` string).
- Exportar um objeto **tipado** `Env` que os demais módulos recebem por
  injeção (não acessam `process.env` diretamente).
- Carregar o arquivo `.env` via `node --env-file=.env` (Node 20+), sem
  dependência `dotenv`.

## Consequences
- **Positivo:** falhas de configuração aparecem no boot, não em requisição.
- **Positivo:** o resto do código depende de um tipo `Env` resolvido, fácil
  de mockar em testes (passa um `Env` de teste em vez de mexer em
  `process.env`).
- **Positivo:** sem dependência extra (`dotenv`); usa capacidade nativa do
  Node 20+.
- **Negativo:** qualquer novo env exige editar `src/env.ts` e o tipo `Env`
  (fricção pequena e desejável — centraliza a intenção).

## Alternatives considered
- **`dotenv` espalhado:** adiciona dependência e não resolve validação/tipagem
  centralizada.
- **`@t3-oss/env` (t3env):** validação type-safe declarativa; boa opção, mas
  adiciona uma dependência e um padrão a mais para um conjunto de env pequeno
  e estável. Poderia ser adotada se o número de variáveis crescer.
- **Ler `process.env` diretamente em cada módulo:** rejeitado pelos problemas
  listados no contexto.