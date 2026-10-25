'use strict';
const cheerio=require('cheerio');
const {parseMoney}=require('../catalogNormalization');
const {parseWeightGrams}=require('../product-value-parsers.cjs');
const {schemaAvailability,aggregateStates}=require('../productEvidence');
const SOURCE='shopline_primary_exact_variant',PRODUCT_SOURCE='shopline_primary_product_offer';
const FIELDS={config:'window\\.mainConfig\\s*=',sdk:'var\\s+appExtensionSdkData\\s*=',product:"app\\.value\\('product',",products:"app\\.value\\('products',",features:"app\\.constant\\('FEATURES_LIMIT',"};
const hex=value=>typeof value==='string' && /^[a-f0-9]{24}$/.test(value);
function field(html,name) {
  const $=cheerio.load(html || ''),script=$('script:not([src])').map((_,e)=>$(e).text()).get().join('\n'),prefix=FIELDS[name];
  if(!prefix)throw Error('Unknown Shopline data field');
  const matches=[...script.matchAll(new RegExp('^\\s*'+prefix+"\\s*JSON\\.parse\\('([^\\r\\n]*)'\\)"+(name==='config'||name==='sdk'?'':'\\)')+'\\s*;?\\s*$','gm'))];
  if(matches.length!==1 || matches[0][1].length>4*1024*1024)throw Error('Shopline '+name+' data missing/ambiguous');
  // The merchant wraps JSON in a single-quoted JS string. Decode its escaped
  // apostrophes at the outer string layer only; never evaluate merchant code.
  try{return JSON.parse(JSON.parse('"'+matches[0][1].replace(/\\[^]/g,s=>s==="\\'"?"'":s)+'"'));}catch{throw Error('Shopline '+name+' JSON invalid');}
}
function owned(value,profile,product=false) {
  const url=new URL(value),isProduct=/^\/products\/[^/]+$/.test(url.pathname),listing=profile.listing_paths.includes(url.pathname);
  if(url.protocol!=='https:' || !profile.hosts.includes(url.hostname) || url.username || url.password || url.port || url.hash || product && !isProduct || !product && !isProduct && !listing && url.pathname!=='/')throw Error('Shopline unreviewed URL');
  if(isProduct && url.search || !isProduct && [...url.searchParams].some(([k,v])=>!['page','limit','sort_by','order_by'].includes(k) || k==='page' && !/^[1-9]\d*$/.test(v) || k==='limit' && v!=='24' || ['sort_by','order_by'].includes(k) && v!==''))throw Error('Shopline unreviewed query');
  return url;
}
function context(html,url,profile) {
  const target=owned(url,profile),config=field(html,'config'),sdk=field(html,'sdk'),merchant=config.merchantData,currency=merchant?.base_currency;
  const route=new URL(config.currentPath,profile.bootstrap_url);
  if(config.merchantId!==profile.shopline_merchant_id || merchant?._id!==profile.shopline_merchant_id || sdk.merchantId!==profile.shopline_merchant_id || new URL(merchant.brand_home_url).origin!==new URL(profile.bootstrap_url).origin || route.origin!==target.origin || route.pathname!==target.pathname || route.search || route.hash || config.currentUser!==null || sdk.loadedCurrency?.toUpperCase()!=='TWD' || sdk.loadedLanguage?.code!=='zh-hant' || currency?.iso_code!=='TWD' || merchant.base_currency_code!=='TWD' || currency.subunit_to_unit!==1)throw Error('Shopline merchant/guest market context mismatch');
  return {config,sdk,currency:'TWD',scale:1};
}
function money(value,market) {
  const amount=parseMoney(value?.dollars,{currency:market.currency,locale:'zh-TW'}),label=parseMoney(value?.label,{currency:market.currency,locale:'zh-TW'});
  if(value?.currency_iso!==market.currency || !Number.isSafeInteger(value.cents) || value.cents<0 || value.cents!==Number(value.dollars)*market.scale || amount.minorUnits==null || label.minorUnits!==amount.minorUnits)throw Error('Shopline exact native amount/currency/scale mismatch');
  return amount;
}
async function discoverShoplineProducts(roaster,profile,fetchHtml) {
  const urls=new Map(),identities=new Map(),evidence=[];
  try {
    for(const path of profile.listing_paths) {
      let next=new URL(path,profile.bootstrap_url).href,page=1;const seen=new Set();
      while(next) {
        if(page>30)throw Error('Shopline pagination limit');
        const response=await fetchHtml(next);if(!response.success || new URL(response.finalUrl || next).href!==next)throw Error('Shopline category unavailable/redirected');
        const market=context(response.data,next,profile),$=cheerio.load(response.data),declared=field(response.data,'products'),cards=$('a.js-quick-cart-item'),sdkProducts=market.sdk.plpProducts;
        if(!Array.isArray(declared) || !Array.isArray(sdkProducts) || declared.some(p=>!hex(p.id)) || new Set(declared.map(p=>p.id)).size!==declared.length || cards.length!==declared.length || sdkProducts.length!==declared.length || sdkProducts.some(p=>!declared.some(d=>d.id===p.id)))throw Error('Shopline current category identities incomplete');
        const pageIds=new Set(),found=[],excluded=[];
        cards.each((_,e)=>{
          const card=$(e),id=card.closest('[product-id]').attr('product-id'),url=owned(new URL(card.attr('href'),next).href,profile,true).href,title=card.find('.title').text().trim();let analytics;
          try{analytics=JSON.parse(card.attr('ga-product'));}catch{throw Error('Shopline current card identity missing');}
          if(!hex(id) || !title || analytics.id!==id || analytics.title!==title || !declared.some(p=>p.id===id) || pageIds.has(id) || seen.has(id))throw Error('Shopline category/card identity mismatch or repeated');
          pageIds.add(id);seen.add(id);
          if(profile.exclude_name_pattern && new RegExp(profile.exclude_name_pattern,'i').test(title) || !profile.shopline_reviewed_product_ids?.includes(id)){excluded.push({id,url,title,reason:'outside_reviewed_coffee_only_scope'});return;}
          if(identities.has(id) && identities.get(id)!==url || urls.has(url) && urls.get(url)!==id)throw Error('Shopline product identity changed across categories');
          identities.set(id,url);urls.set(url,id);found.push({id,url,title});
        });
        evidence.push({listing:next,page,published_products:declared.length,coffee_products:found,excluded});
        const active=$('.ProductList-paginator .active a');
        if(active.length && (active.length!==1 || Number(active.text().trim())!==page))throw Error('Shopline current pagination identity mismatch');
        const controls=$('.ProductList-paginator a').toArray(),following=controls.find(e=>Number($(e).text().trim())===page+1) || controls.find(e=>$(e).find('.fa-angle-right').length);
        if(following){const candidate=owned(new URL($(following).attr('href'),next).href,profile);if(candidate.origin!==new URL(next).origin || candidate.pathname!==path || Number(candidate.searchParams.get('page'))!==page+1)throw Error('Shopline next-page identity mismatch');next=candidate.href;page++;}
        else {if(!active.length && (page!==1 || declared.length>=24))throw Error('Shopline terminal category page unproven');next=null;}
      }
    }
    return {supported:true,urls:[...urls.keys()],complete:urls.size>0,evidence,inventory_scope:'reviewed_coffee_products_in_public_categories',inventory_authorizes_global_absence:false};
  }catch(error){return {supported:true,urls:[...urls.keys()],complete:false,error:error.message,evidence,inventory_authorizes_global_absence:false};}
}
function guestMoney(row,market) {
  const regular=money(row.price,market),sale=row.price_sale;
  if(regular.minorUnits<=0)throw Error('Shopline positive guest price missing');
  if(sale==null)return regular;
  if(sale.dollars===0 && sale.cents===0 && sale.currency_iso===market.currency && sale.label==='')return regular;
  const discount=money(sale,market);
  if(discount.minorUnits<=0 || discount.minorUnits>regular.minorUnits)throw Error('Shopline guest sale price invalid');
  return discount;
}
function stock(product,rows,features) {
  if(typeof product.unlimited_quantity!=='boolean' || typeof product.sold_out!=='boolean' || product.is_stock_shared!==false || product.is_preorder!==false || product.out_of_stock_orderable!==false || features.mask_check_stock_api_quantity!==false || rows.some(v=>!Number.isSafeInteger(v.quantity) || v.quantity<0 || v.max_order_quantity!==-1 && !(Number.isSafeInteger(v.max_order_quantity) && v.max_order_quantity>0)))throw Error('Shopline exact immediate stock unsupported');
  const states=rows.map(v=>product.unlimited_quantity || v.quantity>0?'in_stock':'sold_out');
  const total=rows.reduce((n,v)=>n+v.quantity,0);
  if(product.unlimited_quantity?product.sold_out || product.total_orderable_quantity!==-1:product.total_orderable_quantity!==total || product.sold_out!==(aggregateStates(states)==='sold_out'))throw Error('Shopline native stock disagreement');
  return states;
}
function shoplineProduct(html,url,profile,{now=Date.now}={}) {
  const target=owned(url,profile,true),market=context(html,url,profile),product=field(html,'product'),features=field(html,'features'),sdk=market.sdk.pdpProduct,$=cheerio.load(html || '');
  const canonical=$('link[rel="canonical"]'),headings=$('h1.Product-title'),name=product.title_translations?.['zh-hant'];
  const schemas=$('script[type="application/ld+json"]').toArray().map(e=>{try{return JSON.parse($(e).text());}catch{return null;}}).filter(p=>p?.['@type']==='Product');
  if(!hex(product._id) || !profile.shopline_reviewed_product_ids?.includes(product._id) || product.owner_id!==profile.shopline_merchant_id || product.link?.owner_id!==profile.shopline_merchant_id || product.link.value_id!==product._id || product.link.status!=='active' || product.link.type!=='product' || product.status!=='active' || sdk?.id!==product._id || sdk.main_product_id!==product._id || canonical.length!==1 || new URL(canonical.attr('href'),url).href!==target.href || headings.length!==1 || !name || headings.text().trim()!==name || schemas.length!==1 || schemas[0].sku!==product._id || schemas[0].name!==name)throw Error('Shopline primary coffee/product identity mismatch');
  if(product.hide_price!==false || product.same_price!==false || product.type!=='product' || product.subscription_enabled!==false || product.bundle_set!=null || product.child_products?.length!==0 || product.flash_price_sets?.length!==0 || Object.keys(product.product_price_tiers || {}).length || product.frozen_flag!==0)throw Error('Shopline ordinary one-time offer unsupported');
  const start=product.available_start_time,end=product.available_end_time,time=now();
  if(!Number.isFinite(time) || [start,end].some(v=>v!==null && (typeof v!=='string' || !Number.isFinite(Date.parse(v)))) || start && end && Date.parse(start)>=Date.parse(end))throw Error('Shopline offer window invalid');
  if(start && time<Date.parse(start) || end && time>=Date.parse(end))throw Error('shopline_offer_window_closed: current native sale window excludes this time');
  if(!Array.isArray(product.variations) || !Array.isArray(product.field_titles) || !Array.isArray(product.variant_options) || !Array.isArray(sdk.variation_keys))throw Error('Shopline current native options missing');
  const variants=product.variations,ids=variants.map(v=>v.key),options=new Map(),titles=product.field_titles;
  if(ids.some(id=>!hex(id)) || new Set(ids).size!==ids.length || sdk.variation_keys.length!==ids.length || new Set(sdk.variation_keys).size!==ids.length || sdk.variation_keys.some(id=>!ids.includes(id)) || (variants.length>0? sdk.variation_rendered!==true || !Array.isArray(sdk.variation_ids) || sdk.variation_ids.length!==ids.length || new Set(sdk.variation_ids).size!==ids.length || sdk.variation_ids.some(id=>!ids.includes(id)):sdk.variation_rendered!==false || sdk.variation_ids!==null || titles.length || product.variant_options.length))throw Error('Shopline exact native variation set incomplete');
  for(const [index,title]of titles.entries())if(title.index!==index || !title.key || !title.name_translations?.['zh-hant'])throw Error('Shopline native option dimension mismatch');
  for(const option of product.variant_options){if(!hex(option.key) || options.has(option.key) || !Number.isInteger(option.index) || !titles[option.index] || option.type!==titles[option.index].key || !option.name_translations?.['zh-hant'])throw Error('Shopline native option identity mismatch');options.set(option.key,option);}
  const combinations=new Set(),used=new Set(),rows=variants.length?variants:[product],prices=rows.map(v=>guestMoney(v,market)),states=stock(product,rows,features),offers=[];
  for(const [index,variant]of variants.entries()) {
    const selected=variant.variant_option_ids,names=variant.fields?.map(f=>f.name);
    if(!Array.isArray(selected) || !titles.length || selected.length!==titles.length || !Array.isArray(names) || names.length!==titles.length || JSON.stringify(names)!==JSON.stringify(variant.fields_translations?.['zh-hant']) || Object.keys(variant.product_price_tiers || {}).length)throw Error('Shopline native variation selections missing');
    selected.forEach((id,i)=>{const option=options.get(id);if(!option || option.index!==i || option.name_translations['zh-hant']!==names[i] || variant.fields[i].name_translations?.['zh-hant']!==names[i])throw Error('Shopline variation/option binding mismatch');used.add(id);});
    const key=JSON.stringify(selected);if(combinations.has(key))throw Error('Shopline repeated native option combination');combinations.add(key);
    // Only whole, published gram labels are net weights. Shipping mass, ml,
    // pack counts and ambiguous half-pound conventions remain unconverted.
    const weights=names.filter(n=>/^\d+(?:\.\d+)?\s*(?:g|kg)$/i.test(n)).map(parseWeightGrams);
    offers.push({'@type':'Offer','@id':variant.key,url:target.href,name:names.join(' / '),price:prices[index].amount,priceCurrency:market.currency,availability:states[index]==='in_stock'?'https://schema.org/InStock':'https://schema.org/OutOfStock',_net_weight_g:weights.length===1?weights[0]:null,_stock_evidence:{source:'shopline_native_stock',merchant_id:product.owner_id,product_id:product._id,unlimited_quantity:product.unlimited_quantity,quantity:variant.quantity,sold_out:product.sold_out,masked_quantity:false}});
  }
  if(variants.length && (used.size!==options.size || titles.reduce((n,_,i)=>n*[...options.values()].filter(o=>o.index===i).length,1)!==variants.length))throw Error('Shopline complete option matrix unproven');
  const schema=schemas[0],primaryOffer=schema.offers,minimum=Math.min(...prices.map(p=>p.minorUnits)),state=aggregateStates(states);
  if(primaryOffer?.['@type']!=='Offer' || primaryOffer.priceCurrency!==market.currency || [schema.url,schema['@id'],primaryOffer.url].some(v=>v && new URL(v,url).href!==target.href) || parseMoney(primaryOffer.price,{currency:market.currency}).minorUnits!==minimum || schemaAvailability(primaryOffer.availability)!==state)throw Error('Shopline primary schema/native price or stock disagreement');
  const image=product.media?.[0]?.images?.original?.url,images=[schema.image || []].flat();
  if(!image || images[0]!==image)throw Error('Shopline primary native image disagreement');
  const asset=new URL(image);if(asset.protocol!=='https:' || asset.hostname!=='img.shoplineapp.com' || !hex(product.media[0]._id) || !asset.pathname.startsWith('/media/image_clips/'+product.media[0]._id+'/') || asset.searchParams.has('owner_id') && asset.searchParams.get('owner_id')!==profile.shopline_merchant_id || asset.username || asset.password || asset.port || asset.hash)throw Error('Shopline primary image owner mismatch');
  const descriptions=[...new Set([product.summary_translations?.['zh-hant'],product.summary_translations?.en,schema.description].filter(v=>typeof v==='string' && v.trim()))];
  const result={'@type':'Product',url:target.href,productID:product._id,name,category:'Coffee',description:descriptions.join('\n\n'),image,offers,_variants_complete:variants.length>0,_market_source:SOURCE};
  if(!variants.length){result.productID='shopline:'+profile.shopline_merchant_id+':'+product._id;result._market_source=PRODUCT_SOURCE;result._product_only=true;result._product_offer={source:PRODUCT_SOURCE,source_url:target.href,source_product_id:result.productID,price:prices[0].amount,currency:market.currency,minor_units:prices[0].minorUnits,availability:primaryOffer.availability,state,variant_identity_complete:false,stock_control:{source:'shopline_native_product_stock',merchant_id:product.owner_id,product_id:product._id,unlimited_quantity:product.unlimited_quantity,quantity:product.quantity,sold_out:product.sold_out,masked_quantity:false}};}
  result._market_context={scope:'reshock_public_guest_one_time_offer',currency:market.currency,native_currency_scale:market.scale,variant_identity_complete:variants.length>0};
  return result;
}
module.exports={SOURCE,PRODUCT_SOURCE,field,owned,context,money,discoverShoplineProducts,shoplineProduct};
