const cheerio = require('cheerio');
const globalLogger = require('./logger');

const { classifyPage, MODEL } = require('./gptClassifier');
const { saveKnownPage, getKnownPagesForEntity, saveBlacklistedPages } = require('./knownPages');
const { saveProduct } = require('./productSaver');
const { filterUrlsWithBlacklist } = require('./blacklist');
const { config } = require('./config');
const { fetchHtml, jitteredSleep } = require('./httpClient');

const GPT_DELAY_MS = 500;

function normalizeUrl(url, baseUrl) {
  try {
    if (!url) return null;
    if (url.startsWith('#') || url.startsWith('javascript:') || url.startsWith('mailto:') || url.startsWith('tel:')) {
      return null;
    }
    
    const base = new URL(baseUrl);
    
    if (url.startsWith('//')) {
      return 'https:' + url;
    }
    if (url.startsWith('/')) {
      return base.origin + url;
    }
    if (url.startsWith('http')) {
      const urlObj = new URL(url);
      if (urlObj.hostname !== base.hostname) {
        return null;
      }
      return url.split('#')[0].split('?')[0];
    }
    
    return new URL(url, baseUrl).href.split('#')[0].split('?')[0];
  } catch {
    return null;
  }
}

async function fetchPageAndLinks(url, referer = null) {
  const result = await fetchHtml(url, { 
    timeout: 15000,
    referer,
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error,
      links: [],
    };
  }

  try {
    const $ = cheerio.load(result.data);
    
    const links = [];
    $('a[href]').each((i, el) => {
      const href = $(el).attr('href');
      const normalized = normalizeUrl(href, url);
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
          const urlObj = new URL(url);
          absoluteSrc = urlObj.origin + src;
        }
        images.push({ src: absoluteSrc, alt });
      }
    });

    const imageSection = images.length > 0
      ? '\n\nPRODUCT IMAGES:\n' + images.slice(0, 10).map(img => `- ${img.src} (alt: ${img.alt})`).join('\n')
      : '';

    const content = (bodyText + imageSection).substring(0, 15000);

    return {
      success: true,
      content,
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

async function bfsCrawl(entityId, startUrl, blacklistTerms, accumulator, log = null) {
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
  };

  const MAX_PAGES = config.crawler.maxBfsPages || 200;
  const MAX_QUEUE_SIZE = 500;

  logger.header('BFS Crawl Starting');
  logger.info('BFS', `Starting URL: ${startUrl}`);
  logger.info('BFS', `Max pages: ${MAX_PAGES}`);

  let lastUrl = null;

  while (queue.length > 0 && results.visited < MAX_PAGES) {
    const url = queue.shift();
    
    if (visited.has(url)) continue;
    visited.add(url);
    accumulator.markVisited(url);

    await jitteredSleep(config.crawler.requestDelayMs);

    const fetchResult = await fetchPageAndLinks(url, lastUrl);
    lastUrl = url;

    if (!fetchResult.success) {
      logger.warn('BFS', `Failed to fetch: ${url}`, { error: fetchResult.error });
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

    if (knownPages.has(url)) {
      logger.info('BFS', `Known page, skipping GPT: ${url}`);
      continue;
    }

    await jitteredSleep(GPT_DELAY_MS);

    const classification = await classifyPage(fetchResult.content, url);
    const now = new Date().toISOString();

    if (classification.error) {
      logger.warn('BFS', `Classification error: ${url}`, { error: classification.error });
      results.errors++;
      continue;
    }

    const result = classification.data;

    if (result.is_coffee_page === false || result.is_product === false) {
      await saveKnownPage(entityId, url, 'irrelevant', {
        classification: result,
        classifiedAt: now,
        classifiedBy: MODEL,
      });
      results.irrelevant++;
      continue;
    }

    if (result.is_coffee_page === true && result.product) {
      try {
        await saveProduct(entityId, result.product, url, logger);
        await saveKnownPage(entityId, url, 'coffee', {
          classification: result,
          classifiedAt: now,
          classifiedBy: MODEL,
        });
        logger.success('BFS', `Found coffee: ${result.product.name}`);
        results.coffeeFound++;
      } catch (error) {
        logger.error('BFS', `Failed to save product: ${url}`, { error: error.message });
        results.errors++;
      }
      continue;
    }

    await saveKnownPage(entityId, url, 'irrelevant', {
      classification: result,
      classifiedAt: now,
      classifiedBy: MODEL,
    });
    results.irrelevant++;
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

  return results;
}

module.exports = {
  bfsCrawl,
  fetchPageAndLinks,
  normalizeUrl,
};
