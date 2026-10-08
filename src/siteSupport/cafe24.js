'use strict';
const cheerio=require('cheerio');
const {parseMoney,canonicalProductUrl}=require('../catalogNormalization');
const {parseWeightGrams}=require('../product-value-parsers.cjs');
const {structuredProduct}=require('../productEvidence');
const {discoverDomProducts}=require('./domDiscovery');
function primaryValue($,property){const values=$('meta[property="'+property+'"]').map((_,e)=>$(e).attr('content')).get();if(values.length!==1)throw Error('Cafe24 primary '+property+' missing/ambiguous');return values[0];}
function literal(script,name){const rx=new RegExp('\\bvar\\s+'+name+"\\s*=\\s*'([^'\\r\\n]*)'\\s*;",'g'),values=[...script.matchAll(rx)];if(values.length!==1)throw Error('Cafe24 native '+name+' missing/ambiguous');return values[0][1];}
async function fetchCafe24Product(html,url,profile,fetchHtml) {
  const $=cheerio.load(html),id=new URL(canonicalProductUrl(url)).searchParams.get('product_no'),scripts=$('script:not([src])').map((_,e)=>$(e).text()).get().join('\n');
  const nativeIds=[...scripts.matchAll(/\bvar\s+iProductNo\s*=\s*([1-9]\d*)\s*;/g)];
  if(!profile.hosts.includes(new URL(url).hostname) || !id || nativeIds.length!==1 || nativeIds[0][1]!==id || primaryValue($,'product:productId')!==id)throw Error('Cafe24 primary product identity mismatch');
  const code=literal(scripts,'product_code'),item=literal(scripts,'item_code');
  if(!/^P[A-Z0-9]{7}$/.test(code) || !new RegExp('^'+code+'[A-Z0-9]{4}$').test(item) || literal(scripts,'has_option')!=='F' || literal(scripts,'item_count')!=='1')throw Error('Cafe24 exact native single item unsupported');
  // Cafe24 embeds a JSON object inside a quoted literal. Decode only escaped
  // JSON quotes, then JSON.parse; no script or expression is executed.
  let stock;try{stock=JSON.parse(literal(scripts,'single_option_stock_data').replace(/\\"/g,'"'));}catch{throw Error('Cafe24 exact stock JSON missing');}
  const soldout=literal(scripts,'is_soldout_icon'),buy=$('.xans-product-action .btnSubmit.sizeL');
  if(!['T','F'].includes(soldout) || !['T','F'].includes(stock.use_soldout) || typeof stock.use_stock!=='boolean' || typeof stock.stock_number!=='number' || stock.is_reserve_stat!=='N' || buy.length!==1 || (soldout==='T')!==buy.hasClass('displaynone') || soldout==='F' && stock.use_stock && stock.stock_number<=0)throw Error('Cafe24 exact item stock missing/conflicting');
  const price=primaryValue($,'product:sale_price:amount'),currency=primaryValue($,'product:sale_price:currency'),money=parseMoney(price,{currency,locale:'en-US'}),declared=parseMoney(literal(scripts,'product_price'),{currency,locale:'en-US'});
  if(money.minorUnits==null || money.minorUnits!==declared.minorUnits || primaryValue($,'product:price:currency')!==currency)throw Error('Cafe24 exact primary price/currency mismatch');
  const names=$('[spec="product_name_css"] > div').map((_,e)=>$(e).text().replace(/\s+/g,' ').trim()).get(),name=[...new Set(names)];if(name.length!==1 || !name[0])throw Error('Cafe24 primary name missing');
  const listings=[];
  const discovery=await discoverDomProducts({website_url:'https://'+profile.hosts[0]},profile,async value=>{const result=await fetchHtml(value);if(result.success)listings.push(result.data);return result;});
  if(!discovery.complete || !discovery.urls.includes(canonicalProductUrl(url)))throw Error('Cafe24 current coffee membership incomplete');
  const weights=new Set();
  for(const listing of listings){const $list=cheerio.load(listing),card=$list('#anchorBoxId_'+id);if(!card.length)continue;const listed=card.find('[spec="prd_name"]').attr('spec-data');if(String(listed || '').replace(/\s+/g,' ').trim()!==name[0])throw Error('Cafe24 listing/product name mismatch');const labels=card.find('[spec-title="Weight"][spec-data]').map((_,e)=>$list(e).attr('spec-data')).get();if(labels.length!==1 || parseWeightGrams(labels[0])==null)throw Error('Cafe24 explicit listing net weight missing');weights.add(parseWeightGrams(labels[0]));}
  if(weights.size!==1)throw Error('Cafe24 explicit net weight conflicting/missing');
  const schema=structuredProduct(html,url);
  const detail=$('#prdDetail .cont').first().clone(),descriptionImages=[];detail.find('script,style,form,iframe,button').remove();
  detail.find('img').each((_,element)=>{const src=$(element).attr('ec-data-src') || $(element).attr('src'),asset=new URL(src,url);if(asset.protocol!=='https:' || !profile.description_image_hosts?.includes(asset.hostname) || !asset.pathname.includes('/aerycoffee/'))throw Error('Cafe24 primary description image owner mismatch');descriptionImages.push(asset.href);$(element).replaceWith($('<img>').attr('src',asset.href).attr('alt',$(element).attr('alt') || ''));});
  return {'@type':'Product',url:canonicalProductUrl(url),productID:id,name:name[0],description:descriptionImages.length?detail.html():schema?.description || '',image:primaryValue($,'og:image'),category:'Coffee',offers:[{'@type':'Offer','@id':item,url:canonicalProductUrl(url),name:[...weights][0]+' g',price,priceCurrency:currency,availability:soldout==='T'?'https://schema.org/OutOfStock':'https://schema.org/InStock',_net_weight_g:[...weights][0],_stock_evidence:{merchant_soldout:soldout,inventory_managed:stock.use_stock,sellout_policy:stock.use_soldout,stock_number:stock.stock_number,reserve_status:stock.is_reserve_stat}}],_market_source:'cafe24_exact_native_single_item',_variants_complete:true,_description_image_urls:descriptionImages};
}
module.exports={fetchCafe24Product};
