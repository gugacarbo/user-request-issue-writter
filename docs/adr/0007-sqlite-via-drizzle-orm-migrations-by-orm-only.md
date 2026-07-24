---
status: accepted
date: 2026-07-24
builds-on: ["ADR-0006"]
superseded-by: null
deciders: ["gustavo_carbonera"]
---

# ADR-0007: SQLite via Drizzle ORM; migrations geradas somente pelo ORM

## Contexto e problema
O app hoje não persiste estado de processamento (o ADR-0003 documenta que o
dedupe é em memória e jobs em processamento são perdidos no restart). Para
uma fila de processamento persistente e logs de execução do agente LLM é
necessário um banco de dados local. A definição de schema/migrations é
decisão arquitetural que precisa ser fixada: SQL escrito à mão vs. derivado
da fonte única (schema TypeScript).

## Direcionadores da decisão
- **Fonte única:** o schema TypeScript (`src/db/schema.ts`) deve ser a verdade;
  SQL manual divergente causa drift entre código e banco.
- **Ambiente VPS self-hosted, volume baixo:** sem RDS/Neon, sem servidor extra.
- **Sem orquestração externa:** o processo Node deve subir o banco e aplicar
  migrations no boot (implantável em um único binário/container).
- **Reprodutibilidade de testes:** precisamos instanciar DB em arquivo (ou
  `:memory:`) por teste de forma determinística.

## Opções consideradas

### Opção 1 — Drizzle ORM + `better-sqlite3` + `drizzle-kit generate`
**Prós:**
- Schema TS tipado como fonte única; queries type-safe.
- `drizzle-kit generate` deriva SQL a partir do schema (gerado, não escrito).
- `better-sqlite3` é síncrono e rápido; sem pool/async overhead para volume baixo.
- Migrations aplicáveis programaticamente no boot via `migrate()`.
**Contras:**
- Adiciona dependências (`drizzle-orm`, `drizzle-kit`, `better-sqlite3`).
- Native addon (`better-sqlite3`) exige rebuild no alvo do Docker (multi-stage).

### Opção 2 — Prisma
**Prós:** DX maduro, migrations tipadas.
**Contras:** runtime pesado, gerador de client addicional, shadow DB necessário
para testes; overkill para SQLite local de volume baixo.

### Opção 3 — SQL cru + driver (`better-sqlite3`) sem ORM
**Prós:** zero dependências ORM; controle total.
**Contras:** sem tipagem, campos/colunas divergem fácil, drift de schema; o
custo de manutenção cresce com tabelas (fila + logs + requests).

### Opção 4 — `libSQL`/Turso (remoto)
**Prós:** serverless, edge.
**Contras:** adiciona infraestrutura de rede/design, contra o princípio "sem
serviços extras" (ver `PLAN.md` "O que NÃO está no escopo").

## Decisão
Adotar **SQLite** acessado via **Drizzle ORM** com driver **`better-sqlite3`**.
A regra de migrations é: **migrations são geradas somente pelo ORM**
(`drizzle-kit generate`); nunca hand-written. O arquivo `src/db/schema.ts`
é a fonte única de verdade. As migrations geradas vivem em `migrations/` e
são aplicadas programaticamente no boot do processo via `migrate(db, …)`.

- Migrations manuais (escritas à mão) e DDL ad-hoc em runtime são **proibidos**.
- O driver `better-sqlite3` (native addon) é a única dependência de runtime
  de DB; `drizzle-kit` é dev-only.
- O caminho do arquivo SQLite vem de `src/env.ts` (`DATABASE_PATH`, default
  `./data/app.db`), conforme ADR-0006.

### Regras de migração (obrigatórias)
1. **Sempre nomeadas.** Toda geração deve passar `--name` descritivo
   (`drizzle-kit generate --name create_requests`); **nunca** usar o nome
   aleatório padrão (`0000_bouncy_captain_midlands`). O slug reflete a
   intenção da migration (`create_<tabela>`, `add_<coluna>_to_<tabela>`,
   `drop_<tabela>`, etc.).
2. **Uma tabela por migration.** Cada migration contém no máximo **uma**
   tabela (ou uma operação atômica: add column, create index…). Quando o
   schema adiciona N tabelas, gerar N migrations incrementais (uma por
   tabela), alterando o `src/db/schema.ts` e rodando `drizzle-kit generate
   --name create_<tabela>` entre cada adição.
3. **Migrations são imutáveis e prontas para leitura.** Após gerada, uma
   migration **nunca** é editada à mão (nem mesmo typo/rename); para mudar
   comportamento, gerar uma nova migration. O bloqueio é reforçado em
   `.editorconfig` (`read_only = true` para `migrations/**`).

## Consequências
- **Positivo:** uma única fonte (TS) → código e banco nunca divergem.
- **Positivo:** o processo sobe o banco sozinho; sem passo externo de
  provisioning de schema.
- **Positivo:** testes usam `:memory:` ou arquivo temporário; o `migrate()`
  prepara o schema de forma determinística.
- **Negativo:** rebuild do `better-sqlite3` no Docker (multi-stage, com
  `node-gyp`/toolchain); Dockerfile precisa do stage de build apropriado.
- **Negativo:** mudar o schema exige `drizzle-kit generate` + commit da
  migration gerada (fricção pequena, mas real).

## Confirmação
```bash
# não deve existir DDL escrito à mão em src/ (exceto o schema Drizzle)
! grep -rnE "CREATE TABLE|ALTER TABLE|DROP TABLE" src/ && echo "ok: sem DDL manual"
# migrations são geradas pelo kit
test -f drizzle.config.ts && grep -q "drizzle-kit generate" package.json
# toda geração usa --name (nunca o nome aleatório padrão): proc direto no REAMDE/CONVENTIONS
# bloqueio de edição enforce em .editorconfig
grep -A2 'migrations' .editorconfig
# uma tabela por migration: máximo 1 CREATE TABLE por arquivo .sql
for f in migrations/*.sql; do
  n=$(grep -cE '^CREATE TABLE' "$f")
  test "$n" -le 1 || { echo "violação 1-tabela-por-migration em $f"; exit 1; }
done
echo "ok: regra 1-tabela-por-migration respeitada"
```

## Notas
- O driver `better-sqlite3` é síncrono; usar dentro de `async` é seguro e
  barato (não bloqueia event loop por muito tempo neste volume.
- Loads incrementais de migrations futuras devem passar por
  `drizzle-kit generate --name <slug>` novamente — nunca editar migrations já aplicadas.
- A regra `uma tabela por migration` força gerar incrementalmente quando o
  schema cresce: adicione só a nova tabela ao `schema.ts`, rode
  `db:generate --name create_<tabela>`, commit, repita. O drizzle-kit não
  possui flag nativa para "gerar só uma tabela": o controle é por quando
  se adiciona ao schema entre gerações.
- O `--name` recebe slug em snake_case (`create_requests`, `add_due_at_to_queue`);
  o drizzle-kit usa-o como sufixo do arquivo (`<prefixo-timestamp>_<name>.sql`).
