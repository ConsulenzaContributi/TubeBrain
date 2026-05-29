# TubeBrain Fase 2 — Area A: Sanitizzazione XSS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development o superpowers:executing-plans. Steps con checkbox (`- [ ]`).

**Goal:** Eliminare il rischio XSS introducendo un helper di sanitizzazione condiviso e mettendo in sicurezza ogni `innerHTML` che interpola dati esterni.

**Architecture:** Nuovo modulo `utils/sanitize.js` (funzioni pure, esportate per Node e registrate su `globalThis`/`window`). Audit sistematico dei ~62 `innerHTML` live: i dati esterni passano da `escapeHtml`/`sanitizeMarkdownToHtml`, i casi statici vengono annotati. Test unitari + grep di regressione.

**Tech Stack:** Vanilla JS (MV3), test Node con `assert`. Nessuna dipendenza nuova.

---

### Task 1: Helper di sanitizzazione

**Files:**
- Create: `utils/sanitize.js`
- Test: `tests/area-a-sanitize.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/area-a-sanitize.test.js
const assert = require('assert');
const Sanitize = require('../utils/sanitize.js');

assert.equal(typeof Sanitize.escapeHtml, 'function');
assert.equal(typeof Sanitize.sanitizeMarkdownToHtml, 'function');

const xss = '<img src=x onerror=alert(1)>';
const esc = Sanitize.escapeHtml(xss);
assert.ok(!esc.includes('<img'), 'escapeHtml deve neutralizzare i tag');
assert.ok(esc.includes('&lt;img'), 'escapeHtml deve produrre entita');
assert.equal(Sanitize.escapeHtml(null), '');
assert.equal(Sanitize.escapeHtml(42), '42');

const md = Sanitize.sanitizeMarkdownToHtml('**ciao** <script>alert(1)</script> *ok*');
assert.ok(!md.toLowerCase().includes('<script'), 'niente script');
assert.ok(md.includes('<strong>ciao</strong>'), 'grassetto consentito');
assert.ok(md.includes('<em>ok</em>'), 'corsivo consentito');

console.log('area-a-sanitize OK');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/area-a-sanitize.test.js`
Expected: FAIL — `Cannot find module '../utils/sanitize.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// utils/sanitize.js — Helper di sanitizzazione condiviso
(function (root) {
  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeMarkdownToHtml(text) {
    return escapeHtml(text)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
  }

  const api = { escapeHtml, sanitizeMarkdownToHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.Sanitize = api; }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/area-a-sanitize.test.js`
Expected: PASS — stampa `area-a-sanitize OK`.

- [ ] **Step 5: Commit**

```bash
git add utils/sanitize.js tests/area-a-sanitize.test.js
git commit -m "feat(area-a): helper sanitize condiviso (escapeHtml + sanitizeMarkdownToHtml)"
```

---

### Task 2: Caricare l'helper nelle pagine UI

**Files:**
- Modify: `dashboard/dashboard.html`, `popup/popup.html`, `options/options.html`, `onboarding/onboarding.html`

- [ ] **Step 1: Trova i tag script**

Run: `grep -n "<script" dashboard/dashboard.html popup/popup.html options/options.html onboarding/onboarding.html`

- [ ] **Step 2: Inserisci il caricamento dell'helper PRIMA dello script di pagina**

In ciascun file, subito prima del primo `<script src="...js">` di pagina (e prima di `app-schema.js` dove presente), aggiungi:

```html
<script src="../utils/sanitize.js"></script>
```

(In `dashboard/` e `options/` e `onboarding/` il percorso relativo è `../utils/sanitize.js`; in `popup/` è `../utils/sanitize.js`. Verifica il percorso reale rispetto alla posizione del file e adatta.)

- [ ] **Step 3: Commit**

```bash
git add dashboard/dashboard.html popup/popup.html options/options.html onboarding/onboarding.html
git commit -m "chore(area-a): carica utils/sanitize.js nelle pagine UI"
```

---

### Task 3: Audit e fix di `dashboard/dashboard.js`

**Files:**
- Modify: `dashboard/dashboard.js`

- [ ] **Step 1: Elenca gli innerHTML**

Run: `grep -n "innerHTML" dashboard/dashboard.js`

- [ ] **Step 2: Applica la regola di audit a ciascuno**

Per OGNI assegnazione `innerHTML` che interpola valori dinamici esterni (titoli video, nomi
canale, output AI, messaggi d'errore, dati di rete), avvolgi OGNI valore con `escHtml(...)`
(la funzione locale esistente) oppure `Sanitize.escapeHtml(...)`. Per i blocchi che renderizzano
testo "ricco" proveniente dall'AI usa `Sanitize.sanitizeMarkdownToHtml(...)` invece della
conversione manuale. Esempio di trasformazione:

```js
// PRIMA
card.innerHTML = `<div class="t">${lesson.title}</div><em>${lesson.reason}</em>`;
// DOPO
card.innerHTML = `<div class="t">${escHtml(lesson.title)}</div><em>${escHtml(lesson.reason)}</em>`;
```

I casi con solo contenuto statico/letterale (nessuna `${...}` esterna) si lasciano invariati.

- [ ] **Step 3: Verifica sintassi e regressioni**

Run: `node --check dashboard/dashboard.js`
Run: `node tests/passaggio1-foundation.test.js`
Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add dashboard/dashboard.js
git commit -m "fix(area-a): escape dei dati dinamici in dashboard (anti-XSS)"
```

---

### Task 4: Audit e fix di popup / options / onboarding / content-script

**Files:**
- Modify: `popup/popup.js`, `options/options.js`, `onboarding/onboarding.js`, `content-script.js`

- [ ] **Step 1: Elenca gli innerHTML**

Run: `grep -n "innerHTML" popup/popup.js options/options.js onboarding/onboarding.js content-script.js`

- [ ] **Step 2: Applica la stessa regola del Task 3**

Avvolgi ogni valore dinamico esterno con `Sanitize.escapeHtml(...)`. Esempio noto in `popup/popup.js`:

```js
// PRIMA
badges.innerHTML += `<span class="badge info">CC: ${vd.captionTracks.map(t=>t.languageCode).join(', ')}</span>`;
// DOPO
badges.innerHTML += `<span class="badge info">CC: ${Sanitize.escapeHtml(vd.captionTracks.map(t=>t.languageCode).join(', '))}</span>`;
```

Le label dei 5 strumenti/sezioni provengono dallo schema interno (non esterne): si lasciano.

- [ ] **Step 3: Verifica**

Run: `node --check popup/popup.js && node --check options/options.js && node --check onboarding/onboarding.js && node --check content-script.js`
Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add popup/popup.js options/options.js onboarding/onboarding.js content-script.js
git commit -m "fix(area-a): escape dei dati dinamici in popup/options/onboarding/content-script"
```

---

### Task 5: Test di regressione anti-XSS

**Files:**
- Create: `tests/area-a-no-raw-innerhtml.test.js`

- [ ] **Step 1: Write the test**

```js
// tests/area-a-no-raw-innerhtml.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const files = [
  'dashboard/dashboard.js',
  'popup/popup.js',
  'options/options.js',
  'onboarding/onboarding.js',
  'content-script.js',
];

// Cattura: innerHTML = `...${qualcosa}...`  su singola riga, con ${...} non incapsulato
// in escHtml/escapeHtml/sanitize. Heuristica: segnala le righe con ${ senza una funzione di escape.
const offenders = [];
files.forEach(rel => {
  const full = path.join(__dirname, '..', rel);
  const lines = fs.readFileSync(full, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!/innerHTML\s*\+?=/.test(line)) return;
    if (!line.includes('${')) return;
    if (/escHtml|escapeHtml|Sanitize\./.test(line)) return;
    // consenti interpolazioni puramente numeriche/indici noti
    const interpolations = line.match(/\$\{[^}]*\}/g) || [];
    const risky = interpolations.some(x => !/^\$\{\s*(index|i|\d+|[a-zA-Z0-9_]+\s*\+\s*1)\s*\}$/.test(x));
    if (risky) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
  });
});

assert.deepEqual(offenders, [], 'innerHTML dinamici senza escape:\n' + offenders.join('\n'));
console.log('area-a-no-raw-innerhtml OK');
```

- [ ] **Step 2: Run**

Run: `node tests/area-a-no-raw-innerhtml.test.js`
Expected: PASS dopo i fix dei Task 3-4. Se fallisce, elenca le righe da correggere → tornare al Task corrispondente.

- [ ] **Step 3: Commit**

```bash
git add tests/area-a-no-raw-innerhtml.test.js
git commit -m "test(area-a): regressione anti-XSS sugli innerHTML dinamici"
```

---

## Self-Review

- **Spec coverage:** Area A della spec → Task 1-5. ✓
- **Placeholder scan:** nessun TBD; codice completo per helper, wiring, test; i fix usano regola + esempi concreti. ✓
- **Type consistency:** `Sanitize.escapeHtml` / `Sanitize.sanitizeMarkdownToHtml` coerenti tra Task 1, 3, 4, 5. ✓
- Nota: il test del Task 5 è euristico su righe singole; gli `innerHTML` multi-riga vanno verificati manualmente durante i Task 3-4 (la regola resta: ogni dato esterno passa da escape).
