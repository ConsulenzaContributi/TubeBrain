# 🔑 Guida alle chiavi API di TubeBrain

Guida passo-passo per ottenere e configurare le chiavi necessarie a TubeBrain.

| Chiave | Obbligatoria? | A cosa serve | Costo |
|--------|:---:|--------------|-------|
| **Gemini API key** | ✅ Sì | Generazione di studio, mappa mentale, istruzioni Antigravity | Gratuita (con limiti generosi) |
| **YouTube Data API key** | ⛔ Opzionale | Import di playlist, metadati avanzati, ricerca canali | Gratuita (quota giornaliera) |

> ⏱️ Tempo necessario: ~5 minuti per Gemini, ~10 per YouTube. Serve solo un account Google.

---

## 1) Gemini API key (obbligatoria)

La chiave Gemini si ottiene da **Google AI Studio**, gratuitamente.

### Passaggi

1. Apri **https://aistudio.google.com/** e accedi con il tuo account Google.
2. In alto/laterale clicca su **"Get API key"** (Ottieni chiave API)
   — oppure vai direttamente a **https://aistudio.google.com/app/apikey**.
3. Clicca **"Create API key"** (Crea chiave API).
4. Se richiesto, scegli o crea un **progetto Google Cloud**:
   - se è la prima volta, lascia che ne crei uno automaticamente ("Create API key in new project").
5. Verrà generata una stringa lunga che inizia tipicamente con `AIza...`.
   **Copiala subito** con il pulsante di copia.
6. ⚠️ **Conservala in un posto sicuro**: è come una password. Non condividerla,
   non pubblicarla, non inserirla in screenshot.

### Inserirla in TubeBrain

1. Clicca sull'icona di **TubeBrain** nella barra di Chrome.
2. Apri **Impostazioni** (⚙️).
3. Nel campo **"Gemini API key"** incolla la chiave copiata.
4. *(Opzionale)* premi **"+"** per aggiungere più chiavi e dare loro un nome:
   TubeBrain le ruota automaticamente quando una esaurisce la quota giornaliera.
5. **Salva**. Sei pronto: apri un video YouTube e premi **Avvia**.

### Limiti e quota (free tier)
- Il piano gratuito ha un limite di richieste al minuto/giorno per modello.
- Se vedi un errore di tipo **quota / 429**, attendi qualche minuto oppure
  aggiungi una **seconda chiave** (anche da un altro progetto/account) e lascia
  che TubeBrain ruoti automaticamente.
- Per video molto lunghi TubeBrain fa più chiamate (studio + mappa + Antigravity):
  con più chiavi eviti i blocchi di quota.

---

## 2) YouTube Data API key (opzionale)

Serve **solo** se vuoi importare intere playlist o arricchire i metadati. Per il
funzionamento base (estrazione di un singolo video) **non è necessaria**.

### Passaggi

1. Apri la **Google Cloud Console**: **https://console.cloud.google.com/**
   e accedi con il tuo account Google.
2. In alto, dal selettore progetti, **crea un nuovo progetto** (es. "TubeBrain")
   oppure seleziona quello già creato per Gemini.
3. Vai su **"API e servizi" → "Libreria"**
   (https://console.cloud.google.com/apis/library).
4. Cerca **"YouTube Data API v3"**, aprila e clicca **"Abilita"**.
5. Vai su **"API e servizi" → "Credenziali"**
   (https://console.cloud.google.com/apis/credentials).
6. Clicca **"+ Crea credenziali" → "Chiave API"**.
7. Copia la chiave generata.
8. *(Consigliato)* clicca **"Limita chiave"** e sotto **"Restrizioni API"**
   seleziona solo **YouTube Data API v3**, così la chiave è più sicura.

### Inserirla in TubeBrain
1. Icona TubeBrain → **Impostazioni**.
2. Incolla la chiave nel campo **"YouTube Data API key"**.
3. **Salva**.

### Quota
- La YouTube Data API ha una **quota giornaliera** (in "unità"). L'uso normale
  rientra ampiamente; import massicci di grandi playlist possono esaurirla.
  In tal caso riprova il giorno dopo o richiedi un aumento di quota.

---

## 3) Sicurezza delle chiavi

- Le chiavi vengono salvate **solo localmente** nel browser (`storage.local`),
  non vengono inviate a server di terze parti dall'estensione.
- **Non** pubblicare le chiavi su GitHub, forum o screenshot.
- Se sospetti che una chiave sia stata esposta, **revocala** e creane una nuova:
  - Gemini: https://aistudio.google.com/app/apikey → cestino accanto alla chiave.
  - YouTube: Cloud Console → Credenziali → elimina/rigenera.

---

## 4) Risoluzione problemi

| Problema | Causa probabile | Soluzione |
|----------|-----------------|-----------|
| "API key mancante" | Chiave non inserita/salvata | Reinserisci in Impostazioni e salva |
| Errore **429 / quota** | Limite giornaliero raggiunto | Attendi, o aggiungi una seconda chiave Gemini |
| "Richiesta rifiutata (HTTP 400)" | Chiave errata o input troppo grande | Verifica la chiave; TubeBrain riprova in automatico con input ridotto |
| Playlist non importata | YouTube Data API non abilitata | Abilita la "YouTube Data API v3" e inserisci la relativa chiave |

Per assistenza: **consulenzacontributi@gmail.com**
