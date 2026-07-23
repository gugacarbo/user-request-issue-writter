---
status: draft               # draft | accepted | implemented | deprecated
date: AAAA-MM-DD
builds-on: []               # ADRs que fundamentam. A spec CONSOME decisões, não as redefine.
implemented-by: []          # paths reais (código, migrations, functions) — preenchido no fechamento
# design-ref: <url-ou-path> # feature com UI: referência de design NÃO-normativa (ADR-0014).
#                             Código+snapshot ganham dela em divergência; revisar é humano.
---

<!-- id é DERIVADO do filename (docs/specs/NNNN-titulo-kebab.md → SPEC-NNNN);
     title é DERIVADO do H1 abaixo. -->

# <comportamento em uma frase — vira o title derivado>

> Convenções compartilhadas (envelope de erro, autorização, acesso a dados):
> `docs/context/CONVENTIONS.md`. Esta spec não as repete — só desvia delas
> explicitamente quando necessário.

## Objetivo
<!-- O que o usuário/sistema consegue fazer quando isto estiver implementado. -->

## Fluxo
<!-- Passo a passo do comportamento observável. -->

## Contrato
<!-- API/eventos/UI: entradas, saídas, formatos. O que é garantido. -->

## Casos de borda
<!-- Enumerados e DECIDIDOS. Formato sugerido: EARS, agnóstico de stack.
     Caso sem decisão NÃO fica aqui — vai para Questões em aberto.
     Feature com UI (ADR-0014): estados são casos de borda comuns —
     "QUANDO a lista está vazia, DEVE exibir empty-state com CTA";
     "QUANDO a viewport < 768px, a tabela DEVE colapsar em cards".
     Design system/tokens/estados obrigatórios NÃO se redefinem aqui:
     são ADR do repo, citado em builds-on. -->

| # | QUANDO ⟨gatilho⟩ | o sistema DEVE ⟨resposta⟩ |
|---|---|---|
| 1 |  |  |

## Questões em aberto
<!-- Cada item BLOQUEIA o ponto correspondente da implementação —
     o agente não improvisa sobre questão aberta. -->

- [ ] 

## Definition of Done
<!-- OBRIGATÓRIO antes de sair de draft. Comandos com critério binário,
     executáveis no ambiente do AGENTS.md.
     Fecha o loop DESTA spec (§7, ADR-0012): cada caso de borda enumerado acima
     precisa de linha aqui — ou teste referenciado — que o exercite; cite os
     números dos casos no comentário. DoD só com comandos genéricos do repo
     (subconjunto do DoD global do router) é sinal de spec sem fechamento próprio.
     Estados de UI: use comando REAL do repo que os exercite (teste de componente,
     regressão visual, a11y — se a toolchain existir). NUNCA copie comando de
     exemplo que o repo não tem: passa no docs-check e mente (ADR-0014). -->

```bash
npm run typecheck                 # exit 0
npm test -- --run <escopo>        # N/N verdes — casos <nºs da tabela acima>
```

## Revisão humana
<!-- O que exige olho humano e NÃO está no loop do agente. -->

- 

## Verificação
<!-- Preenchida no FECHAMENTO (transição para implemented, mesmo commit que
     preenche implemented-by): evidência do DoD — comandos rodados + resultado. -->

```text
(preencher no fechamento)
```

<!-- Checklist de fechamento (um commit):
     [ ] DoD verde, evidência acima
     [ ] status: implemented + implemented-by com paths reais
     [ ] gotchas novos → AGENTS.md
     [ ] estado atual novo → capítulo de contexto pertinente
     [ ] scripts/docs-check --emit-index (READMEs regenerados) -->
