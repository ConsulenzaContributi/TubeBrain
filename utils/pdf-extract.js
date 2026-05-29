// utils/pdf-extract.js — Estrazione testo da PDF (pdf.js) + helper puri
(function (root) {
  function joinPdfPages(pages = []) {
    return (pages || []).map(p => String(p || '').trim()).filter(Boolean).join('\n\n');
  }

  // Browser-only: usa pdf.js da vendor/. Ritorna il testo completo.
  async function extractText(arrayBuffer) {
    if (typeof window === 'undefined' || typeof chrome === 'undefined' || !chrome.runtime) {
      throw new Error('extractText disponibile solo nel browser.');
    }
    const pdfjsLib = await import(chrome.runtime.getURL('vendor/pdfjs/pdf.min.mjs'));
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.min.mjs');
    const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map(it => it.str).join(' '));
    }
    return joinPdfPages(pages);
  }

  const api = { joinPdfPages, extractText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PdfExtract = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
