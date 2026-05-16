// core/state-backup.js — Backup ombra per creators, queue, archive e cache locali

const StateBackup = {
  DB_NAME: 'lh-state-backup',
  DB_VERSION: 1,
  STORE: 'snapshots',
  SNAPSHOT_KEY: 'primary-local-state',
  SNAPSHOT_FIELDS: ['creators', 'summaries', 'feedCache', 'channelScans', 'notifiedVideos', 'stats'],

  _openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      req.onupgradeneeded = e => e.target.result.createObjectStore(this.STORE);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  },

  async loadSnapshot() {
    const db = await this._openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readonly');
      const req = tx.objectStore(this.STORE).get(this.SNAPSHOT_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = e => reject(e.target.error);
    });
  },

  async saveSnapshot(snapshot) {
    const db = await this._openDb();
    const payload = {
      savedAt: Date.now(),
      data: snapshot,
    };
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readwrite');
      tx.objectStore(this.STORE).put(payload, this.SNAPSHOT_KEY);
      tx.oncomplete = () => resolve(payload);
      tx.onerror = e => reject(e.target.error);
    });
  },

  async captureFromStorageLocal() {
    const current = await chrome.storage.local.get(this.SNAPSHOT_FIELDS);
    return {
      creators: Array.isArray(current.creators) ? current.creators : [],
      summaries: Array.isArray(current.summaries) ? current.summaries : [],
      feedCache: current.feedCache && typeof current.feedCache === 'object' ? current.feedCache : {},
      channelScans: current.channelScans && typeof current.channelScans === 'object' ? current.channelScans : {},
      notifiedVideos: Array.isArray(current.notifiedVideos) ? current.notifiedVideos : [],
      stats: current.stats && typeof current.stats === 'object' ? current.stats : AppSchema.DEFAULT_STATS,
    };
  },

  async backupNow() {
    const snapshot = await this.captureFromStorageLocal();
    await this.saveSnapshot(snapshot);
    return snapshot;
  },

  isPrimaryDataMissing(localState = {}) {
    const creators = Array.isArray(localState.creators) ? localState.creators.length : 0;
    const summaries = Array.isArray(localState.summaries) ? localState.summaries.length : 0;
    const feedKeys = localState.feedCache ? Object.keys(localState.feedCache).length : 0;
    const scanKeys = localState.channelScans ? Object.keys(localState.channelScans).length : 0;
    const notified = Array.isArray(localState.notifiedVideos) ? localState.notifiedVideos.length : 0;
    return creators === 0 && summaries === 0 && feedKeys === 0 && scanKeys === 0 && notified === 0;
  },

  hasBackupData(snapshot) {
    if (!snapshot?.data) return false;
    return !this.isPrimaryDataMissing(snapshot.data);
  },

  async restoreIfNeeded() {
    const localState = await chrome.storage.local.get(this.SNAPSHOT_FIELDS);
    if (!this.isPrimaryDataMissing(localState)) {
      await this.backupNow();
      return { restored: false, reason: 'primary_present' };
    }

    const snapshot = await this.loadSnapshot();
    if (!this.hasBackupData(snapshot)) {
      return { restored: false, reason: 'no_backup' };
    }

    await chrome.storage.local.set(snapshot.data);
    return { restored: true, reason: 'backup_restored', savedAt: snapshot.savedAt || null };
  },
};

if (typeof module !== 'undefined') module.exports = StateBackup;
