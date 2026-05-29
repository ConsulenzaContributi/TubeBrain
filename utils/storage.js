// utils/storage.js — Gestione centralizzata chrome.storage
// Creators in storage.local, settings in storage.sync
// Aggiornato a v2.4.0 con feature #4 (Learning Paths), #5 (Ricerca ranked), #14 (Test Pre/Post)

const Storage = {
  _initPromise: null,
  SETTINGS_BACKUP_KEY: 'settingsBackup',
  SECRET_KEYS: ['geminiApiKey', 'openaiApiKey', 'youtubeApiKey'],

  _stripSecrets(settings) {
    const copy = { ...settings };
    for (const k of this.SECRET_KEYS) delete copy[k];
    return copy;
  },

  _mergeSecrets(target, source) {
    for (const k of this.SECRET_KEYS) {
      if (source && source[k]) target[k] = source[k];
    }
    return target;
  },

  async ensureInitialized() {
    if (!this._initPromise) {
      this._initPromise = StorageMigrations.ensureAll().catch(err => {
        this._initPromise = null;
        throw err;
      });
    }
    return this._initPromise;
  },

  async syncCreatorStatsCount(creators) {
    const stats = await this.getStats();
    stats.totalCreators = creators.length;
    await chrome.storage.local.set({ stats });
    await this.backupAppState();
  },

  // ── SETTINGS ──────────────────────────────────────────────────────────────

  async getSettings() {
    await this.ensureInitialized();
    const [storedSync, storedLocal] = await Promise.all([
      chrome.storage.sync.get(AppSchema.DEFAULT_SETTINGS),
      chrome.storage.local.get(this.SETTINGS_BACKUP_KEY),
    ]);

    const syncSettings = AppSchema.normalizeSettings(storedSync);
    const localSettings = AppSchema.normalizeSettings(storedLocal[this.SETTINGS_BACKUP_KEY] || {});
    const syncMeaningful = this.hasMeaningfulSettings(syncSettings);
    const localMeaningful = this.hasMeaningfulSettings(localSettings);

    let resolved = syncSettings;
    if (!syncMeaningful && localMeaningful) {
      resolved = localSettings;
      await chrome.storage.sync.set(this._stripSecrets(resolved));
    } else if (syncMeaningful && localMeaningful && localSettings.settingsUpdatedAt > syncSettings.settingsUpdatedAt) {
      resolved = localSettings;
      await chrome.storage.sync.set(this._stripSecrets(resolved));
    }

    // I segreti (API key) vivono solo in storage.local: ripristinali dal backup locale.
    this._mergeSecrets(resolved, localSettings);

    await chrome.storage.local.set({ [this.SETTINGS_BACKUP_KEY]: resolved });
    return resolved;
  },

  async saveSettings(settings) {
    await this.ensureInitialized();
    const normalized = AppSchema.normalizeSettings({
      ...settings,
      settingsUpdatedAt: Date.now(),
    });
    await Promise.all([
      chrome.storage.sync.set(this._stripSecrets(normalized)),
      chrome.storage.local.set({ [this.SETTINGS_BACKUP_KEY]: normalized }),
    ]);
  },

  async backupAppState() {
    if (!globalThis.StateBackup?.backupNow) return;
    await StateBackup.backupNow();
  },

  hasMeaningfulSettings(settings = {}) {
    return Boolean(
      settings.geminiApiKey ||
      settings.geminiApiKeyTested ||
      settings.openaiApiKey ||
      settings.openaiApiKeyTested ||
      settings.youtubeApiKey ||
      settings.downloadFolder ||
      settings.useFileSystemApi ||
      settings.provider !== AppSchema.DEFAULT_SETTINGS.provider ||
      settings.model !== AppSchema.DEFAULT_SETTINGS.model ||
      settings.openaiModel !== AppSchema.DEFAULT_SETTINGS.openaiModel ||
      settings.language !== AppSchema.DEFAULT_SETTINGS.language ||
      settings.defaultLearningMode !== AppSchema.DEFAULT_SETTINGS.defaultLearningMode ||
      settings.outputFormat !== AppSchema.DEFAULT_SETTINGS.outputFormat ||
      settings.autoQueueInterval !== AppSchema.DEFAULT_SETTINGS.autoQueueInterval
    );
  },

  // ── CREATORS ──────────────────────────────────────────────────────────────

  async getCreators() {
    await this.ensureInitialized();
    const { creators = [] } = await chrome.storage.local.get('creators');
    return creators.map(creator => AppSchema.normalizeCreator(creator));
  },

  async addCreator(creator) {
    // creator: { channelId, channelName, channelUrl, platform, addedAt, lastChecked, avatar }
    const creators = await this.getCreators();

    // Controllo duplicati: per channelId E per nome normalizzato (cattura @handle vs /channel/UC...)
    const normalize = s => (s || '').toLowerCase().replace(/[\s_-]/g, '');
    const exists = creators.find(c =>
      c.channelId === creator.channelId ||
      (creator.channelName && c.channelName &&
       normalize(c.channelName) === normalize(creator.channelName))
    );
    if (exists) return { success: false, reason: 'already_exists' };

    const now = Date.now();
    creators.push({
      ...creator,
      addedAt:             now,
      followedAt:          now,     // timestamp per filtrare video post-follow
      lastChecked:         null,
      lastQueueCheck:      null,
      newCount:            0,
      autoQueueEnabled:    true,    // abilita auto-queue per questo creator
      isPriority:          false,   // priority → estrai subito invece di accodare
      minDurationMinutes:  0,       // 0 = nessun filtro durata
      queueKeywords:       [],      // parole chiave titolo per auto-queue
      queueContentTypes:   ['video', 'short', 'live'],
      queueDurationBuckets:['flash', 'quick', 'standard', 'deep', 'marathon'],
      includeBeforeFollowedAt: false,
      massQueueLimit:      100,
      massQueueProfile:    null,
    });
    const normalized = creators.map(entry => AppSchema.normalizeCreator(entry));
    await chrome.storage.local.set({ creators: normalized });
    await this.syncCreatorStatsCount(normalized);
    return { success: true };
  },

  async removeCreator(channelId) {
    const creators = await this.getCreators();
    const filtered = creators.filter(c => c.channelId !== channelId);
    await chrome.storage.local.set({ creators: filtered });
    await this.syncCreatorStatsCount(filtered);
  },

  async updateCreator(channelId, updates) {
    const creators = await this.getCreators();
    const idx = creators.findIndex(c => c.channelId === channelId);
    if (idx !== -1) {
      creators[idx] = AppSchema.normalizeCreator({ ...creators[idx], ...updates });
      await chrome.storage.local.set({ creators });
      await this.backupAppState();
    }
  },

  // ── SUMMARIES (archivio) ──────────────────────────────────────────────────

  async getSummaries() {
    await this.ensureInitialized();
    const { summaries = [] } = await chrome.storage.local.get('summaries');
    return summaries.map(summary => AppSchema.normalizeSummary(summary));
  },

  async saveSummary(summary) {
    // summary: { id, videoId, title, channelName, channelId, url, markdown, createdAt, tags, platform }
    const summaries = await this.getSummaries();
    const id = `sm_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    const entry = AppSchema.normalizeSummary({ ...summary, id, createdAt: Date.now(), updatedAt: Date.now() });
    summaries.unshift(entry); // più recente prima
    await chrome.storage.local.set({ summaries });
    await this.backupAppState();
    return entry;
  },

  async deleteSummary(id) {
    const summaries = await this.getSummaries();
    await chrome.storage.local.set({ summaries: summaries.filter(s => s.id !== id) });
    await this.backupAppState();
  },

  async updateSummaryById(id, updates) {
    const summaries = await this.getSummaries();
    const idx = summaries.findIndex(s => s.id === id);
    if (idx === -1) return null;
    summaries[idx] = AppSchema.normalizeSummary({ ...summaries[idx], ...updates, id, updatedAt: Date.now() });
    await chrome.storage.local.set({ summaries });
    await this.backupAppState();
    return summaries[idx];
  },

  async searchSummaries(query) {
    const summaries = await this.getSummaries();
    if (!query) return summaries;
    const q = query.toLowerCase();
    return summaries.filter(s =>
      s.title?.toLowerCase().includes(q) ||
      s.channelName?.toLowerCase().includes(q) ||
      s.markdown?.toLowerCase().includes(q) ||
      s.tags?.some(t => t.toLowerCase().includes(q))
    );
  },

  // ── FEED CACHE ────────────────────────────────────────────────────────────

  async getFeedCache() {
    await this.ensureInitialized();
    const { feedCache = {} } = await chrome.storage.local.get('feedCache');
    return feedCache; // { channelId: [{ videoId, title, publishedAt, url, thumbnail }] }
  },

  async setFeedCache(channelId, videos) {
    const feedCache = await this.getFeedCache();
    feedCache[channelId] = videos;
    await chrome.storage.local.set({ feedCache });
    await this.backupAppState();
  },

  // ── CHANNEL SCANS ────────────────────────────────────────────────────────

  async getChannelScans() {
    await this.ensureInitialized();
    const { channelScans = {} } = await chrome.storage.local.get('channelScans');
    return channelScans;
  },

  async getChannelScan(channelId) {
    const channelScans = await this.getChannelScans();
    return channelScans[channelId] || null;
  },

  async setChannelScan(channelId, scan) {
    const channelScans = await this.getChannelScans();
    channelScans[channelId] = scan;
    await chrome.storage.local.set({ channelScans });
    await this.backupAppState();
  },

  // ── AUTO-QUEUE ────────────────────────────────────────────────────────────

  /** Ritorna il Set degli videoId già presenti in archivio (pending o estratti). */
  async getQueuedVideoIds() {
    const summaries = await this.getSummaries();
    return new Set(summaries.map(s => s.videoId).filter(Boolean));
  },

  /** Aggiorna le impostazioni di auto-queue di un creator. */
  async updateCreatorQueueSettings(channelId, queueSettings) {
    await this.updateCreator(channelId, queueSettings);
  },

  // ── TOPIC ALERTS ─────────────────────────────────────────────────────────

  async updateCreatorTopics(channelId, topics) {
    await this.updateCreator(channelId, { topics: topics || [] });
  },

  async getNotifiedVideos() {
    await this.ensureInitialized();
    const { notifiedVideos = [] } = await chrome.storage.local.get('notifiedVideos');
    return new Set(notifiedVideos);
  },

  async addNotifiedVideos(videoIds) {
    const existing = await this.getNotifiedVideos();
    const merged = [...existing, ...videoIds];
    const trimmed = merged.slice(-500); // mantieni solo gli ultimi 500
    await chrome.storage.local.set({ notifiedVideos: trimmed });
    await this.backupAppState();
  },

  // ── STATS ─────────────────────────────────────────────────────────────────

  async getStats() {
    await this.ensureInitialized();
    const { stats = { totalSummarized: 0, totalCreators: 0, byMonth: {} } } =
      await chrome.storage.local.get('stats');
    return AppSchema.normalizeStats(stats);
  },

  async incrementStat() {
    const stats = await this.getStats();
    stats.totalSummarized = (stats.totalSummarized || 0) + 1;
    const monthKey = new Date().toISOString().slice(0, 7); // "2026-05"
    stats.byMonth[monthKey] = (stats.byMonth[monthKey] || 0) + 1;
    await chrome.storage.local.set({ stats });
    await this.backupAppState();
  },

  // ── FEATURE #5 — Ricerca Semantica con Ranking ────────────────────────────────

  /**
   * Ricerca nei summary con ranking per rilevanza (keyword avanzato).
   * Restituisce i summary ordinati per score decrescente.
   * @param {string} query
   * @returns {Promise<Array>}
   */
  async searchSummariesRanked(query) {
    const summaries = await this.getSummaries();
    if (!query) return summaries;
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return summaries
      .map(s => {
        let score = 0;
        const text = [s.title, s.channelName, ...(s.tags || []), s.markdown].join(' ').toLowerCase();
        terms.forEach(term => {
          if (s.title?.toLowerCase().includes(term)) score += 10;
          if (s.tags?.some(t => t.toLowerCase().includes(term))) score += 5;
          if (s.channelName?.toLowerCase().includes(term)) score += 3;
          const occurrences = (text.match(new RegExp(term, 'gi')) || []).length;
          score += Math.min(occurrences, 20);
        });
        return { ...s, _score: score };
      })
      .filter(s => s._score > 0)
      .sort((a, b) => b._score - a._score);
  },

  // ── FEATURE #4 — Learning Paths ───────────────────────────────────────────────

  /**
   * Ritorna tutti i percorsi di apprendimento salvati.
   * @returns {Promise<Array<{ id, name, summaryIds, createdAt, description }>>}
   */
  async getLearningPaths() {
    const { learningPaths = [] } = await chrome.storage.local.get('learningPaths');
    return learningPaths;
  },

  /**
   * Salva un percorso di apprendimento (crea o aggiorna per id).
   * @param {{ id?: string, name: string, summaryIds?: string[], description?: string }} path
   * @returns {Promise<object>} il percorso salvato
   */
  async saveLearningPath(path) {
    const paths = await this.getLearningPaths();
    const id = path.id || `lp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const existing = paths.findIndex(p => p.id === id);
    const entry = {
      id,
      name:       path.name || 'Percorso senza nome',
      summaryIds: path.summaryIds || [],
      description: path.description || '',
      createdAt:  path.createdAt || Date.now(),
      updatedAt:  Date.now(),
    };
    if (existing !== -1) paths[existing] = entry;
    else paths.push(entry);
    await chrome.storage.local.set({ learningPaths: paths });
    return entry;
  },

  /**
   * Elimina un percorso di apprendimento per id.
   * @param {string} id
   */
  async deleteLearningPath(id) {
    const paths = await this.getLearningPaths();
    await chrome.storage.local.set({ learningPaths: paths.filter(p => p.id !== id) });
  },

  /**
   * Aggiunge un summary a un percorso di apprendimento esistente.
   * @param {string} pathId
   * @param {string} summaryId
   */
  async addToLearningPath(pathId, summaryId) {
    const paths = await this.getLearningPaths();
    const idx = paths.findIndex(p => p.id === pathId);
    if (idx === -1) throw new Error('Percorso non trovato');
    if (!paths[idx].summaryIds.includes(summaryId)) {
      paths[idx].summaryIds.push(summaryId);
      paths[idx].updatedAt = Date.now();
    }
    await chrome.storage.local.set({ learningPaths: paths });
    return paths[idx];
  },

  // ── FEATURE #14 — Test Pre/Post ───────────────────────────────────────────────

  /**
   * Salva le risposte al pre-test per un summary.
   * @param {string} summaryId
   * @param {object} answers - { [questionId]: selectedOption }
   */
  async savePreTest(summaryId, answers) {
    const { preTests = {} } = await chrome.storage.local.get('preTests');
    preTests[summaryId] = { answers, savedAt: Date.now() };
    await chrome.storage.local.set({ preTests });
  },

  /**
   * Ritorna le risposte al pre-test per un summary.
   * @param {string} summaryId
   * @returns {Promise<object|null>}
   */
  async getPreTest(summaryId) {
    const { preTests = {} } = await chrome.storage.local.get('preTests');
    return preTests[summaryId] || null;
  },

  /**
   * Salva le risposte al post-test per un summary.
   * @param {string} summaryId
   * @param {object} answers - { [questionId]: selectedOption }
   */
  async savePostTest(summaryId, answers) {
    const { postTests = {} } = await chrome.storage.local.get('postTests');
    postTests[summaryId] = { answers, savedAt: Date.now() };
    await chrome.storage.local.set({ postTests });
  },

  /**
   * Confronta pre-test e post-test e ritorna il delta di miglioramento.
   * Richiede che le risposte siano nel formato { [questionId]: selectedOption }.
   * Il confronto avviene sulle domande con la chiave `correct` nelle opzioni.
   * @param {string} summaryId
   * @returns {Promise<{ improved: string[], regressed: string[], delta: number }>}
   */
  async getTestDelta(summaryId) {
    const [preData, { postTests = {} }] = await Promise.all([
      this.getPreTest(summaryId),
      chrome.storage.local.get('postTests'),
    ]);
    const postData = postTests[summaryId] || null;
    if (!preData || !postData) return { improved: [], regressed: [], delta: 0 };

    const pre  = preData.answers  || {};
    const post = postData.answers || {};
    const allIds = new Set([...Object.keys(pre), ...Object.keys(post)]);
    const improved   = [];
    const regressed  = [];

    for (const qId of allIds) {
      // Le risposte sono coppie { selected, correct }
      const preCorrect  = pre[qId]?.selected  === pre[qId]?.correct;
      const postCorrect = post[qId]?.selected === post[qId]?.correct;
      if (!preCorrect && postCorrect) improved.push(qId);
      if (preCorrect && !postCorrect) regressed.push(qId);
    }

    const delta = improved.length - regressed.length;
    return { improved, regressed, delta };
  },

  // ── FEATURE #4 — Visual Notes (Screenshot) ───────────────────────────────────

  _openFramesDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('lh-frames', 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('frames')) {
          db.createObjectStore('frames', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  },

  async saveVideoFrame(videoId, timestampStr, base64Data) {
    const db = await this._openFramesDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('frames', 'readwrite');
      tx.objectStore('frames').add({ videoId, timestampStr, base64Data, createdAt: Date.now() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = e => reject(e.target.error);
    });
  },

  async getVideoFrames(videoId) {
    const db = await this._openFramesDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('frames', 'readonly');
      const req = tx.objectStore('frames').getAll();
      req.onsuccess = e => {
        const all = e.target.result || [];
        resolve(all.filter(f => f.videoId === videoId).sort((a, b) => a.createdAt - b.createdAt));
      };
      req.onerror = e => reject(e.target.error);
    });
  },

  async deleteVideoFrames(videoId) {
    const db = await this._openFramesDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('frames', 'readwrite');
      const store = tx.objectStore('frames');
      const req = store.getAll();
      req.onsuccess = e => {
        const all = e.target.result || [];
        all.forEach(f => {
          if (f.videoId === videoId) store.delete(f.id);
        });
        resolve(true);
      };
      req.onerror = e => reject(e.target.error);
    });
  },
};

// Export per uso nei service worker e pagine extension
if (typeof module !== 'undefined') module.exports = Storage;
