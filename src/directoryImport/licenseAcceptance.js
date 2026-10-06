const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { stableStringify } = require('./core');

const SCHEMA_VERSION = 1;
const RULE_VERSION = 'overture-places-property-license-v1';
const CANONICALIZATION = 'json-utf8-sort-keys-no-whitespace-unescaped-unicode-v1';
const ALLOWED_LICENSES = new Set(['Apache-2.0', 'CC0-1.0', 'CDLA-Permissive-2.0']);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseNdjson(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`Invalid license ledger JSON on line ${index + 1}: ${error.message}`); }
  });
}

function cleanProjection(record) {
  const fields = ['source_profile', 'source_record_id', 'name', 'official_website', 'description_raw', 'short_description', 'primary_location', 'contact', 'location'];
  return Object.fromEntries(fields.filter((key) => record[key] !== null && record[key] !== undefined).map((key) => [key, record[key]]));
}

function verifyLedgerRecord(record) {
  if (!record || record.schema_version !== SCHEMA_VERSION || record.rule_version !== RULE_VERSION || record.canonicalization !== CANONICALIZATION) {
    throw new Error('unsupported license acceptance ledger record');
  }
  if (!/^[a-f0-9]{64}$/.test(record.acceptance_sha256 || '')) throw new Error('invalid license acceptance hash');
  if (!record.row_identity?.source_record_id || !record.row_identity?.name || !record.row_identity?.official_website ||
      !record.normalized_import_projection || typeof record.normalized_import_projection !== 'object') {
    throw new Error('license acceptance is missing row identity or import projection');
  }
  if (!Array.isArray(record.selected_property_paths) || !record.selected_property_paths.length ||
      !Array.isArray(record.governing_sources) || !record.governing_sources.length ||
      !Array.isArray(record.used_licenses) || !record.used_licenses.length) {
    throw new Error('license acceptance is missing property-level governing sources');
  }
  if (record.used_licenses.some((license) => !ALLOWED_LICENSES.has(license))) throw new Error('license acceptance contains an unsupported license');
  for (const target of record.selected_property_paths) {
    if (!record.governing_sources.some((source) => source?.target_path === target)) throw new Error(`license acceptance has no governing source for ${target}`);
  }
  for (const source of record.governing_sources) {
    if (!record.selected_property_paths.includes(source?.target_path) || !source.dataset || !record.used_licenses.includes(source.license)) {
      throw new Error('license acceptance has an invalid governing source');
    }
  }
  if (record.local_license_artifacts_verified !== true || record.data_gate_passed !== true) throw new Error('license acceptance data/artifact gate did not pass');
  for (const license of record.used_licenses) {
    const artifacts = record.license_artifacts?.[license];
    if (!Array.isArray(artifacts) || !artifacts.length || artifacts.some((item) => !item.file || !/^[a-f0-9]{64}$/.test(item.sha256 || ''))) {
      throw new Error(`license acceptance lacks verified artifacts for ${license}`);
    }
  }
  const body = { ...record };
  delete body.acceptance_sha256;
  if (sha256(stableStringify(body)) !== record.acceptance_sha256) throw new Error('license acceptance ledger hash mismatch');
  if (sha256(stableStringify(record.normalized_import_projection)) !== record.normalized_import_projection_sha256) {
    throw new Error('license acceptance projection hash mismatch');
  }
  return true;
}

function loadLicenseAcceptance(ledgerFile, manifestFile) {
  const ledgerPath = path.resolve(ledgerFile);
  const manifestPath = path.resolve(manifestFile);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schema_version !== SCHEMA_VERSION || manifest.rule_version !== RULE_VERSION || manifest.canonicalization !== CANONICALIZATION) {
    throw new Error('unsupported license acceptance manifest');
  }
  const ledgerBytes = fs.readFileSync(ledgerPath);
  if (manifest.acceptance_ledger?.file !== path.basename(ledgerPath) || manifest.acceptance_ledger?.sha256 !== sha256(ledgerBytes)) {
    throw new Error('license acceptance ledger does not match its manifest');
  }
  const records = parseNdjson(ledgerPath);
  if (records.length !== manifest.acceptance_ledger.records) throw new Error('license acceptance ledger record count mismatch');
  records.forEach(verifyLedgerRecord);
  const ordered = [...records].sort((first, second) => String(first.row_identity?.source_record_id).localeCompare(String(second.row_identity?.source_record_id)));
  const root = sha256(`${ordered.map((record) => record.acceptance_sha256).join('\n')}\n`);
  if (root !== manifest.acceptance_root_sha256) throw new Error('license acceptance root hash mismatch');
  const byId = new Map();
  for (const record of records) {
    const id = String(record.row_identity?.source_record_id || '');
    if (!id || byId.has(id)) throw new Error('license acceptance ledger has a missing or duplicate source record ID');
    byId.set(id, record);
  }
  return { byId, ledgerFile: path.basename(ledgerPath), manifest, root };
}

function verifyLicenseAcceptedRecord(record, acceptance) {
  if (!acceptance?.byId) throw new Error('license ledger and manifest are required');
  const embedded = record?.source_metadata?.license_acceptance;
  if (!embedded || embedded.schema_version !== SCHEMA_VERSION || embedded.rule_version !== RULE_VERSION || embedded.canonicalization !== CANONICALIZATION) {
    throw new Error('record has no supported license acceptance');
  }
  if (embedded.ledger_file !== acceptance.ledgerFile) throw new Error('record points to a different license acceptance ledger');
  const identifier = String(record.source_record_id || '');
  const ledger = acceptance.byId.get(identifier);
  if (!ledger || embedded.acceptance_sha256 !== ledger.acceptance_sha256) throw new Error('record has no matching license ledger entry');
  if (embedded.data_gate_passed !== true || ledger.data_gate_passed !== true) throw new Error('record failed the property-level license data gate');
  if (embedded.public_redistribution_ready !== true || ledger.public_redistribution_ready !== true ||
      embedded.production_eligible !== true || ledger.production_eligible !== true) {
    throw new Error('record is not production-eligible until recipient-facing license obligations are satisfied');
  }
  const identity = ledger.row_identity || {};
  if (String(identity.source_record_id || '') !== identifier || identity.name !== record.name || identity.official_website !== record.official_website) {
    throw new Error('record identity does not match its license acceptance');
  }
  const projection = cleanProjection(record);
  if (stableStringify(projection) !== stableStringify(ledger.normalized_import_projection) ||
      sha256(stableStringify(projection)) !== ledger.normalized_import_projection_sha256) {
    throw new Error('record import projection does not match its license acceptance');
  }
  return true;
}

module.exports = {
  CANONICALIZATION,
  RULE_VERSION,
  SCHEMA_VERSION,
  cleanProjection,
  loadLicenseAcceptance,
  verifyLedgerRecord,
  verifyLicenseAcceptedRecord,
};
