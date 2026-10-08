'use strict';
const cheerio=require('cheerio');
const {labelWeight}=require('../shopifyProduct');
const SIZE=/^\d+(?:\.\d+)?\s*(?:g|kg|grams?|kilograms?|oz|ounces?|lbs?|pounds?)(?:(?:\s*\(\s*\d+(?:\.\d+)?\s*(?:g|kg|oz|lbs?)\s*\))|(?:\s*\/\s*\d+(?:\.\d+)?\s*(?:g|kg|oz|lbs?)))?$/i;
function sizeLabel(text) {
 const label=String(text || '').trim().replace(/\s*[-–—]\s*roasted(?: on)?\s+.+$/i,'').replace(/\s*\(roast date\s+[^()]+\)$/i,'').trim();
 return SIZE.test(label)?labelWeight(label):null;
}
function nativeDescriptionWeight(html) {
 const $=cheerio.load(html || ''),weights=[];
 $('p').each((_,e)=>{
  const p=$(e),text=p.text().trim();let value=sizeLabel(text);
  if(value==null){
   const label=p.find('strong,b').first().text().trim();
   if(SIZE.test(label) && text.startsWith(label) && !/\b(?:brew|recipe|water|ratio|dose|shipping|parcel|packaging)\b/i.test(text) && [...text.matchAll(/\b\d+(?:\.\d+)?\s*(?:g|kg|grams?|kilograms?|oz|ounces?|lbs?|pounds?)\b/gi)].length===1)value=labelWeight(label);
  }
  if(value!=null)weights.push(value);
 });
 return weights.length && new Set(weights).size===1?weights[0]:null;
}
function shopifyPageFields(html,native,schema,profile) {
 if(!profile?.primary_fields || !native)return native;
 const $=cheerio.load(html || ''),headings=$('h1').filter((_,e)=>!$(e).parents('aside,nav,footer,header,.related-products,.recommendations').length);
 let analyticsIdentity=false;
 if(profile.primary_fields.identity_source==='exact_native_analytics'){
  const canon=$('link[rel="canonical"]');let canonical;
  try{canonical=canon.length===1?new URL(canon.attr('href')):null;}catch{}
  analyticsIdentity=canonical && profile.hosts.includes(canonical.hostname) && canonical.pathname==='/products/'+native.handle && require('../shopifyProduct').exactAnalyticsMarket(html,native).size===native.variants.length;
 }
 if(!analyticsIdentity && (String(schema?.productID)!==String(native.id) || headings.length!==1 || headings.text().trim()!==native.title))return native;
 const result={...native,variants:native.variants.map(v=>({...v}))};
 function primary(selector){return $(selector).filter((_,e)=>!$(e).parents('aside,nav,footer,header,.related-products,.recommendations,[data-product-recommendations]').length);}
 const selectors=profile.primary_fields.description_selectors || [profile.primary_fields.description_selector],parts=[];
 if(!profile.primary_fields.only_when_native_description_empty || !native.description?.trim())for(const selector of selectors.filter(Boolean)){
  const description=primary(selector);
  if(description.length===1){const clean=description.clone();clean.find('style,script').remove();if(clean.text().trim())parts.push(clean.html());}
 }
 if(parts.length)result.description=[native.description,...parts].filter(Boolean).join('\n');
 const styles=profile.primary_fields.fixed_weight_style_values;
 const fixedStyle=Array.isArray(styles) && native.options?.length===1 && native.options[0].name==='Style' && native.options[0].values?.every(v=>styles.includes(v)) && native.variants.every(v=>styles.includes(v.title));
 const fixedOption=native.options?.length===1 && profile.primary_fields.fixed_weight_option_names?.includes(native.options[0].name) && native.options[0].values?.length>0 && native.variants.every(v=>native.options[0].values.includes(v.title));
 if(result.variants.length===1 || fixedStyle || fixedOption){
  const weight=primary(profile.primary_fields.net_weight_selector);
  const grams=(weight.length===1?sizeLabel(weight.text().trim()):null) ?? (profile.primary_fields.native_description_net_weight?nativeDescriptionWeight(native.description):null);
  if(grams!=null)for(const variant of result.variants)if(variant.weightGrams==null)variant.weightGrams=grams;
 }
 return result;
}
module.exports={shopifyPageFields,sizeLabel,nativeDescriptionWeight};
