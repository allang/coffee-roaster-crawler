'use strict';
const cheerio=require('cheerio');
const {canonicalProductUrl,parseMoney}=require('../catalogNormalization');
const {parseWeightGrams}=require('../product-value-parsers.cjs');
async function pageJson(url,profile,fetchHtml){const target=new URL(url);target.search='format=json';const r=await fetchHtml(target.href);if(!r.success)throw Error(r.error || 'Squarespace public source unavailable');if(!profile.hosts.includes(new URL(r.finalUrl || target).hostname))throw Error('Squarespace API owner mismatch');let d;try{d=JSON.parse(r.data);}catch{throw Error('Invalid Squarespace public JSON');}if(d.website?.id!==profile.squarespace_website_id || d.collection?.id!==profile.squarespace_collection_id)throw Error('Squarespace merchant/collection identity mismatch');return d;}
function coffeeCategories(data,profile){
 const nodes=data.nestedCategories?.categories,ids=new Set();if(!Array.isArray(nodes))throw Error('Squarespace coffee taxonomy missing');
 function collect(node){ids.add(node.id);for(const child of node.children || [])collect(child);}
 function find(nodes){for(const node of nodes){if(node.id===profile.coffee_category_id){collect(node);return true;}if(find(node.children || []))return true;}return false;}
 if(!find(nodes))throw Error('Squarespace verified coffee category missing');return ids;
}
function coffeeItem(item,ids){return item.recordType===11 && item.workflowState===1 && item.structuredContent?.productType===1 && item.structuredContent?.isSubscribable===false && item.categoryIds?.some(id=>ids.has(id));}
function productUrl(item,profile,base){const url=new URL(item.fullUrl,base);require('./network').allowed(url.href,profile.hosts);if(!/^[a-f0-9]{24}$/.test(item.id || '') || item.collectionId!==profile.squarespace_collection_id || url.search || url.hash || !/^\/shop\/p\/[a-z0-9][a-z0-9_/-]*\/?$/i.test(url.pathname) || url.pathname.includes('//'))throw Error('Squarespace product source identity mismatch');return url.href;}
async function discoverSquarespaceProducts(roaster,profile,fetchHtml){
 const urls=[],evidence=[];
 try{const d=await pageJson(new URL(profile.listing_path,roaster.website_url).href,profile,fetchHtml),ids=coffeeCategories(d,profile);if(!Array.isArray(d.items) || !Number.isInteger(d.collection.itemCount))throw Error('Squarespace inventory contract missing');
  if(new Set(d.items.map(i=>i.id)).size!==d.items.length)throw Error('Squarespace inventory identity repeated');
  const coffees=d.items.filter(i=>coffeeItem(i,ids));for(const item of coffees)urls.push(productUrl(item,profile,roaster.website_url));
  evidence.push({listing:new URL(profile.listing_path,roaster.website_url).href+'?format=json',reported_items:d.collection.itemCount,returned_items:d.items.length,coffee_items:coffees.length,pagination_present:Boolean(d.pagination)});
  if(d.collection.itemCount!==d.items.length || d.pagination?.nextPage===true)throw Error('Squarespace public inventory count incomplete: '+d.items.length+' returned / '+d.collection.itemCount+' declared');
  return {supported:true,urls,complete:urls.length>0,evidence,inventory_authorizes_global_absence:false};
 }catch(error){return {supported:true,urls,complete:false,error:error.message,evidence,inventory_authorizes_global_absence:false};}
}
function variantOffer(v,url,total,title){
 if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v.id || '') || typeof v.onSale!=='boolean')throw Error('Squarespace exact SKU identity/price selector missing');
 const price=v.onSale?v.salePriceMoney:v.priceMoney,cents=v.onSale?v.salePrice:v.price,money=parseMoney(price?.value,{currency:price?.currency,locale:'en-US'});
 if(!Number.isSafeInteger(cents) || !money.currency || money.minorUnits!==cents)throw Error('Squarespace paired variant money mismatch');
 const stock=v.unlimited===true?'https://schema.org/InStock':v.unlimited===false && Number.isInteger(v.qtyInStock) && v.qtyInStock>=0?v.qtyInStock>0?'https://schema.org/InStock':'https://schema.org/OutOfStock':null;
 const labels=Object.values(v.attributes || {}),size=parseWeightGrams(v.attributes?.Size) ?? (total===1?parseWeightGrams(title):null);
 return {'@type':'Offer','@id':v.id,sku:v.id,_merchant_sku:v.sku || null,name:labels.join(' / ') || 'default',url,price:price.value,priceCurrency:price.currency,_net_weight_g:size,availability:stock};
}
async function fetchSquarespaceProduct(html,url,profile,fetchHtml){
 const d=await pageJson(url,profile,fetchHtml),item=d.item,ids=coffeeCategories(d,profile);
 if(!item || !coffeeItem(item,ids) || canonicalProductUrl(productUrl(item,profile,url))!==canonicalProductUrl(url))throw Error('Squarespace primary coffee mismatch');
 const $=cheerio.load(html || ''),root=$('article[data-item-id="'+item.id+'"]'),heading=root.find('h1.product-title'),plain=s=>String(s || '').replace(/\s+/g,' ').trim();
 if(root.length!==1 || heading.length!==1 || plain(heading.text())!==plain(item.title))throw Error('Squarespace primary page identity mismatch');
 const variants=item.structuredContent.variants;
 if(!Array.isArray(variants) || !variants.length || variants.length>=250 || new Set(variants.map(v=>v.id)).size!==variants.length)throw Error('Squarespace complete native SKU set missing');
 return {'@type':'Product',productID:item.id,url,name:item.title,description:item.excerpt || item.body || '',category:'Coffee',image:item.assetUrl,offers:variants.map(v=>variantOffer(v,url,variants.length,item.title)),_variants_complete:true,_market_source:'squarespace_primary_native_variants'};
}
module.exports={pageJson,coffeeCategories,coffeeItem,discoverSquarespaceProducts,fetchSquarespaceProduct,variantOffer};
