// core/learning-document.js — Costruzione payload condivisi per documenti di apprendimento

const LearningDocument = {
  inferSourceType(data = {}) {
    if (data.platform === 'instagram') return 'instagram';
    if (data.videoId) return 'youtube';
    return 'web';
  },

  buildPendingSummary(videoData = {}) {
    const duration = Number(videoData.duration || 0);
    const sourceType = this.inferSourceType(videoData);
    return AppSchema.normalizeSummary({
      videoId: videoData.videoId || '',
      title: videoData.title || '',
      channelName: videoData.channelName || '',
      channelId: videoData.channelId || '',
      publishDate: videoData.publishDate || '',
      viewCount: videoData.viewCount || 0,
      url: videoData.url || (videoData.videoId ? `https://youtube.com/watch?v=${videoData.videoId}` : ''),
      markdown: null,
      fullMarkdown: null,
      tags: videoData.tags || videoData.mapTags || [],
      mapTags: videoData.mapTags || videoData.tags || [],
      tagGraph: videoData.tagGraph || null,
      status: 'pending',
      sourceType,
      platform: videoData.platform || sourceType,
      thumbnail: videoData.thumbnail || (videoData.videoId ? `https://i.ytimg.com/vi/${videoData.videoId}/mqdefault.jpg` : ''),
      captionTracks: videoData.captionTracks || [],
      duration,
      contentType: videoData.contentType || 'video',
      durationBucket: videoData.durationBucket || 'standard',
      liveBroadcastContent: videoData.liveBroadcastContent || 'none',
      transcriptQuality: (videoData.captionTracks || []).length ? 'caption-track' : 'unknown',
    });
  },

  buildExtractedSummary(summaryMeta = {}, rawMarkdown, fullMarkdown, saveMeta = {}) {
    return AppSchema.normalizeSummary({
      ...summaryMeta,
      markdown: rawMarkdown,
      fullMarkdown,
      status: 'extracted',
      downloadId: saveMeta.downloadId ?? null,
      savedFilename: saveMeta.savedFilename || '',
      learningMode: summaryMeta.learningMode || 'study',
      outputFormat: summaryMeta.outputFormat || 'mdx',
      updatedAt: Date.now(),
    });
  },
};

if (typeof module !== 'undefined') module.exports = LearningDocument;
