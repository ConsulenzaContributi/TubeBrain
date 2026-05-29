# TubeBrain — Fase 3: Accuratezza — Design

Data: 2026-05-30
Stato: approvato (decisione 3B: auto-caption + messaggio chiaro)
Branch: `security/hardening-v2.1.0`

## Obiettivo
Migliorare l'accuratezza e la trasparenza dell'estrazione: ancorare i contenuti al video,
gestire l'assenza di sottotitoli senza output spazzatura, e mostrare costi/token prima di generare.

## Stato di partenza (verificato nel codice)
- I prompt (`GeminiAPI.build*Prompt`, riusati anche da OpenAI) **già** richiedono timestamp per capitolo.
- I sottotitoli **auto-generati** (`kind:'asr'`) sono **già** inclusi e usati come fallback in
  `selectBestTrack`; il popup mostra già un warning `no_captions`.
- Manca: marcatura esplicita delle inferenze; blocco pulito quando la trascrizione è vuota;
  stima costi/token.

## Aree

### Area A — Grounding esteso (prompt)
**Approccio:** aggiungere a `GeminiAPI.buildLearningSectionsPrompt` (e al prompt tutorial)
una regola esplicita: ogni sezione inizia con `[mm:ss]`; ogni affermazione fattuale chiave
riporta il timestamp di origine dalla trascrizione; i contenuti dedotti e non presenti nella
trascrizione vanno marcati con il prefisso `(inferenza)`. Il viewer già rende cliccabili i `[mm:ss]`.
**Test:** il prompt generato contiene la regola di grounding e di marcatura inferenze.

### Area B — Fallback trascrizione (auto-caption + messaggio chiaro)
**Approccio:** quando non esiste alcuna traccia sottotitoli (né manuale né `asr`),
NON generare da trascrizione vuota: interrompere con messaggio chiaro e riportare il summary
a `pending` con un flag `noCaptions:true`. Auto-caption resta il fallback primario (già attivo).
**Punti:** `doBackgroundExtraction` (background.js, ~riga 632): se `!track` → stop pulito.
**Test:** funzione pura `hasUsableTranscript(videoData)` → false su transcript vuoto/track assente.

### Area C — Costi/token trasparenti
**Approccio:** nuovo modulo `utils/cost.js` (puro, testabile):
- `estimateTokens(text)` ≈ `ceil(chars/4)`;
- `MODEL_PRICING` tabella (USD per 1M token, input) per i modelli supportati;
- `estimateCostUsd(tokens, model)`;
- `recommendModel(tokens)` → modello consigliato per lunghezza (flash per brevi, pro per lunghi).
UI: nel popup, prima di "Genera", mostrare una riga "Stima: ~N token · ~$X · modello consigliato Y".
**Test:** Node su `estimateTokens`, `estimateCostUsd`, `recommendModel`.

## Roadmap successiva
Fase 4 (Apprendimento: FSRS, analytics, embeddings) → Fase 5 (Ecosistema: integrazioni, i18n, oltre-YouTube).
