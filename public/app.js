'use strict';
/* MD Graph — frontend logic: fetch graph JSON, render with D3.js (force layout,
   zoom/pan/drag, hover tooltip + neighborhood highlight, click → impact set), note preview. */

const $ = (sel) => document.querySelector(sel);

let allFiles = [];
let nodes = [];            // d3 node objects {id,name,r,missing,x,y}
let links = [];            // d3 link objects {source,target,alias,miss}
let sim = null;
let svg = null, gZoom = null, gLinks = null, gNodes = null;
let zoomBehavior = null;
let nodeSel = null, edgeSel = null;
let layoutMode = 'force';
let selectedId = null;
let hoveredId = null;
let neighbors = new Map();    // id -> Set of adjacent ids (both directions)
let linksBySource = new Map();// id -> [link]
let outCount = new Map(), inCount = new Map();

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function api(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
}

function buildGraphUrl() {
  const root = $('#root-select').value;
  const depth = Math.max(0, Number($('#depth-input').value || 100));
  const q = new URLSearchParams({ depth: String(depth) });
  if (root) q.set('roots', root);
  return '/api/graph?' + q.toString();
}

// ---------------------------------------------------------------------------
// D3 scaffolding
// ---------------------------------------------------------------------------

function wrapEl() { return $('#graph-wrap'); }
function wrapW() { return wrapEl().clientWidth || 800; }
function wrapH() { return wrapEl().clientHeight || 600; }
const idOf = (v) => (typeof v === 'string' ? v : v.id);

function makeSvg() {
  svg = d3.select(wrapEl()).append('svg').attr('id', 'graph');

  const defs = svg.append('defs');
  for (const [id, color] of [['arrow', '#55557a'], ['arrow-miss', 'rgba(243,139,168,.6)']]) {
    defs.append('marker')
      .attr('id', id).attr('viewBox', '0 -5 10 10')
      .attr('refX', 9).attr('refY', 0)
      .attr('markerWidth', 7).attr('markerHeight', 7)
      .attr('orient', 'auto')
      .append('path').attr('d', 'M0,-4L8,0L0,4').attr('fill', color);
  }

  gZoom = svg.append('g');
  gLinks = gZoom.append('g').attr('class', 'links');
  gNodes = gZoom.append('g').attr('class', 'nodes');

  zoomBehavior = d3.zoom()
    .scaleExtent([0.05, 6])
    .on('zoom', (ev) => gZoom.attr('transform', ev.transform));
  svg.call(zoomBehavior).on('dblclick.zoom', null);

  // background click clears the selection
  svg.on('click', (ev) => {
    if (ev.defaultPrevented || ev.target !== svg.node()) return;
    clearSelection();
  });

  sim = d3.forceSimulation().on('tick', ticked);

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (nodes.length) applyLayout(); }, 150);
  });
}

function dragBehavior() {
  return d3.drag()
    .on('start', function (ev, d) {
      if (!ev.active) sim.alphaTarget(0.25).restart();
      d.fx = d.x; d.fy = d.y;
    })
    .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
    .on('end', (ev) => { if (!ev.active) sim.alphaTarget(0); /* node stays pinned */ });
}

function linkEnds(d) {
  const sx = d.source.x, sy = d.source.y, tx = d.target.x, ty = d.target.y;
  let dx = tx - sx, dy = ty - sy;
  const dist = Math.hypot(dx, dy) || 1;
  dx /= dist; dy /= dist;
  const sr = d.source.r + 2;
  const tr = d.target.r + (d.miss ? 5 : 7); // leave room for the arrowhead
  return { x1: sx + dx * sr, y1: sy + dy * sr, x2: tx - dx * tr, y2: ty - dy * tr };
}

function ticked() {
  if (!nodeSel || !edgeSel) return;
  edgeSel.each(function (d) {
    const e = linkEnds(d);
    d3.select(this).select('line')
      .attr('x1', e.x1).attr('y1', e.y1).attr('x2', e.x2).attr('y2', e.y2);
    d3.select(this).select('text')
      .attr('x', (e.x1 + e.x2) / 2).attr('y', (e.y1 + e.y2) / 2 - 4);
  });
  nodeSel.attr('transform', (d) => `translate(${d.x},${d.y})`);
}

// ---------------------------------------------------------------------------
// Layouts (force / circle / grid) — all driven by the same simulation
// ---------------------------------------------------------------------------

function applyLayout(name) {
  if (name) layoutMode = name;
  $('#layout-btn').textContent = 'Layout: ' + layoutMode;
  const w = wrapW(), h = wrapH();

  sim.force('link', d3.forceLink(links).id((d) => d.id).distance(80).strength(0.5));
  sim.force('collide', d3.forceCollide().radius((d) => d.r + 8).iterations(2));

  if (layoutMode === 'force') {
    sim.force('charge', d3.forceManyBody().strength(-220).distanceMax(420));
    sim.force('x', d3.forceX(w / 2).strength(0.06));
    sim.force('y', d3.forceY(h / 2).strength(0.08));
  } else if (layoutMode === 'circle') {
    const n = nodes.length || 1;
    const R = Math.max(90, Math.sqrt(n) * 42);
    nodes.forEach((nd, i) => {
      const a = (2 * Math.PI * i) / n - Math.PI / 2;
      nd.tx = w / 2 + R * Math.cos(a);
      nd.ty = h / 2 + R * Math.sin(a);
    });
    sim.force('charge', d3.forceManyBody().strength(-80));
    sim.force('x', d3.forceX((d) => d.tx).strength(0.3));
    sim.force('y', d3.forceY((d) => d.ty).strength(0.3));
  } else { // grid
    const n = nodes.length || 1;
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
    const rows = Math.ceil(n / cols);
    const cw = w / cols, ch = h / rows;
    nodes.forEach((nd, i) => {
      nd.tx = ((i % cols) + 0.5) * cw;
      nd.ty = (Math.floor(i / cols) + 0.5) * ch;
    });
    sim.force('charge', d3.forceManyBody().strength(-40));
    sim.force('x', d3.forceX((d) => d.tx).strength(0.35));
    sim.force('y', d3.forceY((d) => d.ty).strength(0.35));
  }
  sim.alpha(0.9).restart();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderGraph(graph) {
  const w = wrapW(), h = wrapH();
  const prev = new Map(nodes.map((n) => [n.id, n]));

  nodes = graph.nodes.map((n) => ({
    id: n.id,
    name: n.name,
    missing: !!n.missing,
    r: Math.max(6, Math.min(23, 4 + Math.sqrt(n.links * 3))),
    x: prev.get(n.id)?.x ?? w / 2 + (Math.random() - 0.5) * w * 0.7,
    y: prev.get(n.id)?.y ?? h / 2 + (Math.random() - 0.5) * h * 0.7
  }));

  links = graph.edges.map((e) => ({
    source: e.data.source,
    target: e.data.target,
    alias: e.data.alias || '',
    miss: e.data.source.startsWith('__missing__') || e.data.target.startsWith('__missing__')
  }));

  // adjacency (computed while source/target are still plain ids)
  neighbors = new Map(); linksBySource = new Map(); outCount = new Map(); inCount = new Map();
  for (const l of links) {
    const s = idOf(l.source), t = idOf(l.target);
    if (!neighbors.has(s)) neighbors.set(s, new Set());
    if (!neighbors.has(t)) neighbors.set(t, new Set());
    neighbors.get(s).add(t);
    neighbors.get(t).add(s);
    if (!linksBySource.has(s)) linksBySource.set(s, []);
    linksBySource.get(s).push(l);
    outCount.set(s, (outCount.get(s) || 0) + 1);
    inCount.set(t, (inCount.get(t) || 0) + 1);
  }

  // --- edges ---
  edgeSel = gLinks.selectAll('g.edge').data(links, (_d, i) => 'e' + i);
  edgeSel.exit().remove();
  const edgeEnter = edgeSel.enter().append('g')
    .attr('class', (d) => 'edge' + (d.miss ? ' missing' : ''));
  edgeEnter.append('line').attr('marker-end', (d) => d.miss ? 'url(#arrow-miss)' : 'url(#arrow)');
  edgeEnter.filter((d) => d.alias).append('text').text((d) => d.alias);
  edgeSel = edgeEnter.merge(edgeSel);

  // --- nodes ---
  nodeSel = gNodes.selectAll('g.node').data(nodes, (d) => d.id);
  nodeSel.exit().remove();
  const nodeEnter = nodeSel.enter().append('g')
    .attr('class', (d) => 'node' + (d.missing ? ' missing' : ''));
  nodeEnter.each(function (d) {
    const g = d3.select(this);
    if (d.missing) {
      const s = d.r * 1.6 + 2; // rotated square ≈ same visual size as the circles
      g.append('rect').attr('x', -s / 2).attr('y', -s / 2)
        .attr('width', s).attr('height', s)
        .attr('transform', 'rotate(45)').attr('fill', '#f38ba8');
    } else {
      g.append('circle').attr('r', d.r).attr('fill', '#9ece6a');
    }
    g.append('text').attr('y', d.r + 13).text(d.name);
  });
  nodeSel = nodeEnter.merge(nodeSel);

  nodeSel
    .call(dragBehavior())
    .on('click', (ev, d) => {
      if (ev.defaultPrevented) return;
      ev.stopPropagation();
      selectNode(d);
    })
    .on('mouseover', (ev, d) => { hoveredId = d.id; showTooltip(ev, d); refreshStyles(); })
    .on('mousemove', (ev) => moveTooltip(ev))
    .on('mouseout', () => { hoveredId = null; hideTooltip(); refreshStyles(); });

  sim.nodes(nodes);
  applyLayout(layoutMode);
  ticked();
  fitView(300);

  const missing = graph.nodes.filter((n) => n.missing).length;
  $('#stats').textContent =
    `${graph.nodes.length - missing} notas · ${missing} em falta · ${graph.edges.length} ligações`;
}

// ---------------------------------------------------------------------------
// Highlighting: hover → closed neighborhood, click → impact set (downstream BFS)
// ---------------------------------------------------------------------------

function closedNeighborhood(id) {
  const set = new Set([id]);
  for (const n of neighbors.get(id) || []) set.add(n);
  return set;
}

function refreshStyles() {
  // hover takes the foreground; the selection is the resting state
  const activeId = hoveredId || selectedId;
  const set = activeId ? closedNeighborhood(activeId) : null;

  nodeSel
    .classed('dimmed', (d) => !!set && !set.has(d.id))
    .classed('selected', (d) => d.id === selectedId);

  edgeSel
    .classed('lit', (l) => {
      const s = idOf(l.source), t = idOf(l.target);
      return !!activeId && (s === activeId || t === activeId);
    })
    .classed('dimmed', (l) => {
      const s = idOf(l.source), t = idOf(l.target);
      return !!activeId && !(s === activeId || t === activeId);
    });
}

function selectNode(d) {
  selectedId = d.id;
  refreshStyles();
  if (d.missing) showMissingNote(d.name);
  else openNote(d.id);
}

function clearSelection() {
  if (selectedId === null) return;
  selectedId = null;
  refreshStyles();
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showTooltip(ev, d) {
  const out = outCount.get(d.id) || 0;
  const inn = inCount.get(d.id) || 0;
  $('#tooltip').innerHTML =
    `<div class="tt-name">${escapeHtml(d.name)}</div>` +
    `<div class="tt-row">${d.missing ? '⚠️ link em falta' : 'nota existente'}</div>` +
    `<div class="tt-row">${out} saídas · ${inn} entradas</div>`;
  $('#tooltip').classList.add('show');
  moveTooltip(ev);
}

function moveTooltip(ev) {
  const rect = wrapEl().getBoundingClientRect();
  const t = $('#tooltip');
  t.style.left = Math.max(0, Math.min(ev.clientX - rect.left + 14, rect.width - 270)) + 'px';
  t.style.top = Math.max(0, ev.clientY - rect.top + 12) + 'px';
}

function hideTooltip() { $('#tooltip').classList.remove('show'); }

// ---------------------------------------------------------------------------
// Zoom helpers
// ---------------------------------------------------------------------------

function fitView(padding = 40) {
  if (!nodes.length || !svg) return;
  const w = wrapW(), h = wrapH();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, n.x - n.r); y0 = Math.min(y0, n.y - n.r);
    x1 = Math.max(x1, n.x + n.r); y1 = Math.max(y1, n.y + n.r);
  }
  const spanX = Math.max(40, x1 - x0), spanY = Math.max(40, y1 - y0);
  const scale = Math.max(0.05, Math.min(6, 0.9 * Math.min(w / spanX, h / spanY)));
  const tx = w / 2 - scale * (x0 + x1) / 2;
  const ty = h / 2 - scale * (y0 + y1) / 2;
  svg.transition().duration(450)
    .call(zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}

function focusNode(id) {
  const n = nodes.find((nd) => nd.id === id);
  if (!n || !svg) return;
  const w = wrapW(), h = wrapH();
  const s = Math.max(d3.zoomTransform(svg.node()).k, 1.4);
  svg.transition().duration(350)
    .call(zoomBehavior.transform, d3.zoomIdentity.translate(w / 2 - s * n.x, h / 2 - s * n.y).scale(s));
}

// ---------------------------------------------------------------------------
// Note panel
// ---------------------------------------------------------------------------

function showMissingNote(name) {
  $('#note-title').textContent = name;
  $('#note-meta').textContent = '⚠️ Link em falta — nenhum ficheiro corresponde a este [[wikilink]].';
  $('#note-body').innerHTML = '<p class="muted">Cria o ficheiro no vault e atualiza o grafo para resolver esta ligação.</p>';
}

// Resolve a wikilink base (e.g. "autenticacao" or "notas/arquitetura") to a
// canonical vault path using the same rules as the server: exact match, then
// basename anywhere in the vault. Returns null when the note is missing.
function resolveLinkTarget(base) {
  const b = String(base || '').trim().replace(/\\/g, '/');
  if (!b) return null;
  const withExt = /\.md$/i.test(b) ? b : b + '.md';
  const lower = withExt.toLowerCase();
  let hit = allFiles.find((f) => f.toLowerCase() === lower);
  if (hit) return hit;
  const baseName = lower.split('/').pop();
  hit = allFiles.find((f) => f.toLowerCase().split('/').pop() === baseName);
  return hit || null;
}

async function openNote(relPath) {
  try {
    const note = await api('/api/note?path=' + encodeURIComponent(relPath));
    $('#note-title').textContent = note.path;
    $('#note-meta').textContent = `${(note.markdown.length / 1024).toFixed(1)} KB · markdown (marked)`;
    let html = window.marked.parse(note.markdown);
    // make [[wikilinks]] clickable in the rendered note
    html = html.replace(/\[\[([^\[\]\n]+?)\]\]/g, (m, t) => {
      const target = t.split('|')[0].split('#')[0];
      return `<a class="wikilink" data-target="${target}">[[${t}]]</a>`;
    });
    $('#note-body').innerHTML = html;
    // resolve wikilinks against the loaded file list for missing styling + navigation
    for (const a of $('#note-body').querySelectorAll('a.wikilink')) {
      const t = a.dataset.target;
      const match = resolveLinkTarget(t);
      if (!match) a.classList.add('missing');
      a.addEventListener('click', () => {
        if (match) {
          focusNode(match);
          openNote(match);
        } else {
          showMissingNote(t.split('#')[0].split('|')[0]);
        }
      });
    }
    $('#note-body').scrollTop = 0;
  } catch (err) {
    $('#note-title').textContent = relPath;
    $('#note-meta').textContent = '';
    $('#note-body').innerHTML = `<p class="muted">Erro ao carregar: ${err.message}</p>`;
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function loadFiles() {
  const data = await api('/api/files');
  allFiles = data.files;
  const sel = $('#root-select');
  sel.innerHTML = '<option value="">Todo o vault</option>' +
    data.files.map((f) => `<option value="${f}">${f}</option>`).join('');
}

async function refresh() {
  try {
    const graph = await api(buildGraphUrl());
    selectedId = null;
    hoveredId = null;
    renderGraph(graph);
  } catch (err) {
    $('#stats').textContent = 'erro: ' + err.message;
  }
}

(async () => {
  makeSvg();
  await loadFiles();
  await refresh();

  $('#reload-btn').addEventListener('click', refresh);
  $('#root-select').addEventListener('change', refresh);
  $('#depth-input').addEventListener('change', refresh);
  $('#fit-btn').addEventListener('click', () => fitView());
  $('#layout-btn').addEventListener('click', () => {
    const order = ['force', 'circle', 'grid'];
    applyLayout(order[(order.indexOf(layoutMode) + 1) % order.length]);
  });
})();
