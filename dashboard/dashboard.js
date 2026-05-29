// dashboard.js — Learning Hub Dashboard Logic v2.3.1

const $ = id => document.getElementById(id);
const bg = (action, data = {}) => chrome.runtime.sendMessage({ action, ...data });

let allSummaries = [];
let allCreators  = [];
let allFeed      = [];
let activeSummary = null;
const _avatarRefreshAttempted = new Set();

// Map state
let mapRendered = false;

// Chat state
let chatHistory = [];
let chatInitialized = false;
let semanticMode = false;
let semanticRankedIds = [];

// ── Barra di progresso globale ────────────────────────────────────────────────

const Progress = {
  _pollInterval: null,

  show(label, current, total, detail = '') {
    const bar = $('global-progress-bar');
    if (!bar) return;
    const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
    bar.classList.remove('hidden');
    document.body.classList.add('progress-active');
    $('gp-label').textContent   = label;
    $('gp-counter').textContent = `${current} / ${total}`;
    $('gp-fill').style.width    = `${pct}%`;
    $('gp-detail').textContent  = detail;
  },

  hide() {
    const bar = $('global-progress-bar');
    if (bar) bar.classList.add('hidden');
    document.body.classList.remove('progress-active');
    this._stopPoll();
  },

  _stopPoll() {
    if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = null; }
  },

  // Polling per estrazioni bulk: controlla ogni 5s quanti sono passati da pending → extracted
  pollExtraction(targetIds, onComplete) {
    this._stopPoll();
    const total = targetIds.length;
    this.show('📊 Estrazione in corso…', 0, total, 'Avvio elaborazione…');

    this._pollInterval = setInterval(async () => {
      const { summaries } = await bg('GET_SUMMARIES').catch(() => ({ summaries: allSummaries }));
      const done    = summaries.filter(s => targetIds.includes(s.id) && s.status !== 'pending').length;
      const current = summaries.find(s => targetIds.includes(s.id) && s.status === 'pending');
      const detail  = current ? `In elaborazione: "${current.title?.slice(0, 60)}…"` : 'Completamento…';
      this.show('📊 Estrazione in corso…', done, total, detail);

      if (done >= total) {
        this.show('✅ Estrazione completata!', total, total, '');
        this._stopPoll();
        setTimeout(async () => {
          this.hide();
          await loadSummaries();
          renderCreatorsArchives();
          if (onComplete) onComplete();
        }, 1500);
      }
    }, 5000);
  },
};

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  bindNav();
  bindButtons();
  await Promise.all([loadCreators(), loadSummaries(), loadStats()]);
  await loadFeed();
  loadNewVideosCounts(); // non-blocking — aggiorna badge nuovi video per creator
  updateWorkspaceInsights();
});

// ── Navigation ────────────────────────────────────────────────────────────────

function bindNav() {
  document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', false);
    t.classList.toggle('hidden', true);
  });
  document.querySelectorAll('.nav-item[data-tab]').forEach(b => b.classList.remove('active'));

  const tab = $(`tab-${name}`);
  if (tab) { tab.classList.remove('hidden'); tab.classList.add('active'); }
  const navBtn = document.querySelector(`.nav-item[data-tab="${name}"]`);
  if (navBtn) navBtn.classList.add('active');

  // Lazy-render map on first switch
  if (name === 'map' && !mapRendered) {
    requestAnimationFrame(() => renderMap());
  }
  // Initialize chat on first switch
  if (name === 'chat' && !chatInitialized) {
    initChat();
  }
}

window.switchTab = switchTab;

// ── Buttons ───────────────────────────────────────────────────────────────────

function bindButtons() {
  $('btn-refresh-feed').addEventListener('click', () => loadFeed(true));
  $('btn-settings-sidebar').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('btn-map-refresh')?.addEventListener('click', () => { mapRendered = false; renderMap(); });
  $('btn-map-detail-close')?.addEventListener('click', () => $('map-node-detail')?.classList.add('hidden'));
  $('btn-add-creator').addEventListener('click', addCreator);
  $('creator-url-input').addEventListener('keydown', e => { if (e.key === 'Enter') addCreator(); });

  // Azioni bulk creator
  $('btn-refresh-all-creators').addEventListener('click', refreshAllCreators);
  $('btn-dedup-creators').addEventListener('click', deduplicateCreators);

  // Archive search
  $('archive-search').addEventListener('input', debounce(() => filterArchive(), 300));
  $('archive-filter-channel').addEventListener('change', () => filterArchive());
  $('archive-filter-status')?.addEventListener('change', () => filterArchive());

  // Semantic search
  $('btn-semantic-search')?.addEventListener('click', () => triggerSemanticSearch());
  $('btn-semantic-reset')?.addEventListener('click', () => resetSemanticSearch());
  
  // Screening buttons
  $('btn-refresh-screening')?.addEventListener('click', async () => {
    $('btn-refresh-screening').disabled = true;
    $('btn-refresh-screening').textContent = '⏳';
    await refreshAllCreators(); // questo in background fa checkAndQueueNewVideos
    $('btn-refresh-screening').disabled = false;
    $('btn-refresh-screening').textContent = '🔄 Aggiorna';
  });

  // Chat buttons
  $('btn-chat-send')?.addEventListener('click', () => sendChatMessage());
  $('btn-chat-clear')?.addEventListener('click', () => clearChat());
  $('chat-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
  });
  $('chat-input')?.addEventListener('input', () => {
    const v = $('chat-input')?.value || '';
    const cc = $('chat-char-count');
    if (cc) cc.textContent = `${v.length} / 2000`;
  });

  // Chat suggestion chips (event delegation on #chat-suggestions)
  $('chat-suggestions')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-action="chat-suggestion"]');
    if (btn) {
      const q = btn.dataset.query;
      if (q && $('chat-input')) {
        $('chat-input').value = q;
        sendChatMessage();
      }
    }
  });

  // Feed search
  $('feed-search').addEventListener('input', debounce(() => renderFeed(
    allFeed.filter(v => matchesFeedSearch(v, $('feed-search').value, $('feed-filter-creator').value))
  ), 300));
  $('feed-filter-creator').addEventListener('change', () => renderFeed(
    allFeed.filter(v => matchesFeedSearch(v, $('feed-search').value, $('feed-filter-creator').value))
  ));

  // Modal
  $('modal-backdrop').addEventListener('click', closeModal);
  $('modal-close').addEventListener('click', closeModal);
  $('modal-copy').addEventListener('click', copyModalContent);
  $('modal-download').addEventListener('click', downloadModalContent);
  $('modal-export-json')?.addEventListener('click', () => exportActiveSummary('json', $('modal-export-json')));
  $('modal-export-txt')?.addEventListener('click', () => exportActiveSummary('txt', $('modal-export-txt')));
  $('modal-export-agent')?.addEventListener('click', () => exportActiveSummary('antigravity', $('modal-export-agent')));
  $('modal-delete').addEventListener('click', deleteActiveSummary);
  $('modal-body').addEventListener('click', handleLearningInteractions);
  $('btn-batch-import')?.addEventListener('click', importBatchUrlsFromDashboard);
  $('btn-generate-path')?.addEventListener('click', generateLearningPathUI);
  $('btn-export-global-archive')?.addEventListener('click', () => bg('EXPORT_GLOBAL_ARCHIVE'));
  // ── Event delegation: Archivio globale ───────────────────────────────────
  $('archive-list').addEventListener('click', async e => {
    // Ignora click su link <a>
    if (e.target.closest('a')) return;

    const btn = e.target.closest('[data-action]');
    if (btn) {
      e.stopPropagation();
      const { action, id } = btn.dataset;
      if (action === 'extract')    await extractPending(id, btn);
      if (action === 'open-file')  await openSummaryFile(id, btn);
      if (action === 'delete')     await deleteSummaryItem(id);
      return;
    }
    // Click sulla card (non su un bottone) → apri modal
    const card = e.target.closest('.archive-item[data-id]:not(.pending)');
    if (card) {
      const s = allSummaries.find(x => x.id === card.dataset.id);
      if (s) openModal(s);
    }
  });

  // ── Event delegation: Screening globale ───────────────────────────────────
  $('screening-list')?.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (btn) {
      e.stopPropagation();
      const { action, id } = btn.dataset;
      if (action === 'approve-screening') await approveScreeningItem(id, btn);
      if (action === 'discard-screening') await deleteSummaryItem(id);
      return;
    }
  });

  // ── Event delegation: Lista Creator (card + pannello archivio inline) ────
  $('creators-list').addEventListener('click', async e => {
    if (e.target.closest('a')) return;

    const btn = e.target.closest('[data-action]');
    if (btn) {
      e.stopPropagation();
      const { action, id, channelId, channelName } = btn.dataset;
      if (action === 'toggle-archive')       toggleCreatorArchive(channelId, channelName, btn);
      if (action === 'refresh-stats')        await doRefreshStats(channelId, btn);
      if (action === 'remove-creator')       await removeCreator(channelId);
      if (action === 'extract')              await extractPending(id, btn);
      if (action === 'open-file')            await openSummaryFile(id, btn);
      if (action === 'delete-creator-item')  await deleteSummaryAndRefresh(id, channelId, channelName);
      if (action === 'extract-all-creator')  await extractAllPending(channelId, btn);
      if (action === 'toggle-topics')        toggleTopicsPanel(channelId, btn);
      if (action === 'save-topics')          await saveCreatorTopics(channelId, btn);
      if (action === 'check-topics-now')     await checkTopicsNow(channelId, btn);
      if (action === 'clear-topics')         await clearCreatorTopics(channelId, btn);
      // Auto-Queue actions
      if (action === 'check-and-queue')      await doCheckAndQueue(channelId, btn);
      if (action === 'toggle-priority')      await doTogglePriority(channelId, btn);
      if (action === 'toggle-queue-settings') toggleQueueSettingsPanel(channelId, btn);
      if (action === 'save-queue-settings')  await saveQueueSettings(channelId, btn);
      if (action === 'catchup-queue')        showCatchupModal(channelId, btn.dataset.channelName);
      if (action === 'toggle-mass-queue')    toggleMassQueuePanel(channelId, btn);
      if (action === 'analyze-mass-queue')   await analyzeMassQueue(channelId, btn);
      if (action === 'save-mass-queue')      await saveMassQueueSettings(channelId, btn);
      if (action === 'queue-mass-channel')   await queueMassChannel(channelId, btn);
      return;
    }
    // Click sulla card archivio per-creator (non pending) → apri modal
    const card = e.target.closest('.creator-archive-item[data-id][data-open-modal]');
    if (card) {
      const s = allSummaries.find(x => x.id === card.dataset.id);
      if (s) openModal(s);
    }
  });

  // Checkbox toggle auto-queue (evento 'change', non 'click')
  $('creators-list').addEventListener('change', async e => {
    const input = e.target.closest('[data-action="queue-toggle-enabled"]');
    if (!input) return;
    const channelId = input.dataset.channelId;
    try {
      await bg('UPDATE_QUEUE_SETTINGS', { channelId, settings: { autoQueueEnabled: input.checked } });
      const creator = allCreators.find(c => c.channelId === channelId);
      if (creator) creator.autoQueueEnabled = input.checked;
      const card = document.getElementById(`creator-card-${channelId}`);
      if (card) card.classList.toggle('queue-disabled', !input.checked);
    } catch (e) { console.error('Toggle queue enabled:', e); }
  });

  // ── Auto-Queue: Accoda tutti i nuovi ─────────────────────────────────────
  $('btn-queue-all-new')?.addEventListener('click', () => queueAllNewFromDashboard());

  // Catch-up modal
  $('catchup-close')?.addEventListener('click', closeCatchupModal);
  $('catchup-backdrop')?.addEventListener('click', closeCatchupModal);
  $('catchup-skip')?.addEventListener('click', closeCatchupModal);
  $('catchup-modal')?.addEventListener('click', e => {
    const opt = e.target.closest('.catchup-opt');
    if (opt) doCatchupQueue(Number(opt.dataset.count));
  });
}

// ── Feed ──────────────────────────────────────────────────────────────────────

async function loadFeed(forceRefresh = false) {
  $('feed-loading').classList.remove('hidden');
  $('feed-list').innerHTML = '';
  $('feed-empty').classList.add('hidden');

  try {
    const { feed } = await bg('GET_FEED', { forceRefresh });
    allFeed = feed || [];

    $('feed-loading').classList.add('hidden');

    if (allFeed.length === 0) {
      $('feed-empty').classList.remove('hidden');
      updateWorkspaceInsights();
      return;
    }

    // Popola filtro creator nel feed
    const creatorSet = [...new Set(allFeed.map(v => v.channelName).filter(Boolean))];
    const sel = $('feed-filter-creator');
    sel.innerHTML = '<option value="">Tutti i creator</option>' +
      creatorSet.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');

    renderFeed(allFeed);
    updateWorkspaceInsights();
  } catch (e) {
    $('feed-loading').classList.add('hidden');
    $('feed-list').innerHTML = `<p style="color:#dc3545">Errore caricamento feed: ${escHtml(e.message)}</p>`;
  }
}

async function renderFeed(videos) {
  const list = $('feed-list');

  if (videos.length === 0) {
    list.innerHTML = '<p style="color:var(--text3);padding:20px">Nessun risultato.</p>';
    return;
  }

  // Controlla quali video sono già stati riassunti
  const summarizedIds = new Set(allSummaries.map(s => s.videoId));

  list.innerHTML = videos.map(v => {
    const summarized = summarizedIds.has(v.videoId);
    const pubDate = v.publishedAt ? new Date(v.publishedAt).toLocaleDateString('it-IT') : '';
    return `
      <div class="video-card">
        <div class="video-thumb-wrap">
          <img class="video-thumb" src="${v.thumbnail}" alt="" loading="lazy">
          ${summarized ? '<div class="video-summarized-badge">✅ Riassunto</div>' : ''}
        </div>
        <div class="video-card-body">
          <p class="video-card-title">${escHtml(v.title)}</p>
          <p class="video-card-channel">${escHtml(v.channelName)} · ${pubDate}</p>
          <div class="video-card-actions">
            <button class="btn btn-primary" onclick="openVideoOnYT('${v.videoId}')">▶ Guarda</button>
            ${summarized
              ? `<button class="btn btn-ghost" onclick="viewSummaryByVideoId('${v.videoId}')">📄 Apri MDX</button>`
              : `<button class="btn btn-ghost" onclick="openVideoForSummary('${v.videoId}')">✨ Genera MDX</button>`
            }
          </div>
        </div>
      </div>
    `;
  }).join('');
}

window.openVideoOnYT = (videoId) => {
  chrome.tabs.create({ url: `https://youtube.com/watch?v=${videoId}`, active: true });
};

window.openVideoForSummary = (videoId) => {
  chrome.tabs.create({ url: `https://youtube.com/watch?v=${videoId}`, active: true });
};

window.viewSummaryByVideoId = (videoId) => {
  const s = allSummaries.find(s => s.videoId === videoId);
  if (s) openModal(s);
};

// ── Creators ──────────────────────────────────────────────────────────────────

async function loadCreators() {
  const { creators } = await bg('GET_CREATORS');
  allCreators = creators || [];
  renderCreators(allCreators);
  $('nav-creators-count').textContent = allCreators.length;
  updateWorkspaceInsights();

  // Auto-refresh avatar per creator senza avatar (sequenziale, una sola volta per sessione)
  const noAvatar = allCreators.filter(c => !c.avatar && !_avatarRefreshAttempted.has(c.channelId));
  if (noAvatar.length > 0) {
    noAvatar.forEach(c => _avatarRefreshAttempted.add(c.channelId));
    // Sequenziale: evita di aprire troppi tab background contemporaneamente
    (async () => {
      for (const c of noAvatar) {
        await bg('REFRESH_CREATOR_STATS', { channelId: c.channelId }).catch(() => {});
      }
      loadCreators();
    })();
  }
}

// Contatori nuovi video (aggiornati in background)
let newVideosCounts = {}; // { channelId: count }

async function loadNewVideosCounts() {
  try {
    const res = await bg('GET_NEW_VIDEOS_COUNT');
    if (res.success) {
      newVideosCounts = res.counts || {};
      // Aggiorna badge bulk
      const total = res.total || 0;
      const badge = $('queue-all-badge');
      if (badge) {
        badge.textContent = total;
        badge.classList.toggle('hidden', total === 0);
      }
    }
  } catch {}
}

function renderCreators(creators) {
  const list = $('creators-list');

  if (creators.length === 0) {
    $('creators-empty').classList.remove('hidden');
    list.innerHTML = '';
    return;
  }
  $('creators-empty').classList.add('hidden');

  list.innerHTML = creators.map(c => {
    const initial = (c.channelName || '?')[0].toUpperCase();
    const stats   = c.stats || {};
    const massQueueProfile = c.massQueueProfile || null;

    // Conteggio archivio
    const creatorSummaries = allSummaries.filter(s => s.channelId === c.channelId || s.channelName === c.channelName);
    const extractedCount   = creatorSummaries.filter(s => s.status !== 'pending').length;
    const pendingCount     = creatorSummaries.filter(s => s.status === 'pending').length;
    const archiveLabelParts = [];
    if (extractedCount > 0) archiveLabelParts.push(`${extractedCount} estratti`);
    if (pendingCount   > 0) archiveLabelParts.push(`${pendingCount} in coda`);
    const archiveLabel    = archiveLabelParts.length ? archiveLabelParts.join(' · ') : 'Nessun video archiviato';
    const archiveBtnLabel = creatorSummaries.length > 0 ? `📂 Archivio (${creatorSummaries.length})` : '📂 Archivio';

    // Avatar
    const avatarHtml = c.avatar
      ? `<img class="creator-avatar-img" src="${escHtml(c.avatar)}" alt="${escHtml(c.channelName)}">`
      : `<div class="creator-avatar">${initial}</div>`;

    // Badge priorità
    const priorityBadge = c.isPriority
      ? `<span class="creator-priority-badge" title="Creator prioritario — i nuovi video vengono estratti subito">⚡</span>`
      : '';

    // Badge nuovi video da accodare
    const newCount = newVideosCounts[c.channelId] || 0;
    const newBadge = newCount > 0
      ? `<span class="creator-new-badge" title="${newCount} nuovi video da accodare">${newCount} nuovi</span>`
      : '';

    // Statistiche canale
    const statParts = [];
    if (stats.hiddenSubs)          statParts.push('👥 iscritti nascosti');
    else if (stats.subscribers > 0) statParts.push(`👥 ${formatNumber(stats.subscribers)} iscritti`);
    if (stats.videoCount > 0)      statParts.push(`🎬 ${formatNumber(stats.videoCount)} video`);
    if (stats.country)             statParts.push(`🌍 ${stats.country}`);
    const statsHtml = statParts.length
      ? `<p class="creator-stats">${statParts.join(' &nbsp;·&nbsp; ')}</p>`
      : `<p class="creator-platform">📺 YouTube</p>`;

    // Storico follow
    const followedAt = c.followedAt || c.addedAt;
    const followDate = followedAt ? new Date(followedAt).toLocaleDateString('it-IT') : null;
    const lastCheck  = c.lastQueueCheck ? new Date(c.lastQueueCheck).toLocaleString('it-IT', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : null;
    const coverageLabel = creatorSummaries.length > 0 && stats.videoCount > 0
      ? ` · ${Math.round((creatorSummaries.length / stats.videoCount) * 100)}% coverage`
      : '';
    const followStatsHtml = followDate
      ? `<p class="creator-follow-stats">📅 Seguito dal ${followDate}${coverageLabel}${lastCheck ? ` · Check: ${lastCheck}` : ''}</p>`
      : '';

    // Badge topic alert
    const topicsHtml = c.topics?.length
      ? `<p class="creator-topics-preview">🔔 ${c.topics.slice(0,4).map(t =>
          `<span class="topic-tag">${escHtml(t)}</span>`).join('')}${c.topics.length > 4 ? `<span class="topic-more">+${c.topics.length - 4}</span>` : ''}</p>`
      : '';

    const alertBtnLabel  = c.topics?.length ? `🔔 Alert (${c.topics.length})` : '🔕 Alert';
    const queueBtnLabel  = newCount > 0 ? `📥 Accoda (${newCount})` : '📥 Accoda';
    const priorityBtnCls = c.isPriority ? ' btn-priority-active' : '';
    const autoQueueCls   = c.autoQueueEnabled === false ? ' queue-disabled' : '';
    const typeLabels = formatMassQueueTypeLabels(massQueueProfile?.counts);
    const durationLabels = formatMassQueueDurationLabels(massQueueProfile?.durationCounts);
    const massSummaryHtml = massQueueProfile
      ? `<div class="mass-queue-summary">
          <span class="mass-queue-kpi">📺 ${massQueueProfile.totalVideos || 0} video scansionati</span>
          <span class="mass-queue-kpi">🗂️ ${typeLabels.join(' · ')}</span>
          <span class="mass-queue-kpi">⏱️ ${durationLabels.join(' · ')}</span>
        </div>`
      : '<p class="mass-queue-hint">📺 Mass Queue disponibile dopo analisi canale via YouTube Data API.</p>';
    const selectedTypes = Array.isArray(c.queueContentTypes) && c.queueContentTypes.length
      ? c.queueContentTypes
      : ['video', 'short', 'live'];
    const selectedBuckets = Array.isArray(c.queueDurationBuckets) && c.queueDurationBuckets.length
      ? c.queueDurationBuckets
      : ['flash', 'quick', 'standard', 'deep', 'marathon'];

    return `
      <div class="creator-card${autoQueueCls}" id="creator-card-${c.channelId}">
        <div class="creator-avatar-wrap">
          ${avatarHtml}
          ${priorityBadge}
        </div>
        <div class="creator-info">
          <div class="creator-name-row">
            <p class="creator-name">${escHtml(c.channelName)}</p>
            ${newBadge}
          </div>
          ${statsHtml}
          ${followStatsHtml}
          <p class="creator-archive-summary">${archiveLabel}</p>
          ${massSummaryHtml}
          ${topicsHtml}
          <div class="creator-actions">
            <a href="${escHtml(c.channelUrl)}" target="_blank" class="btn btn-ghost btn-sm">🔗 Canale</a>
            <button class="btn btn-ghost btn-sm"
              data-action="toggle-archive"
              data-channel-id="${c.channelId}"
              data-channel-name="${escHtml(c.channelName)}">${archiveBtnLabel}</button>
            <button class="btn btn-ghost btn-sm${newCount > 0 ? ' btn-queue-has-new' : ''}"
              data-action="check-and-queue"
              data-channel-id="${c.channelId}">${queueBtnLabel}</button>
            <button class="btn btn-ghost btn-sm${c.topics?.length ? ' btn-alert-active' : ''}"
              data-action="toggle-topics"
              data-channel-id="${c.channelId}">${alertBtnLabel}</button>
            <button class="btn btn-ghost btn-sm${priorityBtnCls}"
              data-action="toggle-priority"
              data-channel-id="${c.channelId}"
              title="${c.isPriority ? 'Prioritario: estrae subito — clicca per disattivare' : 'Rendi prioritario: estrae subito i nuovi video'}">⚡</button>
            <button class="btn btn-ghost btn-sm"
              data-action="toggle-queue-settings"
              data-channel-id="${c.channelId}"
              title="Impostazioni auto-queue">⚙️ Queue</button>
            <button class="btn btn-ghost btn-sm"
              data-action="toggle-mass-queue"
              data-channel-id="${c.channelId}"
              title="Scansione canale completa e accodamento massivo">📺 Mass Queue</button>
            <button class="btn btn-ghost btn-sm"
              data-action="refresh-stats"
              data-channel-id="${c.channelId}">🔄</button>
            <button class="btn btn-danger btn-sm"
              data-action="remove-creator"
              data-channel-id="${c.channelId}">🗑️</button>
          </div>
        </div>
      </div>

      <!-- Pannello impostazioni queue -->
      <div class="queue-settings-panel hidden" id="queue-panel-${c.channelId}">
        <div class="topics-panel-inner">
          <p class="topics-panel-title">⚙️ Impostazioni Auto-Queue — ${escHtml(c.channelName)}</p>
          <div class="queue-settings-grid">
            <label class="toggle-wrap queue-toggle">
              <input type="checkbox" id="queue-enabled-${c.channelId}" ${c.autoQueueEnabled !== false ? 'checked' : ''}
                data-action="queue-toggle-enabled" data-channel-id="${c.channelId}">
              <span class="toggle-label">Auto-queue attivo per questo creator</span>
            </label>
            <div class="queue-setting-row">
              <label class="label" style="font-size:12px">Parole chiave titolo (separare con virgola)</label>
              <input type="text" class="text-input" id="queue-kw-${c.channelId}"
                placeholder="es: tutorial, python, AI — vuoto = tutti i video"
                value="${escHtml((c.queueKeywords || []).join(', '))}">
              <p style="font-size:11px;color:var(--text3);margin-top:4px">Se vuoto, accoda tutti i nuovi video. Altrimenti solo quelli con queste parole nel titolo.</p>
            </div>
          </div>
          <div class="topics-panel-actions">
            <button class="btn btn-primary btn-sm" data-action="save-queue-settings" data-channel-id="${c.channelId}">💾 Salva</button>
            <button class="btn btn-ghost btn-sm" data-action="catchup-queue" data-channel-id="${c.channelId}" data-channel-name="${escHtml(c.channelName)}">📼 Catch-up video passati</button>
          </div>
          <p class="topics-panel-feedback hidden" id="queue-feedback-${c.channelId}"></p>
        </div>
      </div>

      <div class="mass-queue-panel hidden" id="mass-queue-panel-${c.channelId}">
        <div class="topics-panel-inner">
          <p class="topics-panel-title">📺 Channel Mass Queue — ${escHtml(c.channelName)}</p>
          <p class="topics-panel-desc">
            Analizza l'upload history del canale via YouTube Data API, classifica video, Shorts e live per bucket durata, poi accoda in massa solo ciò che ti interessa.
          </p>
          <div class="mass-queue-profile">
            <div class="mass-queue-meta">
              <span><strong>Ultima analisi:</strong> ${massQueueProfile?.analyzedAt ? new Date(massQueueProfile.analyzedAt).toLocaleString('it-IT') : 'mai'}</span>
              <span><strong>Video scansionati:</strong> ${massQueueProfile?.totalVideos || 0}</span>
            </div>
            <div class="mass-queue-chips">${renderMassQueueCountChips(massQueueProfile?.counts, massQueueProfile?.durationCounts)}</div>
          </div>
          <div class="mass-queue-filter-grid">
            <div class="mass-queue-filter-group">
              <label class="label mass-queue-label">Tipi contenuto</label>
              <div class="mass-queue-checkboxes">
                ${renderMassQueueCheckboxes(c.channelId, 'type', [
                  ['video', '▶ Video'],
                  ['short', '⚡ Shorts'],
                  ['live', '🔴 Live'],
                ], selectedTypes)}
              </div>
            </div>
            <div class="mass-queue-filter-group">
              <label class="label mass-queue-label">Bucket durata</label>
              <div class="mass-queue-checkboxes">
                ${renderMassQueueCheckboxes(c.channelId, 'bucket', [
                  ['flash', '⚡ Flash <3m'],
                  ['quick', '🔵 Quick 3-10m'],
                  ['standard', '🟢 Standard 10-30m'],
                  ['deep', '🟡 Deep 30-59m'],
                  ['marathon', '🔴 60m+'],
                ], selectedBuckets)}
              </div>
            </div>
            <label class="toggle-wrap queue-toggle">
              <input type="checkbox" id="mass-include-history-${c.channelId}" ${c.includeBeforeFollowedAt ? 'checked' : ''}>
              <span class="toggle-label">Includi backlog precedente al follow</span>
            </label>
            <div class="queue-setting-row">
              <label class="label mass-queue-label" for="mass-limit-${c.channelId}">Limite massimo da accodare</label>
              <input type="number" min="1" max="500" class="text-input mass-limit-input" id="mass-limit-${c.channelId}" value="${Number(c.massQueueLimit || 100)}">
              <p style="font-size:11px;color:var(--text3);margin-top:4px">Il filtro viene riusato anche dal check automatico dei nuovi video.</p>
            </div>
          </div>
          <div class="topics-panel-actions">
            <button class="btn btn-ghost btn-sm" data-action="save-mass-queue" data-channel-id="${c.channelId}">💾 Salva filtri</button>
            <button class="btn btn-ghost btn-sm" data-action="analyze-mass-queue" data-channel-id="${c.channelId}">🧠 Analizza canale</button>
            <button class="btn btn-primary btn-sm" data-action="queue-mass-channel" data-channel-id="${c.channelId}">📥 Accoda selezione</button>
          </div>
          <p class="topics-panel-feedback hidden" id="mass-queue-feedback-${c.channelId}"></p>
        </div>
      </div>

      <!-- Pannello alert topic -->
      <div class="topics-panel hidden" id="topics-panel-${c.channelId}">
        <div class="topics-panel-inner">
          <p class="topics-panel-title">🔔 Alert argomenti — ${escHtml(c.channelName)}</p>
          <p class="topics-panel-desc">Ricevi una notifica quando un nuovo video di questo creator tratta uno degli argomenti che ti interessano.</p>
          <input type="text" class="text-input topics-input"
            id="topics-input-${c.channelId}"
            placeholder="es: intelligenza artificiale, python, automazione, chatgpt"
            value="${escHtml((c.topics || []).join(', '))}">
          <div class="topics-panel-actions">
            <button class="btn btn-primary btn-sm" data-action="save-topics" data-channel-id="${c.channelId}">💾 Salva</button>
            <button class="btn btn-ghost btn-sm" data-action="check-topics-now" data-channel-id="${c.channelId}">🔍 Controlla ora</button>
            <button class="btn btn-danger btn-sm" data-action="clear-topics" data-channel-id="${c.channelId}">🗑 Rimuovi alert</button>
          </div>
          <p class="topics-panel-feedback hidden" id="topics-feedback-${c.channelId}"></p>
        </div>
      </div>
      <div class="creator-archive-panel hidden" id="archive-panel-${c.channelId}"></div>
    `;
  }).join('');
}

// Espande/chiude il pannello archivio inline di un creator
function toggleCreatorArchive(channelId, channelName, btn) {
  const panel = document.getElementById(`archive-panel-${channelId}`);
  if (!panel) return;
  const isOpen = !panel.classList.contains('hidden');
  if (isOpen) {
    panel.classList.add('hidden');
    btn.classList.remove('active');
    return;
  }
  btn.classList.add('active');
  panel.classList.remove('hidden');
  renderCreatorArchivePanel(panel, channelId, channelName);
}

async function doRefreshStats(channelId, btn) {
  const origText = btn.textContent;
  btn.textContent = '⏳';
  btn.disabled = true;
  try {
    await bg('REFRESH_CREATOR_STATS', { channelId });
    await loadCreators();
  } finally {
    btn.textContent = origText;
    btn.disabled = false;
  }
}

// ── Percorsi di Studio (Learning Paths) ──────────────────────────────────────
async function generateLearningPathUI() {
  const goalInput = $('path-goal-input');
  const btn = $('btn-generate-path');
  const loading = $('path-loading');
  const results = $('path-results');
  
  if (!goalInput.value.trim()) return;
  
  btn.disabled = true;
  loading.classList.remove('hidden');
  results.innerHTML = '';
  
  try {
    const response = await bg('GENERATE_LEARNING_PATH', { goal: goalInput.value.trim() });
    
    if (!response.success) {
      throw new Error(response.error || 'Errore durante la generazione');
    }
    
    const path = response.path || [];
    
    if (path.length === 0) {
      results.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🤷</div>
          <p class="empty-title">Nessun percorso trovato</p>
          <p class="empty-sub">Non ci sono video nel tuo archivio o in coda adatti a questo obiettivo.</p>
        </div>
      `;
      return;
    }
    
    // Mostra il percorso
    path.forEach((lesson, index) => {
      const card = document.createElement('div');
      card.className = 'video-card archive-item';
      card.innerHTML = `
        <div class="video-info" style="width: 100%;">
          <div class="video-title" style="font-size: 1.1em;">
            <span style="color: var(--primary); font-weight: bold; margin-right: 8px;">Lezione ${index + 1}:</span>
            ${escHtml(lesson.title)}
          </div>
          <div class="video-channel" style="margin-top: 8px; color: var(--text-2);">
            <em>"${escHtml(lesson.reason)}"</em>
          </div>
          <div class="video-channel" style="margin-top: 4px;">
            ID Video: ${escHtml(lesson.videoId)}
          </div>
        </div>
      `;
      results.appendChild(card);
    });
    
  } catch (err) {
    results.innerHTML = `
      <div class="empty-state" style="border-color: var(--error);">
        <p style="color: var(--error);">Errore: ${escHtml(err.message)}</p>
      </div>
    `;
  } finally {
    btn.disabled = false;
    loading.classList.add('hidden');
  }
}

async function refreshAllCreators() {
  const btn = $('btn-refresh-all-creators');
  const fb  = $('creators-actions-feedback');
  btn.disabled = true;
  btn.textContent = '⏳ Aggiornamento...';
  fb.textContent = '';

  try {
    // Verifica che la YouTube API key sia configurata
    const { settings } = await bg('GET_SETTINGS');
    if (!settings.youtubeApiKey) {
      fb.textContent = '⚠️ Configura prima la YouTube API key nelle Impostazioni.';
      return;
    }

    // Prima deduplica
    await bg('DEDUPLICATE_CREATORS');
    // Rileggi la lista aggiornata dopo la dedup
    const { creators: freshCreators } = await bg('GET_CREATORS');
    const list = freshCreators || allCreators;
    let done = 0;

    for (const c of list) {
      _avatarRefreshAttempted.delete(c.channelId); // forza nuovo tentativo
      Progress.show('🔄 Aggiornamento creator…', done, list.length, `${c.channelName}`);
      await bg('REFRESH_CREATOR_STATS', { channelId: c.channelId }).catch(() => {});
      done++;
    }
    Progress.show('✅ Creator aggiornati!', done, list.length, '');
    await loadCreators();
    setTimeout(() => { Progress.hide(); fb.textContent = ''; }, 2000);
  } catch (e) {
    fb.textContent = `❌ ${e.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 Aggiorna tutti';
  }
}

async function deduplicateCreators() {
  const btn = $('btn-dedup-creators');
  const fb  = $('creators-actions-feedback');
  btn.disabled = true;
  btn.textContent = '⏳ Analisi...';

  try {
    const { removed } = await bg('DEDUPLICATE_CREATORS');
    if (removed === 0) {
      fb.textContent = '✅ Nessun duplicato trovato.';
    } else {
      fb.textContent = `✅ Rimossi ${removed} creator duplicati.`;
    }
    await loadCreators();
    setTimeout(() => { fb.textContent = ''; }, 4000);
  } catch (e) {
    fb.textContent = `❌ ${e.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = '🧹 Rimuovi duplicati';
  }
}

// ── Topic Alert functions ─────────────────────────────────────────────────────

function toggleTopicsPanel(channelId, btn) {
  const panel = document.getElementById(`topics-panel-${channelId}`);
  if (!panel) return;
  const isOpen = !panel.classList.contains('hidden');
  if (isOpen) {
    panel.classList.add('hidden');
    btn.classList.remove('active');
  } else {
    panel.classList.remove('hidden');
    btn.classList.add('active');
    // Focus sull'input
    setTimeout(() => document.getElementById(`topics-input-${channelId}`)?.focus(), 50);
  }
}

async function saveCreatorTopics(channelId, btn) {
  const input = document.getElementById(`topics-input-${channelId}`);
  const fb    = document.getElementById(`topics-feedback-${channelId}`);
  if (!input) return;

  const topics = input.value
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(Boolean);

  const origText = btn?.textContent;
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }

  try {
    await bg('UPDATE_CREATOR_TOPICS', { channelId, topics });
    // Aggiorna la card senza rifare tutto il DOM
    const creator = allCreators.find(c => c.channelId === channelId);
    if (creator) creator.topics = topics;

    // Aggiorna il badge sul pulsante Alert nella card
    const alertBtn = document.querySelector(
      `#creator-card-${channelId} [data-action="toggle-topics"]`
    );
    if (alertBtn) {
      alertBtn.textContent = topics.length ? `🔔 Alert (${topics.length})` : '🔕 Alert';
      alertBtn.classList.toggle('btn-alert-active', topics.length > 0);
    }

    // Aggiorna la preview dei topic nella card
    const previewEl = document.querySelector(`#creator-card-${channelId} .creator-topics-preview`);
    if (topics.length) {
      const html = `🔔 ${topics.slice(0,4).map(t => `<span class="topic-tag">${escHtml(t)}</span>`).join('')}${topics.length > 4 ? `<span class="topic-more">+${topics.length - 4}</span>` : ''}`;
      if (previewEl) { previewEl.innerHTML = html; }
      else {
        const archiveSummary = document.querySelector(`#creator-card-${channelId} .creator-archive-summary`);
        if (archiveSummary) {
          const p = document.createElement('p');
          p.className = 'creator-topics-preview';
          p.innerHTML = html;
          archiveSummary.after(p);
        }
      }
    } else {
      previewEl?.remove();
    }

    showTopicsFeedback(channelId, topics.length
      ? `✅ Alert salvati per ${topics.length} argomenti`
      : '✅ Alert rimossi');
  } catch (e) {
    showTopicsFeedback(channelId, `❌ ${e.message}`, true);
  } finally {
    if (btn) { btn.textContent = origText; btn.disabled = false; }
  }
}

async function checkTopicsNow(channelId, btn) {
  const origText = btn?.textContent;
  if (btn) { btn.textContent = '⏳ Controllo…'; btn.disabled = true; }
  try {
    const { checked, notified } = await bg('CHECK_TOPIC_ALERTS', { channelId });
    const msg = notified > 0
      ? `🔔 ${notified} nuovo/i video rilevanti trovati! Controlla le notifiche.`
      : checked > 0
        ? `✅ ${checked} video analizzati, nessun match con i tuoi topic.`
        : '✅ Nessun nuovo video da controllare.';
    showTopicsFeedback(channelId, msg);
  } catch (e) {
    showTopicsFeedback(channelId, `❌ ${e.message}`, true);
  } finally {
    if (btn) { btn.textContent = origText; btn.disabled = false; }
  }
}

async function clearCreatorTopics(channelId, btn) {
  if (!confirm('Rimuovere tutti gli alert per questo creator?')) return;
  const origText = btn?.textContent;
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  try {
    await bg('UPDATE_CREATOR_TOPICS', { channelId, topics: [] });
    const creator = allCreators.find(c => c.channelId === channelId);
    if (creator) creator.topics = [];

    // Svuota input
    const input = document.getElementById(`topics-input-${channelId}`);
    if (input) input.value = '';

    // Aggiorna badge
    const alertBtn = document.querySelector(`#creator-card-${channelId} [data-action="toggle-topics"]`);
    if (alertBtn) { alertBtn.textContent = '🔕 Alert'; alertBtn.classList.remove('btn-alert-active'); }

    // Rimuovi preview
    document.querySelector(`#creator-card-${channelId} .creator-topics-preview`)?.remove();

    showTopicsFeedback(channelId, '✅ Alert rimossi');
  } catch (e) {
    showTopicsFeedback(channelId, `❌ ${e.message}`, true);
  } finally {
    if (btn) { btn.textContent = origText; btn.disabled = false; }
  }
}

function showTopicsFeedback(channelId, message, isError = false) {
  const fb = document.getElementById(`topics-feedback-${channelId}`);
  if (!fb) return;
  fb.textContent = message;
  fb.className = `topics-panel-feedback${isError ? ' error' : ''}`;
  fb.classList.remove('hidden');
  setTimeout(() => fb.classList.add('hidden'), 4000);
}

function renderCreatorArchivePanel(panel, channelId, channelName) {
  const videos    = allSummaries.filter(s => s.channelId === channelId || s.channelName === channelName);
  const pending   = videos.filter(s => s.status === 'pending');
  const extracted = videos.filter(s => s.status !== 'pending');

  if (videos.length === 0) {
    panel.innerHTML = `
      <div class="creator-archive-empty">
        <span>📄</span>
        <p>Nessun video archiviato per questo creator.</p>
        <p>Apri un video di <strong>${escHtml(channelName)}</strong> su YouTube e usa il popup per generare il primo riepilogo.</p>
      </div>`;
    return;
  }

  panel.innerHTML = `
    <div class="creator-archive-header">
      <span class="creator-archive-title">📂 Archivio — ${escHtml(channelName)}</span>
      <div class="creator-archive-meta">
        ${extracted.length > 0 ? `<span class="badge-extracted">✅ ${extracted.length} estratti</span>` : ''}
        ${pending.length   > 0 ? `<span class="badge-pending">🕐 ${pending.length} da estrarre</span>` : ''}
        ${pending.length   > 0 ? `<button class="btn btn-primary btn-sm"
          data-action="extract-all-creator" data-channel-id="${channelId}">
          ✨ Estrai tutti (${pending.length})</button>` : ''}
      </div>
    </div>
    <div class="creator-archive-list">
      ${videos.map(s => renderCreatorArchiveItem(s, channelId, channelName)).join('')}
    </div>
  `;
}

function renderCreatorArchiveItem(s, channelId, channelName) {
  const date = s.createdAt
    ? new Date(s.createdAt).toLocaleDateString('it-IT', { day:'2-digit', month:'short', year:'numeric' })
    : '';
  const tags      = (s.tags || []).slice(0, 3).map(t => `<span class="tag">#${escHtml(t)}</span>`).join('');
  const isPending = s.status === 'pending';
  const cid       = channelId   || s.channelId   || '';
  const cname     = channelName || s.channelName || '';

  return `
    <div class="creator-archive-item${isPending ? ' pending' : ''}"
         data-id="${s.id}" ${isPending ? '' : 'data-open-modal'}>
      <img class="archive-thumb" src="${s.thumbnail || ''}" alt="" loading="lazy">
      <div class="archive-info">
        <p class="archive-title">${escHtml(s.title)}</p>
        <div class="archive-tags">${tags}</div>
        <p class="archive-date">${isPending ? '🕐 In coda' : '✅ Estratto'} · ${date}</p>
      </div>
      <div class="archive-actions">
        <a href="${s.url}" target="_blank" class="btn btn-ghost btn-sm" title="Guarda su YouTube">▶</a>
        ${isPending
          ? `<button class="btn btn-primary btn-sm"
               data-action="extract" data-id="${s.id}" title="Estrai MD">✨</button>`
          : `<button class="btn btn-ghost btn-sm"
               data-action="open-file" data-id="${s.id}" title="Apri file MD">📂</button>`
        }
        <button class="btn btn-danger btn-sm"
          data-action="delete-creator-item"
          data-id="${s.id}"
          data-channel-id="${cid}"
          data-channel-name="${escHtml(cname)}"
          title="Elimina">🗑️</button>
      </div>
    </div>
  `;
}

// Elimina da archivio globale
async function deleteSummaryItem(id) {
  if (!confirm('Eliminare questo riepilogo?')) return;
  await bg('DELETE_SUMMARY', { id });
  await loadSummaries();
}

// Elimina e aggiorna anche il pannello per-creator
async function deleteSummaryAndRefresh(id, channelId, channelName) {
  if (!confirm('Eliminare questo riepilogo?')) return;
  await bg('DELETE_SUMMARY', { id });
  await loadSummaries();
  const panel = document.getElementById(`archive-panel-${channelId}`);
  if (panel && !panel.classList.contains('hidden')) {
    renderCreatorArchivePanel(panel, channelId, channelName);
  }
}

async function removeCreator(channelId) {
  if (!confirm('Rimuovere questo creator dalla lista?')) return;
  await bg('REMOVE_CREATOR', { channelId });
  await loadCreators();
}

// Aggiorna tutti i pannelli per-creator aperti (dopo estrazione)
function renderCreatorsArchives() {
  document.querySelectorAll('.creator-archive-panel:not(.hidden)').forEach(panel => {
    const channelId   = panel.id.replace('archive-panel-', '');
    const creator     = allCreators.find(c => c.channelId === channelId);
    if (creator) renderCreatorArchivePanel(panel, channelId, creator.channelName);
  });
}

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000)    return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

async function addCreator() {
  const input = $('creator-url-input');
  const url = input.value.trim();
  if (!url) return;

  const btn = $('btn-add-creator');
  btn.disabled = true;
  btn.textContent = 'Aggiunto...';

  const fb = $('add-creator-feedback');
  fb.className = 'feedback-msg';

  try {
    const result = await bg('ADD_CREATOR', { url });
    if (result.success) {
      fb.textContent = `✅ "${result.channelName}" aggiunto con successo!`;
      fb.classList.add('success');
      input.value = '';
      await loadCreators();
      await loadFeed(true);
    } else if (result.reason === 'already_exists') {
      fb.textContent = 'ℹ️ Questo creator è già nella tua lista.';
      fb.classList.add('error');
    } else {
      fb.textContent = `❌ ${result.error || 'Errore durante l\'aggiunta.'}`;
      fb.classList.add('error');
    }
  } catch (e) {
    fb.textContent = `❌ ${e.message}`;
    fb.classList.add('error');
  }

  fb.classList.remove('hidden');
  setTimeout(() => fb.classList.add('hidden'), 4000);
  btn.disabled = false;
  btn.textContent = 'Aggiungi';
}

// ── Archive ───────────────────────────────────────────────────────────────────

async function loadSummaries() {
  const { summaries } = await bg('GET_SUMMARIES');
  allSummaries = summaries || [];
  mapRendered = false; // forza re-render mappa se summaries aggiornati

  const pending   = allSummaries.filter(s => s.status === 'pending').length;
  const screened  = allSummaries.filter(s => s.status === 'screened').length;
  const extracted = allSummaries.filter(s => s.status !== 'pending' && s.status !== 'screened').length;
  $('nav-archive-count').textContent = allSummaries.filter(s => s.status !== 'screened').length;
  const pendingBadge = $('nav-pending-count');
  if (pendingBadge) { pendingBadge.textContent = pending; pendingBadge.classList.toggle('hidden', pending === 0); }
  
  const screeningBadge = $('nav-screening-badge');
  if (screeningBadge) { screeningBadge.textContent = screened; screeningBadge.classList.toggle('hidden', screened === 0); }

  // Aggiorna contatore note per chat
  const extractedCount = allSummaries.filter(s => s.status === 'extracted' && s.markdown).length;
  const chatCount = $('nav-chat-count');
  if (chatCount) { chatCount.textContent = extractedCount || ''; chatCount.title = `${extractedCount} note nell'archivio`; }
  updateChatNoteCount(extractedCount);

  renderArchive(allSummaries.filter(s => s.status !== 'screened'));
  renderScreening(allSummaries.filter(s => s.status === 'screened'));

  // Popola filtro canale
  const channels = [...new Set(allSummaries.map(s => s.channelName).filter(Boolean))];
  $('archive-filter-channel').innerHTML =
    '<option value="">Tutti i canali</option>' +
    channels.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');

  // Popola filtro stato
  const statusSel = $('archive-filter-status');
  if (statusSel) statusSel.value = statusSel.value || '';
  updateWorkspaceInsights();
}

function renderArchive(summaries, highlightQuery = '') {
  const list = $('archive-list');

  if (summaries.length === 0) {
    $('archive-empty').classList.remove('hidden');
    list.innerHTML = '';
    renderBulkBar(0, null);
    return;
  }
  $('archive-empty').classList.add('hidden');

  // Barra azioni bulk
  const pendingCount = summaries.filter(s => s.status === 'pending').length;
  renderBulkBar(pendingCount, null);

  list.innerHTML = summaries.map(s => {
    const date = s.createdAt
      ? new Date(s.createdAt).toLocaleDateString('it-IT', { day:'2-digit', month:'short', year:'numeric' })
      : '';
    const tags = (s.tags || []).slice(0, 4).map(t => `<span class="tag">#${escHtml(t)}</span>`).join('');

    // Snippet full-text
    let snippet = '';
    if (highlightQuery && s.markdown) {
      const idx = s.markdown.toLowerCase().indexOf(highlightQuery.toLowerCase());
      if (idx !== -1) {
        const start = Math.max(0, idx - 60);
        const raw   = escHtml(s.markdown.slice(start, idx + 120).replace(/[#*`\n]/g, ' '));
        const hl    = raw.replace(new RegExp(escHtml(highlightQuery).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<mark>${m}</mark>`);
        snippet = `<p class="archive-snippet">…${hl}…</p>`;
      }
    }

    // Path archivio
    const pathLabel = s.savedFilename
      ? `<span class="archive-path" title="${escHtml(s.savedFilename)}">📁 ${escHtml(s.savedFilename.split('/').slice(1, 3).join('/'))}…</span>`
      : '';

    const isPending = s.status === 'pending';
    const learningModeLabel = ({
      verbatim: 'Integrale',
      study: 'Studio',
      summary: 'Sintesi',
    })[s.learningMode] || 'Studio';
    const outputFormat = (s.outputFormat || 'mdx').toUpperCase();
    const qualityLabel = ({
      high: 'Transcript alta',
      medium: 'Transcript media',
      low: 'Transcript bassa',
      missing: 'Transcript assente',
    })[s.transcriptQuality] || null;
    return `
      <div class="archive-item${isPending ? ' pending' : ''}"
           data-id="${s.id}" ${isPending ? '' : 'data-open-modal'}>
        <img class="archive-thumb" src="${s.thumbnail || ''}" alt="" loading="lazy">
        <div class="archive-info">
          <p class="archive-title">${escHtml(s.title)}</p>
          <p class="archive-channel">${s.platform === 'instagram' ? '📸' : s.platform === 'web' ? '🌐' : '📺'} ${escHtml(s.channelName)}${s.publishDate ? ' · ' + s.publishDate.slice(0,10) : ''}${s.platform === 'web' ? '<span class="platform-badge web">Articolo</span>' : s.platform === 'instagram' ? `<span class="platform-badge instagram">${s.igType === 'reel' ? 'Reel' : s.igType === 'profile' ? 'Profilo' : 'Post'}</span>` : ''}</p>
          <div class="archive-meta-row">
            <span class="meta-pill ${isPending ? 'pending' : 'extracted'}">${isPending ? 'Pending' : 'Estratto'}</span>
            <span class="meta-pill">${outputFormat}</span>
            <span class="meta-pill">${learningModeLabel}</span>
            ${qualityLabel ? `<span class="meta-pill">${qualityLabel}</span>` : ''}
          </div>
          <div class="archive-tags">${tags}</div>
          ${snippet}
          ${pathLabel}
          <p class="archive-date">Salvato il ${date}${s.viewCount ? ' · 👁 ' + formatNumber(s.viewCount) : ''}</p>
        </div>
        <div class="archive-actions">
          <a href="${s.url}" target="_blank" class="btn btn-ghost btn-sm" title="Guarda su YouTube">▶</a>
          ${isPending
            ? `<button class="btn btn-primary btn-sm" data-action="extract"   data-id="${s.id}" title="Estrai MD">✨ Estrai</button>`
            : `<button class="btn btn-ghost btn-sm"   data-action="open-file" data-id="${s.id}" title="Apri MD">📂 MD</button>`
          }
          <button class="btn btn-danger btn-sm" data-action="delete" data-id="${s.id}" title="Elimina">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

// Barra azioni bulk — usa addEventListener, no onclick inline
function renderBulkBar(pendingCount, channelId) {
  const bar = $('archive-bulk-bar');
  if (!bar) return;
  if (pendingCount === 0) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  bar.innerHTML = `
    <span class="bulk-info">🕐 <strong>${pendingCount}</strong> video da estrarre</span>
    <button class="btn btn-primary btn-sm bulk-extract-btn" id="btn-bulk-extract-global">
      ✨ Estrai tutti (${pendingCount})
    </button>
  `;
  const btn = bar.querySelector('#btn-bulk-extract-global');
  if (btn) btn.addEventListener('click', () => extractAllPending(channelId, btn));
}

function filterArchive() {
  const query   = $('archive-search').value;
  const channel = $('archive-filter-channel').value;
  const status  = $('archive-filter-status')?.value || '';
  const filtered = allSummaries.filter(s =>
    matchesSearch(s, query) &&
    (!channel || s.channelName === channel) &&
    (!status || (status === 'pending' ? s.status === 'pending' : s.status !== 'pending'))
  );
  renderArchive(filtered, query);
  updateWorkspaceInsights(filtered);
}

function updateWorkspaceInsights(filteredArchive = null) {
  const pending = allSummaries.filter(s => s.status === 'pending').length;
  const extracted = allSummaries.filter(s => s.status !== 'pending').length;
  const summarizedIds = new Set(allSummaries.map(s => s.videoId).filter(Boolean));
  const newFeedVideos = allFeed.filter(v => !summarizedIds.has(v.videoId)).length;

  if ($('feed-kpi-creators')) $('feed-kpi-creators').textContent = allCreators.length;
  if ($('feed-kpi-new')) $('feed-kpi-new').textContent = newFeedVideos;
  if ($('feed-kpi-pending')) $('feed-kpi-pending').textContent = pending;

  const archiveSet = filteredArchive || allSummaries;
  if ($('archive-kpi-total')) $('archive-kpi-total').textContent = archiveSet.length;
  if ($('archive-kpi-extracted')) $('archive-kpi-extracted').textContent = extracted;
  if ($('archive-kpi-pending')) $('archive-kpi-pending').textContent = pending;
}

// ── Markdown renderer — full HTML rendering con copy button per codice ────────

/**
 * Converte il markdown grezzo in HTML renderizzato:
 *  - Intestazioni h1–h4, grassetto, corsivo, liste, blockquote, tabelle
 *  - Blocchi codice con syntax highlight del linguaggio + pulsante Copia
 *  - Codice inline con backtick
 *  - Timestamp [mm:ss] → link YouTube cliccabili
 */
function renderMarkdown(md, videoId) {
  if (!md) return '';

  // ── Utility: escape HTML per sicurezza ────────────────────────────────────
  const esc = s => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  function slugifyLabel(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item';
  }

  function splitTableRow(line) {
    return line.split('|').filter((_, idx, arr) => idx > 0 && idx < arr.length - 1).map(cell => cell.trim());
  }

  function parseFlashcards(sectionBody) {
    const lines = String(sectionBody || '').split('\n').map(l => l.trim()).filter(Boolean);
    const tableLines = lines.filter(line => /^\|.+\|$/.test(line) && !/^\|[\s\-:|]+\|$/.test(line));
    if (tableLines.length < 2) return null;
    const rows = tableLines.slice(1).map(splitTableRow).filter(cols => cols.length >= 2);
    if (!rows.length) return null;
    return rows.map((cols, idx) => ({
      id: `fc-${idx + 1}`,
      question: cols[0] || '',
      answer: cols[1] || '',
      difficulty: cols[2] || '',
    }));
  }

  function parseQuiz(sectionBody) {
    const lines = String(sectionBody || '').split('\n');
    const blocks = [];
    let current = null;

    const flush = () => {
      if (!current) return;
      if (current.question && current.options.length) blocks.push(current);
      current = null;
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      const qMatch = line.match(/^\d+\.\s+(.+)/);
      if (qMatch) {
        flush();
        current = { question: qMatch[1].replace(/^\*\*(.+)\*\*$/, '$1'), options: [], answer: '', explanation: '' };
        continue;
      }
      if (!current) continue;

      const optMatch = line.match(/^[-*]?\s*([A-D])[).:\-]\s+(.+)/i);
      if (optMatch) {
        current.options.push({ key: optMatch[1].toUpperCase(), text: optMatch[2] });
        continue;
      }

      const answerMatch = line.match(/^(?:\*\*)?risposta(?:\s+corretta)?(?:\*\*)?\s*[:\-]\s*(.+)$/i);
      if (answerMatch) {
        current.answer = answerMatch[1].replace(/\*\*/g, '').trim();
        continue;
      }

      const explanationMatch = line.match(/^(?:\*\*)?spiegazione(?:\*\*)?\s*[:\-]\s*(.+)$/i);
      if (explanationMatch) {
        current.explanation = explanationMatch[1].replace(/\*\*/g, '').trim();
      }
    }
    flush();
    return blocks.length ? blocks : null;
  }

  function renderFlashcardsHtml(cards) {
    return [
      '<section class="learning-block">',
      '<h2 class="md-h2">Flashcard</h2>',
      '<p class="learning-block-sub">Prova a rispondere mentalmente prima di scoprire la soluzione.</p>',
      '<div class="flashcards-grid">',
      ...cards.map(card => `
        <article class="flashcard-item">
          <div class="flashcard-head">
            <span class="flashcard-badge">Flashcard</span>
            ${card.difficulty ? `<span class="flashcard-difficulty">${inlineFormat(card.difficulty)}</span>` : ''}
          </div>
          <p class="flashcard-question">${inlineFormat(card.question)}</p>
          <button class="btn btn-ghost btn-sm flashcard-toggle" data-action="toggle-flashcard-answer" data-target="${card.id}">👁️ Mostra risposta</button>
          <div class="flashcard-answer hidden" id="${card.id}">
            <p class="flashcard-answer-label">Risposta</p>
            <p class="flashcard-answer-body">${inlineFormat(card.answer)}</p>
          </div>
        </article>
      `),
      '</div>',
      '</section>',
    ].join('');
  }

  function renderQuizHtml(questions) {
    return [
      '<section class="learning-block">',
      '<h2 class="md-h2">Quiz finale</h2>',
      '<p class="learning-block-sub">Seleziona una risposta e usa "Controlla" per verificare senza spoiler immediati.</p>',
      '<div class="quiz-stack">',
      ...questions.map((q, idx) => {
        const answerKey = slugifyLabel((q.answer.match(/[A-D]/i) || [''])[0] || q.answer);
        return `
          <article class="quiz-item" data-answer="${answerKey}">
            <p class="quiz-question">${idx + 1}. ${inlineFormat(q.question)}</p>
            <div class="quiz-options">
              ${q.options.map(opt => `
                <button class="quiz-option" data-action="pick-quiz-option" data-value="${slugifyLabel(opt.key)}">
                  <span class="quiz-option-key">${esc(opt.key)}</span>
                  <span>${inlineFormat(opt.text)}</span>
                </button>
              `).join('')}
            </div>
            <div class="quiz-actions-row">
              <button class="btn btn-primary btn-sm" data-action="check-quiz-answer">✅ Controlla risposta</button>
              <button class="btn btn-ghost btn-sm hidden" data-action="toggle-quiz-solution">👁️ Mostra soluzione</button>
            </div>
            <div class="quiz-feedback hidden">
              <p class="quiz-answer-line" data-answer-text="${esc(q.answer || 'N/D')}"><strong>Risposta corretta:</strong> ${inlineFormat(q.answer || 'N/D')}</p>
              ${q.explanation ? `<p class="quiz-explanation"><strong>Spiegazione:</strong> ${inlineFormat(q.explanation)}</p>` : ''}
            </div>
          </article>
        `;
      }),
      '</div>',
      '</section>',
    ].join('');
  }

  function injectInteractiveSections(markdown) {
    const placeholders = [];
    const save = html => {
      const idx = placeholders.length;
      placeholders.push(html);
      return `\x00LEARN${idx}\x00`;
    };

    const sectionRe = /^##\s+(Flashcard|Quiz finale)\s*$/gmi;
    const matches = [...markdown.matchAll(sectionRe)];
    if (!matches.length) return { markdown, placeholders };

    let out = '';
    let cursor = 0;
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const start = match.index;
      const end = i + 1 < matches.length ? matches[i + 1].index : markdown.length;
      const section = markdown.slice(start, end);
      const title = match[1].toLowerCase();
      const body = section.replace(/^##\s+.+$/m, '').trim();
      let html = '';

      if (title === 'flashcard') {
        const cards = parseFlashcards(body);
        if (cards) html = renderFlashcardsHtml(cards);
      } else if (title === 'quiz finale') {
        const quiz = parseQuiz(body);
        if (quiz) html = renderQuizHtml(quiz);
      }

      out += markdown.slice(cursor, start);
      out += html ? save(html) : section;
      cursor = end;
    }
    out += markdown.slice(cursor);
    return { markdown: out, placeholders };
  }

  // ── Inline formatter ───────────────────────────────────────────────────────
  // Processa il testo inline: code, bold, italic, link, timestamp
  // Ogni elemento viene salvato come placeholder per evitare doppio-escaping
  function inlineFormat(rawText) {
    const saved = [];
    const save = html => { const i = saved.length; saved.push(html); return `\x01${i}\x01`; };

    let t = rawText;

    // 1. Inline code `...`
    t = t.replace(/`([^`]+)`/g, (_, code) => save(`<code class="inline-code">${esc(code)}</code>`));

    // 2. Bold + italic ***text***
    t = t.replace(/\*\*\*(.+?)\*\*\*/g, (_, x) => save(`<strong><em>${esc(x)}</em></strong>`));

    // 3. Bold **text** o __text__
    t = t.replace(/\*\*(.+?)\*\*/g, (_, x) => save(`<strong>${esc(x)}</strong>`));
    t = t.replace(/__(.+?)__/g,     (_, x) => save(`<strong>${esc(x)}</strong>`));

    // 4. Italic *text* (non abbinato a **)
    t = t.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, (_, x) => save(`<em>${esc(x)}</em>`));

    // 5. Link [testo](url)
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
      (_, txt, url) => save(`<a href="${url}" target="_blank" rel="noopener">${esc(txt)}</a>`));

    // 6. Timestamp [mm:ss] o [h:mm:ss] → link YouTube
    if (videoId) {
      t = t.replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g, (_, ts) => {
        const parts = ts.split(':').map(Number);
        const secs  = parts.length === 3
          ? parts[0] * 3600 + parts[1] * 60 + parts[2]
          : parts[0] * 60 + parts[1];
        const url = `https://youtube.com/watch?v=${videoId}&t=${secs}s`;
        return save(`<a href="${url}" target="_blank" class="ts-link" title="▶ Vai a ${ts}">[${ts}]</a>`);
      });
    }

    // 7. Escape il testo rimanente (placeholder \x01N\x01 non contengono & < > ")
    t = esc(t);

    // 8. Ripristina i placeholder
    t = t.replace(/\x01(\d+)\x01/g, (_, i) => saved[+i]);
    return t;
  }

  // ── Fase 1: estrai blocchi codice → placeholder ────────────────────────────
  const codeBlocks = [];
  const interactive = injectInteractiveSections(md);
  let src = interactive.markdown.replace(/```(\w*)\r?\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx      = codeBlocks.length;
    const safeLang = (lang || 'text').toLowerCase();
    const label    = safeLang.toUpperCase();
    // Copia: usa innerText per prendere il testo del <code> già escapato
    const copyJs   = `(function(b){` +
      `var c=b.closest('.code-block-wrap').querySelector('code').innerText;` +
      `navigator.clipboard.writeText(c).then(function(){` +
        `b.textContent='✅ Copiato!';setTimeout(function(){b.textContent='📋 Copia';},1500);` +
      `});` +
    `})(this)`;
    codeBlocks.push(
      `<div class="code-block-wrap">` +
        `<div class="code-block-header">` +
          `<span class="code-lang">${esc(label)}</span>` +
          `<button class="code-copy-btn" onclick="${esc(copyJs)}">📋 Copia</button>` +
        `</div>` +
        `<pre class="code-block"><code>${esc(code.replace(/\n$/, ''))}</code></pre>` +
      `</div>`
    );
    return `\x00CODE${idx}\x00`;
  });

  // ── Fase 2: elabora riga per riga ──────────────────────────────────────────
  const lines  = src.split('\n');
  const out    = [];
  let inUl     = false;
  let inOl     = false;
  let inBq     = false;
  let inTable  = false;
  let tableHdr = false;

  const closeAll = () => {
    if (inUl)    { out.push('</ul>');              inUl    = false; }
    if (inOl)    { out.push('</ol>');              inOl    = false; }
    if (inBq)    { out.push('</blockquote>');      inBq    = false; }
    if (inTable) { out.push('</tbody></table>');   inTable = false; tableHdr = false; }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trim = line.trim();

    // ── Placeholder blocco codice ──────────────────────────────────────────
    if (/^\x00CODE\d+\x00$/.test(trim)) {
      closeAll();
      const idx = +trim.replace(/\x00CODE(\d+)\x00/, '$1');
      out.push(codeBlocks[idx]);
      continue;
    }

    if (/^\x00LEARN\d+\x00$/.test(trim)) {
      closeAll();
      const idx = +trim.replace(/\x00LEARN(\d+)\x00/, '$1');
      out.push(interactive.placeholders[idx]);
      continue;
    }

    // ── Riga orizzontale ---  ***  ___  ─────────────────────────────────────
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trim)) {
      closeAll();
      out.push('<hr class="md-hr">');
      continue;
    }

    // ── Intestazioni # ## ### #### ────────────────────────────────────────
    const hm = trim.match(/^(#{1,4})\s+(.+)/);
    if (hm) {
      closeAll();
      const lv = hm[1].length;
      out.push(`<h${lv} class="md-h${lv}">${inlineFormat(hm[2])}</h${lv}>`);
      continue;
    }

    // ── Blockquote > ──────────────────────────────────────────────────────
    if (/^>\s?/.test(trim)) {
      const content = trim.replace(/^>\s?/, '');
      if (!inBq) {
        if (inUl || inOl) closeAll();
        out.push('<blockquote class="md-quote">');
        inBq = true;
      }
      out.push(`<p class="md-p">${inlineFormat(content)}</p>`);
      continue;
    } else if (inBq) {
      out.push('</blockquote>');
      inBq = false;
    }

    // ── Tabelle | col | col | ─────────────────────────────────────────────
    if (/^\|.+\|$/.test(trim)) {
      // Riga separatore (es. |---|---|)
      if (/^\|[\s\-:|]+\|$/.test(trim)) {
        // Se non abbiamo ancora aperto la tabella, ignora
        continue;
      }
      const cells = trim.split('|').filter((_, j, a) => j > 0 && j < a.length - 1);
      // Controlla se la prossima riga è un separatore → questa è l'intestazione
      const nextTrim = (lines[i + 1] || '').trim();
      if (!inTable && /^\|[\s\-:|]+\|$/.test(nextTrim)) {
        closeAll();
        inTable  = true;
        tableHdr = true;
        out.push('<table class="md-table"><thead><tr>');
        cells.forEach(c => out.push(`<th>${inlineFormat(c.trim())}</th>`));
        out.push('</tr></thead><tbody>');
        i++; // salta la riga separatore
        continue;
      } else if (inTable) {
        out.push('<tr>');
        cells.forEach(c => out.push(`<td>${inlineFormat(c.trim())}</td>`));
        out.push('</tr>');
        continue;
      }
    } else if (inTable) {
      out.push('</tbody></table>');
      inTable = false; tableHdr = false;
    }

    // ── Lista non ordinata - * + ──────────────────────────────────────────
    const ulm = trim.match(/^[-*+]\s+(.+)/);
    if (ulm) {
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (inBq) { out.push('</blockquote>'); inBq = false; }
      if (!inUl) { out.push('<ul class="md-list">'); inUl = true; }
      out.push(`<li class="md-li">${inlineFormat(ulm[1])}</li>`);
      continue;
    }

    // ── Lista ordinata 1. 2. ─────────────────────────────────────────────
    const olm = trim.match(/^\d+\.\s+(.+)/);
    if (olm) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (inBq) { out.push('</blockquote>'); inBq = false; }
      if (!inOl) { out.push('<ol class="md-list">'); inOl = true; }
      out.push(`<li class="md-li">${inlineFormat(olm[1])}</li>`);
      continue;
    }

    // Chiudi liste se la riga non è un elemento lista
    if ((inUl || inOl) && trim !== '') {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (inOl) { out.push('</ol>'); inOl = false; }
    }

    // ── Riga vuota ─────────────────────────────────────────────────────────
    if (trim === '') {
      out.push('');
      continue;
    }

    // ── Paragrafo normale ─────────────────────────────────────────────────
    out.push(`<p class="md-p">${inlineFormat(trim)}</p>`);
  }

  closeAll();

  return `<div class="md-render">${out.join('\n')}</div>`;
}

window.openModal = (summary) => {
  if (!summary) return;
  activeSummary = summary;
  $('modal-title').textContent = summary.title;
  const md = summary.markdown || summary.fullMarkdown || '';
  // Usa innerHTML con markdown reso sicuro — i timestamp diventano link cliccabili
  $('modal-body').innerHTML = renderMarkdown(md, summary.videoId);
  $('preview-modal').classList.remove('hidden');
};

function closeModal() {
  $('preview-modal').classList.add('hidden');
  activeSummary = null;
}

function handleLearningInteractions(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  if (btn.dataset.action === 'toggle-flashcard-answer') {
    const target = document.getElementById(btn.dataset.target);
    if (!target) return;
    const hidden = target.classList.toggle('hidden');
    btn.textContent = hidden ? '👁️ Mostra risposta' : '🙈 Nascondi risposta';
    return;
  }

  if (btn.dataset.action === 'pick-quiz-option') {
    const card = btn.closest('.quiz-item');
    if (!card) return;
    card.querySelectorAll('.quiz-option').forEach(el => el.classList.remove('selected'));
    btn.classList.add('selected');
    card.dataset.selected = btn.dataset.value || '';
    return;
  }

  if (btn.dataset.action === 'check-quiz-answer') {
    const card = btn.closest('.quiz-item');
    if (!card) return;
    const selected = card.dataset.selected || '';
    if (!selected) return;

    const answer = card.dataset.answer || '';
    const correct = selected === answer;
    const feedback = card.querySelector('.quiz-feedback');
    const toggle = card.querySelector('[data-action="toggle-quiz-solution"]');

    card.querySelectorAll('.quiz-option').forEach(el => {
      const value = el.dataset.value || '';
      el.classList.remove('correct', 'wrong');
      if (value === selected) el.classList.add(correct ? 'correct' : 'wrong');
    });

    if (feedback) {
      feedback.classList.remove('hidden');
      feedback.classList.toggle('quiz-feedback-correct', correct);
      feedback.classList.toggle('quiz-feedback-wrong', !correct);
      if (!correct) feedback.classList.add('hidden');
      const line = feedback.querySelector('.quiz-answer-line');
      if (line) {
        line.innerHTML = correct
          ? '<strong>Corretto.</strong> Hai scelto la risposta giusta.'
          : '<strong>Non corretta.</strong> Se vuoi, mostra la soluzione completa.';
      }
    }
    if (toggle) {
      toggle.classList.toggle('hidden', correct);
      toggle.textContent = '👁️ Mostra soluzione';
    }
    return;
  }

  if (btn.dataset.action === 'toggle-quiz-solution') {
    const card = btn.closest('.quiz-item');
    const feedback = card?.querySelector('.quiz-feedback');
    if (!feedback) return;
    const answer = card.dataset.answer || '';
    const line = feedback.querySelector('.quiz-answer-line');
    if (line) {
      line.innerHTML = `<strong>Risposta corretta:</strong> ${escHtml(line.dataset.answerText || 'N/D')}`;
    }
    card.querySelectorAll('.quiz-option').forEach(el => {
      el.classList.toggle('correct', (el.dataset.value || '') === answer);
    });
    const hidden = feedback.classList.toggle('hidden');
    btn.textContent = hidden ? '👁️ Mostra soluzione' : '🙈 Nascondi soluzione';
  }
}

async function copyModalContent() {
  if (!activeSummary) return;
  await navigator.clipboard.writeText(activeSummary.markdown || '');
  $('modal-copy').textContent = '✅ Copiato!';
  setTimeout(() => { $('modal-copy').textContent = '📋 Copia MDX'; }, 1500);
}

async function downloadModalContent() {
  if (!activeSummary) return;
  const blob = new Blob([activeSummary.fullMarkdown || activeSummary.markdown || ''], { type: 'text/markdown' });
  const url  = URL.createObjectURL(blob);
  const filename = `${activeSummary.title?.replace(/[<>:"/\\|?*]/g,'_').slice(0,60) || 'riepilogo'}.mdx`;
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

async function exportActiveSummary(format, btn) {
  if (!activeSummary) return;
  const orig = btn?.textContent || '';
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  try {
    await bg('EXPORT_SUMMARY', { id: activeSummary.id, format });
    if (btn) btn.textContent = '✅';
    setTimeout(() => {
      if (btn) { btn.textContent = orig; btn.disabled = false; }
    }, 1400);
  } catch (error) {
    if (btn) { btn.textContent = '❌'; btn.disabled = false; }
    alert(`Errore export: ${error.message}`);
  }
}

async function deleteActiveSummary() {
  if (!activeSummary) return;
  if (!confirm('Eliminare definitivamente questo riepilogo?')) return;
  await bg('DELETE_SUMMARY', { id: activeSummary.id });
  closeModal();
  await loadSummaries();
}


// Apri file MD in Finder/Explorer (o ri-scarica se downloadId non disponibile)
window.openSummaryFile = async (id, btn) => {
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  try {
    await bg('SHOW_DOWNLOAD', { id });
    if (btn) btn.textContent = '✅';
    setTimeout(() => { if (btn) { btn.textContent = orig; btn.disabled = false; } }, 1500);
  } catch (e) {
    if (btn) { btn.textContent = '❌'; btn.disabled = false; }
    alert(`Errore: ${e.message}`);
  }
};

async function importBatchUrlsFromDashboard() {
  const input = $('batch-import-input');
  const feedback = $('batch-import-feedback');
  const btn = $('btn-batch-import');
  const raw = input?.value?.trim() || '';
  if (!raw) {
    if (feedback) feedback.textContent = 'Incolla almeno un URL.';
    return;
  }

  const orig = btn?.textContent || '';
  if (btn) { btn.textContent = '⏳ Import...'; btn.disabled = true; }
  if (feedback) feedback.textContent = '';
  try {
    const res = await bg('IMPORT_BATCH_URLS', { input: raw });
    if (feedback) {
      feedback.textContent = `✅ ${res.queued} video accodati su ${res.totalResolved} risolti${res.playlistCount ? ` · playlist: ${res.playlistCount}` : ''}${res.skipped?.length ? ` · ignorati: ${res.skipped.length}` : ''}`;
    }
    if (input) input.value = '';
    await loadSummaries();
  } catch (error) {
    if (feedback) feedback.textContent = `❌ ${error.message}`;
  } finally {
    if (btn) { btn.textContent = orig; btn.disabled = false; }
  }
}

// Avvia estrazione MD in background — senza confirm, feedback diretto sul bottone
window.extractPending = async (id, btn) => {
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  try {
    const r = await bg('EXTRACT_PENDING_SUMMARY', { id });
    if (r.success) {
      // Usa la stessa barra di progresso con polling per 1 video
      Progress.pollExtraction([id], () => {
        if (btn) { btn.textContent = orig; btn.disabled = false; }
      });
    }
  } catch (e) {
    Progress.hide();
    if (btn) { btn.textContent = '❌'; btn.disabled = false; }
    setTimeout(() => { if (btn) { btn.textContent = orig; btn.disabled = false; } }, 3000);
  }
};

// Estrai tutti i pending (globale o per canale)
window.extractAllPending = async (channelId, btn) => {
  const subset = channelId
    ? allSummaries.filter(s => s.status === 'pending' && (s.channelId === channelId || s.channelName === channelId))
    : allSummaries.filter(s => s.status === 'pending');
  if (!subset.length) { alert('Nessun video da estrarre.'); return; }

  const orig = btn ? btn.textContent : '';
  if (btn) { btn.textContent = `⏳ In coda…`; btn.disabled = true; }

  try {
    const ids = subset.map(s => s.id);
    await bg('EXTRACT_ALL_PENDING', { ids });
    // Avvia progress bar con polling reale
    Progress.pollExtraction(ids, () => {
      if (btn) { btn.textContent = orig; btn.disabled = false; }
    });
  } catch (e) {
    Progress.hide();
    if (btn) { btn.textContent = orig; btn.disabled = false; }
    alert(`Errore: ${e.message}`);
  }
};

window.allSummaries = allSummaries;

function formatNumber(n) {
  if (!n) return '';
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
  return n.toString();
}

// ── Mappa Connessioni ─────────────────────────────────────────────────────────

/**
 * Costruisce i dati del grafo da summaries + creators.
 * Nodi: tag (blu) + creator (verde). Edges: tag ↔ creator (co-occorrenza).
 */
function buildMapData() {
  const mapped = allSummaries.filter(s => (s.mapTags || s.tags || []).length);
  if (mapped.length < 2) return null;

  const tagCount     = {};   // tag → numero di video
  const tagCreators  = {};   // tag → Set<channelKey>
  const tagVideos    = {};   // tag → [{id, title, channelName}]

  mapped.forEach(s => {
    const ckey = s.channelId || s.channelName || 'unknown';
    const summaryTags = s.mapTags?.length ? s.mapTags : (s.tags || []);
    summaryTags.forEach(tag => {
      tagCount[tag] = (tagCount[tag] || 0) + 1;
      if (!tagCreators[tag]) tagCreators[tag] = new Set();
      tagCreators[tag].add(ckey);
      if (!tagVideos[tag]) tagVideos[tag] = [];
      if (tagVideos[tag].length < 8)
        tagVideos[tag].push({ id: s.id, title: s.title, channelName: s.channelName, status: s.status });
    });
  });

  // Top 45 tag per frequenza
  const topTags = Object.entries(tagCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 45);

  const nodes = [];
  const edges = [];
  const nodeSet = new Set();

  // Nodi tag
  topTags.forEach(([tag, count]) => {
    const id = `tag:${tag}`;
    const r  = Math.min(28, 9 + Math.log(count + 1) * 7);
    nodes.push({ id, type: 'tag', label: tag, count, r, videos: tagVideos[tag] || [] });
    nodeSet.add(id);
  });

  // Nodi creator — solo quelli con almeno un tag rilevante
  const relevantCreatorKeys = new Set();
  topTags.forEach(([tag]) => (tagCreators[tag] || new Set()).forEach(k => relevantCreatorKeys.add(k)));

  allCreators.forEach(c => {
    const ckey = c.channelId || c.channelName;
    if (!relevantCreatorKeys.has(ckey)) return;
    const id = `creator:${ckey}`;
    if (!nodeSet.has(id)) {
      nodes.push({ id, type: 'creator', label: c.channelName, channelKey: ckey, r: 17 });
      nodeSet.add(id);
    }
  });

  // Edges: tag ↔ creator
  topTags.forEach(([tag]) => {
    const tagId = `tag:${tag}`;
    (tagCreators[tag] || new Set()).forEach(ckey => {
      const cid = `creator:${ckey}`;
      if (nodeSet.has(cid)) edges.push({ source: tagId, target: cid });
    });
  });

  return { nodes, edges };
}

/**
 * Simulazione di forze (Euler integration).
 * Repulsione nodo-nodo + spring sugli edge + gravità verso il centro.
 */
function runForceSimulation(nodes, edges, W, H, iterations = 420) {
  // Posizioni iniziali random attorno al centro
  nodes.forEach(n => {
    n.x  = W / 2 + (Math.random() - 0.5) * Math.min(W, H) * 0.6;
    n.y  = H / 2 + (Math.random() - 0.5) * Math.min(W, H) * 0.4;
    n.vx = 0; n.vy = 0;
  });

  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const cx = W / 2, cy = H / 2;

  for (let iter = 0; iter < iterations; iter++) {
    const cool = Math.max(0.01, 1 - iter / iterations);

    // Reset forze
    nodes.forEach(n => { n.fx = 0; n.fy = 0; });

    // Repulsione nodo-nodo (O(n²) — OK per < 80 nodi)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist2 = dx * dx + dy * dy + 0.01;
        const dist  = Math.sqrt(dist2);
        const rep   = (1100 + (a.r + b.r) * 22) / dist2;
        const fx = (dx / dist) * rep, fy = (dy / dist) * rep;
        a.fx -= fx; a.fy -= fy;
        b.fx += fx; b.fy += fy;
      }
    }

    // Spring sugli edge (attrazione verso distanza ideale)
    edges.forEach(e => {
      const a = nodeMap.get(e.source), b = nodeMap.get(e.target);
      if (!a || !b) return;
      const dx   = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const ideal = 110 + a.r + b.r;
      const str  = (dist - ideal) * 0.038;
      const fx = (dx / dist) * str, fy = (dy / dist) * str;
      a.fx += fx; a.fy += fy;
      b.fx -= fx; b.fy -= fy;
    });

    // Gravità verso il centro
    nodes.forEach(n => {
      n.fx += (cx - n.x) * 0.007;
      n.fy += (cy - n.y) * 0.007;
    });

    // Applica con damping + cooling + boundary
    const damp = 0.80;
    nodes.forEach(n => {
      n.vx = (n.vx + n.fx * cool) * damp;
      n.vy = (n.vy + n.fy * cool) * damp;
      n.x  = Math.max(n.r + 8, Math.min(W - n.r - 8, n.x + n.vx));
      n.y  = Math.max(n.r + 8, Math.min(H - n.r - 8, n.y + n.vy));
    });
  }
}

/** Helper: crea un elemento SVG con namespace corretto. */
const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

/**
 * Disegna il grafo nel tag <svg>.
 */
function drawMapSVG(svg, nodes, edges, W, H) {
  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width',  W);
  svg.setAttribute('height', H);

  // Defs (shadow filter)
  const defs   = svgEl('defs');
  const filter = svgEl('filter', { id: 'ns', x: '-30%', y: '-30%', width: '160%', height: '160%' });
  const shadow = svgEl('feDropShadow', { dx: '0', dy: '1', stdDeviation: '2.5', 'flood-color': '#00000022' });
  filter.appendChild(shadow);
  defs.appendChild(filter);
  svg.appendChild(defs);

  // Sfondo
  svg.appendChild(svgEl('rect', { width: W, height: H, fill: '#f8f9fa', rx: '10' }));

  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // Edge layer
  const eg = svgEl('g');
  edges.forEach(e => {
    const a = nodeMap.get(e.source), b = nodeMap.get(e.target);
    if (!a || !b) return;
    eg.appendChild(svgEl('line', {
      x1: Math.round(a.x), y1: Math.round(a.y),
      x2: Math.round(b.x), y2: Math.round(b.y),
      stroke: '#ced4da', 'stroke-width': '1.5', 'stroke-opacity': '0.55',
    }));
  });
  svg.appendChild(eg);

  // Node layer
  const ng = svgEl('g');
  nodes.forEach(n => {
    const g = svgEl('g', { transform: `translate(${Math.round(n.x)},${Math.round(n.y)})` });
    g.style.cursor = 'pointer';
    g.dataset.nodeId = n.id;

    if (n.type === 'tag') {
      // Cerchio tag — colore per frequenza (più video = blu più intenso)
      const intensity = Math.min(1, n.count / 10);
      const fill = `hsl(213,${60 + intensity * 30}%,${88 - intensity * 20}%)`;
      g.appendChild(svgEl('circle', {
        r: n.r, fill, stroke: '#1a73e8', 'stroke-width': '1.8',
        filter: 'url(#ns)',
      }));
      const fs = Math.max(8, Math.min(12, n.r * 0.65));
      const lbl = svgEl('text', {
        'text-anchor': 'middle', dy: '0.35em',
        'font-size': fs, 'font-family': 'system-ui, sans-serif',
        fill: '#1a73e8', 'font-weight': '600', 'pointer-events': 'none',
      });
      lbl.textContent = n.label.length > 13 ? n.label.slice(0, 12) + '…' : n.label;
      g.appendChild(lbl);

      // Badge conteggio sotto il nodo
      const bdg = svgEl('text', {
        'text-anchor': 'middle', dy: n.r + 11,
        'font-size': '9', fill: '#6c757d',
        'font-family': 'system-ui', 'pointer-events': 'none',
      });
      bdg.textContent = `×${n.count}`;
      g.appendChild(bdg);

    } else {
      // Cerchio creator
      g.appendChild(svgEl('circle', {
        r: n.r, fill: '#d1fae5', stroke: '#0f9d58', 'stroke-width': '2',
        filter: 'url(#ns)',
      }));
      const initial = svgEl('text', {
        'text-anchor': 'middle', dy: '0.35em',
        'font-size': '11', 'font-family': 'system-ui',
        fill: '#0f9d58', 'font-weight': '700', 'pointer-events': 'none',
      });
      initial.textContent = (n.label || '?')[0].toUpperCase();
      g.appendChild(initial);

      const nameLbl = svgEl('text', {
        'text-anchor': 'middle', dy: n.r + 13,
        'font-size': '9.5', 'font-family': 'system-ui',
        fill: '#0f9d58', 'font-weight': '700', 'pointer-events': 'none',
      });
      const nm = n.label || '';
      nameLbl.textContent = nm.length > 15 ? nm.slice(0, 14) + '…' : nm;
      g.appendChild(nameLbl);
    }

    // SVG <title> = tooltip nativo del browser al hover
    const title = svgEl('title');
    title.textContent = n.type === 'tag'
      ? `#${n.label} — ${n.count} video`
      : n.label;
    g.appendChild(title);

    // Click → mostra pannello dettaglio
    g.addEventListener('click', () => onMapNodeClick(n, g));
    // Hover highlight
    g.addEventListener('mouseenter', () => {
      const c = g.querySelector('circle');
      if (c) { c.setAttribute('stroke-width', '3'); c.style.filter = 'none'; }
    });
    g.addEventListener('mouseleave', () => {
      const c = g.querySelector('circle');
      if (c) { c.setAttribute('stroke-width', n.type === 'tag' ? '1.8' : '2'); c.style.filter = 'url(#ns)'; }
    });

    ng.appendChild(g);
  });
  svg.appendChild(ng);
}

function onMapNodeClick(node, groupEl) {
  // Deseleziona tutti
  document.querySelectorAll('[data-node-id] circle').forEach(c => {
    c.setAttribute('stroke-width', c.closest('[data-node-id]')?.dataset.nodeId?.startsWith('tag:') ? '1.8' : '2');
  });
  // Seleziona nodo corrente
  const circle = groupEl?.querySelector('circle');
  if (circle) circle.setAttribute('stroke-width', '4');

  const panel = $('map-node-detail');
  const title = $('map-detail-title');
  const body  = $('map-detail-body');

  if (node.type === 'tag') {
    title.innerHTML = `🏷️ <strong>#${escHtml(node.label)}</strong> &nbsp;·&nbsp; ${node.count} video`;
    const chips = (node.videos || []).map(v =>
      `<button class="map-video-chip" data-id="${v.id}" data-status="${v.status || ''}">${escHtml(v.title.slice(0, 55))}${v.status === 'pending' ? ' · coda' : ''}</button>`
    ).join('');
    body.innerHTML = chips
      ? `<div class="map-video-list">${chips}</div>`
      : '<p style="color:var(--text3);font-size:12px">Nessun video associato</p>';
    body.querySelectorAll('.map-video-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const s = allSummaries.find(x => x.id === chip.dataset.id);
        if (!s) return;
        if (chip.dataset.status === 'pending') {
          $('archive-search').value = s.title || '';
          filterArchive();
          switchTab('archive');
          return;
        }
        openModal(s);
      });
    });
    $('btn-map-filter').onclick = () => {
      $('archive-search').value = node.label;
      filterArchive();
      switchTab('archive');
    };

  } else {
    title.innerHTML = `👤 <strong>${escHtml(node.label)}</strong>`;
    const cs = allSummaries.filter(s =>
      s.channelId === node.channelKey || s.channelName === node.label
    );
    body.innerHTML = `<p style="font-size:12px;color:var(--text2)">${escHtml(cs.length)} video archiviati</p>`;
    $('btn-map-filter').onclick = () => {
      $('archive-filter-channel').value = node.label;
      filterArchive();
      switchTab('archive');
    };
  }
  panel.classList.remove('hidden');
}

function renderMap() {
  const area  = $('map-canvas-area');
  const svg   = $('map-svg');
  const empty = $('map-empty');
  if (!area || !svg) return;

  const data = buildMapData();
  if (!data || data.nodes.length < 3) {
    empty.classList.remove('hidden');
    svg.style.display = 'none';
    $('map-node-detail')?.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  svg.style.display = '';

  const W = area.clientWidth  || 780;
  const H = Math.max(460, Math.min(600, window.innerHeight - 260));

  const { nodes, edges } = data;
  runForceSimulation(nodes, edges, W, H);
  drawMapSVG(svg, nodes, edges, W, H);
  mapRendered = true;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

async function loadStats() {
  const [{ stats }, { summaries }, { creators }] = await Promise.all([
    bg('GET_STATS'),
    bg('GET_SUMMARIES'),
    bg('GET_CREATORS'),
  ]);

  $('stat-total').textContent = stats?.totalSummarized || 0;
  $('stat-creators-n').textContent = creators?.length || 0;

  const monthKey = new Date().toISOString().slice(0, 7);
  $('stat-this-month').textContent = stats?.byMonth?.[monthKey] || 0;

  // Tag unici
  const allTags = (summaries || []).flatMap(s => s.tags || []);
  const uniqueTags = new Set(allTags);
  $('stat-tags').textContent = uniqueTags.size;

  // Activity chart (ultimi 6 mesi)
  const chart = $('activity-chart');
  const byMonth = stats?.byMonth || {};
  const months  = getLast6Months();
  const max     = Math.max(...months.map(m => byMonth[m] || 0), 1);

  chart.innerHTML = months.map(m => {
    const count = byMonth[m] || 0;
    const pct   = Math.round((count / max) * 100);
    const label = m.slice(5); // "05"
    return `
      <div class="activity-bar-wrap">
        <div class="activity-bar ${count > 0 ? 'filled' : ''}" style="height:${Math.max(pct,4)}px" title="${count} video"></div>
        <span class="activity-label">${label}</span>
      </div>
    `;
  }).join('');

  // Top tags
  const tagCount = {};
  allTags.forEach(t => { tagCount[t] = (tagCount[t] || 0) + 1; });
  const topTags = Object.entries(tagCount).sort((a,b) => b[1]-a[1]).slice(0, 20);
  $('top-tags').innerHTML = topTags.map(([tag, n]) =>
    `<span class="tag-cloud-item" style="font-size:${11+Math.min(n*2,8)}px">#${escHtml(tag)} <small>(${n})</small></span>`
  ).join('');
}

// ── Chat con l'Archivio ───────────────────────────────────────────────────────

function initChat() {
  chatInitialized = true;
  const extractedCount = allSummaries.filter(s => s.status === 'extracted' && s.markdown).length;
  updateChatNoteCount(extractedCount);
}

function updateChatNoteCount(count) {
  const label = $('chat-note-count-label');
  if (!label) return;
  if (count === 0) {
    label.textContent = 'Archivio vuoto — estrai almeno un riepilogo per usare la chat.';
    $('chat-empty-warn')?.classList.remove('hidden');
    $('chat-suggestions')?.classList.add('hidden');
  } else {
    label.textContent = `Hai ${count} nota${count === 1 ? '' : 'e'} nell'archivio. Chiedimi qualcosa!`;
    $('chat-empty-warn')?.classList.add('hidden');
    $('chat-suggestions')?.classList.remove('hidden');
  }
  const ctxLabel = $('chat-context-label');
  if (ctxLabel) ctxLabel.textContent = count > 0 ? `📚 ${count} note nell'archivio` : '';
}

async function sendChatMessage() {
  const input = $('chat-input');
  const question = input?.value?.trim();
  if (!question) return;

  // Pulisci input e disabilita durante elaborazione
  input.value = '';
  const cc = $('chat-char-count');
  if (cc) cc.textContent = '0 / 2000';

  // Nascondi welcome se presente
  const welcome = $('chat-welcome');
  if (welcome) welcome.style.display = 'none';

  // Aggiungi messaggio utente
  appendUserMessage(question);
  chatHistory.push({ role: 'user', content: question });

  // Mostra indicatore di caricamento
  const loadingId = appendLoadingMessage();
  setBtnSendLoading(true);

  try {
    const res = await bg('CHAT_QUERY', { question });
    removeLoadingMessage(loadingId);

    if (!res.success) throw new Error(res.error || 'Errore sconosciuto');

    if (!res.answer) {
      appendAssistantMessage(
        '⚠️ Non hai ancora note nell\'archivio con markdown estratto. Estrai almeno un riepilogo per usare la chat.',
        []
      );
    } else {
      appendAssistantMessage(res.answer, res.sources || []);
      chatHistory.push({ role: 'assistant', content: res.answer });
    }
  } catch (err) {
    removeLoadingMessage(loadingId);
    appendErrorMessage(err.message || 'Errore durante la ricerca nell\'archivio.');
  } finally {
    setBtnSendLoading(false);
    input?.focus();
  }

  // Scroll al fondo
  scrollChatToBottom();
}

function appendUserMessage(text) {
  const container = $('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg chat-msg-user';
  div.innerHTML = `<div class="chat-bubble chat-bubble-user">${escHtml(text)}</div>`;
  container.appendChild(div);
  scrollChatToBottom();
}

function appendAssistantMessage(text, sources = []) {
  const container = $('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg chat-msg-assistant';

  // Converti il testo in HTML semplice (bold, italic, code, newlines)
  const htmlText = escHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  let sourcesHtml = '';
  if (sources.length > 0) {
    const chips = sources.map(s =>
      `<button class="chat-source-chip" data-action="chat-open-source" data-id="${s.id}" title="${escHtml(s.title)}">${escHtml((s.title || '').slice(0, 40))}${(s.title || '').length > 40 ? '…' : ''}</button>`
    ).join('');
    sourcesHtml = `<div class="chat-sources"><span class="chat-sources-label">📚 Fonti:</span>${chips}</div>`;
  }

  div.innerHTML = `
    <div class="chat-bubble chat-bubble-assistant">
      <p>${htmlText}</p>
    </div>
    ${sourcesHtml}
  `;

  // Bind source chip clicks
  div.querySelectorAll('[data-action="chat-open-source"]').forEach(chip => {
    chip.addEventListener('click', () => {
      const s = allSummaries.find(x => x.id === chip.dataset.id);
      if (s) { openModal(s); }
    });
  });

  container.appendChild(div);
  scrollChatToBottom();
}

function appendErrorMessage(msg) {
  const container = $('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg chat-msg-error';
  div.innerHTML = `<div class="chat-bubble chat-bubble-error">⚠️ ${escHtml(msg)}</div>`;
  container.appendChild(div);
  scrollChatToBottom();
}

function appendLoadingMessage() {
  const container = $('chat-messages');
  const id = `chat-loading-${Date.now()}`;
  const div = document.createElement('div');
  div.className = 'chat-msg chat-msg-assistant';
  div.id = id;
  div.innerHTML = `<div class="chat-bubble chat-bubble-loading"><span class="chat-loading-dots"><span>.</span><span>.</span><span>.</span></span></div>`;
  container.appendChild(div);
  scrollChatToBottom();
  return id;
}

function removeLoadingMessage(id) {
  document.getElementById(id)?.remove();
}

function setBtnSendLoading(loading) {
  const btn = $('btn-chat-send');
  const icon = $('chat-send-icon');
  if (!btn) return;
  btn.disabled = loading;
  if (icon) icon.textContent = loading ? '⏳' : '▶';
}

function clearChat() {
  chatHistory = [];
  const container = $('chat-messages');
  // Rimuovi tutti i messaggi ma lascia #chat-welcome
  [...container.children].forEach(child => {
    if (child.id !== 'chat-welcome') child.remove();
  });
  // Ri-mostra welcome
  const welcome = $('chat-welcome');
  if (welcome) welcome.style.display = '';
}

function scrollChatToBottom() {
  const container = $('chat-messages');
  if (container) container.scrollTop = container.scrollHeight;
}

// ── Ricerca Semantica ─────────────────────────────────────────────────────────

async function triggerSemanticSearch() {
  const query = $('archive-search')?.value?.trim();
  if (!query) {
    $('archive-search')?.focus();
    return;
  }

  const btn = $('btn-semantic-search');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Analisi…'; }

  try {
    const res = await bg('SEMANTIC_SEARCH', { query });
    if (!res.success) throw new Error(res.error || 'Errore ricerca semantica');

    const ranked = res.rankedIds || [];
    if (ranked.length === 0) {
      // Nessun risultato semantico — fallback a full-text
      filterArchive();
      return;
    }

    // Ordina allSummaries secondo il ranking semantico
    const orderMap = new Map(ranked.map((id, i) => [id, i]));
    const rankedSummaries = ranked
      .map(id => allSummaries.find(s => s.id === id))
      .filter(Boolean);

    semanticMode = true;
    semanticRankedIds = ranked;

    // Mostra barra semantica attiva
    const bar = $('semantic-active-bar');
    const qText = $('semantic-query-text');
    const rCount = $('semantic-result-count');
    if (bar) bar.classList.remove('hidden');
    if (qText) qText.textContent = query;
    if (rCount) rCount.textContent = rankedSummaries.length;

    renderArchive(rankedSummaries, query);
  } catch (err) {
    // In caso di errore fallback full-text
    filterArchive();
    const errDiv = document.createElement('div');
    errDiv.className = 'semantic-error';
    errDiv.textContent = `⚠️ Ricerca semantica non disponibile: ${err.message}. Uso ricerca full-text.`;
    errDiv.style.cssText = 'color:#e67e22;font-size:12px;padding:4px 0;';
    $('semantic-active-bar')?.after(errDiv);
    setTimeout(() => errDiv.remove(), 4000);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✨ Semantica'; }
  }
}

function resetSemanticSearch() {
  semanticMode = false;
  semanticRankedIds = [];
  const bar = $('semantic-active-bar');
  if (bar) bar.classList.add('hidden');
  filterArchive();
}

// ── Auto-Queue UI ─────────────────────────────────────────────────────────────

let _catchupChannelId = null;

function showCatchupModal(channelId, channelName) {
  _catchupChannelId = channelId;
  const nameEl = $('catchup-creator-name');
  if (nameEl) nameEl.textContent = channelName || 'questo creator';
  const fb = $('catchup-feedback');
  if (fb) { fb.textContent = ''; fb.style.color = ''; }
  $('catchup-modal')?.classList.remove('hidden');
}

function closeCatchupModal() {
  $('catchup-modal')?.classList.add('hidden');
  _catchupChannelId = null;
}

async function doCatchupQueue(count) {
  const channelId = _catchupChannelId;
  if (!channelId) return;

  const fb = $('catchup-feedback');
  if (fb) fb.textContent = '⏳ Accodamento in corso…';

  const opts = document.querySelectorAll('.catchup-opt');
  opts.forEach(b => { b.disabled = true; });

  try {
    const res = await bg('CATCHUP_QUEUE', { channelId, count });
    if (res.success) {
      if (fb) {
        fb.style.color = 'var(--success)';
        fb.textContent = res.queued > 0
          ? `✅ ${res.queued} video accodati!`
          : '✅ Nessun nuovo video trovato.';
      }
      await loadNewVideosCounts();
      setTimeout(() => { closeCatchupModal(); loadCreators(); }, 1500);
    } else {
      if (fb) { fb.style.color = 'var(--danger)'; fb.textContent = `❌ ${res.error || 'Errore'}`; }
    }
  } catch (e) {
    if (fb) { fb.style.color = 'var(--danger)'; fb.textContent = `❌ ${e.message}`; }
  } finally {
    opts.forEach(b => { b.disabled = false; });
  }
}

async function doCheckAndQueue(channelId, btn) {
  const origText = btn?.textContent;
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  try {
    const res = await bg('CHECK_AND_QUEUE', { channelId });
    if (res.success) {
      const count = res.totalQueued || 0;
      await loadNewVideosCounts();
      // Aggiorna badge globale
      const total = Object.values(newVideosCounts).reduce((a, b) => a + b, 0);
      const badge = $('queue-all-badge');
      if (badge) { badge.textContent = total; badge.classList.toggle('hidden', total === 0); }

      const fb = document.getElementById(`queue-feedback-${channelId}`);
      if (fb) {
        fb.textContent = count > 0 ? `✅ ${count} video accodati!` : '✅ Nessun nuovo video.';
        fb.classList.remove('hidden');
        setTimeout(() => fb.classList.add('hidden'), 4000);
      }
    }
  } catch (e) {
    console.error('Check and queue error:', e);
  } finally {
    const newCount = newVideosCounts[channelId] || 0;
    if (btn) {
      btn.textContent = newCount > 0 ? `📥 Accoda (${newCount})` : '📥 Accoda';
      btn.classList.toggle('btn-queue-has-new', newCount > 0);
      btn.disabled = false;
    }
  }
}

async function doTogglePriority(channelId, btn) {
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  try {
    const res = await bg('TOGGLE_PRIORITY', { channelId });
    if (res.success) {
      const creator = allCreators.find(c => c.channelId === channelId);
      if (creator) creator.isPriority = res.isPriority;
      if (btn) {
        btn.classList.toggle('btn-priority-active', res.isPriority);
        btn.title = res.isPriority
          ? 'Prioritario: estrae subito — clicca per disattivare'
          : 'Rendi prioritario: estrae subito i nuovi video';
      }
      // Aggiorna badge ⚡ sull'avatar
      const card = document.getElementById(`creator-card-${channelId}`);
      const avatarWrap = card?.querySelector('.creator-avatar-wrap');
      if (avatarWrap) {
        const existing = avatarWrap.querySelector('.creator-priority-badge');
        if (res.isPriority && !existing) {
          const badge = document.createElement('span');
          badge.className = 'creator-priority-badge';
          badge.title = 'Creator prioritario — i nuovi video vengono estratti subito';
          badge.textContent = '⚡';
          avatarWrap.appendChild(badge);
        } else if (!res.isPriority && existing) {
          existing.remove();
        }
      }
    }
  } catch (e) {
    console.error('Toggle priority error:', e);
  } finally {
    if (btn) { btn.textContent = '⚡'; btn.disabled = false; }
  }
}

function toggleQueueSettingsPanel(channelId, btn) {
  const panel = document.getElementById(`queue-panel-${channelId}`);
  if (!panel) return;
  const isOpen = !panel.classList.contains('hidden');
  if (isOpen) {
    panel.classList.add('hidden');
    btn?.classList.remove('active');
  } else {
    // Chiudi altri pannelli queue aperti
    document.querySelectorAll('.queue-settings-panel:not(.hidden)').forEach(p => {
      if (p.id !== `queue-panel-${channelId}`) {
        p.classList.add('hidden');
        const otherId = p.id.replace('queue-panel-', '');
        document.querySelector(`[data-action="toggle-queue-settings"][data-channel-id="${otherId}"]`)?.classList.remove('active');
      }
    });
    document.getElementById(`mass-queue-panel-${channelId}`)?.classList.add('hidden');
    document.querySelector(`[data-action="toggle-mass-queue"][data-channel-id="${channelId}"]`)?.classList.remove('active');
    panel.classList.remove('hidden');
    btn?.classList.add('active');
    setTimeout(() => document.getElementById(`queue-kw-${channelId}`)?.focus(), 50);
  }
}

async function saveQueueSettings(channelId, btn) {
  const kwInput   = document.getElementById(`queue-kw-${channelId}`);
  const enabledCb = document.getElementById(`queue-enabled-${channelId}`);
  const fb        = document.getElementById(`queue-feedback-${channelId}`);
  const origText  = btn?.textContent;
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }

  try {
    const keywords = (kwInput?.value || '')
      .split(',')
      .map(k => k.trim().toLowerCase())
      .filter(Boolean);
    const autoQueueEnabled = enabledCb ? enabledCb.checked : true;

    await bg('UPDATE_QUEUE_SETTINGS', { channelId, settings: { queueKeywords: keywords, autoQueueEnabled } });

    const creator = allCreators.find(c => c.channelId === channelId);
    if (creator) { creator.queueKeywords = keywords; creator.autoQueueEnabled = autoQueueEnabled; }

    const card = document.getElementById(`creator-card-${channelId}`);
    if (card) card.classList.toggle('queue-disabled', !autoQueueEnabled);

    if (fb) {
      fb.textContent = '✅ Impostazioni salvate';
      fb.classList.remove('hidden');
      setTimeout(() => fb.classList.add('hidden'), 3000);
    }
  } catch (e) {
    if (fb) {
      fb.textContent = `❌ ${e.message}`;
      fb.classList.remove('hidden');
    }
  } finally {
    if (btn) { btn.textContent = origText; btn.disabled = false; }
  }
}

function toggleMassQueuePanel(channelId, btn) {
  const panel = document.getElementById(`mass-queue-panel-${channelId}`);
  if (!panel) return;
  const isOpen = !panel.classList.contains('hidden');
  if (isOpen) {
    panel.classList.add('hidden');
    btn?.classList.remove('active');
  } else {
    document.querySelectorAll('.mass-queue-panel:not(.hidden)').forEach(p => {
      if (p.id !== `mass-queue-panel-${channelId}`) {
        p.classList.add('hidden');
        const otherId = p.id.replace('mass-queue-panel-', '');
        document.querySelector(`[data-action="toggle-mass-queue"][data-channel-id="${otherId}"]`)?.classList.remove('active');
      }
    });
    document.getElementById(`queue-panel-${channelId}`)?.classList.add('hidden');
    document.querySelector(`[data-action="toggle-queue-settings"][data-channel-id="${channelId}"]`)?.classList.remove('active');
    panel.classList.remove('hidden');
    btn?.classList.add('active');
  }
}

function collectMassQueueSettings(channelId) {
  const contentTypes = [...document.querySelectorAll(`input[data-mass-type="${channelId}"]:checked`)]
    .map(el => el.value);
  const durationBuckets = [...document.querySelectorAll(`input[data-mass-bucket="${channelId}"]:checked`)]
    .map(el => el.value);
  if (!contentTypes.length) throw new Error('Seleziona almeno un tipo di contenuto.');
  if (!durationBuckets.length) throw new Error('Seleziona almeno un bucket di durata.');
  return {
    queueContentTypes: contentTypes,
    queueDurationBuckets: durationBuckets,
    includeBeforeFollowedAt: !!document.getElementById(`mass-include-history-${channelId}`)?.checked,
    massQueueLimit: Math.max(1, Number(document.getElementById(`mass-limit-${channelId}`)?.value || 100)),
  };
}

async function saveMassQueueSettings(channelId, btn) {
  const fb = document.getElementById(`mass-queue-feedback-${channelId}`);
  const origText = btn?.textContent;
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }

  try {
    const settings = collectMassQueueSettings(channelId);
    await bg('UPDATE_QUEUE_SETTINGS', { channelId, settings });
    const creator = allCreators.find(c => c.channelId === channelId);
    if (creator) Object.assign(creator, settings);
    if (fb) {
      fb.textContent = '✅ Filtri salvati';
      fb.classList.remove('hidden');
      setTimeout(() => fb.classList.add('hidden'), 3000);
    }
  } catch (e) {
    if (fb) {
      fb.textContent = `❌ ${e.message}`;
      fb.classList.remove('hidden');
    }
  } finally {
    if (btn) { btn.textContent = origText; btn.disabled = false; }
  }
}

async function analyzeMassQueue(channelId, btn) {
  const fb = document.getElementById(`mass-queue-feedback-${channelId}`);
  const origText = btn?.textContent;
  if (btn) { btn.textContent = '⏳ Analisi…'; btn.disabled = true; }
  try {
    await saveMassQueueSettings(channelId);
    const res = await bg('ANALYZE_CHANNEL_MASS_QUEUE', { channelId, options: { maxItems: 'all' } });
    if (!res.success) throw new Error(res.error || 'Analisi fallita');
    if (fb) {
      fb.textContent = `✅ Analisi completata: ${res.profile?.totalVideos || 0} video classificati`;
      fb.classList.remove('hidden');
    }
    await loadCreators();
    setTimeout(() => {
      const toggleBtn = document.querySelector(`[data-action="toggle-mass-queue"][data-channel-id="${channelId}"]`);
      if (toggleBtn) toggleMassQueuePanel(channelId, toggleBtn);
    }, 50);
  } catch (e) {
    if (fb) {
      fb.textContent = `❌ ${e.message}`;
      fb.classList.remove('hidden');
    }
  } finally {
    if (btn) { btn.textContent = origText; btn.disabled = false; }
  }
}

async function queueMassChannel(channelId, btn) {
  const fb = document.getElementById(`mass-queue-feedback-${channelId}`);
  const origText = btn?.textContent;
  if (btn) { btn.textContent = '⏳ Accodamento…'; btn.disabled = true; }

  try {
    const settings = collectMassQueueSettings(channelId);
    await bg('UPDATE_QUEUE_SETTINGS', { channelId, settings });
    const res = await bg('QUEUE_CHANNEL_MASS', {
      channelId,
      filters: {
        contentTypes: settings.queueContentTypes,
        durationBuckets: settings.queueDurationBuckets,
        includeBeforeFollowedAt: settings.includeBeforeFollowedAt,
        limit: settings.massQueueLimit,
      }
    });
    if (!res.success) throw new Error(res.error || 'Accodamento fallito');
    if (fb) {
      fb.textContent = res.queued > 0
        ? `✅ ${res.queued} video accodati (${res.matched} match su ${res.totalScanned} scansionati)`
        : '✅ Nessun video compatibile con i filtri selezionati.';
      fb.classList.remove('hidden');
    }
    await Promise.all([loadSummaries(), loadCreators(), loadNewVideosCounts()]);
  } catch (e) {
    if (fb) {
      fb.textContent = `❌ ${e.message}`;
      fb.classList.remove('hidden');
    }
  } finally {
    if (btn) { btn.textContent = origText; btn.disabled = false; }
  }
}

async function queueAllNewFromDashboard() {
  const btn = $('btn-queue-all-new');
  const origHTML = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Accodando…'; }

  try {
    const res = await bg('QUEUE_ALL_NEW');
    await loadNewVideosCounts();
    await loadCreators();

    const fb = $('creators-actions-feedback');
    if (fb) {
      fb.textContent = (res.totalQueued || 0) > 0
        ? `✅ ${res.totalQueued} nuovi video accodati!`
        : '✅ Nessun nuovo video da accodare.';
      setTimeout(() => { if (fb) fb.textContent = ''; }, 4000);
    }
  } catch (e) {
    const fb = $('creators-actions-feedback');
    if (fb) { fb.textContent = `❌ ${e.message}`; }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = origHTML; }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function matchesSearch(s, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    s.title?.toLowerCase().includes(q) ||
    s.channelName?.toLowerCase().includes(q) ||
    s.tags?.some(t => t.toLowerCase().includes(q)) ||
    s.markdown?.toLowerCase().includes(q)
  );
}

function matchesFeedSearch(v, query, creatorFilter) {
  const matchCreator = !creatorFilter || v.channelName === creatorFilter;
  if (!query) return matchCreator;
  const q = query.toLowerCase();
  return matchCreator && (
    v.title?.toLowerCase().includes(q) ||
    v.channelName?.toLowerCase().includes(q)
  );
}

function formatMassQueueTypeLabels(counts = {}) {
  return [
    counts.video ? `▶ ${counts.video} video` : null,
    counts.short ? `⚡ ${counts.short} shorts` : null,
    counts.live ? `🔴 ${counts.live} live` : null,
    counts.playlist ? `≡ ${counts.playlist} playlist` : null,
    counts.course ? `🎓 ${counts.course} corsi` : null,
  ].filter(Boolean);
}

function formatMassQueueDurationLabels(counts = {}) {
  return [
    counts.flash ? `⚡ ${counts.flash}` : null,
    counts.quick ? `🔵 ${counts.quick}` : null,
    counts.standard ? `🟢 ${counts.standard}` : null,
    counts.deep ? `🟡 ${counts.deep}` : null,
    counts.marathon ? `🔴 ${counts.marathon}` : null,
  ].filter(Boolean);
}

function renderMassQueueCountChips(typeCounts = {}, durationCounts = {}) {
  const chips = [
    ['type', '▶ Video', typeCounts.video || 0],
    ['type', '⚡ Shorts', typeCounts.short || 0],
    ['type', '🔴 Live', typeCounts.live || 0],
    ['type', '≡ Playlist', typeCounts.playlist || 0],
    ['type', '🎓 Corsi', typeCounts.course || 0],
    ['bucket', '⚡ <3 min', durationCounts.flash || 0],
    ['bucket', '🔵 3–10 min', durationCounts.quick || 0],
    ['bucket', '🟢 10–30 min', durationCounts.standard || 0],
    ['bucket', '🟡 30–59 min', durationCounts.deep || 0],
    ['bucket', '🔴 60+ min', durationCounts.marathon || 0],
  ];
  return chips.map(([kind, label, value]) =>
    `<span class="mass-queue-chip mass-queue-chip-${kind}${value > 0 ? '' : ' empty'}"><strong>${label}</strong> ${value}</span>`
  ).join('');
}

function renderMassQueueCheckboxes(channelId, mode, entries, selectedValues) {
  const selected = new Set(selectedValues || []);
  const attr = mode === 'type' ? 'data-mass-type' : 'data-mass-bucket';
  return entries.map(([value, label]) =>
    `<label class="mass-queue-option">
      <input type="checkbox" ${attr}="${channelId}" value="${value}" ${selected.has(value) ? 'checked' : ''}>
      <span>${label}</span>
    </label>`
  ).join('');
}

function getLast6Months() {
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    months.push(d.toISOString().slice(0, 7));
  }
  return months;
}

function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── Screening & Daily Digest ──────────────────────────────────────────────────

function renderScreening(summaries) {
  const list = $('screening-list');
  if (!list) return;

  if (summaries.length === 0) {
    $('screening-empty').classList.remove('hidden');
    list.innerHTML = '';
    return;
  }
  $('screening-empty').classList.add('hidden');

  list.innerHTML = summaries.map(s => {
    const pitch = s.aiPitch || {};
    const scoreClass = pitch.score >= 8 ? 'text-success' : (pitch.score >= 5 ? 'text-warning' : 'text-danger');
    
    return `
      <div class="archive-item screening-card" data-id="${s.id}">
        <div class="archive-thumb-wrap">
          <img class="archive-thumb" src="${s.thumbnail || `https://i.ytimg.com/vi/${s.videoId}/mqdefault.jpg`}" loading="lazy">
        </div>
        <div class="archive-content">
          <div class="archive-badges">
            <span class="archive-badge badge-pending">💡 Segnalazione</span>
            ${s.durationBucket ? `<span class="archive-badge badge-neutral">${s.durationBucket}</span>` : ''}
            <span class="archive-badge" style="font-weight:bold;color:var(--text1)">Score: <span class="${scoreClass}">${pitch.score || '?'}</span>/10</span>
          </div>
          <h3 class="archive-title">${escHtml(s.title || 'Senza Titolo')}</h3>
          <p class="archive-channel">${escHtml(s.channelName || 'Sconosciuto')}</p>
          
          <div style="background:var(--bg3); padding:12px; border-radius:6px; margin: 12px 0;">
            <p style="font-size:13px; font-weight:600; color:var(--text1); margin-bottom:4px">🎯 Tema:</p>
            <p style="font-size:13px; color:var(--text2); margin-bottom:8px">${escHtml(pitch.hook || 'N/D')}</p>
            <p style="font-size:13px; font-weight:600; color:var(--text1); margin-bottom:4px">💡 Perché vederlo:</p>
            <p style="font-size:13px; color:var(--text2); margin-bottom:8px">${escHtml(pitch.value || 'N/D')}</p>
            <p style="font-size:13px; font-weight:600; color:var(--text1); margin-bottom:4px">🤔 Giudizio:</p>
            <p style="font-size:13px; color:var(--text2);">${escHtml(pitch.reason || 'N/D')}</p>
          </div>
          
          <div class="archive-actions" style="justify-content: flex-start; gap: 8px;">
            <button class="btn btn-primary btn-sm" data-action="approve-screening" data-id="${s.id}">✨ Approva e Estrai</button>
            <button class="btn btn-ghost btn-sm" onclick="openVideoOnYT('${s.videoId}')">▶ Guarda</button>
            <button class="btn btn-danger btn-sm" data-action="discard-screening" data-id="${s.id}">🗑️ Scarta</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function approveScreeningItem(id, btn) {
  const origText = btn.textContent;
  btn.textContent = '⏳ Approvazione...';
  btn.disabled = true;
  try {
    const summary = allSummaries.find(s => s.id === id);
    if (!summary) throw new Error("Item non trovato");
    
    await chrome.storage.local.get(['summaries']).then(res => {
      const arr = res.summaries || [];
      const idx = arr.findIndex(s => s.id === id);
      if (idx !== -1) {
        arr[idx].status = 'pending';
        return chrome.storage.local.set({ summaries: arr });
      }
    });
    
    summary.status = 'pending';
    await bg('EXTRACT_PENDING_SUMMARY', { id });
    
    Progress.show('⚙️ Avvio estrazione', 1, 1, summary.title);
    setTimeout(() => {
      Progress.hide();
      loadSummaries();
    }, 2000);
    
  } catch (e) {
    console.error("Approve error", e);
    btn.textContent = '❌ Errore';
    setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000);
  }
}
