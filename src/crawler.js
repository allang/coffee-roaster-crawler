const { getSupabase } = require('./supabase');
const { discoverSitemapUrl, crawlSitemap, delay } = require('./sitemap');
const { UrlAccumulator } = require('./urlAccumulator');
const { getBlacklistTerms, filterUrlsWithBlacklist } = require('./blacklist');
const { getKnownPagesForEntity, saveBlacklistedPages, filterOutKnownUrls } = require('./knownPages');
const { visitAllPages } = require('./pageVisitor');
const { createCrawlRun, completeCrawlRun, failCrawlRun } = require('./crawlRuns');
const { bfsCrawl } = require('./bfsCrawler');
const { config } = require('./config');
const globalLogger = require('./logger');
const { createScopedLogger } = require('./logger');

const PARALLEL_ROASTERS = 3;

async function detectPlatform(websiteUrl, log) {
  log.info('Platform', `Detecting platform for: ${websiteUrl}`);

  const { fetchUrl } = require('./sitemap');
  const result = await fetchUrl(websiteUrl);

  if (!result.success) {
    log.warn('Platform', 'Could not fetch website for platform detection');
    return { platform: 'unknown', confidence: 0 };
  }

  const html = result.data.toLowerCase();

  if (html.includes('shopify') || html.includes('cdn.shopify.com')) {
    log.success('Platform', 'Detected: Shopify');
    return { platform: 'shopify', confidence: 0.9 };
  }

  if (html.includes('woocommerce') || html.includes('wp-content')) {
    log.success('Platform', 'Detected: WooCommerce');
    return { platform: 'woocommerce', confidence: 0.8 };
  }

  if (html.includes('squarespace')) {
    log.success('Platform', 'Detected: Squarespace (recorded as custom)');
    return { platform: 'custom', confidence: 0.85 };
  }

  log.info('Platform', 'Platform: Unknown/Custom');
  return { platform: 'custom', confidence: 0.5 };
}

function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 30);
}

function ensureHttps(url) {
  if (!url) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return 'https://' + url;
}

async function crawlRoaster(roaster, blacklistTerms) {
  const roasterSlug = generateSlug(roaster.name);
  const log = createScopedLogger(roasterSlug);
  
  log.headerWhite(`Starting Crawl: ${roaster.name}`);
  
  if (!roaster.website_url) {
    log.error('Crawl', 'No website URL for roaster, skipping');
    return { success: false, error: 'No website URL' };
  }

  const websiteUrl = ensureHttps(roaster.website_url);
  
  log.info('Crawl', 'Roaster details', {
    id: roaster.id,
    website: websiteUrl,
  });

  const accumulator = new UrlAccumulator(roaster.id, roaster.name, log);

  const platformInfo = await detectPlatform(websiteUrl, log);

  if (platformInfo.confidence === 0) {
    log.warn('Crawl', 'Website unreachable, will retry later');
    return { success: false, error: 'Website unreachable', retryable: true, roasterName: roaster.name };
  }

  const crawlRun = await createCrawlRun(roaster.id, platformInfo.platform);
  log.info('Crawl', 'Platform detection complete', platformInfo);

  await delay(config.crawler.requestDelayMs);

  const sitemapUrl = await discoverSitemapUrl(websiteUrl);

  if (sitemapUrl) {
    const sitemapResult = await crawlSitemap(sitemapUrl);

    if (sitemapResult.error) {
      log.error('Crawl', 'Sitemap crawl failed', { error: sitemapResult.error });
    }

    if (sitemapResult.urls.length > 0) {
      log.success('Crawl', 'Sitemap crawl complete', {
        urlsFound: sitemapResult.urls.length,
        sitemapsVisited: sitemapResult.sitemaps.length,
        hasErrors: !!sitemapResult.error,
      });

      const { passed, blacklisted } = filterUrlsWithBlacklist(sitemapResult.urls, blacklistTerms);
      
      if (blacklisted.length > 0) {
        log.info('Blacklist', `Filtered ${blacklisted.length} URLs matching blacklist terms`);
        for (const entry of blacklisted) {
          accumulator.addUrl(entry.url, 'sitemap', null, {
            blacklisted: true,
            blacklistedMatch: entry.blacklistedMatch,
          });
        }
      }

      accumulator.addUrlsFromSitemap(passed);
    } else if (!sitemapResult.error) {
      log.warn('Crawl', 'Sitemap crawl returned no URLs');
    }

  } else {
    log.info('Crawl', 'No sitemap found, using BFS crawling');
    accumulator.addUrl(websiteUrl, 'manual');
    
    const bfsResults = await bfsCrawl(roaster.id, websiteUrl, blacklistTerms, accumulator, log);
    
    const stats = accumulator.getStats();
    await completeCrawlRun(crawlRun.id, {
      pagesDiscovered: bfsResults.linksDiscovered || 0,
      pagesVisited: bfsResults.visited || 0,
      pagesSentToGpt: bfsResults.visited || 0,
      coffeesFound: bfsResults.coffeeFound || 0,
    });

    return {
      success: true,
      roasterId: roaster.id,
      roasterName: roaster.name,
      platform: platformInfo,
      sitemapUrl: null,
      stats,
      visitResults: bfsResults,
    };
  }

  const knownUrls = await getKnownPagesForEntity(roaster.id);
  log.info('KnownPages', `Found ${knownUrls.size} known pages for this roaster`);

  const unvisitedAll = accumulator.getUnvisitedUrls();
  const { unknown: newUrls, known: skippedUrls } = filterOutKnownUrls(unvisitedAll, knownUrls);

  if (skippedUrls.length > 0) {
    log.info('KnownPages', `Skipping ${skippedUrls.length} already known pages`);
  }

  const blacklistedEntries = accumulator.getAllUrls().filter(u => u.blacklisted);
  if (blacklistedEntries.length > 0) {
    await saveBlacklistedPages(roaster.id, blacklistedEntries);
  }

  accumulator.printSummary();

  log.info('Crawl', `New pages to visit and classify: ${newUrls.length}`);

  let visitResults = { visited: 0, coffeeFound: 0, irrelevant: 0, errors: 0 };

  try {
    if (newUrls.length > 0) {
      log.header('Visiting Pages & GPT Classification');
      visitResults = await visitAllPages(roaster.id, newUrls, accumulator, log);
      
      log.success('Crawl', 'Page visiting complete', {
        visited: visitResults.visited,
        coffeeFound: visitResults.coffeeFound,
        irrelevant: visitResults.irrelevant,
        errors: visitResults.errors,
      });
    }

    const stats = accumulator.getStats();
    await completeCrawlRun(crawlRun.id, {
      pagesDiscovered: stats.total || 0,
      pagesVisited: visitResults.visited || 0,
      pagesSentToGpt: visitResults.visited || 0,
      coffeesFound: visitResults.coffeeFound || 0,
    });

    return {
      success: true,
      roasterId: roaster.id,
      roasterName: roaster.name,
      platform: platformInfo,
      sitemapUrl,
      stats,
      visitResults,
    };
  } catch (error) {
    await failCrawlRun(crawlRun.id, error.message);
    throw error;
  }
}

async function runCrawler() {
  const { getRoasterEntities, filterRoastersForCrawling } = require('./roasters');

  globalLogger.header('Coffee Roaster Crawler Starting');
  globalLogger.info('Crawler', `Started at: ${new Date().toISOString()}`);
  globalLogger.divider();

  const blacklistTerms = await getBlacklistTerms();

  const roasters = await getRoasterEntities();
  
  if (roasters.length === 0) {
    globalLogger.warn('Crawler', 'No roasters found in database');
    return { success: true, roastersCrawled: 0 };
  }

  const eligibleRoasters = await filterRoastersForCrawling(roasters);

  if (eligibleRoasters.length === 0) {
    globalLogger.warn('Crawler', 'No roasters eligible for crawling (all within 24h cooldown)');
    return { success: true, roastersCrawled: 0 };
  }

  const pLimit = (await import('p-limit')).default;
  const limit = pLimit(PARALLEL_ROASTERS);
  globalLogger.info('Crawler', `Running ${PARALLEL_ROASTERS} roasters in parallel`);

  const allResults = [];
  const retryQueue = [];

  async function crawlWithRetryTracking(roaster) {
    try {
      const result = await crawlRoaster(roaster, blacklistTerms);
      if (result.retryable) {
        return { ...result, roaster };
      }
      return result;
    } catch (error) {
      globalLogger.error('Crawler', `Failed to crawl ${roaster.name}`, { error: error.message });
      return { success: false, roasterName: roaster.name, error: error.message };
    }
  }

  const crawlPromises = eligibleRoasters.map(roaster =>
    limit(() => crawlWithRetryTracking(roaster))
  );

  const firstPassResults = await Promise.all(crawlPromises);

  for (const result of firstPassResults) {
    if (result.retryable && result.roaster) {
      retryQueue.push(result.roaster);
    } else {
      allResults.push(result);
    }
  }

  if (retryQueue.length > 0) {
    globalLogger.header('Retrying Unreachable Sites');
    globalLogger.info('Retry', `${retryQueue.length} sites to retry`);

    const retryPromises = retryQueue.map(roaster =>
      limit(() => crawlWithRetryTracking(roaster))
    );

    const retryResults = await Promise.all(retryPromises);

    for (const result of retryResults) {
      if (result.retryable) {
        allResults.push({ ...result, error: 'Website unreachable after retry' });
      } else {
        allResults.push(result);
      }
    }
  }

  globalLogger.header('Crawl Summary');
  
  const successful = allResults.filter(r => r.success);
  const failed = allResults.filter(r => !r.success);

  globalLogger.info('Summary', 'Overall Results', {
    totalRoasters: eligibleRoasters.length,
    successful: successful.length,
    failed: failed.length,
    retriedSites: retryQueue.length,
  });

  for (const result of successful) {
    globalLogger.success('Summary', `${result.roasterName}`, {
      platform: result.platform?.platform,
      urlsDiscovered: result.stats?.total || 0,
      pagesVisited: result.visitResults?.visited || 0,
      coffeesFound: result.visitResults?.coffeeFound || 0,
    });
  }

  for (const result of failed) {
    globalLogger.error('Summary', `${result.roasterName}: ${result.error}`);
  }

  return { success: true, roastersCrawled: successful.length, results: allResults };
}

module.exports = {
  detectPlatform,
  crawlRoaster,
  runCrawler,
};
