// tests/area-b-net.test.js
const assert = require('assert');
const NetUtils = require('../utils/net.js');
assert.equal(typeof NetUtils.fetchWithRetry, 'function');

function fakeResponse(status, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: k => headers[k.toLowerCase()] || null }, json: async () => ({}), text: async () => '' };
}

(async () => {
  // 1) 429 poi 200 → ritorna 200 dopo 1 retry
  let calls = 0;
  global.fetch = async () => { calls++; return calls === 1 ? fakeResponse(429) : fakeResponse(200); };
  let res = await NetUtils.fetchWithRetry('http://x', {}, { retries: 3, baseDelayMs: 1 });
  assert.equal(res.status, 200);
  assert.equal(calls, 2, 'deve aver ritentato una volta');

  // 2) Esaurimento tentativi su 500 → errore tipizzato
  global.fetch = async () => fakeResponse(500);
  let threw = null;
  try { await NetUtils.fetchWithRetry('http://x', {}, { retries: 2, baseDelayMs: 1 }); } catch (e) { threw = e; }
  assert.ok(threw, 'deve lanciare dopo i tentativi');
  assert.ok(/server|500|temporane/i.test(threw.message), 'messaggio server/temporaneo');

  // 3) 429 senza retry residui → messaggio quota
  global.fetch = async () => fakeResponse(429);
  let q = null;
  try { await NetUtils.fetchWithRetry('http://x', {}, { retries: 0, baseDelayMs: 1 }); } catch (e) { q = e; }
  assert.ok(q && /quota|limite|429/i.test(q.message), 'messaggio quota');

  // 4) Errore di rete poi 200
  let netCalls = 0;
  global.fetch = async () => { netCalls++; if (netCalls === 1) throw new TypeError('Failed to fetch'); return fakeResponse(200); };
  res = await NetUtils.fetchWithRetry('http://x', {}, { retries: 2, baseDelayMs: 1 });
  assert.equal(res.status, 200);

  console.log('area-b-net OK');
})();
