const globalLogger = require('./logger');
const { fetchJson } = require('./httpClient');

function isShopifyProductUrl(url) {
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname;
    return /^\/products\/[^\/]+\/?$/.test(path) || /^\/[a-z]{2}(-[a-z]{2})?\/products\/[^\/]+\/?$/i.test(path);
  } catch {
    return false;
  }
}

function getProductJsonUrl(url) {
  try {
    const urlObj = new URL(url);
    let path = urlObj.pathname;
    
    path = path.replace(/\/$/, '');
    
    if (!path.endsWith('.json')) {
      path = path + '.json';
    }
    
    urlObj.pathname = path;
    urlObj.search = '';
    return urlObj.toString();
  } catch {
    return null;
  }
}

async function fetchShopifyProductJson(url, log = null) {
  const logger = log || globalLogger;
  const jsonUrl = getProductJsonUrl(url);
  
  if (!jsonUrl) {
    return { success: false, error: 'Could not construct JSON URL' };
  }

  const result = await fetchJson(jsonUrl, {
    timeout: 15000,
    referer: url,
  });

  if (!result.success) {
    logger.warn('ShopifyJSON', `Failed to fetch: ${jsonUrl}`, { error: result.error });
    return { success: false, error: result.error };
  }

  if (!result.data || !result.data.product) {
    return { success: false, error: 'Invalid product JSON response' };
  }

  const product = result.data.product;
  logger.info('ShopifyJSON', `Fetched product: ${product.title}`);

  return {
    success: true,
    data: parseShopifyProduct(product),
    raw: product,
  };
}

function parseShopifyProduct(product) {
  const variants = (product.variants || []).map(v => ({
    id: v.id == null ? null : String(v.id),
    title: v.title,
    price: v.price,
    priceCents: Math.round(parseFloat(v.price) * 100),
    weight: v.weight,
    weightUnit: v.weight_unit,
    sku: v.sku,
    available: v.available,
    compareAtPrice: v.compare_at_price,
    currency: product.currency || null,
    weightGrams: v.grams ?? (v.weight_unit === 'g' ? v.weight : v.weight_unit === 'kg' ? Math.round(v.weight * 1000) : null),
  }));

  const images = (product.images || []).map(img => ({
    src: img.src,
    alt: img.alt || product.title,
  }));

  const mainImage = images.length > 0 ? images[0].src : null;

  return {
    id: product.id == null ? null : String(product.id),
    currency: product.currency || null,
    title: product.title,
    handle: product.handle,
    description: product.body_html || '',
    descriptionText: stripHtml(product.body_html || ''),
    vendor: product.vendor,
    productType: product.product_type,
    tags: Array.isArray(product.tags) ? product.tags : product.tags ? product.tags.split(/,\s*/) : [],
    variants,
    images,
    mainImage,
    createdAt: product.created_at,
    updatedAt: product.updated_at,
  };
}

function stripHtml(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mergeGptAndJsonData(gptProduct, jsonData) {
  if (!jsonData || !jsonData.success) {
    return gptProduct;
  }

  const json = jsonData.data;

  const variantPrices = json.variants.map(v => [v.title, v.price]);

  const gptAttributes = gptProduct.attributes || {};
  
  const merged = {
    ...gptProduct,
    name: json.title || gptProduct.name,
    default_price: json.variants.length > 0 ? json.variants[0].price : gptProduct.default_price,
    variant_prices: variantPrices.length > 0 ? variantPrices : gptProduct.variant_prices,
    variant_price_currency: json.currency || gptProduct.variant_price_currency || null,
    variants: json.variants.map(v => ({ source_id:v.id, title:v.title, price:v.price, currency:json.currency || gptProduct.variant_price_currency || null, available:v.available, weight_g:v.weightGrams, sku:v.sku, locale:'en-US' })),
    variants_complete: true,
    description_html: json.description || null,
    description_raw: json.descriptionText || null,
    attributes: {
      ...gptAttributes,
      product_image_url: json.mainImage || gptAttributes.product_image_url,
      original_description: json.descriptionText || gptAttributes.original_description,
      vendor: json.vendor || gptAttributes.vendor,
      tags: json.tags && json.tags.length > 0 ? json.tags : gptAttributes.tags,
    },
  };

  return merged;
}

module.exports = {
  isShopifyProductUrl,
  getProductJsonUrl,
  fetchShopifyProductJson,
  parseShopifyProduct,
  mergeGptAndJsonData,
  stripHtml,
};
