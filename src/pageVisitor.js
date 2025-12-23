const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('./logger');
const { classifyPage, MODEL } = require('./gptClassifier');
const { saveKnownPage } = require('./knownPages');
const { saveProduct } = require('./productSaver');
const { delay } = require('./sitemap');
const { config } = require('./config');

async function fetchPageContent(url) {
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CoffeeCrawler/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    const $ = cheerio.load(response.data);

    $('script, style, nav, footer, header, noscript, iframe').remove();

    const title = $('title').text().trim();
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();

    const contentLength = bodyText.length;
    const truncatedContent = bodyText.substring(0, 15000);

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

async function visitAndClassifyPage(entityId, url, accumulator) {
  const fetchResult = await fetchPageContent(url);

  if (!fetchResult.success) {
    logger.warn('Visitor', `Failed to fetch: ${url}`, { error: fetchResult.error });
    accumulator.markVisited(url);
    return { visited: true, classified: false, error: fetchResult.error };
  }

  accumulator.markVisited(url);

  await delay(GPT_DELAY_MS);

  const classification = await classifyPage(fetchResult.content, url);

  if (classification.error) {
    logger.warn('Visitor', `Classification error for ${url}`, { error: classification.error });
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
      await saveProduct(entityId, result.product, url);
      
      await saveKnownPage(entityId, url, 'coffee', {
        classification: result,
        classifiedAt: now,
        classifiedBy: MODEL,
      });

      logger.success('Visitor', `Found coffee: ${result.product.name}`);
      return { visited: true, classified: true, isCoffee: true, product: result.product };
    } catch (error) {
      logger.error('Visitor', `Failed to save product from ${url}`, { error: error.message });
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

async function visitAllPages(entityId, urls, accumulator) {
  const results = {
    visited: 0,
    coffeeFound: 0,
    irrelevant: 0,
    errors: 0,
  };

  for (const entry of urls) {
    const url = typeof entry === 'object' ? entry.url : entry;

    const result = await visitAndClassifyPage(entityId, url, accumulator);
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
