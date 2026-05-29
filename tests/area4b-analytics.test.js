// tests/area4b-analytics.test.js
const assert = require('assert');
const A = require('../utils/analytics.js');
const DAY = 86400000;
const now = 1700000000000;

// Streak: oggi, ieri, l'altro ieri → 3
const days = [now, now - DAY, now - 2 * DAY].map(t => A.dayKey(t));
assert.equal(A.computeStreak(days, now), 3);
// gap interrompe lo streak
assert.equal(A.computeStreak([A.dayKey(now), A.dayKey(now - 3 * DAY)], now), 1);
// streak 0 se nessuna attività recente
assert.equal(A.computeStreak([A.dayKey(now - 5 * DAY)], now), 0);

// Retention
assert.equal(A.computeRetention([{ correct: true }, { correct: false }, { correct: true }]), 2 / 3);
assert.equal(A.computeRetention([]), 0);

// Due forecast
const cards = [{ dueDate: now + DAY }, { dueDate: now + DAY }, { dueDate: now + 3 * DAY }];
const f = A.dueForecast(cards, now, 7);
assert.equal(f[1], 2);
assert.equal(f[3], 1);
console.log('area4b-analytics OK');
