# TubeBrain Fase 2 — Area C: Persistenza/ripresa coda MV3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development o superpowers:executing-plans. Steps con checkbox (`- [ ]`).

**Goal:** Evitare che un'estrazione interrotta dalla terminazione del service worker MV3 lasci un video "appeso": marcare l'inizio estrazione e, allo startup, riportare a coda gli orfani.

**Architecture:** `doBackgroundExtraction` marca il summary come `extracting` con `extractionStartedAt` all'avvio e lo riporta a `pending` in caso d'errore. Una funzione pura `findOrphanedExtractions(summaries, now, thresholdMs)` (testabile in Node) individua gli orfani; `reconcilePendingExtractions()` li riporta a `pending` allo startup.

**Tech Stack:** Vanilla JS (MV3 service worker), `chrome.storage` via `Storage`, test Node con `assert`.

---

### Task 1: Funzione pura `findOrphanedExtractions`

**Files:**
- Modify: `background.js` (aggiungi la funzione e rendila disponibile per il test)
- Test: `tests/area-c-reconcile.test.js`

Nota: `background.js` è un service worker e usa `importScripts`, non `module.exports`. Per testarla in Node senza caricare l'intero service worker, definisci la logica pura in un nuovo modulo `core/queue-reconcile.js` (esportato) e usala da `background.js`.

- Create: `core/queue-reconcile.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/area-c-reconcile.test.js
const assert = require('assert');
const { findOrphanedExtractions } = require('../core/queue-reconcile.js');

const now = 1000000000;
const thresholdMs = 10 * 60 * 1000; // 10 minuti
const summaries = [
  { id: 'a', status: 'extracting', extractionStartedAt: now - (11 * 60 * 1000) }, // orfano
  { id: 'b', status: 'extracting', extractionStartedAt: now - (2 * 60 * 1000) },  // recente, NON orfano
  { id: 'c', status: 'extracting' },                                              // senza timestamp → orfano
  { id: 'd', status: 'pending', extractionStartedAt: now - (60 * 60 * 1000) },    // non in estrazione
  { id: 'e', status: 'extracted', extractionStartedAt: now - (60 * 60 * 1000) },  // completato
];

const orphans = findOrphanedExtractions(summaries, now, thresholdMs);
assert.deepEqual(orphans.map(s => s.id).sort(), ['a', 'c']);
console.log('area-c-reconcile OK');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/area-c-reconcile.test.js`
Expected: FAIL — `Cannot find module '../core/queue-reconcile.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/area-c-reconcile.test.js`
Expected: PASS — stampa `area-c-reconcile OK`.

- [ ] **Step 5: Commit**

```bash
git add core/queue-reconcile.js tests/area-c-reconcile.test.js
git commit -m "feat(area-c): logica pura findOrphanedExtractions + test"
```

---

### Task 2: Caricare il modulo nel service worker

**Files:**
- Modify: `background.js` (`importScripts`, righe ~4-15)

- [ ] **Step 1: Aggiungi il modulo**

Nella chiamata `importScripts(...)`, aggiungi `'core/queue-reconcile.js',` dopo `'core/learning-document.js',`.

- [ ] **Step 2: Verifica**

Run: `node --check background.js`
Expected: nessun errore.

- [ ] **Step 3: Commit**

```bash
git add background.js
git commit -m "chore(area-c): carica core/queue-reconcile.js nel service worker"
```

---

### Task 3: Marcare inizio/fine estrazione

**Files:**
- Modify: `background.js` (`doBackgroundExtraction`, riga ~568; aggiornamento finale `status:'extracted'`, riga ~702)

- [ ] **Step 1: Marca `extracting` all'inizio**

In `doBackgroundExtraction(id)`, subito dopo aver trovato `const pending = summaries.find(...)` e verificato che esista, aggiungi:

```js
  await Storage.updateSummaryById(id, { status: 'extracting', extractionStartedAt: Date.now() });
```

- [ ] **Step 2: Ripristina `pending` in caso di errore**

Avvolgi il corpo di `doBackgroundExtraction` (dalla creazione tab in poi) in modo che un errore riporti lo stato. Nel blocco `catch`/`finally` esistente (o aggiungendone uno attorno alla logica di estrazione), in caso di errore esegui:

```js
    await Storage.updateSummaryById(id, { status: 'pending', extractionStartedAt: null }).catch(() => {});
```

(NB: l'aggiornamento finale a `status:'extracted'` alla riga ~702 resta invariato e sovrascrive `extracting` al successo.)

- [ ] **Step 3: Verifica**

Run: `node --check background.js`
Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add background.js
git commit -m "feat(area-c): marca stato 'extracting' con timestamp e ripristina su errore"
```

---

### Task 4: Reconcile allo startup

**Files:**
- Modify: `background.js` (vicino a `const appReady = initializeApp();` riga ~29 e ai listener `onStartup`/`onInstalled` righe ~2759-2766)

- [ ] **Step 1: Aggiungi la funzione di reconcile**

Aggiungi in `background.js` (a livello modulo):

```js
async function reconcilePendingExtractions() {
  try {
    const summaries = await Storage.getSummaries();
    const orphans = QueueReconcile.findOrphanedExtractions(summaries, Date.now(), 10 * 60 * 1000);
    for (const s of orphans) {
      await Storage.updateSummaryById(s.id, { status: 'pending', extractionStartedAt: null });
    }
    if (orphans.length) AppLogger?.info?.('Reconcile coda: ripristinati ' + orphans.length + ' video orfani.');
  } catch (e) {}
}
```

- [ ] **Step 2: Invocala allo startup**

Dopo `const appReady = initializeApp();` aggiungi:

```js
appReady.then(() => reconcilePendingExtractions()).catch(() => {});
```

E nel listener `chrome.runtime.onStartup.addListener(() => { ensureContextMenus()... })` aggiungi nel corpo:

```js
  reconcilePendingExtractions().catch(() => {});
```

- [ ] **Step 3: Verifica**

Run: `node --check background.js`
Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add background.js
git commit -m "feat(area-c): reconcilePendingExtractions allo startup del service worker"
```

---

### Task 5: Verifica finale

- [ ] **Step 1: Test**

Run: `node tests/area-c-reconcile.test.js && node tests/passaggio1-foundation.test.js`
Expected: nessun assert fallito.

- [ ] **Step 2: Sintassi**

Run: `node --check core/queue-reconcile.js && node --check background.js`
Expected: nessun errore.

---

## Self-Review

- **Spec coverage:** Area C → Task 1-5. ✓
- **Placeholder scan:** codice completo per logica pura, marcatura stato e reconcile. ✓
- **Type consistency:** `QueueReconcile.findOrphanedExtractions`, stato `'extracting'`, campo `extractionStartedAt` coerenti tra core/queue-reconcile.js, background.js e il test. ✓
- Nota: lo stato `'extracting'` è nuovo; verificare durante l'implementazione che la UI (dashboard) lo mostri in modo sensato (fallback "in coda"/"in corso"); eventuale adeguamento UI minimale è ammesso.
