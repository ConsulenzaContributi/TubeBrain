// tests/area6b-notion.test.js
const assert = require('assert');
const Notion = require('../utils/notion.js');
const summary = { title: 'Mio Video', markdown: 'Riga uno.\n\nRiga due.' };
const p = Notion.buildPagePayload(summary, 'db123');
assert.equal(p.parent.database_id, 'db123');
assert.ok(p.properties.Name.title[0].text.content.includes('Mio Video'));
assert.ok(Array.isArray(p.children) && p.children.length >= 1);
assert.equal(p.children[0].type, 'paragraph');
// chunking: testo lungo spezzato in blocchi <= 2000 char
const long = { title: 'L', markdown: 'x'.repeat(4500) };
const pl = Notion.buildPagePayload(long, 'db');
assert.ok(pl.children.every(b => b.paragraph.rich_text[0].text.content.length <= 2000));
assert.ok(pl.children.length >= 3);
console.log('area6b-notion OK');
