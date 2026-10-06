'use strict';
const cheerio = require('cheerio');
const { stableKey } = require('./catalogNormalization');
const { structuredProduct, sameProduct } = require('./productEvidence');
const EXTRACTION_VERSION = 'extract-v1';
const CACHE_TTL_MS = 7 * 86400_000;
const ATTRIBUTES = ['origin_type','country_of_origin','origin_region','is_decaf','varietal','process','flavor_notes','grind_size_offered','altitude','brew_as','roast_darkness','producer','description','short_description','nano_description','harvest_date','product_image_url'];
const PROPERTY_ALIASES = { origin:'country_of_origin', country:'country_of_origin', region:'origin_region', variety:'varietal', processing:'process', processing_method:'process', tasting_notes:'flavor_notes', roast_level:'roast_darkness', elevation:'altitude', decaf:'is_decaf' };
function stripHtml(html) { const $ = cheerio.load(html || ''); return $.text().replace(/\s+/g,' ').trim(); }

function structuredExtraction(page, shopifyJson) {
  const schema = structuredProduct(page.html, page.finalUrl || page.url);
  const native = shopifyJson?.success ? shopifyJson.data : null;
  const name = native?.title || schema?.name;
  if (!name) return { product:null, complete:false, semantic:null };
  const attributes = {};
  for (const p of [schema?.additionalProperty || []].flat()) {
    const key = String(p?.name || p?.propertyID || '').trim().toLowerCase().replace(/[\s-]+/g,'_');
    const mapped = PROPERTY_ALIASES[key] || key;
    if (ATTRIBUTES.includes(mapped)) attributes[mapped] = p.value;
  }
  const image = native?.mainImage || [schema?.image].flat()[0];
  if (image) attributes.product_image_url = typeof image === 'string' ? image : image.url;
  const descriptionHtml = native?.description || schema?.description || '';
  const description = stripHtml(descriptionHtml);
  if (description) { attributes.original_description = description; attributes.description ??= description; }
  if (native?.vendor) attributes.vendor = native.vendor;
  if (native?.tags?.length) attributes.tags = native.tags;
  const offers = [schema?.offers || []].flat().filter(o => o && o['@type'] !== 'AggregateOffer' && o.price != null && (!o.url || sameProduct(o.url,page.finalUrl || page.url)));
  // Amount and currency must come from one proven price source. Page/meta currency
  // does not establish the currency of a separate native numeric payload.
  const currency = native ? native.currency || null : offers[0]?.priceCurrency || null;
  const variants = native?.variants?.length ? native.variants.map(v => {
    const matches=offers.filter(o=>{
      let selected=null;try{selected=o.url?new URL(o.url,page.url).searchParams.get('variant'):null;}catch{return false;}
      if(selected!=null)return selected===String(v.id)&&(!o.sku||!v.sku||String(o.sku)===String(v.sku));
      return v.sku && String(o.sku)===String(v.sku) && native.variants.filter(other=>String(other.sku)===String(v.sku)).length===1;
    });
    const paired=!(v.currency || native.currency)&&matches.length===1&&matches[0].priceCurrency?matches[0]:null;
    return { source_id:v.id,title:v.title,price:paired?paired.price:v.price,currency:paired?paired.priceCurrency:v.currency || native.currency || null,price_source:paired?'jsonld_exact_variant_offer':'shopify_product_json',available:v.available,weight_g:v.weightGrams,sku:v.sku,locale:'en-US' };
  }) : offers.map(o => ({ source_id:o.sku || o['@id'] || null, title:o.name || o.sku || 'default', price:o.price, currency:o.priceCurrency || null, availability:require('./productEvidence').schemaAvailability(o.availability), locale:'en-US', source_url:o.url }));
  const product = { name, attributes, variants, variant_prices:variants.map(v=>[v.title,v.price]), variant_price_currency:currency, description_html:descriptionHtml || null, description_raw:description || null, source_product_id:native?.id || schema?.productID || null, variants_complete:native?.variantsComplete===true };
  const coffee = /\b(?:coffee|roasted|espresso)\b/i.test(`${native?.productType || ''} ${schema?.category || ''} ${name} ${description}`) && !/\b(?:green coffee|rohkaffee|cascara|grinder|mug|equipment|gift card)\b/i.test(`${name} ${native?.productType || ''}`);
  // Skip semantic AI only when a source supplies the full attribute contract explicitly.
  // Partial structured data still contributes trustworthy prices/variants and falls back for descriptions/facts.
  const complete = coffee && ATTRIBUTES.filter(k=>k!=='product_image_url').every(k => Object.hasOwn(attributes,k));
  // Structured price/stock changes do not invalidate semantic extraction; description/fact changes do.
  const semantic = { name,descriptionHtml,attributes,nativeTags:native?.tags || [],productType:native?.productType || schema?.category || null };
  return { product, complete, semantic, coffee };
}

function semanticHash(page, structured) {
  const $ = cheerio.load(page.html || '');
  $('script,style,nav,footer,header,noscript,iframe,form#product-form,form[data-primary-product], [itemprop="price"], [itemprop="availability"], .price, .stock').remove();
  return stableKey(structured.semantic,$('title').text(),$('body').text().replace(/\s+/g,' ').trim());
}
function mergeSourceProduct(extracted, structured) {
  if (!structured.product) {
    const result={...extracted,source_product_id:null,variants_complete:false};
    if(Array.isArray(result.variants))result.variants=result.variants.map(v=>({...v,source_id:null,id:null}));
    return result;
  }
  const source = structured.product;
  const merged = { ...extracted, ...Object.fromEntries(Object.entries(source).filter(([k,v]) => v != null && !(Array.isArray(v) && v.length===0))), attributes:{ ...(extracted.attributes || {}), ...source.attributes } };
  // A native endpoint lacking currency cannot turn an inferred currency into a fact.
  merged.source_product_id=source.source_product_id || null;
  if (source.variants?.length) merged.variant_price_currency = source.variant_price_currency;
  return merged;
}
function validClassification(value) { return value && typeof value === 'object' && (value.is_product === false || value.is_coffee_page === false || (value.is_coffee_page === true && value.product && typeof value.product.name === 'string' && value.product.name.trim())); }

async function extractPage({ page, shopifyJson, cache, classify, model, now = Date.now() }) {
  const structured = structuredExtraction(page,shopifyJson);
  const hash = semanticHash(page,structured);
  const prior = cache?._extraction;
  let data, mode, usage = null, aiCalls = 0;
  const age = now-Date.parse(prior?.extracted_at);
  if (prior?.version===EXTRACTION_VERSION && prior.model===model && prior.semantic_hash===hash && age>=0 && age<CACHE_TTL_MS && validClassification(cache)) {
    data = { ...cache }; delete data._extraction; mode='cache';
  } else if (structured.complete) {
    data = { is_product:true,is_coffee_page:true,product:structured.product }; mode='structured';
  } else {
    const response = await classify(page.content, page.url);
    aiCalls = response.aiCalls ?? (response.skipped ? 0 : 1);
    if (response.error) return { ...response, mode:'ai', aiCalls, semanticHash:hash };
    if (!validClassification(response.data)) return { error:'Invalid extraction classification',mode:'ai',aiCalls,semanticHash:hash,usage:response.usage };
    data = response.data; usage=response.usage || null; mode='ai';
  }
  if (data.product) data = { ...data,product:mergeSourceProduct(data.product,structured) };
  const extraction = { version:EXTRACTION_VERSION,model,semantic_hash:hash,extracted_at:mode==='cache' ? prior.extracted_at : new Date(now).toISOString(),last_market_checked_at:new Date(now).toISOString(),mode,usage };
  return { data,mode,aiCalls,usage,semanticHash:hash,cache:{ ...data,_extraction:extraction },structured };
}

module.exports = { ATTRIBUTES, EXTRACTION_VERSION, CACHE_TTL_MS, structuredExtraction, semanticHash, mergeSourceProduct, extractPage, validClassification };
