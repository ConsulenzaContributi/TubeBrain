# TubeBrain — Fase 2: Sicurezza & Affidabilità — Design

Data: 2026-05-29
Stato: approvato (in attesa di revisione)
Branch: `security/hardening-v2.1.0`

## Obiettivo

Rendere TubeBrain affidabile e sicuro per uso intensivo, chiudendo tre debolezze emerse
nell'analisi: XSS residuo, fragilità delle chiamate AI, perdita di lavoro quando il
service worker MV3 viene terminato. Fase suddivisa in 3 aree indipendenti.

## Aree

- **Area A — Sanitizzazione XSS completa** (la più critica)
- **Area B — Affidabilità chiamate AI** (retry/backoff, quota, timeout)
- **Area C — Persistenza/ripresa coda MV3**

Ogni area ha il proprio piano di implementazione. Si parte da A.

---

## Area A — Sanitizzazione XSS completa

### Problema
~62 usi di `innerHTML` nel codice live (38 in `dashboard/dashboard.js`, 15 in `popup/popup.js`,
4 in `options/options.js`, 2 in `utils/markdown-generator.js`, 2 in `onboarding/onboarding.js`,
1 in `content-script.js`). Alcuni interpolano dati esterni non sanificati (titoli video, nomi
canale, output AI, messaggi d'errore) → rischio XSS in pagine privilegiate dell'estensione.

### Approccio approvato
1. **Helper condiviso** `utils/sanitize.js` con due funzioni pure ed esportate per Node:
   - `escapeHtml(value)` — escape di `& < > " '`.
   - `sanitizeMarkdownToHtml(text)` — converte un sottoinsieme markdown sicuro (grassetto,
     corsivo, code, newline) dopo aver fatto escape, restituendo HTML innocuo.
2. **Audit sistematico**: per ogni `innerHTML` con interpolazione, una delle tre azioni:
   - se il dato è statico/letterale → lasciare (annotare come verificato);
   - se interpola dati esterni → avvolgere ogni valore con `escapeHtml(...)`;
   - se costruisce nodi complessi → preferire `textContent`/`createElement`.
3. **Difesa di rete**: nessuna nuova dipendenza; helper minimale e testabile.

### Interfacce
- `utils/sanitize.js` esporta `{ escapeHtml, sanitizeMarkdownToHtml }` via `module.exports`
  e si auto-registra su `globalThis`/`window` per l'uso nei file UI (come `AppSchema`).
- `dashboard/dashboard.html`, `popup/popup.html`, `options/options.html` caricano lo script
  prima dei rispettivi `*.js`.

### Testing
- Node: `escapeHtml('<img src=x onerror=alert(1)>')` non contiene `<img`;
  `sanitizeMarkdownToHtml('**ciao** <script>')` non contiene `<script`.
- Grep di regressione: nessun `innerHTML = \`...\${var}...\`` con variabile esterna priva di
  `escapeHtml`/`escHtml` nei file UI (escludendo i casi annotati come statici).

---

## Area B — Affidabilità chiamate AI

### Problema
`utils/gemini.js` e `utils/openai.js` fanno `fetch` senza retry, senza timeout, e con gestione
errori minima. Un 429 (quota) o un timeout di rete fa fallire l'estrazione in modo opaco.

### Approccio approvato
1. **Helper condiviso** `utils/net.js` con `fetchWithRetry(url, options, policy)`:
   - timeout via `AbortController` (default 60s, configurabile);
   - retry con backoff esponenziale + jitter su errori di rete e su HTTP 429/500/502/503/504;
   - rispetto dell'header `Retry-After` quando presente;
   - numero massimo tentativi configurabile (default 3);
   - errori finali con messaggio chiaro (distinzione quota vs rete vs server).
2. `gemini.js`/`openai.js` usano `fetchWithRetry` al posto di `fetch` diretto.
3. Messaggi utente specifici per quota esaurita vs errore temporaneo.

### Testing
- Node con `fetch` mockato: 429 poi 200 → ritorna 200 dopo 1 retry; rispetta `Retry-After`;
  esaurimento tentativi → errore tipizzato; timeout → AbortError gestito.

---

## Area C — Persistenza/ripresa coda MV3

### Problema
In MV3 il service worker viene terminato spesso. Un'estrazione in corso può lasciare un
summary nello stato `extracting` (o equivalente) senza completarsi né riprendere.

### Approccio approvato
1. Allo startup del service worker (`chrome.runtime.onStartup` + all'avvio del modulo),
   eseguire `reconcilePendingExtractions()`:
   - i summary rimasti in stato "in estrazione" da più di N minuti tornano a `pending`;
   - opzionale: rilancio automatico se l'auto-queue è attivo.
2. Marcare l'inizio estrazione con un timestamp (`extractionStartedAt`) per rilevare gli orfani.
3. Nessuna struttura dati nuova: si riusa l'archivio summary in `chrome.storage`.

### Testing
- Node sullo stato: dato un set di summary con stati/timestamp misti,
  `reconcilePendingExtractions(now)` riporta a `pending` solo gli orfani oltre soglia.

---

## Roadmap

- Fase 2 (questa) → Fase 3 (Accuratezza: grounding, fallback trascrizione, costi/token)
  → Fase 4 (Apprendimento: FSRS, analytics, embeddings) → Fase 5 (Ecosistema: integrazioni, i18n).
