const crypto = require('node:crypto');
const { canonicalHost, stableStringify, strictNameKey } = require('../directoryImport/core');
const { candidateKey } = require('./core');

const ACCEPTANCE_RULE_VERSION = 1;
const OFFICIAL_SITE_ACCEPTANCE_RULE_VERSION = 2;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const ACCEPTED_STRONG_SIGNALS = new Set([
  'roast_our_coffee',
  'freshly_roasted',
  'roasted_to_order',
  'our_roastery',
  'french_roaster',
  'spanish_roaster',
]);
const GENERIC_NAME_TOKENS = new Set([
  'coffee', 'coffees', 'roast', 'roaster', 'roasters', 'roasting', 'roastery', 'roasteries',
  'cafe', 'company', 'co', 'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation',
  'the', 'and',
]);
const HARD_REJECT_CLASSIFICATIONS = new Set([
  'cafe_only', 'input_error', 'permanently_closed', 'prohibited_host', 'unlikely_roaster', 'unsupported_host',
]);

function websiteValue(record) {
  return record?.official_website || record?.officialWebsite || record?.website_url || record?.websiteUrl || record?.website || null;
}

function normalizedUrl(value) {
  try { return new URL(value).toString(); }
  catch { return null; }
}

function identityEvidence(name, title, host) {
  const nameKey = strictNameKey(name);
  const titleKey = strictNameKey(title);
  if (!nameKey || !titleKey) return null;
  if (` ${titleKey} `.includes(` ${nameKey} `)) return { kind: 'exact_name_in_title', title: String(title).slice(0, 300) };

  const candidateTokens = nameKey.split(' ').filter((token) => token.length >= 3 && !GENERIC_NAME_TOKENS.has(token));
  const titleTokens = new Set(titleKey.split(' '));
  if (!candidateTokens.length || !candidateTokens.every((token) => titleTokens.has(token))) return null;
  if (candidateTokens.length >= 2) return { kind: 'distinctive_name_tokens_in_title', tokens: candidateTokens };

  const token = candidateTokens[0];
  const hostLetters = String(host || '').split('.')[0].replace(/[^a-z0-9]/g, '');
  if (token.length >= 5 && hostLetters.includes(token.replace(/[^a-z0-9]/g, ''))) {
    return { kind: 'distinctive_title_and_host_token', tokens: [token] };
  }
  return null;
}

function decision(disposition, reasonCode, reason, details = {}) {
  return { disposition, reasonCode, reason, ...details };
}

function evaluateValidation(record, options = {}) {
  const validation = record?.validation;
  if (!validation || typeof validation !== 'object' || Array.isArray(validation)) {
    return decision('reject', 'missing_validation', 'The record has no validator result.');
  }

  const key = candidateKey(record, Number.isInteger(validation.inputIndex) ? validation.inputIndex : 0);
  if (!validation.key || validation.key !== key) {
    return decision('reject', 'validation_key_mismatch', 'The validator result does not belong to this source record and website.');
  }
  const sourceRecordId = record.source_record_id || record.sourceRecordId || record.id || null;
  if (String(validation.sourceRecordId || '') !== String(sourceRecordId || '')) {
    return decision('reject', 'source_record_mismatch', 'The validator source record ID does not match the candidate.');
  }

  const requestedUrl = normalizedUrl(websiteValue(record));
  if (!requestedUrl || normalizedUrl(validation.requestedUrl) !== requestedUrl) {
    return decision('reject', 'requested_url_mismatch', 'The validator URL does not match the candidate official website.');
  }
  if (validation.classification === 'shared_host_conflict') {
    return decision('manual', 'shared_host_conflict', 'Multiple candidates share this canonical host and require entity-level review before validation or import.');
  }
  const finalUrl = normalizedUrl(validation.finalUrl);
  const requestedHost = canonicalHost(requestedUrl);
  const finalHost = canonicalHost(finalUrl);
  if (!finalUrl || !finalHost) return decision('manual', 'missing_final_url', 'The validator did not resolve a final official URL.');
  if (requestedHost !== finalHost) {
    return decision('manual', 'cross_host_redirect', 'The candidate redirected to another canonical host and must be re-deduplicated manually.', { requestedHost, finalHost });
  }

  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const checkedAt = new Date(validation.checkedAt);
  if (!Number.isFinite(checkedAt.getTime())) return decision('reject', 'invalid_checked_at', 'The validation timestamp is invalid.');
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const ageMs = now.getTime() - checkedAt.getTime();
  if (ageMs > maxAgeMs) return decision('manual', 'stale_validation', 'The official-site validation is too old and must be refreshed.', { ageMs, maxAgeMs });
  if (ageMs < -MAX_FUTURE_SKEW_MS) return decision('reject', 'future_validation', 'The validation timestamp is implausibly in the future.');

  if (HARD_REJECT_CLASSIFICATIONS.has(validation.classification)) {
    return decision('reject', `validator_${validation.classification}`, 'The official-site validator produced a negative result.');
  }
  if (validation.classification !== 'likely_roaster' || validation.plausibleRoaster !== true) {
    return decision('manual', 'not_conservatively_likely', 'The validator did not produce a conservative likely-roaster result.');
  }
  if (!Number.isInteger(validation.httpStatus) || validation.httpStatus < 200 || validation.httpStatus >= 300 || validation.error) {
    return decision('manual', 'unsuccessful_validation', 'The final official-site request was not a clean HTTP success.');
  }
  if (validation.robots?.allowed !== true) {
    return decision('manual', 'robots_not_confirmed', 'The validator did not record an allowed robots policy.');
  }
  if (validation.contentType && !/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(validation.contentType)) {
    return decision('manual', 'non_html_validation', 'The validator result was not an HTML page.');
  }

  const evidenceSignals = (validation.evidence || [])
    .filter((item) => item?.strength === 'strong' && ACCEPTED_STRONG_SIGNALS.has(item.signal))
    .map((item) => item.signal);
  if (!evidenceSignals.length) {
    return decision('manual', 'weak_roasting_evidence', 'The page lacks a narrowly explicit coffee-roasting statement suitable for automatic acceptance.');
  }

  const identity = identityEvidence(record.name || record.roaster_name || record.roasterName, validation.page?.title, finalHost);
  if (!identity) {
    return decision('manual', 'candidate_identity_unconfirmed', 'The fetched page title does not conservatively confirm the candidate identity.');
  }

  return decision('accepted', 'accepted_v1', 'Fresh same-host official-site evidence confirms both candidate identity and explicit coffee roasting.', {
    requestedHost,
    finalHost,
    checkedAt: checkedAt.toISOString(),
    evidenceSignals: [...new Set(evidenceSignals)].sort(),
    identity,
  });
}

function recordWithoutAcceptance(record) {
  return Object.fromEntries(Object.entries(record || {}).filter(([key]) => !['validation_acceptance', 'validationAcceptance'].includes(key)));
}

function acceptanceHash(record, acceptance) {
  const body = { record: recordWithoutAcceptance(record), acceptance: Object.fromEntries(Object.entries(acceptance).filter(([key]) => key !== 'hash')) };
  return crypto.createHash('sha256').update(stableStringify(body)).digest('hex');
}

function approveOfficialSiteRecord(record, context = {}) {
  const validation = record?.official_site_validation;
  const finalUrl = normalizedUrl(record?.official_website);
  const sourceProfile = normalizedUrl(record?.source_profile);
  if (!validation || !finalUrl || sourceProfile !== finalUrl) {
    throw new Error('official-site candidate is missing its validation or official source URL');
  }
  const acceptance = {
    schemaVersion: OFFICIAL_SITE_ACCEPTANCE_RULE_VERSION,
    rule: 'official-site-facts-from-approved-single-page',
    finalUrl,
    finalHost: canonicalHost(finalUrl),
    checkedAt: validation.checkedAt,
    discoveryValidationKey: context.discoveryValidationKey || null,
    upstreamAcceptanceHash: context.upstreamAcceptanceHash || null,
  };
  acceptance.hash = acceptanceHash(record, acceptance);
  return { ...recordWithoutAcceptance(record), validation_acceptance: acceptance };
}

function acceptRecord(record, options = {}) {
  const result = evaluateValidation(record, options);
  if (result.disposition !== 'accepted') return { accepted: false, decision: result, record: null };
  const validation = record.validation;
  const acceptance = {
    schemaVersion: ACCEPTANCE_RULE_VERSION,
    rule: 'same-host-fresh-explicit-roasting-and-title-identity',
    validationKey: validation.key,
    checkedAt: result.checkedAt,
    finalUrl: normalizedUrl(validation.finalUrl),
    finalHost: result.finalHost,
    evidenceSignals: result.evidenceSignals,
    identity: result.identity,
  };
  acceptance.hash = acceptanceHash(record, acceptance);
  return { accepted: true, decision: result, record: { ...recordWithoutAcceptance(record), validation_acceptance: acceptance } };
}

function verifyOfficialSiteRecord(record, options = {}) {
  const acceptance = record?.validation_acceptance || record?.validationAcceptance;
  if (!acceptance || acceptance.schemaVersion !== OFFICIAL_SITE_ACCEPTANCE_RULE_VERSION || !/^[a-f0-9]{64}$/.test(acceptance.hash || '')) {
    throw new Error('record is not an approved official-site extraction artifact');
  }
  if (acceptanceHash(record, acceptance) !== acceptance.hash) throw new Error('official-site acceptance hash mismatch');

  const finalUrl = normalizedUrl(record?.official_website || record?.officialWebsite);
  const sourceProfile = normalizedUrl(record?.source_profile || record?.sourceProfile);
  const validation = record?.official_site_validation || record?.officialSiteValidation;
  const metadata = record?.source_metadata || record?.sourceMetadata;
  if (!finalUrl || sourceProfile !== finalUrl || acceptance.finalUrl !== finalUrl || acceptance.finalHost !== canonicalHost(finalUrl)) {
    throw new Error('official-site source and final URL do not match');
  }
  if (!validation || normalizedUrl(validation.finalUrl) !== finalUrl || validation.finalHost !== canonicalHost(finalUrl)) {
    throw new Error('official-site validation does not match the candidate URL');
  }
  if (validation.classification !== 'likely_roaster' || validation.plausibleRoaster !== true || validation.robots?.allowed !== true || validation.httpStatus < 200 || validation.httpStatus >= 300) {
    throw new Error('official-site validation is not a successful likely-roaster result');
  }
  const checkedAt = new Date(validation.checkedAt);
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (!Number.isFinite(checkedAt.getTime())) throw new Error('official-site validation timestamp is invalid');
  const ageMs = now.getTime() - checkedAt.getTime();
  if (ageMs > (options.maxAgeMs ?? DEFAULT_MAX_AGE_MS) || ageMs < -MAX_FUTURE_SKEW_MS) {
    throw new Error('official-site validation is stale or implausibly future-dated');
  }
  if (!validation.identity || !(validation.roastingEvidence || []).some((item) => item?.strength === 'strong' && ACCEPTED_STRONG_SIGNALS.has(item.signal))) {
    throw new Error('official-site validation lacks high-confidence identity or roasting evidence');
  }
  if (metadata?.source_kind !== 'official_site_single_page_observation' || normalizedUrl(metadata.source_url) !== finalUrl) {
    throw new Error('official-site source metadata is missing or inconsistent');
  }
  if (metadata?.legal_review?.status !== 'requires_review') {
    throw new Error('official-site legal ambiguity flag is missing');
  }
  const provenance = metadata?.property_provenance;
  if (provenance?.name?.source !== 'official_site' || provenance?.name?.kind !== 'json_ld' || provenance?.official_website?.source !== 'official_site') {
    throw new Error('official-site field provenance is incomplete');
  }
  return true;
}

function verifyAcceptedRecord(record, options = {}) {
  const acceptance = record?.validation_acceptance || record?.validationAcceptance;
  if (acceptance?.schemaVersion === OFFICIAL_SITE_ACCEPTANCE_RULE_VERSION) {
    return verifyOfficialSiteRecord(record, options);
  }
  if (!acceptance || acceptance.schemaVersion !== ACCEPTANCE_RULE_VERSION || !/^[a-f0-9]{64}$/.test(acceptance.hash || '')) {
    throw new Error('record is not an approved site-validation artifact');
  }
  if (acceptanceHash(record, acceptance) !== acceptance.hash) throw new Error('site-validation acceptance hash mismatch');
  const result = evaluateValidation(record, options);
  if (result.disposition !== 'accepted') throw new Error(`site-validation acceptance no longer passes: ${result.reasonCode}`);
  if (acceptance.validationKey !== record.validation.key || acceptance.finalHost !== result.finalHost || acceptance.checkedAt !== result.checkedAt) {
    throw new Error('site-validation acceptance metadata does not match the validator result');
  }
  return true;
}

module.exports = {
  ACCEPTANCE_RULE_VERSION,
  OFFICIAL_SITE_ACCEPTANCE_RULE_VERSION,
  ACCEPTED_STRONG_SIGNALS,
  DEFAULT_MAX_AGE_MS,
  acceptRecord,
  approveOfficialSiteRecord,
  evaluateValidation,
  identityEvidence,
  verifyAcceptedRecord,
  verifyOfficialSiteRecord,
};
