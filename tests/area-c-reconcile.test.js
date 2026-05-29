// tests/area-c-reconcile.test.js
const assert = require('assert');
const { findOrphanedExtractions } = require('../core/queue-reconcile.js');

const now = 1000000000;
const thresholdMs = 10 * 60 * 1000; // 10 minuti
const summaries = [
  { id: 'a', status: 'extracting', extractionStartedAt: now - (11 * 60 * 1000) }, // orfano
  { id: 'b', status: 'extracting', extractionStartedAt: now - (2 * 60 * 1000) },  // recente, NON orfano
  { id: 'c', status: 'extracting' },                                              // senza timestamp → orfano
  { id: 'd', status: 'pending', extractionStartedAt: now - (60 * 60 * 1000) },    // non in estrazione
  { id: 'e', status: 'extracted', extractionStartedAt: now - (60 * 60 * 1000) },  // completato
];

const orphans = findOrphanedExtractions(summaries, now, thresholdMs);
assert.deepEqual(orphans.map(s => s.id).sort(), ['a', 'c']);
console.log('area-c-reconcile OK');
