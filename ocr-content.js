(function () {
  'use strict';

  if (window.__yocrc_injected) {
    return;
  }
  window.__yocrc_injected = true;

const PLUGIN_VERSION = 'A1.0.9';
const OCR_HOST_URL = chrome.runtime.getURL('ocr/ocr.html');
const OCR_HOST_TIMEOUT_MS = 60000;

  let state = 'idle';
  let selectionOverlay = null;
  let selectionRect = null;
  let activeSelectionCleanup = null;
  let cancelHint = null;
  let startX = 0;
  let startY = 0;
  let isMouseDown = false;
  let textOverlay = null;
  let currentOptions = null;
  let currentMeta = null;
  let currentText = '';
  let currentCaptureImage = null;
  let processingStartTime = null;
  let progressOverlay = null;
  let progressBar = null;
  let progressPercent = null;
  let progressStage = null;
  let resultPanel = null;
  let optionsPanel = null;
  let shortcutListenerAttached = false;
  let currentProgress = { percent: 0, stage: '' };
  let currentSelectionRect = null;
  let ocrHostFrame = null;
  let ocrHostReady = null;
  let ocrHostReadyResolve = null;
  let ocrPending = new Map();
  let ocrHostListenerInstalled = false;
  let logsClearedForVersion = false;

  function loadOptions() {
    return new Promise((resolve) => {
      chrome.storage.local.get('options', (result) => {
        const defaults = {
          overlay: true,
          extendedMeta: true,
          fontMetrics: false,
          localHistory: false,
          banner: true,
          extendedLog: false,
          exportTxt: true,
          exportJson: true,
          shortcut: 'Ctrl+Shift+O',
          language: 'auto'
        };
        currentOptions = { ...defaults, ...result.options };
        resolve(currentOptions);
      });
    });
  }

  function clearLegacyLogsForVersion() {
    if (logsClearedForVersion) return;
    logsClearedForVersion = true;
    chrome.storage.local.get('yocrc_logs_cleared_version', (result) => {
      if (result.yocrc_logs_cleared_version === PLUGIN_VERSION) return;
      chrome.storage.local.set({
        yocrc_logs: [],
        yocrc_logs_cleared_version: PLUGIN_VERSION
      });
    });
  }

  function createNode(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function normalizeShortcut(shortcut) {
    if (!shortcut || typeof shortcut !== 'string') return '';
    return shortcut
      .split('+')
      .map((part) => part.trim())
      .filter(Boolean)
      .join('+');
  }

  function isEditableTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function shortcutEventToString(e) {
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');

    let key = e.key;
    if (!key) return '';
    if (key === ' ') key = 'Space';
    if (key.length === 1) {
      key = key.toUpperCase();
    } else if (key === 'Escape') {
      key = 'Esc';
    }

    if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
      return '';
    }

    parts.push(key);
    return parts.join('+');
  }

  function shortcutMatchesEvent(shortcut, e) {
    const expected = normalizeShortcut(shortcut).toLowerCase();
    if (!expected) return false;
    const actual = shortcutEventToString(e).toLowerCase();
    return actual === expected;
  }

  function attachShortcutListener() {
    if (shortcutListenerAttached) return;
    shortcutListenerAttached = true;

    document.addEventListener('keydown', (e) => {
      if (state === 'selecting' || state === 'processing') return;
      if (isEditableTarget(e.target)) return;
      const shortcut = currentOptions && currentOptions.shortcut ? currentOptions.shortcut : '';
      if (!shortcut) return;
      if (!shortcutMatchesEvent(shortcut, e)) return;

      e.preventDefault();
      e.stopPropagation();
      logToStorage('info', 'Custom shortcut triggered selection', { shortcut, previousState: state });
      startSelection();
    }, true);
  }

  function extractVideoMetadata() {
    const meta = {
      url: window.location.href,
      title: '',
      author: '',
      authorUrl: '',
      publishDate: '',
      frameTimestamp: ''
    };

    const titleEl = document.querySelector(
      'ytd-watch-metadata h1 yt-formatted-string, .ytd-watch-flexy .title.ytd-video-primary-info-renderer, h1.ytd-watch-metadata, title'
    );
    if (titleEl) meta.title = titleEl.textContent.trim();

    const channelEl = document.querySelector('ytd-channel-name a, .ytd-video-owner-renderer a, #owner-name a');
    if (channelEl) {
      meta.author = channelEl.textContent.trim();
      meta.authorUrl = channelEl.href || '';
    }

    const dateEl = document.querySelector('#info-strings yt-formatted-string, #date yt-formatted-string');
    if (dateEl) meta.publishDate = dateEl.textContent.trim();

    const video = findVideoElement();
    if (video) {
      const ct = video.currentTime;
      const m = Math.floor(ct / 60);
      const s = Math.floor(ct % 60);
      meta.frameTimestamp = `${m}:${s.toString().padStart(2, '0')}`;
    }

    return meta;
  }

  function logToStorage(level, message, data) {
    chrome.storage.local.get('yocrc_logs', (result) => {
      const entries = result.yocrc_logs || [];
      entries.push({
        timestamp: new Date().toISOString(),
        version: PLUGIN_VERSION,
        level,
        message,
        data: data || null
      });
      if (entries.length > 200) entries.splice(0, entries.length - 200);
      chrome.storage.local.set({ yocrc_logs: entries });
    });
  }

  function ensureOcrHost() {
    if (ocrHostFrame && ocrHostFrame.isConnected && ocrHostReady) {
      return ocrHostReady;
    }

    if (!ocrHostListenerInstalled) {
      ocrHostListenerInstalled = true;
      window.addEventListener('message', (event) => {
        if (!ocrHostFrame || event.source !== ocrHostFrame.contentWindow) return;
        const msg = event.data;
        if (!msg || msg.source !== 'YT_OCR_HOST') return;

        if (msg.type === 'OCR_READY') {
          if (typeof ocrHostReadyResolve === 'function') {
            ocrHostReadyResolve(ocrHostFrame);
            ocrHostReadyResolve = null;
          }
          return;
        }

        const pending = ocrPending.get(msg.requestId);
        if (!pending) return;

        if (msg.type === 'OCR_PROGRESS') {
          if (typeof pending.onLog === 'function') pending.onLog(msg.progress);
          return;
        }

        ocrPending.delete(msg.requestId);
        if (msg.type === 'OCR_RESULT') {
          const layoutLines = msg.layout && Array.isArray(msg.layout.lines) ? msg.layout.lines : [];
          const layoutWords = msg.layout && Array.isArray(msg.layout.words) ? msg.layout.words : [];
          const layoutSymbols = msg.layout && Array.isArray(msg.layout.symbols) ? msg.layout.symbols : [];
          const layoutBlocks = msg.layout && Array.isArray(msg.layout.blocks) ? msg.layout.blocks : [];
          pending.resolve({
            text: msg.text || '',
            confidence: Number.isFinite(msg.confidence) ? msg.confidence : null,
            lines: Array.isArray(msg.lines) ? msg.lines : layoutLines,
            elapsed: Number.isFinite(msg.elapsed) ? msg.elapsed : null,
            layoutDetails: {
              lines: layoutLines,
              words: layoutWords,
              symbols: layoutSymbols,
              blocks: layoutBlocks
            }
          });
        } else if (msg.type === 'OCR_ERROR') {
          pending.reject(new Error(msg.error || 'Errore OCR host sconosciuto'));
        }
      });
    }

    ocrHostFrame = document.createElement('iframe');
    ocrHostFrame.className = 'yocrc-ocr-host';
    ocrHostFrame.setAttribute('aria-hidden', 'true');
    ocrHostFrame.style.cssText = [
      'position:fixed',
      'left:-9999px',
      'top:0',
      'width:1px',
      'height:1px',
      'opacity:0',
      'pointer-events:none',
      'border:0'
    ].join(';');

    const hostOrigin = new URL(OCR_HOST_URL).origin;

    ocrHostReady = new Promise((resolve, reject) => {
      ocrHostReadyResolve = resolve;
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout avvio OCR host (10s)'));
      }, 10000);

      function cleanup() {
        clearTimeout(timeoutId);
        window.removeEventListener('message', onReady);
      }

      function onReady(event) {
        if (event.source !== ocrHostFrame.contentWindow) return;
        if (event.origin !== hostOrigin) return;
        const msg = event.data;
        if (!msg || msg.source !== 'YT_OCR_HOST' || msg.type !== 'OCR_READY') return;
        cleanup();
        ocrHostReadyResolve = null;
        resolve(ocrHostFrame);
      }

      window.addEventListener('message', onReady);
      ocrHostFrame.addEventListener('error', () => {
        cleanup();
        reject(new Error('Caricamento OCR host fallito'));
      }, { once: true });
    }).catch((error) => {
      ocrHostReady = null;
      ocrHostReadyResolve = null;
      if (ocrHostFrame) {
        try { ocrHostFrame.remove(); } catch (_) {}
        ocrHostFrame = null;
      }
      throw error;
    });

    ocrHostFrame.src = OCR_HOST_URL;
    document.documentElement.appendChild(ocrHostFrame);
    return ocrHostReady;
  }

  function sendProgress(percent, stage) {
    currentProgress = {
      percent: Math.min(100, Math.max(0, Math.round(percent))),
      stage: stage || ''
    };
    chrome.runtime.sendMessage({
      action: 'ocrProgress',
      percent: currentProgress.percent,
      stage: currentProgress.stage
    }).catch(() => {});

    updateProgressOverlay(percent, stage);
  }

  function findVideoElement(requireDimensions = true) {
    const selectors = [
      'video.html5-main-video',
      '#movie_player video',
      '#player video',
      'ytd-player video',
      '.html5-video-container video',
      'video'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && (!requireDimensions || (el.videoWidth > 0 && el.videoHeight > 0))) return el;
    }
    return null;
  }

  function waitForVideoElement(maxWaitMs) {
    return new Promise((resolve) => {
      const video = findVideoElement(true);
      if (video) {
        logToStorage('info', 'Video element found immediately');
        resolve(video);
        return;
      }
      const anyVideo = findVideoElement(false);
      logToStorage('info', 'Video element not ready, waiting...', {
        maxWaitMs,
        hasVideoElement: !!anyVideo
      });
      const start = Date.now();
      let resolved = false;
      let interval = null;
      let timeoutId = null;
      const readyEvents = ['loadedmetadata', 'loadeddata', 'canplay', 'playing', 'timeupdate'];
      const onReadyEvent = () => {
        const readyVideo = findVideoElement(true);
        if (readyVideo && !resolved) {
          resolved = true;
          cleanup();
          logToStorage('info', 'Video element became ready via event', { waitedMs: Date.now() - start });
          resolve(readyVideo);
        }
      };
      const cleanup = () => {
        if (interval) clearInterval(interval);
        if (timeoutId) clearTimeout(timeoutId);
        if (anyVideo) {
          readyEvents.forEach((evt) => anyVideo.removeEventListener(evt, onReadyEvent));
        }
      };

      if (anyVideo) {
        readyEvents.forEach((evt) => anyVideo.addEventListener(evt, onReadyEvent, { once: false }));
      }
      interval = setInterval(() => {
        const v = findVideoElement(true);
        if (v && !resolved) {
          resolved = true;
          cleanup();
          logToStorage('info', 'Video element found after waiting', { waitedMs: Date.now() - start });
          resolve(v);
        } else if (Date.now() - start > maxWaitMs) {
          resolved = true;
          cleanup();
          logToStorage('warn', 'Video element wait timed out', {
            maxWaitMs,
            allVideos: document.querySelectorAll('video').length,
            playerContainer: !!document.querySelector('#movie_player'),
            ytdPlayer: !!document.querySelector('ytd-player'),
            bodyClasses: document.body.className.substring(0, 200)
          });
          resolve(null);
        }
      }, 300);

      timeoutId = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        cleanup();
        logToStorage('warn', 'Video element wait timed out', {
          maxWaitMs,
          allVideos: document.querySelectorAll('video').length,
          playerContainer: !!document.querySelector('#movie_player'),
          ytdPlayer: !!document.querySelector('ytd-player'),
          bodyClasses: document.body.className.substring(0, 200)
        });
        resolve(null);
      }, maxWaitMs);
    });
  }

  function nextPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function hideExtensionUiForCapture() {
    const selectors = [
      '.yocrc-progress-overlay',
      '.yocrc-result-panel',
      '.yocrc-selection-overlay',
      '.yocrc-selection-rect',
      '.yocrc-text-overlay'
    ].join(',');
    const nodes = Array.from(document.querySelectorAll(selectors));
    const previous = nodes.map((node) => ({
      node,
      visibility: node.style.visibility,
      pointerEvents: node.style.pointerEvents
    }));
    for (const item of previous) {
      item.node.style.visibility = 'hidden';
      item.node.style.pointerEvents = 'none';
    }
    return () => {
      for (const item of previous) {
        item.node.style.visibility = item.visibility;
        item.node.style.pointerEvents = item.pointerEvents;
      }
    };
  }

  function requestVisibleTabScreenshot() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'YT_OCR_CAPTURE' }, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message || 'Capture visible tab failed'));
          return;
        }
        resolve(response);
      });
    });
  }

  function resolveRuntimeLanguage(language) {
    const raw = String(language || 'eng').trim().toLowerCase();
    if (!raw || raw === 'auto') return 'eng';
    return raw;
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Impossibile caricare lo screenshot'));
      img.src = dataUrl;
    });
  }

  function captureVideoFrame(_video, rect) {
    return captureSelectionFromScreenshot(rect);
  }

  async function captureSelectionFromScreenshot(rect) {
    const restoreUi = hideExtensionUiForCapture();
    try {
      logToStorage('info', 'Capturing visible tab screenshot', {
        rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
        viewport: { width: window.innerWidth, height: window.innerHeight }
      });
      sendProgress(5, 'stageCapturingFrame');

      await nextPaint();

      const response = await requestVisibleTabScreenshot();
      if (!response || !response.ok || !response.dataUrl) {
        throw new Error(response?.error || 'Cattura screenshot fallita');
      }

      const img = await loadImage(response.dataUrl);
      const scaleX = img.naturalWidth / window.innerWidth;
      const scaleY = img.naturalHeight / window.innerHeight;

      const sx = Math.max(0, Math.round(rect.x * scaleX));
      const sy = Math.max(0, Math.round(rect.y * scaleY));
      const sw = Math.min(img.naturalWidth - sx, Math.round(rect.w * scaleX));
      const sh = Math.min(img.naturalHeight - sy, Math.round(rect.h * scaleY));

      if (sw < 8 || sh < 8) {
        throw new Error('Invalid crop area');
      }

      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = sw;
      cropCanvas.height = sh;
      const ctx = cropCanvas.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

      let outputCanvas = cropCanvas;
      const longSide = Math.max(sw, sh);
      let outputScale = 1;
      if (longSide > 2800) {
        outputScale = 2800 / longSide;
      } else if (longSide > 0 && longSide < 900) {
        outputScale = Math.min(3, 900 / longSide);
      }

      if (Math.abs(outputScale - 1) > 0.01) {
        outputCanvas = document.createElement('canvas');
        outputCanvas.width = Math.max(1, Math.round(sw * outputScale));
        outputCanvas.height = Math.max(1, Math.round(sh * outputScale));
        const scaledCtx = outputCanvas.getContext('2d', { willReadFrequently: true });
        scaledCtx.imageSmoothingEnabled = true;
        scaledCtx.imageSmoothingQuality = 'high';
        scaledCtx.drawImage(cropCanvas, 0, 0, outputCanvas.width, outputCanvas.height);
      }

      sendProgress(10, 'stageCapturingFrame');
      return {
        imageUrl: outputCanvas.toDataURL('image/png'),
        cropRect: `${sx},${sy} ${sw}x${sh}`,
        imageSize: `${outputCanvas.width}x${outputCanvas.height}`,
        screenshotSize: `${img.naturalWidth}x${img.naturalHeight}`,
        scale: { x: Number(scaleX.toFixed(3)), y: Number(scaleY.toFixed(3)) }
      };
    } catch (e) {
      const data = { error: e.message };
      if (currentOptions && currentOptions.extendedLog) data.stack = e.stack;
      logToStorage('error', 'Screenshot crop exception', data);
      throw e;
    } finally {
      restoreUi();
      await nextPaint();
    }
  }

  async function runOCR(imageUrl, language) {
    const startTime = performance.now();
    const runtimeLanguage = resolveRuntimeLanguage(language);

    logToStorage('info', 'OCR pipeline started', {
      requestedLanguage: language,
      runtimeLanguage,
      imageLength: imageUrl.length
    });
    sendProgress(20, 'stageInitializingWorker');

    const host = await ensureOcrHost();
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    return await new Promise((resolve, reject) => {
      const cleanup = async () => {
        ocrPending.delete(requestId);
      };

      const timeoutId = setTimeout(async () => {
        await cleanup();
        reject(new Error(`Timeout OCR host (${Math.round(OCR_HOST_TIMEOUT_MS / 1000)}s)`));
      }, OCR_HOST_TIMEOUT_MS);

      ocrPending.set(requestId, {
        onLog: (progress) => {
          if (!progress || !progress.status) return;
          const statusMap = {
            'loading tesseract core': { percent: 30, stage: 'stageLoadingTesseract' },
            'initializing tesseract': { percent: 35, stage: 'stageInitializingWorker' },
            'loading language traineddata': { percent: 45, stage: 'stageLoadingLanguage' },
            'loaded language traineddata': { percent: 55, stage: 'stageLoadingLanguage' },
            'initializing api': { percent: 55, stage: 'stageInitializingWorker' },
            'recognizing text': { percent: 60, stage: 'stageRecognizing' }
          };
          const mapped = statusMap[progress.status];
          if (mapped) {
            let pct = mapped.percent;
            if (progress.status === 'recognizing text' && progress.progress !== undefined) {
              pct = 60 + Math.round(progress.progress * 35);
            } else if (progress.progress !== undefined) {
              pct = mapped.percent + Math.round(progress.progress * 10);
            }
            sendProgress(pct, mapped.stage);
          }
          if (currentOptions && currentOptions.extendedLog) {
            logToStorage('info', 'OCR host progress', { status: progress.status, progress: progress.progress });
          }
        },
        resolve: async (result) => {
          clearTimeout(timeoutId);
          await cleanup();
          const elapsed = result.elapsed || Math.round(performance.now() - startTime);
          sendProgress(95, 'stageComplete');

          const text = (result.text || '').trim();
          const confidence = Number.isFinite(result.confidence) ? result.confidence : 0;
          const lines = Array.isArray(result.lines) ? result.lines : [];
          const layoutDetails = result.layoutDetails || { lines: [], words: [], symbols: [], blocks: [] };

          let quality = 'unknown';
          if (confidence >= 85) quality = 'high';
          else if (confidence >= 60) quality = 'medium';
          else if (confidence > 0) quality = 'low';

          let layout = 'unknown';
          if (lines.length > 3) layout = 'multi-line';
          else if (lines.length > 1) layout = 'few-line';
          else if (lines.length === 1) layout = 'single-line';

          logToStorage('info', 'OCR recognition completed', {
            textLength: text.length,
            confidence: Math.round(confidence),
            quality,
            layout,
            timing: elapsed,
            lineCount: lines.length
          });

          resolve({
            text,
            meta: {
              quality,
              layout,
              timing: elapsed,
              confidence: Math.round(confidence),
              fontMetrics: null,
              lines,
              layoutDetails
            }
          });
        },
        reject: async (error) => {
          clearTimeout(timeoutId);
          await cleanup();
          const message = error && error.message ? error.message : String(error || 'unknown');
          logToStorage('warn', 'OCR host failed', { error: message });
          reject(error);
        }
      });

      host.contentWindow.postMessage({
        source: 'YT_OCR_CONTENT',
        type: 'OCR_RECOGNIZE',
        requestId,
        image: imageUrl,
        lang: runtimeLanguage || 'eng',
        psm: '6'
      }, new URL(OCR_HOST_URL).origin);
    });
  }

function cleanupSelection() {
  if (activeSelectionCleanup) {
    const cleanup = activeSelectionCleanup;
    activeSelectionCleanup = null;
    cleanup();
    return;
  }
  if (selectionOverlay) {
    selectionOverlay.removeEventListener('mousedown', onOverlayMouseDown);
    selectionOverlay.removeEventListener('mousemove', onOverlayMouseMove);
    selectionOverlay.removeEventListener('mouseup', onOverlayMouseUp);
    selectionOverlay.remove();
    selectionOverlay = null;
  }
  if (selectionRect) {
    selectionRect.remove();
    selectionRect = null;
  }
  if (cancelHint) {
    cancelHint.remove();
    cancelHint = null;
  }
  window.removeEventListener('mousemove', onOverlayMouseMove, true);
  window.removeEventListener('mouseup', onOverlayMouseUp, true);
  document.removeEventListener('keydown', onDocumentKeyDown, true);
}

  function onDocumentKeyDown(e) {
    if (e.key === 'Escape') {
      cleanupSelection();
      state = 'idle';
      isMouseDown = false;
      chrome.runtime.sendMessage({ action: 'selectionCancelled' }).catch(() => {});
    }
  }

  function onOverlayMouseDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    startX = e.clientX;
    startY = e.clientY;
    isMouseDown = true;

    if (!selectionRect) {
      selectionRect = document.createElement('div');
      selectionRect.className = 'yocrc-selection-rect';
      document.body.appendChild(selectionRect);
    }

    selectionRect.style.left = startX + 'px';
    selectionRect.style.top = startY + 'px';
    selectionRect.style.width = '0px';
    selectionRect.style.height = '0px';
  }

  function onOverlayMouseMove(e) {
    if (!isMouseDown || !selectionRect) return;
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    selectionRect.style.left = x + 'px';
    selectionRect.style.top = y + 'px';
    selectionRect.style.width = w + 'px';
    selectionRect.style.height = h + 'px';
  }

  async function onOverlayMouseUp(e) {
    if (!isMouseDown) return;
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    isMouseDown = false;

    if (!selectionRect) {
      cleanupSelection();
      return;
    }

    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    cleanupSelection();

    await processSelectedRect({ x, y, w, h }, 'selected-area');
  }

  async function processSelectedRect(rect, mode) {
    const { x, y, w, h } = rect;
    currentSelectionRect = { x, y, w, h };

    if (w < 10 || h < 10) {
      state = 'idle';
      logToStorage('warn', 'Selection too small, cancelled', { w, h });
      chrome.runtime.sendMessage({ action: 'selectionCancelled' }).catch(() => {});
      return;
    }

    state = 'processing';
    processingStartTime = performance.now();

    showProgressOverlay();

    logToStorage('info', 'Processing started', {
      selectionRect: { x, y, w, h },
      url: window.location.href
    });

    try {
      const capture = await captureVideoFrame(null, { x, y, w, h });
      const videoMeta = extractVideoMetadata();

      const lang = 'auto';
      const ocrResult = await runOCR(capture.imageUrl, lang);
      currentCaptureImage = capture.imageUrl;

      currentText = ocrResult.text;
      currentMeta = {
        ...videoMeta,
        quality: ocrResult.meta.quality,
        layout: ocrResult.meta.layout,
        timing: ocrResult.meta.timing,
        confidence: ocrResult.meta.confidence,
        fontMetrics: ocrResult.meta.fontMetrics,
        cropRect: capture.cropRect,
        imageSize: capture.imageSize,
        screenshotSize: capture.screenshotSize,
        captureScale: capture.scale,
        captureMethod: 'visible-tab-screenshot',
        captureMode: mode || 'selected-area',
        requestedLanguage: lang,
        runtimeLanguage: resolveRuntimeLanguage(lang),
        layoutDetails: ocrResult.meta.layoutDetails
      };

      if (currentOptions && currentOptions.localHistory) {
        saveToHistory(currentText, currentMeta);
      }

      chrome.storage.local.set({
        yocrc_lastResult: { text: currentText, meta: currentMeta, timestamp: Date.now() }
      });

      state = 'result';
      removeProgressOverlay();
      showResultPanel(currentText, currentMeta);

      chrome.runtime.sendMessage({
        action: 'ocrResult',
        text: currentText,
        meta: currentMeta
      }).catch(() => {});

      logToStorage('info', 'OCR pipeline completed successfully', {
        quality: ocrResult.meta.quality,
        timing: ocrResult.meta.timing,
        textLength: ocrResult.text.length
      });
  } catch (err) {
    state = 'error';
    currentMeta = extractVideoMetadata();
    currentMeta.error = err.message;
    showProgressError(err.message || 'OCR fallito. Riprova.');

    chrome.runtime.sendMessage({
      action: 'ocrError',
      message: err.message || 'OCR failed. Please try again.',
      meta: currentMeta
    }).catch(() => {});

    const failureData = { error: err.message };
    if (currentOptions && currentOptions.extendedLog) failureData.stack = err.stack;
    logToStorage('error', 'Processing failed', failureData);
  }
  }

  function saveToHistory(text, meta) {
    chrome.storage.local.get('yocrc_history', (result) => {
      const history = result.yocrc_history || [];
      history.unshift({ text, meta, id: Date.now(), capturedAt: new Date().toISOString() });
      if (history.length > 50) history.splice(50);
      chrome.storage.local.set({ yocrc_history: history });
    });
  }

function showProgressOverlay() {
  removeProgressOverlay();

  progressOverlay = document.createElement('div');
  progressOverlay.className = 'yocrc-progress-overlay';

  const progressPanel = createNode('div', 'yocrc-progress-panel');
  const spinner = createNode('div', 'yocrc-spinner');
  const label = createNode('div', 'yocrc-progress-label', 'OCR in corso...');
  const track = createNode('div', 'yocrc-progress-track');
  const fill = createNode('div', 'yocrc-progress-fill');
  fill.style.width = '0%';
  const info = createNode('div', 'yocrc-progress-info');
  const pct = createNode('span', 'yocrc-progress-pct', '0%');
  const stage = createNode('span', 'yocrc-progress-stage');
  const error = createNode('div', 'yocrc-progress-error');
  error.style.display = 'none';
  const actions = createNode('div', 'yocrc-progress-actions');
  const reportBtn = createNode('button', 'yocrc-btn yocrc-btn-report', 'Copia report');
  reportBtn.type = 'button';

  track.appendChild(fill);
  info.append(pct, stage);
  actions.appendChild(reportBtn);
  progressPanel.append(spinner, label, track, info, error, actions);
  progressOverlay.appendChild(progressPanel);
  document.body.appendChild(progressOverlay);

  progressBar = fill;
  progressPercent = pct;
  progressStage = stage;
  makeDraggable(progressPanel, progressPanel);
  reportBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyExecutionReport();
    if (ok) {
      reportBtn.textContent = 'Copiato!';
      setTimeout(() => {
        reportBtn.textContent = 'Copia report';
      }, 1500);
    }
  });
}

  function updateProgressOverlay(percent, stage) {
    if (!progressOverlay) return;
    const p = Math.max(0, Math.min(100, percent || 0));
    if (progressBar) progressBar.style.width = p + '%';
    if (progressPercent) progressPercent.textContent = p + '%';
    if (progressStage && stage) {
      const stageLabels = {
        'stageCapturingFrame': 'Cattura screenshot...',
        'stageLoadingTesseract': 'Caricamento OCR...',
        'stageInitializingWorker': 'Inizializzazione...',
        'stageLoadingLanguage': 'Caricamento lingua...',
        'stageRecognizing': 'Riconoscimento testo...',
        'stageComplete': 'Completato',
        'stageFailed': 'Fallito'
      };
      progressStage.textContent = stageLabels[stage] || stage;
    }
  }

function removeProgressOverlay() {
  if (progressOverlay) {
    progressOverlay.remove();
    progressOverlay = null;
    progressBar = null;
    progressPercent = null;
    progressStage = null;
  }
}

async function getStorageSnapshot(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result || {}));
  });
}

function stringifyReportValue(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function buildExecutionReportText() {
  const snapshot = await getStorageSnapshot(['options', 'yocrc_logs', 'yocrc_lastResult', 'yocrc_history']);
  const logs = snapshot.yocrc_logs || [];
  const recentLogs = logs.slice(-30);
  const elapsed = processingStartTime ? Math.round(performance.now() - processingStartTime) : null;
  const reportLines = [
    'YouTube OCR Copy - execution report',
    `Generated at: ${new Date().toISOString()}`,
    `Plugin version: ${PLUGIN_VERSION}`,
    `Page URL: ${window.location.href}`,
    `Document title: ${document.title || '-'}`,
    `State: ${state}`,
    `Progress: ${currentProgress.percent}%${currentProgress.stage ? ` (${currentProgress.stage})` : ''}`,
    `Elapsed: ${elapsed !== null ? `${elapsed}ms` : '-'}`,
    '',
    'Operation info:',
    `Autore Video: ${currentMeta?.author || '-'}`,
    `Nome Video: ${currentMeta?.title || document.title || '-'}`,
    `Data Pubblicazione: ${currentMeta?.publishDate || '-'}`,
    `URL: ${currentMeta?.url || window.location.href}`,
    `Momento estrazione frame/fotogramma: ${currentMeta?.frameTimestamp || '-'}`,
    `Metodo cattura: ${currentMeta?.captureMethod || '-'}`,
    `OCR source: selected image crop only`,
    '',
    `Selected rect: ${stringifyReportValue(currentSelectionRect)}`,
    `Current options: ${stringifyReportValue(currentOptions)}`,
    `Current metadata: ${stringifyReportValue(currentMeta)}`,
    `Current text length: ${currentText ? currentText.length : 0}`,
    `Current text preview: ${currentText ? currentText.slice(0, 500) : '-'}`,
    `Last result: ${stringifyReportValue(snapshot.yocrc_lastResult)}`,
    `History entries: ${(snapshot.yocrc_history || []).length}`,
    '',
    'Recent logs:'
  ];

  if (recentLogs.length === 0) {
    reportLines.push('-');
  } else {
    for (const entry of recentLogs) {
      const dataPart = entry.data ? ` | data=${stringifyReportValue(entry.data)}` : '';
      reportLines.push(`${entry.timestamp} [${entry.level}] ${entry.message}${dataPart}`);
    }
  }

  return reportLines.join('\n');
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }
}

async function copyExecutionReport() {
  const report = await buildExecutionReportText();
  const ok = await copyTextToClipboard(report);
  if (ok) {
    logToStorage('info', 'Execution report copied to clipboard', {
      state,
      progress: currentProgress,
      selectionRect: currentSelectionRect
    });
  }
  return ok;
}

function showProgressError(errorMessage) {
  if (!progressOverlay) return;
  progressOverlay.classList.add('yocrc-has-error');
  progressOverlay.addEventListener('click', () => {
    removeProgressOverlay();
    state = 'idle';
  });
  const errorEl = progressOverlay.querySelector('.yocrc-progress-error');
  if (errorEl) {
    errorEl.style.display = 'block';
    errorEl.textContent = 'Errore: ' + errorMessage;
  }
  const spinner = progressOverlay.querySelector('.yocrc-spinner');
  if (spinner) spinner.style.display = 'none';
  sendProgress(0, 'stageFailed');
  const label = progressOverlay.querySelector('.yocrc-progress-label');
  if (label) label.textContent = 'Errore OCR';
}

  function removeResultPanel() {
    if (resultPanel) {
      resultPanel.remove();
      resultPanel = null;
    }
    removeOptionsPanel();
  }

  function removeOptionsPanel() {
    if (optionsPanel) {
      optionsPanel.remove();
      optionsPanel = null;
    }
  }

  function showResultPanel(text, meta) {
    removeResultPanel();
    removeTextOverlay();

    resultPanel = document.createElement('div');
    resultPanel.className = 'yocrc-result-panel';

    const header = createNode('div', 'yocrc-result-header');
    const heading = createNode('div', 'yocrc-result-heading');
    heading.append(
      createNode('span', 'yocrc-result-plugin', `YouTube OCR Copy v${PLUGIN_VERSION}`),
      createNode('span', 'yocrc-result-title', 'OCR Result')
    );
    const optionsBtn = createNode('button', 'yocrc-result-options', '\u2699');
    optionsBtn.type = 'button';
    optionsBtn.title = 'Opzioni';
    optionsBtn.setAttribute('aria-label', 'Opzioni');
    const closeBtn = createNode('button', 'yocrc-result-close', '\u00D7');
    closeBtn.type = 'button';
    closeBtn.title = 'Chiudi';
    header.append(heading, optionsBtn, closeBtn);

    const textBox = createNode('div', 'yocrc-result-text');
    if (text) {
      textBox.textContent = text;
    } else {
      textBox.appendChild(createNode('em', '', 'Nessun testo rilevato'));
    }

    const metaBox = createNode('div', 'yocrc-result-meta');
    const metaParts = [];
    if (meta && meta.confidence) metaParts.push(`Confidence: ${meta.confidence}%`);
    if (meta && meta.timing) metaParts.push(`${meta.timing}ms`);
    metaBox.textContent = metaParts.join(' \u2022 ');

    const actions = createNode('div', 'yocrc-result-actions');
    const copyBtn = createNode('button', 'yocrc-btn yocrc-btn-copy', 'Copia testo');
    copyBtn.type = 'button';
    const newBtn = createNode('button', 'yocrc-btn yocrc-btn-new', 'Nuova selezione');
    newBtn.type = 'button';
    actions.append(copyBtn, newBtn);

    resultPanel.append(header);
    resultPanel.append(textBox, metaBox, actions);

    const banner = createNode('div', 'yocrc-result-banner', 'Banner pubblicitario');
    banner.setAttribute('aria-label', 'Area banner pubblicitario');
    resultPanel.appendChild(banner);

    document.body.appendChild(resultPanel);
    positionResultPanelAtSelection(resultPanel, currentSelectionRect);
    makeDraggable(resultPanel, header);

    closeBtn.addEventListener('click', () => {
      removeResultPanel();
      state = 'idle';
    });

    optionsBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showOptionsPanel(resultPanel);
    });

    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = 'Copiato!';
        copyBtn.style.background = '#4caf50';
        setTimeout(() => {
          copyBtn.textContent = 'Copia testo';
          copyBtn.style.background = '';
        }, 1500);
      }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      });
    });

    newBtn.addEventListener('click', () => {
      removeResultPanel();
      state = 'idle';
      startSelection();
    });
  }

  function showOptionsPanel(anchorPanel) {
    removeOptionsPanel();

    optionsPanel = document.createElement('div');
    optionsPanel.className = 'yocrc-options-panel';

    const header = createNode('div', 'yocrc-options-header');
    const title = createNode('span', 'yocrc-options-title', 'Opzioni');
    const closeBtn = createNode('button', 'yocrc-options-close', '\u00D7');
    closeBtn.type = 'button';
    closeBtn.title = 'Chiudi';
    header.append(title, closeBtn);

    const body = createNode('div', 'yocrc-options-body');
    optionsPanel.append(header, body);

    document.body.appendChild(optionsPanel);
    renderInlineOptions(body);
    positionOptionsPanel(optionsPanel, anchorPanel);
    makeDraggable(optionsPanel, header);

    closeBtn.addEventListener('click', removeOptionsPanel);
  }

  function renderInlineOptions(container) {
    if (!container) return;
    const opts = {
      overlay: true,
      extendedMeta: true,
      fontMetrics: false,
      localHistory: false,
      banner: true,
      extendedLog: false,
      exportTxt: true,
      exportJson: true,
      shortcut: 'Ctrl+Shift+O',
      language: 'auto',
      ...(currentOptions || {})
    };
    container.replaceChildren();

    const infoSection = createNode('div', 'yocrc-options-section');
    infoSection.appendChild(createNode('div', 'yocrc-options-section-title', 'Info estrazione'));

    const infoRows = [
      ['Autore Video', currentMeta?.author || '-', currentMeta?.authorUrl || ''],
      ['Nome Video', currentMeta?.title || document.title || '-'],
      ['Data Pubblicazione', currentMeta?.publishDate || '-'],
      ['URL', currentMeta?.url || window.location.href, currentMeta?.url || window.location.href],
      ['Momento estrazione frame/fotogramma', currentMeta?.frameTimestamp || '-'],
      ['Metodo cattura', currentMeta?.captureMode || currentMeta?.captureMethod || '-'],
      ['Ritaglio', currentMeta?.cropRect || '-'],
      ['Immagine OCR', currentMeta?.imageSize || '-'],
      ['Lingua rilevata/ottimizzata', currentMeta?.runtimeLanguage || 'eng'],
      ['Confidence', currentMeta?.confidence ? `${currentMeta.confidence}%` : '-'],
      ['Tempo OCR', currentMeta?.timing ? `${currentMeta.timing}ms` : '-']
    ];

    infoRows.forEach(([label, value, href]) => {
      const row = createNode('div', 'yocrc-info-row');
      const valueNode = href ? createInfoLink(value, href) : createNode('span', 'yocrc-info-value', value);
      row.append(createNode('span', 'yocrc-info-label', label), valueNode);
      infoSection.appendChild(row);
    });
    container.appendChild(infoSection);

    const commandSection = createNode('div', 'yocrc-options-section');
    commandSection.appendChild(createNode('div', 'yocrc-options-section-title', 'Comandi'));

    const shortcutRow = document.createElement('label');
    shortcutRow.className = 'yocrc-option-row yocrc-option-row-stack';
    shortcutRow.appendChild(createNode('span', '', 'Shortcut'));
    const shortcutInput = document.createElement('input');
    shortcutInput.type = 'text';
    shortcutInput.value = opts.shortcut || 'Ctrl+Shift+O';
    shortcutInput.readOnly = true;
    shortcutRow.appendChild(shortcutInput);
    shortcutInput.addEventListener('focus', () => {
      shortcutInput.value = 'Premi la sequenza...';
    });
    shortcutInput.addEventListener('keydown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        shortcutInput.value = opts.shortcut || 'Ctrl+Shift+O';
        shortcutInput.blur();
        return;
      }
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
      const nextShortcut = shortcutEventToString(event);
      if (!nextShortcut) return;
      opts.shortcut = nextShortcut;
      currentOptions = { ...opts };
      shortcutInput.value = nextShortcut;
      chrome.storage.local.set({ options: currentOptions });
      shortcutInput.blur();
    });
    shortcutInput.addEventListener('blur', () => {
      shortcutInput.value = opts.shortcut || 'Ctrl+Shift+O';
    });
    commandSection.appendChild(shortcutRow);
    container.appendChild(commandSection);
  }

  function createInfoLink(label, href) {
    const link = document.createElement('a');
    link.className = 'yocrc-info-value yocrc-info-link';
    link.textContent = label || href;
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }

  function positionOptionsPanel(panel, anchorPanel) {
    if (!panel || !anchorPanel) return;
    const anchor = anchorPanel.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const left = anchor.left + anchor.width - panelRect.width;
    const top = anchor.top + 44;
    const maxLeft = window.innerWidth - panelRect.width - 12;
    const maxTop = window.innerHeight - panelRect.height - 12;
    panel.style.left = Math.max(12, Math.min(maxLeft, left)) + 'px';
    panel.style.top = Math.max(12, Math.min(maxTop, top)) + 'px';
  }

  function positionResultPanelAtSelection(panel, rect) {
    if (!panel || !rect) return;
    const panelRect = panel.getBoundingClientRect();
    const left = rect.x + (rect.w / 2) - (panelRect.width / 2);
    const top = rect.y + (rect.h / 2) - (panelRect.height / 2);
    const maxLeft = window.innerWidth - panelRect.width - 12;
    const maxTop = window.innerHeight - panelRect.height - 12;
    panel.style.left = Math.max(12, Math.min(maxLeft, left)) + 'px';
    panel.style.top = Math.max(12, Math.min(maxTop, top)) + 'px';
    panel.style.right = 'auto';
  }

  function makeDraggable(panel, handle) {
    if (!panel || !handle) return;
    handle.classList.add('yocrc-drag-handle');
    handle.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || event.target.closest('button')) return;
      event.preventDefault();
      event.stopPropagation();

      const rect = panel.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      panel.style.position = 'fixed';
      panel.style.left = rect.left + 'px';
      panel.style.top = rect.top + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';

      const onMove = (moveEvent) => {
        const nextLeft = moveEvent.clientX - offsetX;
        const nextTop = moveEvent.clientY - offsetY;
        const maxLeft = window.innerWidth - panel.offsetWidth - 8;
        const maxTop = window.innerHeight - panel.offsetHeight - 8;
        panel.style.left = Math.max(8, Math.min(maxLeft, nextLeft)) + 'px';
        panel.style.top = Math.max(8, Math.min(maxTop, nextTop)) + 'px';
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove, true);
        window.removeEventListener('mouseup', onUp, true);
      };

      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('mouseup', onUp, true);
    });
  }

  function createTextOverlay(text, lines, rect) {
    removeTextOverlay();

    const overlay = document.createElement('div');
    overlay.className = 'yocrc-text-overlay';
    overlay.textContent = text;
    overlay.style.left = (rect.x) + 'px';
    overlay.style.top = (rect.y) + 'px';
    overlay.style.maxWidth = rect.w + 'px';

    const fontSize = Math.max(10, Math.min(rect.h / (lines.length || 1), 24));
    overlay.style.fontSize = fontSize + 'px';

    document.body.appendChild(overlay);
    textOverlay = overlay;
  }

  function removeTextOverlay() {
    if (textOverlay) {
      textOverlay.remove();
      textOverlay = null;
    }
  }

  async function startSelection() {
    if (state === 'selecting' || state === 'processing') {
      logToStorage('warn', 'startSelection ignored, busy', { state });
      return;
    }

    await loadOptions();

    const previousState = state;
    cleanupSelection();
    removeTextOverlay();
    removeResultPanel();
    removeProgressOverlay();
    state = 'selecting';
    isMouseDown = false;
    processingStartTime = null;
    currentSelectionRect = null;
    currentCaptureImage = null;
    currentProgress = { percent: 0, stage: '' };

    selectionOverlay = document.createElement('div');
    selectionOverlay.className = 'yocrc-selection-overlay';
    selectionOverlay.addEventListener('mousedown', onOverlayMouseDown);
    window.addEventListener('mousemove', onOverlayMouseMove, true);
    window.addEventListener('mouseup', onOverlayMouseUp, true);
    document.documentElement.appendChild(selectionOverlay);

    cancelHint = document.createElement('div');
    cancelHint.className = 'yocrc-cancel-hint';
    cancelHint.textContent = 'Draw a rectangle to select area \u2022 Press Esc to cancel';
    document.documentElement.appendChild(cancelHint);

    document.addEventListener('keydown', onDocumentKeyDown, true);
    activeSelectionCleanup = () => {
      if (selectionOverlay) {
        selectionOverlay.removeEventListener('mousedown', onOverlayMouseDown);
        selectionOverlay.remove();
        selectionOverlay = null;
      }
      if (selectionRect) {
        selectionRect.remove();
        selectionRect = null;
      }
      if (cancelHint) {
        cancelHint.remove();
        cancelHint = null;
      }
      window.removeEventListener('mousemove', onOverlayMouseMove, true);
      window.removeEventListener('mouseup', onOverlayMouseUp, true);
      document.removeEventListener('keydown', onDocumentKeyDown, true);
      isMouseDown = false;
    };

    logToStorage('info', 'Area selection started', {
      url: window.location.href,
      previousState,
      videoDetected: !!findVideoElement()
    });

    chrome.runtime.sendMessage({ action: 'selectionStarted' }).catch(() => {});
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id && sender.id !== chrome.runtime.id) return false;
    if (message.action === 'startSelection') {
      logToStorage('info', 'Received startSelection from popup/background');
      startSelection();
      sendResponse({ started: true });
    } else if (message.action === 'getState') {
      sendResponse({ state, version: PLUGIN_VERSION, text: currentText, meta: currentMeta });
    } else if (message.action === 'removeOverlay') {
      removeTextOverlay();
      removeResultPanel();
      sendResponse({ removed: true });
    } else if (message.action === 'ping') {
      sendResponse({ alive: true, version: PLUGIN_VERSION, state });
    } else if (message.action === 'getLastResult') {
      sendResponse({ text: currentText, meta: currentMeta, state });
    } else if (message.action === 'copyExecutionReport') {
      copyExecutionReport().then((copied) => {
        sendResponse({
          copied,
          state,
          progress: currentProgress,
          selectionRect: currentSelectionRect
        });
      }).catch((err) => {
        sendResponse({
          copied: false,
          error: err.message,
          state,
          progress: currentProgress,
          selectionRect: currentSelectionRect
        });
      });
      return true;
    }
    return true;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.options) return;
    currentOptions = { ...(currentOptions || {}), ...(changes.options.newValue || {}) };
  });

  loadOptions();
  clearLegacyLogsForVersion();
  attachShortcutListener();
  logToStorage('info', 'Content script initialized', {
    version: PLUGIN_VERSION,
    url: window.location.href,
    videoCount: document.querySelectorAll('video').length
  });
})();
