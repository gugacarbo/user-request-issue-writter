# ADR-0005: Ler repo via GitHub API, nunca clonar

## Status
Accepted

## Context
Para entender o repositório e redigir a issue, o servidor precisa inspecionar
o código fonte. Há dois caminhos:

1. Clonar o repositório localmente (shallow clone) e ler o filesystem.
2. Ler via GitHub REST API (`git/trees`, `contents`, `repos`) usando o
   `GITHUB_TOKEN`.

O deployment é uma VPS leve e o servidor processa webhooks de repositórios
potencialmente privados (autenticados via PAT com escopo `repo`).

## Decision
**Nunca clonar** o repositório. Toda leitura é via GitHub REST API com o PAT.

- `github.getRepoTree` lista a árvore; `github.getFileContent` lê um arquivo
  (com truncamento de arquivos grandes antes de mandar ao LLM);
  `github.getRepoInfo` retorna descrição/linguagens/README.
- As tools só operam no `owner/repo` extraído do webhook — não há acesso a
  outros repos nem path traversal fora do contexto do próprio repo.

## Consequences
- **Positivo:** zero custo de disk/git no VPS (sem `.git`, sem working tree,
  sem `git` no container); imagem Docker pode omitir git.
- **Positivo:** funciona com repositórios privados usando apenas o PAT (sem
  SSH keys ou deploy keys adicionais).
- **Positivo:** leitura sob demanda (só os arquivos que o LLM pedir) reduz
  I/O vs. clonar tudo.
- **Negativo:** rate limits da GitHub API (5000 req/h autenticado). Para
  volume baixo de webhooks e poucas leituras por issue, é confortável; se
  crescer, precisa cache de árvore/conteúdo.
- **Negativo:** arquivos muito grandes custam uma request de API para depois
  serem truncados; mitigado com checagem de tamanho quando a API expuser
  (`size` no conteúdo do repo) antes de baixar.

## Alternatives considered
- **Shallow clone (`git clone --depth 1`):** leitura local rápida, mas exige
  `git` no container, disk temporário por requisição, e credenciais de clone
  (SSH/deploy key) além do PAT — infraestrutura e superfície maiores.
- **Download de tarball do repo:** um fetch só, mas baixa o repo inteiro
  mesmo que o LLM precise de poucos arquivos — desperdício de banda/disk.