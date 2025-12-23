const { getSupabase } = require('./supabase');
const logger = require('./logger');

async function getRoasterEntities() {
  logger.header('Fetching Roaster Entities');
  const supabase = getSupabase();

  logger.info('Roasters', 'Querying entities with role=roaster');

  const { data: roasters, error } = await supabase
    .from('entities')
    .select(`
      id,
      name,
      website_url,
      entity_roles!inner (role)
    `)
    .eq('entity_roles.role', 'roaster');

  if (error) {
    logger.error('Roasters', 'Failed to fetch roasters', { error: error.message });
    throw error;
  }

  logger.success('Roasters', `Found ${roasters.length} roaster entities`);

  return roasters;
}

async function getRoastersWithCrawlState() {
  logger.header('Fetching Roasters with Crawl State');
  const supabase = getSupabase();

  logger.info('Roasters', 'Querying roasters joined with crawl state');

  const { data: roasters, error: roastersError } = await supabase
    .from('entities')
    .select(`
      id,
      name,
      website_url,
      entity_roles!inner (role)
    `)
    .eq('entity_roles.role', 'roaster');

  if (roastersError) {
    logger.error('Roasters', 'Failed to fetch roasters', { error: roastersError.message });
    throw roastersError;
  }

  if (roasters.length === 0) {
    logger.warn('Roasters', 'No roasters found in database');
    return [];
  }

  const roasterIds = roasters.map(r => r.id);
  
  const { data: crawlStates, error: stateError } = await supabase
    .from('entity_crawl_state')
    .select('*')
    .in('entity_id', roasterIds);

  if (stateError) {
    logger.error('Roasters', 'Failed to fetch crawl states', { error: stateError.message });
    throw stateError;
  }

  const stateMap = new Map(crawlStates?.map(s => [s.entity_id, s]) || []);

  const enrichedRoasters = roasters.map(roaster => ({
    ...roaster,
    crawlState: stateMap.get(roaster.id) || null,
  }));

  logger.success('Roasters', `Enriched ${enrichedRoasters.length} roasters with crawl state`);

  return enrichedRoasters;
}

async function filterRoastersForCrawling(roasters) {
  logger.header('Filtering Roasters (24h Cooldown)');
  
  const now = new Date();
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  logger.info('Filter', `Cutoff time: ${cutoff.toISOString()}`);

  const eligible = roasters.filter(roaster => {
    const state = roaster.crawlState;

    if (!state) {
      return true;
    }

    if (state.allow_crawl === false) {
      return false;
    }

    if (!state.last_crawled_at) {
      return true;
    }

    const lastCrawled = new Date(state.last_crawled_at);
    if (lastCrawled < cutoff) {
      return true;
    }

    return false;
  });

  logger.success('Filter', `${eligible.length}/${roasters.length} roasters eligible for crawling`);

  return eligible;
}

module.exports = {
  getRoasterEntities,
  getRoastersWithCrawlState,
  filterRoastersForCrawling,
};
