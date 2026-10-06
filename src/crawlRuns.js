const { getSupabase } = require('./supabase');
const logger = require('./logger');
const { createCooldown, createOwnerProbe } = require('./crawlRunCooldown');

const cooldown = createCooldown({
  probe: createOwnerProbe({ getConfig: () => require('./config').config.supabase }),
  onEvent: event => logger.warn('CrawlRunCooldown', event.kind, event),
});
const waitForCrawlAdmission = () => cooldown.waitForAdmission();

async function createCrawlRun(entityId, platform = 'unknown') {
  await waitForCrawlAdmission();
  const supabase = getSupabase();

  let response;
  try {
    response = await supabase
    .from('crawl_runs')
    .insert({
      entity_id: entityId,
      status: 'running',
      started_at: new Date().toISOString(),
      platform: platform,
    })
    .select()
    .single();
  } catch (error) {
    cooldown.recordCreateFailure(entityId, error);
    throw error; // Never replay a POST whose commit outcome may be unknown.
  }
  const { data, error, status } = response;

  if (error) {
    cooldown.recordCreateFailure(entityId, error, status);
    logger.error('CrawlRuns', 'Failed to create crawl run', { error: error.message });
    throw error;
  }

  logger.info('CrawlRuns', `Created crawl run: ${data.id}`);
  return data;
}

async function completeCrawlRun(crawlRunId, stats) {
  const supabase = getSupabase();

  const { error } = await supabase
    .from('crawl_runs')
    .update({
      status: 'completed',
      finished_at: new Date().toISOString(),
      pages_discovered: stats.pagesDiscovered || 0,
      pages_visited: stats.pagesVisited || 0,
      pages_sent_to_gpt: stats.pagesSentToGpt || 0,
      coffees_found: stats.coffeesFound || 0,
    })
    .eq('id', crawlRunId);

  if (error) {
    logger.error('CrawlRuns', 'Failed to complete crawl run', { error: error.message });
    throw error;
  }

  logger.success('CrawlRuns', `Completed crawl run: ${crawlRunId}`);
  return { id: crawlRunId };
}

async function failCrawlRun(crawlRunId, errorMessage) {
  const supabase = getSupabase();

  const { error } = await supabase
    .from('crawl_runs')
    .update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      error: errorMessage,
    })
    .eq('id', crawlRunId);

  if (error) {
    logger.error('CrawlRuns', 'Failed to mark crawl run as failed', { error: error.message });
    throw error;
  }

  logger.warn('CrawlRuns', `Marked crawl run as failed: ${crawlRunId}`);
  return { id: crawlRunId };
}

async function getRecentCrawlRuns(entityIds) {
  const supabase = getSupabase();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const BATCH_SIZE = 50;
  const allResults = [];

  for (let i = 0; i < entityIds.length; i += BATCH_SIZE) {
    const batch = entityIds.slice(i, i + BATCH_SIZE);
    
    const { data, error } = await supabase
      .from('crawl_runs')
      .select('entity_id, status, finished_at')
      .in('entity_id', batch)
      .in('status', ['completed', 'running'])
      .gte('created_at', cutoff);

    if (error) {
      logger.error('CrawlRuns', 'Failed to fetch recent crawl runs', { error: error.message });
      throw error;
    }

    if (data) {
      allResults.push(...data);
    }
  }

  return allResults;
}

module.exports = {
  waitForCrawlAdmission,
  createCrawlRun,
  completeCrawlRun,
  failCrawlRun,
  getRecentCrawlRuns,
};
