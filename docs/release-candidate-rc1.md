# Release Notes v2.2.7

## Versione

- prodotto: `v2.2.7`
- manifest: `2.2.7`

## Scope incluso

- base tecnica con schema e migrazioni
- popup, options e dashboard riallineati al prodotto learning
- motore `MDX` a 3 livelli
- mappa concettuale
- flashcard
- quiz finale
- errori frequenti e recovery
- export `MDX`, `TXT`, `JSON`, `Antigravity`
- import batch da URL e playlist

## Test automatici disponibili

```bash
node tests/passaggio1-foundation.test.js
node tests/passaggio3-learning-engine.test.js
node tests/passaggio4-exports.test.js
```

## Checklist pre-test esterno

- [ ] Gemini API key configurata
- [ ] YouTube API key configurata per test playlist
- [ ] estensione caricata in Chrome
- [ ] storage legacy verificato
- [ ] smoke test video corto completato
- [ ] smoke test video lungo completato
- [ ] smoke test video tecnico completato
- [ ] export JSON e Antigravity verificati
- [ ] import batch verificato

## Rischi residui noti

- import playlist pensato per RC, non ancora per carichi enterprise
- output AI dipendente dalla qualita reale delle caption
- alcuni flussi article/instagram sono meno rifiniti del flusso YouTube
- verifica visuale end-to-end in browser ancora necessaria su casi reali

## Criterio di promozione a beta

Promuovere la RC a beta solo se:

- nessun bug bloccante nel flusso YouTube principale
- archivio stabile
- export coerenti
- batch ingest affidabile
- QA manuale completata secondo `docs/qa-test-plan.md`
