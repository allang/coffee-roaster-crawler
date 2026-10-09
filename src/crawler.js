const { getSupabase } = require('./supabase');
const { discoverSitemapUrl, crawlSitemap } = require('./sitemap');
const { jitteredSleep, initProxyPool } = require('./httpClient');
const { UrlAccumulator } = require('./urlAccumulator');
const { getBlacklistTerms, filterUrlsWithBlacklist } = require('./blacklist');
const { getKnownPagesForEntity, saveBlacklistedPages, filterOutKnownUrls } = require('./knownPages');
const { visitAllPages } = require('./pageVisitor');
const { createCrawlRun, completeCrawlRun, failCrawlRun, waitForCrawlAdmission } = require('./crawlRuns');
const { bfsCrawl } = require('./bfsCrawler');
const { config } = require('./config');
const globalLogger = require('./logger');
const { createScopedLogger } = require('./logger');
const { reconcileRoasterAvailability } = require('./availability');
const { discoverSiteProducts, profileFor } = require('./siteSupport/discovery');
const { verifiedEmptyInventory } = require('./siteSupport/squareInventory');
const { createReader,allowed } = require('./siteSupport/network');
const {crawlTierPhases}=require('./crawlTierPlan');
const { getCrawlConcurrency } = require('./crawlConcurrency');

async function detectPlatform(websiteUrl, log, options = {}) {
  log.info('Platform', `Detecting platform for: ${websiteUrl}`);

  const { fetchUrl } = require('./sitemap');
  const result = await (options.fetchHtml || fetchUrl)(websiteUrl, {
    contentType: 'html',
    useUrlFallback: true,
  });

  if (!result.success) {
    log.warn('Platform', 'Could not fetch website for platform detection');
    return { platform: 'unknown', confidence: 0 };
  }

  const html = result.data.toLowerCase();

  if (html.includes('shopify') || html.includes('cdn.shopify.com')) {
    log.success('Platform', 'Detected: Shopify');
    return { platform: 'shopify', confidence: 0.9, finalUrl: result.finalUrl || websiteUrl };
  }

  if (html.includes('woocommerce') || html.includes('wp-content')) {
    log.success('Platform', 'Detected: WooCommerce');
    return { platform: 'woocommerce', confidence: 0.8, finalUrl: result.finalUrl || websiteUrl };
  }

  if (html.includes('squarespace')) {
    log.success('Platform', 'Detected: Squarespace (recorded as custom)');
    return { platform: 'custom', confidence: 0.85, finalUrl: result.finalUrl || websiteUrl };
  }

  log.info('Platform', 'Platform: Unknown/Custom');
  return { platform: 'custom', confidence: 0.5, finalUrl: result.finalUrl || websiteUrl };
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
  await waitForCrawlAdmission();
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

  const siteProfile=profileFor(roaster),siteReader=siteProfile?createReader(siteProfile,{resumeCooldowns:true}):null;
  const entryUrl=siteProfile?.bootstrap_url?allowed(siteProfile.bootstrap_url,siteProfile.hosts).href:websiteUrl;
  if(entryUrl!==websiteUrl)log.info('Platform','Using reviewed merchant market entry point',{website:websiteUrl,entry:entryUrl});
  const platformInfo = await detectPlatform(entryUrl, log,siteReader || {});

  if (platformInfo.confidence === 0) {
    log.warn('Crawl', 'Website unreachable, will retry later');
    return { success: false, error: 'Website unreachable', retryable: true, roasterName: roaster.name };
  }

  const effectiveWebsiteUrl = platformInfo.finalUrl || entryUrl;
  if (effectiveWebsiteUrl !== websiteUrl) {
    log.info('Crawl', 'Using fetched canonical URL', { original: websiteUrl, finalUrl: effectiveWebsiteUrl });
  }

  const crawlRun = await createCrawlRun(roaster.id, platformInfo.platform);
  log.info('Crawl', 'Platform detection complete', platformInfo);

  try {
  await jitteredSleep(config.crawler.requestDelayMs);

  const siteDiscovery=await discoverSiteProducts(siteProfile?{...roaster,website_url:effectiveWebsiteUrl}:roaster,siteReader || {fetchHtml:require('./httpClient').fetchHtml});
  const siteFetchOptions=siteReader?{siteProfile,fetchHtml:siteReader.fetchHtml,getMerchantCooldownFailure:siteReader.getCooldownFailure,fetchJson:async url=>{const response=await siteReader.fetchHtml(url);if(!response.success)return response;try{return {...response,data:JSON.parse(response.data)};}catch{return {success:false,error:'Invalid merchant JSON'};}}}:{};
  for(const url of siteDiscovery.urls)accumulator.addUrl(url,'site-support');
  const verifiedEmpty=verifiedEmptyInventory(siteProfile,siteDiscovery);
  const partialScope=require('./siteSupport/txt').partialScopeAllowed(siteProfile,siteDiscovery);
  if(siteDiscovery.error || siteDiscovery.supported && (!siteDiscovery.complete && !partialScope || !siteDiscovery.urls.length && !verifiedEmpty))throw new Error('Supported merchant discovery failed: '+(siteDiscovery.error || 'Incomplete or empty reviewed coffee inventory'));
  if(partialScope)log.info('Crawl','Reading the reviewed public English product scope; inventory and variants remain incomplete',{inventoryScope:siteDiscovery.inventory_scope,products:siteDiscovery.urls.length});
  if(verifiedEmpty) {
    const stats=accumulator.getStats(),visitResults={visited:0,coffeeFound:0,irrelevant:0,errors:0,aiCalls:0,verifiedEmptyInventory:true,inventoryScope:siteDiscovery.inventory_scope};
    await completeCrawlRun(crawlRun.id,{pagesDiscovered:0,pagesVisited:0,pagesSentToGpt:0,coffeesFound:0,metrics:visitResults});
    log.info('Crawl','Verified subscription-only public inventory; no one-time coffees and no omission reconciliation');
    return {success:true,roasterId:roaster.id,roasterName:roaster.name,platform:platformInfo,sitemapUrl:null,stats,visitResults,inventoryEvidence:siteDiscovery.empty_inventory_proof};
  }

  // Registered inventories are already reviewed and complete. Do not fall back
  // to broad sitemaps/BFS or an unguarded reader for these merchants.
  const sitemapUrl = siteDiscovery.supported?null:await discoverSitemapUrl(effectiveWebsiteUrl);
  let sitemapResult = null;
  const observed = new Map();

  if (sitemapUrl) {
    sitemapResult = await crawlSitemap(sitemapUrl);

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

  } else if (!siteDiscovery.urls.length) {
    log.info('Crawl', 'No sitemap found, using BFS crawling');
    accumulator.addUrl(effectiveWebsiteUrl, 'manual');
    
    const bfsResults = await bfsCrawl(
      roaster.id,
      effectiveWebsiteUrl,
      blacklistTerms,
      accumulator,
      log,
      platformInfo.platform,
      {observed}
    );
    
    const stats = accumulator.getStats();
    await completeCrawlRun(crawlRun.id, {
      pagesDiscovered: bfsResults.linksDiscovered || 0,
      pagesVisited: bfsResults.visited || 0,
      pagesSentToGpt: bfsResults.aiCalls || 0,
      metrics: bfsResults,
      coffeesFound: bfsResults.coffeeFound || 0,
    });

    if (bfsResults.inventoryComplete) {
      await reconcileRoasterAvailability({
        entityId: roaster.id,
        surfaceUrls: accumulator.getAllUrls().map(entry => entry.url),
        platform: platformInfo.platform,
        log,
        observed,
      });
    } else {
      log.warn('Availability', 'Skipping reconciliation because BFS inventory surface was incomplete', {
        errors: bfsResults.errors,
        queueRemaining: bfsResults.queueRemaining,
        quotaExceeded: bfsResults.quotaExceeded,
      });
    }

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
  const supportedUrls=new Set(siteDiscovery.urls.map(url=>accumulator.normalizeUrl(url)));
  const eligibleUrls=unvisitedAll.filter(entry=>knownUrls.get(entry.url)?.status!=='skip' && (!supportedUrls.size || supportedUrls.has(entry.url)));
  const newUrls=eligibleUrls;
  const skippedUrls=unvisitedAll.filter(entry=>knownUrls.get(entry.url)?.status==='skip');

  if (skippedUrls.length > 0) {
    log.info('KnownPages', `Skipping ${skippedUrls.length} explicitly excluded pages`);
  }

  const blacklistedEntries = accumulator.getAllUrls().filter(u => u.blacklisted);
  if (blacklistedEntries.length > 0) {
    await saveBlacklistedPages(roaster.id, blacklistedEntries);
  }

  accumulator.printSummary();

  log.info('Crawl', `New pages to visit and classify: ${newUrls.length}`);

  let visitResults = { visited: 0, coffeeFound: 0, irrelevant: 0, errors: 0 };

    if (newUrls.length > 0) {
      log.header('Visiting Pages & GPT Classification');
      visitResults = await visitAllPages(roaster.id, newUrls, accumulator, log, platformInfo.platform, {knownPages:knownUrls,observed,...siteFetchOptions});
      
      log.success('Crawl', 'Page visiting complete', {
        visited: visitResults.visited,
        coffeeFound: visitResults.coffeeFound,
        irrelevant: visitResults.irrelevant,
        errors: visitResults.errors,
      });
    }

    if(siteDiscovery.supported && (visitResults.errors>0 || visitResults.deferredPages>0))throw new Error('Registered merchant product verification failed: '+visitResults.errors+' page error(s)'+(visitResults.deferredPages?'; '+visitResults.deferredPages+' page(s) deferred after merchant cooldown':''));
    if(partialScope)visitResults={...visitResults,partialInventory:true,inventoryComplete:false,inventoryScope:siteDiscovery.inventory_scope,omissionReconciliation:false};
    const stats = accumulator.getStats();
    await completeCrawlRun(crawlRun.id, {
      pagesDiscovered: stats.total || 0,
      pagesVisited: visitResults.visited || 0,
      pagesSentToGpt: visitResults.aiCalls || 0,
      metrics: visitResults,
      coffeesFound: visitResults.coffeeFound || 0,
    });

    const inventoryComplete=siteDiscovery.supported?siteDiscovery.complete:sitemapResult?.urls.length>0 && sitemapResult.inventoryComplete;
    const marketAllowsReconciliation=siteProfile?.reconcile_omissions!==false && siteProfile?.inventory_authorizes_global_absence!==false;
    if (inventoryComplete && visitResults.errors === 0 && marketAllowsReconciliation) {
      await reconcileRoasterAvailability({
        entityId: roaster.id,
        surfaceUrls: siteDiscovery.supported?siteDiscovery.urls:accumulator.getAllUrls().map(entry => entry.url),
        platform: platformInfo.platform,
        log,
        observed,
        ...siteFetchOptions,
        ...(siteReader?{fetchPage:url=>require('./pageVisitor').fetchPageContent(url,null,siteFetchOptions)}:{}),
      });
    } else {
      log.warn('Availability', 'Skipping reconciliation because inventory/page checks were incomplete or the reviewed market forbids omission checks', {
        urlsFound: sitemapResult?.urls.length || 0,
        hasError: !!sitemapResult?.error,
      });
    }

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
  const concurrency = getCrawlConcurrency();
  const { getRoasterEntities, filterRoastersForCrawling } = require('./roasters');

  globalLogger.header('Coffee Roaster Crawler Starting');
  globalLogger.info('Crawler', `Started at: ${new Date().toISOString()}`);
  globalLogger.divider();

  await initProxyPool();

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
  const limit = pLimit(concurrency.roasters);
  globalLogger.info('Crawler', `Running ${concurrency.roasters} roasters in parallel`);
  globalLogger.info('Crawler', 'Concurrency', {
    roasterWorkers: concurrency.roasters,
    pageWorkersPerRoaster: concurrency.pagesPerRoaster,
    maximumPageWorkers: concurrency.roasters * concurrency.pagesPerRoaster,
  });

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

  const {results:allResults,phases,retriedSites}=await crawlTierPhases(eligibleRoasters,{
    crawl:crawlWithRetryTracking,limit,
    onPhaseStart:phase=>{globalLogger.header(`Crawling ${phase.label}`);globalLogger.info('TierOrder','Phase started',{tier:phase.tier,roasters:phase.roasters.length});},
    onRetry:phase=>globalLogger.info('Retry',`${phase.retryCount} unreachable sites to retry before finishing ${phase.label}`),
    onPhaseComplete:summary=>globalLogger.info('TierOrder','Phase finished',summary),
  });

  globalLogger.header('Crawl Summary');
  
  const successful = allResults.filter(r => r.success);
  const failed = allResults.filter(r => !r.success);

  globalLogger.info('Summary', 'Overall Results', {
    totalRoasters: eligibleRoasters.length,
    successful: successful.length,
    failed: failed.length,
    retriedSites,
    phases,
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

  return { success: true, roastersCrawled: successful.length, results: allResults, phases };
}

module.exports = {
  detectPlatform,
  crawlRoaster,
  runCrawler,
};
