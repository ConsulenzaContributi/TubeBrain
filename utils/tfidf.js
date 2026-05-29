// utils/tfidf.js — Ricerca TF-IDF + coseno (pure, locale)
(function (root) {
  function tokenize(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/).filter(t => t.length > 2);
  }

  function termFreq(tokens) {
    const tf = {};
    tokens.forEach(t => { tf[t] = (tf[t] || 0) + 1; });
    return tf;
  }

  function buildIndex(docs = []) {
    const df = {};
    const prepared = docs.map(d => {
      const tokens = tokenize(d.text);
      const tf = termFreq(tokens);
      Object.keys(tf).forEach(term => { df[term] = (df[term] || 0) + 1; });
      return { id: d.id, tf, len: tokens.length };
    });
    const N = prepared.length || 1;
    const idf = {};
    Object.keys(df).forEach(term => { idf[term] = Math.log(1 + N / df[term]); });
    // vettori tf-idf normalizzati
    const vectors = prepared.map(p => {
      const vec = {};
      let norm = 0;
      Object.keys(p.tf).forEach(term => {
        const w = (p.tf[term] / (p.len || 1)) * (idf[term] || 0);
        vec[term] = w; norm += w * w;
      });
      norm = Math.sqrt(norm) || 1;
      Object.keys(vec).forEach(term => { vec[term] /= norm; });
      return { id: p.id, vec };
    });
    return { idf, vectors, N };
  }

  function search(query, index, topK = 10) {
    const tokens = tokenize(query);
    const tf = termFreq(tokens);
    const len = tokens.length || 1;
    const qvec = {};
    let norm = 0;
    Object.keys(tf).forEach(term => {
      const w = (tf[term] / len) * ((index.idf && index.idf[term]) || 0);
      qvec[term] = w; norm += w * w;
    });
    norm = Math.sqrt(norm) || 1;
    Object.keys(qvec).forEach(term => { qvec[term] /= norm; });

    const scored = (index.vectors || []).map(d => {
      let score = 0;
      Object.keys(qvec).forEach(term => { if (d.vec[term]) score += qvec[term] * d.vec[term]; });
      return { id: d.id, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  const api = { tokenize, buildIndex, search };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TfIdf = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
