const cheerio = require('cheerio');
const globalLogger = require('./logger');

const { classifyPage, MODEL } = require('./gptClassifier');
const { saveKnownPage } = require('./knownPages');
const { saveProduct } = require('./productSaver');
const { config } = require('./config');
const { isShopifyProductUrl, fetchShopifyProductJson, mergeGptAndJsonData } = require('./shopifyProduct');
const { fetchHtml, jitteredSleep } = require('./httpClient');
const { detectProductAvailability } = require('./availability');

async function fetchPageContent(url, referer = null) {
  const result = await fetchHtml(url, { 
    timeout: 15000,
    referer,
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error,
    };
  }

  try {
    const $ = cheerio.load(result.data);

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
    const maxClassificationChars = Number(process.env.CLASSIFIER_MAX_CHARS || 6000);
    const truncatedContent = fullContent.substring(0, maxClassificationChars);

    return {
      success: true,
      title,
      content: truncatedContent,
      fullLength: contentLength,
      html: result.data,
      status: result.status,
      finalUrl: result.finalUrl || url,
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

  await jitteredSleep(GPT_DELAY_MS);

  const classification = await classifyPage(fetchResult.content, url);

  if (classification.error) {
    log.warn('Visitor', `Classification error for ${url}`, { error: classification.error });
    return {
      visited: true,
      classified: false,
      error: classification.error,
      quotaExceeded: classification.quotaExceeded,
    };
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

      const availability = detectProductAvailability({
        html: fetchResult.html,
        status: fetchResult.status,
        sourceUrl: url,
        finalUrl: fetchResult.finalUrl,
        shopifyProduct: shopifyJson?.success ? shopifyJson.raw : null,
        allowPriceOnly: true,
      });
      
      const productId = await saveProduct(entityId, productToSave, url, log, { availability });
      
      await saveKnownPage(entityId, url, 'coffee', {
        classification: result,
        shopifyJson: shopifyJson?.success ? shopifyJson.data : null,
        availability,
        classifiedAt: now,
        classifiedBy: MODEL,
      });

      log.success('Visitor', `Found coffee: ${productToSave.name}`);
      return {
        visited: true,
        classified: true,
        isCoffee: true,
        product: productToSave,
        productId,
        availability,
      };
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
      if (result.quotaExceeded) {
        logger.error('Visitor', 'Stopping page classification because OpenAI quota is exhausted');
        break;
      }
    } else if (result.isCoffee) {
      results.coffeeFound++;
    } else {
      results.irrelevant++;
    }

    await jitteredSleep(config.crawler.requestDelayMs);
  }

  return results;
}

module.exports = {
  fetchPageContent,
  visitAndClassifyPage,
  visitAllPages,
};
