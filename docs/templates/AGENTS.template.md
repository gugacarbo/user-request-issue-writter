# AGENTS.md

```yaml
casa-repo-id: <nome-canonico-do-repo>   # usado em referências cross-repo (repo:ADR-0001)
casa-tier: T1                            # T0 (leve) | T1 (padrão) — STANDARD §3
casa-version: 1.8                        # versão do contrato CASA adotado (promessa do repo, ADR-0010)
casa-standard-ref: <sha>                 # versão do casa-standard de origem — o casa-init carimba
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

| Capítulo | Quando carregar |
|---|---|
| (nenhum ainda) | — |

## Mapa de docs
- Decisões: `docs/adr/` · Comportamento: `docs/specs/` (READMEs GERADOS — não editar)
- Validar: `scripts/docs-check` · Regenerar índices: `scripts/docs-check --emit-index`
