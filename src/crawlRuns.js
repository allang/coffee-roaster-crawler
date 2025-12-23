const { getSupabase } = require('./supabase');
const logger = require('./logger');

async function createCrawlRun(entityId, platform = 'unknown') {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('crawl_runs')
    .insert({
      entity_id: entityId,
      status: 'running',
      started_at: new Date().toISOString(),
      platform: platform,
    })
    .select()
    .single();

  if (error) {
    logger.error('CrawlRuns', 'Failed to create crawl run', { error: error.message });
    throw error;
  }

  logger.info('CrawlRuns', `Created crawl run: ${data.id}`);
  return data;
}

async function completeCrawlRun(crawlRunId, stats) {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('crawl_runs')
    .update({
      status: 'completed',
      finished_at: new Date().toISOString(),
      pages_discovered: stats.pagesDiscovered || 0,
      pages_visited: stats.pagesVisited || 0,
      pages_sent_to_gpt: stats.pagesSentToGpt || 0,
      coffees_found: stats.coffeesFound || 0,
    })
    .eq('id', crawlRunId)
    .select()
    .single();

  if (error) {
    logger.error('CrawlRuns', 'Failed to complete crawl run', { error: error.message });
    throw error;
  }

  logger.success('CrawlRuns', `Completed crawl run: ${crawlRunId}`);
  return data;
}

async function failCrawlRun(crawlRunId, errorMessage) {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('crawl_runs')
    .update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      error: errorMessage,
    })
    .eq('id', crawlRunId)
    .select()
    .single();

  if (error) {
    logger.error('CrawlRuns', 'Failed to mark crawl run as failed', { error: error.message });
    throw error;
  }

  logger.warn('CrawlRuns', `Marked crawl run as failed: ${crawlRunId}`);
  return data;
}

async function getRecentCrawlRuns(entityIds) {
  const supabase = getSupabase();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('crawl_runs')
    .select('entity_id, status, finished_at')
    .in('entity_id', entityIds)
    .in('status', ['completed', 'running'])
    .gte('created_at', cutoff);

  if (error) {
    logger.error('CrawlRuns', 'Failed to fetch recent crawl runs', { error: error.message });
    throw error;
  }

  return data || [];
}

module.exports = {
  createCrawlRun,
  completeCrawlRun,
  failCrawlRun,
  getRecentCrawlRuns,
};
