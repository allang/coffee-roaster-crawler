const { getSupabase } = require('./supabase');
const logger = require('./logger');

let cachedTerms = null;

async function getBlacklistTerms() {
  if (cachedTerms) {
    return cachedTerms;
  }

  logger.info('Blacklist', 'Fetching blacklist terms from database');
  const supabase = getSupabase();

  const { data: terms, error } = await supabase
    .from('crawl_blacklist_terms')
    .select('term')
    .eq('enabled', true);

  if (error) {
    logger.error('Blacklist', 'Failed to fetch blacklist terms', { error: error.message });
    throw error;
  }

  cachedTerms = terms.map(t => t.term);
  logger.success('Blacklist', `Loaded ${cachedTerms.length} blacklist terms`);

  return cachedTerms;
}

function matchesBlacklist(url, terms) {
  const lowerUrl = url.toLowerCase();
  
  for (const term of terms) {
    if (lowerUrl.includes(term.toLowerCase())) {
      return term;
    }
  }
  
  return null;
}

function filterUrlsWithBlacklist(urls, terms) {
  const passed = [];
  const blacklisted = [];

  for (const urlEntry of urls) {
    const url = typeof urlEntry === 'object' ? urlEntry.url : urlEntry;
    const matchedTerm = matchesBlacklist(url, terms);
    
    if (matchedTerm) {
      blacklisted.push({
        ...urlEntry,
        blacklisted: true,
        blacklistedMatch: matchedTerm,
      });
    } else {
      passed.push(urlEntry);
    }
  }

  return { passed, blacklisted };
}

function clearCache() {
  cachedTerms = null;
}

module.exports = {
  getBlacklistTerms,
  matchesBlacklist,
  filterUrlsWithBlacklist,
  clearCache,
};
