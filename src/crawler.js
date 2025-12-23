const { getSupabase } = require('./supabase');
const { discoverSitemapUrl, crawlSitemap, delay } = require('./sitemap');
const { UrlAccumulator } = require('./urlAccumulator');
const { getBlacklistTerms, filterUrlsWithBlacklist } = require('./blacklist');
const { getKnownPagesForEntity, saveBlacklistedPages, filterOutKnownUrls } = require('./knownPages');
const { visitAllPages } = require('./pageVisitor');
const { config } = require('./config');
const logger = require('./logger');

async function detectPlatform(websiteUrl) {
  logger.info('Platform', `Detecting platform for: ${websiteUrl}`);

  const { fetchUrl } = require('./sitemap');
  const result = await fetchUrl(websiteUrl);

  if (!result.success) {
    logger.warn('Platform', 'Could not fetch website for platform detection');
    return { platform: 'unknown', confidence: 0 };
  }

  const html = result.data.toLowerCase();

  if (html.includes('shopify') || html.includes('cdn.shopify.com')) {
    logger.success('Platform', 'Detected: Shopify');
    return { platform: 'shopify', confidence: 0.9 };
  }

  if (html.includes('woocommerce') || html.includes('wp-content')) {
    logger.success('Platform', 'Detected: WooCommerce');
    return { platform: 'woocommerce', confidence: 0.8 };
  }

  if (html.includes('squarespace')) {
    logger.success('Platform', 'Detected: Squarespace');
    return { platform: 'squarespace', confidence: 0.85 };
  }

  logger.info('Platform', 'Platform: Unknown/Custom');
  return { platform: 'custom', confidence: 0.5 };
}

async function crawlRoaster(roaster, blacklistTerms) {
  logger.header(`Starting Crawl: ${roaster.name}`);
  logger.info('Crawl', 'Roaster details', {
    id: roaster.id,
    website: roaster.website_url,
  });

  if (!roaster.website_url) {
    logger.error('Crawl', 'No website URL for roaster, skipping');
    return { success: false, error: 'No website URL' };
  }

  const accumulator = new UrlAccumulator(roaster.id, roaster.name);

  const platformInfo = await detectPlatform(roaster.website_url);
  logger.info('Crawl', 'Platform detection complete', platformInfo);

  await delay(config.crawler.requestDelayMs);

  const sitemapUrl = await discoverSitemapUrl(roaster.website_url);

  if (sitemapUrl) {
    const sitemapResult = await crawlSitemap(sitemapUrl);

    if (sitemapResult.error) {
      logger.error('Crawl', 'Sitemap crawl failed', { error: sitemapResult.error });
    }

    if (sitemapResult.urls.length > 0) {
      logger.success('Crawl', 'Sitemap crawl complete', {
        urlsFound: sitemapResult.urls.length,
        sitemapsVisited: sitemapResult.sitemaps.length,
        hasErrors: !!sitemapResult.error,
      });

      const { passed, blacklisted } = filterUrlsWithBlacklist(sitemapResult.urls, blacklistTerms);
      
      if (blacklisted.length > 0) {
        logger.info('Blacklist', `Filtered ${blacklisted.length} URLs matching blacklist terms`);
        for (const entry of blacklisted) {
          accumulator.addUrl(entry.url, 'sitemap', null, {
            blacklisted: true,
            blacklistedMatch: entry.blacklistedMatch,
          });
        }
      }

      accumulator.addUrlsFromSitemap(passed);
    } else if (!sitemapResult.error) {
      logger.warn('Crawl', 'Sitemap crawl returned no URLs');
    }

  } else {
    logger.warn('Crawl', 'No sitemap found, would need to use BFS crawling');
    accumulator.addUrl(roaster.website_url, 'manual');
  }

  const knownUrls = await getKnownPagesForEntity(roaster.id);
  logger.info('KnownPages', `Found ${knownUrls.size} known pages for this roaster`);

  const unvisitedAll = accumulator.getUnvisitedUrls();
  const { unknown: newUrls, known: skippedUrls } = filterOutKnownUrls(unvisitedAll, knownUrls);

  if (skippedUrls.length > 0) {
    logger.info('KnownPages', `Skipping ${skippedUrls.length} already known pages`);
  }

  const blacklistedEntries = accumulator.getAllUrls().filter(u => u.blacklisted);
  if (blacklistedEntries.length > 0) {
    await saveBlacklistedPages(roaster.id, blacklistedEntries);
  }

  accumulator.printSummary();

  logger.info('Crawl', `New pages to visit and classify: ${newUrls.length}`);

  let visitResults = { visited: 0, coffeeFound: 0, irrelevant: 0, errors: 0 };

  if (newUrls.length > 0) {
    logger.header('Visiting Pages & GPT Classification');
    visitResults = await visitAllPages(roaster.id, newUrls, accumulator);
    
    logger.success('Crawl', 'Page visiting complete', {
      visited: visitResults.visited,
      coffeeFound: visitResults.coffeeFound,
      irrelevant: visitResults.irrelevant,
      errors: visitResults.errors,
    });
  }

  return {
    success: true,
    roasterId: roaster.id,
    roasterName: roaster.name,
    platform: platformInfo,
    sitemapUrl,
    stats: accumulator.getStats(),
    visitResults,
  };
}

async function runCrawler() {
  const { getRoastersWithCrawlState, filterRoastersForCrawling } = require('./roasters');

  logger.header('Coffee Roaster Crawler Starting');
  logger.info('Crawler', `Started at: ${new Date().toISOString()}`);
  logger.divider();

  const blacklistTerms = await getBlacklistTerms();

  const roasters = await getRoastersWithCrawlState();
  
  if (roasters.length === 0) {
    logger.warn('Crawler', 'No roasters found in database');
    return { success: true, roastersCrawled: 0 };
  }

  const eligibleRoasters = await filterRoastersForCrawling(roasters);

  if (eligibleRoasters.length === 0) {
    logger.warn('Crawler', 'No roasters eligible for crawling (all within 24h cooldown)');
    return { success: true, roastersCrawled: 0 };
  }

  const results = [];

  for (const roaster of eligibleRoasters) {
    try {
      const result = await crawlRoaster(roaster, blacklistTerms);
      results.push(result);

      await delay(config.crawler.requestDelayMs * 2);
    } catch (error) {
      logger.error('Crawler', `Failed to crawl ${roaster.name}`, { error: error.message });
      results.push({ success: false, roasterName: roaster.name, error: error.message });
    }

    logger.divider();
  }

  logger.header('Crawl Summary');
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  logger.info('Summary', 'Overall Results', {
    totalRoasters: eligibleRoasters.length,
    successful: successful.length,
    failed: failed.length,
  });

  for (const result of successful) {
    logger.success('Summary', `${result.roasterName}`, {
      platform: result.platform?.platform,
      urlsDiscovered: result.stats?.total || 0,
      pagesVisited: result.visitResults?.visited || 0,
      coffeesFound: result.visitResults?.coffeeFound || 0,
    });
  }

  for (const result of failed) {
    logger.error('Summary', `${result.roasterName}: ${result.error}`);
  }

  return { success: true, roastersCrawled: successful.length, results };
}

module.exports = {
  detectPlatform,
  crawlRoaster,
  runCrawler,
};
