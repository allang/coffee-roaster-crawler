'use strict';
const cheerio = require('cheerio');
const { stableKey } = require('./catalogNormalization');
const { structuredProduct, sameProduct, offerVariantId, primaryShopifyPreorders } = require('./productEvidence');
const {processingForProduct,scopedDescription}=require('./coffeeProcessing');
const {primaryProductImage}=require('./productImages');
const EXTRACTION_VERSION = 'extract-v2-processing';
const CACHE_TTL_MS = 7 * 86400_000;
const ATTRIBUTES = ['origin_type','country_of_origin','origin_region','is_decaf','varietal','process','process_methods','is_coferment','coferment_ingredients','flavor_notes','grind_size_offered','altitude','brew_as','roast_darkness','producer','description','short_description','nano_description','harvest_date','product_image_url'];
const PROPERTY_ALIASES = { origin:'country_of_origin', country:'country_of_origin', region:'origin_region', variety:'varietal', processing:'process', processing_method:'process', coffee_processing:'process', proceso:'process', aufbereitung:'process', co_ferment:'is_coferment', co_fermentation:'is_coferment', coferment:'is_coferment', processing_methods:'process_methods', tasting_notes:'flavor_notes', roast_level:'roast_darkness', elevation:'altitude', decaf:'is_decaf' };
function stripHtml(html) { const $ = cheerio.load(html || ''); return $.text().replace(/\s+/g,' ').trim(); }

function structuredExtraction(page, shopifyJson) {
  const schema = page.sourceProduct || structuredProduct(page.html, page.finalUrl || page.url);
  const productOnly=require('./productEvidence').productOnlyOffer(page.sourceProduct,page.finalUrl || page.url);
  let native = shopifyJson?.success ? shopifyJson.data : null;
  if(native){let host;try{host=new URL(page.finalUrl || page.url).hostname;}catch{}const profile=require('./siteSupport/profiles.json').find(p=>p.adapter==='shopify' && p.hosts.includes(host));native=require('./siteSupport/shopifyPageFields').shopifyPageFields(page.html,native,schema,profile);}
  const image=primaryProductImage({html:page.html,url:page.finalUrl || page.url,sourceProduct:schema,native});
  const name = native?.title || schema?.name;
  if (!name) return { product:null, complete:false, semantic:null,image };
  const attributes = {};
  if(productOnly){attributes._product_offer=productOnly;attributes._market_context=schema._market_context;}
  for (const p of [schema?.additionalProperty || []].flat()) {
    const key = String(p?.name || p?.propertyID || '').trim().toLowerCase().replace(/[\s-]+/g,'_');
    const mapped = PROPERTY_ALIASES[key] || key;
    if (ATTRIBUTES.includes(mapped)) attributes[mapped] = p.value;
  }
  if (image.url) {attributes.product_image_url=image.url;attributes._image_evidence=image.evidence;}
  const pageDescription=native?require('./siteSupport/threeMarks').threeMarksDescription(page.html,page.finalUrl || page.url,native):null;
  const descriptions=[native?.description || schema?.description,pageDescription].filter(Boolean);
  const descriptionHtml = descriptions.filter((value,i)=>!descriptions.slice(0,i).some(prior=>stripHtml(prior)===stripHtml(value))).join('\n');
  const description = stripHtml(descriptionHtml);
  if (description) { attributes.original_description = description; attributes.description ??= description; }
  if (native?.vendor) attributes.vendor = native.vendor;
  if (native?.tags?.length) attributes.tags = native.tags;
  const offers = [schema?.offers || []].flat().filter(o => o && o['@type'] !== 'AggregateOffer' && o.price != null && (!o.url || sameProduct(o.url,page.finalUrl || page.url)));
  // Amount and currency must come from one proven price source. Page/meta currency
  // does not establish the currency of a separate native numeric payload.
  const currency = native ? native.currency || null : offers[0]?.priceCurrency || null;
  const analyticsMarket=native?require('./shopifyProduct').exactAnalyticsMarket(page.html,native):new Map();
  const preorders=native?primaryShopifyPreorders(page.html,page.finalUrl || page.url,native):new Map();
  const variants = native?.variants?.length ? native.variants.map(v => {
    const matches=offers.filter(o=>{
      let selected=null;try{selected=o.url?new URL(o.url,page.url).searchParams.get('variant'):null;}catch{return false;}
      if(selected!=null)return selected===String(v.id)&&(!o.sku||!v.sku||String(o.sku)===String(v.sku));
      return v.sku && String(o.sku)===String(v.sku) && native.variants.filter(other=>String(other.sku)===String(v.sku)).length===1;
    });
    const paired=!(v.currency || native.currency)&&matches.length===1&&matches[0].priceCurrency?matches[0]:null;
    const analytics=!(v.currency || native.currency || paired)?analyticsMarket.get(String(v.id)):null;
    return { source_id:v.id,title:v.title,price:paired?paired.price:analytics?analytics.price:v.price,currency:paired?paired.priceCurrency:analytics?analytics.currency:v.currency || native.currency || null,price_source:paired?'jsonld_exact_variant_offer':analytics?analytics.source:'shopify_product_json',available:preorders.has(String(v.id))?null:v.available,weight_g:v.weightGrams,sku:v.sku,locale:'en-US' };
  }) : offers.map(o => ({ source_id:offerVariantId(o,page.finalUrl || page.url), title:o.name || o.sku || 'default', price:o.price, currency:o.priceCurrency || null, weight_g:o._net_weight_g,availability:require('./productEvidence').schemaAvailability(o.availability), stock_evidence:{availability:o.availability || null,...(o._stock_evidence || {})},locale:'en-US', source_url:o.url,price_source:schema?._market_source || 'product_scoped_jsonld_offer' }));
  const product = { name, attributes, variants, variant_prices:variants.map(v=>[v.title,v.price]), variant_price_currency:currency, description_html:descriptionHtml || null, description_raw:description || null, source_product_id:native?.id || schema?.productID || null, variants_complete:native?.variantsComplete===true || !native && schema?._variants_complete===true,...(productOnly?{_product_only:true}:{}) };
  const coffee = /\b(?:coffee|roasted|espresso)\b/i.test(`${native?.productType || ''} ${schema?.category || ''} ${name} ${description}`) && !/\b(?:green coffee|rohkaffee|cascara|grinder|mug|equipment|gift card)\b/i.test(`${name} ${native?.productType || ''}`);
  // Skip semantic AI only when a source supplies the full attribute contract explicitly.
  // Partial structured data still contributes trustworthy prices/variants and falls back for descriptions/facts.
  const complete = coffee && ATTRIBUTES.filter(k=>k!=='product_image_url').every(k => Object.hasOwn(attributes,k));
  // Structured price/stock changes do not invalidate semantic extraction; description/fact changes do.
  const semantic = { name,descriptionHtml,attributes,nativeTags:native?.tags || [],productType:native?.productType || schema?.category || null };
  return { product, complete, semantic, coffee,image };
}

function semanticHash(page, structured) {
  const $ = cheerio.load(page.html || '');
  $('script,style,nav,footer,header,noscript,iframe,form#product-form,form[data-primary-product], [itemprop="price"], [itemprop="availability"], .price, .stock').remove();
  return stableKey(structured.semantic,$('title').text(),$('body').text().replace(/\s+/g,' ').trim());
}
function mergeSourceProduct(extracted, structured) {
  // Photos always come from fresh primary-product evidence. Neither a model nor
  // a cached classification can supply an invented/truncated image URL.
  const attributes={...(extracted.attributes || {})};
  delete attributes.product_image_url;delete attributes._image_evidence;
  if(structured.image?.url){attributes.product_image_url=structured.image.url;attributes._image_evidence=structured.image.evidence;}
  extracted={...extracted,attributes};
  if (!structured.product?.variants?.length) {
    // Fresh AI can extract price text, but cannot prove a native identity,
    // complete inventory or exact variant stock without current source evidence.
    extracted={...extracted,source_product_id:null,variants_complete:false};
    if(Array.isArray(extracted.variants))extracted.variants=extracted.variants.map(v=>({...v,source_id:null,id:null,available:null,availability:'unknown'}));
  }
  if (!structured.product) return extracted;
  const source = structured.product;
  const merged = { ...extracted, ...Object.fromEntries(Object.entries(source).filter(([k,v]) => v != null && !(Array.isArray(v) && v.length===0))), attributes:{ ...(extracted.attributes || {}), ...Object.fromEntries(Object.entries(source.attributes).filter(([,v])=>v!=null)) } };
  // A native endpoint lacking currency cannot turn an inferred currency into a fact.
  merged.source_product_id=source.source_product_id || null;
  if (source.variants?.length) merged.variant_price_currency = source.variant_price_currency;
  if(source._product_only===true) {
    // A proven product offer is not a selectable size/grind combination. Never
    // save a model or cached label as a variant when native IDs are unavailable.
    merged.variants=[];merged.variant_prices=[];merged.variants_complete=false;
    merged.variant_price_currency=null;delete merged.default_price;
  }
  return merged;
}
function validClassification(value) { return value && typeof value === 'object' && (value.is_product === false || value.is_coffee_page === false || (value.is_coffee_page === true && value.product && typeof value.product.name === 'string' && value.product.name.trim())); }

async function extractPage({ page, shopifyJson, cache, classify, model, now = Date.now() }) {
  const structured = structuredExtraction(page,shopifyJson);
  const hash = semanticHash(page,structured);
  const prior = cache?._extraction;
  let data, mode, usage = null, aiCalls = 0;
  const age = now-Date.parse(prior?.extracted_at);
  const hasCurrentVariants = structured.product?.variants?.length > 0;
  // HTML price/stock changes intentionally do not invalidate semanticHash. A
  // coffee cache is safe only when live variants replace its market fields.
  const canReuseCache = cache?.is_coffee_page!==true || hasCurrentVariants || structured.product?._product_only===true;
  if (canReuseCache && prior?.version===EXTRACTION_VERSION && prior.model===model && prior.semantic_hash===hash && age>=0 && age<CACHE_TTL_MS && validClassification(cache)) {
    data = { ...cache }; delete data._extraction; mode='cache';
  } else if (structured.complete && hasCurrentVariants) {
    data = { is_product:true,is_coffee_page:true,product:structured.product }; mode='structured';
  } else if(structured.coffee && structured.product?._product_only===true) {
    // Reviewed native product-only coverage needs no semantic model. Leave
    // unpublished coffee facts unset; save only the proved product/offer/photo.
    data = {is_product:true,is_coffee_page:true,product:structured.product};mode='structured_product_only';
  } else {
    const response = await classify(page.content, page.url);
    aiCalls = response.aiCalls ?? (response.skipped ? 0 : 1);
    if (response.error) return { ...response, mode:'ai', aiCalls, semanticHash:hash };
    if (!validClassification(response.data)) return { error:'Invalid extraction classification',mode:'ai',aiCalls,semanticHash:hash,usage:response.usage };
    data = response.data; usage=response.usage || null; mode='ai';
  }
  if (data.product) {
    const product=mergeSourceProduct(data.product,structured);
    // Rebuild processing from the current product's untruncated native/schema or
    // scoped description, even when the semantic classification was cached.
    const sourceText=[structured.product?.description_html,scopedDescription(page.html)].filter(Boolean).join('\n');
    product._processing=processingForProduct(product,{sourceText:sourceText||undefined,sourceAttributes:structured.product?.attributes,title:structured.product?.name,source:shopifyJson?.success?'shopify_product_description':'product_scoped_description'});
    product.attributes={...(product.attributes||{}),process:product._processing.process,process_methods:product._processing.process_methods,is_coferment:product._processing.is_coferment,coferment_ingredients:product._processing.coferment_ingredients};
    data={...data,product};
  }
  const extraction = { version:EXTRACTION_VERSION,model,semantic_hash:hash,extracted_at:mode==='cache' ? prior.extracted_at : new Date(now).toISOString(),last_market_checked_at:new Date(now).toISOString(),mode,usage };
  return { data,mode,aiCalls,usage,semanticHash:hash,cache:{ ...data,_extraction:extraction },structured };
}

module.exports = { ATTRIBUTES, EXTRACTION_VERSION, CACHE_TTL_MS, structuredExtraction, semanticHash, mergeSourceProduct, extractPage, validClassification };
