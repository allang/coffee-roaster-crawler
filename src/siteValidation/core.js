const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { Readable } = require('node:stream');
const { canonicalHost, normalizeRecord } = require('../directoryImport/core');

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const PROHIBITED_HOST = 'roastlocal.com';

const STRONG_SIGNALS = [
  ['coffee_roaster', /\bcoffee roaster(?:s|y|ies)?\b/i],
  ['coffee_roasting_company', /\bcoffee roasting compan(?:y|ies)\b/i],
  ['we_roast', /\bwe (?:source(?: our coffee)? and )?roast\b/i],
  ['roast_our_coffee', /\b(?:we|our team) roast (?:all of )?our (?:own )?coffee\b/i],
  ['small_batch_roasting', /\bsmall[- ]batch(?: coffee)? roast(?:er|ing|ed)?\b/i],
  ['freshly_roasted', /\bfreshly roasted coffee\b/i],
  ['roasted_to_order', /\broasted to order\b/i],
  ['our_roastery', /\bour roaster(?:y|ies)\b/i],
  ['french_roaster', /\b(?:torr[eé]facteur|torr[eé]faction|caf[eé] torr[eé]fi[eé])\b/i],
  ['spanish_roaster', /\b(?:tostador(?:a)? de caf[eé]|tostamos caf[eé])\b/i],
];

const WEAK_SIGNALS = [
  ['specialty_coffee', /\bspecialt(?:y|ies) coffee\b/i],
  ['coffee_beans', /\bcoffee beans\b/i],
  ['single_origin', /\bsingle[- ]origin\b/i],
  ['whole_bean', /\bwhole bean\b/i],
  ['roast_level', /\broast level\b/i],
  ['coffee_subscription', /\bcoffee subscription\b/i],
  ['shop_coffee', /\bshop (?:our )?coffee\b/i],
  ['add_to_cart', /\badd to (?:cart|bag)\b/i],
];

const PARKED_SIGNALS = [
  ['domain_for_sale', /\b(?:this )?domain (?:name )?is for sale\b/i],
  ['parked_domain', /\b(?:sedo domain parking|buy this domain|domain parking)\b/i],
  ['site_not_found', /\b(?:site not found|website is unavailable|there is nothing here)\b/i],
];

const CLOSURE_SIGNALS = [
  ['permanently_closed', /\bpermanently closed\b/i],
  ['closed_our_doors', /\b(?:we (?:have )?closed|closed) our doors\b/i],
  ['ceased_operations', /\b(?:ceased|ended) operations\b/i],
  ['no_longer_in_business', /\bno longer in business\b/i],
];

const CAFE_ONLY_SIGNALS = [
  ['cafe', /\b(?:cafe|caf[eé]|coffee shop)\b/i],
  ['restaurant', /\brestaurant\b/i],
  ['breakfast_or_lunch', /\b(?:breakfast|brunch|lunch)\b/i],
  ['food_menu', /\b(?:food|kitchen) menu\b/i],
  ['reservations', /\b(?:book a table|make a reservation|reservations)\b/i],
  ['bakery', /\bbaker(?:y|ies)\b/i],
];

const GENERIC_HOSTS = new Map([
  ['facebook.com', 'social_profile'],
  ['instagram.com', 'social_profile'],
  ['linkedin.com', 'social_profile'],
  ['tiktok.com', 'social_profile'],
  ['twitter.com', 'social_profile'],
  ['x.com', 'social_profile'],
  ['linktr.ee', 'link_aggregator'],
  ['beacons.ai', 'link_aggregator'],
  ['yelp.com', 'business_directory'],
  ['tripadvisor.com', 'business_directory'],
  ['foursquare.com', 'business_directory'],
  ['mapquest.com', 'business_directory'],
  ['roastlocal.com', 'prohibited_directory'],
]);

function candidateKey(raw, index = 0) {
  let record;
  try {
    record = normalizeRecord(raw, index);
  } catch {
    record = null;
  }
  const sourceId = record?.sourceRecordId || raw?.source_record_id || raw?.sourceRecordId || raw?.id || `row-${index}`;
  const website = record?.websiteUrl || raw?.official_website || raw?.officialWebsite || raw?.website_url || raw?.websiteUrl || raw?.website || '';
  return crypto.createHash('sha256').update(`${sourceId}\0${website}`).digest('hex');
}

function excerptAround(text, matchIndex, matchLength) {
  const start = Math.max(0, matchIndex - 70);
  const end = Math.min(text.length, matchIndex + matchLength + 70);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`.slice(0, 220);
}

function collectSignalEvidence(text, signals, strength) {
  const evidence = [];
  for (const [signal, pattern] of signals) {
    const match = pattern.exec(text);
    if (!match) continue;
    evidence.push({ signal, strength, excerpt: excerptAround(text, match.index, match[0].length) });
  }
  return evidence;
}

function decodeHtml(value) {
  return String(value || '').replace(/&#(x?[0-9a-f]+);|&(amp|lt|gt|quot|apos|nbsp);/gi, (match, numeric, named) => {
    if (numeric) {
      const radix = numeric[0].toLowerCase() === 'x' ? 16 : 10;
      const point = Number.parseInt(radix === 16 ? numeric.slice(1) : numeric, radix);
      return Number.isFinite(point) ? String.fromCodePoint(point) : match;
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[named.toLowerCase()] || match;
  });
}

function htmlAttributes(tag) {
  const attributes = {};
  const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = pattern.exec(tag))) attributes[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4]);
  return attributes;
}

function jsonLdText(html) {
  const parts = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const attributes = htmlAttributes(match[1]);
    if (String(attributes.type || '').toLowerCase() !== 'application/ld+json') continue;
    const value = match[2].trim();
    if (!value || value.length > 200000) continue;
    try {
      const parsed = JSON.parse(value);
      const walk = (item, depth = 0) => {
        if (depth > 6 || item === null || item === undefined) return;
        if (Array.isArray(item)) return item.slice(0, 100).forEach((entry) => walk(entry, depth + 1));
        if (typeof item !== 'object') return;
        for (const [key, entry] of Object.entries(item)) {
          if (['name', 'description', 'alternateName', 'slogan', '@type'].includes(key) && typeof entry === 'string') parts.push(entry);
          else if (typeof entry === 'object') walk(entry, depth + 1);
        }
      };
      walk(parsed);
    } catch {
      // Invalid structured data is common and is not evidence either way.
    }
  }
  return parts.join(' ');
}

function classifyHtml(html, candidate = {}) {
  const source = String(html || '');
  const structured = jsonLdText(source);
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(source);
  const title = decodeHtml((titleMatch?.[1] || '').replace(/<[^>]*>/g, ' '));
  let description = '';
  for (const tag of source.match(/<meta\b[^>]*>/gi) || []) {
    const attributes = htmlAttributes(tag);
    if (String(attributes.name || '').toLowerCase() === 'description' || String(attributes.property || '').toLowerCase() === 'og:description') {
      description = attributes.content || '';
      if (description) break;
    }
  }
  const body = decodeHtml(source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<(?:noscript|svg|template)\b[^>]*>[\s\S]*?<\/(?:noscript|svg|template)\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' '));
  const text = [title, description, structured, body].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 1000000);

  const strong = collectSignalEvidence(text, STRONG_SIGNALS, 'strong');
  const weak = collectSignalEvidence(text, WEAK_SIGNALS, 'weak');
  const parked = collectSignalEvidence(text, PARKED_SIGNALS, 'negative');
  const closure = collectSignalEvidence(text, CLOSURE_SIGNALS, 'negative');
  const cafeOnly = collectSignalEvidence(text, CAFE_ONLY_SIGNALS, 'cafe');
  let classification;
  let plausibleRoaster;
  let reason;
  let reasonCode;

  if (closure.length) {
    classification = 'permanently_closed';
    plausibleRoaster = false;
    reasonCode = 'permanent_closure_evidence';
    reason = 'The official site says the business has permanently closed or ceased operating.';
  } else if (parked.length) {
    classification = 'unlikely_roaster';
    plausibleRoaster = false;
    reasonCode = 'parked_or_for_sale';
    reason = 'The official URL appears parked, for sale, missing, or unavailable.';
  } else if (strong.length) {
    classification = 'likely_roaster';
    plausibleRoaster = true;
    reasonCode = 'explicit_roasting_evidence';
    reason = 'The official site contains an explicit coffee-roasting statement.';
  } else if (cafeOnly.length >= 2) {
    classification = 'cafe_only';
    plausibleRoaster = false;
    reasonCode = 'cafe_without_roasting_evidence';
    reason = 'The official site presents a cafe or food-service business without evidence that it roasts coffee.';
  } else if (weak.length >= 3) {
    classification = 'possible_roaster';
    plausibleRoaster = true;
    reasonCode = 'multiple_coffee_product_signals';
    reason = 'The official site contains several coffee-product signals but no explicit roasting statement.';
  } else {
    classification = 'needs_review';
    plausibleRoaster = null;
    reasonCode = 'insufficient_evidence';
    reason = 'The home page does not provide enough evidence for a conservative automated decision.';
  }

  return {
    classification,
    plausibleRoaster,
    reasonCode,
    reason,
    evidence: [...closure, ...parked, ...strong, ...cafeOnly, ...weak].slice(0, 8),
    page: { title: title.replace(/\s+/g, ' ').trim().slice(0, 300) || null, description: description.replace(/\s+/g, ' ').trim().slice(0, 500) || null },
  };
}

function genericHostKind(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  for (const [suffix, kind] of GENERIC_HOSTS) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return kind;
  }
  if (host === 'google.com' || host.endsWith('.google.com') || host === 'sites.google.com') return 'business_directory';
  return null;
}

function isPrivateOrReservedIpv4(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0);
}

function isPrivateOrReservedIp(address) {
  const version = net.isIP(address);
  if (version === 4) return isPrivateOrReservedIpv4(address);
  if (version !== 6) return true;
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89a-f]/.test(normalized) || normalized.startsWith('ff') || normalized.startsWith('2001:db8:')) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateOrReservedIpv4(mapped[1]);
  const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    return isPrivateOrReservedIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return false;
}

async function resolveSafePublicUrl(value, lookup = dns.lookup) {
  let url;
  try { url = value instanceof URL ? new URL(value.toString()) : new URL(value); }
  catch { throw Object.assign(new Error('URL must be absolute'), { code: 'invalid_url' }); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Object.assign(new Error('Only credential-free HTTP(S) URLs are allowed'), { code: 'invalid_url' });
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const lookupHostname = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (hostname === PROHIBITED_HOST || hostname.endsWith(`.${PROHIBITED_HOST}`)) throw Object.assign(new Error('Roast Local access is explicitly prohibited'), { code: 'prohibited_host' });
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) throw Object.assign(new Error('Local hosts are not allowed'), { code: 'private_host' });
  let addresses;
  if (net.isIP(lookupHostname)) {
    if (isPrivateOrReservedIp(lookupHostname)) throw Object.assign(new Error('Private or reserved IP addresses are not allowed'), { code: 'private_host' });
    addresses = [{ address: lookupHostname, family: net.isIP(lookupHostname) }];
  } else {
    addresses = await lookup(lookupHostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((entry) => isPrivateOrReservedIp(entry.address))) throw Object.assign(new Error('Host resolves to a private or reserved IP address'), { code: 'private_host' });
    addresses = addresses.map((entry) => ({ address: entry.address, family: Number(entry.family) || net.isIP(entry.address) }));
  }
  url.hash = '';
  return { url, addresses: Object.freeze(addresses.map((entry) => Object.freeze({ ...entry }))) };
}

async function assertSafePublicUrl(value, lookup = dns.lookup) {
  return (await resolveSafePublicUrl(value, lookup)).url;
}

function createPinnedLookup(addresses) {
  const pinned = addresses.map((entry) => ({ address: entry.address, family: Number(entry.family) }));
  if (!pinned.length || pinned.some((entry) => !entry.address || ![4, 6].includes(entry.family) || isPrivateOrReservedIp(entry.address))) {
    throw Object.assign(new Error('Pinned DNS results must contain only public IP addresses'), { code: 'private_host' });
  }
  return (_hostname, options, callback) => {
    const wantsAll = typeof options === 'object' && options?.all;
    if (wantsAll) callback(null, pinned.map((entry) => ({ ...entry })));
    else callback(null, pinned[0].address, pinned[0].family);
  };
}

function responseHeaders(headers) {
  const result = new Headers();
  for (const [key, value] of Object.entries(headers || {})) {
    if (Array.isArray(value)) value.forEach((entry) => result.append(key, entry));
    else if (value !== undefined) result.set(key, String(value));
  }
  return result;
}

async function nodePinnedRequest(resolution, options) {
  const { url, addresses } = resolution;
  const requestFactory = options.requestFactory || (url.protocol === 'https:' ? https.request : http.request);
  const requestOptions = {
    method: 'GET',
    headers: options.headers,
    lookup: createPinnedLookup(addresses),
    family: addresses[0].family,
    autoSelectFamily: false,
    agent: false,
    signal: options.signal,
  };
  const tlsHostname = url.hostname.startsWith('[') && url.hostname.endsWith(']') ? url.hostname.slice(1, -1) : url.hostname;
  if (url.protocol === 'https:' && !net.isIP(tlsHostname)) requestOptions.servername = tlsHostname;

  return new Promise((resolve, reject) => {
    let request;
    try {
      request = requestFactory(url, requestOptions, (response) => {
        resolve({ status: response.statusCode || 0, headers: responseHeaders(response.headers), body: Readable.toWeb(response) });
      });
    } catch (error) {
      reject(error);
      return;
    }
    request.once('error', reject);
    request.end();
  });
}

function pathPatternToRegex(pattern) {
  const anchored = pattern.endsWith('$');
  const withoutEnd = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = withoutEnd.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`);
}

function parseRobots(text) {
  const groups = [];
  let group = null;
  let sawRule = false;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === 'user-agent') {
      if (!group || sawRule) {
        group = { agents: [], rules: [] };
        groups.push(group);
        sawRule = false;
      }
      group.agents.push(value.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && group) {
      sawRule = true;
      if (value) group.rules.push({ allow: key === 'allow', pattern: value });
    }
  }
  return groups;
}

function robotsAllows(text, path, agent = 'EveryCoffeeCatalogValidator') {
  const groups = parseRobots(text);
  const token = agent.toLowerCase();
  const specific = groups.filter((group) => group.agents.some((value) => value !== '*' && token.includes(value)));
  const selected = specific.length ? specific : groups.filter((group) => group.agents.includes('*'));
  const matches = selected.flatMap((group) => group.rules).filter((rule) => pathPatternToRegex(rule.pattern).test(path));
  if (!matches.length) return { allowed: true, matchedRule: null };
  matches.sort((a, b) => b.pattern.replace(/\*|\$$/g, '').length - a.pattern.replace(/\*|\$$/g, '').length || Number(b.allow) - Number(a.allow));
  return { allowed: matches[0].allow, matchedRule: matches[0] };
}

class RateLimiter {
  constructor({ globalDelayMs = 1000, perHostDelayMs = 5000 } = {}) {
    this.globalDelayMs = globalDelayMs;
    this.perHostDelayMs = perHostDelayMs;
    this.nextGlobal = 0;
    this.nextByHost = new Map();
    this.queue = Promise.resolve();
  }

  async wait(hostname) {
    let release;
    const turn = new Promise((resolve) => { release = resolve; });
    const previous = this.queue;
    this.queue = turn;
    await previous;
    try {
      const now = Date.now();
      const target = Math.max(now, this.nextGlobal, this.nextByHost.get(hostname) || 0);
      if (target > now) await new Promise((resolve) => setTimeout(resolve, target - now));
      const started = Date.now();
      this.nextGlobal = started + this.globalDelayMs;
      this.nextByHost.set(hostname, started + this.perHostDelayMs);
    } finally {
      release();
    }
  }
}

async function readBody(response, maxBytes) {
  if (!response.body) return { text: '', bytesRead: 0, truncated: false };
  const reader = response.body.getReader();
  const chunks = [];
  let bytesRead = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - bytesRead;
    if (value.byteLength > remaining) {
      if (remaining > 0) chunks.push(value.slice(0, remaining));
      bytesRead = maxBytes;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    bytesRead += value.byteLength;
  }
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))), bytesRead, truncated };
}

async function requestOnce(url, options) {
  const suppliedResolution = options.resolution;
  const resolution = suppliedResolution?.url?.toString() === new URL(url).toString()
    ? suppliedResolution
    : await resolveSafePublicUrl(url, options.lookup);
  const safeUrl = resolution.url;
  await options.limiter.wait(safeUrl.hostname);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const headers = { 'user-agent': options.userAgent, accept: options.accept || 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5' };
    const response = options.fetch ? await options.fetch(safeUrl, {
      method: 'GET', redirect: 'manual', signal: controller.signal, headers,
    }) : await nodePinnedRequest(resolution, { headers, signal: controller.signal, requestFactory: options.requestFactory });
    const location = response.headers.get('location');
    if (REDIRECT_STATUSES.has(response.status) && location) {
      return { url: safeUrl.toString(), status: response.status, location: new URL(location, safeUrl).toString(), headers: Object.fromEntries(response.headers.entries()), text: '', bytesRead: 0, truncated: false };
    }
    const body = await readBody(response, options.maxBytes);
    return { url: safeUrl.toString(), status: response.status, location: null, headers: Object.fromEntries(response.headers.entries()), ...body };
  } finally {
    clearTimeout(timeout);
  }
}

async function requestFollowingRedirects(startUrl, options) {
  let current = startUrl;
  const redirectChain = [];
  for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
    const response = await requestOnce(current, options);
    redirectChain.push({ url: response.url, status: response.status, location: response.location });
    if (!response.location) return { ...response, finalUrl: response.url, redirectChain };
    if (hop === options.maxRedirects) throw Object.assign(new Error(`More than ${options.maxRedirects} redirects`), { code: 'too_many_redirects', redirectChain });
    current = response.location;
  }
  throw Object.assign(new Error('Redirect loop'), { code: 'too_many_redirects', redirectChain });
}

function errorDetails(error) {
  return { code: error.code || (error.name === 'AbortError' ? 'timeout' : 'request_failed'), message: String(error.message || error).slice(0, 500) };
}

async function validateCandidate(raw, index, options = {}) {
  const checkedAt = new Date().toISOString();
  const key = candidateKey(raw, index);
  let candidate;
  try {
    candidate = normalizeRecord(raw, index);
  } catch (error) {
    return { key, inputIndex: index, sourceRecordId: raw?.source_record_id || raw?.sourceRecordId || raw?.id || null, requestedUrl: raw?.official_website || raw?.website || null, requestedHost: canonicalHost(raw?.official_website || raw?.website), finalUrl: null, finalHost: null, httpStatus: null, redirectChain: [], checkedAt, classification: 'input_error', plausibleRoaster: null, reasonCode: 'invalid_import_record', reason: 'The importer-ready record is invalid.', evidence: [], error: errorDetails(error) };
  }

  const config = {
    fetch: options.fetch || null,
    lookup: options.lookup || dns.lookup,
    limiter: options.limiter || new RateLimiter(),
    timeoutMs: options.timeoutMs || 12000,
    maxBytes: options.maxBytes || 524288,
    maxRedirects: options.maxRedirects ?? 5,
    userAgent: options.userAgent || 'EveryCoffeeCatalogValidator/1.0 (+https://every.coffee)',
    robotsCache: options.robotsCache || new Map(),
    requestFactory: options.requestFactory,
  };

  const base = { key, inputIndex: index, sourceRecordId: candidate.sourceRecordId, name: candidate.name, requestedUrl: candidate.websiteUrl, requestedHost: candidate.host, checkedAt };
  const initialHostKind = genericHostKind(candidate.host);
  if (initialHostKind) {
    const prohibited = initialHostKind === 'prohibited_directory';
    return { ...base, finalUrl: candidate.websiteUrl, finalHost: candidate.host, httpStatus: null, redirectChain: [], classification: prohibited ? 'prohibited_host' : 'unsupported_host', plausibleRoaster: false, reasonCode: prohibited ? 'prohibited_roastlocal_host' : 'generic_directory_or_social_host', reason: prohibited ? 'Roast Local access is explicitly prohibited.' : `The supplied URL is a ${initialHostKind.replace(/_/g, ' ')}, not a candidate-owned official website.`, evidence: [], error: prohibited ? { code: 'prohibited_host', message: 'Roast Local access is explicitly prohibited' } : null };
  }
  const redirectChain = [];
  let current = candidate.websiteUrl;
  try {
    for (let hop = 0; hop <= config.maxRedirects; hop += 1) {
      const resolution = await resolveSafePublicUrl(current, config.lookup);
      const safeUrl = resolution.url;
      const redirectedHostKind = genericHostKind(safeUrl.hostname);
      if (redirectedHostKind) {
        const prohibited = redirectedHostKind === 'prohibited_directory';
        return { ...base, finalUrl: safeUrl.toString(), finalHost: canonicalHost(safeUrl.toString()), httpStatus: null, redirectChain, classification: prohibited ? 'prohibited_host' : 'unsupported_host', plausibleRoaster: false, reasonCode: prohibited ? 'prohibited_roastlocal_host' : 'redirected_to_generic_directory_or_social_host', reason: prohibited ? 'Roast Local access is explicitly prohibited.' : `The official URL redirected to a ${redirectedHostKind.replace(/_/g, ' ')}, not a candidate-owned website.`, evidence: [], error: prohibited ? { code: 'prohibited_host', message: 'Roast Local access is explicitly prohibited' } : null };
      }
      const origin = safeUrl.origin;
      if (!config.robotsCache.has(origin)) {
        config.robotsCache.set(origin, (async () => {
          try {
            const robots = await requestFollowingRedirects(`${origin}/robots.txt`, { ...config, accept: 'text/plain,*/*;q=0.1', maxBytes: 65536 });
            if ([401, 403, 429].includes(robots.status) || robots.status >= 500) return { available: false, status: robots.status, error: `robots.txt returned ${robots.status}` };
            if (robots.status >= 200 && robots.status < 300) return { available: true, status: robots.status, text: robots.text };
            return { available: true, status: robots.status, text: '' };
          } catch (error) {
            return { available: false, status: null, error: errorDetails(error).message };
          }
        })());
      }
      const robots = await config.robotsCache.get(origin);
      if (!robots.available) {
        return { ...base, finalUrl: safeUrl.toString(), finalHost: canonicalHost(safeUrl.toString()), httpStatus: null, redirectChain, classification: 'robots_unavailable', plausibleRoaster: null, reasonCode: 'robots_policy_unavailable', reason: 'The site robots policy could not be checked safely.', evidence: [], robots: { status: robots.status, allowed: null }, error: { code: 'robots_unavailable', message: robots.error } };
      }
      const robotsAgent = config.userAgent.split(/[\/\s]/, 1)[0] || 'EveryCoffeeCatalogValidator';
      const policy = robotsAllows(robots.text, `${safeUrl.pathname}${safeUrl.search}`, robotsAgent);
      if (!policy.allowed) {
        return { ...base, finalUrl: safeUrl.toString(), finalHost: canonicalHost(safeUrl.toString()), httpStatus: null, redirectChain, classification: 'robots_blocked', plausibleRoaster: null, reasonCode: 'robots_policy_disallows', reason: 'robots.txt disallows this validator from requesting the page.', evidence: [], robots: { status: robots.status, allowed: false, matchedRule: policy.matchedRule }, error: null };
      }

      const response = await requestOnce(safeUrl, { ...config, resolution });
      redirectChain.push({ url: response.url, status: response.status, location: response.location });
      if (response.location) {
        if (hop === config.maxRedirects) throw Object.assign(new Error(`More than ${config.maxRedirects} redirects`), { code: 'too_many_redirects' });
        current = response.location;
        continue;
      }
      const contentType = response.headers['content-type'] || null;
      const responseBase = { ...base, finalUrl: response.url, finalHost: canonicalHost(response.url), httpStatus: response.status, redirectChain, contentType, bytesRead: response.bytesRead, truncated: response.truncated, robots: { status: robots.status, allowed: true } };
      if (response.status < 200 || response.status >= 300) {
        return { ...responseBase, classification: 'http_error', plausibleRoaster: null, reasonCode: 'non_success_http_status', reason: `The official site returned HTTP ${response.status}.`, evidence: [], error: { code: 'http_error', message: `HTTP ${response.status}` } };
      }
      if (contentType && !/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType)) {
        return { ...responseBase, classification: 'non_html', plausibleRoaster: null, reasonCode: 'non_html_response', reason: `The official URL returned ${contentType}, not HTML.`, evidence: [], error: null };
      }
      const classification = classifyHtml(response.text, candidate);
      const { extractOfficialSiteData } = require('./officialSiteData');
      const officialSite = extractOfficialSiteData(response.text, response.url, { checkedAt });
      return { ...responseBase, ...classification, officialSite, error: null };
    }
  } catch (error) {
    const details = errorDetails(error);
    return { ...base, finalUrl: current, finalHost: canonicalHost(current), httpStatus: null, redirectChain: error.redirectChain || redirectChain, classification: details.code === 'prohibited_host' ? 'prohibited_host' : 'unreachable', plausibleRoaster: details.code === 'prohibited_host' ? false : null, reasonCode: details.code === 'prohibited_host' ? 'prohibited_roastlocal_host' : 'official_site_unreachable', reason: details.code === 'prohibited_host' ? 'Roast Local access is explicitly prohibited.' : 'The official site could not be validated.', evidence: [], error: details };
  }
  return { ...base, finalUrl: current, finalHost: canonicalHost(current), httpStatus: null, redirectChain, classification: 'unreachable', plausibleRoaster: null, reasonCode: 'redirect_chain_unresolved', reason: 'The redirect chain did not resolve.', evidence: [], error: { code: 'too_many_redirects', message: 'The redirect chain did not resolve.' } };
}

module.exports = {
  PROHIBITED_HOST,
  RateLimiter,
  assertSafePublicUrl,
  candidateKey,
  classifyHtml,
  createPinnedLookup,
  genericHostKind,
  isPrivateOrReservedIp,
  nodePinnedRequest,
  parseRobots,
  requestFollowingRedirects,
  resolveSafePublicUrl,
  robotsAllows,
  validateCandidate,
};
