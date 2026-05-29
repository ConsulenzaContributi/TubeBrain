# TubeBrain Fase 2 — Area B: Affidabilità chiamate AI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development o superpowers:executing-plans. Steps con checkbox (`- [ ]`).

**Goal:** Rendere robuste le chiamate ai provider AI con timeout, retry a backoff esponenziale e gestione esplicita di quota (429) e `Retry-After`.

**Architecture:** Nuovo modulo `utils/net.js` con `fetchWithRetry(url, options, policy)`, caricato via `importScripts` nel service worker prima di `gemini.js`/`openai.js`, che lo usano al posto di `fetch`. Funzione testabile in Node mockando `global.fetch`.

**Tech Stack:** Vanilla JS (MV3 service worker), `AbortController`, test Node con `assert`. Nessuna dipendenza nuova.

---

### Task 1: Helper `fetchWithRetry`

**Files:**
- Create: `utils/net.js`
- Test: `tests/area-b-net.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/area-b-net.test.js
const assert = require('assert');
const NetUtils = require('../utils/net.js');
assert.equal(typeof NetUtils.fetchWithRetry, 'function');

function fakeResponse(status, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: k => headers[k.toLowerCase()] || null }, json: async () => ({}), text: async () => '' };
}

(async () => {
  // 1) 429 poi 200 → ritorna 200 dopo 1 retry
  let calls = 0;
  global.fetch = async () => { calls++; return calls === 1 ? fakeResponse(429) : fakeResponse(200); };
  let res = await NetUtils.fetchWithRetry('http://x', {}, { retries: 3, baseDelayMs: 1 });
  assert.equal(res.status, 200);
  assert.equal(calls, 2, 'deve aver ritentato una volta');

  // 2) Esaurimento tentativi su 500 → errore tipizzato
  global.fetch = async () => fakeResponse(500);
  let threw = null;
  try { await NetUtils.fetchWithRetry('http://x', {}, { retries: 2, baseDelayMs: 1 }); } catch (e) { threw = e; }
  assert.ok(threw, 'deve lanciare dopo i tentativi');
  assert.ok(/server|500|temporane/i.test(threw.message), 'messaggio server/temporaneo');

  // 3) 429 senza retry residui → messaggio quota
  global.fetch = async () => fakeResponse(429);
  let q = null;
  try { await NetUtils.fetchWithRetry('http://x', {}, { retries: 0, baseDelayMs: 1 }); } catch (e) { q = e; }
  assert.ok(q && /quota|limite|429/i.test(q.message), 'messaggio quota');

  // 4) Errore di rete poi 200
  let netCalls = 0;
  global.fetch = async () => { netCalls++; if (netCalls === 1) throw new TypeError('Failed to fetch'); return fakeResponse(200); };
  res = await NetUtils.fetchWithRetry('http://x', {}, { retries: 2, baseDelayMs: 1 });
  assert.equal(res.status, 200);

  console.log('area-b-net OK');
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/area-b-net.test.js`
Expected: FAIL — `Cannot find module '../utils/net.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// utils/net.js — fetch resiliente per le chiamate AI
(function (root) {
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

  async function fetchWithRetry(url, options = {}, policy = {}) {
    const retries = Number.isInteger(policy.retries) ? policy.retries : 3;
    const baseDelayMs = policy.baseDelayMs || 600;
    const timeoutMs = policy.timeoutMs || 60000;

    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) return res;
        if (!RETRYABLE_STATUS.has(res.status) || attempt === retries) {
          if (res.status === 429) throw new Error('Limite di quota raggiunto (429). Riprova più tardi o controlla il piano del provider.');
          throw new Error('Errore server temporaneo (HTTP ' + res.status + ').');
        }
        const retryAfter = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
        const wait = retryAfter > 0 ? retryAfter * 1000 : baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
        await sleep(wait);
      } catch (err) {
        clearTimeout(timer);
        lastError = err;
        const isAbort = err && (err.name === 'AbortError');
        const isNetwork = err && (err.name === 'TypeError');
        const isOurThrow = err && /quota|server temporaneo/i.test(err.message || '');
        if (isOurThrow || attempt === retries) {
          if (isAbort) throw new Error('Timeout della richiesta AI dopo ' + Math.round(timeoutMs / 1000) + 's.');
          throw err;
        }
        if (!isNetwork && !isAbort) throw err;
        await sleep(baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 100));
      }
    }
    throw lastError || new Error('Richiesta AI fallita.');
  }

  const api = { fetchWithRetry };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.NetUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/area-b-net.test.js`
Expected: PASS — stampa `area-b-net OK`.

- [ ] **Step 5: Commit**

```bash
git add utils/net.js tests/area-b-net.test.js
git commit -m "feat(area-b): fetchWithRetry (timeout, backoff, gestione 429/Retry-After)"
```

---

### Task 2: Caricare `net.js` nel service worker

**Files:**
- Modify: `background.js` (lista `importScripts`, righe ~4-15)

- [ ] **Step 1: Aggiungi net.js prima di gemini.js**

Nella chiamata `importScripts(...)`, aggiungi la riga `'utils/net.js',` immediatamente prima di `'utils/gemini.js',`.

- [ ] **Step 2: Verifica**

Run: `node --check background.js`
Expected: nessun errore.

- [ ] **Step 3: Commit**

```bash
git add background.js
git commit -m "chore(area-b): carica utils/net.js nel service worker"
```

---

### Task 3: Usare `fetchWithRetry` in `gemini.js`

**Files:**
- Modify: `utils/gemini.js` (metodo `call`, riga ~73)

- [ ] **Step 1: Sostituisci la fetch**

```js
// PRIMA
const res = await fetch(this.endpoint(model), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
  body: JSON.stringify(body),
});
// DOPO
const netApi = (typeof NetUtils !== 'undefined') ? NetUtils : (typeof require !== 'undefined' ? require('./net.js') : null);
const res = await (netApi ? netApi.fetchWithRetry : fetch)(this.endpoint(model), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
  body: JSON.stringify(body),
}, { retries: 3, timeoutMs: 90000 });
```

- [ ] **Step 2: Verifica**

Run: `node --check utils/gemini.js`
Expected: nessun errore.

- [ ] **Step 3: Commit**

```bash
git add utils/gemini.js
git commit -m "feat(area-b): gemini.js usa fetchWithRetry"
```

---

### Task 4: Usare `fetchWithRetry` in `openai.js`

**Files:**
- Modify: `utils/openai.js` (metodo `call`, riga ~28)

- [ ] **Step 1: Sostituisci la fetch**

```js
// PRIMA
const res = await fetch(this.RESPONSES_URL, {
// DOPO (mantieni method/headers/body invariati, aggiungi la policy come ultimo argomento)
const netApi = (typeof NetUtils !== 'undefined') ? NetUtils : (typeof require !== 'undefined' ? require('./net.js') : null);
const res = await (netApi ? netApi.fetchWithRetry : fetch)(this.RESPONSES_URL, {
```
Chiudi la chiamata aggiungendo, dopo l'oggetto `{ method, headers, body }`, l'argomento `, { retries: 3, timeoutMs: 90000 }`.

- [ ] **Step 2: Verifica**

Run: `node --check utils/openai.js`
Expected: nessun errore.

- [ ] **Step 3: Commit**

```bash
git add utils/openai.js
git commit -m "feat(area-b): openai.js usa fetchWithRetry"
```

---

### Task 5: Verifica finale (no regressioni)

- [ ] **Step 1: Test**

Run: `node tests/area-b-net.test.js && node tests/passaggio5-openai-models.test.js && node tests/passaggio3-learning-engine.test.js`
Expected: nessun assert fallito.

- [ ] **Step 2: Sintassi**

Run: `node --check utils/net.js && node --check utils/gemini.js && node --check utils/openai.js && node --check background.js`
Expected: nessun errore.

---

## Self-Review

- **Spec coverage:** Area B → Task 1-5. ✓
- **Placeholder scan:** codice completo per helper, wiring e fix. ✓
- **Type consistency:** `NetUtils.fetchWithRetry` coerente tra net.js, gemini.js, openai.js, importScripts. ✓
- Nota: la policy timeout per le chiamate AI è 90s (estrazioni lunghe); il default dell'helper è 60s.
