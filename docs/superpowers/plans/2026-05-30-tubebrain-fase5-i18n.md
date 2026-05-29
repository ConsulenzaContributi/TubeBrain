# TubeBrain Fase 5 (parti sicure) — i18n — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development o executing-plans.

**Goal:** Infrastruttura i18n custom (switch a runtime), traduzione EN delle stringhe chiave, selettore lingua nelle Impostazioni.

**Architecture:** `utils/i18n.js` con dizionari `{ it, en }` e `t(key, lang)`; `applyI18n(root, lang)` sostituisce il testo degli elementi con `data-i18n`. `settings.uiLanguage` (it|en). Nessuna dipendenza nuova.

---

### Task 1: Modulo i18n

**Files:**
- Create: `utils/i18n.js`
- Test: `tests/area5-i18n.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/area5-i18n.test.js
const assert = require('assert');
const I18n = require('../utils/i18n.js');
assert.equal(typeof I18n.t, 'function');
// chiave esistente in EN e IT
assert.notEqual(I18n.t('popup.generate', 'en'), I18n.t('popup.generate', 'it'));
// fallback a IT se manca la lingua
assert.equal(I18n.t('popup.generate', 'xx'), I18n.t('popup.generate', 'it'));
// fallback alla chiave se manca del tutto
assert.equal(I18n.t('chiave.inesistente', 'it'), 'chiave.inesistente');
// dizionari coerenti: ogni chiave EN esiste in IT
const { DICT } = I18n;
Object.keys(DICT.en).forEach(k => assert.ok(k in DICT.it, 'chiave mancante in it: ' + k));
console.log('area5-i18n OK');
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** (includi un set iniziale di stringhe chiave; estendibile)

```js
// utils/i18n.js — i18n custom con switch a runtime
(function (root) {
  const DICT = {
    it: {
      'popup.generate': 'Genera Learning MDX',
      'popup.queue': 'Coda',
      'popup.follow': 'Segui Creator',
      'popup.ocr': 'Cattura Testo a Schermo (OCR)',
      'popup.settings': 'Impostazioni',
      'popup.dashboard': 'Apri Dashboard',
      'options.language': 'Lingua interfaccia',
      'dashboard.search': 'Cerca',
      'dashboard.archive': 'Archivio',
      'dashboard.stats': 'Statistiche',
      'common.save': 'Salva',
      'common.loading': 'Caricamento...',
    },
    en: {
      'popup.generate': 'Generate Learning MDX',
      'popup.queue': 'Queue',
      'popup.follow': 'Follow Creator',
      'popup.ocr': 'Capture On-screen Text (OCR)',
      'popup.settings': 'Settings',
      'popup.dashboard': 'Open Dashboard',
      'options.language': 'Interface language',
      'dashboard.search': 'Search',
      'dashboard.archive': 'Archive',
      'dashboard.stats': 'Statistics',
      'common.save': 'Save',
      'common.loading': 'Loading...',
    },
  };

  function t(key, lang = 'it') {
    const table = DICT[lang] || DICT.it;
    if (table && key in table) return table[key];
    if (DICT.it && key in DICT.it) return DICT.it[key];
    return key;
  }

  function applyI18n(rootEl, lang = 'it') {
    if (!rootEl || !rootEl.querySelectorAll) return;
    rootEl.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.getAttribute('data-i18n'), lang);
    });
    rootEl.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder'), lang));
    });
  }

  const api = { DICT, t, applyI18n };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.I18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit**

```bash
git add utils/i18n.js tests/area5-i18n.test.js
git commit -m "feat(area5): modulo i18n custom (it/en) con switch a runtime"
```

---

### Task 2: Selettore lingua + impostazione

**Files:**
- Modify: `schemas/app-schema.js` (DEFAULT_SETTINGS: `uiLanguage: 'it'`; normalizza in normalizeSettings)
- Modify: `options/options.html` (carica `../utils/i18n.js`; aggiungi `<select id="ui-language">` con it/en)
- Modify: `options/options.js` (carica/salva `uiLanguage`; al cambio applica `I18n.applyI18n(document, lang)`)
- Test: estendi `tests/passaggio1-foundation.test.js` NON necessario; basta `node --check`.

- [ ] **Step 1:** In `schemas/app-schema.js`, aggiungi `uiLanguage: 'it'` a `DEFAULT_SETTINGS` e in `normalizeSettings` aggiungi `uiLanguage: ['it','en'].includes(settings.uiLanguage) ? settings.uiLanguage : 'it'`.
- [ ] **Step 2:** In `options/options.html`, aggiungi `<script src="../utils/i18n.js"></script>` prima di `options.js` e un campo:

```html
<label data-i18n="options.language">Lingua interfaccia</label>
<select id="ui-language"><option value="it">Italiano</option><option value="en">English</option></select>
```

- [ ] **Step 3:** In `options/options.js`, al load imposta `select.value = settings.uiLanguage || 'it'` e `I18n.applyI18n(document, settings.uiLanguage || 'it')`; al change salva la nuova lingua in settings (`SAVE_SETTINGS`) e riapplica `I18n.applyI18n(document, lang)`.
- [ ] **Step 4:** Verifica: `node --check schemas/app-schema.js options/options.js` e `node tests/passaggio1-foundation.test.js`.
- [ ] **Step 5: Commit**

```bash
git add schemas/app-schema.js options/options.html options/options.js
git commit -m "feat(area5): selettore lingua interfaccia (it/en) in Impostazioni"
```

---

### Task 3: Applica i18n a popup e dashboard (stringhe chiave)

**Files:**
- Modify: `popup/popup.html` (carica `../utils/i18n.js`; aggiungi `data-i18n` alle stringhe chiave già presenti nel dizionario), `popup/popup.js` (applica al load)
- Modify: `dashboard/dashboard.html` (carica `../utils/i18n.js`; `data-i18n` su voci nav chiave), `dashboard/dashboard.js` (applica al load)

- [ ] **Step 1:** In `popup/popup.html`: aggiungi `<script src="../utils/i18n.js"></script>` prima di `popup.js`. Metti `data-i18n="popup.generate"` sul testo del bottone Genera, `data-i18n="popup.ocr"` sul bottone OCR, ecc. (solo sulle stringhe presenti nel dizionario; non inventare chiavi).
- [ ] **Step 2:** In `popup/popup.js`, all'avvio, dopo aver caricato i settings: `if (typeof I18n !== 'undefined') I18n.applyI18n(document, settings.uiLanguage || 'it');`.
- [ ] **Step 3:** In `dashboard/dashboard.html`: carica `../utils/i18n.js`; aggiungi `data-i18n` alle voci nav `dashboard.archive`/`dashboard.stats`/`dashboard.search` dove combaciano. In `dashboard/dashboard.js`, al load applica `I18n.applyI18n(document, settings.uiLanguage || 'it')`.
- [ ] **Step 4:** Verifica: `node --check popup/popup.js dashboard/dashboard.js`.
- [ ] **Step 5: Commit**

```bash
git add popup/popup.html popup/popup.js dashboard/dashboard.html dashboard/dashboard.js
git commit -m "feat(area5): applica i18n alle stringhe chiave di popup e dashboard"
```

---

### Task FINALE: Verifica Fase 5

- [ ] Run: `node tests/area5-i18n.test.js && node tests/passaggio1-foundation.test.js`
- [ ] Run: `node --check utils/i18n.js schemas/app-schema.js options/options.js popup/popup.js dashboard/dashboard.js`

## Self-Review
- Spec coverage: Area 5B → Task 1-3. ✓
- Placeholder scan: modulo i18n completo; le aggiunte `data-i18n` sono limitate alle chiavi del dizionario (regola: non inventare chiavi). ✓
- Type consistency: `I18n.t`, `I18n.applyI18n`, `settings.uiLanguage` coerenti. ✓
- Nota: copertura traduzioni volutamente parziale (stringhe chiave). Estendibile aggiungendo voci a `DICT` e attributi `data-i18n`.
