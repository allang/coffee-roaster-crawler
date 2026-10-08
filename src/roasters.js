const { getSupabase } = require('./supabase');
const { getRecentCrawlRuns } = require('./crawlRuns');
const logger = require('./logger');
const {fallbackTier,manifest}=require('./crawlTierPlan');

function hasOfficialWebsite(roaster) {
  return Boolean(roaster?.website_url && String(roaster.website_url).trim());
}

function missingTierColumn(error) {
  return ['42703','PGRST204'].includes(error?.code) && /roaster_tier/i.test(error?.message || '');
}
function missingCrawlControlTable(error) {
  return error?.code==='PGRST205' && /public\.entity_crawl_state/i.test(error?.message || '');
}

async function getRoasterEntities() {
  logger.header('Fetching Roaster Entities');
  const supabase = getSupabase();

  logger.info('Roasters', 'Querying entities with role=roaster');

  const allRoasters = [];
  const pageSize = 1000;
  let offset = 0;
  let databaseTiers=true;
  
  while (true) {
    const { data: roasters, error } = await supabase
      .from('entities')
      .select(`
        id,
        name,
        website_url,
        ${databaseTiers?'roaster_tier,':''}
        entity_roles!inner (role)
      `)
      .eq('entity_roles.role', 'roaster')
      .order('id',{ascending:true})
      .range(offset, offset + pageSize - 1);

    if (error) {
      if(databaseTiers && missingTierColumn(error)){
        databaseTiers=false;allRoasters.length=0;offset=0;
        logger.warn('Roasters','Database tier field is not installed; using reviewed stable-ID crawl ordering',{sourceCommit:manifest.source_commit});
        continue;
      }
      logger.error('Roasters', 'Failed to fetch roasters', { error: error.message });
      throw error;
    }

    allRoasters.push(...roasters.map(roaster=>({...roaster,roaster_tier:databaseTiers?roaster.roaster_tier:fallbackTier(roaster.id),crawl_tier_source:databaseTiers?'database':'reviewed_mapping'})));
    
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

  const crawlStates=[];
  // Thousands of IDs in one query can exceed the URL limit and lose exclusions.
  for(let offset=0;offset<roasterIds.length;offset+=50){
    const {data,error}=await supabase.from('entity_crawl_state').select('entity_id, allow_crawl').in('entity_id',roasterIds.slice(offset,offset+50));
    if(missingCrawlControlTable(error)){
      logger.warn('Filter','Optional crawl-control table is not installed; retaining cooldown and website rules');
      break;
    }
    if(error)throw error;
    crawlStates.push(...(data || []));
  }

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
    if (disabledEntityIds.has(roaster.id) || !hasOfficialWebsite(roaster)) {
      return false;
    }
    return !recentlyRunEntityIds.has(roaster.id);
  });

  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }

  logger.success('Filter', `${eligible.length}/${roasters.length} roasters eligible; randomized within tier phases`);

  return eligible;
}

module.exports = {
  hasOfficialWebsite,
  missingTierColumn,
  missingCrawlControlTable,
  getRoasterEntities,
  filterRoastersForCrawling,
};
