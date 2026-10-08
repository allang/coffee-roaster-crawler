'use strict';
const cheerio=require('cheerio');
const {jsonLiteral}=require('./jsonLiteral');
const {sameProduct,schemaAvailability}=require('../productEvidence');
const {parseMoney}=require('../catalogNormalization');
const {imageUrl}=require('../productImages');
const SOURCE='txt_imweb_primary_product_offer';
function schemas($) {
  const out=[];$('script[type="application/ld+json"]').each((_,e)=>{try{out.push(...[JSON.parse($(e).text())].flat());}catch{}});return out;
}
function owned(value,profile,product=false) {
  const url=new URL(value),base=new URL(profile.bootstrap_url);
  if(url.protocol!=='https:' || url.origin!==base.origin || url.username || url.password || product && (!/^\/(?:shop_view|coffeesubscriptions)\/?$/.test(url.pathname) || !/^[1-9]\d*$/.test(url.searchParams.get('idx') || '') || [...url.searchParams.keys()].some(k=>k!=='idx')))throw Error('.txt unreviewed primary URL');
  return url;
}
function context(html,profile) {
  const $=cheerio.load(html),stores=schemas($).filter(p=>p['@type']==='OnlineStore' && p.url && new URL(p.url).origin===new URL(profile.bootstrap_url).origin);
  const siteCodes=new Set(),unitCodes=new Set();
  $('script:not([src])').each((_,e)=>{const script=$(e).text();for(const m of script.matchAll(/\bsiteCode\s*:\s*["'](S[0-9a-f]+)["']/g))siteCodes.add(m[1]);for(const m of script.matchAll(/\bunitCode\s*:\s*["'](u[0-9a-f]+)["']/g))unitCodes.add(m[1]);});
  if(stores.length!==1 || stores[0].name!==profile.imweb_brand || siteCodes.size!==1 || !siteCodes.has(profile.imweb_site_code) || unitCodes.size!==1 || !unitCodes.has(profile.imweb_unit_code) || profile.market_scope!=='EN' || profile.market_currency!=='USD')throw Error('.txt English merchant/unit context mismatch');
  return $;
}
function config($) {
  const found=[];$('script:not([src])').each((_,e)=>{const source=$(e).text();for(const m of source.matchAll(/\bSITE_SHOP_DETAIL\.initDetail\s*\(/g)){const start=m.index+m[0].length;const opening=source.slice(start).match(/^\s*\{/);if(!opening)throw Error('.txt native configuration is not JSON');const value=jsonLiteral(source,start+opening[0].length-1);if(!value)throw Error('.txt native configuration invalid');found.push(value);}});
  if(found.length!==1)throw Error('.txt native primary configuration missing/ambiguous');return found[0];
}
function cards(html,url,profile) {
  const $=context(html,profile),products=new Map();
  $('[data-product-properties]').each((_,e)=>{
    let product;try{product=JSON.parse($(e).attr('data-product-properties'));}catch{throw Error('.txt native card JSON invalid');}
    if(!Number.isSafeInteger(product.idx) || product.idx<=0 || !/^s[0-9a-f]+$/.test(product.code || '') || typeof product.name!=='string' || !product.name.trim() || products.has(product.idx))throw Error('.txt native card identity missing/repeated');
    const links=[...new Set($(e).find('a[href]').map((_,a)=>owned(new URL($(a).attr('href'),url).href,profile,true).href).get())];
    if(links.length!==1 || new URL(links[0]).searchParams.get('idx')!==String(product.idx))throw Error('.txt native card link mismatch');
    const headings=[...new Set($(e).find('h2').map((_,h)=>$(h).text().trim()).get())];if(headings.length!==1 || headings[0]!==product.name)throw Error('.txt native card title mismatch');
    if(profile.exclude_product_codes?.includes(product.code))return;
    if(!/\b(?:blend|ethiopia|colombia|panama|coffee|drip bags)\b/i.test(product.name))throw Error('.txt unreviewed merchandise in coffee scope');
    const primary=new URL('/shop_view/',profile.bootstrap_url);primary.searchParams.set('idx',String(product.idx));products.set(product.idx,{...product,url:primary.href});
  });
  if(!products.size)throw Error('.txt published coffee cards missing');return {products,$};
}
async function discoverTxtProducts(roaster,profile,fetchHtml) {
  const evidence=[],urls=[];
  try {
    let home=null;
    for(const path of profile.listing_paths) {
      const url=new URL(path,profile.bootstrap_url).href,response=await fetchHtml(url);
      if(!response.success)throw Error(response.error || '.txt public collection unavailable');owned(response.finalUrl || url,profile);
      const read=cards(response.data,url,profile);
      if(path==='/')home=read.products;
      else {
        // The published native collection reports one rendered page. Fail closed
        // if pagination changes; this adapter does not infer a complete market.
        const pages=[];read.$('script:not([src])').each((_,e)=>{const s=read.$(e).text();if(!s.includes("'/ajax/get_shop_list_view.cm'"))return;for(const m of s.matchAll(/var\s+page_count\s*=\s*(\d+)\s*;/g))pages.push(Number(m[1]));});
        if(!pages.length || pages.some(p=>p!==1) || read.$('a[rel="next"]').length)throw Error('.txt public collection pagination requires review');
        if(!home || read.products.size!==home.size || [...read.products].some(([idx,p])=>home.get(idx)?.code!==p.code || home.get(idx)?.name!==p.name))throw Error('.txt homepage/coffee collection coverage mismatch');
      }
      evidence.push({listing:url,coffee_products:read.products.size,native_codes:[...read.products.values()].map(p=>p.code),native_indices:[...read.products.keys()]});
    }
    if(!home || evidence.length!==2)throw Error('.txt reviewed scope incomplete');
    urls.push(...[...home.values()].map(p=>p.url));
    return {supported:true,urls,complete:false,observed_scope_complete:true,inventory_complete:false,inventory_scope:'published_english_homepage_and_coffee_collection',market_scope:'EN',reconcile_omissions:false,inventory_authorizes_global_absence:false,evidence};
  }catch(error){return {supported:true,urls:[],complete:false,observed_scope_complete:false,inventory_complete:false,error:error.message,evidence};}
}
function txtProduct(html,url,profile) {
  const primaryUrl=owned(url,profile,true),$=context(html,profile),native=config($),idx=primaryUrl.searchParams.get('idx');
  if(String(native.prod_idx)!==idx || !/^s[0-9a-f]+$/.test(native.prod_code || '') || profile.exclude_product_codes?.includes(native.prod_code) || native.prod_type!=='normal' || native.only_regularly!==null || native.is_price_view_permission!==true || !Number.isInteger(native.require_option_count) || native.require_option_count<0 || typeof native.is_soldout!=='boolean')throw Error('.txt exact native retail product mismatch');
  const products=schemas($).filter(p=>p['@type']==='Product' && [p.offers || []].flat().some(o=>o.url && sameProduct(o.url,url)));
  if(products.length!==1)throw Error('.txt exact primary product offer missing/ambiguous');
  const primary=products[0],offers=[primary.offers || []].flat().filter(o=>o.url && sameProduct(o.url,url));
  if(offers.length!==1 || offers[0].priceCurrency!==profile.market_currency)throw Error('.txt exact English price/currency missing');
  const offer=offers[0],money=parseMoney(offer.price,{currency:offer.priceCurrency}),nativeMoney=parseMoney(native.prod_price,{currency:offer.priceCurrency});
  const heading=$('#prod_detail h1').clone();heading.find('.ns-icon').remove();
  if(heading.length!==1 || heading.text().trim()!==primary.name || money.minorUnits==null || money.minorUnits!==nativeMoney.minorUnits || schemaAvailability(offer.availability)!==(native.is_soldout?'sold_out':'in_stock'))throw Error('.txt primary title/price/stock disagreement');
  const photo=$('#prod_detail #main-image');if(photo.length!==1)throw Error('.txt exact primary photo missing/ambiguous');
  const image=imageUrl(photo.attr('src'),url),imageSource=image && new URL(image);
  if(!imageSource || !['cdn.imweb.me','cdn-optimized.imweb.me'].includes(imageSource.hostname) || !imageSource.pathname.startsWith('/upload/'+profile.imweb_site_code+'/'))throw Error('.txt primary photo owner mismatch');
  const productID=['imweb',profile.market_scope,profile.imweb_site_code,profile.imweb_unit_code,native.prod_code].join(':');
  const productOffer={source:SOURCE,source_url:url,source_product_id:productID,native_product_code:native.prod_code,public_product_index:native.prod_idx,unit_code:profile.imweb_unit_code,price:offer.price,currency:offer.priceCurrency,minor_units:money.minorUnits,availability:offer.availability,state:schemaAvailability(offer.availability),required_options:native.require_option_count,variant_identity_complete:false};
  return {'@type':'Product',url,productID,name:primary.name,description:primary.description || '',category:'Coffee',image,offers:[],_product_only:true,_product_offer:productOffer,_variants_complete:false,_market_source:SOURCE,_market_context:{scope:'published_english_product',currency:'USD',site_code:profile.imweb_site_code,unit_code:profile.imweb_unit_code,inventory_complete:false,domestic_inventory_complete:false,variant_identity_complete:false}};
}
function partialScopeAllowed(profile,discovery) {
  if(!(profile?.adapter==='txt_imweb' && profile.allow_partial_inventory===true && profile.reconcile_omissions===false && profile.inventory_authorizes_global_absence===false && discovery.supported===true && !discovery.error && discovery.complete===false && discovery.observed_scope_complete===true && discovery.inventory_complete===false && discovery.market_scope==='EN' && discovery.inventory_scope==='published_english_homepage_and_coffee_collection' && discovery.reconcile_omissions===false && discovery.inventory_authorizes_global_absence===false && discovery.urls?.length>0 && discovery.evidence?.length===2))return false;
  try {
    const indices=discovery.urls.map(url=>owned(url,profile,true).searchParams.get('idx'));
    if(new Set(indices).size!==indices.length)return false;
    const expectedListings=['/','/coffeesubscriptions'].map(path=>new URL(path,profile.bootstrap_url).href);
    return discovery.evidence.every((row,i)=>row.listing===expectedListings[i] && row.coffee_products===indices.length && row.native_indices?.length===indices.length && new Set(row.native_indices).size===indices.length && row.native_indices.every(idx=>indices.includes(String(idx))) && row.native_codes?.length===indices.length && new Set(row.native_codes).size===indices.length && row.native_codes.every(code=>/^s[0-9a-f]+$/.test(code))) && discovery.evidence[0].native_codes.every(code=>discovery.evidence[1].native_codes.includes(code));
  }catch{return false;}
}
module.exports={SOURCE,context,config,cards,discoverTxtProducts,txtProduct,partialScopeAllowed};
