// core/queue-reconcile.js — logica pura per recupero estrazioni orfane
(function (root) {
  function findOrphanedExtractions(summaries = [], now = Date.now(), thresholdMs = 10 * 60 * 1000) {
    return summaries.filter(s => {
      if (!s || s.status !== 'extracting') return false;
      const started = Number(s.extractionStartedAt || 0);
      if (!started) return true; // estrazione senza timestamp = orfana
      return (now - started) > thresholdMs;
    });
  }
  const api = { findOrphanedExtractions };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.QueueReconcile = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
