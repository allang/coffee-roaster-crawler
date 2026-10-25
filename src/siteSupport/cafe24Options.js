'use strict';
const cheerio=require('cheerio');
const {canonicalProductUrl,parseMoney}=require('../catalogNormalization');
const {parseWeightGrams}=require('../product-value-parsers.cjs');
const {titleNetWeight}=require('../shopifyProduct');
const {discoverDomProducts}=require('./domDiscovery');
const memberships=new WeakMap();
function literal(script,name) {
  const matches=[...script.matchAll(new RegExp('\\bvar\\s+'+name+"\\s*=\\s*'([^'\\r\\n]*)'\\s*;",'g'))];
  if(matches.length!==1)throw Error('Cafe24 native '+name+' missing/ambiguous');
  return matches[0][1];
}
function nativeJson(raw) {
  if(raw.length>4*1024*1024)throw Error('Cafe24 native JSON limit');
  // Cafe24 publishes JSON directly or escaped inside a quoted script literal.
  let value;
  try{value=JSON.parse(raw);}catch{
    try{value=JSON.parse(JSON.parse('"'+raw+'"'));}catch{throw Error('Cafe24 native JSON invalid');}
  }
  if(!value || typeof value!=='object' || Array.isArray(value))throw Error('Cafe24 native JSON object missing');
  return value;
}
function meta($,key) {
  const values=$('meta[property="'+key+'"]').map((_,e)=>$(e).attr('content')).get();
  if(values.length!==1)throw Error('Cafe24 primary '+key+' missing/ambiguous');
  return values[0];
}
function hidden($,element) {
  return $(element).add($(element).parents()).toArray().some(e=>$(e).hasClass('displaynone') || $(e).attr('hidden')!=null || /(?:^|;)\s*display\s*:\s*none(?:\s*!important)?\s*(?:;|$)/i.test($(e).attr('style') || ''));
}
function fixedContents(name,id,profile) {
  if(profile.cafe24_collection_product_ids?.includes(id)) {
    const pairs=[...name.matchAll(/\((\d+(?:\.\d+)?\s*(?:g|kg))\s*[x\u00d7]\s*(\d+)\)|(\d+(?:\.\d+)?\s*(?:g|kg))\uC529\s*(\d+)\uC885/gi)],counts=[...name.matchAll(/(\d+)\uC885/g)];
    const pair=pairs[0],count=pair?Number(pair[2] || pair[4]):null,weight=pair?parseWeightGrams(pair[1] || pair[3]):null;
    if(pairs.length!==1 || counts.length!==1 || Number(counts[0][1])!==count || !Number.isInteger(count) || count<1 || count>100 || !weight)throw Error('Cafe24 reviewed collection contents changed');
    return count*weight;
  }
  if(profile.cafe24_labeled_bag_product_ids?.includes(id)) {
    const weights=[...name.matchAll(/(?:^|\s)(\d+(?:\.\d+)?\s*(?:g|kg))(?=\s|$)/gi)];
    if(weights.length!==1 || !parseWeightGrams(weights[0][1]))throw Error('Cafe24 reviewed bag contents changed');
    return parseWeightGrams(weights[0][1]);
  }
  return titleNetWeight({title:name,variants:[{}]});
}
async function coffeeMembership(profile,fetchHtml) {
  // Share only category proof within one reader; SKU price/stock is always fresh.
  let cache=memberships.get(fetchHtml);if(!cache){cache=new Map();memberships.set(fetchHtml,cache);}
  const previous=cache.get(profile),now=Date.now();
  if(previous && now-previous.at<60000)return previous.promise;
  const promise=discoverDomProducts({website_url:profile.bootstrap_url},profile,fetchHtml);
  cache.set(profile,{at:now,promise});return promise;
}
function stockState(row,globalSoldOut) {
  if(typeof row.use_stock!=='boolean' || row.use_stock && (!Number.isSafeInteger(row.stock_number) || row.stock_number<0) || row.stock_number!=null && !Number.isSafeInteger(row.stock_number) || !['F','T'].includes(row.use_soldout) || row.is_reserve_stat!=='N')throw Error('Cafe24 native stock contract missing');
  for(const flag of ['is_display','is_selling','is_auto_soldout'])if(row[flag]!=null && !['T','F'].includes(row[flag]))throw Error('Cafe24 native sellability invalid');
  if(row.use_stock_original!=null && row.use_stock_original!==(row.use_stock?'T':'F') || row.use_soldout_original!=null && row.use_soldout_original!==row.use_soldout)throw Error('Cafe24 native stock policies disagree');
  if(!globalSoldOut && row.use_stock && row.stock_number===0 && row.use_soldout!=='T' && row.is_auto_soldout!=='T')throw Error('Cafe24 empty tracked stock is not explicitly sold out');
  return globalSoldOut || row.is_display==='F' || row.is_selling==='F' || row.is_auto_soldout==='T' || row.use_stock && row.stock_number===0?'https://schema.org/OutOfStock':'https://schema.org/InStock';
}
function primaryProduct(html,url,profile) {
  const parsed=new URL(url),id=parsed.searchParams.get('product_no'),$=cheerio.load(html || ''),scripts=$('script:not([src])').map((_,e)=>$(e).text()).get().join('\n');
  const nativeIds=[...scripts.matchAll(/\bvar\s+iProductNo\s*=\s*([1-9]\d*)\s*;/g)];
  if(profile.cafe24_native_option_items!==true || parsed.protocol!=='https:' || parsed.username || parsed.password || parsed.port || !profile.hosts.includes(parsed.hostname) || parsed.pathname!=='/product/detail.html' || !/^[1-9]\d*$/.test(id || '') || nativeIds.length!==1 || nativeIds[0][1]!==id || meta($,'product:productId')!==id)throw Error('Cafe24 primary product identity mismatch');
  const codeLink=$('.xans-product-image .keyImg .thumbnail > a'),code=codeLink.attr('alt'),name=literal(scripts,'product_name');
  const zoom=new URL(codeLink.attr('href'),url);
  if(codeLink.length!==1 || zoom.origin!==parsed.origin || zoom.pathname!=='/product/image_zoom2.html' || zoom.searchParams.get('product_no')!==id || /\bvar\s+product_code\b/.test(scripts) && literal(scripts,'product_code')!==code)throw Error('Cafe24 primary native product code mismatch');
  if(!/^P[A-Z0-9]{7}$/.test(code) || !name || /\\/.test(name))throw Error('Cafe24 native product identity unsupported');
  const names=$('.infoArea .xans-product-detaildesign tr').filter((_,e)=>$(e).find('th').text().trim()===profile.cafe24_name_label).map((_,e)=>$(e).find('td').text().trim()).get();
  if(names.length!==1 || names[0]!==name || profile.exclude_name_pattern && new RegExp(profile.exclude_name_pattern,'i').test(name))throw Error('Cafe24 primary coffee name mismatch');
  const currency=meta($,'product:sale_price:currency'),price=meta($,'product:sale_price:amount'),base=parseMoney(price,{currency,locale:'en-US'}),declared=parseMoney(literal(scripts,'product_price'),{currency,locale:'en-US'});
  if(currency!=='KRW' || meta($,'product:price:currency')!==currency || base.minorUnits==null || base.minorUnits!==declared.minorUnits)throw Error('Cafe24 primary price/currency mismatch');
  const globalStock=literal(scripts,'is_soldout_icon'),buy=$('#btnBuy'),reserve=$('#btnReserve');
  if(!['T','F'].includes(globalStock) || buy.length!==1 || reserve.length!==1 || !hidden($,reserve[0]) || !/^product_submit\(1,/.test(buy.closest('a').attr('onclick') || '') || hidden($,buy[0])!==(globalStock==='T'))throw Error('Cafe24 primary purchase/stock control mismatch');
  const image=meta($,'og:image'),primary=$(profile.primary_image_selector);
  const imageUrl=new URL(image,url);
  if(primary.length!==1 || imageUrl.protocol!=='https:' || imageUrl.username || imageUrl.password || imageUrl.port || new URL(primary.attr('src'),url).href!==imageUrl.href || !profile.description_image_hosts.includes(imageUrl.hostname))throw Error('Cafe24 primary product image mismatch');
  const selects=$('select[product_type="product_option"]').toArray().map(e=>{
    const option=$(e),values=option.find('option').map((_,o)=>$(o).attr('value')).get().filter(v=>!['*','**',''].includes(v));
    if(option.attr('option_product_no')!==id || option.attr('option_type')!=='T' || !option.is('[required]') || !option.attr('option_title') || !values.length || new Set(values).size!==values.length)throw Error('Cafe24 native option declaration invalid');
    return {name:option.attr('option_title'),values};
  });
  const hasOptions=literal(scripts,'has_option'),rows=[],seen=new Set();
  if(hasOptions==='T') {
    if(!selects.length || selects.length>4 || literal(scripts,'option_type')!=='T')throw Error('Cafe24 option family unsupported');
    const stock=nativeJson(literal(scripts,'option_stock_data')),entries=Object.entries(stock),combinations=selects.reduce((n,o)=>n*o.values.length,1);
    // Verify the published matrix; never manufacture missing combinations.
    if(!entries.length || entries.length>2000 || combinations!==entries.length)throw Error('Cafe24 native SKU matrix incomplete');
    let nativeNames=null;
    for(const [item,row]of entries) {
      const values=row.option_value_orginal,names=row.option_name_original;
      if(!new RegExp('^'+code+'[A-Z0-9]{4}$').test(item) || row.option_id!==item.slice(-4) || !Array.isArray(values) || !Array.isArray(names) || names.length!==values.length || !names.length || row.option_value!==values.join('-') || row.option_name!==names.join('#$%') || row.is_mandatory!=='T' || !['T','F'].includes(row.is_display) || !['T','F'].includes(row.is_selling))throw Error('Cafe24 exact SKU/option identity mismatch');
      const combined=selects.length===1 && profile.cafe24_combined_option_names?.includes(selects[0].name) && selects[0].name===names.join('-') && (selects[0].values.includes(item) || selects[0].values.includes(row.option_value));
      if(!combined && (values.length!==selects.length || selects.some((o,i)=>names[i]!==o.name || !o.values.includes(values[i]))))throw Error('Cafe24 native option choices mismatch');
      if(nativeNames!==null && nativeNames!==JSON.stringify(names))throw Error('Cafe24 native option names changed within a product');nativeNames=JSON.stringify(names);
      const key=JSON.stringify(values);if(seen.has(key))throw Error('Cafe24 duplicate native SKU combination');seen.add(key);
      const money=parseMoney(row.option_price,{currency,locale:'en-US'}),delta=parseMoney(row.stock_price,{currency,locale:'en-US'});
      if(money.minorUnits==null || delta.minorUnits==null || money.minorUnits!==base.minorUnits+delta.minorUnits)throw Error('Cafe24 exact SKU price/delta mismatch');
      const sizes=names.flatMap((n,i)=>profile.cafe24_weight_option_names.includes(n)?[parseWeightGrams(values[i])]:[]),titleWeight=names.every(n=>profile.cafe24_grind_option_names.includes(n))?fixedContents(name,id,profile):null;
      const pairs=profile.cafe24_same_weight_pair_product_ids?.includes(id) && JSON.stringify(names)===JSON.stringify(['\uc6d0\ub450\uc885 1','\uc6d0\ub450\uc885 2','\ubd84\uc1c4\ub3c4'])?[...name.matchAll(/(?:^|\s)(\d+(?:\.\d+)?\s*(?:g|kg))\s*\+\s*(\d+(?:\.\d+)?\s*(?:g|kg))(?:\s|$)/gi)]:[];
      const pair=pairs.length===1 && [...name.matchAll(/\d+(?:\.\d+)?\s*(?:g|kg)\b/gi)].length===2?pairs[0]:null;
      const pairWeight=pair && parseWeightGrams(pair[1])>0 && parseWeightGrams(pair[1])===parseWeightGrams(pair[2])?2*parseWeightGrams(pair[1]):null;
      rows.push({item,row,title:values.join(' / '),price:row.option_price,weight:sizes.length===1?sizes[0]:sizes.length?null:pairWeight ?? titleWeight});
    }
  }else if(hasOptions==='F' && !selects.length) {
    const item=literal(scripts,'item_code');
    if(!new RegExp('^'+code+'[A-Z0-9]{4}$').test(item) || literal(scripts,'item_count')!=='1')throw Error('Cafe24 single native SKU identity mismatch');
    rows.push({item,row:nativeJson(literal(scripts,'single_option_stock_data')),title:name,price,weight:fixedContents(name,id,profile)});
  }else throw Error('Cafe24 option type unsupported');
  const offers=rows.map(({item,row,title,price,weight})=>({'@type':'Offer','@id':item,url:parsed.href,name:title,price,priceCurrency:currency,availability:stockState(row,globalStock==='T'),_net_weight_g:weight,_stock_evidence:{merchant_soldout:globalStock,inventory_managed:row.use_stock,stock_number:row.stock_number ?? null,sellout_policy:row.use_soldout,native_display:row.is_display ?? null,native_selling:row.is_selling ?? null,reserve_status:row.is_reserve_stat}}));
  if(globalStock==='F' && offers.every(o=>o.availability==='https://schema.org/OutOfStock'))throw Error('Cafe24 product/SKU stock controls disagree');
  const detail=$('#prdDetail .cont');if(detail.length!==1)throw Error('Cafe24 primary description missing/ambiguous');
  const description=detail.clone(),images=[];description.find('script,style,form,iframe,button').remove();
  description.find('img').each((_,e)=>{const element=$(e),src=element.attr('ec-data-src') || element.attr('src');let asset;try{asset=new URL(src,url);}catch{element.remove();return;}if(asset.protocol!=='https:' || asset.username || asset.password || asset.port || !profile.description_image_hosts.includes(asset.hostname)){element.remove();return;}images.push(asset.href);element.replaceWith($('<img>').attr('src',asset.href).attr('alt',element.attr('alt') || ''));});
  return {'@type':'Product',url:parsed.href,productID:id,name,category:'Coffee',description:description.html(),image:new URL(image,url).href,offers,_variants_complete:true,_market_source:'cafe24_exact_native_options',_description_image_urls:[...new Set(images)]};
}
async function fetchCafe24OptionProduct(html,url,profile,fetchHtml) {
  const canonical=canonicalProductUrl(url),source=primaryProduct(html,canonical,profile),membership=await coffeeMembership(profile,fetchHtml);
  if(!membership.complete || !membership.urls.includes(canonical))throw Error('Cafe24 current coffee membership incomplete');
  return source;
}
module.exports={nativeJson,primaryProduct,fetchCafe24OptionProduct};
