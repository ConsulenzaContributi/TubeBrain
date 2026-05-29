# TubeBrain — Fase 4 (Apprendimento) + Fase 5 (Ecosistema, parti sicure) — Design

Data: 2026-05-30
Stato: approvato (TF-IDF locale; Fase 5 = solo parti sicure)
Branch: `security/hardening-v2.1.0`

## Decisioni
- Ricerca semantica locale = **TF-IDF + coseno** (nessuna dipendenza, nessun modello, nessun costo).
- Fase 5 = **solo parti sicure**: i18n (infrastruttura + EN stringhe chiave + switch lingua).
  Integrazioni esterne (Notion/AnkiConnect) e ingestione PDF **rimandate** a fase futura.

## Stato di partenza (verificato)
- `utils/spaced-repetition.js`: algoritmo **SM-2** (campi easeFactor/interval/dueDate/repetitions).
- `utils/progress-tracker.js`: sessioni, sezioni lette, `getGlobalStats`.
- `chrome.alarms`/`chrome.notifications` già usati (coda); nessun promemoria di ripasso.
- Nessun `_locales`, UI solo in italiano.

## Fase 4 — Apprendimento

### Area 4A — Scheduler FSRS + promemoria ripasso
- Nuovo modulo puro `utils/fsrs.js`: `schedule(state, rating, now)` con stabilità/difficoltà
  (rating 1=again,2=hard,3=good,4=easy), ritorna `{ stability, difficulty, dueDate, interval, reps }`.
- `spaced-repetition.updateCard` delega a `fsrs.schedule` mappando la `quality` SM-2 → `rating`,
  mantenendo retrocompatibilità dei campi salvati (aggiunge stability/difficulty).
- Promemoria: alarm giornaliero `review-reminder` che conta le card in scadenza e notifica.

### Area 4B — Analytics di studio
- `utils/analytics.js` (puro): `computeStreak(sessionsByDay, now)`, `computeRetention(reviews)`,
  `dueForecast(cards, now, days)`.
- Dashboard (tab Stats): mostra streak, tempo totale, sezioni lette, card in scadenza (oggi/7gg).

### Area 4C — Ricerca TF-IDF locale
- `utils/tfidf.js` (puro): `buildIndex(docs)` (tokenizza, IDF), `search(query, index, topK)` (coseno).
- Handler background `LOCAL_SEARCH` su titoli+contenuti dei summary; usato dalla ricerca dashboard
  come opzione "ricerca intelligente" istantanea e offline.

## Fase 5 — Ecosistema (solo parti sicure)

### Area 5B — Internazionalizzazione (i18n)
- i18n **custom** (per consentire switch a runtime, che `chrome.i18n` non offre):
  `utils/i18n.js` con dizionari `{ it, en }`, `t(key, lang)` con fallback a `it` e alla chiave.
- `settings.uiLanguage` (it|en) + selettore nelle Impostazioni.
- Traduzione EN delle **stringhe chiave** di popup/dashboard/options (non copertura totale).

## Roadmap residua (rimandata)
- Integrazioni Notion/AnkiConnect (token utente), sync bidirezionale Obsidian.
- Ingestione PDF/slide e altre piattaforme di corsi (pdf.js).
