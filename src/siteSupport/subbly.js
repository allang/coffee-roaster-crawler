'use strict';
const cheerio=require('cheerio');
const {flightObjects}=require('./headlessShopify');
const marketContracts=new WeakMap();
function products(html) {
  const found=[];
  function walk(value,depth=0){if(!value || typeof value!=='object' || depth>80)return;if(value.product?.id && value.product?.slug)found.push(value.product);for(const child of Object.values(value))walk(child,depth+1);}
  flightObjects(html).forEach(value=>walk(value));return found;
}
function retail(product){return product.type==='one_time' && product.giftCard===false && product.digital===false && product.bundleId==null;}
async function discoverSubblyProducts(roaster,profile,fetchHtml) {
  const urls=new Set(),evidence=[];
  try{
    for(const path of profile.listing_paths){
      const url=new URL(path,roaster.website_url).href,response=await fetchHtml(url);
      if(!response.success)throw Error(response.error || 'Subbly collection fetch failed');
      const base=new URL(response.finalUrl || url),$=cheerio.load(response.data);
      if(!profile.hosts.includes(base.hostname) || base.pathname!==path)throw Error('Subbly collection owner/path mismatch');
      const rows=products(response.data),ids=rows.map(p=>String(p.id));
      if(new Set(ids).size!==ids.length)throw Error('Duplicate Subbly catalog product');
      if($('a[href*="page="]').length || $('button').toArray().some(e=>/^(?:load more|next page)$/i.test($(e).text().trim())))throw Error('Unreviewed Subbly pagination');
      for(const product of rows.filter(retail)){
        if(!Number.isSafeInteger(product.id) || product.id<=0 || !/^[a-z0-9][a-z0-9-]*$/i.test(product.slug))throw Error('Invalid Subbly product identity');
        const target=new URL('/shop/'+product.slug,base);
        if(!$('a[href]').toArray().some(e=>new URL($(e).attr('href'),base).href===target.href))throw Error('Subbly product has no published link');
        urls.add(target.href);
      }
      evidence.push({listing:url,products:rows.length,coffeeProducts:rows.filter(retail).length});
    }
    return {supported:true,urls:[...urls],complete:true,evidence};
  }catch(error){return {supported:true,urls:[...urls],complete:false,error:error.message,evidence};}
}
async function marketContract(html,profile,fetchHtml) {
  const $=cheerio.load(html);
  if(!$('script[src]').toArray().some(e=>$(e).attr('src')===profile.formatter_path))throw Error('Subbly formatter version changed');
  let contracts=marketContracts.get(fetchHtml);if(!contracts){contracts=new Map();marketContracts.set(fetchHtml,contracts);}
  const url='https://'+profile.hosts[0]+profile.formatter_path;
  if(!contracts.has(url))contracts.set(url,(async()=>{
    const response=await fetchHtml(url);
    // Reviewed merchant frontend formats every variant's integer price in CAD
    // after dividing by 100. Recheck that code contract, without executing it.
    if(!response.success || !/formatAmount:\(t,r\)=>e\.number\(t\/100,\{style:"currency",currency:"CAD"\}\)/.test(response.data))throw Error('Subbly price unit/currency contract changed');
    return 'CAD';
  })());
  return contracts.get(url);
}
async function fetchSubblyProduct(html,sourceUrl,profile,fetchHtml) {
  const url=new URL(sourceUrl),slug=url.pathname.match(/^\/shop\/([a-z0-9-]+)\/?$/i)?.[1];
  if(!slug || !profile.hosts.includes(url.hostname))throw Error('Invalid Subbly product URL');
  const candidates=products(html).filter(p=>p.slug===slug);
  if(candidates.length!==1)throw Error('Subbly primary product missing or ambiguous');
  const product=candidates[0],$=cheerio.load(html),heading=$('main h1').first(),primary=heading.parent();
  if(!retail(product) || heading.text().trim()!==product.name || !Number.isSafeInteger(product.id) || !Array.isArray(product.variants) || !product.variants.length)throw Error('Subbly primary identity mismatch');
  const ids=product.variants.map(v=>String(v.id));
  if(new Set(ids).size!==ids.length || product.variants.some(v=>!Number.isSafeInteger(v.id) || v.id<=0 || !Number.isSafeInteger(v.price) || v.price<0 || v.priceScheme?.type!=='flat_price' || v.priceScheme.amount!==v.price))throw Error('Invalid Subbly variant/flat price');
  const currency=await marketContract(html,profile,fetchHtml),visible=primary.children('div').first().text().trim().match(/^CA\$([\d,]+\.\d{2})$/);
  if(!visible || Math.round(Number(visible[1].replaceAll(',',''))*100)!==Math.min(...product.variants.map(v=>v.price)))throw Error('Subbly visible primary price disagrees with native variants');
  const offers=product.variants.map(v=>({'@type':'Offer','@id':String(v.id),name:v.name,url:new URL('?variant='+v.id,url).href,price:(v.price/100).toFixed(2),priceCurrency:currency,
    availability:v.stockCount===null || Number.isSafeInteger(v.stockCount) && v.stockCount>0?'https://schema.org/InStock':v.stockCount===0?'https://schema.org/OutOfStock':null}));
  return {'@type':'Product',url:url.href,productID:String(product.id),name:product.name,category:'Roasted coffee',description:primary.find('.rich-text').first().html() || '',image:product.images?.[0]?.url,offers,_market_source:'subbly_primary_variants_reviewed_formatter',_variants_complete:true};
}
module.exports={products,retail,discoverSubblyProducts,fetchSubblyProduct};
