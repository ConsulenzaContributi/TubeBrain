// utils/analytics.js — Statistiche di studio (pure)
(function (root) {
  const DAY = 86400000;
  function dayKey(ts) { return new Date(ts).toISOString().slice(0, 10); }

  function computeStreak(dayKeys = [], now = Date.now()) {
    const set = new Set(dayKeys);
    let streak = 0;
    let cursor = now;
    // consenti che lo streak parta da oggi o ieri
    if (!set.has(dayKey(cursor)) && set.has(dayKey(cursor - DAY))) cursor -= DAY;
    while (set.has(dayKey(cursor))) { streak++; cursor -= DAY; }
    return streak;
  }

  function computeRetention(reviews = []) {
    if (!reviews.length) return 0;
    const correct = reviews.filter(r => r && r.correct).length;
    return correct / reviews.length;
  }

  function dueForecast(cards = [], now = Date.now(), days = 7) {
    const out = {};
    for (let d = 0; d <= days; d++) out[d] = 0;
    cards.forEach(c => {
      const diff = Math.ceil(((Number(c.dueDate) || 0) - now) / DAY);
      if (diff >= 0 && diff <= days) out[diff] = (out[diff] || 0) + 1;
    });
    return out;
  }

  const api = { dayKey, computeStreak, computeRetention, dueForecast };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Analytics = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
