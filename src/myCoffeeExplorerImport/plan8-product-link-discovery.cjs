'use strict';
// Read-only, finite public link discovery. Default preview never creates a transport.
// The imported production transport and legal guard are pinned, not modified.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const { createTransport, ownerUrl, publicUrl } = require('./product-only-network.cjs');
const { installLegalGuard, nativeRequestUrl, safeRequestLabel } = require('./legal-guard.cjs');
const { identity } = require('./validate-sites.cjs');
const BASE = __dirname;
const TAG = 'plan8-product-link-discovery';
const PLAN_HASH = '2689d07a5cf3bcba32e598c8bb490d0e417a84859e753b6f1dd2c82fca4d0abf';
const PINS = Object.freeze({
  'reviewed-public-brands-8/plan.json': 'c5f413704e686e4f2fdfd5ea2d22cd34f60f7661695f1796f7652032309988c6',
  'reviewed-public-brands-8/verification.json': '47b0466323e62c0674fe773d76c2c246c93e23f75ea0afb8a4a63e3481683f99',
  'reviewed-public-brands-8/verification.targets.ndjson': 'ecdb2a8a0efc0adb56d10c3abec3e6e7504b3bca24373331a7e499f99d26b736',
  'snapshot-0114.json': 'c835229bf8c2abbdfcc812f6a9c841b4e6fd8e3c3eb03b8b62474964bb9a3e99',
  'product-only-network.cjs': '06b85be52fce083ee6d2cdf5631fa21d2ccdc7ae7a2d7e0f22549769e097ad3e',
  'legal-guard.cjs': '26acbcc26a6b24aaf3663b5968b6163e010a3ac323eac4cfe1dd8b5e6a16abfc',
  'validate-sites.cjs': '7e1e423d41139078032d81475dcc2acb70610e9fa6cdb0eb6c09d59d23ad133b',
});
const OWNERS = Object.freeze([
  { entity_id: 'fcd431a2-9144-4036-aa7b-9cb20aa89be4', name: 'Terra Coffee & Tea', website_url: 'https://cafeterra.ca/', source_id: 'roaster:public-catalog:terracaf.ca' },
  { entity_id: '53654368-f004-4c6b-abba-f14aec12a4ec', name: 'BUNCA Coffee', website_url: 'https://bunca.de/', source_id: 'roaster:public-catalog:buncacoffee.com' },
  { entity_id: '014b3610-f9d8-44bc-bd2b-022fba19a54a', name: 'La Bon Beans & Coffee', website_url: 'https://labonbeans.com/', source_id: 'roaster:public-catalog:labonbeans.com' },
].map(Object.freeze));
const LIMITS = Object.freeze({ owners: 3, homepage_per_owner: 1, observed_menu_pages_per_owner: 2, product_links_per_owner: 20, concurrency: 1 });
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const host = value => { try { return new URL(/^[a-z]+:\/\//i.test(value) ? value : 'https://' + value).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, ''); } catch { return null; } };
function decode(value) {
  const named = { amp: '&', quot: '"', apos: "'", nbsp: ' ', lt: '<', gt: '>', eacute: 'é', egrave: 'è', ecirc: 'ê', auml: 'ä', ouml: 'ö', uuml: 'ü', szlig: 'ß' };
  return String(value).replace(/&#(x[0-9a-f]+|\d+);?/gi, (_, n) => { const cp = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n); return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ''; }).replace(/&([a-z]+);/gi, (raw, n) => named[n.toLowerCase()] ?? raw);
}
const clean = value => decode(String(value).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const normalized = value => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// Used only to select from observed links, never to manufacture URLs.
const COFFEE = /(?:^|[^a-z])(?:coffee|coffees|cafe|cafes|kaffee|kaffees|kaffeebohnen|bohnen|espresso|espressos|roasted|torrefie|torrefies|specialty)(?:[^a-z]|$)/;
const NON_COFFEE = /(?:^|[^a-z])(?:equipment|accessories|accessoire|accessoires|zubehor|grinder|kettle|strainer|brewer|roaster|roasters|machine|machines|tea|the|tee|matcha|chocolate|cocoa|cascara|green|grun|rohkaf[f]?ee|subscription|subscriptions|abonnement|abo|gift|gifts|merch|workshop|training|academy)(?:[^a-z]|$)/;
function classifyLink(url, text) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname).replace(/^\/(?:en|fr|de)(?:-[a-z]{2})?(?=\/)/i, '').replace(/\/+$/, '') || '/'; } catch { return null; }
  const combined = normalized(pathname + ' ' + text);
  if (NON_COFFEE.test(combined) || /(?:^|\/)(?:blogs?|news|events?|pages\/about|pages\/contact)(?:\/|$)/i.test(pathname)) return null;
  if ([...url.searchParams.keys()].some(k => /^(?:add[-_]to[-_]cart|action|delete|remove|purchase|subscribe|logout)$/i.test(k))) return null;
  // Product detail takes precedence over every label, including a misleading "shop coffee".
  if (/^\/(?:collections\/[^/]+\/)?products?\/[^/]+$/i.test(pathname) || /^\/(?:produkt|produit)\/[^/]+$/i.test(pathname) || /^\/shop\/p\/[^/]+$/i.test(pathname)) return 'product';
  // Product queries are preserved in evidence; navigation queries are not fetched.
  if (url.search) return null;
  // Only structural collection roots and short shop/coffee menu paths are navigable.
  // An unknown slug or /shop/single-item is retained nowhere, not guessed to be a menu.
  if (/^\/(?:collections|product-category|produkt-kategorie|categorie-produit)(?:\/[^/]+)?$/i.test(pathname)) {
    return COFFEE.test(combined) ? 'menu' : null;
  }
  if (/^\/(?:shop|shop-coffee|onlineshop|online-shop|boutique|coffee|coffees|kaffee|kaffees|kaffeebohnen|bohnen|cafe|cafes|cafe-en-grains|cafes-en-grains|catalog|catalogue)$/i.test(pathname)) return 'menu';
  return null;
}
function links(html, base, owner) {
  const source = String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const rows = [];
  for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = match[1].match(/(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!href || match[0].length > 32768) continue;
    const raw = href[1] ?? href[2] ?? href[3];
    // Fragments and other protocols cannot be made into additional requests.
    if (!raw || /^\s*#/.test(raw)) continue;
    try {
      const u = ownerUrl(new URL(decode(raw), base), owner.website_url);
      const heading = match[2].match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1];
      const text = clean(heading || match[2]);
      const type = classifyLink(u, text);
      if (!type) continue;
      rows.push({ url: u.href, type, observed_href: raw, observed_link_text: text.slice(0, 500), anchor_html: match[0], anchor_sha256: sha(match[0]) });
    } catch { /* Legal/auth/private/foreign/credentialed links are excluded pre-dispatch. */ }
  }
  return rows;
}
function validateOwnership(plan, verification, targets, snapshot) {
  assert.equal(plan.planHash, PLAN_HASH);
  assert.equal(verification.planHash, PLAN_HASH);
  assert.equal(verification.verified, 38); assert.equal(verification.expected, 38);
  assert.equal(verification.crawlTargets, 37); assert.deepEqual(verification.failures, []); assert.equal(verification.unresolved, 0);
  assert.equal(verification.inputReceipts.planSha256, PINS['reviewed-public-brands-8/plan.json']);
  assert.equal(verification.targetsSha256, PINS['reviewed-public-brands-8/verification.targets.ndjson']);
  return OWNERS.map(owner => {
    const actions = plan.actions.filter(a => a.entity_id === owner.entity_id), entities = snapshot.entities.filter(e => e.id === owner.entity_id);
    assert.equal(actions.length, 1); assert.equal(entities.length, 1);
    const action = actions[0], entity = entities[0];
    assert.equal(action.action, 'create'); assert.deepEqual(action.newRoles, ['roaster']);
    assert.equal(action.entity.name, owner.name); assert.equal(action.entity.website_url, owner.website_url);
    assert.equal(entity.name, owner.name); assert.equal(entity.website_url, owner.website_url);
    assert.equal(snapshot.roles.filter(r => r.entity_id === owner.entity_id && r.role === 'roaster').length, 1);
    assert(snapshot.entities.filter(e => e.website_url && host(e.website_url) === host(owner.website_url)).every(e => e.id === owner.entity_id), 'Same-host identity collision');
    const sources = snapshot.sourceIds.filter(s => s.source === 'my_coffee_explorer' && s.source_id === owner.source_id);
    assert.equal(sources.length, 1); assert.equal(sources[0].entity_id, owner.entity_id);
    assert.equal(action.sources.filter(s => s.source === 'my_coffee_explorer' && s.source_id === owner.source_id).length, 1);
    const matched = targets.filter(t => t.entity_id === owner.entity_id); assert.equal(matched.length, 1);
    assert.equal(matched[0].website_url, owner.website_url);
    assert(matched[0].source_ids.some(s => s.source === 'my_coffee_explorer' && s.source_id === owner.source_id));
    return { ...owner, snapshot_entity: entity, snapshot_roles: snapshot.roles.filter(r => r.entity_id === owner.entity_id), source: sources[0], verification_target: matched[0], first_party_review: action.sources.find(s => s.source_id === owner.source_id).raw_data.firstPartyReview };
  });
}
function collect(base = BASE) {
  for (const [file, hash] of Object.entries(PINS)) assert.equal(sha(fs.readFileSync(path.join(base, file))), hash, 'Pinned input changed: ' + file);
  const read = file => JSON.parse(fs.readFileSync(path.join(base, file), 'utf8'));
  const plan = read('reviewed-public-brands-8/plan.json'), verification = read('reviewed-public-brands-8/verification.json'), snapshot = read('snapshot-0114.json');
  const targets = fs.readFileSync(path.join(base, 'reviewed-public-brands-8/verification.targets.ndjson'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  return { version: 1, scope: 'offline_verified_owner_preview', plan_hash: PLAN_HASH, verified_at: verification.at, snapshot_at: snapshot.at || snapshot.createdAt || null, input_hashes: PINS, limits: LIMITS, owners: validateOwnership(plan, verification, targets, snapshot), network_requests: 0, database_calls: 0 };
}
async function discoverOwner(owner, { transportFactory = createTransport, onEvent = () => {}, onPage = () => {} } = {}) {
  const exact = OWNERS.find(o => o.entity_id === owner.entity_id); assert(exact, 'Out-of-scope owner');
  for (const key of ['name', 'website_url', 'source_id']) assert.equal(owner[key], exact[key], 'Owner proof mismatch');
  const pages = [], products = new Map(); let context, stop = null;
  const transport = transportFactory({ context: () => context, onEvent });
  async function visit(url, proof) {
    assert(pages.length < 3, 'Page budget exhausted');
    const u = ownerUrl(url, owner.website_url);
    if (pages.length) assert.equal(classifyLink(u, proof.observed_link_text || ''), 'menu', 'Only observed menu pages may be fetched');
    else assert.equal(u.href, owner.website_url, 'Homepage must be exact verified URL');
    // Empty products intentionally forbids changed-path redirects, even to discovered products.
    context = { target: { entity_id: owner.entity_id, website_url: owner.website_url, products: [] }, url: u.href, images: new Set(), networkErrors: [] };
    const record = { requested_url: u.href, discovered_from: proof, started_at: new Date().toISOString() };
    onEvent({ channel: 'discovery_request', entity_id: owner.entity_id, ...record });
    const response = await transport.fetchHtml(u.href);
    if (!response.success) {
      Object.assign(record, { status: 'failed', error: response.error, hard_stop: context.hardStop || null, challenge_reason: context.challengeReason || null });
      pages.push(record); stop = record.hard_stop || record.error || 'request_failed'; onPage(record, null); return [];
    }
    const final = ownerUrl(response.finalUrl, owner.website_url);
    assert.equal(final.pathname.replace(/\/$/, ''), u.pathname.replace(/\/$/, ''), 'Unexpected path change');
    const html = response.data, found = links(html, final.href, owner), meta = identity(html);
    Object.assign(record, { status: response.status, final_url: final.href, html_sha256: sha(html), html_bytes: Buffer.byteLength(html), content_type: response.headers['content-type'], title: meta.title, og_site_name: meta.ogSiteName, json_ld_names: meta.jsonLdNames, parked_signals: meta.parkedSignals });
    if (meta.parkedSignals.length || /^domain (?:is )?for sale\b/i.test(meta.title)) { stop = 'parked_or_unrelated_identity'; record.status = 'stopped'; pages.push(record); onPage(record, html); return []; }
    record.observed_product_link_count = found.filter(x => x.type === 'product').length;
    record.observed_menu_links = found.filter(x => x.type === 'menu').slice(0, 20);
    pages.push(record); onPage(record, html);
    for (const link of found.filter(x => x.type === 'product')) {
      const observation = { page_url: final.href, page_sha256: record.html_sha256, ...link };
      if (products.has(link.url)) { const p = products.get(link.url); if (p.observations.length < 3) p.observations.push(observation); }
      else if (products.size < LIMITS.product_links_per_owner) products.set(link.url, { url: link.url, fetched: false, product_identity_verified: false, classification: 'unvisited_product_link_candidate', observations: [observation] });
    }
    return found;
  }
  const first = await visit(owner.website_url, { type: 'verified_official_homepage', plan_hash: PLAN_HASH, snapshot_sha256: PINS['snapshot-0114.json'] });
  const menus = [...new Map(first.filter(x => x.type === 'menu').map(x => [x.url, x])).values()]
    .sort((a, b) => Number(COFFEE.test(normalized(b.url + ' ' + b.observed_link_text))) - Number(COFFEE.test(normalized(a.url + ' ' + a.observed_link_text))))
    .slice(0, LIMITS.observed_menu_pages_per_owner);
  for (const menu of menus) {
    if (stop || products.size >= LIMITS.product_links_per_owner) break;
    await visit(menu.url, { page_url: pages[0].final_url, page_sha256: pages[0].html_sha256, ...menu });
  }
  return { entity_id: owner.entity_id, name: owner.name, website_url: owner.website_url, source_id: owner.source_id, status: stop ? 'stopped' : products.size ? 'links_discovered' : 'no_product_links_observed', stop_reason: stop, pages, product_links: [...products.values()] };
}
function syncDirectory(directory) {
  const fd = fs.openSync(directory, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function saveExclusive(file, value) {
  const data = Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  const fd = fs.openSync(file, 'wx', 0o600); try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  syncDirectory(path.dirname(file));
}
function openRequestAudit(file) {
  const fd = fs.openSync(file, 'wx', 0o600); let closed = false;
  fs.fsyncSync(fd); syncDirectory(path.dirname(file));
  return {
    append(event) { assert(!closed, 'Request audit closed'); fs.writeFileSync(fd, JSON.stringify(event) + '\n'); fs.fsyncSync(fd); },
    close() { if (!closed) { fs.fsyncSync(fd); fs.closeSync(fd); closed = true; } },
  };
}
function installQuerylessGuard({ httpModule = http, httpsModule = https, onEvent = () => {} } = {}) {
  // This guard checks the effective native URL, not the transport's redacted event URL.
  // Install outside an existing legal guard; uninstall this wrapper first.
  const originals = [{ module: httpModule, protocol: 'http:' }, { module: httpsModule, protocol: 'https:' }]
    .map(item => ({ ...item, request: item.module.request, get: item.module.get }));
  const stats = { attempted: 0, allowed: 0, blocked: 0 }; let closed = false;
  for (const item of originals) {
    assert.equal(typeof item.request, 'function'); assert.equal(typeof item.get, 'function');
  }
  function check(protocol, args) {
    stats.attempted++;
    let url;
    try {
      url = nativeRequestUrl(protocol, args);
      const options = typeof args[0] === 'string' || args[0] instanceof URL ? (args[1] && typeof args[1] === 'object' ? args[1] : {}) : args[0];
      if (protocol !== 'https:' || url.protocol !== 'https:') throw Object.assign(new Error('HTTPS required'), { code: 'unsafe_discovery_protocol' });
      publicUrl(url);
      if (url.search) throw Object.assign(new Error('Discovery request queries forbidden'), { code: 'unmanifested_discovery_query' });
      if (!['GET', 'HEAD'].includes(String(options.method || 'GET').toUpperCase())) throw Object.assign(new Error('Read-only methods required'), { code: 'unsafe_discovery_method' });
      if (options.auth != null) throw Object.assign(new Error('Native auth forbidden'), { code: 'credential_discovery_request' });
      const headers = options.headers || {};
      if (Array.isArray(headers) || ![Object.prototype, null].includes(Object.getPrototypeOf(headers))) throw Object.assign(new Error('Unknown header container'), { code: 'unsafe_discovery_headers' });
      if (Object.keys(headers).some(k => /^(?:cookie|authorization|proxy-authorization)$/i.test(k))) throw Object.assign(new Error('Credentials forbidden'), { code: 'credential_discovery_headers' });
    } catch (error) {
      stats.blocked++;
      onEvent({ channel: 'discovery_native_guard', at: new Date().toISOString(), disposition: 'blocked', url: url ? safeRequestLabel(url) : '[unresolved native request]', code: error.code || 'unsafe_discovery_request' });
      throw error;
    }
    stats.allowed++;
    onEvent({ channel: 'discovery_native_guard', at: new Date().toISOString(), disposition: 'allowed', url: safeRequestLabel(url) });
  }
  for (const item of originals) {
    item.module.request = function guardedDiscoveryRequest(...args) { check(item.protocol, args); return Reflect.apply(item.request, item.module, args); };
    item.module.get = function guardedDiscoveryGet(...args) { const request = item.module.request(...args); request.end(); return request; };
  }
  return { stats, uninstall() { if (!closed) { for (const item of originals) { item.module.request = item.request; item.module.get = item.get; } closed = true; } } };
}
async function run(preview, base = BASE) {
  // This fixed directory is both the durable one-shot reservation and the evidence sink.
  // A crash leaves it in place; this helper never retries or overwrites it.
  const directory = path.join(base, TAG); fs.mkdirSync(directory, { mode: 0o700 }); syncDirectory(base);
  const startedAt = new Date().toISOString(), events = [], owners = [];
  saveExclusive(path.join(directory, 'reservation.json'), { at: startedAt, pid: process.pid, scope: 'read_only_public_link_discovery', preview, helper_sha256: sha(fs.readFileSync(__filename)), no_resume_or_retry: true });
  const audit = openRequestAudit(path.join(directory, 'request-audit.ndjson'));
  const recordEvent = event => { audit.append(event); events.push(event); };
  let guard, nativeGuard, failure = null;
  try {
    guard = installLegalGuard({ onEvent: e => recordEvent({ channel: 'legal_guard', ...e }) });
    nativeGuard = installQuerylessGuard({ onEvent: recordEvent });
    // Revalidate every pin before any request; no source-file mutation is tolerated.
    assert.deepEqual(collect(base), preview);
    for (let i = 0; i < preview.owners.length; i++) {
      let pageIndex = 0;
      const result = await discoverOwner(preview.owners[i], { onEvent: e => recordEvent({ channel: 'strict_public_transport', ...e }), onPage: (record, html) => {
        const prefix = `owner-${i + 1}-page-${++pageIndex}`;
        if (html !== null) { record.html_evidence_file = prefix + '.html'; saveExclusive(path.join(directory, record.html_evidence_file), html); }
        saveExclusive(path.join(directory, prefix + '.json'), record);
      } });
      owners.push(result); saveExclusive(path.join(directory, `owner-${i + 1}.json`), result);
    }
  } catch (error) { failure = { name: error.name, code: String(error.code || 'discovery_failed').slice(0, 100) }; }
  finally { try { nativeGuard?.uninstall(); } finally { try { guard?.uninstall(); } finally { audit.close(); } } }
  const result = { version: 1, started_at: startedAt, finished_at: new Date().toISOString(), scope: 'Public same-owner homepage/menu link discovery only; product links remain unvisited and unclassified. No database calls or writes.', plan_hash: PLAN_HASH, input_hashes: PINS, limits: LIMITS, ownership: preview.owners, owners, failure, safety: { signed_out: true, credentials: false, proxies: false, browser_execution: false, strict_public_dns_and_tls: true, changed_path_redirects: 'refused', no_access_or_challenge_bypass: true, database_calls: 0, product_page_requests: 0, classifier_calls: 0, semantic_legal_documents: 'stopped before link extraction; an innocuous path could return an unexpected legal document' }, request_audit: events, request_audit_file: 'request-audit.ndjson', request_audit_sha256: sha(fs.readFileSync(path.join(directory, 'request-audit.ndjson'))), guard_stats: guard?.stats || null, helper_sha256: sha(fs.readFileSync(__filename)) };
  result.native_guard_stats = nativeGuard?.stats || null;
  saveExclusive(path.join(directory, 'result.json'), result);
  return { output: directory, status: failure ? 'failed' : 'finished', owners: owners.map(o => ({ entity_id: o.entity_id, status: o.status, pages: o.pages.length, product_links: o.product_links.length, stop_reason: o.stop_reason })), result_sha256: sha(fs.readFileSync(path.join(directory, 'result.json'))) };
}
async function main(args = process.argv.slice(2)) {
  assert(args.length <= 1 && (!args[0] || ['--preview', '--run'].includes(args[0])), 'Use --preview (default) or explicitly --run');
  const preview = collect();
  console.log(JSON.stringify(args[0] === '--run' ? await run(preview) : preview, null, 2));
}
module.exports = { BASE, TAG, PLAN_HASH, PINS, OWNERS, LIMITS, sha, decode, classifyLink, links, validateOwnership, collect, discoverOwner, syncDirectory, saveExclusive, openRequestAudit, installQuerylessGuard, main };
if (require.main === module) main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
