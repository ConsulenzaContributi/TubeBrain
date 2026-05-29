// utils/spaced-repetition.js — Algoritmo SM-2 per flashcard
// Feature #2 — v2.4.0

const SR = (() => {
  const STORAGE_KEY = 'srState';

  // ── Parsing ──────────────────────────────────────────────────────────────────

  /**
   * Estrae le flashcard dalla sezione "## Flashcard" del markdown.
   * Formato atteso: linee con "D:" (domanda) e "R:" (risposta), o separatori "---".
   * Supporta anche "**Domanda:**" / "**Risposta:**" e "Q:" / "A:".
   * @param {string} markdown
   * @returns {Array<{ id: string, question: string, answer: string }>}
   */
  function parseFlashcardsFromMarkdown(markdown) {
    if (!markdown) return [];
    // Estrai la sezione ## Flashcard
    const sectionMatch = markdown.match(/^##\s+Flashcard\s*$\n?([\s\S]*?)(?=^##\s+|$)/m);
    const section = sectionMatch ? sectionMatch[1] : markdown;

    const cards = [];
    // Strategia 1: blocchi separati da "---" con etichette D:/R: o Q:/A:
    const blocks = section.split(/\n---+\n/);
    for (const block of blocks) {
      const qMatch = block.match(/(?:^|\n)\s*(?:D:|Q:|(?:\*\*)?(?:Domanda|Question)(?:\*\*)?:)\s*(.+)/i);
      const aMatch = block.match(/(?:^|\n)\s*(?:R:|A:|(?:\*\*)?(?:Risposta|Answer)(?:\*\*)?:)\s*([\s\S]+?)(?=\n\s*(?:D:|Q:|R:|A:)|$)/i);
      if (qMatch && aMatch) {
        const question = qMatch[1].trim();
        const answer   = aMatch[1].trim();
        if (question && answer) {
          cards.push({ id: _cardId(question), question, answer });
        }
      }
    }

    // Strategia 2: coppie sequenziali "**Domanda**: ... **Risposta**: ..."
    if (!cards.length) {
      const domande = [...section.matchAll(/\*\*(?:Domanda|Q):\*\*\s*(.+)/gi)];
      const risposte = [...section.matchAll(/\*\*(?:Risposta|A):\*\*\s*([\s\S]+?)(?=\*\*(?:Domanda|Q):|$)/gi)];
      for (let i = 0; i < Math.min(domande.length, risposte.length); i++) {
        const question = domande[i][1].trim();
        const answer   = risposte[i][1].trim();
        if (question && answer) {
          cards.push({ id: _cardId(question), question, answer });
        }
      }
    }

    return cards;
  }

  /** Genera un id deterministico dalla domanda. */
  function _cardId(question) {
    return 'fc_' + question.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) + '_' + question.length;
  }

  // ── Storage helpers ───────────────────────────────────────────────────────────

  async function _loadState() {
    const { [STORAGE_KEY]: state = {} } = await chrome.storage.local.get(STORAGE_KEY);
    return state; // { [summaryId]: { [cardId]: { easeFactor, interval, dueDate, repetitions } } }
  }

  async function _saveState(state) {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  // ── Algoritmo SM-2 ────────────────────────────────────────────────────────────

  /**
   * Aggiorna lo stato SM-2 di una card.
   * @param {string} cardId
   * @param {string} summaryId
   * @param {number} quality - qualità della risposta 0–5 (0-1=fallita, 2=barely, 3-5=ok)
   */
  async function updateCard(cardId, summaryId, quality) {
    const state = await _loadState();
    if (!state[summaryId]) state[summaryId] = {};

    const card = state[summaryId][cardId] || {
      easeFactor:  2.5,
      interval:    1,
      repetitions: 0,
      dueDate:     Date.now(),
    };

    // Mappa quality SM-2 (0-5) → rating FSRS (1-4)
    const rating = quality <= 2 ? 1 : quality === 3 ? 2 : quality === 4 ? 3 : 4;

    const fsrsApi = (typeof FSRS !== 'undefined') ? FSRS : (typeof require !== 'undefined' ? require('./fsrs.js') : null);
    const next = fsrsApi.schedule(card.stability ? card : null, rating, Date.now());
    card.stability = next.stability;
    card.difficulty = next.difficulty;
    card.interval = next.interval;
    card.repetitions = next.reps;
    card.dueDate = next.dueDate;
    card.lastReviewed = next.lastReviewed;
    // easeFactor mantenuto per retrocompatibilità (non rimosso dallo stato salvato)

    state[summaryId][cardId] = card;
    await _saveState(state);
    return card;
  }

  /**
   * Ritorna le card di un summary con dueDate <= adesso.
   * @param {string} summaryId
   * @returns {Promise<Array<{ cardId: string, ...cardState }>>}
   */
  async function getDueCards(summaryId) {
    const state = await _loadState();
    const cards = state[summaryId] || {};
    const now = Date.now();
    return Object.entries(cards)
      .filter(([, c]) => c.dueDate <= now)
      .map(([cardId, c]) => ({ cardId, ...c }));
  }

  /**
   * Ritorna tutte le card scadute da tutti i summary.
   * @returns {Promise<Array<{ cardId: string, summaryId: string, ...cardState }>>}
   */
  async function getAllDueCards() {
    const state = await _loadState();
    const now = Date.now();
    const result = [];
    for (const [summaryId, cards] of Object.entries(state)) {
      for (const [cardId, c] of Object.entries(cards)) {
        if (c.dueDate <= now) {
          result.push({ cardId, summaryId, ...c });
        }
      }
    }
    return result;
  }

  return {
    parseFlashcardsFromMarkdown,
    updateCard,
    getDueCards,
    getAllDueCards,
  };
})();

if (typeof module !== 'undefined') module.exports = SR;
