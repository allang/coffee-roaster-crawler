#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { parseExport } = require('../directoryImport/core');
const { acceptRecord, DEFAULT_MAX_AGE_MS } = require('./acceptance');

function usage() {
  return `Usage:
  node src/siteValidation/accept-cli.js --input candidates.validation.ndjson [options]

Options:
  --output FILE          Approved-only importer input (default <input>.approved.ndjson)
  --report FILE          Decision report for every input row (default <output>.decisions.ndjson)
  --max-age-hours N      Maximum validation age (default 168, maximum 168)

This command is offline. It accepts only fresh, same-host, successful validator
results with narrow roasting evidence and conservative page-title identity evidence.
Every other row is written to the decision report as manual or reject.`;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') options.help = true;
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

function maxAgeMs(value) {
  if (value === undefined) return DEFAULT_MAX_AGE_MS;
  const hours = Number(value);
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw new Error('--max-age-hours must be an integer from 1 to 168');
  return hours * 60 * 60 * 1000;
}

function writeNdjson(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp`;
  const body = rows.map((row) => JSON.stringify(row)).join('\n');
  fs.writeFileSync(temporary, body ? `${body}\n` : '', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(usage()); return; }
  if (!options.input) throw new Error(`--input is required\n\n${usage()}`);
  const input = path.resolve(options.input);
  const output = path.resolve(options.output || `${input}.approved.ndjson`);
  const report = path.resolve(options.report || `${output}.decisions.ndjson`);
  if (new Set([input, output, report]).size !== 3) throw new Error('input, output, and report must be different files');

  const records = parseExport(fs.readFileSync(input, 'utf8'), 'ndjson');
  const accepted = [];
  const decisions = [];
  const age = maxAgeMs(options.maxAgeHours);
  records.forEach((record, inputIndex) => {
    const result = acceptRecord(record, { maxAgeMs: age });
    decisions.push({
      inputIndex,
      sourceRecordId: record.source_record_id || record.sourceRecordId || record.id || null,
      name: record.name || record.roaster_name || record.roasterName || null,
      website: record.official_website || record.officialWebsite || record.website_url || record.websiteUrl || record.website || null,
      ...result.decision,
    });
    if (result.accepted) accepted.push(result.record);
  });
  writeNdjson(output, accepted);
  writeNdjson(report, decisions);
  const counts = decisions.reduce((summary, item) => ({ ...summary, [item.disposition]: (summary[item.disposition] || 0) + 1 }), {});
  console.log(`Approved importer input: ${output}`);
  console.log(`Decision report: ${report}`);
  console.log(`Decisions: ${JSON.stringify(counts)}`);
  console.log('Offline filter only: no sites or Supabase records were accessed.');
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { maxAgeMs, parseArgs, writeNdjson };
