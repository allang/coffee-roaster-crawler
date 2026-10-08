'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
require('./prepare-lulo-followup.cjs').offlineOnly();
const h = require('./collect-eleventh-deferred-sites.cjs'), core = require('./collect-tenth-sites.cjs');
const flags = () => ({ readOnlyDiscovery: true, staleCatalog: true, databasePlanningAllowed: false, databaseMutationAllowed: false, requiresFreshCatalogBeforeAnyDatabasePlanOrApply: true });
function fixture() {
  const batch = { ...h.BATCH, sourceRows: 2 }, files = {}, put = (f, value) => { files[f] = Buffer.from(JSON.stringify(value)); return h.sha(files[f]); };
  for (const f of Object.keys(h.HELPER_PINS)) files[f] = fs.readFileSync(path.join(__dirname, f));
  const products = Array.from({ length: 2 }, (_, i) => ({ id: i + 1, productId: 'fixture_' + i, name: 'Coffee ' + i, brand: 'Brand ' + i, productUrl: `https://brand${i}.example/products/coffee` }));
  const catalogFile = 'public-catalog-pages/page-0000.json', catalogSha = put(catalogFile, { rows: products });
  const rows = products.map((p, i) => ({ name: p.brand, website_url: `https://brand${i}.example/`, source: 'my_coffee_explorer', source_url: 'https://mycoffeeexplorer.com/coffees', productEvidence: [p], productEvidenceProofs: [{ id: p.id, file: catalogFile, pointer: '/rows/' + i, sha256: catalogSha }], identityVerified: false, discoveryOnly: true, ...flags() }));
  const preview = { ...flags(), selected: rows.map(r => ({ name: r.name, website_url: r.website_url, originalProductEvidence: r.productEvidence.map((p, i) => { const { id, ...proof } = r.productEvidenceProofs[i]; return { ...p, sourceCatalogProof: proof }; }) })) };
  const audit = { ...flags(), output: batch.inputFile, inputHashes: {} }, manifest = { ...flags() };
  batch.snapshotSha256 = put(batch.snapshotFile, { at: '2026-09-27T01:15:21.554Z', entities: [] });
  put('prior-review.json', { status: 'held_not_retried' });
  const seal = () => {
    batch.inputSha256 = put(batch.inputFile, rows); batch.previewSha256 = put(batch.previewFile, preview);
    audit.outputSha256 = batch.inputSha256; audit.reviewedPreview = { file: batch.previewFile, sha256: batch.previewSha256 };
    audit.inputHashes = Object.fromEntries([batch.inputFile, batch.previewFile, batch.snapshotFile, catalogFile, 'prior-review.json'].map(f => [f, h.sha(files[f])]));
    batch.auditSha256 = put(batch.auditFile, audit);
    for (const key of ['input', 'preview', 'audit']) manifest[key] = { file: batch[key + 'File'], sha256: batch[key + 'Sha256'] };
    batch.manifestSha256 = put(batch.manifestFile, manifest);
  };
  seal(); return { batch, files, rows, preview, audit, manifest, seal, read: file => { assert(files[file], 'missing fixture ' + file); return files[file]; } };
}
const html = text => ({ status: 200, contentType: 'text/html', html: text });
test('reviewed pins validate; default/check stay offline and missing pins fail closed', async () => {
  for (const k of ['inputSha256', 'auditSha256', 'previewSha256', 'manifestSha256', 'snapshotSha256']) {
    assert.match(h.BATCH[k], /^[a-f0-9]{64}$/);
    assert.throws(() => h.assertReady({ ...h.BATCH, [k]: null }), /eleventh-deferred_input_pins_unset/);
  }
  const rows = h.inputs(); assert.equal(rows.length, 2); assert.equal(rows.reduce((n, r) => n + r.productEvidence.length, 0), 2);
  assert.deepEqual(rows.map(x => x.website_url), ['https://thegrindcoffeeco.com/', 'https://wildhighlandscoffee.com/']);
  for (const args of [[], ['--check']]) { const result = await h.main(args); assert.equal(result.networkRequests, 0); assert.equal(result.databaseCalls, 0); }
  assert(!fs.existsSync(path.join(__dirname, h.OUTPUT))); assert(!fs.existsSync(path.join(__dirname, h.RESERVATION)));
});
test('all unchanged transitive helper pins match existing frozen bytes', () => {
  assert.deepEqual(h.LIMITS, { ...core.LIMITS, owners: 2 });
  for (const [f, pin] of Object.entries(h.HELPER_PINS)) assert.equal(h.sha(fs.readFileSync(path.join(__dirname, f))), pin, f);
  assert(h.HELPER_PINS['brand-site-review.cjs']); assert(h.HELPER_PINS['collect-tenth-sites.cjs']); assert(h.HELPER_PINS['product-only-network.cjs']);
});
test('2-host fixture validates full original proof and preview/manifest/audit hash chain', () => {
  const f = fixture(); assert.deepEqual(h.validateFrozenInputs(f.batch, f.read), f.rows);
});
test('any fixed artifact, source file or prior exclusion receipt byte drift fails closed', () => {
  for (const choose of [f => f.batch.inputFile, f => f.batch.auditFile, f => f.batch.previewFile, f => f.batch.manifestFile, f => f.batch.snapshotFile, () => 'prior-review.json', () => 'public-catalog-pages/page-0000.json', () => 'brand-site-review.cjs']) {
    const f = fixture(), file = choose(f); f.files[file] = Buffer.concat([f.files[file], Buffer.from(' ')]); assert.throws(() => h.validateFrozenInputs(f.batch, f.read));
  }
});
test('no refreshed-catalog or DB authority can appear in input/audit/manifest', () => {
  for (const target of ['row', 'audit', 'manifest']) for (const [key, value] of [['databaseMutationAllowed', true], ['databasePlanningAllowed', true], ['staleCatalog', false], ['readOnlyDiscovery', false], ['requiresFreshCatalogBeforeAnyDatabasePlanOrApply', false]]) {
    const f = fixture(); (target === 'row' ? f.rows[0] : f[target])[key] = value; f.seal(); assert.throws(() => h.validateFrozenInputs(f.batch, f.read), /discovery_only_gate_required/);
  }
});
test('changed original factual fields fail even if new wrapper controls are resealed', () => {
  for (const field of ['id', 'productId', 'name', 'brand', 'productUrl']) {
    const f = fixture(); f.rows[0].productEvidence = structuredClone(f.rows[0].productEvidence); f.rows[0].productEvidence[0][field] = 'tampered'; f.seal(); assert.throws(() => h.validateFrozenInputs(f.batch, f.read));
  }
});
test('source provenance cannot be rebound to another identical row or page', () => {
  for (const kind of ['pointer', 'file']) { const f = fixture(); if (kind === 'pointer') f.rows[0].productEvidenceProofs[0].pointer = '/rows/1'; else { const name = 'public-catalog-pages/page-9999.json'; f.files[name] = f.files['public-catalog-pages/page-0000.json']; f.rows[0].productEvidenceProofs[0].file = name; } f.seal(); assert.throws(() => h.validateFrozenInputs(f.batch, f.read), /Reviewed source proof changed/); }
});
test('duplicate owners, guessed sites, source changes and identity approval are rejected', () => {
  for (const mutate of [f => f.rows[1].website_url = f.rows[0].website_url, f => f.rows[0].website_url = 'https://guessed.example/', f => f.rows[0].identityVerified = true, f => f.rows[0].discoveryOnly = false, f => f.rows[0].source = 'other', f => f.rows[0].source_url += '/guessed']) { const f = fixture(); mutate(f); f.seal(); assert.throws(() => h.validateFrozenInputs(f.batch, f.read)); }
});
test('owner/page/source budgets cannot expand', () => {
  const f = fixture(); assert.equal(h.LIMITS.owners, 2); assert.equal(h.LIMITS.pagesPerOwner, 3); assert.equal(h.LIMITS.concurrency, 2); assert.equal(h.LIMITS.maxHtmlBytes, 1048576);
  for (const batch of [{ ...f.batch, owners: 3 }, { ...f.batch, sourceRows: 7 }, { ...f.batch, sourceRows: null }, { ...f.batch, inputFile: '../outside.json' }]) assert.throws(() => h.validateFrozenInputs(batch, f.read));
});
test('homepage/category source URLs are preserved discovery facts, not fetch targets', () => {
  const f = fixture(), product = { ...f.rows[0].productEvidence[0], productUrl: 'https://brand0.example/collections/coffee?catalog=old' }; f.rows[0].productEvidence = [product]; f.preview.selected[0].originalProductEvidence[0] = { ...product, sourceCatalogProof: { ...f.preview.selected[0].originalProductEvidence[0].sourceCatalogProof } };
  const catalog = JSON.parse(f.files['public-catalog-pages/page-0000.json']); catalog.rows[0] = product; f.files['public-catalog-pages/page-0000.json'] = Buffer.from(JSON.stringify(catalog)); const digest = h.sha(f.files['public-catalog-pages/page-0000.json']);
  for (let i = 0; i < 2; i++) { f.rows[i].productEvidenceProofs[0].sha256 = digest; f.preview.selected[i].originalProductEvidence[0].sourceCatalogProof.sha256 = digest; } f.seal(); assert.deepEqual(h.validateFrozenInputs(f.batch, f.read)[0].productEvidence[0], product);
});
test('exported fixture collector cannot enable default or actual pageRequest', async () => {
  const rows = fixture().rows; await assert.rejects(h.collectRows(rows, { onResult() {} }), /explicit_verified_run_required/);
  await assert.rejects(h.collectRows(rows, { request: require('./validate-sites.cjs').pageRequest, onResult() {} }), /explicit_verified_run_required/);
});
test('2 owners use at most2workers and3observed pages each, never product proof URLs', async () => {
  const rows = fixture().rows, seen = [], results = []; let active = 0, maximum = 0;
  await h.collectRows(rows, { request: async u => { active++; maximum = Math.max(maximum, active); seen.push(u.href); await new Promise(r => setImmediate(r)); active--; return html(u.pathname === '/' ? '<title>Our coffee</title><a href="/about">About us</a><a href="/roastery">Our roastery</a><a href="/team">Our team</a>' : '<title>About us</title><p>We roast our coffee.</p>'); }, onResult: r => results.push(r) });
  assert.equal(maximum, 2); assert.equal(results.length, 2); assert(seen.length <= 6); assert(results.every(r => r.pages.length <= 3)); assert(!seen.some(u => u.includes('/products/')));
});
test('every allowed page retains full rawHTML and static text beyond200k', async () => {
  const text = '<title>Our coffee</title><main>' + 'coffee '.repeat(35000) + 'END_FULL_CAPTURE</main>', results = [];
  await h.collectRows(fixture().rows.slice(0, 1), { request: async () => html(text), onResult: r => results.push(r) });
  const p = results[0].pages[0]; assert.equal(p.rawHtml, text); assert.equal(p.rawHtmlSha256, h.sha(text)); assert(p.staticBodyTextChars > 200000); assert(p.staticBodyText.endsWith('END_FULL_CAPTURE'));
});
test('access/challenge/legal/oversize results contain no HTML and no followups', async () => {
  for (const response of [{ status: 401 }, { status: 403 }, { status: 407 }, { status: 429 }, html('<title>Terms and Conditions</title>DO_NOT_CAPTURE'), html('<title>Just a moment</title>DO_NOT_CAPTURE'), html('x'.repeat(1048577)), { ...html('DO_NOT_CAPTURE'), truncated: true }]) {
    let calls = 0; const results = []; await h.collectRows(fixture().rows.slice(0, 1), { request: async () => { calls++; return response; }, onResult: r => results.push(r) });
    assert.equal(calls, 1); assert(!results[0].pages[0].rawHtml); assert(!results[0].pages[0].staticBodyText);
  }
});
test('legal/auth/private/action-query redirect is refused before second request', async () => {
  for (const location of ['/terms', '/%2574erms', '/login', '/?add-to-cart=1', 'http://127.0.0.1/', 'https://127.0.0.1/']) { let calls = 0; const results = []; await h.collectRows(fixture().rows.slice(0, 1), { request: async () => { calls++; return { status: 302, location }; }, onResult: r => results.push(r) }); assert.equal(calls, 1); assert.equal(results[0].status, 'failed'); }
});
test('same-resolution strict DNS rejects mixed unsafe addresses before dispatch', async () => {
  for (const address of ['127.0.0.1', '2002:0a00:0001::1', '2001::1']) { const dns = { lookup: async () => [{ address: '1.1.1.1', family: 4 }, { address, family: address.includes(':') ? 6 : 4 }] }, old = dns.lookup, guard = core.installStrictDnsGuard({ dnsModule: dns }); try { await assert.rejects(dns.lookup('fixture.example', { all: true }), /private_or_reserved_dns/); } finally { guard.uninstall(); } assert.equal(dns.lookup, old); }
});
test('fatal audit error stops scheduling while inherited workers drain', async () => {
  let requests = 0; const event = core.latchedEvents(() => { throw Error('audit_failed'); });
  await assert.rejects(h.collectRows(fixture().rows, { request: async () => { requests++; return html('<title>About</title>'); }, event, onResult() {} }), /audit_failed/); assert.equal(requests, 0);
});
test('fatal output error waits for both started workers before cleanup', async () => {
  const sequence = []; let starts = 0;
  await assert.rejects((async () => { try { await h.collectRows(fixture().rows, { request: async () => { const n = ++starts; sequence.push('start' + n); if (n === 2) await new Promise(r => setTimeout(r, 5)); sequence.push('end' + n); return html('<title>About</title>'); }, onResult() { throw Error('output_failed'); } }); } finally { sequence.push('cleanup'); } })(), /output_failed/);
  assert.equal(starts, 2); assert(sequence.indexOf('cleanup') > sequence.indexOf('end2'));
});
test('all fixtures forbid real network or process creation', () => {
  assert.throws(() => fetch('https://example.com'), /offline_builder/); assert.throws(() => require('node:https').get('https://example.com'), /offline_builder/); assert.throws(() => require('node:child_process').spawn('anything'), /offline_builder/);
});
