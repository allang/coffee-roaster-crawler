const fs = require('node:fs');
const path = require('node:path');
const { canonicalHost, verifyPlan } = require('./core');
const { writePrivateJson } = require('./store');

const DEFAULT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function actionCheckpointKey(action) {
  return `${action.host}:${action.action}`;
}

function targetsFromPlanCheckpoint(plan, checkpoint) {
  verifyPlan(plan);
  if ((plan.counts?.conflict || 0) > 0 || (plan.counts?.reject || 0) > 0) {
    throw new Error('Reviewed plan contains unresolved conflicts or rejected rows');
  }
  if (!checkpoint || checkpoint.planHash !== plan.planHash || !checkpoint.entries || typeof checkpoint.entries !== 'object') {
    throw new Error('Import checkpoint does not belong to the reviewed plan');
  }
  const actionable = plan.actions.filter((action) => ['create', 'enrich'].includes(action.action));
  if (checkpoint.preflight?.planSnapshotHash !== plan.snapshotHash || checkpoint.completed !== actionable.length) {
    throw new Error('Import checkpoint is not a successful completed apply for the reviewed plan');
  }
  for (const action of actionable) {
    const entry = checkpoint.entries[actionCheckpointKey(action)];
    if (!entry || entry.status !== 'complete' || !entry.entityId) {
      throw new Error(`Import checkpoint is not successful: ${actionCheckpointKey(action)} is incomplete`);
    }
  }
  const targets = plan.actions.filter((action) => action.action === 'create').map((action) => {
    const entry = checkpoint.entries[actionCheckpointKey(action)];
    return {
      entityId: entry.entityId,
      host: action.host,
      name: action.name,
      slug: action.slug,
      websiteUrl: action.websiteUrl,
      actionKey: actionCheckpointKey(action),
    };
  });
  const entityIds = targets.map((target) => target.entityId);
  if (new Set(entityIds).size !== entityIds.length) throw new Error('Import checkpoint maps multiple create actions to one entity ID');
  return targets;
}

function verifyTargetEntities(targets, entities) {
  const byId = new Map((entities || []).map((entity) => [entity.id, entity]));
  return targets.map((target) => {
    const entity = byId.get(target.entityId);
    if (!entity) throw new Error(`Imported entity ${target.entityId} is missing`);
    if (entity.slug !== target.slug || entity.name !== target.name || canonicalHost(entity.website_url) !== target.host) {
      throw new Error(`Imported entity ${target.entityId} no longer matches reviewed create action ${target.actionKey}`);
    }
    return { ...target, entity };
  });
}

function runTimestamp(run) {
  const value = run.status === 'completed'
    ? (run.finished_at || run.started_at || run.created_at)
    : (run.started_at || run.created_at);
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

function selectEligibleTargets(targets, state, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const retryFailed = options.retryFailed === true;
  const roleIds = new Set((state.roles || []).filter((row) => row.role === 'roaster').map((row) => row.entity_id));
  const disabledIds = new Set((state.crawlStates || []).filter((row) => row.allow_crawl === false).map((row) => row.entity_id));
  const runsByEntity = new Map();
  for (const run of state.crawlRuns || []) {
    if (!runsByEntity.has(run.entity_id)) runsByEntity.set(run.entity_id, []);
    runsByEntity.get(run.entity_id).push(run);
  }
  const runnerResults = options.runnerCheckpoint?.results || {};
  const eligible = [];
  const skipped = [];

  for (const target of targets) {
    const previous = runnerResults[target.entityId];
    if (previous?.status === 'complete') {
      skipped.push({ ...target, reason: 'runner_checkpoint_complete' });
      continue;
    }
    if (previous?.status === 'failed' && !retryFailed) {
      skipped.push({ ...target, reason: 'runner_checkpoint_failed_requires_retry_flag' });
      continue;
    }
    if (!roleIds.has(target.entityId)) {
      skipped.push({ ...target, reason: 'missing_roaster_role' });
      continue;
    }
    if (disabledIds.has(target.entityId)) {
      skipped.push({ ...target, reason: 'crawl_disabled' });
      continue;
    }
    const runs = runsByEntity.get(target.entityId) || [];
    if (runs.some((run) => run.status === 'running')) {
      skipped.push({ ...target, reason: 'running_crawl_exists' });
      continue;
    }
    const recentCompleted = runs.some((run) => {
      if (run.status !== 'completed') return false;
      const timestamp = runTimestamp(run);
      return timestamp === null || now.getTime() - timestamp <= cooldownMs;
    });
    if (recentCompleted) {
      skipped.push({ ...target, reason: 'recent_completed_crawl' });
      continue;
    }
    eligible.push(target);
  }
  return { eligible, skipped };
}

async function fetchTargetState(db, targets) {
  const ids = targets.map((target) => target.entityId);
  if (!ids.length) return { entities: [], roles: [], crawlStates: [], crawlRuns: [] };
  const queries = await Promise.all([
    db.from('entities').select('id,name,slug,name_slug,website_url').in('id', ids),
    db.from('entity_roles').select('entity_id,role').in('entity_id', ids).eq('role', 'roaster'),
    db.from('entity_crawl_state').select('entity_id,allow_crawl').in('entity_id', ids),
    db.from('crawl_runs').select('id,entity_id,status,created_at,started_at,finished_at').in('entity_id', ids).in('status', ['completed', 'running']),
  ]);
  const names = ['entities', 'entity_roles', 'entity_crawl_state', 'crawl_runs'];
  queries.forEach((result, index) => {
    const optionalCrawlStateMissing = index === 2 && result.error && (
      result.error.code === 'PGRST205' ||
      /could not find the table .*entity_crawl_state.*schema cache/i.test(result.error.message || '')
    );
    if (result.error && !optionalCrawlStateMissing) {
      throw new Error(`Unable to verify ${names[index]} for targeted crawl: ${result.error.message}`);
    }
  });
  return {
    entities: queries[0].data || [],
    roles: queries[1].data || [],
    // This table is optional in the production crawler; absence means no
    // per-entity crawl overrides are configured.
    crawlStates: queries[2].error ? [] : (queries[2].data || []),
    crawlRuns: queries[3].data || [],
  };
}

async function mapLimit(items, concurrency, worker) {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  });
  await Promise.all(workers);
}

function readRunnerCheckpoint(file, planHash) {
  if (!fs.existsSync(file)) return { schemaVersion: 1, planHash, results: {} };
  const checkpoint = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (checkpoint.schemaVersion !== 1 || checkpoint.planHash !== planHash || !checkpoint.results || typeof checkpoint.results !== 'object') {
    throw new Error('Post-import crawl checkpoint belongs to a different plan or is malformed');
  }
  return checkpoint;
}

async function runPostImportCrawl(options) {
  const { db, plan, importCheckpoint, runnerCheckpointFile, concurrency = 2, cooldownMs = DEFAULT_COOLDOWN_MS } = options;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Post-import crawl concurrency must be an integer from 1 to 4');
  const targets = targetsFromPlanCheckpoint(plan, importCheckpoint);
  const runnerCheckpoint = readRunnerCheckpoint(runnerCheckpointFile, plan.planHash);
  const state = await fetchTargetState(db, targets);
  const verifiedTargets = verifyTargetEntities(targets, state.entities);
  const selection = selectEligibleTargets(verifiedTargets, state, {
    runnerCheckpoint,
    retryFailed: options.retryFailed,
    cooldownMs,
    now: options.now,
  });
  const startedAt = new Date().toISOString();
  const summary = {
    schemaVersion: 1,
    planHash: plan.planHash,
    mode: options.run === true ? 'run' : 'preview',
    startedAt,
    targetCount: targets.length,
    eligibleCount: selection.eligible.length,
    eligible: selection.eligible.map((target) => ({ entityId: target.entityId, name: target.name, host: target.host })),
    skipped: selection.skipped.map((target) => ({ entityId: target.entityId, name: target.name, reason: target.reason })),
    results: [],
  };

  if (options.run !== true || !selection.eligible.length) {
    summary.finishedAt = new Date().toISOString();
    return { summary, runnerCheckpoint };
  }

  const initProxyPool = options.initProxyPool || require('../httpClient').initProxyPool;
  const getBlacklistTerms = options.getBlacklistTerms || require('../blacklist').getBlacklistTerms;
  const crawlRoaster = options.crawlRoaster || require('../crawler').crawlRoaster;
  summary.proxyPoolAvailable = await initProxyPool();
  const blacklistTerms = await getBlacklistTerms();
  summary.blacklistTermCount = blacklistTerms.length;

  await mapLimit(selection.eligible, concurrency, async (target) => {
    // Close the gap between the batch preview and the actual invocation. This
    // also catches another targeted runner starting one of these IDs.
    const latestState = await fetchTargetState(db, [target]);
    const [latestTarget] = verifyTargetEntities([target], latestState.entities);
    const latestSelection = selectEligibleTargets([latestTarget], latestState, {
      runnerCheckpoint,
      retryFailed: options.retryFailed,
      cooldownMs,
      now: options.now,
    });
    if (!latestSelection.eligible.length) {
      const reason = latestSelection.skipped[0]?.reason || 'no_longer_eligible';
      summary.skipped.push({ entityId: target.entityId, name: target.name, reason });
      return;
    }
    const attemptedAt = new Date().toISOString();
    try {
      // Minimize the check-to-crawl race with the regular scheduler by refreshing
      // this one entity immediately before handing it to the existing crawler.
      const freshState = await fetchTargetState(db, [target]);
      const [freshTarget] = verifyTargetEntities([target], freshState.entities);
      const freshSelection = selectEligibleTargets([freshTarget], freshState, {
        runnerCheckpoint,
        retryFailed: options.retryFailed,
        cooldownMs,
        now: options.now,
      });
      if (!freshSelection.eligible.length) {
        const reason = freshSelection.skipped[0]?.reason || 'no_longer_eligible';
        const entry = { status: 'skipped', attemptedAt, finishedAt: new Date().toISOString(), success: false, retryable: false, reason, error: null };
        runnerCheckpoint.results[target.entityId] = entry;
        summary.results.push({ entityId: target.entityId, name: target.name, ...entry });
        runnerCheckpoint.updatedAt = new Date().toISOString();
        writePrivateJson(runnerCheckpointFile, runnerCheckpoint);
        return;
      }
      const result = await crawlRoaster(freshTarget.entity, blacklistTerms);
      const status = result?.success ? 'complete' : 'failed';
      const entry = {
        status,
        attemptedAt,
        finishedAt: new Date().toISOString(),
        success: result?.success === true,
        retryable: result?.retryable === true,
        error: result?.error || null,
        coffeesFound: result?.visitResults?.coffeeFound || 0,
        pagesVisited: result?.visitResults?.visited || 0,
      };
      runnerCheckpoint.results[target.entityId] = entry;
      summary.results.push({ entityId: target.entityId, name: target.name, ...entry });
    } catch (error) {
      const entry = { status: 'failed', attemptedAt, finishedAt: new Date().toISOString(), success: false, retryable: false, error: String(error.message || error).slice(0, 1000) };
      runnerCheckpoint.results[target.entityId] = entry;
      summary.results.push({ entityId: target.entityId, name: target.name, ...entry });
    }
    runnerCheckpoint.updatedAt = new Date().toISOString();
    writePrivateJson(runnerCheckpointFile, runnerCheckpoint);
  });
  summary.finishedAt = new Date().toISOString();
  summary.results.sort((first, second) => String(first.entityId).localeCompare(String(second.entityId)));
  summary.completedCount = summary.results.filter((result) => result.status === 'complete').length;
  summary.failedCount = summary.results.filter((result) => result.status === 'failed').length;
  return { summary, runnerCheckpoint };
}

function defaultOutputPaths(importCheckpointFile) {
  const absolute = path.resolve(importCheckpointFile);
  return {
    runnerCheckpoint: `${absolute}.post-import-crawl.json`,
    summary: `${absolute}.post-import-crawl-summary.json`,
  };
}

module.exports = {
  DEFAULT_COOLDOWN_MS,
  actionCheckpointKey,
  defaultOutputPaths,
  fetchTargetState,
  mapLimit,
  readRunnerCheckpoint,
  runPostImportCrawl,
  runTimestamp,
  selectEligibleTargets,
  targetsFromPlanCheckpoint,
  verifyTargetEntities,
};
