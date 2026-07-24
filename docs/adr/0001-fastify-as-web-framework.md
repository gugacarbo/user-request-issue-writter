---
status: accepted
date: 2026-07-24
builds-on: []
superseded-by: null
deciders: ["gustavo_carbonera"]
---

# ADR-0001: Fastify como web framework

## Contexto e problema
O servidor recebe webhooks do GitHub em uma única rota (`POST /webhook/github`),
valida assinatura HMAC e orquestra chamadas a um LLM. Precisamos de um
framework HTTP que:

- Adicione pouca sobrecarga de dependências (imagem Docker enxuta para VPS).
- Forneça logging estruturado pronto (para observabilidade do fluxo de webhook
  → LLM → issue).
- Suporte leitura do raw body sem buffering manual para validação HMAC.
- Seja estável e mantido no ecossistema Node.js LTS.

## Direcionadores da decisão
- **Footprint mínimo:** imagem Docker enxuta para VPS leve.
- **Observabilidade:** logging estruturado pronto para o fluxo webhook → LLM → issue.
- **HMAC:** acesso ao raw body sem buffering manual.
- **Estabilidade:** framework mantido no ecossistema Node.js LTS.

## Opções consideradas

### Opção 1 — Fastify
**Prós:**
- Logging estruturado embutido (pino); raw body via hook `preParsing`/content-type;
  validação de schema de rota; performance alta; compatível com Node.js 20+.
**Contras:**
- Acoplamento ao ecossistema Fastify (plugins, hooks); migração de framework
  exigiria adaptação de rota e middleware.

### Opção 2 — Express + pino
**Prós:** framework mais maduro.
**Contras:** exige `express.raw()` ou configuração extra de body parser para
preservar o raw body; logging estruturado exigiria `pino-http` separado (mais
uma dep).

### Opção 3 — Hono
**Prós:** excelente footprint e compatível com Web standards.
**Contras:** ecossistema menor para o padrão de hooks/preParsing que
simplificam o acesso ao raw body e a injeção de dependências de teste.

### Opção 4 — Node `http` nativo (sem framework)
**Prós:** zero dependências.
**Contras:** exige reimplementar roteamento, parsing e logging — custo de
manutenção alto para benefício pequeno dado o volume baixo.

## Decisão
Adotar **Fastify** como única dependência de runtime.

- Logging via `fastify.log` (pino embutido), sem um `logger.ts` de pino
  separado a menos que necessário fora do request.
- Raw body obtido via hook `preParsing`/content-type para verificação HMAC.
- Registro das rotas com tipagem de schema (Fastify valida entrada).

## Consequências
- **Positivo:** uma única dep de runtime; logging estruturado sem configuração
  extra; performance alta; raw body acessível para HMAC.
- **Positivo:** Fastify é compatível com Node.js 20+ (fetch/crypto nativos).
- **Negativo:** acoplamento ao ecossistema Fastify (plugins, hooks) — se
  migrarmos de framework, rota e middleware precisarão adaptação.
- **Neutro:** uso de memória não é relevante para volume baixo.

## Confirmação
```bash
grep -q '"fastify"' package.json && echo "ok: fastify presente"
grep -rn "fastify" src/server.ts
```

## Notas
- Fastify cobre logging, roteamento e acesso ao raw body sem dependências
  adicionais; substitui SQLite/Redis/etc. só quando o volume justificar.
