'use strict';
/**
 * md-graph-viewer — Node server that crawls a markdown vault for Obsidian-style
 * [[wikilinks]] and serves the resulting graph to a Cytoscape.js frontend.
 *
 * Endpoints:
 *   GET /            -> public/index.html
 *   GET /api/files  -> flat list of every .md file in the vault
 *   GET /api/graph -> { nodes, edges } (BFS over wikilinks; ?roots=a.md,b.md&depth=2)
 *   GET /api/note?path=... -> raw text of one vault note
 */

const fs = require('fs');
const fsp = fs.promises;
const http = require('http');
const path = require('path');
const { URL } = require('url');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROOT = __dirname;
const VAULT_DIR = process.env.VAULT_DIR
  ? path.resolve(process.env.VAULT_DIR)
  : path.join(ROOT, 'vault');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8000);

// ---------------------------------------------------------------------------
// Vault index — built once at startup (rebuild with `node server.js --reindex`)
// ---------------------------------------------------------------------------

/** @type {Map<string, string>} normalized relative path -> absolute path */
let fileIndex = new Map();
const lowerIndex = new Map(); // lowercase key -> canonical key (case-insensitive lookup)

function isMarkdownFile(name) {
  return /\.(md|markdown)$/.test(name.toLowerCase());
}

async function buildIndex() {
  const found = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      console.warn(`[index] cannot read ${dir}: ${err.message}`);
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
        await walk(full);
      } else if (isMarkdownFile(ent.name)) {
        found.push(full);
      }
    }
  }
  await walk(VAULT_DIR);

  const index = new Map();
  for (const abs of found) {
    const rel = path.relative(VAULT_DIR, abs).split(path.sep).join('/');
    index.set(rel, abs);
  }
  fileIndex = index;
  lowerIndex.clear();
  for (const key of index.keys()) lowerIndex.set(key.toLowerCase(), key);
  console.log(`[index] vault ready: ${fileIndex.size} markdown files in ${VAULT_DIR}`);
}

/** Resolve a wikilink target to a canonical relative path, or null. */
function resolveTarget(raw) {
  let t = raw.trim().split('#')[0].split('|')[0].trim();
  if (!t) return null;
  t = t.replace(/\\/g, '/');
  while (t.startsWith('./')) t = t.slice(2);
  while (t.startsWith('/')) t = t.slice(1);
  if (!/\.(md|markdown)$/i.test(t)) t += '.md';

  const direct = fileIndex.get(t) ? t : null;
  if (direct) return direct;
  if (lowerIndex.has(t.toLowerCase())) return lowerIndex.get(t.toLowerCase());

  // Obsidian resolves bare names against the whole vault.
  const base = path.posix.basename(t).toLowerCase();
  for (const [key, canon] of lowerIndex) {
    if (path.posix.basename(canon) === base) return canon;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Wikilink extraction
// ---------------------------------------------------------------------------

/** Matches [[target]], [[target|alias]], [[target#heading]] — not inside code spans. */
const WIKILINK_RE = /\[\[([^\[\]\n]+?)\]\]/g;
const CODE_SPAN_RE = /`[^`\n]*`/g;

/** Extract wikilink targets from markdown text (code spans ignored). */
function extractWikilinks(text) {
  const noCode = text.replace(CODE_SPAN_RE, '');
  const out = [];
  let m;
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(noCode)) !== null) {
    const target = m[1].trim();
    if (target) out.push(target);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Graph construction (BFS over wikilinks, "abre o ficheiro referido, repete")
// ---------------------------------------------------------------------------

async function buildGraph({ roots = null, depth = Infinity } = {}) {
  const nodes = new Map(); // rel path -> node object
  const edgeSet = new Set(); // "src\ttarget"
  const edges = [];

  const textCache = new Map(); // rel path -> raw markdown

  async function readText(rel) {
    if (!textCache.has(rel)) {
      const abs = fileIndex.get(rel);
      let text = '';
      if (abs) {
        try {
          text = await fsp.readFile(abs, 'utf8');
        } catch (err) {
          console.warn(`[graph] cannot read ${rel}: ${err.message}`);
        }
      }
      textCache.set(rel, text);
    }
    return textCache.get(rel);
  }

  async function ensureNode(rel) {
    if (!nodes.has(rel)) {
      const text = await readText(rel);
      nodes.set(rel, {
        id: rel,
        name: path.posix.basename(rel).replace(/\.(md|markdown)$/i, ''),
        path: rel,
        folder: path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel),
        size: Buffer.byteLength(text || '', 'utf8'),
        links: 0,
        missing: false
      });
    }
    return nodes.get(rel);
  }

  // BFS queue seeded with roots (or the whole vault).
  const queue = [];
  const queued = new Set();
  if (roots && roots.length) {
    for (const r of roots) {
      const rel = resolveTarget(r);
      if (rel && !queued.has(rel)) { queued.add(rel); queue.push({ rel, d: 0 }); }
    }
  } else {
    for (const rel of fileIndex.keys()) { queued.add(rel); queue.push({ rel, d: 0 }); }
  }

  while (queue.length) {
    const { rel, d } = queue.shift();
    await ensureNode(rel);
    if (d <= depth) {
      const text = await readText(rel);
      const targets = extractWikilinks(text);
      const node = nodes.get(rel);
      for (const raw of targets) {
        node.links++;
        const resolved = resolveTarget(raw);
        if (resolved === null) {
          // Dangling link: create a "missing" node so it shows in the graph.
          const missId = '__missing__' + raw.replace(/\//g, '_');
          if (!nodes.has(missId)) {
            nodes.set(missId, {
              id: missId, name: raw.split('#')[0], path: null,
              folder: '', size: 0, links: 0, missing: true
            });
          }
          const key = rel + '\t' + missId;
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            edges.push({ data: { source: rel, target: missId, alias: (raw.split('|')[1] || '').trim(), heading: raw.includes('#') ? raw.split('#')[1].split('|')[0] : null } });
          }
        } else if (resolved !== rel) {
          const key = rel + '\t' + resolved;
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            edges.push({ data: { source: rel, target: resolved, alias: (raw.split('|')[1] || '').trim(), heading: raw.includes('#') ? raw.split('#')[1].split('|')[0] : null } });
          }
          if (!queued.has(resolved)) { queued.add(resolved); queue.push({ rel: resolved, d: d + 1 }); }
        }
      }
    }
  }

  return { nodes: [...nodes.values()], edges };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

async function serveStatic(req, res, urlPath) {
  let p = decodeURIComponent(urlPath);
  if (p === '/') p = '/index.html';
  const full = path.normalize(path.join(PUBLIC_DIR, p));
  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }
  try {
    const st = await fsp.stat(full);
    if (st.isFile()) {
      const ext = path.extname(full).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      return res.end(await fsp.readFile(full));
    }
  } catch (_) { /* fall through to 404 */ }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

// ---------------------------------------------------------------------------
// Request router
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = u.pathname;

  try {
    if (p === '/api/files') {
      return sendJson(res, 200, { vault: VAULT_DIR, files: [...fileIndex.keys()].sort() });
    }

    if (p === '/api/graph') {
      const rootsParam = u.searchParams.get('roots');
      const depth = Number(u.searchParams.get('depth') || Infinity);
      const roots = rootsParam ? rootsParam.split(',').map(s => s.trim()).filter(Boolean) : null;
      const graph = await buildGraph({ roots, depth });
      return sendJson(res, 200, { vault: VAULT_DIR, ...graph });
    }

    if (p === '/api/note') {
      const rel = u.searchParams.get('path');
      if (!rel) return sendJson(res, 400, { error: 'missing ?path=' });
      const canonical = resolveTarget(rel);
      if (!canonical) return sendJson(res, 404, { error: 'note not found', path: rel });
      const text = await fsp.readFile(fileIndex.get(canonical), 'utf8');
      return sendJson(res, 200, { path: canonical, markdown: text });
    }

    if (p.startsWith('/api/')) {
      return sendJson(res, 404, { error: 'unknown api endpoint' });
    }

    return await serveStatic(req, res, p);
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

(async () => {
  // vendor bundles once so the browser never needs node_modules
  require('./scripts/copy-vendor.js');

  if (!fs.existsSync(VAULT_DIR)) {
    console.error(`Vault directory not found: ${VAULT_DIR}`);
    process.exit(1);
  }

  await buildIndex();

  server.listen(PORT, () => {
    console.log(`md-graph-viewer running at http://127.0.0.1:${PORT}`);
    console.log(`  vault : ${VAULT_DIR}`);
    console.log(`  files : ${fileIndex.size}`);
  });

  // Live reload: watch the vault, rebuild the index when notes change.
  try {
    fs.watch(VAULT_DIR, { recursive: true }, () => { buildIndex(); });
    console.log('[watch] vault is being watched — edits reindex automatically');
  } catch (e) {
    console.warn('[watch] recursive watch unavailable:', e.message);
  }
})().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
