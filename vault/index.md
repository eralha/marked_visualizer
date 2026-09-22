# Índice do Vault

Bem-vindo ao vault de exemplo. Esta nota é a porta de entrada do grafo.

## Notas principais

- [[autenticacao]] — como funciona o login
- [[banco-de-dados]] — esquema e migrações
- [[api-rest]] — endpoints públicos
- [[deploy]] — pipeline de produção
- [[notas/arquitetura]] — visão global (subpasta)

## Como usar esta app

1. O Node lê cada `.md` do vault
2. Extrai os `[[wikilinks]]` (ignorando blocos de código)
3. Abre o ficheiro referido e repete até não haver novos links
4. Devolve `{ nodes, edges }` ao browser via `GET /api/graph`
5. O Cytoscape.js desenha o grafo

> Dica: clica num nó para veres a nota renderizada no painel lateral.
> Links em falta aparecem como losangos rosas — por exemplo [[roadmap-2026]] ainda não existe.
