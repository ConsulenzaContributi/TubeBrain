# Changelog: TubeBrainC

Tutte le modifiche significative a questo progetto (codice, UI, funzionalità) saranno documentate in questo file.
Il formato è basato su [Keep a Changelog](https://keepachangelog.com/it-IT/1.0.0/).

---

## [1.7.0] - 2026-06-21

### ✨ Novità
- Pulsante OCR "📸 Cattura Testo a Schermo" ora disponibile anche nella schermata per pagine non-YouTube (stato `not-youtube`): l'OCR è ora accessibile da qualsiasi pagina web, non solo sui video YouTube.
- Logica OCR estratta nella funzione condivisa `launchOcr()` in `popup.js`, collegata sia a `btn-ocr` (stato video YouTube) sia al nuovo `btn-ocr-nyt` (tutte le altre pagine).

## [1.6.0] - 2026-06-21

### ✨ Novità
- Prima implementazione del pulsante OCR aggiuntivo nello stato non-YouTube (`btn-ocr-nyt`) e refactoring iniziale della logica OCR.

## [1.5.1] - 2026-06-21

### ♻️ Modifiche
- Troncato il titolo del video nel nome dei file a 20 caratteri per evitare nomi troppo lunghi e riabilitata l'aggiunta del suffisso (es. risoluzione) nel nome finale del file se fornito.

## [1.5.0] - 2026-06-21

### ✨ Novità
- Suffisso dinamico della risoluzione (es. _360p) al nome del file generato da yt-dlp per risolvere il problema dei file saltati (already downloaded) ed etichettare correttamente la qualità scelta.

## [1.4.1] - 2026-06-21

### 🐛 Correzioni
- Aggiunti filtri [ext=mp4] e [ext=m4a] alla generazione dei comandi yt-dlp per forzare lo scaricamento esclusivo dei codec H264 e AAC. Risolve l'incompatibilità su Mac (QuickTime) che impediva la riproduzione del flusso video quando yt-dlp scaricava codec VP9/Opus (WebM) forzandoli in un contenitore .mp4.

## [1.4.0] - 2026-06-21

### ✨ Novità
- Campo "Percorso Assoluto Base" nelle opzioni dell'estensione per permettere all'utente di definire un percorso assoluto locale (es. /Volumes/... o C:\...) usato esclusivamente per i comandi di yt-dlp via terminale. Risolve il problema del salvataggio dei file video nella directory Home (~/) del terminale anziché nella reale cartella dei Download (es. drive esterni).

## [1.3.7] - 2026-06-21

### 🐛 Correzioni
- Generazione del comando yt-dlp per impedire l'aggiunta dell'estensione .webm al file .mp4 forzando --merge-output-format mp4. Implementato l'escape dei caratteri speciali % (come %%) per impedire errori di parsing nei template di output di yt-dlp.

## [1.3.6] - 2026-06-21

### 🐛 Correzioni
- Layout e impaginazione della notifica toast popup. Rimosso white-space: nowrap, aggiunta larghezza massima e andata a capo per evitare il taglio del testo. Formattato il titolo in grassetto su una riga separata per una migliore leggibilità.

## [1.3.5] - 2026-06-21

### ♻️ Modifiche
- Rimosso pulsante download video diretto su YouTube per prevenire fallimenti (errori 403 / salvataggi .txt). Introdotto comando yt-dlp avanzato con parametro -o per forzare il salvataggio nella stessa directory e con lo stesso nome esatto della feature Genera Studio.

## [1.3.4] - 2026-06-21

### 🐛 Correzioni
- Impostato 360p come risoluzione predefinita all'apertura del modal.

### ♻️ Modifiche
- Aggiunto avviso visivo in UI per i download bloccati da YouTube con salvataggio forzato come file .txt.

## [1.3.3] - 2026-06-21

### ♻️ Modifiche
- updateModalUI() e getDownloadPathsForVideo() — fix visibilità convertitore online, rimosso suffisso risoluzione, aggiunto pulsante standalone sottotitoli.

## [1.3.2] - 2026-06-21

### 🐛 Correzioni
- Risolta la mancata rilevazione e il fallimento del download diretto per i flussi video e audio di YouTube.
- Sincronizzata la visibilità del pannello di split download e dei pulsanti "Video Solo" e "Audio Solo" in base all'effettiva presenza di URL validi non cifrati nel player response di YouTube.
- Migliorato il download dei sottotitoli YouTube tramite il servizio nativo timedtext (VTT) associato alla lingua specificata, con fallback sui segmenti di trascrizione generati per la massima compatibilità.

## [1.3.1] - 2026-06-21

### ♻️ Modifiche
- Allineato il percorso e il nome dei file video, audio e sottotitoli scaricati affinché vengano salvati nella stessa cartella e con lo stesso nome identificativo generato da "Genera Studio" (risolvendo il path in `LearningHub/${dossierFolder}/${pubDate}_${channelFolder}_${titleSafe}`).

## [1.3.0] - 2026-06-21

### ✨ Novità
- Introduzione di una finestra dedicata (modal overlay con slide-up ed effetto glassmorphic blur) per la configurazione avanzata delle preferenze di download.
- Possibilità di scegliere il tipo di file da scaricare tra *Video + Audio* (completo) e *Solo Audio* (estratto/nativo).
- Opzioni di selezione della risoluzione/qualità video per YouTube (Migliore disponibile, 1080p, 720p, 480p, 360p).
- Opzioni di selezione del formato di esportazione audio (MP3 convertito, M4A nativo, WebM Opus).
- Logica intelligente per gestire le restrizioni dei flussi di YouTube: download diretto dal browser per flussi progressivi 360p/720p o audio nativi, opzioni di download separato delle tracce Video/Audio per formati DASH non-progressivi (es. 1080p), e indicazioni per flussi cifrati/protetti.
- Risolto un bug di visibilità nel popup inserendo la classe globale `.hidden { display: none !important; }` nel CSS per evitare che pulsanti di terze parti (come HLS/ffmpeg) si sovrapponessero su YouTube.

## [1.2.0] - 2026-06-21

### ✨ Novità
- Aggiunta l'opzione nelle impostazioni per scaricare automaticamente i sottotitoli in formato WebVTT (.vtt) insieme al video.
- Implementata la conversione al volo dei segmenti di trascrizione interni in formato WebVTT per i video di YouTube.
- Supportato il download delle tracce di sottotitoli/didascalie rilevate nel DOM per siti terzi generici.
- Sincronizzati i nomi dei file del video e dei sottotitoli nella cartella di destinazione `LearningHub/Videos/` per consentire il caricamento automatico da parte dei media player locali.

## [1.1.0] - 2026-06-21

### ✨ Novità
- Aggiunta la funzionalità di download video/audio direttamente dal popup dell'estensione.
- Esteso il supporto del plugin a qualsiasi sito web contenente elementi video (es. Vimeo, player HTML5 generici) oltre a YouTube.
- Supportati flussi di download progressivi (.mp4) tramite l'API `chrome.downloads`.
- Fornite istruzioni e comandi pronti all'uso per `yt-dlp` e `ffmpeg` (per flussi segmentati HLS/M3U8) copiabili con un click.
- Aggiunti controlli di tolleranza per i metadati mancanti (like, visualizzazioni, ecc.) per garantire un funzionamento fluido su siti terzi.
- Aggiunta la configurazione del metodo di download e del servizio online preferito nelle Impostazioni dell'estensione.

## [1.0.5] - 2026-06-21

### 🐛 Correzioni
- Risolto l'errore di timeout avvio host (10s) nell'OCR su siti terzi (es. Instagram) aggiornando i pattern di `matches` in `web_accessible_resources` di `manifest.json` per abilitare l'iniezione locale dell'iframe di Tesseract su qualsiasi sito HTTP e HTTPS (`http://*/*` e `https://*/*`).

## [1.0.4] - 2026-06-20

### 🐛 Correzioni
- Risolto l'errore diagnostico `panel=ok-dom-empty` in `popup/popup.js`, `content-script.js` e `background.js` tramite l'introduzione di controlli di visibilità (`isVisible`), esclusione dei pannelli di descrizione per evitare falsi positivi, scansione avanzata e multilingua dei pulsanti di trascrizione, e tolleranza migliorata sulle righe brevi nell'estrattore basato su `innerText`.

## [1.0.3] - 2026-06-20

### ♻️ Modifiche
- Incremento di versione a `1.0.3` a seguito del consolidamento dei test asincroni del parser DOM Fallback.

## [1.0.2] - 2026-06-20

### 🏗️ Ristrutturazioni
- Effettuato il ripristino della codebase partendo dalla versione GitHub v1.0.1 ("trasposizione") ed eseguiti i porting dei fix critici del DOM Fallback in `background.js` e `popup.js`, integrazione di `unlimitedStorage` e pulizia chiavi per prevenire gli errori di quota di Chrome Storage, e apertura automatica del viewer MDX.

### 🐛 Correzioni
- Corretto il DOM Fallback facendo attendere il caricamento dei segmenti anziché ritornare immediatamente quando il pannello della trascrizione viene trovato ma è ancora vuoto.
- Spostata la ricerca del pulsante di trascrizione all'interno del ciclo di attesa per garantirne il rilevamento dopo l'espansione della descrizione del video.
- Integrata la logica di fallback asincrona per il parsing regex del `textContent` grezzo nei casi in cui YouTube rimuova le classi CSS dei sottotitoli.

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
- **Rebranding Completo**: L'estensione precedentemente nota come "YouTube Learn" / "Learning Hub" è stata ufficialmente rinominata in **TubeBrainC**.
- **Cartella Risorse Grafiche (`brand_assets/`)**: Creata una cartella dedicata per raccogliere i loghi ufficiali ad alta risoluzione (`logo_square.png` e `logo_banner.png`).
- **Icone Ufficiali Applicate**: Resettate e rigenerate le icone ufficiali dell'estensione (`icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`) in formato PNG reale partendo dal nuovo logo quadrato di TubeBrainC, risolvendo l'incongruenza della vecchia icona di default su Chrome.
- **Deep Extract Universale (Motore a 4 Fasi)**: Implementato il nuovo motore orchestratore AI in `utils/gemini.js` per gestire l'estrazione gerarchica dei video:
  - Fase 1: Generazione Indice (TOC).
  - Fase 2 & 3: Estrazione Granulare e Metadati Globali in parallelo.
  - Fase 4: Assemblaggio strutturato in Markdown.
  - Fase 1: Generazione Indice (TOC).
  - Fase 2 & 3: Estrazione Granulare e Metadati Globali in parallelo.
  - Fase 4: Assemblaggio strutturato in Markdown.
- **Integrazione Motore OCR Locale (Tesseract.js)**: Incorporate le logiche e le librerie del plugin `youtube-ocr-copy`. Ora TubeBrainC è in grado di leggere il testo a schermo nei video (es. lavagne, codice, slide) semplicemente tracciando un'area di selezione (`Ctrl+Shift+O` o `Cmd+Shift+O`). L'estrazione avviene interamente in locale sfruttando il motore WebAssembly di Tesseract.
- **Supporto Modelli Gemini Aggiornato**: Integrata la lista definitiva dei modelli Gemini consigliati (`gemini-2.5-flash-lite`, `gemini-2.5-flash`, `gemini-3.0-flash`, `gemini-2.5-pro`, `gemini-3.5-flash`, `gemini-3.1-pro`) e confermato `gemini-2.5-flash` come modello predefinito in assoluto.
- **Log Aggiornamenti**: Aggiunto questo file `CHANGELOG.md` per tracciare ogni singola modifica tecnica e concettuale futura.

### Modificato
- Sostituite tutte le stringhe, ID e riferimenti HTML/JS al vecchio nome nelle schermate di Dashboard, Options e Popup.
- Bump della versione nel `manifest.json` da `2.14.0` a `1.0.0` (versione utente: `A1.0.0`).
