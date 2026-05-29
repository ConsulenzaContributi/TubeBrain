// utils/fsrs.js — Scheduler FSRS semplificato (stability/difficulty)
(function (root) {
  const DAY = 24 * 60 * 60 * 1000;
  const INIT_STABILITY = { 1: 0.4, 2: 1.2, 3: 3.1, 4: 8.2 };
  const clampD = d => Math.min(10, Math.max(1, d));

  function schedule(state, rating, now = Date.now()) {
    const r = Math.min(4, Math.max(1, Number(rating) || 3));
    const prev = state && Number(state.stability) > 0 ? state : null;

    let difficulty, stability, reps;
    if (!prev) {
      difficulty = clampD(5 - (r - 3));            // good→5, easy→4, hard→6, again→7
      stability = INIT_STABILITY[r];
      reps = 1;
    } else {
      reps = (Number(prev.reps) || 0) + 1;
      difficulty = clampD((Number(prev.difficulty) || 5) - (r - 3) * 0.6);
      if (r === 1) {
        stability = Math.max(0.4, (Number(prev.stability) || 1) * 0.4); // lapse
        reps = 0;
      } else {
        const factor = { 2: 1.15, 3: 1.6, 4: 2.1 }[r];
        const difficultyMod = 1 + (5.5 - difficulty) * 0.04;
        stability = (Number(prev.stability) || 1) * factor * difficultyMod;
      }
    }

    const interval = r === 1 ? 1 : Math.max(1, Math.round(stability));
    return {
      stability: Math.round(stability * 100) / 100,
      difficulty: Math.round(difficulty * 100) / 100,
      reps,
      interval,
      dueDate: now + interval * DAY,
      lastReviewed: now,
    };
  }

  const api = { schedule };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FSRS = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
