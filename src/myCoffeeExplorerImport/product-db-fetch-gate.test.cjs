'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const { ORIGIN, createDatabaseFetchGate } = require('./product-db-fetch-gate.cjs');
const url = ORIGIN + '/rest/v1/entities?id=eq.fixture';
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
function fixture(delegate = async () => json([]), options = {}) {
  let clock = 0; const starts = [], events = [], stops = [];
  const gate = createDatabaseFetchGate(async (request, init) => { starts.push(clock); return delegate(request, init); },
    { now: () => clock, wait: async ms => { clock += ms; }, onEvent: e => events.push(e), onStop: e => stops.push(e), ...options });
  return { gate, starts, events, stops, advance: ms => { clock += ms; } };
}
test('five concurrent ownership reads dispatch serially with 500ms gaps', async () => {
  let active = 0, peak = 0;
  const f = fixture(async () => { active++; peak = Math.max(peak, active); await Promise.resolve(); active--; return json([]); });
  await Promise.all(Array.from({ length: 5 }, () => f.gate.fetch(url)));
  assert.equal(peak, 1); assert.deepEqual(f.starts, [0, 500, 1000, 1500, 2000]); assert.equal(f.gate.state().requests, 5);
});
test('queue waits for body completion, not only headers', async () => {
  let end; const body = new ReadableStream({ start(c) { end = () => { c.enqueue(new TextEncoder().encode('[]')); c.close(); }; } });
  let n = 0; const f = fixture(async () => ++n === 1 ? new Response(body) : json([]));
  const first = f.gate.fetch(url), second = f.gate.fetch(url);
  await new Promise(setImmediate); assert.equal(n, 1); f.advance(125); end();
  await Promise.all([first, second]); assert.deepEqual(f.starts, [0, 625]);
});
for (const [status, code] of [[429, null], [500, null], [503, null], [504, null], [400, '57014'], [400, '53300']]) {
  test(`HTTP ${status} / ${code} trips gate and refuses all queued requests`, async () => {
    const f = fixture(async () => json({ code }, status));
    const results = await Promise.allSettled([f.gate.fetch(url), f.gate.fetch(url), f.gate.fetch(url)]);
    assert.equal(results[0].value.status, status); assert.equal(results[1].status, 'rejected'); assert.equal(results[2].status, 'rejected');
    assert.equal(f.starts.length, 1); assert.equal(f.stops.length, 1); assert.equal(f.gate.state().queued, 0);
    await assert.rejects(f.gate.fetch(url), /database_gate_stopped/);
  });
}
test('network error latches without retrying a mutation', async () => {
  const f = fixture(async () => { throw Error('network disconnected'); });
  const results = await Promise.allSettled([f.gate.fetch(url, { method: 'POST', body: '{}' }), f.gate.fetch(url)]);
  assert.equal(results[0].status, 'rejected'); assert.equal(results[1].status, 'rejected'); assert.equal(f.starts.length, 1);
});
test('body-inclusive timeout cancels stalled response and prevents next dispatch', async () => {
  let cancelled = false;
  const f = fixture(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })), { timeoutMs: 10 });
  const results = await Promise.allSettled([f.gate.fetch(url), f.gate.fetch(url)]);
  assert.match(results[0].reason.code, /timeout_or_abort/); assert.equal(f.starts.length, 1); assert.equal(cancelled, true);
});
test('headers timeout is bounded even when delegate ignores its abort signal', async () => {
  const f = fixture(() => new Promise(() => {}), { timeoutMs: 10 });
  await assert.rejects(f.gate.fetch(url), /timeout_or_abort/); assert.equal(f.starts.length, 1);
});
test('expected 406 single lookup is unchanged and does not stop later work', async () => {
  let n = 0; const value = { code: 'PGRST116', details: 'The result contains 0 rows' };
  const f = fixture(async () => ++n === 1 ? json(value, 406) : json([{ id: 'one' }]));
  const first = await f.gate.fetch(url); assert.equal(first.status, 406); assert.deepEqual(await first.json(), value);
  assert.deepEqual(await (await f.gate.fetch(url)).json(), [{ id: 'one' }]); assert.equal(f.gate.state().stopped, null);
});
test('optional-table 404 remains an error response for existing caller policy', async () => {
  const f = fixture(async () => json({ code: 'PGRST205' }, 404)); const r = await f.gate.fetch(ORIGIN + '/rest/v1/entity_crawl_state');
  assert.equal(r.status, 404); assert.equal((await r.json()).code, 'PGRST205'); assert.equal(f.gate.state().stopped, null);
});
test('nontransient validation error is preserved, not retried or converted to success', async () => {
  const f = fixture(async () => json({ code: '23505' }, 409)); const r = await f.gate.fetch(url, { method: 'POST', body: '{}' });
  assert.equal(r.status, 409); assert.equal((await r.json()).code, '23505'); assert.equal(f.starts.length, 1);
});
test('only pinned production origin is permitted', async () => {
  for (const u of ['https://other.supabase.co/rest/v1/entities', 'http://gtlipifdfyugiwpxvuse.supabase.co/rest/v1/entities', ORIGIN + ':444/rest/v1/entities']) {
    const f = fixture(); await assert.rejects(f.gate.fetch(u), /origin_forbidden/); assert.equal(f.starts.length, 0);
  }
});
test('delegate receives error redirect mode and no origin-changing response is accepted', async () => {
  const f = fixture(async (_, init) => { assert.equal(init.redirect, 'error'); const r = json([]); Object.defineProperty(r, 'url', { value: 'https://other.example/' }); return r; });
  await assert.rejects(f.gate.fetch(url), /response_origin_changed/); assert.equal(f.gate.state().stopped.code, 'database_transport_failure');
});
test('normal mutation body, auth headers and response remain unchanged', async () => {
  const f = fixture(async request => { assert.equal(request.method, 'PATCH'); assert.equal(request.headers.get('authorization'), 'Bearer fixture'); assert.deepEqual(await request.json(), { name: 'coffee' }); return json([{ id: 'p' }], 201); });
  const r = await f.gate.fetch(url, { method: 'PATCH', headers: { authorization: 'Bearer fixture' }, body: JSON.stringify({ name: 'coffee' }) });
  assert.equal(r.status, 201); assert.deepEqual(await r.json(), [{ id: 'p' }]); assert(!JSON.stringify(f.events).includes('Bearer'));
});
test('empty 204 mutation response is valid', async () => {
  const f = fixture(async () => new Response(null, { status: 204 })); const r = await f.gate.fetch(url, { method: 'DELETE' }); assert.equal(r.status, 204); assert.equal(await r.text(), '');
});
test('oversized body cancels and latches', async () => {
  const f = fixture(async () => new Response('too large'), { maxBodyBytes: 2 }); await assert.rejects(f.gate.fetch(url), /too_large/); assert(f.gate.state().stopped);
});
test('already aborted caller sends zero network requests', async () => {
  const f = fixture(), c = new AbortController(); c.abort(); await assert.rejects(f.gate.fetch(url, { signal: c.signal }), /timeout_or_abort/); assert.equal(f.starts.length, 0);
});
test('audit failure stops queued requests before dispatch', async () => {
  const f = fixture(undefined, { onEvent: () => { throw Error('disk failed'); } }); const result = await Promise.allSettled([f.gate.fetch(url), f.gate.fetch(url)]);
  assert(result.every(r => r.status === 'rejected')); assert.equal(f.starts.length, 0);
});
test('queued work preserves independent async owner context', async () => {
  const context = new AsyncLocalStorage(), seen = [], f = fixture(async () => { seen.push(context.getStore()); return json([]); });
  await Promise.all(['owner-a', 'owner-b'].map(owner => context.run(owner, () => f.gate.fetch(url)))); assert.deepEqual(seen, ['owner-a', 'owner-b']);
});
test('existing delegate legal refusal remains fail closed with no retries', async () => {
  let calls = 0; const f = fixture(async () => { calls++; throw Object.assign(Error('legal guard'), { code: 'ECLEGALBLOCK' }); });
  await assert.rejects(f.gate.fetch(url), e => e.code === 'ECLEGALBLOCK'); await assert.rejects(f.gate.fetch(url), /database_gate_stopped/); assert.equal(calls, 1);
});
test('explicit stop drains queued work without changing global fetch', async () => {
  const original = globalThis.fetch, f = fixture(); const p = f.gate.fetch(url); f.gate.stop(); await assert.rejects(p, /database_gate_stopped/); await f.gate.drain(); assert.equal(f.starts.length, 0); assert.equal(globalThis.fetch, original);
});
