#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { parseExport } = require('../directoryImport/core');
const { writeNdjson } = require('./accept-cli');
const { convertOfficialSiteRecord } = require('./officialSiteData');

function usage() {
  return `Usage:
  node src/siteValidation/official-convert-cli.js --input approved.validation.ndjson [options]

Options:
  --output FILE   Official-site-sourced importer candidates
                  (default <input>.official-candidates.ndjson)
  --report FILE   Per-record conversion decisions (default <output>.decisions.ndjson)

This command is offline. It emits only facts observed on the single official page
already fetched by the robots-aware validator. Discovery-source names, contact data,
and locations are never promoted as official-site facts. Legal status is recorded as
requiring review; this tool does not make legal conclusions.`;
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(usage()); return; }
  if (!options.input) throw new Error(`--input is required\n\n${usage()}`);
  const input = path.resolve(options.input);
  const output = path.resolve(options.output || `${input}.official-candidates.ndjson`);
  const report = path.resolve(options.report || `${output}.decisions.ndjson`);
  if (new Set([input, output, report]).size !== 3) throw new Error('input, output, and report must be different files');

  const records = parseExport(fs.readFileSync(input, 'utf8'), 'ndjson');
  const converted = [];
  const decisions = [];
  records.forEach((record, inputIndex) => {
    try {
      const candidate = convertOfficialSiteRecord(record);
      converted.push(candidate);
      decisions.push({
        inputIndex,
        disposition: 'converted',
        sourceRecordId: candidate.source_record_id,
        officialWebsite: candidate.official_website,
        name: candidate.name,
        legalReviewStatus: candidate.source_metadata.legal_review.status,
      });
    } catch (error) {
      decisions.push({
        inputIndex,
        disposition: 'manual',
        discoverySourceRecordId: record.source_record_id || record.sourceRecordId || null,
        reason: String(error.message || error).slice(0, 500),
      });
    }
  });
  writeNdjson(output, converted);
  writeNdjson(report, decisions);
  console.log(`Official-site candidates: ${output}`);
  console.log(`Decision report: ${report}`);
  console.log(`Converted: ${converted.length}; manual: ${records.length - converted.length}`);
  console.log('Offline conversion only: no websites, Roast Local, or Supabase were accessed.');
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { parseArgs };
