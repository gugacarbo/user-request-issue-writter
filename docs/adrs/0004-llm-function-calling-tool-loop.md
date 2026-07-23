# ADR-0004: Loop de function calling com `submit_issue` terminal

## Status
Accepted

## Context
A partir de um comentário de usuário, precisamos gerar uma issue bem
escrita. Isso requer **entender o repositório** antes de redigir (listar
arquivos, ler trechos relevantes, conhecer linguagens/README). O LLM
escolhido é OpenAI-compatible com suporte a *function calling* (`tools`).

Há duas famílias de abordagem:
1. Pedir ao LLM tudo em uma única chamada (sem acesso ao contexto do repo,
   só ao comentário) — resultado genérico e descontextualizado.
2. Dar ao LLM tools para inspecionar o repo sob demanda e deixá-lo decidir
   o que ler antes de submeter.

## Decision
Implementar um **tool loop** em `llm.ts`:

- Mensagem de sistema orienta o modelo a usar tools para entender o contexto
  antes de submeter.
- Tools de leitura: `list_files(path?)`, `read_file(path)`, `get_repo_info()`
  → dispatchers que chamam `github.ts` (operam só no `owner/repo` do webhook).
- `submit_issue(title, body, labels?)` é uma **tool terminal**: quando o
  modelo a chama, o loop para e retorna os argumentos estruturados; **não**
  executa a criação da issue — isso fica em `server.ts`, que chama
  `github.createIssue` com o `body` + rodapé de crédito.
- Limite de iterações (ex.: 15) por segurança; ao estourar, encerra com erro
  controlado (não cria issue).
- Resultados de tools são adicionados como mensagens `tool` na conversa.

## Consequences
- **Positivo:** o conteúdo da issue é fundamentado no código real do repo,
  não em suposições.
- **Positivo:** a mutação (criação da issue) fica fora do loop e fora do
  controle do modelo — o LLM só propõe argumentos; a aplicação executa com
  auditoria e pode aplicar o fallback de labels (422).
- **Positivo:** `submit_issue` terminal dá um ponto de parada determinístico,
  evitando loops infinitos.
- **Negativo:** custo de tokens e latência variáveis por requisição (o
  modelo decide quantas tools chamar). Mitigado pelo cap de iterações e
  truncamento de arquivos grandes.
- **Negativo:** depende de o provedor LLM suportar function calling
  corretamente (compatibilidade OpenAI). Limite aceitável do escopo.

## Alternatives considered
- **Prompt único sem tools:** simples e barato, mas gera issues
  descontextualizadas — contrária ao objetivo de qualidade.
- **Pré-busca determinística (RAG estático):** indexar o repo inteiro antes.
  Custo alto e variabilidade grande de tamanho de repo; o tool loop lê só o
  que o modelo julga necessário, sob demanda.
- **Orquestração externa (LangChain/agentes):** adiciona dependências e
  abstrações pesadas; o loop manual é pequeno e mantém o contrato de
  "sem SDKs" (ver ADR-0002).