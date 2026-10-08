'use strict';
const { getSupabase } = require('./supabase');
const globalLogger = require('./logger');
const { downloadAndSaveImage } = require('./imageDownloader');
const { parsePriceCents, parseWeightGrams } = require('./product-value-parsers.cjs');
const { normalizeProduct, canonicalProductUrl, stableKey, stableUuid } = require('./catalogNormalization');
function generateSlug(name) { return String(name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80) || 'coffee'; }
function sanitizeNullStrings(value) {
  if (value === 'null' || value === 'NULL') return null;
  if (Array.isArray(value)) return value.map(sanitizeNullStrings);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,sanitizeNullStrings(v)]));
  return value;
}
async function findExistingProduct(db,entityId,sourceUrl,key) {
  const {data:known,error}=await db.from('products').select('id,slug,source_url,source_key').eq('entity_id',entityId).eq('source_key',key).maybeSingle();
  if(error) throw error;
  if(known) return known;
  const matches=[];
  for(let offset=0;;offset+=500) {
    const {data,error:readError}=await db.from('products').select('id,slug,source_url,source_key').eq('entity_id',entityId).order('id').range(offset,offset+499);
    if(readError) throw readError;
    for(const row of data || []) { try { if(canonicalProductUrl(row.source_url)===sourceUrl) matches.push(row); } catch {} }
    if((data || []).length<500) break;
  }
  if(matches.length>1) throw new Error('Multiple legacy products share source identity; review before adoption');
  return matches[0] || null;
}
function productSourceKey(entityId,product,sourceUrl) {
  const native=product?.source_product_id;
  const valid=typeof native==='string' && native.trim() && native.length<=200 && native!=='null' || typeof native==='number' && Number.isSafeInteger(native) && native>0;
  return stableKey(entityId,valid ? ['native',String(native)] : ['url',canonicalProductUrl(sourceUrl)]);
}
function retrievalUrl(sourceUrl) {const original=new URL(sourceUrl),url=new URL(canonicalProductUrl(sourceUrl));url.hostname=original.hostname;url.pathname=original.pathname.replace(/\/+$/, '') || '/';return url.href;}
function catalogPayload(entityId, product, sourceUrl, existing, availability, now) {
  const normalized=normalizeProduct(sanitizeNullStrings(product),sourceUrl);
  const sourceKey=productSourceKey(entityId,normalized,sourceUrl);
  const id=existing?.id || stableUuid(entityId,sourceKey);
  const attrs=Object.fromEntries(Object.entries(normalized.attributes || {}).filter(([k,v])=>v!=null));
  const variants=normalized.variants.map(v=>{
    const native=v.source_id==null ? null : String(v.source_id);
    const key=stableKey(native ? ['native',native] : ['label',v.title.normalize('NFKC').trim(),v.sku || null]);
    const evidence=availability?.variants?.find(e=>native!=null && String(e.source_id)===native);
    const state=availability?.state==='removed'?'removed':evidence?.state || v.availability;
    return {id:stableUuid(id,key),source_key:key,merchant_variant_id:native,variant_name:v.title,weight_g:v.weight_g,
      price_cents:parsePriceCents(v.money.amount),price_minor_units:v.money.minorUnits,price_amount:v.money.amount,currency:v.money.currency,currency_exponent:v.money.exponent,price_raw:String(v.money.raw ?? ''),
      availability_state:state,availability_evidence:evidence?.evidence || [{source:'extracted_variant',state}],availability_checked_at:now,
      provenance:{source_url:normalized.source_url,merchant_variant_id:native,money_reason:v.money.reason}};
  });
  if(new Set(variants.map(v=>v.source_key)).size!==variants.length) throw new Error('Duplicate source variant identity');
  const notes=normalized.tasting_notes;
  const processingEvidence={...normalized.processing.evidence,source_url:retrievalUrl(sourceUrl)};
  const productAvailability=availability ? {...availability,state:availability.state || (availability.isAvailable===true?'in_stock':availability.isAvailable===false?'sold_out':'unknown')} : {state:'unknown',isAvailable:null,reason:'not_checked',evidence:[]};
  return { product:{id,entity_id:entityId,slug:existing?.slug || `${generateSlug(normalized.original_title)}-${sourceKey.slice(0,10)}`,source_url:retrievalUrl(sourceUrl),source_key:sourceKey,
    adopted_source_url:existing?.source_url || null,original_title:normalized.original_title,display_title:normalized.display_title,name:normalized.original_title,
    description_html:normalized.description_html || null,description_raw:normalized.description_raw || null,
    metadata:{...attrs,is_coferment:normalized.processing.is_coferment,_normalization:{version:normalized.normalization_version,tasting_notes:notes,processing:processingEvidence,source_product_id:normalized.source_product_id || null,canonical_source_url:normalized.source_url}},
    availability_state:productAvailability.state,availability_reason:productAvailability.reason,availability_evidence:productAvailability.evidence || [],checked_at:now},
    variants,variants_complete:normalized.variants_complete===true,
    facts:{process:normalized.processing.process,process_methods:normalized.processing.process_methods,is_coferment:normalized.processing.is_coferment,coferment_ingredients:normalized.processing.coferment_ingredients,processing_evidence:processingEvidence,variety:attrs.varietal || null,roast_level:attrs.roast_darkness || null,decaf:typeof attrs.is_decaf==='boolean'?attrs.is_decaf:null,
      elevation_m:/^\d+(?:\s*(?:m|masl))?$/i.test(String(attrs.altitude || ''))?parseInt(attrs.altitude):null,tasting_notes_raw:Array.isArray(notes.source)?notes.source.join(', '):typeof notes.source==='string'?notes.source:null} };
}
async function saveProduct(entityId,productData,sourceUrl,log=null,options={}) {
  const logger=log || globalLogger, db=options.db || getSupabase();
  if(typeof productData?.name!=='string' || !productData.name.trim()) {logger.warn('ProductSaver','Product has no valid name, skipping',{sourceUrl});return null;}
  const canonical=canonicalProductUrl(sourceUrl), key=productSourceKey(entityId,productData,sourceUrl);
  const existing=await findExistingProduct(db,entityId,canonical,key);
  const payload=catalogPayload(entityId,productData,sourceUrl,existing,options.availability,options.checkedAt || new Date().toISOString());
  const {data,error}=await db.rpc('save_catalog_product_v2',{payload});
  if(error) throw error; // No destructive legacy fallback if migration is absent.
  const productId=data?.product_id;
  if(!productId) throw new Error('Catalog transaction returned no product ID');
  const image=productData.attributes?.product_image_url;
  if(image) await (options.downloadImage || downloadAndSaveImage)(productId,image,logger);
  logger.info('ProductSaver','Saved catalog product',{productId,contentChanged:data.content_changed,marketChanged:data.market_changed});
  return productId;
}
module.exports={saveProduct,generateSlug,parsePriceCents,parseWeightGrams,catalogPayload,findExistingProduct,sanitizeNullStrings,productSourceKey,retrievalUrl};
