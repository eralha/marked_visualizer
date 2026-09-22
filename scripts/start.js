'use strict';
// Wrapper for `npm start`: accepts VAR=value pairs after the script name and
// injects them as environment variables, then spawns `node server.js`.
// Usage: npm start -- VAULT_DIR="C:\caminho\vault" PORT=9000
// With no arguments it behaves exactly like `node server.js`.

const { spawn } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const extraEnv = {};

for (const arg of args) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(arg);
  if (!m) {
    console.error(`[start] argumento inválido: "${arg}" — formato esperado VAR=valor`);
    process.exit(1);
  }
  extraEnv[m[1]] = m[2];
}

const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  stdio: 'inherit',
  env: { ...process.env, ...extraEnv }
});

child.on('close', (code) => process.exit(code ?? 0));
child.on('SIGINT', () => child.kill('SIGINT'));
