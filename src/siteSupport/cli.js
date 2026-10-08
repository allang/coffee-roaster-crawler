#!/usr/bin/env node
'use strict';
// Merchant GET-only inspection. This module never loads a DB client or AI client.
const fs=require('node:fs');
const profiles=require('./profiles.json');
const {discoverProfileProducts}=require('./discovery');
const {createReader}=require('./network');
const {structuredExtraction}=require('../extraction');
const {normalizeProduct}=require('../catalogNormalization');
const {productAvailability}=require('../productEvidence');
const {fetchShopifyProductJson}=require('../shopifyProduct');
function inspectionErrors(product,availability) {
  const errors=[];
  if(!product.source_product_id)errors.push('Exact product identity missing');
  if(!product.variants.length || product.variants.some(v=>!v.source_id) || new Set(product.variants.map(v=>String(v.source_id))).size!==product.variants.length)errors.push('Exact unique variant identities missing');
  if(product.variants.some(v=>v.money.minorUnits==null || !v.money.currency))errors.push('Exact paired price and currency missing for a variant');
  const explicitPreorders=new Set((availability.variants || []).filter(v=>v.state==='unknown' && v.evidence?.some(e=>['shopify_product_preorder_tag','primary_product_preorder_control'].includes(e.source) && String(e.variant_id)===String(v.source_id) && String(e.product_id)===String(product.source_product_id))).map(v=>String(v.source_id)));
  for(const variant of availability.variants || [])if(variant.state==='unknown' && variant.evidence?.some(e=>/\/(?:BackOrder|PreOrder)$/.test(e.availability || '') && (e.source==='woocommerce_store_exact_variant' && e.merchant_stock?.merchant_backorder===true || e.source==='hydrogen_primary_exact_variant' && e.merchant_stock?.currently_not_in_stock===true)))explicitPreorders.add(String(variant.source_id));
  if(availability.state==='unknown' && !explicitPreorders.size || product.variants.some(v=>v.availability==='unknown' && !explicitPreorders.has(String(v.source_id))))errors.push('Exact stock evidence missing');
  return errors;
}
async function main() {
  const name=process.argv[2],output=process.argv[3];
  const profile=profiles.find(p=>p.name.toLowerCase()===String(name).toLowerCase());
  if(!profile)throw Error('Usage: node src/siteSupport/cli.js SITE [OUTPUT.json]; site must have a reviewed profile');
  const reader=createReader(profile),roaster={id:profile.entity_ids[0],website_url:profile.bootstrap_url || 'https://'+profile.hosts[0]},discovery=await discoverProfileProducts(roaster,profile,reader.fetchHtml),products=[],errors=[],unavailableProducts=[];
  if(discovery.error)errors.push({stage:'discovery',error:discovery.error});
  else if(!discovery.complete)errors.push({stage:'discovery',error:'Inventory discovery incomplete'});
  for(const url of discovery.urls) {
    const page=await reader.fetchHtml(url);
    if(!page.success){if([404,410].includes(page.status))unavailableProducts.push({url,...productAvailability({status:page.status,sourceUrl:url})});else errors.push({url,error:page.error});continue;}
    const pageAvailability=productAvailability({html:page.data,status:200,sourceUrl:url,finalUrl:page.finalUrl});
    if(pageAvailability.reason==='product_soft_404'){unavailableProducts.push({url,...pageAvailability});continue;}
    try {
    const jsonFetch=async value=>{const response=await reader.fetchHtml(value);if(!response.success)return response;try{return {...response,data:JSON.parse(response.data)};}catch{return {success:false,error:'Invalid product JSON'};}};
    const native=profile.adapter==='shopify'?await fetchShopifyProductJson(url,null,{fetchJson:jsonFetch}):null;
    if(profile.adapter==='shopify' && (!native?.success || !native.data.variantsComplete)){errors.push({url,error:'Shopify complete native variants missing: '+(native?.error || 'incomplete SKU set')});continue;}
    const sourceProduct=profile.adapter==='square'?await require('./square').fetchSquareProduct(page.data,url,profile,reader.fetchHtml):profile.adapter==='subbly'?await require('./subbly').fetchSubblyProduct(page.data,url,profile,reader.fetchHtml):profile.adapter==='nuxt_shopify'?await require('./nuxtShopify').fetchNuxtShopifyProduct(page.data,url,profile,reader.fetchHtml):profile.adapter==='imweb'?await require('./imweb').fetchImwebProduct(page.data,url,profile,reader.fetchHtml):['woocommerce','woocommerce_store'].includes(profile.adapter)?await require('./woocommerce').fetchWooProduct(page.data,url,profile,reader.fetchHtml):profile.adapter==='hydrogen'?require('./hydrogen').hydrogenProduct(page.data,page.finalUrl || url,profile):profile.adapter==='wix'?require('./wix').wixProduct(page.data,page.finalUrl || url,profile):profile.adapter==='cafe24' && profile.cafe24_native_single_items?await require('./cafe24').fetchCafe24Product(page.data,page.finalUrl || url,profile,reader.fetchHtml):profile.adapter==='fathers'?require('./fathers').fathersProduct(page.data,url,profile):profile.adapter==='squarespace'?await require('./squarespace').fetchSquarespaceProduct(page.data,url,profile,reader.fetchHtml):null;
    const structured=structuredExtraction({html:page.data,sourceProduct,url,finalUrl:page.finalUrl},native);
    if(!structured.product || !(structured.coffee || profile.coffee_collection_verified || native?.success && (profile.coffee_product_types?.includes(native.data.productType) || profile.coffee_handles?.includes(native.data.handle)))){errors.push({url,error:'Exact coffee product data missing'});continue;}
    const product=normalizeProduct(structured.product,url),availability=productAvailability({html:page.data,sourceProduct,status:200,sourceUrl:url,finalUrl:page.finalUrl,shopifyProduct:native?.success?native.raw:null});
    const failures=inspectionErrors(product,availability);if(failures.length){errors.push({url,error:failures.join('; ')});continue;}
    const priced=product.variants.filter(v=>v.money.minorUnits!=null && v.money.currency);
    if(!priced.length || priced.length!==product.variants.length){errors.push({url,error:'Exact currency and price missing for one or more variants'});continue;}
    products.push({url,title:product.name,source_product_id:product.source_product_id,state:availability.state,variants_complete:product.variants_complete,variants:product.variants.map(v=>({id:v.source_id,title:v.title,weight_g:v.weight_g,money:v.money,state:v.availability,stock_evidence:v.stock_evidence,price_source:v.price_source})),processing:product.processing,description_present:Boolean(product.description_raw),description_html_present:Boolean(product.description_html),description_image_urls:sourceProduct?._description_image_urls || [],image_present:Boolean(product.attributes?.product_image_url),...(sourceProduct?._market_context?{market_context:sourceProduct._market_context}:{})});
    console.log('PASS '+product.name+' ('+priced.length+' priced variants, '+availability.state+')');
    }catch(error){errors.push({url,error:error.message});}
  }
  const report={name:profile.name,checked_at:new Date().toISOString(),mode:'merchant-get-only-dry-run',entity_ids:profile.entity_ids,identity_blocker:profile.identity_blocker || null,discovery,products,unavailable_products:unavailableProducts,errors,requests:reader.requests,production_writes:0,ai_calls:0,prohibited_requests:0,passed:discovery.complete===true && products.length>0 && !errors.length};
  if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({name:profile.name,coffee_products:products.length,errors:errors.length,passed:report.passed,production_writes:0}));
  if(!report.passed)process.exitCode=1;
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={main,inspectionErrors};
