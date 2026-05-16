// utils/markdown-generator.js — Post-processing e download del file MD

const MarkdownGenerator = {

  getLearningModeLabel(mode = 'study') {
    return {
      verbatim: 'Trascrizione integrale',
      study: 'Studio guidato',
      summary: 'Sintesi rapida',
    }[mode] || 'Studio guidato';
  },

  /**
   * Aggiunge YAML frontmatter Obsidian-compatible al markdown generato da Gemini.
   */
  addFrontmatter(markdown, videoData, tags = [], options = {}) {
    const date = new Date().toISOString().slice(0, 10);
    const tagList = tags.length > 0
      ? tags.map(t => `  - ${t}`).join('\n')
      : '  - tutorial\n  - youtube';
    const learningMode = options.learningMode || videoData.learningMode || 'study';
    const outputFormat = options.outputFormat || videoData.outputFormat || 'mdx';

    const frontmatter = `---
title: "${(videoData.title || '').replace(/"/g, "'")}"
channel: "${videoData.channelName || ''}"
video_id: "${videoData.videoId || ''}"
url: "https://youtube.com/watch?v=${videoData.videoId || ''}"
platform: youtube
duration_sec: ${videoData.duration || 0}
date_analyzed: ${date}
tags:
${tagList}
status: to-review
learning_mode_default: ${learningMode}
learning_mode_label: "${this.getLearningModeLabel(learningMode)}"
output_format: ${outputFormat}
---

`;
    return frontmatter + markdown;
  },

  /**
   * Genera un nome file sicuro per il markdown.
   */
  sanitizeFilename(title, channelName, extension = 'mdx') {
    const date = new Date().toISOString().slice(0, 10);
    const safe = (str) => str
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 60);
    return `${date}_${safe(channelName)}_${safe(title)}.${extension}`;
  },

  buildModeChooser(videoData, learningMode = 'study') {
    const modeItems = [
      { id: 'mode-verbatim', key: 'verbatim', title: '1. Trascrizione integrale' },
      { id: 'mode-study', key: 'study', title: '2. Studio guidato' },
      { id: 'mode-summary', key: 'summary', title: '3. Sintesi rapida' },
    ];

    return [
      '# ' + (videoData.title || 'Video Tutorial'),
      '',
      `> **Canale:** ${videoData.channelName || 'N/D'} | **Durata:** ${videoData.duration || 0} sec | **Formato:** MDX`,
      `> **Video:** [Guarda su YouTube](https://youtube.com/watch?v=${videoData.videoId || ''})`,
      `> **Modalita consigliata all'apertura:** ${this.getLearningModeLabel(learningMode)}`,
      '',
      '## Scegli Modalita',
      '',
      ...modeItems.map(item =>
        `- ${item.key === learningMode ? '**' : ''}[${item.title}](#${item.id})${item.key === learningMode ? '**' : ''}`
      ),
      '',
      '## Come Usare Questo File',
      '',
      '- Parti da `Trascrizione integrale` se vuoi massima fedelta al video.',
      '- Usa `Studio guidato` per replicare il tutorial e lavorare in Google Antigravity.',
      '- Apri `Sintesi rapida` se vuoi un ripasso per capitoli in meno tempo.',
      '',
    ].join('\n');
  },

  buildVerbatimSection(videoData) {
    const transcript = (videoData.transcript || '').trim() || 'Trascrizione non disponibile.';
    return [
      '## <a id="mode-verbatim"></a>1. Trascrizione integrale',
      '',
      '> Questa sezione preserva la trascrizione del video senza sintesi. I capitoli originali vengono mantenuti quando disponibili.',
      '',
      transcript,
      '',
    ].join('\n');
  },

  buildLearningDocument(videoData, aiSectionsMarkdown, options = {}) {
    const learningMode = options.learningMode || videoData.learningMode || 'study';
    const parts = [
      this.buildModeChooser(videoData, learningMode),
      this.buildVerbatimSection(videoData),
      aiSectionsMarkdown.trim(),
    ];
    return parts.filter(Boolean).join('\n\n');
  },

  /**
   * Scarica il file MD usando l'API downloads di Chrome.
   */
  downloadMarkdown(markdown, filename) {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url  = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      chrome.downloads.download(
        { url, filename, saveAs: false, conflictAction: 'uniquify' },
        (downloadId) => {
          URL.revokeObjectURL(url);
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(downloadId);
        }
      );
    });
  },

  /**
   * Salva direttamente nella cartella Obsidian vault via File System Access API.
   * Il directoryHandle viene passato dalla pagina options dopo che l'utente
   * ha scelto la cartella con showDirectoryPicker().
   */
  async saveToObsidian(markdown, filename, directoryHandle) {
    if (!directoryHandle) throw new Error('Cartella Obsidian non configurata.');
    const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
    const writable   = await fileHandle.createWritable();
    await writable.write(markdown);
    await writable.close();
  },

  /**
   * Copia il markdown negli appunti.
   */
  async copyToClipboard(markdown) {
    await navigator.clipboard.writeText(markdown);
  },

  /**
   * Prepara il markdown finale (frontmatter + contenuto) e lo scarica/salva
   * in base alle impostazioni dell'utente.
   */
  async saveAll(rawMarkdown, videoData, tags, settings) {
    const outputFormat = settings.outputFormat || 'mdx';
    const markdown = this.addFrontmatter(rawMarkdown, videoData, tags, settings);
    const filename = this.sanitizeFilename(videoData.title || 'video', videoData.channelName || 'channel', outputFormat);

    const results = { filename, downloadId: null, savedToObsidian: false, error: null };

    try {
      results.downloadId = await this.downloadMarkdown(markdown, filename);
    } catch (e) {
      results.error = e.message;
    }

    return { markdown, filename, ...results };
  },

  /**
   * Genera un'anteprima HTML del markdown (usata nel popup).
   * Parsing semplice senza dipendenze esterne.
   */
  toPreviewHtml(markdown) {
    return markdown
      .slice(0, 2000) // solo anteprima
      .replace(/^#{1}\s(.+)$/gm, '<h1>$1</h1>')
      .replace(/^#{2}\s(.+)$/gm, '<h2>$1</h2>')
      .replace(/^#{3}\s(.+)$/gm, '<h3>$1</h3>')
      .replace(/^>{1}\s(.+)$/gm, '<blockquote>$1</blockquote>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/^[-*]\s(.+)$/gm, '<li>$1</li>')
      .replace(/\n/g, '<br>');
  },
};

if (typeof module !== 'undefined') module.exports = MarkdownGenerator;
