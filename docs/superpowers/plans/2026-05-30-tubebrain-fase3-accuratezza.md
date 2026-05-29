# TubeBrain Fase 3 — Accuratezza — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development o executing-plans. Steps con checkbox.

**Goal:** Grounding esteso (timestamp + marcatura inferenze), blocco pulito senza sottotitoli, stima costi/token nel popup.

**Architecture:** A = regola nel prompt `GeminiAPI.buildLearningSectionsPrompt` (riusato anche da OpenAI). B = helper puro `Transcript.hasUsableTranscript` + stop in `doBackgroundExtraction`. C = nuovo `utils/cost.js` puro + riga di stima nel popup.

**Tech Stack:** Vanilla JS (MV3), test Node con `assert`.

---

### Task A1: Regola di grounding nel prompt

**Files:**
- Modify: `utils/gemini.js` (`buildLearningSectionsPrompt`, riga ~484)
- Test: `tests/area3a-grounding-prompt.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/area3a-grounding-prompt.test.js
const assert = require('assert');
const GeminiAPI = require('../utils/gemini.js');
const prompt = GeminiAPI.buildLearningSectionsPrompt({ videoId: 'abc', title: 'T', channelName: 'C', transcript: '[0:00] ciao', chapters: [] }, 'it', {});
assert.ok(/grounding|ancora/i.test(prompt), 'manca regola di grounding');
assert.ok(prompt.includes('(inferenza)'), 'manca marcatura inferenze');
assert.ok(/\[mm:ss\]|\[minuti:secondi\]|timestamp/i.test(prompt), 'manca richiesta timestamp');
console.log('area3a-grounding-prompt OK');
```

- [ ] **Step 2: Run test** → `node tests/area3a-grounding-prompt.test.js` → FAIL (manca `(inferenza)`).

- [ ] **Step 3: Implement** — In `buildLearningSectionsPrompt`, dentro la stringa di prompt ritornata, inserisci (in un punto visibile, es. subito dopo le istruzioni di lingua o prima del template di output) questo blocco:

```
═══════════════════════════════════════
REGOLE DI GROUNDING (ANCORAGGIO AL VIDEO)
═══════════════════════════════════════
• Inizia ogni sezione/capitolo con un riferimento temporale nel formato [mm:ss] preso dalla trascrizione.
• Per ogni affermazione fattuale chiave, indica il timestamp [mm:ss] del punto in cui viene detta.
• Se un contenuto è una tua deduzione NON presente esplicitamente nella trascrizione, anteponi il marcatore (inferenza).
• Non inventare timestamp: usa solo quelli realmente presenti nella trascrizione.
```

Concatenalo nel template literal esistente (es. interpolando una costante `const groundingRules = \`...\`;` dichiarata nella funzione e inserita nel prompt).

- [ ] **Step 4: Run test** → PASS (`area3a-grounding-prompt OK`).

- [ ] **Step 5: Commit**

```bash
git add utils/gemini.js tests/area3a-grounding-prompt.test.js
git commit -m "feat(area3a): regola di grounding + marcatura inferenze nel prompt"
```

---

### Task B1: Helper trascrizione utilizzabile + stop pulito

**Files:**
- Modify: `utils/transcript.js` (aggiungi metodo + assicura `module.exports`)
- Modify: `background.js` (`doBackgroundExtraction`, ~riga 632)
- Test: `tests/area3b-transcript-guard.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/area3b-transcript-guard.test.js
const assert = require('assert');
const Transcript = require('../utils/transcript.js');
assert.equal(typeof Transcript.hasUsableTranscript, 'function');
assert.equal(Transcript.hasUsableTranscript({ transcript: '' }), false);
assert.equal(Transcript.hasUsableTranscript({ transcript: '   ' }), false);
assert.equal(Transcript.hasUsableTranscript({}), false);
assert.equal(Transcript.hasUsableTranscript({ transcript: '[0:00] contenuto reale' }), true);
console.log('area3b-transcript-guard OK');
```

- [ ] **Step 2: Run test** → `node tests/area3b-transcript-guard.test.js` → FAIL.

- [ ] **Step 3: Implement** —
  (a) In `utils/transcript.js`, aggiungi al suo oggetto principale il metodo:

```js
  hasUsableTranscript(videoData = {}) {
    return typeof videoData.transcript === 'string' && videoData.transcript.trim().length > 0;
  },
```
  Verifica che in fondo al file ci sia `if (typeof module !== 'undefined' && module.exports) module.exports = Transcript;` (o equivalente con il nome reale dell'oggetto). Se manca, aggiungilo senza rompere l'uso via `importScripts`.

  (b) In `background.js`, dentro `doBackgroundExtraction`, dopo la costruzione di `const videoData = { ...pageData, transcript, ... };` (riga ~653) e PRIMA della generazione del summary, aggiungi il guardiano:

```js
    if (!Transcript.hasUsableTranscript(videoData)) {
      await Storage.updateSummaryById(id, { status: 'pending', extractionStartedAt: null, noCaptions: true });
      try { chrome.tabs.remove(tab.id); } catch (e) {}
      await failRuntimeStatus(new Error('Questo video non ha sottotitoli (nemmeno auto-generati): impossibile estrarre. Riprova con un video che abbia i CC attivi.'), tab.windowId || null);
      showNotification('TubeBrain ⚠️', 'Nessun sottotitolo disponibile per questo video.');
      return;
    }
```

- [ ] **Step 4: Run test** → PASS. Poi `node --check background.js utils/transcript.js`.

- [ ] **Step 5: Commit**

```bash
git add utils/transcript.js background.js tests/area3b-transcript-guard.test.js
git commit -m "feat(area3b): stop pulito su video senza sottotitoli + helper hasUsableTranscript"
```

---

### Task C1: Helper costi/token

**Files:**
- Create: `utils/cost.js`
- Test: `tests/area3c-cost.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/area3c-cost.test.js
const assert = require('assert');
const Cost = require('../utils/cost.js');
assert.equal(Cost.estimateTokens(''), 0);
assert.equal(Cost.estimateTokens('abcd'), 1);       // 4 char ≈ 1 token
assert.equal(Cost.estimateTokens('a'.repeat(400)), 100);
assert.ok(Cost.estimateCostUsd(1000000, 'gemini-2.5-flash') > 0);
assert.equal(Cost.estimateCostUsd(0, 'gemini-2.5-flash'), 0);
// modello sconosciuto → costo 0 (nessun prezzo noto) ma non errore
assert.equal(typeof Cost.estimateCostUsd(1000, 'modello-ignoto'), 'number');
// raccomandazione: brevi → flash, lunghi → pro
assert.ok(/flash/.test(Cost.recommendModel(5000)));
assert.ok(/pro/.test(Cost.recommendModel(500000)));
console.log('area3c-cost OK');
```

- [ ] **Step 2: Run test** → FAIL (modulo assente).

- [ ] **Step 3: Implement**

```js
// utils/cost.js — Stima token/costo e raccomandazione modello
(function (root) {
  // USD per 1M token (input), valori indicativi configurabili
  const MODEL_PRICING = {
    'gemini-2.5-flash-lite': 0.10,
    'gemini-2.5-flash': 0.30,
    'gemini-3.0-flash': 0.30,
    'gemini-3.5-flash': 0.35,
    'gemini-2.5-pro': 1.25,
    'gemini-3.1-pro': 1.50,
    'gpt-5.4-mini': 0.40,
    'gpt-5.4': 3.00,
  };

  function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(String(text).length / 4);
  }

  function estimateCostUsd(tokens, model) {
    const price = MODEL_PRICING[model];
    if (!price || !tokens) return 0;
    return (tokens / 1000000) * price;
  }

  function recommendModel(tokens) {
    // Contesti molto lunghi → modello "pro"; altrimenti "flash" (rapido/economico)
    return tokens > 200000 ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
  }

  const api = { MODEL_PRICING, estimateTokens, estimateCostUsd, recommendModel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CostUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
```

- [ ] **Step 4: Run test** → PASS (`area3c-cost OK`).

- [ ] **Step 5: Commit**

```bash
git add utils/cost.js tests/area3c-cost.test.js
git commit -m "feat(area3c): helper stima token/costo + raccomandazione modello"
```

---

### Task C2: Mostra la stima nel popup

**Files:**
- Modify: `popup/popup.html` (carica `utils/cost.js` + un contenitore stima)
- Modify: `popup/popup.js` (calcola e mostra la stima nello stato video)

- [ ] **Step 1: Carica l'helper e aggiungi il contenitore**

In `popup/popup.html`, aggiungi `<script src="../utils/cost.js"></script>` prima di `popup.js`. Dentro lo stato video (`id="state-video"`), vicino al pulsante Genera, aggiungi:

```html
<p id="cost-estimate" class="popup-card-hint" style="margin-top:6px;"></p>
```

- [ ] **Step 2: Popola la stima**

In `popup/popup.js`, dentro `showVideoState(vd, settings)` (dopo aver determinato il provider/modello), aggiungi:

```js
  try {
    const estEl = $('cost-estimate');
    if (estEl && typeof CostUtils !== 'undefined') {
      const durMin = Number(vd.duration ? vd.duration / 60 : 0);
      const approxChars = vd.transcript ? vd.transcript.length : Math.round(durMin * 150 * 6); // ~150 parole/min, ~6 char/parola
      const tokens = CostUtils.estimateTokens('x'.repeat(Math.max(0, approxChars)));
      const model = settings.provider === 'openai' ? (settings.openaiModel || 'gpt-5.4-mini') : (settings.model || 'gemini-2.5-flash');
      const usd = CostUtils.estimateCostUsd(tokens, model);
      const reco = CostUtils.recommendModel(tokens);
      estEl.textContent = `Stima: ~${tokens.toLocaleString('it-IT')} token · ~$${usd.toFixed(4)} · consigliato: ${reco}`;
    }
  } catch (e) {}
```

- [ ] **Step 3: Verifica**

Run: `node --check popup/popup.js`
Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add popup/popup.html popup/popup.js
git commit -m "feat(area3c): stima token/costo/modello consigliato nel popup"
```

---

### Task FINALE: Verifica

- [ ] Run: `node tests/area3a-grounding-prompt.test.js && node tests/area3b-transcript-guard.test.js && node tests/area3c-cost.test.js`
- [ ] Run: `node tests/passaggio1-foundation.test.js && node tests/passaggio3-learning-engine.test.js`
- [ ] Run: `node --check utils/gemini.js background.js utils/transcript.js utils/cost.js popup/popup.js`
- [ ] Tutti verdi → Fase 3 completata.

## Self-Review
- **Spec coverage:** Area A→Task A1; Area B→Task B1; Area C→Task C1+C2. ✓
- **Placeholder scan:** codice completo per helper, prompt, guard, UI. ✓
- **Type consistency:** `Transcript.hasUsableTranscript`, `CostUtils.{estimateTokens,estimateCostUsd,recommendModel}`, flag `noCaptions`, stato `pending` coerenti. ✓
- Nota: i prezzi in `MODEL_PRICING` sono indicativi; la UI di stima è best-effort (usa la durata se la trascrizione non è ancora disponibile nel popup).
