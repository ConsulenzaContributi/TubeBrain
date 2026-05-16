# QA Test Plan

## Obiettivo

Validare `Codex_Chrome-PlugIn_YouTube-Learn v2.0 RC1` su flussi reali prima del test esterno.

## Ambiente minimo

- Chrome aggiornato
- estensione caricata localmente
- Gemini API key valida
- YouTube API key valida per test playlist e metadata batch

## Smoke test obbligatori

### 1. Video YouTube con caption manuali

- aprire video standard con capitoli
- generare `Learning MDX`
- verificare presenza di:
  - trascrizione integrale
  - studio guidato
  - sintesi rapida
  - mappa concettuale
  - flashcard
  - quiz finale

### 2. Video YouTube con caption auto-generate

- verificare comparsa quality signal transcript
- verificare che l'output resti leggibile

### 3. Video YouTube senza caption

- verificare warning chiaro
- verificare che la generazione non rompa il flusso

### 4. Video lungo oltre 60 minuti

- verificare tempi, stabilita e struttura capitoli
- verificare che il documento resti coerente

### 5. Video tecnico con codice parlato

- controllare ricostruzione comandi, file e snippet
- controllare sezioni errori e recovery

### 6. Dashboard archivio

- verificare ricerca
- verificare filtri per stato e canale
- verificare apertura modal
- verificare export `MDX`, `TXT`, `JSON`, `Antigravity`

### 7. Batch import

- incollare piu URL video
- verificare accodamento
- incollare una playlist
- verificare risoluzione dei video con YouTube API key

## Regression test

- feed creator
- auto-queue
- catch-up creator
- semantic search archivio
- chat archivio
- salvataggio locale
- salvataggio su vault Obsidian se configurato

## Casi limite

- URL YouTube non validi
- playlist privata o non raggiungibile
- API key Gemini assente
- API key YouTube assente durante import playlist
- storage con dati legacy
- navigazione YouTube SPA tra due video consecutivi

## Criteri di passaggio

- nessun errore bloccante nel flusso principale
- nessuna perdita dati in archivio
- export funzionanti
- documenti generati con struttura completa
- warning chiari nei casi degradati

## Output QA richiesto

Per ogni sessione test annotare:

- scenario
- risultato
- bug
- severita
- passaggi per riproduzione
