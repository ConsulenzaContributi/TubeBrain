// popup.js — Learning Hub v1.4.0
// Estrae dati video via chrome.scripting (world:MAIN), fetch captions direttamente.

const $ = id => document.getElementById(id);
const show = id => $(id)?.classList.remove('hidden');
const hide = id => $(id)?.classList.add('hidden');

let currentVideoData = null;
let currentMarkdown  = null;
let currentTags      = [];
let currentPageType  = 'web'; // 'web' | 'instagram-post' | 'instagram-reel' | 'instagram-profile'
let currentLearningMode = 'study';

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await loadStats();
  await loadPopupPreferences();
  await detectVideo();
  bindButtons();
});

async function loadPopupPreferences() {
  try {
    const settings = await bg('GET_SETTINGS').then(r => r.settings);
    currentLearningMode = settings.defaultLearningMode || 'study';
    if ($('learning-mode')) $('learning-mode').value = currentLearningMode;
  } catch {}
}

async function loadStats() {
  try {
    const { stats } = await bg('GET_STATS');
    if (stats?.totalSummarized > 0)
      $('footer-stats').textContent = `${stats.totalSummarized} riepiloghi`;
  } catch {}
}

// ── Rilevamento video ─────────────────────────────────────────────────────────

// ── Rilevamento tipo pagina Instagram ────────────────────────────────────────

function detectInstagramType(url) {
  if (/instagram\.com\/reel\//.test(url))              return 'instagram-reel';
  if (/instagram\.com\/p\//.test(url))                 return 'instagram-post';
  if (/instagram\.com\/(tv|stories)\//.test(url))      return 'instagram-post';
  if (/instagram\.com\/[^/]+\/?(\?.*)?$/.test(url) &&
      !/instagram\.com\/(explore|direct|accounts|ar|privacy|about|legal|press|jobs|faq)/.test(url))
    return 'instagram-profile';
  return 'instagram-post';
}

function applyInstagramUI(igType) {
  const iconEl  = document.querySelector('#state-not-youtube .state-icon');
  const titleEl = document.querySelector('#state-not-youtube .state-title');
  const subEl   = document.querySelector('#state-not-youtube p.state-sub');
  const hintEl  = $('webpage-hint');
  const btnEl   = $('btn-analyze-page');

  const typeLabel = igType === 'instagram-reel'    ? 'Reel'
                  : igType === 'instagram-profile' ? 'Profilo'
                  : 'Post';

  if (iconEl)  iconEl.textContent  = '📸';
  if (titleEl) titleEl.textContent = `${typeLabel} Instagram rilevato`;
  if (subEl)   subEl.textContent   = `Analizza questo ${typeLabel} con Gemini AI`;
  if (hintEl)  hintEl.textContent  = 'Caption, hashtag, testo visibile nella pagina · Note: i Reel non hanno trascrizione audio';
  if (btnEl) {
    btnEl.innerHTML = `<span class="btn-icon">📸</span> Analizza ${typeLabel} Instagram`;
    btnEl.style.display = '';
  }
}

function applyWebUI(isReadable) {
  // Ripristina UI default per pagine web generiche
  const iconEl  = document.querySelector('#state-not-youtube .state-icon');
  const titleEl = document.querySelector('#state-not-youtube .state-title');
  const subEl   = document.querySelector('#state-not-youtube p.state-sub');
  const hintEl  = $('webpage-hint');
  const btnEl   = $('btn-analyze-page');

  if (iconEl)  iconEl.textContent  = '🎬';
  if (titleEl) titleEl.textContent = 'Nessun video YouTube';
  if (subEl)   subEl.textContent   = 'Apri un video YouTube, oppure analizza questa pagina web.';
  if (hintEl)  hintEl.textContent  = 'Articoli, blog post, documentazione — qualsiasi pagina con testo';
  if (btnEl) {
    btnEl.innerHTML = '<span class="btn-icon">📄</span> Analizza questa pagina';
    btnEl.style.display = isReadable ? '' : 'none';
  }
}

async function detectVideo() {
  showState('loading-info');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('youtube.com/watch')) {
      const url = tab?.url || '';
      // Pagina web generica
      currentPageType = 'web';
      const isReadable = url &&
        !url.startsWith('chrome') &&
        !url.startsWith('about') &&
        !url.startsWith('chrome-extension');
      applyWebUI(isReadable);
      showState('not-youtube');
      return;
    }

    const settings = await bg('GET_SETTINGS').then(r => r.settings);

    // Leggi ytInitialPlayerResponse direttamente nel contesto pagina
    let pageData = null;
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: extractPageVideoData,
      });
      pageData = res?.result ?? null;
    } catch (e) {
      showError(`Errore accesso pagina: ${e.message}. Ricarica la tab YouTube (F5) e riprova.`);
      return;
    }

    if (!pageData?.videoId) {
      showError('Nessun video rilevato. Ricarica la pagina YouTube (F5) e riapri il plugin.');
      return;
    }

    // Fetch trascrizione
    const lang = settings.language === 'auto'
      ? (navigator.language || 'it').split('-')[0]
      : (settings.language || 'it');
    const track = selectBestTrack(pageData.captionTracks, lang);
    let transcript = '', transcriptSegments = [], captionLang = null, captionType = null, warning = null;
    if (track) {
      try {
        const captionData = await fetchCaption(track.baseUrl, pageData.chapters || []);
        transcript = captionData.transcript;
        transcriptSegments = captionData.segments;
        captionLang = track.languageCode;
        captionType = track.kind;
      }
      catch { warning = 'caption_fetch_failed'; }
    } else { warning = 'no_captions'; }

    currentVideoData = { ...pageData, transcript, transcriptSegments, captionLang, captionType, warning };
    await showVideoState(currentVideoData, settings);

  } catch (e) { showError(e.message); }
}

// Eseguita in world:'MAIN' — nessun riferimento a scope esterno
function extractPageVideoData() {
  try {
    const pr = window.ytInitialPlayerResponse;
    if (!pr) return null;
    const vd = pr.videoDetails || {};
    const mf = pr.microformat?.playerMicroformatRenderer || {};

    let captionTracks = [];
    try {
      captionTracks = pr.captions.playerCaptionsTracklistRenderer.captionTracks.map(c => ({
        baseUrl: c.baseUrl, languageCode: c.languageCode,
        kind: c.kind || 'manual', name: (c.name?.simpleText) || c.languageCode,
      }));
    } catch {}

    let chapters = [];
    try {
      chapters = (mf.chapters || []).map(ch => ({
        title: ch.chapterRenderer.title.simpleText,
        startMs: parseInt(ch.chapterRenderer.timeRangeStartMillis || 0),
      }));
    } catch {}

    return {
      videoId:     vd.videoId     || '',
      title:       vd.title       || document.title || '',
      channelId:   vd.channelId   || '',
      channelName: vd.author      || '',
      duration:    parseInt(vd.lengthSeconds || 0),
      description: (vd.shortDescription || '').slice(0, 1000),
      viewCount:   parseInt(vd.viewCount || 0),
      publishDate: mf.publishDate || mf.uploadDate || '',
      captionTracks, chapters,
    };
  } catch (e) { return { _error: e.message }; }
}

// ── Caption helpers ───────────────────────────────────────────────────────────

function selectBestTrack(tracks, lang) {
  if (!tracks?.length) return null;
  const manual = tracks.filter(t => t.kind !== 'asr');
  const auto   = tracks.filter(t => t.kind === 'asr');
  return manual.find(t => t.languageCode.startsWith(lang))
      || auto.find(t => t.languageCode.startsWith(lang))
      || manual[0] || auto[0] || tracks[0];
}

function formatCaptionWithChapters(segs, chapters = []) {
  if (!chapters.length) return null;
  return chapters.map((chapter, index) => {
    const start = chapter.startMs || 0;
    const end = chapters[index + 1]?.startMs ?? Infinity;
    const chapterSegs = segs.filter(seg => seg.ms >= start && seg.ms < end);
    return `## ${chapter.title} [${msTs(start)}]\n${chapterSegs.map(seg => seg.text).join(' ')}`;
  }).join('\n\n');
}

async function fetchCaption(baseUrl, chapters = []) {
  const url = new URL(baseUrl);
  url.searchParams.set('fmt', 'json3');
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Captions HTTP ${res.status}`);
  const data = await res.json();
  if (!data.events) return { transcript: '', segments: [] };

  const segs = [];
  for (const ev of data.events) {
    if (!ev.segs) continue;
    const t = ev.segs.map(s => s.utf8 || '').join('').replace(/\n/g, ' ').trim();
    if (t) segs.push({ ms: ev.tStartMs || 0, text: t });
  }
  const chapterTranscript = formatCaptionWithChapters(segs, chapters);
  if (chapterTranscript) {
    return { transcript: chapterTranscript, segments: segs };
  }
  let out = '', block = [], bs = 0;
  for (const s of segs) {
    if (s.ms - bs > 45000 && block.length) {
      out += `[${msTs(bs)}] ${block.join(' ')}\n`;
      block = []; bs = s.ms;
    }
    block.push(s.text);
  }
  if (block.length) out += `[${msTs(bs)}] ${block.join(' ')}\n`;
  return { transcript: out, segments: segs };
}

function msTs(ms) {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
  return h > 0
    ? `${h}:${String(m%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`
    : `${m}:${String(s%60).padStart(2,'0')}`;
}

// ── Visualizzazione stato video ───────────────────────────────────────────────

async function showVideoState(vd, settings) {
  $('video-thumb').src = `https://i.ytimg.com/vi/${vd.videoId}/mqdefault.jpg`;
  $('video-title').textContent  = vd.title || 'Titolo non disponibile';
  $('video-channel').textContent = vd.channelName || '';

  const badges = $('video-badges');
  if (badges) {
    badges.innerHTML = '';
    if (vd.captionTracks?.length)
      badges.innerHTML += `<span class="badge info">CC: ${vd.captionTracks.map(t=>t.languageCode).join(', ')}</span>`;
  }
  if (vd.warning === 'no_captions') show('no-captions-warn');
  updateWorkflowPreview(vd);

  // Statistiche video
  updateStatsDisplay(vd);

  try {
    const { summarized } = await bg('CHECK_VIDEO_SUMMARIZED', { videoId: vd.videoId });
    if (summarized) show('already-summarized');
  } catch {}

  if (!settings.geminiApiKey) {
    $('btn-generate').disabled = true;
    showBanner('⚙️ API key non configurata. <a id="link-settings" href="#">Vai alle Impostazioni →</a>');
    document.addEventListener('click', e => {
      if (e.target.id === 'link-settings') { e.preventDefault(); openSettings(); }
    }, { once: true });
  }
  showState('video');
}

function updateWorkflowPreview(vd) {
  const chapters = Array.isArray(vd.chapters) ? vd.chapters.length : 0;
  const transcriptLines = (vd.transcript || '').split('\n').filter(Boolean).length;
  const transcriptState = vd.warning === 'no_captions'
    ? 'Metadati only'
    : transcriptLines > 0
      ? `${transcriptLines} blocchi`
      : 'In attesa';

  if ($('metric-chapters')) $('metric-chapters').textContent = chapters || 'Auto';
  if ($('metric-language')) $('metric-language').textContent = (vd.captionLang || 'auto').toUpperCase();
  if ($('metric-transcript')) $('metric-transcript').textContent = transcriptState;

  const health = $('transcript-health');
  if (health) {
    health.textContent = vd.warning === 'no_captions' ? 'CC assenti' : vd.captionLang ? `CC ${vd.captionLang}` : 'CC rilevate';
    health.classList.toggle('warn', vd.warning === 'no_captions');
  }

  updateModePreview($('learning-mode')?.value || currentLearningMode || 'study');
}

function updateModePreview(mode) {
  const descriptions = {
    verbatim: 'Il file aprirà sulla trascrizione integrale, utile quando vuoi massima fedeltà e ricostruzione completa del tutorial.',
    study: 'Il file aprirà in priorità la modalità Studio guidato, mantenendo comunque tutte le altre sezioni nello stesso MDX.',
    summary: 'Il file aprirà sulla sintesi rapida per capitoli, ideale per un ripasso veloce prima di eseguire il workflow.',
  };
  document.querySelectorAll('[data-mode-card]').forEach(card => {
    card.classList.toggle('mode-preview-card-active', card.dataset.modeCard === mode);
  });
  if ($('mode-description')) $('mode-description').textContent = descriptions[mode] || descriptions.study;
}

function updateStatsDisplay(vd) {
  const viewEl = $('video-views');
  const dateEl = $('video-pubdate');
  if (viewEl && vd.viewCount > 0)
    viewEl.textContent = `👁 ${formatNumber(vd.viewCount)} visualizzazioni`;
  if (dateEl && vd.publishDate)
    dateEl.textContent = `📅 ${vd.publishDate}`;
}

function formatNumber(n) {
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
  return n.toString();
}

// ── Refresh statistiche video ─────────────────────────────────────────────────

async function refreshVideoStats() {
  const btn = $('btn-refresh-stats');
  if (!btn || !currentVideoData) return;
  btn.classList.add('spinning');
  btn.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => {
        const vd = window.ytInitialPlayerResponse?.videoDetails || {};
        return { viewCount: parseInt(vd.viewCount || 0) };
      },
    });
    if (res?.result?.viewCount) {
      currentVideoData.viewCount = res.result.viewCount;
      updateStatsDisplay(currentVideoData);
    }
  } catch {}
  btn.classList.remove('spinning');
  btn.disabled = false;
}

// ── Banner utility ────────────────────────────────────────────────────────────

function showBanner(html) {
  document.querySelector('.warn-banner')?.remove();
  const div = document.createElement('div');
  div.className = 'warn-banner';
  div.style.cssText = 'background:#fff3cd;color:#856404;padding:8px 12px;font-size:12px;border-radius:6px;margin-bottom:10px;';
  div.innerHTML = html;
  $('state-video')?.prepend(div);
}

// ── Generazione riepilogo ─────────────────────────────────────────────────────

async function generate() {
  if (!currentVideoData) return;
  currentLearningMode = $('learning-mode')?.value || currentLearningMode || 'study';
  showState('generating');
  setProgress(10, 'Dati video pronti...');
  try {
    setProgress(currentVideoData.transcript ? 30 : 20,
      currentVideoData.transcript ? 'Trascrizione pronta. Avvio analisi AI...' : 'Analisi da metadati...');
    setProgress(40, 'Creazione Learning MDX con Gemini 2.5 Flash...');
    const result = await bg('GENERATE_SUMMARY', {
      videoData: currentVideoData,
      generationOptions: { learningMode: currentLearningMode },
    });
    if (!result.success) throw new Error(result.error);
    currentMarkdown = result.markdown;
    currentTags     = result.tags || [];
    if (result.transcriptQuality) currentVideoData.transcriptQuality = result.transcriptQuality;

    // ── Auto-save immediato senza conferma ────────────────────────────────
    setProgress(90, 'Salvataggio automatico...');
    const saveResult = await bg('SAVE_SUMMARY', {
      summary: { ...currentVideoData, tags: currentTags, learningMode: currentLearningMode, outputFormat: 'mdx' },
      rawMarkdown: currentMarkdown,
      generationOptions: { learningMode: currentLearningMode },
    });
    if (!saveResult.success) throw new Error(saveResult.error);

    setProgress(100, 'Completato e salvato!');
    await delay(400);
    showDoneState(saveResult.filename);

  } catch (e) { showError(e.message); }
}

function showDoneState(filename) {
  if ($('done-filename')) {
    const f = filename || sanitizeFilename(currentVideoData?.title||'video', currentVideoData?.channelName||'channel');
    $('done-filename').textContent = '💾 ' + f.split('/').pop(); // mostra solo il nome file
  }
  const tw = $('tags-wrap');
  if (tw) tw.innerHTML = currentTags.map(t=>`<span class="tag">#${t}</span>`).join('');
  const pv = $('preview-content');
  if (pv) pv.innerHTML = markdownToPreview(currentMarkdown);
  showState('done');
}

// ── Re-download (il file è già salvato, questa è una copia extra) ─────────────

async function save() {
  const btn = $('btn-save');
  btn.disabled = true; btn.textContent = '📂 Scaricando...';
  try {
    // Crea una copia aggiuntiva del file già salvato
    const blob = new Blob([currentMarkdown || ''], { type: 'text/markdown' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = sanitizeFilename(currentVideoData?.title||'video', currentVideoData?.channelName||'channel');
    a.click();
    URL.revokeObjectURL(url);
    btn.textContent = '✅ Scaricato!';
    setTimeout(() => { btn.textContent = '📂 Scarica copia MDX'; btn.disabled = false; }, 2000);
  } catch {
    btn.disabled = false; btn.textContent = '📂 Scarica copia MDX';
  }
}

// ── Aggiungi alla coda (senza estrarre) ──────────────────────────────────────

async function addToQueue() {
  if (!currentVideoData) return;
  const btn = $('btn-add-queue');
  if (!btn) return;
  btn.disabled = true;
  try {
    const r = await bg('ADD_TO_QUEUE', { videoData: currentVideoData });
    btn.textContent = r.success ? '✅ Aggiunto in coda!' : r.reason === 'already_exists' ? '✓ Già in archivio' : '❌ Errore';
  } catch { btn.disabled = false; btn.textContent = '🕐 Aggiungi alla coda'; }
}

async function copy() {
  if (!currentMarkdown) return;
  await navigator.clipboard.writeText(currentMarkdown);
  const btn = $('btn-copy');
  btn.textContent = '✅ Copiato!';
  setTimeout(() => { btn.textContent = '📋 Copia MDX'; }, 1500);
}

async function addCreator() {
  if (!currentVideoData?.channelId) return;
  const btn = $('btn-add-creator');
  btn.disabled = true;
  try {
    const r = await bg('ADD_CREATOR', {
      url: currentVideoData.channelId.startsWith('UC')
        ? `https://youtube.com/channel/${currentVideoData.channelId}`
        : currentVideoData.channelId,
    });
    btn.textContent = r.success ? '✅ Creator aggiunto!' : r.reason === 'already_exists' ? '✓ Già seguito' : '❌ Errore';
  } catch { btn.disabled = false; btn.textContent = '➕ Segui Creator'; }
}

// ── Binding ───────────────────────────────────────────────────────────────────

function bindButtons() {
  $('btn-dashboard')?.addEventListener('click', () => bg('OPEN_DASHBOARD'));
  $('btn-settings')?.addEventListener('click', openSettings);
  $('btn-settings-err')?.addEventListener('click', openSettings);
  $('btn-generate')?.addEventListener('click', generate);
  $('btn-add-creator')?.addEventListener('click', addCreator);
  $('btn-add-queue')?.addEventListener('click', addToQueue);
  $('btn-refresh-stats')?.addEventListener('click', refreshVideoStats);
  $('btn-save')?.addEventListener('click', save);
  $('btn-copy')?.addEventListener('click', copy);
  $('btn-retry')?.addEventListener('click', () => detectVideo());
  $('btn-new')?.addEventListener('click', () => detectVideo());
  $('btn-open-yt')?.addEventListener('click', () => chrome.tabs.create({ url: 'https://youtube.com' }));
  $('link-existing')?.addEventListener('click', e => { e.preventDefault(); bg('OPEN_DASHBOARD'); });
  $('btn-analyze-page')?.addEventListener('click', analyzeWebPage);
  $('learning-mode')?.addEventListener('change', (event) => {
    currentLearningMode = event.target.value;
    updateModePreview(currentLearningMode);
  });
}

// ── Analisi articolo web ──────────────────────────────────────────────────────

/** Funzione iniettata nella pagina per estrarre il testo dell'articolo. */
function extractArticleFromPage() {
  try {
    const title    = document.title || '';
    const url      = location.href;
    const siteMeta = document.querySelector('meta[property="og:site_name"]');
    const siteName = siteMeta?.content || '';
    const authMeta = document.querySelector('meta[name="author"],meta[property="article:author"]');
    const author   = authMeta?.content || '';
    const dateMeta = document.querySelector(
      'meta[property="article:published_time"],meta[name="date"],time[datetime],time[pubdate]'
    );
    const date      = dateMeta?.getAttribute('content') || dateMeta?.getAttribute('datetime') || '';
    const ogImage   = document.querySelector('meta[property="og:image"]');
    const thumbnail = ogImage?.content || '';

    // Selezione elemento principale
    const sel = ['article','[role="main"]','main','.article-body','.post-content',
                  '.entry-content','.article-content','#article','#content','body'];
    let mainEl = null;
    for (const s of sel) { mainEl = document.querySelector(s); if (mainEl) break; }
    if (!mainEl) mainEl = document.body;

    // Clona e rimuovi elementi di navigazione/UI
    const clone = mainEl.cloneNode(true);
    clone.querySelectorAll(
      'script,style,nav,header,footer,aside,.sidebar,.menu,.nav,.advertisement,' +
      '[role="navigation"],[role="banner"],[role="complementary"],.cookie-banner,.popup'
    ).forEach(el => el.remove());

    let text = (clone.innerText || clone.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
    return { title, url, siteName, author, date, thumbnail, text: text.slice(0, 60000) };
  } catch (e) { return { error: e.message }; }
}

async function analyzeWebPage() {
  // Se siamo su Instagram, delega ad analyzeInstagramPage
  if (currentPageType && currentPageType.startsWith('instagram')) {
    return analyzeInstagramPage();
  }

  const settings = await bg('GET_SETTINGS').then(r => r.settings);
  if (!settings.geminiApiKey) {
    showBanner('⚙️ API key non configurata. <a id="link-settings" href="#">Vai alle Impostazioni →</a>');
    document.addEventListener('click', e => {
      if (e.target.id === 'link-settings') { e.preventDefault(); openSettings(); }
    }, { once: true });
    return;
  }

  showState('analyzing-page');
  setArticleProgress(15, 'Lettura pagina…');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Estrai testo articolo dalla pagina
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: extractArticleFromPage,
    });
    const articleData = res?.result;
    if (!articleData || articleData.error || !articleData.title) {
      throw new Error('Impossibile leggere il contenuto della pagina.');
    }
    if (!articleData.text || articleData.text.length < 100) {
      throw new Error('Contenuto testo troppo scarso. Prova su una pagina con più testo.');
    }

    setArticleProgress(40, 'Analisi AI con Gemini…');
    const result = await bg('ANALYZE_WEBPAGE', { articleData });
    if (!result.success) throw new Error(result.error || 'Errore analisi');

    setArticleProgress(100, 'Salvato!');
    await delay(300);

    // Riusa lo stato "done" con dati dell'articolo
    currentMarkdown = result.markdown;
    currentTags     = [];
    currentVideoData = { title: articleData.title, videoId: null };
    if ($('done-filename'))
      $('done-filename').textContent = '💾 ' + (result.filename?.split('/').pop() || 'articolo.mdx');
    const tw = $('tags-wrap');
    if (tw) tw.innerHTML = '';
    const pv = $('preview-content');
    if (pv) pv.innerHTML = markdownToPreview(result.markdown);
    showState('done');

  } catch (e) { showError(e.message); }
}

// ── Instagram scraper + analisi ───────────────────────────────────────────────

/** Eseguita in world:'MAIN' — estrae dati da una pagina Instagram. */
function extractInstagramFromPage() {
  try {
    const url = window.location.href;
    const pathname = window.location.pathname;

    // Tipo pagina
    let pageType = 'post';
    if (/\/reel\//.test(pathname))                        pageType = 'reel';
    else if (/\/(tv|stories)\//.test(pathname))           pageType = 'post';
    else if (!/\/(p|reel|tv|stories|explore|direct)\//.test(pathname))
      pageType = 'profile';

    // OG meta tags (più affidabili su Instagram)
    const getMeta = prop => {
      const el = document.querySelector(`meta[property="${prop}"]`)
               || document.querySelector(`meta[name="${prop}"]`);
      return el ? (el.getAttribute('content') || '') : '';
    };
    const ogTitle  = getMeta('og:title');
    const ogDesc   = getMeta('og:description');
    const ogImage  = getMeta('og:image');
    const ogUrl    = getMeta('og:url') || url;

    // Username dall'URL o dall'OG title
    let username = '';
    const urlUser = pathname.match(/^\/([^/]+)\//);
    if (urlUser && !['p','reel','tv','stories','explore','direct','accounts'].includes(urlUser[1]))
      username = urlUser[1];
    if (!username) {
      const titleUser = ogTitle.match(/^(.+?) (?:on Instagram|·)/i);
      if (titleUser) username = titleUser[1].trim().replace(/^@/, '');
    }

    // Testo dall'elemento article (fallback approfondito)
    let articleText = '';
    try {
      const root = document.querySelector('article, main, [role="main"]') || document.body;
      const clone = root.cloneNode(true);
      clone.querySelectorAll(
        'button, svg, script, style, header, footer, nav, [aria-hidden="true"], [role="button"]'
      ).forEach(el => el.remove());
      articleText = (clone.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
    } catch (_) {}

    // Combina testo: OG description + article text (evita duplicati)
    const combined = ogDesc && articleText.includes(ogDesc.slice(0, 30))
      ? articleText
      : [ogDesc, articleText].filter(Boolean).join('\n\n');

    // Hashtag e menzioni
    const raw = (ogDesc || '') + ' ' + articleText;
    const hashtags = [...new Set((raw.match(/#[\wÀ-ɏ]+/g) || []))].slice(0, 40);
    const mentions = [...new Set((raw.match(/@[\w.]+/g) || []))].slice(0, 20);

    // Titolo pulito
    let title = ogTitle || document.title || `${pageType} di @${username}`;
    if (title.length > 120) title = title.slice(0, 120) + '…';

    return {
      title,
      url:      ogUrl,
      text:     combined.slice(0, 20000),
      caption:  ogDesc,
      username,
      pageType,
      hashtags,
      mentions,
      siteName: `Instagram${username ? ' @' + username : ''}`,
      thumbnail: ogImage,
      platform: 'instagram',
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function analyzeInstagramPage() {
  const settings = await bg('GET_SETTINGS').then(r => r.settings);
  if (!settings.geminiApiKey) {
    showBanner('⚙️ API key non configurata. <a id="link-settings" href="#">Vai alle Impostazioni →</a>');
    document.addEventListener('click', e => {
      if (e.target.id === 'link-settings') { e.preventDefault(); openSettings(); }
    }, { once: true });
    return;
  }

  showState('analyzing-page');
  const typeLabel = currentPageType === 'instagram-reel'    ? 'Reel'
                  : currentPageType === 'instagram-profile' ? 'Profilo'
                  : 'Post';
  setArticleProgress(10, `Lettura ${typeLabel} Instagram…`);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Estrai dati dalla pagina Instagram
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: extractInstagramFromPage,
    });
    const igData = res?.result;
    if (!igData || igData.error) {
      throw new Error('Impossibile leggere la pagina Instagram. Assicurati di essere loggato e prova a ricaricare la pagina.');
    }

    // Se non c'è quasi testo, avvisa ma procedi comunque
    const hasText = (igData.text || '').length > 30;
    if (!hasText) {
      igData.text = `Tipo: ${igData.pageType}\nCreator: @${igData.username}\nURL: ${igData.url}\n(Testo estratto molto scarso — Instagram può limitare il contenuto visibile agli utenti non loggati o su determinati contenuti)`;
    }

    setArticleProgress(40, 'Analisi AI con Gemini…');
    const result = await bg('ANALYZE_WEBPAGE', { articleData: igData });
    if (!result.success) throw new Error(result.error || 'Errore analisi');

    setArticleProgress(100, 'Salvato!');
    await delay(300);

    currentMarkdown  = result.markdown;
    currentTags      = [];
    currentVideoData = { title: igData.title, videoId: null };
    if ($('done-filename'))
      $('done-filename').textContent = '💾 ' + (result.filename?.split('/').pop() || 'instagram.mdx');
    const tw = $('tags-wrap');
    if (tw) tw.innerHTML = '';
    const pv = $('preview-content');
    if (pv) pv.innerHTML = markdownToPreview(result.markdown);
    showState('done');

  } catch (e) { showError(e.message); }
}

function setArticleProgress(pct, lbl) {
  const b = $('article-progress-bar'); if (b) b.style.width = `${pct}%`;
  const l = $('article-progress-step'); if (l && lbl) l.textContent = lbl;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'SUMMARY_PROGRESS')
    setProgress(msg.percent, msg.step === 'generating' ? 'Analisi AI in corso...' : 'Estrazione tag...');
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function showState(name) {
  ['not-youtube','loading-info','video','generating','analyzing-page','done','error'].forEach(s =>
    $(`state-${s}`)?.classList.add('hidden'));
  $(`state-${name}`)?.classList.remove('hidden');
}
function showError(msg) { if ($('error-message')) $('error-message').textContent = msg; showState('error'); }
function setProgress(pct, lbl) {
  const b = $('progress-bar'); if (b) b.style.width = `${pct}%`;
  const l = $('progress-label'); if (l && lbl) l.textContent = lbl;
}
function openSettings() { chrome.runtime.openOptionsPage(); }
function bg(action, data={}) { return chrome.runtime.sendMessage({ action, ...data }); }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function sanitizeFilename(title, channel) {
  const d = new Date().toISOString().slice(0,10);
  const s = x => x.replace(/[<>:"/\\|?*]/g,'').replace(/\s+/g,'_').slice(0,50);
  return `${d}_${s(channel)}_${s(title)}.mdx`;
}
function markdownToPreview(md) {
  if (!md) return '';
  return md.slice(0,1500)
    .replace(/^---[\s\S]*?---\n/,'')
    .replace(/^# (.+)$/m,'<h1>$1</h1>')
    .replace(/^## (.+)$/gm,'<h2>$1</h2>')
    .replace(/^### (.+)$/gm,'<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/^[-*] (.+)$/gm,'<li>$1</li>')
    .replace(/\n\n/g,'<br><br>').replace(/\n/g,'<br>');
}
