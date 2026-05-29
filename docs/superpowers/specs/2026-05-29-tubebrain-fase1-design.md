# TubeBrain — Fase 1: Design

Data: 2026-05-29
Stato: approvato (in attesa di revisione spec)
Branch: `security/hardening-v2.1.0`

## Obiettivo

Rendere TubeBrain più professionale e indispensabile per lo studio agendo su 5 aree:
semplificazione del popup a 5 strumenti, viewer MDX navigabile, accodamento massivo,
menu tasto destro multi-opzione, shortcut da tastiera attivati e documentati.

Questa è la **Fase 1**. I 20 miglioramenti più ampi sono pianificati come Fasi 2-5 (vedi Roadmap).

## Decisioni architetturali approvate

- **Viewer MDX = documento HTML autoportante arricchito** (non viewer dentro l'estensione).
  Il file generato resta apribile/condivisibile offline; le funzioni di navigazione sono JS embedded.
- **5 strumenti = layer UI sopra i 14 toggle esistenti.** Lo storage continua a salvare 14 booleani
  (`mdxSections`). Nessuna migrazione dati. Retrocompatibile con l'archivio esistente.

## Vincoli

- Chrome MV3, nessuna dipendenza esterna nuova senza segnalazione.
- Rispettare convenzioni esistenti (prefisso CSS `lhv2-`, naming, indentazione).
- Riusare il fix anti-XSS (`escHtml`) introdotto nel branch corrente per ogni output dinamico.

---

## 1. Popup: 5 strumenti

### Modello dati
Nuova costante in `schemas/app-schema.js`:

```
MDX_TOOL_GROUPS = [
  { key: 'transcript',  label: '📝 Trascrizione',   sections: ['verbatimTranscript'] },
  { key: 'study',       label: '🎓 Studio guidato', sections: ['studyGuide','quickSummary','conceptMap','operationalGlossary'] },
  { key: 'memorize',    label: '🧠 Memorizzazione', sections: ['flashcards','finalQuiz','errorsRecovery'] },
  { key: 'practice',    label: '🛠️ Pratica',        sections: ['interactiveTimeline','executionChecklist','tutorialReplication'] },
  { key: 'antigravity', label: '🤖 Antigravity',    sections: ['antigravityInstructions','antigravityPrompt'] },
]
```

`personalNotes` non appartiene ad alcun gruppo: è sempre attivo, mostrato a parte.

### Comportamento UI (`popup/popup.{html,js}`)
- 5 interruttori, uno per gruppo.
- Toggle gruppo ON → attiva tutte le sezioni figlie; OFF → disattiva tutte.
- Stato del toggle gruppo derivato dai figli: ON (tutti attivi), OFF (nessuno), "misto" (alcuni).
- Expander **"⚙️ Avanzate"**: rivela i 14 toggle granulari attuali (UI esistente, riusata).
- Modifiche in "Avanzate" si riflettono sullo stato dei 5 gruppi e viceversa.

### Interfacce
- Input: `mdxSections` (oggetto 14 booleani) da `Storage.getSettings()`.
- Output: stesso oggetto `mdxSections` salvato via `SAVE_SETTINGS`. Nessun nuovo campo persistito.

---

## 2. Viewer MDX navigabile

Tutto incapsulato nel documento generato da `utils/markdown-generator.js` (CSS+JS embedded, prefisso `lhv2-`).

### 2.1 Indice laterale (TOC) + scroll-spy
- Sidebar sticky con elenco delle sezioni del documento.
- `IntersectionObserver` evidenzia la voce della sezione visibile.
- Campo di ricerca interno: filtra/evidenzia le occorrenze nel documento.

### 2.2 Timestamp cliccabili
- I marcatori `[mm:ss]` / `[hh:mm:ss]` nel testo vengono convertiti in link
  `https://www.youtube.com/watch?v=<videoId>&t=<secondi>s` (apertura in nuova scheda).
- `videoId` incorporato come `data-video-id` nel contenitore del documento.
- Parsing robusto: ignora pattern non validi; non rompe il testo se manca il videoId.

### 2.3 Sezioni a fisarmonica
- Ogni sezione ha intestazione cliccabile (comprimi/espandi).
- Pulsanti globali "Espandi tutto" / "Comprimi tutto".
- Stato persistito in `localStorage` con chiave `lhv2:<docId>:accordion`.

### 2.4 Progresso & ripasso nel documento
- Checkbox "letto/capito" per ogni sezione → aggiorna una **barra di completamento** in testa.
- Flashcard interattive ("gira la carta") e quiz cliccabile inline (risposta + esito).
- Stato persistito in `localStorage` con chiave `lhv2:<docId>:progress`.

### Sicurezza
- Ogni contenuto dinamico passa da `escapeHtml`. Nessun `innerHTML` con dati non sanificati.

---

## 3. Accodamento massivo

### 3.1 Da playlist/canale (`popup` + `dashboard` + `background.js`)
- Campo URL playlist/canale. Riusa `analyzeChannelForMassQueue` / `queueChannelMass`.
- Aggiunge parsing playlist e filtri: numero max, durata min/max, ordine (dal più recente),
  escludi video già riassunti/in coda.

### 3.2 Selezione multipla in pagina (`content-script.js`)
- Modalità selezione attivabile da pulsante fluttuante o `Alt+Q`.
- Checkbox sovrapposta su ogni miniatura video rilevata.
- Barra fluttuante con contatore "Accoda selezionati (N)" → invia gli URL al background.

### 3.3 Accoda tutta la pagina (`content-script.js`)
- Pulsante "Accoda tutti i video visibili": raccoglie gli ID dalle miniature presenti
  (home, risultati ricerca, pagina canale) e li accoda in blocco.

### 3.4 Incolla lista URL (migliora `IMPORT_BATCH_URLS`)
- Validazione degli URL/ID (uno per riga) + anteprima titoli prima di confermare l'accodamento.

### Interfacce
- Tutti i flussi convergono su `addToQueue(pageData)` nel background, con dedup esistente.

---

## 4. Menu tasto destro (`background.js`)

Sostituisce la voce singola con un sottomenu **"TubeBrain"** (parent) e 4 figli:

| Voce                       | Handler                                  |
|----------------------------|------------------------------------------|
| Accoda video               | `queueVideoFromUrl` (senza follow)       |
| Accoda + segui creator     | comportamento attuale                    |
| Genera MDX ora             | estrazione/generazione immediata         |
| Accoda con priorità        | `addToQueue` + `togglePriority`          |

- Creati in `ensureContextMenus`, `contexts: ['link','image','page','video']`,
  `documentUrlPatterns: ['*://*.youtube.com/*']`.
- Routing in `chrome.contextMenus.onClicked` per `menuItemId`.

---

## 5. Shortcut da tastiera

- Mantiene i `commands` esistenti nel manifest:
  - `Cmd/Ctrl+Shift+P` → accoda video corrente/target.
  - `Alt+Q` → toggle modalità selezione/coda.
  - `Cmd/Ctrl+Shift+O` → avvio OCR.
- Verifica funzionamento end-to-end; documenta in `onboarding/` e nella guida (sezione "Scorciatoie").

---

## Componenti toccati

- `schemas/app-schema.js` — `MDX_TOOL_GROUPS`.
- `popup/popup.html`, `popup/popup.js` — 5 toggle + "Avanzate" + campo bulk URL.
- `utils/markdown-generator.js` — viewer navigabile (TOC, timestamp, fisarmonica, progresso).
- `content-script.js` — selezione miniature, accoda pagina, barra selezione.
- `background.js` — sottomenu contestuale, handler bulk/priorità/genera-ora.
- `dashboard/*` — UI accodamento massivo (playlist/canale, lista URL con anteprima).
- `onboarding/*` — documentazione shortcut.
- `manifest.json` — `commands` già presenti (nessuna modifica salvo verifica).

## Testing

- Unit (Node, stile `tests/*.test.js`): mappatura `MDX_TOOL_GROUPS` ↔ `mdxSections`;
  parsing timestamp → secondi; validazione lista URL.
- Manuale: caricare l'estensione, verificare i 5 toggle, generare un MDX e provare
  TOC/timestamp/fisarmonica/progresso; provare le 4 modalità di accodamento, le 4 voci
  di menu e i 3 shortcut.

## Roadmap fasi successive (dai 20 miglioramenti)

- **Fase 2 — Sicurezza/Affidabilità**: sanitizzazione completa XSS (~100 `innerHTML`),
  retry/backoff API + gestione quota, persistenza/ripresa coda MV3.
- **Fase 3 — Accuratezza**: grounding timestamp esteso, fallback trascrizione (STT),
  gestione costi/token trasparente.
- **Fase 4 — Apprendimento**: algoritmo FSRS + notifiche ripasso, analytics di studio,
  ricerca con embeddings locali.
- **Fase 5 — Ecosistema**: integrazioni (AnkiConnect/Notion/Obsidian sync), i18n,
  estensione oltre YouTube (PDF/slide/corsi).

Ogni fase avrà la propria spec e il proprio piano di implementazione.
