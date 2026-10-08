'use strict';
const cheerio=require('cheerio');
const {sameProduct}=require('../productEvidence');
const {parseWeightGrams}=require('../product-value-parsers.cjs');
function productPathMatches(url,profile){const path=new URL(url).pathname,prefix=profile.product_path || '/product/';return path.startsWith(prefix) && /^[^/]+\/?$/.test(path.slice(prefix.length));}
function merchantUrl(value,profile) {
  const url=new URL(value);
  if(url.protocol!=='https:' || !profile.hosts.includes(url.hostname) || !productPathMatches(value,profile))throw Error('WooCommerce product owner/path mismatch');
  return url.href;
}
function coffee(product,profile) {
  const category=Array.isArray(product.categories) && product.categories.some(c=>profile.coffee_category_ids?.includes(c.id));
  return (category || profile.coffee_catalog_verified===true && ['simple','variable'].includes(product.type)) && !/(?:^|-)subscription$/.test(product.type || '') && !/\b(?:subscription|abonnement|wholesale|gift|cascara|green coffee|equipment)\b/i.test(product.name || '') && !(profile.exclude_name_pattern && new RegExp(profile.exclude_name_pattern,'i').test(product.name || ''));
}
async function readJson(url,fetchHtml) {
  const response=await fetchHtml(url);if(!response.success)throw Error(response.error || 'WooCommerce catalog fetch failed');
  try{return {...response,value:JSON.parse(response.data)};}catch{throw Error('Invalid WooCommerce JSON');}
}
async function discoverWooProducts(roaster,profile,fetchHtml) {
  if(profile.adapter==='woocommerce_store')return require('./woocommerceSimple').discoverWooProducts(roaster,profile,fetchHtml);
  const urls=new Set(),evidence=[];let pages=null,total=null,observed=0;const ids=new Set();
  try {
    for(let page=1;page<=40;page++) {
      const url=new URL(profile.catalog_path,roaster.website_url);url.search=new URLSearchParams({...profile.catalog_query,...profile.catalog_category_id?{category:String(profile.catalog_category_id)}:{},per_page:String(profile.catalog_page_size || 100),page:String(page)}).toString();
      const response=await readJson(url.href,fetchHtml),products=response.value;
      if(!Array.isArray(products) || !Number.isSafeInteger(response.catalogTotal) || !Number.isSafeInteger(response.catalogPages))throw Error('WooCommerce pagination totals missing');
      if(pages==null){pages=response.catalogPages;total=response.catalogTotal;}
      if(pages!==response.catalogPages || total!==response.catalogTotal || pages<1 || pages>40)throw Error('WooCommerce pagination changed or incomplete');
      for(const product of products) {
        if(!Number.isSafeInteger(product.id) || product.id<=0 || ids.has(product.id))throw Error('WooCommerce product identity repeated/invalid');
        ids.add(product.id);observed++;
        if(coffee(product,profile))urls.add(merchantUrl(product.permalink,profile));
      }
      evidence.push({listing:url.href,page,products:products.length,coffeeProducts:products.filter(p=>coffee(p,profile)).length,total,pages});
      if(page===pages){if(observed!==total)throw Error('WooCommerce inventory total mismatch');return {supported:true,urls:[...urls],complete:true,evidence};}
      if(!products.length)throw Error('WooCommerce inventory ended early');
    }
    throw Error('WooCommerce inventory page limit');
  }catch(error){return {supported:true,urls:[...urls],complete:false,error:error.message,evidence};}
}
function decimal(prices) {
  if(!/^\d+$/.test(prices?.price || '') || !/^[A-Z]{3}$/.test(prices.currency_code || '') || !Number.isInteger(prices.currency_minor_unit) || prices.currency_minor_unit<0 || prices.currency_minor_unit>3)throw Error('WooCommerce exact variant price/currency missing');
  const digits=prices.price.padStart(prices.currency_minor_unit+1,'0'),n=prices.currency_minor_unit;
  return n?digits.slice(0,-n)+'.'+digits.slice(-n):digits;
}
function offer(variant,identity,title,url) {
  const price=decimal(variant.prices);
  return {'@type':'Offer','@id':String(identity),name:title,url,price,priceCurrency:variant.prices.currency_code,
    availability:variant.is_in_stock===false?'https://schema.org/OutOfStock':variant.is_purchasable===true && variant.is_on_backorder===true?'https://schema.org/BackOrder':variant.is_in_stock===true && variant.is_purchasable===true && variant.is_on_backorder===false?'https://schema.org/InStock':null,
    _stock_evidence:{merchant_in_stock:variant.is_in_stock,merchant_purchasable:variant.is_purchasable,merchant_backorder:variant.is_on_backorder}};
}
async function fetchWooProduct(html,url,profile,fetchHtml) {
  if(profile.adapter==='woocommerce_store')return require('./woocommerceSimple').fetchWooProduct(html,url,profile,fetchHtml);
  const $=cheerio.load(html),bodyIds=($('body').attr('class') || '').match(/(?:^|\s)postid-(\d+)(?=\s|$)/g) || [];
  const ids=new Set(bodyIds.map(x=>x.trim().slice(7)));
  if(ids.size!==1)throw Error('WooCommerce primary product ID missing/ambiguous');
  const id=[...ids][0],endpoint=new URL(profile.catalog_path+'/'+id,url);endpoint.search=new URLSearchParams(profile.catalog_query || {}).toString();const product=(await readJson(endpoint.href,fetchHtml)).value;
  if(String(product.id)!==id || product.parent!==0 || !sameProduct(merchantUrl(product.permalink,profile),url) || !coffee(product,profile))throw Error('WooCommerce primary product mismatch');
  const offers=[];
  if(product.type==='variable') {
    if(!Array.isArray(product.variations) || !product.variations.length || product.variations.length>100)throw Error('WooCommerce exact variants missing');
    const seen=new Set();
    for(const member of product.variations) {
      if(!Number.isSafeInteger(member.id) || member.id<=0 || seen.has(member.id))throw Error('WooCommerce variant ID invalid/repeated');seen.add(member.id);
      const variantEndpoint=new URL(profile.catalog_path+'/'+member.id,url);variantEndpoint.search=new URLSearchParams(profile.catalog_query || {}).toString();const variant=(await readJson(variantEndpoint.href,fetchHtml)).value;
      const variantUrl=merchantUrl(variant.permalink,profile);
      if(variant.id!==member.id || variant.parent!==product.id || variant.type!=='variation' || !sameProduct(variantUrl,url))throw Error('WooCommerce variant parent mismatch');
      if(!Array.isArray(member.attributes) || member.attributes.some(a=>!a.name || typeof a.value!=='string' && a.value!==null))throw Error('WooCommerce variant attributes missing');
      // Empty WooCommerce attribute values explicitly mean any option (e.g. any
      // grind). They share this exact native variant; never synthesize new SKUs.
      const resolved=member.attributes.filter(a=>a.value).map(a=>{const terms=(product.attributes || []).filter(p=>p.name===a.name).flatMap(p=>p.terms || []).filter(t=>t.slug===a.value || t.name===a.value);return {...a,label:terms.length===1?terms[0].name:a.value};});
      const title=resolved.map(a=>a.name+': '+a.label).join(' / ') || variant.variation || product.name;
      const sizes=resolved.filter(a=>/^(?:size|bag size|pack size|weight|poids|gewicht|format)$/i.test(a.name)).map(a=>parseWeightGrams(a.label)).filter(v=>v!=null);
      offers.push({...offer(variant,member.id,title,variantUrl),_net_weight_g:sizes.length===1?sizes[0]:null,_variant_options:member.attributes});
    }
  } else if(product.type==='simple') {
    const sizes=(product.attributes || []).filter(a=>/^(?:size|bag size|pack size|weight|poids|gewicht|format)$/i.test(a.name) && a.terms?.length===1).map(a=>parseWeightGrams(a.terms[0].name)).filter(v=>v!=null);
    let netWeight=sizes.length===1?sizes[0]:null;
    if(profile.net_weight_row_selector){const values=$(profile.net_weight_row_selector).filter((_,e)=>$(e).children('span').first().text().trim()==='Net Weight').map((_,e)=>$(e).children('span').eq(1).text().trim()).get();if(values.length>1)throw Error('WooCommerce primary net weight ambiguous');if(values.length){netWeight=parseWeightGrams(values[0]);if(netWeight==null)throw Error('WooCommerce explicit net weight invalid');}}
    offers.push({...offer(product,product.id,product.name,product.permalink),_net_weight_g:netWeight});
  }
  else throw Error('Unsupported WooCommerce product type');
  const primary=profile.description_selector?$(profile.description_selector).clone():null;
  primary?.find('script,style,form,button').remove();
  const description=[product.description,product.short_description,primary?.text().replace(/\s+/g,' ').trim()].find(value=>cheerio.load(value || '').text().trim()) || '';
  return {'@type':'Product',url:product.permalink,productID:String(product.id),name:cheerio.load(product.name).text(),description,image:product.images?.[0]?.src,category:'coffee',offers,
    additionalProperty:(product.attributes || []).filter(a=>!a.has_variations).map(a=>({name:a.name,value:(a.terms || []).map(t=>t.name).join(', ')})),_variants_complete:true,_market_source:'woocommerce_store_exact_variant'};
}
module.exports={discoverWooProducts,fetchWooProduct,productPathMatches,readJson:require('./woocommerceSimple').readJson,decimalPrice:require('./woocommerceSimple').decimalPrice};
