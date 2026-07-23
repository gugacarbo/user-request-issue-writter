---
status: proposed            # proposed | accepted | deprecated | superseded
date: AAAA-MM-DD
builds-on: []               # ADRs relacionados: ADR-NNNN ou repo:ADR-NNNN
superseded-by: null         # escalar; preenchido no ADR antigo no commit que aceita o novo
deciders: []
---

<!-- id é DERIVADO do filename (docs/adr/NNNN-titulo-kebab.md → ADR-NNNN);
     title é DERIVADO do H1 abaixo. Não existem no frontmatter de propósito.

     ⚠️ Bloco VERDADE ATUAL — obrigatório quando este ADR for superado.
     Única edição substantiva permitida em ADR aceito. Máximo 3 linhas:

> ⚠️ VERDADE ATUAL: <o que ainda vale; o que foi revogado; ADR fonte atual>
-->

# <título da decisão, voz ativa — vira o title derivado>

## Contexto e problema
<!-- Que situação força uma decisão? Por que agora?
     ⚠️ DECISÃO ≠ ESTADO ATUAL: este doc registra a decisão datada.
     O estado atual decorrente vive em docs/context/ e aponta para cá. -->

## Direcionadores da decisão
<!-- Forças em jogo: requisitos, restrições, custo, prazo, risco. -->

## Opções consideradas

### Opção 1 — <nome>
**Prós:**
**Contras:**

### Opção 2 — <nome>
**Prós:**
**Contras:**

## Decisão
<!-- A escolha em uma frase + justificativa em um parágrafo.
     Backend integrável? Posicione no eixo comum: acoplamento da escrita ×
     tratamento de falha parcial (síncrono+compensação vs. assíncrono+reconciler). -->

## Consequências
<!-- Positivas, negativas, e o que passa a ser proibido/obrigatório. -->

## Confirmação
<!-- Como verificar que a decisão está sendo respeitada NA PRÁTICA:
     comando, query, inspeção. É o loop do agente para esta decisão. -->

```bash
# ex.: grep -r "supabase functions deploy" scripts/ && exit 1   # ninguém burla o sbx
```

## Notas
<!-- ⚠️ Não inventar: decisão de negócio não tomada → issue tracker, não ADR.
     Critério mecânico: em ADR já aceito só frontmatter e o bloco VERDADE ATUAL
     mudam (lint de imutabilidade, STANDARD §8). Qualquer mudança de corpo —
     inclusive typo/link → ADR novo que supersede. -->
