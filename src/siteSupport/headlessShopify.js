'use strict';
const cheerio=require('cheerio');

// Read JSON literals from React Flight hydration, never evaluate merchant scripts.
// Only a primary `product` prop with the requested handle can supply market data.
function flightObjects(html) {
  const $=cheerio.load(html || ''),chunks=[];
  $('script:not([src])').each((_,element)=>{
    const source=$(element).text().trim();
    const match=source.match(/^self\.__next_f\.push\((\[[\s\S]*\])\);?$/);
    if(!match)return;
    try { const value=JSON.parse(match[1]);if(value[0]===1 && typeof value[1]==='string')chunks.push(value[1]); } catch {}
  });
  const objects=[],stream=chunks.join(''),records=/[0-9a-f]+:(?=[\[{])/gi;
  // Flight text records are length-prefixed and need not end with a newline.
  // Locate JSON record boundaries and parse only balanced JSON, never JS.
  for(let match;(match=records.exec(stream));) {
    const start=records.lastIndex;let depth=0,quoted=false,escaped=false;
    for(let end=start;end<stream.length;end++) {
      const char=stream[end];
      if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
      if(char==='"'){quoted=true;continue;}
      if(char==='[' || char==='{')depth++;
      else if(char===']' || char==='}')depth--;
      if(depth===0){try{objects.push(JSON.parse(stream.slice(start,end+1)));records.lastIndex=end+1;}catch{}break;}
    }
  }
  return objects;
}
function collectProps(objects,key) {
  const found=[];
  function walk(value,depth=0) {
    if(!value || typeof value!=='object' || depth>80)return;
    if(!Array.isArray(value) && Object.hasOwn(value,key))found.push(value[key]);
    for(const child of Object.values(value))walk(child,depth+1);
  }
  for(const object of objects)walk(object);
  return found;
}
function nativeId(value,kind) { const m=String(value || '').match(new RegExp('^gid://shopify/'+kind+'/([1-9]\\d*)$'));return m?.[1] || null; }
function headlessShopifyProduct(html,sourceUrl) {
  let url,handle;try{url=new URL(sourceUrl);handle=decodeURIComponent(url.pathname.match(/^\/products?\/([^/]+)\/?$/)?.[1] || '');}catch{return null;}
  if(!handle)return null;
  const found=collectProps(flightObjects(html),'product').filter(p=>p?.handle===handle && nativeId(p.id,'Product'));
  // Multiple primary objects are ambiguous even if a recommendation shares the name.
  if(found.length!==1)return null;
  const product=found[0];
  if(!product.title || !Array.isArray(product.variants) || !product.variants.length)return null;
  const ids=product.variants.map(v=>nativeId(v.id,'ProductVariant'));
  if(ids.some(id=>!id) || new Set(ids).size!==ids.length)return null;
  const offers=product.variants.map((v,i)=>({
    '@type':'Offer','@id':ids[i],name:v.title,
    url:new URL('?variant='+ids[i],url).href,
    price:v.price?.amount,priceCurrency:v.price?.currencyCode || null,
    availability:v.availableForSale===true?'https://schema.org/InStock':v.availableForSale===false?'https://schema.org/OutOfStock':null,
  }));
  return {'@type':'Product',url:url.href,productID:nativeId(product.id,'Product'),name:product.title,
    description:typeof product.descriptionHtml==='string' && !/^\$[0-9a-f]+$/i.test(product.descriptionHtml)?product.descriptionHtml:product.description || '',
    image:product.featuredImage?.url || product.images?.[0]?.url,
    category:product.productType || (product.tags || []).join(' '),offers,
    _market_source:'headless_shopify_primary_product'};
}
function headlessCollectionProducts(html) {
  return collectProps(flightObjects(html),'initialProducts').flat().filter(p=>p && nativeId(p.id,'Product'));
}
function headlessCollectionPage(html,collection) {
  // Locate the containing props rather than relying on React element positions.
  const candidates=[];
  function walk(v,depth=0){if(depth>80 || !v || typeof v!=='object')return;if(v.collection===collection && Array.isArray(v.initialProducts))candidates.push(v);for(const x of Object.values(v))if(x && typeof x==='object')walk(x,depth+1);}
  flightObjects(html).forEach(walk);
  if(candidates.length!==1)return null;
  return {products:candidates[0].initialProducts,pageInfo:candidates[0].initialPageInfo};
}
function isCoffee(product) {
  const explicit=`${product.productType || ''} ${(product.tags || []).join(' ')} ${product.description || ''}`;
  return /roasted\s+coffee\s+beans|filter\s+beans|espresso\s+beans|\bdrip pack\b|\bapril coffee\b/i.test(explicit)
    && !/\b(?:green coffee|cascara|tasting menu|gift\s*card|subscription|brewer|paper filter|bundle|cup|mug|thermos|trousers?|shirts?|hoodie|jacket|stickers?|poster|book|cap|hat)\b/i.test(product.title || '');
}
module.exports={flightObjects,headlessShopifyProduct,headlessCollectionProducts,headlessCollectionPage,isCoffee};
