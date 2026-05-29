// tests/area4c-tfidf.test.js
const assert = require('assert');
const TfIdf = require('../utils/tfidf.js');
const docs = [
  { id: '1', text: 'python machine learning tutorial pandas' },
  { id: '2', text: 'cucina ricetta pasta pomodoro italiana' },
  { id: '3', text: 'python data science numpy pandas' },
];
const index = TfIdf.buildIndex(docs);
const res = TfIdf.search('python pandas', index, 3);
assert.ok(res.length > 0);
assert.ok(['1', '3'].includes(res[0].id), 'primo risultato pertinente a python/pandas');
// la ricetta non deve stare in cima
assert.notEqual(res[0].id, '2');
// query senza match → nessun risultato con score > 0
const none = TfIdf.search('quantistica astrofisica', index, 3);
assert.ok(none.every(r => r.score === 0) || none.length === 0);
console.log('area4c-tfidf OK');
