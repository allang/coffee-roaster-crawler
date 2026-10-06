'use strict';
require('./prepare-lulo-followup.cjs').offlineOnly();
const fs = require('node:fs'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const core = require('./collect-tenth-sites.cjs');
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const CACHE = 'eleventh-public-brand-site-review.ndjson';
const pins = {
  [CACHE]: '2c3c6994810ed609851d4f63e38b05cde622328224cf916b73e18644e9dc92a1',
  'eleventh-public-brand-site-review.ndjson.audit.ndjson': '25b3028031302b8688b474fd43560e5d3c8700b39680c2bda9b056914d20fb00',
  'eleventh-reviewed-site-input.json': '5684e5ee0f1443f927bb550ea777a1c84762ad5c6ca3f0c32434d6f0b86aa1f9',
  'eleventh-reviewed-site-input.audit.json': '8e4048fe7389c64af528d53db591e3cdb304acfa2331a1533495c595ee8cb446',
  'eleventh-site-discovery.receipt.json': '1325f9681dd70db4bcb8c5842c2b70f783207506b864a855b0d4fe89fbd97413'
};
for (const [f, h] of Object.entries(pins)) assert.equal(sha(fs.readFileSync(f)), h, f);
const priorAudit = JSON.parse(fs.readFileSync('eleventh-reviewed-site-input.audit.json'));
const priorFiles = [...new Set([...priorAudit.requestLogFiles, CACHE, 'eleventh-public-brand-site-review.ndjson.audit.ndjson'])];
const requested = new Set(); let priorRecords = 0;
function pageKey(value) { const u = new URL(value); return u.hostname.toLowerCase().replace(/^www\./, '') + (u.pathname.replace(/\/$/, '') || '/'); }
function scan(value) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach(scan); return; }
  for (const [key, item] of Object.entries(value)) {
    if (['url', 'requestedUrl', 'finalUrl', 'requested_url', 'final_url', 'from', 'to'].includes(key) && typeof item === 'string' && /^https?:\/\//.test(item)) requested.add(pageKey(item));
    else if (item && typeof item === 'object') scan(item);
  }
}
for (const file of priorFiles) {
  const bytes = fs.readFileSync(file), expected = pins[file] || priorAudit.inputHashes[file]; assert(expected, 'unbound prior request file'); assert.equal(sha(bytes), expected, file); pins[file] = expected;
  for (const line of bytes.toString().split('\n').filter(Boolean)) { scan(JSON.parse(line)); priorRecords++; }
}
const followupFile = 'tenth-identity-followup/result.json', followupBytes = fs.readFileSync(followupFile);
assert.equal(sha(followupBytes), priorAudit.inputHashes[followupFile]); pins[followupFile] = sha(followupBytes); scan(JSON.parse(followupBytes).pages);
const input = JSON.parse(fs.readFileSync('eleventh-reviewed-site-input.json'));
const lines = fs.readFileSync(CACHE, 'utf8').trim().split('\n'), records = lines.map(JSON.parse);
const chosen = [
  { owner: 'https://www.sastostadores.com/', url: 'https://sastostadores.com/quienes-somos/', root: 'sastostadores.com', purpose: 'Read the observed Spanish About page to determine current own-roasting operator; name Tostadores and sales alone were insufficient.' },
  { owner: 'https://bbs.cafe/', url: 'https://bbs.cafe/pages/equipo', root: 'bbs.cafe', purpose: 'Read the observed EQUIPO team page to distinguish own-roasting operation from a specialty-coffee retailer.' },
  { owner: 'https://en.sarutahiko.jp/', url: 'https://brand.sarutahiko.jp/brand', root: 'sarutahiko.jp', purpose: 'Read the explicitly linked Our Philosophy identity page on the same registered-domain brand site; do not infer roasting from an online-shop title alone.' },
];
const targets = chosen.map(c => {
  const ii = input.findIndex(r => r.website_url === c.owner); assert(ii >= 0);
  const ri = records.findIndex(r => r.candidate.website_url === c.owner); assert(ri >= 0); const record = records[ri], page = record.pages[0];
  assert.equal(page.status, 200); assert.equal(page.captureComplete, true); assert.equal(sha(page.rawHtml), page.rawHtmlSha256); assert.equal(sha(page.staticBodyText), page.staticBodyTextSha256);
  const excludedRanges = [...page.rawHtml.matchAll(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->/gi)].map(m => [m.index, m.index + m[0].length]);
  const anchors = [...page.rawHtml.matchAll(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>[\s\S]*?<\/a>/gi)].filter(m => !excludedRanges.some(([a, b]) => m.index >= a && m.index < b));
  const found = anchors.find(m => { try { return new URL(m[2], page.finalUrl).href === c.url; } catch { return false; } }); assert(found, 'literal visible anchor required');
  const url = core.safe(c.url); assert.equal(url.href, c.url); assert(!url.search && !url.hash && url.protocol === 'https:');
  for (const v of [c.owner, c.url]) { const h = new URL(v).hostname.replace(/^www\./, ''); assert(h === c.root || h.endsWith('.' + c.root)); }
  assert(!requested.has(pageKey(c.url)), 'identity page already requested');
  const anchor = found[0], rawHref = found[2], offset = found.index; assert.equal(page.rawHtml.slice(offset, offset + anchor.length), anchor);
  return { target_id: sha(c.owner + '\n' + c.url), input_index: ii, candidate_name: input[ii].name, owner_url: c.owner, url: c.url, observed_same_domain_family: c.root, purpose: c.purpose, fetched: false, identityVerified: false, source_cache_file: CACHE, source_cache_sha256: pins[CACHE], source_cache_line: ri + 1, source_cache_line_sha256: sha(lines[ri]), source_cache_key: record.key, source_page_index: 0, source_page: page.finalUrl, source_raw_html_sha256: page.rawHtmlSha256, source_static_text_sha256: page.staticBodyTextSha256, raw_href: rawHref, anchor_text: anchor.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(), anchor_html: anchor, anchor_sha256: sha(anchor), raw_html_utf16_range: [offset, offset + anchor.length], raw_href_html_utf16_range: [offset + anchor.indexOf(rawHref), offset + anchor.indexOf(rawHref) + rawHref.length], novelty: { presentInPriorRequestedPageSet: false, normalization: 'For conservative comparison only: hostname lowercased and www stripped; query ignored; one trailing path slash removed. Actual target URL is never rewritten.' } };
});
assert.equal(targets.length, 3); assert.equal(new Set(targets.map(x => x.owner_url)).size, 3);
for (const [file, pin] of Object.entries(pins)) assert.equal(sha(fs.readFileSync(file)), pin, 'evidence drift');
const manifest = { version: 1, at: new Date().toISOString(), scope: 'explicit_observed_identity_pages_only', status: 'prepared_not_executed', readOnlyDiscovery: true, staleCatalog: true, databasePlanningAllowed: false, databaseMutationAllowed: false, requiresFreshCatalogBeforeAnyDatabasePlanOrApply: true, executionAuthorized: false, limits: { maxOwners: 3, maxPages: 3, pagesPerOwner: 1, concurrency: 1, requestTimeoutMs: 20000, maxHtmlBytes: 1048576, maxRedirects: 5, retries: 0 }, inputHashes: pins, noveltyInventory: { priorFiles: priorFiles.length, records: priorRecords, conservativePageKeys: requested.size, includesAllFiveTenthIdentityFollowups: true, includesCompletedEleventh: true, inspectedOnlyLocally: true }, warning: 'This manifest records three previously unvisited literal first-party identity links. Their contents are unknown until an explicitly reviewed guarded collector runs. No inferred paths, product URLs, blog expansion, legal/auth routes, JS, database writes or identity approvals.', targets };
const out = 'eleventh-identity-followup.manifest.json', bytes = JSON.stringify(manifest, null, 2) + '\n';
const fd = fs.openSync(out, 'wx', 0o444); try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
console.log(JSON.stringify({ file: out, sha256: sha(bytes), targets: targets.map(x => x.url), novelty: manifest.noveltyInventory, networkRequests: 0, databaseCalls: 0 }));
