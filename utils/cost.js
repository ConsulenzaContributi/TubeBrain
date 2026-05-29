// utils/cost.js — Stima token/costo e raccomandazione modello
(function (root) {
  // USD per 1M token (input), valori indicativi configurabili
  const MODEL_PRICING = {
    'gemini-2.5-flash-lite': 0.10,
    'gemini-2.5-flash': 0.30,
    'gemini-3.0-flash': 0.30,
    'gemini-3.5-flash': 0.35,
    'gemini-2.5-pro': 1.25,
    'gemini-3.1-pro': 1.50,
    'gpt-5.4-mini': 0.40,
    'gpt-5.4': 3.00,
  };

  function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(String(text).length / 4);
  }

  function estimateCostUsd(tokens, model) {
    const price = MODEL_PRICING[model];
    if (!price || !tokens) return 0;
    return (tokens / 1000000) * price;
  }

  function recommendModel(tokens) {
    // Contesti molto lunghi → modello "pro"; altrimenti "flash" (rapido/economico)
    return tokens > 200000 ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
  }

  const api = { MODEL_PRICING, estimateTokens, estimateCostUsd, recommendModel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CostUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
