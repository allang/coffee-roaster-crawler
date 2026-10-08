'use strict';
const cheerio=require('cheerio');
const {labelWeight}=require('../shopifyProduct');
function explicitNetWeight(description,title='',prefixes=[]) {
  const $=cheerio.load(description || ''),values=[];
  $('br').replaceWith('\n');
  $('p,li,td').each((_,e)=>{
    for(const line of $(e).text().split('\n').map(x=>x.trim()).filter(Boolean)) {
      const match=line.match(/^(?:net\s*weight|weight|volume|contents)\s*[:：]\s*(.+)$/i);
      if(match)values.push(labelWeight(match[1]));
      for(const prefix of prefixes)if(line.startsWith(prefix))values.push(labelWeight(line.slice(prefix.length).trim()));
      for(const total of line.matchAll(/(?<![\d.,])\b(\d+(?:\.\d+)?\s*(?:kg|g))\s+of\s+coffee\s+in\s+total\b/gi))values.push(labelWeight(total[1]));
    }
  });
  const sizes=[...title.matchAll(/\((\s*\d+(?:\.\d+)?\s*(?:g|kg|oz|lbs?)\s*)\)/gi)];
  if(sizes.length===1 && !/\d\s*(?:x|×)|\d\s*(?:bags?|packs?)\b/i.test(title))values.push(labelWeight(sizes[0][1]));
  if(!values.length || values.some(v=>v==null) || new Set(values).size!==1)return null;
  return values[0];
}
const {parseWeightGrams}=require('../product-value-parsers.cjs');
// Read explicit net contents in the primary merchant description. Shipping mass,
// recipes and farm-processing weights cannot establish the coffee bag's weight.
function descriptionNetWeight(html) {
 const $=cheerio.load(html || ''),text=$.text().replace(/\s+/g,' '),unit='(?:kilograms?|kg|grams?|g|ounces?|oz|pounds?|lbs?)',size='\\d+(?:\\.\\d+)?\\s*'+unit;
 const patterns=[new RegExp('\\b(?:sold|available|packaged) in\\s+('+size+')\\s+bags?\\b','gi'),new RegExp('\\b(?:add|is|contains) one\\s+('+size+')\\s+bag\\b','gi'),new RegExp('\\btotal(?:l?ing| net weight)\\s*:?\\s*('+size+')\\b','gi')];
 const weights=patterns.flatMap(p=>[...text.matchAll(p)].filter(m=>{
  const start=Math.max(text.lastIndexOf('.',m.index-1),text.lastIndexOf(';',m.index-1))+1,end=text.indexOf('.',m.index+m[0].length),statement=text.slice(start,end<0?undefined:end);
  return !/\b(?:brew|recipe|water|ratio|dose|shipping|parcel|packaging)\b/i.test(statement);
 }).map(m=>parseWeightGrams(m[1]))).filter(v=>v!==null);
 return weights.length && new Set(weights).size===1?weights[0]:null;
}
function coffeeBundleWeight(html){
 const $=cheerio.load(html || ''),totals=[];
 $('p').each((_,e)=>{const text=$(e).text();if(/\b(?:brew|recipe|water|shipping|parcel)\b/i.test(text))return;
  for(const m of text.matchAll(/\b(?:includes|contains)\s+(\d+)\s*[x×]\s*(\d+(?:\.\d+)?\s*(?:g|kg|oz|lbs?))\s+bags?\s+of\s+coffees?\b/gi)){
   const count=Number(m[1]),grams=parseWeightGrams(m[2]);if(Number.isInteger(count)&&count>0&&count<=50&&grams!=null&&Number.isSafeInteger(count*grams))totals.push(count*grams);
  }
 });
 return totals.length && new Set(totals).size===1?totals[0]:null;
}
module.exports={explicitNetWeight,descriptionNetWeight,coffeeBundleWeight};
