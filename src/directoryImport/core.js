const crypto = require('node:crypto');

const WEBSITE_KEYS = ['official_website', 'officialWebsite', 'website_url', 'websiteUrl', 'website'];
const PROFILE_KEYS = ['source_profile', 'sourceProfile', 'profile_url', 'profileUrl'];
const NAME_KEYS = ['name', 'roaster_name', 'roasterName'];
const MAX_PLAN_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_VALIDATION_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function firstValue(object, keys) {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null && object[key] !== '') {
      return object[key];
    }
  }
  return null;
}

function cleanString(value) {
  if (value === null || value === undefined) return null;
  const result = String(value).normalize('NFC').replace(/\s+/g, ' ').trim();
  return result || null;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/, ''));
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  if (quoted) throw new Error('CSV has an unterminated quoted field');
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ''));
    if (row.some((value) => value !== '')) rows.push(row);
  }
  if (!rows.length) return [];

  const headers = rows.shift().map((header, index) => {
    const clean = header.replace(/^\uFEFF/, '').trim();
    if (!clean) throw new Error(`CSV header ${index + 1} is empty`);
    return clean;
  });
  if (new Set(headers).size !== headers.length) throw new Error('CSV contains duplicate headers');

  return rows.map((values, rowIndex) => {
    if (values.length > headers.length) throw new Error(`CSV row ${rowIndex + 2} has too many fields`);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function parseExport(text, format = 'json') {
  const normalizedFormat = format.toLowerCase();
  if (normalizedFormat === 'csv') return parseCsv(text);
  if (normalizedFormat === 'ndjson' || normalizedFormat === 'jsonl') {
    return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid NDJSON on line ${index + 1}: ${error.message}`);
      }
    });
  }
  if (normalizedFormat !== 'json') throw new Error(`Unsupported format: ${format}`);
  const parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (Array.isArray(parsed)) return parsed;
  for (const key of ['records', 'items', 'data']) {
    if (Array.isArray(parsed?.[key])) return parsed[key];
  }
  if (parsed && typeof parsed === 'object') return [parsed];
  throw new Error('JSON export must be an object, array, or contain records/items/data');
}

function normalizeHttpUrl(value, field) {
  const raw = cleanString(value);
  if (!raw) throw new Error(`${field} is required`);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${field} must be an absolute URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${field} must use http or https`);
  if (url.username || url.password) throw new Error(`${field} must not contain credentials`);
  if (!url.hostname || url.hostname === 'localhost') throw new Error(`${field} has an invalid host`);
  url.hash = '';
  return url.toString();
}

function canonicalHost(value) {
  if (!value) return null;
  let hostname;
  try {
    hostname = new URL(value).hostname;
  } catch {
    return null;
  }
  return hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '') || null;
}

function validateName(value) {
  if (value !== null && value !== undefined && /[\u0000-\u001f\u007f]/.test(String(value))) {
    throw new Error('name contains control characters');
  }
  const name = cleanString(value);
  if (!name || name.length < 2 || name.length > 160) throw new Error('name must be 2-160 characters');
  if (/https?:\/\/|www\.|@[^ ]+\.[a-z]{2,}/i.test(name)) throw new Error('name must not be a URL or email');
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new Error('name contains control characters');
  if (!/[\p{L}\p{N}]/u.test(name)) throw new Error('name must contain a letter or number');
  if (/^(unknown|n\/?a|none|null|untitled|test)$/i.test(name)) throw new Error('name is a placeholder');
  return name;
}

function parseMaybeObject(value, field) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      throw new Error(`${field} must contain valid JSON`);
    }
  }
  return {};
}

function normalizeSourceMetadata(raw) {
  const value = firstValue(raw, ['source_metadata', 'sourceMetadata']);
  if (value === null) return null;
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); }
    catch { throw new Error('source metadata must contain valid JSON'); }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('source metadata must be a JSON object');
  }

  let keyCount = 0;
  function copy(item, depth) {
    if (depth > 5) throw new Error('source metadata exceeds maximum depth');
    if (item === null || typeof item === 'boolean' || typeof item === 'number') {
      if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('source metadata contains a non-finite number');
      return item;
    }
    if (typeof item === 'string') {
      if (item.length > 2000) throw new Error('source metadata contains a string longer than 2,000 characters');
      return item;
    }
    if (Array.isArray(item)) {
      if (item.length > 100) throw new Error('source metadata array exceeds 100 items');
      return item.map((entry) => copy(entry, depth + 1));
    }
    if (!item || typeof item !== 'object') throw new Error('source metadata contains an unsupported value');
    const result = {};
    for (const [key, entry] of Object.entries(item)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('source metadata contains a forbidden key');
      keyCount += 1;
      if (keyCount > 100) throw new Error('source metadata exceeds 100 keys');
      result[key] = copy(entry, depth + 1);
    }
    return result;
  }

  const result = copy(parsed, 0);
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 10000) throw new Error('source metadata exceeds 10,000 bytes');
  return result;
}

function compactObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== null && value !== undefined && value !== ''));
}

function normalizeContact(raw) {
  const nested = parseMaybeObject(raw.contact, 'contact');
  const contact = { ...nested };
  for (const key of ['email', 'phone', 'instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'whatsapp']) {
    if (raw[key] !== undefined && raw[key] !== '') contact[key] = raw[key];
  }
  for (const [key, value] of Object.entries(contact)) {
    if (typeof value === 'string') contact[key] = cleanString(value);
    else if (Array.isArray(value)) contact[key] = value.map((entry) => typeof entry === 'string' ? cleanString(entry) : entry).filter((entry) => entry !== null && entry !== undefined && entry !== '');
  }
  const compact = Object.fromEntries(Object.entries(compactObject(contact)).filter(([, value]) =>
    !Array.isArray(value) || value.length > 0));
  return Object.keys(compact).length ? compact : null;
}

function normalizeLocation(raw) {
  const nested = parseMaybeObject(raw.location, 'location');
  const pick = (keys) => firstValue(nested, keys) ?? firstValue(raw, keys);
  const location = compactObject({
    label: cleanString(pick(['label', 'location_label', 'locationLabel'])) || 'roastery',
    address1: cleanString(pick(['address1', 'address_1', 'street_address', 'streetAddress'])),
    address2: cleanString(pick(['address2', 'address_2'])),
    city: cleanString(pick(['city', 'locality'])),
    region: cleanString(pick(['region', 'state', 'province'])),
    postal_code: cleanString(pick(['postal_code', 'postalCode', 'zip'])),
    country: cleanString(pick(['country', 'country_name', 'countryName'])),
    lat: pick(['lat', 'latitude']),
    lng: pick(['lng', 'lon', 'longitude']),
  });
  for (const key of ['lat', 'lng']) {
    if (location[key] !== undefined) {
      const number = Number(location[key]);
      if (!Number.isFinite(number)) throw new Error(`location.${key} must be numeric`);
      location[key] = number;
    }
  }
  if (location.lat !== undefined && (location.lat < -90 || location.lat > 90)) throw new Error('location.lat is out of range');
  if (location.lng !== undefined && (location.lng < -180 || location.lng > 180)) throw new Error('location.lng is out of range');
  const usable = location.address1 || location.city || (location.lat !== undefined && location.lng !== undefined);
  return usable ? location : null;
}

function normalizeRecord(raw, index = 0) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('record must be an object');
  const websiteUrl = normalizeHttpUrl(firstValue(raw, WEBSITE_KEYS), 'official website');
  const sourceProfile = normalizeHttpUrl(firstValue(raw, PROFILE_KEYS), 'source profile');
  const name = validateName(firstValue(raw, NAME_KEYS));
  const location = normalizeLocation(raw);
  const primaryLocation = cleanString(firstValue(raw, ['primary_location', 'primaryLocation'])) ||
    (location ? [location.city, location.region, location.country].filter(Boolean).join(', ') || location.address1 : null);
  const shortDescription = cleanString(firstValue(raw, ['short_description', 'shortDescription']));
  if (shortDescription && shortDescription.length > 400) throw new Error('short description exceeds 400 characters');
  const descriptionRaw = cleanString(firstValue(raw, ['description_raw', 'descriptionRaw', 'description']));
  if (descriptionRaw && descriptionRaw.length > 20000) throw new Error('description exceeds 20,000 characters');
  return {
    inputIndex: index,
    sourceProfile,
    sourceRecordId: cleanString(firstValue(raw, ['source_record_id', 'sourceRecordId', 'id'])),
    sourceMetadata: normalizeSourceMetadata(raw),
    validationAcceptance: firstValue(raw, ['validation_acceptance', 'validationAcceptance']),
    name,
    websiteUrl,
    host: canonicalHost(websiteUrl),
    descriptionRaw,
    shortDescription,
    primaryLocation,
    contact: normalizeContact(raw),
    location,
  };
}

function slugify(name) {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'roaster';
}

function strictNameKey(name) {
  const value = cleanString(name);
  if (!value) return null;
  return value.normalize('NFKC').toLocaleLowerCase('und').replace(/&/g, ' and ')
    .replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim() || null;
}

function isDirectParentOrSubdomain(firstHost, secondHost) {
  if (!firstHost || !secondHost || firstHost === secondHost) return false;
  const first = firstHost.toLowerCase().split('.');
  const second = secondHost.toLowerCase().split('.');
  const longer = first.length > second.length ? first : second;
  const shorter = first.length > second.length ? second : first;
  return longer.length === shorter.length + 1 && longer.slice(1).join('.') === shorter.join('.');
}

function allocateSlug(name, usedSlugs) {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;
  while (usedSlugs.has(candidate.toLowerCase())) {
    candidate = `${base.slice(0, Math.max(1, 80 - String(suffix).length - 1))}-${suffix}`;
    suffix += 1;
  }
  usedSlugs.add(candidate.toLowerCase());
  return candidate;
}

function locationFingerprint(location) {
  if (!location) return null;
  return ['address1', 'address2', 'city', 'region', 'postal_code', 'country', 'lat', 'lng']
    .map((key) => String(location[key] ?? '').normalize('NFKC').trim().toLowerCase()).join('|');
}

function sourceKey(sourceName, sourceProfile, sourceRecordId = '') {
  return crypto.createHash('sha256').update(`${sourceName}\0${sourceProfile}\0${sourceRecordId}`).digest('hex').slice(0, 24);
}

function provenanceHas(roleMetadata, key) {
  return Boolean(roleMetadata?.provenance?.authorized_exports?.[key]);
}

function matchRecord(record, entities) {
  const matches = entities.filter((entity) => canonicalHost(entity.website_url) === record.host);
  if (matches.length === 1) return { kind: 'match', entity: matches[0] };
  if (matches.length > 1) return { kind: 'ambiguous', entities: matches };
  return { kind: 'create' };
}

function mergeInputRecords(records) {
  const grouped = new Map();
  for (const record of records) {
    if (!grouped.has(record.host)) {
      grouped.set(record.host, { ...record, sources: [{ profile: record.sourceProfile, recordId: record.sourceRecordId, metadata: record.sourceMetadata, validationAcceptance: record.validationAcceptance }] });
      continue;
    }
    const target = grouped.get(record.host);
    if (target.name.localeCompare(record.name, undefined, { sensitivity: 'base' }) !== 0) {
      target.inputConflict = `same host has conflicting names: "${target.name}" and "${record.name}"`;
    }
    target.sources.push({ profile: record.sourceProfile, recordId: record.sourceRecordId, metadata: record.sourceMetadata, validationAcceptance: record.validationAcceptance });
    for (const key of ['descriptionRaw', 'shortDescription', 'primaryLocation', 'contact', 'location']) {
      if (target[key] == null && record[key] != null) target[key] = record[key];
    }
  }
  return [...grouped.values()];
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function planBody(plan) {
  return {
    schemaVersion: plan.schemaVersion,
    sourceName: plan.sourceName,
    authorizationNote: plan.authorizationNote,
    plannedAt: plan.plannedAt,
    snapshotHash: plan.snapshotHash,
    unaffectedSnapshotHash: plan.unaffectedSnapshotHash,
    snapshotCounts: plan.snapshotCounts,
    counts: plan.counts,
    actions: plan.actions,
  };
}

function planHash(plan) {
  return crypto.createHash('sha256').update(stableStringify(planBody(plan))).digest('hex');
}

function verifyPlan(plan, options = {}) {
  if (!plan || plan.schemaVersion !== 1 || !Array.isArray(plan.actions) ||
      !/^[a-f0-9]{64}$/.test(plan.snapshotHash || '') || !/^[a-f0-9]{64}$/.test(plan.unaffectedSnapshotHash || '')) {
    throw new Error('Unsupported or malformed import plan');
  }
  if (planHash(plan) !== plan.planHash) throw new Error('Import plan hash mismatch; do not apply a modified plan');
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const plannedAt = new Date(plan.plannedAt);
  if (!Number.isFinite(plannedAt.getTime())) throw new Error('Import plan has an invalid plannedAt timestamp');
  const planAgeMs = now.getTime() - plannedAt.getTime();
  if (planAgeMs > (options.maxPlanAgeMs ?? MAX_PLAN_AGE_MS)) throw new Error('Import plan is stale; regenerate and review it before apply');
  if (planAgeMs < -MAX_FUTURE_SKEW_MS) throw new Error('Import plan timestamp is implausibly in the future');
  if (options.requireAcceptanceFreshness) {
    for (const action of plan.actions.filter((item) => ['create', 'enrich'].includes(item.action))) {
      if (!Array.isArray(action.sources) || !action.sources.length) throw new Error(`Import action ${action.host || action.entityId} has no accepted source`);
      for (const source of action.sources) {
        const checkedAt = new Date(source.validationAcceptance?.checkedAt);
        if (!Number.isFinite(checkedAt.getTime())) throw new Error(`Import action ${action.host || action.entityId} has no valid site-validation timestamp`);
        const validationAgeMs = now.getTime() - checkedAt.getTime();
        if (validationAgeMs > MAX_VALIDATION_AGE_MS) throw new Error(`Site validation for ${action.host || action.entityId} is stale; revalidate and rebuild the plan`);
        if (validationAgeMs < -MAX_FUTURE_SKEW_MS) throw new Error(`Site validation for ${action.host || action.entityId} is implausibly in the future`);
      }
    }
  }
  return true;
}

function snapshotFingerprint(snapshot, options = {}) {
  const excluded = new Set(options.excludeEntityIds || []);
  const sortRows = (rows) => [...(rows || [])].sort((first, second) => {
    const firstValue = stableStringify(first);
    const secondValue = stableStringify(second);
    return firstValue < secondValue ? -1 : firstValue > secondValue ? 1 : 0;
  });
  const body = {
    entities: sortRows((snapshot?.entities || []).filter((row) => !excluded.has(row.id))),
    roles: sortRows((snapshot?.roles || []).filter((row) => !excluded.has(row.entity_id))),
    locations: sortRows((snapshot?.locations || []).filter((row) => !excluded.has(row.entity_id))),
  };
  return crypto.createHash('sha256').update(stableStringify(body)).digest('hex');
}

function findCreateConflicts(action, entities, options = {}) {
  const ignoredEntityIds = new Set(options.ignoredEntityIds || []);
  const conflicts = [];
  for (const entity of entities || []) {
    if (ignoredEntityIds.has(entity.id)) continue;
    const entityHost = canonicalHost(entity.website_url);
    if (options.allowPlannedSlugRecovery && entity.slug === action.slug && entityHost === action.host) continue;
    if (entityHost === action.host) {
      conflicts.push({ kind: 'exact_host', entityId: entity.id, host: entityHost });
      continue;
    }
    if (strictNameKey(entity.name) === strictNameKey(action.name)) {
      conflicts.push({ kind: 'strict_name', entityId: entity.id, host: entityHost });
      continue;
    }
    if (isDirectParentOrSubdomain(entityHost, action.host)) {
      conflicts.push({ kind: 'parent_or_subdomain', entityId: entity.id, host: entityHost });
    }
  }
  return conflicts;
}

function assertPlanFresh(plan, snapshot, options = {}) {
  const ignoredEntityIds = options.ignoredEntityIds || [];
  for (const action of plan.actions.filter((item) => item.action === 'create')) {
    const conflicts = findCreateConflicts(action, snapshot.entities, {
      ignoredEntityIds,
      allowPlannedSlugRecovery: options.allowPlannedSlugRecovery,
    });
    if (conflicts.length) {
      const kinds = [...new Set(conflicts.map((conflict) => conflict.kind))].join(', ');
      const ids = conflicts.map((conflict) => conflict.entityId).filter(Boolean).join(', ');
      throw new Error(`Import plan is stale: create preflight found ${kinds} conflict(s) for ${action.host}${ids ? ` (${ids})` : ''}; regenerate and review the plan`);
    }
  }
  const expectedHash = options.useUnaffectedFingerprint ? plan.unaffectedSnapshotHash : plan.snapshotHash;
  const actualHash = snapshotFingerprint(snapshot, { excludeEntityIds: options.excludeEntityIds });
  if (actualHash !== expectedHash) {
    throw new Error('Import plan is stale: the full entity/role/location snapshot changed; regenerate and review the plan');
  }
  return true;
}

function buildPlan(rawRecords, snapshot, options) {
  const sourceName = cleanString(options.sourceName);
  const authorizationNote = cleanString(options.authorizationNote);
  if (!sourceName) throw new Error('sourceName is required');
  if (!authorizationNote) throw new Error('authorizationNote is required');
  const rejected = [];
  const normalized = [];
  rawRecords.forEach((raw, index) => {
    try { normalized.push(normalizeRecord(raw, index)); }
    catch (error) { rejected.push({ action: 'reject', inputIndex: index, reason: error.message }); }
  });

  const entities = snapshot.entities || [];
  const roles = new Map((snapshot.roles || []).filter((row) => row.role === 'roaster').map((row) => [row.entity_id, row]));
  const locations = new Map();
  for (const location of snapshot.locations || []) {
    if (!locations.has(location.entity_id)) locations.set(location.entity_id, []);
    locations.get(location.entity_id).push(location);
  }
  const usedSlugs = new Set(entities.flatMap((entity) => [entity.slug, entity.name_slug]).filter(Boolean).map((slug) => slug.toLowerCase()));
  const actions = [...rejected];

  const mergedRecords = mergeInputRecords(normalized);
  const incomingNames = new Map();
  for (const record of mergedRecords) {
    const nameKey = strictNameKey(record.name);
    if (!incomingNames.has(nameKey)) incomingNames.set(nameKey, []);
    incomingNames.get(nameKey).push(record);
  }

  for (const record of mergedRecords) {
    const keys = record.sources.map((source) => sourceKey(sourceName, source.profile, source.recordId));
    if (record.inputConflict) {
      actions.push({ action: 'conflict', host: record.host, name: record.name, reason: record.inputConflict, sources: record.sources });
      continue;
    }
    const sameIncomingName = (incomingNames.get(strictNameKey(record.name)) || [])
      .filter((candidate) => candidate.host !== record.host);
    if (sameIncomingName.length) {
      const relatedHost = sameIncomingName.some((candidate) => isDirectParentOrSubdomain(record.host, candidate.host));
      actions.push({
        action: 'conflict',
        host: record.host,
        name: record.name,
        reason: relatedHost
          ? 'strict normalized name matches another input on a direct parent/subdomain; manual review required'
          : 'strict normalized name matches another input on a different host; manual review required',
        conflictingHosts: sameIncomingName.map((candidate) => candidate.host).sort(),
        sources: record.sources,
      });
      continue;
    }
    const relatedIncomingHosts = mergedRecords
      .filter((candidate) => candidate.host !== record.host && isDirectParentOrSubdomain(record.host, candidate.host));
    if (relatedIncomingHosts.length) {
      actions.push({
        action: 'conflict',
        host: record.host,
        name: record.name,
        reason: 'official host is a direct parent/subdomain of another input; manual review required',
        conflictingHosts: relatedIncomingHosts.map((candidate) => candidate.host).sort(),
        sources: record.sources,
      });
      continue;
    }
    const match = matchRecord(record, entities);
    if (match.kind === 'ambiguous') {
      actions.push({ action: 'conflict', host: record.host, name: record.name, reason: 'multiple existing entities use this exact host', entityIds: match.entities.map((e) => e.id), sources: record.sources });
      continue;
    }
    if (match.kind === 'create') {
      const relatedHostEntities = entities.filter((entity) => isDirectParentOrSubdomain(record.host, canonicalHost(entity.website_url)));
      if (relatedHostEntities.length) {
        actions.push({
          action: 'conflict',
          host: record.host,
          name: record.name,
          reason: 'official host is a direct parent/subdomain of an existing entity; manual review required',
          entityIds: relatedHostEntities.map((entity) => entity.id),
          sources: record.sources,
        });
        continue;
      }
      const sameNameEntities = entities.filter((entity) => strictNameKey(entity.name) === strictNameKey(record.name));
      if (sameNameEntities.length) {
        const relatedHost = sameNameEntities.some((entity) => isDirectParentOrSubdomain(record.host, canonicalHost(entity.website_url)));
        actions.push({
          action: 'conflict',
          host: record.host,
          name: record.name,
          reason: relatedHost
            ? 'strict normalized name matches an entity on a direct parent/subdomain; manual review required'
            : 'strict normalized name matches an existing entity on another host; manual review required',
          entityIds: sameNameEntities.map((entity) => entity.id),
          sources: record.sources,
        });
        continue;
      }
      const slug = allocateSlug(record.name, usedSlugs);
      actions.push({ action: 'create', ...record, slug, nameSlug: slug, provenanceKeys: keys });
      continue;
    }

    const entity = match.entity;
    const role = roles.get(entity.id);
    if (!role) {
      actions.push({
        action: 'conflict',
        host: record.host,
        name: record.name,
        reason: 'exact-host entity is not already a roaster; manual review required',
        entityIds: [entity.id],
        sources: record.sources,
      });
      continue;
    }
    const patch = {};
    for (const [sourceField, targetField] of [['descriptionRaw', 'description_raw'], ['shortDescription', 'short_description'], ['primaryLocation', 'primary_location'], ['contact', 'contact']]) {
      if (entity[targetField] == null && record[sourceField] != null) patch[targetField] = record[sourceField];
    }
    const existingLocations = locations.get(entity.id) || [];
    const addLocation = record.location && !existingLocations.some((location) => locationFingerprint(location) === locationFingerprint(record.location)) ? record.location : null;
    const missingProvenance = keys.some((key) => !provenanceHas(role?.role_metadata, key));
    actions.push({
      action: Object.keys(patch).length || addLocation || missingProvenance || !role ? 'enrich' : 'unchanged',
      entityId: entity.id,
      host: record.host,
      name: record.name,
      websiteUrl: record.websiteUrl,
      patch,
      location: addLocation,
      sources: record.sources,
      provenanceKeys: keys,
    });
  }

  const counts = actions.reduce((acc, action) => ({ ...acc, [action.action]: (acc[action.action] || 0) + 1 }), {});
  const affectedExistingIds = actions.filter((action) => action.action === 'enrich').map((action) => action.entityId);
  const plannedAtValue = options.plannedAt === undefined ? new Date() : new Date(options.plannedAt);
  if (!Number.isFinite(plannedAtValue.getTime())) throw new Error('plannedAt must be a valid timestamp');
  const result = {
    schemaVersion: 1,
    sourceName,
    authorizationNote,
    plannedAt: plannedAtValue.toISOString(),
    snapshotHash: snapshotFingerprint(snapshot),
    unaffectedSnapshotHash: snapshotFingerprint(snapshot, { excludeEntityIds: affectedExistingIds }),
    snapshotCounts: { entities: entities.length, roles: snapshot.roles?.length || 0, locations: snapshot.locations?.length || 0 },
    counts,
    actions,
  };
  return { ...result, planHash: planHash(result) };
}

module.exports = {
  allocateSlug,
  MAX_PLAN_AGE_MS,
  MAX_VALIDATION_AGE_MS,
  assertPlanFresh,
  buildPlan,
  canonicalHost,
  findCreateConflicts,
  locationFingerprint,
  matchRecord,
  isDirectParentOrSubdomain,
  normalizeRecord,
  parseCsv,
  parseExport,
  sourceKey,
  snapshotFingerprint,
  stableStringify,
  strictNameKey,
  validateName,
  verifyPlan,
};
