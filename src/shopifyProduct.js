const axios = require('axios');
const https = require('https');
const globalLogger = require('./logger');

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

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

  try {
    const response = await axios.get(jsonUrl, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CoffeeCrawler/1.0)',
        'Accept': 'application/json',
      },
      httpsAgent,
    });

    if (!response.data || !response.data.product) {
      return { success: false, error: 'Invalid product JSON response' };
    }

    const product = response.data.product;
    logger.info('ShopifyJSON', `Fetched product: ${product.title}`);

    return {
      success: true,
      data: parseShopifyProduct(product),
      raw: product,
    };
  } catch (error) {
    logger.warn('ShopifyJSON', `Failed to fetch: ${jsonUrl}`, { error: error.message });
    return { success: false, error: error.message };
  }
}

function parseShopifyProduct(product) {
  const variants = (product.variants || []).map(v => ({
    title: v.title,
    price: v.price,
    priceCents: Math.round(parseFloat(v.price) * 100),
    weight: v.weight,
    weightUnit: v.weight_unit,
    sku: v.sku,
    available: v.available,
    compareAtPrice: v.compare_at_price,
  }));

  const images = (product.images || []).map(img => ({
    src: img.src,
    alt: img.alt || product.title,
  }));

  const mainImage = images.length > 0 ? images[0].src : null;

  return {
    title: product.title,
    handle: product.handle,
    description: product.body_html || '',
    descriptionText: stripHtml(product.body_html || ''),
    vendor: product.vendor,
    productType: product.product_type,
    tags: product.tags ? product.tags.split(', ') : [],
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
