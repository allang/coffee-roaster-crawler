const globalLogger = require('./logger');
const { fetchJson } = require('./httpClient');
const cheerio=require('cheerio');
const {jsonLiteral}=require('./siteSupport/jsonLiteral');
const {parseMoney}=require('./catalogNormalization');
const {parseWeightGrams}=require('./product-value-parsers.cjs');
function labelWeight(value) {
  // Roast-date suffixes do not change the explicitly labelled net coffee size.
  value=String(value || '').replace(/\s*-\s*\d{1,2}\/\d{1,2}\s*$/,'');
  // Merchant packaging labels also use gm for gram; never a shipping mass.
  value=String(value || '').replace(/(\d)\s*gm\b/gi,'$1g');
  const direct=parseWeightGrams(value);if(direct!=null)return direct;
  const packaged=value.match(/^\s*(\d+(?:\.\d+)?)\s*(g|kg)\s*\(\s*(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(g|kg)\s+vac\s*seal(?:ed)?\s+pouch(?:es)?\s*\)\s*$/i);
  if(packaged) {
    const total=parseWeightGrams(packaged[1]+packaged[2]),perPouch=parseWeightGrams(packaged[4]+packaged[5]),count=Number(packaged[3]);
    return total && perPouch && count>0 && count<=1000 && total===count*perPouch?total:null;
  }
  const dual=String(value || '').match(/^\s*(\d+(?:\.\d+)?)\s*(oz|lbs?)\s*\(\s*(\d+(?:\.\d+)?)\s*(g|kg)\s*\)\s*$/i) || String(value || '').match(/^\s*(\d+(?:\.\d+)?)\s*(oz|lbs?)\s*\/\s*(\d+(?:\.\d+)?)\s*(g|kg)\s*$/i);
  const reverse=String(value || '').match(/^\s*(\d+(?:\.\d+)?)\s*(g|kg)\s*\(\s*(\d+(?:\.\d+)?)\s*(oz|lbs?)\s*\)\s*$/i) || String(value || '').match(/^\s*(\d+(?:\.\d+)?)\s*(g|kg)\s*\/\s*(\d+(?:\.\d+)?)\s*(oz|lbs?)\s*$/i);
  if(!dual && !reverse)return null;
  const imperial=parseWeightGrams(dual?dual[1]+dual[2]:reverse[3]+reverse[4]),metric=parseWeightGrams(dual?dual[3]+dual[4]:reverse[1]+reverse[2]);
  return imperial && metric && Math.abs(imperial-metric)<=Math.max(2,metric*0.02)?metric:null;
}
function titleNetWeight(product) {
  const title=String(product.title || ''),sizes=[...title.matchAll(/\b(\d+(?:\.\d+)?\s*(?:kg|g|oz|lbs?))\b/gi)];
  if(sizes.length!==1 || /\d\s*(?:x|×)|\d\s*(?:bags?|packs?)\b/i.test(title))return null;
  const suffix=title.match(/(?:^|\s|\()(\d+(?:\.\d+)?\s*(?:kg|g|oz|lbs?))\s*\)?\s*$/i);
  if(!suffix)return null;
  // A size declared in the product title applies to multiple grind variants
  // only when every option is explicitly a grind/preparation choice.
  if(product.variants?.length>1 && (product.variants.some(v=>labelWeight(v.title)!=null) || !Array.isArray(product.options) || !product.options.length || product.options.some(o=>{
    const name=typeof o==='string'?o:o.name;
    const grindValues=Array.isArray(o.values) && o.values.length>0 && o.values.every(v=>/^(?:whole\s*beans?|ground\s+for\s+(?:filter|espresso|french press|aeropress))$/i.test(v));
    return !/^(?:grind|grinding|preparation|form)$/i.test(name) && !grindValues;
  })))return null;
  return labelWeight(suffix[1]);
}

function nativeNetWeight(product,variant) {
  // Size belongs to its native option, independently of grind/roast labels.
  // Shipping grams and ambiguous multi-bag labels cannot establish net mass.
  const sizeOptions=(product.options || []).filter(o=>o && /^(?:size|bag size|pack size|weight|labeled weight|net weight|poids|gewicht|format)$/i.test(String(o.name || '').trim()));
  if(sizeOptions.length){const sizes=sizeOptions.map(o=>{const value=variant['option'+o.position];if(typeof value!=='string' || Array.isArray(o.values) && !o.values.includes(value))return null;const direct=labelWeight(value.replace(/_/g,' '));if(direct!=null)return direct;const encoded=value.match(/^(2good2go(?:_(?:\d{4}|X+))*)_(\d+(?:[.,]\d+)?\s*(?:g|kg|oz|lbs?))$/i);return encoded?labelWeight(encoded[2]):null;});return sizes.length===1?sizes[0]:null;}
  return labelWeight(variant.title) ?? (product.variants.length===1?labelWeight(product.title):null);
}

function exactAnalyticsMarket(html,native) {
  const $=cheerio.load(html || ''),candidates=[];
  $('script:not([src])').each((_,element)=>{
    const script=$(element).text(),currency=script.match(/\bShopifyAnalytics\.meta\.currency\s*=\s*['"]([A-Z]{3})['"]/);
    const start=script.match(/\bvar\s+meta\s*=\s*(?=\{)/);if(!currency || !start)return;
    const meta=jsonLiteral(script,start.index+start[0].length),product=meta?.product;
    if(String(product?.id)!==String(native.id) || product.handle!==native.handle || !Array.isArray(product.variants))return;
    candidates.push({currency:currency[1],variants:product.variants});
  });
  if(candidates.length!==1)return new Map();
  const market=candidates[0],result=new Map();
  for(const variant of native.variants || []) {
    const matches=market.variants.filter(v=>String(v.id)===String(variant.id));
    const money=parseMoney(variant.price,{currency:market.currency,locale:'en-US'});
    // Require the exact variant's declared minor amount to agree with the decimal
    // native payload. A page's general shop currency alone never proves a price.
    if(matches.length===1 && Number.isSafeInteger(matches[0].price) && money.minorUnits===matches[0].price)
      result.set(String(variant.id),{price:variant.price,currency:market.currency,source:'shopify_exact_variant_analytics'});
  }
  return result;
}

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

async function fetchShopifyProductJson(url, log = null, options={}) {
  const logger = log || globalLogger;
  const jsonUrl = getProductJsonUrl(url);
  
  if (!jsonUrl) {
    return { success: false, error: 'Could not construct JSON URL' };
  }

  const fetch=options.fetchJson || fetchJson;
  const result = await fetch(jsonUrl, {
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

  let product = result.data.product;
  const registeredProfile=require('./siteSupport/profiles.json').find(p=>p.adapter==='shopify' && p.hosts.includes(new URL(url).hostname)),registered=Boolean(registeredProfile);
  const handle=decodeURIComponent(new URL(url).pathname.replace(/\/$/,'').split('/').at(-1));
  const identity=v=>typeof v==='number'?Number.isSafeInteger(v)&&v>0:typeof v==='string'&&/^[1-9]\d*$/.test(v);
  if(registered && (product.handle!==handle || !identity(product.id) || !Array.isArray(product.variants) || !product.variants.length || product.variants.some(v=>!identity(v.id)) || new Set(product.variants.map(v=>String(v.id))).size!==product.variants.length))return {success:false,error:'Shopify primary product/variant identity mismatch'};
  // Public product.json may omit sellability. Ajax supplies exact-ID stock flags;
  // its presentment-currency price integers are deliberately not merged here.
  const ajaxUrl=new URL(jsonUrl);ajaxUrl.pathname=ajaxUrl.pathname.replace(/\.json$/,'.js');
  const ajax=await fetch(ajaxUrl.href,{timeout:15000,referer:url});
  product=mergeShopifyStock(product,ajax.success?ajax.data:null);
  const profile=lookupRegisteredProfile(url);
  if(profile?.exclude_variant_title_pattern) {
    const excluded=new RegExp(profile.exclude_variant_title_pattern,'i'),variants=product.variants.filter(v=>!excluded.test(String(v.title || '')));
    if(variants.length!==product.variants.length)product={...product,variants,_variants_complete:false};
  }

  logger.info('ShopifyJSON', `Fetched product: ${product.title}`);

  return {
    success: true,
    data: parseShopifyProduct(product,registeredWeightOptions(url,product)),
    raw: product,
  };
}

function mergeShopifyStock(product,ajax) {
  const matched=ajax && product.id!=null && ajax.id!=null && String(product.id)===String(ajax.id) && Array.isArray(ajax.variants);
  const stocks=new Map(matched?ajax.variants.map(v=>[String(v.id),v]):[]);
  const variants=(product.variants || []).map(v=>{
    const stock=stocks.get(String(v.id));
    return stock && typeof stock.available==='boolean' ? {...v,available:stock.available,_availability_source:'shopify_ajax_product_js'} : {...v};
  });
  const pricedIds=new Set(variants.map(v=>String(v.id)));
  const complete=Boolean(matched && ajax.variants.length<250 && ajax.variants.length===variants.length && new Set(ajax.variants.map(v=>String(v.id))).size===ajax.variants.length && ajax.variants.every(v=>pricedIds.has(String(v.id))));
  return {...product,variants,_variants_complete:complete};
}

function registeredWeightOptions(url,product) {
  const profile=lookupRegisteredProfile(url);
  return {preferLabelWeight:Boolean(profile),singleVariantDescriptionWeight:profile?.single_variant_description_weight===true,netWeightUnproven:profile?.ambiguous_net_weight_handles?.includes(product?.handle),descriptionWeightPrefixes:profile?.description_net_weight_prefixes || [],variantSizePrefix:profile?.variant_size_prefix,variantSizePatterns:profile?.variant_size_patterns,variantPriceSuffix:profile?.variant_price_suffix,fixedRetailBagLabel:profile?.fixed_retail_bag_label,bundleNetWeightProductIds:profile?.bundle_net_weight_product_ids};
}
function lookupRegisteredProfile(url) {return require('./siteSupport/profiles.json').find(p=>p.adapter==='shopify' && p.hosts.includes(new URL(url).hostname));}
function explicitCoffeeWeight(html) {
  const $=cheerio.load(html || ''),weights=[];
  $('p,li').each((_,el)=>{
    const text=$(el).text().trim();
    if(/^(?:net\s*(?:weight)?\s*[:：]?\s*)?\d+(?:\.\d+)?\s*(?:g|kg|oz|lbs?)\s+(?:of\s+)?(?:whole\s*bean|roasted|ground)?\s*coffee\.?$/i.test(text))weights.push(labelWeight(text));
  });
  return weights.length===1?weights[0]:null;
}
function parseShopifyProduct(product,{netWeightUnproven=false,singleVariantDescriptionWeight=false,descriptionWeightPrefixes=[],preferLabelWeight=false,variantSizePrefix=null,variantSizePatterns=[],variantPriceSuffix=false,fixedRetailBagLabel=false,bundleNetWeightProductIds=[]}={}) {
  const bag=fixedRetailBagLabel?String(product.title || '').match(/^Retail Bags\((\d+(?:\.\d+)?g)\) - Garage Sale Drop (\d+\/\d+)$/):null,option=product.options?.length===1?product.options[0]:null;
  const fixedWeight=bag && String(option?.product_id)===String(product.id) && option.name==='Garage Sale '+bag[2]+' Retail bags('+bag[1]+')' && Array.isArray(option.values) && product.variants.every(v=>option.values.includes(v.title))?labelWeight(bag[1]):null;
  const bundleWeight=product.variants?.length===1 && bundleNetWeightProductIds?.includes(String(product.id))?require('./siteSupport/netWeight').coffeeBundleWeight(product.body_html):null;
  const variantWeight=title=>{
    const cleaned=variantPriceSuffix?String(title || '').replace(/\s+-\s+\$\s*\d+(?:\.\d+)?$/,'').replace(/\s+-\s+(?=\d+(?:\.\d+)?\s*(?:g|kg|oz|lbs?)$)/i,' '):title;
    const direct=labelWeight(cleaned);if(direct!=null)return direct;
    const patterns=[...(Array.isArray(variantSizePatterns)?variantSizePatterns:[])];
    if(typeof variantSizePrefix==='string' && /^[A-Z]+$/.test(variantSizePrefix))patterns.push('^'+variantSizePrefix+'-[0-9]+(?:\\.[0-9]+)?\\s+[-–—]\\s+(.+)$');
    for(const pattern of patterns){const suffix=String(title || '').match(new RegExp(pattern))?.[1],weight=suffix?require('./siteSupport/shopifyPageFields').sizeLabel(suffix):null;if(weight!=null)return weight;}
    return null;
  };
  const variants = (product.variants || []).map(v => ({
    id: v.id == null ? null : String(v.id),
    title: v.title,
    price: v.price,
    priceCents: Math.round(parseFloat(v.price) * 100),
    weight: v.weight,
    weightUnit: v.weight_unit,
    sku: v.sku,
    available: v.available,
    availabilitySource:v._availability_source || 'shopify_product_json',
    compareAtPrice: v.compare_at_price,
    currency: product.currency || null,
    weightGrams: netWeightUnproven?null:preferLabelWeight?(variantWeight(v.title) ?? fixedWeight ?? bundleWeight ?? nativeNetWeight(product,v) ?? titleNetWeight(product) ?? (product.variants.length===1?labelWeight(product.title) ?? require('./siteSupport/netWeight').explicitNetWeight(product.body_html,product.title,descriptionWeightPrefixes) ?? (singleVariantDescriptionWeight?explicitCoffeeWeight(product.body_html):null):null)):(v.grams ?? (v.weight_unit === 'g' ? v.weight : v.weight_unit === 'kg' ? Math.round(v.weight * 1000) : null)),
    shippingWeightGrams:v.grams ?? null,
  }));

  const images = (product.images || []).map(img => ({
    src: typeof img==='string'?img:img?.src || img?.url || img?.contentUrl,
    alt: img?.alt || product.title,
  })).filter(img=>typeof img.src==='string' && img.src.trim());

  const primary=product.image || product.featured_image;
  const mainImage=(typeof primary==='string'?primary:primary?.src || primary?.url || primary?.contentUrl) || images[0]?.src || null;

  return {
    id: product.id == null ? null : String(product.id),
    variantsComplete: product._variants_complete===true,
    currency: product.currency || null,
    title: product.title,
    handle: product.handle,
    description: product.body_html || '',
    descriptionText: stripHtml(product.body_html || ''),
    vendor: product.vendor,
    productType: product.product_type,
    tags: Array.isArray(product.tags) ? product.tags : product.tags ? product.tags.split(/,\s*/) : [],
    variants,
    options:(product.options || []).filter(o=>String(o.product_id)===String(product.id)).map(o=>({name:o.name,values:o.values})),
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
    variant_price_currency: json.currency || null,
    variants: json.variants.map(v => ({ source_id:v.id, title:v.title, price:v.price, currency:v.currency || json.currency || null, available:v.available, weight_g:v.weightGrams, sku:v.sku, locale:'en-US' })),
    variants_complete: json.variantsComplete===true,
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
  labelWeight,
  explicitCoffeeWeight,
  titleNetWeight,
  exactAnalyticsMarket,
  mergeShopifyStock,
  isShopifyProductUrl,
  getProductJsonUrl,
  fetchShopifyProductJson,
  parseShopifyProduct,
  mergeGptAndJsonData,
  stripHtml,
};
