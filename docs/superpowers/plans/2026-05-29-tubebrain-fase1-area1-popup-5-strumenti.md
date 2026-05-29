# TubeBrain Fase 1 — Area 1: Popup 5 strumenti — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire i 14 toggle del popup con 5 strumenti raggruppati per obiettivo di studio, mantenendo i 14 toggle granulari in un pannello "Avanzate".

**Architecture:** Layer UI sopra i 14 booleani `mdxSections` esistenti. Lo schema espone una mappa gruppo→sezioni e due funzioni pure (`mdxGroupState`, `applyMdxGroupToggle`) testabili con Node. Il popup rende 5 toggle derivati dallo stato dei figli; un expander mostra i 14 controlli fini. Nessuna migrazione dati.

**Tech Stack:** Vanilla JS (Chrome MV3), test Node con `assert`, nessuna dipendenza nuova.

---

### Task 1: Modello dati gruppi nello schema

**Files:**
- Modify: `schemas/app-schema.js` (aggiunta `MDX_TOOL_GROUPS` e funzioni dopo `MDX_SECTION_CATALOG`)
- Test: `tests/area1-tool-groups.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/area1-tool-groups.test.js
const assert = require('assert');
const AppSchema = require('../schemas/app-schema.js');

// La mappa gruppi esiste e copre solo chiavi valide del catalogo
const catalogKeys = new Set(AppSchema.MDX_SECTION_CATALOG.map(s => s.key));
assert.ok(Array.isArray(AppSchema.MDX_TOOL_GROUPS), 'MDX_TOOL_GROUPS deve essere un array');
assert.equal(AppSchema.MDX_TOOL_GROUPS.length, 5, 'devono esserci 5 gruppi');
AppSchema.MDX_TOOL_GROUPS.forEach(g => {
  assert.ok(g.key && g.label && Array.isArray(g.sections) && g.sections.length, `gruppo ${g.key} malformato`);
  g.sections.forEach(k => assert.ok(catalogKeys.has(k), `sezione ${k} non nel catalogo`));
});

// personalNotes non appartiene ad alcun gruppo
const grouped = new Set(AppSchema.MDX_TOOL_GROUPS.flatMap(g => g.sections));
assert.ok(!grouped.has('personalNotes'), 'personalNotes non deve stare in un gruppo');

// mdxGroupState: on / off / mixed
const allOn = AppSchema.normalizeMdxSections({});
assert.equal(AppSchema.mdxGroupState(allOn, 'study'), 'on');
const allOff = {};
AppSchema.MDX_SECTION_CATALOG.forEach(s => { allOff[s.key] = false; });
assert.equal(AppSchema.mdxGroupState(allOff, 'study'), 'off');
const mixed = { ...allOff, studyGuide: true };
assert.equal(AppSchema.mdxGroupState(mixed, 'study'), 'mixed');

// applyMdxGroupToggle non muta l'input e cambia solo i figli del gruppo
const before = AppSchema.normalizeMdxSections({});
const after = AppSchema.applyMdxGroupToggle(before, 'memorize', false);
assert.equal(before.flashcards, true, 'input non deve mutare');
assert.equal(after.flashcards, false);
assert.equal(after.finalQuiz, false);
assert.equal(after.errorsRecovery, false);
assert.equal(after.studyGuide, true, 'sezioni di altri gruppi invariate');
assert.equal(after.personalNotes, before.personalNotes, 'personalNotes invariato');

console.log('area1-tool-groups OK');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/area1-tool-groups.test.js`
Expected: FAIL — `MDX_TOOL_GROUPS deve essere un array` (proprietà non definita).

- [ ] **Step 3: Write minimal implementation**

In `schemas/app-schema.js`, subito dopo la chiusura di `MDX_SECTION_CATALOG: [ ... ],` (riga ~21) inserisci:

```js
  MDX_TOOL_GROUPS: [
    { key: 'transcript',  label: '📝 Trascrizione',   sections: ['verbatimTranscript'] },
    { key: 'study',       label: '🎓 Studio guidato', sections: ['studyGuide', 'quickSummary', 'conceptMap', 'operationalGlossary'] },
    { key: 'memorize',    label: '🧠 Memorizzazione', sections: ['flashcards', 'finalQuiz', 'errorsRecovery'] },
    { key: 'practice',    label: '🛠️ Pratica',        sections: ['interactiveTimeline', 'executionChecklist', 'tutorialReplication'] },
    { key: 'antigravity', label: '🤖 Antigravity',    sections: ['antigravityInstructions', 'antigravityPrompt'] },
  ],

  mdxGroupState(mdxSections = {}, groupKey) {
    const group = this.MDX_TOOL_GROUPS.find(g => g.key === groupKey);
    if (!group) return 'off';
    const on = group.sections.filter(k => Boolean(mdxSections[k])).length;
    if (on === 0) return 'off';
    if (on === group.sections.length) return 'on';
    return 'mixed';
  },

  applyMdxGroupToggle(mdxSections = {}, groupKey, value) {
    const group = this.MDX_TOOL_GROUPS.find(g => g.key === groupKey);
    const next = { ...mdxSections };
    if (!group) return next;
    group.sections.forEach(k => { next[k] = Boolean(value); });
    return next;
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/area1-tool-groups.test.js`
Expected: PASS — stampa `area1-tool-groups OK`.

- [ ] **Step 5: Commit**

```bash
git add schemas/app-schema.js tests/area1-tool-groups.test.js
git commit -m "feat(area1): mappa gruppi MDX + stato/toggle gruppo (schema)"
```

---

### Task 2: Markup popup per 5 strumenti + Avanzate

**Files:**
- Modify: `popup/popup.html` (contenitore `popup-mdx-sections-list` e dintorni)

- [ ] **Step 1: Trova il blocco esistente**

Run: `grep -n "popup-mdx-sections-list\|popup-mdx-structure\|enable-all-sections" popup/popup.html`
Expected: trovi il contenitore `id="popup-mdx-sections-list"` e i pulsanti enable/disable all.

- [ ] **Step 2: Inserisci il contenitore dei 5 gruppi e l'expander Avanzate**

Subito **prima** dell'elemento con `id="popup-mdx-sections-list"`, aggiungi:

```html
<div id="popup-mdx-tools-list" class="popup-tools-list"></div>
<details id="popup-mdx-advanced" class="popup-advanced">
  <summary>⚙️ Avanzate (controllo per sezione)</summary>
```

E **subito dopo** la chiusura del contenitore `popup-mdx-sections-list` (il suo `</div>`), aggiungi la chiusura del `<details>`:

```html
</details>
```

(Così i 14 toggle esistenti restano identici, ma annidati dentro "Avanzate".)

- [ ] **Step 3: Commit**

```bash
git add popup/popup.html
git commit -m "feat(area1): markup 5 strumenti + expander Avanzate nel popup"
```

---

### Task 3: Rendering e logica dei 5 toggle nel popup

**Files:**
- Modify: `popup/popup.js` (funzioni di rendering/apply, righe ~114-143)

- [ ] **Step 1: Aggiungi il riferimento ai gruppi**

Dopo la definizione di `POPUP_MDX_SECTION_CATALOG` (riga ~17-18), aggiungi:

```js
const POPUP_MDX_TOOL_GROUPS = (typeof AppSchema !== 'undefined' && Array.isArray(AppSchema.MDX_TOOL_GROUPS))
  ? AppSchema.MDX_TOOL_GROUPS
  : [];
```

- [ ] **Step 2: Renderizza i 5 gruppi**

Dentro `renderPopupMdxSectionSettings()` (riga ~114), prima del `return`/fine funzione, aggiungi il rendering dei gruppi:

```js
  const groupsContainer = $('popup-mdx-tools-list');
  if (groupsContainer && POPUP_MDX_TOOL_GROUPS.length) {
    groupsContainer.innerHTML = POPUP_MDX_TOOL_GROUPS.map(group => `
      <label class="popup-check-item popup-tool-item">
        <input type="checkbox" data-popup-mdx-group="${group.key}">
        <span>${group.label}</span>
      </label>
    `).join('');
    groupsContainer.querySelectorAll('[data-popup-mdx-group]').forEach(input => {
      input.addEventListener('change', () => {
        currentMdxSections = AppSchema.applyMdxGroupToggle(
          collectPopupMdxSectionSettings(),
          input.getAttribute('data-popup-mdx-group'),
          input.checked,
        );
        applyPopupMdxSectionSettings(currentMdxSections);
        savePopupMdxSections();
      });
    });
  }
```

- [ ] **Step 3: Sincronizza lo stato dei gruppi quando applichi le sezioni**

In `applyPopupMdxSectionSettings(mdxSections)` (riga ~125), dopo il ciclo `forEach` esistente, aggiungi:

```js
  document.querySelectorAll('[data-popup-mdx-group]').forEach(groupInput => {
    const state = AppSchema.mdxGroupState(mdxSections, groupInput.getAttribute('data-popup-mdx-group'));
    groupInput.checked = state === 'on';
    groupInput.indeterminate = state === 'mixed';
  });
```

- [ ] **Step 4: Verifica manuale di carico**

Run: `node -e "require('./popup/popup.js')" 2>/dev/null || echo "popup.js usa API browser: verifica solo sintassi"`
Run: `node --check popup/popup.js`
Expected: nessun errore di sintassi.

- [ ] **Step 5: Commit**

```bash
git add popup/popup.js
git commit -m "feat(area1): 5 toggle gruppo nel popup con stato derivato e salvataggio"
```

---

### Task 4: Stile dei nuovi controlli

**Files:**
- Modify: `popup/popup.html` (blocco `<style>`) oppure il CSS del popup collegato

- [ ] **Step 1: Individua il foglio di stile del popup**

Run: `grep -n "popup-check-item" popup/popup.html popup/*.css 2>/dev/null`
Expected: trovi la regola esistente `.popup-check-item`.

- [ ] **Step 2: Aggiungi le regole (accanto a `.popup-check-item`)**

```css
.popup-tools-list { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px; }
.popup-tool-item { font-weight: 600; }
.popup-advanced { margin-top: 6px; }
.popup-advanced > summary { cursor: pointer; font-size: 12px; opacity: .8; }
```

- [ ] **Step 3: Commit**

```bash
git add popup/popup.html
git commit -m "style(area1): griglia 5 strumenti e pannello Avanzate"
```

---

### Task 5: Verifica manuale end-to-end

- [ ] **Step 1: Carica l'estensione**

In `chrome://extensions` → "Carica estensione non pacchettizzata" → cartella `TubeBrainClaude` (o ricarica se già caricata).

- [ ] **Step 2: Apri un video YouTube e il popup**

Verifica: vedi 5 strumenti. Disattivando "🧠 Memorizzazione" si deselezionano flashcard+quiz+errori. Aprendo "⚙️ Avanzate" vedi i 14 toggle coerenti. Riattivando una sola sotto-sezione, il gruppo mostra lo stato "misto" (checkbox indeterminata).

- [ ] **Step 3: Genera un MDX**

Verifica che vengano incluse solo le sezioni dei gruppi attivi e che "Appunti personali" sia sempre presente.

- [ ] **Step 4: Run dei test esistenti (no regressioni)**

Run: `node tests/passaggio1-foundation.test.js && node tests/area1-tool-groups.test.js`
Expected: nessun assert fallito.

---

## Self-Review

- **Spec coverage:** Sezione spec "1. Popup: 5 strumenti" → Task 1-5. ✓
- **Placeholder scan:** nessun TBD/TODO; codice completo in ogni step. ✓
- **Type consistency:** `mdxGroupState`, `applyMdxGroupToggle`, `MDX_TOOL_GROUPS`, attributi `data-popup-mdx-group` coerenti tra Task 1 e Task 3. ✓
- Nota: `personalNotes` resta gestito dal flusso esistente (sempre attivo), non toccato qui.
