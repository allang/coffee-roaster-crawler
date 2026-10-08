'use strict';
const excluded=/\b(?:gift\s*card|subscription|wholesale|equipment|brewer|paper\s*filter|grinder|cup|mug|thermos|trousers?|shirts?|hoodie|hat|cap|book|cascara|green coffee)\b/i;
function retailCoffee(product,profile) {
  const type=String(product.product_type || ''),title=String(product.title || '');
  if(excluded.test(type+' '+title))return false;
  return profile.coffee_product_types?.includes(type) || /\b(?:coffee|espresso|roasted beans|instant)\b/i.test(type);
}
async function discoverShopifyProducts(roaster,profile,fetchHtml) {
  const urls=new Set(),evidence=[];let anyProducts=false;
  for(const path of profile.listing_paths) {
    const seen=new Set();let exhausted=false;
    for(let page=1;page<=40;page++) {
      const url=new URL(path,roaster.website_url);url.search=new URLSearchParams({limit:'50',page:String(page)}).toString();
      const response=await fetchHtml(url.href);
      if(!response.success || !profile.hosts.includes(new URL(response.finalUrl || url).hostname))return {supported:true,urls:[...urls],complete:false,error:'Shopify collection fetch failed',evidence};
      let products;try{products=JSON.parse(response.data).products;}catch{}
      if(!Array.isArray(products))return {supported:true,urls:[...urls],complete:false,error:'Shopify collection JSON missing',evidence};
      if(!products.length){exhausted=true;break;}
      anyProducts=true;
      const fingerprint=products.map(p=>p.id).join(',');if(seen.has(fingerprint))return {supported:true,urls:[...urls],complete:false,error:'Shopify collection page repeated',evidence};seen.add(fingerprint);
      const coffees=products.filter(p=>retailCoffee(p,profile));
      for(const p of coffees){if(!/^[a-z0-9][a-z0-9-]*$/i.test(p.handle))return {supported:true,urls:[],complete:false,error:'Invalid Shopify handle',evidence};urls.add(new URL('/products/'+p.handle,url).href);}
      evidence.push({listing:path,page,products:products.length,coffeeProducts:coffees.length});
      // Explicit empty final page avoids treating a merchant's lower response cap
      // as proof of exhaustion. Fail closed if a cursor/page limit is reached.
    }
    if(!exhausted)return {supported:true,urls:[...urls],complete:false,error:'Shopify inventory page limit reached',evidence};
  }
  return {supported:true,urls:[...urls],complete:anyProducts && urls.size>0,evidence};
}
module.exports={retailCoffee,discoverShopifyProducts};
