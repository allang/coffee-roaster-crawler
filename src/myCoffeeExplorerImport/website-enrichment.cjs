'use strict';

// A deliberately separate, narrow importer: entities.website_url is its only write.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { assertAllowedUrl } = require('./legal-guard.cjs');
const SOURCE = 'my_coffee_explorer';
const KIND = 'reviewed_official_website_null_only_v1';
function configuration(base = process.env.MCE_WEBSITE_BASE || __dirname, cwd = process.cwd()) {
  const resolvedBase = path.resolve(cwd, base);
  return { BASE: resolvedBase, OUT: path.join(resolvedBase, 'continuation-websites'),
    LOCK: path.resolve(cwd, '.state/my-coffee-explorer/apply.lock') };
}
const { BASE, OUT, LOCK } = configuration();
const now = () => new Date().toISOString();
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
function fail(message) { throw new Error(message); }
function uuid(value) { if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) fail('Invalid entity/source row identifier'); return value; }
function url(value) {
  const u = assertAllowedUrl(value);
  if (u.username || u.password || u.hash || /\/(?:api|h2-console|auth|admin)(?:\/|$)/i.test(u.pathname)) fail('Unsafe website URL');
  return u.href;
}
function host(value) { return new URL(url(value)).hostname.toLowerCase().replace(/^www\./, ''); }
function sameFamily(a, b) { return a === b || a.endsWith('.' + b); }
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function freeze(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    if (hash(read(file)) !== hash(value)) fail('Refusing to replace frozen artifact: ' + path.basename(file));
    return;
  }
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}

function buildPlan(review, snapshot, mainPlanHash) {
  const selected = review.reviews.filter(r => r.status === 'verified_crawl_candidate');
  if (!selected.length || selected.length > 7 || new Set(selected.map(r => r.entity_id)).size !== selected.length) fail('Expected one to seven distinct reviewed candidates');
  const p = { version: 1, kind: KIND, source: SOURCE, snapshot_at: snapshot.at, review_at: review.reviewed_at,
    main_plan_hash: mainPlanHash, review_hash: hash(review), snapshot_hash: hash(snapshot),
    mutation_scope: 'Only entities.website_url, and only while SQL NULL. No role, source, location, name, or main-plan writes.',
    targets: [], held: [] };
  const roasters = new Set(snapshot.roles.filter(r => r.role === 'roaster').map(r => r.entity_id));
  for (const r of selected) {
    uuid(r.entity_id);
    const e = snapshot.entities.find(e => e.id === r.entity_id);
    if (!e || e.name !== r.name || !e.slug || !roasters.has(e.id)) fail('Reviewed identity or roaster role missing: ' + r.name);
    if (r.identity_verified !== true || r.roasting_verified !== true || r.existing_canonical_entity_id) fail('Candidate identity is not approved: ' + r.name);
    const official = url(r.official_website);
    if (url(r.crawl_website) !== official || !r.evidence || !r.evidence_urls?.length) fail('Missing website/citation review: ' + r.name);
    const citations = r.evidence_urls.map(v => url(v));
    if (citations.some(v => !sameFamily(host(v), host(official)))) fail('Citation is not on the reviewed official host: ' + r.name);
    if (!r.source_ids?.length || new Set(r.source_ids).size !== r.source_ids.length) fail('Missing/duplicate reviewed sources');
    const bindings = r.source_ids.map(sourceId => {
      const rows = snapshot.sourceIds.filter(s => s.source === SOURCE && s.source_id === sourceId);
      if (rows.length !== 1 || rows[0].entity_id !== e.id) fail('Source binding missing/ambiguous: ' + sourceId);
      const s = rows[0]; uuid(s.id);
      if (new URL(url(s.source_url)).hostname !== 'mycoffeeexplorer.com') fail('Unexpected source citation host');
      return { id: s.id, entity_id: s.entity_id, source: s.source, source_id: s.source_id, source_url: s.source_url };
    });
    const duplicates = snapshot.entities.filter(other => other.id !== e.id && roasters.has(other.id) && other.website_url && (() => {
      try { return host(other.website_url) === host(official); } catch { return false; }
    })());
    if (duplicates.length) { p.held.push({ entity_id: e.id, name: e.name, reason: 'other_existing_roaster_on_official_host', existing_entity_ids: duplicates.map(v => v.id) }); continue; }
    let disposition, expected;
    if (e.website_url === null) { disposition = 'patch_null'; expected = official; }
    else if (typeof e.website_url === 'string' && e.website_url && host(e.website_url) === host(official)) { disposition = 'preserve_existing_same_host'; expected = e.website_url; }
    else { p.held.push({ entity_id: e.id, name: e.name, reason: 'non_null_website_conflict', website_url: e.website_url }); continue; }
    p.targets.push({ entity_id: e.id, name: e.name, disposition,
      before: { id: e.id, name: e.name, slug: e.slug, website_url: e.website_url },
      after: { website_url: expected }, required_role: 'roaster', source_bindings: bindings,
      citation_review: { official_website: official, evidence_urls: citations, evidence: r.evidence, reviewed_at: review.reviewed_at, identity_verified: true, roasting_verified: true },
      crawl_target: { entity_id: e.id, website_url: expected, reason: 'reviewed_official_website_continuation', source_ids: bindings.map(s => ({ source: s.source, source_id: s.source_id })) } });
  }
  p.summary = { reviewed: selected.length, null_only_patches: p.targets.filter(t => t.disposition === 'patch_null').length,
    preserved_existing: p.targets.filter(t => t.disposition !== 'patch_null').length, held: p.held.length, separate_crawl_targets: p.targets.length };
  p.planHash = hash(p); return p;
}

function checkPlan(p, expectedHash) {
  const { planHash, ...body } = p;
  if (hash(body) !== planHash || (expectedHash && expectedHash !== planHash)) fail('Frozen plan hash mismatch');
  if (p.kind !== KIND || p.source !== SOURCE || !p.targets.length || p.targets.length > 7) fail('Wrong or unbounded website plan');
  if (new Set(p.targets.map(t => t.entity_id)).size !== p.targets.length) fail('Duplicate target');
  for (const t of p.targets) {
    uuid(t.entity_id); url(t.after.website_url);
    if (t.before.id !== t.entity_id || t.before.name !== t.name || !t.before.slug || t.required_role !== 'roaster') fail('Invalid frozen identity');
    if (Object.keys(t.after).join() !== 'website_url' || !t.source_bindings.length) fail('Wrong write scope');
    if (t.disposition === 'patch_null') { if (t.before.website_url !== null || t.after.website_url !== t.citation_review.official_website) fail('Not a NULL-only patch'); }
    else if (t.disposition !== 'preserve_existing_same_host' || t.after.website_url !== t.before.website_url || host(t.after.website_url) !== host(t.citation_review.official_website)) fail('Invalid preserved website');
    if (t.citation_review.identity_verified !== true || t.citation_review.roasting_verified !== true) fail('Unreviewed evidence');
    for (const u of t.citation_review.evidence_urls) { url(u); if (!sameFamily(host(u), host(t.citation_review.official_website))) fail('Unreviewed evidence host'); }
    for (const b of t.source_bindings) { uuid(b.id); url(b.source_url); if (b.entity_id !== t.entity_id || b.source !== SOURCE) fail('Wrong source binding'); }
    if (t.crawl_target.entity_id !== t.entity_id || t.crawl_target.website_url !== t.after.website_url) fail('Wrong crawl target');
  }
  return p;
}

// No arbitrary table or method is exposed. Redirects are rejected, not followed.
function restClient(env = process.env, fetchImpl = globalThis.fetch) {
  const origin = new URL(env.NEXT_PUBLIC_SUPABASE_URL || 'https://invalid.invalid');
  if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.supabase.co') || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || !env.SUPABASE_SERVICE_ROLE_KEY) fail('Expected configured hosted Supabase origin and service key');
  async function request(table, params, body) {
    if (!['entities', 'entity_roles', 'entity_source_ids'].includes(table) || (body && table !== 'entities')) fail('REST write scope violation');
    if (body && Object.keys(body).join() !== 'website_url') fail('Only website_url can be written');
    const u = new URL('/rest/v1/' + table, origin); for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    assertAllowedUrl(u);
    const response = await fetchImpl(u.href, { method: body ? 'PATCH' : 'GET', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(30000),
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
        'Cache-Control': 'no-cache', 'Content-Type': 'application/json', Prefer: 'return=representation' },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) fail('REST ' + (body ? 'PATCH' : 'GET') + ' ' + table + ' returned HTTP ' + response.status);
    const data = await response.json(); if (!Array.isArray(data)) fail('Unexpected REST row response'); return data;
  }
  return {
    async state(t) {
      const entities = await request('entities', { select: 'id,name,slug,website_url', id: 'eq.' + uuid(t.entity_id) });
      const roles = await request('entity_roles', { select: 'entity_id,role', entity_id: 'eq.' + t.entity_id });
      const sources = [];
      // Look up by source ID, NOT entity ID, so a moved binding is detected.
      for (const b of t.source_bindings) sources.push(...await request('entity_source_ids', { select: 'id,entity_id,source,source_id,source_url', source: 'eq.' + SOURCE, source_id: 'eq.' + b.source_id }));
      return { entity: entities.length === 1 ? entities[0] : null, roles, sources };
    },
    patch(t) {
      if (t.disposition !== 'patch_null' || t.before.website_url !== null) fail('Attempt to change non-NULL website');
      return request('entities', { select: 'id,name,slug,website_url', id: 'eq.' + uuid(t.entity_id), name: 'eq.' + t.before.name, slug: 'eq.' + t.before.slug, website_url: 'is.null' }, { website_url: t.after.website_url });
    }
  };
}

function validateState(t, state, final = false) {
  const e = state.entity;
  if (!e || ['id', 'name', 'slug'].some(k => e[k] !== t.before[k])) fail('Live identity changed: ' + t.name);
  if (!state.roles.some(r => r.entity_id === t.entity_id && r.role === 'roaster')) fail('Live roaster role missing: ' + t.name);
  for (const b of t.source_bindings) {
    const matches = state.sources.filter(s => s.source === b.source && s.source_id === b.source_id);
    if (matches.length !== 1 || Object.keys(b).some(k => matches[0][k] !== b[k])) fail('Live source binding changed: ' + b.source_id);
  }
  if (e.website_url === t.after.website_url) return 'satisfied';
  if (!final && t.disposition === 'patch_null' && e.website_url === null) return 'pending';
  fail('Live website conflict; preserved without overwrite: ' + t.name);
}

async function applyTarget(db, t, entry, save) {
  const live = await db.state(t); const state = validateState(t, live);
  if (state === 'pending') {
    entry.status = 'patch_intent'; entry.before = clone(live); entry.intent_at = now(); save();
    const changed = await db.patch(t);
    if (changed.length !== 1 || changed[0].id !== t.entity_id || changed[0].website_url !== t.after.website_url) fail('NULL-only CAS did not update exactly one expected entity: ' + t.name);
    entry.patch_returned_at = now(); save();
  } else entry.already_satisfied = true;
  // Always reread from REST, even on a completed checkpoint or a resume.
  const after = await db.state(t); validateState(t, after, true);
  entry.status = 'complete'; entry.after = clone(after); entry.verified_at = now(); save();
}

async function withLock(lock, planHash, fn) {
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const fd = fs.openSync(lock, 'wx', 0o600); const token = crypto.randomUUID();
  try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, kind: KIND, planHash, token, startedAt: now() })); return await fn(); }
  finally { fs.closeSync(fd); if (fs.existsSync(lock) && read(lock).token === token) fs.unlinkSync(lock); }
}
async function verify(db, p) {
  const rows = [];
  for (const t of p.targets) { const state = await db.state(t); validateState(t, state, true); rows.push({ entity_id: t.entity_id, website_url: state.entity.website_url, verified_role: 'roaster', verified_source_ids: state.sources.map(s => s.source_id) }); }
  return { at: now(), planHash: p.planHash, status: 'verified', verified: rows.length, failures: [], rows };
}
async function applyPlan(db, p, directory, lock = LOCK) {
  checkPlan(p);
  return withLock(lock, p.planHash, async () => {
    const file = path.join(directory, 'checkpoint.json');
    const cp = fs.existsSync(file) ? read(file) : { planHash: p.planHash, started_at: now(), entries: {} };
    if (cp.planHash !== p.planHash) fail('Checkpoint plan mismatch');
    const save = () => atomic(file, cp);
    // A failed rerun must not leave a previous successful target list looking current.
    atomic(path.join(directory, 'verification.json'), { at: now(), planHash: p.planHash, status: 'checking', verified: 0 });
    atomic(path.join(directory, 'verified-crawl-targets.json'), { planHash: p.planHash, status: 'NOT_READY_UNTIL_LIVE_VERIFICATION', targets: [] });
    // All targets preflight before the first patch, and each is checked again immediately before PATCH.
    for (const t of p.targets) validateState(t, await db.state(t));
    save();
    for (const t of p.targets) {
      const entry = cp.entries[t.entity_id] ||= {};
      try { await applyTarget(db, t, entry, save); }
      catch (error) { entry.status = 'failed'; entry.error = error.message; entry.failed_at = now(); save(); throw error; }
    }
    const result = await verify(db, p);
    atomic(path.join(directory, 'verification.json'), result);
    atomic(path.join(directory, 'verified-crawl-targets.json'), { planHash: p.planHash, status: 'verified', verified_at: result.at, targets: p.targets.map(t => t.crawl_target) });
    cp.completed_at = now(); save(); return result;
  });
}

async function main() {
  const [command = 'plan', expectedHash] = process.argv.slice(2);
  if (command === 'plan') {
    const review = read(path.join(BASE, 'continuation-websites.json'));
    const snapshot = read(path.join(BASE, 'current-snapshot.json'));
    const mainPlan = read(path.join(BASE, 'plan.json'));
    const p = checkPlan(buildPlan(review, snapshot, mainPlan.planHash));
    freeze(path.join(OUT, 'plan.json'), p);
    freeze(path.join(OUT, 'before-after.json'), { planHash: p.planHash, rows: p.targets.map(t => ({ entity_id: t.entity_id, name: t.name, disposition: t.disposition, before: t.before, after: t.after })), held: p.held });
    freeze(path.join(OUT, 'planned-crawl-targets.json'), { planHash: p.planHash, status: 'NOT_READY_UNTIL_LIVE_VERIFICATION', targets: p.targets.map(t => t.crawl_target) });
    console.log(JSON.stringify({ planHash: p.planHash, ...p.summary, applied: false })); return;
  }
  if (!['preflight', 'apply', 'verify'].includes(command)) fail('Expected plan, preflight, apply, or verify');
  if (!expectedHash) fail('Pass the exact frozen plan hash as the second argument');
  const p = checkPlan(read(path.join(OUT, 'plan.json')), expectedHash); const db = restClient();
  if (command === 'preflight') {
    const rows = [];
    for (const t of p.targets) rows.push({ entity_id: t.entity_id, state: validateState(t, await db.state(t)) });
    console.log(JSON.stringify({ planHash: p.planHash, read_only: true, rows })); return;
  }
  const result = command === 'apply' ? await applyPlan(db, p, OUT) : await verify(db, p);
  console.log(JSON.stringify({ planHash: result.planHash, verified: result.verified, failures: result.failures.length }));
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { buildPlan, checkPlan, validateState, applyTarget, applyPlan, withLock, restClient, hash, clone, verify, configuration };
