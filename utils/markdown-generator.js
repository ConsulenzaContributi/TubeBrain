// utils/markdown-generator.js — Post-processing e download del file MDX

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
workspace_views:
  - verbatim
  - study
  - summary
  - assets
workspace_behavior: "all_views_always_generated"
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

  buildModeChooser(videoData, learningMode = 'study') {
    return [
      '# ' + (videoData.title || 'Video Tutorial'),
      '',
      `> **Canale:** ${videoData.channelName || 'N/D'} | **Durata:** ${videoData.duration || 0} sec | **Formato:** MDX v2`,
      `> **Video:** [Guarda su YouTube](https://youtube.com/watch?v=${videoData.videoId || ''})`,
      `> **Vista predefinita all'apertura:** ${this.getLearningModeLabel(learningMode)}`,
      '> **Regola workspace:** tutte le viste vengono sempre generate nello stesso file MDX e restano selezionabili durante l\'uso.',
      '',
      '## Workspace Interattivo',
      '',
      '- Il plugin non genera file alternativi per modalita diverse: genera un solo workspace MDX completo',
      '- Colonna sinistra: navigazione delle sezioni',
      '- Colonna centrale: contenuto della sola sezione selezionata',
      '- Colonna destra: istruzioni operative per Antigravity relative alla sezione corrente',
      '- I pulsanti `Copia sezione` e `Copia Antigravity` sono disponibili sia in testa sia in coda ai pannelli',
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
      return {
        index,
        rawTitle,
        title: this.normalizeSectionTitle(rawTitle, `Trascrizione ${index + 1}`),
        body: lines.join('\n').trim(),
      };
    });
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

  renderCodeBlock(code = '', lang = 'text') {
    return `<pre class="lhv2-code" data-lang="${this.escapeHtml(lang || 'text')}">{${this.jsxStringLiteral(code)}}</pre>`;
  },

  renderInlineCode(code = '') {
    return `<code>{${this.jsxStringLiteral(code)}}</code>`;
  },

  markdownToHtml(markdown = '') {
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
      html += `<p>${this.inlineMarkdown(paragraph.join(' '))}</p>`;
      paragraph = [];
    };

    const closeList = () => {
      if (inList) html += `</${listType}>`;
      inList = false;
      listType = '';
    };

    const flushCode = () => {
      if (!inCode) return;
      html += this.renderCodeBlock(codeLines.join('\n'), codeLang || 'text');
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
        html += `<h4>${this.inlineMarkdown(line.replace(/^####\s+/, '').trim())}</h4>`;
        continue;
      }
      if (/^###\s+/.test(line)) {
        flushParagraph();
        closeList();
        html += `<h3>${this.inlineMarkdown(line.replace(/^###\s+/, '').trim())}</h3>`;
        continue;
      }
      if (/^##\s+/.test(line)) {
        flushParagraph();
        closeList();
        html += `<h2>${this.inlineMarkdown(line.replace(/^##\s+/, '').trim())}</h2>`;
        continue;
      }
      if (/^>\s*/.test(line)) {
        flushParagraph();
        closeList();
        html += `<blockquote>${this.inlineMarkdown(line.replace(/^>\s*/, '').trim())}</blockquote>`;
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
        html += `<li>${this.inlineMarkdown(item)}</li>`;
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
        html += `<li>${this.inlineMarkdown(item)}</li>`;
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

  inlineMarkdown(text = '') {
    return this.escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, (_, code) => this.renderInlineCode(code))
      .replace(/\[(\d{2}:\d{2}:\d{2})\]/g, '<span class="lhv2-ts">[$1]</span>');
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

  buildInteractiveShell(selectors) {
    return [
      '<style>{`',
      '.lhv2-app { border: 1px solid #dbe4f0; border-radius: 20px; background: linear-gradient(180deg, #ffffff 0%, #f7fbff 100%); box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08); overflow: hidden; }',
      '.lhv2-hidden { display: none; }',
      '.lhv2-toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid #e3ebf5; background: #ffffff; }',
      '.lhv2-mode-tabs, .lhv2-toggle-group { display: flex; flex-wrap: wrap; gap: 8px; }',
      '.lhv2-radio, .lhv2-toggle { display: none; }',
      '.lhv2-chip, .lhv2-toggle-label { display: inline-flex; align-items: center; justify-content: center; padding: 8px 12px; border-radius: 999px; border: 1px solid #d7e3f4; background: #f8fbff; color: #31507f; font-weight: 700; cursor: pointer; }',
      '.lhv2-frame { display: grid; grid-template-columns: 260px minmax(0, 1fr) 320px; min-height: 640px; }',
      '.lhv2-sidebar { border-right: 1px solid #e3ebf5; padding: 14px; background: #fbfdff; overflow: auto; }',
      '.lhv2-main { padding: 18px; overflow: auto; }',
      '.lhv2-agent { border-left: 1px solid #e3ebf5; padding: 18px; background: #f8fbff; overflow: auto; }',
      '.lhv2-sidebar h3, .lhv2-agent h3 { margin: 0 0 12px; font-size: 0.95rem; color: #17324d; }',
      '.lhv2-nav-item { display: block; width: 100%; text-align: left; margin-bottom: 8px; }',
      '.lhv2-nav-item label { display: block; cursor: pointer; padding: 10px 12px; border-radius: 12px; border: 1px solid #dbe4f0; background: #ffffff; font-weight: 600; color: #274a6d; }',
      '.lhv2-panel, .lhv2-agent-panel { display: none; }',
      '.lhv2-panel-body, .lhv2-agent-body { border: 1px solid #e3ebf5; border-radius: 16px; background: #ffffff; padding: 16px; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.04); }',
      '.lhv2-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px; }',
      '.lhv2-panel-head h2 { margin: 0; font-size: 1.1rem; color: #102a43; }',
      '.lhv2-copy-btn { border: 1px solid #d7e3f4; background: #f8fbff; color: #1f4f82; border-radius: 10px; padding: 7px 10px; cursor: pointer; font-weight: 700; }',
      '.lhv2-copy-footer { display: flex; justify-content: flex-end; margin-top: 16px; }',
      '.lhv2-ts { display: inline-block; border-radius: 6px; background: #e8f1ff; color: #1d4ed8; padding: 0 5px; font-weight: 700; }',
      '.lhv2-code { background: #0f172a; color: #e5eef9; padding: 14px; border-radius: 14px; overflow: auto; white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace; }',
      '.lhv2-panel-body h2, .lhv2-panel-body h3, .lhv2-panel-body h4, .lhv2-agent-body h2, .lhv2-agent-body h3, .lhv2-agent-body h4 { margin: 14px 0 8px; color: #17324d; }',
      '.lhv2-panel-body p, .lhv2-agent-body p, .lhv2-panel-body li, .lhv2-agent-body li { line-height: 1.7; }',
      '.lhv2-panel-body blockquote, .lhv2-agent-body blockquote { border-left: 3px solid #b7d0ff; margin: 10px 0; padding-left: 12px; color: #31507f; }',
      '#lhv2-left-off:checked ~ .lhv2-app .lhv2-frame { grid-template-columns: 0 minmax(0, 1fr) 320px; }',
      '#lhv2-left-off:checked ~ .lhv2-app .lhv2-sidebar { display: none; }',
      '#lhv2-right-off:checked ~ .lhv2-app .lhv2-frame { grid-template-columns: 260px minmax(0, 1fr) 0; }',
      '#lhv2-right-off:checked ~ .lhv2-app .lhv2-agent { display: none; }',
      '#lhv2-mode-verbatim:checked ~ .lhv2-app label[for="lhv2-mode-verbatim"], #lhv2-mode-study:checked ~ .lhv2-app label[for="lhv2-mode-study"], #lhv2-mode-summary:checked ~ .lhv2-app label[for="lhv2-mode-summary"], #lhv2-mode-assets:checked ~ .lhv2-app label[for="lhv2-mode-assets"], #lhv2-left-on:checked ~ .lhv2-app label[for="lhv2-left-on"], #lhv2-left-off:checked ~ .lhv2-app label[for="lhv2-left-off"], #lhv2-right-on:checked ~ .lhv2-app label[for="lhv2-right-on"], #lhv2-right-off:checked ~ .lhv2-app label[for="lhv2-right-off"] { background: #1558b0; color: #ffffff; border-color: #1558b0; }',
      selectors,
      '@media (max-width: 1180px) { .lhv2-frame { grid-template-columns: 1fr; } .lhv2-sidebar, .lhv2-agent { display: none; } }',
      '`}</style>',
      '<script>{`',
      'document.addEventListener("click", function(event) {',
      '  const button = event.target.closest("[data-copy-target]");',
      '  if (!button) return;',
      '  const target = document.getElementById(button.getAttribute("data-copy-target"));',
      '  if (!target) return;',
      '  const text = target.innerText.trim();',
      '  if (!text) return;',
      '  navigator.clipboard.writeText(text).then(function() {',
      '    const original = button.textContent;',
      '    button.textContent = "Copiato";',
      '    setTimeout(function() { button.textContent = original; }, 1200);',
      '  });',
      '});',
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
    return [
      `<article class="lhv2-panel" data-${mode}-panel="${index}">`,
      '<div class="lhv2-panel-body">',
      '<div class="lhv2-panel-head">',
      `<h2>${this.escapeHtml(title)}</h2>`,
      this.buildCopyButton(copyTargetId),
      '</div>',
      `<div id="${copyTargetId}">${htmlBody}</div>`,
      `<div class="lhv2-copy-footer">${this.buildCopyButton(copyTargetId)}</div>`,
      '</div>',
      '</article>',
    ].join('\n');
  },

  buildAgentPanel(item, index, videoData) {
    const agentId = `agent-copy-${index}`;
    const projectZero = this.buildInstructionZero(videoData, item.title);
    const htmlBody = this.markdownToHtml(`${projectZero}\n${item.agent || 'Nessuna istruzione specifica disponibile per questa sezione.'}`);
    return [
      `<article class="lhv2-agent-panel" data-study-panel="${index}">`,
      '<div class="lhv2-agent-body">',
      '<div class="lhv2-panel-head">',
      `<h2>Antigravity · ${this.escapeHtml(item.title)}</h2>`,
      this.buildCopyButton(agentId, 'Copia Antigravity'),
      '</div>',
      `<div id="${agentId}">${htmlBody}</div>`,
      `<div class="lhv2-copy-footer">${this.buildCopyButton(agentId, 'Copia Antigravity')}</div>`,
      '</div>',
      '</article>',
    ].join('\n');
  },

  buildLearningDocument(videoData, aiSectionsMarkdown, options = {}) {
    const learningMode = options.learningMode || videoData.learningMode || 'study';
    const sections = this.splitLearningSections(aiSectionsMarkdown);
    const studyChapters = this.extractChapterBlocks(sections.study).map(block => {
      const split = this.extractAntigravitySection(block.body);
      return { ...block, main: split.main, agent: split.agent };
    });
    const summaryChapters = this.extractChapterBlocks(sections.summary);
    const transcriptChapters = this.extractTranscriptBlocks(videoData.transcript);
    const assetSections = this.splitAssetsSections(sections.assets);
    const modeDefaultIndex = { verbatim: 0, study: 0, summary: 0, assets: 0 };

    const workspaceData = {
      verbatim: transcriptChapters,
      study: studyChapters.length ? studyChapters : [{ title: 'Studio guidato', main: sections.study || 'Nessun contenuto studio disponibile.', agent: '' }],
      summary: summaryChapters.length ? summaryChapters : [{ title: 'Sintesi rapida', body: sections.summary || 'Nessuna sintesi disponibile.' }],
      assets: assetSections.length ? assetSections : [{ title: 'Asset didattici avanzati', body: sections.assets || 'Nessun asset disponibile.' }],
    };

    const shell = this.buildInteractiveShell(this.buildWorkspaceSelectors(workspaceData));

    const parts = [
      shell,
      this.buildModeChooser(videoData, learningMode),
      this.buildWorkspaceRadios('verbatim', workspaceData.verbatim, 0),
      this.buildWorkspaceRadios('study', workspaceData.study, 0),
      this.buildWorkspaceRadios('summary', workspaceData.summary, 0),
      this.buildWorkspaceRadios('assets', workspaceData.assets, 0),
      '<input class="lhv2-toggle" type="radio" name="lhv2-left-toggle" id="lhv2-left-on" checked />',
      '<input class="lhv2-toggle" type="radio" name="lhv2-left-toggle" id="lhv2-left-off" />',
      '<input class="lhv2-toggle" type="radio" name="lhv2-right-toggle" id="lhv2-right-on" checked />',
      '<input class="lhv2-toggle" type="radio" name="lhv2-right-toggle" id="lhv2-right-off" />',
      `<input class="lhv2-radio" type="radio" name="lhv2-mode" id="lhv2-mode-verbatim"${this.getTabChecked('verbatim', learningMode)} />`,
      `<input class="lhv2-radio" type="radio" name="lhv2-mode" id="lhv2-mode-study"${this.getTabChecked('study', learningMode)} />`,
      `<input class="lhv2-radio" type="radio" name="lhv2-mode" id="lhv2-mode-summary"${this.getTabChecked('summary', learningMode)} />`,
      `<input class="lhv2-radio" type="radio" name="lhv2-mode" id="lhv2-mode-assets"${this.getTabChecked('assets', learningMode === 'verbatim' || learningMode === 'study' || learningMode === 'summary' ? 'study' : learningMode)} />`,
      '<div class="lhv2-app">',
      '<div class="lhv2-toolbar">',
      '<div class="lhv2-mode-tabs">',
      '<label class="lhv2-chip" for="lhv2-mode-verbatim">Integrale</label>',
      '<label class="lhv2-chip" for="lhv2-mode-study">Studio</label>',
      '<label class="lhv2-chip" for="lhv2-mode-summary">Sintesi</label>',
      '<label class="lhv2-chip" for="lhv2-mode-assets">Asset</label>',
      '</div>',
      '<div class="lhv2-toggle-group">',
      '<label class="lhv2-toggle-label" for="lhv2-left-on">SX on</label>',
      '<label class="lhv2-toggle-label" for="lhv2-left-off">SX off</label>',
      '<label class="lhv2-toggle-label" for="lhv2-right-on">DX on</label>',
      '<label class="lhv2-toggle-label" for="lhv2-right-off">DX off</label>',
      '</div>',
      '</div>',
      '<div class="lhv2-frame">',
      '<aside class="lhv2-sidebar">',
      this.buildSidebar('verbatim', workspaceData.verbatim),
      this.buildSidebar('study', workspaceData.study),
      this.buildSidebar('summary', workspaceData.summary),
      this.buildSidebar('assets', workspaceData.assets),
      '</aside>',
      '<main class="lhv2-main">',
      `<div class="lhv2-main-mode lhv2-main-verbatim hidden">${workspaceData.verbatim.map((item, index) => this.buildPanel('verbatim', item, index, item.title, this.markdownToHtml(item.body), `verbatim-copy-${index}`)).join('\n')}</div>`,
      `<div class="lhv2-main-mode lhv2-main-study hidden">${workspaceData.study.map((item, index) => this.buildPanel('study', item, index, item.title, this.markdownToHtml(item.main || item.body || ''), `study-copy-${index}`)).join('\n')}</div>`,
      `<div class="lhv2-main-mode lhv2-main-summary hidden">${workspaceData.summary.map((item, index) => this.buildPanel('summary', item, index, item.title, this.markdownToHtml(item.body), `summary-copy-${index}`)).join('\n')}</div>`,
      `<div class="lhv2-main-mode lhv2-main-assets hidden">${workspaceData.assets.map((item, index) => this.buildPanel('assets', item, index, item.title, this.markdownToHtml(item.body), `assets-copy-${index}`)).join('\n')}</div>`,
      '</main>',
      '<aside class="lhv2-agent">',
      '<div class="lhv2-agent-study hidden">',
      '<h3>Antigravity</h3>',
      workspaceData.study.map((item, index) => this.buildAgentPanel(item, index, videoData)).join('\n'),
      '</div>',
      '</aside>',
      '</div>',
      '</div>',
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
