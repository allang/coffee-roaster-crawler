'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function helper({ apply = false, foreign = false, project = 'https://gtlipifdfyugiwpxvuse.supabase.co', database = { entities: [], roles: [] } } = {}) {
  const calls = [], outputs = [], receipts = [], module = { exports: {} };
  const read = file => file === 'node:crypto' ? require('node:crypto') : file === '../src/catalogNormalization' ? require('../src/catalogNormalization') : { mkdirSync() {}, writeFileSync: (_, value) => receipts.push(JSON.parse(value)) };
  const context = { module, exports: module.exports, require: read, URLSearchParams, AbortSignal, console: { log: value => outputs.push(JSON.parse(value)), error() {} }, process: { env: { NEXT_PUBLIC_SUPABASE_URL: project, SUPABASE_SERVICE_ROLE_KEY: 'mock-key' }, argv: apply ? ['node', 'script', '--apply'] : ['node', 'script'] }, fetch: async (value, options) => {
    const url = new URL(value), table = url.pathname.split('/').at(-1), method = options.method; calls.push({ table, method });
    let rows;
    if (method === 'POST') { rows = [JSON.parse(options.body)]; database[table === 'entities' ? 'entities' : 'roles'].push(...rows); }
    else if (table === 'entity_roles') rows = database.roles.filter(r => r.entity_id === url.searchParams.get('entity_id').slice(3));
    else if (url.searchParams.has('id')) rows = database.entities.filter(r => r.id === url.searchParams.get('id').slice(3));
    else if (foreign) rows = [{ id: 'existing-owner', name: 'Toyosaki', website_url: 'https://existing.test' }];
    else rows = database.entities.filter(r => url.searchParams.get('or').includes(r.website_url.includes('regolith') ? 'regolith' : 'toyosaki'));
    return { ok: true, status: 200, json: async () => structuredClone(rows) };
  } };
  read.main = null; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../scripts/add-session-three-roasters.cjs'), 'utf8'), context);
  return { run: module.exports.main, calls, outputs, receipts, database };
}
test('session-three index preview never posts production rows', async () => {
  const h = helper(); await h.run(); assert.equal(h.calls.filter(c => c.method === 'POST').length, 0);
  assert.equal(h.outputs[0].mode, 'preview'); assert.equal(h.outputs[0].targets.length, 2); assert(h.receipts.at(-1).targets.every(t => t.before.length === 0));
});
test('session-three inserts only the two reviewed owners and preserves their IDs on rerun', async () => {
  const first = helper({ apply: true }); await first.run();
  assert.equal(first.database.entities.length, 2); assert.equal(first.database.roles.length, 2);
  assert(first.receipts.at(-1).targets.every(t => t.status === 'verified'));
  const second = helper({ apply: true, database: first.database }); await second.run();
  assert.equal(second.calls.filter(c => c.method === 'POST').length, 0);
  assert.deepEqual(second.outputs[0].targets.map(t => t.id), first.outputs[0].targets.map(t => t.id));
  assert.notEqual(second.outputs[0].output, first.outputs[0].output);
});
test('session-three refuses ambiguous preexisting identity rather than modifying or duplicating it', async () => {
  const h = helper({ apply: true, foreign: true }); await assert.rejects(h.run(), /Existing identity requires review/); assert(h.calls.every(c => c.method === 'GET'));
});
test('session-three rejects a different project before catalog access', async () => {
  const h = helper({ project: 'https://unrelated.supabase.co' }); await assert.rejects(h.run(), /Unexpected or missing/); assert.equal(h.calls.length, 0);
});
