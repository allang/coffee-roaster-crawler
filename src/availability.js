const { getSupabase } = require('./supabase');
const globalLogger = require('./logger');
const { fetchHtml } = require('./httpClient');
const { isShopifyProductUrl, fetchShopifyProductJson } = require('./shopifyProduct');

const { productAvailability: detectProductAvailability } = require('./productEvidence');
const { canonicalProductUrl } = require('./catalogNormalization');
function normalizeUrlForComparison(url) { try { return canonicalProductUrl(url); } catch { return null; } }

async function checkProductUrlAvailability(product, platform, logger, options={}) {
  if (!product.source_url) {
    return { checked: true, ...detectProductAvailability({}) };
  }

  const htmlResult = options.fetchPage?await options.fetchPage(product.source_url):await (options.fetchHtml || fetchHtml)(product.source_url, {
    timeout: 15000,
    useUrlFallback: true,
    maxRetries: 0,
    logger,
  });

  if (!htmlResult.success && ![404,410].includes(htmlResult.status)) {
    return {
      checked: true,
      ...detectProductAvailability({ status:htmlResult.status || 503, sourceUrl:product.source_url }),
    };
  }

  const html=htmlResult.html || htmlResult.data || '',pageState=detectProductAvailability({html,status:htmlResult.status,sourceUrl:product.source_url,finalUrl:htmlResult.finalUrl});
  if(pageState.state==='removed')return {checked:true,...pageState};
  // Fetch the actual page before consulting a native endpoint: cached catalog
  // JSON cannot override a current primary soft 404.
  let shopifyProduct=null;
  if(platform==='shopify' && isShopifyProductUrl(product.source_url)){
    const native=await fetchShopifyProductJson(product.source_url,logger,{fetchJson:options.fetchJson});
    if(native.success)shopifyProduct=native.raw;
  }

  const detection = detectProductAvailability({
    html,
    sourceProduct:htmlResult.sourceProduct,
    status: htmlResult.status,
    sourceUrl: product.source_url,
    finalUrl: htmlResult.finalUrl,
    shopifyProduct,
    allowPriceOnly: true,
  });

  return { checked: true, ...detection };
}

function isMissingAvailabilitySchemaError(error) {
  const message = error?.message || '';
  return (
    error?.code === '42703' ||
    error?.code === 'PGRST204' ||
    /is_available|availability_checked_at|availability_last_seen_at|availability_reason/i.test(message)
  );
}

async function updateProductAvailability(productId, availability, checkedAt, log = null) {
  if (!productId || !availability) return { updated: false };

  const logger = log || globalLogger;
  const supabase = getSupabase();
  const timestamp = checkedAt || new Date().toISOString();
  const observation = {...availability,checkedAt:timestamp};
  const { error } = await supabase.rpc('update_catalog_availability_v1',{product_id:productId,observation});

  if (error) {
    if (isMissingAvailabilitySchemaError(error)) {
      logger.warn('Availability', 'Availability columns are not present yet; product availability update skipped');
      return { updated: false, schemaReady: false };
    }
    throw error;
  }

  return { updated: true, schemaReady: true };
}

async function reconcileRoasterAvailability(options) {
  const {
    entityId,
    surfaceUrls,
    platform = 'unknown',
    checkedAt = new Date().toISOString(),
    log = null,
  } = options || {};
  const logger = log || globalLogger;

  if (!entityId) {
    throw new Error('entityId is required for availability reconciliation');
  }

  if (!Array.isArray(surfaceUrls) || surfaceUrls.length === 0) {
    logger.warn('Availability', 'No completed inventory surface URLs; skipping reconciliation');
    return { skipped: true, reason: 'empty_inventory_surface' };
  }

  const supabase = getSupabase();
  const { data: products, error } = await supabase
    .from('products')
    .select('id,name,source_url')
    .eq('entity_id', entityId)
    .eq('product_type', 'coffee')
    .eq('is_active', true);

  if (error) {
    logger.error('Availability', 'Failed to fetch roaster products', { error: error.message });
    throw error;
  }

  const observed = options.observed || new Map();
  const result = { checked:0,available:0,unavailable:0,unknown:0,removed:0,reused:0,schemaReady:true };
  for (const product of products || []) {
    const known = observed.get(normalizeUrlForComparison(product.source_url));
    // Surface absence alone is not removal evidence; verify an omitted URL before changing state.
    const availability = known || await checkProductUrlAvailability(product, platform, logger,options);
    if (known) { result.reused++; continue; } // Shared extraction already persisted the fresh result.
    if (!availability.checked) continue;
    const update = await updateProductAvailability(product.id,availability,checkedAt,logger);
    if (update.schemaReady === false) return {skipped:true,schemaReady:false};
    result.checked++;
    if (availability.state==='in_stock') result.available++;
    else if (availability.state==='removed') result.removed++;
    else if (availability.state==='sold_out') result.unavailable++;
    else result.unknown++;
  }

  logger.success('Availability', 'Reconciled roaster availability', result);
  return result;
}

module.exports = {
  detectProductAvailability,
  normalizeUrlForComparison,
  reconcileRoasterAvailability,
  updateProductAvailability,
};
