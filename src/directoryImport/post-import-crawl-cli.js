#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { writePrivateJson } = require('./store');
const { defaultOutputPaths, runPostImportCrawl } = require('./postImportCrawl');

function usage() {
  return `Usage:
  node src/directoryImport/post-import-crawl-cli.js \
    --plan /path/to/reviewed.import-plan.json \
    --import-checkpoint /path/to/reviewed.import-plan.json.checkpoint.json \
    [--run] [--concurrency 2] [--retry-failed]

Preview is the default and performs no crawl. --run initializes the existing proxy
pool and blacklist once, then invokes crawlRoaster only for completed create actions
that still match their imported entities and pass role/state/recent-run checks.
This command does not load, restart, stop, or otherwise touch the LaunchAgent.`;
}

function parseArgs(argv) {
  const options = { run: false, retryFailed: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--run') options.run = true;
    else if (token === '--retry-failed') options.retryFailed = true;
    else if (token === '--help' || token === '-h') options.help = true;
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

function concurrencyOption(value) {
  if (value === undefined) return 2;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 4) throw new Error('--concurrency must be an integer from 1 to 4');
  return number;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(usage()); return; }
  if (!options.plan || !options.importCheckpoint) throw new Error(`--plan and --import-checkpoint are required\n\n${usage()}`);

  const planFile = path.resolve(options.plan);
  const importCheckpointFile = path.resolve(options.importCheckpoint);
  const defaults = defaultOutputPaths(importCheckpointFile);
  const runnerCheckpointFile = path.resolve(options.runnerCheckpoint || defaults.runnerCheckpoint);
  const summaryFile = path.resolve(options.summary || defaults.summary);
  if (new Set([planFile, importCheckpointFile, runnerCheckpointFile, summaryFile]).size !== 4) {
    throw new Error('plan, import checkpoint, runner checkpoint, and summary must be different files');
  }
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const importCheckpoint = JSON.parse(fs.readFileSync(importCheckpointFile, 'utf8'));
  const { getSupabase } = require('../supabase');
  const result = await runPostImportCrawl({
    db: getSupabase(),
    plan,
    importCheckpoint,
    runnerCheckpointFile,
    concurrency: concurrencyOption(options.concurrency),
    retryFailed: options.retryFailed,
    run: options.run,
  });
  writePrivateJson(summaryFile, result.summary);
  console.log(`Post-import crawl ${result.summary.mode}: ${summaryFile}`);
  console.log(`Targets: ${result.summary.targetCount}; eligible: ${result.summary.eligibleCount}; skipped: ${result.summary.skipped.length}`);
  if (options.run) console.log(`Completed: ${result.summary.completedCount || 0}; failed: ${result.summary.failedCount || 0}; checkpoint: ${runnerCheckpointFile}`);
  else console.log('Preview only: proxy pool, blacklist, crawler, and LaunchAgent were not touched.');
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { concurrencyOption, parseArgs };
