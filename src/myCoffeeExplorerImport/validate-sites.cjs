'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns/promises');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { assertAllowedUrl, installLegalGuard } = require('./legal-guard.cjs');

const ROOT = __dirname;
const TIMEOUT_MS = 15000;
const MAX_BYTES = 1024 * 1024;
const NON_OFFICIAL_HOSTS = /(?:^|\.)(?:facebook\.com|instagram\.com|linktr\.ee|yelp\.com|google\.com|maps\.app\.goo\.gl|mycoffeeexplorer\.com|tripadvisor\.com|tiktok\.com|twitter\.com|x\.com)$/i;
const hostStarts = new Map();
const stats = { targetAttempts: 0, requests: 0, prohibitedRequests: 0, privateRequests: 0 };

function publicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 ||
      a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 ||
      a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2)) ||
      a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower.startsWith('::ffff:')) return publicAddress(lower.slice(7));
    return /^[23]/.test(lower) && !/^2001:(?:db8|0*2|0*1[0-9a-f]):/.test(lower);
  }
  return false;
}

function safeUrl(value) { const url = new URL(value); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.toString(); }
function urlKey(value) {
  const url = new URL(value);
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return crypto.createHash('sha256').update(url.toString()).digest('hex');
}
function actionWebsite(action) { return action.patch?.website_url || action.entity?.website_url || null; }
function selectActions(plan) {
  return plan.actions.filter((action) => ['create', 'enrich'].includes(action.action) &&
    (action.newRoles?.includes('roaster') || action.action === 'create' && action.roles?.includes('roaster')) && actionWebsite(action));
}
function classifyUrl(value) {
  const url = assertAllowedUrl(value);
  if (url.username || url.password) throw Object.assign(new Error('credentialed_url'), { code: 'credentialed_url' });
  if (url.port && !['80', '443'].includes(url.port)) throw Object.assign(new Error('nonstandard_port'), { code: 'nonstandard_port' });
  if (url.hostname === 'localhost' || url.hostname.endsWith('.local') || url.hostname.endsWith('.internal')) throw Object.assign(new Error('private_host'), { code: 'private_host' });
  if (NON_OFFICIAL_HOSTS.test(url.hostname)) throw Object.assign(new Error('non_official_host'), { code: 'non_official_host' });
  if (/(?:^|\/)api(?:\/|$)/i.test(url.pathname)) throw Object.assign(new Error('api_url_excluded'), { code: 'api_url_excluded' });
  if (/\.(?:jpg|jpeg|png|gif|webp|svg|ico|mp4|mp3|pdf|zip|json|xml|js|css)(?:$|\/)/i.test(url.pathname)) throw Object.assign(new Error('media_url_excluded'), { code: 'media_url_excluded' });
  return url;
}

async function withDeadline(promise, deadline) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), Math.max(1, deadline - Date.now())); })]); }
  finally { clearTimeout(timer); }
}

async function paced(url, deadline) {
  const now = Date.now();
  const start = Math.max(now, hostStarts.get(url.hostname) || 0);
  hostStarts.set(url.hostname, start + 1000);
  if (start >= deadline) throw Object.assign(new Error('timeout'), { code: 'timeout' });
  if (start > now) await new Promise((resolve) => setTimeout(resolve, start - now));
}

async function pageRequest(url, deadline) {
  await paced(url, deadline);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await withDeadline(dns.lookup(host, { all: true }), deadline);
  if (!addresses.length || addresses.some((entry) => !publicAddress(entry.address))) throw Object.assign(new Error('private_or_reserved_dns'), { code: 'private_or_reserved_dns' });
  const address = addresses.find((entry) => entry.family === 4) || addresses[0];
  stats.requests += 1;
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.get(url, {
      headers: { 'user-agent': 'EveryCoffeeCatalogValidation/1.0 (+https://every.coffee)', accept: 'text/html,application/xhtml+xml;q=0.9', 'accept-encoding': 'identity' },
      agent: false,
      lookup(_host, options, callback) { callback(null, options?.all ? [address] : address.address, address.family); },
    }, (response) => {
      const responseInfo = { status: response.statusCode, contentType: response.headers['content-type'] || null, location: response.headers.location || null };
      if ([301, 302, 303, 307, 308].includes(response.statusCode) || response.statusCode >= 400 || !/^(?:text\/html|application\/xhtml\+xml)\b/i.test(responseInfo.contentType || '')) {
        response.destroy(); clearTimeout(timer); resolve({ ...responseInfo, html: '' }); return;
      }
      let stream = response;
      const encoding = String(response.headers['content-encoding'] || '').toLowerCase();
      if (encoding === 'gzip') stream = response.pipe(zlib.createGunzip());
      else if (encoding === 'br') stream = response.pipe(zlib.createBrotliDecompress());
      else if (encoding === 'deflate') stream = response.pipe(zlib.createInflate());
      const chunks = [];
      let bytes = 0;
      stream.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) { stream.destroy(); response.destroy(); request.destroy(); clearTimeout(timer); resolve({ ...responseInfo, html: Buffer.concat(chunks).toString('utf8'), truncated: true }); }
        else chunks.push(chunk);
      });
      stream.on('end', () => { clearTimeout(timer); resolve({ ...responseInfo, html: Buffer.concat(chunks).toString('utf8'), truncated: false }); });
      stream.on('error', (error) => { clearTimeout(timer); reject(error); });
    });
    const timer = setTimeout(() => request.destroy(Object.assign(new Error('timeout'), { code: 'timeout' })), Math.max(1, deadline - Date.now()));
    request.on('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

function clean(value, maximum = 300) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/&#(x[0-9a-f]+|\d+);?/gi, (_match, code) => { try { return String.fromCodePoint(code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10)); } catch { return ''; } }).replace(/&(?:amp|quot|apos|lt|gt|nbsp);/gi, (entity) => ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' })[entity.toLowerCase()] || ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function identity(html) {
  const title = clean(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]);
  let siteName = '';
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attributes = Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((match) => [match[1].toLowerCase(), match[2] ?? match[3]]));
    if (attributes.property?.toLowerCase() === 'og:site_name') siteName = clean(attributes.content);
  }
  const jsonLdNames = [];
  function walk(item, depth = 0) {
    if (!item || depth > 10 || jsonLdNames.length >= 30) return;
    if (Array.isArray(item)) { for (const entry of item) walk(entry, depth + 1); return; }
    if (typeof item !== 'object') return;
    if (item.name && item['@type']) {
      const types = (Array.isArray(item['@type']) ? item['@type'] : [item['@type']]).map(String);
      if (types.some((type) => /(?:Organization|LocalBusiness|CafeOrCoffeeShop|Store|Restaurant|WebSite|FoodEstablishment|Corporation)$/i.test(type))) jsonLdNames.push({ type: types.slice(0, 3), name: clean(item.name) });
    }
    for (const [key, value] of Object.entries(item)) if (key !== 'name' && key !== 'description') walk(value, depth + 1);
  }
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/type\s*=\s*["']application\/ld\+json["']/i.test(script[1])) continue;
    try { walk(JSON.parse(script[2])); } catch {}
  }
  const parkedSignals = [];
  const markers = [
    ['domain_for_sale', /(?:this\s+domain\s+(?:name\s+)?(?:is\s+)?for\s+sale|buy\s+this\s+domain)/i],
    ['domain_parked', /(?:domain\s+(?:is\s+)?parked|parkingcrew|sedoparking|afternic\.com\/forsale)/i],
    ['domain_expired', /(?:this\s+domain\s+(?:name\s+)?has\s+expired|domain\s+registration\s+expired)/i],
    ['site_suspended', /(?:account\s+suspended|website\s+has\s+been\s+suspended)/i],
    ['placeholder_title', /^(?:Index of \/|Coming Soon|Default Web Site Page|404 Not Found|Site not found|Website Expired)$/i],
  ];
  for (const [signal, pattern] of markers) if (pattern.test(signal === 'placeholder_title' ? title : html)) parkedSignals.push(signal);
  if (/(?:slot\s+gacor|rajabandot|togel|judi\s+online|online\s+casino|casino\s+online)/i.test(`${title} ${siteName}`)) parkedSignals.push('unrelated_gambling_identity');
  return { title, ogSiteName: siteName || null, jsonLdNames, parkedSignals };
}

function identityAssessment(row, action) {
  const norm = (value) => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const generic = new Set('coffee coffees roasting roaster roasters roastery company house cafe caffe and the co shop room tasting bar downtown inc llc'.split(' '));
  const names = [row.title, row.ogSiteName, ...(row.jsonLdNames || []).map((entry) => entry.name)].filter(Boolean).join(' ');
  const sourceNames = [action.entity.name, ...(action.sources || []).map((source) => source.raw_data?.name)].filter(Boolean);
  const distinctive = [...new Set(sourceNames.flatMap((name) => norm(name).split(' ').filter((word) => word.length > 2 && !generic.has(word))))];
  const matchedTokens = distinctive.filter((word) => norm(names).includes(word));
  const identityFlags = [];
  const rejectionFlags = [...(row.parkedSignals || [])];
  if (/(?:slot\s+gacor|rajabandot|togel|judi\s+online|online\s+casino|casino\s+online)/i.test(names) && !rejectionFlags.includes('unrelated_gambling_identity')) rejectionFlags.push('unrelated_gambling_identity');
  if (!names) identityFlags.push('identity_metadata_missing');
  else if (distinctive.length && !matchedTokens.length) identityFlags.push('candidate_identity_not_confirmed');
  if (/[\uac00-\ud7af]/.test(names) && sourceNames.every((name) => !/[\uac00-\ud7af]/.test(name))) identityFlags.push('different_language_identity_review');
  if (row.finalUrl && new URL(row.finalUrl).hostname.replace(/^www\./, '') !== new URL(actionWebsite(action)).hostname.replace(/^www\./, '')) identityFlags.push('cross_host_redirect_review');
  return {
    identityAssessment: rejectionFlags.length ? 'rejected_metadata' : matchedTokens.length ? 'metadata_consistent_needs_review' : 'inconclusive',
    identityFlags, rejectionFlags, matchedIdentityTokens: matchedTokens,
    verifiedOfficialWebsite: false,
  };
}

async function validate(action) {
  const website = actionWebsite(action);
  const output = { formatVersion: 2, entity_id: action.entity_id, name: action.entity.name, requestedUrl: safeUrl(website), cacheKey: urlKey(website), source_ids: action.sources.map((source) => source.source_id), checkedAt: new Date().toISOString(), redirects: [] };
  const deadline = Date.now() + TIMEOUT_MS;
  stats.targetAttempts += 1;
  try {
    let current = classifyUrl(website);
    for (let hop = 0; hop <= 5; hop += 1) {
      const response = await pageRequest(current, deadline);
      if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
        if (hop === 5) throw Object.assign(new Error('redirect_limit'), { code: 'redirect_limit' });
        const next = classifyUrl(new URL(response.location, current));
        output.redirects.push({ status: response.status, from: safeUrl(current), to: safeUrl(next) });
        current = next;
        continue;
      }
      Object.assign(output, { httpStatus: response.status, finalUrl: safeUrl(current), contentType: response.contentType, truncated: response.truncated || false, ...identity(response.html) });
      output.status = response.status >= 400 ? 'http_error' : !response.html ? 'non_html' : output.parkedSignals.length ? 'parked_or_placeholder' : 'html_success';
      return { ...output, ...identityAssessment(output, action) };
    }
  } catch (error) { output.status = 'failed'; output.errorCode = String(error.code || error.name || 'fetch_error').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100); }
  return { ...output, ...identityAssessment(output, action) };
}

async function main() {
  const planFile = path.resolve(process.argv[2] || path.join(ROOT, 'roaster-preview.json'));
  const outputFile = path.resolve(process.argv[3] || path.join(ROOT, 'site-validation.ndjson'));
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const candidates = selectActions(plan);
  const previousRows = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse) : [];
  const cache = new Map();
  const exactRows = new Map();
  for (const row of previousRows) {
    cache.set(row.cacheKey || urlKey(row.requestedUrl), row);
    if (row.finalUrl) cache.set(urlKey(row.finalUrl), row);
    exactRows.set(`${row.entity_id}|${urlKey(row.requestedUrl)}`, row);
  }
  const pending = [];
  const cached = [];
  for (const action of candidates) {
    const key = urlKey(actionWebsite(action));
    if (cache.has(key)) cached.push({ action, row: cache.get(key), exact: exactRows.get(`${action.entity_id}|${key}`) });
    else pending.push(action);
  }
  const fd = fs.openSync(outputFile, 'a', 0o600);
  fs.fchmodSync(fd, 0o600);
  const guard = installLegalGuard();
  const counts = {};
  for (const { action, row, exact } of cached) {
    const reused = { ...row, formatVersion: 2, entity_id: action.entity_id, name: action.entity.name, requestedUrl: safeUrl(actionWebsite(action)), cacheKey: urlKey(actionWebsite(action)), source_ids: action.sources.map((source) => source.source_id), planHash: plan.planHash || null, fromCache: true, ...identityAssessment(row, action) };
    if (exact?.formatVersion !== 2 || exact?.planHash !== plan.planHash) fs.writeSync(fd, `${JSON.stringify(reused)}\n`);
    counts[reused.status] = (counts[reused.status] || 0) + 1;
  }
  let index = 0;
  let finished = 0;
  const inFlightByUrl = new Map();
  console.log(JSON.stringify({ event: 'start', planHash: plan.planHash, candidates: candidates.length, cached: cached.length, pending: pending.length, concurrency: 4 }));
  try {
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (index < pending.length) {
        const action = pending[index++];
        const key = urlKey(actionWebsite(action));
        if (!inFlightByUrl.has(key)) inFlightByUrl.set(key, validate(action));
        const observed = await inFlightByUrl.get(key);
        const row = { ...observed, entity_id: action.entity_id, name: action.entity.name, requestedUrl: safeUrl(actionWebsite(action)), cacheKey: key, source_ids: action.sources.map((source) => source.source_id), ...identityAssessment(observed, action), planHash: plan.planHash || null };
        fs.writeSync(fd, `${JSON.stringify(row)}\n`);
        counts[row.status] = (counts[row.status] || 0) + 1;
        finished += 1;
        if (finished % 20 === 0 || finished === pending.length) console.log(JSON.stringify({ event: 'progress', finished, pending: pending.length, counts, requests: stats.requests }));
      }
    }));
  } finally { guard.uninstall(); fs.closeSync(fd); }
  console.log(JSON.stringify({ event: 'complete', planHash: plan.planHash, candidates: candidates.length, cached: cached.length, newlyValidated: finished, counts, ...stats, guard: guard.stats, outputFile }));
}
if (require.main === module) main().catch((error) => { console.error(error.code || error.name || 'validation_failed'); process.exitCode = 1; });
module.exports = { publicAddress, classifyUrl, identity, identityAssessment, selectActions, urlKey, pageRequest, clean };
