// renderers/export-formatters.js — Export multipli per MDX, TXT, JSON e Antigravity

const ExportFormatters = {
  getExtension(format = 'mdx') {
    return {
      mdx: 'mdx',
      md: 'md',
      txt: 'txt',
      json: 'json',
      antigravity: 'json',
    }[format] || 'txt';
  },

  stripFrontmatter(markdown = '') {
    return String(markdown).replace(/^---[\s\S]*?---\n?/, '').trim();
  },

  stripMarkdown(markdown = '') {
    return this.stripFrontmatter(markdown)
      .replace(/```[\s\S]*?```/g, block => block.replace(/```[a-zA-Z0-9_-]*\n?/g, '').trim() + '\n')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1 ($2)')
      .replace(/<a id=".*?"><\/a>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  },

  extractSection(markdown = '', heading) {
    const normalized = this.stripFrontmatter(markdown);
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^##\\s+${escaped}\\s*$\\n?([\\s\\S]*?)(?=^##\\s+|$)`, 'm');
    const match = normalized.match(regex);
    return match ? match[1].trim() : '';
  },

  buildTxt(summary) {
    const body = this.stripMarkdown(summary.fullMarkdown || summary.markdown || '');
    return [
      `Titolo: ${summary.title || ''}`,
      `Canale: ${summary.channelName || ''}`,
      `URL: ${summary.url || ''}`,
      `Formato originale: ${(summary.outputFormat || 'mdx').toUpperCase()}`,
      `Modalita predefinita: ${summary.learningMode || 'study'}`,
      '',
      body,
    ].join('\n');
  },

  buildJson(summary) {
    const payload = {
      id: summary.id,
      title: summary.title,
      channelName: summary.channelName,
      channelId: summary.channelId,
      sourceType: summary.sourceType,
      platform: summary.platform,
      videoId: summary.videoId,
      url: summary.url,
      publishDate: summary.publishDate,
      learningMode: summary.learningMode,
      outputFormat: summary.outputFormat,
      transcriptQuality: summary.transcriptQuality,
      transcriptQualityReason: summary.transcriptQualityReason || '',
      tags: summary.tags || [],
      contentType: summary.contentType,
      durationBucket: summary.durationBucket,
      status: summary.status,
      markdown: summary.fullMarkdown || summary.markdown || '',
    };
    return JSON.stringify(payload, null, 2);
  },

  buildAntigravity(summary) {
    const md = summary.fullMarkdown || summary.markdown || '';
    const studySection = this.extractSection(md, '<a id="mode-study"></a>2. Studio guidato') || this.extractSection(md, '2. Studio guidato');
    const summarySection = this.extractSection(md, '<a id="mode-summary"></a>3. Sintesi rapida') || this.extractSection(md, '3. Sintesi rapida');
    const errorsSection = this.extractSection(md, 'Errori frequenti e recovery');

    const payload = {
      schema: 'antigravity-workflow.v1',
      source: {
        title: summary.title,
        url: summary.url,
        channelName: summary.channelName,
        videoId: summary.videoId,
      },
      mode: summary.learningMode || 'study',
      objective: `Replicare il tutorial "${summary.title || 'Untitled'}" in modo operativo.`,
      inputs: [
        { name: 'source_url', type: 'url', required: true, value: summary.url || '' },
        { name: 'workspace_path', type: 'text', required: false },
      ],
      sections: {
        study: studySection,
        summary: summarySection,
        recovery: errorsSection,
      },
      executionHints: {
        transcriptQuality: summary.transcriptQuality || 'unknown',
        transcriptQualityReason: summary.transcriptQualityReason || '',
        contentType: summary.contentType || 'video',
        durationBucket: summary.durationBucket || 'standard',
      },
      output: {
        type: 'learning-document',
        format: 'mdx',
        title: summary.title || 'Untitled',
      },
    };
    return JSON.stringify(payload, null, 2);
  },

  buildContent(summary, format = 'mdx') {
    if (format === 'txt') return this.buildTxt(summary);
    if (format === 'json') return this.buildJson(summary);
    if (format === 'antigravity') return this.buildAntigravity(summary);
    return summary.fullMarkdown || summary.markdown || '';
  },
};

if (typeof module !== 'undefined') module.exports = ExportFormatters;
