# TubeBrain Fase 6 — Integrazioni + PDF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development o executing-plans.

**Goal:** AnkiConnect, Notion, Obsidian sync (una via), ingestione PDF (pdf.js).

**Architecture:** Builder puri testabili (`utils/ankiconnect.js`, `utils/notion.js`, parte pura di `utils/pdf-extract.js`) + handler background che usano `fetchWithRetry` + wiring UI minimale. pdf.js già in `vendor/pdfjs/`. Token Notion = segreto in storage.local.

---

### Task A1: Builder AnkiConnect

**Files:**
- Create: `utils/ankiconnect.js`
- Test: `tests/area6a-ankiconnect.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/area6a-ankiconnect.test.js
const assert = require('assert');
const Anki = require('../utils/ankiconnect.js');
const cards = [{ question: 'Q1', answer: 'A1' }, { question: 'Q2', answer: 'A2' }];
const payload = Anki.buildAddNotesPayload(cards, 'TubeBrain::Video X', 'Basic');
assert.equal(payload.action, 'addNotes');
assert.equal(payload.version, 6);
assert.equal(payload.params.notes.length, 2);
assert.equal(payload.params.notes[0].deckName, 'TubeBrain::Video X');
assert.equal(payload.params.notes[0].modelName, 'Basic');
assert.equal(payload.params.notes[0].fields.Front, 'Q1');
assert.equal(payload.params.notes[0].fields.Back, 'A1');
assert.deepEqual(payload.params.notes[0].options, { allowDuplicate: false });
// nessuna card → notes vuoto
assert.equal(Anki.buildAddNotesPayload([], 'D', 'Basic').params.notes.length, 0);
console.log('area6a-ankiconnect OK');
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```js
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
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit**

```bash
git add utils/ankiconnect.js tests/area6a-ankiconnect.test.js
git commit -m "feat(area6a): builder payload AnkiConnect (puro, testato)"
```

---

### Task A2: Handler ANKICONNECT_PUSH + UI

**Files:**
- Modify: `background.js` (importScripts + handler), `manifest.json` (host_permissions), `dashboard/dashboard.js` (pulsante)

- [ ] **Step 1:** In `manifest.json` `host_permissions`, aggiungi `"http://127.0.0.1:8765/*"`.
- [ ] **Step 2:** In `background.js` `importScripts`, aggiungi `'utils/ankiconnect.js',`.
- [ ] **Step 3:** Nel `switch` di `handleMessage` aggiungi:

```js
    case 'ANKICONNECT_PUSH': {
      const summaries = await Storage.getSummaries();
      const s = summaries.find(x => x.id === message.id);
      if (!s) throw new Error('Riepilogo non trovato');
      const cards = SR.parseFlashcardsFromMarkdown(s.fullMarkdown || s.markdown || '');
      if (!cards.length) return { success: false, error: 'Nessuna flashcard in questo documento.' };
      const deck = 'TubeBrain::' + (s.title || 'Video').slice(0, 60).replace(/[:]/g, '-');
      const payload = AnkiConnect.buildAddNotesPayload(cards, deck, 'Basic');
      try {
        const res = await NetUtils.fetchWithRetry('http://127.0.0.1:8765', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        }, { retries: 1, timeoutMs: 8000 });
        const data = await res.json();
        if (data.error) return { success: false, error: 'Anki: ' + data.error };
        return { success: true, added: (data.result || []).filter(Boolean).length };
      } catch (e) {
        return { success: false, error: 'Anki non raggiungibile. Apri Anki con l\'add-on AnkiConnect attivo.' };
      }
    }
```

- [ ] **Step 4:** In `dashboard/dashboard.js`, sull'item archivio aggiungi un pulsante "Invia ad Anki" che chiama `bg('ANKICONNECT_PUSH', { id })` e mostra feedback (success/added o error). Adatta al rendering reale; usa `escHtml`.
- [ ] **Step 5:** `node --check background.js dashboard/dashboard.js` e `node tests/area6a-ankiconnect.test.js`.
- [ ] **Step 6: Commit**

```bash
git add background.js manifest.json dashboard/dashboard.js
git commit -m "feat(area6a): handler ANKICONNECT_PUSH + pulsante Invia ad Anki"
```

---

### Task B1: Builder Notion

**Files:**
- Create: `utils/notion.js`
- Test: `tests/area6b-notion.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/area6b-notion.test.js
const assert = require('assert');
const Notion = require('../utils/notion.js');
const summary = { title: 'Mio Video', markdown: 'Riga uno.\n\nRiga due.' };
const p = Notion.buildPagePayload(summary, 'db123');
assert.equal(p.parent.database_id, 'db123');
assert.ok(p.properties.Name.title[0].text.content.includes('Mio Video'));
assert.ok(Array.isArray(p.children) && p.children.length >= 1);
assert.equal(p.children[0].type, 'paragraph');
// chunking: testo lungo spezzato in blocchi <= 2000 char
const long = { title: 'L', markdown: 'x'.repeat(4500) };
const pl = Notion.buildPagePayload(long, 'db');
assert.ok(pl.children.every(b => b.paragraph.rich_text[0].text.content.length <= 2000));
assert.ok(pl.children.length >= 3);
console.log('area6b-notion OK');
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```js
// utils/notion.js — Builder payload pagina Notion (puro)
(function (root) {
  function chunk(text, size) {
    const out = [];
    const s = String(text || '');
    for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
    return out.length ? out : [''];
  }
  function buildPagePayload(summary = {}, databaseId = '') {
    const body = summary.fullMarkdown || summary.markdown || '';
    const children = chunk(body, 2000).map(part => ({
      object: 'block', type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: part } }] },
    }));
    return {
      parent: { database_id: databaseId },
      properties: { Name: { title: [{ text: { content: String(summary.title || 'TubeBrain').slice(0, 200) } }] } },
      children,
    };
  }
  const api = { buildPagePayload };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.NotionExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit**

```bash
git add utils/notion.js tests/area6b-notion.test.js
git commit -m "feat(area6b): builder payload Notion (puro, chunking 2000)"
```

---

### Task B2: Segreti Notion + handler + UI

**Files:**
- Modify: `utils/storage.js` (SECRET_KEYS += notionToken), `schemas/app-schema.js` (default notionToken/notionDatabaseId), `background.js` (importScripts + handler `NOTION_EXPORT`), `manifest.json` (host_permissions), `options/options.html`+`options.js` (campi), `dashboard/dashboard.js` (pulsante)

- [ ] **Step 1:** In `utils/storage.js` aggiungi `'notionToken'` a `SECRET_KEYS`. In `schemas/app-schema.js` `DEFAULT_SETTINGS` aggiungi `notionToken: ''` e `notionDatabaseId: ''` (e normalizzali come stringhe in normalizeSettings).
- [ ] **Step 2:** `manifest.json` `host_permissions` += `"https://api.notion.com/*"`. `background.js` importScripts += `'utils/notion.js',`.
- [ ] **Step 3:** Handler nel switch:

```js
    case 'NOTION_EXPORT': {
      const settings = await Storage.getSettings();
      if (!settings.notionToken || !settings.notionDatabaseId) return { success: false, error: 'Configura token e database Notion nelle Impostazioni.' };
      const summaries = await Storage.getSummaries();
      const s = summaries.find(x => x.id === message.id);
      if (!s) throw new Error('Riepilogo non trovato');
      const payload = NotionExport.buildPagePayload(s, settings.notionDatabaseId);
      const res = await NetUtils.fetchWithRetry('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + settings.notionToken, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, { retries: 2, timeoutMs: 20000 });
      const data = await res.json();
      if (!res.ok) return { success: false, error: 'Notion: ' + (data && data.message || res.status) };
      return { success: true, url: data.url };
    }
```

- [ ] **Step 4:** In `options/options.html` aggiungi campi `#notion-token` e `#notion-db`; in `options.js` caricali/salvali in settings. In `dashboard/dashboard.js` aggiungi pulsante "Esporta su Notion" → `bg('NOTION_EXPORT', { id })`.
- [ ] **Step 5:** `node --check` sui file toccati + `node tests/area6b-notion.test.js` + `node tests/passaggio1-foundation.test.js`.
- [ ] **Step 6: Commit**

```bash
git add utils/storage.js schemas/app-schema.js background.js manifest.json options/options.html options/options.js dashboard/dashboard.js
git commit -m "feat(area6b): export Notion (segreto in storage.local, handler, UI)"
```

---

### Task C1: Obsidian sync-all

**Files:**
- Modify: `background.js` (handler `OBSIDIAN_SYNC_ALL`), `dashboard/dashboard.js` (pulsante)

- [ ] **Step 1:** Handler nel switch:

```js
    case 'OBSIDIAN_SYNC_ALL': {
      const summaries = (await Storage.getSummaries()).filter(s => s.status === 'extracted');
      let ok = 0, failed = 0;
      for (const s of summaries) {
        try {
          const md = ExportFormatters.buildObsidianMd(s);
          const safe = sanitizePath(s.title || s.id).slice(0, 60);
          await FileSystemUtils.trySaveToVault(`LearningHub/Obsidian/${safe}.md`, md);
          ok++;
        } catch (e) { failed++; }
      }
      return { success: true, synced: ok, failed };
    }
```
(Verifica che `sanitizePath` esista in background.js — è usato altrove; se il nome reale differisce, adattati.)

- [ ] **Step 2:** In `dashboard/dashboard.js` aggiungi pulsante "Sincronizza vault Obsidian" → `bg('OBSIDIAN_SYNC_ALL')` con feedback `synced/failed`.
- [ ] **Step 3:** `node --check background.js dashboard/dashboard.js`.
- [ ] **Step 4: Commit**

```bash
git add background.js dashboard/dashboard.js
git commit -m "feat(area6c): sincronizzazione una-via dell'archivio nel vault Obsidian"
```

---

### Task D1: Estrazione testo PDF (parte pura) + modulo

**Files:**
- Create: `utils/pdf-extract.js`
- Test: `tests/area6d-pdf.test.js`

- [ ] **Step 1: Write the failing test** (parte pura `joinPdfPages`)

```js
// tests/area6d-pdf.test.js
const assert = require('assert');
const Pdf = require('../utils/pdf-extract.js');
assert.equal(typeof Pdf.joinPdfPages, 'function');
assert.equal(Pdf.joinPdfPages(['pagina uno', '  ', 'pagina due']), 'pagina uno\n\npagina due');
assert.equal(Pdf.joinPdfPages([]), '');
assert.equal(Pdf.joinPdfPages(['  solo spazi  ']), 'solo spazi');
console.log('area6d-pdf OK');
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** (parte pura in Node + estrazione browser con pdf.js via import dinamico)

```js
// utils/pdf-extract.js — Estrazione testo da PDF (pdf.js) + helper puri
(function (root) {
  function joinPdfPages(pages = []) {
    return (pages || []).map(p => String(p || '').trim()).filter(Boolean).join('\n\n');
  }

  // Browser-only: usa pdf.js da vendor/. Ritorna il testo completo.
  async function extractText(arrayBuffer) {
    if (typeof window === 'undefined' || typeof chrome === 'undefined' || !chrome.runtime) {
      throw new Error('extractText disponibile solo nel browser.');
    }
    const pdfjsLib = await import(chrome.runtime.getURL('vendor/pdfjs/pdf.min.mjs'));
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.min.mjs');
    const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map(it => it.str).join(' '));
    }
    return joinPdfPages(pages);
  }

  const api = { joinPdfPages, extractText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PdfExtract = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit**

```bash
git add utils/pdf-extract.js tests/area6d-pdf.test.js
git commit -m "feat(area6d): modulo estrazione PDF (pdf.js) + helper puro joinPdfPages"
```

---

### Task D2: UI import PDF nella dashboard

**Files:**
- Modify: `dashboard/dashboard.html` (file input + script), `dashboard/dashboard.js` (handler import)

- [ ] **Step 1:** In `dashboard/dashboard.html`, aggiungi un controllo "Importa PDF": `<input type="file" id="pdf-import" accept="application/pdf">` e un feedback. Carica `../utils/pdf-extract.js` come `<script type="module">`? NB: pdf.js è ESM; usa un piccolo modulo. In alternativa importa dinamicamente dentro dashboard.js.
- [ ] **Step 2:** In `dashboard/dashboard.js`, al change del file: leggi `arrayBuffer`, `const text = await PdfExtract.extractText(buf)` (import dinamico del modulo se necessario), poi invia a `bg('ANALYZE_WEBPAGE', { articleData: { title: file.name.replace(/\.pdf$/i,''), text, url: 'pdf://' + file.name } })` e mostra l'esito. Riusa il rendering/feedback esistente; non duplicare.
- [ ] **Step 3:** `node --check dashboard/dashboard.js`.
- [ ] **Step 4: Commit**

```bash
git add dashboard/dashboard.html dashboard/dashboard.js
git commit -m "feat(area6d): import PDF in dashboard → analisi AI (riusa analyzeWebpage)"
```

---

### Task FINALE: Verifica Fase 6

- [ ] Run: `node tests/area6a-ankiconnect.test.js && node tests/area6b-notion.test.js && node tests/area6d-pdf.test.js`
- [ ] Run: `node tests/passaggio1-foundation.test.js`
- [ ] Run: `node --check utils/ankiconnect.js utils/notion.js utils/pdf-extract.js background.js dashboard/dashboard.js options/options.js schemas/app-schema.js utils/storage.js`
- [ ] Verifica `manifest.json` valido (JSON.parse) e che `vendor/pdfjs/*.mjs` esistano.

## Self-Review
- Spec coverage: 6A→A1/A2, 6B→B1/B2, 6C→C1, 6D→D1/D2. ✓
- Placeholder scan: codice completo per i 3 builder puri + handler; wiring UI best-effort con regola di adattamento. ✓
- Type consistency: `AnkiConnect.buildAddNotesPayload`, `NotionExport.buildPagePayload`, `PdfExtract.{joinPdfPages,extractText}`, `notionToken` in SECRET_KEYS coerenti. ✓
- Sicurezza: token Notion solo in storage.local; fetch via fetchWithRetry; AnkiConnect locale.
