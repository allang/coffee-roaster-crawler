#!/usr/bin/env node
'use strict';
// Read frozen catalog snapshots, prepare translations, and write a review plan.
// This script has no DB client or catalog writer.
const fs=require('node:fs');
const {translateProductForSave,TEXT_ATTRIBUTES}=require('../src/productTranslation');
const {displayTitle,tastingNotes}=require('../src/catalogNormalization');
function storedInput(row,variants){
 const metadata=row.metadata || {},original=metadata._translation?.original_attributes || metadata;
 const attributes={...original};delete attributes._translation;delete attributes._normalization;
 attributes.description ??= row.description_raw || row.description || null;
 attributes.short_description ??= row.short_description || null;attributes.nano_description ??= row.nano_description || null;
 return {name:row.original_title || row.name,original_title:row.original_title || row.name,description_raw:row.description_raw || null,description_html:row.description_html || null,attributes,source_product_id:metadata._normalization?.source_product_id || null,variants:variants.map(v=>({source_id:v.merchant_variant_id,title:v.provenance?.original_variant_name || v.variant_name || 'default',weight_g:v.weight_g,price:v.price_amount ?? v.price_cents,currency:v.currency}))};
}
async function prepare(rows,variants,facts,{request}={}){
 const results=[];
 for(const row of rows){
  const children=variants.filter(v=>v.product_id===row.id),input=storedInput(row,children),metrics=[];
  const p=await translateProductForSave(input,row.source_url,{request,previous:row.metadata?._translation,onMetrics:r=>metrics.push({ai_calls:r.aiCalls || 0,usage:r.usage || null,cache_hit:r.cacheHit || false,error:r.error || null})});
  const metadata={...(row.metadata || {})};for(const key of TEXT_ATTRIBUTES)if(Object.hasOwn(p.attributes,key))metadata[key]=p.attributes[key];metadata._translation=p.attributes._translation;
  if(metadata._normalization)metadata._normalization={...metadata._normalization,tasting_notes:tastingNotes(p.attributes.flavor_notes)};
  const originalFacts=facts.find(f=>f.product_id===row.id),factPatch={};
  const glossary={'워시드':'Washed','무산소 내추럴':'Anaerobic Natural','게이샤':'Geisha'};
  if(originalFacts){metadata._translation.original_facts=Object.fromEntries(['process','variety','roast_level','tasting_notes_raw'].map(k=>[k,originalFacts[k]]));for(const key of ['process','variety','roast_level'])if(glossary[originalFacts[key]])factPatch[key]=glossary[originalFacts[key]];}
  const productPatch={name:p.name,display_title:displayTitle(p.name,p.attributes),original_title:p.original_title,metadata};
  for(const key of ['description','short_description','nano_description','country_of_origin','origin_region'])if(typeof p.attributes[key]==='string')productPatch[key]=p.attributes[key];
  results.push({id:row.id,entity_id:row.entity_id,source_url:row.source_url,original_title:p.original_title,product_patch:productPatch,variant_patches:children.map((v,i)=>({id:v.id,product_id:v.product_id,variant_name:p.variants[i].title,provenance:{...(v.provenance || {}),original_variant_name:input.variants[i].title,original_language:p.attributes._translation.source_language}})),facts_patch:factPatch,metrics});
 }
 return {version:1,prepared_at:new Date().toISOString(),mode:'frozen-snapshot-translation-review',production_writes:0,products:results};
}
if(require.main===module){const [productsPath,variantsPath,factsPath,output]=process.argv.slice(2);if(!output)throw Error('Usage: prepare-product-translations.cjs products.json variants.json facts.json output.json');prepare(JSON.parse(fs.readFileSync(productsPath)),JSON.parse(fs.readFileSync(variantsPath)),JSON.parse(fs.readFileSync(factsPath))).then(plan=>{fs.writeFileSync(output,JSON.stringify(plan,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({prepared:plan.products.length,output,production_writes:0}));}).catch(e=>{console.error(e.message);process.exitCode=1;});}
module.exports={storedInput,prepare};
