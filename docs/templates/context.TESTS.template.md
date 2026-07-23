<!-- Capítulo de contexto RECONHECIDO pelo CASA (STANDARD §4/§8).
     Copie para docs/context/TESTS.md e aponte no Mapa de contexto do AGENTS.md:
       | `docs/context/TESTS.md` | ao alterar teste, DoD, bugfix ou comportamento crítico |
     Conteúdo IMPERATIVO e ATEMPORAL ("rode X", "NUNCA Y", "o estado atual é Z").
     Quando este capítulo é DECLARADO no router, o docs-check exige ao menos UM comando
     canônico em bloco de código — liste o comando real do repo, não prosa. Convenção de
     teste compartilhada APONTA para ADR/Spec quando existir; não copia o corpo (§4). -->

# Testes

## Comandos canônicos
<!-- O(s) comando(s) que rodam a suíte. É o que o docs-check exige existir. -->

```bash
npm test                 # substitua pelo comando real do repo (pytest -q, deno test, …)
```

## Tipos de teste usados neste repo
<!-- Quais existem (unit/integração/e2e) e o que cada um cobre. Omita o que não usa. -->

## Onde criar teste novo
<!-- Diretório e convenção de nome por tipo (ex.: `tests/unit/<modulo>.test.ts`). -->

## Como testar bugfix
<!-- Regra: bug reproduzido vira teste de regressão ANTES do fix. Onde/como. -->

## O que conta como regressão
<!-- Quando um teste novo é obrigatório vs. opcional. -->

## O que NÃO testar
<!-- Fronteiras: o que é caro/frágil demais e fica fora de propósito. -->
