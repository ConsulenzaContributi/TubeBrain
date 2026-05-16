// core/storage-migrations.js — Versioning e migrazioni storage

const StorageMigrations = {
  LOCAL_META_KEY: 'appMeta',

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
    const snapshot = await chrome.storage.sync.get(null);
    const normalized = AppSchema.normalizeSettings(snapshot);
    const changed = JSON.stringify(snapshot) !== JSON.stringify(normalized);
    if (changed) await chrome.storage.sync.set(normalized);
    return normalized;
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
