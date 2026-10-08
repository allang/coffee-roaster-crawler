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
module.exports={explicitNetWeight};
