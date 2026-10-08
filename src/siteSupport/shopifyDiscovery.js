'use strict';
const excluded=/\b(?:(?:e[-\s]?)?gift\s*(?:cards?|vouchers?|certificates?)|subscription|wholesale|equipment|brewer|paper\s*filter|grinder|cup(?!\s+of\s+excellence)|mug|thermos|trousers?|shirts?|hoodie|hat|cap|book|cascara|green coffee)\b/i;
function retailCoffee(product,profile) {
  if(profile.exclude_product_ids?.includes(String(product.id)))return false;
  const type=String(product.product_type || ''),title=String(product.title || '');
  if(profile.exclude_handles?.includes(product.handle))return false;
  if(profile.exclude_name_pattern && new RegExp(profile.exclude_name_pattern,'i').test(title))return false;
  if(profile.exclude_product_tags?.some(tag=>(Array.isArray(product.tags)?product.tags:String(product.tags || '').split(/,\s*/)).includes(tag)))return false;
  const tags=Array.isArray(product.tags)?product.tags.join(' '):String(product.tags || '');
  // A coffee sold once may also carry a subscription tag (ONA's blends do).
  // Exclude subscription products by their title/type, not a second sales channel.
  if(excluded.test(type+' '+title) || /\bwholesale[-_\s]+only\b/i.test(tags) || !type.trim() && /\bwholesale\b/i.test(tags))return false;
  if(profile.coffee_content_pattern && !new RegExp(profile.coffee_content_pattern,'i').test(product.body_html || ''))return false;
  if(profile.strict_coffee_product_types)return profile.coffee_product_types?.includes(type)===true || profile.coffee_handles?.includes(product.handle)===true;
  return profile.coffee_product_types?.includes(type) || profile.coffee_handles?.includes(product.handle) || /\b(?:coffee|espresso|roasted beans|instant)\b/i.test(type);
}
async function discoverShopifyProducts(roaster,profile,fetchHtml) {
  const urls=new Set(),evidence=[];let anyProducts=false;
  for(const path of profile.listing_paths) {
    const seen=new Set(),ids=new Set();let exhausted=false;
    for(let page=1;page<=40;page++) {
      const url=new URL(path,profile.listing_origin || roaster.website_url);url.search=new URLSearchParams({limit:'50',page:String(page)}).toString();
      const response=await fetchHtml(url.href);
      if(!response.success || !profile.hosts.includes(new URL(response.finalUrl || url).hostname))return {supported:true,urls:[...urls],complete:false,error:'Shopify collection fetch failed',evidence};
      let products;try{products=JSON.parse(response.data).products;}catch{}
      if(!Array.isArray(products))return {supported:true,urls:[...urls],complete:false,error:'Shopify collection JSON missing',evidence};
      if(!products.length){exhausted=true;break;}
      anyProducts=true;
      const fingerprint=products.map(p=>p.id).join(',');if(seen.has(fingerprint))return {supported:true,urls:[...urls],complete:false,error:'Shopify collection page repeated',evidence};seen.add(fingerprint);
      for(const product of products){const id=String(product.id ?? '');if(!/^[1-9]\d*$/.test(id) || ids.has(id))return {supported:true,urls:[...urls],complete:false,error:'Shopify collection identity missing or repeated',evidence};ids.add(id);}
      const listingProfile={...profile,coffee_product_types:profile.coffee_product_types_by_listing?.[path] ?? profile.coffee_product_types};
      const coffees=products.filter(p=>retailCoffee(p,listingProfile));
      for(const p of coffees){if(!/^[a-z0-9][a-z0-9_-]*$/i.test(p.handle))return {supported:true,urls:[],complete:false,error:'Invalid Shopify handle',evidence};urls.add(new URL((profile.product_path || '/products/')+p.handle,roaster.website_url).href);}
      evidence.push({listing:path,page,products:products.length,coffeeProducts:coffees.length});
      // Explicit empty final page avoids treating a merchant's lower response cap
      // as proof of exhaustion. Fail closed if a cursor/page limit is reached.
    }
    if(!exhausted)return {supported:true,urls:[...urls],complete:false,error:'Shopify inventory page limit reached',evidence};
  }
  for(const path of profile.additional_product_paths || []) {
    const url=new URL(path,roaster.website_url);
    if(!/^\/products\/[a-z0-9][a-z0-9-]*$/i.test(url.pathname) || !profile.hosts.includes(url.hostname))return {supported:true,urls:[...urls],complete:false,error:'Unreviewed additional product path',evidence};
    const response=await fetchHtml(url.href+'.json');let product;
    if(response.success && profile.hosts.includes(new URL(response.finalUrl || url).hostname))try{product=JSON.parse(response.data).product;}catch{}
    if(!product || product.id==null || '/products/'+product.handle!==url.pathname || !retailCoffee(product,profile))return {supported:true,urls:[...urls],complete:false,error:'Featured coffee identity unavailable',evidence};
    urls.add(url.href);evidence.push({listing:path,products:1,coffeeProducts:1});anyProducts=true;
  }
  return {supported:true,urls:[...urls],complete:anyProducts && urls.size>0,evidence,market:profile.market || null,inventory_authorizes_global_absence:profile.inventory_authorizes_global_absence!==false};
}
module.exports={retailCoffee,discoverShopifyProducts,excluded};
