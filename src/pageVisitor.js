const axios = require('axios');
const https = require('https');
const cheerio = require('cheerio');
const globalLogger = require('./logger');

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});
const { classifyPage, MODEL } = require('./gptClassifier');
const { saveKnownPage } = require('./knownPages');
const { saveProduct } = require('./productSaver');
const { delay } = require('./sitemap');
const { config } = require('./config');
const { isShopifyProductUrl, fetchShopifyProductJson, mergeGptAndJsonData } = require('./shopifyProduct');

async function fetchPageContent(url) {
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CoffeeCrawler/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      httpsAgent,
    });

    const $ = cheerio.load(response.data);

    $('script, style, nav, footer, header, noscript, iframe').remove();

    const title = $('title').text().trim();
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

    const fullContent = bodyText + imageSection;
    const contentLength = fullContent.length;
    const truncatedContent = fullContent.substring(0, 15000);

    return {
      success: true,
      title,
      content: truncatedContent,
      fullLength: contentLength,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

const GPT_DELAY_MS = 500;

async function visitAndClassifyPage(entityId, url, accumulator, log, platform = 'unknown') {
  const fetchResult = await fetchPageContent(url);

  if (!fetchResult.success) {
    log.warn('Visitor', `Failed to fetch: ${url}`, { error: fetchResult.error });
    accumulator.markVisited(url);
    return { visited: true, classified: false, error: fetchResult.error };
  }

  accumulator.markVisited(url);

  let shopifyJson = null;
  if (platform === 'shopify' && isShopifyProductUrl(url)) {
    shopifyJson = await fetchShopifyProductJson(url, log);
    if (shopifyJson.success) {
      log.info('Visitor', `Got Shopify JSON with ${shopifyJson.data.variants.length} variants`);
    }
  }

  await delay(GPT_DELAY_MS);

  const classification = await classifyPage(fetchResult.content, url);

  if (classification.error) {
    log.warn('Visitor', `Classification error for ${url}`, { error: classification.error });
    return { visited: true, classified: false, error: classification.error };
  }

  const result = classification.data;
  const now = new Date().toISOString();

  if (result.is_coffee_page === false || result.is_product === false) {
    await saveKnownPage(entityId, url, 'irrelevant', {
      classification: result,
      classifiedAt: now,
      classifiedBy: MODEL,
    });
    
    return { visited: true, classified: true, isCoffee: false };
  }

  if (result.is_coffee_page === true && result.product) {
    try {
      let productToSave = result.product;
      
      if (shopifyJson && shopifyJson.success) {
        productToSave = mergeGptAndJsonData(result.product, shopifyJson);
        log.info('Visitor', `Merged GPT + JSON data for: ${productToSave.name}`);
      }
      
      await saveProduct(entityId, productToSave, url, log);
      
      await saveKnownPage(entityId, url, 'coffee', {
        classification: result,
        shopifyJson: shopifyJson?.success ? shopifyJson.data : null,
        classifiedAt: now,
        classifiedBy: MODEL,
      });

      log.success('Visitor', `Found coffee: ${productToSave.name}`);
      return { visited: true, classified: true, isCoffee: true, product: productToSave };
    } catch (error) {
      log.error('Visitor', `Failed to save product from ${url}`, { error: error.message });
      return { visited: true, classified: true, isCoffee: true, error: error.message };
    }
  }

  await saveKnownPage(entityId, url, 'irrelevant', {
    classification: result,
    classifiedAt: now,
    classifiedBy: MODEL,
  });

  return { visited: true, classified: true, isCoffee: false };
}

async function visitAllPages(entityId, urls, accumulator, log = null, platform = 'unknown') {
  const logger = log || globalLogger;
  const results = {
    visited: 0,
    coffeeFound: 0,
    irrelevant: 0,
    errors: 0,
  };

  for (const entry of urls) {
    const url = typeof entry === 'object' ? entry.url : entry;

    const result = await visitAndClassifyPage(entityId, url, accumulator, logger, platform);
    results.visited++;

    if (result.error) {
      results.errors++;
    } else if (result.isCoffee) {
      results.coffeeFound++;
    } else {
      results.irrelevant++;
    }

    await delay(config.crawler.requestDelayMs);
  }

  return results;
}

module.exports = {
  fetchPageContent,
  visitAndClassifyPage,
  visitAllPages,
};
