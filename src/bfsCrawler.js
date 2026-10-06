const cheerio = require('cheerio');
const globalLogger = require('./logger');

const { processFetchedPage, addExtractionMetrics, extractionMetrics } = require('./pageVisitor');
const { canonicalProductUrl } = require('./catalogNormalization');
const { saveKnownPage, getKnownPagesForEntity, saveBlacklistedPages } = require('./knownPages');
const { saveProduct } = require('./productSaver');
const { filterUrlsWithBlacklist } = require('./blacklist');
const { config } = require('./config');
const { fetchHtml, jitteredSleep } = require('./httpClient');
const { detectProductAvailability } = require('./availability');
const { isShopifyProductUrl, fetchShopifyProductJson, mergeGptAndJsonData } = require('./shopifyProduct');

const GPT_DELAY_MS = 500;

function normalizeUrl(url,baseUrl) {
  try { const parsed=new URL(url,baseUrl),base=new URL(baseUrl);if(parsed.hostname!==base.hostname)return null;const normalized=new URL(canonicalProductUrl(parsed.href));normalized.hostname=parsed.hostname;return normalized.href; } catch {return null;}
}

async function fetchPageAndLinks(url, referer = null, options = {}) {
  const result = await fetchHtml(url, { 
    timeout: 15000,
    referer,
    useUrlFallback: options.useUrlFallback || false,
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error,
      status: result.status,
      links: [],
    };
  }

  try {
    const effectiveUrl = result.finalUrl || url;
    const $ = cheerio.load(result.data);
    
    const links = [];
    $('a[href]').each((i, el) => {
      const href = $(el).attr('href');
      const normalized = normalizeUrl(href, effectiveUrl);
      if (normalized) {
        links.push(normalized);
      }
    });

    $('script, style, nav, footer, header, noscript, iframe').remove();
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
    
    const images = [];
    $('img').each((i, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      const alt = $(el).attr('alt') || '';
      if (src && !src.startsWith('data:')) {
        let absoluteSrc = src;
        if (src.startsWith('//')) {
          absoluteSrc = 'https:' + src;
        } else if (src.startsWith('/')) {
          const urlObj = new URL(effectiveUrl);
          absoluteSrc = urlObj.origin + src;
        }
        images.push({ src: absoluteSrc, alt });
      }
    });

    const imageSection = images.length > 0
      ? '\n\nPRODUCT IMAGES:\n' + images.slice(0, 10).map(img => `- ${img.src} (alt: ${img.alt})`).join('\n')
      : '';

    const content = (bodyText + imageSection).substring(0,Number(process.env.CLASSIFIER_MAX_CHARS || 15000));

    return {
      success: true,
      content,
      html: result.data,
      status: result.status,
      finalUrl: effectiveUrl,
      links: [...new Set(links)],
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      links: [],
    };
  }
}

async function bfsCrawl(entityId, startUrl, blacklistTerms, accumulator, log = null, platform = 'unknown', options={}) {
  const logger = log || globalLogger;
  const visited = new Set();
  const knownPages = await getKnownPagesForEntity(entityId);
  const queue = [startUrl];
  const blacklistedEntries = [];
  
  const results = {
    visited: 0,
    coffeeFound: 0,
    irrelevant: 0,
    errors: 0,
    linksDiscovered: 0,
    blacklisted: 0,
    quotaExceeded: false,
    ...extractionMetrics(),
  };

  const MAX_PAGES = config.crawler.maxBfsPages || 200;
  const MAX_QUEUE_SIZE = 500;

  logger.header('BFS Crawl Starting');
  logger.info('BFS', `Starting URL: ${startUrl}`);
  logger.info('BFS', `Max pages: ${MAX_PAGES}`);

  let lastUrl = null;

  while (queue.length > 0 && results.visited < MAX_PAGES) {
    const url = queue.shift();
    
    if (visited.has(url) || knownPages.get(url)?.status==='skip') continue;
    visited.add(url);
    accumulator.markVisited(url);

    await jitteredSleep(config.crawler.requestDelayMs);

    const fetchResult = await fetchPageAndLinks(url, lastUrl, { useUrlFallback: url === startUrl });
    if (fetchResult.finalUrl && fetchResult.finalUrl !== url) {
      logger.info('BFS', 'Using fetched canonical URL', { original: url, finalUrl: fetchResult.finalUrl });
    }
    lastUrl = fetchResult.finalUrl || url;

    if (!fetchResult.success) {
      logger.warn('BFS', `Failed to fetch: ${url}`, { error: fetchResult.error });
      try { await processFetchedPage(entityId,url,fetchResult,logger,platform,{...options,knownPage:knownPages.get(url)}); } catch {}
      results.errors++;
      continue;
    }

    results.visited++;

    const newLinks = fetchResult.links.filter(link => !visited.has(link));
    const { passed, blacklisted } = filterUrlsWithBlacklist(
      newLinks.map(u => ({ url: u })),
      blacklistTerms
    );

    for (const entry of blacklisted) {
      if (!visited.has(entry.url)) {
        visited.add(entry.url);
        accumulator.addUrl(entry.url, 'dom_link', url, {
          blacklisted: true,
          blacklistedMatch: entry.blacklistedMatch,
        });
        blacklistedEntries.push(entry);
        results.blacklisted++;
      }
    }

    for (const entry of passed) {
      if (!visited.has(entry.url) && !queue.includes(entry.url) && queue.length < MAX_QUEUE_SIZE) {
        queue.push(entry.url);
        accumulator.addUrl(entry.url, 'dom_link', url);
        results.linksDiscovered++;
      }
    }

    let result;
    try { result=await processFetchedPage(entityId,url,fetchResult,logger,platform,{...options,knownPage:knownPages.get(url)}); }
    catch(error) { result={error:error.message}; }
    addExtractionMetrics(results,result);
    if(result.error) {
      results.errors++;
      if(result.quotaExceeded) { results.quotaExceeded=true; break; }
    } else if(result.isCoffee) results.coffeeFound++;
    else results.irrelevant++;

  }

  if (blacklistedEntries.length > 0) {
    logger.info('BFS', `Saving ${blacklistedEntries.length} blacklisted pages`);
    await saveBlacklistedPages(entityId, blacklistedEntries.map(e => ({
      url: e.url,
      blacklisted: true,
      blacklistedMatch: e.blacklistedMatch,
    })));
  }

  logger.success('BFS', 'Crawl complete', {
    visited: results.visited,
    coffeeFound: results.coffeeFound,
    linksDiscovered: results.linksDiscovered,
    blacklisted: results.blacklisted,
    queueRemaining: queue.length,
  });

  results.queueRemaining = queue.length;
  results.inventoryComplete =
    queue.length === 0 &&
    results.errors === 0 &&
    results.quotaExceeded === false &&
    results.visited < MAX_PAGES;

  return results;
}

module.exports = {
  bfsCrawl,
  fetchPageAndLinks,
  normalizeUrl,
};
