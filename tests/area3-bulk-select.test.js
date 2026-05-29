const assert = require('assert');
const fs = require('fs');
const cs = fs.readFileSync(__dirname + '/../content-script.js', 'utf8');
['harvestPageVideoUrls','toggleSelectionMode','decorateThumbnails','ensureSelectionBar','queueUrls','updateSelectionCount'].forEach(fn => {
  assert.ok(cs.includes('function ' + fn) || cs.includes(fn + ' ='), 'manca funzione ' + fn);
});
assert.ok(cs.includes('TOGGLE_SELECTION_MODE'), 'manca handler TOGGLE_SELECTION_MODE');
assert.ok(cs.includes('IMPORT_BATCH_URLS'), 'manca invio IMPORT_BATCH_URLS');
assert.ok(cs.includes('tb-selection-bar'), 'manca barra selezione');
const bg = fs.readFileSync(__dirname + '/../background.js', 'utf8');
assert.ok(bg.includes("command === 'toggle-queue'"), 'manca wiring toggle-queue in background');
console.log('area3-bulk-select OK');
