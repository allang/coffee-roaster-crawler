const cheerio = require('cheerio');
const globalLogger = require('./logger');

const { classifyPage, MODEL } = require('./gptClassifier');
const { saveKnownPage } = require('./knownPages');
const { getCrawlConcurrency } = require('./crawlConcurrency');
const { extractPage } = require('./extraction');
const { canonicalProductUrl } = require('./catalogNormalization');
const { saveProduct,findExistingProduct,productSourceKey } = require('./productSaver');
const { config } = require('./config');
const { isShopifyProductUrl, fetchShopifyProductJson, mergeGptAndJsonData } = require('./shopifyProduct');
const { fetchHtml, jitteredSleep } = require('./httpClient');
const { detectProductAvailability,updateProductAvailability } = require('./availability');
const {urlRoute,pageRoute}=require('./aiPageRouting');
const budget=require('./crawlBudget');

async function fetchPageContent(url, referer = null, options = {}) {
  const result = await (options.fetchHtml || fetchHtml)(url, {
    timeout: 15000,
    referer,
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error,
      status: result.status,
      retryStopped: result.retryStopped,
      cooldown: result.cooldown,
      merchantCooldownExceeded: result.merchantCooldownExceeded,
      cooldownRecovery: result.cooldownRecovery,
    };
  }

  try {
    const $ = cheerio.load(result.data);

    // Shopyflow's static Webflow shell includes a hidden cart with fake titles,
    // prices and images. It is not evidence for the page's primary product.
    const hasShopyflowCart = $('[sf-cart-popup]').length > 0 && $('script[data-shop-id]').length > 0;
    $('[sf-cart-popup]').remove();
    const evidenceHtml = $.html();
    const primaryProduct = require('./productEvidence').structuredProduct(evidenceHtml,result.finalUrl || url);
    const storefrontShell = hasShopyflowCart && !primaryProduct;
    // A Squarespace native product listing contains real coffee cards, but those
    // cards never identify the listing itself as a purchasable coffee.
    const productLists = $('[data-controller="ProductList"]').filter((_,el)=>!$(el).parents('aside,nav,header,footer,.related-products,.recommendations').length);
    const nativeProductPage = $('article[data-item-id] h1.product-title').length===1;
    const squarespacePage = $('body').hasClass('sqs-seven-one');
    const catalogListing = !primaryProduct && !nativeProductPage && (productLists.length>0 || squarespacePage);

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

    let sourceProduct=null;
    const soft404=detectProductAvailability({html:result.data,status:result.status,sourceUrl:url,finalUrl:result.finalUrl}).reason==='product_soft_404';
    if(!soft404 && options.siteProfile?.adapter==='square'){sourceProduct=await require('./siteSupport/square').fetchSquareProduct(result.data,result.finalUrl || url,options.siteProfile,options.fetchHtml || fetchHtml);}
    if(!soft404 && options.siteProfile?.adapter==='subbly'){sourceProduct=await require('./siteSupport/subbly').fetchSubblyProduct(result.data,result.finalUrl || url,options.siteProfile,options.fetchHtml || fetchHtml);}
    if(!soft404 && options.siteProfile?.adapter==='nuxt_shopify'){sourceProduct=await require('./siteSupport/nuxtShopify').fetchNuxtShopifyProduct(result.data,result.finalUrl || url,options.siteProfile,options.fetchHtml || fetchHtml);}
    if(!soft404 && options.siteProfile?.adapter==='imweb'){sourceProduct=await require('./siteSupport/imweb').fetchImwebProduct(result.data,result.finalUrl || url,options.siteProfile,options.fetchHtml || fetchHtml);}
    if(!soft404 && options.siteProfile?.adapter==='txt_imweb' && /^\/(?:shop_view|coffeesubscriptions)\/?$/.test(new URL(result.finalUrl || url).pathname) && new URL(result.finalUrl || url).searchParams.has('idx')){sourceProduct=require('./siteSupport/txt').txtProduct(result.data,result.finalUrl || url,options.siteProfile);}
    if(!soft404 && options.siteProfile?.adapter==='woocommerce' && require('./siteSupport/woocommerce').productPathMatches(result.finalUrl || url,options.siteProfile)){sourceProduct=await require('./siteSupport/woocommerce').fetchWooProduct(result.data,result.finalUrl || url,options.siteProfile,options.fetchHtml || fetchHtml);}
    if(!soft404 && options.siteProfile?.adapter==='hydrogen' && /^\/products\/[^/]+\/?$/.test(new URL(result.finalUrl || url).pathname)){sourceProduct=require('./siteSupport/hydrogen').hydrogenProduct(result.data,result.finalUrl || url,options.siteProfile);}
    if(!soft404 && options.siteProfile?.adapter==='wix' && new URL(result.finalUrl || url).pathname.startsWith(options.siteProfile.product_path)){sourceProduct=require('./siteSupport/wix').wixProduct(result.data,result.finalUrl || url,options.siteProfile);}
    if(!soft404 && options.siteProfile?.adapter==='cafe24' && options.siteProfile.cafe24_native_single_items && require('./catalogNormalization').canonicalProductUrl(result.finalUrl || url).includes('/product/detail.html?product_no=')){sourceProduct=await require('./siteSupport/cafe24').fetchCafe24Product(result.data,result.finalUrl || url,options.siteProfile,options.fetchHtml || fetchHtml);}
    if(!soft404 && options.siteProfile?.adapter==='fathers'){sourceProduct=require('./siteSupport/fathers').fathersProduct(result.data,result.finalUrl || url,options.siteProfile);}
    if(!soft404 && options.siteProfile?.adapter==='woocommerce_store'){sourceProduct=await require('./siteSupport/woocommerce').fetchWooProduct(result.data,result.finalUrl || url,options.siteProfile,options.fetchHtml || fetchHtml);}
    if(!soft404 && options.siteProfile?.adapter==='squarespace'){sourceProduct=await require('./siteSupport/squarespace').fetchSquarespaceProduct(result.data,result.finalUrl || url,options.siteProfile,options.fetchHtml || fetchHtml);}
    if(!soft404 && options.siteProfile?.adapter==='naver_smartstore'){sourceProduct=require('./siteSupport/naver').naverProduct(result.data,result.finalUrl || url,options.siteProfile);}
    return {
      success: true,
      sourceProduct,
      nonProductReason: storefrontShell ? 'headless_storefront_shell_without_product_identity' : catalogListing ? 'catalog_listing_without_primary_product' : null,
      title,
      content: sourceProduct?sourceProduct.name+"\n"+sourceProduct.description:truncatedContent,
      fullLength: contentLength,
      html: evidenceHtml,
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
  budget.check();
  const skipped=category=>({visited:true,classified:false,isCoffee:false,aiCalls:0,pageCategory:category,aiSkipped:true,reason:category});
  if(fetchResult.success && fetchResult.nonProductReason)return {...skipped(fetchResult.nonProductReason.includes('listing')?'listing':'storefront_shell'),reason:fetchResult.nonProductReason};
  const known=options.knownPage;
  const pageAvailability=fetchResult.success?detectProductAvailability({html:fetchResult.html,status:fetchResult.status,sourceUrl:url,finalUrl:fetchResult.finalUrl}):null;
  if(pageAvailability?.reason==='product_soft_404') {
    // An unavailable page cannot refresh product sightings or publish cached API
    // stock. Update only the existing product's availability, if identified.
    const source=canonicalProductUrl(url),db=require('./supabase').getSupabase();
    const existing=await findExistingProduct(db,entityId,source,productSourceKey(entityId,null,source));
    if(existing)await updateProductAvailability(existing.id,pageAvailability,null,log);
    options.observed?.set(source,pageAvailability);
    return {visited:true,classified:false,isCoffee:false,availability:pageAvailability,aiCalls:0,unavailable:true};
  }
  if (!fetchResult.success) {
    if ([404,410].includes(fetchResult.status) && known?.status==='coffee' && known.classification?.product) {
      const availability=detectProductAvailability({status:fetchResult.status,sourceUrl:url});
      const source=canonicalProductUrl(url),db=require('./supabase').getSupabase();
      const existing=await findExistingProduct(db,entityId,source,productSourceKey(entityId,null,source));
      // A cached extraction can precede a failed first catalog save. A removal
      // must never create that product or retranslate/rewrite old content.
      if(existing)await updateProductAvailability(existing.id,availability,null,log);
      options.observed?.set(canonicalProductUrl(url),availability);
      return {visited:true,classified:false,isCoffee:false,availability,aiCalls:0,unavailable:true};
    }
    return {visited:true,classified:false,error:fetchResult.error,status:fetchResult.status,retryStopped:fetchResult.retryStopped,cooldown:fetchResult.cooldown,merchantCooldownExceeded:fetchResult.merchantCooldownExceeded,cooldownRecovery:fetchResult.cooldownRecovery,aiCalls:0};
  }
  const early=urlRoute(url);
  if(early.skip && known?.status!=='coffee')return skipped(early.category);
  let shopifyJson=null;
  if((platform==='shopify' || options.siteProfile?.adapter==='shopify') && isShopifyProductUrl(url) && options.siteProfile?.adapter!=='nuxt_shopify') shopifyJson=await fetchShopifyProductJson(url,log,{fetchJson:options.fetchJson});
  if(options.siteProfile?.adapter==='shopify' && !require('./shopifyProduct').verifiedShopifyVariantScope(shopifyJson,url))return {visited:true,classified:false,error:'Registered Shopify source incomplete: '+(shopifyJson?.error || 'incomplete SKU set'),status:shopifyJson?.status,sourceStage:shopifyJson?.sourceStage,retryStopped:shopifyJson?.retryStopped,cooldown:shopifyJson?.cooldown,merchantCooldownExceeded:shopifyJson?.merchantCooldownExceeded,cooldownRecovery:shopifyJson?.cooldownRecovery,aiCalls:0};
  const route=pageRoute({url:fetchResult.finalUrl || url,html:fetchResult.html,sourceProduct:fetchResult.sourceProduct,native:shopifyJson?.success?shopifyJson.data:null});
  if(route.skip)return skipped(route.category);
  const classification=await extractPage({page:{...fetchResult,url},shopifyJson,cache:known?.classification,classify:classifyPage,model:MODEL});
  const metrics={aiCalls:classification.aiCalls || 0,extractionCalls:classification.aiCalls || 0,translationCalls:0,pageCategory:route.category,usage:classification.usage?structuredClone(classification.usage):null,mode:classification.mode};
  (log || globalLogger).info('AIRouting','Product candidate extraction result',{url,category:route.category,mode:classification.mode,aiCalls:metrics.aiCalls});
  if(classification.error) return {visited:true,classified:false,error:classification.error,quotaExceeded:classification.quotaExceeded,...metrics};
  const result=classification.data;
  const now=new Date().toISOString();
  const coffee=result.is_coffee_page===true && result.product && !isClearlyNonCoffeeProduct(result.product);
  if(coffee && shopifyJson?.data?.reviewedAccessorySubset) {
    const normalized=require('./catalogNormalization').normalizeProduct(result.product,url),nativeIds=shopifyJson.data.variants.map(v=>v.id);
    if(normalized.variants_complete!==false || normalized.variants.length!==nativeIds.length || normalized.variants.some(v=>!nativeIds.includes(String(v.source_id)) || v.money.minorUnits==null || !v.money.currency || !['in_stock','sold_out'].includes(v.availability)))return {visited:true,classified:true,error:'Reviewed accessory subset lacks exact current coffee SKU money or stock',...metrics};
  }
  let productId, availability;
  const pageOptions=()=>({classification:classification.cache,classifiedAt:classification.cache._extraction.extracted_at,classifiedBy:classification.mode==='structured_product_only'?'structured-product-only-v1':classification.mode==='structured'?'structured-v1':MODEL,fetchedAt:now,statusCode:fetchResult.status,contentHash:classification.semanticHash,firstSeenAt:known?.first_seen_at,timesSeen:(known?.times_seen || 0)+1});
  let cacheSaved=false;
  async function persistExtraction(){await saveKnownPage(entityId,url,coffee?'coffee':'irrelevant',pageOptions());cacheSaved=true;}
  try {
  if(coffee) {
    // A catalog write or translation failure must not discard paid, validated
    // semantic extraction. This row classifies a page; it does not publish stock
    // or claim that a catalog transaction or complete inventory succeeded.
    if(classification.mode!=='cache')await persistExtraction();
    availability=detectProductAvailability({html:fetchResult.html,sourceProduct:fetchResult.sourceProduct,status:fetchResult.status,sourceUrl:url,finalUrl:fetchResult.finalUrl,shopifyProduct:shopifyJson?.success?shopifyJson.raw:null});
    productId=await saveProduct(entityId,result.product,url,log,{availability,checkedAt:now,preparedTranslation:known?.classification?._prepared_translation,onTranslationPrepared:async prepared=>{
      classification.cache._prepared_translation=prepared;await persistExtraction();
    },onTranslationMetrics:translation=>{
      metrics.aiCalls+=translation.aiCalls || 0;
      metrics.translationCalls+=translation.aiCalls || 0;
      if(translation.usage){metrics.usage ||= {};function add(to,from){for(const [key,value] of Object.entries(from)){if(typeof value==='number')to[key]=(to[key] || 0)+value;else if(value && typeof value==='object')add(to[key] ||= {},value);}}add(metrics.usage,translation.usage);}
    }});
    if(!productId) return {visited:true,classified:true,error:'Product persistence skipped',...metrics};
    options.observed?.set(canonicalProductUrl(url),availability);
  }
  if(!cacheSaved)await persistExtraction();
  return {visited:true,classified:true,isCoffee:Boolean(coffee),product:coffee?result.product:undefined,productId,availability,...metrics};
  } catch(error) { return {visited:true,classified:true,error:error.message,quotaExceeded:error.quotaExceeded,...metrics}; }
}
async function visitAndClassifyPage(entityId,url,accumulator,log,platform='unknown',options={}) {
  budget.check();const route=urlRoute(url);
  if(route.skip && options.knownPage?.status!=='coffee'){accumulator.markVisited(url);return {visited:true,classified:false,isCoffee:false,aiCalls:0,pageCategory:route.category,aiSkipped:true,reason:route.category};}
  const fetchResult=await fetchPageContent(url,null,options);
  accumulator.markVisited(url);
  try { return await processFetchedPage(entityId,url,fetchResult,log,platform,options); }
  catch(error) { log.error('Visitor','Page processing failed',{url,error:error.message});return {visited:true,error:error.message}; }
}
function addExtractionMetrics(results,result) {
  results.aiCalls += result.aiCalls || 0;
  results.cacheHits += result.mode==='cache'?1:0;
  results.structuredPages += ['structured','structured_product_only'].includes(result.mode)?1:0;
  results.structuredProductOnlyPages += result.mode==='structured_product_only'?1:0;
  results.marketChecks += result.availability?1:0;
  results.extractionCalls=(results.extractionCalls || 0)+(result.extractionCalls || 0);
  results.translationCalls=(results.translationCalls || 0)+(result.translationCalls || 0);
  if(result.pageCategory){results.pageCategories ||= {};results.pageCategories[result.pageCategory]=(results.pageCategories[result.pageCategory] || 0)+1;results.aiCallsByCategory ||= {};results.aiCallsByCategory[result.pageCategory]=(results.aiCallsByCategory[result.pageCategory] || 0)+(result.aiCalls || 0);}
  if(result.aiSkipped){results.aiSkipped=(results.aiSkipped || 0)+1;}
  if(result.usage) {
    results.aiUsage.prompt_tokens += result.usage.prompt_tokens || 0;
    results.aiUsage.completion_tokens += result.usage.completion_tokens || 0;
    results.aiUsage.cached_tokens += result.usage.prompt_tokens_details?.cached_tokens || 0;
    results.aiUsage.reasoning_tokens += result.usage.completion_tokens_details?.reasoning_tokens || 0;
    const reported=Number.isInteger(result.usage.reported_calls)?Math.max(0,Math.min(result.aiCalls || 0,result.usage.reported_calls)):1;
    results.aiUsage.unreported_calls += Math.max(0,(result.aiCalls || 0)-reported);
  } else if(result.aiCalls) results.aiUsage.unreported_calls += result.aiCalls;
}
function extractionMetrics() { return {aiCalls:0,cacheHits:0,structuredPages:0,structuredProductOnlyPages:0,marketChecks:0,aiUsage:{prompt_tokens:0,completion_tokens:0,cached_tokens:0,reasoning_tokens:0,unreported_calls:0}}; }

async function visitAllPages(entityId, urls, accumulator, log = null, platform = 'unknown', options={}) {
  const logger = log || globalLogger;
  const results = {
    visited: 0,
    coffeeFound: 0,
    irrelevant: 0,
    errors: 0,
    ...extractionMetrics(),
  };
  const { pagesPerRoaster: pageConcurrency } = getCrawlConcurrency();
  let nextIndex = 0;
  let stopForQuota = false;
  let stopForMerchant = false;

  async function worker() {
    while (!stopForQuota && !stopForMerchant && !budget.expired()) {
      const entryIndex = nextIndex++;
      if (entryIndex >= urls.length) {
        return;
      }

      const entry = urls[entryIndex];
      const url = typeof entry === 'object' ? entry.url : entry;
      let result;
      try{result=await visitAndClassifyPage(entityId,url,accumulator,logger,platform,{...options,knownPage:options.knownPages?.get(url)});}
      catch(error){if(budget.expired())break;throw error;}
      results.visited++;
      addExtractionMetrics(results,result);

      if (result.error) {
        results.errors++;
        const blocked=options.getMerchantCooldownFailure?.();
        if(blocked)Object.assign(result,{merchantCooldownExceeded:true,cooldown:blocked.cooldown,cooldownRecovery:blocked.cooldownRecovery,retryStopped:blocked.retryStopped});
        logger.error('Visitor','Page returned an error',{url,error:result.error,status:result.status,sourceStage:result.sourceStage,retryStopped:result.retryStopped,cooldown:result.cooldown,cooldownRecovery:result.cooldownRecovery});
        if(result.merchantCooldownExceeded) {
          stopForMerchant=true;
          logger.warn('Visitor','Stopping merchant inventory after bounded cooldown recovery; remaining pages stay unverified');
        }
        if (result.quotaExceeded) {
          stopForQuota = true;
          logger.error('Visitor', 'Stopping page classification because OpenAI quota is exhausted');
        }
      } else if (result.isCoffee) {
        results.coffeeFound++;
      } else {
        results.irrelevant++;
      }

      if (!stopForQuota && !stopForMerchant) {
        await jitteredSleep(config.crawler.requestDelayMs);
      }
    }
  }

  const workerCount = Math.min(pageConcurrency, Math.max(1, urls.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if(stopForMerchant || budget.expired()) {results.deferredPages=Math.max(0,urls.length-results.visited);results.inventoryComplete=false;results.merchantCooldownExceeded=stopForMerchant;results.budgetExceeded=budget.expired();}

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
