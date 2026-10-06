'use strict';
// Three immutable read-only observations, never a catalog snapshot or approval.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual: equal } = require('node:util');
const ORIGIN = 'https://gtlipifdfyugiwpxvuse.supabase.co';
const ROOT = '/Users/allan/.openclaw/workspace/coffee-roaster-crawler';
const STATE = ROOT + '/.state/my-coffee-explorer/2026-09-26';
const CURSOR = '012f129b-c7f3-44be-8264-0b9adb1b5c89';
const FIELDS = 'id,name,slug,name_slug,website_url,primary_location,google_place_id';
const TIMEOUT_MS = 20000, MAX_BYTES = 1048576;
const QUERIES = Object.freeze([
  Object.freeze({ id: 'q1', select: 'id', limit: 25 }),
  Object.freeze({ id: 'q2', select: FIELDS, limit: 25 }),
  Object.freeze({ id: 'q3', select: 'id', limit: 250 }),
]);
const PINS = Object.freeze({
  'snapshot-sequential-post10-v2/entities/page-0000.json': '14819e04d0aad42f62a026dfe23cb690926210408898edcea8f8a286b7fea925',
  'snapshot-sequential-post10-v2/requests.ndjson': '037f576e54a8a8c5bf4effe0c920076a5c4005e7dfa193598c9b99006a21ec33',
  'snapshot-sequential-post10-v2/failed.json': 'a57351ce5fc94fa7185eb53ae15a05a870e910715adbd3e2e1298da10335af01',
  'snapshot-sequential-v2.cjs': '34be0d78d2a7d93ec42a02cd3aa33f7e83ac835fe1475a89cd3a4e8512efe2fa',
});
const TOKEN = Symbol('verified-explicit-diagnostic-run');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SAFE_CODES = new Set(['request_timeout', 'response_too_large', 'http_failure', 'redirect_forbidden', 'response_origin_changed', 'non_json_response', 'invalid_json', 'invalid_rows', 'selected_fields_mismatch', 'invalid_id_order', 'invalid_field_value', 'content_range_mismatch', 'transport_latched_stop', 'concurrent_request_refused', 'fixed_query_order_required', 'request_out_of_scope', 'request_headers_out_of_scope', 'request_body_forbidden']);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function must(ok, code) { if (!ok) throw Object.assign(new Error(code), { code }); }
function safeError(e) {
  return { code: SAFE_CODES.has(e?.code) ? e.code : 'diagnostic_failure',
    ...(Number.isInteger(e?.http_status) && e.http_status >= 100 && e.http_status <= 599 ? { http_status: e.http_status } : {}),
    ...(typeof e?.db_code === 'string' && /^[A-Z0-9]{5,8}$/.test(e.db_code) ? { db_code: e.db_code } : {}) };
}
function readPins(base = __dirname, read = f => fs.readFileSync(f)) {
  const content = {};
  for (const [file, pin] of Object.entries(PINS)) {
    const bytes = read(path.join(base, file));
    must(sha(bytes) === pin, 'pinned_evidence_changed'); content[file] = bytes;
  }
  const first = JSON.parse(content[Object.keys(PINS)[0]]);
  must(first.page === 0 && first.cursor === CURSOR && first.rows?.length === 250 && first.rows.at(-1).id === CURSOR && first.terminal === false, 'cursor_evidence_mismatch');
  must(equal(first.request, { table: 'entities', select: FIELDS, orders: ['id'], limit: 250, cursor: null, offset: null, overlap: false }), 'original_query_mismatch');
  must(first.page_rows_sha256 === sha(JSON.stringify(first.rows)), 'page_rows_hash_mismatch');
  const events = content[Object.keys(PINS)[1]].toString().trim().split('\n').map(JSON.parse);
  must(events.length === 2 && events[0].table === 'entities' && events[0].rows === 250 && events[1].table === 'entities' && events[1].outcome === 'failure' && events[1].db_code === '57014', 'failure_evidence_mismatch');
  const failed = JSON.parse(content[Object.keys(PINS)[2]]);
  must(failed.status === 'failed' && failed.snapshotPublished === false, 'failed_snapshot_evidence_mismatch');
  return { inputHashes: PINS, cursor: CURSOR, originalSnapshotPublished: false };
}
function queryUrl(query) {
  const u = new URL(ORIGIN + '/rest/v1/entities');
  u.searchParams.set('select', query.select); u.searchParams.set('id', 'gt.' + CURSOR);
  u.searchParams.set('order', 'id.asc'); u.searchParams.set('limit', String(query.limit)); return u.href;
}
function validateRequest(query, input, init = {}) {
  must(QUERIES.some(q => equal(q, query)) && input === queryUrl(query) && init.method === 'GET' && init.redirect === 'error', 'request_out_of_scope');
  must(init.body === undefined || init.body === null, 'request_body_forbidden');
  const headers = new Headers(init.headers);
  must([...headers.keys()].sort().join(',') === 'accept,apikey,authorization' && headers.get('accept') === 'application/json', 'request_headers_out_of_scope');
  must(!!headers.get('apikey') && headers.get('authorization') === 'Bearer ' + headers.get('apikey'), 'request_headers_out_of_scope');
}
function validateRows(query, rows, range) {
  must(Array.isArray(rows) && rows.length <= query.limit, 'invalid_rows');
  const match = String(range || '').match(/^(?:(\d+)-(\d+)|\*)\/(\d+|\*)$/);
  must(match && (rows.length ? match[1] === '0' && Number(match[2]) === rows.length - 1 : match[1] === undefined), 'content_range_mismatch');
  if (rows.length && match[3] !== '*') must(Number(match[3]) >= rows.length, 'content_range_mismatch');
  const fields = query.select.split(',').sort(); let previous = CURSOR;
  for (const row of rows) {
    must(row && typeof row === 'object' && !Array.isArray(row) && equal(Object.keys(row).sort(), fields), 'selected_fields_mismatch');
    must(UUID.test(row.id || '') && row.id > previous, 'invalid_id_order'); previous = row.id;
    for (const field of fields.filter(f => f !== 'id')) must(row[field] === null || typeof row[field] === 'string', 'invalid_field_value');
  }
}
function createReader({ send, credential, token, timeoutMs = TIMEOUT_MS } = {}) {
  must(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= TIMEOUT_MS, 'invalid_deadline');
  if (!send) { must(token === TOKEN, 'explicit_verified_run_required'); send = globalThis.fetch.bind(globalThis); }
  must(typeof credential === 'string' && credential.length > 0 && !/[\r\n]/.test(credential), 'credential_required');
  let active = false, stopped = false, next = 0;
  return async function read(query) {
    must(!stopped, 'transport_latched_stop'); must(!active, 'concurrent_request_refused');
    must(next < 3 && equal(query, QUERIES[next]), 'fixed_query_order_required');
    active = true; next++;
    const controller = new AbortController(); let timer;
    const started = performance.now(), startedAt = new Date().toISOString();
    const url = queryUrl(query), init = { method: 'GET', redirect: 'error', headers: { Accept: 'application/json', apikey: credential, Authorization: 'Bearer ' + credential }, signal: controller.signal };
    try {
      validateRequest(query, url, init);
      const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error('request_timeout'), { code: 'request_timeout' })); }, timeoutMs); });
      return await Promise.race([deadline, (async () => {
        const response = await send(url, init);
        must(response && !response.redirected, 'redirect_forbidden');
        if (response.url) must(response.url === url, 'response_origin_changed');
        must((response.headers.get('content-type') || '').toLowerCase().includes('application/json'), 'non_json_response');
        const reader = response.body?.getReader(); must(reader, 'invalid_rows');
        const chunks = []; let bytes = 0;
        for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
          if (bytes > MAX_BYTES) { await reader.cancel(); throw Object.assign(new Error('response_too_large'), { code: 'response_too_large' }); }
          chunks.push(Buffer.from(part.value));
        }
        const body = Buffer.concat(chunks).toString('utf8'); let rows;
        try { rows = JSON.parse(body); } catch { throw Object.assign(new Error('invalid_json'), { code: 'invalid_json' }); }
        if (![200, 206].includes(response.status)) throw Object.assign(new Error('http_failure'), { code: 'http_failure', http_status: response.status, db_code: rows?.code });
        validateRows(query, rows, response.headers.get('content-range'));
        return { query, request_url: url, started_at: startedAt, finished_at: new Date().toISOString(), elapsed_ms: Math.round(performance.now() - started), status: response.status, body_bytes: bytes, body_sha256: sha(body), content_range: response.headers.get('content-range'), rows, row_count: rows.length };
      })()]);
    } catch (error) {
      stopped = true; controller.abort();
      const failure = safeError(error);
      throw Object.assign(new Error(failure.code), failure, { query_id: query.id, elapsed_ms: Math.round(performance.now() - started), started_at: startedAt, finished_at: new Date().toISOString() });
    } finally { clearTimeout(timer); active = false; }
  };
}
function syncDir(dir) { const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function exclusive(file, value) {
  const body = JSON.stringify(value, null, 2) + '\n', fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, body); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  syncDir(path.dirname(file)); return sha(body);
}
function append(file, value) { const fd = fs.openSync(file, 'a', 0o600); try { fs.writeSync(fd, JSON.stringify(value) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } syncDir(path.dirname(file)); }
async function runDiagnostic({ outputDir, proof, read }) {
  must(path.isAbsolute(outputDir) && !fs.existsSync(outputDir), 'new_output_directory_required');
  must(equal(proof?.inputHashes, PINS) && proof.cursor === CURSOR && proof.originalSnapshotPublished === false, 'evidence_proof_required');
  fs.mkdirSync(outputDir, { mode: 0o700 }); syncDir(path.dirname(outputDir));
  const common = { readOnly: true, catalogSnapshot: false, catalogCompletenessClaim: false, databasePlanningAllowed: false, databaseMutationAllowed: false, freshnessGateUnchanged: true };
  const helperSha = sha(fs.readFileSync(__filename)), resultRows = [], events = path.join(outputDir, 'requests.ndjson');
  exclusive(path.join(outputDir, 'reservation.json'), { at: new Date().toISOString(), pid: process.pid, helper_sha256: helperSha, ...common, proof, queries: QUERIES, concurrency: 1, maximumRequests: 3, timeoutMs: TIMEOUT_MS, maximumBodyBytes: MAX_BYTES, retries: 0, resumeAllowed: false });
  try {
    for (const query of QUERIES) {
      append(events, { at: new Date().toISOString(), query: query.id, event: 'started', request_url: queryUrl(query) });
      const result = await read(query);
      must(equal(result.query, query), 'reader_query_mismatch'); validateRows(query, result.rows, result.content_range);
      const digest = exclusive(path.join(outputDir, query.id + '.json'), result); resultRows.push(result);
      append(events, { at: new Date().toISOString(), query: query.id, event: 'complete', sha256: digest, elapsed_ms: result.elapsed_ms, row_count: result.rows.length });
    }
    const ids = resultRows.map(r => r.rows.map(x => x.id));
    const summary = { at: new Date().toISOString(), status: 'complete_observations_only', ...common, helper_sha256: helperSha, completedRequests: 3, comparisons: { q1_q2_same_ids: equal(ids[0], ids[1]), q1_q3_prefix_same_ids: equal(ids[0], ids[2].slice(0, ids[0].length)), observations: resultRows.map(r => ({ query: r.query, elapsed_ms: r.elapsed_ms, rows: r.row_count, body_bytes: r.body_bytes })) }, limitations: 'Sequential nontransactional observations only. Projection-group/cardinality comparisons do not isolate primary_location or prove query-plan, RLS, load, freshness, completeness or missing identity. No retry or follow-on scan authorized.' };
    exclusive(path.join(outputDir, 'result.json'), summary); return summary;
  } catch (error) {
    const failure = { at: new Date().toISOString(), status: 'stopped_first_error', ...common, completedRequests: resultRows.length, query_id: error.query_id || QUERIES[resultRows.length]?.id || null, ...safeError(error), ...(Number.isFinite(error.elapsed_ms) ? { elapsed_ms: error.elapsed_ms } : {}), retries: 0, remainingQueriesNotRequested: QUERIES.slice(resultRows.length + 1).map(q => q.id) };
    append(events, { ...failure, event: 'stopped' }); exclusive(path.join(outputDir, 'failed.json'), failure); throw error;
  }
}
function validateRuntime(base, output, env, cwd = process.cwd(), helperDir = __dirname) {
  must(cwd === ROOT && helperDir === ROOT + '/src/myCoffeeExplorerImport', 'production_location_required');
  must(base === STATE && path.dirname(output) === STATE && /^entity-query-shapes-[a-z0-9-]+$/.test(path.basename(output)), 'fixed_state_scope_required');
  must(env.NEXT_PUBLIC_SUPABASE_URL === ORIGIN || env.NEXT_PUBLIC_SUPABASE_URL === ORIGIN + '/', 'production_origin_required');
  must(typeof env.SUPABASE_SERVICE_ROLE_KEY === 'string' && env.SUPABASE_SERVICE_ROLE_KEY.length > 20 && !/[\r\n]/.test(env.SUPABASE_SERVICE_ROLE_KEY), 'runtime_credential_required');
}
async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv[0] === '--check') {
    must(argv.length <= 2, 'usage_check_optional_base'); const proof = readPins(argv[1] ? fs.realpathSync(argv[1]) : __dirname);
    const result = { mode: 'offline_check', queries: QUERIES, cursor: proof.cursor, maximumRequests: 3, timeoutMs: TIMEOUT_MS, maximumBodyBytes: MAX_BYTES, networkRequests: 0, catalogSnapshot: false, freshnessGateUnchanged: true };
    console.log(JSON.stringify(result)); return result;
  }
  must(argv.length === 3 && argv[0] === '--run', 'usage_run_BASE_NEW_OUTPUT');
  const base = fs.realpathSync(argv[1]), output = path.resolve(argv[2]);
  validateRuntime(base, output, process.env, fs.realpathSync(process.cwd()), fs.realpathSync(__dirname));
  const proof = readPins(base), lock = path.join(base, 'entity-query-shapes.lock');
  const fd = fs.openSync(lock, 'wx', 0o600), inode = fs.fstatSync(fd).ino;
  try {
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), scope: 'three_read_only_observations' })); fs.fsyncSync(fd); syncDir(base);
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';
    const read = createReader({ credential: process.env.SUPABASE_SERVICE_ROLE_KEY, token: TOKEN });
    console.log(JSON.stringify(await runDiagnostic({ outputDir: output, proof, read })));
  } finally {
    fs.closeSync(fd); if (fs.existsSync(lock) && fs.statSync(lock).ino === inode) { fs.unlinkSync(lock); syncDir(base); }
  }
}
module.exports = { ORIGIN, ROOT, STATE, CURSOR, FIELDS, TIMEOUT_MS, MAX_BYTES, QUERIES, PINS, sha, safeError, readPins, queryUrl, validateRequest, validateRows, createReader, runDiagnostic, validateRuntime, main };
if (require.main === module) main().catch(e => { console.error(JSON.stringify(safeError(e))); process.exitCode = 1; });
