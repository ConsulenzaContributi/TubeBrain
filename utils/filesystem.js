// utils/filesystem.js — File System Access API + IndexedDB
// Permette al service worker di scrivere file direttamente nella cartella vault
// senza mostrare il dialogo di Chrome "Salva con nome".

const FileSystemUtils = {
  DB_NAME:    'lh-filesystem',
  DB_VERSION: 1,
  STORE:      'handles',
  HANDLE_KEY: 'obsidian-vault',

  _openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      req.onupgradeneeded = e => e.target.result.createObjectStore(this.STORE);
      req.onsuccess  = e => resolve(e.target.result);
      req.onerror    = e => reject(e.target.error);
    });
  },

  // Salva il FileSystemDirectoryHandle in IndexedDB (chiamato dalla options page)
  async saveHandle(handle) {
    const db = await this._openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).put(handle, this.HANDLE_KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror    = e => reject(e.target.error);
    });
  },

  // Recupera il handle (può essere chiamato dal service worker)
  async getHandle() {
    const db = await this._openDb();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(this.STORE, 'readonly');
      const req = tx.objectStore(this.STORE).get(this.HANDLE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = e => reject(e.target.error);
    });
  },

  // Rimuove il handle (quando l'utente deseleziona la cartella)
  async clearHandle() {
    const db = await this._openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).delete(this.HANDLE_KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror    = e => reject(e.target.error);
    });
  },

  // Scrive un file in un percorso relativo sotto il directory handle
  // relativePath: es. "Raffaele_Gaito/2026/2026-02-20_titolo.md"
  async writeFile(dirHandle, relativePath, content) {
    const parts    = relativePath.split('/').filter(Boolean);
    const filename = parts.pop();

    // Naviga / crea le sottocartelle
    let dir = dirHandle;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }

    // Scrivi il file (sovrascrive se esiste)
    const fileHandle = await dir.getFileHandle(filename, { create: true });
    const writable   = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
    return relativePath;
  },

  // Tenta di scrivere il file usando il handle in IndexedDB.
  // Ritorna { success: true, path } oppure { success: false, reason }
  async trySaveToVault(relativePath, content) {
    try {
      const handle = await this.getHandle();
      if (!handle) return { success: false, reason: 'no_handle' };

      // Verifica permesso (funziona nel service worker senza user gesture in MV3)
      let perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        // In un service worker non possiamo chiamare requestPermission (richiede user gesture).
        // Segnaliamo che serve re-autorizzazione.
        return { success: false, reason: 'permission_denied' };
      }

      await this.writeFile(handle, relativePath, content);
      return { success: true, path: relativePath };
    } catch (err) {
      return { success: false, reason: err.message };
    }
  },
};

if (typeof module !== 'undefined') module.exports = FileSystemUtils;
