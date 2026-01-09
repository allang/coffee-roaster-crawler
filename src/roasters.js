const { getSupabase } = require('./supabase');
const { getRecentCrawlRuns } = require('./crawlRuns');
const logger = require('./logger');

async function getRoasterEntities() {
  logger.header('Fetching Roaster Entities');
  const supabase = getSupabase();

  logger.info('Roasters', 'Querying entities with role=roaster');

  const allRoasters = [];
  const pageSize = 1000;
  let offset = 0;
  
  while (true) {
    const { data: roasters, error } = await supabase
      .from('entities')
      .select(`
        id,
        name,
        website_url,
        entity_roles!inner (role)
      `)
      .eq('entity_roles.role', 'roaster')
      .range(offset, offset + pageSize - 1);

    if (error) {
      logger.error('Roasters', 'Failed to fetch roasters', { error: error.message });
      throw error;
    }

    allRoasters.push(...roasters);
    
    if (roasters.length < pageSize) {
      break;
    }
    offset += pageSize;
  }

  logger.success('Roasters', `Found ${allRoasters.length} roaster entities`);

  return allRoasters;
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

  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }

  logger.success('Filter', `${eligible.length}/${roasters.length} roasters eligible for crawling (randomized)`);

  return eligible;
}

module.exports = {
  getRoasterEntities,
  filterRoastersForCrawling,
};
