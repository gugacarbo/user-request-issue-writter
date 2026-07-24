---
status: accepted
date: 2026-07-24
builds-on: []
superseded-by: null
deciders: ["gustavo_carbonera"]
---

# ADR-0002: `fetch` direto para GitHub; SDK `openai` para LLM

> ⚠️ VERDADE ATUAL: revisão 1 deste ADR usava `fetch` direto para ambos; a
> decisão atual usa `fetch` para GitHub e SDK `openai` para LLM.

## Contexto e problema
O servidor precisa (1) ler arquivos e metadados de repositórios via GitHub
REST API e (2) chamar um LLM OpenAI-compatible com function calling.

A revisão original (raw `fetch` para ambos) funcionou, mas o parsing manual
do `/chat/completions` — especially tool_calls com `id`, `type`, `function.arguments`
como JSON string — é propenso a erros e difícil de manter alinhado com a
evolução da API. O SDK `openai` (v6) é estável, leve (zero deps transitivas
pesadas), e funciona com qualquer endpoint OpenAI-compatible via `baseURL`.

As chamadas GitHub REST permanecem poucas e bem definidas (listar árvore,
ler arquivo, info do repo, criar issue), e o `fetch` nativo é suficiente.

## Direcionadores da decisão
- **Manutenibilidade:** parsing manual de tool_calls é frágil e repetitivo.
- **Portabilidade de provider:** trocar de LLM sem mudar código.
- **Minimalismo:** GitHub usa poucos endpoints; SDK seria acoplamento
  desproporcional.
- **Estabilidade:** SDK `openai` (v6) mantido pela OpenAI.

## Opções consideradas

### Opção 1 — `fetch` para GitHub + SDK `openai` para LLM (escolhida)
**Prós:**
- Tipos e serialização do LLM delegados ao SDK; menos código manual e menor
  risco de drift com a API.
- `baseURL` permite trocar de provider (DeepSeek, Groq, Together, local)
  sem mudar código.
- GitHub continua sem SDK — `fetch` é suficiente para 4 endpoints e mantém
  o controle do fallback de labels (422).
**Contras:**
- `openai` adiciona uma dependência de runtime (~1 pacote).
- O adapter em `openai.ts` precisa converter mensagens entre os formatos
  interno e do SDK (tool_call_id matching).

### Opção 2 — `fetch` direto para ambos (revisão original)
**Prós:** uma única abordagem, sem SDK.
**Contras:** parsing manual de tool_calls é frágil e repetitivo.

### Opção 3 — Vercel AI SDK (`ai`)
**Prós:** provider-agnostic e flexível.
**Contras:** adiciona múltiplas packages e abstração desnecessária para um
único provider OpenAI-compatible.

### Opção 4 — `@octokit/rest` para GitHub
**Prós:** menos boilerplate.
**Contras:** o projeto precisa de apenas 4 endpoints; não justifica o
acoplamento.

## Decisão
- **GitHub:** usar **`fetch` nativo** (sem `@octokit/rest`). `github.ts`
  implementa clientes REST tipados sobre `fetch`.
- **LLM:** usar o **SDK `openai`** (v6+) em `openai.ts`. O SDK gerencia
  autenticação, serialização de tool calls, e tipagem das responses.
- `llm.ts` mantém a interface `LlmClient` independente do SDK; `openai.ts`
  é o adapter que converte entre os tipos internos (`ChatMessage`,
  `ToolCall`) e os tipos do SDK (`ChatCompletionMessageParam`, etc.).
- O adapter gera `id`s determinísticos (`call_0`, `call_1`, …) para
  correlacionar assistant tool_calls com tool messages, já que o loop
  interno em `llm.ts` não propaga o `id` original da API.

## Consequências
- **Positivo:** tipos e serialização do LLM delegados ao SDK; menos código
  manual e menos risco de drift com a API.
- **Positivo:** `baseURL` permite trocar de provider (DeepSeek, Groq,
  Together, local) sem mudar código.
- **Positivo:** GitHub continua sem SDK — `fetch` é suficiente para 4
  endpoints e mantém o controle do fallback de labels (422).
- **Negativo:** `openai` adiciona uma dependência de runtime (~1 pacote);
  mitigado pelo fato de ser mantido pela OpenAI com releases frequentes.
- **Negativo:** o adapter em `openai.ts` precisa converter mensagens entre
  os formatos interno e do SDK (tool_call_id matching).

## Confirmação
```bash
grep -q '"openai"' package.json && echo "ok: openai SDK presente"
grep -q '@octokit' package.json && echo "FALHA: octokit presente" || echo "ok: sem octokit"
grep -rn "fetch(" src/github.ts
```

## Notas
- Revisão 1 deste ADR usava `fetch` para ambos; a mudança para o SDK
  `openai` no LLM motivou a revisão (sem novo ADR porque a decisão anterior
  não tinha sido formalmente aceita no template).
