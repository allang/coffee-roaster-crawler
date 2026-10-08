'use strict';
const {stableKey,normalizeProduct}=require('./catalogNormalization');
const VERSION='english-before-save-v1';
const TEXT_ATTRIBUTES=['origin_type','country_of_origin','origin_region','varietal','process','coferment_ingredients','flavor_notes','grind_size_offered','brew_as','roast_darkness','producer','description','short_description','nano_description'];
const foreignScript=/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Devanagari}\p{Script=Thai}\p{Script=Greek}]/u;
// Commas join a number only in complete thousands groups. In an option such
// as "10g×50,12g×50", the comma separates two pack quantities.
function numericTokens(text){return (text.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?(?!\d)|\d+(?:\.\d+)?/g)||[]).map(s=>s.replace(/,/g,'')).sort();}
function sourceBundle(product,url){
 const p=normalizeProduct(structuredClone(product),url);
 p.original_title=product.original_title || product.name;
 p.attributes.description ??= p.description_raw || null;
 const texts=[];
 function add(path,value){if(typeof value==='string' && value.trim())texts.push({id:path.join('.'),text:value,path});else if(Array.isArray(value))value.forEach((v,i)=>add([...path,String(i)],v));}
 add(['name'],p.name);for(const key of TEXT_ATTRIBUTES)add(['attributes',key],p.attributes[key]);
 p.variants.forEach((v,i)=>{v.original_title ??= v.title;add(['variants',String(i),'title'],v.title);});
 return {product:p,texts,hash:stableKey(VERSION,texts.map(({id,text})=>({id,text})))};
}
function validate(data,texts){
 if(!data || !/^(?:[a-z]{2,3})(?:-[A-Za-z0-9]+)*$/.test(data.source_language || '') || !Array.isArray(data.translations) || data.translations.length!==texts.length)throw Error('Invalid translation language or field set');
 const values=new Map();
 for(const item of data.translations){if(!item || typeof item.id!=='string' || typeof item.text!=='string' || !item.text.trim() || values.has(item.id))throw Error('Invalid or duplicate translation field');values.set(item.id,item.text);}
 for(const field of texts){const value=values.get(field.id);if(value==null || foreignScript.test(value) || JSON.stringify(numericTokens(field.text))!==JSON.stringify(numericTokens(value)))throw Error('Translation must retain numeric facts and return English: '+field.id);}
 return values;
}
async function translateProductForSave(product,url,{previous=null,request,onMetrics}={}){
 const bundle=sourceBundle(product,url),p=bundle.product;
 let result;
 if(previous?.version===VERSION && previous.source_hash===bundle.hash)result={data:{source_language:previous.source_language,translations:previous.translations},aiCalls:0,cacheHit:true};
 else result=await (request || require('./gptClassifier').translateTexts)({target_language:'en',texts:bundle.texts.map(({id,text})=>({id,text}))},url);
 onMetrics?.(result);
 if(result.error){const error=Error('Translation failed before catalog save: '+result.error);error.quotaExceeded=result.quotaExceeded;throw error;}
 const values=validate(result.data,bundle.texts);
 const originalAttributes=structuredClone(product.attributes || {});
 delete originalAttributes._translation;
 for(const field of bundle.texts){let target=p;for(const key of field.path.slice(0,-1))target=target[key];target[field.path.at(-1)]=values.get(field.id);}
 if(p._processing){p._processing.process=p.attributes.process;p._processing.coferment_ingredients=p.attributes.coferment_ingredients || [];}
 p.attributes._translation={version:VERSION,source_language:result.data.source_language,target_language:'en',source_hash:bundle.hash,original_attributes:originalAttributes,translations:bundle.texts.map(({id})=>({id,text:values.get(id)}))};
 // Original merchant HTML/text stay in their schema columns. The displayed
 // name, summaries, descriptive attributes and option labels are English.
 p.description_raw=product.description_raw || null;p.description_html=product.description_html || null;
 return p;
}
module.exports={VERSION,TEXT_ATTRIBUTES,sourceBundle,validate,translateProductForSave};
