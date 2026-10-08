'use strict';
// New, read-only snapshot format. V2 and all earlier evidence remain untouched.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const ORIGIN = 'https://gtlipifdfyugiwpxvuse.supabase.co';
const ROOT = '/Users/allan/.openclaw/workspace/coffee-roaster-crawler';
const STATE = ROOT + '/.state/my-coffee-explorer/2026-09-26';
const PAGE_SIZE = 250, ROLE_BATCH_SIZE = 250, MAX_ROWS = 100000, MAX_PAGES = 1000;
const MAX_ROLE_GROUP_ROWS = 5000, MAX_ROLE_REQUESTS = 5000;
const TIMEOUT_MS = 20000, MIN_SPACING_MS = 500, MAX_BODY_BYTES = 4 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CANONICAL_KEY = 'canonical_roaster_entity_id';
const TABLES = Object.freeze([
  { table: 'entities', key: 'entities', fields: 'id,name,slug,name_slug,website_url,primary_location,google_place_id', orders: ['id'] },
  { table: 'entity_roles', key: 'roles', fields: 'entity_id,role', orders: ['entity_id', 'role'] },
  { table: 'entity_locations', key: 'locations', fields: 'id,entity_id,label,address1,address2,city,region,postal_code,country,lat,lng,is_primary', orders: ['id'] },
  { table: 'entity_source_ids', key: 'sourceIds', fields: 'id,entity_id,source,source_id,source_url', orders: ['id'] },
  { table: 'entity_attributes', key: 'canonicalLinks', fields: 'id,entity_id,attribute_key,attribute_value,source', orders: ['id'] },
].map(Object.freeze));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function must(ok, code) { if (!ok) throw Object.assign(new Error(code), { code }); }
function diagnostic(e) {
  return { code: String(e?.code || 'snapshot_failure').replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 100),
    ...(Number.isInteger(e?.http_status) ? { http_status: e.http_status } : {}),
    ...(typeof e?.db_code === 'string' && /^[A-Z0-9]{1,16}$/.test(e.db_code) ? { db_code: e.db_code } : {}) };
}
function syncDir(dir) { const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function exclusive(file, value) {
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n'), fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  syncDir(path.dirname(file)); return sha(bytes);
}
function journal(file, value) {
  const fd = fs.openSync(file, 'a', 0o600);
  try { fs.writeSync(fd, JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); } syncDir(path.dirname(file));
}
function validateIds(ids) {
  must(Array.isArray(ids) && ids.length > 0 && ids.length <= ROLE_BATCH_SIZE, 'invalid_role_batch');
  ids.forEach((id, i) => must(UUID.test(id) && (!i || id > ids[i - 1]), 'invalid_role_batch_order'));
}
function rowKey(spec, row) {
  must(row && typeof row === 'object' && !Array.isArray(row), 'invalid_row');
  must(Object.keys(row).sort().join(',') === spec.fields.split(',').sort().join(','), 'selected_fields_mismatch');
  if (spec.key === 'roles') {
    must(UUID.test(row.entity_id || '') && typeof row.role === 'string' && /^[a-z][a-z0-9_]*$/.test(row.role), 'invalid_role_key');
    return row.entity_id + '\0' + row.role;
  }
  must(UUID.test(row.id || ''), 'invalid_uuid_cursor');
  if (spec.key !== 'entities') must(UUID.test(row.entity_id || ''), 'invalid_owner_uuid');
  if (spec.key === 'canonicalLinks') {
    must(row.attribute_key === CANONICAL_KEY, 'wrong_canonical_key');
    must(UUID.test(row.attribute_value || ''), 'invalid_canonical_target');
    must(row.source === null || typeof row.source === 'string', 'invalid_canonical_source');
  }
  return row.id;
}
function requestFor(spec, { cursor = null, count = 0, probe = false, entityIds = null } = {}) {
  const roles = spec.key === 'roles';
  if (roles) validateIds(entityIds);
  return { table: spec.table, select: spec.fields, orders: spec.orders, limit: PAGE_SIZE,
    cursor: roles ? null : cursor, offset: roles ? (probe ? count : Math.max(0, count - 1)) : null,
    entityIds: roles ? [...entityIds] : null, overlap: roles && count > 0 && !probe,
    ...(probe ? { probe: true } : {}), ...(spec.key === 'canonicalLinks' ? { attributeKey: CANONICAL_KEY } : {}) };
}
function buildQuery(db, request, signal) {
  let q = db.from(request.table).select(request.select);
  for (const col of request.orders) q = q.order(col, { ascending: true });
  if (request.cursor) q = q.gt('id', request.cursor);
  if (request.entityIds) q = q.in('entity_id', request.entityIds);
  if (request.attributeKey) q = q.eq('attribute_key', request.attributeKey);
  q = request.offset === null ? q.limit(request.limit) : q.range(request.offset, request.offset + request.limit - 1);
  return q.abortSignal(signal);
}
function readOnlyUrl(input, init = {}) {
  const u = new URL(typeof input === 'string' || input instanceof URL ? input : input?.url);
  must(u.origin === ORIGIN && !u.username && !u.password && !u.hash, 'wrong_database_origin');
  must((init.method || input?.method || 'GET').toUpperCase() === 'GET', 'read_only_get_required');
  must(init.body == null, 'request_body_forbidden');
  const spec = TABLES.find(s => u.pathname === '/rest/v1/' + s.table); must(spec, 'table_out_of_scope');
  const headers = new Headers(init.headers || input?.headers);
  for (const h of ['Prefer', 'Range', 'Content-Profile']) must(!headers.has(h), 'unexpected_request_header');
  must(!headers.get('Accept-Profile') || headers.get('Accept-Profile') === 'public', 'wrong_schema');
  const q = u.searchParams, roles = spec.key === 'roles';
  const allowed = new Set(['select', 'order', 'limit', ...(roles ? ['offset', 'entity_id'] : ['id']),
    ...(spec.key === 'canonicalLinks' ? ['attribute_key'] : [])]);
  for (const k of q.keys()) must(allowed.has(k) && q.getAll(k).length === 1, 'unexpected_query_parameter');
  must(q.get('select') === spec.fields, 'wrong_selected_fields');
  must(q.get('order') === spec.orders.map(s => s + '.asc').join(','), 'wrong_order');
  must(q.get('limit') === String(PAGE_SIZE), 'wrong_page_limit');
  if (roles) {
    // supabase-js emits in.(...), not in(...).
    const actual = /^in\.\(([^)]+)\)$/.exec(q.get('entity_id') || '');
    must(actual, 'role_batch_filter_required'); validateIds(actual[1].split(','));
    must(/^\d+$/.test(q.get('offset') || '') && Number(q.get('offset')) <= MAX_ROLE_GROUP_ROWS, 'invalid_role_offset');
  } else if (q.has('id')) must(q.get('id').startsWith('gt.') && UUID.test(q.get('id').slice(3)), 'invalid_uuid_filter');
  if (spec.key === 'canonicalLinks') must(q.get('attribute_key') === 'eq.' + CANONICAL_KEY, 'canonical_filter_required');
  return { url: u, spec, offset: roles ? Number(q.get('offset')) : 0 };
}
function validateRange(header, count, offset) {
  const m = typeof header === 'string' && /^(?:(\d+)-(\d+)|\*)\/(\d+|\*)$/.exec(header);
  must(m, 'missing_or_invalid_content_range');
  if (!count) { must(m[1] === undefined, 'empty_range_mismatch'); return; }
  must(m[1] !== undefined && Number(m[1]) === offset && Number(m[2]) - Number(m[1]) + 1 === count, 'body_range_mismatch');
  if (m[3] !== '*') must(Number(m[3]) >= Number(m[2]) + 1, 'range_total_mismatch');
}
function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(Object.assign(new Error('request_timeout_or_abort'), { code: 'request_timeout_or_abort' }));
    if (signal.aborted) { aborted(); return; }
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function guardedFetch(delegate, { onResponse = () => {}, now = Date.now, wait = sleep, timeoutMs = TIMEOUT_MS } = {}) {
  must(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= TIMEOUT_MS, 'invalid_timeout');
  let active = false, stopped = false, previousFinished = null;
  return async (input, init = {}) => {
    if (stopped) throw Object.assign(new Error('transport_latched_stop'), { code: 'transport_latched_stop' });
    if (active) { stopped = true; throw Object.assign(new Error('concurrent_request_refused'), { code: 'concurrent_request_refused' }); }
    active = true; let allowed, startedAt, timer, reader, controller;
    const upstreamAbort = () => controller?.abort();
    try {
      allowed = readOnlyUrl(input, init);
      if (previousFinished !== null) await wait(Math.max(0, MIN_SPACING_MS - (now() - previousFinished)));
      must(!stopped, 'transport_latched_stop');
      controller = new AbortController(); if (init.signal?.aborted) controller.abort();
      init.signal?.addEventListener('abort', upstreamAbort, { once: true });
      timer = setTimeout(() => controller.abort(), timeoutMs); startedAt = new Date().toISOString();
      must(!controller.signal.aborted, 'request_timeout_or_abort');
      const response = await abortable(delegate(input, { ...init, signal: controller.signal, redirect: 'error' }), controller.signal);
      must(!response.redirected, 'database_redirect_forbidden');
      if (response.url) must(new URL(response.url).origin === ORIGIN, 'response_origin_changed');
      reader = response.body?.getReader(); must(reader, 'missing_response_body');
      const ok = [200, 206].includes(response.status), chunks = []; let bytes = 0;
      for (;;) {
        const r = await abortable(reader.read(), controller.signal); if (r.done) break;
        bytes += r.value.byteLength; must(bytes <= (ok ? MAX_BODY_BYTES : 8192), 'page_body_too_large'); chunks.push(Buffer.from(r.value));
      }
      const body = Buffer.concat(chunks).toString('utf8');
      if (!ok) { let dbCode; try { dbCode = JSON.parse(body)?.code; } catch {} throw Object.assign(new Error('read_http_failure'), { code: 'read_http_failure', http_status: response.status, db_code: dbCode }); }
      must((response.headers.get('content-type') || '').toLowerCase().includes('application/json'), 'non_json_response');
      let rows; try { rows = JSON.parse(body); } catch { must(false, 'invalid_json_response'); }
      must(Array.isArray(rows) && rows.length <= PAGE_SIZE, 'invalid_page_shape'); validateRange(response.headers.get('content-range'), rows.length, allowed.offset);
      must(!stopped, 'transport_latched_stop');
      onResponse({ table: allowed.spec.table, startedAt, finishedAt: new Date().toISOString(), status: response.status, rows: rows.length,
        response_body_sha256: sha(body), content_range: response.headers.get('content-range') });
      return new Response(body, { status: response.status, headers: response.headers });
    } catch (e) {
      stopped = true; controller?.abort(); if (reader) void reader.cancel().catch(() => {});
      onResponse({ ...(allowed ? { table: allowed.spec.table } : {}), startedAt, finishedAt: new Date().toISOString(), outcome: 'failure', ...diagnostic(e) }); throw e;
    } finally { clearTimeout(timer); init.signal?.removeEventListener('abort', upstreamAbort); previousFinished = now(); active = false; }
  };
}
async function pageRequest(db, request) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const result = await buildQuery(db, request, controller.signal);
    if (!result || result.error || ![200, 206].includes(result.status)) throw Object.assign(new Error('database_page_error'), { code: 'database_page_error', http_status: result?.status, db_code: result?.error?.code });
    must(Array.isArray(result.data), 'database_page_not_array'); return result.data;
  } finally { clearTimeout(timer); }
}
async function collectTable(spec, fetchPage, { onPage = () => {}, maxRows = MAX_ROWS, maxPages = MAX_PAGES, entityIds = null } = {}) {
  must(Number.isSafeInteger(maxRows) && maxRows > 0 && maxRows <= MAX_ROWS, 'invalid_row_bound');
  must(Number.isSafeInteger(maxPages) && maxPages > 0 && maxPages <= MAX_PAGES, 'invalid_page_bound');
  const roles = spec.key === 'roles'; if (roles) validateIds(entityIds);
  const ownerSet = new Set(entityIds || []), rows = [], seen = new Set(), receipts = []; let cursor = null, previousKey = null, previousOwner = null, probe = false;
  for (let page = 0; page < maxPages; page++) {
    const request = requestFor(spec, { cursor, count: rows.length, probe, entityIds }), part = await fetchPage(request);
    must(Array.isArray(part) && part.length <= PAGE_SIZE, 'invalid_page_shape'); const keys = part.map(r => rowKey(spec, r));
    if (roles) {
      for (let i = 0; i < part.length; i++) must(ownerSet.has(part[i].entity_id) && (!i || part[i].entity_id >= part[i - 1].entity_id), 'role_owner_scope_or_order');
    } else for (let i = 1; i < keys.length; i++) must(keys[i] > keys[i - 1], 'page_not_strictly_ordered');
    let fresh = part, freshKeys = keys;
    if (request.overlap) { must(keys.length > 0 && keys[0] === previousKey, 'role_boundary_shift'); fresh = part.slice(1); freshKeys = keys.slice(1); }
    for (let i = 0; i < fresh.length; i++) {
      must(!seen.has(freshKeys[i]), 'duplicate_row');
      if (roles) must(previousOwner === null || fresh[i].entity_id >= previousOwner, 'role_owner_order_regressed');
      else must(previousKey === null || freshKeys[i] > previousKey, 'cursor_stalled_or_out_of_order');
      seen.add(freshKeys[i]); previousKey = freshKeys[i]; previousOwner = fresh[i].entity_id; rows.push(fresh[i]);
      must(rows.length <= maxRows && (!roles || rows.length <= MAX_ROLE_GROUP_ROWS), 'table_row_bound_exhausted');
    }
    if (!roles && fresh.length) cursor = fresh.at(-1).id;
    const boundaryOnly = request.overlap && fresh.length === 0; probe = boundaryOnly;
    const terminal = part.length === 0 && !request.overlap;
    const receipt = { page, request, returned_rows: part.length, new_rows: fresh.length, total_rows: rows.length, terminal,
      page_rows_sha256: sha(JSON.stringify(part)), rows: part };
    await onPage(receipt); receipts.push({ page, returned_rows: part.length, new_rows: fresh.length, terminal, page_rows_sha256: receipt.page_rows_sha256 });
    if (terminal) return { rows, method: { table: spec.table, fields: spec.fields, order: spec.orders,
      pagination: roles ? 'known_entity_batch_shallow_offset_overlap' : 'uuid_keyset', requests: page + 1,
      row_count: rows.length, terminal_empty_continuation: true, pages: receipts } };
  }
  throw Object.assign(new Error('table_page_bound_exhausted'), { code: 'table_page_bound_exhausted' });
}
function crossTableIntegrity(snapshot) {
  const ids = new Set(), roleKeys = new Set(), sourceKeys = new Set(), edge = new Map();
  for (const spec of TABLES) {
    must(Array.isArray(snapshot[spec.key]) && snapshot[spec.key].length <= MAX_ROWS, 'invalid_snapshot_table');
    const seen = new Set();
    for (const row of snapshot[spec.key]) { const key = rowKey(spec, row); must(!seen.has(key), 'duplicate_' + spec.key + '_key'); seen.add(key); }
  }
  for (const e of snapshot.entities) { must(!ids.has(e.id), 'duplicate_entity_id'); ids.add(e.id); }
  must(ids.size > 0, 'empty_entities_snapshot');
  for (const key of ['roles', 'locations', 'sourceIds', 'canonicalLinks']) for (const r of snapshot[key]) must(ids.has(r.entity_id), 'orphan_' + key + '_entity');
  for (const r of snapshot.roles) { const k = r.entity_id + '\0' + r.role; must(!roleKeys.has(k), 'duplicate_role_pair'); roleKeys.add(k); }
  for (const r of snapshot.sourceIds) {
    must(typeof r.source === 'string' && r.source && typeof r.source_id === 'string' && r.source_id, 'invalid_source_natural_key');
    const k = JSON.stringify([r.source, r.source_id]); must(!sourceKeys.has(k), 'duplicate_source_natural_key'); sourceKeys.add(k);
  }
  for (const r of snapshot.canonicalLinks) {
    rowKey(TABLES[4], r); must(ids.has(r.attribute_value), 'missing_canonical_target');
    if (edge.has(r.entity_id)) must(false, edge.get(r.entity_id) === r.attribute_value ? 'duplicate_canonical_link' : 'conflicting_canonical_target');
    edge.set(r.entity_id, r.attribute_value);
  }
  const done = new Set();
  for (const start of edge.keys()) {
    const chain = new Set(); let cursor = start;
    while (edge.has(cursor) && !done.has(cursor)) { must(!chain.has(cursor), 'canonical_cycle'); chain.add(cursor); cursor = edge.get(cursor); }
    for (const id of chain) done.add(id);
  }
  return { canonical_link_count: edge.size, canonical_targets_present: true, duplicate_conflict_cycle_checks: true };
}
async function runSnapshot({ db, outputDir, fetchPage = request => pageRequest(db, request) }) {
  must(typeof outputDir === 'string' && path.isAbsolute(outputDir), 'absolute_new_output_required');
  must(!fs.existsSync(outputDir), 'new_run_directory_required'); fs.mkdirSync(outputDir, { mode: 0o700 }); syncDir(path.dirname(outputDir));
  const startedAt = new Date().toISOString(), events = path.join(outputDir, 'progress.ndjson');
  exclusive(path.join(outputDir, 'reservation.json'), { version: 3, started_at: startedAt, pid: process.pid, helper_sha256: sha(fs.readFileSync(__filename)),
    database_origin: ORIGIN, readOnly: true, concurrency: 1, retries: 0, resumeAllowed: false, requestSpacingMs: MIN_SPACING_MS, timeoutMs: TIMEOUT_MS });
  try {
    const snapshot = {}, methods = [];
    for (const spec of TABLES) {
      const dir = path.join(outputDir, spec.table); fs.mkdirSync(dir, { mode: 0o700 }); syncDir(outputDir);
      journal(events, { event: 'table_started', table: spec.table });
      const groups = spec.key === 'roles' ? Array.from({ length: Math.ceil(snapshot.entities.length / ROLE_BATCH_SIZE) }, (_, i) => snapshot.entities.slice(i * ROLE_BATCH_SIZE, (i + 1) * ROLE_BATCH_SIZE).map(r => r.id)) : [null];
      const rows = [], groupMethods = []; let requests = 0;
      for (let group = 0; group < groups.length; group++) {
        const result = await collectTable(spec, async request => {
          must(++requests <= (spec.key === 'roles' ? MAX_ROLE_REQUESTS : MAX_PAGES), 'table_request_bound_exhausted'); return fetchPage(request);
        }, { entityIds: groups[group], onPage: receipt => {
          const file = `group-${String(group).padStart(4, '0')}-page-${String(receipt.page).padStart(4, '0')}.json`;
          const digest = exclusive(path.join(dir, file), receipt);
          journal(events, { event: 'page_complete', table: spec.table, group, file: spec.table + '/' + file, sha256: digest, rows: receipt.new_rows, terminal: receipt.terminal });
        } });
        rows.push(...result.rows); must(rows.length <= MAX_ROWS, 'table_row_bound_exhausted');
        groupMethods.push({ ...result.method, ...(groups[group] ? { entity_count: groups[group].length, entity_ids_sha256: sha(JSON.stringify(groups[group])) } : {}) });
      }
      const result = { rows, method: { table: spec.table, fields: spec.fields, requests, row_count: rows.length, groups: groupMethods,
        ...(spec.key === 'roles' ? { hydrated_entity_count: snapshot.entities.length, hydrated_entity_ids_sha256: sha(JSON.stringify(snapshot.entities.map(r => r.id))),
          coverage: 'Every exported entity UUID belongs to exactly one 250-ID-or-smaller batch. Every batch terminates with an explicit empty page. No deep/global OFFSET or inferred role enumeration.' } : {}) } };
      if (spec.key === 'entities') must(rows.length > 0, 'empty_entities_snapshot');
      const digest = exclusive(path.join(dir, 'result.json'), result);
      journal(events, { event: 'table_complete', table: spec.table, rows: rows.length, sha256: digest }); snapshot[spec.key] = rows;
      methods.push({ ...result.method, artifact: spec.table + '/result.json', artifact_sha256: digest });
    }
    const integrity = crossTableIntegrity(snapshot);
    const document = { at: new Date().toISOString(), ...snapshot, method: { name: 'sequential_bounded_keyset_snapshot_v3', started_at: startedAt, database_origin: ORIGIN,
      readOnly: true, complete: true, concurrency: 1, min_request_spacing_ms: MIN_SPACING_MS, timeout_ms: TIMEOUT_MS, retries: 0, headCounts: false, rpc: false,
      page_size: PAGE_SIZE, role_batch_size: ROLE_BATCH_SIZE, max_rows_per_table: MAX_ROWS, max_pages_per_uuid_table: MAX_PAGES,
      max_role_group_rows: MAX_ROLE_GROUP_ROWS, max_role_requests: MAX_ROLE_REQUESTS, counts: Object.fromEntries(TABLES.map(s => [s.key, snapshot[s.key].length])), tables: methods,
      cross_table_integrity_checked: true, ...integrity,
      role_order_validation: 'Database orders entity_id and role. UUID order, pair uniqueness and overlap boundaries are validated; no assumption about role text collation or enum rank.',
      consistency: 'Nontransactional sequential reads, not a point-in-time snapshot. Catalog identity writes must remain paused. New entities/roles inserted behind an earlier cursor can be missed; cross-table orphan checks cannot rule out all concurrent drift. Canonical links are exported, never automatically merged. Consumers must validate this run\'s complete.json, snapshot hash and five table receipts, and reject any failed marker.' } };
    const file = path.join(outputDir, 'snapshot.json'), digest = exclusive(file, document);
    journal(events, { event: 'snapshot_complete', sha256: digest, counts: document.method.counts });
    exclusive(path.join(outputDir, 'complete.json'), { version: 3, at: document.at, started_at: startedAt, status: 'complete', snapshot_file: 'snapshot.json', snapshot_sha256: digest, counts: document.method.counts, readOnly: true });
    loadCompleteSnapshot(outputDir); return { file, sha256: digest, counts: document.method.counts };
  } catch (e) {
    journal(events, { event: 'stopped_for_review', ...diagnostic(e) });
    exclusive(path.join(outputDir, 'failed.json'), { at: new Date().toISOString(), status: 'failed', ...diagnostic(e), snapshotPublished: fs.existsSync(path.join(outputDir, 'snapshot.json')),
      restart: 'No retries or resume. This failed run is not a fresh complete catalog. Inspect evidence; use a separately authorized new directory.' }); throw e;
  }
}
function loadCompleteSnapshot(dir) {
  must(!fs.existsSync(path.join(dir, 'failed.json')), 'failed_snapshot_not_fresh');
  const read = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const complete = read('complete.json'), reservation = read('reservation.json');
  must(complete.version === 3 && complete.status === 'complete' && complete.snapshot_file === 'snapshot.json', 'wrong_completion_marker');
  must(reservation.version === 3 && reservation.readOnly === true && reservation.database_origin === ORIGIN && complete.readOnly === true, 'wrong_reservation');
  const bytes = fs.readFileSync(path.join(dir, 'snapshot.json')); must(sha(bytes) === complete.snapshot_sha256, 'snapshot_hash_mismatch');
  const s = JSON.parse(bytes); must(s.method.name === 'sequential_bounded_keyset_snapshot_v3' && s.method.complete === true && s.method.readOnly === true && s.method.database_origin === ORIGIN && s.method.started_at === reservation.started_at && complete.started_at === reservation.started_at && s.at === complete.at, 'snapshot_run_mismatch');
  crossTableIntegrity(s);
  must(s.method.tables.length === TABLES.length, 'incomplete_table_set');
  TABLES.forEach((spec, i) => {
    const table = s.method.tables[i]; must(table.table === spec.table && table.artifact === spec.table + '/result.json', 'wrong_table_receipt');
    const raw = fs.readFileSync(path.join(dir, table.artifact)); must(sha(raw) === table.artifact_sha256, 'table_receipt_hash_mismatch');
    const result = JSON.parse(raw); must(JSON.stringify(result.rows) === JSON.stringify(s[spec.key]), 'table_rows_mismatch');
    const { artifact, artifact_sha256, ...copiedMethod } = table;
    must(JSON.stringify(result.method) === JSON.stringify(copiedMethod), 'table_method_mismatch');
    const groups = result.method.groups, roles = spec.key === 'roles';
    must(Array.isArray(groups) && groups.length === (roles ? Math.ceil(s.entities.length / ROLE_BATCH_SIZE) : 1), 'incomplete_group_coverage');
    let requests = 0, rows = 0;
    for (const [index, g] of groups.entries()) {
      must(g.table === spec.table && g.fields === spec.fields && Array.isArray(g.pages) && g.pages.length > 0 && g.pages.length <= MAX_PAGES && g.requests === g.pages.length, 'invalid_group_receipt');
      must(g.row_count === g.pages.reduce((n, p) => n + p.new_rows, 0), 'group_row_count_mismatch');
      requests += g.requests; rows += g.row_count;
      if (roles) {
        const batch = s.entities.slice(index * ROLE_BATCH_SIZE, (index + 1) * ROLE_BATCH_SIZE).map(r => r.id);
        must(g.entity_count === batch.length && g.entity_ids_sha256 === sha(JSON.stringify(batch)), 'role_group_coverage_mismatch');
        must(g.row_count <= MAX_ROLE_GROUP_ROWS, 'role_group_bound_exhausted');
      }
    }
    must(requests === result.method.requests && requests <= (roles ? MAX_ROLE_REQUESTS : MAX_PAGES) && rows === result.rows.length && rows === result.method.row_count, 'table_totals_mismatch');
    if (roles) must(result.method.hydrated_entity_count === s.entities.length && result.method.hydrated_entity_ids_sha256 === sha(JSON.stringify(s.entities.map(r => r.id))), 'role_coverage_mismatch');
    must(result.method.groups.every(g => g.terminal_empty_continuation && g.pages.at(-1)?.terminal && g.pages.at(-1)?.returned_rows === 0), 'missing_empty_completion');
    must(s[spec.key].length === s.method.counts[spec.key] && s[spec.key].length === complete.counts[spec.key], 'snapshot_counts_mismatch');
  });
  return s;
}
async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === '--check') {
    must(args.length <= 1, 'check_has_no_arguments'); console.log(JSON.stringify({ mode: 'offline_check', tables: TABLES, pageSize: PAGE_SIZE, roleBatchSize: ROLE_BATCH_SIZE,
      concurrency: 1, retries: 0, minRequestSpacingMs: MIN_SPACING_MS, timeoutMs: TIMEOUT_MS, networkRequests: 0, readiness: 'Requires root review before a separate explicit run; no automatic resume.' })); return;
  }
  must(args.length === 2 && args[0] === '--run', 'use_check_or_run_NEW_OUTPUT_DIRECTORY');
  must(fs.realpathSync(process.cwd()) === ROOT && fs.realpathSync(__dirname) === ROOT + '/src/myCoffeeExplorerImport', 'production_location_required');
  const output = path.resolve(args[1]); must(path.dirname(output) === STATE && /^snapshot-sequential-v3-[a-z0-9-]+$/.test(path.basename(output)), 'restricted_new_snapshot_directory');
  must(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').href === ORIGIN + '/', 'wrong_database_origin');
  must(typeof process.env.SUPABASE_SERVICE_ROLE_KEY === 'string' && process.env.SUPABASE_SERVICE_ROLE_KEY.length > 20, 'missing_runtime_credentials');
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';
  const lock = path.join(STATE, 'snapshot-sequential.lock'), fd = fs.openSync(lock, 'wx', 0o600), inode = fs.fstatSync(fd).ino;
  try {
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), scope: 'read_only_snapshot_v3' })); fs.fsyncSync(fd); syncDir(STATE);
    const { createClient } = require('@supabase/supabase-js');
    const transport = guardedFetch(globalThis.fetch.bind(globalThis), { onResponse: r => { if (fs.existsSync(output)) journal(path.join(output, 'requests.ndjson'), r); } });
    const db = createClient(ORIGIN, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: transport } });
    console.log(JSON.stringify(await runSnapshot({ db, outputDir: output })));
  } finally { fs.closeSync(fd); if (fs.existsSync(lock) && fs.statSync(lock).ino === inode) { fs.unlinkSync(lock); syncDir(STATE); } }
}
module.exports = { ORIGIN, TABLES, PAGE_SIZE, ROLE_BATCH_SIZE, MAX_ROWS, MAX_PAGES, MAX_ROLE_GROUP_ROWS, MAX_ROLE_REQUESTS, TIMEOUT_MS, MIN_SPACING_MS, MAX_BODY_BYTES,
  sha, diagnostic, rowKey, requestFor, buildQuery, readOnlyUrl, validateRange, guardedFetch, pageRequest, collectTable, crossTableIntegrity, runSnapshot, loadCompleteSnapshot };
if (require.main === module) main().catch(e => { console.error(JSON.stringify(diagnostic(e))); process.exitCode = 1; });
