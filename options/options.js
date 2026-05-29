// options.js — Pagina Impostazioni Learning Hub

const $ = id => document.getElementById(id);
const bg = (action, data = {}) => chrome.runtime.sendMessage({ action, ...data });

const GEMINI_FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.0-flash',
  'gemini-2.5-pro',
  'gemini-3.5-flash',
  'gemini-3.1-pro'
];

const OPENAI_FALLBACK_MODELS = [
  'gpt-5.4-mini',
  'gpt-5.4',
  'gpt-5.4-nano',
  'gpt-5.2',
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-nano',
  'gpt-4.1',
  'gpt-4.1-mini',
];

const MDX_SECTION_CATALOG = (typeof AppSchema !== 'undefined' && Array.isArray(AppSchema.MDX_SECTION_CATALOG))
  ? AppSchema.MDX_SECTION_CATALOG
  : [
      { key: 'verbatimTranscript', label: '📝 Trascrizione integrale' },
      { key: 'studyGuide', label: '🎓 Studio guidato' },
      { key: 'antigravityInstructions', label: '🤖 Istruzioni Google Antigravity' },
      { key: 'antigravityPrompt', label: '🧩 Prompt Antigravity pronto all’uso' },
      { key: 'quickSummary', label: '⚡ Sintesi rapida' },
      { key: 'conceptMap', label: '🗺️ Mappa concettuale' },
      { key: 'flashcards', label: '🃏 Flashcard' },
      { key: 'finalQuiz', label: '❓ Quiz finale' },
      { key: 'interactiveTimeline', label: '⏱️ Timeline interattiva' },
      { key: 'executionChecklist', label: '✅ Checklist esecuzione' },
      { key: 'operationalGlossary', label: '📚 Glossario operativo' },
      { key: 'errorsRecovery', label: '🛠️ Errori frequenti e recovery' },
      { key: 'tutorialReplication', label: '♻️ Replicazione del tutorial' },
      { key: 'personalNotes', label: '🗒️ Appunti personali' },
    ];

const DEFAULT_MDX_SECTIONS = (typeof AppSchema !== 'undefined' && AppSchema.DEFAULT_MDX_SECTIONS)
  ? { ...AppSchema.DEFAULT_MDX_SECTIONS }
  : MDX_SECTION_CATALOG.reduce((acc, item) => ({ ...acc, [item.key]: true }), {});

let obsidianDirHandle = null;
let providerState = {
  initialGeminiKey: '',
  initialOpenAIKey: '',
  geminiTested: false,
  openaiTested: false,
};
let modelCatalogState = {
  gemini: {
    models: [...GEMINI_FALLBACK_MODELS],
    source: 'fallback',
    key: '',
  },
  openai: {
    models: [...OPENAI_FALLBACK_MODELS],
    source: 'fallback',
    key: '',
  },
};
let currentMdxSectionSettings = { ...DEFAULT_MDX_SECTIONS };

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  $('sys-lang').textContent = navigator.language || 'it';
  renderMdxSectionSettings();
  await loadSettings();
  bindEvents();
  await tryRestoreObsidianHandle();
  await loadShortcuts();
  await restoreModelCatalogs();
});

async function loadSettings() {
  const { settings } = await bg('GET_SETTINGS');

  $('ai-provider').value = settings.provider || 'gemini';
  $('gemini-key').value = settings.geminiApiKey || '';
  $('openai-key').value = settings.openaiApiKey || '';
  $('toggle-obsidian').checked = settings.useFileSystemApi || false;
  $('youtube-key').value = settings.youtubeApiKey || '';
  $('default-learning-mode').value = settings.defaultLearningMode || 'study';
  $('output-format').value = settings.outputFormat || 'mdx';
  populateModelSelect('gemini', modelCatalogState.gemini.models, settings.model || GEMINI_FALLBACK_MODELS[0]);
  populateModelSelect('openai', modelCatalogState.openai.models, settings.openaiModel || OPENAI_FALLBACK_MODELS[0]);

  // Lingua
  const langRadio = document.querySelector(`input[name="language"][value="${settings.language || 'it'}"]`);
  if (langRadio) langRadio.checked = true;

  // Cartella
  if (settings.downloadFolder) {
    $('obsidian-path').value = settings.downloadFolder;
  }

  // Auto-Queue
  const intervalSel = $('auto-queue-interval');
  if (intervalSel) intervalSel.value = settings.autoQueueInterval || '12';
  
  if ($('user-topics')) $('user-topics').value = settings.userTopics || '';
  if ($('auto-extract-high-relevance')) $('auto-extract-high-relevance').checked = settings.autoExtractHighRelevance || false;

  applyMdxSectionSettings(settings.mdxSections || DEFAULT_MDX_SECTIONS);

  // Cloud Sync
  if ($('cloud-sync-mode')) $('cloud-sync-mode').value = settings.cloudSyncMode || 'none';
  if ($('notion-token')) $('notion-token').value = settings.notionToken || '';
  if ($('notion-db-id')) $('notion-db-id').value = settings.notionDbId || '';
  if ($('github-token')) $('github-token').value = settings.githubToken || '';
  if ($('github-owner')) $('github-owner').value = settings.githubOwner || '';
  if ($('github-repo')) $('github-repo').value = settings.githubRepo || '';
  updateCloudSyncUI();

  providerState = {
    initialGeminiKey: settings.geminiApiKey || '',
    initialOpenAIKey: settings.openaiApiKey || '',
    geminiTested: Boolean(settings.geminiApiKey && settings.geminiApiKeyTested),
    openaiTested: Boolean(settings.openaiApiKey && settings.openaiApiKeyTested),
  };

  updateProviderUI();
}

async function restoreModelCatalogs() {
  const tasks = [];
  const geminiKey = $('gemini-key').value.trim();
  const openaiKey = $('openai-key').value.trim();

  if (geminiKey) tasks.push(refreshGeminiModelCatalog({ key: geminiKey, silent: true }));
  if (openaiKey) tasks.push(refreshOpenAIModelCatalog({ key: openaiKey, silent: true }));

  if (!tasks.length) return;
  await Promise.allSettled(tasks);
  updateProviderUI();
}

async function tryRestoreObsidianHandle() {
  try {
    const handle = await getHandleFromIndexedDB();
    if (!handle) return;

    obsidianDirHandle = handle;
    $('obsidian-path').value = handle.name || $('obsidian-path').value || '';

    const perm = await handle.queryPermission({ mode: 'readwrite' }).catch(() => 'prompt');
    if (perm === 'granted') {
      $('toggle-obsidian').checked = true;
    }
  } catch (e) {
    console.warn('Impossibile ripristinare il vault Obsidian:', e);
  }
}

// ── Scorciatoie ───────────────────────────────────────────────────────────────

async function loadShortcuts() {
  try {
    const commands = await chrome.commands.getAll();
    const queueCmd = commands.find(c => c.name === 'add-to-queue');
    const shortcutEl = $('shortcut-queue');
    const detectedEl = $('shortcut-detected');

    if (queueCmd?.shortcut) {
      // Shortcut attiva: mostrala dinamicamente
      const keys = queueCmd.shortcut.split('+').map(k => {
        if (k === 'MacCtrl') return '⌃ Ctrl';
        if (k === 'Ctrl')    return 'Ctrl';
        if (k === 'Command') return '⌘ Cmd';
        if (k === 'Shift')   return '⇧ Shift';
        if (k === 'Alt')     return '⌥ Alt';
        return k;
      });
      shortcutEl.innerHTML = keys.map(k =>
        `<span class="shortcut-badge">${Sanitize.escapeHtml(k)}</span>`
      ).join('<span class="shortcut-sep">+</span>');
      detectedEl.textContent = `✅ Scorciatoia attiva: ${queueCmd.shortcut}`;
      detectedEl.style.color = 'var(--success)';
    } else {
      shortcutEl.innerHTML = '<span class="shortcut-badge" style="color:var(--warn)">Non impostata</span>';
      detectedEl.textContent = '⚠️ Nessuna scorciatoia impostata. Clicca il bottone qui sotto per configurarla.';
      detectedEl.style.color = 'var(--warn)';
    }
  } catch (e) {
    console.warn('Impossibile leggere scorciatoie:', e);
  }
}

// ── Bind ──────────────────────────────────────────────────────────────────────

function bindEvents() {
  // Toggle visibilità API keys
  $('toggle-key').addEventListener('click', () => {
    const input = $('gemini-key');
    input.type = input.type === 'password' ? 'text' : 'password';
  });
  $('toggle-openai-key').addEventListener('click', () => {
    const input = $('openai-key');
    input.type = input.type === 'password' ? 'text' : 'password';
  });
  $('toggle-yt-key').addEventListener('click', () => {
    const input = $('youtube-key');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  $('ai-provider').addEventListener('change', updateProviderUI);
  $('gemini-key').addEventListener('input', syncProviderTestingState);
  $('openai-key').addEventListener('input', syncProviderTestingState);
  $('gemini-model-select').addEventListener('change', () => updateModelFeedback('gemini'));
  $('openai-model-select').addEventListener('change', () => updateModelFeedback('openai'));

  // Test API key
  $('test-key').addEventListener('click', testApiKey);
  $('test-openai-key').addEventListener('click', testOpenAIApiKey);
  $('test-yt-key').addEventListener('click', testYouTubeApiKey);

  // Selezione cartella Obsidian
  $('btn-pick-folder').addEventListener('click', pickObsidianFolder);
  $('btn-clear-folder').addEventListener('click', async () => {
    obsidianDirHandle = null;
    $('obsidian-path').value = '';
    $('toggle-obsidian').checked = false;
    await bg('CLEAR_FS_HANDLE').catch(() => {});
  });

  // Scorciatoie: apri pagina Chrome
  $('btn-open-shortcuts').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  $('btn-enable-all-sections')?.addEventListener('click', () => setAllMdxSections(true));
  $('btn-disable-all-sections')?.addEventListener('click', () => setAllMdxSections(false));

  $('cloud-sync-mode')?.addEventListener('change', updateCloudSyncUI);

  // Salva
  $('btn-save').addEventListener('click', saveSettings);

  // Dashboard
  $('btn-dashboard').addEventListener('click', () => bg('OPEN_DASHBOARD'));
}

// ── Test API Key ──────────────────────────────────────────────────────────────

async function testApiKey() {
  const key  = $('gemini-key').value.trim();
  const fb   = $('key-feedback');
  const btn  = $('test-key');

  if (!key) {
    showFeedback(fb, '⚠️ Inserisci prima la tua API key.', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = '...';
  fb.className = 'field-hint hidden';

  try {
    const models = await refreshGeminiModelCatalog({ key, silent: true });
    const selectedModel = chooseModel(models, $('gemini-model-select').value, GEMINI_FALLBACK_MODELS[0]);
    populateModelSelect('gemini', models, selectedModel);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Rispondi solo con: OK' }] }],
          generationConfig: { maxOutputTokens: 5 }
        })
      }
    );
    if (res.ok) {
      providerState.geminiTested = true;
      providerState.initialGeminiKey = key;
      modelCatalogState.gemini.key = key;
      updateModelFeedback('gemini', `Catalogo aggiornato: ${models.length} modelli disponibili con questa API key.`);
      showFeedback(fb, `✅ API key valida! ${selectedModel} è pronto.`, 'success');
      updateProviderUI();
    } else {
      providerState.geminiTested = false;
      const err = await res.json().catch(() => ({}));
      showFeedback(fb, `❌ Errore: ${err?.error?.message || 'API key non valida'}`, 'error');
      updateProviderUI();
    }
  } catch (e) {
    providerState.geminiTested = false;
    showFeedback(fb, `❌ Errore di rete: ${e.message}`, 'error');
    updateProviderUI();
  }

  btn.disabled = false;
  btn.textContent = 'Test';
}

async function testOpenAIApiKey() {
  const key = $('openai-key').value.trim();
  const fb = $('openai-key-feedback');
  const btn = $('test-openai-key');

  if (!key) {
    showFeedback(fb, '⚠️ Inserisci prima la tua OpenAI API key.', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = '...';
  fb.className = 'field-hint hidden';

  try {
    const models = await refreshOpenAIModelCatalog({ key, silent: true });
    const selectedModel = chooseModel(models, $('openai-model-select').value, OPENAI_FALLBACK_MODELS[0]);
    populateModelSelect('openai', models, selectedModel);
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: selectedModel,
        input: 'Reply only with OK',
        reasoning: { effort: 'low' },
        max_output_tokens: 16,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      providerState.openaiTested = true;
      providerState.initialOpenAIKey = key;
      modelCatalogState.openai.key = key;
      updateModelFeedback('openai', `Catalogo aggiornato: ${models.length} modelli disponibili con questa API key.`);
      showFeedback(fb, `✅ API key valida! OpenAI è pronto. Modello attivo: ${selectedModel}.`, 'success');
      updateProviderUI();
    } else {
      providerState.openaiTested = false;
      showFeedback(fb, `❌ Errore: ${data?.error?.message || 'API key non valida'}`, 'error');
      updateProviderUI();
    }
  } catch (e) {
    providerState.openaiTested = false;
    showFeedback(fb, `❌ Errore di rete: ${e.message}`, 'error');
    updateProviderUI();
  }

  btn.disabled = false;
  btn.textContent = 'Test';
}

// ── Test YouTube API Key ──────────────────────────────────────────────────────

async function testYouTubeApiKey() {
  const key = $('youtube-key').value.trim();
  const fb  = $('yt-key-feedback');
  const btn = $('test-yt-key');

  if (!key) {
    showFeedback(fb, '⚠️ Inserisci prima la YouTube API key.', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = '...';
  fb.className = 'field-hint hidden';

  try {
    // Chiamata leggera: cerca i canali di YouTube stesso (0 quota consumata per errori, 1 unità se ok)
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=UCVHFbw7woebKtfvug_Iy3Xg&key=${key}`
    );
    if (res.ok) {
      const data = await res.json();
      if (data.items?.length > 0) {
        showFeedback(fb, '✅ YouTube API key valida! Avatar e statistiche attivi.', 'success');
      } else {
        showFeedback(fb, '✅ Chiave valida (quota OK, risposta vuota — normale).', 'success');
      }
    } else {
      const err = await res.json().catch(() => ({}));
      const msg = err?.error?.message || 'API key non valida o YouTube Data API v3 non attiva';
      showFeedback(fb, `❌ ${msg}`, 'error');
    }
  } catch (e) {
    showFeedback(fb, `❌ Errore di rete: ${e.message}`, 'error');
  }

  btn.disabled = false;
  btn.textContent = 'Test';
}

// ── Cartella Obsidian ─────────────────────────────────────────────────────────

async function pickObsidianFolder() {
  try {
    if (!window.showDirectoryPicker) {
      alert('Il tuo browser non supporta File System Access API.\nI file verranno scaricati nella cartella Download standard.');
      return;
    }
    obsidianDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    $('obsidian-path').value = obsidianDirHandle.name;
    $('toggle-obsidian').checked = true;

    // Salva l'handle in IndexedDB così il service worker può scrivere direttamente
    // nella cartella senza mostrare dialoghi di Chrome
    await saveHandleToIndexedDB(obsidianDirHandle);
  } catch (e) {
    if (e.name !== 'AbortError') {
      alert(`Errore selezione cartella: ${e.message}`);
    }
  }
}

async function saveHandleToIndexedDB(handle) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('lh-filesystem', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('handles');
    req.onsuccess = e => {
      const db = e.target.result;
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(handle, 'obsidian-vault');
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e.target.error);
    };
    req.onerror = e => reject(e.target.error);
  });
}

async function getHandleFromIndexedDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('lh-filesystem', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('handles');
    req.onsuccess = e => {
      const db = e.target.result;
      const tx = db.transaction('handles', 'readonly');
      const getReq = tx.objectStore('handles').get('obsidian-vault');
      getReq.onsuccess = () => resolve(getReq.result || null);
      getReq.onerror = err => reject(err.target.error);
    };
    req.onerror = e => reject(e.target.error);
  });
}

// ── Salva impostazioni ────────────────────────────────────────────────────────

async function saveSettings() {
  const btn = $('btn-save');
  const fb  = $('save-feedback');
  btn.disabled = true;

  const langRadio = document.querySelector('input[name="language"]:checked');

  const autoQueueInterval = $('auto-queue-interval')?.value || '12';

  const settings = {
    provider:          $('ai-provider').value || 'gemini',
    geminiApiKey:      $('gemini-key').value.trim(),
    geminiApiKeyTested: providerState.geminiTested && $('gemini-key').value.trim() === providerState.initialGeminiKey ? true : providerState.geminiTested,
    openaiApiKey:      $('openai-key').value.trim(),
    openaiApiKeyTested: providerState.openaiTested && $('openai-key').value.trim() === providerState.initialOpenAIKey ? true : providerState.openaiTested,
    youtubeApiKey:     $('youtube-key').value.trim(),
    model:             $('gemini-model-select').value,
    openaiModel:       $('openai-model-select').value || 'gpt-5.4-mini',
    language:          langRadio ? langRadio.value : 'it',
    defaultLearningMode: $('default-learning-mode').value || 'study',
    outputFormat:      $('output-format').value || 'mdx',
    useFileSystemApi:  $('toggle-obsidian').checked,
    downloadFolder:    $('obsidian-path').value || '',
    autoQueueInterval: autoQueueInterval,
    userTopics:        $('user-topics') ? $('user-topics').value.trim() : '',
    autoExtractHighRelevance: $('auto-extract-high-relevance') ? $('auto-extract-high-relevance').checked : false,
    mdxSections:       collectMdxSectionSettings(),
    cloudSyncMode:     $('cloud-sync-mode') ? $('cloud-sync-mode').value : 'none',
    notionToken:       $('notion-token') ? $('notion-token').value.trim() : '',
    notionDbId:        $('notion-db-id') ? $('notion-db-id').value.trim() : '',
    githubToken:       $('github-token') ? $('github-token').value.trim() : '',
    githubOwner:       $('github-owner') ? $('github-owner').value.trim() : '',
    githubRepo:        $('github-repo') ? $('github-repo').value.trim() : '',
  };

  const requiredKey = settings.provider === 'openai' ? settings.openaiApiKey : settings.geminiApiKey;
  const requiredLabel = settings.provider === 'openai' ? 'OpenAI' : 'Gemini';
  if (!requiredKey) {
    showFeedback(fb, `⚠️ Inserisci la tua ${requiredLabel} API key prima di salvare.`, 'error');
    btn.disabled = false;
    return;
  }

  try {
    await bg('SAVE_SETTINGS', { settings });
    providerState.initialGeminiKey = settings.geminiApiKey;
    providerState.initialOpenAIKey = settings.openaiApiKey;
    providerState.geminiTested = settings.geminiApiKeyTested;
    providerState.openaiTested = settings.openaiApiKeyTested;
    // Aggiorna l'allarme Chrome con il nuovo intervallo
    await bg('SETUP_AUTO_QUEUE_ALARM', { intervalHours: autoQueueInterval === 'off' ? null : Number(autoQueueInterval) }).catch(() => {});
    showFeedback(fb, '✅ Impostazioni salvate!', 'success');
    setTimeout(() => { fb.classList.add('hidden'); }, 3000);
  } catch (e) {
    showFeedback(fb, `❌ Errore: ${e.message}`, 'error');
  }

  btn.disabled = false;
}

function renderMdxSectionSettings() {
  const container = $('mdx-sections-list');
  if (!container) return;
  container.innerHTML = MDX_SECTION_CATALOG.map(section => `
    <label class="check-item">
      <input type="checkbox" data-mdx-section="${section.key}">
      <span>${section.label}</span>
    </label>
  `).join('');
}

function applyMdxSectionSettings(mdxSections = {}) {
  const merged = { ...DEFAULT_MDX_SECTIONS, ...(mdxSections || {}) };
  currentMdxSectionSettings = merged;
  document.querySelectorAll('[data-mdx-section]').forEach(input => {
    const key = input.getAttribute('data-mdx-section');
    input.checked = Boolean(merged[key]);
  });
}

function collectMdxSectionSettings() {
  const inputs = document.querySelectorAll('[data-mdx-section]');
  if (!inputs.length) return { ...currentMdxSectionSettings };
  return MDX_SECTION_CATALOG.reduce((acc, section) => {
    acc[section.key] = Boolean(document.querySelector(`[data-mdx-section="${section.key}"]`)?.checked);
    return acc;
  }, {});
}

function setAllMdxSections(nextValue) {
  document.querySelectorAll('[data-mdx-section]').forEach(input => {
    input.checked = Boolean(nextValue);
  });
}

function updateProviderUI() {
  const available = getAvailableProviders();
  const providerSelect = $('ai-provider');
  if (providerSelect) {
    [...providerSelect.options].forEach(option => {
      option.disabled = !available.includes(option.value);
      option.textContent = option.value === 'openai'
        ? `OpenAI${available.includes('openai') ? '' : ' (disponibile dopo test chiave)'}`
        : `Gemini${available.includes('gemini') ? '' : ' (disponibile dopo test chiave)'}`;
    });
    if (!available.includes(providerSelect.value)) {
      providerSelect.value = available[0] || 'gemini';
    }
  }
  const provider = providerSelect?.value || 'gemini';
  document.querySelectorAll('.provider-panel-gemini').forEach(el => el.classList.toggle('hidden', provider !== 'gemini'));
  document.querySelectorAll('.provider-panel-openai').forEach(el => el.classList.toggle('hidden', provider !== 'openai'));
  updateModelFeedback('gemini');
  updateModelFeedback('openai');
}

function syncProviderTestingState() {
  const geminiKey = $('gemini-key').value.trim();
  const openaiKey = $('openai-key').value.trim();

  providerState.geminiTested = geminiKey && geminiKey === providerState.initialGeminiKey
    ? providerState.geminiTested
    : false;
  providerState.openaiTested = openaiKey && openaiKey === providerState.initialOpenAIKey
    ? providerState.openaiTested
    : false;

  if (geminiKey !== modelCatalogState.gemini.key) {
    modelCatalogState.gemini = {
      models: [...GEMINI_FALLBACK_MODELS],
      source: 'fallback',
      key: '',
    };
    populateModelSelect('gemini', modelCatalogState.gemini.models, $('gemini-model-select').value || GEMINI_FALLBACK_MODELS[0]);
  }

  if (openaiKey !== modelCatalogState.openai.key) {
    modelCatalogState.openai = {
      models: [...OPENAI_FALLBACK_MODELS],
      source: 'fallback',
      key: '',
    };
    populateModelSelect('openai', modelCatalogState.openai.models, $('openai-model-select').value || OPENAI_FALLBACK_MODELS[0]);
  }

  updateProviderUI();
}

function getAvailableProviders() {
  const available = [];
  if ($('gemini-key').value.trim() && providerState.geminiTested) available.push('gemini');
  if ($('openai-key').value.trim() && providerState.openaiTested) available.push('openai');
  if (!available.length) available.push('gemini');
  return available;
}

async function refreshGeminiModelCatalog({ key, silent = false } = {}) {
  const apiKey = key || $('gemini-key').value.trim();
  if (!apiKey) return [...GEMINI_FALLBACK_MODELS];

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error?.message || `HTTP ${res.status}`);
    }

    const models = (data.models || [])
      .filter(model =>
        model?.name &&
        model.name.startsWith('models/gemini') &&
        Array.isArray(model.supportedGenerationMethods) &&
        model.supportedGenerationMethods.includes('generateContent')
      )
      .map(model => model.name.replace(/^models\//, ''));

    const normalized = sortModels(uniqueStrings(models), GEMINI_FALLBACK_MODELS);
    if (!normalized.length) throw new Error('Nessun modello Gemini compatibile trovato per questa API key.');

    providerState.geminiTested = true;
    modelCatalogState.gemini = { models: normalized, source: 'api', key: apiKey };
    populateModelSelect('gemini', normalized, $('gemini-model-select').value || GEMINI_FALLBACK_MODELS[0]);
    updateModelFeedback('gemini', `Catalogo API caricato (${normalized.length} modelli).`);
    return normalized;
  } catch (e) {
    providerState.geminiTested = false;
    modelCatalogState.gemini = { models: [...GEMINI_FALLBACK_MODELS], source: 'fallback', key: '' };
    populateModelSelect('gemini', modelCatalogState.gemini.models, $('gemini-model-select').value || GEMINI_FALLBACK_MODELS[0]);
    updateModelFeedback('gemini', silent ? 'Catalogo statico locale. Testa la chiave per leggere i modelli esposti dalla tua API.' : `Catalogo API non disponibile: ${e.message}`);
    if (!silent) throw e;
    return [...GEMINI_FALLBACK_MODELS];
  }
}

async function refreshOpenAIModelCatalog({ key, silent = false } = {}) {
  const apiKey = key || $('openai-key').value.trim();
  if (!apiKey) return [...OPENAI_FALLBACK_MODELS];

  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error?.message || `HTTP ${res.status}`);
    }

    const models = (data.data || [])
      .map(model => model?.id)
      .filter(model =>
        typeof model === 'string' &&
        /^gpt-/.test(model) &&
        !model.startsWith('gpt-image') &&
        !model.startsWith('gpt-audio') &&
        !model.startsWith('gpt-realtime') &&
        !model.startsWith('chatgpt-')
      );

    const normalized = sortModels(uniqueStrings(models), OPENAI_FALLBACK_MODELS);
    if (!normalized.length) throw new Error('Nessun modello OpenAI compatibile trovato per questa API key.');

    providerState.openaiTested = true;
    modelCatalogState.openai = { models: normalized, source: 'api', key: apiKey };
    populateModelSelect('openai', normalized, $('openai-model-select').value || OPENAI_FALLBACK_MODELS[0]);
    updateModelFeedback('openai', `Catalogo API caricato (${normalized.length} modelli).`);
    return normalized;
  } catch (e) {
    providerState.openaiTested = false;
    modelCatalogState.openai = { models: [...OPENAI_FALLBACK_MODELS], source: 'fallback', key: '' };
    populateModelSelect('openai', modelCatalogState.openai.models, $('openai-model-select').value || OPENAI_FALLBACK_MODELS[0]);
    updateModelFeedback('openai', silent ? 'Catalogo statico locale. Testa la chiave per leggere i modelli esposti dalla tua API.' : `Catalogo API non disponibile: ${e.message}`);
    if (!silent) throw e;
    return [...OPENAI_FALLBACK_MODELS];
  }
}

function populateModelSelect(provider, models, preferredModel) {
  const select = provider === 'openai' ? $('openai-model-select') : $('gemini-model-select');
  if (!select) return;

  const normalized = uniqueStrings(models);
  const selectedModel = chooseModel(normalized, preferredModel, normalized[0]);
  select.innerHTML = '';

  normalized.forEach(model => {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = formatModelLabel(provider, model);
    select.appendChild(option);
  });

  if (selectedModel) select.value = selectedModel;
}

function updateModelFeedback(provider, message) {
  const el = provider === 'openai' ? $('openai-model-feedback') : $('gemini-model-feedback');
  if (!el) return;

  if (message) {
    el.textContent = message;
    return;
  }

  const state = modelCatalogState[provider];
  const selected = provider === 'openai' ? $('openai-model-select')?.value : $('gemini-model-select')?.value;
  const sourceLabel = state.source === 'api' ? 'catalogo live dalla tua API' : 'catalogo statico locale';
  if (selected) {
    el.textContent = `Modello selezionato: ${selected} · Sorgente: ${sourceLabel}.`;
  } else {
    el.textContent = `Sorgente modelli: ${sourceLabel}.`;
  }
}

function chooseModel(models, preferredModel, fallbackModel) {
  if (preferredModel && models.includes(preferredModel)) return preferredModel;
  if (fallbackModel && models.includes(fallbackModel)) return fallbackModel;
  return models[0] || fallbackModel || '';
}

function sortModels(models, priorityModels) {
  return [...models].sort((left, right) => {
    const leftIndex = priorityModels.indexOf(left);
    const rightIndex = priorityModels.indexOf(right);
    if (leftIndex !== -1 || rightIndex !== -1) {
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    }
    return left.localeCompare(right);
  });
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter(Boolean).map(value => String(value).trim()).filter(Boolean))];
}

function formatModelLabel(provider, model) {
  if (provider === 'gemini') {
    if (model === 'gemini-2.5-flash') return 'Gemini 2.5 Flash (consigliato)';
    if (model === 'gemini-2.5-flash-lite') return 'Gemini 2.5 Flash-Lite';
    if (model === 'gemini-2.5-pro') return 'Gemini 2.5 Pro';
    return model;
  }

  if (model === 'gpt-5.4-mini') return 'GPT-5.4 mini (consigliato)';
  if (model === 'gpt-5.4') return 'GPT-5.4';
  if (model === 'gpt-5.4-nano') return 'GPT-5.4 nano';
  if (model === 'gpt-5.2') return 'GPT-5.2';
  if (model === 'gpt-5') return 'GPT-5';
  if (model === 'gpt-5-mini') return 'GPT-5 mini';
  if (model === 'gpt-5-nano') return 'GPT-5 nano';
  return model;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function showFeedback(el, message, type) {
  el.textContent = message;
  el.className = `${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}
