#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { assertAllowedUrl, installLegalGuard } = require('./legal-guard');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

function usage() {
  return 'Usage: node src/myCoffeeExplorerImport/targeted-crawl.js --input verified-targets.ndjson [--checkpoint FILE] [--summary FILE] [--audit FILE] [--source-key my_coffee_explorer] [--concurrency 1|2] [--run] [--retry-failed]\nPreview is the default. Input rows: {entity_id,website_url,reason,source_ids:[{source,source_id}]}. Source-ID strings use --source-key. No scheduler changes.';
}

function parseArgs(argv) {
  const options = { run: false, retryFailed: false, concurrency: 1, sourceKey: 'my_coffee_explorer' };
  const values = new Set(['input', 'checkpoint', 'summary', 'audit', 'source-key', 'concurrency']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--run') options.run = true;
    else if (arg === '--retry-failed') options.retryFailed = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--') && values.has(arg.slice(2))) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`${arg} requires a value`);
      options[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  options.concurrency = Number(options.concurrency);
  if (![1, 2].includes(options.concurrency)) throw new Error('Concurrency must be 1 or 2');
  return options;
}

function websiteKey(value) {
  const url = assertAllowedUrl(value);
  if (url.username || url.password) throw new Error('Official website contains credentials');
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function parseTargets(text, sourceKey = 'my_coffee_explorer') {
  const targets = text.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    let row;
    try { row = JSON.parse(line); } catch { throw new Error(`Invalid JSON in input row ${index + 1}`); }
    if (!UUID.test(row.entity_id || '')) throw new Error(`Invalid entity_id in input row ${index + 1}`);
    const website = websiteKey(row.website_url);
    if (!Array.isArray(row.source_ids) || !row.source_ids.length) throw new Error(`Missing verified source_ids in input row ${index + 1}`);
    const sourceIds = row.source_ids.map((value) => typeof value === 'string'
      ? { source: sourceKey, source_id: value }
      : { source: value?.source || sourceKey, source_id: String(value?.source_id ?? value?.sourceId ?? '') });
    if (sourceIds.some((x) => !x.source || !x.source_id)) throw new Error(`Invalid source_ids in input row ${index + 1}`);
    return { entityId: row.entity_id, websiteUrl: website, reason: String(row.reason || '').slice(0, 300), sourceIds };
  });
  if (new Set(targets.map((x) => x.entityId)).size !== targets.length) throw new Error('Input contains duplicate entity IDs');
  return targets;
}

function privateJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

async function allRows(queryFactory) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await queryFactory().range(offset, offset + 999);
    if (result.error) throw result.error;
    rows.push(...(result.data || []));
    if ((result.data || []).length < 1000) return rows;
  }
}

async function fetchState(db, targets) {
  const state = { entities: [], roles: [], crawlStates: [], runs: [], sourceIds: [] };
  for (let offset = 0; offset < targets.length; offset += 25) {
    const ids = targets.slice(offset, offset + 25).map((x) => x.entityId);
    const entries = await Promise.all([
      allRows(() => db.from('entities').select('id,name,slug,website_url').in('id', ids).order('id')),
      allRows(() => db.from('entity_roles').select('entity_id,role').in('entity_id', ids).eq('role', 'roaster').order('entity_id')),
      allRows(() => db.from('entity_crawl_state').select('entity_id,allow_crawl').in('entity_id', ids).order('entity_id')).catch((error) => {
        if (error.code === 'PGRST205' && /entity_crawl_state/i.test(error.message || '')) return [];
        throw error;
      }),
      allRows(() => db.from('crawl_runs').select('id,entity_id,status,started_at,finished_at,created_at').in('entity_id', ids).in('status', ['running', 'completed']).order('id')),
      allRows(() => db.from('entity_source_ids').select('id,entity_id,source,source_id').in('entity_id', ids).order('id')),
    ]);
    ['entities', 'roles', 'crawlStates', 'runs', 'sourceIds'].forEach((key, index) => state[key].push(...entries[index]));
  }
  return state;
}

function selectTarget(target, state, checkpoint = {}, options = {}) {
  const entity = state.entities.find((x) => x.id === target.entityId);
  if (!entity) return { eligible: false, reason: 'entity_missing' };
  if (!entity.website_url || websiteKey(entity.website_url) !== target.websiteUrl) return { eligible: false, reason: 'website_mismatch' };
  if (!state.roles.some((x) => x.entity_id === target.entityId && x.role === 'roaster')) return { eligible: false, reason: 'roaster_role_missing' };
  if (target.sourceIds.some((source) => !state.sourceIds.some((x) => x.entity_id === target.entityId && x.source === source.source && x.source_id === source.source_id))) return { eligible: false, reason: 'verified_source_id_missing' };
  if (state.crawlStates.some((x) => x.entity_id === target.entityId && x.allow_crawl === false)) return { eligible: false, reason: 'crawl_disabled' };
  const runs = state.runs.filter((x) => x.entity_id === target.entityId);
  if (runs.some((x) => x.status === 'running')) return { eligible: false, reason: 'active_crawl_exists' };
  const now = options.now ?? Date.now();
  if (runs.some((x) => {
    if (x.status !== 'completed') return false;
    const timestamp = Date.parse(x.finished_at || x.started_at || x.created_at || '');
    return !Number.isFinite(timestamp) || now - timestamp <= COOLDOWN_MS;
  })) return { eligible: false, reason: 'completed_within_24_hours' };
  const prior = checkpoint.results?.[target.entityId];
  if (prior?.status === 'complete') return { eligible: false, reason: 'checkpoint_complete' };
  if (prior?.status === 'failed' && !options.retryFailed) return { eligible: false, reason: 'failed_requires_retry_flag' };
  return { eligible: true, entity };
}

function safeError(error) {
  // Dependencies may include full request URLs or credentials in errors. Keep only a code.
  const code = String(error?.code || error?.name || 'crawl_failed').replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 100);
  return { code: code || 'crawl_failed' };
}

async function run(options, dependencies = {}) {
  const inputFile = path.resolve(options.input);
  const text = fs.readFileSync(inputFile, 'utf8');
  const targets = parseTargets(text, options.sourceKey);
  const inputHash = crypto.createHash('sha256').update(JSON.stringify(targets)).digest('hex');
  const checkpointFile = path.resolve(options.checkpoint || `${inputFile}.crawl-checkpoint.json`);
  const summaryFile = path.resolve(options.summary || `${inputFile}.crawl-summary.json`);
  const auditFile = path.resolve(options.audit || `${inputFile}.crawl-requests.ndjson`);
  if (new Set([inputFile, checkpointFile, summaryFile, auditFile]).size !== 4) throw new Error('Input, checkpoint, summary and audit must be distinct files');
  let checkpoint = { schemaVersion: 1, inputHash, results: {} };
  if (fs.existsSync(checkpointFile)) {
    checkpoint = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
    if (checkpoint.schemaVersion !== 1 || checkpoint.inputHash !== inputHash || !checkpoint.results) throw new Error('Checkpoint input hash mismatch');
  }
  const lockFile = `${checkpointFile}.lock`;
  let lockFd;
  if (options.run) {
    fs.mkdirSync(path.dirname(checkpointFile), { recursive: true, mode: 0o700 });
    try { lockFd = fs.openSync(lockFile, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw new Error(`Runner lock exists; inspect owner before recovery: ${lockFile}`); throw error; }
    fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), inputHash }));
  }
  const context = new AsyncLocalStorage();
  fs.mkdirSync(path.dirname(auditFile), { recursive: true, mode: 0o700 });
  const auditFd = fs.openSync(auditFile, 'a', 0o600);
  fs.fchmodSync(auditFd, 0o600);
  const guard = installLegalGuard({ internalDataOrigin: process.env.NEXT_PUBLIC_SUPABASE_URL, context: () => context.getStore() || null, onEvent: (event) => fs.writeSync(auditFd, `${JSON.stringify(event)}\n`) });
  const summary = { schemaVersion: 1, inputHash, mode: options.run ? 'run' : 'preview', startedAt: new Date().toISOString(), targetCount: targets.length, eligibleCount: 0, skipped: [], results: [] };
  try {
    const db = dependencies.db || require('../supabase').getSupabase();
    const initial = await fetchState(db, targets);
    const eligible = [];
    for (const target of targets) {
      const selection = selectTarget(target, initial, checkpoint, options);
      if (selection.eligible) eligible.push(target);
      else summary.skipped.push({ entityId: target.entityId, reason: selection.reason });
    }
    summary.eligibleCount = eligible.length;
    summary.eligible = eligible.map((x) => ({ entityId: x.entityId, websiteUrl: x.websiteUrl }));
    if (options.run && eligible.length) {
      const { initProxyPool } = dependencies.httpClient || require('../httpClient');
      const { getBlacklistTerms } = dependencies.blacklist || require('../blacklist');
      const crawlRoaster = dependencies.crawlRoaster || require('../crawler').crawlRoaster;
      await initProxyPool();
      const blacklist = await getBlacklistTerms();
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(options.concurrency, eligible.length) }, async () => {
        while (next < eligible.length) {
          const target = eligible[next++];
          await context.run({ entityId: target.entityId }, async () => {
            const fresh = await fetchState(db, [target]);
            const selection = selectTarget(target, fresh, checkpoint, options);
            if (!selection.eligible) { summary.skipped.push({ entityId: target.entityId, reason: selection.reason }); return; }
            const startedAt = new Date().toISOString();
            checkpoint.results[target.entityId] = { status: 'running', startedAt };
            checkpoint.updatedAt = startedAt;
            privateJson(checkpointFile, checkpoint);
            let result;
            try {
              const crawled = await crawlRoaster(selection.entity, blacklist);
              result = { status: crawled?.success ? 'complete' : 'failed', startedAt, finishedAt: new Date().toISOString(), coffeesFound: crawled?.visitResults?.coffeeFound || 0, pagesVisited: crawled?.visitResults?.visited || 0, retryable: crawled?.retryable === true, ...(crawled?.success ? {} : { error: safeError(crawled?.error) }) };
            } catch (error) { result = { status: 'failed', startedAt, finishedAt: new Date().toISOString(), error: safeError(error) }; }
            checkpoint.results[target.entityId] = result;
            checkpoint.updatedAt = result.finishedAt;
            privateJson(checkpointFile, checkpoint);
            summary.results.push({ entityId: target.entityId, ...result });
          });
        }
      }));
    }
    summary.completedCount = summary.results.filter((x) => x.status === 'complete').length;
    summary.failedCount = summary.results.filter((x) => x.status === 'failed').length;
    return summary;
  } finally {
    summary.finishedAt = new Date().toISOString();
    summary.guard = { ...guard.stats };
    privateJson(summaryFile, summary);
    guard.uninstall();
    fs.closeSync(auditFd);
    if (lockFd !== undefined) { fs.closeSync(lockFd); fs.unlinkSync(lockFile); }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(usage()); return; }
  if (!options.input) throw new Error(usage());
  const summary = await run(options);
  console.log(JSON.stringify({ ...summary, eligible: undefined, results: undefined }, null, 2));
  if (summary.failedCount) process.exitCode = 1;
}
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { COOLDOWN_MS, fetchState, parseArgs, parseTargets, run, selectTarget, websiteKey };
