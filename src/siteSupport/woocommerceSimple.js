'use strict';
const cheerio=require('cheerio');
const {canonicalProductUrl,parseMoney}=require('../catalogNormalization');
async function readJson(url,profile,fetchHtml){
 const response=await fetchHtml(url);if(!response.success)throw Error(response.error || 'WooCommerce public catalog unavailable');
 if(!profile.hosts.includes(new URL(response.finalUrl || url).hostname))throw Error('WooCommerce API owner mismatch');
 try{return JSON.parse(response.data);}catch{throw Error('Invalid WooCommerce product JSON');}
}
function catalogUrl(profile,sourceUrl){return new URL(profile.store_api_path,sourceUrl);}
function coffeeProduct(product,profile){return product.categories?.some(c=>profile.coffee_category_ids.includes(String(c.id)));}
function reviewedProduct(product,profile){
 if(!Number.isSafeInteger(product.id) || product.id<=0 || !coffeeProduct(product,profile))throw Error('WooCommerce product/category identity mismatch');
 const url=new URL(product.permalink);if(!profile.hosts.includes(url.hostname) || !/^\/product\/[a-z0-9][a-z0-9_-]*\/?$/i.test(url.pathname))throw Error('WooCommerce product source mismatch');
 if(product.type!=='simple' || product.has_options!==false || !Array.isArray(product.variations) || product.variations.length || product.is_password_protected===true)throw Error('WooCommerce complete simple SKU source required');
 return url.href;
}
async function discoverWooProducts(roaster,profile,fetchHtml){
 const urls=new Set(),ids=new Set(),evidence=[];
 try{
  for(const category of profile.coffee_category_ids){let exhausted=false;
   for(let page=1;page<=40;page++){
    const url=catalogUrl(profile,roaster.website_url);url.search=new URLSearchParams({category,per_page:'100',page:String(page),orderby:'id',order:'asc'}).toString();
    const products=await readJson(url.href,profile,fetchHtml);if(!Array.isArray(products))throw Error('WooCommerce inventory array missing');
    evidence.push({listing:url.href,page,products:products.length});if(!products.length){exhausted=true;break;}
    for(const product of products){const source=reviewedProduct(product,profile);if(ids.has(product.id))throw Error('WooCommerce repeated inventory identity');ids.add(product.id);urls.add(source);}
   }
   if(!exhausted)throw Error('WooCommerce inventory page limit reached');
  }
  return {supported:true,urls:[...urls],complete:urls.size>0,evidence};
 }catch(error){return {supported:true,urls:[...urls],complete:false,error:error.message,evidence};}
}
function decimalPrice(prices){
 const scale=prices?.currency_minor_unit,currency=prices?.currency_code,minor=prices?.price;
 if(!Number.isInteger(scale) || scale<0 || scale>3 || !/^[A-Z]{3}$/.test(currency || '') || !/^\d+$/.test(minor || '') || prices.price_range!==null)throw Error('WooCommerce exact market amount missing');
 const digits=String(minor).padStart(scale+1,'0'),decimal=scale?digits.slice(0,-scale)+'.'+digits.slice(-scale):digits,money=parseMoney(decimal,{currency,locale:'en-US'});
 if(money.exponent!==scale || !Number.isSafeInteger(Number(minor)) || money.minorUnits!==Number(minor))throw Error('WooCommerce currency minor-unit mismatch');
 return decimal;
}
async function fetchWooProduct(html,sourceUrl,profile,fetchHtml){
 const slug=new URL(sourceUrl).pathname.match(/^\/product\/([a-z0-9][a-z0-9_-]*)\/?$/i)?.[1];if(!slug)throw Error('Invalid WooCommerce product path');
 const url=catalogUrl(profile,sourceUrl);url.search=new URLSearchParams({slug,category:profile.coffee_category_ids.join(','),per_page:'100',page:'1'}).toString();
 const products=await readJson(url.href,profile,fetchHtml);if(!Array.isArray(products) || products.length!==1)throw Error('WooCommerce unique primary product missing');
 const product=products[0];reviewedProduct(product,profile);
 if(product.slug!==slug || canonicalProductUrl(product.permalink)!==canonicalProductUrl(sourceUrl))throw Error('WooCommerce canonical primary product mismatch');
 const $=cheerio.load(html || ''),root=$('[id="product-'+product.id+'"]'),heading=root.find('h1.product_title');
 if(root.length!==1 || heading.length!==1 || heading.text().trim()!==product.name)throw Error('WooCommerce primary page identity mismatch');
 const price=decimalPrice(product.prices),size=require('./shopifyPageFields').nativeDescriptionWeight(product.short_description),soldOut=product.is_in_stock===false,buyable=product.is_in_stock===true && product.is_purchasable===true && product.is_on_backorder===false;
 return {'@type':'Product',url:sourceUrl,productID:String(product.id),name:product.name,description:[product.short_description,product.description].filter(Boolean).join('\n'),category:'Coffee',image:product.images?.[0]?.src,offers:[{'@type':'Offer','@id':String(product.id),sku:String(product.id),name:'default',url:sourceUrl,price,priceCurrency:product.prices.currency_code,_net_weight_g:size,availability:soldOut?'https://schema.org/OutOfStock':buyable?'https://schema.org/InStock':null}],_variants_complete:true,_market_source:'woocommerce_public_store_product'};
}
module.exports={readJson,discoverWooProducts,fetchWooProduct,decimalPrice};
