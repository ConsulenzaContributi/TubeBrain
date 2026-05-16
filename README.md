# Codex_Chrome-PlugIn_YouTube-Learn

Chrome Extension MV3 per trasformare video YouTube in documenti `MDX` orientati all'apprendimento.

Stato attuale: `v2.0 RC1`

## Cosa fa

- estrae trascrizione e capitoli da YouTube
- genera un file `MDX` con 3 livelli:
  - trascrizione integrale
  - studio guidato
  - sintesi rapida
- aggiunge mappa concettuale, flashcard, quiz ed errori frequenti
- produce output strutturati per Google Antigravity
- salva tutto in archivio locale con dashboard di ricerca
- supporta export `MDX`, `TXT`, `JSON` e `Antigravity JSON`
- supporta import batch da URL e playlist

## Requisiti

- Chrome o browser Chromium-based
- Gemini API key
- YouTube Data API key opzionale ma consigliata
  - necessaria per playlist import e metadata enrichment avanzato

## Installazione

1. Apri `chrome://extensions/`
2. Attiva `Modalità sviluppatore`
3. Clicca `Carica estensione non pacchettizzata`
4. Seleziona la cartella del progetto
5. Apri `Impostazioni` dell'estensione e configura almeno la Gemini API key

## Flusso principale

1. Apri un video YouTube
2. Dal popup scegli la modalità iniziale
3. Premi `Genera Learning MDX`
4. Il file viene salvato in `LearningHub/`
5. Riapri, filtra ed esporta tutto dalla dashboard

## Struttura progetto

```text
manifest.json
background.js
content-script.js
schemas/
core/
renderers/
utils/
popup/
options/
dashboard/
docs/
tests/
```

## Documentazione interna

- [Blueprint software house](/Volumes/Crucial%20X9/CodexX9/codex_chrome-plugin_youtube-learn/docs/softwarehouse-project-blueprint.md)
- [Blueprint prodotto](/Volumes/Crucial%20X9/CodexX9/codex_chrome-plugin_youtube-learn/docs/learning-plugin-blueprint.mdx)
- [QA test plan](/Volumes/Crucial%20X9/CodexX9/codex_chrome-plugin_youtube-learn/docs/qa-test-plan.md)
- [Release checklist RC1](/Volumes/Crucial%20X9/CodexX9/codex_chrome-plugin_youtube-learn/docs/release-candidate-rc1.md)

## Test disponibili

Eseguibili con Node:

```bash
node tests/passaggio1-foundation.test.js
node tests/passaggio3-learning-engine.test.js
node tests/passaggio4-exports.test.js
```

## Note privacy

- API key salvate nel browser
- archivio salvato localmente
- il testo inviato a Gemini dipende dal contenuto estratto e dalla generazione richiesta

## Licenza

MIT
