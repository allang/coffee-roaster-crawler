'use strict';
const cheerio=require('cheerio');
const {parseMoney}=require('../catalogNormalization');
const {parseWeightGrams}=require('../product-value-parsers.cjs');
const {jsonLiteral}=require('./jsonLiteral');
const EXCLUDE=/subscription|green\s+coffee|gift\s*card|\u751f\u8c46|\u8b1b\u7fd2|\u30ef\u30fc\u30af\u30b7\u30e7\u30c3\u30d7|\u30bb\u30df\u30ca\u30fc|\u5b9a\u671f\u4fbf|T\u30b7\u30e3\u30c4/i;
function one(values,label) {
  const unique=[...new Set(values)];if(unique.length!==1 || !unique[0])throw Error('BASE classic '+label+' missing/conflicting');return unique[0];
}
function document(html,url,profile) {
  require('./base').owned(url,profile);
  const $=cheerio.load(html || ''),canonical=one($('link[rel="canonical"]').map((_,e)=>$(e).attr('href')).get(),'canonical');
  if(canonical!==url)throw Error('BASE classic canonical identity mismatch');
  return $;
}
async function discoverClassicProducts(roaster,profile,fetchHtml) {
  const urls=new Set(),evidence=[];
  try {
    if(profile.base_classic_template!==true || !require('./base').identityMatches(roaster.website_url,profile))throw Error('BASE classic index identity mismatch');
    for(const path of profile.listing_paths){
      const url=new URL(path,profile.bootstrap_url).href,response=await fetchHtml(url);
      if(!response.success || new URL(response.finalUrl || url).href!==url)throw Error('BASE classic listing unavailable/redirected');
      const $=document(response.data,url,profile),cards=$('.card a[href]').filter((_,e)=>$(e).find('.card-title').length===1),found=new Set(),excluded=[];
      if(!cards.length)throw Error('BASE classic published cards missing');
      cards.each((_,e)=>{const target=new URL($(e).attr('href'),url).href,id=require('./base').owned(target,profile,true).product,title=$(e).find('.card-title').text().trim();if(!title)throw Error('BASE classic card title missing');if(!profile.base_reviewed_product_ids.includes(id) || EXCLUDE.test(title)){excluded.push({url:target,title});return;}found.add(target);urls.add(target);});
      if(!found.size)throw Error('BASE classic reviewed coffee cards missing');
      evidence.push({listing:url,product_urls:[...found],excluded});
    }
    return {supported:true,urls:[...urls],complete:false,observed_scope_complete:true,inventory_complete:false,inventory_scope:'base_published_one_time_cards',market_scope:'JPY_public_offer',reconcile_omissions:false,inventory_authorizes_global_absence:false,evidence};
  }catch(error){return {supported:true,urls:[],complete:false,observed_scope_complete:false,inventory_complete:false,error:error.message,evidence};}
}
function classicProduct(html,url,profile) {
  const target=require('./base').owned(url,profile,true),$=document(html,url,profile),form=$('form#purchase_form.x_purchaseForm');
  if(profile.base_classic_template!==true || !profile.base_reviewed_product_ids.includes(target.product) || form.length!==1 || form.attr('method')!=='post' || form.attr('action')!==new URL('/cart/add/'+profile.base_shop_id,profile.bootstrap_url).href)throw Error('BASE classic primary form identity mismatch');
  for(const [name,value]of [['shopID',profile.base_shop_id],['id',target.product]]){const inputs=form.find('input[name="'+name+'"]');if(inputs.length!==1 || inputs.attr('value')!==value)throw Error('BASE classic hidden product/shop identity mismatch');}
  const heading=$('.itemDetail h1.itemTitle'),name=heading.text().trim();
  if(heading.length!==1 || !name || EXCLUDE.test(name) || !/coffee|\u30b3\u30fc\u30d2\u30fc|\u30c9\u30ea\u30c3\u30d7/i.test(name))throw Error('BASE classic primary coffee title missing');
  const meta=key=>one($('meta[property="'+key+'"]').map((_,e)=>$(e).attr('content')).get(),key);
  if(meta('og:url')!==url || meta('product:product_link')!==url || !meta('og:title').startsWith(name+' | ') || meta('product:price:currency')!=='JPY')throw Error('BASE classic primary product/market mismatch');
  const money=parseMoney(meta('product:price:amount'),{currency:'JPY',locale:'ja-JP'});
  if(money.minorUnits==null)throw Error('BASE classic exact JPY price missing');
  const scripts=$('script:not([src])').map((_,e)=>$(e).text()).get().join('\n'),events=[];
  // Correlate the paired price with published same-product JSON, without running trackers.
  for(const match of scripts.matchAll(/\bfbq\(\s*'trackSingle',\s*'[^']+',\s*'ViewContent',\s*(?=\{)/g)){
    const event=jsonLiteral(scripts,match.index+match[0].length);if(event?.content_ids?.length===1 && event.content_ids[0]===target.product)events.push(event);
  }
  if(!events.length || events.some(e=>e.currency!=='JPY' || e.contents?.length!==1 || e.contents[0].id!==target.product || parseMoney(e.value,{currency:'JPY'}).minorUnits!==money.minorUnits || parseMoney(e.contents[0].item_price,{currency:'JPY'}).minorUnits!==money.minorUnits))throw Error('BASE classic exact product price evidence mismatch');
  const controls=form.find('button.purchaseButton__btn[type="submit"]');if(controls.length!==1)throw Error('BASE classic purchase control missing/ambiguous');
  const control=controls.first(),label=control.text().replace(/\s+/g,' ').trim(),disabled=control.is('[disabled],[aria-disabled="true"]');
  const state=/^sold\s*out$/i.test(label) && disabled?'sold_out':/^add to cart$/i.test(label) && !disabled?'in_stock':null;
  if(!state)throw Error('BASE classic primary stock control missing/conflicting');
  const detail=$('.itemDetail .itemDescription');if(detail.length!==1)throw Error('BASE classic primary description missing/ambiguous');
  const description=detail.clone();description.find('script,style,iframe,form').remove();
  const titleWeights=[...name.matchAll(/\[\u30b3\u30fc\u30d2\u30fc[\u8c46\u7c89]:\s*(\d+(?:\.\d+)?\s*(?:g|kg))\]/gi)];
  const netWeight=titleWeights.length===1?parseWeightGrams(titleWeights[0][1]):null;
  const id='base:'+profile.base_shop_id+':'+target.product,offer={source:'base_primary_product_offer',source_url:url,source_product_id:id,price:money.amount,currency:'JPY',minor_units:money.minorUnits,availability:'https://schema.org/'+(state==='in_stock'?'InStock':'OutOfStock'),state,variant_identity_complete:false,net_weight_g:netWeight,stock_control:{source:'base_primary_purchase_control',product_id:target.product,shop_id:profile.base_shop_id,text:label,disabled},schema_availability:null};
  return {'@type':'Product',url,productID:id,name,category:'Coffee',description:description.html(),image:meta('og:image'),offers:[],_product_only:true,_product_offer:offer,_variants_complete:false,_market_source:'base_primary_product_offer',_market_context:{scope:'base_public_primary_offer',currency:'JPY',inventory_complete:false,variant_identity_complete:false,base_price_only:true,template:'classic'}};
}
module.exports={discoverClassicProducts,classicProduct};
