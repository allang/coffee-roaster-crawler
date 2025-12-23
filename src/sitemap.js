const axios = require('axios');
const xml2js = require('xml2js');
const { config } = require('./config');
const logger = require('./logger');

const parser = new xml2js.Parser({ explicitArray: false });

async function fetchUrl(url) {
  try {
    const response = await axios.get(url, {
      timeout: config.crawler.requestTimeoutMs,
      headers: {
        'User-Agent': config.crawler.userAgent,
        'Accept': 'application/xml, text/xml, */*',
      },
      maxRedirects: 5,
    });

    return { success: true, data: response.data, status: response.status };
  } catch (error) {
    const status = error.response?.status || 0;
    logger.warn('HTTP', `Failed to fetch ${url}`, { 
      status, 
      message: error.message 
    });
    return { success: false, error: error.message, status };
  }
}

async function parseSitemapXml(xmlContent) {
  try {
    const result = await parser.parseStringPromise(xmlContent);
    return { success: true, data: result };
  } catch (error) {
    logger.warn('Sitemap', 'Failed to parse XML', { error: error.message });
    return { success: false, error: error.message };
  }
}

function extractUrlsFromSitemap(parsedXml) {
  const urls = [];
  const childSitemaps = [];

  if (parsedXml.sitemapindex?.sitemap) {
    const sitemaps = Array.isArray(parsedXml.sitemapindex.sitemap)
      ? parsedXml.sitemapindex.sitemap
      : [parsedXml.sitemapindex.sitemap];

    for (const sitemap of sitemaps) {
      const loc = sitemap.loc;
      if (loc) {
        childSitemaps.push(loc);
      }
    }
  }

  if (parsedXml.urlset?.url) {
    const urlEntries = Array.isArray(parsedXml.urlset.url)
      ? parsedXml.urlset.url
      : [parsedXml.urlset.url];

    for (const entry of urlEntries) {
      const loc = entry.loc;
      if (loc) {
        urls.push({
          url: loc,
          lastmod: entry.lastmod || null,
          priority: entry.priority || null,
          changefreq: entry.changefreq || null,
        });
      }
    }
  }

  return { urls, childSitemaps };
}

async function crawlSitemap(sitemapUrl, visited = new Set()) {
  logger.info('Sitemap', `Crawling sitemap: ${sitemapUrl}`);

  if (visited.has(sitemapUrl)) {
    return { urls: [], sitemaps: [] };
  }
  visited.add(sitemapUrl);

  const fetchResult = await fetchUrl(sitemapUrl);
  if (!fetchResult.success) {
    return { urls: [], sitemaps: [], error: fetchResult.error };
  }

  const parseResult = await parseSitemapXml(fetchResult.data);
  if (!parseResult.success) {
    return { urls: [], sitemaps: [], error: parseResult.error };
  }

  const { urls, childSitemaps } = extractUrlsFromSitemap(parseResult.data);

  const allUrls = [...urls];
  const allSitemaps = [{ url: sitemapUrl, type: childSitemaps.length > 0 ? 'master' : 'child' }];

  const errors = [];
  
  for (const childUrl of childSitemaps) {
    if (visited.size >= config.crawler.maxSitemapsPerEntity) {
      logger.warn('Sitemap', `Reached max sitemaps limit (${config.crawler.maxSitemapsPerEntity})`);
      break;
    }

    await delay(config.crawler.requestDelayMs);

    const childResult = await crawlSitemap(childUrl, visited);
    
    if (childResult.error) {
      logger.warn('Sitemap', `Child sitemap failed: ${childUrl}`, { error: childResult.error });
      errors.push({ url: childUrl, error: childResult.error });
    }
    
    allUrls.push(...childResult.urls);
    allSitemaps.push(...childResult.sitemaps);
  }

  return { 
    urls: allUrls, 
    sitemaps: allSitemaps,
    childErrors: errors.length > 0 ? errors : undefined,
  };
}

async function discoverSitemapUrl(websiteUrl) {
  logger.info('Sitemap', `Discovering sitemap for: ${websiteUrl}`);

  const baseUrl = websiteUrl.replace(/\/$/, '');
  
  const candidates = [
    `${baseUrl}/sitemap.xml`,
    `${baseUrl}/sitemap_index.xml`,
    `${baseUrl}/sitemap-index.xml`,
    `${baseUrl}/sitemap1.xml`,
  ];

  for (const candidate of candidates) {
    const result = await fetchUrl(candidate);
    
    if (result.success && result.data?.includes('<?xml')) {
      logger.success('Sitemap', `Found valid sitemap at: ${candidate}`);
      return candidate;
    }

    await delay(config.crawler.requestDelayMs);
  }

  logger.warn('Sitemap', 'No sitemap found at common locations');
  return null;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  fetchUrl,
  parseSitemapXml,
  extractUrlsFromSitemap,
  crawlSitemap,
  discoverSitemapUrl,
  delay,
};
