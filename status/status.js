const STATUS_KEY = 'runtimeStatus';

const els = {
  icon: document.getElementById('status-icon'),
  kicker: document.getElementById('status-kicker'),
  title: document.getElementById('status-title'),
  detail: document.getElementById('status-detail'),
  fill: document.getElementById('status-progress-fill'),
  phase: document.getElementById('status-phase'),
  updated: document.getElementById('status-updated'),
  close: document.getElementById('btn-close'),
};

function relTime(ts) {
  if (!ts) return 'adesso';
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 5) return 'adesso';
  if (seconds < 60) return `${seconds}s fa`;
  const minutes = Math.round(seconds / 60);
  return `${minutes}m fa`;
}

function renderStatus(status = {}) {
  const kind = status.kind || 'info';
  document.body.dataset.kind = kind;
  els.icon.textContent = status.icon || '📚';
  els.kicker.textContent = status.kicker || 'Operazione in corso';
  els.title.textContent = status.title || 'In attesa…';
  els.detail.textContent = status.detail || 'Nessuna operazione attiva.';
  els.fill.style.width = `${Math.max(0, Math.min(100, Number(status.progress || 0)))}%`;
  els.phase.textContent = status.phase || 'idle';
  els.updated.textContent = relTime(status.updatedAt);
  if (status.autoCloseAt && Date.now() >= status.autoCloseAt) {
    window.close();
  }
}

async function loadStatus() {
  const data = await chrome.storage.local.get(STATUS_KEY);
  renderStatus(data[STATUS_KEY] || {});
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[STATUS_KEY]) return;
  renderStatus(changes[STATUS_KEY].newValue || {});
});

els.close.addEventListener('click', () => window.close());
loadStatus();
setInterval(loadStatus, 1000);
