#!/usr/bin/env node
'use strict';
// Offline review only: no database client, merchant request, AI call or apply mode.
const fs=require('node:fs');
const {processingForProduct}=require('../src/coffeeProcessing');
const {currencyCode}=require('../src/catalogNormalization');
function present(value){return value!=null&&String(value).trim()&&!/^(?:null|unknown|n\/a)$/i.test(String(value).trim());}
function costEstimate(count){
 if(!Number.isSafeInteger(count)||count<0)throw Error('Invalid coffee count');
 const low=(2000*0.25+1000*2)/1e6,high=(4000*0.25+3000*2)/1e6;
 return {coffees:count,usd_low:Number((count*low*1.25).toFixed(4)),usd_high:Number((count*high*1.25).toFixed(4)),model:'gpt-5-mini',calls_per_coffee:1,retry_reserve:0.25,input_tokens_per_coffee:[2000,4000],billed_output_tokens_per_coffee:[1000,3000],rates_usd_per_million:{input:0.25,output:2},pricing_checked:'2026-10-07',pricing_url:'https://developers.openai.com/api/docs/models/gpt-5-mini',assumption:'uncached one-call-per-product re-extraction; not a hard spending cap; excludes proxy/bandwidth/runtime/human review'};
}
function auditCatalog(snapshot){
 if(!Array.isArray(snapshot?.rows))throw Error('Snapshot rows must be an array');
 const counts={coffees:snapshot.rows.length,roasters:new Set(snapshot.rows.map(p=>p.entity_id)).size,missing_process:0,process_candidates_from_retained_source:0,coferment_disclosed_in_retained_source:0,coferment_ingredients_disclosed:0,missing_origin:0,process_field_disagreements:0,variants:0,money_complete:0,money_incomplete:0,money_arithmetic_mismatch:0,money_currency_precision_mismatch:0,coffees_with_review_flags:0};
 const candidates=[];
 for(const row of snapshot.rows){
  const facts=Array.isArray(row.coffee_facts)?row.coffee_facts[0]:row.coffee_facts,attrs=row.metadata||{},flags=[];
  const recorded=facts?.process;
  const proposed=processingForProduct({name:row.original_title||row.name,attributes:{...attrs,process:present(recorded)?recorded:attrs.process},description_html:row.description_html,description_raw:row.description_raw},{source:'retained_product_description'});
  if(!present(recorded)){counts.missing_process++;flags.push('process_missing');if(proposed.process&&proposed.process_methods.length)counts.process_candidates_from_retained_source++;}
  if(present(recorded)&&present(attrs.process)&&String(recorded).toLowerCase()!==String(attrs.process).toLowerCase()){counts.process_field_disagreements++;flags.push('process_field_disagreement');}
  if(proposed.is_coferment===true){counts.coferment_disclosed_in_retained_source++;flags.push('coferment_disclosure_requires_projection');if(proposed.coferment_ingredients.length)counts.coferment_ingredients_disclosed++;}
  if(!present(attrs.country_of_origin)){counts.missing_origin++;flags.push('origin_missing');}
  const money=[];
  for(const variant of row.product_variants||[]){
   counts.variants++;const issues=[];
   const code=currencyCode(variant.currency),exponent=variant.currency_exponent;
   const complete=/^[A-Z]{3}$/.test(variant.currency||'')&&code===variant.currency&&Number.isSafeInteger(variant.price_minor_units)&&variant.price_minor_units>=0&&Number.isInteger(exponent)&&exponent>=0&&exponent<=4&&variant.price_amount!=null&&Number.isFinite(Number(variant.price_amount))&&Number(variant.price_amount)>=0;
   if(complete){counts.money_complete++;if(Math.round(Number(variant.price_amount)*10**exponent)!==variant.price_minor_units){counts.money_arithmetic_mismatch++;issues.push('money_arithmetic_mismatch');}
    const precision=new Intl.NumberFormat('en',{style:'currency',currency:code}).resolvedOptions().maximumFractionDigits;
    if(exponent!==precision){counts.money_currency_precision_mismatch++;issues.push('money_currency_precision_mismatch');}
   }else{counts.money_incomplete++;issues.push('money_incomplete');}
   if(issues.length)money.push({variant_id:variant.id,issues});
  }
  if(money.length)flags.push('variant_money_requires_review');
  if(flags.length){counts.coffees_with_review_flags++;candidates.push({product_id:row.id,source_url:row.source_url,flags,recorded_process:recorded??null,recorded_country:attrs.country_of_origin??null,proposed_processing:proposed,variant_flags:money});}
 }
 return {summary:{captured_at:snapshot.captured_at,selection:snapshot.selection,source_counts:snapshot.counts,counts,estimates:[costEstimate(1000),costEstimate(10000),...(Number.isSafeInteger(snapshot.counts?.coffee_products)?[costEstimate(snapshot.counts.coffee_products)]:[])],model_calls:0,database_writes:0,limits:['Retained source proposals require source review before correction; no automatic apply mode.','Field presence, quoted disclosures and money arithmetic do not prove current merchant prices or correct origin.','A recent non-atomic sample is not representative of the full catalog.']},candidates};
}
if(require.main===module){
 try{const args=process.argv.slice(2);if(!args[0]||args.some(v=>v.startsWith('--')&&v!=='--output'))throw Error('Usage: node scripts/audit-catalog.cjs private-snapshot.json [--output private-report.json]');
  const result=auditCatalog(JSON.parse(fs.readFileSync(args[0],'utf8')));const index=args.indexOf('--output');
  if(index>=0){if(!args[index+1])throw Error('Missing output path');const fd=fs.openSync(args[index+1],'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(result,null,2));}finally{fs.closeSync(fd);}}
  console.log(JSON.stringify(result.summary,null,2));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={auditCatalog,costEstimate};
