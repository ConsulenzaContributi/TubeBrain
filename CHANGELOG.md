# Changelog: TubeBrain

Tutte le modifiche significative a questo progetto (codice, UI, funzionalità) saranno documentate in questo file.
Il formato è basato su [Keep a Changelog](https://keepachangelog.com/it-IT/1.0.0/).

---

## [2.5.0] - 2026-05-30

### Sicurezza (hardening)
- Rimosse API key reali hardcoded dallo schema; segreti (incluso `notionToken`) solo in `storage.local`, mai sincronizzati né loggati.
- Sanitizzazione XSS completa: helper `utils/sanitize.js` + audit di tutti gli `innerHTML` dinamici + test di regressione.
- Chiave Gemini inviata via header `x-goog-api-key` (non più in query string).
- `onMessage` (background, content-script, OCR): validazione del mittente (`sender.id`).
- `postMessage` (bridge dati YouTube): validazione `event.source === window` e `targetOrigin` ristretto a `location.origin`.

### Fase 1 — UX & funzioni studio
- Popup semplificato a **5 strumenti** (gruppi sopra i 14 toggle) + pannello "Avanzate".
- Viewer MDX navigabile: ricerca interna, scroll-spy, fisarmonica persistente, progresso "letto" con barra.
- Accodamento massivo: selezione multipla delle miniature + "accoda tutta la pagina".
- Menu tasto destro a 4 voci (accoda / accoda+segui / genera ora / priorità) + shortcut documentati.

### Fase 2 — Sicurezza & affidabilità
- `utils/net.js` `fetchWithRetry`: timeout, backoff esponenziale, gestione 429/`Retry-After` (Gemini + OpenAI).
- `core/queue-reconcile.js`: stato `extracting` + recupero estrazioni orfane allo startup (resilienza MV3).

### Fase 3 — Accuratezza
- Grounding: timestamp per sezione e marcatura `(inferenza)` nel prompt.
- Fallback sottotitoli auto-generati + stop pulito su video senza CC.
- `utils/cost.js`: stima token/costo e modello consigliato nel popup.

### Fase 4 — Apprendimento
- `utils/fsrs.js`: scheduler **FSRS** (sostituisce SM-2) + promemoria di ripasso giornaliero.
- `utils/analytics.js`: streak, retention, previsione card in scadenza.
- `utils/tfidf.js`: ricerca semantica **locale** (TF-IDF, zero dipendenze) — handler `LOCAL_SEARCH`.

### Fase 5 — Internazionalizzazione
- `utils/i18n.js`: i18n custom IT/EN con switch a runtime + selettore lingua nelle Impostazioni.

### Fase 6 — Integrazioni & PDF
- **AnkiConnect**: invio diretto delle flashcard ad Anki (`utils/ankiconnect.js`).
- **Notion**: esportazione dei riassunti come pagine (`utils/notion.js`).
- **Obsidian**: sincronizzazione dell'intero archivio nel vault.
- **PDF**: ingestione di PDF via pdf.js (`vendor/pdfjs/`) → analisi AI come per gli articoli.

## [A1.0.1] - 2026-05-29

### Aggiunto
- **External Onboarding Wizard**: L'interfaccia di primo avvio è stata spostata dal piccolo popup a una nuova scheda dedicata a schermo intero per garantire massima stabilità durante la configurazione iniziale.
- **Selezione Motore AI**: Ora è possibile scegliere esplicitamente se usare Google Gemini o OpenAI al primo avvio, con guide integrate e link diretti per la generazione delle rispettive API Keys.
- **Contatore ETA**: Inserito un sistema dinamico (Velocity Tracker) che stima in tempo reale i secondi rimanenti (`ETA`) per tutte le operazioni di estrazione AI.
- **Onboarding File System**: Richiesta e connessione semplificata per autorizzare una cartella nativa sul Mac.

## [A1.0.0] - 2026-05-29
### Aggiunto
- **Rebranding Completo**: L'estensione precedentemente nota come "YouTube Learn" / "Learning Hub" è stata ufficialmente rinominata in **TubeBrain**.
- **Cartella Risorse Grafiche (`brand_assets/`)**: Creata una cartella dedicata per raccogliere i loghi ufficiali ad alta risoluzione (`logo_square.png` e `logo_banner.png`).
- **Icone Ufficiali Applicate**: Resettate e rigenerate le icone ufficiali dell'estensione (`icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`) in formato PNG reale partendo dal nuovo logo quadrato di TubeBrain, risolvendo l'incongruenza della vecchia icona di default su Chrome.
- **Deep Extract Universale (Motore a 4 Fasi)**: Implementato il nuovo motore orchestratore AI in `utils/gemini.js` per gestire l'estrazione gerarchica dei video:
  - Fase 1: Generazione Indice (TOC).
  - Fase 2 & 3: Estrazione Granulare e Metadati Globali in parallelo.
  - Fase 4: Assemblaggio strutturato in Markdown.
  - Fase 1: Generazione Indice (TOC).
  - Fase 2 & 3: Estrazione Granulare e Metadati Globali in parallelo.
  - Fase 4: Assemblaggio strutturato in Markdown.
- **Integrazione Motore OCR Locale (Tesseract.js)**: Incorporate le logiche e le librerie del plugin `youtube-ocr-copy`. Ora TubeBrain è in grado di leggere il testo a schermo nei video (es. lavagne, codice, slide) semplicemente tracciando un'area di selezione (`Ctrl+Shift+O` o `Cmd+Shift+O`). L'estrazione avviene interamente in locale sfruttando il motore WebAssembly di Tesseract.
- **Supporto Modelli Gemini Aggiornato**: Integrata la lista definitiva dei modelli Gemini consigliati (`gemini-2.5-flash-lite`, `gemini-2.5-flash`, `gemini-3.0-flash`, `gemini-2.5-pro`, `gemini-3.5-flash`, `gemini-3.1-pro`) e confermato `gemini-2.5-flash` come modello predefinito in assoluto.
- **Log Aggiornamenti**: Aggiunto questo file `CHANGELOG.md` per tracciare ogni singola modifica tecnica e concettuale futura.

### Modificato
- Sostituite tutte le stringhe, ID e riferimenti HTML/JS al vecchio nome nelle schermate di Dashboard, Options e Popup.
- Bump della versione nel `manifest.json` da `2.14.0` a `1.0.0` (versione utente: `A1.0.0`).
