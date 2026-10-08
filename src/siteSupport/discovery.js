'use strict';
const profiles=require('./profiles.json');
const {headlessCollectionPage,isCoffee}=require('./headlessShopify');
function profileFor(roaster) {
  let host;try{host=new URL(roaster.website_url).hostname.toLowerCase();}catch{return null;}
  return profiles.find(p=>p.entity_ids.includes(roaster.id) && p.hosts.includes(host)) || null;
}
async function discoverSiteProducts(roaster,{fetchHtml}={}) {
  const profile=profileFor(roaster);
  if(!profile)return {supported:false,urls:[],complete:false};
  if(profile.adapter==='shopify')return require('./shopifyDiscovery').discoverShopifyProducts(roaster,profile,fetchHtml);
  if(profile.adapter==='square')return require('./square').discoverSquareProducts(roaster,profile,fetchHtml);
  if(profile.adapter==='cafe24')return require('./domDiscovery').discoverDomProducts(roaster,profile,fetchHtml);
  if(profile.adapter==='subbly')return require('./subbly').discoverSubblyProducts(roaster,profile,fetchHtml);
  const urls=new Set(),evidence=[];
  for(const path of profile.listing_paths) {
    const url=new URL(path,roaster.website_url).href,result=await fetchHtml(url);
    if(!result.success)return {supported:true,urls:[...urls],complete:false,error:result.error || 'Listing fetch failed',evidence};
    const final=new URL(result.finalUrl || url);
    if(!profile.hosts.includes(final.hostname))return {supported:true,urls:[],complete:false,error:'Listing redirected away from verified merchant',evidence};
    const collection=path.split('/').filter(Boolean).at(-1);
    let page=headlessCollectionPage(result.data,collection);const cursors=new Set();
    if(!page?.products?.length)return {supported:true,urls:[...urls],complete:false,error:'Merchant product data missing',evidence};
    for(let count=0;;count++) {
      if(!Array.isArray(page.products) || typeof page.pageInfo?.hasNextPage!=='boolean')return {supported:true,urls:[...urls],complete:false,error:'Invalid inventory pagination',evidence};
      const coffees=page.products.filter(isCoffee);
      for(const product of coffees){if(!/^[a-z0-9][a-z0-9-]*$/i.test(product.handle))return {supported:true,urls:[],complete:false,error:'Invalid merchant handle',evidence};urls.add(new URL(profile.product_path+product.handle,final).href);}
      evidence.push({listing:url,page:count+1,products:page.products.length,coffeeProducts:coffees.length});
      if(!page.pageInfo.hasNextPage)break;
      const cursor=page.pageInfo.endCursor;
      if(count>=19 || !cursor || cursors.has(cursor))return {supported:true,urls:[...urls],complete:false,error:'Inventory cursor incomplete or repeated',evidence};
      cursors.add(cursor);
      const next=new URL(profile.pagination_path,final);next.search=new URLSearchParams({collection,cursor}).toString();
      const response=await fetchHtml(next.href);
      if(!response.success || !profile.hosts.includes(new URL(response.finalUrl || next).hostname))return {supported:true,urls:[...urls],complete:false,error:'Inventory page fetch failed',evidence};
      try{page=JSON.parse(response.data);}catch{return {supported:true,urls:[...urls],complete:false,error:'Invalid inventory JSON',evidence};}
    }
  }
  return {supported:true,urls:[...urls],complete:urls.size>0,evidence};
}
module.exports={profileFor,discoverSiteProducts};
