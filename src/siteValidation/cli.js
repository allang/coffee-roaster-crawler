#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { canonicalHost, parseExport } = require('../directoryImport/core');
const { RateLimiter, candidateKey, validateCandidate } = require('./core');

function usage() {
  return `Usage:
  node src/siteValidation/cli.js --input overture-import-ready.ndjson [options]

Options:
  --output FILE                Append-only checkpoint/results NDJSON
  --concurrency N              Concurrent candidates (default 2, maximum 4)
  --delay-ms N                 Minimum global delay between HTTP starts (default 1000, minimum 500)
  --per-host-delay-ms N        Minimum delay per hostname (default 5000, minimum 1000)
  --timeout-ms N               Per-request timeout (default 12000, maximum 30000)
  --max-bytes N                Maximum HTML bytes per page (default 524288, maximum 1048576)
  --max-redirects N            Maximum redirects (default 5, maximum 10)
  --limit N                    Validate at most N selected candidates
  --shard-count N              Deterministically split work into N shards
  --shard-index N              Zero-based shard index (requires --shard-count)
  --retry-errors               Retry prior unreachable/http/robots-unavailable results
  --user-agent STRING          Honest identifying User-Agent

The validator reads only candidate official sites and their robots.txt files. It never
connects to Supabase. Roast Local and private-network destinations are hard-blocked.`;
}

function parseArgs(argv) {
  const options = { retryErrors: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') options.help = true;
    else if (token === '--retry-errors') options.retryErrors = true;
    else if (token.startsWith('--')) {
      const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${token} requires a value`);
      options[key] = value;
      index += 1;
    } else throw new Error(`Unexpected argument: ${token}`);
  }
  return options;
}

function integerOption(value, name, fallback, min, max) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return number;
}

function readCheckpoint(file) {
  const completed = new Map();
  if (!fs.existsSync(file)) return completed;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const item = JSON.parse(line);
      if (item?.validation?.key) completed.set(item.validation.key, item);
    } catch (error) {
      const isLastNonEmpty = !lines.slice(index + 1).some((entry) => entry.trim());
      if (!isLastNonEmpty) throw new Error(`Invalid checkpoint NDJSON on line ${index + 1}: ${error.message}`);
      console.warn(`Ignoring incomplete final checkpoint line ${index + 1}`);
    }
  }
  return completed;
}

function shouldRetry(item) {
  return ['unreachable', 'http_error', 'robots_unavailable'].includes(item?.validation?.classification);
}

function candidateWebsite(record) {
  return record?.official_website || record?.officialWebsite || record?.website_url || record?.websiteUrl || record?.website || null;
}

function sharedHostGroups(records) {
  const groups = new Map();
  records.forEach((record, inputIndex) => {
    const host = canonicalHost(candidateWebsite(record));
    if (!host) return;
    if (!groups.has(host)) groups.set(host, []);
    groups.get(host).push(inputIndex);
  });
  return new Map([...groups].filter(([, indexes]) => indexes.length > 1));
}

async function mapLimit(items, concurrency, worker) {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(usage()); return; }
  if (!options.input) throw new Error(`--input is required\n\n${usage()}`);

  const input = path.resolve(options.input);
  const output = path.resolve(options.output || `${input}.validation.ndjson`);
  if (input === output) throw new Error('--output must differ from --input');
  const concurrency = integerOption(options.concurrency, '--concurrency', 2, 1, 4);
  const delayMs = integerOption(options.delayMs, '--delay-ms', 1000, 500, 60000);
  const perHostDelayMs = integerOption(options.perHostDelayMs, '--per-host-delay-ms', 5000, 1000, 300000);
  const timeoutMs = integerOption(options.timeoutMs, '--timeout-ms', 12000, 3000, 30000);
  const maxBytes = integerOption(options.maxBytes, '--max-bytes', 524288, 16384, 1048576);
  const maxRedirects = integerOption(options.maxRedirects, '--max-redirects', 5, 0, 10);
  const shardCount = integerOption(options.shardCount, '--shard-count', 1, 1, 1000);
  const shardIndex = integerOption(options.shardIndex, '--shard-index', 0, 0, shardCount - 1);
  const limit = options.limit === undefined ? Infinity : integerOption(options.limit, '--limit', null, 1, 10000000);
  if (shardCount > 1 && options.shardIndex === undefined) throw new Error('--shard-index is required when --shard-count is greater than 1');

  const format = /\.(?:ndjson|jsonl)$/i.test(input) ? 'ndjson' : /\.csv$/i.test(input) ? 'csv' : 'json';
  const records = parseExport(fs.readFileSync(input, 'utf8'), format);
  const duplicateHosts = sharedHostGroups(records);
  const checkpoint = readCheckpoint(output);
  const selected = records.map((record, inputIndex) => ({ record, inputIndex, key: candidateKey(record, inputIndex) }))
    .filter(({ inputIndex }) => inputIndex % shardCount === shardIndex)
    .filter(({ key }) => !checkpoint.has(key) || (options.retryErrors && shouldRetry(checkpoint.get(key))))
    .slice(0, limit);

  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  const limiter = new RateLimiter({ globalDelayMs: delayMs, perHostDelayMs });
  const robotsCache = new Map();
  const cachedByUrl = new Map();
  for (const item of checkpoint.values()) {
    if (item?.validation?.requestedUrl && !shouldRetry(item)) cachedByUrl.set(item.validation.requestedUrl, item.validation);
  }

  let completed = 0;
  await mapLimit(selected, concurrency, async ({ record, inputIndex, key }) => {
    let validation;
    const requestedUrl = candidateWebsite(record);
    const normalizedRequested = (() => { try { return new URL(requestedUrl).toString(); } catch { return null; } })();
    const requestedHost = canonicalHost(normalizedRequested);
    if (requestedHost && duplicateHosts.has(requestedHost)) {
      validation = {
        key,
        inputIndex,
        sourceRecordId: record.source_record_id || record.sourceRecordId || record.id || null,
        name: record.name || record.roaster_name || record.roasterName || null,
        requestedUrl: normalizedRequested,
        requestedHost,
        finalUrl: null,
        finalHost: null,
        httpStatus: null,
        redirectChain: [],
        checkedAt: new Date().toISOString(),
        classification: 'shared_host_conflict',
        plausibleRoaster: null,
        reasonCode: 'multiple_candidates_share_official_host',
        reason: `${duplicateHosts.get(requestedHost).length} input candidates share this canonical host; resolve the brand/entity relationship before any site request or import.`,
        evidence: [],
        error: null,
      };
    } else if (normalizedRequested && cachedByUrl.has(normalizedRequested)) {
      const cached = cachedByUrl.get(normalizedRequested);
      validation = { ...cached, key, inputIndex, sourceRecordId: record.source_record_id || record.sourceRecordId || record.id || null, name: record.name || record.roaster_name || record.roasterName || null, requestedUrl: normalizedRequested, checkedAt: new Date().toISOString(), reusedValidationKey: cached.key };
    } else {
      validation = await validateCandidate(record, inputIndex, { limiter, robotsCache, timeoutMs, maxBytes, maxRedirects, userAgent: options.userAgent });
      if (validation.requestedUrl) cachedByUrl.set(validation.requestedUrl, validation);
    }
    fs.appendFileSync(output, `${JSON.stringify({ ...record, validation })}\n`, { encoding: 'utf8', mode: 0o600 });
    completed += 1;
    console.log(`[${completed}/${selected.length}] ${validation.classification} ${validation.name || validation.requestedUrl || `row ${inputIndex + 1}`}`);
  });

  console.log(`Validation checkpoint: ${output}`);
  console.log(`Selected ${selected.length}; previously completed ${checkpoint.size}; no Supabase writes were made.`);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { candidateWebsite, integerOption, mapLimit, parseArgs, readCheckpoint, sharedHostGroups, shouldRetry };
