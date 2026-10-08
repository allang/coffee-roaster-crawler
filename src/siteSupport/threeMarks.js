'use strict';
const cheerio=require('cheerio');
function normalized(value){return String(value||'').replace(/\s+/g,' ').trim();}
function threeMarksDescription(html,url,native) {
  let source;try{source=new URL(url);}catch{return null;}
  if(!['threemarkscoffee.com','www.threemarkscoffee.com'].includes(source.hostname) || !/^\/products\/[^/]+\/?$/.test(source.pathname) || !native?.variants?.length)return null;
  const $=cheerio.load(html||''),canonical=$('link[rel="canonical"]'),root=$('main [id^="ProductInformation-"]');
  if(canonical.length!==1 || root.length!==1)return null;
  let target;try{target=new URL(canonical.attr('href'),url);}catch{return null;}
  if(target.origin!==source.origin || target.pathname.replace(/\/$/,'')!==source.pathname.replace(/\/$/,'') || root.find('h1').length!==1 || normalized(root.find('h1').text())!==normalized(native.title))return null;
  // This theme's primary product form proves which native variants own the
  // adjacent metafield accordions. Related-product forms outside this root
  // cannot contribute text, even if they have the same CSS classes.
  const selected=root.find('input[name="id"][data-variant-id]');
  if(selected.length!==1 || !native.variants.some(v=>String(v.id)===selected.attr('value')))return null;
  const pieces=[];
  for(const el of root.find('[class*="__text_notas_cafe"], .tm-accordion-metafield').toArray()) {
    const copy=$(el).clone();copy.find('script,style,iframe,form,button').remove();
    const text=normalized(copy.text());
    if(text && !pieces.some(p=>p.text===text))pieces.push({text,html:copy.html()});
  }
  if(!pieces.length)return null;
  return pieces.map(p=>p.html).join('\n');
}
module.exports={threeMarksDescription};
