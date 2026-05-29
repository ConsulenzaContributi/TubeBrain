// utils/i18n.js — i18n custom con switch a runtime
(function (root) {
  const DICT = {
    it: {
      'popup.generate': 'Genera Learning MDX',
      'popup.queue': 'Coda',
      'popup.follow': 'Segui Creator',
      'popup.ocr': 'Cattura Testo a Schermo (OCR)',
      'popup.settings': 'Impostazioni',
      'popup.dashboard': 'Apri Dashboard',
      'options.language': 'Lingua interfaccia',
      'dashboard.search': 'Cerca',
      'dashboard.archive': 'Archivio',
      'dashboard.stats': 'Statistiche',
      'common.save': 'Salva',
      'common.loading': 'Caricamento...',
    },
    en: {
      'popup.generate': 'Generate Learning MDX',
      'popup.queue': 'Queue',
      'popup.follow': 'Follow Creator',
      'popup.ocr': 'Capture On-screen Text (OCR)',
      'popup.settings': 'Settings',
      'popup.dashboard': 'Open Dashboard',
      'options.language': 'Interface language',
      'dashboard.search': 'Search',
      'dashboard.archive': 'Archive',
      'dashboard.stats': 'Statistics',
      'common.save': 'Save',
      'common.loading': 'Loading...',
    },
  };

  function t(key, lang = 'it') {
    const table = DICT[lang] || DICT.it;
    if (table && key in table) return table[key];
    if (DICT.it && key in DICT.it) return DICT.it[key];
    return key;
  }

  function applyI18n(rootEl, lang = 'it') {
    if (!rootEl || !rootEl.querySelectorAll) return;
    rootEl.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.getAttribute('data-i18n'), lang);
    });
    rootEl.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder'), lang));
    });
  }

  const api = { DICT, t, applyI18n };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.I18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
