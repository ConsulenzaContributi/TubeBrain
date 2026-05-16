// utils/openai.js — Chiamate OpenAI Responses API per GPT-5 family

const OpenAIAPI = {
  RESPONSES_URL: 'https://api.openai.com/v1/responses',
  DEFAULT_MODEL: 'gpt-5.4-mini',

  resolveModel(settings = {}) {
    return this.getRequestedModel(settings);
  },

  getRequestedModel(settings = {}) {
    return typeof settings.openaiModel === 'string' && settings.openaiModel.trim()
      ? settings.openaiModel.trim()
      : this.DEFAULT_MODEL;
  },

  async call(prompt, apiKey, options = {}) {
    if (!apiKey) throw new Error('API key OpenAI mancante. Configurala nelle Impostazioni.');

    const model = options.model || this.DEFAULT_MODEL;
    const body = {
      model,
      input: prompt,
      reasoning: { effort: options.reasoningEffort || 'medium' },
      max_output_tokens: options.maxOutputTokens ?? 8192,
    };

    const res = await fetch(this.RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      throw new Error(`OpenAI API error: ${msg}`);
    }

    const text = this.extractText(data);
    if (!text) throw new Error('Risposta OpenAI vuota.');
    return text;
  },

  extractText(data = {}) {
    if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;
    if (Array.isArray(data.output)) {
      const chunks = [];
      for (const item of data.output) {
        for (const content of item?.content || []) {
          if (typeof content?.text === 'string') chunks.push(content.text);
        }
      }
      if (chunks.length) return chunks.join('\n').trim();
    }
    return '';
  },

  async generateLearningSections(videoData, settings) {
    const prompt = GeminiAPI.buildLearningSectionsPrompt(videoData, settings.language);
    return await this.call(prompt, settings.openaiApiKey, {
      model: this.resolveModel(settings),
      maxOutputTokens: 16384,
      reasoningEffort: 'medium',
    });
  },

  async generateArticleSummary(articleData, settings) {
    const MAX_CHARS = 200000;
    let text = articleData.text || '';
    if (text.length > MAX_CHARS) text = `${text.slice(0, MAX_CHARS)}\n\n[... contenuto troncato per lunghezza ...]`;
    const prompt = GeminiAPI.buildArticlePrompt({ ...articleData, text }, settings.language);
    return await this.call(prompt, settings.openaiApiKey, {
      model: this.resolveModel(settings),
      maxOutputTokens: 4096,
      reasoningEffort: 'medium',
    });
  },

  async generateInstagramSummary(igData, settings) {
    const MAX_CHARS = 30000;
    let text = igData.text || igData.caption || '';
    if (text.length > MAX_CHARS) text = `${text.slice(0, MAX_CHARS)}\n\n[... contenuto troncato ...]`;
    const prompt = GeminiAPI.buildInstagramPrompt({ ...igData, text }, settings.language);
    return await this.call(prompt, settings.openaiApiKey, {
      model: this.resolveModel(settings),
      maxOutputTokens: 4096,
      reasoningEffort: 'medium',
    });
  },

  async extractTags(title, description, settings) {
    const prompt = `Estrai 5-8 tag tematici rilevanti per questo contenuto.\nTitolo: "${title}"\nDescrizione: "${(description || '').slice(0, 300)}"\nRispondi SOLO con i tag separati da virgola, senza #, minuscolo.`;
    try {
      const result = await this.call(prompt, settings.openaiApiKey, {
        model: this.resolveModel(settings),
        maxOutputTokens: 120,
        reasoningEffort: 'low',
      });
      return result.split(',').map(t => t.trim().replace(/[^a-z0-9À-ÿ\s-]/gi, '')).filter(Boolean);
    } catch {
      return [];
    }
  },

  async chatWithArchive(question, summaries, settings) {
    if (!settings.openaiApiKey) throw new Error('API key OpenAI mancante. Configurala nelle Impostazioni.');
    if (!summaries?.length) throw new Error('Archivio vuoto: non ci sono riepiloghi salvati.');

    const qWords = question.toLowerCase().replace(/[^\wàáèéìíòóùú\s]/gi, ' ').split(/\s+/).filter(w => w.length > 2);
    const scored = summaries.map(s => {
      const haystack = [s.title || '', s.channelName || '', (s.tags || []).join(' '), (s.markdown || '').slice(0, 600)].join(' ').toLowerCase();
      const score = qWords.reduce((acc, w) => acc + (((s.title || '').toLowerCase().includes(w) ? 3 : 0) + ((s.tags || []).some(t => t.toLowerCase().includes(w)) ? 2 : 0) + (haystack.includes(w) ? 1 : 0)), 0);
      return { ...s, score };
    }).sort((a, b) => b.score - a.score);

    const selected = scored.slice(0, scored[0]?.score > 0 ? 25 : 20);
    const contextBlocks = [];
    let totalChars = 0;
    for (const s of selected) {
      const md = (s.markdown || '').slice(0, 3500);
      const block = `### [${s.title}] (${s.channelName || 'Sconosciuto'})\n${md}`;
      if (totalChars + block.length > 380000) break;
      contextBlocks.push({ id: s.id, title: s.title, channelName: s.channelName, block });
      totalChars += block.length;
    }

    const langNote = settings.language === 'en' ? 'Answer in English.' : 'Rispondi sempre in italiano, indipendentemente dalla lingua dei documenti.';
    const contextText = contextBlocks.map(c => c.block).join('\n\n---\n\n');
    const prompt = `Sei un assistente esperto che risponde a domande basandosi ESCLUSIVAMENTE sui documenti dell'archivio forniti qui sotto. ${langNote}

REGOLE:
1. Rispondi SOLO usando le informazioni presenti nei documenti. Non inventare nulla.
2. Cita le fonti usando il formato [Titolo del documento] dopo ogni affermazione chiave.
3. Se l'informazione non è nei documenti, dillo esplicitamente.
4. Sii preciso, dettagliato e utile.

DOMANDA:
${question}

DOCUMENTI:
${contextText}

RISPOSTA:`;

    const answer = await this.call(prompt, settings.openaiApiKey, {
      model: this.resolveModel(settings),
      maxOutputTokens: 4096,
      reasoningEffort: 'medium',
    });

    const citedSources = contextBlocks.filter(c => answer.includes(c.title) || answer.includes(`[${c.title}]`));
    const sources = citedSources.length
      ? citedSources.map(c => ({ id: c.id, title: c.title, channelName: c.channelName }))
      : contextBlocks.slice(0, 3).map(c => ({ id: c.id, title: c.title, channelName: c.channelName }));
    return { answer, sources };
  },

  async semanticRank(query, summaries, settings) {
    if (!settings.openaiApiKey || !summaries?.length) return summaries.map(s => s.id);
    const list = summaries.slice(0, 60).map((s, i) => {
      const tags = (s.tags || []).slice(0, 5).join(', ');
      return `${i}|${s.id}|${s.title} (${s.channelName || '?'})${tags ? ' — tag: ' + tags : ''}`;
    }).join('\n');

    const prompt = `Sei un motore di ricerca semantica. Data la query dell'utente, seleziona e ordina i documenti più rilevanti dall'elenco sottostante.

QUERY: "${query}"

DOCUMENTI:
${list}

Restituisci SOLO un array JSON con gli ID più rilevanti, massimo 20 risultati.`;

    try {
      const raw = await this.call(prompt, settings.openaiApiKey, {
        model: this.resolveModel(settings),
        maxOutputTokens: 400,
        reasoningEffort: 'low',
      });
      const match = raw.match(/\[[\s\S]*?\]/);
      if (!match) return summaries.map(s => s.id);
      const ids = JSON.parse(match[0]);
      const validIds = new Set(summaries.map(s => s.id));
      return Array.isArray(ids) ? ids.filter(id => validIds.has(id)) : summaries.map(s => s.id);
    } catch {
      return summaries.map(s => s.id);
    }
  },

  async checkTopicMatch(videoTitle, videoDescription, topics, settings) {
    if (!topics?.length || !settings.openaiApiKey) return false;
    const prompt = `Valuta se questo video è rilevante per almeno uno degli argomenti di interesse.\n\nVideo:\nTitolo: "${videoTitle}"\nDescrizione: "${(videoDescription || '').slice(0, 400)}"\n\nArgomenti di interesse: ${topics.join(', ')}\n\nRispondi ESCLUSIVAMENTE con YES o NO.`;
    try {
      const r = await this.call(prompt, settings.openaiApiKey, {
        model: this.resolveModel(settings),
        maxOutputTokens: 10,
        reasoningEffort: 'low',
      });
      return r.trim().toUpperCase().startsWith('Y');
    } catch {
      return false;
    }
  },
};

if (typeof module !== 'undefined') module.exports = OpenAIAPI;
