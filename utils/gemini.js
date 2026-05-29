// utils/gemini.js — Chiamate all'API Gemini 2.5 Flash (e fallback) — v1.13.0

const GeminiAPI = {

  // Base URL — il modello viene specificato dinamicamente nella call
  GEMINI_BASE: 'https://generativelanguage.googleapis.com/v1beta/models',
  DEFAULT_MODEL: 'gemini-2.5-flash',

  endpoint(model) {
    return `${this.GEMINI_BASE}/${model || this.DEFAULT_MODEL}:generateContent`;
  },

  getDurationBucket(durationSec = 0) {
    if (durationSec < 180) return 'flash';
    if (durationSec < 600) return 'quick';
    if (durationSec < 1800) return 'standard';
    if (durationSec < 3600) return 'deep';
    return 'marathon';
  },

  classifyContentType(videoData = {}) {
    if (videoData.liveBroadcastContent === 'live' || videoData.liveBroadcastContent === 'upcoming' || videoData.isLive) {
      return 'live';
    }
    return (videoData.duration || 0) < 180 ? 'short' : 'video';
  },

  buildPromptStrategy(videoData = {}) {
    const duration = videoData.duration || 0;
    const bucket = videoData.durationBucket || this.getDurationBucket(duration);
    const contentType = videoData.contentType || this.classifyContentType(videoData);
    const typeNote = contentType === 'short'
      ? 'SHORTS: punta su hook, idea centrale, takeaway immediati e formato molto compatto.'
      : contentType === 'live'
        ? 'LIVE: separa contenuto sostanziale da saluti, housekeeping, pause e Q&A ripetitivo.'
        : 'VIDEO: tratta il contenuto come tutorial o spiegazione strutturata.';
    const bucketNote = {
      flash: 'Bucket FLASH (<3 min): evita espansioni artificiali, massimo 2-3 blocchi logici.',
      quick: 'Bucket QUICK (3-10 min): mantieni il documento snello, focalizzato sulle azioni pratiche.',
      standard: 'Bucket STANDARD (10-30 min): usa il template completo standard.',
      deep: 'Bucket DEEP (30-59 min): aumenta granularita di capitoli, troubleshooting e cross-link.',
      marathon: 'Bucket MARATHON (60+ min): produci capitoli piu densi, evidenzia milestone, recap intermedi e segmenti ignorabili.',
    }[bucket] || '';

    return { contentType, bucket, text: `${typeNote}\n${bucketNote}`.trim() };
  },

  /**
   * Chiamata base a Gemini.
   * @param {string} prompt - Il prompt completo
   * @param {string} apiKey - Gemini API key
   * @param {object} options - { temperature, maxOutputTokens, model }
   */
  async call(prompt, apiKey, options = {}) {
    if (!apiKey) throw new Error('API key Gemini mancante. Configurala nelle Impostazioni.');

    const model = options.model || this.DEFAULT_MODEL;
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: options.temperature ?? 0.3,
        maxOutputTokens: options.maxOutputTokens ?? 8192,
        topP: 0.95,
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    };

    const netApi = (typeof NetUtils !== 'undefined') ? NetUtils : (typeof require !== 'undefined' ? require('./net.js') : null);
    const res = await (netApi ? netApi.fetchWithRetry : fetch)(this.endpoint(model), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    }, { retries: 3, timeoutMs: 90000 });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err?.error?.message || `HTTP ${res.status}`;
      throw new Error(`Gemini API error: ${msg}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Risposta Gemini vuota o bloccata.');
    return text;
  },

  /**
   * Costruisce il mega-prompt per analisi tutorial YouTube.
   */
  buildTutorialPrompt(videoData, language = 'it') {

    const langInstruction = language === 'auto'
      ? 'Rispondi nella stessa lingua in cui è parlato il video.'
      : language === 'en'
        ? 'Write the entire document in English.'
        : 'Scrivi l\'intero documento in italiano, indipendentemente dalla lingua del video.';

    const chaptersHint = videoData.chapters?.length > 0
      ? `\nCAPITOLI ORIGINALI DEL VIDEO:\n${videoData.chapters.map(c =>
          `- ${c.title} [${Math.floor(c.startMs/60000)}:${String(Math.floor((c.startMs%60000)/1000)).padStart(2,'0')}]`
        ).join('\n')}`
      : '';

    const durationStr = videoData.duration
      ? `${Math.floor(videoData.duration/60)} minuti`
      : 'sconosciuta';
    const strategy = this.buildPromptStrategy(videoData);

    const youtubeUrl = `https://youtube.com/watch?v=${videoData.videoId}`;

    return `Sei un esperto analista di video tutorial tecnici. ${langInstruction}

Analizza la seguente trascrizione del video YouTube e genera un documento Markdown completo, dettagliato e professionale.

═══════════════════════════════════════
INFORMAZIONI VIDEO
═══════════════════════════════════════
Titolo: ${videoData.title}
Canale: ${videoData.channelName}
URL: ${youtubeUrl}
Durata: ${durationStr}
Tipo contenuto: ${strategy.contentType}
Bucket durata: ${strategy.bucket}
Descrizione: ${(videoData.description || '').slice(0, 500)}
${chaptersHint}

═══════════════════════════════════════
STRATEGIA DI LETTURA DEL CONTENUTO
═══════════════════════════════════════
${strategy.text}

═══════════════════════════════════════
⚠️ NOTA CRITICA — RICONOSCIMENTO CODICE PARLATO
═══════════════════════════════════════
La trascrizione è linguaggio parlato convertito in testo. Il codice e i comandi NON appaiono
formattati: devi riconoscerli nel parlato e ricostruirli correttamente.

REGOLE DI RICONOSCIMENTO:
• COMANDI TERMINALE: "digita pip install pandas", "esegui python main punto py",
  "lancia npm run dev", "scrivi docker-compose up" → blocco \`\`\`bash (o \`\`\`powershell su Windows)
• CODICE SORGENTE: quando il relatore "legge" codice ("def mia funzione due punti",
  "for i in range dieci colon", "import os"), ricostruisci il codice Python/JS/ecc. corretto
• PERCORSI FILE: "apri src barra components barra App punto jsx" → \`src/components/App.jsx\`
• VARIABILI/FUNZIONI/CLASSI menzionate oralmente → usa \`backtick\` inline
• CONFIGURAZIONI lette ad alta voce → ricostruisci la struttura YAML/JSON/TOML corretta
• SHORTCUT: "premi ctrl shift p", "command T" → \`Ctrl+Shift+P\`, \`Cmd+T\`
• OUTPUT TERMINALE letto ad alta voce → riproducilo in blocco \`\`\`text
• VERSIONI: "la versione tre punto undici di python" → Python 3.11, pip 23.x

REGOLA ASSOLUTA SUI BLOCCHI CODICE:
✅ Ogni blocco codice DEVE specificare il linguaggio: \`\`\`python, \`\`\`bash, \`\`\`javascript,
   \`\`\`typescript, \`\`\`yaml, \`\`\`json, \`\`\`sql, \`\`\`dockerfile, \`\`\`toml, \`\`\`css, \`\`\`html, ecc.
✅ Comandi shell/terminale → sempre \`\`\`bash (o \`\`\`powershell se su Windows)
✅ Output puro senza sintassi → \`\`\`text
❌ MAI usare \`\`\` senza il tag linguaggio

REGOLA SUI PARAMETRI E PLACEHOLDER:
✅ Qualsiasi valore che l'utente deve personalizzare → notazione \`<NOME_PARAMETRO>\`
   Esempi: \`<YOUR_API_KEY>\`, \`<USERNAME>\`, \`<PROJECT_NAME>\`, \`<DATABASE_URL>\`, \`<PORT>\`
❌ NON lasciare mai valori hard-coded che variano per utente (API key, password, path assoluti)

═══════════════════════════════════════
TRASCRIZIONE (con timestamp)
═══════════════════════════════════════
${videoData.transcript}

═══════════════════════════════════════
ISTRUZIONI STRUTTURA OUTPUT
═══════════════════════════════════════
Genera ESATTAMENTE questo documento Markdown, compilando ogni sezione in modo dettagliato:

---

# ${videoData.title}

> **Canale:** ${videoData.channelName} | **Durata:** ${durationStr} | **Piattaforma:** YouTube
> **Video:** [▶ Guarda su YouTube](${youtubeUrl})
> **Analisi generata il:** ${new Date().toLocaleDateString('it-IT', { day:'2-digit', month:'long', year:'numeric' })}
> **Tags:** [genera 5-8 tag rilevanti preceduti da #, es: #tutorial #python #automazione]

---

## 📋 Riepilogo Generale

[Scrivi 3-4 paragrafi che spiegano: (1) di cosa tratta il video, (2) cosa impara chi lo guarda, (3) a chi è rivolto, (4) il risultato finale ottenuto]

---

## 🗺️ Mappa Mentale / Architettura (Mermaid)

[Crea una mappa concettuale o un diagramma di architettura visivo usando la sintassi \`mermaid\`. Se il video descrive un sistema, disegna il diagramma architetturale (graph TD/LR). Se descrive concetti teorici, disegna una mappa mentale logica. Non usare sintassi incompatibili, usa solo nodi e frecce semplici.]

\`\`\`mermaid
graph TD
    %% Sostituisci questo blocco con il tuo codice Mermaid generato
    A[Concetto Chiave] --> B(Dettaglio 1)
    A --> C(Dettaglio 2)
\`\`\`

---

## 🎯 Prerequisiti

[Lista puntata di TUTTO ciò che l'utente deve sapere, avere installato, o aver fatto prima di seguire questo tutorial. Se non ci sono prerequisiti espliciti, deducili dal contenuto.]

---

## 📦 Dipendenze e Versioni

[Elenca TUTTE le librerie, tool, runtime e versioni menzionate nel video. Genera il file di dipendenze appropriato per il linguaggio principale del tutorial.]

### Versioni richieste

| Componente | Versione | Note |
|------------|---------|------|
| [runtime/tool] | [versione] | [note] |

### File dipendenze

\`\`\`[requirements.txt | package.json | go.mod | Gemfile | pyproject.toml — scegli il formato corretto]
[contenuto del file basato sulle librerie identificate nel video]
\`\`\`

---

## 🛠️ Tool, Software e Risorse

[Tabella Markdown di tutti gli strumenti, librerie, servizi, siti web menzionati nel video]

| Nome | Tipo | Versione/Note | Link |
|------|------|---------------|------|
| ... | ... | ... | ... |

---

## ⚡ Quick Run — Comandi Pronti all'Uso

> Copia e incolla questi comandi nel terminale nell'ordine indicato per replicare il tutorial da zero.
> Sostituisci i placeholder \`<NOME>\` con i tuoi valori prima di eseguire.

\`\`\`bash
# === SETUP AMBIENTE ===
# [tutti i comandi di installazione nell'ordine corretto]

# === CONFIGURAZIONE ===
# [comandi per configurare variabili, file .env, permessi ecc.]

# === ESECUZIONE ===
# [comandi per avviare il progetto/script]

# === VERIFICA ===
# [comandi per verificare che tutto funzioni correttamente]
\`\`\`

---

## 📚 Capitoli e Contenuto Dettagliato

[Dividi il video in capitoli semantici (usa quelli originali se presenti, altrimenti crea la divisione logica). Per ogni capitolo:]

### Capitolo N: [Titolo Capitolo] — ⏱️ [timestamp]

[Riepilogo dettagliato di questo capitolo in 150-300 parole. Spiega esattamente cosa viene fatto e mostrato.]

#### 🔹 Passaggi eseguiti:

1. **[passaggio 1]** _(richiede: [prerequisito o output del passo precedente, se presente])_
2. **[passaggio 2]** _(richiede: [prerequisito])_
...

#### 💻 Codice e Comandi:

\`\`\`[linguaggio-specifico — OBBLIGATORIO]
[codice o comandi mostrati in questo capitolo — ricostruiti dal parlato se necessario]
\`\`\`

[Spiegazione riga per riga se il codice è complesso o non ovvio]

[Ripeti per ogni capitolo]

---

## 💻 Code Snippet Repository

[Raccogli tutto il codice sorgente mostrato o spiegato nel video, e organizzalo come file separati pronti per essere salvati. Per ogni file individuato o deducibile, devi usare ESATTAMENTE questo formato:]

### File: [percorso/del/file.estensione]
\`\`\`[linguaggio]
[codice completo per questo file]
\`\`\`

[Ripeti per tutti i file. Includi le estensioni corrette (.js, .py, .css, .html). Se il video non specifica il nome del file, inventane uno logico (es. main.py, style.css). Questo passaggio è critico perché il plugin estrarrà questi blocchi per creare i file reali sul disco dell'utente.]

---

## 🐛 Troubleshooting

[Identifica errori e problemi menzionati nel video oppure prevedibili dati i comandi e le
 librerie usate. Per ogni problema compila questa scheda:]

### Problema: [descrizione breve del problema]

| Campo | Dettaglio |
|-------|-----------|
| **Sintomo** | [messaggio di errore esatto o comportamento anomalo osservabile] |
| **Causa probabile** | [perché accade — dipendenza mancante, versione incompatibile, config errata, ecc.] |
| **Soluzione** | [passi concreti per risolvere] |

\`\`\`bash
# Fix
[comando o codice correttivo — usa \`\`\`bash, \`\`\`python ecc. secondo il contesto]
\`\`\`

[Includi almeno 3 problemi per video tecnici. Se il video non ne menziona esplicitamente,
 aggiungi i più comuni per quel tipo di setup/linguaggio/tool.]

---

## 🃏 Flashcards (Anki)

[Estrai 10 concetti chiave affrontati nel video per favorire lo studio attivo tramite Spaced Repetition. Usa ESATTAMENTE il seguente formato CSV per ogni flashcard, per permettere l'esportazione automatica in Anki.]

\`\`\`csv
Q: [Domanda breve e chiara]; A: [Risposta concisa]
Q: [Domanda 2]; A: [Risposta 2]
\`\`\`

---

## 🔗 Fonti Ufficiali (Documentazione)

[Identifica le 3-5 tecnologie, linguaggi, librerie o concetti principali citati nel video. Per ciascuna di esse, fornisci il **link esatto alla documentazione ufficiale** pertinente (es. se nel video si parla di \`useEffect\` in React, metti il link a react.dev). Questo arricchirà gli appunti fornendo fonti sicure e aggiornate.]

- **[Nome Tecnologia/Concetto]**: [Breve spiegazione del perché è rilevante] - [URL Ufficiale]

---

## 🔀 Diff Prima/Dopo

[Includi questa sezione SOLO se il video mostra refactoring, modifiche a codice esistente,
 migrazione tra versioni o framework, oppure ottimizzazioni. Ometti completamente se non pertinente.]

[Per ogni modifica significativa:]

### Modifica N: [descrizione sintetica della modifica]

**Prima:**
\`\`\`[linguaggio]
[codice originale — ricostruito dal parlato/video se necessario]
\`\`\`

**Dopo:**
\`\`\`[linguaggio]
[codice modificato]
\`\`\`

> 💡 **Perché:** [motivazione della modifica — performance, leggibilità, sicurezza, nuova API, ecc.]

---

## 🔑 Punti Chiave e Takeaway

[7-10 punti chiave che l'utente porta a casa dopo aver visto questo video. Devono essere specifici e actionable.]

1. [punto chiave 1]
2. [punto chiave 2]
...

---

## 🔄 Blueprint per Replicazione del Contenuto

### Struttura Narrativa del Video
[Descrivi l'arco narrativo: come inizia, come si sviluppa, come finisce]

### Hook di Apertura
[Come cattura l'attenzione nei primi 30-60 secondi]

### Schema dei Capitoli
[Template della struttura replicabile]

### Stile e Tono
[Descrivi brevemente lo stile comunicativo del creator]

### Call to Action Finale
[Cosa chiede al pubblico alla fine]

---

## 📎 Risorse e Link Menzionati

[Lista di tutti i link, risorse, canali, libri, strumenti citati nel video]

---

## 🤖 Antigravity IDE & AI Agents Workflow

[QUESTA SEZIONE È FONDAMENTALE. Estrai l'intera sequenza operativa del video e trasformala in un PROMPT STRUTTURATO copia-incolla che l'utente può fornire a un agente AI autonomo (come Google Antigravity, Cursor, o Copilot Workspace) per far fargli eseguire il tutorial in autonomia.]

**Istruzioni per l'utente:**
> Incolla il blocco sottostante al tuo AI Agent per fargli ricreare il progetto del video senza alcun tuo intervento.

\`\`\`markdown
Sei un AI Coding Agent autonomo. Il tuo compito è replicare esattamente il tutorial descritto di seguito. Esegui questi passaggi nell'ordine indicato, verificando il successo di ogni step prima di passare al successivo. Usa i tuoi tool di file system e bash per completare i task.

### Contesto del Progetto
- **Obiettivo:** [Sintetizza l'obiettivo finale del progetto]
- **Stack Tecnologico:** [Linguaggi, framework, librerie e versioni esatte]
- **Struttura Directory Attesa:** [Albero delle directory principale]

### Task Sequenziali

**Fase 1: Setup e Dipendenze**
- [ ] Crea i file di configurazione necessari (es. package.json, requirements.txt, ecc.) con i seguenti contenuti:
  \`[Inserisci gli snippet di config esatti]\`
- [ ] Esegui i seguenti comandi nel terminale per preparare l'ambiente: \`[lista comandi setup]\`

**Fase 2: Implementazione Core**
[Dividi il codice del video in Task specifici e progressivi]
- [ ] Task 2.1: Crea il file \`[percorso_file]\` scrivendo la logica per [cosa deve fare].
  \`\`\`[linguaggio]
  [Codice esatto mostrato nel video]
  \`\`\`
- [ ] Task 2.2: Aggiorna il file \`[percorso_file]\` per [motivo dell'update]. Aggiungi questa logica:
  \`\`\`[linguaggio]
  [Codice esatto mostrato nel video]
  \`\`\`
[... ripeti per ogni file o blocco logico del video ...]

**Fase 3: Avvio e Verifica**
- [ ] Avvia l'ambiente locale usando il comando nel terminale: \`[comando start]\`
- [ ] Verifica che il sistema funzioni controllando [cosa deve apparire/succedere].
- [ ] Fallback/Troubleshooting: Se riscontri l'errore [errore tipico del video], esegui [comando o fix risolutivo].
\`\`\`

---

[FINE DOCUMENTO — Non aggiungere altro testo dopo questa riga]

IMPORTANTE: Compila OGNI sezione in modo completo e specifico basandoti sulla trascrizione reale.
Sezione Antigravity: istruzioni VERE e OPERATIVE, non placeholder generici.
Sezione Troubleshooting: almeno 3 problemi reali o prevedibili, con fix concreti.
Sezione Diff Prima/Dopo: includila solo se il video mostra effettive modifiche al codice.
Sezione Quick Run: deve essere eseguibile copiando e incollando, con placeholder chiari.`;
  },

  getDefaultMdxSections() {
    return (typeof AppSchema !== 'undefined' && AppSchema.DEFAULT_MDX_SECTIONS)
      ? { ...AppSchema.DEFAULT_MDX_SECTIONS }
      : {
          verbatimTranscript: true,
          studyGuide: true,
          antigravityInstructions: true,
          antigravityPrompt: true,
          quickSummary: true,
          conceptMap: true,
          flashcards: true,
          finalQuiz: true,
          interactiveTimeline: true,
          executionChecklist: true,
          operationalGlossary: true,
          errorsRecovery: true,
          tutorialReplication: true,
          personalNotes: true,
        };
  },

  resolveMdxSections(settings = {}) {
    const defaults = this.getDefaultMdxSections();
    const source = settings?.mdxSections && typeof settings.mdxSections === 'object'
      ? settings.mdxSections
      : {};
    return Object.keys(defaults).reduce((acc, key) => {
      acc[key] = typeof source[key] === 'boolean' ? source[key] : defaults[key];
      return acc;
    }, {});
  },

  buildLearningSectionsPrompt(videoData, language = 'it', settings = {}) {
    const langInstruction = language === 'auto'
      ? 'Rispondi nella stessa lingua in cui e parlato il video.'
      : language === 'en'
        ? 'Write the entire document in English.'
        : 'Scrivi l\'intero documento in italiano, indipendentemente dalla lingua del video.';
    const chaptersHint = videoData.chapters?.length > 0
      ? videoData.chapters.map((c, index) =>
          `${index + 1}. ${c.title} [${Math.floor(c.startMs / 60000)}:${String(Math.floor((c.startMs % 60000) / 1000)).padStart(2, '0')}]`
        ).join('\n')
      : 'Nessun capitolo ufficiale disponibile: creali tu in modo coerente.';
    const youtubeUrl = `https://youtube.com/watch?v=${videoData.videoId}`;
    const transcriptQuality = videoData.transcriptQuality?.level || 'unknown';
    const transcriptQualityReason = videoData.transcriptQuality?.reason || 'Qualita transcript non disponibile';
    const studyDepth = videoData.durationBucket === 'marathon' || videoData.durationBucket === 'deep'
      ? 'Alta granularita: usa sottocapitoli, recap intermedi, milestone e checkpoints pratici.'
      : 'Granularita standard: mantieni capitoli compatti ma operativi.';
    const mdxSections = this.resolveMdxSections(settings);
    const includeStudyMode = mdxSections.studyGuide;
    const includeSummaryMode = mdxSections.quickSummary;
    const optionalSections = [];

    if (mdxSections.conceptMap) {
      optionalSections.push(`## Mappa concettuale

- usa un blocco \`\`\`mermaid
- crea una mappa leggibile e compatta
- nodo centrale = tema del video
- rami = capitoli principali
- sotto-rami = concetti, strumenti, output, errori da evitare`);
    }
    if (mdxSections.flashcards) {
      optionalSections.push(`## Flashcard

- crea 8-15 flashcard
- formato tabella Markdown con colonne: \`Domanda | Risposta | Difficolta\`
- le domande devono coprire concetti, passaggi e decisioni tecniche`);
    }
    if (mdxSections.finalQuiz) {
      optionalSections.push(`## Quiz finale

- crea 8 domande a risposta multipla
- 4 opzioni per domanda
- indica la risposta corretta
- aggiungi una spiegazione breve`);
    }
    if (mdxSections.interactiveTimeline) {
      optionalSections.push(`## Timeline interattiva

- crea una tabella Markdown con colonne: \`Timestamp | Focus | Azione pratica | Perche conta\`
- usa timestamp reali del video quando disponibili
- includi solo i passaggi che vale la pena riaprire o rivedere`);
    }
    if (mdxSections.executionChecklist) {
      optionalSections.push(`## Checklist esecuzione

- crea 8-15 task in formato GFM task list: \`- [ ] azione\`
- ogni task deve essere atomico, verificabile e direttamente eseguibile
- evita task vaghi come "studia meglio" o "capisci il concetto"`);
    }
    if (mdxSections.operationalGlossary) {
      optionalSections.push(`## Glossario operativo

- crea una tabella Markdown con colonne: \`Termine | Definizione | Perche conta\`
- includi concetti tecnici, file, strumenti, pattern e nomi API ricorrenti
- ogni definizione deve stare in 1-2 frasi dense`);
    }
    if (mdxSections.errorsRecovery) {
      optionalSections.push(`## Errori frequenti e recovery

- elenca gli errori operativi piu probabili emersi dal tutorial
- per ogni errore indica sintomo, causa, fix e controllo finale`);
    }
    if (mdxSections.tutorialReplication) {
      optionalSections.push(`## Replicazione del tutorial

- 5-10 punti pratici su come replicare contenuto, struttura, workflow e logica del tutorial`);
    }

    const studyHeadingBlock = mdxSections.antigravityInstructions
      ? `Formato richiesto per ogni capitolo:
### [Titolo capitolo]
#### Cosa impari
#### Passaggi operativi
#### Checklist studio
#### Errori da evitare
#### Segnali di completamento
#### Istruzioni Google Antigravity

Nella sottosezione "Istruzioni Google Antigravity" inserisci:
- obiettivo del task
- input richiesti
- sequenza di azioni
- output atteso
- controlli di verifica`
      : `Formato richiesto per ogni capitolo:
### [Titolo capitolo]
#### Cosa impari
#### Passaggi operativi
#### Checklist studio
#### Errori da evitare
#### Segnali di completamento`;

    const studyPromptBlock = mdxSections.antigravityPrompt
      ? `Dopo i capitoli aggiungi:
### Prompt Antigravity pronto all'uso
con un blocco \`\`\`text`
      : '';

    const activeSectionOrder = [
      includeStudyMode ? 'Studio guidato' : null,
      includeSummaryMode ? 'Sintesi rapida' : null,
      ...optionalSections.map(section => section.match(/^##\s+(.+)$/m)?.[1] || null),
    ].filter(Boolean).join(' → ');

    return `Sei un learning designer specializzato in tutorial tecnici. ${langInstruction}

Devi produrre SOLO la parte finale di un file MDX. La trascrizione integrale verra aggiunta separatamente dal sistema:
NON ripetere l'intera trascrizione e NON scrivere frontmatter YAML.

═══════════════════════════════════════
DATI VIDEO
═══════════════════════════════════════
Titolo: ${videoData.title}
Canale: ${videoData.channelName}
URL: ${youtubeUrl}
Descrizione: ${(videoData.description || '').slice(0, 700)}
Qualita transcript: ${transcriptQuality}
Nota qualita transcript: ${transcriptQualityReason}
Capitoli ufficiali:
${chaptersHint}

═══════════════════════════════════════
TRASCRIZIONE DI RIFERIMENTO
═══════════════════════════════════════
${videoData.transcript}

═══════════════════════════════════════
ISTRUZIONI DI OUTPUT
═══════════════════════════════════════
Genera SOLO le sezioni attive richieste qui sotto, in Markdown/MDX.
Non aggiungere sezioni extra.

${includeStudyMode ? `## <a id="mode-study"></a>2. Studio guidato

Per ogni capitolo e sottocapitolo:
- mantieni il titolo del capitolo originale o quello piu fedele possibile
- spiega cosa succede
- estrai passaggi operativi replicabili
- aggiungi una mini checklist studio
${mdxSections.antigravityInstructions ? '- aggiungi una sottosezione separata con istruzioni operative per Google Antigravity' : ''}

${studyHeadingBlock}

Regole aggiuntive per la sezione Studio guidato:
- ${studyDepth}
- Ogni capitolo deve finire con una micro-sintesi di 1 frase
- Se il video e tecnico, includi comandi, file, path e snippet essenziali
- Se il transcript e di qualita bassa, dichiara le assunzioni solo quando necessario

${studyPromptBlock}` : ''}

${includeSummaryMode ? `## <a id="mode-summary"></a>3. Sintesi rapida

Per ogni capitolo:
- massimo 500 caratteri per capitolo
- mantieni capitoli e sottocapitoli
- tono denso, utile per ripasso e memorizzazione` : ''}

${optionalSections.join('\n\n')}

Vincoli:
- niente frontmatter
- niente testo introduttivo extra
- niente placeholder generici tipo "inserisci qui"
- ${mdxSections.antigravityInstructions || mdxSections.antigravityPrompt ? 'le istruzioni Antigravity devono essere concrete e basate davvero sulla trascrizione' : 'non citare Antigravity se le relative sezioni non sono attive'}
- se il video e tecnico, riconosci comandi, codice, file e configurazioni dal parlato
- mantieni un ordine stabile delle sezioni attive: ${activeSectionOrder || 'nessuna sezione attiva'}`;
  },

  /**
   * Genera il riepilogo completo di un video tutorial.
   * Gestisce automaticamente transcript lunghi (chunking).
   */
  async generateSummary(videoData, settings) {
    const { geminiApiKey, language, model } = settings;

    // Stima token: ~4 chars per token. Limite sicuro: ~600K chars (150K tokens)
    const MAX_CHARS = 600000;
    let transcript = videoData.transcript || '';
    const normalizedVideoData = {
      ...videoData,
      contentType: videoData.contentType || this.classifyContentType(videoData),
      durationBucket: videoData.durationBucket || this.getDurationBucket(videoData.duration || 0),
    };

    if (transcript.length > MAX_CHARS) {
      // Tronca mantenendo inizio e fine
      const half = MAX_CHARS / 2;
      transcript =
        transcript.slice(0, half) +
        '\n\n[... sezione centrale omessa per lunghezza ...]\n\n' +
        transcript.slice(-half);
    }

    const prompt = this.buildTutorialPrompt({ ...normalizedVideoData, transcript }, language);

    const markdown = await this.call(prompt, geminiApiKey, {
      temperature: 0.25,
      maxOutputTokens: 16384,
      model: model || this.DEFAULT_MODEL,
    });

    return markdown;
  },

  async generateLearningSections(videoData, settings) {
    const { geminiApiKey, language, model } = settings;
    const transcript = videoData.transcript || '';
    
    // FASE 1: Generazione Indice (TOC)
    const tocPrompt = `Analizza la seguente trascrizione del video e genera un Indice (Table of Contents) gerarchico.
Individua i capitoli principali (minimo 3, massimo 15) e restituisci SOLO un array JSON con questa struttura:
[
  { "title": "Titolo Capitolo 1", "summary": "Di cosa parla", "start": "00:00", "end": "05:30" }
]
NON AGGIUNGERE ALTRO TESTO OLTRE AL JSON. Usa i timestamp che trovi nella trascrizione per intuire inizio e fine.

Trascrizione:
${transcript.substring(0, 150000)} // Limite per l'indice per risparmiare token
`;
    
    let toc = [];
    try {
      const tocRaw = await this.call(tocPrompt, geminiApiKey, { temperature: 0.1, maxOutputTokens: 2000, model: model || this.DEFAULT_MODEL });
      const match = tocRaw.match(/\[[\s\S]*?\]/);
      if (match) toc = JSON.parse(match[0]);
    } catch (e) {
      console.warn("Errore TOC:", e);
      // Fallback: se fallisce, facciamo un unico blocco
      toc = [{ title: "Tutorial Completo", summary: "Tutto il video", start: "00:00", end: "99:99" }];
    }

    if (!Array.isArray(toc) || toc.length === 0) {
      toc = [{ title: "Tutorial Completo", summary: "Tutto il video", start: "00:00", end: "99:99" }];
    }

    // FASE 2 & 3: Estrazione Granulare e Metadati Globali in Parallelo
    const langInstruction = language === 'en' ? 'Write in English.' : 'Scrivi in Italiano.';
    
    const globalMetadataPrompt = `Sei un esperto tecnico. ${langInstruction}
Genera un documento Markdown di intestazione per questo video: ${videoData.title}.
Devi includere ESATTAMENTE queste sezioni, compilandole con cura estraendo le info dalla trascrizione:
## 📋 Riepilogo Generale (3-4 paragrafi)
## 🗺️ Mappa Mentale / Architettura (Usa blocco \`\`\`mermaid)
## 🎯 Prerequisiti
## 📦 Dipendenze e Versioni (Includi blocco codice per requirements.txt/package.json se applicabile)
## 🛠️ Tool, Software e Risorse (Includi link fittizi o reali se deducibili)

Trascrizione:
${transcript.substring(0, 300000)} // Primo blocco
`;

    const globalPromise = this.call(globalMetadataPrompt, geminiApiKey, { temperature: 0.3, maxOutputTokens: 4000, model: model || this.DEFAULT_MODEL });
    
    // Chiamate sequenziali o batch per i capitoli per non superare i rate limit (max 3 in parallelo)
    let chapterResults = [];
    for (let i = 0; i < toc.length; i++) {
      const chapter = toc[i];
      // Per semplicità e sicurezza dei rate limit, passiamo al modello la trascrizione intera ma gli chiediamo di concentrarsi solo su quel capitolo
      const chapterPrompt = `Sei un analista tecnico. ${langInstruction}
Estrai i dettagli operativi dal seguente video, concentrandoti SOLO sul capitolo: "${chapter.title}" (da ${chapter.start} a ${chapter.end}).

Usa ESATTAMENTE questo formato Markdown per la risposta:
### ${chapter.title}
[Riepilogo conciso del capitolo]

#### 🔹 Passaggi eseguiti:
1. [Passaggio 1]
2. [Passaggio 2]

#### 💻 Codice e Comandi:
\`\`\`[linguaggio]
[codice]
\`\`\`

Devi estrarre tutto il codice parlato o mostrato e scomporre il capitolo in sottoparagrafi.

Trascrizione completa (ignora ciò che non fa parte del capitolo):
${transcript.substring(0, 300000)}
`;
      try {
        const res = await this.call(chapterPrompt, geminiApiKey, { temperature: 0.2, maxOutputTokens: 4000, model: model || this.DEFAULT_MODEL });
        chapterResults.push(res);
      } catch (e) {
        console.warn(`Errore estrazione capitolo ${i}:`, e);
      }
    }

    const globalMetadata = await globalPromise.catch(() => "## 📋 Riepilogo Generale\n\nErrore generazione metadati.\n\n");

    // FASE 4: Assemblaggio
    const finalMarkdown = `
${globalMetadata}

---

## 📚 Capitoli e Contenuto Dettagliato (Deep Extract)

${chapterResults.join('\n\n---\n\n')}
`;
    return finalMarkdown;
  },

  /**
   * Verifica se un video corrisponde ai topic di interesse del creator.
   * Ritorna true/false. Chiamata ultra-leggera (5 token output).
   */
  async checkTopicMatch(videoTitle, videoDescription, topics, apiKey, model) {
    if (!topics?.length || !apiKey) return false;
    const prompt =
`Valuta se questo video è rilevante per almeno uno degli argomenti di interesse.

Video:
Titolo: "${videoTitle}"
Descrizione: "${(videoDescription || '').slice(0, 400)}"

Argomenti di interesse: ${topics.join(', ')}

Rispondi ESCLUSIVAMENTE con YES o NO.`;
    try {
      const r = await this.call(prompt, apiKey, { maxOutputTokens: 5, temperature: 0, model });
      return r.trim().toUpperCase().startsWith('Y');
    } catch { return false; }
  },

  /**
   * Costruisce il prompt per analisi di articoli web e pagine.
   */
  buildArticlePrompt(articleData, language = 'it') {
    const langInstruction = language === 'en'
      ? 'Write the entire document in English.'
      : 'Scrivi l\'intero documento in italiano, indipendentemente dalla lingua della pagina.';
    const sourceUrl = articleData.url || '';
    const today = new Date().toLocaleDateString('it-IT', { day:'2-digit', month:'long', year:'numeric' });
    const host = (() => { try { return new URL(sourceUrl).hostname; } catch { return sourceUrl; } })();

    return `Sei un esperto analista di contenuti. ${langInstruction}

Analizza il seguente contenuto estratto da una pagina web e genera un documento Markdown professionale.

═══════════════════════════════════════
INFORMAZIONI PAGINA
═══════════════════════════════════════
Titolo: ${articleData.title}
URL: ${sourceUrl}
Fonte/Sito: ${articleData.siteName || host}
Autore: ${articleData.author || 'non specificato'}
Data pubblicazione: ${articleData.date || 'non specificata'}

═══════════════════════════════════════
CONTENUTO TESTO
═══════════════════════════════════════
${articleData.text}

═══════════════════════════════════════
ISTRUZIONI STRUTTURA OUTPUT
═══════════════════════════════════════
Genera ESATTAMENTE questo documento Markdown:

---

# ${articleData.title}

> **Fonte:** [${articleData.siteName || host}](${sourceUrl})
> **Autore:** ${articleData.author || 'N/D'} | **Data:** ${articleData.date || 'N/D'}
> **Analisi generata il:** ${today}
> **Tags:** [genera 5-8 tag rilevanti preceduti da #]

---

## 📋 Sintesi

[3-4 paragrafi: argomento principale, tesi centrale, punti chiave, conclusioni]

---

## 🔑 Punti Chiave

[7-10 punti chiave specifici e actionable, numerati]

---

## 💬 Citazioni e Dati Notevoli

[Le 3-5 citazioni, statistiche o affermazioni più significative tra virgolette con contesto]

---

## 🔄 Analisi Critica

[Valutazione equilibrata: solidità argomentazione, contesto più ampio, eventuali limiti]

---

## 📎 Risorse e Link Menzionati

[Lista di tutti i link, studi, strumenti, libri citati nel contenuto]

---

[FINE DOCUMENTO]

IMPORTANTE: Basati ESCLUSIVAMENTE sul testo fornito. Sii preciso e fedele al contenuto originale.`;
  },

  /**
   * Genera il riepilogo di un articolo/pagina web.
   */
  async generateArticleSummary(articleData, settings) {
    const { geminiApiKey, language, model } = settings;
    const MAX_CHARS = 200000;
    let text = articleData.text || '';
    if (text.length > MAX_CHARS)
      text = text.slice(0, MAX_CHARS) + '\n\n[... contenuto troncato per lunghezza ...]';

    const prompt = this.buildArticlePrompt({ ...articleData, text }, language);
    return await this.call(prompt, geminiApiKey, {
      temperature: 0.25,
      maxOutputTokens: 4096,
      model: model || this.DEFAULT_MODEL,
    });
  },

  /**
   * Costruisce il prompt per analisi di contenuti Instagram (post, reel, profilo).
   */
  buildInstagramPrompt(igData, language = 'it') {
    const langInstruction = language === 'en'
      ? 'Write the entire document in English.'
      : 'Scrivi l\'intero documento in italiano, indipendentemente dalla lingua del contenuto.';

    const today = new Date().toLocaleDateString('it-IT', { day:'2-digit', month:'long', year:'numeric' });
    const typeLabel = igData.pageType === 'reel' ? 'Reel'
                    : igData.pageType === 'profile' ? 'Profilo'
                    : 'Post';
    const username = igData.username ? `@${igData.username}` : 'sconosciuto';
    const hashtags = (igData.hashtags || []).join(' ') || 'nessuno';
    const mentions = (igData.mentions || []).join(', ') || 'nessuno';

    return `Sei un esperto analista di contenuti social media. ${langInstruction}

Analizza il seguente contenuto Instagram e genera un documento Markdown professionale.

═══════════════════════════════════════
INFORMAZIONI CONTENUTO
═══════════════════════════════════════
Tipo: ${typeLabel} Instagram
Creator: ${username}
URL: ${igData.url || ''}
Hashtag: ${hashtags}
Menzioni: ${mentions}

═══════════════════════════════════════
TESTO / CAPTION ESTRATTO
═══════════════════════════════════════
${igData.text || igData.caption || '(nessun testo estratto dalla pagina)'}

═══════════════════════════════════════
ISTRUZIONI STRUTTURA OUTPUT
═══════════════════════════════════════
Genera ESATTAMENTE questo documento Markdown. Se alcune informazioni non sono disponibili, scrivilo esplicitamente anziché inventare.

---

# ${igData.title || typeLabel + ' di ' + username}

> **Creator:** [${username}](${igData.url || ''})
> **Tipo contenuto:** ${typeLabel} Instagram
> **Analisi generata il:** ${today}
> **Tags:** [genera 5-8 tag tematici rilevanti preceduti da #]

---

## 📋 Sintesi del Contenuto

[2-3 paragrafi: di cosa parla il contenuto, qual è il messaggio principale, a chi è rivolto]

---

## 🎯 Hook e Struttura

### Hook di Apertura
[Come inizia il contenuto? Cosa cattura l'attenzione? (se reel: descrivilo basandoti sulla caption; se post: analizza il testo; se profilo: descrivi il posizionamento del creator)]

### Struttura del Contenuto
[Come è organizzato il messaggio? Qual è l'arco narrativo o la progressione logica?]

### Call to Action
[C'è una CTA esplicita? Cosa viene chiesto al pubblico (seguire, commentare, cliccare, condividere)?]

---

## 🔑 Messaggi Chiave e Takeaway

[5-8 punti chiave specifici che emergono dal contenuto. Cosa impara o ricorda il follower?]

1. [punto chiave 1]
2. [punto chiave 2]
...

---

## 📊 Analisi della Strategia

### Hashtag Strategy
[Analizza gli hashtag usati: sono di nicchia o generici? Quanti? Qual è la logica di selezione?]
Hashtag presenti: ${hashtags}

### Tono e Stile Comunicativo
[Formale/informale? Educativo/intrattenimento? Personale/professionale? Come si relaziona con il pubblico?]

### Posizionamento del Creator
[In quale nicchia opera? Qual è la sua value proposition? A chi si rivolge principalmente?]

---

## 💡 Spunti per Replicazione

[3-5 idee pratiche per creare contenuti simili o ispirati a questo, con indicazioni concrete su struttura, tono e argomenti]

---

## 📎 Link e Menzioni Rilevanti

[Lista di account menzionati, link citati in bio/caption, risorse referenziate]
Menzioni presenti: ${mentions}

---

[FINE DOCUMENTO]

IMPORTANTE: Basati ESCLUSIVAMENTE sul testo estratto dalla pagina. Non inventare statistiche, follower o informazioni non presenti. Se il testo è scarso (Instagram può limitare il contenuto visibile), analizza quello disponibile e segnalalo.`;
  },

  /**
   * Genera il riepilogo di un contenuto Instagram.
   */
  async generateInstagramSummary(igData, settings) {
    const { geminiApiKey, language, model } = settings;
    const MAX_CHARS = 30000; // Instagram ha molto meno testo di un video/articolo
    let text = igData.text || igData.caption || '';
    if (text.length > MAX_CHARS)
      text = text.slice(0, MAX_CHARS) + '\n\n[... contenuto troncato ...]';

    const prompt = this.buildInstagramPrompt({ ...igData, text }, language);
    return await this.call(prompt, geminiApiKey, {
      temperature: 0.25,
      maxOutputTokens: 4096,
      model: model || this.DEFAULT_MODEL,
    });
  },

  /**
   * Chat RAG con l'archivio: risponde a una domanda usando i riepiloghi più rilevanti come contesto.
   * @param {string} question - Domanda dell'utente
   * @param {Array}  summaries - Array di oggetti { id, title, channelName, tags, markdown }
   * @param {object} settings  - { geminiApiKey, language, model }
   * @returns {{ answer: string, sources: Array<{id,title,channelName}> }}
   */
  async chatWithArchive(question, summaries, settings) {
    const { geminiApiKey, language, model } = settings;
    if (!geminiApiKey) throw new Error('API key Gemini mancante. Configurala nelle Impostazioni.');
    if (!summaries?.length) throw new Error('Archivio vuoto: non ci sono riepiloghi salvati.');

    // ── Pre-filtraggio keyword per selezionare i riepiloghi più rilevanti ──
    const qWords = question.toLowerCase()
      .replace(/[^\wàáèéìíòóùú\s]/gi, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);

    const scored = summaries.map(s => {
      const haystack = [
        s.title || '',
        (s.channelName || ''),
        (s.tags || []).join(' '),
        (s.markdown || '').slice(0, 600),
      ].join(' ').toLowerCase();

      const score = qWords.reduce((acc, w) => {
        const titleHit = (s.title || '').toLowerCase().includes(w) ? 3 : 0;
        const tagHit   = (s.tags || []).some(t => t.toLowerCase().includes(w)) ? 2 : 0;
        const bodyHit  = haystack.includes(w) ? 1 : 0;
        return acc + titleHit + tagHit + bodyHit;
      }, 0);
      return { ...s, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // Top 25 se ci sono match, altrimenti top 20 generici
    const hasMatches = scored[0]?.score > 0;
    const topN = hasMatches ? 25 : 20;
    const selected = scored.slice(0, topN);

    // ── Costruzione contesto ──
    const MAX_PER_DOC = 3500;
    const MAX_TOTAL   = 380000;
    let contextBlocks = [];
    let totalChars = 0;

    for (const s of selected) {
      const md = (s.markdown || '').slice(0, MAX_PER_DOC);
      const block = `### [${s.title}] (${s.channelName || 'Sconosciuto'})\n${md}`;
      if (totalChars + block.length > MAX_TOTAL) break;
      contextBlocks.push({ id: s.id, title: s.title, channelName: s.channelName, block });
      totalChars += block.length;
    }

    const langNote = language === 'en'
      ? 'Answer in English.'
      : 'Rispondi sempre in italiano, indipendentemente dalla lingua dei documenti.';

    const contextText = contextBlocks.map(c => c.block).join('\n\n---\n\n');

    const prompt = `Sei un assistente esperto che risponde a domande basandosi ESCLUSIVAMENTE sui documenti dell'archivio forniti qui sotto. ${langNote}

REGOLE:
1. Rispondi SOLO usando le informazioni presenti nei documenti. Non inventare nulla.
2. Cita le fonti usando il formato [Titolo del documento] dopo ogni affermazione chiave.
3. Se l'informazione non è nei documenti, dì esplicitamente che non hai abbastanza informazioni nell'archivio.
4. Sii preciso, dettagliato e utile.
5. Se la domanda è generica (es. "cosa ho imparato?"), fai un riepilogo organizzato per temi.

═══════════════════════════════════════
DOMANDA DELL'UTENTE
═══════════════════════════════════════
${question}

═══════════════════════════════════════
DOCUMENTI DELL'ARCHIVIO (${contextBlocks.length} riepiloghi)
═══════════════════════════════════════
${contextText}

═══════════════════════════════════════
RISPOSTA
═══════════════════════════════════════
Rispondi alla domanda in modo chiaro e strutturato. Cita le fonti con [Titolo].`;

    const answer = await this.call(prompt, geminiApiKey, {
      temperature: 0.2,
      maxOutputTokens: 4096,
      model: model || this.DEFAULT_MODEL,
    });

    // Rileva quali fonti sono effettivamente citate nella risposta
    const citedSources = contextBlocks.filter(c =>
      answer.includes(c.title) || answer.includes(`[${c.title}]`)
    );
    // Se nessuna citazione esplicita, includi le top 3 per rilevanza
    const sources = citedSources.length > 0
      ? citedSources.map(c => ({ id: c.id, title: c.title, channelName: c.channelName }))
      : contextBlocks.slice(0, 3).map(c => ({ id: c.id, title: c.title, channelName: c.channelName }));

    return { answer, sources };
  },

  /**
   * Ranking semantico via Gemini: ordina i riepiloghi per rilevanza rispetto a una query.
   * @param {string} query     - Testo della ricerca
   * @param {Array}  summaries - Array di { id, title, channelName, tags }
   * @param {string} apiKey
   * @param {string} model
   * @returns {string[]} Array di IDs ordinati per rilevanza (max 20)
   */
  async semanticRank(query, summaries, apiKey, model) {
    if (!apiKey || !summaries?.length) return summaries.map(s => s.id);

    // Lista compatta: index|id|title (channel) — tags: t1, t2
    const list = summaries.slice(0, 60).map((s, i) => {
      const tags = (s.tags || []).slice(0, 5).join(', ');
      return `${i}|${s.id}|${s.title} (${s.channelName || '?'})${tags ? ' — tag: ' + tags : ''}`;
    }).join('\n');

    const prompt = `Sei un motore di ricerca semantica. Data la query dell'utente, seleziona e ordina i documenti più rilevanti dall'elenco sottostante.

QUERY: "${query}"

DOCUMENTI:
${list}

ISTRUZIONI:
- Considera sinonimi, concetti correlati e intenzione della ricerca, non solo parole esatte.
- Restituisci SOLO un array JSON con gli ID dei documenti più rilevanti, ordinati dal più al meno rilevante.
- Includi al massimo 20 risultati. Escludi i documenti non pertinenti.
- Formato risposta (solo JSON, niente altro): ["id1","id2","id3",...]`;

    try {
      const raw = await this.call(prompt, apiKey, {
        maxOutputTokens: 400,
        temperature: 0,
        model: model || this.DEFAULT_MODEL,
      });
      // Estrai l'array JSON dalla risposta
      const match = raw.match(/\[[\s\S]*?\]/);
      if (!match) return summaries.map(s => s.id);
      const ids = JSON.parse(match[0]);
      if (!Array.isArray(ids)) return summaries.map(s => s.id);
      // Ritorna gli IDs validi nell'ordine semantico
      const validIds = new Set(summaries.map(s => s.id));
      return ids.filter(id => validIds.has(id));
    } catch {
      return summaries.map(s => s.id);
    }
  },

  /**
   * Genera un percorso di studio ordinando logicamente i video in base a un obiettivo.
   */
  async generateLearningPath(goal, videosList, apiKey, model) {
    if (!videosList || videosList.length === 0) return [];
    
    const catalogStr = videosList.map(v => `ID: ${v.id} | Titolo: "${v.title}" | Canale: ${v.channel}`).join('\n');
    
    const prompt = `Sei un tutor didattico esperto.
Il mio obiettivo di apprendimento è: "${goal}"

Ecco l'elenco dei video che ho nel mio archivio/coda:
${catalogStr}

Seleziona SOLO i video pertinenti al mio obiettivo e ordinali in un percorso logico dal più basilare (Lezione 1) al più avanzato. Scarta i video irrilevanti.

Rispondi ESATTAMENTE E SOLO con un array JSON in questo formato (senza formattazione markdown \`\`\`json):
[
  {
    "lessonNumber": 1,
    "title": "Titolo del video selezionato",
    "videoId": "ID del video corrispondente",
    "reason": "Breve motivo (1 frase) per cui questo step è necessario in questa fase"
  },
  ...
]`;

    try {
      const raw = await this.call(prompt, apiKey, {
        maxOutputTokens: 1500,
        temperature: 0.1,
        model: model || this.DEFAULT_MODEL,
      });
      
      const match = raw.match(/\[[\s\S]*?\]/);
      if (!match) return [];
      
      return JSON.parse(match[0]);
    } catch (e) {
      console.warn("Errore generazione learning path:", e);
      return [];
    }
  },

  /**
   * Estrae tag automatici da un video (chiamata rapida ed economica).
   */
  async extractTags(title, description, apiKey, model) {
    const prompt = `Estrai 5-8 tag tematici rilevanti per questo video YouTube.
Titolo: "${title}"
Descrizione: "${(description || '').slice(0, 300)}"
Rispondi SOLO con i tag separati da virgola, senza #, minuscolo. Es: python, automazione, tutorial, api`;

    try {
      const result = await this.call(prompt, apiKey, { maxOutputTokens: 100, temperature: 0.1, model });
      return result.split(',').map(t => t.trim().replace(/[^a-z0-9À-ÿ\s-]/gi, '')).filter(Boolean);
    } catch {
      return [];
    }
  },
};

if (typeof module !== 'undefined') module.exports = GeminiAPI;
