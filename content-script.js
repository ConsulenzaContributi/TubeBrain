// content-script.js — Iniettato nelle pagine YouTube
// Risponde ai messaggi del popup/background per estrarre dati video

(function () {
  'use strict';

  // Evita doppia iniezione
  if (window.__learningHubInjected) return;
  window.__learningHubInjected = true;

  let lastHoveredVideoUrl = '';

  function normalizeYouTubeVideoUrl(url) {
    if (!url) return '';
    try {
      const parsed = new URL(url, location.origin);
      if (/youtu\.be$/i.test(parsed.hostname)) {
        const id = parsed.pathname.split('/').filter(Boolean)[0];
        return id ? `https://www.youtube.com/watch?v=${id}` : '';
      }
      if (!/youtube\.com$/i.test(parsed.hostname) && !/\.youtube\.com$/i.test(parsed.hostname)) return '';
      if (parsed.pathname === '/watch') {
        const id = parsed.searchParams.get('v');
        return id ? `https://www.youtube.com/watch?v=${id}` : '';
      }
      const shorts = parsed.pathname.match(/^\/shorts\/([^/?#]+)/);
      if (shorts) return `https://www.youtube.com/watch?v=${shorts[1]}`;
      return '';
    } catch {
      return '';
    }
  }

  function resolveVideoUrlFromNode(node) {
    const anchor = node?.closest?.('a[href]') || null;
    return normalizeYouTubeVideoUrl(anchor?.href || '');
  }

  function captureHoveredVideo(event) {
    const path = event.composedPath ? event.composedPath() : [event.target];
    for (const node of path) {
      const url = resolveVideoUrlFromNode(node);
      if (url) {
        lastHoveredVideoUrl = url;
        return;
      }
    }
  }

  function detectShortcut(event) {
    const isMac = navigator.platform.toLowerCase().includes('mac');
    const cmdOrCtrl = isMac ? event.metaKey : event.ctrlKey;
    
    const active = document.activeElement;
    const typing = active && (
      /input|textarea|select/i.test(active.tagName) ||
      active.isContentEditable
    );
    if (typing) return null;

    // Cmd/Ctrl + Shift + P -> Queue shortcut
    if (cmdOrCtrl && event.shiftKey && String(event.key || '').toLowerCase() === 'p') {
      return 'queue';
    }

    // Alt/Option + S -> Screenshot
    if (event.altKey && String(event.key || '').toLowerCase() === 's') {
      return 'screenshot';
    }

    return null;
  }

  function resolveShortcutVideoUrl() {
    return normalizeYouTubeVideoUrl(location.href) || lastHoveredVideoUrl || '';
  }

  async function triggerQueueShortcutFromPage() {
    const targetUrl = resolveShortcutVideoUrl();
    if (!targetUrl) {
      playQueueSound('info');
      showQueueToast('already', 'Nessun video rilevato', 'Apri un video o passa il mouse sopra una miniatura YouTube.');
      return;
    }
    try {
      await chrome.runtime.sendMessage({ action: 'QUEUE_SHORTCUT_TARGET', targetUrl });
    } catch {
      playQueueSound('info');
      showQueueToast('already', 'Scorciatoia non riuscita', 'Ricarica l’estensione e riprova.');
    }
  }

  // ── Utility: inject script nel contesto pagina ────────────────────────────

  function injectAndCapture() {
    return new Promise((resolve, reject) => {
      const CHANNEL = 'LH_EXTRACT_' + Date.now();

      const script = document.createElement('script');
      script.textContent = `
        (function() {
          try {
            var pr = window.ytInitialPlayerResponse;
            if (!pr) {
              window.postMessage({ type: '${CHANNEL}', error: 'no_player_response' }, '*');
              return;
            }

            var vd = pr.videoDetails || {};

            // Caption tracks
            var captionTracks = [];
            try {
              captionTracks = pr.captions.playerCaptionsTracklistRenderer.captionTracks.map(function(c) {
                return {
                  baseUrl: c.baseUrl,
                  languageCode: c.languageCode,
                  kind: c.kind || 'manual',
                  name: (c.name && c.name.simpleText) || c.languageCode
                };
              });
            } catch(e) {}

            // Capitoli
            var chapters = [];
            try {
              chapters = pr.playerMicroformatRenderer.chapters.map(function(ch) {
                return {
                  title: ch.chapterRenderer.title.simpleText,
                  startMs: parseInt(ch.chapterRenderer.timeRangeStartMillis || 0)
                };
              });
            } catch(e) {}

            window.postMessage({
              type: '${CHANNEL}',
              data: {
                videoId: vd.videoId || '',
                title: vd.title || document.title,
                channelId: vd.channelId || '',
                channelName: vd.author || '',
                duration: parseInt(vd.lengthSeconds || 0),
                description: (vd.shortDescription || '').slice(0, 1000),
                captionTracks: captionTracks,
                chapters: chapters
              }
            }, '*');

          } catch(e) {
            window.postMessage({ type: '${CHANNEL}', error: e.message }, '*');
          }
        })();
      `;

      document.documentElement.appendChild(script);
      script.remove();

      var timeout = setTimeout(function() {
        reject(new Error('Timeout: impossibile leggere i dati del video YouTube'));
      }, 8000);

      window.addEventListener('message', function handler(event) {
        if (!event.data || event.data.type !== CHANNEL) return;
        window.removeEventListener('message', handler);
        clearTimeout(timeout);
        if (event.data.error) return reject(new Error(event.data.error));
        resolve(event.data.data);
      });
    });
  }

  // ── Selezione migliore caption track ─────────────────────────────────────

  function selectBestTrack(tracks, preferredLang) {
    if (!tracks || tracks.length === 0) return null;
    const manual = tracks.filter(t => t.kind !== 'asr');
    const auto   = tracks.filter(t => t.kind === 'asr');
    return (
      manual.find(t => t.languageCode.startsWith(preferredLang)) ||
      auto.find(t => t.languageCode.startsWith(preferredLang)) ||
      manual[0] || auto[0] || tracks[0]
    );
  }

  // ── Fetch e parsing caption JSON3 ────────────────────────────────────────

  async function fetchCaption(baseUrl) {
    const url = new URL(baseUrl);
    url.searchParams.set('fmt', 'json3');
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Captions HTTP ${res.status}`);
    const data = await res.json();
    if (!data.events) return '';

    // Formatta: [MM:SS] testo
    const segments = [];
    for (const ev of data.events) {
      if (!ev.segs) continue;
      const text = ev.segs.map(s => s.utf8 || '').join('').replace(/\n/g, ' ').trim();
      if (text) segments.push({ ms: ev.tStartMs || 0, text });
    }

    // Raggruppa in blocchi da 45 secondi
    let out = '';
    let blockText = [];
    let blockStart = 0;
    for (const seg of segments) {
      if (seg.ms - blockStart > 45000 && blockText.length > 0) {
        out += `[${msToTs(blockStart)}] ${blockText.join(' ')}\n`;
        blockText = [];
        blockStart = seg.ms;
      }
      blockText.push(seg.text);
    }
    if (blockText.length > 0) out += `[${msToTs(blockStart)}] ${blockText.join(' ')}\n`;
    return out;
  }

  function msToTs(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}:${String(m % 60).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
    return `${m}:${String(s % 60).padStart(2,'0')}`;
  }

  // ── Toast notifica coda ───────────────────────────────────────────────────

  function playQueueSound(status) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();

      function playTone(freq, startAt, duration, gain) {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.connect(env);
        env.connect(ctx.destination);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startAt);

        // Inviluppo morbido: attack brevissimo, decay graduale
        env.gain.setValueAtTime(0, startAt);
        env.gain.linearRampToValueAtTime(gain, startAt + 0.02);
        env.gain.exponentialRampToValueAtTime(0.001, startAt + duration);

        osc.start(startAt);
        osc.stop(startAt + duration);
      }

      if (status === 'success') {
        // Due note molto morbide: Sol4 → Si4
        playTone(392.0,  ctx.currentTime,        0.28, 0.045);
        playTone(493.88, ctx.currentTime + 0.10, 0.30, 0.038);
      } else {
        // Nota singola morbida per stato informativo
        playTone(349.23, ctx.currentTime, 0.24, 0.03);
      }

      // Chiudi il context dopo che i suoni sono finiti
      setTimeout(() => ctx.close(), 1000);
    } catch (e) {
      // Web Audio non disponibile: nessun problema
    }
  }

  function showQueueToast(status, title, subtitle = '') {
    // Rimuovi eventuali toast precedenti
    const old = document.getElementById('lh-queue-toast');
    if (old) old.remove();

    const isSuccess = status === 'success';
    const icon  = isSuccess ? '🕐' : 'ℹ️';
    const label = isSuccess ? 'Azione completata' : 'Nessuna modifica';
    const color = isSuccess ? '#1a73e8' : '#f59e0b';
    const titleShort = (title || '').length > 52 ? title.slice(0, 52) + '…' : (title || '');

    const toast = document.createElement('div');
    toast.id = 'lh-queue-toast';
    toast.style.cssText = `
      position: fixed;
      top: 72px;
      right: 20px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 12px;
      background: #ffffff;
      border: 1.5px solid ${color};
      border-left: 4px solid ${color};
      border-radius: 10px;
      padding: 12px 16px 12px 14px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15), 0 1px 4px rgba(0,0,0,0.08);
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 340px;
      min-width: 260px;
      opacity: 0;
      transform: translateX(16px);
      transition: opacity 0.22s ease, transform 0.22s ease;
      pointer-events: none;
    `;

    toast.innerHTML = `
      <span style="font-size:20px;flex-shrink:0">${icon}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700;color:${color};letter-spacing:0.3px;margin-bottom:2px">${label}</div>
        <div style="font-size:12px;color:#495057;line-height:1.4;word-break:break-word">${titleShort}</div>
        ${subtitle ? `<div style="font-size:11px;color:#6b7280;line-height:1.35;margin-top:3px">${subtitle}</div>` : ''}
      </div>
      <span style="font-size:18px;font-weight:700;color:#868e96;cursor:pointer;flex-shrink:0;pointer-events:all;padding:0 2px"
            onclick="this.closest('#lh-queue-toast').remove()">×</span>
    `;

    document.body.appendChild(toast);

    // Slide-in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(0)';
      });
    });

    // Auto-dismiss dopo 4s con fade-out
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(16px)';
      setTimeout(() => toast.remove(), 280);
    }, 4000);
  }

  // ── Area 3: Selezione multipla miniature + accoda pagina ─────────────────

  let selectionModeOn = false;
  let selectedVideoUrls = new Set();
  let _selectionObserver = null;
  let _selectionDebounceTimer = null;

  function harvestPageVideoUrls() {
    const seen = new Set();
    const anchors = document.querySelectorAll('a[href]');
    for (const a of anchors) {
      const url = normalizeYouTubeVideoUrl(a.href);
      if (url) seen.add(url);
      if (seen.size >= 200) break;
    }
    return Array.from(seen);
  }

  function updateSelectionCount() {
    const counter = document.getElementById('tb-sel-count');
    if (counter) counter.textContent = selectedVideoUrls.size + ' selezionati';
  }

  function ensureSelectionBar() {
    if (document.getElementById('tb-selection-bar')) return;

    const bar = document.createElement('div');
    bar.id = 'tb-selection-bar';
    bar.style.cssText = 'position:fixed;bottom:18px;right:18px;z-index:2147483000;display:flex;gap:8px;background:#fff;border:1px solid #f97316;border-radius:12px;padding:10px 12px;box-shadow:0 8px 24px rgba(0,0,0,.18);font:600 13px system-ui;align-items:center';

    const counter = document.createElement('span');
    counter.id = 'tb-sel-count';
    counter.textContent = '0 selezionati';
    counter.style.cssText = 'color:#374151;margin-right:4px';
    bar.appendChild(counter);

    const btnStyle = 'background:#f97316;color:#fff;border:none;border-radius:8px;padding:6px 12px;cursor:pointer;font:600 12px system-ui';

    const btnQueue = document.createElement('button');
    btnQueue.textContent = 'Accoda selezionati';
    btnQueue.style.cssText = btnStyle;
    btnQueue.addEventListener('click', () => queueUrls(Array.from(selectedVideoUrls)));
    bar.appendChild(btnQueue);

    const btnAll = document.createElement('button');
    btnAll.textContent = 'Accoda tutta la pagina';
    btnAll.style.cssText = btnStyle;
    btnAll.addEventListener('click', () => queueUrls(harvestPageVideoUrls()));
    bar.appendChild(btnAll);

    const btnExit = document.createElement('button');
    btnExit.textContent = 'Esci';
    btnExit.style.cssText = 'background:#6b7280;color:#fff;border:none;border-radius:8px;padding:6px 12px;cursor:pointer;font:600 12px system-ui';
    btnExit.addEventListener('click', () => toggleSelectionMode(false));
    bar.appendChild(btnExit);

    document.body.appendChild(bar);
  }

  function decorateThumbnails() {
    const anchors = document.querySelectorAll('a[href]');
    for (const a of anchors) {
      const url = normalizeYouTubeVideoUrl(a.href);
      if (!url) continue;

      const container = a.closest('ytd-thumbnail, ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer') || a;
      if (container.dataset.tbDecorated === '1') continue;
      container.dataset.tbDecorated = '1';

      const currentPosition = container.style.position;
      if (!currentPosition || currentPosition === 'static') {
        container.style.position = 'relative';
      }

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'tb-sel-checkbox';
      cb.dataset.tbUrl = url;
      cb.style.cssText = 'position:absolute;top:6px;left:6px;width:20px;height:20px;z-index:9999;cursor:pointer;accent-color:#f97316';

      if (selectedVideoUrls.has(url)) cb.checked = true;

      cb.addEventListener('change', () => {
        if (cb.checked) {
          selectedVideoUrls.add(cb.dataset.tbUrl);
        } else {
          selectedVideoUrls.delete(cb.dataset.tbUrl);
        }
        updateSelectionCount();
      });

      container.appendChild(cb);
    }
  }

  function toggleSelectionMode(force) {
    const next = (force !== undefined) ? !!force : !selectionModeOn;
    selectionModeOn = next;

    if (selectionModeOn) {
      ensureSelectionBar();
      decorateThumbnails();

      // MutationObserver per lazy-loading
      _selectionObserver = new MutationObserver(() => {
        clearTimeout(_selectionDebounceTimer);
        _selectionDebounceTimer = setTimeout(decorateThumbnails, 300);
      });
      _selectionObserver.observe(document.body, { childList: true, subtree: true });

    } else {
      // Rimuovi checkboxes
      document.querySelectorAll('.tb-sel-checkbox').forEach(cb => cb.remove());
      document.querySelectorAll('[data-tb-decorated]').forEach(el => delete el.dataset.tbDecorated);
      selectedVideoUrls.clear();

      // Nascondi barra
      const bar = document.getElementById('tb-selection-bar');
      if (bar) bar.remove();

      // Disconnetti observer
      if (_selectionObserver) {
        _selectionObserver.disconnect();
        _selectionObserver = null;
      }
      clearTimeout(_selectionDebounceTimer);
    }
  }

  function queueUrls(urls) {
    if (!urls || urls.length === 0) {
      showQueueToast('error', 'Nessun video selezionato', '');
      return;
    }
    chrome.runtime.sendMessage({ action: 'IMPORT_BATCH_URLS', input: urls.join('\n') })
      .then(res => {
        showQueueToast('success', (res.queued || 0) + ' video accodati', (res.totalResolved || urls.length) + ' risolti');
      })
      .catch(err => {
        showQueueToast('error', 'Errore accodamento', String(err && err.message || err));
      });
  }

  // ── Listener messaggi dal popup / background ──────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'TOGGLE_SELECTION_MODE') {
      toggleSelectionMode();
      sendResponse && sendResponse({ ok: true });
      return true;
    }

    if (message.action === 'SHOW_QUEUE_TOAST') {
      playQueueSound(message.status);
      showQueueToast(message.status, message.title, message.subtitle || '');
      sendResponse({ ok: true });
      return false;
    }

    if (message.action !== 'GET_VIDEO_DATA') return false;

    const preferredLang = message.language || 'it';

    (async () => {
      try {
        const pageData = await injectAndCapture();
        const track = selectBestTrack(pageData.captionTracks, preferredLang);

        let transcript = '';
        let captionLang = null;
        let warning = null;

        if (track) {
          try {
            transcript = await fetchCaption(track.baseUrl);
            captionLang = track.languageCode;
          } catch (e) {
            warning = 'caption_fetch_failed';
          }
        } else {
          warning = 'no_captions';
        }

        sendResponse({
          success: true,
          data: { ...pageData, transcript, captionLang, warning }
        });

      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();

    return true; // risposta asincrona
  });

  document.addEventListener('mousemove', captureHoveredVideo, true);
  document.addEventListener('contextmenu', captureHoveredVideo, true);
  document.addEventListener('focusin', captureHoveredVideo, true);
  document.addEventListener('keydown', event => {
    const shortcut = detectShortcut(event);
    if (!shortcut) return;
    event.preventDefault();
    event.stopPropagation();
    
    if (shortcut === 'queue') {
      triggerQueueShortcutFromPage();
    } else if (shortcut === 'screenshot') {
      captureVideoScreenshot();
    }
  }, true);

  // ── Feature: Screenshot (Visual Notes) ──────────────────────────────────
  async function captureVideoScreenshot() {
    const videoElement = document.querySelector('video');
    if (!videoElement) {
      showQueueToast('error', 'Nessun video trovato nella pagina.');
      return;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = videoElement.videoWidth;
      canvas.height = videoElement.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
      const base64Data = canvas.toDataURL('image/jpeg', 0.85);

      const url = new URL(location.href);
      const videoId = url.searchParams.get('v');
      if (!videoId) throw new Error('Video ID non trovato');

      const timestampMs = Math.floor(videoElement.currentTime * 1000);
      const timestampStr = msToTs(timestampMs);

      await chrome.runtime.sendMessage({
        action: 'CAPTURE_FRAME',
        videoId,
        timestampStr,
        base64Data
      });

      playQueueSound('success');
      showQueueToast('success', '📸 Screenshot acquisito!', `Salvato al timestamp ${timestampStr}`);
    } catch (e) {
      showQueueToast('error', 'Errore acquisizione', e.message);
    }
  }

  // ── Indicatore visivo nella pagina ───────────────────────────────────────
  // Piccolo badge "LH" nell'angolo del video player per indicare che
  // l'estensione è attiva e pronta

  function injectBadge() {
    if (!location.href.includes('/watch')) return;
    if (document.getElementById('lh-badge')) return;
    const badge = document.createElement('div');
    badge.id = 'lh-badge';
    badge.title = 'TubeBrain attivo — clicca l\'icona dell\'estensione per generare il riepilogo';
    badge.style.cssText = `
      position: fixed; bottom: 80px; right: 16px; z-index: 9999;
      background: #1a73e8; color: white; font-size: 11px; font-weight: 700;
      padding: 4px 8px; border-radius: 4px; cursor: pointer;
      font-family: system-ui, sans-serif; letter-spacing: 0.5px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3); opacity: 0.85;
    `;
    badge.textContent = '📚 LH';
    badge.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'OPEN_POPUP' });
    });
    document.body.appendChild(badge);
  }

  // Inietta badge quando la pagina è pronta
  if (document.readyState === 'complete') {
    injectBadge();
  } else {
    window.addEventListener('load', injectBadge);
  }

  // Aggiorna badge al cambio di video (YouTube è SPA)
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(injectBadge, 1500);
    }
  }).observe(document.body, { childList: true, subtree: true });

})();
