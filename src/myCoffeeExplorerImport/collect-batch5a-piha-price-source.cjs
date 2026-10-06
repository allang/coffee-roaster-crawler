'use strict';
// One-shot evidence-only price verification. Never imports the product pipeline or a DB client.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createTransport, ownerUrl, publicUrl } = require('./product-only-network.cjs');
const { installLegalGuard } = require('./legal-guard.cjs');
const { installQuerylessGuard, saveExclusive, openRequestAudit, syncDirectory } = require('./plan8-product-link-discovery.cjs');
const { capture, latchedEvents } = require('./collect-tenth-sites.cjs');

const BASE = __dirname;
const TAG = 'batch5a-piha-price-source';
const PLAN_FILE = 'batch5a-two-eur-price-repair-plan.json';
const PLAN_SHA256 = '4bb1e31ea6bba8c6d781192df501b925329caf7af395e99ef37cf1592fdfd989';
const PLAN_HASH = '2d250e4dc04a79c6c7afae173359ad79c9929e68a758140213c53b28e2c0ae52';
const MANIFEST_FILE = 'product-seed-batch5a-reviewed/manifest.json';
const MANIFEST_SHA256 = '114fa0f38cf1a4285213aeb583a00f5ffee77e5d661df2171c433e56fd9b30a3';
const OWNER = 'd11e3f98-4506-4435-90cd-dff1634cc974';
const WEBSITE = 'https://www.cafepiha.com/';
const LIMITS = Object.freeze({ owners: 1, pages: 2, concurrency: 1, requestTimeoutMs: 20000, maxHtmlBytes: 1048576, maxRedirects: 5, minimumRequestSpacingMs: 500, retries: 0 });
const HELPER_PINS = Object.freeze({
  'product-only-network.cjs': '06b85be52fce083ee6d2cdf5631fa21d2ccdc7ae7a2d7e0f22549769e097ad3e',
  'legal-guard.cjs': '26acbcc26a6b24aaf3663b5968b6163e010a3ac323eac4cfe1dd8b5e6a16abfc',
  'plan8-product-link-discovery.cjs': '75aa82758e22574e81ae1789b26c56f0d791ece06993284ec6d502f781d05fa7',
  'collect-tenth-sites.cjs': '1e0979428ffa97f0290c9637b116eacc30d0de9eb21bc13d042534c7e4fe75f5',
  'validate-sites.cjs': '7e1e423d41139078032d81475dcc2acb70610e9fa6cdb0eb6c09d59d23ad133b',
  'brand-site-review.cjs': '586ba32207bc78c59c8a7645682b4fb27528f2d7fe818787664e099591b51e8d',
});
const TARGETS = Object.freeze([
  Object.freeze({ product_id: '23a3c38f-2a53-4649-b145-8ca331870aad', variant_id: '53707a41-c59c-47a7-9350-416ab3444b85', url: 'https://www.cafepiha.com/e-boutique/la-victoria-honey/', catalog_id: 47160 }),
  Object.freeze({ product_id: 'c66abd24-7e76-4937-939e-509b9f47e1b4', variant_id: 'b9c867c4-d2b3-4fbc-b62a-545d6e99f1a6', url: 'https://www.cafepiha.com/e-boutique/decafeine-la-belle-endormie/', catalog_id: 47159 }),
]);
const TOKEN = Symbol('explicit verified CLI run');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const stamp = () => new Date().toISOString();
const HASH_ENCODING = 'SHA-256 of UTF-8 compact JSON.stringify after recursively lexicographically sorting object keys; array order preserved. File hashes instead use exact original file bytes.';
function canonical(value) { return Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value; }
function rowHash(value) { return sha(JSON.stringify(canonical(value))); }
function must(ok, code) { if (!ok) throw Object.assign(Error(code), { code }); }
function readLocal(file) {
  must(typeof file === 'string' && !path.isAbsolute(file) && !file.split('/').includes('..'), 'unsafe_evidence_path');
  const real = fs.realpathSync(path.join(BASE, file));
  must(real.startsWith(BASE + path.sep), 'evidence_outside_base');
  return fs.readFileSync(real);
}
function strictUrl(value) {
  const u = new URL(value);
  must(!u.search && !u.hash, 'query_or_fragment_forbidden');
  publicUrl(u); ownerUrl(u, WEBSITE);
  must(u.href === value, 'url_must_be_exact');
  return u;
}
function pointer(doc, value) {
  must(/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(value), 'invalid_pointer');
  for (const key of value.slice(1).split('/')) { must(!['__proto__', 'prototype', 'constructor'].includes(key) && doc && Object.hasOwn(doc, key), 'missing_pointer'); doc = doc[key]; }
  return doc;
}
function loadBundle(read = readLocal) {
  for (const [file, pin] of Object.entries(HELPER_PINS)) assert.equal(sha(read(file)), pin, 'Pinned helper changed: ' + file);
  const bytes = read(PLAN_FILE); assert.equal(sha(bytes), PLAN_SHA256, 'Pinned price proposal changed');
  const plan = JSON.parse(bytes), withoutHash = { ...plan }; delete withoutHash.planHash;
  assert.equal(plan.planHash, PLAN_HASH); assert.equal(rowHash(withoutHash), PLAN_HASH);
  assert.equal(plan.scope, 'batch5a_exact_two_EUR_decimal_comma_price_cents_only');
  assert.equal(plan.apply_ready, false); assert.equal(plan.independent_first_party_price_verified, false);
  assert.equal(plan.allowed_entity_id, OWNER); assert.equal(plan.actions.length, 2);
  const docs = new Map();
  for (const proof of plan.evidence_receipts) { assert(!docs.has(proof.file)); const data = read(proof.file); assert.equal(sha(data), proof.sha256, 'Pinned evidence changed: ' + proof.file); docs.set(proof.file, data); }
  assert.equal(plan.evidence_receipts.length, 14);
  assert.equal(sha(docs.get(MANIFEST_FILE)), MANIFEST_SHA256); assert.equal(plan.manifest_sha256, MANIFEST_SHA256);
  const manifest = JSON.parse(docs.get(MANIFEST_FILE));
  const owners = manifest.targets.filter(row => row.entity_id === OWNER); assert.equal(owners.length, 1);
  const owner = owners[0]; assert.equal(owner.website_url, WEBSITE);
  const ownership = JSON.parse(docs.get('product-seed-batch5a-reviewed/ownership.json'));
  assert.deepEqual(pointer(ownership, owner.owner_evidence.pointer).source_ids, owner.source_ids);
  const targets = TARGETS.map((fixed, index) => {
    strictUrl(fixed.url);
    const action = plan.actions[index], binding = action.product_binding, proof = action.evidence.original_catalog_proof;
    assert.equal(action.key.id, fixed.variant_id); assert.equal(action.key.product_id, fixed.product_id);
    assert.equal(rowHash(action.before), action.full_variant_row_sha256);
    assert.equal(binding.product_id, fixed.product_id); assert.equal(binding.entity_id, OWNER); assert.equal(binding.source_url, fixed.url);
    assert.equal(binding.owner.website_url, WEBSITE); assert.deepEqual(binding.owner, pointer(ownership, owner.owner_evidence.pointer));
    assert.deepEqual(binding.owner.source_ids, owner.source_ids);
    const products = owner.products.filter(p => p.url === fixed.url); assert.equal(products.length, 1);
    assert.deepEqual(products[0], binding.manifest_product); assert.equal(products[0].source_product_id, fixed.catalog_id);
    assert(docs.has(proof.file)); assert.equal(sha(docs.get(proof.file)), proof.sha256);
    const row = pointer(JSON.parse(docs.get(proof.file)), proof.pointer); assert.deepEqual(row, proof.row);
    assert.equal(row.id, fixed.catalog_id); assert.equal(row.productUrl, fixed.url); assert.equal(row.brand, products[0].source_brand);
    assert.equal(row.name, products[0].name);
    return { ...fixed, entity_id: OWNER, name: binding.name, source_binding: { owner, catalog_proof: proof }, extractor_price_is_not_independent_evidence: action.evidence.captured_price_text };
  });
  return { scope: 'exact_two_first_party_price_source_pages_only', targets, evidenceReceipts: plan.evidence_receipts, plan_sha256: PLAN_SHA256, manifest_sha256: MANIFEST_SHA256, databaseCallsAllowed: false, databaseMutationAllowed: false };
}
async function collectPages(bundle, { transportFactory = createTransport, event = () => {}, onPage = () => {}, token } = {}) {
  if (transportFactory === createTransport) must(token === TOKEN, 'explicit_verified_run_required');
  assert.deepEqual(bundle.targets.map(({ product_id, variant_id, url, catalog_id }) => ({ product_id, variant_id, url, catalog_id })), TARGETS);
  let context, stopped = null; const records = [];
  const transport = transportFactory({ context: () => context, onEvent: event });
  for (const target of bundle.targets) {
    const record = { ...target, started_at: stamp(), requested_url: target.url, fetched: false, raw_first_party_capture: false, priceVerificationStatus: 'not_verified', databaseMutationAllowed: false };
    if (stopped) { Object.assign(record, { status: 'not_requested_prior_owner_stop', stop_reason: stopped }); }
    else {
      const u = strictUrl(target.url);
      // Empty products means even the other pinned page cannot authorize a changed-path redirect.
      context = { target: { entity_id: OWNER, website_url: WEBSITE, products: [] }, url: u.href, images: new Set(), networkErrors: [] };
      event({ channel: 'piha_price_source', at: stamp(), url: u.href, entityId: OWNER, disposition: 'starting' });
      const response = await transport.fetchHtml(u.href); event.throwIfFailed?.();
      if (!response.success) { stopped = context.hardStop || response.error || 'request_failed'; Object.assign(record, { status: 'failed', error: response.error, hard_stop: context.hardStop || null, challenge_reason: context.challengeReason || null }); }
      else {
        const final = strictUrl(response.finalUrl);
        assert.equal(final.pathname.replace(/\/$/, ''), u.pathname.replace(/\/$/, ''), 'Changed-path response forbidden');
        assert(typeof response.data === 'string' && Buffer.byteLength(response.data) <= LIMITS.maxHtmlBytes);
        Object.assign(record, { status: response.status, final_url: final.href, fetched: true, raw_first_party_capture: true, content_type: response.headers['content-type'], ...capture(response.data), priceVerificationStatus: 'awaiting_manual_raw_first_party_price_currency_weight_review' });
      }
    }
    record.finished_at = stamp(); await onPage(record); records.push(record);
  }
  return records;
}
function reserve(directory, details) {
  fs.mkdirSync(directory, { mode: 0o700 }); syncDirectory(path.dirname(directory));
  saveExclusive(path.join(directory, 'reservation.json'), details);
}
async function run(bundle, token) {
  must(token === TOKEN, 'explicit_verified_run_required'); assert.deepEqual(loadBundle(), bundle);
  const directory = path.join(BASE, TAG), helperSha = sha(fs.readFileSync(__filename));
  const reservation = { at: stamp(), pid: process.pid, helper_sha256: helperSha, plan_sha256: PLAN_SHA256, manifest_sha256: MANIFEST_SHA256, limits: LIMITS, repeated_page_justification: 'Exactly these two previously observed product pages require independent raw first-party evidence to confirm or reject suspected persisted EUR decimal-comma price errors. No discovery or retry expansion.', no_resume_or_retry: true, databaseCallsAllowed: false, databaseMutationAllowed: false };
  reserve(directory, reservation);
  const audit = openRequestAudit(path.join(directory, 'requests.ndjson')), event = latchedEvents(e => audit.append(e));
  let legal, native, failure = null; const pages = [];
  const previousTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  try {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';
    legal = installLegalGuard({ onEvent: event }); native = installQuerylessGuard({ onEvent: event });
    await collectPages(bundle, { token, event, onPage: record => { saveExclusive(path.join(directory, 'page-' + record.variant_id + '.json'), record); pages.push(record); } });
  } catch (error) { failure = { code: String(error.code || 'price_source_collection_failed').replace(/[^A-Za-z0-9_:-]/g, '').slice(0, 100) }; }
  finally {
    try { native?.uninstall(); } finally { try { legal?.uninstall(); } finally { audit.close(); if (previousTls === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTls; } }
  }
  const failed = failure || pages.length !== 2 || pages.some(p => !p.fetched);
  const result = { version: 1, at: stamp(), status: failed ? 'stopped_for_review' : 'captured_for_manual_price_verification', failure, helper_sha256: helperSha, plan_sha256: PLAN_SHA256, manifest_sha256: MANIFEST_SHA256, evidenceReceipts: bundle.evidenceReceipts, hash_encoding: HASH_ENCODING, limits: LIMITS, pages, request_audit_file: 'requests.ndjson', request_audit_sha256: sha(fs.readFileSync(path.join(directory, 'requests.ndjson'))), legal_guard: legal?.stats, native_guard: native?.stats, priceRepairApproved: false, databaseCallsAllowed: false, databaseMutationAllowed: false, network_scope: 'Only two exact signed-out HTML product source pages; no JSON/API/product pipeline/JS/media/auth/cookies/proxy/retry/link traversal. At most same-owner canonical-host or trailing-slash redirects, never changed path or query.' };
  saveExclusive(path.join(directory, 'result.json'), result);
  return { status: result.status, failed: Boolean(failed), output: directory, pages: pages.length, result_sha256: sha(fs.readFileSync(path.join(directory, 'result.json'))) };
}
async function main(args = process.argv.slice(2)) {
  assert(args.length <= 1 && (!args[0] || ['--check', '--run'].includes(args[0])), 'Exact --check or --run only');
  const bundle = loadBundle();
  if (args[0] !== '--run') { console.log(JSON.stringify({ status: 'pass_offline_only', pages: 2, owners: 1, plan_sha256: PLAN_SHA256, manifest_sha256: MANIFEST_SHA256, networkRequests: 0, databaseCalls: 0 })); return; }
  const result = await run(bundle, TOKEN); console.log(JSON.stringify(result)); if (result.failed) process.exitCode = 1;
}
module.exports = { BASE, TAG, PLAN_FILE, PLAN_SHA256, PLAN_HASH, MANIFEST_FILE, MANIFEST_SHA256, OWNER, WEBSITE, TARGETS, LIMITS, HELPER_PINS, HASH_ENCODING, sha, canonical, rowHash, strictUrl, pointer, loadBundle, collectPages, reserve, main };
if (require.main === module) main().catch(error => { console.error(String(error.code || 'price_source_preflight_failed').replace(/[^A-Za-z0-9_:-]/g, '').slice(0, 100)); process.exitCode = 1; });
