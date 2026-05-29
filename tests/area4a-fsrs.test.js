// tests/area4a-fsrs.test.js
const assert = require('assert');
const FSRS = require('../utils/fsrs.js');
const now = 1000000000000;

// Prima review "good" → stabilità/intervallo positivi, dueDate futuro
let s = FSRS.schedule(null, 3, now);
assert.ok(s.stability > 0 && s.interval >= 1);
assert.ok(s.dueDate > now);
assert.ok(s.difficulty >= 1 && s.difficulty <= 10);

// "again" su carta esistente → intervallo che si accorcia (<= 1 giorno)
let again = FSRS.schedule({ stability: 10, difficulty: 5, reps: 3 }, 1, now);
assert.ok(again.interval <= 1, 'again deve resettare a intervallo breve');

// "easy" ripetuto cresce l'intervallo rispetto a "good"
const good = FSRS.schedule({ stability: 5, difficulty: 5, reps: 2 }, 3, now);
const easy = FSRS.schedule({ stability: 5, difficulty: 5, reps: 2 }, 4, now);
assert.ok(easy.interval >= good.interval, 'easy >= good');

// difficoltà resta nei limiti
assert.ok(easy.difficulty >= 1 && easy.difficulty <= 10);
console.log('area4a-fsrs OK');
