// background.js — Service Worker MV3 — Learning Hub v2.0 RC1

importScripts(
  'schemas/app-schema.js',
  'core/storage-migrations.js',
  'core/learning-document.js',
  'core/app-logger.js',
  'renderers/export-formatters.js',
  'utils/transcript.js',
  'utils/storage.js',
  'utils/gemini.js',
  'utils/markdown-generator.js',
  'utils/filesystem.js'
);

const appReady = initializeApp();

async function initializeApp() {
  try {
    await Storage.ensureInitialized();
    AppLogger.info('Storage initialized', { schemaVersion: AppSchema.VERSION });
  } catch (error) {
    AppLogger.error('Storage initialization failed', error);
    throw error;
  }
}

// ── Message Router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  appReady
    .then(() => handleMessage(message, sender))
    .then(sendResponse)
    .catch(err => sendResponse({ success: false, error: err.message }));
  return true;
});

async function handleMessage(message) {
  switch (message.action) {
    case 'GENERATE_SUMMARY':        return await generateSummary(message.videoData, message.generationOptions || {});
    case 'SAVE_SUMMARY':            return await saveSummary(message.summary, message.rawMarkdown, message.generationOptions || {});
    case 'ADD_TO_QUEUE':            return await addToQueue(message.videoData);
    case 'IMPORT_BATCH_URLS':       return await importBatchUrls(message.input || '');
    case 'EXTRACT_PENDING_SUMMARY': return await startBackgroundExtraction(message.id);
    case 'REDOWNLOAD_SUMMARY':      return await redownloadSummary(message.id);
    case 'SHOW_DOWNLOAD':           return await showDownloadFile(message.id);
    case 'EXPORT_SUMMARY':          return await exportSummary(message.id, message.format || 'mdx');
    case 'EXTRACT_ALL_PENDING':     return await extractAllPending(message.ids);
    case 'OPEN_DASHBOARD':          return await openDashboard();
    case 'GET_CREATORS':            return { success: true, creators: await Storage.getCreators() };
    case 'ADD_CREATOR':             return await addCreator(message.url);
    case 'REMOVE_CREATOR':          await Storage.removeCreator(message.channelId); return { success: true };
    case 'GET_SUMMARIES':           return { success: true, summaries: await Storage.getSummaries() };
    case 'DELETE_SUMMARY':          await Storage.deleteSummary(message.id); return { success: true };
    case 'SEARCH_SUMMARIES':        return { success: true, summaries: await Storage.searchSummaries(message.query) };
    case 'GET_FEED':                return await getFeed(message.forceRefresh);
    case 'GET_SETTINGS':            return { success: true, settings: await Storage.getSettings() };
    case 'SAVE_SETTINGS':           await Storage.saveSettings(message.settings); return { success: true };
    case 'STORE_FS_HANDLE':         await FileSystemUtils.saveHandle(message.handle); return { success: true };
    case 'CLEAR_FS_HANDLE':         await FileSystemUtils.clearHandle(); return { success: true };
    case 'GET_STATS':               return { success: true, stats: await Storage.getStats() };
    case 'CHECK_VIDEO_SUMMARIZED':  return await checkVideoSummarized(message.videoId);
    case 'REFRESH_CREATOR_STATS':   return await refreshCreatorStats(message.channelId);
    case 'REFRESH_ALL_CREATORS':    return await refreshAllCreators();
    case 'DEDUPLICATE_CREATORS':    return await deduplicateCreators();
    case 'ANALYZE_WEBPAGE':         return await analyzeWebpage(message.articleData);
    case 'UPDATE_CREATOR_TOPICS':   return await updateCreatorTopics(message.channelId, message.topics);
    case 'CHECK_TOPIC_ALERTS':      return await checkTopicsAndNotify(message.channelId);
    case 'CHAT_QUERY':              return await chatQuery(message.question);
    case 'SEMANTIC_SEARCH':         return await semanticSearch(message.query);
    case 'CHECK_AND_QUEUE':         return await checkAndQueueNewVideos(message.channelId || null);
    case 'QUEUE_ALL_NEW':           return await queueAllNew();
    case 'GET_NEW_VIDEOS_COUNT':    return await getNewVideosCount(message.channelId || null);
    case 'TOGGLE_PRIORITY':         return await togglePriority(message.channelId);
    case 'UPDATE_QUEUE_SETTINGS':   return await updateQueueSettings(message.channelId, message.settings);
    case 'CATCHUP_QUEUE':           return await catchupQueue(message.channelId, message.count);
    case 'ANALYZE_CHANNEL_MASS_QUEUE': return await analyzeChannelForMassQueue(message.channelId, message.options || {});
    case 'QUEUE_CHANNEL_MASS':      return await queueChannelMass(message.channelId, message.filters || {});
    case 'SETUP_AUTO_QUEUE_ALARM':  setupAutoQueueAlarm(message.intervalHours); return { success: true };
    default: throw new Error(`Azione non riconosciuta: ${message.action}`);
  }
}

// ── Keyboard Shortcut: Aggiungi alla coda ─────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'add-to-queue') return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('youtube.com/watch')) {
      showNotification('Codex_Chrome-PlugIn_YouTube-Learn', 'Apri un video YouTube per aggiungerlo alla coda.');
      return;
    }

    // Leggi dati video dalla pagina
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: extractPageVideoDataForQueue,
    });
    const pageData = res?.result;
    if (!pageData?.videoId) {
      showNotification('Codex_Chrome-PlugIn_YouTube-Learn ⚠️', 'Impossibile leggere il video. Ricarica la pagina.');
      return;
    }

    const result = await addToQueue(pageData);
    if (result.success) {
      // Toast + suono nella pagina
      chrome.tabs.sendMessage(tab.id, {
        action: 'SHOW_QUEUE_TOAST',
        status: 'success',
        title: pageData.title,
      }).catch(() => {}); // silenzioso se content script non risponde
    } else if (result.reason === 'already_exists') {
      chrome.tabs.sendMessage(tab.id, {
        action: 'SHOW_QUEUE_TOAST',
        status: 'already',
        title: pageData.title,
      }).catch(() => {});
    }
  } catch (e) {
    showNotification('Codex_Chrome-PlugIn_YouTube-Learn ❌', e.message);
  }
});

// Funzione eseguita in world:MAIN per la coda (auto-contenuta, async con retry SPA)
async function extractPageVideoDataForQueue() {
  const urlVideoId = new URLSearchParams(location.search).get('v');

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const pr = window.ytInitialPlayerResponse;
      const vd = pr?.videoDetails;

      // SPA check: verifica che i dati corrispondano al video corrente nell'URL
      if (vd?.videoId && (!urlVideoId || vd.videoId === urlVideoId)) {
        const mf = pr.microformat?.playerMicroformatRenderer || {};
        let captionTracks = [];
        try {
          captionTracks = pr.captions.playerCaptionsTracklistRenderer.captionTracks.map(c => ({
            baseUrl: c.baseUrl, languageCode: c.languageCode,
            kind: c.kind || 'manual', name: c.name?.simpleText || c.languageCode,
          }));
        } catch {}
        return {
          videoId: vd.videoId,
          title: vd.title || document.title,
          channelId: vd.channelId || '',
          channelName: vd.author || '',
          duration: parseInt(vd.lengthSeconds || 0),
          viewCount: parseInt(vd.viewCount || 0),
          description: (vd.shortDescription || '').slice(0, 500),
          publishDate: mf.publishDate || mf.uploadDate || '',
          isLive: !!(vd.isLiveContent || mf.liveBroadcastDetails),
          liveBroadcastContent: vd.isLiveContent ? 'live' : (mf.liveBroadcastDetails ? 'upcoming' : 'none'),
          contentType: classifyQueueContentType({
            durationSec: parseInt(vd.lengthSeconds || 0),
            liveBroadcastContent: vd.isLiveContent ? 'live' : (mf.liveBroadcastDetails ? 'upcoming' : 'none'),
          }),
          durationBucket: getDurationBucket(parseInt(vd.lengthSeconds || 0)),
          captionTracks,
        };
      }
    } catch {}

    // Attendi che YouTube SPA aggiorni ytInitialPlayerResponse
    if (attempt < 3) await new Promise(r => setTimeout(r, 1500));
  }
  return null;
}

// ── Aggiungi alla coda (senza estrarre) ──────────────────────────────────────

async function addToQueue(videoData) {
  const summaries = await Storage.getSummaries();
  const exists = summaries.find(s => s.videoId === videoData.videoId);
  if (exists) return { success: false, reason: 'already_exists' };
  const duration = parseInt(videoData.duration || 0, 10);
  const liveBroadcastContent = videoData.liveBroadcastContent || (videoData.isLive ? 'live' : 'none');
  const saved = await Storage.saveSummary(LearningDocument.buildPendingSummary({
    ...videoData,
    url: `https://youtube.com/watch?v=${videoData.videoId}`,
    duration,
    liveBroadcastContent,
    contentType: videoData.contentType || classifyQueueContentType({ durationSec: duration, liveBroadcastContent }),
    durationBucket: videoData.durationBucket || getDurationBucket(duration),
    platform: 'youtube',
  }));

  // ── Auto-follow: se il creator non è ancora seguito, aggiungilo ──
  if (videoData.channelId) {
    const creators = await Storage.getCreators();
    const alreadyFollowed = creators.some(c => c.channelId === videoData.channelId);
    if (!alreadyFollowed && videoData.channelName) {
      await Storage.addCreator({
        channelId:   videoData.channelId,
        channelName: videoData.channelName,
        channelUrl:  `https://youtube.com/channel/${videoData.channelId}`,
        platform:    'youtube',
        avatar:      null,
        stats:       null,
        // followedAt impostato da Storage.addCreator
      });
    }
  }

  return { success: true, id: saved.id };
}

// ── Estrazione in background (da dashboard, senza aprire popup) ───────────────

async function startBackgroundExtraction(id) {
  // Risponde subito, esegue in background
  doBackgroundExtraction(id).catch(err => {
    showNotification('Codex_Chrome-PlugIn_YouTube-Learn ❌', `Errore estrazione: ${err.message}`);
  });
  return { success: true, queued: true };
}

async function doBackgroundExtraction(id) {
  const summaries = await Storage.getSummaries();
  const pending   = summaries.find(s => s.id === id);
  if (!pending) throw new Error('Riepilogo non trovato');

  const settings = await Storage.getSettings();
  if (!settings.geminiApiKey) throw new Error('API key Gemini non configurata. Vai nelle Impostazioni.');

  // Apri tab YouTube in background (non attivo)
  const tab = await new Promise(resolve =>
    chrome.tabs.create({ url: pending.url, active: false }, resolve)
  );

  try {
    // Aspetta caricamento completo + 2s per il JS della pagina
    await waitForTabLoad(tab.id, 25000);
    await delay(2000);

    // Estrai dati video dalla pagina
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: extractPageVideoDataForQueue,
    });
    const pageData = res?.result;
    if (!pageData?.videoId) throw new Error('Impossibile leggere i dati del video dalla pagina');

    // Usa captionTracks memorizzate se la pagina non le carica (raro)
    const tracks = pageData.captionTracks?.length
      ? pageData.captionTracks
      : (pending.captionTracks || []);

    // Fetch trascrizione
    const lang  = settings.language === 'auto' ? 'it' : (settings.language || 'it');
    const track = selectBestTrack(tracks, lang);
    let transcript = '';
    let transcriptSegments = [];
    let transcriptQuality = null;
    if (track) {
      try {
        const captionData = await fetchCaption(track.baseUrl, pageData.chapters || []);
        transcript = captionData.transcript;
        transcriptSegments = captionData.segments;
        transcriptQuality = Transcript.assessTranscriptQuality(transcriptSegments, track);
      } catch {}
    }

    const videoData = { ...pageData, transcript, transcriptSegments, transcriptQuality, captionLang: track?.languageCode, captionType: track?.kind };

    // Genera summary
    const markdown = await GeminiAPI.generateSummary(videoData, settings);
    const tags     = await GeminiAPI.extractTags(videoData.title, videoData.description, settings.geminiApiKey, settings.model);

    const fullMarkdown = MarkdownGenerator.addFrontmatter(markdown, { ...pending, tags }, tags);
    const pubDate      = pending.publishDate || pageData.publishDate || new Date().toISOString().slice(0, 10);

    // Salva file (vault diretto o fallback Downloads)
    const { downloadId, savedFilename } = await saveMarkdownFile(
      fullMarkdown,
      pending.channelName,
      pending.title,
      pubDate
    );

    // Aggiorna entry da pending → extracted
    await Storage.updateSummaryById(id, {
      status: 'extracted', markdown, fullMarkdown, tags,
      downloadId, savedFilename,
      publishDate: pubDate,
      viewCount: pageData.viewCount || pending.viewCount || 0,
      duration: pageData.duration || pending.duration || 0,
      contentType: pageData.contentType || pending.contentType || 'video',
      durationBucket: pageData.durationBucket || pending.durationBucket || getDurationBucket(pageData.duration || pending.duration || 0),
      liveBroadcastContent: pageData.liveBroadcastContent || pending.liveBroadcastContent || 'none',
    });
    await Storage.incrementStat();

    showNotification('📚 Codex_Chrome-PlugIn_YouTube-Learn — Completato!', `"${pending.title?.slice(0,50)}" estratto e salvato.`);

  } finally {
    // Chiudi tab aperta in background
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function waitForTabLoad(tabId, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Timeout caricamento tab')), timeout);
    function handler(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(handler);
        clearTimeout(t);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(handler);
  });
}

// ── Caption helpers (per il background service worker) ────────────────────────

function selectBestTrack(tracks, lang) {
  if (!tracks?.length) return null;
  const manual = tracks.filter(t => t.kind !== 'asr');
  const auto   = tracks.filter(t => t.kind === 'asr');
  return manual.find(t => t.languageCode.startsWith(lang))
      || auto.find(t => t.languageCode.startsWith(lang))
      || manual[0] || auto[0] || tracks[0];
}

async function fetchCaption(baseUrl, chapters = []) {
  const url = new URL(baseUrl);
  url.searchParams.set('fmt', 'json3');
  const res = await fetch(url.toString());
  if (!res.ok) return { transcript: '', segments: [] };
  const data = await res.json();
  if (!data.events) return { transcript: '', segments: [] };
  const rawSegments = [];
  for (const ev of data.events) {
    if (!ev.segs) continue;
    const t = ev.segs.map(s => s.utf8 || '').join('').replace(/\n/g, ' ').trim();
    if (t) rawSegments.push({ startMs: ev.tStartMs || 0, text: t });
  }
  const normalizedChapters = Transcript.normalizeChapters(chapters, rawSegments);
  return {
    transcript: Transcript.formatTranscript(rawSegments, normalizedChapters),
    segments: rawSegments,
  };
}

function msTs(ms) {
  const s = Math.floor(ms/1000), m = Math.floor(s/60), h = Math.floor(m/60);
  return h > 0
    ? `${h}:${String(m%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`
    : `${m}:${String(s%60).padStart(2,'0')}`;
}

// ── Generazione Riepilogo (dal popup) ────────────────────────────────────────

async function generateSummary(videoData, generationOptions = {}) {
  const settings = await Storage.getSettings();
  if (!settings.geminiApiKey)
    throw new Error('API key Gemini non configurata. Vai nelle Impostazioni.');

  const transcriptQuality = videoData.transcriptQuality
    || Transcript.assessTranscriptQuality(videoData.transcriptSegments || [], {
      kind: videoData.captionType || 'manual',
      languageCode: videoData.captionLang || '',
    });
  const normalizedChapters = Transcript.normalizeChapters(videoData.chapters || [], videoData.transcriptSegments || []);
  const enrichedVideoData = {
    ...videoData,
    chapters: normalizedChapters,
    transcriptQuality,
  };

  chrome.runtime.sendMessage({ action: 'SUMMARY_PROGRESS', step: 'generating', percent: 20 }).catch(() => {});
  const aiSections = await GeminiAPI.generateLearningSections(enrichedVideoData, settings);
  const learningMode = generationOptions.learningMode || settings.defaultLearningMode || 'study';
  const markdown = MarkdownGenerator.buildLearningDocument(
    { ...enrichedVideoData, learningMode, outputFormat: settings.outputFormat || 'mdx' },
    aiSections,
    { learningMode }
  );

  chrome.runtime.sendMessage({ action: 'SUMMARY_PROGRESS', step: 'extracting_tags', percent: 80 }).catch(() => {});
  const tags = await GeminiAPI.extractTags(videoData.title, videoData.description, settings.geminiApiKey, settings.model);

  return { success: true, markdown, tags, transcriptQuality };
}

// ── Helper: salva file MD (vault diretto o fallback download) ─────────────────

async function saveMarkdownFile(content, channelName, title, publishDate) {
  const channelFolder = sanitizePath(channelName || 'Unknown_Channel');
  const pubDate       = publishDate || new Date().toISOString().slice(0, 10);
  const year          = pubDate.slice(0, 4) || String(new Date().getFullYear());
  const titleSafe     = sanitizePath(title || 'video').slice(0, 60);
  const settings = await Storage.getSettings();
  const extension = settings.outputFormat || 'mdx';

  // Percorso relativo (sotto la cartella vault o sotto Downloads/LearningHub)
  const relativePath = `${channelFolder}/${year}/${pubDate.slice(0, 10)}_${titleSafe}.${extension}`;
  const fullPath     = `LearningHub/${relativePath}`;

  // ── Tentativo 1: File System Access API → scrittura diretta, nessun dialogo ─
  if (settings.useFileSystemApi) {
    const fsResult = await FileSystemUtils.trySaveToVault(relativePath, content).catch(() => null);
    if (fsResult?.success) {
      return { downloadId: null, savedFilename: relativePath, method: 'vault' };
    }
    // Se il permesso è scaduto, segnalalo nella notifica ma continua col fallback
    if (fsResult?.reason === 'permission_denied') {
      showNotification('Codex_Chrome-PlugIn_YouTube-Learn ⚠️',
        'Permesso cartella vault scaduto. Ri-seleziona la cartella nelle Impostazioni. File salvato in Download.');
    }
  }

  // ── Fallback: chrome.downloads (va nella cartella Download di Chrome) ────────
  const blob    = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const dataUrl = await blobToDataUrl(blob);
  const downloadId = await new Promise((resolve, reject) =>
    chrome.downloads.download(
      { url: dataUrl, filename: fullPath, saveAs: false, conflictAction: 'uniquify' },
      id => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(id)
    )
  );
  return { downloadId, savedFilename: fullPath, method: 'downloads' };
}

// ── Salvataggio con struttura gerarchica ──────────────────────────────────────

async function saveSummary(summaryMeta, rawMarkdown, generationOptions = {}) {
  const tags         = summaryMeta.tags || [];
  const settings = await Storage.getSettings();
  const learningMode = generationOptions.learningMode || settings.defaultLearningMode || 'study';
  const outputFormat = settings.outputFormat || 'mdx';
  const fullMarkdown = MarkdownGenerator.addFrontmatter(
    rawMarkdown,
    { ...summaryMeta, learningMode, outputFormat },
    tags,
    { learningMode, outputFormat }
  );

  const { downloadId, savedFilename } = await saveMarkdownFile(
    fullMarkdown,
    summaryMeta.channelName,
    summaryMeta.title,
    summaryMeta.publishDate
  );

  // Controlla se esiste già come pending e aggiorna, altrimenti crea
  const existing = (await Storage.getSummaries()).find(
    s => s.videoId === summaryMeta.videoId && s.status === 'pending'
  );

  let saved;
  if (existing) {
    saved = await Storage.updateSummaryById(existing.id, LearningDocument.buildExtractedSummary({
      ...existing,
      ...summaryMeta,
      tags,
      learningMode,
      outputFormat,
      viewCount: summaryMeta.viewCount || 0,
      publishDate: summaryMeta.publishDate || '',
      duration: summaryMeta.duration || 0,
      contentType: summaryMeta.contentType || classifyQueueContentType({ durationSec: summaryMeta.duration || 0, liveBroadcastContent: summaryMeta.liveBroadcastContent || 'none' }),
      durationBucket: summaryMeta.durationBucket || getDurationBucket(summaryMeta.duration || 0),
      liveBroadcastContent: summaryMeta.liveBroadcastContent || 'none',
    }, rawMarkdown, fullMarkdown, { downloadId, savedFilename }));
  } else {
    saved = await Storage.saveSummary(LearningDocument.buildExtractedSummary({
      ...summaryMeta,
      tags,
      url: `https://youtube.com/watch?v=${summaryMeta.videoId}`,
      platform: 'youtube',
      thumbnail: `https://i.ytimg.com/vi/${summaryMeta.videoId}/mqdefault.jpg`,
      learningMode,
      outputFormat,
      duration: summaryMeta.duration || 0,
      contentType: summaryMeta.contentType || classifyQueueContentType({ durationSec: summaryMeta.duration || 0, liveBroadcastContent: summaryMeta.liveBroadcastContent || 'none' }),
      durationBucket: summaryMeta.durationBucket || getDurationBucket(summaryMeta.duration || 0),
      liveBroadcastContent: summaryMeta.liveBroadcastContent || 'none',
    }, rawMarkdown, fullMarkdown, { downloadId, savedFilename }));
  }

  await Storage.incrementStat();
  return { success: true, id: saved.id, filename: savedFilename };
}

// ── Channel Mass Queue helpers ───────────────────────────────────────────────

const DURATION_BUCKETS = ['flash', 'quick', 'standard', 'deep', 'marathon'];
const DEFAULT_QUEUE_TYPES = ['video', 'short', 'live'];
const COURSE_PLAYLIST_RE = /\b(corso|course|masterclass|bootcamp|academy|playlist|lesson|lezione|tutorial series|full course)\b/i;

function parseIso8601DurationToSeconds(iso) {
  if (!iso || typeof iso !== 'string') return 0;
  const m = iso.match(/P(?:\d+Y)?(?:\d+M)?(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0, 10) * 3600)
    + (parseInt(m[2] || 0, 10) * 60)
    + parseInt(m[3] || 0, 10);
}

function getDurationBucket(durationSec = 0) {
  if (durationSec < 180) return 'flash';
  if (durationSec < 600) return 'quick';
  if (durationSec < 1800) return 'standard';
  if (durationSec < 3600) return 'deep';
  return 'marathon';
}

function classifyQueueContentType({ durationSec = 0, liveBroadcastContent = 'none' } = {}) {
  if (liveBroadcastContent === 'live' || liveBroadcastContent === 'upcoming') return 'live';
  if (durationSec > 0 && durationSec < 180) return 'short';
  return 'video';
}

function buildDefaultMassQueueCounts() {
  return {
    video: 0,
    short: 0,
    live: 0,
    playlist: 0,
    course: 0,
  };
}

function buildDefaultDurationCounts() {
  return {
    flash: 0,
    quick: 0,
    standard: 0,
    deep: 0,
    marathon: 0,
  };
}

function normalizeQueueFilters(creator = {}, filters = {}) {
  const contentTypes = Array.isArray(filters.contentTypes) && filters.contentTypes.length
    ? filters.contentTypes
    : (creator.queueContentTypes?.length ? creator.queueContentTypes : DEFAULT_QUEUE_TYPES);
  const durationBuckets = Array.isArray(filters.durationBuckets) && filters.durationBuckets.length
    ? filters.durationBuckets
    : (creator.queueDurationBuckets?.length ? creator.queueDurationBuckets : DURATION_BUCKETS);
  return {
    contentTypes,
    durationBuckets,
    includeBeforeFollowedAt: filters.includeBeforeFollowedAt ?? creator.includeBeforeFollowedAt ?? false,
    limit: Math.max(1, Number(filters.limit || creator.massQueueLimit || 100)),
    queueKeywords: Array.isArray(filters.queueKeywords)
      ? filters.queueKeywords
      : (creator.queueKeywords || []),
  };
}

function matchesQueueFilters(video, creator, filters) {
  const contentTypes = filters.contentTypes?.length ? filters.contentTypes : DEFAULT_QUEUE_TYPES;
  const durationBuckets = filters.durationBuckets?.length ? filters.durationBuckets : DURATION_BUCKETS;
  const queueKeywords = (filters.queueKeywords || []).map(k => k.toLowerCase().trim()).filter(Boolean);
  const followedAt = creator.followedAt || creator.addedAt || 0;

  if (contentTypes.length && !contentTypes.includes(video.contentType || 'video')) return false;
  if (durationBuckets.length && !durationBuckets.includes(video.durationBucket || getDurationBucket(video.durationSec || video.duration || 0))) return false;
  if (!filters.includeBeforeFollowedAt) {
    const pubTime = video.publishedAt ? new Date(video.publishedAt).getTime() : 0;
    if (followedAt && pubTime > 0 && pubTime < followedAt) return false;
  }
  if (queueKeywords.length) {
    const titleLow = (video.title || '').toLowerCase();
    if (!queueKeywords.some(k => titleLow.includes(k))) return false;
  }
  return true;
}

async function youtubeApiGet(path, params, apiKey) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  Object.entries(params || {}).forEach(([key, val]) => {
    if (val !== undefined && val !== null && val !== '') url.searchParams.set(key, String(val));
  });
  url.searchParams.set('key', apiKey);
  const res = await fetch(url.toString());
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`YouTube API error: ${msg}`);
  }
  return data;
}

async function fetchUploadsPlaylistId(channelId, apiKey) {
  const data = await youtubeApiGet('channels', {
    part: 'contentDetails,snippet',
    id: channelId,
    maxResults: 1,
  }, apiKey);
  const item = data?.items?.[0];
  const uploadsPlaylistId = item?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) throw new Error('Uploads playlist non trovata per questo canale');
  return {
    uploadsPlaylistId,
    channelTitle: item?.snippet?.title || '',
  };
}

async function fetchChannelPlaylistsSummary(channelId, apiKey) {
  let pageToken = '';
  let total = 0;
  let courses = 0;

  do {
    const data = await youtubeApiGet('playlists', {
      part: 'snippet,contentDetails',
      channelId,
      maxResults: 50,
      pageToken,
    }, apiKey);
    const items = data?.items || [];
    total += items.length;
    for (const pl of items) {
      const title = pl?.snippet?.title || '';
      const itemCount = parseInt(pl?.contentDetails?.itemCount || 0, 10);
      if (COURSE_PLAYLIST_RE.test(title) || itemCount >= 8) courses++;
    }
    pageToken = data?.nextPageToken || '';
  } while (pageToken);

  return { playlist: total, course: courses };
}

async function fetchUploadsInventory(channelId, apiKey, options = {}) {
  const { uploadsPlaylistId, channelTitle } = await fetchUploadsPlaylistId(channelId, apiKey);
  const maxItems = options.maxItems === 'all'
    ? 1200
    : Math.max(1, Number(options.maxItems || 500));

  const seedItems = [];
  let pageToken = '';

  while (seedItems.length < maxItems) {
    const data = await youtubeApiGet('playlistItems', {
      part: 'snippet,contentDetails',
      playlistId: uploadsPlaylistId,
      maxResults: 50,
      pageToken,
    }, apiKey);
    const items = data?.items || [];
    for (const item of items) {
      const videoId = item?.contentDetails?.videoId;
      if (!videoId) continue;
      seedItems.push({
        videoId,
        title: item?.snippet?.title || '',
        publishedAt: item?.contentDetails?.videoPublishedAt || item?.snippet?.publishedAt || '',
        thumbnail: item?.snippet?.thumbnails?.medium?.url
          || item?.snippet?.thumbnails?.default?.url
          || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      });
      if (seedItems.length >= maxItems) break;
    }
    pageToken = data?.nextPageToken || '';
    if (!pageToken || items.length === 0) break;
  }

  const detailsMap = new Map();
  for (let i = 0; i < seedItems.length; i += 50) {
    const batchIds = seedItems.slice(i, i + 50).map(v => v.videoId).join(',');
    const data = await youtubeApiGet('videos', {
      part: 'contentDetails,snippet,liveStreamingDetails',
      id: batchIds,
      maxResults: 50,
    }, apiKey);
    for (const item of data?.items || []) detailsMap.set(item.id, item);
  }

  const counts = buildDefaultMassQueueCounts();
  const durationCounts = buildDefaultDurationCounts();
  const videos = seedItems.map(seed => {
    const item = detailsMap.get(seed.videoId);
    const durationSec = parseIso8601DurationToSeconds(item?.contentDetails?.duration);
    const liveBroadcastContent = item?.snippet?.liveBroadcastContent || 'none';
    const contentType = classifyQueueContentType({ durationSec, liveBroadcastContent });
    const durationBucket = getDurationBucket(durationSec);
    counts[contentType] = (counts[contentType] || 0) + 1;
    durationCounts[durationBucket] = (durationCounts[durationBucket] || 0) + 1;
    return {
      videoId: seed.videoId,
      title: item?.snippet?.title || seed.title,
      publishedAt: item?.snippet?.publishedAt || seed.publishedAt,
      thumbnail: item?.snippet?.thumbnails?.medium?.url || seed.thumbnail,
      durationSec,
      durationBucket,
      contentType,
      liveBroadcastContent,
      url: `https://youtube.com/watch?v=${seed.videoId}`,
      channelId,
      channelName: item?.snippet?.channelTitle || channelTitle || '',
      description: (item?.snippet?.description || '').slice(0, 180),
    };
  });

  const playlistSummary = await fetchChannelPlaylistsSummary(channelId, apiKey);
  counts.playlist = playlistSummary.playlist;
  counts.course = playlistSummary.course;

  return {
    channelId,
    channelName: videos[0]?.channelName || channelTitle || '',
    analyzedAt: Date.now(),
    totalVideos: videos.length,
    counts,
    durationCounts,
    videos,
  };
}

async function analyzeChannelForMassQueue(channelId, options = {}) {
  const settings = await Storage.getSettings();
  if (!settings.youtubeApiKey) throw new Error('YouTube API key non configurata. Serve per analizzare il canale completo.');

  const scan = await fetchUploadsInventory(channelId, settings.youtubeApiKey, options);
  const creator = (await Storage.getCreators()).find(c => c.channelId === channelId);
  const normalizedFilters = normalizeQueueFilters(creator || {}, {});

  await Storage.setChannelScan(channelId, scan);
  await Storage.updateCreator(channelId, {
    massQueueProfile: {
      analyzedAt: scan.analyzedAt,
      totalVideos: scan.totalVideos,
      counts: scan.counts,
      durationCounts: scan.durationCounts,
      scanLimit: options.maxItems || 500,
    },
    queueContentTypes: creator?.queueContentTypes?.length ? creator.queueContentTypes : normalizedFilters.contentTypes,
    queueDurationBuckets: creator?.queueDurationBuckets?.length ? creator.queueDurationBuckets : normalizedFilters.durationBuckets,
  });

  return { success: true, profile: scan };
}

async function ensureChannelScan(channelId, options = {}) {
  const existing = await Storage.getChannelScan(channelId);
  if (existing?.videos?.length) return existing;
  const result = await analyzeChannelForMassQueue(channelId, options);
  return result.profile;
}

async function hydrateRecentVideosForCreator(creator, videos, settings) {
  const needsMetadataFilters =
    (creator.queueContentTypes?.length && creator.queueContentTypes.length < DEFAULT_QUEUE_TYPES.length)
    || (creator.queueDurationBuckets?.length && creator.queueDurationBuckets.length < DURATION_BUCKETS.length);

  if (!needsMetadataFilters) {
    return videos.map(v => ({
      ...v,
      durationSec: v.durationSec || 0,
      contentType: v.contentType || 'video',
      durationBucket: v.durationBucket || getDurationBucket(v.durationSec || 0),
      liveBroadcastContent: v.liveBroadcastContent || 'none',
    }));
  }

  if (!settings.youtubeApiKey) {
    return videos.map(v => ({
      ...v,
      metadataUnavailable: true,
      contentType: 'unknown',
      durationBucket: 'unknown',
      liveBroadcastContent: 'none',
      durationSec: 0,
    }));
  }
  const ids = videos.map(v => v.videoId).filter(Boolean);
  if (!ids.length) return videos;

  const detailsMap = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const batchIds = ids.slice(i, i + 50).join(',');
    const data = await youtubeApiGet('videos', {
      part: 'contentDetails,snippet',
      id: batchIds,
      maxResults: 50,
    }, settings.youtubeApiKey);
    for (const item of data?.items || []) detailsMap.set(item.id, item);
  }

  return videos.map(v => {
    const item = detailsMap.get(v.videoId);
    const durationSec = parseIso8601DurationToSeconds(item?.contentDetails?.duration);
    const liveBroadcastContent = item?.snippet?.liveBroadcastContent || 'none';
    return {
      ...v,
      durationSec,
      contentType: classifyQueueContentType({ durationSec, liveBroadcastContent }),
      durationBucket: getDurationBucket(durationSec),
      liveBroadcastContent,
      description: v.description || (item?.snippet?.description || '').slice(0, 300),
    };
  });
}

async function queueChannelMass(channelId, rawFilters = {}) {
  const creators = await Storage.getCreators();
  const creator = creators.find(c => c.channelId === channelId);
  if (!creator) throw new Error('Creator non trovato');

  const filters = normalizeQueueFilters(creator, rawFilters);
  await Storage.updateCreator(channelId, {
    queueContentTypes: filters.contentTypes,
    queueDurationBuckets: filters.durationBuckets,
    includeBeforeFollowedAt: filters.includeBeforeFollowedAt,
    massQueueLimit: filters.limit,
  });

  const scan = await ensureChannelScan(channelId, { maxItems: rawFilters.scanLimit || 'all' });
  const queuedIds = await Storage.getQueuedVideoIds();
  const selected = scan.videos
    .filter(v => !queuedIds.has(v.videoId))
    .filter(v => matchesQueueFilters(v, creator, filters))
    .slice(0, filters.limit);

  let queued = 0;
  for (const video of selected) {
    const res = await addToQueue({
      ...video,
      duration: video.durationSec,
      channelName: creator.channelName || video.channelName,
      channelId,
      publishDate: video.publishedAt,
    });
    if (res.success) queued++;
  }

  return {
    success: true,
    queued,
    matched: selected.length,
    totalScanned: scan.videos.length,
  };
}

function parseYouTubeVideoId(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.hostname.includes('youtu.be')) return url.pathname.slice(1) || null;
    if (url.searchParams.get('v')) return url.searchParams.get('v');
    const shortsMatch = url.pathname.match(/\/shorts\/([^/?]+)/);
    return shortsMatch ? shortsMatch[1] : null;
  } catch {
    return null;
  }
}

function parseYouTubePlaylistId(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.searchParams.get('list') || null;
  } catch {
    return null;
  }
}

async function fetchVideosByIds(videoIds, apiKey) {
  if (!videoIds.length) return [];
  const data = await youtubeApiGet('videos', {
    part: 'snippet,contentDetails',
    id: videoIds.join(','),
    maxResults: 50,
  }, apiKey);
  return (data?.items || []).map(item => {
    const durationSec = parseIso8601DurationToSeconds(item?.contentDetails?.duration);
    return {
      videoId: item.id,
      title: item?.snippet?.title || `Video ${item.id}`,
      channelName: item?.snippet?.channelTitle || 'YouTube',
      channelId: item?.snippet?.channelId || '',
      publishDate: item?.snippet?.publishedAt || '',
      description: (item?.snippet?.description || '').slice(0, 300),
      thumbnail: item?.snippet?.thumbnails?.medium?.url || `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`,
      url: `https://youtube.com/watch?v=${item.id}`,
      duration: durationSec,
      contentType: classifyQueueContentType({ durationSec, liveBroadcastContent: item?.snippet?.liveBroadcastContent || 'none' }),
      durationBucket: getDurationBucket(durationSec),
      liveBroadcastContent: item?.snippet?.liveBroadcastContent || 'none',
      platform: 'youtube',
    };
  });
}

async function fetchPlaylistVideos(playlistId, apiKey) {
  const collected = [];
  let pageToken = '';
  let safety = 0;
  do {
    const data = await youtubeApiGet('playlistItems', {
      part: 'contentDetails',
      playlistId,
      maxResults: 50,
      pageToken,
    }, apiKey);
    for (const item of data?.items || []) {
      const videoId = item?.contentDetails?.videoId;
      if (videoId) collected.push(videoId);
    }
    pageToken = data?.nextPageToken || '';
    safety += 1;
  } while (pageToken && safety < 20);
  return collected;
}

async function importBatchUrls(input = '') {
  const settings = await Storage.getSettings();
  const lines = String(input)
    .split(/\r?\n|,/)
    .map(line => line.trim())
    .filter(Boolean);

  if (!lines.length) throw new Error('Inserisci almeno un URL YouTube o playlist.');

  const videoIds = new Set();
  const playlistIds = new Set();
  const skipped = [];

  for (const line of lines) {
    const videoId = parseYouTubeVideoId(line);
    const playlistId = parseYouTubePlaylistId(line);
    if (videoId) videoIds.add(videoId);
    else if (playlistId) playlistIds.add(playlistId);
    else skipped.push(line);
  }

  if (playlistIds.size && !settings.youtubeApiKey) {
    throw new Error('Per importare playlist serve una YouTube API key configurata.');
  }

  for (const playlistId of playlistIds) {
    const ids = await fetchPlaylistVideos(playlistId, settings.youtubeApiKey);
    ids.forEach(id => videoIds.add(id));
  }

  const resolvedVideos = settings.youtubeApiKey
    ? await fetchVideosByIds([...videoIds].slice(0, 50), settings.youtubeApiKey)
    : [...videoIds].slice(0, 50).map(videoId => ({
        videoId,
        title: `YouTube Video ${videoId}`,
        channelName: 'YouTube',
        channelId: '',
        publishDate: '',
        description: '',
        thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        url: `https://youtube.com/watch?v=${videoId}`,
        duration: 0,
        contentType: 'video',
        durationBucket: 'standard',
        liveBroadcastContent: 'none',
        platform: 'youtube',
      }));

  let queued = 0;
  const existingIds = await Storage.getQueuedVideoIds();
  for (const video of resolvedVideos) {
    if (existingIds.has(video.videoId)) continue;
    const res = await addToQueue(video);
    if (res.success) {
      queued += 1;
      existingIds.add(video.videoId);
    }
  }

  return {
    success: true,
    queued,
    totalResolved: resolvedVideos.length,
    playlistCount: playlistIds.size,
    skipped,
  };
}

// ── Re-download/Apri file MD ──────────────────────────────────────────────────

async function redownloadSummary(id) {
  const summaries = await Storage.getSummaries();
  const s = summaries.find(x => x.id === id);
  if (!s) throw new Error('Riepilogo non trovato');

  const content = s.fullMarkdown || s.markdown || '';
  const blob    = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const dataUrl = await blobToDataUrl(blob);
  const channelFolder = sanitizePath(s.channelName || 'Unknown_Channel');
  const pubDate  = s.publishDate || new Date(s.createdAt).toISOString().slice(0, 10);
  const year     = pubDate.slice(0, 4);
  const titleSafe = sanitizePath(s.title || 'video').slice(0, 60);
  const filename  = s.savedFilename || `LearningHub/${channelFolder}/${year}/${pubDate.slice(0,10)}_${titleSafe}.${s.outputFormat || 'mdx'}`;

  await chrome.downloads.download({ url: dataUrl, filename, saveAs: false, conflictAction: 'uniquify' });
  return { success: true };
}

async function exportSummary(id, format = 'mdx') {
  const summaries = await Storage.getSummaries();
  const summary = summaries.find(entry => entry.id === id);
  if (!summary) throw new Error('Riepilogo non trovato');

  const content = ExportFormatters.buildContent(summary, format);
  const extension = ExportFormatters.getExtension(format);
  const mime = format === 'json' || format === 'antigravity'
    ? 'application/json;charset=utf-8'
    : 'text/plain;charset=utf-8';

  const channelFolder = sanitizePath(summary.channelName || 'Unknown_Channel');
  const pubDate = summary.publishDate || new Date(summary.createdAt).toISOString().slice(0, 10);
  const year = pubDate.slice(0, 4);
  const titleSafe = sanitizePath(summary.title || 'video').slice(0, 60);
  const suffix = format === 'antigravity' ? '_antigravity' : `_${format}`;
  const filename = `LearningHub/${channelFolder}/${year}/${pubDate.slice(0,10)}_${titleSafe}${suffix}.${extension}`;

  const blob = new Blob([content], { type: mime });
  const dataUrl = await blobToDataUrl(blob);
  await chrome.downloads.download({ url: dataUrl, filename, saveAs: false, conflictAction: 'uniquify' });
  return { success: true, filename };
}

// ── Mostra file scaricato in Finder/Explorer ──────────────────────────────────

async function showDownloadFile(id) {
  const summaries = await Storage.getSummaries();
  const s = summaries.find(x => x.id === id);
  if (!s) throw new Error('Riepilogo non trovato');

  // Se abbiamo il downloadId, usa chrome.downloads.show() per evidenziare in Finder
  if (s.downloadId != null) {
    try {
      await chrome.downloads.show(s.downloadId);
      return { success: true, method: 'show' };
    } catch {}
  }

  // Fallback: scarica di nuovo (il file appare nella barra download di Chrome)
  return await redownloadSummary(id);
}

// ── Estrazione multipla (bulk) ────────────────────────────────────────────────

async function extractAllPending(ids) {
  // Avvia tutte le estrazioni in sequenza (rate limit Gemini + non parallelizzare tab)
  let started = 0;
  for (const id of ids) {
    doBackgroundExtraction(id).catch(err => {
      showNotification('Codex_Chrome-PlugIn_YouTube-Learn ❌', `Errore estrazione: ${err.message}`);
    });
    started++;
    await delay(800); // piccola pausa tra le richieste
  }
  return { success: true, started };
}

// ── Utility ───────────────────────────────────────────────────────────────────

function sanitizePath(str) {
  return (str || 'Unknown')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '_').replace(/_{2,}/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 80) || 'Unknown';
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function showNotification(title, message) {
  chrome.notifications.create(`lh_${Date.now()}`, {
    type: 'basic', iconUrl: 'icons/icon48.png', title, message,
  });
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

async function openDashboard() {
  const url  = chrome.runtime.getURL('dashboard/dashboard.html');
  const tabs = await chrome.tabs.query({ url });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
  return { success: true };
}

// ── Creator Management ────────────────────────────────────────────────────────

async function addCreator(urlOrChannelId) {
  let channelId = urlOrChannelId.trim(), channelHandle = '', channelUrl = '';
  const patterns = [
    { re: /youtube\.com\/channel\/(UC[\w-]{21,})/, type: 'id' },
    { re: /youtube\.com\/@([\w.-]+)/, type: 'handle' },
    { re: /youtube\.com\/user\/([\w.-]+)/, type: 'handle' },
    { re: /youtube\.com\/c\/([\w.-]+)/, type: 'handle' },
  ];
  for (const { re, type } of patterns) {
    const m = urlOrChannelId.match(re);
    if (m) { if (type === 'id') channelId = m[1]; else channelHandle = m[1]; channelUrl = urlOrChannelId; break; }
  }

  let channelName = '';
  try {
    const rssUrl = channelId.startsWith('UC')
      ? `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
      : `https://www.youtube.com/feeds/videos.xml?user=${channelHandle || channelId}`;
    const res = await fetch(rssUrl);
    if (res.ok) {
      const xml = await res.text();
      const nm = xml.match(/<name>(.*?)<\/name>/);
      const im = xml.match(/<yt:channelId>(.*?)<\/yt:channelId>/);
      if (nm) channelName = nm[1];
      if (im) channelId   = im[1];
    }
  } catch {}

  let avatar = null, stats = null;
  const settings = await Storage.getSettings();
  if (settings.youtubeApiKey && channelId.startsWith('UC')) {
    try { const i = await fetchYouTubeChannelInfo(channelId, settings.youtubeApiKey); if (i) { channelName = i.name || channelName; avatar = i.avatar; stats = i.stats; } } catch {}
  }
  if (!avatar) { try { avatar = await scrapeChannelAvatar(channelId); } catch {} }

  const result = await Storage.addCreator({
    channelId, channelName: channelName || channelHandle || channelId,
    channelUrl: channelUrl || `https://youtube.com/channel/${channelId}`,
    platform: 'youtube', avatar, stats,
    avatarFetchAttempted: true,
    // followedAt è impostato dentro Storage.addCreator
  });
  if (result.success) fetchChannelFeed(channelId).catch(() => {});
  return { ...result, channelId, channelName };
}

// ── Feed RSS ──────────────────────────────────────────────────────────────────

async function getFeed(forceRefresh = false) {
  const creators = await Storage.getCreators();
  if (!creators.length) return { success: true, feed: [] };
  const feedCache = await Storage.getFeedCache();
  const now = Date.now(), TTL = 30 * 60 * 1000;
  const all = await Promise.all(creators.map(async c => {
    const cached = feedCache[c.channelId];
    if (!forceRefresh && cached && (now - (cached.fetchedAt||0)) < TTL && cached.videos) return cached.videos;
    try { return await fetchChannelFeed(c.channelId); } catch { return cached?.videos || []; }
  }));
  return { success: true, feed: all.flat().sort((a,b) => new Date(b.publishedAt) - new Date(a.publishedAt)) };
}

async function fetchChannelFeed(channelId) {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  if (!res.ok) throw new Error(`RSS failed: ${channelId}`);
  const xml = await res.text(), videos = parseRssXml(xml, channelId);
  const feedCache = await Storage.getFeedCache();
  feedCache[channelId] = { videos, fetchedAt: Date.now() };
  await chrome.storage.local.set({ feedCache });
  await Storage.updateCreator(channelId, { lastChecked: Date.now() });
  return videos;
}

function parseRssXml(xml, channelId) {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  const cnm = xml.match(/<author>\s*<name>(.*?)<\/name>/);
  const channelName = cnm ? cnm[1] : '';
  return entries.map(entry => {
    const vid = entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/);
    if (!vid) return null;
    const tit = entry.match(/<title>(.*?)<\/title>/);
    const pub = entry.match(/<published>(.*?)<\/published>/);
    const thm = entry.match(/url="(https:\/\/i\.ytimg\.com[^"]+)"/);
    const dsc = entry.match(/<media:description>([\s\S]*?)<\/media:description>/);
    return {
      videoId: vid[1], title: tit ? decodeXml(tit[1]) : '',
      publishedAt: pub ? pub[1] : '',
      url: `https://youtube.com/watch?v=${vid[1]}`,
      thumbnail: thm ? thm[1] : `https://i.ytimg.com/vi/${vid[1]}/mqdefault.jpg`,
      description: dsc ? decodeXml(dsc[1]).slice(0,300) : '',
      channelId, channelName, platform: 'youtube',
    };
  }).filter(Boolean);
}

function decodeXml(s) {
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
}

async function checkVideoSummarized(videoId) {
  const summaries = await Storage.getSummaries();
  const found = summaries.find(s => s.videoId === videoId);
  return { success: true, summarized: !!found, summary: found || null };
}

async function fetchYouTubeChannelInfo(channelId, apiKey) {
  // Normalizza: estrai handle o UC-id da qualsiasi formato
  let ucId = '', handle = '';
  if (channelId.startsWith('UC') && channelId.length > 20) {
    ucId = channelId;
  } else {
    // estrai handle da URL come https://youtube.com/@simone_rizzo98 o simone_rizzo98
    const m = channelId.match(/youtube\.com\/@?([\w.-]+)/) || channelId.match(/^@?([\w.-]+)$/);
    if (m) handle = m[1].replace(/^@/, '');
  }

  const base = 'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics';
  let item = null;

  // Tentativo 1: ID diretto (UC...)
  if (ucId) {
    const r = await fetch(`${base}&id=${ucId}&key=${apiKey}`);
    if (r.ok) item = (await r.json())?.items?.[0];
  }

  // Tentativo 2: forHandle (YouTube API v3 — canali con @handle)
  if (!item && handle) {
    const r = await fetch(`${base}&forHandle=@${encodeURIComponent(handle)}&key=${apiKey}`);
    if (r.ok) item = (await r.json())?.items?.[0];
  }

  // Tentativo 3: forUsername (canali legacy con username)
  if (!item && handle) {
    const r = await fetch(`${base}&forUsername=${encodeURIComponent(handle)}&key=${apiKey}`);
    if (r.ok) item = (await r.json())?.items?.[0];
  }

  if (!item) return null;
  const sn = item.snippet || {}, st = item.statistics || {}, th = sn.thumbnails || {};
  return {
    name:      sn.title || '',
    channelId: item.id,   // UC... corretto — usato per aggiornare lo storage
    avatar:    th.high?.url || th.medium?.url || th.default?.url || null,
    stats: {
      subscribers: parseInt(st.subscriberCount  || 0),
      videoCount:  parseInt(st.videoCount       || 0),
      totalViews:  parseInt(st.viewCount        || 0),
      hiddenSubs:  st.hiddenSubscriberCount     || false,
      country:     sn.country                  || '',
      description: (sn.description             || '').slice(0, 200),
    },
  };
}

// ── Avatar via API interna YouTube (InnerTube) ───────────────────────────────

async function fetchAvatarViaInnerTube(channelId) {
  const res = await fetch(
    'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': '2.20240801.00.00',
      },
      body: JSON.stringify({
        browseId: channelId,
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20240801.00.00',
            hl: 'en', gl: 'US',
          }
        }
      })
    }
  );
  if (!res.ok) return null;
  const data = await res.json();

  // Prova vari percorsi dove YouTube mette l'avatar del canale
  const thumbArrays = [
    data?.header?.c4TabbedHeaderRenderer?.avatar?.thumbnails,
    data?.header?.pageHeaderRenderer?.content?.pageHeaderViewModel
      ?.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources,
    data?.microformat?.microformatDataRenderer?.thumbnail?.thumbnails,
  ];
  for (const thumbs of thumbArrays) {
    if (!thumbs?.length) continue;
    const best = thumbs[thumbs.length - 1];
    const url = typeof best === 'string' ? best : best?.url;
    if (url?.startsWith('http')) return url;
  }
  return null;
}

// ── Avatar via tab in background (fallback affidabile — come estrazione video) ─

async function fetchAvatarViaTab(channelId) {
  const tab = await new Promise(resolve =>
    chrome.tabs.create({ url: `https://www.youtube.com/channel/${channelId}`, active: false }, resolve)
  );
  try {
    await waitForTabLoad(tab.id, 15000);
    await delay(1500); // attendi che YouTube inizializzi ytInitialData

    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => {
        try {
          const data = window.ytInitialData;
          const thumbs =
            data?.header?.c4TabbedHeaderRenderer?.avatar?.thumbnails ||
            data?.microformat?.microformatDataRenderer?.thumbnail?.thumbnails;
          if (thumbs?.length) return thumbs[thumbs.length - 1]?.url || null;
          // Fallback: og:image dal DOM
          return document.querySelector('meta[property="og:image"]')?.content || null;
        } catch { return null; }
      }
    });
    return res?.result || null;
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function refreshCreatorStats(channelId) {
  const settings = await Storage.getSettings();
  let avatar = null, stats = null, resolvedChannelId = channelId;

  // Livello 1: YouTube Data API (se l'utente ha configurato la chiave)
  if (settings.youtubeApiKey) {
    const i = await fetchYouTubeChannelInfo(channelId, settings.youtubeApiKey).catch(()=>null);
    if (i) {
      avatar = i.avatar;
      stats  = i.stats;
      // Se l'API ha risolto un handle → UC..., aggiorna il channelId in storage
      if (i.channelId && i.channelId !== channelId) resolvedChannelId = i.channelId;
    }
  }

  // Livello 2: API interna YouTube (InnerTube) — veloce, nessun tab
  if (!avatar && resolvedChannelId.startsWith('UC')) {
    avatar = await fetchAvatarViaInnerTube(resolvedChannelId).catch(()=>null);
  }

  // Livello 3: Tab in background — affidabile al 100%, come l'estrazione video
  if (!avatar) {
    const tabId = resolvedChannelId.startsWith('UC') ? resolvedChannelId : channelId;
    avatar = await fetchAvatarViaTab(tabId).catch(()=>null);
  }

  // Salva sempre, aggiornando anche il channelId se è stato risolto
  const updates = {
    avatarFetchAttempted: true,
    statsUpdatedAt: Date.now(),
    channelId: resolvedChannelId,
    channelUrl: resolvedChannelId.startsWith('UC')
      ? `https://youtube.com/channel/${resolvedChannelId}`
      : undefined,
  };
  if (avatar) updates.avatar = avatar;
  if (stats)  updates.stats  = stats;
  // Rimuovi undefined
  Object.keys(updates).forEach(k => updates[k] === undefined && delete updates[k]);
  await Storage.updateCreator(channelId, updates);
  return { avatar, stats, channelId: resolvedChannelId };
}

// ── Deduplicazione creator ────────────────────────────────────────────────────

async function deduplicateCreators() {
  const creators = await Storage.getCreators();
  const normalize = s => (s || '').toLowerCase().replace(/[\s_\-\.]/g, '');
  const seen = new Map(); // chiave normalizzata → creator da tenere
  const toRemove = [];

  for (const c of creators) {
    const key = c.channelId || normalize(c.channelName);
    if (seen.has(key)) {
      // Tieni quello con più dati (avatar, stats), altrimenti il più recente
      const existing = seen.get(key);
      const existingScore = (existing.avatar ? 2 : 0) + (existing.stats ? 1 : 0);
      const newScore      = (c.avatar ? 2 : 0) + (c.stats ? 1 : 0);
      if (newScore > existingScore) {
        toRemove.push(existing.channelId);
        seen.set(key, c);
      } else {
        toRemove.push(c.channelId);
      }
    } else {
      // Controlla anche per nome normalizzato (cattura handle vs nome esteso)
      let foundByName = false;
      for (const [, existing] of seen) {
        if (normalize(existing.channelName) === normalize(c.channelName)) {
          const existingScore = (existing.avatar ? 2 : 0) + (existing.stats ? 1 : 0);
          const newScore      = (c.avatar ? 2 : 0) + (c.stats ? 1 : 0);
          if (newScore > existingScore) {
            toRemove.push(existing.channelId);
            seen.set(normalize(existing.channelName), c);
          } else {
            toRemove.push(c.channelId);
          }
          foundByName = true;
          break;
        }
      }
      if (!foundByName) seen.set(key, c);
    }
  }

  for (const channelId of toRemove) {
    await Storage.removeCreator(channelId);
  }
  return { success: true, removed: toRemove.length };
}

// ── Aggiorna tutti i creator (stats + avatar) ─────────────────────────────────

async function refreshAllCreators() {
  const creators = await Storage.getCreators();
  let updated = 0;
  for (const c of creators) {
    try {
      await refreshCreatorStats(c.channelId);
      updated++;
    } catch {}
  }
  return { success: true, updated };
}

// ── Analisi pagina web (multi-piattaforma) ────────────────────────────────────

async function analyzeWebpage(articleData) {
  const settings = await Storage.getSettings();
  if (!settings.geminiApiKey) throw new Error('API key Gemini non configurata.');

  const platform = articleData.platform || 'web';
  const isInstagram = platform === 'instagram';

  // Genera il markdown con il prompt appropriato alla piattaforma
  const markdown = isInstagram
    ? await GeminiAPI.generateInstagramSummary(articleData, settings)
    : await GeminiAPI.generateArticleSummary(articleData, settings);

  // Estrai tag (titolo + caption/text iniziale)
  const tagSource = isInstagram
    ? (articleData.hashtags || []).join(', ') + ' ' + (articleData.caption || '').slice(0, 300)
    : (articleData.text || '').slice(0, 400);

  const tags = await GeminiAPI.extractTags(
    articleData.title,
    tagSource,
    settings.geminiApiKey,
    settings.model
  );

  // Usa MarkdownGenerator per il frontmatter
  const fullMarkdown = MarkdownGenerator.addFrontmatter(markdown, {
    ...articleData,
    platform,
    tags,
    videoId: `${platform}_${Date.now()}`,
  }, tags);

  // Determina il "canale" (siteName o username Instagram)
  let siteName = articleData.siteName || '';
  if (!siteName && articleData.url) {
    try { siteName = new URL(articleData.url).hostname.replace(/^www\./, ''); } catch {}
  }
  if (isInstagram && articleData.username) {
    siteName = `@${articleData.username}`;
  }

  const pubDate = articleData.date || new Date().toISOString().slice(0, 10);
  const folderName = isInstagram ? `Instagram_${articleData.username || 'post'}` : (siteName || 'Web');

  // Salva il file
  const { downloadId, savedFilename } = await saveMarkdownFile(
    fullMarkdown,
    folderName,
    articleData.title,
    pubDate
  );

  // Aggiungi all'archivio con la piattaforma corretta
  const saved = await Storage.saveSummary({
    videoId:     `${platform}_${Date.now()}_${Math.random().toString(36).slice(2,5)}`,
    title:       articleData.title,
    channelName: siteName || (isInstagram ? 'Instagram' : 'Web'),
    channelId:   '',
    url:         articleData.url || '',
    markdown,
    fullMarkdown,
    tags,
    status:      'extracted',
    platform,
    thumbnail:   articleData.thumbnail || '',
    publishDate: pubDate,
    downloadId,
    savedFilename,
    // Metadati Instagram extra
    ...(isInstagram ? {
      igUsername: articleData.username,
      igType:     articleData.pageType,
      igHashtags: articleData.hashtags,
    } : {}),
  });

  await Storage.incrementStat();

  const notifMsg = isInstagram
    ? `📸 Codex_Chrome-PlugIn_YouTube-Learn — Instagram salvato!`
    : `📄 Codex_Chrome-PlugIn_YouTube-Learn — Articolo salvato!`;
  showNotification(notifMsg,
    `"${(articleData.title || '').slice(0, 60)}" analizzato e salvato.`);

  return { success: true, id: saved.id, filename: savedFilename, markdown };
}

// ── Auto-Queue: controllo e accodamento nuovi video ──────────────────────────

/**
 * Verifica il feed di uno o tutti i creator e accoda i nuovi video pubblicati
 * dopo la data di follow, applicando i filtri configurati.
 * @param {string|null} filterChannelId - null = tutti i creator
 * @returns {{ success, totalQueued, byCreator }}
 */
async function checkAndQueueNewVideos(filterChannelId = null) {
  const creators = await Storage.getCreators();
  const settings = await Storage.getSettings();
  const targets = filterChannelId
    ? creators.filter(c => c.channelId === filterChannelId)
    : creators.filter(c => c.autoQueueEnabled !== false);

  if (!targets.length) return { success: true, totalQueued: 0, byCreator: {} };

  const queuedIds = await Storage.getQueuedVideoIds();
  const byCreator = {};
  let totalQueued = 0;

  for (const creator of targets) {
    let videos;
    try { videos = await fetchChannelFeed(creator.channelId); }
    catch { byCreator[creator.channelId] = { queued: 0, error: true }; continue; }

    const hydratedVideos = await hydrateRecentVideosForCreator(creator, videos, settings).catch(() => videos);
    const filters = normalizeQueueFilters(creator, {});
    const toQueue = hydratedVideos.filter(v => !queuedIds.has(v.videoId))
      .filter(v => matchesQueueFilters(v, creator, filters));

    let queued = 0;
    for (const v of toQueue) {
      const videoData = {
        ...v,
        duration: v.durationSec || v.duration || 0,
        channelName: creator.channelName,
        channelId: creator.channelId,
        publishDate: v.publishedAt || v.publishDate || '',
      };
      if (creator.isPriority) {
        // Creator prioritario: salva in pending e avvia estrazione immediata
        const summaries = await Storage.getSummaries();
        if (!summaries.find(s => s.videoId === v.videoId)) {
          const saved = await Storage.saveSummary({
            videoId: v.videoId, title: v.title,
            channelName: creator.channelName, channelId: creator.channelId,
            publishDate: v.publishedAt || '', url: v.url || `https://youtube.com/watch?v=${v.videoId}`,
            markdown: null, fullMarkdown: null, tags: [], status: 'pending',
            platform: 'youtube',
            thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
            duration: v.durationSec || 0,
            contentType: v.contentType || 'video',
            durationBucket: v.durationBucket || getDurationBucket(v.durationSec || 0),
            liveBroadcastContent: v.liveBroadcastContent || 'none',
          });
          startBackgroundExtraction(saved.id).catch(() => {});
        }
      } else {
        // Creator normale: solo coda
        const res = await addToQueue(videoData);
        if (res.success) {
          queuedIds.add(v.videoId);
          queued++;
          totalQueued++;
        }
      }
    }

    byCreator[creator.channelId] = { queued, channelName: creator.channelName };
    await Storage.updateCreator(creator.channelId, { lastQueueCheck: Date.now() });
  }

  return { success: true, totalQueued, byCreator };
}

/**
 * Accoda tutti i nuovi video da tutti i creator seguiti.
 */
async function queueAllNew() {
  const result = await checkAndQueueNewVideos(null);
  if (result.totalQueued > 0) {
    showNotification('📚 Codex_Chrome-PlugIn_YouTube-Learn — Coda aggiornata',
      `${result.totalQueued} nuov${result.totalQueued === 1 ? 'o video accodato' : 'i video accodati'} dai creator seguiti.`);
  }
  return result;
}

/**
 * Ritorna il conteggio dei video non ancora accodati per uno o tutti i creator.
 */
async function getNewVideosCount(filterChannelId = null) {
  const creators = await Storage.getCreators();
  const settings = await Storage.getSettings();
  const targets = filterChannelId
    ? creators.filter(c => c.channelId === filterChannelId)
    : creators;
  const queuedIds = await Storage.getQueuedVideoIds();
  const feedCache = await Storage.getFeedCache();
  const counts = {};

  for (const creator of targets) {
    const cached = feedCache[creator.channelId];
    // feedCache stores arrays directly: { channelId: [video, ...] }
    const videos = Array.isArray(cached) ? cached : (cached?.videos || []);
    const hydratedVideos = await hydrateRecentVideosForCreator(creator, videos, settings).catch(() => videos);
    const filters = normalizeQueueFilters(creator, {});

    const count = hydratedVideos
      .filter(v => !queuedIds.has(v.videoId))
      .filter(v => matchesQueueFilters(v, creator, filters)).length;

    counts[creator.channelId] = count;
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { success: true, counts, total };
}

/**
 * Catch-up: accoda gli ultimi N video di un creator (anche pre-followedAt).
 */
async function catchupQueue(channelId, count = 5) {
  let videos;
  try { videos = await fetchChannelFeed(channelId); }
  catch (e) { throw new Error(`Impossibile leggere il feed: ${e.message}`); }

  const queuedIds = await Storage.getQueuedVideoIds();
  const creators = await Storage.getCreators();
  const creator = creators.find(c => c.channelId === channelId);
  const settings = await Storage.getSettings();
  const hydratedVideos = await hydrateRecentVideosForCreator(creator || {}, videos, settings).catch(() => videos);
  const toQueue = hydratedVideos.filter(v => !queuedIds.has(v.videoId)).slice(0, count);

  let queued = 0;
  for (const v of toQueue) {
    const res = await addToQueue({
      ...v,
      duration: v.durationSec || 0,
      channelName: creator?.channelName || '',
      channelId,
      publishDate: v.publishedAt || '',
    });
    if (res.success) queued++;
  }
  return { success: true, queued };
}

/**
 * Toggle creator prioritario (isPriority).
 */
async function togglePriority(channelId) {
  const creators = await Storage.getCreators();
  const creator = creators.find(c => c.channelId === channelId);
  if (!creator) throw new Error('Creator non trovato');
  const newVal = !creator.isPriority;
  await Storage.updateCreator(channelId, { isPriority: newVal });
  return { success: true, isPriority: newVal };
}

/**
 * Aggiorna le impostazioni di auto-queue di un creator.
 */
async function updateQueueSettings(channelId, settings) {
  await Storage.updateCreatorQueueSettings(channelId, settings);
  return { success: true };
}

// ── Allarme schedulato per auto-queue ─────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'auto-queue-check') {
    const settings = await Storage.getSettings();
    if (!settings.autoQueueInterval || settings.autoQueueInterval === 'off') return;
    const result = await checkAndQueueNewVideos(null);
    if (result.totalQueued > 0) {
      showNotification('📚 Codex_Chrome-PlugIn_YouTube-Learn — Nuovi video',
        `${result.totalQueued} nuov${result.totalQueued === 1 ? 'o video' : 'i video'} accodati automaticamente.`);
    }
  }
});

function setupAutoQueueAlarm(intervalHours) {
  chrome.alarms.clear('auto-queue-check', () => {
    if (!intervalHours || intervalHours === 'off') return;
    const hours = parseFloat(intervalHours);
    if (!isNaN(hours) && hours > 0) {
      chrome.alarms.create('auto-queue-check', {
        delayInMinutes: hours * 60,
        periodInMinutes: hours * 60,
      });
    }
  });
}

// Imposta allarme all'avvio del service worker
chrome.storage.sync.get({ autoQueueInterval: '12' }, ({ autoQueueInterval }) => {
  setupAutoQueueAlarm(autoQueueInterval);
});

// ── Chat con l'Archivio (RAG) ────────────────────────────────────────────────

/**
 * Risponde a una domanda in linguaggio naturale usando i riepiloghi come contesto.
 * @param {string} question - La domanda dell'utente
 * @returns {{ success, answer, sources, noteCount }}
 */
async function chatQuery(question) {
  const [settings, allSummaries] = await Promise.all([
    Storage.getSettings(),
    Storage.getSummaries(),
  ]);
  if (!settings.geminiApiKey) throw new Error('API key Gemini non configurata. Vai nelle Impostazioni.');
  if (!allSummaries?.length) return { success: true, answer: null, sources: [], noteCount: 0 };

  const summaries = allSummaries.filter(s => s.status === 'extracted' && s.markdown);
  if (!summaries.length) return { success: true, answer: null, sources: [], noteCount: 0 };

  const { answer, sources } = await GeminiAPI.chatWithArchive(question, summaries, settings);
  return { success: true, answer, sources, noteCount: summaries.length };
}

// ── Ricerca Semantica ─────────────────────────────────────────────────────────

/**
 * Ordina i riepiloghi per rilevanza semantica rispetto alla query.
 * @param {string} query - Testo della ricerca
 * @returns {{ success, rankedIds: string[], noteCount: number }}
 */
async function semanticSearch(query) {
  const [settings, allSummaries] = await Promise.all([
    Storage.getSettings(),
    Storage.getSummaries(),
  ]);
  if (!settings.geminiApiKey) throw new Error('API key Gemini non configurata.');

  const summaries = allSummaries.filter(s => s.status === 'extracted');
  if (!summaries.length) return { success: true, rankedIds: [], noteCount: 0 };

  const rankedIds = await GeminiAPI.semanticRank(
    query,
    summaries.map(s => ({ id: s.id, title: s.title, channelName: s.channelName, tags: s.tags })),
    settings.geminiApiKey,
    settings.model
  );
  return { success: true, rankedIds, noteCount: summaries.length };
}

// ── Topic Alerts ─────────────────────────────────────────────────────────────

async function updateCreatorTopics(channelId, topics) {
  await Storage.updateCreatorTopics(channelId, topics);
  return { success: true };
}

/**
 * Controlla i feed di tutti i creator con topic configurati.
 * Per ogni nuovo video (non ancora valutato), chiama Gemini per verificare
 * la pertinenza e invia una notifica Chrome se il video corrisponde.
 * @param {string|null} filterChannelId - se passato, controlla solo quel creator
 */
async function checkTopicsAndNotify(filterChannelId = null) {
  const creators  = await Storage.getCreators();
  const settings  = await Storage.getSettings();

  if (!settings.geminiApiKey) return { success: false, reason: 'no_api_key' };

  const notified   = await Storage.getNotifiedVideos();
  const newVideoIds = [];
  const toNotify    = [];

  // Filtra solo i creator con topic impostati (e opzionalmente per channelId)
  const targets = creators.filter(c =>
    c.topics?.length > 0 &&
    (!filterChannelId || c.channelId === filterChannelId)
  );

  for (const creator of targets) {
    let videos = [];
    try {
      // fetchChannelFeed aggiorna anche la cache RSS — usa quella se fresca
      videos = await fetchChannelFeed(creator.channelId);
    } catch { continue; }

    // Considera solo i video non ancora valutati (max ultimi 10)
    const newVideos = videos
      .filter(v => !notified.has(v.videoId))
      .slice(0, 10);

    if (!newVideos.length) continue;

    for (const video of newVideos) {
      newVideoIds.push(video.videoId); // segna come valutato

      const matches = await GeminiAPI.checkTopicMatch(
        video.title,
        video.description,
        creator.topics,
        settings.geminiApiKey,
        settings.model || GeminiAPI.DEFAULT_MODEL
      ).catch(() => false);

      if (matches) {
        toNotify.push({ video, creator });
      }
    }
  }

  // Persisti tutti i videoId valutati (sia match che no) per non riesaminarli
  if (newVideoIds.length) {
    await Storage.addNotifiedVideos(newVideoIds);
  }

  // Invia notifiche (con piccolo delay tra l'una e l'altra)
  for (const { video, creator } of toNotify) {
    showNotification(
      `📚 ${creator.channelName} — Argomento rilevato`,
      `"${video.title.slice(0, 80)}" corrisponde ai tuoi interessi`
    );
    await delay(400);
  }

  return { success: true, checked: newVideoIds.length, notified: toNotify.length };
}

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
});
