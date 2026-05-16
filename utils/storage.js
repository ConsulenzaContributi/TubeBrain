// utils/storage.js — Gestione centralizzata chrome.storage
// Creators in storage.local, settings in storage.sync

const Storage = {
  _initPromise: null,

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
  },

  // ── SETTINGS ──────────────────────────────────────────────────────────────

  async getSettings() {
    await this.ensureInitialized();
    const stored = await chrome.storage.sync.get(AppSchema.DEFAULT_SETTINGS);
    return AppSchema.normalizeSettings(stored);
  },

  async saveSettings(settings) {
    await this.ensureInitialized();
    await chrome.storage.sync.set(AppSchema.normalizeSettings(settings));
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
    return entry;
  },

  async deleteSummary(id) {
    const summaries = await this.getSummaries();
    await chrome.storage.local.set({ summaries: summaries.filter(s => s.id !== id) });
  },

  async updateSummaryById(id, updates) {
    const summaries = await this.getSummaries();
    const idx = summaries.findIndex(s => s.id === id);
    if (idx === -1) return null;
    summaries[idx] = AppSchema.normalizeSummary({ ...summaries[idx], ...updates, id, updatedAt: Date.now() });
    await chrome.storage.local.set({ summaries });
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
  },
};

// Export per uso nei service worker e pagine extension
if (typeof module !== 'undefined') module.exports = Storage;
