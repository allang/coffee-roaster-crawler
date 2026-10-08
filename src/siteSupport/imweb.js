'use strict';
const cheerio=require('cheerio');
const {sameProduct}=require('../productEvidence');
const {parseMoney}=require('../catalogNormalization');
const {labelWeight}=require('../shopifyProduct');
function nodes(html){const $=cheerio.load(html || ''),out=[];$('script[type="application/ld+json"]').each((_,e)=>{try{out.push(...[JSON.parse($(e).text())].flat());}catch{}});return out;}
function storeContext(html,profile) {
  const stores=nodes(html).filter(p=>p['@type']==='OnlineStore' && p.url && new URL(p.url).origin===new URL(profile.bootstrap_url).origin);
  if(stores.length!==1 || stores[0].name!==profile.imweb_brand)throw Error('Imweb merchant context mismatch');
  const services=[stores[0].hasShippingService || []].flat(),conditions=services.flatMap(s=>[s.shippingConditions || []].flat());
  if(!conditions.some(c=>c.shippingOrigin?.addressCountry===profile.market_scope && c.shippingDestination?.addressCountry===profile.market_scope && c.shippingRate?.currency===profile.market_currency))throw Error('Imweb retail market context missing');
  return profile.market_currency;
}
function primaryProduct(html,url,profile) {
  storeContext(html,profile);
  const products=nodes(html).filter(p=>p['@type']==='Product' && [p.offers || []].flat().some(o=>o.url && sameProduct(o.url,url)));
  if(products.length!==1 || !profile.imweb_product_brands.includes(products[0].brand?.name))throw Error('Imweb primary product missing');
  const offers=[products[0].offers || []].flat().filter(o=>o.url && sameProduct(o.url,url));
  if(offers.length!==1 || offers[0].priceCurrency!==profile.market_currency)throw Error('Imweb exact primary price/currency missing');
  return {...products[0],offers};
}
async function json(url,fetchHtml,options) {
  const r=await fetchHtml(url,options);if(!r.success)throw Error(r.error || 'Imweb catalog read failed');
  try{return JSON.parse(r.data);}catch{throw Error('Invalid Imweb catalog JSON');}
}
function listingCategory(html,path,profile) {
  const $=cheerio.load(html),expected=profile.listing_categories[path];
  if(!expected)throw Error('Unreviewed Imweb category');
  const markers=$('[data-momos-grid]').map((_,e)=>$(e).attr('data-category')).get();
  if(markers.length)return markers.length===1 && markers[0]===expected?expected:null;
  // Read literal category data from the merchant's own native GET listing config.
  // No script is evaluated, and no endpoint or category is taken from arbitrary code.
  const categories=new Set();
  $('script:not([src])').each((_,e)=>{const s=$(e).text();if(!s.includes("url : ('/ajax/get_shop_list_view.cm')") || !s.includes("'menu_url': '"+path+"/'"))return;for(const m of s.matchAll(/'category'\s*:\s*'(s[0-9a-f]+)'/g))categories.add(m[1]);});
  return categories.size===1 && categories.has(expected)?expected:null;
}
async function discoverImwebProducts(roaster,profile,fetchHtml) {
  const urls=new Set(),evidence=[];
  try {
    const home=await fetchHtml(profile.bootstrap_url);if(!home.success)throw Error('Imweb merchant homepage unavailable');storeContext(home.data,profile);
    if(!home.data.includes('window.MOMOS_API_BASE = '+JSON.stringify(profile.catalog_origin)))throw Error('Imweb public catalog ownership missing');
    for(const path of profile.listing_paths) {
      const page=await fetchHtml(new URL(path,profile.bootstrap_url).href);if(!page.success)throw Error('Imweb retail collection unavailable');
      const category=listingCategory(page.data,path,profile);if(!category)throw Error('Imweb reviewed retail category changed');
      let total=null,totalPages=null;const identities=new Set();let count=0;
      for(let number=1;number<=30;number++) {
        const url=new URL('/api/public/products',profile.catalog_origin);url.search=new URLSearchParams({category,page:String(number),limit:'50'}).toString();
        const data=await json(url.href,fetchHtml);
        if(!Array.isArray(data.items) || data.page!==number || !Number.isInteger(data.totalCount) || data.totalCount<0 || !Number.isInteger(data.totalPage) || data.totalPage<1 || data.count!==data.items.length)throw Error('Invalid Imweb pagination');
        if(total!==null && (total!==data.totalCount || totalPages!==data.totalPage))throw Error('Imweb inventory changed during pagination');total=data.totalCount;totalPages=data.totalPage;
        for(const item of data.items) {
          if(!Number.isSafeInteger(item.prodNo) || item.prodNo<=0 || !/^s[0-9a-f]+$/.test(item.prodCode || '') || identities.has(item.prodNo))throw Error('Imweb listing identity missing or repeated');identities.add(item.prodNo);count++;
          if(!['sale','soldout'].includes(item.status))throw Error('Unproven Imweb published product status');
          if(profile.exclude_product_codes?.includes(item.prodCode) || /\[B\]|구독|생두|드리퍼|텀블러|머그|\bequipment\b/i.test(item.name))continue;
          const source=new URL(item.pdpUrl,profile.bootstrap_url);
          if(source.origin!==new URL(profile.bootstrap_url).origin || !/^\/shop_view\/?$/.test(source.pathname) || source.searchParams.get('idx')!==String(item.prodNo))throw Error('Imweb primary URL mismatch');
          source.pathname='/shop_view';source.search='';source.searchParams.set('idx',String(item.prodNo));urls.add(source.href);
        }
        evidence.push({listing:path,category,page:number,products:data.items.length,total:data.totalCount});
        if(number===totalPages){if(count!==total)throw Error('Truncated Imweb inventory');break;}
        if(number===30)throw Error('Imweb pagination limit reached');
      }
    }
    return {supported:true,urls:[...urls],complete:urls.size>0,market_scope:profile.market_scope,reconcile_omissions:false,evidence};
  }catch(error){return {supported:true,urls:[...urls],complete:false,market_scope:profile.market_scope,reconcile_omissions:false,error:error.message,evidence};}
}
function contentsWeight(html) {
  const $=cheerio.load(html || ''),weights=[];
  $('tr').each((_,e)=>{const cells=$(e).find('td');if(cells.length!==2 || !/^(?:내용량|용량|중량)$/.test(cells.eq(0).text().trim()))return;
    const text=cells.eq(1).text().trim().replace(/^\d+\s*개입\s*\/\s*/,'');
    const explicitTotal=text.match(/^(\d+(?:\.\d+)?\s*(?:g|kg))\s*\([^)]*(?:x|×)[^)]*\)$/i);weights.push(labelWeight(explicitTotal?explicitTotal[1]:text));
  });return weights.length && weights.every(v=>v!=null) && new Set(weights).size===1?weights[0]:null;
}
function stockState(product,option=null) {
  if(product.prod_soldout_status==='soldout' || option?.status==='SOLDOUT')return 'https://schema.org/OutOfStock';
  if(product.prod_status!=='sale' || product.prod_soldout_status!=='sale' || product.use_pre_sale!==false || product.preSaleInfo?.enabled===true || option && option.status!=='SALE' || !product.deliv_data?.some(d=>d.parcel===true))return null;
  const stock=option?option.stock:product.stock_no_option;
  if(product.stock_use===false || product.stock_unlimit===true || typeof stock==='number' && stock>0)return 'https://schema.org/InStock';
  if(product.stock_use===true && product.stock_unlimit===false && stock===0)return 'https://schema.org/OutOfStock';
  return null;
}
function nativeProduct(product,primary,url,profile) {
  const idx=new URL(url).searchParams.get('idx'),offer=primary.offers[0];
  if(String(product?.idx)!==idx || product.site_code!==profile.imweb_site_code || !/^s[0-9a-f]+$/.test(product.code || '') || profile.exclude_product_codes?.includes(product.code) || product.name!==primary.name || product.deleted!==false || product.prod_type!=='normal' || product.price_none!==false)throw Error('Imweb exact native product mismatch');
  const base=parseMoney(product.price,{currency:profile.market_currency}),paired=parseMoney(offer.price,{currency:offer.priceCurrency});
  // The same primary product's offer fixes its native KRW market context. Require
  // exact base-price agreement before accepting native option totals in that market.
  if(base.minorUnits==null || base.minorUnits!==paired.minorUnits || product.use_period_discount===true)throw Error('Imweb native primary price context mismatch');
  const required=(product.options || []).filter(o=>o.is_require);
  if(required.some(o=>o.type!=='default' || o.prod_code!==product.code || o.site_code!==profile.imweb_site_code) || new Set(required.map(o=>o.code)).size!==required.length)throw Error('Unsupported Imweb required option');
  const allDetails=product.options_detail || [];if(!Array.isArray(allDetails))throw Error('Imweb native option data missing');
  const details=allDetails.filter(o=>o.status!=='HIDDEN');
  if(required.length && !details.length)throw Error('Imweb native combinations missing');
  const variants=required.length?details.map(row=>{
    if(row.prod_code!==product.code || !/^od[0-9a-f]+$/.test(row.code || '') || row.option_code_list?.length!==required.length || row.value_code_list?.length!==required.length || new Set(row.option_code_list).size!==required.length)throw Error('Imweb exact variant mismatch');
    const values=row.option_code_list.map((code,i)=>{const dimension=required.find(o=>o.code===code),value=dimension?.value_list?.[row.value_code_list[i]];if(typeof value!=='string')throw Error('Imweb exact variant option missing');return {name:dimension.name,value};});
    const weights=values.filter(v=>/^(?:중량|내용량|용량)$/.test(v.name)).map(v=>labelWeight(v.value));
    const packagingOnly=values.every(v=>/쇼핑백|분쇄|컵|포장/.test(v.name));
    const weight=weights.length && weights.every(v=>v!=null) && new Set(weights).size===1?weights[0]:!weights.length && packagingOnly?contentsWeight(product.simple_content):null;
    return {'@type':'Offer',sku:row.code,_merchant_sku:row.stock_sku || null,name:values.map(v=>v.name+': '+v.value).join(' / '),url,price:row.price,priceCurrency:profile.market_currency,availability:stockState(product,row),_net_weight_g:weight};
  }):[{'@type':'Offer',sku:product.code,name:product.name,url,price:product.price,priceCurrency:profile.market_currency,availability:stockState(product),_net_weight_g:contentsWeight(product.simple_content)}];
  if(new Set(variants.map(v=>v.sku)).size!==variants.length || variants.some(v=>parseMoney(v.price,{currency:v.priceCurrency}).minorUnits==null))throw Error('Imweb exact variant price/identity missing');
  const $=cheerio.load(product.simple_content || '');$('script,style,iframe,form').remove();
  return {'@type':'Product',url,productID:'imweb:'+profile.market_scope+':'+profile.imweb_site_code+':'+product.code,name:product.name,description:$.html(),category:'Coffee',image:primary.image,offers:variants,_variants_complete:false,_market_source:'imweb_exact_native_options_primary_market'};
}
async function fetchImwebProduct(html,url,profile,fetchHtml) {
  const source=new URL(url);if(source.origin!==new URL(profile.bootstrap_url).origin || !/^\/shop_view\/?$/.test(source.pathname) || !/^[1-9]\d*$/.test(source.searchParams.get('idx') || ''))throw Error('Unreviewed Imweb primary product URL');
  const primary=primaryProduct(html,url,profile),request=new URL(profile.product_api_path,source);request.searchParams.set('prod_idx',source.searchParams.get('idx'));
  const native=await json(request.href,fetchHtml,{referer:url});if(native.msg!=='SUCCESS')throw Error('Imweb native product unavailable');
  return nativeProduct(native.data,primary,url,profile);
}
module.exports={storeContext,primaryProduct,listingCategory,discoverImwebProducts,contentsWeight,stockState,nativeProduct,fetchImwebProduct};
