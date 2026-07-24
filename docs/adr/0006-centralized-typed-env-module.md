---
status: accepted
date: 2026-07-24
builds-on: []
superseded-by: null
deciders: ["gustavo_carbonera"]
---

# ADR-0006: Env centralizado e tipado em `src/env.ts`

## Contexto e problema
O servidor depende de várias variáveis de ambiente obrigatórias
(`WEBHOOK_SECRET`, `GITHUB_TOKEN`, `LLM_BASE_URL`, `LLM_API_KEY`,
`LLM_MODEL`) e opcionais/com default (`PORT`, `LOG_LEVEL`).
Ler `process.env` espalhado pelos módulos gera:

- strings não validadas propagadas pelo código (bugs em runtime, não em boot);
- default implícitos espalhados;
- dificuldade de testar (módulos acoplados a `process.env`).

## Direcionadores da decisão
- **Falhar cedo:** erros de configuração no boot, não em requisição.
- **Tipagem:** código depende de um `Env` resolvido, fácil de mockar.
- **Minimalismo:** usar capacidade nativa do Node 20+ (`--env-file`), sem
  `dotenv`.
- **Intenção centralizada:** novo env exige editar `src/env.ts`.

## Opções consideradas

### Opção 1 — Módulo centralizado em `src/env.ts` (escolhida)
**Prós:**
- Falhas de configuração aparecem no boot, não em requisição.
- Código depende de um tipo `Env` resolvido, fácil de mockar em testes.
- Sem dependência extra (`dotenv`); usa capacidade nativa do Node 20+.
**Contras:**
- Qualquer novo env exige editar `src/env.ts` e o tipo `Env` (fricção
  pequena e desejável — centraliza a intenção).

### Opção 2 — `dotenv` espalhado
**Prós:** padrão conhecido.
**Contras:** adiciona dependência e não resolve validação/tipagem centralizada.

### Opção 3 — `@t3-oss/env` (t3env)
**Prós:** validação type-safe declarativa.
**Contras:** adiciona uma dependência e um padrão a mais para um conjunto de
env pequeno e estável. Poderia ser adotada se o número de variáveis crescer.

### Opção 4 — Ler `process.env` diretamente em cada módulo
**Prós:** zero abstração.
**Contras:** rejeitado pelos problemas listados no contexto (strings não
validadas, defaults implícitos, difícil de testar).

## Decisão
Centralizar **toda** leitura de `process.env` em **`src/env.ts`**:

- Validar obrigatórios no boot (lança cedo se faltar).
- Aplicar defaults e normalizar (`PORT` numérico, `LOG_LEVEL` string).
- Exportar um objeto **tipado** `Env` que os demais módulos recebem por
  injeção (não acessam `process.env` diretamente).
- Carregar o arquivo `.env` via `node --env-file=.env` (Node 20+), sem
  dependência `dotenv`.

## Consequências
- **Positivo:** falhas de configuração aparecem no boot, não em requisição.
- **Positivo:** o resto do código depende de um tipo `Env` resolvido, fácil
  de mockar em testes (passa um `Env` de teste em vez de mexer em
  `process.env`).
- **Positivo:** sem dependência extra (`dotenv`); usa capacidade nativa do
  Node 20+.
- **Negativo:** qualquer novo env exige editar `src/env.ts` e o tipo `Env`
  (fricção pequena e desejável — centraliza a intenção).

## Confirmação
```bash
grep -rn "process.env" src/ | grep -v src/env.ts && echo "FALHA: env fora de env.ts" || echo "ok: env centralizado"
test -f src/env.ts && grep -q "export.*Env" src/env.ts
```

## Notas
- ADR-0007 (`builds-on`: `ADR-0006`) estende o contrato de env ao adicionar
  `DATABASE_PATH` (default `./data/app.db`) para o SQLite via Drizzle.