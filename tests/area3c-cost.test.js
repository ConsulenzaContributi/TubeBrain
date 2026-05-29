// tests/area3c-cost.test.js
const assert = require('assert');
const Cost = require('../utils/cost.js');
assert.equal(Cost.estimateTokens(''), 0);
assert.equal(Cost.estimateTokens('abcd'), 1);       // 4 char ≈ 1 token
assert.equal(Cost.estimateTokens('a'.repeat(400)), 100);
assert.ok(Cost.estimateCostUsd(1000000, 'gemini-2.5-flash') > 0);
assert.equal(Cost.estimateCostUsd(0, 'gemini-2.5-flash'), 0);
// modello sconosciuto → costo 0 (nessun prezzo noto) ma non errore
assert.equal(typeof Cost.estimateCostUsd(1000, 'modello-ignoto'), 'number');
// raccomandazione: brevi → flash, lunghi → pro
assert.ok(/flash/.test(Cost.recommendModel(5000)));
assert.ok(/pro/.test(Cost.recommendModel(500000)));
console.log('area3c-cost OK');
