'use strict';
const cheerio=require('cheerio');
const {parseMoney}=require('../catalogNormalization');

// Nuxt's indexed JSON table is data. Decode only the primary product store;
// runtime config, credentials, cart state and recommendation data are ignored.
function nuxtPrimaryProduct(html) {
  const $=cheerio.load(html || ''),scripts=$('script#__NUXT_DATA__[type="application/json"]');
  if(scripts.length!==1)return null;
  try {
    const table=JSON.parse(scripts.text());if(!Array.isArray(table) || table.length>50000)return null;
    function unwrap(index) {
      for(let depth=0;depth<20;depth++) {
        if(!Number.isSafeInteger(index) || index<0 || index>=table.length)throw Error('Invalid Nuxt reference');
        const item=table[index];
        if(Array.isArray(item) && ['Reactive','ShallowReactive'].includes(item[0])){index=item[1];continue;}
        return item;
      }
      throw Error('Nuxt wrapper depth exceeded');
    }
    const root=unwrap(0),stores=unwrap(root.pinia),store=unwrap(stores.product),memo=new Map(),active=new Set();
    function decode(index,depth=0) {
      if(index===-1)return undefined;
      if(depth>60 || active.has(index))throw Error('Invalid cyclic Nuxt product');
      if(memo.has(index))return memo.get(index);
      const item=unwrap(index);if(item==null || typeof item!=='object')return item;
      active.add(index);const value=Array.isArray(item)?[]:Object.create(null);
      for(const [key,ref]of Object.entries(item))value[key]=decode(ref,depth+1);
      active.delete(index);memo.set(index,value);return value;
    }
    return decode(store.product);
  }catch{return null;}
}
function nativeId(value,kind){return String(value || '').match(new RegExp('^gid://shopify/'+kind+'/([1-9]\\d*)$'))?.[1] || null;}
async function fetchNuxtShopifyProduct(html,url,profile,fetchHtml) {
  const handle=new URL(url).pathname.match(/^\/en\/products\/([a-z0-9-]+)\/?$/i)?.[1],p=nuxtPrimaryProduct(html);
  if(!handle || p?.handle!==handle || !nativeId(p.id,'Product') || !p.title || p.requiresSellingPlan!==false || p.productType!=='Coffee')throw Error('Exact Nuxt coffee product missing');
  const variants=p.variants?.edges?.map(e=>e.node);
  if(!variants?.length || variants.length>=250)throw Error('Nuxt variant inventory incomplete');
  const ids=variants.map(v=>nativeId(v.id,'ProductVariant'));
  if(ids.some(id=>!id) || new Set(ids).size!==ids.length)throw Error('Invalid Nuxt variant identity');
  const response=await fetchHtml(new URL('/products/'+handle+'.js',profile.stock_origin).href);
  if(!response.success)throw Error('Native Shopify stock fetch failed');
  let stock;try{stock=JSON.parse(response.data);}catch{throw Error('Invalid Shopify stock JSON');}
  if(String(stock.id)!==nativeId(p.id,'Product') || stock.handle!==handle || !Array.isArray(stock.variants) || stock.variants.length!==variants.length || new Set(stock.variants.map(v=>String(v.id))).size!==variants.length)throw Error('Native Shopify stock product/variant mismatch');
  const offers=variants.map((v,i)=>{
    const money=parseMoney(v.priceV2?.amount,{currency:v.priceV2?.currencyCode,locale:'en-US'}),match=stock.variants.filter(s=>String(s.id)===ids[i]);
    if(money.minorUnits==null || !money.currency || match.length!==1 || typeof match[0].available!=='boolean')throw Error('Exact Nuxt variant price/currency or stock missing');
    return {'@type':'Offer','@id':ids[i],name:v.title,url:new URL('?variant='+ids[i],url).href,price:v.priceV2.amount,priceCurrency:v.priceV2.currencyCode,availability:'https://schema.org/'+(match[0].available?'InStock':'OutOfStock')};
  });
  const aliases={process:'processing',region:'region',producer:'producer',variety:'variety',flavour:'tasting_notes',location:'altitude'},additionalProperty=[];
  for(const [field,name]of Object.entries(aliases)){if(p[field]?.value!=null)additionalProperty.push({name,value:p[field].value});}
  return {'@type':'Product',productID:nativeId(p.id,'Product'),name:p.title,url,category:p.productType,description:p.descriptionHtml || p.description || '',image:p.images?.edges?.[0]?.node?.url,offers,additionalProperty,_variants_complete:true,_market_source:'nuxt_primary_product_paired_money_native_variant_stock'};
}
module.exports={nuxtPrimaryProduct,fetchNuxtShopifyProduct};
