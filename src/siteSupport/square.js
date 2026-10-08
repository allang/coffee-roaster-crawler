'use strict';
const cheerio=require('cheerio');
const {canonicalProductUrl}=require('../catalogNormalization');
function bootstrap(html) {
  const $=cheerio.load(html || '');let result=null,count=0;
  $('script:not([src])').each((_,element)=>{
    const s=$(element).text().trim(),prefix='window.__BOOTSTRAP_STATE__ = ';
    if(!s.startsWith(prefix))return;
    count++;try{result=JSON.parse(s.slice(prefix.length).replace(/;\s*$/,''));}catch{}
  });return count===1?result:null;
}
function context(html,profile) {
  const state=bootstrap(html),currency=state?.storeInfo?.currency;
  if(String(state?.siteData?.site?.properties?.classicSiteID)!==profile.square_site_id || String(state?.siteData?.user?.id)!==profile.square_owner_id || !/^[A-Z]{3}$/.test(currency || ''))throw Error('Square merchant context mismatch');
  return {currency,merchant_id:state.storeInfo.merchant_id};
}
function apiBase(profile) {return profile.catalog_origin+'/app/store/api/v28/editor/users/'+profile.square_owner_id+'/sites/'+profile.square_site_id;}
async function readJson(url,fetchHtml) {
  const response=await fetchHtml(url);if(!response.success)throw Error(response.error || 'Square catalog fetch failed');
  try{return JSON.parse(response.data);}catch{throw Error('Invalid Square catalog JSON');}
}
async function paged(url,fetchHtml) {
  const rows=[];let total=null;
  for(let page=1;page<=30;page++) {
    const request=new URL(url);request.searchParams.set('page',String(page));request.searchParams.set('per_page','100');
    const result=await readJson(request.href,fetchHtml),pagination=result.meta?.pagination;
    if(!Array.isArray(result.data) || !Number.isInteger(pagination?.total_pages) || pagination.current_page!==page || !Number.isInteger(pagination.total))throw Error('Invalid Square pagination');
    if(total!==null && total!==pagination.total)throw Error('Square inventory changed during pagination');total=pagination.total;
    rows.push(...result.data);
    if(page>=pagination.total_pages){if(rows.length!==total)throw Error('Truncated Square catalog');return rows;}
  }throw Error('Square pagination limit');
}
async function discoverSquareProducts(roaster,profile,fetchHtml) {
  try {
    const home=await fetchHtml(roaster.website_url);if(!home.success)throw Error('Square homepage unavailable');context(home.data,profile);
    const urls=new Set(),evidence=[];
    for(const category of profile.coffee_category_ids) {
      const url=new URL(apiBase(profile)+'/products');
      url.search=new URLSearchParams({'categories[]':category,include:'images,media_files,discounts',excluded_fulfillment:'dine_in','cache-version':'2026-03-25'}).toString();
      const items=await paged(url.href,fetchHtml);
      for(const item of items) {
        if(item.owner_id!==profile.square_owner_id || !item.categoryIds?.includes(category))throw Error('Square product belongs to a different merchant/category');
        if(item.visibility!=='visible' || item.only_subscribable || /gift\s*card|subscription/i.test(item.name))continue;
        const link=new URL(item.absolute_site_link);
        if(!profile.hosts.includes(link.hostname) || !/^\/product\/[^/]+\/[a-z0-9]+\/?$/i.test(link.pathname))throw Error('Square source URL mismatch');
        urls.add(link.href);
      }
      evidence.push({category,products:items.length});
    }
    return {supported:true,urls:[...urls],complete:urls.size>0,evidence};
  }catch(error){return {supported:true,urls:[],complete:false,error:error.message};}
}
async function fetchSquareProduct(html,sourceUrl,profile,fetchHtml) {
  const merchant=context(html,profile),url=new URL(sourceUrl),id=url.pathname.match(/^\/product\/[^/]+\/([a-z0-9]+)\/?$/i)?.[1];
  if(!id)throw Error('Invalid Square product URL');
  const product=(await readJson(apiBase(profile)+'/products/'+id+'?include=images,options,category,fulfillment&cache-version=2026-03-25',fetchHtml)).data;
  if(!product || product.owner_id!==profile.square_owner_id || product.merchant_id!==merchant.merchant_id || String(product.site_product_id)!==id || canonicalProductUrl(product.absolute_site_link)!==canonicalProductUrl(sourceUrl))throw Error('Square primary product mismatch');
  const skus=await paged(apiBase(profile)+'/products/'+id+'/skus?include=image,product&cache-version=2026-03-25',fetchHtml);
  if(!skus.length || new Set(skus.map(s=>s.id)).size!==skus.length || skus.some(s=>s.product_square_id!==product.id || String(s.site_product_id)!==id || s.owner_id!==profile.square_owner_id))throw Error('Square exact variant mismatch');
  const offers=skus.map(s=>{
    const knownSoldOut=s.sold_out===true;
    const buyable=s.sold_out===false && s.sellable===true && s.fulfillable===true && s.fulfillment?.methods?.shipping===true && product.preordering?.shipping===false;
    return {'@type':'Offer','@id':s.id,name:s.name,sku:s.id,_merchant_sku:s.sku || null,url:sourceUrl,price:s.price?.current,priceCurrency:merchant.currency,availability:knownSoldOut?'https://schema.org/OutOfStock':buyable?'https://schema.org/InStock':null};
  });
  return {'@type':'Product',url:sourceUrl,productID:product.id,name:product.name,description:product.short_description || '',category:product.category?.data?.name || '',image:product.images?.data?.[0]?.absolute_url || product.thumbnail?.data?.absolute_url,offers,_variants_complete:true,_market_source:'square_public_catalog_skus'};
}
module.exports={bootstrap,context,apiBase,paged,discoverSquareProducts,fetchSquareProduct};
