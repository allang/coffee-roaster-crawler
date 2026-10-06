'use strict';
// New discovery-only wrapper. Existing collectors/transports/guards remain frozen.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const core = require('./collect-tenth-sites.cjs');
const { pageRequest } = require('./validate-sites.cjs');
const { installLegalGuard } = require('./legal-guard.cjs');
const { installQuerylessGuard } = require('./plan8-product-link-discovery.cjs');
const BASE = __dirname;
const BATCH = Object.freeze({
  inputFile: 'eleventh-deferred-reviewed-site-input.json', inputSha256: '2744e970ad9de5545c46ae12b9c2d4760104272842b289b01252b236458e02d7',
  auditFile: 'eleventh-deferred-reviewed-site-input.audit.json', auditSha256: '383070beca30bf829bbf8f23fda93f792f9f4dd624315eb283e79204eaa99126',
  previewFile: 'eleventh-deferred-discovery-preview.json', previewSha256: 'd3065d17e567de68fe7fb0f89f5e697c332bc23cac7fecd8a9c1d91386dc7506',
  manifestFile: 'eleventh-deferred-discovery-manifest.json', manifestSha256: 'e83195473d5c85b1d6a58d037ffeaf5a7ab86c9273b04240430ff825a0ad28c0',
  snapshotFile: 'snapshot-0114.json', snapshotSha256: 'c835229bf8c2abbdfcc812f6a9c841b4e6fd8e3c3eb03b8b62474964bb9a3e99',
  owners: 2, sourceRows: 2,
});
const OUTPUT = 'eleventh-deferred-public-brand-site-review.ndjson';
const RECEIPT = 'eleventh-deferred-site-discovery.receipt.json';
const RESERVATION = 'eleventh-deferred-site-discovery.reservation.json';
const HELPER_PINS = Object.freeze({
  'collect-tenth-sites.cjs': '1e0979428ffa97f0290c9637b116eacc30d0de9eb21bc13d042534c7e4fe75f5',
  ...core.HELPER_PINS,
});
const LIMITS = Object.freeze({ ...core.LIMITS, owners: 2 });
const TOKEN = Symbol('eleventh-deferred verified explicit run');
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
function must(ok, code) { if (!ok) throw Object.assign(Error(code), { code }); }
function assertReady(batch = BATCH) {
  for (const key of ['inputSha256', 'auditSha256', 'previewSha256', 'manifestSha256', 'snapshotSha256']) must(/^[a-f0-9]{64}$/.test(batch[key] || ''), 'eleventh-deferred_input_pins_unset');
  must(batch.owners === 2 && Number.isSafeInteger(batch.sourceRows) && batch.sourceRows > 0 && batch.sourceRows <= 6, 'eleventh-deferred_scope_bounds');
  for (const key of ['inputFile', 'auditFile', 'previewFile', 'manifestFile', 'snapshotFile']) must(typeof batch[key] === 'string' && /^[a-z0-9][a-z0-9._-]*\.json$/.test(batch[key]), 'unsafe_evidence_filename');
}
function readLocal(file) {
  must(typeof file === 'string' && /^[a-z0-9][a-zA-Z0-9._/-]*$/.test(file) && !file.split('/').includes('..'), 'unsafe_evidence_path');
  const real = fs.realpathSync(path.join(BASE, file)); must(real.startsWith(fs.realpathSync(BASE) + path.sep), 'evidence_outside_base');
  return fs.readFileSync(real);
}
function discoveryOnly(value) {
  must(value.readOnlyDiscovery === true && value.staleCatalog === true && value.databasePlanningAllowed === false && value.databaseMutationAllowed === false && value.requiresFreshCatalogBeforeAnyDatabasePlanOrApply === true, 'discovery_only_gate_required');
}
function validateFrozenInputs(batch, read) {
  assertReady(batch);
  const fixed = { ...HELPER_PINS, [batch.inputFile]: batch.inputSha256, [batch.auditFile]: batch.auditSha256, [batch.previewFile]: batch.previewSha256, [batch.manifestFile]: batch.manifestSha256, [batch.snapshotFile]: batch.snapshotSha256 };
  for (const [file, pin] of Object.entries(fixed)) must(sha(read(file)) === pin, 'pinned_input_changed');
  const rows = JSON.parse(read(batch.inputFile)), preview = JSON.parse(read(batch.previewFile)), manifest = JSON.parse(read(batch.manifestFile)), audit = JSON.parse(read(batch.auditFile));
  must(audit.output === batch.inputFile && audit.outputSha256 === batch.inputSha256, 'audit_output_binding_changed');
  assert.deepEqual(audit.reviewedPreview, { file: batch.previewFile, sha256: batch.previewSha256 });
  for (const [key, file, pin] of [['input', batch.inputFile, batch.inputSha256], ['preview', batch.previewFile, batch.previewSha256], ['audit', batch.auditFile, batch.auditSha256]]) assert.deepEqual(manifest[key], { file, sha256: pin });
  must(audit.inputHashes && audit.inputHashes[batch.snapshotFile] === batch.snapshotSha256, 'snapshot_pin_missing');
  must(Object.keys(audit.inputHashes).length > 0 && Object.keys(audit.inputHashes).length <= 2000, 'audit_hash_bounds');
  for (const [file, pin] of Object.entries(audit.inputHashes)) {
    must(/^[a-f0-9]{64}$/.test(pin) && sha(read(file)) === pin, 'audit_evidence_changed');
  }
  discoveryOnly(audit); discoveryOnly(manifest);
  for (const row of rows) {
    discoveryOnly(row); must(row.source === 'my_coffee_explorer' && row.source_url === 'https://mycoffeeexplorer.com/coffees', 'source_binding_changed');
    must(Array.isArray(row.productEvidence) && row.productEvidence.length > 0 && row.productEvidence.length <= 3, 'per_owner_source_bounds');
  }
  return core.validateRows(rows, preview, batch, read);
}
function inputs() { return validateFrozenInputs(BATCH, readLocal); }
async function collectRows(rows, { request, event = () => {}, onResult, token } = {}) {
  must(Array.isArray(rows) && rows.length > 0 && rows.length <= LIMITS.owners && typeof onResult === 'function', 'collection_scope_invalid');
  if (!request || request === pageRequest) { must(token === TOKEN, 'explicit_verified_run_required'); request = pageRequest; }
  await core.runWorkers(rows, {
    work: async row => { const result = await core.review(row, { request, event }); event.throwIfFailed?.(); return result; },
    onResult,
  });
}
function syncDir() { const fd = fs.openSync(BASE, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function writeAll(fd, value) { const bytes = Buffer.from(value); let offset = 0; while (offset < bytes.length) { const count = fs.writeSync(fd, bytes, offset, bytes.length - offset); must(count > 0, 'output_write_stalled'); offset += count; } fs.fsyncSync(fd); }
function exclusive(file, value) { const fd = fs.openSync(file, 'wx', 0o600); try { writeAll(fd, JSON.stringify(value, null, 2) + '\n'); } finally { fs.closeSync(fd); syncDir(); } }
async function main(args = process.argv.slice(2)) {
  const mode = args.length ? args[0] : '--check'; must(args.length <= 1 && ['--check', '--run'].includes(mode), 'use_check_or_run_only');
  const rows = inputs();
  if (mode === '--check') { const result = { status: 'pass', owners: BATCH.owners, sourceRows: BATCH.sourceRows, networkRequests: 0, databaseCalls: 0, databasePlanningAllowed: false }; console.log(JSON.stringify(result)); return result; }
  const out = path.join(BASE, OUTPUT), audit = out + '.audit.ndjson', receiptFile = path.join(BASE, RECEIPT), reservationFile = path.join(BASE, RESERVATION);
  must(![out, audit, receiptFile, reservationFile].some(f => fs.existsSync(f)), 'prior_collection_requires_review_no_retry');
  // Exclusive reservation prevents simultaneous launches before guards or HTTP.
  exclusive(reservationFile, { at: new Date().toISOString(), pid: process.pid, helper_sha256: sha(fs.readFileSync(__filename)), batch: BATCH, helperPins: HELPER_PINS, limits: LIMITS, readOnlyDiscovery: true, staleCatalog: true, databasePlanningAllowed: false, databaseMutationAllowed: false, requiresFreshCatalogBeforeAnyDatabasePlanOrApply: true, retries: 0 });
  let fd, af, guard, queryless, strictDns, finished = 0;
  const priorTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  try {
    fd = fs.openSync(out, 'wx', 0o600); af = fs.openSync(audit, 'wx', 0o600); syncDir();
    const event = core.latchedEvents(e => writeAll(af, JSON.stringify(e) + '\n'));
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';
    guard = installLegalGuard({ onEvent: event }); queryless = installQuerylessGuard({ onEvent: event }); strictDns = core.installStrictDnsGuard({ onEvent: event });
    await collectRows(rows, { request: pageRequest, token: TOKEN, event, onResult: result => { writeAll(fd, JSON.stringify(result) + '\n'); finished++; if (finished % 4 === 0) console.log(JSON.stringify({ finished, total: rows.length })); } });
  } finally {
    // collectRows drains both workers before returning or throwing. Every installed
    // guard is cleaned up even if another cleanup reports an ownership violation.
    try { strictDns?.uninstall(); } finally { try { queryless?.uninstall(); } finally { try { guard?.uninstall(); } finally {
      try { if (fd !== undefined) fs.closeSync(fd); } finally { if (af !== undefined) fs.closeSync(af); syncDir(); if (priorTls === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = priorTls; }
    } } }
  }
  const receipt = { at: new Date().toISOString(), status: 'collection_finished_not_identity_approved', finished, total: rows.length, batch: BATCH, helperPins: HELPER_PINS, limits: LIMITS,
    helper_sha256: sha(fs.readFileSync(__filename)), output_sha256: sha(fs.readFileSync(out)), audit_sha256: sha(fs.readFileSync(audit)), guard: guard.stats, nativeGuard: queryless.stats, strictDnsGuard: strictDns.stats,
    readOnlyDiscovery: true, staleCatalog: true, databasePlanningAllowed: false, databaseMutationAllowed: false, requiresFreshCatalogBeforeAnyDatabasePlanOrApply: true,
    scope: '2 exact reviewed source merchant homepages; at most two observed first-party followups each. HTTPS GET only; no queries, credentials, cookies, auth, JS, product pipeline or database calls. No retries or resume.',
    fullCapture: 'Unchanged audited tenth collector retains full allowed raw HTML/static text; size, access, challenge and legal exclusions remain unchanged.' };
  exclusive(receiptFile, receipt); console.log(JSON.stringify(receipt)); return receipt;
}
module.exports = { BATCH, HELPER_PINS, LIMITS, OUTPUT, RECEIPT, RESERVATION, sha, assertReady, discoveryOnly, validateFrozenInputs, inputs, collectRows, main };
if (require.main === module) main().catch(e => { console.error(e.code || e.message); process.exitCode = 1; });
