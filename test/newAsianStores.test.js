'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const profiles=require('../src/siteSupport/profiles.json');
const {profileFor}=require('../src/siteSupport/discovery');
const {discoverShopifyProducts,retailCoffee}=require('../src/siteSupport/shopifyDiscovery');
const {parseShopifyProduct}=require('../src/shopifyProduct');
const {discoverWixProducts,wixProduct}=require('../src/siteSupport/wix');
const {structuredExtraction}=require('../src/extraction');
const {normalizeProduct}=require('../src/catalogNormalization');
const {productAvailability}=require('../src/productEvidence');
const regolith=require('./fixtures/siteSupport/regolith-shopify.json');
const toyosaki=require('./fixtures/siteSupport/toyosaki-wix.json');
const shopify=profiles.find(p=>p.name==='Regolith Coffee'),wix=profiles.find(p=>p.name==='Toyosaki Coffee Factory');
const wixHtml=store=>'<script id="wix-warmup-data" type="application/json">'+JSON.stringify({appsWarmupData:{'1380b703-ce81-ff05-f115-39571d94dfcd':store}})+'</script>';
const productHtml=record=>wixHtml({[record.key]:{catalog:{product:record.product}}});

test('new store profiles require the reviewed owner and never enable omission reconciliation',()=>{
 for(const profile of [shopify,wix]){
  assert.equal(profileFor({id:profile.entity_ids[0],website_url:profile.bootstrap_url}),profile);
  assert.equal(profileFor({id:'another-owner',website_url:profile.bootstrap_url}),null);
  assert.equal(profile.reconcile_omissions,false);assert.equal(profile.inventory_authorizes_global_absence,false);
 }
});
test('captured Regolith pagination selects 21 one-time bean products and six reviewed drip bags',async()=>{
 const requested=[];
 const result=await discoverShopifyProducts({website_url:shopify.bootstrap_url},shopify,async value=>{
  const page=Number(new URL(value).searchParams.get('page'));requested.push(page);
  return {success:true,finalUrl:value,data:JSON.stringify({products:regolith.products.slice((page-1)*50,page*50)})};
 });
 assert.deepEqual(requested,[1,2,3]);assert.equal(result.complete,true);assert.equal(result.urls.length,27);
 const selected=regolith.products.filter(p=>retailCoffee(p,shopify));
 assert.equal(selected.filter(p=>p.product_type===shopify.coffee_product_types[0]).length,21);
 assert.equal(selected.filter(p=>!p.product_type).length,6);
 assert.equal(regolith.products.filter(p=>new RegExp(shopify.exclude_name_pattern).test(p.title) && /\u5b9a\u671f|\u307e\u3068\u3081\u3066\u8cfc\u5165/.test(p.title)).length,34);
 assert(!selected.some(p=>/\bGift\b|\u6c34\u51fa\u3057/.test(p.title)));
 assert(!selected.some(p=>p.variants.some(v=>Number(v.price)===0)));
 assert.equal(result.inventory_authorizes_global_absence,false);
});
test('Regolith bag weights use the reviewed title and grind contract, never shipping grams',()=>{
 const beans=regolith.products.filter(p=>retailCoffee(p,shopify) && p.product_type),options={preferLabelWeight:true,titleNetWeightRule:shopify.title_net_weight_rule};
 for(const raw of beans){
  const changed=structuredClone(raw);changed.variants.forEach(v=>v.grams=9999);
  const parsed=parseShopifyProduct(changed,options);assert.equal(parsed.variants.length,5);assert(parsed.variants.every(v=>v.weightGrams===100 && v.shippingWeightGrams===9999));
 }
 const changed=structuredClone(beans[0]);changed.options[0].name='Size';
 assert(parseShopifyProduct(changed,options).variants.every(v=>v.weightGrams===null));
 for(const raw of regolith.products.filter(p=>shopify.coffee_handles.includes(p.handle)))assert(parseShopifyProduct(raw,options).variants.every(v=>v.weightGrams===null));
});
test('Toyosaki uses the complete published second page and logs new unreviewed products separately',async()=>{
 const requests=[],read=async value=>{requests.push(value);return {success:true,finalUrl:value,data:wixHtml(toyosaki.listing)};};
 const result=await discoverWixProducts({website_url:wix.bootstrap_url},wix,read);
 assert.equal(result.complete,true);assert.equal(result.urls.length,22);assert.equal(new URL(requests[0]).searchParams.get('page'),'2');
 const initial=structuredClone(toyosaki.initial),first=Object.values(initial)[0];
 const partial=await discoverWixProducts({website_url:wix.bootstrap_url},wix,async()=>({success:true,data:wixHtml({[wix.wix_listing_key]:first})}));
 assert.equal(partial.complete,false);assert.match(partial.error,/incomplete/);
 const extra=structuredClone(toyosaki.listing),category=extra[wix.wix_listing_key].catalog.category;
 category.productsWithMetaData.list.push({id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',name:'Coffee grinder',urlPart:'coffee-grinder',productType:'physical'});category.productsWithMetaData.totalCount++;
 const scoped=await discoverWixProducts({website_url:wix.bootstrap_url},wix,async()=>({success:true,data:wixHtml(extra)}));
 assert.equal(scoped.complete,true);assert.equal(scoped.urls.length,22);assert.equal(scoped.evidence[0].excluded_unreviewed_products.length,1);
 assert(!scoped.urls.some(u=>u.endsWith('coffee-grinder')));
});
test('all 22 captured Toyosaki offers retain native UUIDs and JPY totals without multiplying customization choices',()=>{
 const expected=[150,150,150,150,150,450,130,434,300,500,800,150,150,150,600,208,156,150,150,300,150,150],ids=new Set();
 for(const [i,record]of toyosaki.products.entries()){
  const raw=structuredClone(record);raw.product.weight=99;raw.product.productItems[0].weight=100;
  const source=wixProduct(productHtml(raw),record.url,wix),product=normalizeProduct(structuredExtraction({html:'',url:record.url,sourceProduct:source},null).product,record.url);
  assert.equal(product.source_product_id,record.product.id);assert.equal(product.variants.length,1);assert.equal(product.variants_complete,true);
  const variant=product.variants[0];assert.equal(variant.source_id,record.product.productItems[0].id);assert.equal(variant.weight_g,expected[i]);assert.equal(variant.money.currency,'JPY');assert.equal(variant.money.minorUnits,record.product.productItems[0].price);assert.equal(variant.availability,'in_stock');
  assert.equal(productAvailability({sourceProduct:source,sourceUrl:record.url}).state,'in_stock');assert(!ids.has(variant.source_id));ids.add(variant.source_id);
 }
 assert(toyosaki.products.some(p=>p.product.options.length>3));
 const oldSlug=toyosaki.products.find(p=>p.product.id==='f0359dd5-5310-b0aa-a4c5-e8af50260578');assert.match(oldSlug.product.name,/150g$/);
 assert.equal(wixProduct(productHtml(oldSlug),oldSlug.url,wix).offers[0]._net_weight_g,150);
});
test('Toyosaki unknown identities or missing/ambiguous net-content evidence fail closed',()=>{
 const record=toyosaki.products[0];
 for(const mutate of [p=>p.id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',p=>p.additionalInfo=[],p=>p.additionalInfo.push(structuredClone(p.additionalInfo[0])),p=>p.additionalInfo[0].description='Shipping weight: 500g']){
  const changed=structuredClone(record);mutate(changed.product);assert.throws(()=>wixProduct(productHtml(changed),record.url,wix),/mismatch|net contents/);
 }
 const duplicate=structuredClone(record);duplicate.product.additionalInfo[0].description='\u5185\u5bb9\u91cf:150g\n\u5185\u5bb9\u91cf:200g';
 assert.throws(()=>wixProduct(productHtml(duplicate),record.url,wix),/ambiguous/);
 const zero=structuredClone(record);zero.product.additionalInfo[0].description='\u5185\u5bb9\u91cf:0g';
 assert.throws(()=>wixProduct(productHtml(zero),record.url,wix),/invalid/);
 const fullwidth=structuredClone(record);fullwidth.product.additionalInfo[0].description='\u5185\u5bb9\u91cf\uff1a\uff11\uff15\uff10\uff47';
 assert.equal(wixProduct(productHtml(fullwidth),record.url,wix).offers[0]._net_weight_g,150);
});
test('Toyosaki page visitor dispatch remains scoped to its registered Wix product reader',async()=>{
 const record=toyosaki.products[0],{fetchPageContent}=require('../src/pageVisitor');
 const result=await fetchPageContent(record.url,null,{siteProfile:wix,fetchHtml:async()=>({success:true,status:200,finalUrl:record.url,data:productHtml(record)})});
 assert.equal(result.success,true);assert.equal(result.sourceProduct.productID,record.product.id);assert.equal(result.sourceProduct.offers.length,1);
});
