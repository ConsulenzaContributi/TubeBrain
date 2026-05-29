// tests/area-a-no-raw-innerhtml.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const files = [
  'dashboard/dashboard.js',
  'popup/popup.js',
  'options/options.js',
  'onboarding/onboarding.js',
  'content-script.js',
];

// Cattura: innerHTML = `...${qualcosa}...`  su singola riga, con ${...} non incapsulato
// in escHtml/escapeHtml/sanitize. Heuristica: segnala le righe con ${ senza una funzione di escape.
const offenders = [];
files.forEach(rel => {
  const full = path.join(__dirname, '..', rel);
  const lines = fs.readFileSync(full, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!/innerHTML\s*\+?=/.test(line)) return;
    if (!line.includes('${')) return;
    if (/escHtml|escapeHtml|Sanitize\./.test(line)) return;
    // consenti interpolazioni puramente numeriche/indici noti
    const interpolations = line.match(/\$\{[^}]*\}/g) || [];
    const risky = interpolations.some(x => !/^\$\{\s*(index|i|\d+|[a-zA-Z0-9_]+\s*\+\s*1)\s*\}$/.test(x));
    if (risky) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
  });
});

assert.deepEqual(offenders, [], 'innerHTML dinamici senza escape:\n' + offenders.join('\n'));
console.log('area-a-no-raw-innerhtml OK');
