const { getSupabase } = require('./supabase');
const logger = require('./logger');

async function getKnownPagesForEntity(entityId) {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('known_pages')
    .select('url')
    .eq('entity_id', entityId);

  if (error) {
    logger.error('KnownPages', 'Failed to fetch known pages', { error: error.message });
    throw error;
  }

  const knownUrls = new Set(data.map(p => p.url));
  return knownUrls;
}

async function saveKnownPage(entityId, url, status, options = {}) {
  const supabase = getSupabase();

  const record = {
    entity_id: entityId,
    url: url,
    status: status,
    reason: options.reason || null,
    blacklisted_match: options.blacklistedMatch || null,
    classification: options.classification || null,
    last_classified_at: options.classifiedAt || null,
    last_classified_by: options.classifiedBy || null,
    first_seen_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    times_seen: 1,
  };

  const { error } = await supabase
    .from('known_pages')
    .upsert(record, { 
      onConflict: 'entity_id,url',
      ignoreDuplicates: false 
    });

  if (error) {
    logger.error('KnownPages', 'Failed to save known page', { url, error: error.message });
    throw error;
  }

  return true;
}

async function saveBlacklistedPages(entityId, blacklistedUrls) {
  if (blacklistedUrls.length === 0) return;

  const supabase = getSupabase();
  const now = new Date().toISOString();

  const records = blacklistedUrls.map(entry => ({
    entity_id: entityId,
    url: entry.url,
    status: 'skip',
    reason: 'blacklist',
    blacklisted_match: entry.blacklistedMatch,
    first_seen_at: now,
    last_seen_at: now,
    times_seen: 1,
  }));

  const { error } = await supabase
    .from('known_pages')
    .upsert(records, { 
      onConflict: 'entity_id,url',
      ignoreDuplicates: false 
    });

  if (error) {
    logger.error('KnownPages', 'Failed to save blacklisted pages', { error: error.message });
    throw error;
  }

  logger.info('KnownPages', `Saved ${blacklistedUrls.length} blacklisted pages`);
}

function filterOutKnownUrls(urls, knownUrls) {
  const unknown = [];
  const known = [];

  for (const entry of urls) {
    const url = typeof entry === 'object' ? entry.url : entry;
    if (knownUrls.has(url)) {
      known.push(entry);
    } else {
      unknown.push(entry);
    }
  }

  return { unknown, known };
}

module.exports = {
  getKnownPagesForEntity,
  saveKnownPage,
  saveBlacklistedPages,
  filterOutKnownUrls,
};
