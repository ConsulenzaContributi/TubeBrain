// utils/net.js — fetch resiliente per le chiamate AI
(function (root) {
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

  async function fetchWithRetry(url, options = {}, policy = {}) {
    const retries = Number.isInteger(policy.retries) ? policy.retries : 3;
    const baseDelayMs = policy.baseDelayMs || 600;
    const timeoutMs = policy.timeoutMs || 60000;

    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timer);
        if (res.ok) return res;
        if (!RETRYABLE_STATUS.has(res.status) || attempt === retries) {
          if (res.status === 429) throw new Error('Limite di quota raggiunto (429). Riprova più tardi o controlla il piano del provider.');
          throw new Error('Errore server temporaneo (HTTP ' + res.status + ').');
        }
        const retryAfter = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
        const wait = retryAfter > 0 ? retryAfter * 1000 : baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
        await sleep(wait);
      } catch (err) {
        clearTimeout(timer);
        lastError = err;
        const isAbort = err && (err.name === 'AbortError');
        const isNetwork = err && (err.name === 'TypeError');
        const isOurThrow = err && /quota|server temporaneo/i.test(err.message || '');
        if (isOurThrow || attempt === retries) {
          if (isAbort) throw new Error('Timeout della richiesta AI dopo ' + Math.round(timeoutMs / 1000) + 's.');
          throw err;
        }
        if (!isNetwork && !isAbort) throw err;
        await sleep(baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 100));
      }
    }
    throw lastError || new Error('Richiesta AI fallita.');
  }

  const api = { fetchWithRetry };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.NetUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
