'use strict';

const MIN_DELAY_MS = 60_000;
const MAX_DELAY_MS = 300_000;
const PROBE_TIMEOUT_MS = 20_000;
const MAX_PROBE_BYTES = 4096;

function isTransientCreateFailure(error, status) {
  const code = String(error?.code || error?.cause?.code || '');
  return [429, 500, 502, 503, 504].includes(Number(status || error?.status)) ||
    ['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003', '57014', '53300', '57P01', '57P02', '57P03',
      'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(code) ||
    ['AbortError', 'TimeoutError'].includes(error?.name) ||
    /Could not query the database for the schema cache|^TypeError: fetch failed$|^fetch failed$/i.test(String(error?.message || ''));
}

// One shared admission gate, not an automatic retry wrapper around any write.
function createCooldown({ probe, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)), random = Math.random, onEvent = () => {} }) {
  if (typeof probe !== 'function') throw new TypeError('Recovery probe required');
  let blocked = false, until = 0, failures = 0, generation = 0, ownerId = null, inFlight = null;
  const event = (kind, extra = {}) => {
    // A logger failure must not change the original database error or unlock the gate.
    try { onEvent({ kind, at: new Date(now()).toISOString(), generation, ...extra }); } catch {}
  };
  function open(id, reason, error, status) {
    blocked = true;
    ownerId = id;
    failures++;
    generation++;
    const base = Math.min(MAX_DELAY_MS, MIN_DELAY_MS * 2 ** Math.min(failures - 1, 3));
    const sample = Math.max(0, Math.min(1, Number(random()) || 0));
    const jitter = 1 + Math.floor(sample * base * 0.1);
    const delayMs = Math.min(MAX_DELAY_MS, base + jitter);
    until = Math.max(until, now() + delayMs);
    event('cooldown_open', { reason, delayMs: until - now(), ownerId, status: Number(status || error?.status) || null, code: error?.code || null });
  }
  function recordCreateFailure(id, error, status) {
    if (!isTransientCreateFailure(error, status)) return false;
    open(id, 'create_crawl_run_failed', error, status);
    return true;
  }
  async function waitForAdmission() {
    while (blocked) {
      const remaining = until - now();
      if (remaining > 0) {
        await sleep(remaining);
        continue; // Recheck the shared deadline after concurrent failures.
      }
      if (!inFlight) {
        const startedGeneration = generation, testedOwner = ownerId;
        inFlight = (async () => {
          let failed = false, failure;
          try { await probe(testedOwner); } catch (error) { failed = true; failure = error; }
          // A newer create failure always wins, even over a late successful probe.
          if (startedGeneration !== generation) {
            event('stale_probe_ignored', { startedGeneration });
          } else if (failed) {
            open(testedOwner, 'recovery_probe_failed', failure);
          } else {
            blocked = false;
            failures = 0;
            until = 0;
            event('cooldown_recovered', { ownerId: testedOwner });
          }
        })().finally(() => { inFlight = null; });
      }
      await inFlight;
    }
  }
  return { recordCreateFailure, waitForAdmission, state: () => ({ blocked, until, failures, generation, ownerId, probeInFlight: Boolean(inFlight) }) };
}

// Exact existing-owner GET only: no joins/counts/scans, redirects or write replay.
function createOwnerProbe({ getConfig, fetchImpl = (...args) => globalThis.fetch(...args), setTimer = setTimeout, clearTimer = clearTimeout }) {
  return async ownerId => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId || '')) throw new Error('Invalid recovery owner ID');
    const config = getConfig(), origin = new URL(config.url);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' || !config.serviceRoleKey) throw new Error('Invalid recovery database configuration');
    const url = new URL('/rest/v1/entities', origin);
    url.searchParams.set('select', 'id');
    url.searchParams.set('id', `eq.${ownerId}`);
    url.searchParams.set('limit', '1');
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimer(() => {
        controller.abort();
        reject(Object.assign(new Error('Recovery probe timed out'), { code: 'PROBE_TIMEOUT' }));
      }, PROBE_TIMEOUT_MS);
    });
    try {
      await Promise.race([deadline, (async () => {
        const response = await fetchImpl(url.href, {
          method: 'GET', redirect: 'error', signal: controller.signal,
          headers: { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}`, Accept: 'application/json' },
        });
        if (response.status !== 200) {
          await response.body?.cancel();
          throw Object.assign(new Error('Recovery probe HTTP failure'), { status: response.status });
        }
        if (!/application\/json/i.test(response.headers.get('content-type') || '')) throw new Error('Recovery probe was not JSON');
        const reader = response.body.getReader();
        let bytes = 0;
        const chunks = [];
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > MAX_PROBE_BYTES) throw new Error('Recovery probe response too large');
            chunks.push(Buffer.from(value));
          }
        } finally { await reader.cancel(); }
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!Array.isArray(data) || data.length !== 1 || data[0]?.id !== ownerId || Object.keys(data[0]).length !== 1) throw new Error('Recovery owner was not returned exactly');
      })()]);
    } finally {
      clearTimer(timer);
      controller.abort();
    }
  };
}

module.exports = { createCooldown, createOwnerProbe, isTransientCreateFailure, MIN_DELAY_MS, MAX_DELAY_MS, PROBE_TIMEOUT_MS, MAX_PROBE_BYTES };
