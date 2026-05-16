// utils/ai-provider.js — Facciata unica per Gemini/OpenAI

const AIProvider = {
  getProvider(settings = {}) {
    return settings.provider === 'openai' ? 'openai' : 'gemini';
  },

  getProviderLabel(settings = {}) {
    return this.getProvider(settings) === 'openai' ? 'OpenAI' : 'Gemini';
  },

  getConfiguredModel(settings = {}) {
    return this.getProvider(settings) === 'openai'
      ? OpenAIAPI.resolveModel(settings)
      : (settings.model || GeminiAPI.DEFAULT_MODEL);
  },

  getRequestedModel(settings = {}) {
    return this.getProvider(settings) === 'openai'
      ? OpenAIAPI.getRequestedModel(settings)
      : (settings.model || GeminiAPI.DEFAULT_MODEL);
  },

  hasApiKey(settings = {}) {
    return this.getProvider(settings) === 'openai'
      ? Boolean(settings.openaiApiKey)
      : Boolean(settings.geminiApiKey);
  },

  requireApiKey(settings = {}) {
    if (this.hasApiKey(settings)) return;
    throw new Error(`API key ${this.getProviderLabel(settings)} non configurata. Vai nelle Impostazioni.`);
  },

  async generateLearningSections(videoData, settings) {
    return this.getProvider(settings) === 'openai'
      ? OpenAIAPI.generateLearningSections(videoData, settings)
      : GeminiAPI.generateLearningSections(videoData, settings);
  },

  async extractTags(title, description, settings) {
    return this.getProvider(settings) === 'openai'
      ? OpenAIAPI.extractTags(title, description, settings)
      : GeminiAPI.extractTags(title, description, settings.geminiApiKey, settings.model);
  },

  async generateArticleSummary(articleData, settings) {
    return this.getProvider(settings) === 'openai'
      ? OpenAIAPI.generateArticleSummary(articleData, settings)
      : GeminiAPI.generateArticleSummary(articleData, settings);
  },

  async generateInstagramSummary(igData, settings) {
    return this.getProvider(settings) === 'openai'
      ? OpenAIAPI.generateInstagramSummary(igData, settings)
      : GeminiAPI.generateInstagramSummary(igData, settings);
  },

  async chatWithArchive(question, summaries, settings) {
    return this.getProvider(settings) === 'openai'
      ? OpenAIAPI.chatWithArchive(question, summaries, settings)
      : GeminiAPI.chatWithArchive(question, summaries, settings);
  },

  async semanticRank(query, summaries, settings) {
    return this.getProvider(settings) === 'openai'
      ? OpenAIAPI.semanticRank(query, summaries, settings)
      : GeminiAPI.semanticRank(query, summaries, settings.geminiApiKey, settings.model);
  },

  async checkTopicMatch(videoTitle, videoDescription, topics, settings) {
    return this.getProvider(settings) === 'openai'
      ? OpenAIAPI.checkTopicMatch(videoTitle, videoDescription, topics, settings)
      : GeminiAPI.checkTopicMatch(videoTitle, videoDescription, topics, settings.geminiApiKey, settings.model);
  },
};

if (typeof module !== 'undefined') module.exports = AIProvider;
