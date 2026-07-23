# ADR-0001: Fastify como web framework

## Status
Accepted

## Context
O servidor recebe webhooks do GitHub em uma única rota (`POST /webhook/github`),
valida assinatura HMAC e orquestra chamadas a um LLM. Precisamos de um
framework HTTP que:

- Adicione pouca sobrecarga de dependências (imagem Docker enxuta para VPS).
- Forneça logging estruturado pronto (para observabilidade do fluxo de webhook
  → LLM → issue).
- Suporte leitura do raw body sem buffering manual para validação HMAC.
- Seja estável e mantido no ecossistema Node.js LTS.

## Decision
Adotar **Fastify** como única dependência de runtime.

- Logging via `fastify.log` (pino embutido), sem um `logger.ts` de pino
  separado a menos que necessário fora do request.
- Raw body obtido via hook `preParsing`/content-type para verificação HMAC.
- Registro das rotas com tipagem de schema (Fastify valida entrada).

## Consequences
- **Positivo:** uma única dep de runtime; logging estruturado sem configuração
  extra; performance alta; raw body acessível para HMAC.
- **Positivo:** Fastify é compatível com Node.js 20+ (fetch/crypto nativos).
- **Negativo:** acoplamento ao ecossistema Fastify (plugins, hooks) — se
  migrarmos de framework, rota e middleware precisarão adaptação.
- **Neutral:** argon de memória não é relevante para volume baixo.

## Alternatives considered
- **Express + pino:** mais maduro, porém exige `express.raw()` ou
  configuração extra de body parser para preservar o raw body; logging
  estruturado exigiria `pino-http` separado (mais uma dep).
- **Hono:** excelente footprint e compatível com Web standards, porém
  ecossistema menor para o padrão de hooks/preParsing que simplificam o
  acesso ao raw body e a injeção de dependências de teste.
- **Node `http` nativo (sem framework):** zero dependências, mas exige
  reimplementar roteamento, parsing e logging — custo de manutenção alto
  para benefício pequeno dado o volume baixo.
