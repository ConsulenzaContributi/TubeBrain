// utils/notion.js — Builder payload pagina Notion (puro)
(function (root) {
  function chunk(text, size) {
    const out = [];
    const s = String(text || '');
    for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
    return out.length ? out : [''];
  }
  function buildPagePayload(summary = {}, databaseId = '') {
    const body = summary.fullMarkdown || summary.markdown || '';
    const children = chunk(body, 2000).map(part => ({
      object: 'block', type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: part } }] },
    }));
    return {
      parent: { database_id: databaseId },
      properties: { Name: { title: [{ text: { content: String(summary.title || 'TubeBrain').slice(0, 200) } }] } },
      children,
    };
  }
  const api = { buildPagePayload };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.NotionExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
