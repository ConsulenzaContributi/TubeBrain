# TubeBrain — Fase 6: Integrazioni + PDF — Design

Data: 2026-05-30
Stato: approvato (AnkiConnect + Notion + Obsidian sync + PDF via pdf.js)
Branch: `security/hardening-v2.1.0`

## Obiettivo
Aprire TubeBrain verso l'ecosistema: invio diretto ad Anki, esportazione su Notion,
sincronizzazione vault Obsidian, e ingestione di PDF come fonte di studio.

## Stato di partenza (verificato)
- `renderers/export-formatters.js`: `buildAnkiCsv`/`buildObsidianMd` già presenti (export file).
- `utils/filesystem.js`: `trySaveToVault(relativePath, content)` + handle vault già presenti.
- `analyzeWebpage(articleData)` + `buildArticlePrompt` già gestiscono testo→AI (riusabili per PDF).
- `utils/net.js` `fetchWithRetry` disponibile per le chiamate di rete.
- `vendor/pdfjs/` con `pdf.min.mjs` + `pdf.worker.min.mjs` (pdf.js 4.2.67) scaricati.

## Aree

### Area 6A — AnkiConnect
- `utils/ankiconnect.js` (puro): `buildAddNotesPayload(cards, deckName, modelName)` → corpo JSON
  per `action:'addNotes', version:6`. `cards` = flashcard estratte dal markdown.
- Handler background `ANKICONNECT_PUSH` (summaryId, deck): estrae flashcard, costruisce payload,
  `fetchWithRetry('http://127.0.0.1:8765', ...)`, gestisce errori (Anki non in esecuzione).
- UI: pulsante "Invia ad Anki" nella dashboard (sull'item archivio).
- Manifest: `host_permissions` += `http://127.0.0.1:8765/*`.

### Area 6B — Notion
- `utils/notion.js` (puro): `buildPagePayload(summary, databaseId)` → pagina Notion con titolo +
  blocchi paragrafo derivati dal markdown (chunked ≤ 2000 char per blocco, limite API).
- `settings.notionToken`, `settings.notionDatabaseId` (segreti → storage.local come le API key).
- Handler background `NOTION_EXPORT` (summaryId): `fetchWithRetry('https://api.notion.com/v1/pages', ...)`
  con header `Authorization`, `Notion-Version: 2022-06-28`.
- UI: campi token/DB nelle Impostazioni + pulsante "Esporta su Notion" nella dashboard.
- Manifest: `host_permissions` += `https://api.notion.com/*`.

### Area 6C — Obsidian sync (una via)
- Handler `OBSIDIAN_SYNC_ALL`: per ogni summary estratto, `FileSystemUtils.trySaveToVault(path, md)`
  usando `ExportFormatters.buildObsidianMd`. UI: pulsante "Sincronizza vault" nella dashboard.
- Nessun nuovo permesso (usa l'handle vault esistente).

### Area 6D — Ingestione PDF
- `utils/pdf-extract.js`: wrapper su pdf.js. `extractText(arrayBuffer)` → testo concatenato
  (imposta `workerSrc` a `chrome.runtime.getURL('vendor/pdfjs/pdf.worker.min.mjs')`).
  Parte pura testabile: `joinPdfPages(pagesText)` (normalizza/concatena).
- UI: "Importa PDF" (file input) in dashboard → estrae testo → invia a `analyzeWebpage`
  come `articleData { title, text, url:'pdf://<nome>' }` (riusa il flusso articolo→AI).
- Manifest: `vendor/pdfjs/*.mjs` accessibili dalle pagine estensione (getURL; nessun WAR per pagine proprie).

## Sicurezza
- Token Notion = segreto: salvato solo in `storage.local` (riusa `Storage.SECRET_KEYS`).
- Tutte le fetch passano da `fetchWithRetry` (timeout/backoff).
- AnkiConnect è locale (127.0.0.1): nessun dato esce dal dispositivo.

## Roadmap residua
- Sync bidirezionale (lettura modifiche dal vault) — non fattibile in modo affidabile da estensione, escluso.
