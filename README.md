# 🕸️ MD Graph — Obsidian Graph View em web + Node

Aplicação **Node.js + Cytoscape.js** que lê um vault de ficheiros Markdown, extrai os links internos estilo Obsidian (`[[wikilinks]]`), segue-os em profundidade (BFS) e desenha o grafo de relações no browser — sem plugins do Obsidian, sem build step.

```
lê um .md → encontra [[links]] → abre o ficheiro referido → repete → grafo (nodes + edges) → browser
```

## Funcionalidades

- **Crawler BFS** de `[[wikilinks]]` por todo o vault (com proteção contra ciclos)
- Resolução de nomes como no Obsidian: `[[nota]]`, `[[pasta/nota]]`, `[[nota#secção]]`, `[[nota|alias]]` — case-insensitive, extensão `.md` opcional
- **Links em falta** (dangling links) aparecem como nós losango/rosa no grafo
- Grafo interativo com **Cytoscape.js**: force-directed, hover destaca a vizinhança, zoom/pan
- Clique num nó → **painel lateral** com a nota renderizada (via `marked`), com os wikilinks clicáveis
- Dropdown para **re-crawlear a partir de um ficheiro raiz** + limite de profundidade
- Troca de layout: force / grid / circle
- **Live reload**: o watcher do vault reindexa automaticamente quando editas notas

## Requisitos

- Node.js ≥ 18 (testado com v24)
- npm

## Instalação e arranque

```bash
npm install
npm start
```

Abre **http://127.0.0.1:8000** no browser.

> O `npm start` copia automaticamente os bundles UMD do Cytoscape e do Marked para `public/vendor/` — o browser não precisa de `node_modules`.

### Configuração (variáveis de ambiente)

| Variável | Default | Descrição |
|---|---|---|
| `PORT` | `8000` | Porta HTTP do servidor |
| `VAULT_DIR` | `./vault` | Diretório raiz do vault Markdown |

```bash
# exemplo: apontar para outro vault noutra porta
PORT=9000 VAULT_DIR=C:\caminho\para\vault npm start
```

## API

| Endpoint | Descrição |
|---|---|
| `GET /` | Página do grafo (frontend) |
| `GET /api/files` | Lista de todos os `.md` do vault |
| `GET /api/graph` | Grafo completo `{ nodes, edges }` |
| `GET /api/graph?roots=index.md&depth=2` | Crawler a partir de um ou mais ficheiros raiz (separados por vírgula), com limite de profundidade |
| `GET /api/note?path=autenticacao.md` | Conteúdo Markdown bruto de uma nota |

### Formato do grafo

```json
{
  "nodes": [
    { "id": "index.md", "name": "index", "path": "index.md", "folder": "", "size": 787, "links": 6, "missing": false }
  ],
  "edges": [
    { "data": { "source": "index.md", "target": "autenticacao.md", "alias": "", "heading": null } }
  ]
}
```

- `missing: true` → o wikilink não corresponde a nenhum ficheiro do vault (nó fantasma, desenhado a losango)
- `links` → número de saídas da nota; determina o raio do nó no grafo

## Estrutura do projeto

```
obsidian/
├── server.js               # servidor HTTP + crawler BFS + API
├── package.json
├── scripts/
│   └── copy-vendor.js      # copia dists UMD → public/vendor (roda no npm start)
├── public/
│   ├── index.html          # UI: toolbar, área do grafo, painel da nota
│   ├── style.css           # tema escuro + estilos markdown
│   ├── app.js              # Cytoscape, fetch da API, preview de notas
│   └── vendor/             # cytoscape.min.js, marked.min.js (gerados)
└── vault/                  # ← o teu vault Markdown (exemplo incluído)
    ├── index.md
    ├── autenticacao.md
    ├── banco-de-dados.md
    ├── api-rest.md
    ├── deploy.md
    └── notas/arquitetura.md
```

## Formatos de wikilink suportados

| Sintaxe | Suportado |
|---|---|
| `[[nota]]` | ✅ |
| `[[pasta/nota]]` | ✅ |
| `[[nota#secção]]` | ✅ (o heading é guardado na aresta) |
| `[[nota\|alias]]` | ✅ (o alias aparece no rótulo da aresta) |
| `` `[[código]]` `` em code span | ignorado (não conta como link) |

## Notas e limitações

- **Porta 8000** — se já estiver ocupada, muda com `PORT=... npm start`.
- O watcher (`fs.watch` recursivo) reindexa o vault em alterações; os nós de "falta" desaparecem quando crias o ficheiro correspondente e atualizas.
- O grafo é recalculado a cada pedido à API (vaults até a milhares de notas respondem em milissegundos).
- A resolução de nomes curtos faz *basename matching* contra todo o vault — se houver duas notas com o mesmo nome em pastas diferentes, ganha a primeira encontrada no índice.

## Ideias para evoluir

- Filtros por pasta/tag (frontmatter) e busca de nós
- Exportação do grafo em PNG/SVG
- Modos dark/light e temas por pasta
- Suporte a `![[embed]]` como aresta de tipo distinto
