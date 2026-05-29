// tests/area6a-ankiconnect.test.js
const assert = require('assert');
const Anki = require('../utils/ankiconnect.js');
const cards = [{ question: 'Q1', answer: 'A1' }, { question: 'Q2', answer: 'A2' }];
const payload = Anki.buildAddNotesPayload(cards, 'TubeBrain::Video X', 'Basic');
assert.equal(payload.action, 'addNotes');
assert.equal(payload.version, 6);
assert.equal(payload.params.notes.length, 2);
assert.equal(payload.params.notes[0].deckName, 'TubeBrain::Video X');
assert.equal(payload.params.notes[0].modelName, 'Basic');
assert.equal(payload.params.notes[0].fields.Front, 'Q1');
assert.equal(payload.params.notes[0].fields.Back, 'A1');
assert.deepEqual(payload.params.notes[0].options, { allowDuplicate: false });
// nessuna card → notes vuoto
assert.equal(Anki.buildAddNotesPayload([], 'D', 'Basic').params.notes.length, 0);
console.log('area6a-ankiconnect OK');
