#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');

const SITEMAP_URL = 'https://www.roastlocal.com/sitemap.xml';
const ROBOTS_URL = 'https://www.roastlocal.com/robots.txt';
const ALLOWED_HOSTS = new Set(['roastlocal.com', 'www.roastlocal.com']);
const USER_AGENT = 'EveryCoffeeDataEnrichment/1.0';
const SCHEMA_VERSION = 1;

function parseArgs(argv) {
  const options = { command: argv[0] || null };
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    if (['apply', 'selfTest', 'retryErrors'].includes(key)) {
      options[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${token} requires a value`);
    options[key] = value;
    index += 1;
  }
  return options;
}

function usage() {
  return `Usage:
  node cli.js self-test
  node cli.js crawl --output profiles.ndjson [--manifest manifest.json]
  node cli.js plan --input profiles.ndjson --output import-plan.json
  node cli.js apply --plan import-plan.json [--checkpoint checkpoint.json]
  node cli.js verify --plan import-plan.json

All network requests are constrained to Roast Local sitemap, robots.txt, and
canonical three-segment profile URLs. /terms and descendants are blocked before
every request and redirect. Crawl output is append-only and resumable.`;
}

function decodePathname(pathname) {
  let value = pathname;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const decoded = decodeURIComponent(value);
      if (decoded === value) break;
      value = decoded;
    } catch {
      break;
    }
  }
  return value.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
}

function isTermsPath(urlValue) {
  const url = urlValue instanceof URL ? urlValue : new URL(urlValue);
  const pathname = decodePathname(url.pathname).replace(/\/+$/, '') || '/';
  return pathname === '/terms' || pathname.startsWith('/terms/');
}

function assertAllowedRequest(urlValue, kind) {
  const url = urlValue instanceof URL ? urlValue : new URL(urlValue);
  if (url.protocol !== 'https:') throw new Error(`Blocked non-HTTPS ${kind} URL: ${url}`);
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) throw new Error(`Blocked off-site ${kind} URL: ${url}`);
  if (isTermsPath(url)) throw new Error(`Blocked prohibited /terms ${kind} URL: ${url}`);
  if (url.username || url.password) throw new Error(`Blocked credentialed ${kind} URL: ${url}`);
  return url;
}

function profilePath(urlValue) {
  const url = assertAllowedRequest(urlValue, 'profile');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 3) return false;
  if (['api', 'account', 'dashboard', 'onboarding', 'shop', 'blog', 'terms'].includes(parts[0].toLowerCase())) return false;
  return true;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class StartLimiter {
  constructor(delayMs) {
    this.delayMs = delayMs;
    this.nextAt = 0;
    this.chain = Promise.resolve();
  }

  wait() {
    const pending = this.chain.then(async () => {
      const now = Date.now();
      const waitMs = Math.max(0, this.nextAt - now);
      if (waitMs) await sleep(waitMs);
      this.nextAt = Date.now() + this.delayMs;
    });
    this.chain = pending.catch(() => {});
    return pending;
  }
}

async function responseTextWithLimit(response, maximumBytes) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > maximumBytes) {
      await reader.cancel();
      throw new Error(`Response exceeds ${maximumBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function safeFetchText(urlValue, options = {}) {
  const limiter = options.limiter || new StartLimiter(0);
  const maximumBytes = options.maximumBytes || 1024 * 1024;
  const maximumRedirects = options.maximumRedirects ?? 3;
  const timeoutMs = options.timeoutMs || 20000;
  let current = assertAllowedRequest(urlValue, options.kind || 'request');
  const redirectChain = [];
  for (let hop = 0; hop <= maximumRedirects; hop += 1) {
    await limiter.wait();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          accept: options.accept || 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
          'user-agent': options.userAgent || USER_AGENT,
        },
      });
    } finally {
      clearTimeout(timer);
    }
    const location = response.headers.get('location');
    redirectChain.push({ url: current.toString(), status: response.status, location });
    if ([301, 302, 303, 307, 308].includes(response.status) && location) {
      if (hop === maximumRedirects) throw new Error(`Too many redirects from ${urlValue}`);
      current = assertAllowedRequest(new URL(location, current), 'redirect');
      continue;
    }
    const text = await responseTextWithLimit(response, maximumBytes);
    return {
      status: response.status,
      finalUrl: current.toString(),
      headers: Object.fromEntries(['content-type', 'etag', 'last-modified', 'retry-after'].map((key) => [key, response.headers.get(key)])),
      redirectChain,
      text,
      bytes: Buffer.byteLength(text),
    };
  }
  throw new Error(`Redirect loop from ${urlValue}`);
}

function xmlLocations(xml) {
  return [...String(xml).matchAll(/<loc>([\s\S]*?)<\/loc>/gi)]
    .map((match) => match[1].replace(/&amp;/g, '&').trim())
    .filter(Boolean);
}

function robotsAllowed(robotsText, pathname) {
  const lines = String(robotsText).split(/\r?\n/).map((line) => line.replace(/#.*/, '').trim()).filter(Boolean);
  let applies = false;
  const rules = [];
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === 'user-agent') applies = value === '*' || USER_AGENT.toLowerCase().startsWith(value.toLowerCase());
    else if (applies && (key === 'allow' || key === 'disallow') && value) rules.push({ allow: key === 'allow', value });
  }
  const matching = rules.filter((rule) => pathname.startsWith(rule.value)).sort((a, b) => b.value.length - a.value.length || Number(b.allow) - Number(a.allow));
  return matching.length ? matching[0].allow : true;
}

function cleanString(value, maximum = 20000) {
  if (value === null || value === undefined) return null;
  const result = String(value).normalize('NFC').replace(/\s+/g, ' ').trim();
  return result ? result.slice(0, maximum) : null;
}

function canonicalHost(value) {
  if (!value) return null;
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '') || null; }
  catch { return null; }
}

function safeExternalUrl(value, baseUrl) {
  if (!value) return null;
  try {
    const url = new URL(String(value).trim(), baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname) return null;
    if (ALLOWED_HOSTS.has(url.hostname.toLowerCase()) || isTermsPath(url)) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch { return null; }
}

const SOCIAL_HOSTS = new Set([
  'facebook.com', 'instagram.com', 'linkedin.com', 'tiktok.com', 'twitter.com', 'x.com',
  'youtube.com', 'youtu.be', 'threads.net', 'pinterest.com', 'linktr.ee',
]);

function isSocialHost(host) {
  return [...SOCIAL_HOSTS].some((value) => host === value || host.endsWith(`.${value}`));
}

function schemaTypes(value) {
  return (Array.isArray(value) ? value : [value]).map((item) => String(item || '').replace(/.*[#/]/, ''));
}

function flattenJsonLd(value, result = [], depth = 0) {
  if (depth > 8 || result.length > 1000 || value === null || value === undefined) return result;
  if (Array.isArray(value)) {
    value.slice(0, 500).forEach((item) => flattenJsonLd(item, result, depth + 1));
    return result;
  }
  if (typeof value !== 'object') return result;
  if (value['@type']) result.push(value);
  Object.values(value).forEach((item) => {
    if (item && typeof item === 'object') flattenJsonLd(item, result, depth + 1);
  });
  return result;
}

function structuredAddress(value) {
  if (!value) return null;
  if (typeof value === 'string') return { address1: cleanString(value, 500) };
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const countryValue = typeof value.addressCountry === 'object' ? value.addressCountry?.name || value.addressCountry?.['@id'] : value.addressCountry;
  const result = {
    label: 'roastery',
    address1: cleanString(value.streetAddress, 500),
    address2: cleanString(value.postOfficeBoxNumber, 200),
    city: cleanString(value.addressLocality, 160),
    region: cleanString(value.addressRegion, 160),
    postal_code: cleanString(value.postalCode, 60),
    country: cleanString(countryValue, 100),
  };
  const compact = Object.fromEntries(Object.entries(result).filter(([, item]) => item !== null));
  return compact.address1 || compact.city ? compact : null;
}

function roastStyles(text) {
  const section = /Roast styles(?:\s*:)?\s*(?:Roast styles:\s*)?([\s\S]{0,180}?)(?:Other indie|This roaster|Location|Last verified)/i.exec(text)?.[1] || '';
  const styles = [];
  for (const style of ['Ultra Light', 'Medium-Light', 'Medium Light', 'Light', 'Medium-Dark', 'Medium Dark', 'Medium', 'Dark']) {
    if (new RegExp(`\\b${style.replace(' ', '[ -]')}\\b`, 'i').test(section)) styles.push(style.replace(' ', '-'));
  }
  return [...new Set(styles)];
}

function parseProfile(html, requestedUrl, finalUrl) {
  const $ = cheerio.load(html);
  const nodes = [];
  $('script[type="application/ld+json"]').slice(0, 50).each((_index, element) => {
    const source = $(element).text().trim();
    if (!source || source.length > 300000) return;
    try { flattenJsonLd(JSON.parse(source), nodes); } catch { /* malformed JSON-LD is ignored */ }
  });
  const requestedPath = new URL(requestedUrl).pathname;
  const businesses = nodes.filter((node) => schemaTypes(node['@type']).some((type) => ['CafeOrCoffeeShop', 'LocalBusiness', 'OnlineStore', 'Store', 'Organization'].includes(type)));
  const business = businesses.find((node) => {
    const identity = String(node['@id'] || node.url || '');
    return identity.includes(requestedPath) && cleanString(node.name, 160) !== 'Roast Local';
  }) || businesses.find((node) => cleanString(node.name, 160) !== 'Roast Local') || null;

  const bodyClone = $('body').clone();
  bodyClone.find('script,style,noscript,svg,template').remove();
  const bodyText = cleanString(bodyClone.text(), 200000) || '';
  const sameAs = Array.isArray(business?.sameAs) ? business.sameAs : business?.sameAs ? [business.sameAs] : [];
  const externalUrls = sameAs.map((value) => safeExternalUrl(value, finalUrl)).filter(Boolean);
  const officialWebsite = externalUrls.find((value) => !isSocialHost(canonicalHost(value))) || null;
  const socials = externalUrls.filter((value) => isSocialHost(canonicalHost(value)));
  const address = structuredAddress(business?.address);
  const latitude = Number(business?.geo?.latitude);
  const longitude = Number(business?.geo?.longitude);
  if (address && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90) address.lat = latitude;
  if (address && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180) address.lng = longitude;
  const telephone = cleanString(business?.telephone, 100);
  const email = cleanString(business?.email, 320)?.replace(/^mailto:/i, '') || null;
  const contact = {};
  if (telephone) contact.phone = telephone;
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) contact.email = email;
  if (socials.length) contact.socials = [...new Set(socials)];
  const description = cleanString(business?.description, 20000);
  const image = safeExternalUrl(Array.isArray(business?.image) ? business.image[0] : (business?.image?.url || business?.image), finalUrl);
  const verifiedMatch = /Last verified\s+([A-Za-z]+\s+\d{4})/i.exec(bodyText);
  return {
    sourceProfile: requestedUrl,
    finalUrl,
    name: cleanString(business?.name, 160),
    officialWebsite,
    contact: Object.keys(contact).length ? contact : null,
    location: address,
    description,
    image,
    roastStyles: roastStyles(bodyText),
    claimed: !/has(?:n't| not|n’t) claimed their profile yet/i.test(bodyText),
    lastVerifiedLabel: verifiedMatch?.[1] || null,
    schemaType: business ? schemaTypes(business['@type']) : [],
  };
}

function readNdjson(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`Invalid NDJSON in ${file} line ${index + 1}: ${error.message}`); }
  });
}

function writePrivateJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

async function crawl(options) {
  if (!options.output) throw new Error(`crawl requires --output\n\n${usage()}`);
  const output = path.resolve(options.output);
  const manifest = path.resolve(options.manifest || `${output}.manifest.json`);
  const delayMs = integer(options.delayMs, 400, 250, 60000, '--delay-ms');
  const concurrency = integer(options.concurrency, 4, 1, 8, '--concurrency');
  const limiter = new StartLimiter(delayMs);

  const robotsResponse = await safeFetchText(ROBOTS_URL, { limiter, kind: 'robots', accept: 'text/plain,*/*;q=0.1', maximumBytes: 128 * 1024 });
  if (robotsResponse.status < 200 || robotsResponse.status >= 300) throw new Error(`robots.txt returned ${robotsResponse.status}`);
  const sitemapResponse = await safeFetchText(SITEMAP_URL, { limiter, kind: 'sitemap', accept: 'application/xml,text/xml;q=0.9,*/*;q=0.1', maximumBytes: 5 * 1024 * 1024 });
  if (sitemapResponse.status < 200 || sitemapResponse.status >= 300) throw new Error(`sitemap returned ${sitemapResponse.status}`);
  const allUrls = [...new Set(xmlLocations(sitemapResponse.text))];
  const profiles = allUrls.filter((url) => {
    try { return profilePath(url); } catch { return false; }
  });
  if (!profiles.length) throw new Error('No canonical profile URLs found in sitemap');
  for (const url of profiles) {
    if (!robotsAllowed(robotsResponse.text, new URL(url).pathname)) throw new Error(`robots.txt disallows queued profile ${url}`);
  }
  const existingRows = readNdjson(output);
  const completed = new Map(existingRows.map((row) => [row.requestedUrl, row]));
  const pending = profiles.filter((url) => !completed.has(url) || (options.retryErrors && (completed.get(url).status !== 200 || !completed.get(url).parsed?.name)));
  const limit = options.limit === undefined ? pending.length : integer(options.limit, null, 1, profiles.length, '--limit');
  const selected = pending.slice(0, limit);
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  const startedAt = new Date().toISOString();
  writePrivateJson(manifest, {
    schemaVersion: SCHEMA_VERSION,
    source: SITEMAP_URL,
    robots: { url: ROBOTS_URL, status: robotsResponse.status, fetchedAt: startedAt },
    startedAt,
    sitemap: { status: sitemapResponse.status, fetchedAt: startedAt, allUniqueUrls: allUrls.length, profileUrls: profiles.length },
    prohibitedPaths: ['/terms', '/terms/**'],
    requestPolicy: { delayMs, concurrency, userAgent: USER_AGENT, followsPageLinks: false },
    output,
    previouslyCompleted: completed.size,
    selected: selected.length,
  });

  let cursor = 0;
  let runCompleted = 0;
  let errors = 0;
  const workers = Array.from({ length: Math.min(concurrency, selected.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= selected.length) return;
      const requestedUrl = selected[index];
      const fetchedAt = new Date().toISOString();
      let row;
      try {
        let response;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          response = await safeFetchText(requestedUrl, { limiter, kind: 'profile', maximumBytes: 1024 * 1024, timeoutMs: 25000 });
          if (![429, 500, 502, 503, 504].includes(response.status)) break;
          await sleep(Math.max(2000, Number(response.headers['retry-after'] || 0) * 1000));
        }
        const contentType = response.headers['content-type'] || '';
        const parsed = response.status >= 200 && response.status < 300 && /html/i.test(contentType)
          ? parseProfile(response.text, requestedUrl, response.finalUrl)
          : null;
        row = {
          schemaVersion: SCHEMA_VERSION,
          requestedUrl,
          fetchedAt,
          status: response.status,
          finalUrl: response.finalUrl,
          redirectChain: response.redirectChain,
          contentType: response.headers['content-type'],
          etag: response.headers.etag,
          bytes: response.bytes,
          parsed,
          error: null,
        };
        if (response.status !== 200 || !parsed?.name) errors += 1;
      } catch (error) {
        errors += 1;
        row = { schemaVersion: SCHEMA_VERSION, requestedUrl, fetchedAt, status: null, finalUrl: null, redirectChain: [], parsed: null, error: cleanString(error.message, 1000) };
      }
      fs.appendFileSync(output, `${JSON.stringify(row)}\n`, { encoding: 'utf8', mode: 0o600 });
      runCompleted += 1;
      if (runCompleted % 50 === 0 || runCompleted === selected.length) {
        console.log(`[${runCompleted}/${selected.length}] errors=${errors} latest=${requestedUrl}`);
      }
    }
  });
  await Promise.all(workers);
  const finalRows = readNdjson(output);
  const latest = new Map(finalRows.map((row) => [row.requestedUrl, row]));
  const summary = {
    completedAt: new Date().toISOString(),
    uniqueResults: latest.size,
    successful: [...latest.values()].filter((row) => row.status === 200 && row.parsed?.name).length,
    errors: [...latest.values()].filter((row) => row.status !== 200 || !row.parsed?.name).length,
    termsRequests: [...latest.keys()].filter(isTermsPath).length,
  };
  const currentManifest = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  writePrivateJson(manifest, { ...currentManifest, summary });
  console.log(`Crawl complete: ${JSON.stringify(summary)}`);
}

function integer(value, fallback, minimum, maximum, name) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new Error(`${name} must be ${minimum}-${maximum}`);
  return number;
}

function normalizeName(value) {
  return cleanString(value, 160)?.normalize('NFKC').toLowerCase().replace(/&/g, ' and ')
    .replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim() || null;
}

function slugify(value) {
  return String(value || 'roaster').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'roaster';
}

function compact(object) {
  return Object.fromEntries(Object.entries(object || {}).filter(([, value]) => value !== null && value !== undefined && value !== ''));
}

function locationFingerprint(location) {
  if (!location) return null;
  const hasCoordinates = location.lat !== null && location.lat !== undefined && location.lat !== '' &&
    location.lng !== null && location.lng !== undefined && location.lng !== '';
  if (hasCoordinates && Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lng))) {
    return `geo:${Number(location.lat).toFixed(4)}:${Number(location.lng).toFixed(4)}`;
  }
  return ['address1', 'address2', 'city', 'region', 'postal_code', 'country']
    .map((key) => cleanString(location[key], 500)?.toLowerCase() || '').join('|');
}

function sameLocation(first, second) {
  if (!first || !second) return false;
  const firstLat = Number(first.lat); const firstLng = Number(first.lng);
  const secondLat = Number(second.lat); const secondLng = Number(second.lng);
  const allCoordinateValuesPresent = [first.lat, first.lng, second.lat, second.lng]
    .every((value) => value !== null && value !== undefined && value !== '');
  if (allCoordinateValuesPresent && [firstLat, firstLng, secondLat, secondLng].every(Number.isFinite) && Math.abs(firstLat - secondLat) <= 0.0005 && Math.abs(firstLng - secondLng) <= 0.0005) return true;
  return locationFingerprint(first) === locationFingerprint(second);
}

function mergeContact(items) {
  const result = {};
  for (const item of items.filter(Boolean)) {
    for (const key of ['phone', 'email']) if (!result[key] && item[key]) result[key] = item[key];
    if (Array.isArray(item.socials)) result.socials = [...new Set([...(result.socials || []), ...item.socials])];
  }
  return Object.keys(result).length ? result : null;
}

function usableDescription(value, name) {
  const description = cleanString(value, 20000);
  if (!description || description.length < 40) return null;
  if (/Roast Local (?:tracks|is a free directory)/i.test(description)) return null;
  if (new RegExp(`^${String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is an independent coffee roaster in `, 'i').test(description)) return null;
  return description;
}

async function fetchAll(db, table, select, orderColumns = ['id'], pageSize = 1000) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    let query = db.from(table).select(select);
    for (const column of orderColumns) query = query.order(column, { ascending: true });
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw new Error(`Unable to read ${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

function databaseClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase environment variables are required');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function snapshotDatabase(db) {
  const entities = await fetchAll(db, 'entities', 'id,name,slug,name_slug,website_url,description_raw,short_description,primary_location,contact');
  const roles = await fetchAll(db, 'entity_roles', 'entity_id,role,role_metadata', ['entity_id', 'role']);
  const locations = await fetchAll(db, 'entity_locations', 'id,entity_id,label,address1,address2,city,region,postal_code,country,lat,lng,is_primary');
  return { entities, roles, locations };
}

function currentRows(input) {
  const latest = new Map(readNdjson(input).map((row) => [row.requestedUrl, row]));
  return [...latest.values()];
}

function titleCaseSlug(value) {
  return String(value || '').split('-').filter(Boolean).map((part) => {
    if (/^(?:llc|usa)$/i.test(part)) return part.toUpperCase();
    if (/^(?:and|of|the|in)$/i.test(part)) return part.toLowerCase();
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  }).join(' ').replace(/^./, (letter) => letter.toUpperCase());
}

function locationNameFromSlug(value) {
  const overrides = { 'coeur-dalene': "Coeur d'Alene" };
  return overrides[value] || titleCaseSlug(value);
}

function redirectFallback(row) {
  if (row.status !== 200 || row.parsed?.name || !row.requestedUrl || !row.finalUrl) return null;
  const requested = new URL(row.requestedUrl);
  const final = new URL(row.finalUrl);
  const requestedParts = requested.pathname.split('/').filter(Boolean);
  const finalParts = final.pathname.split('/').filter(Boolean);
  if (requestedParts.length !== 3 || finalParts.length !== 2 || requestedParts[0] !== finalParts[0] || requestedParts[1] !== finalParts[1]) return null;
  return {
    sourceProfile: row.requestedUrl,
    finalUrl: row.finalUrl,
    name: titleCaseSlug(requestedParts[2]),
    officialWebsite: null,
    contact: null,
    location: { label: 'roastery', city: locationNameFromSlug(requestedParts[1]), region: locationNameFromSlug(requestedParts[0]) },
    description: null,
    image: null,
    roastStyles: [],
    claimed: false,
    lastVerifiedLabel: null,
    schemaType: [],
    redirectFallback: true,
  };
}

function sourceRecord(row) {
  const parsed = row.parsed?.name ? row.parsed : redirectFallback(row);
  return {
    sourceProfile: row.requestedUrl,
    finalUrl: row.finalUrl,
    fetchedAt: row.fetchedAt,
    etag: row.etag,
    name: parsed.name,
    websiteUrl: parsed.officialWebsite,
    host: canonicalHost(parsed.officialWebsite),
    location: parsed.location ? compact(parsed.location) : null,
    contact: parsed.contact,
    description: usableDescription(parsed.description, parsed.name),
    roastStyles: parsed.roastStyles || [],
    claimed: Boolean(parsed.claimed),
    lastVerifiedLabel: parsed.lastVerifiedLabel,
    image: parsed.image,
    redirectFallback: Boolean(parsed.redirectFallback),
  };
}

function sourceGroupKey(record) {
  if (record.host) return `host:${record.host}`;
  return `profile:${record.sourceProfile}`;
}

function sourceProvenance(records, syncedAt) {
  const profiles = {};
  for (const record of records) {
    const key = crypto.createHash('sha256').update(record.sourceProfile).digest('hex').slice(0, 24);
    profiles[key] = compact({
      source_profile: record.sourceProfile,
      final_url: record.finalUrl,
      fetched_at: record.fetchedAt,
      etag: record.etag,
      observed_name: record.name,
      official_website: record.websiteUrl,
      location: record.location,
      contact: record.contact,
      roast_styles: record.roastStyles.length ? record.roastStyles : null,
      claimed: record.claimed,
      last_verified_label: record.lastVerifiedLabel,
      source_image: record.image,
      redirect_fallback: record.redirectFallback || null,
    });
  }
  return { schema_version: SCHEMA_VERSION, sitemap_url: SITEMAP_URL, last_synced_at: syncedAt, profiles };
}

function mergeRoleMetadata(current, incoming) {
  const metadata = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const provenance = metadata.provenance && typeof metadata.provenance === 'object' ? metadata.provenance : {};
  const publicDirectories = provenance.public_directories && typeof provenance.public_directories === 'object' ? provenance.public_directories : {};
  const existing = publicDirectories.roast_local && typeof publicDirectories.roast_local === 'object' ? publicDirectories.roast_local : {};
  return {
    ...metadata,
    provenance: {
      ...provenance,
      public_directories: {
        ...publicDirectories,
        roast_local: {
          ...existing,
          ...incoming,
          profiles: { ...(existing.profiles || {}), ...(incoming.profiles || {}) },
        },
      },
    },
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function planHash(plan) {
  const body = Object.fromEntries(Object.entries(plan).filter(([key]) => key !== 'planHash'));
  return crypto.createHash('sha256').update(stableStringify(body)).digest('hex');
}

function chooseName(records) {
  const counts = new Map();
  for (const record of records) {
    const key = normalizeName(record.name);
    if (!key) continue;
    const current = counts.get(key) || { count: 0, values: [] };
    current.count += 1; current.values.push(record.name); counts.set(key, current);
  }
  const best = [...counts.values()].sort((a, b) => b.count - a.count || Math.min(...a.values.map((v) => v.length)) - Math.min(...b.values.map((v) => v.length)))[0];
  return best?.values.sort((a, b) => a.length - b.length || a.localeCompare(b))[0] || records[0]?.name || null;
}

function allocateSlug(name, used) {
  const base = slugify(name);
  let candidate = base; let suffix = 2;
  while (used.has(candidate)) { candidate = `${base.slice(0, 78 - String(suffix).length)}-${suffix}`; suffix += 1; }
  used.add(candidate); return candidate;
}

function indexSnapshot(snapshot) {
  const entitiesByHost = new Map();
  const entitiesByName = new Map();
  const roles = new Map(snapshot.roles.map((role) => [`${role.entity_id}:${role.role}`, role]));
  const locations = new Map();
  for (const entity of snapshot.entities) {
    const host = canonicalHost(entity.website_url);
    if (host) { if (!entitiesByHost.has(host)) entitiesByHost.set(host, []); entitiesByHost.get(host).push(entity); }
    const name = normalizeName(entity.name);
    if (name) { if (!entitiesByName.has(name)) entitiesByName.set(name, []); entitiesByName.get(name).push(entity); }
  }
  for (const location of snapshot.locations) {
    if (!locations.has(location.entity_id)) locations.set(location.entity_id, []);
    locations.get(location.entity_id).push(location);
  }
  return { entitiesByHost, entitiesByName, roles, locations };
}

function locationContextMatches(entity, incomingLocations, snapshotIndex) {
  const existing = snapshotIndex.locations.get(entity.id) || [];
  for (const incoming of incomingLocations) {
    if (existing.some((location) => sameLocation(location, incoming))) return true;
    const incomingCity = normalizeName(incoming.city);
    const incomingRegion = normalizeName(incoming.region);
    if (incomingCity && existing.some((location) => {
      const cityMatches = normalizeName(location.city) === incomingCity;
      const regionMatches = !incomingRegion || !location.region || normalizeName(location.region) === incomingRegion;
      return cityMatches && regionMatches;
    })) return true;
    const primary = normalizeName(entity.primary_location) || '';
    if (incomingCity && primary.includes(incomingCity) && (!incomingRegion || primary.includes(incomingRegion))) return true;
  }
  return false;
}

function exactLocationMatches(entity, incomingLocations, snapshotIndex) {
  const existing = snapshotIndex.locations.get(entity.id) || [];
  return existing.some((location) => incomingLocations.some((incoming) => sameLocation(location, incoming)));
}

function resolveGroup(records, snapshotIndex) {
  const name = chooseName(records);
  const host = records.find((record) => record.host)?.host || null;
  const exactHost = host ? snapshotIndex.entitiesByHost.get(host) || [] : [];
  if (exactHost.length === 1) return { kind: 'match', entity: exactHost[0], reason: 'exact_host' };
  if (exactHost.length > 1) {
    const incomingLocations = records.map((record) => record.location).filter(Boolean);
    const exactLocated = exactHost.filter((entity) => exactLocationMatches(entity, incomingLocations, snapshotIndex));
    if (exactLocated.length === 1) return { kind: 'match', entity: exactLocated[0], reason: 'exact_host_and_coordinates' };
    const located = exactHost.filter((entity) => locationContextMatches(entity, incomingLocations, snapshotIndex));
    if (located.length === 1) return { kind: 'match', entity: located[0], reason: 'exact_host_and_location' };
    const allNamed = exactHost.filter((entity) => normalizeName(entity.name) === normalizeName(name));
    if (allNamed.length === 1) return { kind: 'match', entity: allNamed[0], reason: 'exact_host_and_name' };
    const roasters = exactHost.filter((entity) => snapshotIndex.roles.has(`${entity.id}:roaster`));
    const named = roasters.filter((entity) => normalizeName(entity.name) === normalizeName(name));
    if (named.length === 1) return { kind: 'match', entity: named[0], reason: 'exact_host_and_name' };
    if (roasters.length === 1) return { kind: 'match', entity: roasters[0], reason: 'only_roaster_on_host' };
    if (roasters.length === 0) return { kind: 'create', reason: 'brand_roaster_missing_from_shared_cafe_host' };
    return { kind: 'conflict', reason: 'multiple_entities_use_exact_host', entityIds: exactHost.map((entity) => entity.id) };
  }
  const sameName = snapshotIndex.entitiesByName.get(normalizeName(name)) || [];
  const roasterNames = sameName.filter((entity) => snapshotIndex.roles.has(`${entity.id}:roaster`));
  const incomingLocations = records.map((record) => record.location).filter(Boolean);
  const exactLocationMatchesForName = sameName.filter((entity) => exactLocationMatches(entity, incomingLocations, snapshotIndex));
  if (exactLocationMatchesForName.length === 1) return { kind: 'match', entity: exactLocationMatchesForName[0], reason: 'name_and_coordinates' };
  const locationMatches = sameName.filter((entity) => locationContextMatches(entity, incomingLocations, snapshotIndex));
  if (locationMatches.length === 1) return { kind: 'match', entity: locationMatches[0], reason: 'name_and_location' };
  if (sameName.length === 1) return { kind: 'match', entity: sameName[0], reason: sameName[0].website_url ? 'unique_exact_name' : 'name_and_missing_website' };
  if (!host && roasterNames.length === 1) return { kind: 'match', entity: roasterNames[0], reason: 'name_only_no_source_website' };
  if (sameName.length) return { kind: 'create', reason: 'same_name_but_distinct_location_or_identity' };
  return { kind: 'create' };
}

async function buildPlan(options) {
  if (!options.input || !options.output) throw new Error(`plan requires --input and --output\n\n${usage()}`);
  const rows = currentRows(path.resolve(options.input));
  const successfulRows = rows.filter((row) => row.status === 200 && (row.parsed?.name || redirectFallback(row)?.name));
  const successful = successfulRows.map(sourceRecord);
  const errors = rows.filter((row) => !successfulRows.includes(row));
  if (errors.length) throw new Error(`Refusing to plan: ${errors.length} sitemap profiles do not have a successful parsed result`);
  if (rows.some((row) => isTermsPath(row.requestedUrl))) throw new Error('Crawl artifact contains a prohibited /terms request');
  const groups = new Map();
  for (const record of successful) {
    const key = sourceGroupKey(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const db = databaseClient();
  const snapshot = await snapshotDatabase(db);
  const index = indexSnapshot(snapshot);
  const usedSlugs = new Set(snapshot.entities.flatMap((entity) => [entity.slug, entity.name_slug]).filter(Boolean).map((value) => value.toLowerCase()));
  const syncedAt = new Date().toISOString();
  const actions = [];
  for (const [key, records] of groups) {
    const name = chooseName(records);
    const websiteUrl = records.find((record) => record.websiteUrl)?.websiteUrl || null;
    const host = canonicalHost(websiteUrl);
    const locations = [];
    for (const record of records) if (record.location && !locations.some((item) => sameLocation(item, record.location))) locations.push(record.location);
    const contact = mergeContact(records.map((record) => record.contact));
    const description = records.map((record) => record.description).find(Boolean) || null;
    const primaryLocation = locations[0] ? [locations[0].city, locations[0].region, locations[0].country].filter(Boolean).join(', ') || locations[0].address1 : null;
    const resolution = resolveGroup(records, index);
    if (resolution.kind === 'conflict') {
      actions.push({ action: 'conflict', key, name, host, reason: resolution.reason, entityIds: resolution.entityIds, sourceProfiles: records.map((record) => record.sourceProfile) });
      continue;
    }
    if (resolution.kind === 'create') {
      const slug = allocateSlug(name, usedSlugs);
      actions.push({ action: 'create', key, name, slug, websiteUrl, host, matchReason: resolution.reason || 'no_existing_identity_match', allowExistingHost: resolution.reason === 'brand_roaster_missing_from_shared_cafe_host', description, shortDescription: description?.length <= 400 ? description : null, primaryLocation, contact, locations, locationPatches: [], provenance: sourceProvenance(records, syncedAt), sourceProfiles: records.map((record) => record.sourceProfile) });
      continue;
    }
    const entity = resolution.entity;
    const patch = {};
    if (!entity.website_url && websiteUrl) patch.website_url = websiteUrl;
    if (!entity.description_raw && description) patch.description_raw = description;
    if (!entity.short_description && description && description.length <= 400) patch.short_description = description;
    if (!entity.primary_location && primaryLocation) patch.primary_location = primaryLocation;
    if (!entity.contact && contact) patch.contact = contact;
    const existingLocations = index.locations.get(entity.id) || [];
    const newLocations = [];
    const locationPatches = [];
    for (const location of locations) {
      const current = existingLocations.find((item) => sameLocation(item, location));
      if (!current) { newLocations.push(location); continue; }
      const locationPatch = Object.fromEntries(
        ['label', 'address1', 'address2', 'city', 'region', 'postal_code', 'country', 'lat', 'lng']
          .filter((field) => (current[field] === null || current[field] === undefined || current[field] === '') && location[field] !== null && location[field] !== undefined && location[field] !== '')
          .map((field) => [field, location[field]])
      );
      if (Object.keys(locationPatch).length) locationPatches.push({ id: current.id, patch: locationPatch });
    }
    const role = index.roles.get(`${entity.id}:roaster`) || null;
    const incomingProvenance = sourceProvenance(records, syncedAt);
    const nextMetadata = mergeRoleMetadata(role?.role_metadata, incomingProvenance);
    actions.push({
      action: Object.keys(patch).length || newLocations.length || locationPatches.length || !role || stableStringify(nextMetadata) !== stableStringify(role.role_metadata || {}) ? 'enrich' : 'unchanged',
      key, entityId: entity.id, name, host, matchReason: resolution.reason, patch, locations: newLocations, locationPatches,
      provenance: incomingProvenance, sourceProfiles: records.map((record) => record.sourceProfile),
    });
  }
  const counts = actions.reduce((result, action) => ({ ...result, [action.action]: (result[action.action] || 0) + 1 }), {});
  const plan = {
    schemaVersion: SCHEMA_VERSION,
    source: 'Roast Local public roaster profiles',
    sitemapUrl: SITEMAP_URL,
    plannedAt: syncedAt,
    prohibitedPaths: ['/terms', '/terms/**'],
    crawlCounts: { sitemapProfiles: rows.length, successfulProfiles: successful.length, redirectFallbacks: successful.filter((record) => record.redirectFallback).length, errors: errors.length },
    snapshotCounts: { entities: snapshot.entities.length, roles: snapshot.roles.length, locations: snapshot.locations.length },
    counts,
    actions,
  };
  plan.planHash = planHash(plan);
  writePrivateJson(path.resolve(options.output), plan);
  console.log(`Plan written: ${path.resolve(options.output)}`);
  console.log(`Counts: ${JSON.stringify(counts)}`);
}

function verifyPlanFile(plan) {
  if (!plan || plan.schemaVersion !== SCHEMA_VERSION || !Array.isArray(plan.actions) || !/^[a-f0-9]{64}$/.test(plan.planHash || '')) throw new Error('Malformed plan');
  if (planHash(plan) !== plan.planHash) throw new Error('Plan hash mismatch');
  if (plan.actions.some((action) => (action.sourceProfiles || []).some(isTermsPath))) throw new Error('Plan contains a prohibited /terms source');
  if ((plan.counts.conflict || 0) > 0) throw new Error(`Plan has ${plan.counts.conflict} unresolved conflicts`);
  return true;
}

async function applyEntityPatch(db, entityId, patch) {
  const fields = Object.keys(patch || {});
  if (!fields.length) return;
  const { data, error } = await db.from('entities').select(`id,${fields.join(',')}`).eq('id', entityId).single();
  if (error) throw new Error(`Entity refresh failed: ${error.message}`);
  const safePatch = Object.fromEntries(fields.filter((field) => data[field] === null || data[field] === '').map((field) => [field, patch[field]]));
  if (!Object.keys(safePatch).length) return;
  const updated = await db.from('entities').update(safePatch).eq('id', entityId);
  if (updated.error) throw new Error(`Entity patch failed: ${updated.error.message}`);
}

async function ensureRole(db, entityId, provenance) {
  const current = await db.from('entity_roles').select('role_metadata').eq('entity_id', entityId).eq('role', 'roaster').maybeSingle();
  if (current.error) throw new Error(`Role lookup failed: ${current.error.message}`);
  const metadata = mergeRoleMetadata(current.data?.role_metadata, provenance);
  if (current.data && stableStringify(metadata) === stableStringify(current.data.role_metadata || {})) return;
  const result = current.data
    ? await db.from('entity_roles').update({ role_metadata: metadata }).eq('entity_id', entityId).eq('role', 'roaster')
    : await db.from('entity_roles').insert({ entity_id: entityId, role: 'roaster', role_metadata: metadata });
  if (result.error) throw new Error(`Role write failed: ${result.error.message}`);
}

async function ensureLocations(db, entityId, incoming) {
  if (!incoming?.length) return;
  const current = await db.from('entity_locations').select('address1,address2,city,region,postal_code,country,lat,lng,is_primary').eq('entity_id', entityId);
  if (current.error) throw new Error(`Location lookup failed: ${current.error.message}`);
  const rows = incoming.filter((location) => !current.data.some((existing) => sameLocation(existing, location)));
  for (const [index, location] of rows.entries()) {
    const result = await db.from('entity_locations').insert({ entity_id: entityId, ...location, is_primary: !current.data.some((item) => item.is_primary) && index === 0 });
    if (result.error) throw new Error(`Location insert failed: ${result.error.message}`);
  }
}

async function applyLocationPatches(db, patches) {
  for (const item of patches || []) {
    const fields = Object.keys(item.patch || {});
    if (!fields.length) continue;
    const current = await db.from('entity_locations').select(`id,${fields.join(',')}`).eq('id', item.id).single();
    if (current.error) throw new Error(`Location refresh failed: ${current.error.message}`);
    const safePatch = Object.fromEntries(fields.filter((field) => current.data[field] === null || current.data[field] === '').map((field) => [field, item.patch[field]]));
    if (!Object.keys(safePatch).length) continue;
    const result = await db.from('entity_locations').update(safePatch).eq('id', item.id);
    if (result.error) throw new Error(`Location enrichment failed: ${result.error.message}`);
  }
}

async function createEntity(db, action) {
  const existing = await db.from('entities').select('id,website_url').eq('slug', action.slug).maybeSingle();
  if (existing.error) throw new Error(`Slug lookup failed: ${existing.error.message}`);
  if (existing.data) {
    if (canonicalHost(existing.data.website_url) !== action.host) throw new Error(`Slug ${action.slug} is owned by another entity`);
    return existing.data.id;
  }
  const insert = compact({
    name: action.name,
    slug: action.slug,
    name_slug: action.slug,
    website_url: action.websiteUrl,
    description_raw: action.description,
    short_description: action.shortDescription,
    primary_location: action.primaryLocation,
    contact: action.contact,
  });
  const created = await db.from('entities').insert(insert).select('id').single();
  if (created.error) throw new Error(`Entity insert failed: ${created.error.message}`);
  return created.data.id;
}

async function applyPlanFile(options) {
  if (!options.plan) throw new Error(`apply requires --plan\n\n${usage()}`);
  const planPath = path.resolve(options.plan);
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  verifyPlanFile(plan);
  const checkpointPath = path.resolve(options.checkpoint || `${planPath}.checkpoint.json`);
  const checkpoint = fs.existsSync(checkpointPath) ? JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) : { schemaVersion: SCHEMA_VERSION, planHash: plan.planHash, entries: {} };
  if (checkpoint.planHash !== plan.planHash) throw new Error('Checkpoint belongs to a different plan');
  const db = databaseClient();
  if (!Object.keys(checkpoint.entries || {}).length) {
    const fresh = await snapshotDatabase(db);
    const freshCounts = { entities: fresh.entities.length, roles: fresh.roles.length, locations: fresh.locations.length };
    if (stableStringify(freshCounts) !== stableStringify(plan.snapshotCounts)) {
      throw new Error(`Database changed after planning; regenerate the plan. Expected ${JSON.stringify(plan.snapshotCounts)}, found ${JSON.stringify(freshCounts)}`);
    }
    const freshIndex = indexSnapshot(fresh);
    for (const action of plan.actions.filter((item) => item.action === 'create' && item.host && !item.allowExistingHost)) {
      if ((freshIndex.entitiesByHost.get(action.host) || []).length) throw new Error(`Create preflight found an existing entity on ${action.host}; regenerate the plan`);
    }
  }
  const actionable = plan.actions.filter((action) => ['create', 'enrich'].includes(action.action));
  for (let index = 0; index < actionable.length; index += 1) {
    const action = actionable[index];
    const entry = checkpoint.entries[action.key] || { status: 'pending', steps: {} };
    if (entry.status === 'complete') continue;
    try {
      const entityId = entry.entityId || (action.action === 'create' ? await createEntity(db, action) : action.entityId);
      entry.entityId = entityId; entry.steps.entity = true; checkpoint.entries[action.key] = entry; writePrivateJson(checkpointPath, checkpoint);
      if (!entry.steps.patch) { await applyEntityPatch(db, entityId, action.patch || {}); entry.steps.patch = true; writePrivateJson(checkpointPath, checkpoint); }
      if (!entry.steps.role) { await ensureRole(db, entityId, action.provenance); entry.steps.role = true; writePrivateJson(checkpointPath, checkpoint); }
      if (!entry.steps.locationPatches) { await applyLocationPatches(db, action.locationPatches); entry.steps.locationPatches = true; writePrivateJson(checkpointPath, checkpoint); }
      if (!entry.steps.locations) { await ensureLocations(db, entityId, action.locations); entry.steps.locations = true; writePrivateJson(checkpointPath, checkpoint); }
      entry.status = 'complete'; entry.error = null; checkpoint.entries[action.key] = entry;
      checkpoint.completed = Object.values(checkpoint.entries).filter((item) => item.status === 'complete').length;
      writePrivateJson(checkpointPath, checkpoint);
      if (checkpoint.completed % 25 === 0 || checkpoint.completed === actionable.length) console.log(`[${checkpoint.completed}/${actionable.length}] ${action.action} ${action.name}`);
    } catch (error) {
      entry.status = 'failed'; entry.error = cleanString(error.message, 1000); checkpoint.entries[action.key] = entry; writePrivateJson(checkpointPath, checkpoint);
      throw new Error(`Apply stopped at ${action.name}: ${error.message}`);
    }
  }
  console.log(`Apply complete: ${checkpoint.completed}/${actionable.length}; checkpoint ${checkpointPath}`);
}

async function verifyApplied(options) {
  if (!options.plan) throw new Error(`verify requires --plan\n\n${usage()}`);
  const plan = JSON.parse(fs.readFileSync(path.resolve(options.plan), 'utf8'));
  verifyPlanFile(plan);
  const db = databaseClient();
  const snapshot = await snapshotDatabase(db);
  const index = indexSnapshot(snapshot);
  const entitiesById = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  const entitiesBySlug = new Map(snapshot.entities.map((entity) => [entity.slug, entity]));
  const locationsById = new Map(snapshot.locations.map((location) => [location.id, location]));
  const failures = [];
  let verified = 0;
  for (const action of plan.actions.filter((item) => ['create', 'enrich', 'unchanged'].includes(item.action))) {
    const entity = action.entityId ? entitiesById.get(action.entityId) : entitiesBySlug.get(action.slug);
    if (!entity) { failures.push({ name: action.name, reason: 'entity missing' }); continue; }
    const role = index.roles.get(`${entity.id}:roaster`);
    if (!role) { failures.push({ name: action.name, reason: 'roaster role missing' }); continue; }
    const profiles = role.role_metadata?.provenance?.public_directories?.roast_local?.profiles || {};
    const recordedUrls = new Set(Object.values(profiles).map((profile) => profile.source_profile));
    const missing = action.sourceProfiles.filter((url) => !recordedUrls.has(url));
    if (missing.length) { failures.push({ name: action.name, reason: `${missing.length} profile provenance entries missing` }); continue; }
    const expectedFields = action.action === 'create'
      ? compact({ website_url: action.websiteUrl, description_raw: action.description, short_description: action.shortDescription, primary_location: action.primaryLocation, contact: action.contact })
      : action.patch || {};
    const absentFields = Object.keys(expectedFields).filter((field) => entity[field] === null || entity[field] === undefined || entity[field] === '');
    if (absentFields.length) { failures.push({ name: action.name, reason: `enrichment fields missing: ${absentFields.join(', ')}` }); continue; }
    const actualLocations = index.locations.get(entity.id) || [];
    const missingLocations = (action.locations || []).filter((location) => !actualLocations.some((actual) => sameLocation(actual, location)));
    if (missingLocations.length) { failures.push({ name: action.name, reason: `${missingLocations.length} expected locations missing` }); continue; }
    const incompleteLocationPatches = (action.locationPatches || []).filter((item) => {
      const actual = locationsById.get(item.id);
      return !actual || Object.keys(item.patch || {}).some((field) => actual[field] === null || actual[field] === undefined || actual[field] === '');
    });
    if (incompleteLocationPatches.length) { failures.push({ name: action.name, reason: `${incompleteLocationPatches.length} location enrichments missing` }); continue; }
    verified += 1;
  }
  const { count: roasterCount, error } = await db.from('entity_roles').select('*', { count: 'exact', head: true }).eq('role', 'roaster');
  if (error) throw new Error(error.message);
  const result = { verifiedActions: verified, failures: failures.length, roasterCount, checkedAt: new Date().toISOString(), termsRequests: 0 };
  console.log(JSON.stringify(result));
  if (failures.length) { console.log(JSON.stringify(failures.slice(0, 50), null, 2)); process.exitCode = 1; }
}

function selfTest() {
  const blocked = [
    'https://www.roastlocal.com/terms',
    'https://www.roastlocal.com/terms/',
    'https://www.roastlocal.com/terms/privacy',
    'https://www.roastlocal.com/%74erms',
    'https://www.roastlocal.com/%2574erms',
    'https://www.roastlocal.com//TERMS',
  ];
  const allowed = [SITEMAP_URL, ROBOTS_URL, 'https://www.roastlocal.com/oregon/portland/heart-coffee-roasters'];
  for (const url of blocked) {
    if (!isTermsPath(url)) throw new Error(`Self-test failed to identify prohibited URL: ${url}`);
    let rejected = false; try { assertAllowedRequest(url, 'self-test'); } catch { rejected = true; }
    if (!rejected) throw new Error(`Self-test failed to reject prohibited URL: ${url}`);
  }
  for (const url of allowed) assertAllowedRequest(url, 'self-test');
  if (!profilePath(allowed[2]) || profilePath(SITEMAP_URL)) throw new Error('Profile path self-test failed');
  const sample = '<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"CafeOrCoffeeShop","@id":"https://www.roastlocal.com/oregon/portland/test#business","name":"Test Coffee","address":{"@type":"PostalAddress","streetAddress":"1 Main St","addressLocality":"Portland","addressRegion":"Oregon","addressCountry":"US"},"geo":{"latitude":45.5,"longitude":-122.6},"sameAs":["https://testcoffee.example"]}</script></head><body><h2>Roast styles: Light Medium</h2><p>This roaster has not claimed their profile yet.</p><a href="/terms">Terms</a></body></html>';
  const parsed = parseProfile(sample, 'https://www.roastlocal.com/oregon/portland/test', 'https://www.roastlocal.com/oregon/portland/test');
  if (parsed.name !== 'Test Coffee' || canonicalHost(parsed.officialWebsite) !== 'testcoffee.example' || parsed.location.city !== 'Portland') throw new Error('Profile parser self-test failed');
  const fallback = redirectFallback({ status: 200, requestedUrl: 'https://www.roastlocal.com/idaho/coeur-dalene/created-coffee-roasters', finalUrl: 'https://www.roastlocal.com/idaho/coeur-dalene', parsed: null });
  if (fallback?.name !== 'Created Coffee Roasters' || fallback.location.city !== "Coeur d'Alene") throw new Error('Redirect fallback self-test failed');
  console.log('Self-test passed: /terms guard, profile queue guard, redirect guard, and structured profile parser');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'self-test') return selfTest();
  if (options.command === 'crawl') return crawl(options);
  if (options.command === 'plan') return buildPlan(options);
  if (options.command === 'apply') return applyPlanFile(options);
  if (options.command === 'verify') return verifyApplied(options);
  throw new Error(usage());
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = { assertAllowedRequest, isTermsPath, parseProfile, profilePath };
