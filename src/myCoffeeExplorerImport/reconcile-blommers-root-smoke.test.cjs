'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./reconcile-blommers-historical-claims.cjs');
const clone = x => JSON.parse(JSON.stringify(x));
const plan = h.loadPlan();

function fake(mode, drift = false) {
  let time = Date.parse('2026-09-27T17:50:00.000Z');
  const rows = clone(plan.expected), calls = [];
  if (drift) rows[10].pages_visited = 1;
  const delegate = async (url, init) => {
    const u = new URL(url), q = u.searchParams;
    assert.equal(u.origin, h.ORIGIN);
    assert.equal(init.redirect, 'error');
    assert.ok(['GET', 'PATCH'].includes(init.method));
    calls.push({ method: init.method, url });
    let result;
    if (u.pathname === '/rest/v1/entities') {
      assert.equal(init.method, 'GET');
      assert.equal(q.get('id'), 'eq.' + h.OWNER);
      result = [clone(plan.owner)];
    } else {
      assert.equal(u.pathname, '/rest/v1/crawl_runs');
      assert.equal(q.get('entity_id'), 'eq.' + h.OWNER);
      if (init.method === 'PATCH') {
        const row = rows.find(r => 'eq.' + r.id === q.get('id'));
        assert.ok(row);
        for (const [k, v] of Object.entries(row)) {
          const predicate = v === null ? 'is.null' : 'eq.' + (typeof v === 'object' ? JSON.stringify(v) : v);
          assert.equal(q.get(k), predicate, 'full-row CAS for ' + k);
        }
        const patch = JSON.parse(init.body);
        assert.deepEqual(Object.keys(patch).sort(), ['error', 'finished_at', 'status']);
        assert.equal(patch.status, 'failed');
        assert.match(patch.error, /original finish time and cause unknown/);
        Object.assign(row, patch);
        result = [clone(row)];
      } else if (q.get('status') === 'eq.running') {
        result = clone(rows.filter(r => r.status === 'running'));
      } else {
        assert.equal(q.get('id'), 'in.(' + plan.claim_ids.join(',') + ')');
        result = clone(rows);
      }
    }
    const headers = { 'content-type': 'application/json' };
    if (init.method === 'GET') headers['content-range'] = result.length ? `0-${result.length - 1}/${result.length}` : '*/0';
    const response = new Response(JSON.stringify(result), { status: 200, headers });
    Object.defineProperty(response, 'url', { value: url });
    return response;
  };
  const client = h.createClient({ plan, key: 'offline-test', mode, delegate, now: () => time, wait: async ms => { time += ms; } });
  return { rows, calls, client, now: () => time };
}

test('root: exact historical inventory is pinned and all 43 identities are distinct', () => {
  assert.equal(plan.expected.length, 43);
  assert.equal(new Set(plan.claim_ids).size, 43);
  for (const row of plan.expected) assert.equal(row.entity_id, h.OWNER);
});

test('root: preview uses exactly three GET requests and no mutation', async () => {
  const f = fake('preview');
  const result = await h.execute({ plan, client: f.client, mode: 'preview', proof: () => ({}), now: f.now });
  assert.equal(result.writes, 0);
  assert.deepEqual(f.calls.map(c => c.method), ['GET', 'GET', 'GET']);
  assert.deepEqual(f.rows, plan.expected);
});

test('root: full apply preserves all 43 rows except the three authorized fields', async () => {
  const f = fake('apply');
  const preview = { at: new Date(f.now()).toISOString(), status: 'claims_reconciliation_preview_pass', helper_sha256: h.helperSha(), plan_sha256: h.PLAN_SHA, owner: plan.owner, before: plan.expected };
  const result = await h.execute({ plan, client: f.client, mode: 'apply', preview, proof: () => ({}), now: f.now });
  assert.equal(result.writes, 43);
  assert.equal(f.calls.length, 91);
  assert.equal(f.calls.filter(c => c.method === 'PATCH').length, 43);
  for (let i = 0; i < 43; i++) {
    const { status, finished_at, error, ...after } = f.rows[i];
    const { status: oldStatus, finished_at: oldFinish, error: oldError, ...before } = plan.expected[i];
    assert.equal(status, 'failed');
    assert.ok(finished_at && error);
    assert.deepEqual(after, before);
  }
});

test('root: fresh counter drift stops before any PATCH', async () => {
  const f = fake('apply', true);
  const preview = { at: new Date(f.now()).toISOString(), status: 'claims_reconciliation_preview_pass', helper_sha256: h.helperSha(), plan_sha256: h.PLAN_SHA, owner: plan.owner, before: plan.expected };
  await assert.rejects(h.execute({ plan, client: f.client, mode: 'apply', preview, proof: () => ({}), now: f.now }), /row_drift:pages_visited/);
  assert.equal(f.calls.filter(c => c.method === 'PATCH').length, 0);
});
