# TubeBrain Fase 4 — Apprendimento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development o executing-plans.

**Goal:** Scheduler FSRS + promemoria ripasso, analytics di studio, ricerca TF-IDF locale.

**Architecture:** Tre moduli puri testabili (`utils/fsrs.js`, `utils/analytics.js`, `utils/tfidf.js`) + wiring minimale in `utils/spaced-repetition.js`, `background.js`, dashboard. Nessuna dipendenza nuova.

---

### Task A1: Modulo FSRS

**Files:**
- Create: `utils/fsrs.js`
- Test: `tests/area4a-fsrs.test.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run** → FAIL (modulo assente).

- [ ] **Step 3: Implement**

```js
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
```

- [ ] **Step 4: Run** → PASS (`area4a-fsrs OK`).
- [ ] **Step 5: Commit**

```bash
git add utils/fsrs.js tests/area4a-fsrs.test.js
git commit -m "feat(area4a): scheduler FSRS semplificato (pure, testato)"
```

---

### Task A2: SR usa FSRS + alarm promemoria

**Files:**
- Modify: `utils/spaced-repetition.js` (`updateCard`)
- Modify: `background.js` (`importScripts` + alarm `review-reminder` + handler `onAlarm`)

- [ ] **Step 1: Delega a FSRS in `updateCard`**

In `utils/spaced-repetition.js`, sostituisci il calcolo SM-2 dentro `updateCard(cardId, summaryId, quality)` con la delega a FSRS, mantenendo il salvataggio dello stato. La `quality` SM-2 (0-5) va mappata a rating FSRS (1-4): `const rating = quality <= 2 ? 1 : quality === 3 ? 2 : quality === 4 ? 3 : 4;`. Poi:

```js
    const fsrsApi = (typeof FSRS !== 'undefined') ? FSRS : (typeof require !== 'undefined' ? require('./fsrs.js') : null);
    const next = fsrsApi.schedule(card.stability ? card : null, rating, Date.now());
    card.stability = next.stability;
    card.difficulty = next.difficulty;
    card.interval = next.interval;
    card.repetitions = next.reps;
    card.dueDate = next.dueDate;
    card.lastReviewed = next.lastReviewed;
```
Mantieni `easeFactor` se presente per retrocompatibilità (non rimuoverlo dallo stato salvato). Assicurati che `SR` resti esportato (`module.exports = SR` è già in fondo).

- [ ] **Step 2: Carica fsrs.js nel service worker**

In `background.js` `importScripts(...)`, aggiungi `'utils/fsrs.js',` prima di `'utils/spaced-repetition.js',` (se SR è caricato; altrimenti aggiungilo dopo gli altri utils). Verifica con `grep -n "spaced-repetition\|importScripts" background.js`.

- [ ] **Step 3: Alarm promemoria ripasso**

Nella funzione di init (dove vengono creati gli alarm, vicino a `setupAutoQueueAlarm` o `initializeApp`), crea un alarm giornaliero:

```js
chrome.alarms.create('review-reminder', { periodInMinutes: 24 * 60, delayInMinutes: 60 });
```
Nel listener `chrome.alarms.onAlarm.addListener(async (alarm) => { ... })` (riga ~2571) aggiungi un ramo:

```js
  if (alarm.name === 'review-reminder') {
    try {
      const due = await SR.getAllDueCards();
      if (due.length > 0) {
        showNotification('TubeBrain · Ripasso', `Hai ${due.length} flashcard da ripassare oggi.`);
      }
    } catch (e) {}
    return;
  }
```

- [ ] **Step 4: Verifica**

Run: `node --check utils/spaced-repetition.js utils/fsrs.js background.js`
Run: `node tests/area4a-fsrs.test.js`
Expected: nessun errore.

- [ ] **Step 5: Commit**

```bash
git add utils/spaced-repetition.js background.js
git commit -m "feat(area4a): SR usa FSRS + alarm promemoria ripasso giornaliero"
```

---

### Task B1: Modulo analytics

**Files:**
- Create: `utils/analytics.js`
- Test: `tests/area4b-analytics.test.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```js
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
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit**

```bash
git add utils/analytics.js tests/area4b-analytics.test.js
git commit -m "feat(area4b): modulo analytics (streak, retention, due forecast)"
```

---

### Task B2: Mostra analytics nella dashboard (best-effort)

**Files:**
- Modify: `background.js` (carica `utils/analytics.js` in importScripts; estendi `GET_GLOBAL_STATS` per includere streak e dueForecast)
- Modify: `dashboard/dashboard.js` (tab Stats: mostra i nuovi valori)

- [ ] **Step 1:** Aggiungi `'utils/analytics.js',` agli `importScripts`.
- [ ] **Step 2:** Nel punto in cui si gestisce `GET_GLOBAL_STATS` / `ProgressTracker.getGlobalStats`, arricchisci la risposta:

```js
  const dueCards = await SR.getAllDueCards();
  const sessionsDays = /* ricava i dayKey dalle sessioni se disponibili, altrimenti [] */ [];
  stats.streak = Analytics.computeStreak(sessionsDays, Date.now());
  stats.dueToday = (Analytics.dueForecast(dueCards, Date.now(), 0)[0]) || dueCards.length;
```
(Se i giorni delle sessioni non sono tracciati per-giorno, usa `[]` → streak 0; è accettabile come prima versione. NON inventare dati.)

- [ ] **Step 3:** In `dashboard/dashboard.js`, nella tab Stats, mostra `🔥 Streak: N giorni` e `🃏 Da ripassare oggi: N` se presenti nella risposta. Usa `escHtml`/numeri.
- [ ] **Step 4:** Verifica: `node --check background.js dashboard/dashboard.js`.
- [ ] **Step 5: Commit**

```bash
git add background.js dashboard/dashboard.js
git commit -m "feat(area4b): streak e card-in-scadenza nelle statistiche dashboard"
```

---

### Task C1: Modulo TF-IDF

**Files:**
- Create: `utils/tfidf.js`
- Test: `tests/area4c-tfidf.test.js`

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```js
// utils/tfidf.js — Ricerca TF-IDF + coseno (pure, locale)
(function (root) {
  function tokenize(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/).filter(t => t.length > 2);
  }

  function termFreq(tokens) {
    const tf = {};
    tokens.forEach(t => { tf[t] = (tf[t] || 0) + 1; });
    return tf;
  }

  function buildIndex(docs = []) {
    const df = {};
    const prepared = docs.map(d => {
      const tokens = tokenize(d.text);
      const tf = termFreq(tokens);
      Object.keys(tf).forEach(term => { df[term] = (df[term] || 0) + 1; });
      return { id: d.id, tf, len: tokens.length };
    });
    const N = prepared.length || 1;
    const idf = {};
    Object.keys(df).forEach(term => { idf[term] = Math.log(1 + N / df[term]); });
    // vettori tf-idf normalizzati
    const vectors = prepared.map(p => {
      const vec = {};
      let norm = 0;
      Object.keys(p.tf).forEach(term => {
        const w = (p.tf[term] / (p.len || 1)) * (idf[term] || 0);
        vec[term] = w; norm += w * w;
      });
      norm = Math.sqrt(norm) || 1;
      Object.keys(vec).forEach(term => { vec[term] /= norm; });
      return { id: p.id, vec };
    });
    return { idf, vectors, N };
  }

  function search(query, index, topK = 10) {
    const tokens = tokenize(query);
    const tf = termFreq(tokens);
    const len = tokens.length || 1;
    const qvec = {};
    let norm = 0;
    Object.keys(tf).forEach(term => {
      const w = (tf[term] / len) * ((index.idf && index.idf[term]) || 0);
      qvec[term] = w; norm += w * w;
    });
    norm = Math.sqrt(norm) || 1;
    Object.keys(qvec).forEach(term => { qvec[term] /= norm; });

    const scored = (index.vectors || []).map(d => {
      let score = 0;
      Object.keys(qvec).forEach(term => { if (d.vec[term]) score += qvec[term] * d.vec[term]; });
      return { id: d.id, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  const api = { tokenize, buildIndex, search };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TfIdf = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit**

```bash
git add utils/tfidf.js tests/area4c-tfidf.test.js
git commit -m "feat(area4c): ricerca TF-IDF locale (pure, testata)"
```

---

### Task C2: Handler ricerca locale + uso in dashboard

**Files:**
- Modify: `background.js` (importScripts + handler `LOCAL_SEARCH`)
- Modify: `dashboard/dashboard.js` (usa LOCAL_SEARCH nella ricerca)

- [ ] **Step 1:** Aggiungi `'utils/tfidf.js',` agli `importScripts`.
- [ ] **Step 2:** Nel `switch` di `handleMessage` (background.js) aggiungi:

```js
    case 'LOCAL_SEARCH': {
      const summaries = await Storage.getSummaries();
      const docs = summaries.map(s => ({ id: s.id, text: [s.title, (s.tags || []).join(' '), s.markdown || ''].join(' ') }));
      const index = TfIdf.buildIndex(docs);
      const ranked = TfIdf.search(message.query || '', index, message.topK || 20).filter(r => r.score > 0);
      const byId = new Map(summaries.map(s => [s.id, s]));
      return { success: true, summaries: ranked.map(r => byId.get(r.id)).filter(Boolean) };
    }
```

- [ ] **Step 3:** In `dashboard/dashboard.js`, dove esiste la ricerca archivio, aggiungi un'opzione "Ricerca intelligente (locale)" che chiama `bg('LOCAL_SEARCH', { query })` e renderizza i risultati con la funzione esistente. (Adatta al codice reale; non duplicare il rendering.)
- [ ] **Step 4:** Verifica: `node --check background.js dashboard/dashboard.js`.
- [ ] **Step 5: Commit**

```bash
git add background.js dashboard/dashboard.js
git commit -m "feat(area4c): handler LOCAL_SEARCH TF-IDF + ricerca intelligente in dashboard"
```

---

### Task FINALE: Verifica Fase 4

- [ ] Run: `node tests/area4a-fsrs.test.js && node tests/area4b-analytics.test.js && node tests/area4c-tfidf.test.js`
- [ ] Run: `node tests/passaggio1-foundation.test.js`
- [ ] Run: `node --check utils/fsrs.js utils/analytics.js utils/tfidf.js utils/spaced-repetition.js background.js dashboard/dashboard.js`

## Self-Review
- Spec coverage: 4A→A1/A2, 4B→B1/B2, 4C→C1/C2. ✓
- Placeholder scan: codice completo per i 3 moduli puri + wiring; le parti UI sono best-effort con regola esplicita di non inventare dati. ✓
- Type consistency: `FSRS.schedule`, `Analytics.{dayKey,computeStreak,computeRetention,dueForecast}`, `TfIdf.{buildIndex,search}` coerenti tra moduli, test e wiring. ✓
