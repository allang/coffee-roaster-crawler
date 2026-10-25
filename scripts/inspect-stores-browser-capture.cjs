'use strict';
const {parseMoney}=require('../src/catalogNormalization');
const {parseWeightGrams}=require('../src/product-value-parsers.cjs');
const {jsonLiteral}=require('../src/siteSupport/jsonLiteral');
const MERCHANT='67a992c0f3d6dd02082d2e88',OWNER='31ebaf16-7beb-4b1f-b6ba-3d316d3f4e62';
const CATEGORY='https://auracoffee.stores.jp/?category_id=67fa483ec823279e7f4db66b';
function itemId(value){const url=new URL(value),match=url.pathname.match(/^\/items\/([a-f0-9]{24})$/);if(url.origin!=='https://auracoffee.stores.jp' || !match || url.search || url.hash)throw Error('Aura public product URL mismatch');return match[1];}
function inspectCapture(capture) {
  if(capture.mode!=='public-browser-dom-capture-not-cli-ingestion' || capture.production_writes!==0 || capture.explicit_cart_or_account_actions!==0 || capture.category?.url!==CATEGORY || !Array.isArray(capture.products) || !capture.products.length)throw Error('Unreviewed browser capture scope');
  const listed=capture.category.links.map(l=>itemId(l.url));
  if(new Set(listed).size!==listed.length || listed.length!==capture.products.length || !capture.category.heading.some(t=>t==='CATEGORY 珈琲豆'))throw Error('Aura observed category/product set mismatch');
  const products=[],seen=new Set();
  for(const page of capture.products) {
    const id=itemId(page.url),script=page.native_init || '',declarations=[...script.matchAll(/detailCtrl\.itemId='([a-f0-9]{24})';/g)],calls=[...script.matchAll(/detailCtrl\.addItemBrowsingHistory\(/g)];
    if(!listed.includes(id) || seen.has(id) || page.product_id!==id || declarations.length!==1 || declarations[0][1]!==id || page.merchant_ids?.length!==1 || page.merchant_ids[0]!==MERCHANT || calls.length!==1)throw Error('Aura native merchant/product binding mismatch');seen.add(id);
    for(const key of ['isDigit','isSubscription','isTicket','isLoggedIn'])if([...script.matchAll(new RegExp('detailCtrl\\.'+key+'=false;','g'))].length!==1)throw Error('Aura ordinary anonymous coffee offer unproved');
    const schemas=page.schemas.flat().filter(p=>p?.['@type']==='Product'),native=jsonLiteral(script,calls[0].index+calls[0][0].length),ids=new Set(),offers=[];
    const names=[...script.matchAll(/detailCtrl\.itemName='([^'\r\n]*)';/g)];
    if(names.length!==1 || names[0][1]!==page.title || schemas.length!==1 || schemas[0].mpn!==id || schemas[0].url!==page.url || schemas[0].name!==page.title || !Array.isArray(native) || !native.length || page.rows.length!==native.length)throw Error('Aura primary native/schema identity or SKU count mismatch');
    const schema=schemas[0],aggregate=schema.offers;
    if(aggregate?.['@type']!=='AggregateOffer' || aggregate.priceCurrency!=='JPY' || aggregate.url!==page.url || aggregate.offerCount!==native.length || aggregate.availability!=='https://schema.org/InStock')throw Error('Aura paired aggregate market scope mismatch');
    for(const [index,variant]of native.entries()) {
      const row=page.rows[index],button=row?.buttons?.[0],binding=button?.binding?.match(/^detailCtrl\.addCart\((\{.*\}), undefined\)$/);
      let control;try{control=binding && JSON.parse(binding[1]);}catch{throw Error('Aura native purchase binding JSON invalid');}
      if(!/^[a-f0-9]{24}$/.test(variant.id || '') || ids.has(variant.id) || !variant.name || variant.name!==row.title || JSON.stringify(control)!==JSON.stringify(variant) || row.buttons.length!==1 || button.text!=='カートに入れる' || button.disabled!==null || button.aria_disabled!==null || !Number.isSafeInteger(variant.quantity) || variant.quantity<=0)throw Error('Aura exact SKU/control identity or stock mismatch');ids.add(variant.id);
      const money=parseMoney(variant.salesPrice,{currency:'JPY'}),visible=parseMoney(row.prices,{currency:'JPY',locale:'ja-JP'});
      if(!Number.isSafeInteger(variant.salesPrice) || variant.salesPrice<=0 || money.minorUnits!==visible.minorUnits || variant.originalPrice!==null || variant.discountRate!==0 || variant.discountAmount!==0)throw Error('Aura exact native/displayed JPY price mismatch');
      offers.push({id:variant.id,title:variant.name,price:money.amount,currency:'JPY',minor_units:money.minorUnits,weight_g:parseWeightGrams(variant.name),state:'in_stock',stock_evidence:'same-native-SKU enabled primary purchase control',quantity_disclosed:variant.quantity});
    }
    if(Math.min(...offers.map(v=>v.minor_units))!==parseMoney(aggregate.lowPrice,{currency:'JPY'}).minorUnits || Math.max(...offers.map(v=>v.minor_units))!==parseMoney(aggregate.highPrice,{currency:'JPY'}).minorUnits)throw Error('Aura aggregate/exact SKU range disagreement');
    products.push({url:page.url,source_product_id:id,title:page.title,checked_at:page.checked_at,variants:offers});
  }
  return {checked_at:new Date().toISOString(),source_capture_checked_at:capture.checked_at,source_capture_sha256:capture.source_capture_sha256 || null,mode:'browser-capture-evidence-inspection-not-crawler-ingest',entity_id:OWNER,merchant_id:MERCHANT,category:CATEGORY,products,product_count:products.length,native_variant_count:products.reduce((n,p)=>n+p.variants.length,0),automated_http_supported:false,production_ingest_verified:false,inventory_authorizes_global_absence:false,production_writes:0,ai_calls:0};
}
if(require.main===module){const fs=require('node:fs'),[input,output]=process.argv.slice(2);if(!input)throw Error('Usage: node scripts/inspect-stores-browser-capture.cjs CAPTURE.json [REPORT.json]');const report=inspectCapture(JSON.parse(fs.readFileSync(input,'utf8')));if(output)fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({products:report.product_count,native_variants:report.native_variant_count,automated_http_supported:false,production_writes:0}));}
module.exports={inspectCapture};
