'use strict';

// Isolated Supabase-client transport; never installs/replaces global fetch.
// Inject the already legally guarded fetch as delegate, before loading visitor.
const ORIGIN = 'https://gtlipifdfyugiwpxvuse.supabase.co';
const MIN_SPACING_MS = 500, TIMEOUT_MS = 20000, MAX_BODY_BYTES = 4 * 1024 * 1024;
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function problem(code, extra = {}) { return Object.assign(new Error(code), { code, ...extra }); }
function must(value, code) { if (!value) throw problem(code); }
function abortable(promise, signal, onLate) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => { if (!settled) { settled = true; reject(problem('database_request_timeout_or_abort')); } };
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => {
      signal.removeEventListener('abort', abort);
      if (settled) { onLate?.(value); return; }
      settled = true; resolve(value);
    }, error => {
      signal.removeEventListener('abort', abort);
      if (!settled) { settled = true; reject(error); }
    });
  });
}
function createDatabaseFetchGate(delegate, {
  now = Date.now, wait = sleep, timeoutMs = TIMEOUT_MS, maxBodyBytes = MAX_BODY_BYTES,
  onEvent = () => {}, onStop = () => {},
} = {}) {
  must(typeof delegate === 'function', 'database_fetch_delegate_missing');
  must(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= TIMEOUT_MS, 'invalid_database_timeout');
  must(Number.isInteger(maxBodyBytes) && maxBodyBytes > 0 && maxBodyBytes <= MAX_BODY_BYTES, 'invalid_database_body_bound');
  let tail = Promise.resolve(), stopped = null, active = 0, queued = 0, requests = 0, sequence = 0, previousFinished = null;
  function stop(reason) {
    if (stopped) return;
    stopped = { code: reason.code || 'database_transport_failure', ...(reason.http_status ? { http_status: reason.http_status } : {}), ...(reason.db_code ? { db_code: reason.db_code } : {}) };
    // Persist first-stop evidence synchronously. Failure cannot reopen the gate.
    onStop({ ...stopped, requests });
  }
  function latched() { return problem('database_gate_stopped', { reason: stopped }); }
  async function dispatch(request, seq) {
    if (stopped) throw latched();
    let reader, timer, controller, started = null, status, bytes = 0;
    const upstreamAbort = () => controller?.abort();
    const label = { sequence: seq, method: request.method, path: new URL(request.url).pathname };
    active = 1;
    try {
      if (previousFinished !== null) await wait(Math.max(0, MIN_SPACING_MS - (now() - previousFinished)));
      if (stopped) throw latched();
      must(!request.signal.aborted, 'database_request_timeout_or_abort');
      controller = new AbortController();
      request.signal.addEventListener('abort', upstreamAbort, { once: true });
      timer = setTimeout(() => controller.abort(), timeoutMs);
      started = now();
      onEvent({ event: 'database_request_started', ...label });
      requests++;
      const response = await abortable(delegate(request, { signal: controller.signal, redirect: 'error' }), controller.signal,
        late => { void late.body?.cancel().catch(() => {}); });
      status = response.status;
      must(!response.redirected && (!response.url || new URL(response.url).origin === ORIGIN), 'database_response_origin_changed');
      must(status < 300 || status >= 400, 'database_redirect_forbidden');
      reader = response.body?.getReader();
      const chunks = [];
      if (reader) for (;;) {
        const part = await abortable(reader.read(), controller.signal);
        if (part.done) break;
        bytes += part.value.byteLength;
        must(bytes <= maxBodyBytes, 'database_response_too_large');
        chunks.push(Buffer.from(part.value));
      }
      const body = Buffer.concat(chunks);
      let dbCode;
      try { const parsed = JSON.parse(body.toString('utf8')); if (typeof parsed?.code === 'string') dbCode = parsed.code; } catch {}
      if (status === 429 || status >= 500 || ['57014', '53300'].includes(dbCode)) {
        stop({ code: 'database_transient_stop', http_status: status, ...(dbCode ? { db_code: dbCode } : {}) });
      }
      onEvent({ event: 'database_response_finished', ...label, http_status: status, ...(dbCode ? { db_code: dbCode } : {}), bytes, elapsed_ms: now() - started, stopped: !!stopped });
      // The original caller sees the original error response (including expected
      // 406 single-lookup and optional-table 404). No synthetic success, retry,
      // status rewrite or ownership-check bypass is introduced.
      return new Response(request.method === 'HEAD' || [204, 205, 304].includes(status) ? null : body,
        { status, statusText: response.statusText, headers: response.headers });
    } catch (error) {
      controller?.abort();
      if (reader) void reader.cancel().catch(() => {});
      stop({ code: error?.code === 'database_gate_stopped' ? stopped.code : 'database_transport_failure', ...(status ? { http_status: status } : {}) });
      onEvent({ event: 'database_request_failed', ...label, code: String(error?.code || error?.name || 'error').replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 80), ...(status ? { http_status: status } : {}), bytes, elapsed_ms: started === null ? 0 : now() - started });
      throw error;
    } finally {
      clearTimeout(timer); request.signal.removeEventListener('abort', upstreamAbort);
      previousFinished = now(); active = 0;
    }
  }
  function fetch(input, init) {
    if (stopped) return Promise.reject(latched());
    let request;
    try {
      request = new Request(input, init);
      const u = new URL(request.url);
      must(u.origin === ORIGIN && u.protocol === 'https:' && !u.username && !u.password && !u.hash, 'database_request_origin_forbidden');
      must(METHODS.has(request.method), 'database_request_method_forbidden');
    } catch (error) {
      try { stop({ code: 'database_request_scope_failure' }); } catch (auditError) { return Promise.reject(auditError); }
      return Promise.reject(error);
    }
    const seq = ++sequence; queued++;
    const result = tail.then(() => { queued--; return dispatch(request, seq); });
    // Every caller retains its own error. The scheduling chain always drains;
    // a failed request never permits a queued or subsequent network dispatch.
    tail = result.then(() => undefined, () => undefined);
    return result;
  }
  return {
    fetch,
    state: () => ({ stopped: stopped ? { ...stopped } : null, active, queued, requests, minimumSpacingMs: MIN_SPACING_MS }),
    drain: () => tail,
    stop: (code = 'database_gate_closed') => stop({ code }),
  };
}
module.exports = { ORIGIN, MIN_SPACING_MS, TIMEOUT_MS, MAX_BODY_BYTES, createDatabaseFetchGate };
