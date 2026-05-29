const assert = require('assert');
global.AppSchema = require('../schemas/app-schema.js');
const MarkdownGenerator = require('../utils/markdown-generator.js');
const shell = MarkdownGenerator.buildInteractiveShell('', { videoId: 'abc123' });
['lhv2InitAccordion','lhv2InitProgress','lhv2InitDocSearch','lhv2InitScrollSpy'].forEach(fn => {
  assert.ok(shell.includes('function ' + fn + '('), 'manca definizione ' + fn);
  assert.ok(shell.includes(fn + '('), 'manca chiamata ' + fn);
});
assert.ok(shell.includes('lhv2-progress-strip'), 'manca CSS barra progresso');
assert.ok(shell.includes('lhv2-doc-search'), 'manca CSS ricerca');
assert.ok(shell.includes('lhv2-nav-active'), 'manca CSS scroll-spy');
assert.ok(shell.includes('lhv2-progress:'), 'manca progressKey');
assert.ok(shell.includes('lhv2-accordion:'), 'manca accordionKey');
console.log('area2-viewer-wiring OK');
