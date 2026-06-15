# 🧠 TubeBrain

**Estensione Chrome (Manifest V3) che trasforma qualsiasi video YouTube in una piattaforma di apprendimento basata su AI.**

> **Versione attuale: `v1.0.1`** — [scarica l'ultima release](https://github.com/ConsulenzaContributi/TubeBrain/releases/latest)
>
> Questo branch (`main`) è la **vetrina di distribuzione**: contiene solo questa guida e lo ZIP installabile. Il **codice sorgente** completo è nel branch [`source`](https://github.com/ConsulenzaContributi/TubeBrain/tree/source).

---

## Cos'è TubeBrain

TubeBrain prende un video YouTube (anche lungo, anche tecnico) e ne genera uno
**spazio di studio interattivo**: trascrizione fedele, studio guidato per capitolo,
mappa mentale navigabile in stile NotebookLM e istruzioni operative pronte da
incollare in un IDE o in Google Antigravity. Tutto resta **locale** nel browser e
viene salvato anche come file Markdown portabile (Obsidian-friendly).

### Funzionalità principali

- **🎬 Studio (video)** — trasposizione fedele dei capitoli reali del video, con
  approfondimenti evidenziati e riferimenti temporali cliccabili.
- **🧠 Mappa mentale dinamica (stile NotebookLM)** — albero orizzontale espandibile
  (SVG): nodi cliccabili con approfondimento in pannello laterale, testo multi-riga,
  pan/zoom, espandi/comprimi tutto, schermo intero. Funziona anche senza AI (fallback
  costruito dai capitoli).
- **🛠 Istruzioni Antigravity per capitolo** — per ogni capitolo azionabile, un prompt
  copia-incolla (Obiettivo / Istruzioni / Criteri di accettazione) + operazioni
  atomiche, pronti da eseguire in un IDE o in Antigravity. I capitoli puramente
  teorici mostrano la motivazione.
- **📝 Trascrizione integrale** con timestamp che aprono il punto esatto su YouTube.
- **📦 Esportazione Markdown** con data/ora di estrazione, frontmatter e tag.
- **🔑 Chiavi API multiple** per provider con rotazione automatica; estrazione come
  **job di background** che continua anche cambiando pagina.
- **🗂 Archivio locale** con dashboard di ricerca per creator.

---

## Requisiti

- Google Chrome (o browser Chromium-based: Edge, Brave, ecc.).
- Una **Gemini API key** (gratuita su [Google AI Studio](https://aistudio.google.com/)).
- *(Opzionale)* una **YouTube Data API key** per import di playlist e metadati avanzati.

---

## Installazione

1. Vai alla pagina **[Releases](https://github.com/ConsulenzaContributi/TubeBrain/releases/latest)**
   e scarica il file **`TubeBrain-v1.0.1.zip`**.
2. **Estrai** lo zip in una cartella a tua scelta (es. `~/TubeBrain`).
3. Apri Chrome e vai su **`chrome://extensions`**.
4. Attiva in alto a destra la **Modalità sviluppatore**.
5. Clicca **"Carica estensione non pacchettizzata"** e seleziona la cartella estratta.
6. L'icona di TubeBrain comparirà nella barra. Aprila → **Impostazioni** → incolla la
   tua **Gemini API key** e salva.

> 🔑 Non sai come ottenere le chiavi API? Segui la **[Guida alle chiavi API](GUIDA_CHIAVI_API.md)**
> (passo-passo per Gemini e YouTube Data API).

### Aggiornare a una nuova versione

Scarica il nuovo zip, estrailo (sovrascrivendo la cartella) e premi l'icona di
**ricarica ⟳** sull'estensione in `chrome://extensions`.

---

## Come si usa

1. Apri un video su YouTube.
2. Clicca l'icona di TubeBrain e premi **Avvia** estrazione.
3. Al termine apri lo **Studio**: troverai Panoramica, **Mappa mentale**,
   **Trascrizione** comparata e la colonna **Istruzioni Antigravity**.
4. Il documento viene salvato anche come file `.md` nella cartella configurata.

---

## Versioni

Il changelog completo è in [`CHANGELOG.md`](CHANGELOG.md). Ogni release è taggata e
pubblicata nella sezione [Releases](https://github.com/ConsulenzaContributi/TubeBrain/releases).

---

## Licenza

⚠️ **Software proprietario — Tutti i diritti riservati.** TubeBrain **non** è open
source. È consentito il solo **uso personale e non commerciale** dell'estensione
distribuita ufficialmente. Sono vietati redistribuzione, modifica, uso commerciale
e reverse engineering a fini commerciali. Vedi [`LICENSE`](LICENSE).
Per usi commerciali o licenze: **consulenzacontributi@gmail.com**.
