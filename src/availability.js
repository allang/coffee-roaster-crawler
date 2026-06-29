const { getSupabase } = require('./supabase');
const globalLogger = require('./logger');
const { fetchHtml } = require('./httpClient');
const { isShopifyProductUrl, fetchShopifyProductJson } = require('./shopifyProduct');

const UNAVAILABLE_TEXT_PATTERNS = [
  /\bsold\s*out\b/i,
  /\bout\s*of\s*stock\b/i,
  /\bunavailable\b/i,
  /\bnotify\s*me\b/i,
  /\bcoming\s*soon\b/i,
];

const BUY_BUTTON_TEXT_PATTERNS = [
  /\badd\s*to\s*cart\b/i,
  /\badd\s*to\s*bag\b/i,
  /\bbuy\s*now\b/i,
  /\bpurchase\b/i,
  /\bcheckout\b/i,
];

const PRICE_PATTERN = /(?:[$€£¥]\s?\d|\d+(?:[.,]\d{2})?\s?(?:usd|eur|gbp|cad|aud|jpy))/i;

function normalizeText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUrlForComparison(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.search = '';
    parsed.hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.toString();
  } catch {
    return null;
  }
}

function redirectsAwayFromProduct(sourceUrl, finalUrl) {
  if (!sourceUrl || !finalUrl) return false;

  try {
    const source = new URL(sourceUrl);
    const final = new URL(finalUrl);
    const sourcePath = source.pathname.replace(/\/+$/, '') || '/';
    const finalPath = final.pathname.replace(/\/+$/, '') || '/';

    if (source.hostname.replace(/^www\./i, '') !== final.hostname.replace(/^www\./i, '')) {
      return false;
    }

    if (sourcePath === finalPath) {
      return false;
    }

    return /\/products?\//i.test(sourcePath) && !/\/products?\//i.test(finalPath);
  } catch {
    return false;
  }
}

function detectStructuredDataAvailability(html) {
  const availabilityMatches = Array.from(
    String(html || '').matchAll(/"availability"\s*:\s*"([^"]+)"/gi)
  ).map((match) => match[1].toLowerCase());

  if (availabilityMatches.some((value) => value.includes('instock'))) {
    return { isAvailable: true, reason: 'structured_data_in_stock' };
  }

  if (
    availabilityMatches.length > 0 &&
    availabilityMatches.every((value) => !value.includes('instock'))
  ) {
    return { isAvailable: false, reason: 'structured_data_not_in_stock' };
  }

  return null;
}

function getShopifyVariantAvailability(input) {
  const variants = input?.shopifyProduct?.variants;
  if (Array.isArray(variants) && variants.length > 0) {
    return variants.map((variant) => variant.available === true);
  }

  return Array.from(
    String(input?.html || '').matchAll(/"available"\s*:\s*(true|false)/gi)
  ).map((match) => match[1] === 'true');
}

function detectShopifyVariantAvailability(input) {
  const availabilityMatches = getShopifyVariantAvailability(input);

  if (availabilityMatches.some(Boolean)) {
    return { isAvailable: true, reason: 'shopify_variant_available' };
  }

  if (availabilityMatches.length > 0) {
    return { isAvailable: false, reason: 'shopify_variants_unavailable' };
  }

  return null;
}

function getBuyControls(html) {
  const controls = [
    ...String(html || '').match(/<button[\s\S]*?<\/button>/gi) ?? [],
    ...String(html || '').match(/<input[^>]+(?:type=["']?(?:submit|button)["']?)[^>]*>/gi) ?? [],
    ...String(html || '').match(/<a[^>]+href=["'][^"']*(?:cart|checkout)[^"']*["'][\s\S]*?<\/a>/gi) ?? [],
  ];

  return controls.map((controlHtml) => ({
    html: controlHtml,
    text: normalizeText(controlHtml),
    disabled:
      /\sdisabled(?:\s|>|=)/i.test(controlHtml) ||
      /aria-disabled=["']true["']/i.test(controlHtml) ||
      /class=["'][^"']*\bdisabled\b/i.test(controlHtml),
  }));
}

function hasDisabledBuyButton(html) {
  return getBuyControls(html).some((control) => (
    BUY_BUTTON_TEXT_PATTERNS.some((pattern) => pattern.test(control.text)) &&
    control.disabled
  ));
}

function hasEnabledBuyButton(html) {
  return getBuyControls(html).some((control) => (
    BUY_BUTTON_TEXT_PATTERNS.some((pattern) => pattern.test(control.text)) &&
    !control.disabled
  ));
}

function detectProductAvailability(input = {}) {
  const status = input.status ?? 200;
  if (status === 404 || status === 410) {
    return { isAvailable: false, reason: 'product_url_unreachable' };
  }

  if (redirectsAwayFromProduct(input.sourceUrl, input.finalUrl)) {
    return { isAvailable: false, reason: 'product_url_redirected_away' };
  }

  const html = input.html || '';
  if (!String(html).trim() && !input.shopifyProduct) {
    return { isAvailable: false, reason: 'empty_product_html' };
  }

  const structuredDataResult = detectStructuredDataAvailability(html);
  if (structuredDataResult) {
    return structuredDataResult;
  }

  const shopifyResult = detectShopifyVariantAvailability(input);
  if (shopifyResult) {
    return shopifyResult;
  }

  const text = normalizeText(html);
  if (UNAVAILABLE_TEXT_PATTERNS.some((pattern) => pattern.test(text))) {
    return { isAvailable: false, reason: 'unavailable_text' };
  }

  if (hasDisabledBuyButton(html)) {
    return { isAvailable: false, reason: 'buy_button_disabled' };
  }

  if (hasEnabledBuyButton(html)) {
    return { isAvailable: true, reason: 'buy_button_enabled' };
  }

  if (input.allowPriceOnly && PRICE_PATTERN.test(text) && !input.requireBuyButton) {
    return { isAvailable: true, reason: 'price_without_unavailable_signal' };
  }

  return { isAvailable: false, reason: 'buy_signal_missing' };
}

function isIncompleteFetch(result) {
  if (!result || result.success) return false;
  if (result.status === 404 || result.status === 410) return false;
  return ['blocked', 'rate_limited', 'timeout', 'dns', 'network', 'transient_http'].includes(
    result.failureCategory
  );
}

async function checkProductUrlAvailability(product, platform, logger) {
  if (!product.source_url) {
    return { checked: true, isAvailable: false, reason: 'missing_source_url' };
  }

  let shopifyProduct = null;
  if (platform === 'shopify' && isShopifyProductUrl(product.source_url)) {
    const shopifyJson = await fetchShopifyProductJson(product.source_url, logger);
    if (shopifyJson.success) {
      shopifyProduct = shopifyJson.raw;
    }
  }

  const htmlResult = await fetchHtml(product.source_url, {
    timeout: 15000,
    useUrlFallback: true,
    maxRetries: 0,
    logger,
  });

  if (isIncompleteFetch(htmlResult)) {
    return {
      checked: false,
      reason: `availability_check_incomplete_${htmlResult.failureCategory || 'unknown'}`,
    };
  }

  const detection = detectProductAvailability({
    html: htmlResult.data || '',
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
  const updates = {
    is_available: availability.isAvailable === true,
    availability_checked_at: timestamp,
    availability_reason: availability.isAvailable === true ? null : availability.reason,
  };

  if (availability.isAvailable === true) {
    updates.availability_last_seen_at = timestamp;
  }

  const { error } = await supabase
    .from('products')
    .update(updates)
    .eq('id', productId);

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

  const normalizedSurfaceUrls = new Set(
    surfaceUrls
      .map(normalizeUrlForComparison)
      .filter(Boolean)
  );

  const availableIds = [];
  const unavailableReasons = new Map();
  let skippedChecks = 0;

  for (const product of products || []) {
    const normalizedSourceUrl = normalizeUrlForComparison(product.source_url);

    if (!normalizedSourceUrl || !normalizedSurfaceUrls.has(normalizedSourceUrl)) {
      unavailableReasons.set(product.id, 'not_seen_in_successful_crawl');
      continue;
    }

    const availability = await checkProductUrlAvailability(product, platform, logger);
    if (!availability.checked) {
      skippedChecks++;
      logger.warn('Availability', `Skipped availability update for ${product.name}`, {
        reason: availability.reason,
        sourceUrl: product.source_url,
      });
      continue;
    }

    if (availability.isAvailable) {
      availableIds.push(product.id);
    } else {
      unavailableReasons.set(product.id, availability.reason);
    }
  }

  if (availableIds.length > 0) {
    const { error: availableError } = await supabase
      .from('products')
      .update({
        is_available: true,
        availability_checked_at: checkedAt,
        availability_last_seen_at: checkedAt,
        availability_reason: null,
      })
      .in('id', availableIds);

    if (availableError) {
      if (isMissingAvailabilitySchemaError(availableError)) {
        logger.warn('Availability', 'Availability columns are not present yet; reconciliation skipped');
        return { skipped: true, schemaReady: false };
      }
      throw availableError;
    }
  }

  const idsByReason = new Map();
  for (const [productId, reason] of unavailableReasons.entries()) {
    if (!idsByReason.has(reason)) idsByReason.set(reason, []);
    idsByReason.get(reason).push(productId);
  }

  for (const [reason, productIds] of idsByReason.entries()) {
    const { error: unavailableError } = await supabase
      .from('products')
      .update({
        is_available: false,
        availability_checked_at: checkedAt,
        availability_reason: reason,
      })
      .in('id', productIds);

    if (unavailableError) {
      if (isMissingAvailabilitySchemaError(unavailableError)) {
        logger.warn('Availability', 'Availability columns are not present yet; reconciliation skipped');
        return { skipped: true, schemaReady: false };
      }
      throw unavailableError;
    }
  }

  const result = {
    checked: (products || []).length,
    available: availableIds.length,
    unavailable: unavailableReasons.size,
    skipped: skippedChecks,
    schemaReady: true,
  };

  logger.success('Availability', 'Reconciled roaster availability', result);
  return result;
}

module.exports = {
  detectProductAvailability,
  normalizeUrlForComparison,
  reconcileRoasterAvailability,
  updateProductAvailability,
};
