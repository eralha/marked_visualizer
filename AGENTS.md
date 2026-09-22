# AGENTS.md — MD Graph (md-graph-viewer)

Guia para agentes de IA que trabalham neste repositório.

## O que é este projeto

Aplicação **Node.js + D3.js** (sem build step, sem framework) que lê um vault de
ficheiros Markdown, extrai `[[wikilinks]]` estilo Obsidian, segue-os por BFS e
desenha o grafo de relações no browser. UI em **português (PT-PT)** — manter
assim os textos novos.

## Como correr

```bash
npm install          # instala d3 + marked
npm start            # arranca em http://127.0.0.1:8000 (vault default: ./vault)

# env vars como parâmetros do script npm:
npm start -- VAULT_DIR="C:\caminho\para\vault" PORT=9000

# ou via batch (Windows):
start.bat                       # vault default ./vault
start.bat "C:\outro\vault"     # 1º argumento = VAULT_DIR
```

- `npm start` é um wrapper (`scripts/start.js`) que aceita pares `VAR=valor`
  após o `--` e injeta-os como env no processo do servidor. Sem argumentos,
  comporta-se exatamente como `node server.js`.
- O servidor copia automaticamente os bundles UMD de `node_modules` para
  `public/vendor/` no arranque (`scripts/copy-vendor.js`). Não editar nada em
  `public/vendor/` à mão — é gerado.

## Variáveis de ambiente

| Variável    | Default | Descrição                          |
|-------------|---------|------------------------------------|
| `VAULT_DIR` | `./vault` (relativo ao repo) | Diretório raiz do vault Markdown |
| `PORT`      | `8000`  | Porta HTTP                         |

## Arquitetura

### `server.js` (único ficheiro backend, CommonJS)

- **Índice do vault**: construído no arranque — walk recursivo de `.md`/`.markdown`,
  ignorando `node_modules` e pastas com ponto. Mapa `relPath → absPath` + índice
  case-insensitive. **Reconstruído automaticamente** pelo `fs.watch` recursivo
  quando o vault muda (live reload).
- **Resolução de wikilinks** (`resolveTarget`): normaliza `\`→`/`, remove `./` e `/`
  iniciais, acrescenta `.md` se faltar; depois: match exato → case-insensitive →
  *basename matching* contra todo o vault (regra do Obsidian). Ambiguidade: ganha
  a primeira no índice.
- **Extração** (`extractWikilinks`): regex `[[...]]` sobre o texto com code spans
  (`` ` ``) removidos — links em código não contam.
- **Grafo** (`buildGraph`): BFS a partir de `roots` (ou do vault inteiro), com
  `depth`. Links sem correspondência criam nós fantasma com id prefixado por
  `__missing__` e `missing: true` (desenhados a losango/rosa no frontend).
- **API HTTP** (sem router, `http.createServer` + if/else):
  - `GET /api/files` → `{ vault, files[] }`
  - `GET /api/graph?roots=a.md,b.md&depth=2` → `{ nodes[], edges[] }`
  - `GET /api/note?path=...` → `{ path, markdown }` (texto bruto)
  - resto → estáticos de `public/`

### `public/` (frontend vanilla, sem build)

- `index.html` — toolbar (root select, depth, layout), área do grafo, sidebar da nota.
- `app.js` — D3 force simulation: hover → tooltip + destaque da vizinhança fechada;
  clique no nó **ou** em wikilink do painel → `selectNode` (highlight das arestas)
  + pan/zoom até ao nó + abrir a nota. Drag fixa nós; layouts force/circle/grid.
- `style.css` — tema escuro + estilos do markdown renderizado.
- `vendor/` — **gerado**, não editar.

### Convenções de código

- JavaScript plain, CommonJS no server (`require`), scripts inline no browser
  (sem módulos). Não introduzir TypeScript, bundlers ou frameworks.
- UI e comentários novos em PT-PT; nomes de variáveis/funções em inglês.
- Sem dependências além de `d3` e `marked`.

## Gotchas

- **Não** editar `public/vendor/` (gerado no arranque) nem `node_modules/`.
- O watcher do vault reindexa em background; se editares `server.js` em
  desenvolvimento, reinicia o processo para ver mudanças.
- Porta 8000 ocupada → usar `PORT=...` (npm script, batch ou env).
- `__missing__` é um prefixo de id reservado — não criar nós com esse formato
  fora do crawler.
- O grafo é recalculado a cada pedido à API (intencional; vaults até milhares
  de notas respondem em ms).

## Estrutura

```
├── server.js               # servidor HTTP + crawler BFS + API
├── start.bat               # launcher Windows com VAULT_DIR/PORT
├── scripts/
│   ├── start.js            # wrapper npm start → env params → node server.js
│   └── copy-vendor.js      # node_modules → public/vendor (no arranque)
├── public/                 # frontend (index.html, app.js, style.css, vendor/)
└── vault/                  # vault de exemplo (o alvo real é VAULT_DIR)
```
