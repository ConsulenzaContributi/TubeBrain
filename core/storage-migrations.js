// core/storage-migrations.js — Versioning e migrazioni storage

const StorageMigrations = {
  LOCAL_META_KEY: 'appMeta',
  SETTINGS_BACKUP_KEY: 'settingsBackup',

  migrateLocalState(state = {}) {
    const currentVersion = state?.appMeta?.storageSchemaVersion || 0;
    let changed = currentVersion < AppSchema.VERSION;

    const creators = AppSchema.normalizeArray(state.creators).map(creator => AppSchema.normalizeCreator(creator));
    const summaries = AppSchema.normalizeArray(state.summaries).map(summary => AppSchema.normalizeSummary(summary));
    const stats = AppSchema.normalizeStats({
      ...state.stats,
      totalCreators: creators.length,
    });

    return {
      changed,
      state: {
        ...state,
        creators,
        summaries,
        stats,
        [this.LOCAL_META_KEY]: {
          storageSchemaVersion: AppSchema.VERSION,
          migratedAt: Date.now(),
        },
      },
    };
  },

  async ensureLocalMigration() {
    const snapshot = await chrome.storage.local.get(null);
    const { changed, state } = this.migrateLocalState(snapshot);
    if (changed) await chrome.storage.local.set(state);
    return state;
  },

  async ensureSettingsMigration() {
    const [syncSnapshot, localSnapshot] = await Promise.all([
      chrome.storage.sync.get(null),
      chrome.storage.local.get(this.SETTINGS_BACKUP_KEY),
    ]);

    const normalizedSync = AppSchema.normalizeSettings(syncSnapshot);
    const normalizedLocal = AppSchema.normalizeSettings(localSnapshot[this.SETTINGS_BACKUP_KEY] || {});

    const syncHasData = this.hasMeaningfulSettings(normalizedSync);
    const localHasData = this.hasMeaningfulSettings(normalizedLocal);

    let resolved = normalizedSync;
    if (!syncHasData && localHasData) {
      resolved = normalizedLocal;
    } else if (syncHasData && localHasData && normalizedLocal.settingsUpdatedAt > normalizedSync.settingsUpdatedAt) {
      resolved = normalizedLocal;
    }

    const syncChanged = JSON.stringify(syncSnapshot) !== JSON.stringify(resolved);
    const localChanged = JSON.stringify(localSnapshot[this.SETTINGS_BACKUP_KEY] || {}) !== JSON.stringify(resolved);

    if (syncChanged || localChanged) {
      await Promise.all([
        syncChanged ? chrome.storage.sync.set(resolved) : Promise.resolve(),
        localChanged ? chrome.storage.local.set({ [this.SETTINGS_BACKUP_KEY]: resolved }) : Promise.resolve(),
      ]);
    }

    return resolved;
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

  async ensureAll() {
    const [localState, settings] = await Promise.all([
      this.ensureLocalMigration(),
      this.ensureSettingsMigration(),
    ]);
    return { localState, settings };
  },
};

if (typeof module !== 'undefined') module.exports = StorageMigrations;
