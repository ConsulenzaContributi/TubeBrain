// utils/ankiconnect.js — Builder payload AnkiConnect (puro)
(function (root) {
  function buildAddNotesPayload(cards = [], deckName = 'TubeBrain', modelName = 'Basic') {
    const notes = (cards || []).filter(c => c && c.question && c.answer).map(c => ({
      deckName,
      modelName,
      fields: { Front: String(c.question), Back: String(c.answer) },
      options: { allowDuplicate: false },
      tags: ['TubeBrain'],
    }));
    return { action: 'addNotes', version: 6, params: { notes } };
  }
  const api = { buildAddNotesPayload };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AnkiConnect = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
