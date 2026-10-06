'use strict';
// Offline evidence comparator only. No database client, requests, identity decisions or merges.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { isDeepStrictEqual: equal } = require('node:util');
const BASE = __dirname, MAX_CANDIDATES = 32, MAX_MATCHES = 2000, MAX_OUTPUT = 32 * 1024 * 1024;
const PINS = Object.freeze({
  'snapshot-sequential-v3.cjs': '9bff32ee4385d40792431d1b1f8c1822e2f801db7497064d5f197ba7ccd05daa',
  'import.cjs': 'd423c2ce40dd10fb69576131ab833e6180ea8c10d1f5e880b12b7583af4bb2d3',
});
const SHA = /^[a-f0-9]{64}$/, UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function must(ok, code) { if (!ok) throw new Error(code); }
function dependencies() {
  for (const [f, pin] of Object.entries(PINS)) must(sha(fs.readFileSync(path.join(BASE, f))) === pin, 'dependency_changed:' + f);
  return { ...require('./snapshot-sequential-v3.cjs'), indexSnapshot: require('./import.cjs').indexSnapshot };
}
// Adapted from reconcile-pending33-fresh: Unicode name keys are matching cues, not aliases.
function norm(s) { return String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
const GENERIC = /\b(?:and|coffees?|co|company|roasting|roasters?|roastery|roasterie|cafes?|caffe|cafeteria|shop|house|llc|inc|ltd|the|kaffee|kaffeerosterei|tostadores?|torrefaction|torrefacteur|torrefazione|brulerie|specialty|speciality|online|s r l)\b/g;
function nameKeys(s) {
  const full = norm(s), core = full.replace(GENERIC, ' ').replace(/\s+/g, ' ').trim();
  return Object.entries({ normalized_name: full, compact_name: full.replace(/ /g, ''), core_name: core.replace(/ /g, ''), core_token_set: core.split(' ').sort().join(' ') })
    .filter(([, k]) => k.replace(/ /g, '').length >= 3).map(([kind, value]) => ({ kind, value }));
}
function host(s) {
  if (typeof s !== 'string' || !s.trim()) return null;
  try { const u = new URL(/^[a-z]+:\/\//i.test(s) ? s : 'https://' + s); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null; return u.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, ''); } catch { return null; }
}
const relatedHost = (a, b) => !!a && !!b && (a === b || a.endsWith('.' + b) || b.endsWith('.' + a));
const excludedHostCue = h => h.include_in_owner_host_matching === false || /generic_contact_email_provider|dated_multibrand_retailer/.test(h.kind);
const phraseIn = (value, phrase) => !!phrase && (' ' + norm(value) + ' ').includes(' ' + norm(phrase) + ' ');
function localFile(base, rel) {
  must(typeof rel === 'string' && rel && !path.isAbsolute(rel) && !rel.split(/[\\/]/).includes('..'), 'relative_local_path_required');
  const p = fs.realpathSync(path.join(base, rel)), root = fs.realpathSync(base);
  must(p.startsWith(root + path.sep), 'path_outside_evidence_base'); return p;
}
function readFile(base, rel, hashes, expected) {
  if (expected !== undefined) must(SHA.test(expected), 'invalid_sha_pin');
  const f = localFile(base, rel); must(fs.statSync(f).isFile(), 'regular_file_required');
  const b = fs.readFileSync(f), h = sha(b); must(!expected || h === expected, 'pinned_file_changed:' + rel);
  must(!hashes[rel] || hashes[rel] === h, 'file_changed_during_comparison:' + rel); hashes[rel] = h; return b;
}
function pointer(value, p) {
  must(typeof p === 'string' && p.startsWith('/'), 'invalid_pointer');
  return p.split('/').slice(1).reduce((v, k) => v?.[k.replace(/~1/g, '/').replace(/~0/g, '~')], value);
}
function validateCandidate(c) {
  must(c && typeof c.key === 'string' && c.key && typeof c.review_display_name === 'string', 'invalid_candidate');
  must(Array.isArray(c.literal_public_names) && c.literal_public_names.length > 0 && c.literal_public_names.every(n => typeof n.text === 'string' && n.text.trim()), 'literal_names_required');
  must(Array.isArray(c.comparison_name_tokens) && c.comparison_name_tokens.every(n => typeof n === 'string' && n.trim()), 'invalid_name_cues');
  must(typeof c.exact_source_key?.source === 'string' && c.exact_source_key.source && typeof c.exact_source_key.source_id === 'string' && c.exact_source_key.source_id, 'source_key_required');
  must(Array.isArray(c.host_cues) && c.host_cues.every(h => host(h.host) && typeof h.kind === 'string'), 'invalid_host_cues');
  must(Array.isArray(c.pages) && c.pages.length > 0 && Array.isArray(c.original_source_product_proofs), 'source_proofs_required');
  must((c.existing_candidate_entity_ids || []).every(id => UUID.test(id)), 'invalid_prior_identity_id');
  for (const a of [c.address, ...(c.addresses || [])].filter(Boolean)) {
    must((a.literal === null || typeof a.literal === 'string') && Array.isArray(a.tokens) && a.tokens.every(t => typeof t === 'string') && Array.isArray(a.unit_tokens || []), 'invalid_address_cues');
  }
}
function loadIntake(base, file, pin, hashes) {
  const intake = JSON.parse(readFile(base, file, hashes, pin));
  must(intake.version === 1 && intake.status === 'DATA_ONLY_FRESH_IDENTITY_COMPARISON_INTAKE', 'unsupported_intake_schema');
  must(intake.input_pins && typeof intake.input_pins === 'object' && !Array.isArray(intake.input_pins), 'input_pins_required');
  must(Array.isArray(intake.candidates) && intake.candidates.length > 0 && intake.candidates.length <= MAX_CANDIDATES, 'invalid_candidate_count');
  const content = new Map();
  for (const [f, h] of Object.entries(intake.input_pins)) content.set(f, readFile(base, f, hashes, h));
  const collections = [...content.keys()].filter(f => /-discovery\.ndjson$/.test(f)); must(collections.length === 1, 'one_pinned_collection_required');
  const collection = collections[0], lines = content.get(collection).toString('utf8').trim().split('\n').map(JSON.parse);
  const fragment = p => {
    must(p && Number.isInteger(p.collection_line) && p.collection_line > 0 && p.collection_line <= lines.length, 'invalid_fragment_line');
    const text = pointer(lines[p.collection_line - 1], p.pointer);
    must(typeof text === 'string' && Number.isInteger(p.utf16_offset) && p.utf16_offset >= 0 && Number.isInteger(p.utf16_length) && p.utf16_length > 0 && p.utf16_offset + p.utf16_length <= text.length, 'invalid_fragment_range');
    const value = text.slice(p.utf16_offset, p.utf16_offset + p.utf16_length); must(sha(value) === p.sha256, 'fragment_hash_mismatch'); return value;
  };
  for (const c of intake.candidates) {
    validateCandidate(c);
    for (const n of c.literal_public_names) must(fragment(n.proof) === n.text, 'literal_name_proof_mismatch');
    for (const h of c.host_cues) if (h.proof) fragment(h.proof);
    for (const a of [c.address, ...(c.addresses || [])].filter(Boolean)) if (a.proof) fragment(a.proof);
    for (const p of c.pages) {
      const page = pointer(lines[p.collection_line - 1], p.pointer);
      must(page?.status === 200 && page.captureComplete === true && page.truncated === false, 'incomplete_source_page');
      must(page.requestedUrl === p.requested_url && page.finalUrl === p.final_url, 'source_page_url_mismatch');
      must(sha(page.rawHtml) === p.raw_html_sha256 && sha(page.staticBodyText) === p.static_text_sha256, 'source_page_hash_mismatch');
    }
    for (const { row, proof } of c.original_source_product_proofs) {
      must(content.has(proof.file) && intake.input_pins[proof.file] === proof.sha256, 'product_proof_not_pinned');
      const actual = pointer(JSON.parse(content.get(proof.file)), proof.pointer);
      for (const k of ['id', 'productId', 'name', 'brand', 'productUrl']) must(actual?.[k] === row[k], 'product_source_row_mismatch');
    }
  }
  return { file, sha256: pin, collection, intake };
}
function planInventory(base) {
  return ['plan.json', ...fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory() && fs.existsSync(path.join(base, d.name, 'plan.json'))).map(d => d.name + '/plan.json')]
    .filter(f => fs.existsSync(path.join(base, f))).sort();
}
function canonicalIndex(snapshot) {
  const forward = new Map(snapshot.canonicalLinks.map(r => [r.entity_id, r.attribute_value])), inbound = new Map();
  for (const r of snapshot.canonicalLinks) { if (!inbound.has(r.attribute_value)) inbound.set(r.attribute_value, []); inbound.get(r.attribute_value).push(r.entity_id); }
  return { forward, inbound, component(id) {
    const seen = new Set(), pending = [id];
    while (pending.length) { const n = pending.pop(); if (seen.has(n)) continue; seen.add(n); if (forward.has(n)) pending.push(forward.get(n)); pending.push(...inbound.get(n) || []); }
    const chain = [id]; while (forward.has(chain.at(-1))) { const n = forward.get(chain.at(-1)); must(!chain.includes(n), 'canonical_cycle'); chain.push(n); }
    return { root_entity_id: chain.at(-1), forward_chain: chain, member_ids: [...seen].sort(), links: snapshot.canonicalLinks.filter(r => seen.has(r.entity_id)) };
  } };
}
function compare(snapshot, candidates, plans = [], snapshotFile = 'snapshot.json') {
  const deps = dependencies(); deps.crossTableIntegrity(snapshot);
  must(candidates.length > 0 && candidates.length <= MAX_CANDIDATES && new Set(candidates.map(c => c.key)).size === candidates.length, 'duplicate_or_invalid_candidate_set');
  candidates.forEach(validateCandidate);
  const ix = deps.indexSnapshot(snapshot), sources = new Map(), bySourceOwner = new Map(), entries = new Map(), aliasBindings = [];
  for (const s of snapshot.sourceIds) {
    sources.set(JSON.stringify([s.source, s.source_id]), s); if (!bySourceOwner.has(s.entity_id)) bySourceOwner.set(s.entity_id, []); bySourceOwner.get(s.entity_id).push(s);
  }
  function addName(e, name, proof) { if (typeof name === 'string' && name.trim()) e.names.push({ name, keys: nameKeys(name), proof }); }
  function addHost(e, value, proof) { const h = host(value); if (h) e.hosts.push({ host: h, proof }); }
  for (const e of ix.byId.values()) {
    const item = { entity: e, names: [], hosts: [] }; entries.set(e.id, item);
    addName(item, e.name, { file: snapshotFile, kind: 'snapshot_entity_name', entity_id: e.id });
    addHost(item, e.website_url, { file: snapshotFile, kind: 'snapshot_entity_website', entity_id: e.id });
  }
  for (const s of snapshot.sourceIds) {
    const e = entries.get(s.entity_id), proof = { file: snapshotFile, kind: 'snapshot_source_binding', source_row_id: s.id, source: s.source, source_id: s.source_id };
    addHost(e, s.source_url, proof);
    if (s.source === 'my_coffee_explorer') {
      const m = /^roaster:(?:public-catalog|price-brand):(.+)$/.exec(s.source_id);
      if (m) addHost(e, m[1], proof); else if (s.source_id.startsWith('roaster:')) addName(e, s.source_id.slice(8).replace(/-/g, ' '), { ...proof, kind: 'source_slug_name_caution' });
    }
  }
  let skippedUnownedPlanSources = 0;
  for (const { file, plan } of plans) for (const [ai, a] of (plan.actions || []).entries()) for (const [si, s] of (a.sources || []).entries()) {
    const owned = sources.get(JSON.stringify([s.source || 'my_coffee_explorer', s.source_id]));
    if (!owned) { skippedUnownedPlanSources++; continue; }
    const e = entries.get(owned.entity_id), raw = s.raw_data || {};
    const proof = { file, pointer: `/actions/${ai}/sources/${si}/raw_data`, kind: 'retained_plan_alias_current_source_owned', source_row_id: owned.id, source: owned.source, source_id: owned.source_id, current_entity_id: owned.entity_id, historical_entity_id: a.entity_id || null, historical_owner_differs: !!a.entity_id && a.entity_id !== owned.entity_id };
    for (const k of ['name', 'sourceBrandLabel', 'candidate_name', 'canonical_name', 'current_name']) addName(e, raw[k], { ...proof, field: k });
    for (const k of ['acceptedSourceBrandAliases', 'declared_aliases', 'aliases']) if (Array.isArray(raw[k])) for (const n of raw[k]) addName(e, n, { ...proof, field: k });
    for (const k of ['websiteUrl', 'accepted_website', 'website_url', 'current_website_url']) addHost(e, raw[k], { ...proof, field: k });
    aliasBindings.push(proof);
  }
  const canon = canonicalIndex(snapshot);
  function detail(id, basis) {
    const e = entries.get(id).entity;
    return { entity_id: id, entity: Object.fromEntries(Object.entries(e).filter(([k]) => !['roles', 'locations'].includes(k))), roles: [...e.roles].sort(), locations: e.locations, source_bindings: bySourceOwner.get(id) || [], basis, canonical: canon.component(id) };
  }
  const rows = candidates.map(c => {
    const found = new Map(), add = (id, reason) => { must(entries.has(id), 'matched_entity_missing'); if (!found.has(id)) found.set(id, []); found.get(id).push(reason); must(found.size <= MAX_MATCHES, 'match_bound_exceeded_not_truncated'); };
    const names = [...new Set(c.literal_public_names.map(n => n.text))], keys = names.flatMap(name => nameKeys(name).map(k => ({ ...k, candidate_name: name })));
    const terms = [...new Set(c.comparison_name_tokens.map(norm))].filter(t => t.replace(/ /g, '').length >= 3);
    const excludedHosts = c.host_cues.filter(excludedHostCue);
    const hosts = c.host_cues.filter(h => !excludedHosts.includes(h)).map(h => ({ ...h, normalized_host: host(h.host) }));
    const addresses = [c.address, ...(c.addresses || [])].filter(a => a && (a.literal || a.tokens.length));
    for (const [id, e] of entries) {
      for (const n of e.names) {
        const shared = keys.filter(k => n.keys.some(x => x.kind === k.kind && x.value === k.value));
        if (shared.length) add(id, { kind: 'name_key_match_not_identity', alias: n.name, proof: n.proof, candidate_keys: shared });
        const partial = terms.filter(t => phraseIn(n.name, t));
        if (partial.length && !shared.length) add(id, { kind: 'name_token_caution_not_identity', alias: n.name, proof: n.proof, candidate_terms: partial });
      }
      for (const h of e.hosts) for (const ch of hosts) if (relatedHost(h.host, ch.normalized_host)) add(id, { kind: 'host_family_caution_not_identity', candidate_host: ch.host, candidate_host_kind: ch.kind, current_host: h.host, proof: h.proof, contact_only: /contact_email/.test(ch.kind), alias_asserted: false });
      const locations = [{ id: null, text: e.entity.primary_location, field: 'entity.primary_location' }, ...e.entity.locations.map(l => ({ id: l.id, text: [l.label, l.address1, l.address2, l.city, l.region, l.postal_code, l.country].filter(Boolean).join(' '), field: 'entity_locations' }))];
      for (const a of addresses) for (const l of locations) {
        const matched = (a.tokens || []).filter(t => norm(t).length >= 3 && phraseIn(l.text, t));
        const units = (a.unit_tokens || []).filter(t => phraseIn(l.text, t));
        const literal = !!a.literal && phraseIn(l.text, a.literal);
        if (literal || matched.length) add(id, { kind: 'address_cue_not_identity', candidate_address: a.literal, location_id: l.id, location_field: l.field, matched_tokens: matched, matched_unit_tokens: units, normalized_literal_contained: literal });
      }
    }
    const owned = sources.get(JSON.stringify([c.exact_source_key.source, c.exact_source_key.source_id]));
    if (owned) add(owned.entity_id, { kind: 'exact_source_key_owner', source_row: owned });
    const missingPriorIds = [];
    for (const id of c.existing_candidate_entity_ids || []) if (entries.has(id)) add(id, { kind: 'retained_identity_id_caution' }); else missingPriorIds.push(id);
    const directIds = [...found.keys()].sort();
    for (const id of directIds) for (const related of canon.component(id).member_ids) if (related !== id) add(related, { kind: 'canonical_closure_from_match', matched_entity_id: id });
    return { key: c.key, name: c.review_display_name, exact_source_key: c.exact_source_key, current_source_owner: owned || null,
      names_checked: names, name_tokens_checked: terms, host_cues_checked: hosts, host_cues_excluded: excludedHosts, addresses_checked: addresses,
      operator_claim: c.operator_claim || null, intake_cautions: c.cautions || [], missing_retained_entity_ids: missingPriorIds,
      direct_match_entity_ids: directIds, matches: [...found].sort(([a], [b]) => a.localeCompare(b)).map(([id, basis]) => detail(id, basis)),
      result: found.size ? 'OBSERVED_MATCHES_REQUIRE_ADJUDICATION' : 'NO_MATCH_IN_VALIDATED_SNAPSHOT_UNDER_LISTED_CUES',
      identity_approved: false, database_absence_asserted: false, merge_allowed: false, import_approved: false };
  });
  const cross = [];
  for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
    const a = candidates[i], b = candidates[j], ak = a.literal_public_names.flatMap(n => nameKeys(n.text)), bk = b.literal_public_names.flatMap(n => nameKeys(n.text));
    const sameSource = equal(a.exact_source_key, b.exact_source_key), sharedKeys = ak.filter(x => bk.some(y => y.kind === x.kind && y.value === x.value));
    const sharedHosts = a.host_cues.filter(h => !excludedHostCue(h)).flatMap(h => b.host_cues.filter(z => !excludedHostCue(z) && relatedHost(host(h.host), host(z.host))).map(z => [h.host, z.host]));
    if (sameSource || sharedKeys.length || sharedHosts.length) cross.push({ keys: [a.key, b.key], same_source_key: sameSource, shared_name_keys: sharedKeys, related_host_cues: sharedHosts, automatic_merge: false });
  }
  return { rows, cross_candidate_cautions: cross, alias_inventory: { plan_files: plans.length, source_owned_plan_rows: aliasBindings.length, skipped_unowned_plan_sources: skippedUnownedPlanSources, bindings: aliasBindings } };
}
function run({ base = BASE, snapshotDir, snapshotSha, intakes }) {
  const deps = dependencies(), hashes = { ...PINS }, dir = localFile(base, snapshotDir);
  must(fs.statSync(dir).isDirectory() && SHA.test(snapshotSha), 'snapshot_directory_and_pin_required');
  readFile(base, snapshotDir + '/snapshot.json', hashes, snapshotSha);
  const snapshot = deps.loadCompleteSnapshot(dir);
  const snapshotReceipts = ['reservation.json', 'complete.json', ...snapshot.method.tables.map(t => t.artifact)];
  for (const f of snapshotReceipts) readFile(base, snapshotDir + '/' + f, hashes);
  const reservation = JSON.parse(readFile(base, snapshotDir + '/reservation.json', hashes));
  must(reservation.helper_sha256 === PINS['snapshot-sequential-v3.cjs'], 'snapshot_loader_version_mismatch');
  must(Array.isArray(intakes) && intakes.length > 0 && intakes.length <= 4, 'invalid_intake_count');
  const packets = intakes.map(i => loadIntake(base, i.file, i.sha256, hashes));
  const planFiles = planInventory(base); must(planFiles.length <= 128, 'plan_inventory_bound');
  const plans = planFiles.map(file => ({ file, plan: JSON.parse(readFile(base, file, hashes)) }));
  const result = compare(snapshot, packets.flatMap(p => p.intake.candidates), plans, snapshotDir + '/snapshot.json');
  must(equal(planFiles, planInventory(base)), 'plan_inventory_changed');
  for (const [f, h] of Object.entries(hashes)) if (!PINS[f]) readFile(base, f, hashes, h);
  must(!fs.existsSync(path.join(dir, 'failed.json')), 'snapshot_failed_during_comparison');
  return { version: 1, at: new Date().toISOString(), status: 'OFFLINE_IDENTITY_COMPARISON_REQUIRES_REVIEW',
    snapshot: { file: snapshotDir + '/snapshot.json', sha256: snapshotSha, at: snapshot.at, started_at: snapshot.method.started_at, counts: snapshot.method.counts, nontransactional: true, complete_loader_validated: true },
    intakes: packets.map(p => ({ file: p.file, sha256: p.sha256, candidates: p.intake.candidates.length })), ...result,
    limitations: ['Snapshot reflects its dated nontransactional export, not a new live query or transaction-consistent absence proof.', 'All entity roles and canonical links are compared; unknown aliases and unrepresented relationships remain possible.', 'Core names, tokens, address and host-family matches are cautions, not proof of one legal operator or cafe branch.', 'Historical plan aliases are attributed only through exact source keys currently owned in this snapshot, never through an old planned entity ID.', 'No automatic approvals, inserts, merges, deletions or crawling. Fresh execution preflight remains separate.'],
    network_requests: 0, database_calls: 0, database_writes: 0, import_approved: false, file_hashes: hashes, helper_sha256: sha(fs.readFileSync(__filename)) };
}
function saveExclusive(file, result) {
  const bytes = Buffer.from(JSON.stringify(result, null, 2) + '\n'); must(bytes.length <= MAX_OUTPUT, 'output_bound_exceeded_not_truncated');
  const fd = fs.openSync(file, 'wx', 0o600); try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const dir = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  return { file, sha256: sha(bytes), bytes: bytes.length };
}
function main(args = process.argv.slice(2)) {
  dependencies();
  if (!args.length || equal(args, ['--check'])) return { status: 'OFFLINE_ONLY_READY', dependency_pins: PINS, maximum_candidates: MAX_CANDIDATES, network_requests: 0, database_calls: 0 };
  must(args.shift() === '--compare' && args.shift() === '--snapshot', 'use_compare_snapshot_DIR_SHA_intake_FILE_SHA_output_FILE');
  const snapshotDir = args.shift(), snapshotSha = args.shift(), intakes = [];
  while (args[0] === '--intake') { args.shift(); intakes.push({ file: args.shift(), sha256: args.shift() }); }
  must(args.shift() === '--output' && args.length === 1, 'exclusive_output_required');
  const output = args.shift(); must(typeof output === 'string' && /^[a-z0-9][a-z0-9._-]*\.json$/.test(output), 'output_basename_required');
  return saveExclusive(path.join(BASE, output), run({ snapshotDir, snapshotSha, intakes }));
}
module.exports = { PINS, MAX_MATCHES, sha, norm, nameKeys, host, relatedHost, phraseIn, localFile, pointer, validateCandidate, loadIntake, planInventory, canonicalIndex, compare, run, saveExclusive, main };
if (require.main === module) { try { console.log(JSON.stringify(main())); } catch (e) { console.error(JSON.stringify({ status: 'STOPPED_NO_APPROVAL', error: e.message })); process.exitCode = 1; } }
