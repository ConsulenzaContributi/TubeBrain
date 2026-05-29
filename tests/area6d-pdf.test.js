// tests/area6d-pdf.test.js
const assert = require('assert');
const Pdf = require('../utils/pdf-extract.js');
assert.equal(typeof Pdf.joinPdfPages, 'function');
assert.equal(Pdf.joinPdfPages(['pagina uno', '  ', 'pagina due']), 'pagina uno\n\npagina due');
assert.equal(Pdf.joinPdfPages([]), '');
assert.equal(Pdf.joinPdfPages(['  solo spazi  ']), 'solo spazi');
console.log('area6d-pdf OK');
