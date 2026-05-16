// options.js — Pagina Impostazioni Learning Hub

const $ = id => document.getElementById(id);
const bg = (action, data = {}) => chrome.runtime.sendMessage({ action, ...data });

let obsidianDirHandle = null;

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  $('sys-lang').textContent = navigator.language || 'it';
  await loadSettings();
  bindEvents();
  await tryRestoreObsidianHandle();
  await loadShortcuts();
});

async function loadSettings() {
  const { settings } = await bg('GET_SETTINGS');

  $('gemini-key').value = settings.geminiApiKey || '';
  $('model-select').value = settings.model || 'gemini-2.5-flash';
  $('toggle-obsidian').checked = settings.useFileSystemApi || false;
  $('youtube-key').value = settings.youtubeApiKey || '';
  $('default-learning-mode').value = settings.defaultLearningMode || 'study';
  $('output-format').value = settings.outputFormat || 'mdx';

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
}

async function tryRestoreObsidianHandle() {
  // Il FileSystemDirectoryHandle non è serializzabile in chrome.storage,
  // quindi non possiamo ripristinarlo automaticamente — l'utente deve
  // ri-selezionare la cartella ad ogni sessione se vuole il salvataggio diretto.
  // (IndexedDB è un'alternativa ma fuori scope per v1)
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
        `<span class="shortcut-badge">${k}</span>`
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
  $('toggle-yt-key').addEventListener('click', () => {
    const input = $('youtube-key');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Test API key
  $('test-key').addEventListener('click', testApiKey);
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
    const selectedModel = $('model-select').value || 'gemini-2.5-flash';
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
      showFeedback(fb, `✅ API key valida! ${selectedModel} è pronto.`, 'success');
    } else {
      const err = await res.json().catch(() => ({}));
      showFeedback(fb, `❌ Errore: ${err?.error?.message || 'API key non valida'}`, 'error');
    }
  } catch (e) {
    showFeedback(fb, `❌ Errore di rete: ${e.message}`, 'error');
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

// ── Salva impostazioni ────────────────────────────────────────────────────────

async function saveSettings() {
  const btn = $('btn-save');
  const fb  = $('save-feedback');
  btn.disabled = true;

  const langRadio = document.querySelector('input[name="language"]:checked');

  const autoQueueInterval = $('auto-queue-interval')?.value || '12';

  const settings = {
    geminiApiKey:      $('gemini-key').value.trim(),
    youtubeApiKey:     $('youtube-key').value.trim(),
    model:             $('model-select').value,
    language:          langRadio ? langRadio.value : 'it',
    defaultLearningMode: $('default-learning-mode').value || 'study',
    outputFormat:      $('output-format').value || 'mdx',
    useFileSystemApi:  $('toggle-obsidian').checked,
    downloadFolder:    $('obsidian-path').value || '',
    autoQueueInterval: autoQueueInterval,
  };

  if (!settings.geminiApiKey) {
    showFeedback(fb, '⚠️ Inserisci la tua Gemini API key prima di salvare.', 'error');
    btn.disabled = false;
    return;
  }

  try {
    await bg('SAVE_SETTINGS', { settings });
    // Aggiorna l'allarme Chrome con il nuovo intervallo
    await bg('SETUP_AUTO_QUEUE_ALARM', { intervalHours: autoQueueInterval === 'off' ? null : Number(autoQueueInterval) }).catch(() => {});
    showFeedback(fb, '✅ Impostazioni salvate!', 'success');
    setTimeout(() => { fb.classList.add('hidden'); }, 3000);
  } catch (e) {
    showFeedback(fb, `❌ Errore: ${e.message}`, 'error');
  }

  btn.disabled = false;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function showFeedback(el, message, type) {
  el.textContent = message;
  el.className = `${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}
