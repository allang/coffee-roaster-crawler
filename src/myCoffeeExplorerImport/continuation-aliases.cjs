'use strict';

// Independent, narrowly scoped correction ledger. Never revises an import plan.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { checkPlan } = require('./import.cjs');
const SOURCE = 'my_coffee_explorer';
const TAG = 'continuation_verified_profile_aliases_v1';
const MAIN_HASH = '53b1d00a4c7112108dacd46e91c42174c8fd4262480e6b6987c8d8ef112ff2c3';
const DEFINITIONS = [
  { entity_id: '6fa75d4d-68f1-4cb9-b9b4-02e11cba6889', name: '[CxT] Roasting Company', canonical_entity_id: 'adf17aa4-222e-4734-bb8a-77f6cea3c300', canonical_name: 'CxT Roasting', host: 'cxt.coffee', source_id: 'roaster:cxt-roasting-company' },
  { entity_id: '62ade2dd-ec98-43dc-b9ac-134cfaf3cf29', name: 'A Roaster Called Revenant', canonical_entity_id: 'cbebd30f-5ccb-4f25-bbf3-447d7506484e', canonical_name: 'Revenant Coffee', host: 'revenant.coffee', source_id: 'roaster:a-roaster-called-revenant' },
  { entity_id: '8923d2ad-950e-41f6-9d65-e8b4566e37b4', name: 'A&E Coffee Roastery', canonical_entity_id: '2e273897-d7b0-4683-811a-9ee022575ac1', canonical_name: 'Rare Breed Coffee', host: 'rarebreedcoffee.com', source_id: 'roaster:ae-coffee-roastery' },
];
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const sha = v => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const ordered = v => Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, ordered(v[k])])) : v;
const equal = (a, b) => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
const host = url => { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } };
const fail = message => { throw new Error(message); };
function write(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, file);
}
function checkFrozen(frozen) {
  const { manifestHash, ...body } = frozen;
  if (sha(body) !== manifestHash || frozen.tag !== TAG || frozen.mainPlanHash !== MAIN_HASH || !equal(frozen.definitions, DEFINITIONS)) fail('Frozen correction manifest mismatch');
}
function ownRole(row, frozen) {
  const m = row.role_metadata, provenance = m?.provenance, directories = provenance?.public_directories, own = directories?.[SOURCE];
  if (!m || Object.keys(m).join(',') !== 'provenance' || Object.keys(provenance).join(',') !== 'public_directories' || Object.keys(directories).join(',') !== SOURCE || !own || Object.keys(own).join(',') !== 'imported_at') fail('HOLD: role metadata is not solely this import');
  const at = Date.parse(own.imported_at);
  if (!Number.isFinite(at) || at < Date.parse(frozen.mainPlannedAt) || at > Date.parse(frozen.mainVerifiedAt)) fail('HOLD: role timestamp is outside this import');
}
function validateObserved(observed, frozen, initial = false) {
  if (observed.products.length) fail('HOLD: alias has a product');
  if (observed.crawlRuns.length) fail('HOLD: alias has crawl history');
  if (observed.locations.length) fail('HOLD: alias has a location');
  const states = [];
  for (const def of DEFINITIONS) {
    const e = observed.entities.find(x => x.id === def.entity_id), c = observed.entities.find(x => x.id === def.canonical_entity_id);
    const planned = frozen.actions.find(a => a.entity_id === def.entity_id);
    if (!e || e.name !== def.name || e.slug !== planned.entity.slug || e.website_url || e.primary_location || e.google_place_id) fail(`HOLD: alias identity/enrichment changed: ${def.entity_id}`);
    if (!initial && !equal(e, frozen.before.entities.find(x => x.id === e.id))) fail(`HOLD: alias fields changed after audit: ${e.id}`);
    if (!c || c.name !== def.canonical_name || host(c.website_url) !== def.host || !observed.roles.some(x => x.entity_id === c.id && x.role === 'roaster')) fail(`HOLD: canonical identity/role changed: ${def.canonical_entity_id}`);
    const roles = observed.roles.filter(x => x.entity_id === e.id);
    if (roles.length > 1 || roles.some(x => x.role !== 'roaster')) fail('HOLD: alias acquired another role');
    if (roles.length) {
      ownRole(roles[0], frozen);
      if (!initial && !equal(roles[0], frozen.before.roles.find(x => x.entity_id === e.id && x.role === 'roaster'))) fail('HOLD: alias role changed after audit');
    }
    const ownSources = observed.aliasSources.filter(x => x.entity_id === e.id);
    if (ownSources.some(x => x.source !== SOURCE || x.source_id !== def.source_id)) fail('HOLD: alias has an unreviewed source association');
    const rows = observed.sourceRows.filter(x => x.source === SOURCE && x.source_id === def.source_id);
    if (rows.length !== 1 || ![e.id, c.id].includes(rows[0].entity_id)) fail('HOLD: exact source has unexpected owner');
    const source = rows[0];
    if (!initial) {
      const prior = frozen.before.sourceRows.find(x => x.source_id === def.source_id);
      const strip = ({ entity_id, ...rest }) => rest;
      if (!prior || !equal(strip(prior), strip(source))) fail('HOLD: source data changed after audit');
    }
    const attrs = observed.attributes.filter(x => x.entity_id === e.id);
    if (attrs.length > 1 || attrs.some(x => x.attribute_key !== 'canonical_roaster_entity_id' || x.attribute_value !== c.id || x.source !== SOURCE)) fail('HOLD: alias has foreign/conflicting attributes');
    if (initial && (!roles.length || source.entity_id !== e.id || attrs.length || ownSources.length !== 1)) fail('HOLD: initial state is not an untouched import-created alias');
    if (source.entity_id === c.id && !attrs.length) fail('HOLD: reparented source lacks this correction binding');
    if (!roles.length && (source.entity_id !== c.id || !attrs.length)) fail('HOLD: retired role without completed source binding');
    states.push({ def, source, role: roles[0] || null, attribute: attrs[0] || null, complete: !roles.length && source.entity_id === c.id && attrs.length === 1 });
  }
  return states;
}
function verifyObserved(observed, frozen) {
  const states = validateObserved(observed, frozen);
  if (states.some(s => !s.complete)) fail('Correction has not reached all required postconditions');
  return { verified: states.length, entitiesRetained: states.length, sourcesReassigned: states.length, ownRoasterRolesRemoved: states.length };
}
function buildFrozen(inputs, observed) {
  const { main, verification, baseline, review, protectedHashes } = inputs;
  checkPlan(main);
  if (main.planHash !== MAIN_HASH || verification.planHash !== MAIN_HASH || verification.verified !== main.actions.length || verification.expected !== main.actions.length || !Array.isArray(verification.failures) || verification.failures.length) fail('Exact completed main plan verification required');
  if (review.main_plan_hash !== MAIN_HASH || review.candidates.length !== 3) fail('Unexpected reviewed correction set');
  const actions = DEFINITIONS.map(d => {
    const reviewed = review.candidates.find(r => r.alias_entity_id === d.entity_id && r.canonical_entity_id === d.canonical_entity_id);
    const a = main.actions.find(x => x.entity_id === d.entity_id);
    if (!reviewed?.evidence || !a || a.action !== 'create' || a.roles.join(',') !== 'roaster' || a.newRoles.join(',') !== 'roaster' || a.locations.length || Object.keys(a.patch).length || a.sources.length !== 1 || a.sources[0].source !== SOURCE || a.sources[0].source_id !== d.source_id || a.crawlWebsite) fail('Correction is not an exact reviewed profile-only create');
    if (baseline.entities.some(x => x.id === d.entity_id) || !baseline.roles.some(x => x.entity_id === d.canonical_entity_id && x.role === 'roaster')) fail('Correction does not preserve baseline identities/roles');
    return a;
  });
  const frozen = { version: 1, tag: TAG, createdAt: new Date().toISOString(), mainPlanHash: MAIN_HASH, mainPlannedAt: main.plannedAt, mainVerifiedAt: verification.at, protectedHashes, definitions: DEFINITIONS, reviewHash: sha(review), actions, before: observed };
  validateObserved(observed, frozen, true);
  frozen.manifestHash = sha(frozen);
  return frozen;
}
async function observedState(db) {
  const ids = DEFINITIONS.map(d => d.entity_id), allIds = [...ids, ...DEFINITIONS.map(d => d.canonical_entity_id)];
  const q = async request => { const { data, error } = await request; if (error) throw error; return data; };
  const [entities, roles, aliasSources, sourceRows, attributes, locations, products, crawlRuns] = await Promise.all([
    q(db.from('entities').select('*').in('id', allIds)),
    q(db.from('entity_roles').select('*').in('entity_id', allIds)),
    q(db.from('entity_source_ids').select('*').in('entity_id', ids)),
    q(db.from('entity_source_ids').select('*').eq('source', SOURCE).in('source_id', DEFINITIONS.map(d => d.source_id))),
    q(db.from('entity_attributes').select('*').in('entity_id', ids)),
    q(db.from('entity_locations').select('*').in('entity_id', ids)),
    q(db.from('products').select('id,entity_id').in('entity_id', ids).limit(1)),
    q(db.from('crawl_runs').select('id,entity_id,status').in('entity_id', ids).limit(1)),
  ]);
  if ([entities, roles, aliasSources, sourceRows, attributes, locations].some(rows => rows.length >= 1000)) fail('Preflight may be truncated; no correction allowed');
  return { entities, roles, aliasSources, sourceRows, attributes, locations, products, crawlRuns };
}
function protectedFiles(base) {
  const names = ['plan.json', 'checkpoint.json', 'verification.json', 'profile-aliases.json'];
  for (const dir of ['before-alias-reconciliation', 'before-source-binding-correction']) {
    const visit = rel => { const full = path.join(base, rel); if (!fs.existsSync(full)) return; for (const item of fs.readdirSync(full, { withFileTypes: true })) { const child = path.join(rel, item.name); if (item.isDirectory()) visit(child); else if (item.isFile()) names.push(child); } };
    visit(dir);
  }
  return Object.fromEntries(names.map(name => { const file = path.join(base, name); if (!fs.existsSync(file)) fail(`Missing protected artifact: ${name}`); return [name, sha(fs.readFileSync(file, 'utf8'))]; }));
}
async function main() {
  const [mode, suppliedBase] = process.argv.slice(2);
  if (!['preview', 'apply', 'verify'].includes(mode) || process.argv.length > 4) fail('preview|apply|verify [BASE]');
  const base = path.resolve(suppliedBase || __dirname), out = path.join(base, 'continuation-alias-recovery-v1');
  const frozenFile = path.join(out, 'frozen.json'), checkpointFile = path.join(out, 'checkpoint.json');
  const lock = path.resolve('.state/my-coffee-explorer/apply.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const fd = fs.openSync(lock, 'wx', 0o600);fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, operation: TAG, mode, at: new Date().toISOString() }));
  try {
    const { createClient } = require('@supabase/supabase-js');
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const q = async request => { const { data, error } = await request; if (error) throw error; return data; };
    const protectedNow = protectedFiles(base);
    let frozen;
    if (fs.existsSync(frozenFile)) { frozen = read(frozenFile);checkFrozen(frozen);if (!equal(protectedNow, frozen.protectedHashes)) fail('Protected main/completed correction artifacts changed'); }
    else {
      if (mode === 'verify') fail('No frozen correction exists');
      frozen = buildFrozen({ main: read(path.join(base, 'plan.json')), verification: read(path.join(base, 'verification.json')), baseline: read(path.join(base, 'snapshot.json')), review: read(path.join(base, 'continuation-alias-review.json')), protectedHashes: protectedNow }, await observedState(db));
    }
    let current = await observedState(db), states = validateObserved(current, frozen);
    if (mode === 'preview') { console.log(JSON.stringify({ mode, tag: TAG, manifestHash: frozen.manifestHash, candidates: states.map(s => ({ alias: s.def.entity_id, canonical: s.def.canonical_entity_id, complete: s.complete })), mainPlanUnchanged: equal(protectedFiles(base), protectedNow) }));return; }
    if (mode === 'verify') { const verification = verifyObserved(current, frozen);if (!equal(protectedFiles(base), protectedNow)) fail('Protected artifacts changed during verification');console.log(JSON.stringify({ mode, manifestHash: frozen.manifestHash, ...verification }));return; }
    fs.mkdirSync(out, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(frozenFile)) write(frozenFile, frozen);
    const checkpoint = fs.existsSync(checkpointFile) ? read(checkpointFile) : { tag: TAG, manifestHash: frozen.manifestHash, steps: [], status: 'prepared' };
    if (checkpoint.manifestHash !== frozen.manifestHash || checkpoint.tag !== TAG) fail('Correction checkpoint mismatch');
    if (checkpoint.status === 'complete') { const verification = verifyObserved(current, frozen);console.log(JSON.stringify({ mode, alreadyComplete: true, ...verification }));return; }
    const save = (def, step) => { checkpoint.steps.push({ entity_id: def.entity_id, step, at: new Date().toISOString() });checkpoint.status = 'mutating';write(checkpointFile, checkpoint); };
    write(checkpointFile, checkpoint);
    for (const def of DEFINITIONS) {
      if (!equal(protectedFiles(base), protectedNow)) fail('Protected artifacts changed during correction');
      // Re-read safety gates immediately before each candidate, including retries.
      states = validateObserved(await observedState(db), frozen);
      let state = states.find(s => s.def.entity_id === def.entity_id);
      if (!state.attribute) {
        await q(db.from('entity_attributes').upsert({ entity_id: def.entity_id, attribute_key: 'canonical_roaster_entity_id', attribute_value: def.canonical_entity_id, source: SOURCE }, { onConflict: 'entity_id,attribute_key', ignoreDuplicates: true }));
        states = validateObserved(await observedState(db), frozen);state = states.find(s => s.def.entity_id === def.entity_id);
        if (!state.attribute) fail('Canonical attribute was not established');save(def, 'canonical_attribute');
      }
      if (state.source.entity_id === def.entity_id) {
        const changed = await q(db.from('entity_source_ids').update({ entity_id: def.canonical_entity_id }).eq('id', state.source.id).eq('source', SOURCE).eq('source_id', def.source_id).eq('entity_id', def.entity_id).select('id'));
        if (changed.length !== 1) fail('Exact source owner changed concurrently');save(def, 'source_reassigned');
      }
      // Fresh products/crawls/attributes/source/metadata check before role retirement.
      states = validateObserved(await observedState(db), frozen);state = states.find(s => s.def.entity_id === def.entity_id);
      if (state.role) {
        const removed = await q(db.from('entity_roles').delete().eq('entity_id', def.entity_id).eq('role', 'roaster').eq('role_metadata', JSON.stringify(state.role.role_metadata)).select('entity_id'));
        if (removed.length !== 1) fail('Import-owned role changed concurrently');save(def, 'own_roaster_role_retired');
      }
    }
    const verification = verifyObserved(await observedState(db), frozen);
    if (!equal(protectedFiles(base), protectedNow)) fail('Protected artifacts changed during correction');
    write(path.join(out, 'verification.json'), { at: new Date().toISOString(), tag: TAG, manifestHash: frozen.manifestHash, mainPlanHash: MAIN_HASH, ...verification, protectedArtifactsUnchanged: true, historicalMainExceptions: DEFINITIONS.map(d => ({ entity_id: d.entity_id, retired_role: 'roaster', source_id: d.source_id, current_source_owner: d.canonical_entity_id })) });
    checkpoint.status = 'complete';checkpoint.completedAt = new Date().toISOString();write(checkpointFile, checkpoint);
    console.log(JSON.stringify({ mode, manifestHash: frozen.manifestHash, ...verification, mainPlanUnchanged: true }));
  } finally { fs.closeSync(fd);fs.unlinkSync(lock); }
}
if (require.main === module) main().catch(error => { console.error(error.stack);process.exitCode = 1; });
module.exports = { validateObserved, verifyObserved, buildFrozen, checkFrozen, DEFINITIONS };
