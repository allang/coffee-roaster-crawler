#!/usr/bin/env node
'use strict';
// Merchant GET-only inspection. This module never loads a DB client or AI client.
const fs=require('node:fs');
const profiles=require('./profiles.json');
const {discoverSiteProducts}=require('./discovery');
const {createReader}=require('./network');
const {structuredExtraction}=require('../extraction');
const {normalizeProduct}=require('../catalogNormalization');
const {productAvailability}=require('../productEvidence');
const {fetchShopifyProductJson}=require('../shopifyProduct');
async function main() {
  const name=process.argv[2],output=process.argv[3];
  const profile=profiles.find(p=>p.name.toLowerCase()===String(name).toLowerCase());
  if(!profile)throw Error('Usage: node src/siteSupport/cli.js SITE [OUTPUT.json]; site must have a reviewed profile');
  const reader=createReader(profile),roaster={id:profile.entity_ids[0],website_url:'https://'+profile.hosts[0]},discovery=await discoverSiteProducts(roaster,reader),products=[],errors=[],unavailableProducts=[];
  if(discovery.error)errors.push({stage:'discovery',error:discovery.error});
  for(const url of discovery.urls) {
    const page=await reader.fetchHtml(url);
    if(!page.success){errors.push({url,error:page.error});continue;}
    const pageAvailability=productAvailability({html:page.data,status:200,sourceUrl:url,finalUrl:page.finalUrl});
    if(pageAvailability.reason==='product_soft_404'){unavailableProducts.push({url,...pageAvailability});continue;}
    try {
    const jsonFetch=async value=>{const response=await reader.fetchHtml(value);if(!response.success)return response;try{return {...response,data:JSON.parse(response.data)};}catch{return {success:false,error:'Invalid product JSON'};}};
    const native=profile.adapter==='shopify'?await fetchShopifyProductJson(url,null,{fetchJson:jsonFetch}):null;
    const sourceProduct=profile.adapter==='square'?await require('./square').fetchSquareProduct(page.data,url,profile,reader.fetchHtml):null;
    const structured=structuredExtraction({html:page.data,sourceProduct,url,finalUrl:page.finalUrl},native);
    if(!structured.product || !(structured.coffee || profile.coffee_collection_verified || native?.success && profile.coffee_product_types?.includes(native.data.productType))){errors.push({url,error:'Exact coffee product data missing'});continue;}
    const product=normalizeProduct(structured.product,url),availability=productAvailability({html:page.data,sourceProduct,status:200,sourceUrl:url,finalUrl:page.finalUrl,shopifyProduct:native?.success?native.raw:null});
    const priced=product.variants.filter(v=>v.money.minorUnits!=null && v.money.currency);
    if(!priced.length){errors.push({url,error:'No proven currency and price'});continue;}
    products.push({url,title:product.name,source_product_id:product.source_product_id,state:availability.state,variants:product.variants.map(v=>({id:v.source_id,title:v.title,weight_g:v.weight_g,money:v.money,state:v.availability,price_source:v.price_source})),processing:product.processing,description_present:Boolean(product.description_raw),image_present:Boolean(product.attributes?.product_image_url)});
    console.log('PASS '+product.name+' ('+priced.length+' priced variants, '+availability.state+')');
    }catch(error){errors.push({url,error:error.message});}
  }
  const report={name:profile.name,checked_at:new Date().toISOString(),mode:'merchant-get-only-dry-run',discovery,products,unavailable_products:unavailableProducts,errors,requests:reader.requests,production_writes:0,ai_calls:0,prohibited_requests:0,passed:products.length>0 && !errors.length};
  if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({name:profile.name,coffee_products:products.length,errors:errors.length,passed:report.passed,production_writes:0}));
  if(!report.passed)process.exitCode=1;
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={main};
