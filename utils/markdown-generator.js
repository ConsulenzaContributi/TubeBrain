// utils/markdown-generator.js — Post-processing e download del file MDX

const MarkdownGenerator = {

  INTERACTIVE_FEATURES: [
    'timestamp-links',
    'study-workspace',
    'reading-time',
    'auto-heading-ids',
    'interactive-notes',
    'task-checklists',
    'flashcards-reveal',
    'quiz-guarded-answer',
    'glossary-filter',
    'mermaid-map',
    'timeline-jumps',
    'copy-sections',
    'antigravity-panels',
  ],

  getDefaultMdxSections() {
    return (typeof AppSchema !== 'undefined' && AppSchema.DEFAULT_MDX_SECTIONS)
      ? { ...AppSchema.DEFAULT_MDX_SECTIONS }
      : {
          verbatimTranscript: true,
          studyGuide: true,
          antigravityInstructions: true,
          antigravityPrompt: true,
          quickSummary: true,
          conceptMap: true,
          flashcards: true,
          finalQuiz: true,
          interactiveTimeline: true,
          executionChecklist: true,
          operationalGlossary: true,
          errorsRecovery: true,
          tutorialReplication: true,
          personalNotes: true,
        };
  },

  resolveMdxSections(settings = {}) {
    const defaults = this.getDefaultMdxSections();
    const source = settings?.mdxSections && typeof settings.mdxSections === 'object'
      ? settings.mdxSections
      : {};
    return Object.keys(defaults).reduce((acc, key) => {
      acc[key] = typeof source[key] === 'boolean' ? source[key] : defaults[key];
      return acc;
    }, {});
  },

  getFeatureFlags(mdxSections = {}) {
    const features = [...this.INTERACTIVE_FEATURES];
    if (!mdxSections.personalNotes) {
      return features.filter(feature => feature !== 'interactive-notes');
    }
    return features;
  },

  getWorkspaceViews(mdxSections = {}) {
    return [
      mdxSections.verbatimTranscript ? 'verbatim' : null,
      mdxSections.studyGuide ? 'study' : null,
      mdxSections.quickSummary ? 'summary' : null,
      (mdxSections.conceptMap
        || mdxSections.flashcards
        || mdxSections.finalQuiz
        || mdxSections.interactiveTimeline
        || mdxSections.executionChecklist
        || mdxSections.operationalGlossary
        || mdxSections.errorsRecovery
        || mdxSections.tutorialReplication) ? 'assets' : null,
    ].filter(Boolean);
  },

  getAssetSectionSettingKey(title = '') {
    return {
      'Mappa concettuale': 'conceptMap',
      Flashcard: 'flashcards',
      'Quiz finale': 'finalQuiz',
      'Timeline interattiva': 'interactiveTimeline',
      'Checklist esecuzione': 'executionChecklist',
      'Glossario operativo': 'operationalGlossary',
      'Errori frequenti e recovery': 'errorsRecovery',
      'Replicazione del tutorial': 'tutorialReplication',
    }[this.normalizeSectionTitle(title)] || null;
  },

  isAntigravityPromptTitle(title = '') {
    return /^Prompt Antigravity pronto all'?uso$/i.test(this.normalizeSectionTitle(title));
  },

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
    const mdxSections = this.resolveMdxSections(options);
    const workspaceViews = this.getWorkspaceViews(mdxSections);
    const readingTimeMinutes = this.estimateReadingTimeMinutes([
      videoData.transcript || '',
      markdown || '',
      videoData.description || '',
    ].join('\n\n'));
    const seoDescription = (videoData.description || videoData.title || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180)
      .replace(/"/g, '\'');
    const capabilitiesYaml = this.getFeatureFlags(mdxSections).map(feature => `  - ${feature}`).join('\n');
    const workspaceViewsYaml = workspaceViews.length
      ? workspaceViews.map(view => `  - ${view}`).join('\n')
      : '  - notes';

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
workspace_views:
${workspaceViewsYaml}
workspace_behavior: "views_generated_from_active_settings"
output_format: ${outputFormat}
mdx_runtime: "interactive-book-v3"
reading_time_minutes: ${readingTimeMinutes}
interactive_features:
${capabilitiesYaml}
seo_title: "${(videoData.title || '').replace(/"/g, "'")} · ${((videoData.channelName || 'YouTube Learning')).replace(/"/g, "'")}"
seo_description: "${seoDescription}"
youtube_embed_url: "https://www.youtube.com/embed/${videoData.videoId || ''}"
---

`;
    return frontmatter + markdown;
  },

  estimateReadingTimeMinutes(text = '') {
    const words = String(text || '')
      .replace(/<[^>]+>/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 220));
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

  splitLearningSections(aiSectionsMarkdown = '') {
    const full = String(aiSectionsMarkdown || '').trim();
    const summaryMarker = '## <a id="mode-summary"></a>3. Sintesi rapida';
    const fallbackSummaryMarker = '## 3. Sintesi rapida';
    const mapMarker = '## Mappa concettuale';

    const summaryIndex = full.indexOf(summaryMarker) >= 0
      ? full.indexOf(summaryMarker)
      : full.indexOf(fallbackSummaryMarker);
    const mapIndex = full.indexOf(mapMarker);

    if (summaryIndex === -1) {
      return { study: full, summary: '', assets: '' };
    }

    const study = full.slice(0, summaryIndex).trim();
    const summary = mapIndex > summaryIndex
      ? full.slice(summaryIndex, mapIndex).trim()
      : full.slice(summaryIndex).trim();
    const assets = mapIndex > summaryIndex ? full.slice(mapIndex).trim() : '';

    return { study, summary, assets };
  },

  /**
   * Genera URL thumbnail YouTube in varie risoluzioni.
   * YouTube espone thumbnail standard senza autenticazione.
   */
  buildVideoVisuals(videoData = {}) {
    const id = videoData.videoId || '';
    if (!id) return { heroBlock: '', framesBlock: '' };

    // Thumbnail principale in maxresdefault (1280x720) con fallback a hqdefault (480x360)
    const thumbHq  = `https://img.youtube.com/vi/${id}/maxresdefault.jpg`;
    const thumbMed = `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
    const thumbSd  = `https://img.youtube.com/vi/${id}/sddefault.jpg`;

    // Frame a timestamp fissi: 25%, 50%, 75% della durata
    const dur = videoData.duration || 0;
    const frameTimestamps = dur > 30
      ? [
          Math.floor(dur * 0.25),
          Math.floor(dur * 0.50),
          Math.floor(dur * 0.75),
        ]
      : [];

    // YouTube non espone frame arbitrari via URL pubblici,
    // ma i thumbnail storyboard sono accessibili a t=Ns via embed
    // Usiamo i 4 thumbnail predefiniti (default, 1, 2, 3) come frame chiave
    const keyFrameUrls = [
      `https://img.youtube.com/vi/${id}/1.jpg`,
      `https://img.youtube.com/vi/${id}/2.jpg`,
      `https://img.youtube.com/vi/${id}/3.jpg`,
    ];

    const heroBlock = [
      '## 🖼️ Copertina Video',
      '',
      `<figure class="lh-video-hero">`,
      `  <a href="https://youtube.com/watch?v=${id}" target="_blank" rel="noopener">`,
      `    <img src="${thumbHq}" onerror="this.src='${thumbMed}'" alt="Thumbnail: ${(videoData.title||'').replace(/"/g,"'")}" class="lh-hero-img" loading="lazy">`,
      `    <div class="lh-play-overlay"><span class="lh-play-btn">▶</span></div>`,
      `  </a>`,
      `  <figcaption><strong>${videoData.title || ''}</strong> · ${videoData.channelName || ''}</figcaption>`,
      `</figure>`,
      '',
    ].join('\n');

    const framesBlock = keyFrameUrls.length > 0 ? [
      '## 📸 Frame Chiave dal Video',
      '',
      '<div class="lh-frames-grid">',
      ...keyFrameUrls.map((url, i) => {
        const label = frameTimestamps[i]
          ? `Frame ~${this.secondsToTimestamp(frameTimestamps[i])}`
          : `Frame ${i + 1}`;
        const ytLink = frameTimestamps[i]
          ? `https://youtube.com/watch?v=${id}&t=${frameTimestamps[i]}s`
          : `https://youtube.com/watch?v=${id}`;
        return [
          `  <figure class="lh-frame-card">`,
          `    <a href="${ytLink}" target="_blank" rel="noopener">`,
          `      <img src="${url}" alt="${label}" class="lh-frame-img" loading="lazy" onerror="this.parentElement.parentElement.style.display='none'">`,
          `    </a>`,
          `    <figcaption>${label}</figcaption>`,
          `  </figure>`,
        ].join('\n');
      }),
      '</div>',
      '',
    ].join('\n') : '';

    return { heroBlock, framesBlock };
  },

  buildModeChooser(videoData, learningMode = 'study', mdxSections = this.getDefaultMdxSections()) {
    const readingTime = this.estimateReadingTimeMinutes([
      videoData.transcript || '',
      videoData.description || '',
      videoData.title || '',
    ].join('\n'));
    const { heroBlock } = this.buildVideoVisuals(videoData);
    return [
      '# ' + (videoData.title || 'Video Tutorial'),
      '',
      heroBlock,
      `> **Canale:** ${videoData.channelName || 'N/D'} | **Durata:** ${videoData.duration || 0} sec | **Formato:** MDX v2`,
      `> **Video:** [Guarda su YouTube](https://youtube.com/watch?v=${videoData.videoId || ''})`,
      `> **Vista predefinita all'apertura:** ${this.getLearningModeLabel(learningMode)}`,
      `> **Tempo di studio stimato:** ${readingTime} min`,
      '> **Regola workspace:** tutte le viste vengono sempre generate nello stesso file MDX e restano selezionabili durante l\'uso.',
      '',
      '## Workspace Interattivo',
      '',
      '- Il plugin genera un solo workspace MDX, ma include solo le viste attivate nelle impostazioni',
      '- Colonna sinistra: navigazione delle sezioni',
      '- Colonna centrale: contenuto della sola sezione selezionata',
      '- Colonna destra: istruzioni operative per Antigravity relative alla sezione corrente',
      '- I pulsanti `Copia sezione` e `Copia Antigravity` sono disponibili sia in testa sia in coda ai pannelli',
      '- Il file include componenti interattivi per checklist, flashcard, quiz, timeline, glossario, note locali e mappe concettuali',
      '',
      '## Capacita MDX Attive',
      '',
      ...this.getFeatureFlags(mdxSections).map(feature => `- \`${feature}\``),
      '',
    ].join('\n');
  },

  getTabChecked(targetMode, defaultMode) {
    return targetMode === defaultMode ? ' checked' : '';
  },

  slugify(value = '') {
    return String(value)
      .toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section';
  },

  normalizeSectionTitle(rawTitle = '', fallback = 'Sezione') {
    return String(rawTitle || '')
      .replace(/<[^>]+>/g, '')
      .replace(/^#+\s*/, '')
      .replace(/^\d+[\.\)]\s*/, '')
      .replace(/\s+—\s+⏱️.*$/, '')
      .trim() || fallback;
  },

  extractChapterBlocks(markdown = '', headingPrefix = '### ') {
    const normalized = String(markdown || '').trim();
    if (!normalized) return [];
    const parts = normalized.split(new RegExp(`(?=^${headingPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'm')).filter(Boolean);
    return parts.map((part, index) => {
      const lines = part.trim().split('\n');
      const rawTitle = lines.shift().replace(/^###\s+/, '').trim();
      return {
        index,
        rawTitle,
        title: this.normalizeSectionTitle(rawTitle, `Sezione ${index + 1}`),
        body: lines.join('\n').trim(),
      };
    });
  },

  extractTranscriptBlocks(transcript = '') {
    const normalized = String(transcript || '').trim();
    if (!normalized || /Trascrizione non disponibile/i.test(normalized)) {
      return [{ index: 0, title: 'Trascrizione', body: 'Trascrizione non disponibile.' }];
    }

    const chapterParts = normalized.split(/(?=^##\s+)/m).filter(Boolean);
    if (chapterParts.length === 0) {
      return [{ index: 0, title: 'Trascrizione', body: normalized }];
    }

    return chapterParts.map((part, index) => {
      const lines = part.trim().split('\n');
      const rawTitle = lines.shift().replace(/^##\s+/, '').trim();
      const tsMatch = rawTitle.match(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/);
      return {
        index,
        rawTitle,
        title: this.normalizeSectionTitle(rawTitle, `Trascrizione ${index + 1}`),
        body: lines.join('\n').trim(),
        timestamp: tsMatch ? tsMatch[1] : '',
        startSeconds: tsMatch ? this.timestampToSeconds(tsMatch[1]) : index * 60,
      };
    });
  },

  buildTranscriptFromSegments(segments = [], chapters = []) {
    const safeSegments = Array.isArray(segments) ? segments.filter(seg => seg && seg.text) : [];
    if (!safeSegments.length) return '';
    const safeChapters = Array.isArray(chapters) ? chapters : [];
    if (!safeChapters.length) {
      return safeSegments
        .map(seg => `[${this.secondsToTimestamp(Math.floor((Number(seg.startMs || 0) / 1000)))}] ${String(seg.text || '').trim()}`)
        .join('\n');
    }

    return safeChapters.map((chapter, index) => {
      const startMs = Number(chapter.startMs || 0);
      const endMs = Number(safeChapters[index + 1]?.startMs ?? Infinity);
      const lines = safeSegments
        .filter(seg => Number(seg.startMs || 0) >= startMs && Number(seg.startMs || 0) < endMs)
        .map(seg => `[${this.secondsToTimestamp(Math.floor((Number(seg.startMs || 0) / 1000)))}] ${String(seg.text || '').trim()}`);
      const heading = `## ${(chapter.title || `Sezione ${index + 1}`).trim()} [${this.secondsToTimestamp(Math.floor(startMs / 1000))}]`;
      return [heading, ...lines].join('\n');
    }).join('\n\n');
  },

  resolveTranscriptText(videoData = {}) {
    const transcript = String(videoData?.transcript || '').trim();
    if (transcript && !/Trascrizione non disponibile/i.test(transcript)) return transcript;
    return this.buildTranscriptFromSegments(videoData?.transcriptSegments || [], videoData?.chapters || []);
  },

  extractAntigravitySection(body = '') {
    const marker = '#### Istruzioni Google Antigravity';
    const index = body.indexOf(marker);
    if (index === -1) return { main: body.trim(), agent: '' };
    return {
      main: body.slice(0, index).trim(),
      agent: body.slice(index).trim(),
    };
  },

  splitAssetsSections(markdown = '') {
    const normalized = String(markdown || '').trim();
    const markers = [
      '## Mappa concettuale',
      '## Flashcard',
      '## Quiz finale',
      '## Timeline interattiva',
      '## Checklist esecuzione',
      '## Glossario operativo',
      '## Errori frequenti e recovery',
      '## Replicazione del tutorial',
    ];
    const blocks = [];
    for (let i = 0; i < markers.length; i++) {
      const start = normalized.indexOf(markers[i]);
      if (start === -1) continue;
      const nextStart = markers.slice(i + 1)
        .map(marker => normalized.indexOf(marker))
        .filter(index => index > start)
        .sort((a, b) => a - b)[0] ?? normalized.length;
      const block = normalized.slice(start, nextStart).trim();
      blocks.push({
        key: `asset-${i}`,
        title: this.normalizeSectionTitle(markers[i].replace(/^##\s+/, '')),
        body: block,
      });
    }
    return blocks;
  },

  escapeHtml(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  jsxStringLiteral(value = '') {
    return JSON.stringify(String(value || ''));
  },

  parseCodeFenceMeta(lang = '') {
    const raw = String(lang || '').trim();
    if (!raw) return { language: 'text', flags: [] };
    const tokens = raw.split(/\s+/).filter(Boolean);
    const first = tokens.shift() || 'text';
    const firstParts = first.split(':').filter(Boolean);
    const language = firstParts.shift() || 'text';
    return {
      language,
      flags: [...firstParts, ...tokens].map(token => token.toLowerCase()),
    };
  },

  renderCodeBlock(code = '', lang = 'text') {
    const meta = this.parseCodeFenceMeta(lang);
    const safeLang = this.escapeHtml(meta.language || 'text');
    const encoded = this.escapeHtml(code.replace(/\n$/, ''));
    const lines = code.replace(/\n$/, '').split('\n');
    const isDiff = meta.language === 'diff' || meta.flags.includes('diff');
    const isLive = meta.flags.includes('live') || (meta.language === 'html' && meta.flags.includes('preview'));
    const isCollapsible = meta.flags.includes('collapse') || lines.length > 18;
    const body = isDiff
      ? `<pre class="lhv2-code lhv2-code-diff" data-lang="${safeLang}"><code>${encoded.split('\n').map(line => {
          const cls = line.startsWith('+') ? 'lhv2-diff-add' : line.startsWith('-') ? 'lhv2-diff-del' : 'lhv2-diff-neutral';
          return `<span class="${cls}">${line || ' '}</span>`;
        }).join('\n')}</code></pre>`
      : `<pre class="lhv2-code" data-lang="${safeLang}"><code>${encoded}</code></pre>`;

    return [
      `<div class="code-block-wrap" data-code-flags="${this.escapeHtml(meta.flags.join(','))}">`,
      '<div class="code-block-header">',
      `<span class="code-lang">${safeLang.toUpperCase()}</span>`,
      '<div class="code-block-actions">',
      isCollapsible ? '<button class="code-copy-btn" type="button" data-code-collapse>Comprimi</button>' : '',
      isLive ? `<button class="code-copy-btn" type="button" data-live-run="${safeLang}">Preview</button>` : '',
      '<button class="code-copy-btn" type="button" data-code-copy>📋 Copia</button>',
      '</div>',
      '</div>',
      `<div class="code-block-body${isCollapsible ? ' is-collapsible' : ''}">`,
      body,
      isLive ? '<iframe class="lhv2-live-frame lhv2-hidden" sandbox="allow-scripts allow-modals"></iframe>' : '',
      '</div>',
      '</div>',
    ].join('');
  },

  renderInlineCode(code = '') {
    return `<code>{${this.jsxStringLiteral(code)}}</code>`;
  },

  slugifyForDom(value = '') {
    return String(value)
      .toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item';
  },

  parseMarkdownTable(markdown = '') {
    const lines = String(markdown || '').split('\n').map(line => line.trim()).filter(Boolean);
    const rows = lines.filter(line => /^\|.+\|$/.test(line));
    if (rows.length < 2) return null;
    const parseRow = line => line.split('|').filter((_, index, arr) => index > 0 && index < arr.length - 1).map(cell => cell.trim());
    const header = parseRow(rows[0]);
    const body = rows.slice(1).filter(line => !/^\|[\s\-:|]+\|$/.test(line)).map(parseRow).filter(cols => cols.length);
    if (!header.length || !body.length) return null;
    return { header, rows: body };
  },

  parseFlashcards(markdown = '') {
    const table = this.parseMarkdownTable(markdown);
    if (!table) return [];
    return table.rows.map((cols, index) => ({
      id: `lhv2-fc-${index}`,
      question: cols[0] || '',
      answer: cols[1] || '',
      difficulty: cols[2] || '',
    })).filter(card => card.question && card.answer);
  },

  parseQuiz(markdown = '') {
    const lines = String(markdown || '').split('\n');
    const blocks = [];
    let current = null;

    const flush = () => {
      if (!current) return;
      if (current.question && current.options.length) blocks.push(current);
      current = null;
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      const questionMatch = line.match(/^\d+\.\s+(.+)/);
      if (questionMatch) {
        flush();
        current = { question: questionMatch[1], options: [], answer: '', explanation: '' };
        continue;
      }
      if (!current) continue;

      const optionMatch = line.match(/^[-*]?\s*([A-D])[).:\-]\s+(.+)/i);
      if (optionMatch) {
        current.options.push({ key: optionMatch[1].toUpperCase(), text: optionMatch[2] });
        continue;
      }

      const answerMatch = line.match(/^(?:\*\*)?risposta(?:\s+corretta)?(?:\*\*)?\s*[:\-]\s*(.+)$/i);
      if (answerMatch) {
        current.answer = answerMatch[1].replace(/\*\*/g, '').trim();
        continue;
      }

      const explanationMatch = line.match(/^(?:\*\*)?spiegazione(?:\*\*)?\s*[:\-]\s*(.+)$/i);
      if (explanationMatch) {
        current.explanation = explanationMatch[1].replace(/\*\*/g, '').trim();
      }
    }

    flush();
    return blocks;
  },

  parseChecklist(markdown = '') {
    return String(markdown || '')
      .split('\n')
      .map(line => line.trim())
      .map((line, index) => {
        const match = line.match(/^[-*]\s+\[( |x|X)\]\s+(.+)/);
        if (!match) return null;
        return {
          id: `task-${index}`,
          done: match[1].toLowerCase() === 'x',
          label: match[2].trim(),
        };
      })
      .filter(Boolean);
  },

  parseGlossary(markdown = '') {
    const table = this.parseMarkdownTable(markdown);
    if (!table) return [];
    return table.rows.map((cols, index) => ({
      id: `term-${index}`,
      term: cols[0] || '',
      definition: cols[1] || '',
      why: cols[2] || '',
    })).filter(item => item.term && item.definition);
  },

  parseTimeline(markdown = '') {
    const table = this.parseMarkdownTable(markdown);
    if (table) {
      return table.rows.map((cols, index) => ({
        id: `timeline-${index}`,
        timestamp: cols[0] || '',
        focus: cols[1] || '',
        action: cols[2] || '',
        why: cols[3] || '',
      })).filter(item => item.timestamp);
    }

    return String(markdown || '')
      .split('\n')
      .map(line => line.trim())
      .map((line, index) => {
        const match = line.match(/^[-*]\s+\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.+)$/);
        if (!match) return null;
        return {
          id: `timeline-${index}`,
          timestamp: match[1],
          focus: match[2],
          action: '',
          why: '',
        };
      })
      .filter(Boolean);
  },

  parseProblemBlocks(markdown = '') {
    const parts = String(markdown || '')
      .split(/(?=^###\s+Problema:)/m)
      .map(block => block.trim())
      .filter(Boolean);
    return parts.map((block, index) => {
      const lines = block.split('\n');
      const titleLine = lines.shift() || `### Problema: Scenario ${index + 1}`;
      return {
        id: `problem-${index}`,
        title: titleLine.replace(/^###\s+Problema:\s*/i, '').trim() || `Scenario ${index + 1}`,
        body: lines.join('\n').trim(),
      };
    });
  },

  extractMermaid(markdown = '') {
    const match = String(markdown || '').match(/```mermaid\s*([\s\S]*?)```/i);
    return match ? match[1].trim() : '';
  },

  parseConceptGraph(markdown = '') {
    const source = this.extractMermaid(markdown);
    if (!source) return null;

    const nodes = new Map();
    const edges = [];
    const outgoing = new Map();
    const incoming = new Map();
    const ensureNode = (id, label = '') => {
      const safeId = this.slugifyForDom(id || label || `node-${nodes.size + 1}`);
      if (!nodes.has(safeId)) {
        nodes.set(safeId, { id: safeId, label: String(label || id || safeId).trim(), weight: 0 });
      } else if (label) {
        const nextLabel = String(label).trim();
        const current = nodes.get(safeId);
        if (current.label === safeId || current.label === id || nextLabel.length > current.label.length) {
          current.label = nextLabel;
        }
      }
      return safeId;
    };

    const decodeLabel = (token = '') => {
      const trimmed = String(token || '').trim();
      const explicit = [
        trimmed.match(/^([A-Za-z0-9_-]+)\[(.+)\]$/),
        trimmed.match(/^([A-Za-z0-9_-]+)\((.+)\)$/),
        trimmed.match(/^([A-Za-z0-9_-]+)\{(.+)\}$/),
        trimmed.match(/^([A-Za-z0-9_-]+)\"(.+)\"$/),
      ].find(Boolean);
      if (explicit) return { id: explicit[1], label: explicit[2] };
      const match = trimmed.match(/^([A-Za-z0-9_-]+)$/);
      if (!match) return { id: this.slugifyForDom(trimmed), label: trimmed };
      return {
        id: match[1],
        label: match[1],
      };
    };

    source.split('\n').map(line => line.trim()).filter(Boolean).forEach(line => {
      if (/^(graph|flowchart|mindmap)\b/i.test(line)) return;
      if (/^%%/.test(line)) return;

      const edgeMatch = line.match(/^(.+?)\s*(-->|---|==>|-->|\.-+>|\-\.->)\s*(.+)$/);
      if (edgeMatch) {
        const left = decodeLabel(edgeMatch[1]);
        const right = decodeLabel(edgeMatch[3]);
        const from = ensureNode(left.id, left.label);
        const to = ensureNode(right.id, right.label);
        edges.push({ from, to });
        nodes.get(from).weight += 1;
        nodes.get(to).weight += 1;
        if (!outgoing.has(from)) outgoing.set(from, []);
        if (!incoming.has(to)) incoming.set(to, []);
        outgoing.get(from).push(to);
        incoming.get(to).push(from);
        return;
      }

      const single = decodeLabel(line.replace(/^[-*]\s+/, ''));
      ensureNode(single.id, single.label);
    });

    const graphNodes = Array.from(nodes.values());
    if (!graphNodes.length) return null;
    if (!edges.length && graphNodes.length > 1) {
      const hub = graphNodes[0].id;
      graphNodes.slice(1).forEach(node => {
        edges.push({ from: hub, to: node.id });
        nodes.get(hub).weight += 1;
        nodes.get(node.id).weight += 1;
        if (!outgoing.has(hub)) outgoing.set(hub, []);
        if (!incoming.has(node.id)) incoming.set(node.id, []);
        outgoing.get(hub).push(node.id);
        incoming.get(node.id).push(hub);
      });
    }

    const root = graphNodes
      .slice()
      .sort((a, b) => {
        const aIncoming = (incoming.get(a.id) || []).length;
        const bIncoming = (incoming.get(b.id) || []).length;
        const aOutgoing = (outgoing.get(a.id) || []).length;
        const bOutgoing = (outgoing.get(b.id) || []).length;
        if (aIncoming !== bIncoming) return aIncoming - bIncoming;
        if (aOutgoing !== bOutgoing) return bOutgoing - aOutgoing;
        return b.weight - a.weight;
      })[0];

    const levels = new Map([[root.id, 0]]);
    const queue = [root.id];
    while (queue.length) {
      const current = queue.shift();
      const currentLevel = levels.get(current) || 0;
      (outgoing.get(current) || []).forEach(childId => {
        if (!levels.has(childId) || (levels.get(childId) > currentLevel + 1)) {
          levels.set(childId, currentLevel + 1);
          queue.push(childId);
        }
      });
    }

    graphNodes.forEach(node => {
      if (!levels.has(node.id)) levels.set(node.id, 1);
    });

    const grouped = new Map();
    graphNodes.forEach(node => {
      const depth = levels.get(node.id) || 0;
      if (!grouped.has(depth)) grouped.set(depth, []);
      grouped.get(depth).push(node);
    });

    const maxDepth = Math.max(...Array.from(grouped.keys()));
    const positioned = [];
    Array.from(grouped.entries())
      .sort((a, b) => a[0] - b[0])
      .forEach(([depth, items]) => {
        const x = depth === 0
          ? 28
          : 28 + (depth * (56 / Math.max(1, maxDepth)));
        items
          .slice()
          .sort((a, b) => {
            const outA = (outgoing.get(a.id) || []).length;
            const outB = (outgoing.get(b.id) || []).length;
            if (outA !== outB) return outB - outA;
            return b.weight - a.weight;
          })
          .forEach((node, index) => {
            const total = items.length;
            const y = total === 1
              ? 50
              : 18 + ((64 / Math.max(1, total - 1)) * index);
            positioned.push({
              ...node,
              depth,
              x: Number(x.toFixed(2)),
              y: Number(y.toFixed(2)),
              size: depth === 0 ? 5 : Math.min(4, Math.max(2, node.weight + 1)),
            });
          });
      });

    return {
      source,
      nodes: positioned,
      edges,
      rootId: root.id,
      maxDepth,
      maxNodesPerDepth: Math.max(...Array.from(grouped.values()).map(items => items.length)),
    };
  },

  timestampToSeconds(timestamp = '') {
    const parts = String(timestamp || '').split(':').map(Number);
    if (parts.some(num => Number.isNaN(num))) return 0;
    return parts.length === 3
      ? (parts[0] * 3600) + (parts[1] * 60) + parts[2]
      : (parts[0] * 60) + parts[1];
  },

  secondsToTimestamp(seconds = 0) {
    const total = Math.max(0, Number(seconds || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = Math.floor(total % 60);
    return h > 0
      ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  },

  renderTimestampLink(timestamp = '', videoId = '', label = '') {
    const safeTimestamp = this.escapeHtml(timestamp);
    const seconds = this.timestampToSeconds(timestamp);
    const href = videoId ? `https://youtube.com/watch?v=${videoId}&t=${seconds}s` : '#';
    const text = this.escapeHtml(label || timestamp);
    return `<a class="lhv2-ts-link" href="${href}" target="_blank" rel="noopener" data-seconds="${seconds}">${text}</a>`;
  },

  renderTranscriptSection(item = {}, videoData = {}) {
    const lines = String(item.body || '').split('\n').map(line => line.trim()).filter(Boolean);
    if (!lines.length) return '<p>Trascrizione non disponibile.</p>';
    const transcriptLines = lines.map((line, index) => {
      const match = line.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s+(.+)$/);
      if (!match) {
        return `<div class="lhv2-transcript-line"><div class="lhv2-transcript-copy">${this.escapeHtml(line)}</div></div>`;
      }
      return `
        <div class="lhv2-transcript-line" data-transcript-line-start="${this.timestampToSeconds(match[1])}">
          <div class="lhv2-transcript-stamp">${this.renderTimestampLink(match[1], videoData.videoId || '', match[1])}</div>
          <div class="lhv2-transcript-copy">${this.inlineMarkdown(match[2], { videoId: videoData.videoId || '' })}</div>
        </div>
      `;
    }).join('\n');

    return [
      `<div class="lhv2-transcript-block" data-transcript-block="${this.escapeHtml(item.title || 'Trascrizione')}">`,
      item.timestamp ? `<div class="lhv2-transcript-meta"><span class="lhv2-badge">Start ${this.escapeHtml(item.timestamp)}</span><span class="lhv2-badge lhv2-badge-soft">${lines.length} righe</span></div>` : '',
      '<div class="lhv2-transcript-lines">',
      transcriptLines,
      '</div>',
      '</div>',
    ].join('\n');
  },

  markdownToHtml(markdown = '', context = {}) {
    const lines = String(markdown || '').replace(/\r/g, '').split('\n');
    let html = '';
    let inList = false;
    let listType = '';
    let inCode = false;
    let codeLang = '';
    let codeLines = [];
    let paragraph = [];

    const flushParagraph = () => {
      if (!paragraph.length) return;
      html += `<p>${this.inlineMarkdown(paragraph.join(' '), context)}</p>`;
      paragraph = [];
    };

    const closeList = () => {
      if (inList) html += `</${listType}>`;
      inList = false;
      listType = '';
    };

    const flushCode = () => {
      if (!inCode) return;
      if ((codeLang || '').toLowerCase() === 'mermaid') {
        html += `<div class="lhv2-mermaid-wrap"><pre class="lhv2-mermaid">${this.escapeHtml(codeLines.join('\n'))}</pre></div>`;
      } else {
        html += this.renderCodeBlock(codeLines.join('\n'), codeLang || 'text');
      }
      inCode = false;
      codeLang = '';
      codeLines = [];
    };

    for (const line of lines) {
      if (line.startsWith('```')) {
        flushParagraph();
        closeList();
        if (inCode) flushCode();
        else {
          inCode = true;
          codeLang = line.replace(/```/, '').trim();
        }
        continue;
      }
      if (inCode) {
        codeLines.push(line);
        continue;
      }
      if (!line.trim()) {
        flushParagraph();
        closeList();
        continue;
      }
      if (/^####\s+/.test(line)) {
        flushParagraph();
        closeList();
        const title = line.replace(/^####\s+/, '').trim();
        html += `<h4 id="${this.slugifyForDom(title)}">${this.inlineMarkdown(title, context)}</h4>`;
        continue;
      }
      if (/^###\s+/.test(line)) {
        flushParagraph();
        closeList();
        const title = line.replace(/^###\s+/, '').trim();
        html += `<h3 id="${this.slugifyForDom(title)}">${this.inlineMarkdown(title, context)}</h3>`;
        continue;
      }
      if (/^##\s+/.test(line)) {
        flushParagraph();
        closeList();
        const title = line.replace(/^##\s+/, '').trim();
        html += `<h2 id="${this.slugifyForDom(title)}">${this.inlineMarkdown(title, context)}</h2>`;
        continue;
      }
      if (/^>\s*/.test(line)) {
        flushParagraph();
        closeList();
        const quoteText = line.replace(/^>\s*/, '').trim();
        const admonition = quoteText.match(/^(TIP|NOTE|NOTA|WARNING|ATTENZIONE|DANGER|PERICOLO)\s*:\s*(.+)$/i);
        if (admonition) {
          html += `<div class="lhv2-admonition" data-kind="${this.escapeHtml(admonition[1].toLowerCase())}"><strong>${this.escapeHtml(admonition[1])}</strong><p>${this.inlineMarkdown(admonition[2], context)}</p></div>`;
        } else {
          html += `<blockquote>${this.inlineMarkdown(quoteText, context)}</blockquote>`;
        }
        continue;
      }
      if (/^(\*|-)\s+/.test(line)) {
        flushParagraph();
        const item = line.replace(/^(\*|-)\s+/, '').trim();
        if (!inList || listType !== 'ul') {
          closeList();
          inList = true;
          listType = 'ul';
          html += '<ul>';
        }
        html += `<li>${this.inlineMarkdown(item, context)}</li>`;
        continue;
      }
      if (/^\d+\.\s+/.test(line)) {
        flushParagraph();
        const item = line.replace(/^\d+\.\s+/, '').trim();
        if (!inList || listType !== 'ol') {
          closeList();
          inList = true;
          listType = 'ol';
          html += '<ol>';
        }
        html += `<li>${this.inlineMarkdown(item, context)}</li>`;
        continue;
      }
      if (inList) closeList();
      paragraph.push(line.trim());
    }

    flushParagraph();
    closeList();
    flushCode();
    return html;
  },

  inlineMarkdown(text = '', context = {}) {
    return this.escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, (_, code) => this.renderInlineCode(code))
      .replace(/:youtube-timestamp\[([^\]]+)\]\{t=([^}]+)\}/g, (_, label, ts) => this.renderTimestampLink(ts, context.videoId || '', label))
      .replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g, (_, ts) => this.renderTimestampLink(ts, context.videoId || '', `[${ts}]`));
  },

  buildInstructionZero(videoData, chapterTitle) {
    return [
      '### Istruzione 0 — Contesto progetto',
      '',
      `- Progetto: ${videoData.title || 'Tutorial'}`,
      `- Sezione corrente: ${chapterTitle}`,
      `- Canale sorgente: ${videoData.channelName || 'N/D'}`,
      `- Obiettivo globale: replicare il contenuto del tutorial in modo operativo e verificabile`,
      `- Output atteso: task eseguibili, checklist, risultati verificabili e passaggi coerenti con il tutorial originale`,
      '',
    ].join('\n');
  },

  buildCopyButton(targetId, label = 'Copia sezione') {
    return `<button class="lhv2-copy-btn" data-copy-target="${targetId}">${label}</button>`;
  },

  buildVideoStage(videoData = {}) {
    if (!videoData.videoId) return '';
    const embedUrl = `https://www.youtube.com/embed/${videoData.videoId}?enablejsapi=1&rel=0&modestbranding=1`;
    return [
      '<section class="lhv2-video-stage" data-lhv2-video-stage>',
      '<div class="lhv2-video-shell">',
      `<iframe id="lhv2-youtube-player" class="lhv2-video-frame" src="${embedUrl}" title="${this.escapeHtml(videoData.title || 'YouTube video')}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`,
      '</div>',
      '<div class="lhv2-video-controls">',
      '<button class="lhv2-copy-btn" type="button" data-video-toggle-focus>Focus</button>',
      '<button class="lhv2-copy-btn" type="button" data-video-toggle-pip>Mini player</button>',
      '<label class="lhv2-video-resize"><span>Video</span><input type="range" min="220" max="1280" step="10" value="960" data-video-size /></label>',
      '<button class="lhv2-copy-btn" type="button" data-video-speed="0.75">0.75x</button>',
      '<button class="lhv2-copy-btn" type="button" data-video-speed="1">1x</button>',
      '<button class="lhv2-copy-btn" type="button" data-video-speed="1.25">1.25x</button>',
      '<button class="lhv2-copy-btn" type="button" data-video-speed="1.5">1.5x</button>',
      '</div>',
      '</section>',
    ].join('\n');
  },

  renderFlashcardsSection(markdown = '') {
    const cards = this.parseFlashcards(markdown);
    if (!cards.length) return this.markdownToHtml(markdown);
    return [
      '<div class="lhv2-flashcards">',
      '<p class="lhv2-section-intro">Metti in pausa, prova a rispondere mentalmente, poi scopri la soluzione.</p>',
      ...cards.map(card => `
        <details class="lhv2-flashcard" data-flashcard>
          <summary class="lhv2-flashcard-summary" style="cursor: pointer; list-style: none;">
            <div class="lhv2-flashcard-head">
              <span class="lhv2-badge">Flashcard</span>
              ${card.difficulty ? `<span class="lhv2-badge lhv2-badge-soft">${this.escapeHtml(card.difficulty)}</span>` : ''}
            </div>
            <p class="lhv2-flashcard-q" style="display: inline-block; margin-top: 8px;">${this.inlineMarkdown(card.question)}</p>
          </summary>
          <div class="lhv2-flashcard-a" style="margin-top: 12px; display: block;">
            <p class="lhv2-flashcard-label">Risposta</p>
            <div>${this.inlineMarkdown(card.answer)}</div>
          </div>
        </details>
      `),
      '</div>',
    ].join('\n');
  },

  renderQuizSection(markdown = '') {
    const questions = this.parseQuiz(markdown);
    if (!questions.length) return this.markdownToHtml(markdown);
    return [
      '<div class="lhv2-quiz-stack">',
      '<p class="lhv2-section-intro">Seleziona un\'opzione, verifica e mostra la soluzione solo se ti serve davvero.</p>',
      ...questions.map((question, index) => {
        const answerKey = this.slugifyForDom((question.answer.match(/[A-D]/i) || [''])[0] || question.answer);
        return `
          <details class="lhv2-quiz" data-quiz data-answer="${answerKey}">
            <summary style="cursor: pointer; list-style: none;">
              <p class="lhv2-quiz-q" style="display: inline-block; font-weight: bold;">${index + 1}. ${this.inlineMarkdown(question.question)}</p>
            </summary>
            <div class="lhv2-quiz-options">
              ${question.options.map(option => `
                <div class="lhv2-quiz-option" data-quiz-option="${this.slugifyForDom(option.key)}" style="margin-bottom: 4px;">
                  <span class="lhv2-quiz-key">${this.escapeHtml(option.key)}</span>
                  <span>${this.inlineMarkdown(option.text)}</span>
                </div>
              `).join('')}
            </div>
            <div class="lhv2-quiz-feedback" style="margin-top: 12px; display: block; border-left: 3px solid #86efac; padding-left: 10px;">
              <p class="lhv2-quiz-answer" data-answer-text="${this.escapeHtml(question.answer || 'N/D')}"><strong>Soluzione corretta:</strong> ${this.inlineMarkdown(question.answer || 'N/D')}</p>
              ${question.explanation ? `<p class="lhv2-quiz-explanation"><strong>Spiegazione:</strong> ${this.inlineMarkdown(question.explanation)}</p>` : ''}
            </div>
          </details>
        `;
      }),
      '</div>',
    ].join('\n');
  },

  renderTimelineSection(markdown = '', videoData = {}) {
    const items = this.parseTimeline(markdown);
    if (!items.length) return this.markdownToHtml(markdown, { videoId: videoData.videoId || '' });
    return [
      '<div class="lhv2-timeline">',
      '<p class="lhv2-section-intro">Usa questi punti di salto per rientrare subito nei passaggi decisivi del video.</p>',
      ...items.map(item => `
        <article class="lhv2-timeline-item">
          <div class="lhv2-timeline-time">${this.renderTimestampLink(item.timestamp, videoData.videoId, item.timestamp)}</div>
          <div class="lhv2-timeline-body">
            <h4>${this.escapeHtml(item.focus || 'Passaggio chiave')}</h4>
            ${item.action ? `<p><strong>Azione:</strong> ${this.inlineMarkdown(item.action, { videoId: videoData.videoId || '' })}</p>` : ''}
            ${item.why ? `<p><strong>Perché conta:</strong> ${this.inlineMarkdown(item.why, { videoId: videoData.videoId || '' })}</p>` : ''}
          </div>
        </article>
      `),
      '</div>',
    ].join('\n');
  },

  renderChecklistSection(markdown = '', videoData = {}) {
    const tasks = this.parseChecklist(markdown);
    if (!tasks.length) return this.markdownToHtml(markdown, { videoId: videoData.videoId || '' });
    return [
      `<div class="lhv2-checklist" data-checklist-root="${this.escapeHtml(videoData.videoId || 'generic')}">`,
      '<p class="lhv2-section-intro">Le spunte vengono salvate localmente per continuare lo studio anche dopo il refresh.</p>',
      ...tasks.map(task => `
        <label class="lhv2-task">
          <input type="checkbox" data-task-id="${this.escapeHtml(task.id)}" ${task.done ? 'checked' : ''} />
          <span>${this.inlineMarkdown(task.label, { videoId: videoData.videoId || '' })}</span>
        </label>
      `),
      '</div>',
    ].join('\n');
  },

  renderGlossarySection(markdown = '') {
    const items = this.parseGlossary(markdown);
    if (!items.length) return this.markdownToHtml(markdown);
    return [
      '<div class="lhv2-glossary">',
      '<p class="lhv2-section-intro">Filtra i termini e usa il glossario come memoria rapida durante il ripasso.</p>',
      '<input class="lhv2-glossary-search" type="search" placeholder="Filtra termini o definizioni..." data-glossary-search />',
      '<div class="lhv2-glossary-list" data-glossary-list>',
      ...items.map(item => `
        <article class="lhv2-glossary-item" data-glossary-item>
          <h4>${this.escapeHtml(item.term)}</h4>
          <p>${this.inlineMarkdown(item.definition)}</p>
          ${item.why ? `<div class="lhv2-glossary-why"><strong>Perché conta:</strong> ${this.inlineMarkdown(item.why)}</div>` : ''}
        </article>
      `),
      '</div>',
      '</div>',
    ].join('\n');
  },

  renderConceptMapSection(markdown = '') {
    const graph = this.parseConceptGraph(markdown);
    if (!graph) return this.markdownToHtml(markdown);
    const canvasWidth = Math.max(980, 640 + ((Number(graph.maxDepth || 1) + 1) * 240));
    const canvasHeight = Math.max(720, 240 + (Number(graph.maxNodesPerDepth || 1) * 118));
    return [
      '<div class="lhv2-concept-map">',
      '<p class="lhv2-section-intro">Mappa concettuale colorata con nodi proporzionali e connessioni leggibili. I testi restano completi dentro ogni nodo.</p>',
      `<div class="lhv2-concept-stage" data-concept-stage style="--lhv2-concept-width:${canvasWidth}px;--lhv2-concept-height:${canvasHeight}px;">`,
      '<div class="lhv2-concept-head"><span class="lhv2-concept-title">Mappa del contenuto</span><span class="lhv2-concept-subtitle">Espansione gerarchica dei concetti principali</span></div>',
      '<div class="lhv2-concept-canvas" data-concept-canvas>',
      '<svg class="lhv2-concept-svg" viewBox="0 0 1000 700" preserveAspectRatio="none" aria-hidden="true"></svg>',
      ...graph.edges.map(edge => `<span class="lhv2-concept-edge lhv2-hidden" data-edge-from="${this.escapeHtml(edge.from)}" data-edge-to="${this.escapeHtml(edge.to)}"></span>`),
      ...graph.nodes.map(node => `
        <article class="lhv2-concept-node" data-node-id="${this.escapeHtml(node.id)}" data-node-size="${Number(node.size || 1)}" data-node-depth="${Number(node.depth || 0)}" style="left:${Number(node.x || 50)}%;top:${Number(node.y || 50)}%;">
          ${node.id === graph.rootId ? '' : '<span class="lhv2-concept-port lhv2-concept-port-in">‹</span>'}
          <strong>${this.escapeHtml(node.label)}</strong>
          <span class="lhv2-concept-port lhv2-concept-port-out">›</span>
        </article>
      `),
      '</div>',
      '</div>',
      `<details class="lhv2-problem"><summary>Sorgente mappa</summary><div class="lhv2-problem-body"><pre class="lhv2-mermaid">${this.escapeHtml(graph.source)}</pre></div></details>`,
      '</div>',
    ].join('\n');
  },

  renderProblemsSection(markdown = '') {
    const problems = this.parseProblemBlocks(markdown);
    if (!problems.length) return this.markdownToHtml(markdown);
    return [
      '<div class="lhv2-problems">',
      ...problems.map(problem => `
        <details class="lhv2-problem">
          <summary>${this.escapeHtml(problem.title)}</summary>
          <div class="lhv2-problem-body">${this.markdownToHtml(problem.body)}</div>
        </details>
      `),
      '</div>',
    ].join('\n');
  },

  renderAssetSection(item, videoData = {}) {
    if (!item) return '';
    if (/^Mappa concettuale$/i.test(item.title)) return this.renderConceptMapSection(item.body);
    if (/^Flashcard$/i.test(item.title)) return this.renderFlashcardsSection(item.body);
    if (/^Quiz finale$/i.test(item.title)) return this.renderQuizSection(item.body);
    if (/^Timeline interattiva$/i.test(item.title)) return this.renderTimelineSection(item.body, videoData);
    if (/^Checklist esecuzione$/i.test(item.title)) return this.renderChecklistSection(item.body, videoData);
    if (/^Glossario operativo$/i.test(item.title)) return this.renderGlossarySection(item.body);
    if (/^Errori frequenti e recovery$/i.test(item.title)) return this.renderProblemsSection(item.body);
    return this.markdownToHtml(item.body);
  },

  buildInteractiveShell(selectors, videoData = {}) {
    const noteKey = `lhv2-notes:${videoData.videoId || 'generic'}`;
    const checklistKey = `lhv2-checklist:${videoData.videoId || 'generic'}`;
    const shellKey = `lhv2-shell:${videoData.videoId || 'generic'}`;
    const progressKey = `lhv2-progress:${videoData.videoId || 'generic'}`;
    const accordionKey = `lhv2-accordion:${videoData.videoId || 'generic'}`;
    return [
      '<style>{`',
      '.lhv2-app { --lhv2-bg-0: #ffffff; --lhv2-bg-1: #f7fbff; --lhv2-surface: #ffffff; --lhv2-surface-soft: #f8fbff; --lhv2-surface-muted: #fbfdff; --lhv2-border: #dbe4f0; --lhv2-border-strong: #bfd3f3; --lhv2-text: #17324d; --lhv2-text-soft: #4a647f; --lhv2-accent: #1558b0; --lhv2-accent-soft: #e8f1ff; --lhv2-shadow: rgba(15, 23, 42, 0.08); --lhv2-video-width: min(960px, 100%); border: 1px solid var(--lhv2-border); border-radius: 24px; background: linear-gradient(180deg, var(--lhv2-bg-0) 0%, var(--lhv2-bg-1) 100%); box-shadow: 0 18px 48px var(--lhv2-shadow); overflow: hidden; color: var(--lhv2-text); }',
      '.lhv2-app[data-theme="sunset"] { --lhv2-bg-0: #fffaf5; --lhv2-bg-1: #fff0e6; --lhv2-surface: #fffdfb; --lhv2-surface-soft: #fff6ef; --lhv2-surface-muted: #fffaf6; --lhv2-border: #f1d5bf; --lhv2-border-strong: #f7b98b; --lhv2-text: #5f2d14; --lhv2-text-soft: #8a4c28; --lhv2-accent: #c25b2a; --lhv2-accent-soft: #ffe5d6; }',
      '.lhv2-app[data-theme="forest"] { --lhv2-bg-0: #f6fff9; --lhv2-bg-1: #ebf8ef; --lhv2-surface: #fbfffc; --lhv2-surface-soft: #f3fcf6; --lhv2-surface-muted: #f8fff9; --lhv2-border: #cde5d4; --lhv2-border-strong: #93c5aa; --lhv2-text: #143524; --lhv2-text-soft: #3c6951; --lhv2-accent: #1e7a52; --lhv2-accent-soft: #def7e8; }',
      '.lhv2-app[data-theme="graphite"] { --lhv2-bg-0: #f4f7fb; --lhv2-bg-1: #e8eef7; --lhv2-surface: #fcfdff; --lhv2-surface-soft: #eef3fb; --lhv2-surface-muted: #f7f9fd; --lhv2-border: #ced9ea; --lhv2-border-strong: #96abc8; --lhv2-text: #1c2a3d; --lhv2-text-soft: #506176; --lhv2-accent: #425f8c; --lhv2-accent-soft: #dde7f5; }',
      '.lhv2-hidden { display: none; }',
      '.lhv2-toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 18px 20px; border-bottom: 1px solid var(--lhv2-border); background: rgba(255,255,255,0.72); backdrop-filter: blur(10px); }',
      '.lhv2-mode-tabs { display: flex; flex-wrap: wrap; gap: 8px; }',
      '.lhv2-toolbar-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }',
      '.lhv2-radio { display: none; }',
      '.lhv2-chip, .lhv2-side-toggle, .lhv2-theme-select { display: inline-flex; align-items: center; justify-content: center; padding: 8px 12px; border-radius: 999px; border: 1px solid var(--lhv2-border); background: var(--lhv2-surface-soft); color: var(--lhv2-text); font-weight: 700; cursor: pointer; }',
      '.lhv2-theme-select { padding-right: 36px; appearance: none; }',
      '.lhv2-meta { display: flex; flex-wrap: wrap; gap: 8px; color: var(--lhv2-text-soft); font-size: 0.9rem; }',
      '.lhv2-kicker { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 999px; background: var(--lhv2-accent-soft); border: 1px solid var(--lhv2-border); }',
      '.lhv2-frame-wrap { position: relative; }',
      '.lhv2-frame { display: grid; grid-template-columns: 260px minmax(0, 1fr) 320px; min-height: 640px; }',
      '.lhv2-app[data-left-open="false"] .lhv2-frame { grid-template-columns: 0 minmax(0, 1fr) 320px; }',
      '.lhv2-app[data-left-open="false"] .lhv2-sidebar { display: none; }',
      '.lhv2-app[data-right-open="false"] .lhv2-frame { grid-template-columns: 260px minmax(0, 1fr) 0; }',
      '.lhv2-app[data-right-open="false"] .lhv2-agent { display: none; }',
      '.lhv2-sidebar { border-right: 1px solid var(--lhv2-border); padding: 14px; background: var(--lhv2-surface-muted); overflow: auto; }',
      '.lhv2-main { padding: 18px; overflow: auto; }',
      '.lhv2-agent { border-left: 1px solid var(--lhv2-border); padding: 18px; background: var(--lhv2-surface-soft); overflow: auto; }',
      '.lhv2-sidebar h3, .lhv2-agent h3 { margin: 0 0 12px; font-size: 0.95rem; color: var(--lhv2-text); }',
      '.lhv2-nav-item { display: block; width: 100%; text-align: left; margin-bottom: 8px; }',
      '.lhv2-nav-item label { display: block; cursor: pointer; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--lhv2-border); background: var(--lhv2-surface); font-weight: 600; color: var(--lhv2-text); }',
      '.lhv2-panel, .lhv2-agent-panel { display: none; }',
      '.lhv2-panel-body, .lhv2-agent-body { border: 1px solid var(--lhv2-border); border-radius: 18px; background: var(--lhv2-surface); padding: 16px; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.04); }',
      '.lhv2-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }',
      '.lhv2-panel-head h2 { margin: 0; font-size: 1.1rem; color: var(--lhv2-text); }',
      '.lhv2-panel-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }',
      '.lhv2-panel-content { margin-top: 14px; }',
      '.lhv2-panel-content.lhv2-collapsed { display: none; }',
      '.lhv2-copy-btn { border: 1px solid var(--lhv2-border); background: var(--lhv2-surface-soft); color: var(--lhv2-text); border-radius: 10px; padding: 7px 10px; cursor: pointer; font-weight: 700; }',
      '.lhv2-copy-footer { display: flex; justify-content: flex-end; margin-top: 16px; }',
      '.lhv2-ts-link { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border-radius: 999px; background: var(--lhv2-accent-soft); color: var(--lhv2-accent); padding: 2px 10px; font-weight: 700; text-decoration: none; }',
      '.lhv2-code { background: #0f172a; color: #e5eef9; padding: 14px; border-radius: 14px; overflow: auto; white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace; }',
      '.lhv2-code-diff code { display: grid; gap: 0; }',
      '.lhv2-diff-add { background: rgba(34, 197, 94, 0.18); display: block; }',
      '.lhv2-diff-del { background: rgba(239, 68, 68, 0.18); display: block; }',
      '.lhv2-diff-neutral { display: block; }',
      '.code-block-wrap { margin: 14px 0; border-radius: 16px; border: 1px solid var(--lhv2-border); overflow: hidden; background: var(--lhv2-surface); }',
      '.code-block-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--lhv2-border); background: var(--lhv2-surface-soft); }',
      '.code-block-actions { display: flex; gap: 8px; flex-wrap: wrap; }',
      '.code-lang { font-weight: 800; color: var(--lhv2-text); font-size: 0.8rem; }',
      '.code-copy-btn { border: 1px solid var(--lhv2-border); background: var(--lhv2-surface); color: var(--lhv2-text); border-radius: 999px; padding: 6px 10px; cursor: pointer; font-weight: 700; font-size: 0.8rem; }',
      '.code-block-body.is-collapsible { max-height: 340px; overflow: hidden; position: relative; }',
      '.code-block-wrap[data-collapsed="false"] .code-block-body.is-collapsible { max-height: none; }',
      '.lhv2-live-frame { width: 100%; min-height: 220px; border: 0; border-top: 1px solid var(--lhv2-border); background: var(--lhv2-surface); }',
      '.lhv2-panel-body h2, .lhv2-panel-body h3, .lhv2-panel-body h4, .lhv2-agent-body h2, .lhv2-agent-body h3, .lhv2-agent-body h4 { margin: 14px 0 8px; color: var(--lhv2-text); }',
      '.lhv2-panel-body p, .lhv2-agent-body p, .lhv2-panel-body li, .lhv2-agent-body li { line-height: 1.7; }',
      '.lhv2-panel-body blockquote, .lhv2-agent-body blockquote { border-left: 3px solid var(--lhv2-border-strong); margin: 10px 0; padding-left: 12px; color: var(--lhv2-text-soft); }',
      '.lhv2-panel-body h2[id], .lhv2-panel-body h3[id], .lhv2-panel-body h4[id] { scroll-margin-top: 14px; }',
      '.lhv2-admonition { border: 1px solid var(--lhv2-border); background: var(--lhv2-surface-soft); border-radius: 14px; padding: 12px 14px; margin: 12px 0; }',
      '.lhv2-admonition[data-kind="warning"], .lhv2-admonition[data-kind="attenzione"], .lhv2-admonition[data-kind="danger"], .lhv2-admonition[data-kind="pericolo"] { background: #fff7ed; border-color: #fed7aa; }',
      '.lhv2-section-intro { color: var(--lhv2-text-soft); margin-bottom: 12px; }',
      '.lhv2-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px; border-radius: 999px; background: var(--lhv2-accent-soft); color: var(--lhv2-accent); font-weight: 700; font-size: 0.8rem; }',
      '.lhv2-badge-soft { background: #ecfccb; color: #3f6212; }',
      '.lhv2-flashcards, .lhv2-quiz-stack, .lhv2-timeline, .lhv2-problems, .lhv2-glossary-list { display: grid; gap: 12px; }',
      '.lhv2-flashcard, .lhv2-quiz, .lhv2-timeline-item, .lhv2-glossary-item { border: 1px solid var(--lhv2-border); background: var(--lhv2-surface-muted); border-radius: 16px; padding: 14px; }',
      '.lhv2-flashcard-head { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 8px; }',
      '.lhv2-flashcard-q, .lhv2-quiz-q { margin: 0 0 12px; font-weight: 700; color: var(--lhv2-text); }',
      '.lhv2-flashcard-label { margin: 0 0 6px; font-size: 0.8rem; text-transform: uppercase; color: #166534; font-weight: 800; }',
      '.lhv2-flashcard-a { margin-top: 12px; padding: 12px; border-radius: 12px; background: #eefbf3; border: 1px solid #bbf7d0; }',
      '.lhv2-quiz-options { display: grid; gap: 8px; margin-bottom: 10px; }',
      '.lhv2-quiz-option { width: 100%; display: flex; gap: 10px; text-align: left; border: 1px solid var(--lhv2-border); background: var(--lhv2-surface); border-radius: 12px; padding: 10px 12px; cursor: pointer; color: var(--lhv2-text); }',
      '.lhv2-quiz-option[data-selected="true"] { border-color: #93c5fd; background: #eff6ff; }',
      '.lhv2-quiz-option[data-state="correct"] { border-color: #86efac; background: #ecfdf5; color: #166534; }',
      '.lhv2-quiz-option[data-state="wrong"] { border-color: #fca5a5; background: #fef2f2; color: #991b1b; }',
      '.lhv2-quiz-key { font-weight: 800; min-width: 20px; }',
      '.lhv2-quiz-actions { display: flex; flex-wrap: wrap; gap: 8px; }',
      '.lhv2-quiz-feedback { margin-top: 12px; padding: 12px; border-radius: 12px; border: 1px solid var(--lhv2-border); background: var(--lhv2-surface); }',
      '.lhv2-timeline-item { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 14px; align-items: start; }',
      '.lhv2-timeline-time { padding-top: 2px; }',
      '.lhv2-checklist { display: grid; gap: 10px; }',
      '.lhv2-task { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--lhv2-border); background: var(--lhv2-surface); }',
      '.lhv2-task input { margin-top: 5px; }',
      '.lhv2-glossary-search, .lhv2-notes textarea { width: 100%; border: 1px solid var(--lhv2-border); border-radius: 12px; padding: 12px 14px; font: inherit; color: var(--lhv2-text); background: var(--lhv2-surface); }',
      '.lhv2-glossary-why { margin-top: 8px; color: var(--lhv2-text-soft); }',
      '.lhv2-problem { border: 1px solid var(--lhv2-border); border-radius: 14px; background: var(--lhv2-surface); padding: 12px 14px; }',
      '.lhv2-problem summary { cursor: pointer; font-weight: 700; color: var(--lhv2-text); }',
      '.lhv2-problem-body { margin-top: 10px; }',
      '.lhv2-mermaid { margin: 0; white-space: pre-wrap; color: var(--lhv2-text); }',
      '.lhv2-concept-stage { position: relative; min-height: 700px; border: 1px solid var(--lhv2-border); border-radius: 24px; background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,251,255,0.96)); overflow: auto; padding: 96px 18px 20px; }',
      '.lhv2-concept-head { position: sticky; left: 0; top: 0; z-index: 3; display: grid; gap: 4px; margin: -74px 0 14px; padding: 10px 6px 12px; background: linear-gradient(180deg, rgba(255,255,255,0.96), rgba(255,255,255,0.72), rgba(255,255,255,0)); backdrop-filter: blur(4px); }',
      '.lhv2-concept-title { font-size: 1.45rem; font-weight: 700; color: var(--lhv2-text); }',
      '.lhv2-concept-subtitle { font-size: 0.95rem; color: var(--lhv2-text-soft); }',
      '.lhv2-concept-canvas { position: relative; width: max(100%, var(--lhv2-concept-width, 1180px)); min-width: 100%; min-height: var(--lhv2-concept-height, 720px); margin: 0 auto; padding: 12px 12px 16px; }',
      '.lhv2-concept-svg { position: absolute; inset: 0; width: 100%; height: 100%; }',
      '.lhv2-concept-node { position: absolute; transform: translate(-50%, -50%); width: clamp(170px, 18vw, 290px); max-width: 290px; min-width: 170px; padding: 14px 18px; border-radius: 12px; border: 1px solid var(--lhv2-border-strong); background: linear-gradient(180deg, rgba(197,214,247,0.82), rgba(179,203,243,0.95)); color: #12263f; text-align: center; line-height: 1.45; box-shadow: 0 14px 28px rgba(21, 88, 176, 0.10); }',
      '.lhv2-concept-node strong { display: block; font-size: 0.95rem; white-space: normal; word-break: break-word; overflow-wrap: anywhere; text-wrap: balance; }',
      '.lhv2-concept-node[data-node-size="5"] { width: clamp(220px, 24vw, 340px); max-width: 340px; min-width: 220px; border-width: 2px; background: linear-gradient(180deg, #c4cdfc, #b8c6ff); }',
      '.lhv2-concept-node[data-node-size="4"] { width: clamp(200px, 21vw, 300px); max-width: 300px; min-width: 200px; background: linear-gradient(180deg, #cfe0f7, #bfd7f5); }',
      '.lhv2-concept-node[data-node-size="3"] { width: clamp(186px, 19vw, 280px); max-width: 280px; min-width: 186px; background: linear-gradient(180deg, #d5f2e9, #bde9dd); }',
      '.lhv2-concept-node[data-node-size="2"] { width: clamp(174px, 17vw, 250px); max-width: 250px; background: linear-gradient(180deg, #def5ed, #c8efe2); }',
      '.lhv2-concept-node[data-node-depth="0"] { box-shadow: 0 0 0 2px rgba(21, 88, 176, 0.12), 0 16px 36px rgba(21, 88, 176, 0.16); }',
      '.lhv2-concept-port { position: absolute; top: 50%; transform: translateY(-50%); width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; background: rgba(255,255,255,0.88); color: #5b74c8; font-weight: 800; box-shadow: 0 4px 10px rgba(21, 88, 176, 0.12); }',
      '.lhv2-concept-port-in { left: -12px; }',
      '.lhv2-concept-port-out { right: -12px; }',
      '.lhv2-notes { border-top: 1px solid var(--lhv2-border); background: var(--lhv2-surface-soft); padding: 16px 18px; }',
      '.lhv2-notes-head { display: flex; justify-content: space-between; gap: 10px; align-items: center; margin-bottom: 10px; }',
      '.lhv2-notes small { color: var(--lhv2-text-soft); }',
      '.lhv2-capabilities { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }',
      '.lhv2-video-stage { padding: 16px 18px 0; background: linear-gradient(180deg, var(--lhv2-bg-0) 0%, var(--lhv2-bg-1) 100%); }',
      '.lhv2-video-shell { width: var(--lhv2-video-width); max-width: 100%; margin: 0 auto; border: 1px solid var(--lhv2-border); border-radius: 18px; overflow: hidden; background: #0f172a; box-shadow: 0 12px 28px rgba(15, 23, 42, 0.12); resize: horizontal; min-width: 220px; }',
      '.lhv2-video-frame { display: block; width: 100%; aspect-ratio: 16 / 9; border: 0; }',
      '.lhv2-video-controls { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; align-items: center; }',
      '.lhv2-video-resize { display: inline-flex; align-items: center; gap: 10px; padding: 7px 12px; border: 1px solid var(--lhv2-border); border-radius: 999px; background: var(--lhv2-surface); }',
      '.lhv2-video-resize input { width: 120px; }',
      '.lhv2-app[data-focus-video="true"] .lhv2-frame { opacity: 0.18; }',
      '.lhv2-app[data-focus-video="true"] .lhv2-video-stage { position: sticky; top: 0; z-index: 20; padding-bottom: 16px; }',
      '.lhv2-app[data-pip-video="true"] .lhv2-video-stage { position: fixed; right: 18px; bottom: 18px; width: min(420px, 42vw); z-index: 50; padding: 0; }',
      '.lhv2-app[data-pip-video="true"] .lhv2-video-shell { width: 100%; }',
      '.lhv2-app[data-pip-video="true"] .lhv2-video-controls { padding: 10px; margin: 0; background: rgba(255,255,255,0.96); border: 1px solid var(--lhv2-border); border-top: 0; border-radius: 0 0 18px 18px; }',
      '.lhv2-transcript-block { display: grid; gap: 12px; }',
      '.lhv2-transcript-meta { display: flex; flex-wrap: wrap; gap: 8px; }',
      '.lhv2-transcript-lines { display: grid; gap: 10px; }',
      '.lhv2-transcript-line { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 12px; padding: 10px 12px; border: 1px solid var(--lhv2-border); border-radius: 14px; background: var(--lhv2-surface-muted); }',
      '.lhv2-transcript-copy { color: var(--lhv2-text); line-height: 1.7; }',
      '.lhv2-transcript-line.lhv2-transcript-active, .lhv2-transcript-active .lhv2-transcript-line:first-child { border-color: var(--lhv2-border-strong); background: var(--lhv2-accent-soft); }',
      '.lhv2-side-toggle { position: absolute; top: 50%; transform: translateY(-50%); width: 42px; height: 42px; border-radius: 999px; z-index: 8; box-shadow: 0 10px 22px rgba(15,23,42,0.16); }',
      '.lhv2-side-toggle[data-side="left"] { left: 12px; }',
      '.lhv2-side-toggle[data-side="right"] { right: 12px; }',
      '.lhv2-side-toggle[data-state="active"] { background: var(--lhv2-accent); color: #ffffff; border-color: var(--lhv2-accent); }',
      '.lhv2-side-toggle[data-state="inactive"] { background: rgba(255,255,255,0.86); color: var(--lhv2-text-soft); }',
      '#lhv2-mode-verbatim:checked ~ .lhv2-app label[for="lhv2-mode-verbatim"], #lhv2-mode-study:checked ~ .lhv2-app label[for="lhv2-mode-study"], #lhv2-mode-summary:checked ~ .lhv2-app label[for="lhv2-mode-summary"], #lhv2-mode-assets:checked ~ .lhv2-app label[for="lhv2-mode-assets"] { background: var(--lhv2-accent); color: #ffffff; border-color: var(--lhv2-accent); }',
      selectors,
      '@media (max-width: 1180px) { .lhv2-toolbar { grid-template-columns: 1fr; } .lhv2-toolbar-right { justify-content: flex-start; } .lhv2-frame { grid-template-columns: 1fr !important; } .lhv2-sidebar, .lhv2-agent { display: none !important; } .lhv2-timeline-item, .lhv2-transcript-line { grid-template-columns: 1fr; } .lhv2-side-toggle { display: none; } .lhv2-app[data-pip-video="true"] .lhv2-video-stage { width: calc(100vw - 24px); right: 12px; left: 12px; bottom: 12px; } .lhv2-concept-stage { min-height: 820px; padding-inline: 12px; } .lhv2-concept-canvas { width: max(920px, var(--lhv2-concept-width, 920px)); } }',
      /* ── CSS Visuals: hero thumbnail + frame grid ── */
      '.lh-video-hero { position: relative; margin: 0 0 1.5rem; border-radius: 14px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.18); }',
      '.lh-hero-img { width: 100%; display: block; aspect-ratio: 16/9; object-fit: cover; }',
      '.lh-play-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0); transition: background 0.2s; }',
      '.lh-video-hero:hover .lh-play-overlay { background: rgba(0,0,0,0.28); }',
      '.lh-play-btn { width: 64px; height: 64px; background: rgba(255,255,255,0.92); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 26px; opacity: 0; transition: opacity 0.2s; color: #f97316; box-shadow: 0 4px 16px rgba(0,0,0,0.25); }',
      '.lh-video-hero:hover .lh-play-btn { opacity: 1; }',
      '.lh-video-hero figcaption { position: absolute; bottom: 0; left: 0; right: 0; padding: 10px 14px; background: linear-gradient(to top, rgba(0,0,0,0.72) 0%, transparent 100%); color: #fff; font-size: 13px; }',
      '.lh-frames-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 1rem 0 1.5rem; }',
      '.lh-frame-card { margin: 0; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 14px rgba(0,0,0,0.12); transition: transform 0.18s, box-shadow 0.18s; }',
      '.lh-frame-card:hover { transform: translateY(-3px); box-shadow: 0 8px 22px rgba(0,0,0,0.18); }',
      '.lh-frame-img { width: 100%; display: block; aspect-ratio: 16/9; object-fit: cover; }',
      '.lh-frame-card figcaption { font-size: 11px; padding: 5px 8px; background: #1e293b; color: #94a3b8; text-align: center; }',
      '@media (max-width: 680px) { .lh-frames-grid { grid-template-columns: 1fr 1fr; } }',
      '.lhv2-progress-strip { display: flex; align-items: center; gap: 12px; padding: 8px 20px; border-bottom: 1px solid var(--lhv2-border); background: var(--lhv2-surface-soft); font-size: 0.85rem; color: var(--lhv2-text-soft); }',
      '.lhv2-progress-track { flex: 1; height: 8px; border-radius: 999px; background: var(--lhv2-accent-soft); overflow: hidden; }',
      '.lhv2-progress-fill { height: 100%; width: 0%; background: var(--lhv2-accent); transition: width .25s; }',
      '.lhv2-read-label { display: inline-flex; align-items: center; gap: 6px; font-size: 0.8rem; font-weight: 700; cursor: pointer; white-space: nowrap; }',
      '.lhv2-doc-search { width: 100%; margin-bottom: 10px; border: 1px solid var(--lhv2-border); border-radius: 12px; padding: 9px 12px; font: inherit; color: var(--lhv2-text); background: var(--lhv2-surface); }',
      '.lhv2-doc-search-count { font-size: 0.75rem; color: var(--lhv2-text-soft); margin-bottom: 10px; }',
      '.lhv2-nav-item.lhv2-nav-active label { background: var(--lhv2-accent); color: #fff; border-color: var(--lhv2-accent); }',
      '.lhv2-panel.lhv2-search-hidden, .lhv2-agent-panel.lhv2-search-hidden { display: none !important; }',
      '.lhv2-panel-body[data-lhv2-read="true"], .lhv2-agent-body[data-lhv2-read="true"] { border-color: #86efac; }',
      '`}</style>',
      '<script>{`',
      'var lhv2Player = null;',
      'function lhv2ReadShellState(){ try { return JSON.parse(localStorage.getItem(' + JSON.stringify(shellKey) + ') || "{}"); } catch (error) { return {}; } }',
      'function lhv2WriteShellState(next){ localStorage.setItem(' + JSON.stringify(shellKey) + ', JSON.stringify(next)); }',
      'function lhv2PostPlayer(command, args){ var iframe = document.getElementById("lhv2-youtube-player"); if (!iframe || !iframe.contentWindow) return; iframe.contentWindow.postMessage(JSON.stringify({ event: "command", func: command, args: args || [] }), "*"); }',
      'function lhv2LoadMermaid(){ if (typeof window === "undefined") return; if (window.mermaid && window.mermaid.run) { window.mermaid.initialize({ startOnLoad: false, securityLevel: "loose" }); window.mermaid.run({ querySelector: ".lhv2-mermaid" }); return; } if (document.querySelector("script[data-lhv2-mermaid-loader]")) return; var script = document.createElement("script"); script.src = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"; script.async = true; script.dataset.lhv2MermaidLoader = "true"; script.onload = function(){ if (window.mermaid && window.mermaid.run) { window.mermaid.initialize({ startOnLoad: false, securityLevel: "loose" }); window.mermaid.run({ querySelector: ".lhv2-mermaid" }); } }; document.head.appendChild(script); }',
      'function lhv2LoadYouTubeApi(){ if (document.querySelector("script[data-lhv2-yt-loader]")) return; var script = document.createElement("script"); script.src = "https://www.youtube.com/iframe_api"; script.async = true; script.dataset.lhv2YtLoader = "true"; document.head.appendChild(script); window.onYouTubeIframeAPIReady = function(){ if (!window.YT || !window.YT.Player) return; lhv2Player = new window.YT.Player("lhv2-youtube-player", { events: { onReady: function(){}, onStateChange: function(){} } }); }; }',
      'function lhv2ApplySideButtons(app){ app.querySelectorAll("[data-side-toggle]").forEach(function(button){ var side = button.getAttribute("data-side"); var open = app.dataset[side + "Open"] !== "false"; button.dataset.state = open ? "active" : "inactive"; button.textContent = side === "left" ? (open ? "◀" : "▶") : (open ? "▶" : "◀"); }); }',
      'function lhv2InitShellControls(){ var app = document.querySelector(".lhv2-app"); if (!app) return; var saved = lhv2ReadShellState(); app.dataset.leftOpen = saved.leftOpen === false ? "false" : "true"; app.dataset.rightOpen = saved.rightOpen === false ? "false" : "true"; app.dataset.theme = saved.theme || app.dataset.theme || "aurora"; app.style.setProperty("--lhv2-video-width", Math.max(220, Number(saved.videoWidth || 960)) + "px"); lhv2ApplySideButtons(app); app.querySelectorAll("[data-side-toggle]").forEach(function(button){ button.addEventListener("click", function(){ var side = button.getAttribute("data-side"); var key = side + "Open"; app.dataset[key] = app.dataset[key] === "false" ? "true" : "false"; var state = lhv2ReadShellState(); state.leftOpen = app.dataset.leftOpen !== "false"; state.rightOpen = app.dataset.rightOpen !== "false"; state.theme = app.dataset.theme || "aurora"; state.videoWidth = parseInt((app.style.getPropertyValue("--lhv2-video-width") || "960").replace("px", ""), 10) || 960; lhv2WriteShellState(state); lhv2ApplySideButtons(app); }); }); var themeSelect = app.querySelector("[data-theme-select]"); if (themeSelect) { themeSelect.value = app.dataset.theme || "aurora"; themeSelect.addEventListener("change", function(){ app.dataset.theme = themeSelect.value || "aurora"; var state = lhv2ReadShellState(); state.leftOpen = app.dataset.leftOpen !== "false"; state.rightOpen = app.dataset.rightOpen !== "false"; state.theme = app.dataset.theme; state.videoWidth = parseInt((app.style.getPropertyValue("--lhv2-video-width") || "960").replace("px", ""), 10) || 960; lhv2WriteShellState(state); }); } }',
      'function lhv2InitPlayerControls(){ var app = document.querySelector(".lhv2-app"); if (!app) return; app.querySelectorAll("[data-video-speed]").forEach(function(button){ button.addEventListener("click", function(){ var speed = Number(button.getAttribute("data-video-speed") || "1"); if (lhv2Player && lhv2Player.setPlaybackRate) lhv2Player.setPlaybackRate(speed); else lhv2PostPlayer("setPlaybackRate", [speed]); }); }); var focus = app.querySelector("[data-video-toggle-focus]"); if (focus) focus.addEventListener("click", function(){ app.dataset.focusVideo = app.dataset.focusVideo === "true" ? "false" : "true"; focus.textContent = app.dataset.focusVideo === "true" ? "Disattiva focus" : "Focus"; }); var pip = app.querySelector("[data-video-toggle-pip]"); if (pip) pip.addEventListener("click", function(){ app.dataset.pipVideo = app.dataset.pipVideo === "true" ? "false" : "true"; pip.textContent = app.dataset.pipVideo === "true" ? "Chiudi mini player" : "Mini player"; }); var size = app.querySelector("[data-video-size]"); if (size) { var initial = parseInt((app.style.getPropertyValue("--lhv2-video-width") || "960").replace("px", ""), 10) || 960; size.value = String(initial); size.addEventListener("input", function(){ var width = Math.max(220, Number(size.value || "960")); app.style.setProperty("--lhv2-video-width", width + "px"); var state = lhv2ReadShellState(); state.leftOpen = app.dataset.leftOpen !== "false"; state.rightOpen = app.dataset.rightOpen !== "false"; state.theme = app.dataset.theme || "aurora"; state.videoWidth = width; lhv2WriteShellState(state); }); } }',
      'function lhv2BindTimestampLinks(){ document.querySelectorAll(".lhv2-ts-link[data-seconds]").forEach(function(link){ link.addEventListener("click", function(event){ var seconds = Number(link.getAttribute("data-seconds") || "0"); if (!seconds || Number.isNaN(seconds)) return; event.preventDefault(); if (lhv2Player && lhv2Player.seekTo) { lhv2Player.seekTo(seconds, true); if (lhv2Player.playVideo) lhv2Player.playVideo(); } else { lhv2PostPlayer("seekTo", [seconds, true]); lhv2PostPlayer("playVideo"); } var stage = document.querySelector(".lhv2-video-stage"); if (stage && stage.scrollIntoView) stage.scrollIntoView({ behavior: "smooth", block: "start" }); }); }); }',
      'function lhv2InitCodeBlocks(){ document.querySelectorAll(".code-block-wrap").forEach(function(block){ var copy = block.querySelector("[data-code-copy]"); if (copy) copy.addEventListener("click", function(){ var text = block.querySelector("code") ? block.querySelector("code").innerText : ""; if (!text) return; navigator.clipboard.writeText(text).then(function(){ var original = copy.textContent; copy.textContent = "Copiato"; setTimeout(function(){ copy.textContent = original; }, 1200); }); }); var collapse = block.querySelector("[data-code-collapse]"); if (collapse) { block.dataset.collapsed = "true"; collapse.addEventListener("click", function(){ var next = block.dataset.collapsed === "true" ? "false" : "true"; block.dataset.collapsed = next; collapse.textContent = next === "true" ? "Espandi" : "Comprimi"; }); } var run = block.querySelector("[data-live-run]"); if (run) run.addEventListener("click", function(){ var frame = block.querySelector(".lhv2-live-frame"); var code = block.querySelector("code") ? block.querySelector("code").innerText : ""; if (!frame || !code) return; frame.classList.remove("lhv2-hidden"); frame.srcdoc = code; }); }); }',
      'function lhv2SyncTranscript(){ var entries = Array.from(document.querySelectorAll("[data-transcript-start]")); if (!entries.length) return; setInterval(function(){ if (!lhv2Player || !lhv2Player.getCurrentTime) return; var current = 0; try { current = lhv2Player.getCurrentTime() || 0; } catch (error) { return; } var active = null; entries.forEach(function(entry){ var start = Number(entry.getAttribute("data-transcript-start") || "0"); if (current >= start) active = entry; entry.classList.remove("lhv2-transcript-active"); }); if (active) active.classList.add("lhv2-transcript-active"); document.querySelectorAll("[data-transcript-line-start]").forEach(function(line){ var lineStart = Number(line.getAttribute("data-transcript-line-start") || "0"); line.classList.toggle("lhv2-transcript-active", current >= lineStart && current < lineStart + 8); }); }, 1500); }',
      'function lhv2InitNotes(){ var key = ' + JSON.stringify(noteKey) + '; var root = document.querySelector("[data-lhv2-notes]"); if (!root) return; var input = root.querySelector("textarea"); var toggle = document.querySelector("[data-lhv2-notes-toggle]"); var defaultTemplate = ["Obiettivo studio:", "- ", "", "Domande aperte:", "- ", "", "Snippet da riprovare:", "- ", "", "Azioni successive:", "- "].join("\\n"); if (input) { input.value = localStorage.getItem(key) || defaultTemplate; input.addEventListener("input", function(){ localStorage.setItem(key, input.value); }); } if (toggle) { toggle.addEventListener("click", function(){ root.classList.toggle("lhv2-hidden"); }); } }',
      'function lhv2InitChecklist(){ var baseKey = ' + JSON.stringify(checklistKey) + '; document.querySelectorAll("[data-checklist-root]").forEach(function(root){ var saved = {}; try { saved = JSON.parse(localStorage.getItem(baseKey) || "{}"); } catch (error) {} root.querySelectorAll("[data-task-id]").forEach(function(input){ var taskId = input.getAttribute("data-task-id"); if (Object.prototype.hasOwnProperty.call(saved, taskId)) input.checked = !!saved[taskId]; input.addEventListener("change", function(){ saved[taskId] = input.checked; localStorage.setItem(baseKey, JSON.stringify(saved)); }); }); }); }',
      'function lhv2InitFlashcards(){ document.querySelectorAll("[data-flashcard-toggle]").forEach(function(button){ button.addEventListener("click", function(){ var card = button.closest("[data-flashcard]"); var answer = card && card.querySelector(".lhv2-flashcard-a"); if (!answer) return; answer.classList.toggle("lhv2-hidden"); button.textContent = answer.classList.contains("lhv2-hidden") ? "Mostra risposta" : "Nascondi risposta"; }); }); }',
      'function lhv2InitQuiz(){ document.querySelectorAll("[data-quiz]").forEach(function(card){ var selected = ""; card.querySelectorAll("[data-quiz-option]").forEach(function(option){ option.addEventListener("click", function(){ selected = option.getAttribute("data-quiz-option") || ""; card.querySelectorAll("[data-quiz-option]").forEach(function(btn){ btn.dataset.selected = "false"; btn.dataset.state = ""; }); option.dataset.selected = "true"; }); }); var check = card.querySelector("[data-quiz-check]"); var reveal = card.querySelector("[data-quiz-reveal]"); var feedback = card.querySelector(".lhv2-quiz-feedback"); if (check) check.addEventListener("click", function(){ if (!selected) return; var answer = card.dataset.answer || ""; var correct = selected === answer; card.querySelectorAll("[data-quiz-option]").forEach(function(btn){ if ((btn.getAttribute("data-quiz-option") || "") === selected) btn.dataset.state = correct ? "correct" : "wrong"; }); if (feedback) { var answerLine = feedback.querySelector(".lhv2-quiz-answer"); if (correct) { feedback.classList.remove("lhv2-hidden"); if (answerLine) answerLine.innerHTML = "<strong>Corretto.</strong> Hai selezionato la risposta giusta."; if (reveal) reveal.classList.add("lhv2-hidden"); } else { feedback.classList.add("lhv2-hidden"); if (answerLine) answerLine.innerHTML = "<strong>Non corretta.</strong> Apri la soluzione solo se ti serve."; if (reveal) reveal.classList.remove("lhv2-hidden"); } } }); if (reveal) reveal.addEventListener("click", function(){ var answer = card.dataset.answer || ""; card.querySelectorAll("[data-quiz-option]").forEach(function(btn){ if ((btn.getAttribute("data-quiz-option") || "") === answer) btn.dataset.state = "correct"; }); if (feedback) { var answerLine = feedback.querySelector(".lhv2-quiz-answer"); var answerText = answerLine ? answerLine.getAttribute("data-answer-text") : "N/D"; if (answerLine) answerLine.innerHTML = "<strong>Risposta corretta:</strong> " + answerText; feedback.classList.toggle("lhv2-hidden"); reveal.textContent = feedback.classList.contains("lhv2-hidden") ? "Mostra soluzione" : "Nascondi soluzione"; } }); }); }',
      'function lhv2InitPanels(){ document.querySelectorAll("[data-panel-toggle]").forEach(function(button){ button.addEventListener("click", function(){ var card = button.closest(".lhv2-panel-body, .lhv2-agent-body"); var content = card && card.querySelector("[data-panel-content]"); if (!content) return; content.classList.toggle("lhv2-collapsed"); button.textContent = content.classList.contains("lhv2-collapsed") ? "Espandi" : "Comprimi"; }); }); }',
      'function lhv2DrawConceptMaps(){ document.querySelectorAll("[data-concept-stage]").forEach(function(stage){ var canvas = stage.querySelector("[data-concept-canvas]"); var svg = stage.querySelector(".lhv2-concept-svg"); if (!svg || !canvas) return; var bounds = canvas.getBoundingClientRect(); var lines = []; stage.querySelectorAll("[data-edge-from]").forEach(function(edge){ var from = stage.querySelector(\'[data-node-id="\' + edge.getAttribute("data-edge-from") + \'"]\'); var to = stage.querySelector(\'[data-node-id="\' + edge.getAttribute("data-edge-to") + \'"]\'); if (!from || !to) return; var a = from.getBoundingClientRect(); var b = to.getBoundingClientRect(); var x1 = ((a.left - bounds.left) + (a.width / 2)) / bounds.width * 1000; var y1 = ((a.top - bounds.top) + (a.height / 2)) / bounds.height * 700; var x2 = ((b.left - bounds.left) + (b.width / 2)) / bounds.width * 1000; var y2 = ((b.top - bounds.top) + (b.height / 2)) / bounds.height * 700; var curve = Math.max(70, Math.abs(x2 - x1) * 0.38); lines.push(\'<path d="M \' + x1 + \' \' + y1 + \' C \' + (x1 + curve) + \' \' + y1 + \', \' + (x2 - curve) + \' \' + y2 + \', \' + x2 + \' \' + y2 + \'" stroke="rgba(21,88,176,0.28)" stroke-width="3" fill="none" stroke-linecap="round" />\'); }); svg.innerHTML = lines.join(""); }); }',
      'function lhv2InitGlossary(){ document.querySelectorAll("[data-glossary-search]").forEach(function(input){ input.addEventListener("input", function(){ var query = input.value.toLowerCase().trim(); var container = input.parentElement.querySelector("[data-glossary-list]"); if (!container) return; container.querySelectorAll("[data-glossary-item]").forEach(function(item){ item.style.display = !query || item.innerText.toLowerCase().includes(query) ? "" : "none"; }); }); }); }',
      'function lhv2InitAccordion(){ var aKey = ' + JSON.stringify(accordionKey) + '; var saved = {}; try { saved = JSON.parse(localStorage.getItem(aKey) || "{}"); } catch(e){} var panels = Array.from(document.querySelectorAll(".lhv2-panel, .lhv2-agent-panel")); panels.forEach(function(panel, i){ var pid = "p" + i; panel.setAttribute("data-lhv2-pid", pid); var body = panel.querySelector(".lhv2-panel-body, .lhv2-agent-body"); var content = body && body.querySelector("[data-panel-content]"); var btn = body && body.querySelector("[data-panel-toggle]"); if (!content || !btn) return; if (Object.prototype.hasOwnProperty.call(saved, pid)) { if (saved[pid]) { content.classList.remove("lhv2-collapsed"); btn.textContent = "Comprimi"; } else { content.classList.add("lhv2-collapsed"); btn.textContent = "Espandi"; } } btn.addEventListener("click", function(){ setTimeout(function(){ var state = {}; panels.forEach(function(p){ var c = p.querySelector("[data-panel-content]"); state[p.getAttribute("data-lhv2-pid")] = c ? !c.classList.contains("lhv2-collapsed") : false; }); localStorage.setItem(aKey, JSON.stringify(state)); }, 0); }); }); var tabs = document.querySelector(".lhv2-mode-tabs"); if (tabs && !tabs.querySelector("[data-lhv2-expand-all]")) { var expandBtn = document.createElement("button"); expandBtn.className = "lhv2-chip"; expandBtn.setAttribute("data-lhv2-expand-all", "true"); expandBtn.textContent = "Espandi tutto"; expandBtn.addEventListener("click", function(){ var state = {}; panels.forEach(function(p){ var body = p.querySelector(".lhv2-panel-body, .lhv2-agent-body"); var content = body && body.querySelector("[data-panel-content]"); var btn = body && body.querySelector("[data-panel-toggle]"); if (content) content.classList.remove("lhv2-collapsed"); if (btn) btn.textContent = "Comprimi"; state[p.getAttribute("data-lhv2-pid")] = true; }); localStorage.setItem(aKey, JSON.stringify(state)); }); var collapseBtn = document.createElement("button"); collapseBtn.className = "lhv2-chip"; collapseBtn.setAttribute("data-lhv2-collapse-all", "true"); collapseBtn.textContent = "Comprimi tutto"; collapseBtn.addEventListener("click", function(){ var state = {}; panels.forEach(function(p){ var body = p.querySelector(".lhv2-panel-body, .lhv2-agent-body"); var content = body && body.querySelector("[data-panel-content]"); var btn = body && body.querySelector("[data-panel-toggle]"); if (content) content.classList.add("lhv2-collapsed"); if (btn) btn.textContent = "Espandi"; state[p.getAttribute("data-lhv2-pid")] = false; }); localStorage.setItem(aKey, JSON.stringify(state)); }); tabs.appendChild(expandBtn); tabs.appendChild(collapseBtn); } }',
      'function lhv2InitProgress(){ var pKey = ' + JSON.stringify(progressKey) + '; var app = document.querySelector(".lhv2-app"); var toolbar = app && app.querySelector(".lhv2-toolbar"); if (!toolbar) return; var strip = document.createElement("div"); strip.className = "lhv2-progress-strip"; var track = document.createElement("div"); track.className = "lhv2-progress-track"; var fill = document.createElement("div"); fill.className = "lhv2-progress-fill"; fill.setAttribute("data-progress-fill", "true"); track.appendChild(fill); var txt = document.createElement("span"); txt.setAttribute("data-progress-text", "true"); strip.appendChild(track); strip.appendChild(txt); toolbar.parentNode.insertBefore(strip, toolbar.nextSibling); var saved = {}; try { saved = JSON.parse(localStorage.getItem(pKey) || "{}"); } catch(e){} var panels = Array.from(document.querySelectorAll(".lhv2-panel, .lhv2-agent-panel")); panels.forEach(function(panel, i){ var pid = panel.getAttribute("data-lhv2-pid") || ("p" + i); var body = panel.querySelector(".lhv2-panel-body, .lhv2-agent-body"); var actions = body && body.querySelector(".lhv2-panel-actions"); if (!actions) return; if (actions.querySelector("[data-lhv2-read-pid]")) return; var label = document.createElement("label"); label.className = "lhv2-read-label"; var cb = document.createElement("input"); cb.type = "checkbox"; cb.setAttribute("data-lhv2-read-pid", pid); if (saved[pid]) { cb.checked = true; if (body) body.setAttribute("data-lhv2-read", "true"); } label.appendChild(cb); label.appendChild(document.createTextNode(" letto")); actions.insertBefore(label, actions.firstChild); cb.addEventListener("change", function(){ saved[pid] = cb.checked; if (body) { if (cb.checked) body.setAttribute("data-lhv2-read", "true"); else body.removeAttribute("data-lhv2-read"); } localStorage.setItem(pKey, JSON.stringify(saved)); recompute(); }); }); function recompute(){ var visible = panels.filter(function(p){ return p.offsetParent !== null; }); var done = visible.filter(function(p){ var pid = p.getAttribute("data-lhv2-pid"); var cb = p.querySelector("[data-lhv2-read-pid]"); return cb && cb.checked; }).length; var total = visible.length; var pct = total ? Math.round(done / total * 100) : 0; var fillEl = strip.querySelector("[data-progress-fill]"); var txtEl = strip.querySelector("[data-progress-text]"); if (fillEl) fillEl.style.width = pct + "%"; if (txtEl) txtEl.textContent = done + "/" + total + " sezioni (" + pct + "%)"; } recompute(); var modeTabs = document.querySelector(".lhv2-mode-tabs"); if (modeTabs) modeTabs.addEventListener("click", function(){ setTimeout(recompute, 30); }); }',
      'function lhv2InitDocSearch(){ var sidebar = document.querySelector(".lhv2-sidebar"); if (!sidebar || sidebar.querySelector(".lhv2-doc-search")) return; var input = document.createElement("input"); input.className = "lhv2-doc-search"; input.placeholder = "Cerca nel documento..."; var count = document.createElement("div"); count.className = "lhv2-doc-search-count"; sidebar.insertBefore(count, sidebar.firstChild); sidebar.insertBefore(input, sidebar.firstChild); input.addEventListener("input", function(){ var query = input.value.toLowerCase().trim(); var panels = Array.from(document.querySelectorAll(".lhv2-panel, .lhv2-agent-panel")); var visiblePanels = panels.filter(function(p){ return !p.classList.contains("lhv2-search-hidden") || query === ""; }); if (query === "") { panels.forEach(function(p){ p.classList.remove("lhv2-search-hidden"); }); count.textContent = ""; return; } var matches = 0; panels.forEach(function(p){ if (p.offsetParent === null && !p.classList.contains("lhv2-search-hidden")) return; var text = p.textContent.toLowerCase(); if (text.includes(query)) { p.classList.remove("lhv2-search-hidden"); var body = p.querySelector(".lhv2-panel-body, .lhv2-agent-body"); var content = body && body.querySelector("[data-panel-content]"); var btn = body && body.querySelector("[data-panel-toggle]"); if (content) content.classList.remove("lhv2-collapsed"); if (btn) btn.textContent = "Comprimi"; matches++; } else { p.classList.add("lhv2-search-hidden"); } }); count.textContent = matches + " risultati"; }); }',
      'function lhv2InitScrollSpy(){ if (typeof IntersectionObserver === "undefined") return; var observer = new IntersectionObserver(function(entries){ entries.forEach(function(entry){ if (!entry.isIntersecting) return; var panel = entry.target; var attrNames = panel.getAttributeNames(); var mode = null; var idx = null; attrNames.forEach(function(name){ var match = name.match(/^data-(.+)-panel$/); if (match) { mode = match[1]; idx = panel.getAttribute(name); } }); if (mode === null || idx === null) return; document.querySelectorAll(".lhv2-nav-item").forEach(function(item){ item.classList.remove("lhv2-nav-active"); }); var navItem = document.querySelector(".lhv2-nav-item[data-" + mode + "-nav=\\"" + idx + "\\"]"); if (navItem) navItem.classList.add("lhv2-nav-active"); }); }, { threshold: 0.3 }); document.querySelectorAll(".lhv2-panel, .lhv2-agent-panel").forEach(function(p){ observer.observe(p); }); }',
      'function lhv2Boot(){ lhv2LoadMermaid(); lhv2LoadYouTubeApi(); lhv2InitShellControls(); lhv2InitPlayerControls(); lhv2BindTimestampLinks(); lhv2InitCodeBlocks(); lhv2InitPanels(); lhv2InitAccordion(); lhv2InitProgress(); lhv2InitDocSearch(); lhv2InitScrollSpy(); lhv2InitNotes(); lhv2InitChecklist(); lhv2InitFlashcards(); lhv2InitQuiz(); lhv2InitGlossary(); lhv2SyncTranscript(); lhv2DrawConceptMaps(); window.addEventListener("resize", lhv2DrawConceptMaps); }',
      'document.addEventListener("click", function(event) { const button = event.target.closest("[data-copy-target]"); if (!button) return; const target = document.getElementById(button.getAttribute("data-copy-target")); if (!target) return; const text = target.innerText.trim(); if (!text) return; navigator.clipboard.writeText(text).then(function() { const original = button.textContent; button.textContent = "Copiato"; setTimeout(function() { button.textContent = original; }, 1200); }); });',
      'if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", lhv2Boot); else lhv2Boot();',
      '`}</script>',
      '',
    ].join('\n');
  },

  buildChapterSelectors(mode, count, withAgent = false) {
    const selectors = [];
    for (let index = 0; index < count; index++) {
      selectors.push(`#${mode}-sec-${index}:checked ~ .lhv2-app .lhv2-nav-item[data-${mode}-nav="${index}"] label { background: #e8f1ff; border-color: #9fc0ff; color: #1558b0; }`);
      selectors.push(`#${mode}-sec-${index}:checked ~ .lhv2-app .lhv2-panel[data-${mode}-panel="${index}"] { display: block; }`);
      if (withAgent) selectors.push(`#${mode}-sec-${index}:checked ~ .lhv2-app .lhv2-agent-panel[data-${mode}-panel="${index}"] { display: block; }`);
    }
    return selectors.join(' ');
  },

  buildWorkspaceSelectors(data) {
    return [
      this.buildChapterSelectors('verbatim', data.verbatim.length, false),
      this.buildChapterSelectors('study', data.study.length, true),
      this.buildChapterSelectors('summary', data.summary.length, false),
      this.buildChapterSelectors('assets', data.assets.length, false),
      '#lhv2-mode-verbatim:checked ~ .lhv2-app .lhv2-sidebar-mode, #lhv2-mode-study:checked ~ .lhv2-app .lhv2-sidebar-mode, #lhv2-mode-summary:checked ~ .lhv2-app .lhv2-sidebar-mode, #lhv2-mode-assets:checked ~ .lhv2-app .lhv2-sidebar-mode { display: none; }',
      '#lhv2-mode-verbatim:checked ~ .lhv2-app .lhv2-sidebar-verbatim, #lhv2-mode-study:checked ~ .lhv2-app .lhv2-sidebar-study, #lhv2-mode-summary:checked ~ .lhv2-app .lhv2-sidebar-summary, #lhv2-mode-assets:checked ~ .lhv2-app .lhv2-sidebar-assets { display: block; }',
      '#lhv2-mode-verbatim:checked ~ .lhv2-app .lhv2-main-mode, #lhv2-mode-study:checked ~ .lhv2-app .lhv2-main-mode, #lhv2-mode-summary:checked ~ .lhv2-app .lhv2-main-mode, #lhv2-mode-assets:checked ~ .lhv2-app .lhv2-main-mode { display: none; }',
      '#lhv2-mode-verbatim:checked ~ .lhv2-app .lhv2-main-verbatim, #lhv2-mode-study:checked ~ .lhv2-app .lhv2-main-study, #lhv2-mode-summary:checked ~ .lhv2-app .lhv2-main-summary, #lhv2-mode-assets:checked ~ .lhv2-app .lhv2-main-assets { display: block; }',
      '#lhv2-mode-study:checked ~ .lhv2-app .lhv2-agent-study { display: block; } #lhv2-mode-verbatim:checked ~ .lhv2-app .lhv2-agent-study, #lhv2-mode-summary:checked ~ .lhv2-app .lhv2-agent-study, #lhv2-mode-assets:checked ~ .lhv2-app .lhv2-agent-study { display: none; }',
    ].join(' ');
  },

  buildWorkspaceRadios(mode, items, defaultChecked) {
    return items.map((item, index) =>
      `<input class="lhv2-radio" type="radio" name="${mode}-sections" id="${mode}-sec-${index}"${index === defaultChecked ? ' checked' : ''} />`
    ).join('\n');
  },

  buildSidebar(mode, items) {
    return [
      `<div class="lhv2-sidebar-mode lhv2-sidebar-${mode} hidden">`,
      '<h3>Sezioni</h3>',
      ...items.map((item, index) =>
        `<div class="lhv2-nav-item" data-${mode}-nav="${index}"><label for="${mode}-sec-${index}">${this.escapeHtml(item.title)}</label></div>`
      ),
      '</div>',
    ].join('\n');
  },

  buildPanel(mode, item, index, title, htmlBody, copyTargetId) {
    const transcriptAttrs = mode === 'verbatim'
      ? ` data-transcript-start="${Number(item.startSeconds || 0)}"`
      : '';
    return [
      `<article class="lhv2-panel" data-${mode}-panel="${index}"${transcriptAttrs}>`,
      '<div class="lhv2-panel-body">',
      '<div class="lhv2-panel-head">',
      `<h2>${this.escapeHtml(title)}</h2>`,
      `<div class="lhv2-panel-actions"><button class="lhv2-copy-btn" type="button" data-panel-toggle>Espandi</button>${this.buildCopyButton(copyTargetId)}</div>`,
      '</div>',
      `<div class="lhv2-panel-content lhv2-collapsed" data-panel-content><div id="${copyTargetId}">${htmlBody}</div><div class="lhv2-copy-footer">${this.buildCopyButton(copyTargetId)}</div></div>`,
      '</div>',
      '</article>',
    ].join('\n');
  },

  buildAgentPanel(item, index, videoData) {
    const agentId = `agent-copy-${index}`;
    const projectZero = this.buildInstructionZero(videoData, item.title);
    const htmlBody = this.markdownToHtml(`${projectZero}\n${item.agent || 'Nessuna istruzione specifica disponibile per questa sezione.'}`, { videoId: videoData.videoId || '' });
    return [
      `<article class="lhv2-agent-panel" data-study-panel="${index}">`,
      '<div class="lhv2-agent-body">',
      '<div class="lhv2-panel-head">',
      `<h2>Antigravity · ${this.escapeHtml(item.title)}</h2>`,
      `<div class="lhv2-panel-actions"><button class="lhv2-copy-btn" type="button" data-panel-toggle>Espandi</button>${this.buildCopyButton(agentId, 'Copia Antigravity')}</div>`,
      '</div>',
      `<div class="lhv2-panel-content lhv2-collapsed" data-panel-content><div id="${agentId}">${htmlBody}</div><div class="lhv2-copy-footer">${this.buildCopyButton(agentId, 'Copia Antigravity')}</div></div>`,
      '</div>',
      '</article>',
    ].join('\n');
  },

  buildLearningDocument(videoData, aiSectionsMarkdown, options = {}) {
    const mdxSections = this.resolveMdxSections(options);
    const requestedMode = options.learningMode || videoData.learningMode || 'study';
    const sections = this.splitLearningSections(aiSectionsMarkdown);
    const isModeMarker = block => /^(Studio guidato|Sintesi rapida)$/i.test(this.normalizeSectionTitle(block.rawTitle || block.title || '')) && !(block.body || '').trim();
    const studyChapters = this.extractChapterBlocks(sections.study).filter(block => !isModeMarker(block)).map(block => {
      const split = this.extractAntigravitySection(block.body);
      const isPromptBlock = this.isAntigravityPromptTitle(block.title);
      return {
        ...block,
        isPromptBlock,
        main: mdxSections.antigravityInstructions && !isPromptBlock ? split.main : block.body,
        agent: mdxSections.antigravityInstructions && !isPromptBlock ? split.agent : '',
      };
    }).filter(block => {
      if (!mdxSections.studyGuide) return false;
      if (block.isPromptBlock && !mdxSections.antigravityPrompt) return false;
      return true;
    });
    const summaryChapters = mdxSections.quickSummary
      ? this.extractChapterBlocks(sections.summary).filter(block => !isModeMarker(block))
      : [];
    const transcriptSource = this.resolveTranscriptText(videoData);
    const transcriptChapters = mdxSections.verbatimTranscript ? this.extractTranscriptBlocks(transcriptSource) : [];
    const assetSections = this.splitAssetsSections(sections.assets).filter(item => {
      const key = this.getAssetSectionSettingKey(item.title);
      return key ? Boolean(mdxSections[key]) : true;
    });

    // ── Inietta sezione frame video in assets se il videoId è disponibile ──
    const { framesBlock } = this.buildVideoVisuals(videoData);
    if (framesBlock && videoData.videoId) {
      assetSections.unshift({
        title: '📸 Frame Chiave dal Video',
        body: framesBlock,
      });
    }

    const workspaceData = {
      verbatim: transcriptChapters,
      study: mdxSections.studyGuide
        ? (studyChapters.length ? studyChapters : [{ title: 'Studio guidato', main: sections.study || 'Nessun contenuto studio disponibile.', agent: '' }])
        : [],
      summary: mdxSections.quickSummary
        ? (summaryChapters.length ? summaryChapters : [{ title: 'Sintesi rapida', body: sections.summary || 'Nessuna sintesi disponibile.' }])
        : [],
      assets: assetSections,
    };

    const availableModes = ['verbatim', 'study', 'summary', 'assets'].filter(mode => workspaceData[mode]?.length);
    if (!availableModes.length) {
      workspaceData.assets = [{ title: 'Sezioni disattivate', body: 'Tutte le sezioni del documento sono disattivate nelle Impostazioni.' }];
      availableModes.push('assets');
    }
    const learningMode = availableModes.includes(requestedMode) ? requestedMode : availableModes[0];
    const hasAgentPanels = mdxSections.antigravityInstructions && workspaceData.study.some(item => (item.agent || '').trim());

    const shell = this.buildInteractiveShell(this.buildWorkspaceSelectors(workspaceData), videoData);
    const readingTime = this.estimateReadingTimeMinutes([
      videoData.transcript || '',
      aiSectionsMarkdown || '',
      videoData.description || '',
    ].join('\n'));

    const parts = [
      shell,
      this.buildModeChooser(videoData, learningMode, mdxSections),
      this.buildWorkspaceRadios('verbatim', workspaceData.verbatim, 0),
      this.buildWorkspaceRadios('study', workspaceData.study, 0),
      this.buildWorkspaceRadios('summary', workspaceData.summary, 0),
      this.buildWorkspaceRadios('assets', workspaceData.assets, 0),
      availableModes.includes('verbatim') ? `<input class="lhv2-radio" type="radio" name="lhv2-mode" id="lhv2-mode-verbatim"${this.getTabChecked('verbatim', learningMode)} />` : '',
      availableModes.includes('study') ? `<input class="lhv2-radio" type="radio" name="lhv2-mode" id="lhv2-mode-study"${this.getTabChecked('study', learningMode)} />` : '',
      availableModes.includes('summary') ? `<input class="lhv2-radio" type="radio" name="lhv2-mode" id="lhv2-mode-summary"${this.getTabChecked('summary', learningMode)} />` : '',
      availableModes.includes('assets') ? `<input class="lhv2-radio" type="radio" name="lhv2-mode" id="lhv2-mode-assets"${this.getTabChecked('assets', learningMode)} />` : '',
      '<div class="lhv2-app" data-left-open="true" data-right-open="true" data-theme="aurora">',
      '<div class="lhv2-toolbar">',
      '<div class="lhv2-mode-tabs">',
      availableModes.includes('verbatim') ? '<label class="lhv2-chip" for="lhv2-mode-verbatim">Integrale</label>' : '',
      availableModes.includes('study') ? '<label class="lhv2-chip" for="lhv2-mode-study">Studio</label>' : '',
      availableModes.includes('summary') ? '<label class="lhv2-chip" for="lhv2-mode-summary">Sintesi</label>' : '',
      availableModes.includes('assets') ? '<label class="lhv2-chip" for="lhv2-mode-assets">Asset</label>' : '',
      mdxSections.personalNotes ? '<button class="lhv2-chip" type="button" data-lhv2-notes-toggle>Appunti</button>' : '',
      '</div>',
      `<div class="lhv2-toolbar-right"><div class="lhv2-meta"><span class="lhv2-kicker">📖 ${readingTime} min</span><span class="lhv2-kicker">🎬 ${this.escapeHtml(videoData.channelName || 'Canale')}</span><span class="lhv2-kicker">🧠 ${this.escapeHtml(this.getLearningModeLabel(learningMode))}</span></div><select class="lhv2-theme-select" data-theme-select><option value="aurora">Aurora</option><option value="sunset">Sunset</option><option value="forest">Forest</option><option value="graphite">Graphite</option></select></div>`,
      '</div>',
      this.buildVideoStage(videoData),
      '<div class="lhv2-frame-wrap">',
      '<button class="lhv2-side-toggle" type="button" data-side-toggle data-side="left" data-state="active">◀</button>',
      '<button class="lhv2-side-toggle" type="button" data-side-toggle data-side="right" data-state="active">▶</button>',
      '<div class="lhv2-frame">',
      '<aside class="lhv2-sidebar">',
      availableModes.includes('verbatim') ? this.buildSidebar('verbatim', workspaceData.verbatim) : '',
      availableModes.includes('study') ? this.buildSidebar('study', workspaceData.study) : '',
      availableModes.includes('summary') ? this.buildSidebar('summary', workspaceData.summary) : '',
      availableModes.includes('assets') ? this.buildSidebar('assets', workspaceData.assets) : '',
      '</aside>',
      '<main class="lhv2-main">',
      availableModes.includes('verbatim') ? `<div class="lhv2-main-mode lhv2-main-verbatim hidden">${workspaceData.verbatim.map((item, index) => this.buildPanel('verbatim', item, index, item.title, this.renderTranscriptSection(item, videoData), `verbatim-copy-${index}`)).join('\n')}</div>` : '',
      availableModes.includes('study') ? `<div class="lhv2-main-mode lhv2-main-study hidden">${workspaceData.study.map((item, index) => this.buildPanel('study', item, index, item.title, this.markdownToHtml(item.main || item.body || '', { videoId: videoData.videoId || '' }), `study-copy-${index}`)).join('\n')}</div>` : '',
      availableModes.includes('summary') ? `<div class="lhv2-main-mode lhv2-main-summary hidden">${workspaceData.summary.map((item, index) => this.buildPanel('summary', item, index, item.title, this.markdownToHtml(item.body, { videoId: videoData.videoId || '' }), `summary-copy-${index}`)).join('\n')}</div>` : '',
      availableModes.includes('assets') ? `<div class="lhv2-main-mode lhv2-main-assets hidden">${workspaceData.assets.map((item, index) => this.buildPanel('assets', item, index, item.title, this.renderAssetSection(item, videoData), `assets-copy-${index}`)).join('\n')}</div>` : '',
      '</main>',
      hasAgentPanels ? '<aside class="lhv2-agent">' : '',
      hasAgentPanels ? '<div class="lhv2-agent-study hidden">' : '',
      hasAgentPanels ? '<h3>Antigravity</h3>' : '',
      hasAgentPanels ? workspaceData.study.map((item, index) => this.buildAgentPanel(item, index, videoData)).join('\n') : '',
      hasAgentPanels ? '</div>' : '',
      hasAgentPanels ? '</aside>' : '',
      '</div>',
      '</div>',
      mdxSections.personalNotes ? `<section class="lhv2-notes lhv2-hidden" data-lhv2-notes><div class="lhv2-notes-head"><div><h3>Appunti personali</h3><small>Salvati localmente nel browser per questo documento.</small></div><div class="lhv2-capabilities">${this.getFeatureFlags(mdxSections).slice(0, 6).map(feature => `<span class="lhv2-badge">${this.escapeHtml(feature)}</span>`).join('')}</div></div><textarea rows="8" placeholder="Scrivi dubbi, comandi da riprovare, varianti, TODO...">Obiettivo studio:
- 

Domande aperte:
- 

Snippet da riprovare:
- 

Azioni successive:
- </textarea></section>` : '',
      '</div>',
    ];
    return parts.filter(Boolean).join('\n\n');
  },

  /**
   * Scarica il file MD usando l'API downloads di Chrome.
   */
  downloadMarkdown(markdown, filename) {
    const blob = new Blob([markdown], { type: 'application/octet-stream;charset=utf-8' });
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
