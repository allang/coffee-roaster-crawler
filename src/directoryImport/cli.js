#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { buildPlan, parseExport, verifyPlan } = require('./core');
const { applyPlan, loadSnapshot, writePrivateJson } = require('./store');
const { verifyAcceptedRecord } = require('../siteValidation/acceptance');
const { loadLicenseAcceptance, verifyLicenseAcceptedRecord } = require('./licenseAcceptance');

function usage() {
  return `Usage:
  node src/directoryImport/cli.js --input authorized-export.json \\
    --source-name "Licensed directory export" \\
    --authorization-note "Export received under ..." \\
    --license-ledger /path/to/license-acceptance.ndjson \\
    --license-manifest /path/to/license-acceptance.manifest.json \\
    [--format json|ndjson|csv]

The license ledger and manifest are required for Overture inputs. Dry-run is the
default. Input must come from siteValidation/accept-cli.js. It reads
Supabase to snapshot every entity, then writes a plan/report.
Apply the exact reviewed plan with:
  node src/directoryImport/cli.js --apply --plan /path/to/export.import-plan.json`;
}

function parseArgs(argv) {
  const options = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--apply') options.apply = true;
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

function inferFormat(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.csv') return 'csv';
  if (extension === '.ndjson' || extension === '.jsonl') return 'ndjson';
  return 'json';
}

function requiresOvertureLicenseAcceptance(record) {
  return record?.source_metadata?.provider === 'Overture Maps Foundation' ||
    /^https:\/\/docs\.overturemaps\.org\//i.test(record?.source_profile || record?.sourceProfile || '');
}

function assertApprovedRecords(records, options = {}) {
  records.forEach((record, index) => {
    try {
      verifyAcceptedRecord(record, { now: options.now });
      if (requiresOvertureLicenseAcceptance(record)) verifyLicenseAcceptedRecord(record, options.licenseAcceptance);
    }
    catch (error) { throw new Error(`Input row ${index + 1} is not approved for import: ${error.message}`); }
  });
  return true;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(usage()); return; }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const { createClient } = require('@supabase/supabase-js');
  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  if (options.apply) {
    if (!options.plan) throw new Error(`--apply requires --plan so only a previously reviewed plan can be written\n\n${usage()}`);
    const planPath = path.resolve(options.plan);
    const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    verifyPlan(plan, { requireAcceptanceFreshness: true });
    if ((plan.counts.conflict || 0) > 0 || (plan.counts.reject || 0) > 0) {
      throw new Error('Apply refused: resolve every rejected or conflicting row first');
    }
    const checkpointPath = path.resolve(options.checkpoint || `${planPath}.checkpoint.json`);
    const checkpoint = await applyPlan(db, plan, checkpointPath);
    console.log(`Apply complete: ${checkpoint.completed || 0} records; checkpoint ${checkpointPath}`);
    return;
  }

  if (!options.input || !options.sourceName || !options.authorizationNote) {
    throw new Error(`--input, --source-name, and --authorization-note are required\n\n${usage()}`);
  }
  const inputPath = path.resolve(options.input);
  const records = parseExport(fs.readFileSync(inputPath, 'utf8'), options.format || inferFormat(inputPath));
  const requiresLicense = records.some(requiresOvertureLicenseAcceptance);
  if (requiresLicense && (!options.licenseLedger || !options.licenseManifest)) {
    throw new Error(`Overture input requires --license-ledger and --license-manifest\n\n${usage()}`);
  }
  const licenseAcceptance = requiresLicense ? loadLicenseAcceptance(options.licenseLedger, options.licenseManifest) : null;
  assertApprovedRecords(records, { licenseAcceptance });
  const snapshot = await loadSnapshot(db);
  const plan = buildPlan(records, snapshot, { sourceName: options.sourceName, authorizationNote: options.authorizationNote });
  const reportPath = path.resolve(options.report || `${inputPath}.import-plan.json`);
  writePrivateJson(reportPath, { ...plan, mode: 'dry-run' });
  console.log(`Plan: ${reportPath}`);
  console.log(`Snapshot: ${plan.snapshotCounts.entities} entities, ${plan.snapshotCounts.roles} roles, ${plan.snapshotCounts.locations} locations`);
  console.log(`Actions: ${JSON.stringify(plan.counts)}`);

  console.log(`Dry-run only: no Supabase writes were made. Review the plan, then apply it with --apply --plan ${reportPath}`);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { assertApprovedRecords, inferFormat, parseArgs, requiresOvertureLicenseAcceptance };
