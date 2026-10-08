'use strict';
const cheerio=require('cheerio');
// React Router publishes a JSON string containing an indexed JSON table. Read
// only the named route's primary field; never evaluate JavaScript or root
// account/analytics fields, promises, recommendations or unrelated products.
function routerField(html,route,field) {
  const $=cheerio.load(html || ''),tables=[];
  $('script:not([src])').each((_,e)=>{
    const match=$(e).text().trim().match(/^window\.__reactRouterContext\.streamController\.enqueue\(("(?:[^"\\]|\\.)*")\);?$/);
    if(!match)return;
    try{const stream=JSON.parse(match[1]);if(stream.startsWith('[')){const table=JSON.parse(stream);if(Array.isArray(table) && table.length<=150000)tables.push(table);}}catch{}
  });
  if(tables.length!==1)throw Error('Hydrogen primary JSON table missing/ambiguous');
  const table=tables[0];
  const member=(object,key)=>{
    if(!object || typeof object!=='object' || Array.isArray(object))throw Error('Invalid Hydrogen loader object');
    const keys=Object.keys(object).filter(k=>/^_\d+$/.test(k) && table[Number(k.slice(1))]===key);
    if(keys.length!==1)throw Error('Hydrogen primary field missing/ambiguous');return object[keys[0]];
  };
  const loader=table[member(table[0],'loaderData')],routeData=table[member(loader,route)],start=member(routeData,field),active=new Set();let reads=0;
  function resolve(index,depth=0) {
    // Published turbo-stream 2.x JSON constants: NULL=-5, UNDEFINED=-7.
    if(index===-5)return null;if(index===-7)return undefined;
    if(!Number.isInteger(index) || index<0 || index>=table.length || depth>90 || ++reads>250000 || active.has(index))throw Error('Invalid Hydrogen JSON reference');
    const value=table[index];if(value===null || typeof value!=='object')return value;
    active.add(index);let result;
    if(Array.isArray(value)){if(value.some(v=>!Number.isInteger(v)))throw Error('Unsupported Hydrogen JSON record');result=value.map(i=>resolve(i,depth+1));}
    else {
      result=Object.create(null);
      for(const [key,indexValue] of Object.entries(value)){
        if(!/^_\d+$/.test(key))throw Error('Invalid Hydrogen JSON key');const name=table[Number(key.slice(1))];
        if(typeof name!=='string' || ['__proto__','constructor','prototype'].includes(name))throw Error('Unsafe Hydrogen JSON key');
        result[name]=resolve(indexValue,depth+1);
      }
    }
    active.delete(index);return result;
  }
  return resolve(start);
}
const nativeId=(value,type)=>String(value || '').match(new RegExp('^gid://shopify/'+type+'/([1-9]\\d*)$'))?.[1] || null;
const isCoffee=p=>p.productType==='Coffee' && p.requiresSellingPlan!==true && p.isGiftCard!==true && p.isArchived!==true && !/\b(?:gift|subscription|wholesale|green coffee|cascara)\b/i.test(p.title || '');
async function discoverHydrogenProducts(roaster,profile,fetchHtml) {
  const urls=new Set(),evidence=[],cursors=new Set(),ids=new Set();
  try {
    for(const path of profile.listing_paths) {
      let next=new URL(path,roaster.website_url).href;
      for(let count=0;next;count++) {
        if(count>=40)throw Error('Hydrogen inventory page limit');
        const response=await fetchHtml(next);if(!response.success)throw Error(response.error || 'Hydrogen listing fetch failed');
        const base=new URL(response.finalUrl || next);if(!profile.hosts.includes(base.hostname))throw Error('Hydrogen listing owner mismatch');
        const collection=routerField(response.data,profile.collection_route,'collection');
        if(collection.handle!==path.split('/').at(-1) || !Array.isArray(collection.products?.nodes) || typeof collection.products.pageInfo?.hasNextPage!=='boolean')throw Error('Hydrogen inventory pagination missing');
        const products=collection.products.nodes,coffees=products.filter(isCoffee);
        for(const product of coffees){const id=nativeId(product.id,'Product');if(!id || ids.has(id) || !/^[a-z0-9][a-z0-9-]*$/i.test(product.handle))throw Error('Hydrogen inventory identity invalid/repeated');ids.add(id);urls.add(new URL('/products/'+product.handle,base).href);}
        evidence.push({listing:next,page:count+1,products:products.length,coffeeProducts:coffees.length});
        const page=collection.products.pageInfo;if(!page.hasNextPage){next=null;continue;}
        if(!products.length || typeof page.endCursor!=='string' || !page.endCursor || cursors.has(page.endCursor))throw Error('Hydrogen cursor missing/repeated');cursors.add(page.endCursor);
        const $=cheerio.load(response.data),links=$('a[href]').map((_,e)=>$(e).attr('href')).get().map(h=>{try{return new URL(h,base);}catch{return null;}}).filter(u=>u && u.origin===base.origin && u.pathname===base.pathname && u.searchParams.get('direction')==='next' && u.searchParams.get('cursor')===page.endCursor);
        if(!links.length)throw Error('Hydrogen public next-page link missing');next=links[0].href;
      }
    }
    return {supported:true,urls:[...urls],complete:true,evidence};
  }catch(error){return {supported:true,urls:[...urls],complete:false,error:error.message,evidence};}
}
function hydrogenProduct(html,url,profile) {
  const parsed=new URL(url),handle=parsed.pathname.match(/^\/products\/([^/]+)\/?$/)?.[1],product=routerField(html,profile.product_route,'parsedProduct');
  if(!profile.hosts.includes(parsed.hostname) || product.handle!==handle || !nativeId(product.id,'Product') || !isCoffee(product) || !Array.isArray(product.variants) || !product.variants.length)throw Error('Hydrogen primary product mismatch');
  const ids=new Set(),offers=[];
  for(const variant of product.variants){const id=nativeId(variant.id,'ProductVariant');
    if(!id || ids.has(id) || variant.product?.id!==product.id || !/^\d+(?:\.\d+)?$/.test(variant.price?.amount || '') || !/^[A-Z]{3}$/.test(variant.price?.currencyCode || ''))throw Error('Hydrogen exact variant identity/price mismatch');ids.add(id);
    const inStock=variant.availableForSale===true && variant.isAvailable===true && variant.currentlyNotInStock===false;
    const outOfStock=variant.availableForSale===false || variant.isOOS===true;
    const backOrder=variant.availableForSale===true && variant.isAvailable===true && variant.currentlyNotInStock===true;
    if(!inStock && !outOfStock && !backOrder)throw Error('Hydrogen exact variant stock missing');
    offers.push({'@type':'Offer','@id':id,url:new URL('?variant='+id,parsed).href,name:variant.title,price:variant.price.amount,priceCurrency:variant.price.currencyCode,availability:outOfStock?'https://schema.org/OutOfStock':inStock?'https://schema.org/InStock':'https://schema.org/BackOrder',_stock_evidence:{available_for_sale:variant.availableForSale,currently_not_in_stock:variant.currentlyNotInStock,merchant_is_available:variant.isAvailable}});
  }
  // This merchant filters native options for the retail storefront (Keystone
  // publishes three sizes while native existence encodes seven). Its primary
  // variants are exact current retail offers, but cannot authorize retiring
  // native variants hidden from this market/customer context.
  return {'@type':'Product',url:parsed.href,productID:nativeId(product.id,'Product'),name:product.title,description:product.descriptionHtml || product.description || '',image:product.featuredImage?.url || product.images?.[0]?.url,category:'Coffee',offers,_market_source:'hydrogen_primary_exact_variant',_variants_complete:false,
    additionalProperty:[['origin',product.country],['region',product.region],['variety',product.variety],['processing',product.processingMethod],['tasting_notes',product.tastingNotes]].filter(([,v])=>Array.isArray(v)).map(([name,v])=>({name,value:v.join(', ')}))};
}
module.exports={routerField,discoverHydrogenProducts,hydrogenProduct};
