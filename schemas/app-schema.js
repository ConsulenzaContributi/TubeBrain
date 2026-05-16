// schemas/app-schema.js — Schema condiviso applicazione e normalizzazione entita

const AppSchema = {
  VERSION: 2,

  DEFAULT_SETTINGS: {
    geminiApiKey: '',
    youtubeApiKey: '',
    language: 'it',
    downloadFolder: '',
    useFileSystemApi: false,
    model: 'gemini-2.5-flash',
    fallbackModel: 'groq',
    autoQueueInterval: '12',
    defaultLearningMode: 'study',
    outputFormat: 'mdx',
    settingsSchemaVersion: 2,
  },

  DEFAULT_STATS: {
    totalSummarized: 0,
    totalCreators: 0,
    byMonth: {},
  },

  normalizeString(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
  },

  normalizeNumber(value, fallback = 0) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  },

  normalizeBoolean(value, fallback = false) {
    return typeof value === 'boolean' ? value : fallback;
  },

  normalizeArray(value) {
    return Array.isArray(value) ? value : [];
  },

  uniqueStrings(values) {
    return [...new Set(this.normalizeArray(values).filter(Boolean).map(v => String(v).trim()).filter(Boolean))];
  },

  normalizeSettings(settings = {}) {
    return {
      ...this.DEFAULT_SETTINGS,
      ...settings,
      language: ['it', 'auto', 'en'].includes(settings.language) ? settings.language : this.DEFAULT_SETTINGS.language,
      defaultLearningMode: ['verbatim', 'study', 'summary'].includes(settings.defaultLearningMode)
        ? settings.defaultLearningMode
        : this.DEFAULT_SETTINGS.defaultLearningMode,
      outputFormat: settings.outputFormat === 'md' ? 'md' : 'mdx',
      useFileSystemApi: this.normalizeBoolean(settings.useFileSystemApi, false),
      autoQueueInterval: ['off', '6', '12', '24'].includes(String(settings.autoQueueInterval))
        ? String(settings.autoQueueInterval)
        : this.DEFAULT_SETTINGS.autoQueueInterval,
      settingsSchemaVersion: this.VERSION,
    };
  },

  normalizeCreator(creator = {}) {
    const now = Date.now();
    return {
      channelId: this.normalizeString(creator.channelId),
      channelName: this.normalizeString(creator.channelName),
      channelUrl: this.normalizeString(creator.channelUrl),
      platform: this.normalizeString(creator.platform, 'youtube'),
      avatar: creator.avatar || null,
      stats: creator.stats || null,
      addedAt: this.normalizeNumber(creator.addedAt, now),
      followedAt: this.normalizeNumber(creator.followedAt, now),
      lastChecked: creator.lastChecked ?? null,
      lastQueueCheck: creator.lastQueueCheck ?? null,
      newCount: this.normalizeNumber(creator.newCount, 0),
      autoQueueEnabled: this.normalizeBoolean(creator.autoQueueEnabled, true),
      isPriority: this.normalizeBoolean(creator.isPriority, false),
      minDurationMinutes: this.normalizeNumber(creator.minDurationMinutes, 0),
      queueKeywords: this.uniqueStrings(creator.queueKeywords),
      queueContentTypes: this.uniqueStrings(creator.queueContentTypes).length
        ? this.uniqueStrings(creator.queueContentTypes)
        : ['video', 'short', 'live'],
      queueDurationBuckets: this.uniqueStrings(creator.queueDurationBuckets).length
        ? this.uniqueStrings(creator.queueDurationBuckets)
        : ['flash', 'quick', 'standard', 'deep', 'marathon'],
      includeBeforeFollowedAt: this.normalizeBoolean(creator.includeBeforeFollowedAt, false),
      massQueueLimit: this.normalizeNumber(creator.massQueueLimit, 100),
      massQueueProfile: creator.massQueueProfile || null,
      topics: this.uniqueStrings(creator.topics),
      schemaVersion: this.VERSION,
      entityType: 'creator',
    };
  },

  normalizeSummary(summary = {}) {
    const now = Date.now();
    const videoId = this.normalizeString(summary.videoId);
    const channelName = this.normalizeString(summary.channelName);
    const title = this.normalizeString(summary.title, 'Untitled');
    const status = ['pending', 'extracted', 'failed'].includes(summary.status) ? summary.status : 'pending';
    const outputFormat = summary.outputFormat === 'md' ? 'md' : 'mdx';
    const learningMode = ['verbatim', 'study', 'summary'].includes(summary.learningMode)
      ? summary.learningMode
      : 'study';

    const transcriptQualityValue = typeof summary.transcriptQuality === 'string'
      ? summary.transcriptQuality
      : summary.transcriptQuality?.level;
    const transcriptQualityReason = typeof summary.transcriptQuality === 'object'
      ? this.normalizeString(summary.transcriptQuality?.reason)
      : this.normalizeString(summary.transcriptQualityReason);

    return {
      ...summary,
      id: this.normalizeString(summary.id),
      schemaVersion: this.VERSION,
      entityType: 'learningDocument',
      sourceType: this.normalizeString(summary.sourceType, summary.videoId ? 'youtube' : 'web'),
      platform: this.normalizeString(summary.platform, summary.videoId ? 'youtube' : 'web'),
      videoId,
      title,
      channelName,
      channelId: this.normalizeString(summary.channelId),
      publishDate: this.normalizeString(summary.publishDate),
      viewCount: this.normalizeNumber(summary.viewCount, 0),
      url: this.normalizeString(summary.url, videoId ? `https://youtube.com/watch?v=${videoId}` : ''),
      markdown: typeof summary.markdown === 'string' ? summary.markdown : null,
      fullMarkdown: typeof summary.fullMarkdown === 'string' ? summary.fullMarkdown : null,
      tags: this.uniqueStrings(summary.tags),
      status,
      thumbnail: summary.thumbnail || (videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : ''),
      captionTracks: this.normalizeArray(summary.captionTracks),
      duration: this.normalizeNumber(summary.duration, 0),
      contentType: this.normalizeString(summary.contentType, 'video'),
      durationBucket: this.normalizeString(summary.durationBucket, 'standard'),
      liveBroadcastContent: this.normalizeString(summary.liveBroadcastContent, 'none'),
      learningMode,
      outputFormat,
      transcriptQuality: this.normalizeString(transcriptQualityValue, summary.captionTracks?.length ? 'caption-track' : 'unknown'),
      transcriptQualityReason,
      savedFilename: this.normalizeString(summary.savedFilename),
      downloadId: summary.downloadId ?? null,
      createdAt: this.normalizeNumber(summary.createdAt, now),
      updatedAt: this.normalizeNumber(summary.updatedAt, summary.createdAt || now),
    };
  },

  normalizeStats(stats = {}) {
    return {
      totalSummarized: this.normalizeNumber(stats.totalSummarized, 0),
      totalCreators: this.normalizeNumber(stats.totalCreators, 0),
      byMonth: (stats.byMonth && typeof stats.byMonth === 'object') ? stats.byMonth : {},
    };
  },
};

if (typeof module !== 'undefined') module.exports = AppSchema;
