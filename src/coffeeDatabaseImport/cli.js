#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');

const SITEMAP_URLS = [
  'https://coffee-database.com/kaffeeroester-sitemap.xml',
  'https://coffee-database.com/kaffeeroester-sitemap2.xml',
];
const ROBOTS_URL = 'https://coffee-database.com/robots.txt';
const ALLOWED_HOSTS = new Set(['coffee-database.com', 'www.coffee-database.com']);
const USER_AGENT = 'EveryCoffeeDataEnrichment/1.0';
const SCHEMA_VERSION = 1;
const SOURCE_KEY = 'coffee_database';
const SOURCE_LABEL = 'Coffee Database public roaster profiles';

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

All network requests are constrained to the two Coffee Database sitemaps,
robots.txt, and canonical /kaffeeroester/{slug}/ profile URLs. /terms and descendants are blocked before
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
  return parts.length === 2 && parts[0].toLowerCase() === 'kaffeeroester' && Boolean(parts[1]);
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
      if (/^(?:utm_|fbclid|gclid|source$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch { return null; }
}

const SOCIAL_HOSTS = new Set([
  'facebook.com', 'instagram.com', 'linkedin.com', 'tiktok.com', 'twitter.com', 'x.com',
  'youtube.com', 'youtu.be', 'threads.net', 'pinterest.com', 'linktr.ee',
]);
const NON_OFFICIAL_HOSTS = new Set(['speisekartenweb.de']);

function isSocialHost(host) {
  return [...SOCIAL_HOSTS].some((value) => host === value || host.endsWith(`.${value}`));
}

function usableOfficialWebsite(value) {
  const host = canonicalHost(value);
  return value && host && !NON_OFFICIAL_HOSTS.has(host) ? value : null;
}

function parseProfile(html, requestedUrl, finalUrl) {
  const $ = cheerio.load(html);
  if (!$('body').hasClass('single-kaffeeroester')) return null;
  const name = cleanString($('h1').first().text(), 160);
  if (!name) return null;

  const websiteAnchor = $('a').filter((_index, element) => /zur\s+website/i.test($(element).text())).first();
  const externalCandidate = safeExternalUrl(websiteAnchor.attr('href'), finalUrl);
  const officialWebsite = externalCandidate && !isSocialHost(canonicalHost(externalCandidate)) ? externalCandidate : null;

  const addressBlock = $('div').filter((_index, element) => /^\s*Adresse\s*:/i.test($(element).clone().children().remove().end().text())).first();
  const addressParts = addressBlock.find('span').map((_index, element) => cleanString($(element).text(), 500)).get();
  const location = compact({
    label: 'roastery',
    address1: addressParts[0] || null,
    postal_code: addressParts[1] || null,
    city: addressParts[2] || null,
  });
  const latitudeMatch = /\blat\s*:\s*parseFloat\(\s*['"](-?\d+(?:\.\d+)?)['"]\s*\)/i.exec(html);
  const longitudeMatch = /\blng\s*:\s*parseFloat\(\s*['"](-?\d+(?:\.\d+)?)['"]\s*\)/i.exec(html);
  const latitude = latitudeMatch ? Number(latitudeMatch[1]) : null;
  const longitude = longitudeMatch ? Number(longitudeMatch[1]) : null;
  if (Number.isFinite(latitude) && latitude >= -90 && latitude <= 90) location.lat = latitude;
  if (Number.isFinite(longitude) && longitude >= -180 && longitude <= 180) location.lng = longitude;
  const observedCoordinates = location.lat !== undefined && location.lng !== undefined ? { lat: location.lat, lng: location.lng } : null;

  const phoneBlock = $('div').filter((_index, element) => /^\s*Telefon\s*:/i.test($(element).clone().children().remove().end().text())).first();
  const phone = cleanString(phoneBlock.find('span').first().text(), 100);
  const hoursBlock = $('b').filter((_index, element) => /Öffnungszeiten\s*:/i.test($(element).text())).first().parent('div');
  const openingHours = cleanString(hoursBlock.find('span').last().text(), 2000);
  const specialtiesLabel = $('b').filter((_index, element) => /Besonderheiten\s*:/i.test($(element).text())).first().parent('div');
  const specialties = cleanString(specialtiesLabel.next('div').text(), 2000);
  const mapsAnchor = $('a[href*="google.com/maps/place"]').first().attr('href');
  let googlePlaceId = null;
  if (mapsAnchor) {
    try {
      const query = new URL(mapsAnchor, finalUrl).searchParams.get('q') || '';
      googlePlaceId = cleanString(query.replace(/^place_id:/i, ''), 250);
    } catch { /* malformed map links are ignored */ }
  }
  return {
    sourceProfile: requestedUrl,
    finalUrl,
    name,
    officialWebsite,
    contact: phone ? { phone } : null,
    location: location.address1 || location.city || location.postal_code ? location : null,
    observedCoordinates,
    openingHours,
    specialties,
    googlePlaceId,
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
  const sitemapResponses = [];
  for (const sitemapUrl of SITEMAP_URLS) {
    const response = await safeFetchText(sitemapUrl, { limiter, kind: 'sitemap', accept: 'application/xml,text/xml;q=0.9,*/*;q=0.1', maximumBytes: 5 * 1024 * 1024 });
    if (response.status < 200 || response.status >= 300) throw new Error(`${sitemapUrl} returned ${response.status}`);
    sitemapResponses.push({ url: sitemapUrl, response });
  }
  const allUrls = [...new Set(sitemapResponses.flatMap(({ response }) => xmlLocations(response.text)))];
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
    sources: SITEMAP_URLS,
    robots: { url: ROBOTS_URL, status: robotsResponse.status, fetchedAt: startedAt },
    startedAt,
    sitemaps: sitemapResponses.map(({ url, response }) => ({ url, status: response.status, fetchedAt: startedAt, profileUrls: xmlLocations(response.text).length })),
    sitemap: { allUniqueUrls: allUrls.length, profileUrls: profiles.length },
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
  const entities = await fetchAll(db, 'entities', 'id,name,slug,name_slug,website_url,description_raw,short_description,primary_location,contact,google_place_id');
  const roles = await fetchAll(db, 'entity_roles', 'entity_id,role,role_metadata', ['entity_id', 'role']);
  const locations = await fetchAll(db, 'entity_locations', 'id,entity_id,label,address1,address2,city,region,postal_code,country,lat,lng,is_primary');
  const attributes = await fetchAll(db, 'entity_attributes', 'id,entity_id,attribute_key,attribute_value,source');
  const sourceIds = await fetchAll(db, 'entity_source_ids', 'id,entity_id,source,source_id,source_url,last_synced_at');
  return { entities, roles, locations, attributes, sourceIds };
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
  return null;
}

function sourceProfileId(value) {
  const parts = new URL(value).pathname.split('/').filter(Boolean);
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'kaffeeroester') throw new Error(`Invalid source profile: ${value}`);
  return parts[1].toLowerCase();
}

function sourceRecord(row) {
  const parsed = row.parsed;
  return {
    sourceId: sourceProfileId(row.requestedUrl),
    sourceProfile: row.requestedUrl,
    finalUrl: row.finalUrl,
    fetchedAt: row.fetchedAt,
    etag: row.etag,
    name: parsed.name,
    listedWebsite: parsed.officialWebsite,
    websiteUrl: usableOfficialWebsite(parsed.officialWebsite),
    host: canonicalHost(usableOfficialWebsite(parsed.officialWebsite)),
    location: parsed.location ? compact(parsed.location) : null,
    contact: parsed.contact,
    description: usableDescription(parsed.description, parsed.name),
    openingHours: parsed.openingHours,
    specialties: parsed.specialties,
    googlePlaceId: parsed.googlePlaceId,
    observedCoordinates: parsed.observedCoordinates,
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
      listed_website: record.listedWebsite,
      official_website: record.websiteUrl,
      location: record.location,
      contact: record.contact,
      opening_hours: record.openingHours,
      specialties: record.specialties,
      google_place_id: record.googlePlaceId,
      observed_coordinates: record.observedCoordinates,
    });
  }
  return { schema_version: SCHEMA_VERSION, sitemap_urls: SITEMAP_URLS, last_synced_at: syncedAt, profiles };
}

function mergeRoleMetadata(current, incoming) {
  const metadata = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const provenance = metadata.provenance && typeof metadata.provenance === 'object' ? metadata.provenance : {};
  const publicDirectories = provenance.public_directories && typeof provenance.public_directories === 'object' ? provenance.public_directories : {};
  const existing = publicDirectories[SOURCE_KEY] && typeof publicDirectories[SOURCE_KEY] === 'object' ? publicDirectories[SOURCE_KEY] : {};
  return {
    ...metadata,
    provenance: {
      ...provenance,
      public_directories: {
        ...publicDirectories,
        [SOURCE_KEY]: {
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
  const entitiesByGooglePlace = new Map();
  const entitiesById = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  const roles = new Map(snapshot.roles.map((role) => [`${role.entity_id}:${role.role}`, role]));
  const locations = new Map();
  const attributes = new Map(snapshot.attributes.map((attribute) => [`${attribute.entity_id}:${attribute.attribute_key}`, attribute]));
  const sourceIds = new Map(snapshot.sourceIds.map((sourceId) => [`${sourceId.source}:${sourceId.source_id}`, sourceId]));
  for (const entity of snapshot.entities) {
    const host = canonicalHost(entity.website_url);
    if (host) { if (!entitiesByHost.has(host)) entitiesByHost.set(host, []); entitiesByHost.get(host).push(entity); }
    const name = normalizeName(entity.name);
    if (name) { if (!entitiesByName.has(name)) entitiesByName.set(name, []); entitiesByName.get(name).push(entity); }
    if (entity.google_place_id) { if (!entitiesByGooglePlace.has(entity.google_place_id)) entitiesByGooglePlace.set(entity.google_place_id, []); entitiesByGooglePlace.get(entity.google_place_id).push(entity); }
  }
  for (const location of snapshot.locations) {
    if (!locations.has(location.entity_id)) locations.set(location.entity_id, []);
    locations.get(location.entity_id).push(location);
  }
  return { entitiesByHost, entitiesByName, entitiesByGooglePlace, entitiesById, roles, locations, attributes, sourceIds };
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

function distinctiveExactName(value) {
  const name = normalizeName(value);
  if (!name || name.length < 7) return false;
  return !new Set(['kaffeerosterei', 'kaffeerösterei', 'kaffee rosterei', 'kaffee rösterei', 'coffee roaster', 'coffee roasters', 'roastery', 'rosterei', 'rösterei']).has(name);
}

function knownHostAlias(name, sourceHost, existingHost) {
  const aliases = {
    'slow coffee roasters': new Set(['slowcoffeeroasters.de', 'slowcoffeeroasters.com']),
    'the visit coffee roastery': new Set(['visit-coffee.com', 'thevisit.coffee']),
  };
  const allowed = aliases[normalizeName(name)];
  return Boolean(allowed && allowed.has(sourceHost) && allowed.has(existingHost));
}

function resolveGroup(records, snapshotIndex) {
  const name = chooseName(records);
  const sourceMatches = [...new Set(records.map((record) => snapshotIndex.sourceIds.get(`${SOURCE_KEY}:${record.sourceId}`)?.entity_id).filter(Boolean))];
  if (sourceMatches.length === 1) {
    const entity = snapshotIndex.entitiesById.get(sourceMatches[0]);
    if (!entity) return { kind: 'conflict', reason: 'source_id_points_to_missing_entity', entityIds: sourceMatches };
    return { kind: 'match', entity, reason: 'source_id' };
  }
  if (sourceMatches.length > 1) return { kind: 'conflict', reason: 'source_ids_point_to_multiple_entities', entityIds: sourceMatches };
  const placeMatches = [...new Set(records.flatMap((record) => (snapshotIndex.entitiesByGooglePlace.get(record.googlePlaceId) || []).map((entity) => entity.id)))];
  if (placeMatches.length === 1) return { kind: 'match', entity: snapshotIndex.entitiesById.get(placeMatches[0]), reason: 'google_place_id' };
  if (placeMatches.length > 1) return { kind: 'conflict', reason: 'google_place_ids_point_to_multiple_entities', entityIds: placeMatches };
  const host = records.find((record) => record.host)?.host || null;
  const exactHost = host ? snapshotIndex.entitiesByHost.get(host) || [] : [];
  if (exactHost.length === 1) {
    const entity = exactHost[0];
    const incomingLocations = records.map((record) => record.location).filter(Boolean);
    if (snapshotIndex.roles.has(`${entity.id}:roaster`)) return { kind: 'match', entity, reason: 'exact_host' };
    if (normalizeName(entity.name) === normalizeName(name)) return { kind: 'match', entity, reason: 'exact_host_and_name' };
    if (locationContextMatches(entity, incomingLocations, snapshotIndex)) return { kind: 'match', entity, reason: 'exact_host_and_location' };
    return { kind: 'create', reason: 'brand_roaster_missing_from_shared_cafe_host' };
  }
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
  if (sameName.length === 1) {
    const entity = sameName[0];
    const existingHost = canonicalHost(entity.website_url);
    if (!existingHost && distinctiveExactName(name)) return { kind: 'match', entity, reason: 'distinctive_name_and_missing_website' };
    if (host && existingHost && knownHostAlias(name, host, existingHost)) return { kind: 'match', entity, reason: 'verified_host_alias_and_name' };
    return { kind: 'create', reason: 'exact_name_but_distinct_or_unverified_identity' };
  }
  if (!host && roasterNames.length === 1) return { kind: 'match', entity: roasterNames[0], reason: 'name_only_no_source_website' };
  if (sameName.length) return { kind: 'create', reason: 'same_name_but_distinct_location_or_identity' };
  return { kind: 'create' };
}

function sourceIdWrites(records, syncedAt) {
  return records.map((record) => ({
    source: SOURCE_KEY,
    sourceId: record.sourceId,
    sourceUrl: record.sourceProfile,
    syncedAt,
    rawData: compact({
      observed_name: record.name,
      listed_website: record.listedWebsite,
      official_website: record.websiteUrl,
      location: record.location,
      contact: record.contact,
      opening_hours: record.openingHours,
      specialties: record.specialties,
      google_place_id: record.googlePlaceId,
      observed_coordinates: record.observedCoordinates,
      fetched_at: record.fetchedAt,
      final_url: record.finalUrl,
    }),
  }));
}

function attributeCandidates(records) {
  const openingHours = records.map((record) => record.openingHours).find(Boolean) || null;
  const specialties = records.map((record) => record.specialties).find(Boolean) || null;
  return [
    openingHours ? { attributeKey: 'opening_hours', attributeValue: openingHours, source: SOURCE_KEY } : null,
    specialties ? { attributeKey: 'coffee_database_specialties', attributeValue: specialties, source: SOURCE_KEY } : null,
  ].filter(Boolean);
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
    const googlePlaceId = records.map((record) => record.googlePlaceId).find(Boolean) || null;
    const sourceIds = sourceIdWrites(records, syncedAt);
    const candidateAttributes = attributeCandidates(records);
    const primaryLocation = locations[0] ? [locations[0].city, locations[0].region, locations[0].country].filter(Boolean).join(', ') || locations[0].address1 : null;
    const resolution = resolveGroup(records, index);
    if (resolution.kind === 'conflict') {
      actions.push({ action: 'conflict', key, name, host, reason: resolution.reason, entityIds: resolution.entityIds, sourceProfiles: records.map((record) => record.sourceProfile) });
      continue;
    }
    if (resolution.kind === 'create') {
      const slug = allocateSlug(name, usedSlugs);
      actions.push({ action: 'create', key, name, slug, websiteUrl, host, matchReason: resolution.reason || 'no_existing_identity_match', allowExistingHost: resolution.reason === 'brand_roaster_missing_from_shared_cafe_host', description, shortDescription: description?.length <= 400 ? description : null, primaryLocation, contact, googlePlaceId, locations, locationPatches: [], attributes: candidateAttributes, sourceIds, provenance: sourceProvenance(records, syncedAt), sourceProfiles: records.map((record) => record.sourceProfile) });
      continue;
    }
    const entity = resolution.entity;
    const patch = {};
    if (!entity.website_url && websiteUrl) patch.website_url = websiteUrl;
    if (!entity.description_raw && description) patch.description_raw = description;
    if (!entity.short_description && description && description.length <= 400) patch.short_description = description;
    if (!entity.primary_location && primaryLocation) patch.primary_location = primaryLocation;
    const mergedContact = mergeContact([entity.contact, contact]);
    if (mergedContact && stableStringify(mergedContact) !== stableStringify(entity.contact || {})) patch.contact = mergedContact;
    if (!entity.google_place_id && googlePlaceId) patch.google_place_id = googlePlaceId;
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
    const attributes = candidateAttributes.filter((attribute) => {
      const current = index.attributes.get(`${entity.id}:${attribute.attributeKey}`);
      return !current || current.attribute_value === null || current.attribute_value === '';
    });
    const incomingProvenance = sourceProvenance(records, syncedAt);
    const nextMetadata = mergeRoleMetadata(role?.role_metadata, incomingProvenance);
    actions.push({
      action: Object.keys(patch).length || newLocations.length || locationPatches.length || !role || stableStringify(nextMetadata) !== stableStringify(role.role_metadata || {}) ? 'enrich' : 'unchanged',
      key, entityId: entity.id, name, host, matchReason: resolution.reason, patch, locations: newLocations, locationPatches, attributes, sourceIds,
      provenance: incomingProvenance, sourceProfiles: records.map((record) => record.sourceProfile),
    });
  }
  const counts = actions.reduce((result, action) => ({ ...result, [action.action]: (result[action.action] || 0) + 1 }), {});
  const plan = {
    schemaVersion: SCHEMA_VERSION,
    source: SOURCE_LABEL,
    sitemapUrls: SITEMAP_URLS,
    plannedAt: syncedAt,
    prohibitedPaths: ['/terms', '/terms/**'],
    crawlCounts: { sitemapProfiles: rows.length, successfulProfiles: successful.length, errors: errors.length },
    snapshotCounts: { entities: snapshot.entities.length, roles: snapshot.roles.length, locations: snapshot.locations.length, attributes: snapshot.attributes.length, sourceIds: snapshot.sourceIds.length },
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
  const safePatch = {};
  for (const field of fields) {
    if (data[field] === null || data[field] === '') safePatch[field] = patch[field];
    else if (field === 'contact' && patch[field] && typeof patch[field] === 'object') {
      const merged = mergeContact([data[field], patch[field]]);
      if (merged && stableStringify(merged) !== stableStringify(data[field])) safePatch[field] = merged;
    }
  }
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

async function ensureAttributes(db, entityId, attributes) {
  for (const attribute of attributes || []) {
    const current = await db.from('entity_attributes').select('id,attribute_value').eq('entity_id', entityId).eq('attribute_key', attribute.attributeKey).maybeSingle();
    if (current.error) throw new Error(`Attribute lookup failed: ${current.error.message}`);
    if (!current.data) {
      const inserted = await db.from('entity_attributes').insert({ entity_id: entityId, attribute_key: attribute.attributeKey, attribute_value: attribute.attributeValue, source: attribute.source });
      if (inserted.error) throw new Error(`Attribute insert failed: ${inserted.error.message}`);
    } else if (current.data.attribute_value === null || current.data.attribute_value === '') {
      const updated = await db.from('entity_attributes').update({ attribute_value: attribute.attributeValue, source: attribute.source }).eq('id', current.data.id);
      if (updated.error) throw new Error(`Attribute enrichment failed: ${updated.error.message}`);
    }
  }
}

async function ensureSourceIds(db, entityId, sourceIds) {
  for (const item of sourceIds || []) {
    const current = await db.from('entity_source_ids').select('id,entity_id').eq('source', item.source).eq('source_id', item.sourceId).maybeSingle();
    if (current.error) throw new Error(`Source ID lookup failed: ${current.error.message}`);
    if (current.data && current.data.entity_id !== entityId) throw new Error(`Source ID ${item.source}:${item.sourceId} belongs to another entity`);
    const values = { source_url: item.sourceUrl, confidence: 1, raw_data: item.rawData, last_synced_at: item.syncedAt };
    const result = current.data
      ? await db.from('entity_source_ids').update(values).eq('id', current.data.id)
      : await db.from('entity_source_ids').insert({ entity_id: entityId, source: item.source, source_id: item.sourceId, ...values });
    if (result.error) throw new Error(`Source ID write failed: ${result.error.message}`);
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
    google_place_id: action.googlePlaceId,
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
    const freshCounts = { entities: fresh.entities.length, roles: fresh.roles.length, locations: fresh.locations.length, attributes: fresh.attributes.length, sourceIds: fresh.sourceIds.length };
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
      if (!entry.steps.attributes) { await ensureAttributes(db, entityId, action.attributes); entry.steps.attributes = true; writePrivateJson(checkpointPath, checkpoint); }
      if (!entry.steps.sourceIds) { await ensureSourceIds(db, entityId, action.sourceIds); entry.steps.sourceIds = true; writePrivateJson(checkpointPath, checkpoint); }
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
  const sourceIds = new Map(snapshot.sourceIds.map((sourceId) => [`${sourceId.source}:${sourceId.source_id}`, sourceId]));
  const attributes = new Map(snapshot.attributes.map((attribute) => [`${attribute.entity_id}:${attribute.attribute_key}`, attribute]));
  const failures = [];
  let verified = 0;
  for (const action of plan.actions.filter((item) => ['create', 'enrich', 'unchanged'].includes(item.action))) {
    const entity = action.entityId ? entitiesById.get(action.entityId) : entitiesBySlug.get(action.slug);
    if (!entity) { failures.push({ name: action.name, reason: 'entity missing' }); continue; }
    const role = index.roles.get(`${entity.id}:roaster`);
    if (!role) { failures.push({ name: action.name, reason: 'roaster role missing' }); continue; }
    const profiles = role.role_metadata?.provenance?.public_directories?.[SOURCE_KEY]?.profiles || {};
    const recordedUrls = new Set(Object.values(profiles).map((profile) => profile.source_profile));
    const missing = action.sourceProfiles.filter((url) => !recordedUrls.has(url));
    if (missing.length) { failures.push({ name: action.name, reason: `${missing.length} profile provenance entries missing` }); continue; }
    const expectedFields = action.action === 'create'
      ? compact({ website_url: action.websiteUrl, description_raw: action.description, short_description: action.shortDescription, primary_location: action.primaryLocation, contact: action.contact, google_place_id: action.googlePlaceId })
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
    const missingAttributes = (action.attributes || []).filter((attribute) => {
      const actual = attributes.get(`${entity.id}:${attribute.attributeKey}`);
      return !actual || actual.attribute_value === null || actual.attribute_value === '';
    });
    if (missingAttributes.length) { failures.push({ name: action.name, reason: `${missingAttributes.length} attributes missing` }); continue; }
    const missingSourceIds = (action.sourceIds || []).filter((item) => sourceIds.get(`${item.source}:${item.sourceId}`)?.entity_id !== entity.id);
    if (missingSourceIds.length) { failures.push({ name: action.name, reason: `${missingSourceIds.length} source IDs missing` }); continue; }
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
    'https://coffee-database.com/terms',
    'https://coffee-database.com/terms/',
    'https://coffee-database.com/terms/privacy',
    'https://coffee-database.com/%74erms',
    'https://coffee-database.com/%2574erms',
    'https://coffee-database.com//TERMS',
  ];
  const allowed = [...SITEMAP_URLS, ROBOTS_URL, 'https://coffee-database.com/kaffeeroester/test-kaffee/'];
  for (const url of blocked) {
    if (!isTermsPath(url)) throw new Error(`Self-test failed to identify prohibited URL: ${url}`);
    let rejected = false; try { assertAllowedRequest(url, 'self-test'); } catch { rejected = true; }
    if (!rejected) throw new Error(`Self-test failed to reject prohibited URL: ${url}`);
  }
  for (const url of allowed) assertAllowedRequest(url, 'self-test');
  if (!profilePath(allowed[3]) || profilePath(SITEMAP_URLS[0])) throw new Error('Profile path self-test failed');
  const sample = '<html><body class="single-kaffeeroester"><h1>Test Kaffee</h1><div>Adresse: <span>1 Hauptstrasse</span>, <span>10115</span>, <span>Berlin</span></div><div>Telefon: <span>030 1234</span></div><div><b>Öffnungszeiten:</b> <span>Mo-Fr 08:00-17:00</span></div><div><b>Besonderheiten:</b></div><div>Bio</div><a href="https://testcoffee.example/?source=coffee-database.com">zur Website</a><a href="https://www.google.com/maps/place/?q=place_id:abc123">Google Maps</a><script>var p={lat: parseFloat(\'52.5\'), lng: parseFloat(\'13.4\')}</script></body></html>';
  const parsed = parseProfile(sample, allowed[3], allowed[3]);
  if (parsed.name !== 'Test Kaffee' || canonicalHost(parsed.officialWebsite) !== 'testcoffee.example' || parsed.location.city !== 'Berlin' || parsed.googlePlaceId !== 'abc123' || parsed.openingHours !== 'Mo-Fr 08:00-17:00') throw new Error('Profile parser self-test failed');
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
