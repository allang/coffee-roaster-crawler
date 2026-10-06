const fs = require('node:fs');
const path = require('node:path');
const { assertPlanFresh, canonicalHost, locationFingerprint, sourceKey, stableStringify } = require('./core');

async function fetchAll(db, table, select, pageSize = 1000, orderColumns = ['id']) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    let query = db.from(table).select(select);
    for (const column of orderColumns) query = query.order(column, { ascending: true });
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw new Error(`Unable to snapshot ${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

async function loadSnapshot(db, pageSize = 1000) {
  // Do not narrow this to roasters: a cafe or other entity may own the same official host.
  const entities = await fetchAll(db, 'entities', 'id,name,slug,name_slug,website_url,description_raw,short_description,primary_location,contact', pageSize);
  const roles = await fetchAll(db, 'entity_roles', 'entity_id,role,role_metadata', pageSize, ['entity_id', 'role']);
  const locations = await fetchAll(db, 'entity_locations', 'id,entity_id,label,address1,address2,city,region,postal_code,country,lat,lng,is_primary', pageSize);
  return { entities, roles, locations };
}

function readCheckpoint(file, planHash) {
  if (!fs.existsSync(file)) return { schemaVersion: 1, planHash, entries: {} };
  const checkpoint = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (checkpoint.planHash !== planHash) throw new Error('Checkpoint belongs to a different import plan');
  return checkpoint;
}

function writePrivateJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

function mergeProvenance(metadata, plan, action) {
  const current = metadata && typeof metadata === 'object' ? metadata : {};
  const provenance = current.provenance && typeof current.provenance === 'object' ? current.provenance : {};
  const authorized = provenance.authorized_exports && typeof provenance.authorized_exports === 'object' ? provenance.authorized_exports : {};
  const next = { ...authorized };
  action.sources.forEach((source) => {
    const key = sourceKey(plan.sourceName, source.profile, source.recordId);
    if (!next[key]) {
      next[key] = {
        source_name: plan.sourceName,
        source_profile: source.profile,
        ...(source.recordId ? { source_record_id: source.recordId } : {}),
        authorization_note: plan.authorizationNote,
        imported_at: new Date().toISOString(),
        ...(source.metadata ? { source_metadata: source.metadata } : {}),
        ...(source.validationAcceptance ? { site_validation: source.validationAcceptance } : {}),
      };
    } else {
      let existing = next[key];
      if (source.metadata && existing.source_metadata == null) existing = { ...existing, source_metadata: source.metadata };
      if (source.validationAcceptance && existing.site_validation == null) existing = { ...existing, site_validation: source.validationAcceptance };
      next[key] = existing;
    }
  });
  return { ...current, provenance: { ...provenance, authorized_exports: next } };
}

function entityInsert(action) {
  return {
    name: action.name,
    slug: action.slug,
    name_slug: action.nameSlug,
    website_url: action.websiteUrl,
    ...(action.descriptionRaw ? { description_raw: action.descriptionRaw } : {}),
    ...(action.shortDescription ? { short_description: action.shortDescription } : {}),
    ...(action.primaryLocation ? { primary_location: action.primaryLocation } : {}),
    ...(action.contact ? { contact: action.contact } : {}),
  };
}

async function resolveOrCreateEntity(db, action, entry) {
  if (entry.entityId) return entry.entityId;
  if (action.action !== 'create') return action.entityId;

  // This exact slug lookup closes the small crash window between insert and checkpoint.
  const existing = await db.from('entities').select('id,website_url').eq('slug', action.slug).maybeSingle();
  if (existing.error) throw new Error(`Unable to check slug ${action.slug}: ${existing.error.message}`);
  if (existing.data) {
    if (canonicalHost(existing.data.website_url) !== action.host) throw new Error(`Slug ${action.slug} was claimed by another host`);
    return existing.data.id;
  }
  const inserted = await db.from('entities').insert(entityInsert(action)).select('id').single();
  if (inserted.error) throw new Error(`Entity insert failed: ${inserted.error.message}`);
  return inserted.data.id;
}

async function applyEntityPatch(db, entityId, action) {
  if (action.action !== 'enrich' || !Object.keys(action.patch || {}).length) return;
  const fields = Object.keys(action.patch);
  const current = await db.from('entities').select(`id,${fields.join(',')}`).eq('id', entityId).single();
  if (current.error) throw new Error(`Entity refresh failed: ${current.error.message}`);
  const nullOnly = Object.fromEntries(fields.filter((field) => current.data[field] == null).map((field) => [field, action.patch[field]]));
  if (!Object.keys(nullOnly).length) return;
  const updated = await db.from('entities').update(nullOnly).eq('id', entityId);
  if (updated.error) throw new Error(`Entity enrichment failed: ${updated.error.message}`);
}

async function applyRole(db, entityId, plan, action) {
  const result = await db.from('entity_roles').select('role_metadata').eq('entity_id', entityId).eq('role', 'roaster').maybeSingle();
  if (result.error) throw new Error(`Role lookup failed: ${result.error.message}`);
  const roleMetadata = mergeProvenance(result.data?.role_metadata, plan, action);
  if (result.data && stableStringify(roleMetadata) === stableStringify(result.data.role_metadata || {})) return;
  const write = result.data
    ? await db.from('entity_roles').update({ role_metadata: roleMetadata }).eq('entity_id', entityId).eq('role', 'roaster')
    : await db.from('entity_roles').insert({ entity_id: entityId, role: 'roaster', role_metadata: roleMetadata });
  if (write.error) throw new Error(`Role provenance write failed: ${write.error.message}`);
}

async function applyLocation(db, entityId, location) {
  if (!location) return;
  const current = await db.from('entity_locations').select('address1,address2,city,region,postal_code,country,lat,lng,is_primary').eq('entity_id', entityId);
  if (current.error) throw new Error(`Location lookup failed: ${current.error.message}`);
  if (current.data.some((row) => locationFingerprint(row) === locationFingerprint(location))) return;
  const inserted = await db.from('entity_locations').insert({ entity_id: entityId, ...location, is_primary: !current.data.some((row) => row.is_primary) });
  if (inserted.error) throw new Error(`Location insert failed: ${inserted.error.message}`);
}

async function applyPlan(db, plan, checkpointFile) {
  const checkpoint = readCheckpoint(checkpointFile, plan.planHash);
  const freshSnapshot = await loadSnapshot(db);
  const resuming = checkpoint.preflight?.planSnapshotHash === plan.snapshotHash;
  const checkpointEntityIds = Object.values(checkpoint.entries || {}).map((entry) => entry.entityId).filter(Boolean);
  const recoveryEntityIds = resuming ? plan.actions.filter((action) => action.action === 'create').flatMap((action) =>
    freshSnapshot.entities.filter((entity) => entity.slug === action.slug && canonicalHost(entity.website_url) === action.host).map((entity) => entity.id)) : [];
  const affectedExistingIds = plan.actions.filter((action) => action.action === 'enrich').map((action) => action.entityId);
  const ownCreatedEntityIds = [...new Set([...checkpointEntityIds, ...recoveryEntityIds])];
  assertPlanFresh(plan, freshSnapshot, {
    ignoredEntityIds: ownCreatedEntityIds,
    allowPlannedSlugRecovery: resuming,
    useUnaffectedFingerprint: resuming,
    excludeEntityIds: resuming ? [...new Set([...affectedExistingIds, ...ownCreatedEntityIds])] : [],
  });
  if (!checkpoint.preflight) {
    checkpoint.preflight = {
      planSnapshotHash: plan.snapshotHash,
      checkedSnapshotHash: plan.snapshotHash,
      passedAt: new Date().toISOString(),
    };
    writePrivateJson(checkpointFile, checkpoint);
  }
  const actionable = plan.actions.filter((action) => ['create', 'enrich'].includes(action.action));
  for (let index = 0; index < actionable.length; index += 1) {
    const action = actionable[index];
    const key = `${action.host}:${action.action}`;
    const entry = checkpoint.entries[key] || { status: 'pending', steps: {} };
    if (entry.status === 'complete') continue;
    try {
      const entityId = await resolveOrCreateEntity(db, action, entry);
      entry.entityId = entityId;
      entry.steps.entity = true;
      checkpoint.entries[key] = entry;
      writePrivateJson(checkpointFile, checkpoint);
      if (!entry.steps.enrichment) {
        await applyEntityPatch(db, entityId, action);
        entry.steps.enrichment = true;
        writePrivateJson(checkpointFile, checkpoint);
      }
      if (!entry.steps.role) {
        await applyRole(db, entityId, plan, action);
        entry.steps.role = true;
        writePrivateJson(checkpointFile, checkpoint);
      }
      if (!entry.steps.location) {
        await applyLocation(db, entityId, action.location);
        entry.steps.location = true;
      }
      entry.status = 'complete';
      entry.error = null;
      checkpoint.completed = Object.values(checkpoint.entries).filter((item) => item.status === 'complete').length;
      writePrivateJson(checkpointFile, checkpoint);
    } catch (error) {
      entry.status = 'failed';
      entry.error = error.message;
      checkpoint.entries[key] = entry;
      writePrivateJson(checkpointFile, checkpoint);
      throw new Error(`Apply stopped at ${action.host}; rerun with the same checkpoint to resume: ${error.message}`);
    }
  }
  return checkpoint;
}

module.exports = { applyPlan, fetchAll, loadSnapshot, mergeProvenance, writePrivateJson };
