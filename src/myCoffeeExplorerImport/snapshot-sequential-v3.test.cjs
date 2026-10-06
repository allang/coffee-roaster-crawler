'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict'), test = require('node:test'), { execFileSync } = require('node:child_process');
const { createClient } = require('@supabase/supabase-js');
const h = require('./snapshot-sequential-v3.cjs'), roots = [];
test.after(() => { for (const p of roots) fs.rmSync(p, { recursive: true, force: true }); });
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
function row(spec, n, extra = {}) {
  return Object.assign(Object.fromEntries(spec.fields.split(',').map(k => [k,
    ['id', 'entity_id'].includes(k) ? uuid(n) : k === 'role' ? 'roaster' : k === 'source' ? 'fixture' :
      k === 'source_id' ? 'source-' + n : k === 'attribute_key' ? 'canonical_roaster_entity_id' : k === 'attribute_value' ? uuid(2) : null])), extra);
}
function outputDir() { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'mce-snapshot-v3-test-')); roots.push(p); return path.join(p, 'capture'); }
function dataSet() {
  return { entities: [row(h.TABLES[0], 1), row(h.TABLES[0], 2)], entity_roles: [row(h.TABLES[1], 1)],
    entity_locations: [row(h.TABLES[2], 1)], entity_source_ids: [row(h.TABLES[3], 1)], entity_attributes: [row(h.TABLES[4], 1)] };
}
function source(data, calls = [], cap = 250) {
  let active = 0, max = 0;
  return { get max() { return max; }, fetch: async r => {
    calls.push(r); max = Math.max(max, ++active); await Promise.resolve();
    let a = data[r.table] || [];
    if (r.entityIds) a = a.filter(x => r.entityIds.includes(x.entity_id));
    if (r.cursor) a = a.filter(x => x.id > r.cursor);
    const answer = a.slice(r.offset || 0, (r.offset || 0) + Math.min(r.limit, cap)); active--; return answer;
  } };
}
function url(spec, state = {}) {
  const client = createClient(h.ORIGIN, 'offline', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: () => { throw Error('unexpected network'); } } });
  return h.buildQuery(client, h.requestFor(spec, spec.key === 'roles' ? { entityIds: [uuid(1)], ...state } : state), new AbortController().signal).url.href;
}
function response(rows, { status = 200, offset = 0, range, contentType = 'application/json' } = {}) {
  return new Response(JSON.stringify(rows), { status, headers: { 'content-type': contentType,
    'content-range': range ?? (rows.length ? `${offset}-${offset + rows.length - 1}/*` : '*/*') } });
}
function clock() { let t = 0; const waits = []; return { now: () => t, wait: async n => { waits.push(n); t += n; }, waits }; }

test('offline CLI default/check performs no collection and run is blocked outside production', () => {
  for (const args of [[], ['--check']]) {
    const r = JSON.parse(execFileSync(process.execPath, [require.resolve('./snapshot-sequential-v3.cjs'), ...args], { encoding: 'utf8' }));
    assert.equal(r.networkRequests, 0); assert.equal(r.timeoutMs, 20000); assert.equal(r.minRequestSpacingMs, 500);
  }
  assert.throws(() => execFileSync(process.execPath, [require.resolve('./snapshot-sequential-v3.cjs'), '--run', outputDir()], { stdio: 'pipe' }), e => e.stderr.toString().includes('production_location_required'));
});
test('five exact descriptors preserve four old selections and add only canonical attributes', () => {
  const v2 = require('./snapshot-sequential-v2.cjs'); assert.equal(h.TABLES.length, 5);
  for (let i = 0; i < 4; i++) assert.equal(h.TABLES[i].fields, v2.TABLES[i].fields);
  assert.equal(h.TABLES[4].fields, 'id,entity_id,attribute_key,attribute_value,source');
  const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260301120000_add_cafe_ingestion_tables.sql'), 'utf8');
  assert.match(migration, /entity_attributes\s*\(\s*id uuid primary key/);
  assert.equal(h.ROLE_BATCH_SIZE, 250); assert.equal(h.TIMEOUT_MS, 20000);
});
test('actual SDK query builder uses known-UUID hydration and exact canonical filter', () => {
  const ru = new URL(url(h.TABLES[1], { entityIds: [uuid(1), uuid(2)], count: 251 }));
  assert.equal(ru.searchParams.get('entity_id'), `in.(${uuid(1)},${uuid(2)})`);
  assert.equal(ru.searchParams.get('offset'), '250'); assert.equal(ru.searchParams.get('order'), 'entity_id.asc,role.asc');
  h.readOnlyUrl(ru); const cu = new URL(url(h.TABLES[4], { cursor: uuid(4) }));
  assert.equal(cu.searchParams.get('attribute_key'), 'eq.canonical_roaster_entity_id'); assert.equal(cu.searchParams.get('id'), 'gt.' + uuid(4)); h.readOnlyUrl(cu);
});
test('wrong table/origin/columns/filter/order/HEAD/mutation/count is refused before dispatch', async () => {
  const good = url(h.TABLES[0]); const canonical = url(h.TABLES[4]), roles = url(h.TABLES[1]);
  for (const [u, init] of [[good.replace(h.ORIGIN, 'https://other.supabase.co'), {}], [good.replace('/entities?', '/rpc/x?'), {}],
    [good + '&or=x', {}], [good.replace('limit=250', 'limit=251'), {}], [good.replace('id.asc', 'id.desc'), {}],
    [good, { method: 'POST' }], [good, { method: 'HEAD' }], [good, { body: '{}' }], [good, { headers: { Prefer: 'count=exact' } }],
    [canonical.replace('eq.canonical_roaster_entity_id', 'eq.other'), {}], [canonical.replace('&attribute_key=eq.canonical_roaster_entity_id', ''), {}],
    [roles.replace('offset=0', 'offset=5001'), {}], [roles.replace('entity_id=in.', 'entity_id=eq.'), {}]]) {
    let calls = 0; const f = h.guardedFetch(async () => { calls++; return response([]); });
    await assert.rejects(f(u, init)); await assert.rejects(f(good), /latched/); assert.equal(calls, 0);
  }
});
test('UUID pages250/500 and short capped pages require final empty continuation', async () => {
  for (const [n, cap] of [[250, 250], [500, 250], [17, 6]]) {
    const calls = [], s = source({ entities: Array.from({ length: n }, (_, i) => row(h.TABLES[0], i + 1)) }, calls, cap);
    const r = await h.collectTable(h.TABLES[0], s.fetch); assert.equal(r.rows.length, n);
    assert.equal(calls.length, Math.ceil(n / cap) + 1); assert.equal(r.method.pages.at(-1).returned_rows, 0);
  }
});
test('canonical collection always sends exact filter and stops only at explicit empty', async () => {
  const calls = [], s = source({ entity_attributes: [row(h.TABLES[4], 1)] }, calls);
  await h.collectTable(h.TABLES[4], s.fetch); assert.equal(calls.length, 2); assert(calls.every(r => r.attributeKey === 'canonical_roaster_entity_id'));
});
test('null/malformed/oversized pages and wrong UUID order stop without truncation', async () => {
  const s = h.TABLES[0];
  for (const part of [null, {}, [row(s, 2), row(s, 1)], [row(s, 1), row(s, 1)], [row(s, 1, { id: 'bad' })], [row(s, 1, { extra: 1 })], Array.from({ length: 251 }, (_, i) => row(s, i))])
    await assert.rejects(h.collectTable(s, async () => part));
  await assert.rejects(h.collectTable(s, async () => [row(s, 1)], { maxPages: 1 }), /page_bound/);
  await assert.rejects(h.collectTable(s, async r => [row(s, r.cursor ? 2 : 1)], { maxRows: 1 }), /row_bound/);
});
test('role order is database-defined, without assuming enum/lexical rank', async () => {
  const spec = h.TABLES[1], rows = [row(spec, 1, { role: 'roaster' }), row(spec, 1, { role: 'cafe' }), row(spec, 2, { role: 'cafe' })];
  for (const cap of [1, 2, 250]) {
    const calls = [], s = source({ entity_roles: rows }, calls, cap);
    const r = await h.collectTable(spec, s.fetch, { entityIds: [uuid(1), uuid(2)] }); assert.deepEqual(r.rows, rows);
    assert(r.method.terminal_empty_continuation); assert(calls.every(c => c.entityIds.length === 2));
    assert.equal(r.method.pages.at(-1).returned_rows, 0);
  }
});
test('role boundary-only response is not completion; next-offset empty proof is required', async () => {
  const calls = [], s = source({ entity_roles: [row(h.TABLES[1], 1)] }, calls);
  const r = await h.collectTable(h.TABLES[1], s.fetch, { entityIds: [uuid(1)] });
  assert.deepEqual(calls.map(r => r.offset), [0, 0, 1]); assert.equal(r.method.pages[1].terminal, false); assert.equal(r.method.pages[2].terminal, true);
});
test('role foreign owner, shifted boundary, duplicate pair and stalled probes fail closed', async () => {
  const spec = h.TABLES[1], a = row(spec, 1), b = row(spec, 2);
  for (const pages of [[[b]], [[a], []], [[a], [b]], [[a, a]], [[a], [a], [a]]]) {
    let i = 0; await assert.rejects(h.collectTable(spec, async () => pages[i++] || [], { entityIds: [uuid(1)] }));
  }
});
test('roles hydrate all251 exported owners in two disjoint batches with explicit EOF', async () => {
  const d = dataSet(); d.entities = Array.from({ length: 251 }, (_, i) => row(h.TABLES[0], i + 1));
  d.entity_roles = [row(h.TABLES[1], 1), row(h.TABLES[1], 250), row(h.TABLES[1], 251)];
  const calls = [], s = source(d, calls), out = outputDir(); const result = await h.runSnapshot({ outputDir: out, fetchPage: s.fetch });
  assert.equal(s.max, 1); const snap = h.loadCompleteSnapshot(out), method = snap.method.tables[1];
  assert.equal(method.hydrated_entity_count, 251); assert.equal(method.groups.length, 2); assert.deepEqual(method.groups.map(g => g.entity_count), [250, 1]);
  assert(calls.filter(r => r.table === 'entity_roles').every(r => r.entityIds.length <= 250 && r.offset <= 5000));
  assert.equal(result.counts.canonicalLinks, 1); assert.equal(result.counts.roles, 3); assert(snap.method.consistency.includes('Nontransactional'));
});
test('zero-role owners still receive hydration and an explicit empty result', async () => {
  const d = dataSet(); d.entity_roles = []; const calls = [], s = source(d, calls), out = outputDir();
  await h.runSnapshot({ outputDir: out, fetchPage: s.fetch }); const requests = calls.filter(r => r.table === 'entity_roles');
  assert.equal(requests.length, 1); assert.deepEqual(requests[0].entityIds, [uuid(1), uuid(2)]);
});
test('one sequential five-table capture publishes hashes, actual counts and canonical edges', async () => {
  const d = dataSet(), s = source(d), out = outputDir(), r = await h.runSnapshot({ outputDir: out, fetchPage: s.fetch });
  const snap = h.loadCompleteSnapshot(out); assert.equal(s.max, 1); assert.equal(h.sha(fs.readFileSync(r.file)), r.sha256);
  for (const spec of h.TABLES) assert.deepEqual(snap[spec.key], d[spec.table]);
  assert.equal(snap.method.canonical_link_count, 1); assert.equal(snap.method.tables.length, 5);
});
test('later-table failure publishes no complete snapshot and never reads later tables', async () => {
  const out = outputDir(), calls = [], s = source(dataSet());
  await assert.rejects(h.runSnapshot({ outputDir: out, fetchPage: r => {
    calls.push(r.table); if (r.table === 'entity_locations') throw Object.assign(Error('stop'), { code: '57014' }); return s.fetch(r);
  } }), /stop/);
  assert(!calls.includes('entity_source_ids')); assert(!fs.existsSync(path.join(out, 'snapshot.json'))); assert(fs.existsSync(path.join(out, 'failed.json')));
  assert.throws(() => h.loadCompleteSnapshot(out), /failed_snapshot/);
});
test('partial/complete run directories cannot resume or overwrite', async () => {
  const out = outputDir(); await h.runSnapshot({ outputDir: out, fetchPage: source(dataSet()).fetch }); let calls = 0;
  await assert.rejects(h.runSnapshot({ outputDir: out, fetchPage: async () => { calls++; return []; } }), /new_run/); assert.equal(calls, 0);
});
function snapshot() { const d = dataSet(); return Object.fromEntries(h.TABLES.map(s => [s.key, d[s.table]])); }
test('canonical cycles, self-links, unknown owners/targets, duplicate/conflicting edges fail', () => {
  for (const links of [[row(h.TABLES[4], 1, { attribute_value: uuid(1) })],
    [row(h.TABLES[4], 1), row(h.TABLES[4], 2, { attribute_value: uuid(1) })],
    [row(h.TABLES[4], 1, { attribute_value: uuid(3) })], [row(h.TABLES[4], 3)],
    [row(h.TABLES[4], 1), row(h.TABLES[4], 3, { entity_id: uuid(1) })],
    [row(h.TABLES[4], 1), row(h.TABLES[4], 3, { entity_id: uuid(1), attribute_value: uuid(1) })]]) {
    const s = snapshot(); s.canonicalLinks = links; assert.throws(() => h.crossTableIntegrity(s), /canonical|orphan/);
  }
});
test('canonical chains preserve raw edges without automatically merging identities', () => {
  const s = snapshot(); s.entities.push(row(h.TABLES[0], 3)); s.canonicalLinks.push(row(h.TABLES[4], 2, { attribute_value: uuid(3) }));
  assert.equal(h.crossTableIntegrity(s).canonical_link_count, 2); assert.equal(s.entities.length, 3); assert.equal(s.canonicalLinks[0].attribute_value, uuid(2));
});
test('orphan children, duplicate sources and invalid canonical selected fields refuse publication', async () => {
  for (const index of [1, 2, 3, 4]) {
    const d = dataSet(); d[h.TABLES[index].table] = [row(h.TABLES[index], 3)];
    if (index === 1) { assert.throws(() => h.crossTableIntegrity({ ...snapshot(), roles: d.entity_roles }), /orphan/); continue; }
    const out = outputDir(); await assert.rejects(h.runSnapshot({ outputDir: out, fetchPage: source(d).fetch }), /orphan/); assert(!fs.existsSync(path.join(out, 'complete.json')));
  }
  const s = snapshot(); s.sourceIds.push({ ...s.sourceIds[0], id: uuid(2) }); assert.throws(() => h.crossTableIntegrity(s), /duplicate_source/);
  assert.throws(() => h.rowKey(h.TABLES[4], row(h.TABLES[4], 1, { attribute_key: 'other' })), /wrong_canonical/);
});
test('loader rejects absent completion, failed marker, tampered snapshot/table or old format', async () => {
  for (const mutation of ['complete', 'failed', 'snapshot', 'table', 'v2']) {
    const out = outputDir(); await h.runSnapshot({ outputDir: out, fetchPage: source(dataSet()).fetch });
    if (mutation === 'complete') fs.unlinkSync(path.join(out, 'complete.json'));
    if (mutation === 'failed') fs.writeFileSync(path.join(out, 'failed.json'), '{}');
    if (mutation === 'snapshot') fs.appendFileSync(path.join(out, 'snapshot.json'), ' ');
    if (mutation === 'table') fs.appendFileSync(path.join(out, 'entity_roles/result.json'), ' ');
    if (mutation === 'v2') { const p = path.join(out, 'complete.json'), j = JSON.parse(fs.readFileSync(p)); j.version = 2; fs.writeFileSync(p, JSON.stringify(j)); }
    assert.throws(() => h.loadCompleteSnapshot(out));
  }
});
test('loader refuses missing or substituted role coverage even with internally updated hashes', async () => {
  for (const mutate of [m => { m.groups = []; }, m => { m.groups[0].entity_ids_sha256 = 'wrong'; },
    m => { m.hydrated_entity_count--; }, m => { m.groups[0].row_count++; }]) {
    const out = outputDir(); await h.runSnapshot({ outputDir: out, fetchPage: source(dataSet()).fetch });
    const tablePath = path.join(out, 'entity_roles/result.json'), result = JSON.parse(fs.readFileSync(tablePath)); mutate(result.method);
    fs.writeFileSync(tablePath, JSON.stringify(result));
    const snapPath = path.join(out, 'snapshot.json'), snap = JSON.parse(fs.readFileSync(snapPath));
    snap.method.tables[1] = { ...result.method, artifact: 'entity_roles/result.json', artifact_sha256: h.sha(fs.readFileSync(tablePath)) };
    fs.writeFileSync(snapPath, JSON.stringify(snap));
    const completePath = path.join(out, 'complete.json'), complete = JSON.parse(fs.readFileSync(completePath));
    complete.snapshot_sha256 = h.sha(fs.readFileSync(snapPath)); fs.writeFileSync(completePath, JSON.stringify(complete));
    assert.throws(() => h.loadCompleteSnapshot(out), /coverage|row_count/);
  }
});
test('empty entity export fails before reading any child table', async () => {
  const calls = [], out = outputDir(); await assert.rejects(h.runSnapshot({ outputDir: out, fetchPage: async r => { calls.push(r.table); return []; } }), /empty_entities/);
  assert.deepEqual(calls, ['entities']); assert(!fs.existsSync(path.join(out, 'complete.json')));
});
test('cross-table validation checks selected fields and primary keys on all loaded tables', () => {
  for (const spec of h.TABLES) {
    const duplicate = snapshot(); duplicate[spec.key].push({ ...duplicate[spec.key][0] });
    assert.throws(() => h.crossTableIntegrity(duplicate), /duplicate/);
    const malformed = snapshot(); malformed[spec.key][0].extra = true;
    assert.throws(() => h.crossTableIntegrity(malformed), /selected_fields/);
  }
});
test('transport paces ALL table requests500ms after previous body completion', async () => {
  const c = clock(), starts = [], f = h.guardedFetch(async () => { starts.push(c.now()); return response([]); }, c);
  for (const spec of h.TABLES) await f(url(spec)); assert.deepEqual(starts, [0, 500, 1000, 1500, 2000]); assert.deepEqual(c.waits, [500, 500, 500, 500]);
});
test('HTTP failure stops permanently, retaining only safe status/code rather than credentials', async () => {
  let calls = 0; const events = [], c = clock();
  const f = h.guardedFetch(async () => { calls++; return response({ code: '57014', message: 'secret token' }, { status: 500 }); }, { ...c, onResponse: e => events.push(e) });
  await assert.rejects(f(url(h.TABLES[0]), { headers: { apikey: 'never-log' } }), e => e.db_code === '57014');
  await assert.rejects(f(url(h.TABLES[0])), /latched/); assert.equal(calls, 1); assert(!/secret|never-log/.test(JSON.stringify(events)));
});
test('transport forbids overlapping requests and does not dispatch a second GET', async () => {
  let release, calls = 0; const pending = new Promise(r => { release = r; });
  const f = h.guardedFetch(async () => { calls++; await pending; return response([]); });
  const a = f(url(h.TABLES[0])); await assert.rejects(f(url(h.TABLES[0])), /concurrent/); release(); await assert.rejects(a, /latched/); assert.equal(calls, 1);
});
test('body-inclusive deadline terminates a stalled body and forbids retries', async () => {
  let calls = 0; const f = h.guardedFetch(async () => { calls++; return new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'application/json' } }); }, { timeoutMs: 5 });
  await assert.rejects(f(url(h.TABLES[0])), /timeout/); await assert.rejects(f(url(h.TABLES[0])), /latched/); assert.equal(calls, 1);
});
test('deadline also terminates a delegate that never returns headers', async () => {
  const f = h.guardedFetch(() => new Promise(() => {}), { timeoutMs: 5 }); await assert.rejects(f(url(h.TABLES[0])), /timeout/);
});
test('redirects, nonJSON, wrong range and oversized stream are refused', async () => {
  const redirected = response([]); Object.defineProperty(redirected, 'redirected', { value: true });
  const wrongOrigin = response([]); Object.defineProperty(wrongOrigin, 'url', { value: 'https://elsewhere.example/' });
  const huge = new Response('x'.repeat(h.MAX_BODY_BYTES + 1), { headers: { 'content-type': 'application/json' } });
  for (const r of [redirected, wrongOrigin, response([], { contentType: 'text/html' }), response([{}], { range: '0-5/*' }), huge])
    await assert.rejects(h.guardedFetch(async () => r)(url(h.TABLES[0])));
});
test('journal failure latches transport and cannot cause a retry', async () => {
  let calls = 0; const f = h.guardedFetch(async () => { calls++; return response([]); }, { onResponse: () => { throw Error('disk failure'); } });
  await assert.rejects(f(url(h.TABLES[0])), /disk failure/); await assert.rejects(f(url(h.TABLES[0])), /latched/); assert.equal(calls, 1);
});
test('pre-aborted request dispatches zero GETs', async () => {
  let calls = 0; const f = h.guardedFetch(async () => { calls++; return response([]); }); await assert.rejects(f(url(h.TABLES[0]), { signal: AbortSignal.abort() })); assert.equal(calls, 0);
});
