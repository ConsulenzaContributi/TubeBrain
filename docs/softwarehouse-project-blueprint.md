# Blueprint Progetto

## Nome progetto

`Codex Chrome Plugin YouTube Learn v2.0`

## Obiettivo

Realizzare un'estensione Chrome professionale che trasformi contenuti video, con priorita a YouTube, in documenti `MDX` ottimizzati per apprendimento, ripasso, replicazione operativa e automazione tramite agenti AI.

L'estensione deve partire dalla trascrizione completa del video e generare un archivio di apprendimento strutturato, navigabile e riutilizzabile.

## Visione prodotto

Il prodotto non deve essere un semplice "riassuntore di video", ma un sistema di apprendimento operativo che:

- estrae la trascrizione completa
- preserva capitoli e sottocapitoli
- produce tre livelli di approfondimento nello stesso file
- genera output pronti per studio e riproduzione pratica
- crea istruzioni operative per Google Antigravity
- genera una mappa concettuale
- costruisce un archivio personale di knowledge base

## Deliverable finale richiesto

Una Chrome Extension MV3 installabile e testabile che includa:

- popup operativo
- options page
- dashboard archivio
- background service worker
- pipeline di estrazione trascrizione
- pipeline AI di generazione contenuti
- export `MDX` come formato primario
- export opzionali `JSON` e `TXT`
- documentazione tecnica e utente
- test plan e checklist QA

## Output principale del prodotto

Per ogni video deve essere generato un file `MDX` unico con queste sezioni:

### 1. Trascrizione integrale

- trascrizione fedele del video
- nessuna sintesi
- capitoli e sottocapitoli mantenuti
- timestamp preservati quando disponibili

### 2. Studio guidato

- capitoli e sottocapitoli ottimizzati per apprendimento
- spiegazione di cosa si impara
- passaggi operativi
- checklist studio
- errori da evitare
- comandi, codice, file e configurazioni riconosciuti dal parlato
- istruzioni operative separate per ambiente Google Antigravity

### 3. Sintesi rapida

- capitoli e sottocapitoli mantenuti
- sintesi per capitolo
- massimo 500 caratteri per capitolo

### 4. Mappa concettuale

- output in `mermaid`
- nodo centrale, capitoli principali, sotto-concetti, strumenti, output e criticita

## Funzioni principali obbligatorie

### Estrazione contenuto

- rilevamento automatico del video YouTube aperto
- lettura metadata video
- recupero caption track migliore
- supporto sottotitoli manuali e auto-generated
- gestione fallback quando la trascrizione non e disponibile
- mantenimento dei capitoli YouTube quando presenti

### Generazione learning document

- generazione file `MDX`
- scelta modalita iniziale da popup: `verbatim`, `study`, `summary`
- creazione documento con tutte e tre le modalita nello stesso file
- supporto a video tecnici e tutorial con ricostruzione di comandi e codice
- generazione di sezioni Antigravity concrete e non generiche

### Gestione archivio

- salvataggio locale degli output generati
- ricerca per titolo, canale, tag, contenuto
- stato documento: `pending`, `extracted`, `failed`
- ri-download e copia file
- apertura dashboard archivio

### Batch e scalabilita

- supporto successivo per playlist
- supporto successivo per batch URL
- supporto versioni multiple dello stesso video con preset diversi

## Funzioni secondarie consigliate

- flashcard automatiche
- quiz finali
- checklist di esecuzione
- comparazione tra piu video
- syllabus da playlist
- piano studio giornaliero
- export machine-readable per agenti

## Requisiti UX/UI

### Popup

Il popup deve essere chiaro, veloce e professionale. Deve mostrare:

- titolo e canale del video
- stato transcript
- selettore modalita iniziale
- CTA primaria di generazione
- warning chiari se mancano caption o API key
- preview sintetica del risultato

### Dashboard

La dashboard deve permettere:

- ricerca archivio
- filtro per tag, canale, stato, piattaforma
- apertura note generate
- accesso a file salvati
- gestione creator seguiti
- coda di estrazione

### Options

La pagina opzioni deve permettere:

- configurazione API key
- scelta lingua output
- scelta formato output
- scelta modalita predefinita
- configurazione cartella Obsidian
- impostazioni auto-queue

## Requisiti tecnici

### Stack minimo richiesto

- Chrome Extension Manifest V3
- JavaScript modulare oppure TypeScript preferito
- storage locale Chrome
- service worker background
- content script YouTube
- API Gemini per generazione contenuti

### Architettura richiesta

Separazione minima in moduli:

- `ui/`
- `core/`
- `schemas/`
- `services/`
- `renderers/`
- `storage/`

### Moduli principali

- transcript extraction service
- prompt builder service
- AI generation service
- MDX renderer
- JSON renderer
- archive storage manager
- migration manager
- job orchestration layer

### Standard qualitativi richiesti

- naming coerente
- schema dati condiviso
- versioning storage
- migrazioni retrocompatibili
- gestione errori con retry e timeout
- logging chiaro
- codice leggibile e documentato

## Data model richiesto

### Settings

- api keys
- lingua
- modello
- output format
- modalita predefinita
- opzioni vault
- intervallo auto-queue

### Creator

- channelId
- channelName
- channelUrl
- followedAt
- autoQueueEnabled
- priority
- topics

### LearningDocument

- id
- sourceType
- platform
- videoId
- title
- channelName
- channelId
- publishDate
- viewCount
- url
- markdown
- fullMarkdown
- tags
- status
- thumbnail
- captionTracks
- duration
- contentType
- durationBucket
- liveBroadcastContent
- learningMode
- outputFormat
- transcriptQuality
- createdAt
- updatedAt

## Integrazione AI

### Input al modello

- titolo video
- canale
- descrizione
- durata
- capitoli
- trascrizione
- lingua
- preset scelto

### Output richiesto al modello

- sezione studio guidato
- sintesi rapida
- mappa concettuale
- prompt e workflow Antigravity
- tag semantici

### Vincoli AI

- output stabile e prevedibile
- capitoli coerenti con video
- nessun placeholder generico
- codice e comandi ricostruiti correttamente
- contenuto fedele alla trascrizione

## Requisiti non funzionali

- tempi di risposta ragionevoli anche su video lunghi
- robustezza su video con transcript parziale o rumoroso
- compatibilita con YouTube SPA navigation
- basso numero di errori silenziosi
- nessuna perdita dati in archivio
- compatibilita Obsidian opzionale

## Sicurezza e privacy

- API key salvate solo in storage browser
- nessun backend obbligatorio nella v2.0
- i dati utente restano locali salvo chiamate esplicite a Gemini
- documentare chiaramente cosa viene inviato ai modelli AI

## Piano realizzativo in 5 fasi

### Fase 1. Fondazione tecnica

- schema dati
- migrazioni storage
- moduli core
- builder documento
- logging e error handling

### Fase 2. UI professionale

- redesign popup
- redesign options
- redesign dashboard
- progress states reali

### Fase 3. Motore learning

- miglioramento prompt
- output a tre livelli
- mappa concettuale
- checklist, quiz, flashcard

### Fase 4. Automazione e output avanzati

- batch
- playlist
- export JSON/TXT
- output strutturato Antigravity

### Fase 5. QA e release candidate

- test reali
- performance
- bug fixing
- documentazione

## Deliverable per ciascuna fase

La software house deve consegnare per ogni fase:

- codice sorgente aggiornato
- changelog della fase
- elenco file/moduli toccati
- evidenza test effettuati
- note su rischi residui

## Criteri di accettazione

### Accettazione funzionale

- su un video YouTube con trascrizione disponibile il plugin deve generare un file `MDX` completo
- il file deve contenere tutte le sezioni richieste
- la modalita iniziale selezionata deve riflettersi nel documento
- il file deve essere salvabile e ricercabile in archivio

### Accettazione qualitativa

- UI leggibile e coerente
- output generato utile per studio reale
- mappa concettuale sensata
- istruzioni Antigravity operative
- assenza di regressioni sui flussi attuali

### Accettazione tecnica

- codice modulare
- zero errori sintattici
- test minimi su moduli critici
- storage migrato correttamente

## Test scenario minimi obbligatori

- video breve con capitoli
- video lungo oltre 60 minuti
- video tecnico con codice parlato
- video senza capitoli
- video con sottotitoli automatici
- video senza sottotitoli
- cambio video via navigazione SPA YouTube
- export su vault Obsidian

## Ruoli minimi richiesti alla software house

- Tech Lead
- Frontend engineer Chrome Extension
- AI integration engineer
- QA engineer
- UI/UX designer

## Output documentali richiesti

La software house deve produrre anche:

- architettura tecnica
- manuale installazione sviluppo
- guida configurazione API
- guida test
- roadmap post-release

## Cose da evitare

- codice monolitico centrato solo su `background.js`
- logica di business mischiata alla UI
- prompt hardcoded non riusabili
- formati output incoerenti
- mancanza di schema dati
- assenza di migrazioni
- dipendenze inutili

## Priorita di progetto

### Must have

- output MDX a 3 livelli
- trascrizione completa
- studio guidato
- sintesi rapida
- mappa concettuale
- archivio locale
- popup/dashboard/options professionali
- base tecnica modulare

### Should have

- quiz
- flashcard
- export JSON
- workflow Antigravity strutturato

### Could have

- playlist
- batch
- comparazione multi-video
- syllabus avanzato

## Risultato atteso finale

Una estensione Chrome pronta per beta test professionale, capace di convertire tutorial YouTube in asset di apprendimento realmente utili, riutilizzabili e scalabili, con base tecnica solida e spazio per evoluzioni future.
