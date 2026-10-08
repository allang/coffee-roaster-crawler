const test = require('node:test');
const assert = require('node:assert/strict');
const {
  allocateSlug,
  assertPlanFresh,
  buildPlan,
  canonicalHost,
  isDirectParentOrSubdomain,
  findCreateConflicts,
  matchRecord,
  normalizeRecord,
  parseExport,
  snapshotFingerprint,
  strictNameKey,
  validateName,
  verifyPlan,
} = require('../src/directoryImport/core');
const { applyPlan, mergeProvenance } = require('../src/directoryImport/store');
const {
  actionCheckpointKey,
  fetchTargetState,
  runPostImportCrawl,
  selectEligibleTargets,
  targetsFromPlanCheckpoint,
  verifyTargetEntities,
} = require('../src/directoryImport/postImportCrawl');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('reads JSON, NDJSON, and quoted CSV exports', () => {
  assert.equal(parseExport('[{"name":"One"}]', 'json')[0].name, 'One');
  assert.deepEqual(parseExport('{"name":"One"}\n{"name":"Two"}\n', 'ndjson').map((row) => row.name), ['One', 'Two']);
  const csv = 'name,official_website,source_profile,description\r\n"Acme, Coffee",https://acme.test,https://directory.test/acme,"Line one, line two"\r\n';
  const [record] = parseExport(csv, 'csv');
  assert.equal(record.name, 'Acme, Coffee');
  assert.equal(record.description, 'Line one, line two');
});

test('canonical host is exact except for case, trailing dot, and www', () => {
  assert.equal(canonicalHost('HTTPS://WWW.Example.COM./shop'), 'example.com');
  assert.notEqual(canonicalHost('https://shop.example.com'), canonicalHost('https://example.com'));
  assert.equal(canonicalHost('not a url'), null);
});

test('strict name validation rejects placeholders, URLs, and punctuation-only names', () => {
  assert.equal(validateName('  Café Integral  '), 'Café Integral');
  for (const bad of ['N/A', 'https://coffee.test', '---', 'x']) assert.throws(() => validateName(bad));
});

test('normalization accepts nested contact and location fields', () => {
  const record = normalizeRecord({
    name: 'Acme Coffee', official_website: 'https://www.acme.test/', source_profile: 'https://directory.test/acme',
    contact: { email: ' hello@acme.test ' }, location: { city: 'Portland', region: 'OR', country: 'US' },
  });
  assert.equal(record.host, 'acme.test');
  assert.equal(record.contact.email, 'hello@acme.test');
  assert.equal(record.primaryLocation, 'Portland, OR, US');
  const noContact = normalizeRecord({
    name: 'Empty Contact Coffee', official_website: 'https://empty-contact.test/', source_profile: 'https://directory.test/empty-contact',
    contact: { email: null, phone: null, socials: [] },
  });
  assert.equal(noContact.contact, null);
});

test('matching uses only an exact canonical host, never a fuzzy name', () => {
  const entities = [{ id: '1', name: 'Acme Coffee', website_url: 'https://acme.test' }];
  assert.equal(matchRecord({ host: 'acme.test' }, entities).kind, 'match');
  assert.equal(matchRecord({ host: 'shop.acme.test', name: 'Acme Coffee' }, entities).kind, 'create');
  assert.equal(matchRecord({ host: 'other.test', name: 'Acme Coffee' }, entities).kind, 'create');
  assert.equal(matchRecord({ host: 'acme.test' }, [...entities, { id: '2', website_url: 'https://www.acme.test/about' }]).kind, 'ambiguous');
});

test('slug allocation is unique and deterministic across collisions', () => {
  const used = new Set(['acme-coffee', 'acme-coffee-2']);
  assert.equal(allocateSlug('Acme Coffee', used), 'acme-coffee-3');
  assert.equal(allocateSlug('Acme Coffee', used), 'acme-coffee-4');
});

test('plan snapshots all entities, enriches nulls, and never overwrites populated data', () => {
  const records = [{
    name: 'Acme Coffee', official_website: 'https://www.acme.test', source_profile: 'https://directory.test/acme',
    description: 'Imported raw description', short_description: 'Imported summary', city: 'Portland', country: 'US',
  }];
  const snapshot = {
    entities: [{ id: 'entity-1', name: 'Existing Name', slug: 'existing', name_slug: 'existing', website_url: 'https://acme.test', description_raw: 'Keep me', short_description: null, primary_location: null, contact: null }],
    roles: [{ entity_id: 'entity-1', role: 'roaster', role_metadata: null }], locations: [],
  };
  const plan = buildPlan(records, snapshot, { sourceName: 'Authorized Test', authorizationNote: 'Fixture permission' });
  assert.equal(plan.snapshotCounts.entities, 1);
  assert.equal(plan.actions[0].action, 'enrich');
  assert.equal(plan.actions[0].patch.description_raw, undefined);
  assert.equal(plan.actions[0].patch.short_description, 'Imported summary');
  assert.equal(plan.actions[0].location.city, 'Portland');
});

test('plan allocates around both slug and name_slug collisions', () => {
  const record = [{ name: 'Acme', official_website: 'https://new.test', source_profile: 'https://directory.test/new' }];
  const snapshot = { entities: [{ id: '1', slug: 'different', name_slug: 'acme', website_url: 'https://old.test' }], roles: [], locations: [] };
  const plan = buildPlan(record, snapshot, { sourceName: 'Authorized Test', authorizationNote: 'Fixture permission' });
  assert.equal(plan.actions[0].slug, 'acme-2');
  assert.equal(plan.actions[0].nameSlug, 'acme-2');
});

test('exact-host cafe-only and roleless entities require manual review', () => {
  const records = [{ name: 'Acme', official_website: 'https://acme.test', source_profile: 'https://directory.test/acme' }];
  const entity = { id: 'entity-1', slug: 'acme', name_slug: 'acme', website_url: 'https://acme.test' };
  for (const roles of [[], [{ entity_id: 'entity-1', role: 'cafe', role_metadata: null }]]) {
    const plan = buildPlan(records, { entities: [entity], roles, locations: [] }, { sourceName: 'Authorized Test', authorizationNote: 'Fixture permission' });
    assert.equal(plan.actions[0].action, 'conflict');
    assert.match(plan.actions[0].reason, /not already a roaster/);
  }
});

test('reviewed plan hash detects edits before apply', () => {
  const plan = buildPlan(
    [{ name: 'Acme', official_website: 'https://acme.test', source_profile: 'https://directory.test/acme' }],
    { entities: [], roles: [], locations: [] },
    { sourceName: 'Authorized Test', authorizationNote: 'Fixture permission' },
  );
  assert.equal(verifyPlan(plan), true);
  plan.actions[0].name = 'Tampered';
  assert.throws(() => verifyPlan(plan), /hash mismatch/);
});

test('plannedAt is hashed and apply review expires after 24 hours', () => {
  const plan = buildPlan(
    [{ name: 'Acme', official_website: 'https://acme.test', source_profile: 'https://directory.test/acme' }],
    { entities: [], roles: [], locations: [] },
    { sourceName: 'Authorized Test', authorizationNote: 'Fixture permission', plannedAt: '2026-08-10T10:00:00.000Z' },
  );
  assert.equal(verifyPlan(plan, { now: new Date('2026-08-11T09:59:59.000Z') }), true);
  assert.throws(() => verifyPlan(plan, { now: new Date('2026-08-11T10:00:01.000Z') }), /plan is stale/);
  plan.plannedAt = '2026-08-10T11:00:00.000Z';
  assert.throws(() => verifyPlan(plan, { now: new Date('2026-08-10T12:00:00.000Z') }), /hash mismatch/);
});

test('apply verification never outlives the embedded seven-day site validation', () => {
  const record = {
    name: 'Acme',
    official_website: 'https://acme.test',
    source_profile: 'https://directory.test/acme',
    validation_acceptance: { checkedAt: '2026-08-03T09:59:59.000Z' },
  };
  const stale = buildPlan([record], { entities: [], roles: [], locations: [] }, {
    sourceName: 'Authorized Test', authorizationNote: 'Fixture permission', plannedAt: '2026-08-10T10:00:00.000Z',
  });
  assert.throws(() => verifyPlan(stale, { now: new Date('2026-08-10T10:00:00.000Z'), requireAcceptanceFreshness: true }), /Site validation.*stale/);
  const fresh = buildPlan([{ ...record, validation_acceptance: { checkedAt: '2026-08-03T10:00:01.000Z' } }], { entities: [], roles: [], locations: [] }, {
    sourceName: 'Authorized Test', authorizationNote: 'Fixture permission', plannedAt: '2026-08-10T10:00:00.000Z',
  });
  assert.equal(verifyPlan(fresh, { now: new Date('2026-08-10T10:00:00.000Z'), requireAcceptanceFreshness: true }), true);
});

test('strict Unicode name keys normalize compatibility forms, ampersands, and punctuation', () => {
  assert.equal(strictNameKey('  Ｃａｆé & Co.  '), 'café and co');
  assert.equal(strictNameKey('CAFÉ AND CO'), 'café and co');
  assert.equal(isDirectParentOrSubdomain('shop.example.com', 'example.com'), true);
  assert.equal(isDirectParentOrSubdomain('deep.shop.example.com', 'example.com'), false);
  assert.equal(isDirectParentOrSubdomain('example.net', 'example.com'), false);
});

test('same strict name on another host is always a manual-review conflict', () => {
  const records = [{ name: 'Ｃａｆé & Co.', official_website: 'https://new.test', source_profile: 'https://directory.test/new' }];
  const snapshot = { entities: [{ id: '1', name: 'CAFÉ AND CO', slug: 'cafe', name_slug: 'cafe', website_url: 'https://old.test' }], roles: [{ entity_id: '1', role: 'roaster' }], locations: [] };
  const plan = buildPlan(records, snapshot, { sourceName: 'Authorized Test', authorizationNote: 'Fixture permission' });
  assert.equal(plan.actions[0].action, 'conflict');
  assert.match(plan.actions[0].reason, /normalized name/);
});

test('same strict name on a direct subdomain gets the parent-subdomain conflict', () => {
  const records = [{ name: 'Acme Coffee', official_website: 'https://shop.acme.test', source_profile: 'https://directory.test/acme' }];
  const snapshot = { entities: [{ id: '1', name: 'Acme Coffee', slug: 'acme', name_slug: 'acme', website_url: 'https://acme.test' }], roles: [{ entity_id: '1', role: 'roaster' }], locations: [] };
  const plan = buildPlan(records, snapshot, { sourceName: 'Authorized Test', authorizationNote: 'Fixture permission' });
  assert.equal(plan.actions[0].action, 'conflict');
  assert.match(plan.actions[0].reason, /parent\/subdomain/);
});

test('same strict name on different incoming hosts requires manual review', () => {
  const records = [
    { name: 'Acme Coffee', official_website: 'https://acme.test', source_profile: 'https://directory.test/acme-1' },
    { name: 'Acme Coffee', official_website: 'https://shop.acme.test', source_profile: 'https://directory.test/acme-2' },
  ];
  const plan = buildPlan(records, { entities: [], roles: [], locations: [] }, { sourceName: 'Authorized Test', authorizationNote: 'Fixture permission' });
  assert.equal(plan.counts.conflict, 2);
  assert.deepEqual(plan.actions.map((action) => action.conflictingHosts), [['shop.acme.test'], ['acme.test']]);
  assert.ok(plan.actions.every((action) => /another input/.test(action.reason)));
});

test('licensed source metadata survives normalization, planning, and provenance merge', () => {
  const sourceMetadata = { dataset: 'places', license: 'CDLA Permissive 2.0', properties: ['name', 'website'] };
  const validationAcceptance = { schemaVersion: 1, hash: 'a'.repeat(64) };
  const normalized = normalizeRecord({
    name: 'Acme Coffee', official_website: 'https://acme.test', source_profile: 'https://source.test/record/1',
    source_record_id: 'record-1', source_metadata: sourceMetadata, validation_acceptance: validationAcceptance,
  });
  assert.deepEqual(normalized.sourceMetadata, sourceMetadata);
  const plan = buildPlan([{ name: 'Acme Coffee', official_website: 'https://acme.test', source_profile: 'https://source.test/record/1', source_record_id: 'record-1', source_metadata: sourceMetadata, validation_acceptance: validationAcceptance }],
    { entities: [], roles: [], locations: [] }, { sourceName: 'Licensed Source', authorizationNote: 'Open-data license' });
  assert.deepEqual(plan.actions[0].sources[0].metadata, sourceMetadata);
  const metadata = mergeProvenance(null, plan, plan.actions[0]);
  const [entry] = Object.values(metadata.provenance.authorized_exports);
  assert.deepEqual(entry.source_metadata, sourceMetadata);
  assert.deepEqual(entry.site_validation, validationAcceptance);
});

test('snapshot fingerprint is deterministic and reviewed plans reject any database drift', () => {
  const snapshot = {
    entities: [{ id: '2', name: 'Two' }, { id: '1', name: 'One' }],
    roles: [{ entity_id: '1', role: 'roaster', role_metadata: {} }],
    locations: [],
  };
  assert.equal(snapshotFingerprint(snapshot), snapshotFingerprint({ ...snapshot, entities: [...snapshot.entities].reverse() }));
  const plan = buildPlan(
    [{ name: 'Acme Coffee', official_website: 'https://acme.test', source_profile: 'https://source.test/acme' }],
    snapshot,
    { sourceName: 'Authorized Test', authorizationNote: 'Fixture permission' },
  );
  assert.equal(assertPlanFresh(plan, snapshot), true);
  assert.throws(() => assertPlanFresh(plan, { ...snapshot, roles: [...snapshot.roles, { entity_id: '2', role: 'cafe' }] }), /full entity\/role\/location snapshot changed/);
});

test('create preflight detects exact-host, strict-name, and parent-subdomain conflicts', () => {
  const action = { action: 'create', host: 'shop.acme.test', name: 'Acme Coffee', slug: 'acme-coffee' };
  assert.deepEqual(findCreateConflicts(action, [{ id: 'host', name: 'Different', website_url: 'https://shop.acme.test/about' }]).map((item) => item.kind), ['exact_host']);
  assert.deepEqual(findCreateConflicts(action, [{ id: 'name', name: 'Acme Coffee', website_url: 'https://other.test' }]).map((item) => item.kind), ['strict_name']);
  assert.deepEqual(findCreateConflicts({ ...action, name: 'Different' }, [{ id: 'parent', name: 'Parent Brand', website_url: 'https://acme.test' }]).map((item) => item.kind), ['parent_or_subdomain']);
});

test('apply loads a fresh full snapshot and refuses a stale reviewed plan before writes', async () => {
  const reviewed = { entities: [], roles: [], locations: [] };
  const plan = buildPlan(
    [{ name: 'Acme Coffee', official_website: 'https://acme.test', source_profile: 'https://source.test/acme' }],
    reviewed,
    { sourceName: 'Authorized Test', authorizationNote: 'Fixture permission' },
  );
  const tables = {
    entities: [{ id: 'new', name: 'Unrelated', slug: 'unrelated', name_slug: 'unrelated', website_url: 'https://unrelated.test', description_raw: null, short_description: null, primary_location: null, contact: null }],
    entity_roles: [],
    entity_locations: [],
  };
  let mutationAttempted = false;
  const db = {
    from(table) {
      const query = {
        select() { return query; },
        order() { return query; },
        range() { return Promise.resolve({ data: tables[table], error: null }); },
        insert() { mutationAttempted = true; throw new Error('must not write'); },
        update() { mutationAttempted = true; throw new Error('must not write'); },
      };
      return query;
    },
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coffee-import-preflight-'));
  try {
    await assert.rejects(applyPlan(db, plan, path.join(directory, 'checkpoint.json')), /snapshot changed/);
    assert.equal(mutationAttempted, false);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('resume still refuses unrelated database drift after a checkpointed preflight', async () => {
  const reviewed = { entities: [], roles: [], locations: [] };
  const plan = buildPlan(
    [{ name: 'Acme Coffee', official_website: 'https://acme.test', source_profile: 'https://source.test/acme' }],
    reviewed,
    { sourceName: 'Authorized Test', authorizationNote: 'Fixture permission' },
  );
  const tables = {
    entities: [{ id: 'external', name: 'External Coffee', slug: 'external-coffee', name_slug: 'external-coffee', website_url: 'https://external.test', description_raw: null, short_description: null, primary_location: null, contact: null }],
    entity_roles: [],
    entity_locations: [],
  };
  const db = {
    from(table) {
      const query = {
        select() { return query; },
        order() { return query; },
        range() { return Promise.resolve({ data: tables[table], error: null }); },
      };
      return query;
    },
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coffee-import-resume-preflight-'));
  const checkpoint = path.join(directory, 'checkpoint.json');
  fs.writeFileSync(checkpoint, JSON.stringify({
    schemaVersion: 1,
    planHash: plan.planHash,
    entries: {},
    preflight: { planSnapshotHash: plan.snapshotHash, checkedSnapshotHash: plan.snapshotHash, passedAt: '2026-08-10T12:00:00.000Z' },
  }));
  try {
    await assert.rejects(applyPlan(db, plan, checkpoint), /snapshot changed/);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('resume excludes its checkpointed creates while hashing unaffected database state', async () => {
  const reviewed = { entities: [], roles: [], locations: [] };
  const plan = buildPlan(
    [{ name: 'Acme Coffee', official_website: 'https://acme.test', source_profile: 'https://source.test/acme' }],
    reviewed,
    { sourceName: 'Authorized Test', authorizationNote: 'Fixture permission' },
  );
  const action = plan.actions[0];
  const tables = {
    entities: [{ id: 'created', name: action.name, slug: action.slug, name_slug: action.nameSlug, website_url: action.websiteUrl, description_raw: null, short_description: null, primary_location: null, contact: null }],
    entity_roles: [{ entity_id: 'created', role: 'roaster', role_metadata: {} }],
    entity_locations: [],
  };
  const db = {
    from(table) {
      const query = {
        select() { return query; },
        order() { return query; },
        range() { return Promise.resolve({ data: tables[table], error: null }); },
      };
      return query;
    },
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coffee-import-own-resume-'));
  const checkpoint = path.join(directory, 'checkpoint.json');
  fs.writeFileSync(checkpoint, JSON.stringify({
    schemaVersion: 1,
    planHash: plan.planHash,
    entries: { [`${action.host}:create`]: { entityId: 'created', status: 'complete', steps: { entity: true, enrichment: true, role: true, location: true } } },
    preflight: { planSnapshotHash: plan.snapshotHash, checkedSnapshotHash: plan.snapshotHash, passedAt: '2026-08-10T12:00:00.000Z' },
  }));
  try {
    const result = await applyPlan(db, plan, checkpoint);
    assert.equal(result.entries[`${action.host}:create`].status, 'complete');
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

function completedImportFixture() {
  const snapshot = {
    entities: [{ id: 'existing', name: 'Existing Coffee', slug: 'existing-coffee', name_slug: 'existing-coffee', website_url: 'https://existing.test', description_raw: null, short_description: null, primary_location: null, contact: null }],
    roles: [{ entity_id: 'existing', role: 'roaster', role_metadata: {} }],
    locations: [],
  };
  const plan = buildPlan([
    { name: 'New Coffee', official_website: 'https://new.test', source_profile: 'https://source.test/new' },
    { name: 'Existing Coffee', official_website: 'https://existing.test', source_profile: 'https://source.test/existing' },
  ], snapshot, { sourceName: 'Authorized Test', authorizationNote: 'Fixture permission' });
  const entries = {};
  for (const action of plan.actions.filter((item) => ['create', 'enrich'].includes(item.action))) {
    entries[actionCheckpointKey(action)] = {
      status: 'complete',
      entityId: action.action === 'create' ? 'created-id' : action.entityId,
      steps: { entity: true, enrichment: true, role: true, location: true },
    };
  }
  const checkpoint = {
    schemaVersion: 1,
    planHash: plan.planHash,
    preflight: { planSnapshotHash: plan.snapshotHash },
    completed: Object.keys(entries).length,
    entries,
  };
  return { plan, checkpoint };
}

test('post-import targets come only from completed create actions in a successful checkpoint', () => {
  const { plan, checkpoint } = completedImportFixture();
  const targets = targetsFromPlanCheckpoint(plan, checkpoint);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].entityId, 'created-id');
  assert.equal(targets[0].host, 'new.test');
  const incomplete = structuredClone(checkpoint);
  const enrich = plan.actions.find((action) => action.action === 'enrich');
  incomplete.entries[actionCheckpointKey(enrich)].status = 'failed';
  assert.throws(() => targetsFromPlanCheckpoint(plan, incomplete), /incomplete/);
  const unfinished = structuredClone(checkpoint);
  unfinished.completed -= 1;
  assert.throws(() => targetsFromPlanCheckpoint(plan, unfinished), /not a successful completed apply/);
});

test('post-import entity verification binds checkpoint IDs to reviewed name, slug, and host', () => {
  const { plan, checkpoint } = completedImportFixture();
  const targets = targetsFromPlanCheckpoint(plan, checkpoint);
  const action = plan.actions.find((item) => item.action === 'create');
  const [verified] = verifyTargetEntities(targets, [{
    id: 'created-id', name: action.name, slug: action.slug, name_slug: action.nameSlug, website_url: action.websiteUrl,
  }]);
  assert.equal(verified.entity.id, 'created-id');
  assert.throws(() => verifyTargetEntities(targets, [{
    id: 'created-id', name: action.name, slug: action.slug, website_url: 'https://different.test',
  }]), /no longer matches reviewed create action/);
  assert.throws(() => verifyTargetEntities(targets, []), /is missing/);
});

test('post-import selection requires roaster role, honors allow_crawl, and skips running or recent completed runs', () => {
  const makeTarget = (id) => ({ entityId: id, name: `Coffee ${id}`, host: `${id}.test`, entity: { id, name: `Coffee ${id}`, website_url: `https://${id}.test` } });
  const targets = ['eligible', 'missing-role', 'disabled', 'running', 'recent', 'old', 'done', 'failed', 'unknown-time']
    .map(makeTarget);
  const roles = targets.filter((target) => target.entityId !== 'missing-role').map((target) => ({ entity_id: target.entityId, role: 'roaster' }));
  const state = {
    roles,
    crawlStates: [{ entity_id: 'disabled', allow_crawl: false }],
    crawlRuns: [
      { entity_id: 'running', status: 'running', started_at: '2026-08-01T00:00:00.000Z' },
      { entity_id: 'recent', status: 'completed', finished_at: '2026-08-10T11:00:00.000Z' },
      { entity_id: 'old', status: 'completed', finished_at: '2026-08-08T11:00:00.000Z' },
      { entity_id: 'unknown-time', status: 'completed', finished_at: null },
    ],
  };
  const runnerCheckpoint = { results: { done: { status: 'complete' }, failed: { status: 'failed' } } };
  const selection = selectEligibleTargets(targets, state, { now: new Date('2026-08-10T12:00:00.000Z'), runnerCheckpoint });
  assert.deepEqual(selection.eligible.map((target) => target.entityId), ['eligible', 'old']);
  assert.deepEqual(Object.fromEntries(selection.skipped.map((target) => [target.entityId, target.reason])), {
    'missing-role': 'missing_roaster_role',
    disabled: 'crawl_disabled',
    running: 'running_crawl_exists',
    recent: 'recent_completed_crawl',
    done: 'runner_checkpoint_complete',
    failed: 'runner_checkpoint_failed_requires_retry_flag',
    'unknown-time': 'recent_completed_crawl',
  });
  const retry = selectEligibleTargets(targets, state, { now: new Date('2026-08-10T12:00:00.000Z'), runnerCheckpoint, retryFailed: true });
  assert.deepEqual(retry.eligible.map((target) => target.entityId), ['eligible', 'old', 'failed']);
});

test('post-import state treats the optional missing crawl-state table as no overrides', async () => {
  const rows = {
    entities: [{ id: 'created-id', name: 'New Coffee', slug: 'new-coffee', name_slug: 'new-coffee', website_url: 'https://new.test' }],
    entity_roles: [{ entity_id: 'created-id', role: 'roaster' }],
    crawl_runs: [],
  };
  const db = {
    from(table) {
      const result = table === 'entity_crawl_state'
        ? { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.entity_crawl_state' in the schema cache" } }
        : { data: rows[table], error: null };
      const query = {
        select() { return query; },
        in() { return query; },
        eq() { return query; },
        then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
      };
      return query;
    },
  };
  const state = await fetchTargetState(db, [{ entityId: 'created-id' }]);
  assert.deepEqual(state.crawlStates, []);
  assert.equal(state.entities.length, 1);
  assert.equal(state.roles.length, 1);
});

test('post-import runner initializes once, crawls only the verified create, and is checkpoint-idempotent', async () => {
  const { plan, checkpoint } = completedImportFixture();
  const create = plan.actions.find((action) => action.action === 'create');
  const tables = {
    entities: [{ id: 'created-id', name: create.name, slug: create.slug, name_slug: create.nameSlug, website_url: create.websiteUrl }],
    entity_roles: [{ entity_id: 'created-id', role: 'roaster' }],
    entity_crawl_state: [],
    crawl_runs: [],
  };
  const db = {
    from(table) {
      const query = {
        select() { return query; },
        in() { return query; },
        eq() { return query; },
        then(resolve, reject) { return Promise.resolve({ data: tables[table], error: null }).then(resolve, reject); },
      };
      return query;
    },
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coffee-post-import-runner-'));
  const runnerCheckpointFile = path.join(directory, 'runner.json');
  let proxyInitializations = 0;
  let blacklistLoads = 0;
  const crawled = [];
  try {
    const first = await runPostImportCrawl({
      db, plan, importCheckpoint: checkpoint, runnerCheckpointFile, run: true, concurrency: 2,
      initProxyPool: async () => { proxyInitializations += 1; return true; },
      getBlacklistTerms: async () => { blacklistLoads += 1; return ['gift-card']; },
      crawlRoaster: async (entity, terms) => { crawled.push([entity.id, terms]); return { success: true, visitResults: { coffeeFound: 3, visited: 5 } }; },
    });
    assert.equal(first.summary.completedCount, 1);
    assert.deepEqual(crawled, [['created-id', ['gift-card']]]);
    assert.equal(proxyInitializations, 1);
    assert.equal(blacklistLoads, 1);
    assert.equal(JSON.parse(fs.readFileSync(runnerCheckpointFile, 'utf8')).results['created-id'].status, 'complete');

    const second = await runPostImportCrawl({
      db, plan, importCheckpoint: checkpoint, runnerCheckpointFile, run: true, concurrency: 2,
      initProxyPool: async () => { throw new Error('must not initialize for a checkpointed target'); },
      getBlacklistTerms: async () => { throw new Error('must not load blacklist for a checkpointed target'); },
      crawlRoaster: async () => { throw new Error('must not crawl twice'); },
    });
    assert.equal(second.summary.eligibleCount, 0);
    assert.equal(second.summary.skipped[0].reason, 'runner_checkpoint_complete');
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});
