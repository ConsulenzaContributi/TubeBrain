// tests/area-a-sanitize.test.js
const assert = require('assert');
const Sanitize = require('../utils/sanitize.js');

assert.equal(typeof Sanitize.escapeHtml, 'function');
assert.equal(typeof Sanitize.sanitizeMarkdownToHtml, 'function');

const xss = '<img src=x onerror=alert(1)>';
const esc = Sanitize.escapeHtml(xss);
assert.ok(!esc.includes('<img'), 'escapeHtml deve neutralizzare i tag');
assert.ok(esc.includes('&lt;img'), 'escapeHtml deve produrre entita');
assert.equal(Sanitize.escapeHtml(null), '');
assert.equal(Sanitize.escapeHtml(42), '42');

const md = Sanitize.sanitizeMarkdownToHtml('**ciao** <script>alert(1)</script> *ok*');
assert.ok(!md.toLowerCase().includes('<script'), 'niente script');
assert.ok(md.includes('<strong>ciao</strong>'), 'grassetto consentito');
assert.ok(md.includes('<em>ok</em>'), 'corsivo consentito');

console.log('area-a-sanitize OK');
