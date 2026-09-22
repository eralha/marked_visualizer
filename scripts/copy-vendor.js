'use strict';
// Copies browser-ready UMD bundles from node_modules into public/vendor so the
// frontend works with zero build step. Run automatically on `npm start`.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const vendorDir = path.join(root, 'public', 'vendor');

const files = [
  { from: 'node_modules/cytoscape/dist/cytoscape.umd.js', to: 'cytoscape.min.js' },
  { from: 'node_modules/marked/marked.min.js', to: 'marked.min.js' }
];

fs.mkdirSync(vendorDir, { recursive: true });
for (const { from, to } of files) {
  const src = path.join(root, from);
  const dest = path.join(vendorDir, to);
  fs.copyFileSync(src, dest);
  console.log(`[vendor] ${from} -> public/vendor/${to}`);
}
