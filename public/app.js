'use strict';
/* MD Graph — frontend logic: fetch graph JSON, render with Cytoscape, note preview. */

const $ = (sel) => document.querySelector(sel);

let cy = null;
let allFiles = [];
let currentGraph = null;
let layoutMode = 'cose';

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
// Cytoscape setup
// ---------------------------------------------------------------------------

const CY_STYLE = [
  {
    selector: 'node',
    style: {
      label: 'data(name)',
      'text-valign': 'bottom',
      'text-margin-y': '-6px',
      shape: 'ellipse',
      'background-color': '#9ece6a',
      color: '#e6e6f0',
      'font-size': 11,
      width: 'data(size)',
      height: 'data(size)'
    }
  },
  { selector: 'node.missing', style: { 'background-color': '#f38ba8', shape: 'diamond' } },
  { selector: ':selected', style: { 'border-width': 4, 'border-color': '#7aa2f7', 'z-index': 10 } },
  {
    selector: 'edge',
    style: {
      width: 1.6,
      'line-color': '#55557a',
      'target-arrow-color': '#55557a',
      'source-arrow-color': '#ffffff00',
      'arrow-scale': .8,
      'curve-style': 'bezier',
      label: 'data(label)',
      'text-rotation': 'autorotate'
    }
  },
  { selector: 'edge.missing', style: { 'line-style': 'dashed', 'line-color': '#f38ba866', 'target-arrow-color': '#f38ba866' } },
  { selector: '.dimmed', style: { opacity: .12 } }
];

function makeCytoscape() {
  cy = cytoscape({
    container: $('#cy'),
    elements: [],
    style: CY_STYLE,
    layout: { name: 'preset' },
    wheelSensitivity: 0.35,
    minZoom: 0.05,
    maxZoom: 6
  });

  cy.on('tap', 'node', (ev) => {
    const n = ev.target;
    if (n.hasClass('missing')) return showMissingNote(n.data('name'));
    openNote(n.data('id'));
  });
  cy.on('tap', (ev) => {
    if (ev.target === cy) clearSelection();
  });

  // highlight neighborhood on hover
  cy.on('mouseover', 'node', (ev) => {
    const n = ev.target;
    const hood = n.closedNeighborhood();
    cy.elements().addClass('dimmed');
    hood.removeClass('dimmed');
  });
  cy.on('mouseout', 'node', () => cy.elements().removeClass('dimmed'));

  window.addEventListener('resize', () => cy.resize());
}

function applyLayout(name) {
  layoutMode = name;
  $('#layout-btn').textContent = 'Layout: ' + name;
  const layouts = { cose: 'cose', force: 'fcos', grid: 'grid', circle: 'circle' };
  cy.layout({ name: layouts[name] || 'cose', animate: true, animationDuration: 400 }).run();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderGraph(graph) {
  currentGraph = graph;
  const nodes = graph.nodes.map(n => ({
    data: {
      id: n.id,
      name: n.name,
      size: Math.max(10, Math.min(46, 8 + Math.sqrt(n.links * 6))),
      label: ''
    },
    classes: n.missing ? 'missing' : ''
  }));

  const edges = graph.edges.map((e, i) => ({
    data: { id: 'e' + i, source: e.data.source, target: e.data.target, label: e.data.alias || '' },
    classes: e.data.source.startsWith('__missing__') || e.data.target.startsWith('__missing__') ? 'missing' : ''
  }));

  cy.elements().remove();
  cy.add(nodes);
  cy.add(edges);
  applyLayout(layoutMode);

  const missing = graph.nodes.filter(n => n.missing).length;
  $('#stats').textContent =
    `${graph.nodes.length - missing} notas · ${missing} em falta · ${graph.edges.length} ligações`;
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
  let hit = allFiles.find(f => f.toLowerCase() === lower);
  if (hit) return hit;
  const baseName = lower.split('/').pop();
  hit = allFiles.find(f => f.toLowerCase().split('/').pop() === baseName);
  return hit || null;
}

async function openNote(relPath) {
  try {
    const note = await api('/api/note?path=' + encodeURIComponent(relPath));
    $('#note-title').textContent = note.path;
    $('#note-meta').textContent = `${(note.markdown.length / 1024).toFixed(1)} KB · markdown-it render`;
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
          const el = cy.$(`#${CSS.escape(match)}`);
          if (el.length) cy.animate({ center: { eles: el } }, { duration: 250 });
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

function clearSelection() {
  cy.$(':selected').unselect();
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function loadFiles() {
  const data = await api('/api/files');
  allFiles = data.files;
  const sel = $('#root-select');
  sel.innerHTML = '<option value="">Todo o vault</option>' +
    data.files.map(f => `<option value="${f}">${f}</option>`).join('');
}

async function refresh() {
  try {
    const graph = await api(buildGraphUrl());
    renderGraph(graph);
  } catch (err) {
    $('#stats').textContent = 'erro: ' + err.message;
  }
}

(async () => {
  makeCytoscape();
  await loadFiles();
  await refresh();

  $('#reload-btn').addEventListener('click', refresh);
  $('#root-select').addEventListener('change', refresh);
  $('#depth-input').addEventListener('change', refresh);
  $('#fit-btn').addEventListener('click', () => cy.fit(undefined, 30));
  $('#layout-btn').addEventListener('click', () => {
    const order = ['cose', 'force', 'grid', 'circle'];
    applyLayout(order[(order.indexOf(layoutMode) + 1) % order.length]);
  });
})();
