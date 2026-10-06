const cheerio = require('cheerio');
const globalLogger = require('./logger');

const { classifyPage, MODEL } = require('./gptClassifier');
const { saveKnownPage } = require('./knownPages');
const { extractPage } = require('./extraction');
const { canonicalProductUrl } = require('./catalogNormalization');
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
      status: result.status,
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
    const maxClassificationChars = Number(process.env.CLASSIFIER_MAX_CHARS || 15000);
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

function isClearlyNonCoffeeProduct(product) {
  const name = String(product?.name || '').trim();

  return /\b(?:green coffee|rohkaffee)\b/i.test(name)
    || /^cascara(?:\b|[\s,–—-])/i.test(name)
    || /^hibiscus(?:\b|[\s,–—-])/i.test(name)
    || /\bflor de jamaica\b/i.test(name);
}

async function processFetchedPage(entityId, url, fetchResult, log, platform='unknown', options={}) {
  const known=options.knownPage;
  if (!fetchResult.success) {
    if ([404,410].includes(fetchResult.status) && known?.status==='coffee' && known.classification?.product) {
      const availability=detectProductAvailability({status:fetchResult.status,sourceUrl:url});
      const productId=await saveProduct(entityId,known.classification.product,url,log,{availability});
      options.observed?.set(canonicalProductUrl(url),availability);
      return {visited:true,classified:false,isCoffee:true,productId,availability,aiCalls:0};
    }
    return {visited:true,classified:false,error:fetchResult.error,aiCalls:0};
  }
  let shopifyJson=null;
  if(platform==='shopify' && isShopifyProductUrl(url)) shopifyJson=await fetchShopifyProductJson(url,log);
  const classification=await extractPage({page:{...fetchResult,url},shopifyJson,cache:known?.classification,classify:classifyPage,model:MODEL});
  const metrics={aiCalls:classification.aiCalls || 0,usage:classification.usage,mode:classification.mode};
  if(classification.error) return {visited:true,classified:false,error:classification.error,quotaExceeded:classification.quotaExceeded,...metrics};
  const result=classification.data;
  const now=new Date().toISOString();
  const coffee=result.is_coffee_page===true && result.product && !isClearlyNonCoffeeProduct(result.product);
  let productId, availability;
  try {
  if(coffee) {
    availability=detectProductAvailability({html:fetchResult.html,status:fetchResult.status,sourceUrl:url,finalUrl:fetchResult.finalUrl,shopifyProduct:shopifyJson?.success?shopifyJson.raw:null});
    productId=await saveProduct(entityId,result.product,url,log,{availability,checkedAt:now});
    if(!productId) return {visited:true,classified:true,error:'Product persistence skipped',...metrics};
    options.observed?.set(canonicalProductUrl(url),availability);
  }
  await saveKnownPage(entityId,url,coffee?'coffee':'irrelevant',{classification:classification.cache,classifiedAt:classification.cache._extraction.extracted_at,classifiedBy:classification.mode==='structured'?'structured-v1':MODEL,fetchedAt:now,statusCode:fetchResult.status,contentHash:classification.semanticHash,firstSeenAt:known?.first_seen_at,timesSeen:(known?.times_seen || 0)+1});
  return {visited:true,classified:true,isCoffee:Boolean(coffee),product:coffee?result.product:undefined,productId,availability,...metrics};
  } catch(error) { return {visited:true,classified:true,error:error.message,...metrics}; }
}
async function visitAndClassifyPage(entityId,url,accumulator,log,platform='unknown',options={}) {
  const fetchResult=await fetchPageContent(url);
  accumulator.markVisited(url);
  try { return await processFetchedPage(entityId,url,fetchResult,log,platform,options); }
  catch(error) { log.error('Visitor','Page processing failed',{url,error:error.message});return {visited:true,error:error.message}; }
}
function addExtractionMetrics(results,result) {
  results.aiCalls += result.aiCalls || 0;
  results.cacheHits += result.mode==='cache'?1:0;
  results.structuredPages += result.mode==='structured'?1:0;
  results.marketChecks += result.availability?1:0;
  if(result.usage) {
    results.aiUsage.prompt_tokens += result.usage.prompt_tokens || 0;
    results.aiUsage.completion_tokens += result.usage.completion_tokens || 0;
    results.aiUsage.cached_tokens += result.usage.prompt_tokens_details?.cached_tokens || 0;
  } else if(result.aiCalls) results.aiUsage.unreported_calls += result.aiCalls;
}
function extractionMetrics() { return {aiCalls:0,cacheHits:0,structuredPages:0,marketChecks:0,aiUsage:{prompt_tokens:0,completion_tokens:0,cached_tokens:0,unreported_calls:0}}; }

async function visitAllPages(entityId, urls, accumulator, log = null, platform = 'unknown', options={}) {
  const logger = log || globalLogger;
  const results = {
    visited: 0,
    coffeeFound: 0,
    irrelevant: 0,
    errors: 0,
    ...extractionMetrics(),
  };
  const configuredPageConcurrency = Number(process.env.CRAWLER_PAGE_CONCURRENCY || 1);
  const pageConcurrency = Number.isFinite(configuredPageConcurrency)
    ? Math.max(1, Math.floor(configuredPageConcurrency))
    : 1;
  let nextIndex = 0;
  let stopForQuota = false;

  async function worker() {
    while (!stopForQuota) {
      const entryIndex = nextIndex++;
      if (entryIndex >= urls.length) {
        return;
      }

      const entry = urls[entryIndex];
      const url = typeof entry === 'object' ? entry.url : entry;
      const result = await visitAndClassifyPage(entityId, url, accumulator, logger, platform, {...options,knownPage:options.knownPages?.get(url)});
      results.visited++;
      addExtractionMetrics(results,result);

      if (result.error) {
        results.errors++;
        if (result.quotaExceeded) {
          stopForQuota = true;
          logger.error('Visitor', 'Stopping page classification because OpenAI quota is exhausted');
        }
      } else if (result.isCoffee) {
        results.coffeeFound++;
      } else {
        results.irrelevant++;
      }

      if (!stopForQuota) {
        await jitteredSleep(config.crawler.requestDelayMs);
      }
    }
  }

  const workerCount = Math.min(pageConcurrency, Math.max(1, urls.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

module.exports = {
  fetchPageContent,
  processFetchedPage,
  addExtractionMetrics,
  extractionMetrics,
  isClearlyNonCoffeeProduct,
  visitAndClassifyPage,
  visitAllPages,
};
