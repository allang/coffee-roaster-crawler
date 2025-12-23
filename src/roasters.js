const { getSupabase } = require('./supabase');
const { getRecentCrawlRuns } = require('./crawlRuns');
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

async function filterRoastersForCrawling(roasters) {
  logger.header('Filtering Roasters (24h Cooldown)');
  
  if (roasters.length === 0) {
    return [];
  }

  const supabase = getSupabase();
  const roasterIds = roasters.map(r => r.id);

  const { data: crawlStates } = await supabase
    .from('entity_crawl_state')
    .select('entity_id, allow_crawl')
    .in('entity_id', roasterIds);

  const disabledEntityIds = new Set(
    (crawlStates || [])
      .filter(s => s.allow_crawl === false)
      .map(s => s.entity_id)
  );

  const recentRuns = await getRecentCrawlRuns(roasterIds);
  const recentlyRunEntityIds = new Set(recentRuns.map(r => r.entity_id));

  logger.info('Filter', `Found ${recentRuns.length} crawl runs in last 24h`);
  if (disabledEntityIds.size > 0) {
    logger.info('Filter', `${disabledEntityIds.size} roasters have crawling disabled`);
  }

  const eligible = roasters.filter(roaster => {
    if (disabledEntityIds.has(roaster.id)) {
      return false;
    }
    return !recentlyRunEntityIds.has(roaster.id);
  });

  logger.success('Filter', `${eligible.length}/${roasters.length} roasters eligible for crawling`);

  return eligible;
}

module.exports = {
  getRoasterEntities,
  filterRoastersForCrawling,
};
