'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),cheerio=require('cheerio');
const profiles=require('../src/siteSupport/profiles.json');
const {profileFor,discoverSiteProducts}=require('../src/siteSupport/discovery');
const {discoverWixProducts,wixProduct}=require('../src/siteSupport/wix');
const {discoverBaseProducts,baseProduct,partialScopeAllowed}=require('../src/siteSupport/base');
const {productOnlyOffer,productAvailability}=require('../src/productEvidence');
const {structuredExtraction}=require('../src/extraction'),{normalizeProduct}=require('../src/catalogNormalization');
const {productSourceKey}=require('../src/productSaver');
const wix=require('./fixtures/siteSupport/zuku-wix.json'),base=require('./fixtures/siteSupport/nakaji-base-classic.json');
const zuku=profiles.find(p=>p.name==='Zuku Cafe'),nakaji=profiles.find(p=>p.name==='Coffee Roastery Nakaji');
const wixHtml=store=>'<script id="wix-warmup-data" type="application/json">'+JSON.stringify({appsWarmupData:{'1380b703-ce81-ff05-f115-39571d94dfcd':store}})+'</script>';
const productHtml=p=>wixHtml({[p.key]:{catalog:{product:p.product}}});
test('Zuku and Nakaji profiles require exact owners and preserve the original Nakaji index URL',async()=>{
 for(const [p,url]of [[zuku,'https://zukucafe.com/'],[nakaji,'https://coffee-nakaji.com/']]){assert.equal(profileFor({id:p.entity_ids[0],website_url:url}),p);assert.equal(profileFor({id:'other-owner',website_url:url}),null);assert.equal(p.reconcile_omissions,false);assert.equal(p.inventory_authorizes_global_absence,false);}
 const roaster={id:nakaji.entity_ids[0],website_url:'https://coffee-nakaji.com/'},requests=[];
 const result=await discoverSiteProducts(roaster,{fetchHtml:async url=>{requests.push(url);return {success:true,finalUrl:url,data:base.listing.html};}});
 assert.equal(result.urls.length,22);assert(requests.every(u=>new URL(u).hostname==='shop.coffee-nakaji.com'));assert.equal(roaster.website_url,'https://coffee-nakaji.com/');
});
test('Zuku requires all 23 published items and selects only 19 reviewed coffees',async()=>{
 const result=await discoverWixProducts({website_url:zuku.bootstrap_url},zuku,async url=>({success:true,finalUrl:url,data:wixHtml(wix.listings)}));
 assert.equal(result.complete,true);assert.equal(result.urls.length,19);assert.equal(result.evidence[0].excluded_unreviewed_products.length,4);
 assert(!result.urls.some(u=>/keepcup|starter/.test(u)));
 const first=Object.values(wix.initial)[0],partial=await discoverWixProducts({website_url:zuku.bootstrap_url},zuku,async()=>({success:true,data:wixHtml({[zuku.wix_listing_key]:first})}));assert.equal(partial.complete,false);assert.match(partial.error,/incomplete/);
});
test('all captured Zuku products retain 102 exact JPY SKUs, including the sold-out lot',()=>{
 let count=0,unknown=0,soldOut=0;
 for(const record of wix.products){const source=wixProduct(productHtml(record),record.url,zuku),p=normalizeProduct(structuredExtraction({html:'',url:record.url,sourceProduct:source},null).product,record.url);assert.equal(p.source_product_id,record.product.id);assert.equal(p.variants_complete,true);assert.equal(p.variants.length,record.product.productItems.length);assert.equal(new Set(p.variants.map(v=>v.source_id)).size,p.variants.length);assert(p.variants.every(v=>v.money.currency==='JPY'));count+=p.variants.length;unknown+=p.variants.filter(v=>v.weight_g==null).length;soldOut+=Number(productAvailability({sourceProduct:source,sourceUrl:record.url}).state==='sold_out');}
 assert.equal(count,102);assert.equal(unknown,33);assert.equal(soldOut,1);
});
test('Zuku uses Japanese size labels and declared assortment contents, not shipping mass or unlabeled pack counts',()=>{
 const record=structuredClone(wix.products.find(p=>p.product.urlPart==='brazil-100g-200g'));record.product.productItems.forEach(v=>v.weight=99);
 assert.deepEqual(wixProduct(productHtml(record),record.url,zuku).offers.map(o=>o._net_weight_g),[100,100,100,100,200,200,200,200]);
 for(const [id,grams]of [['8b6c6ab4-58f1-a15c-adee-d3bd373dd890',165],['b0878265-807d-b50f-8dff-667ac71e137d',200]]){const p=wix.products.find(p=>p.product.id===id);assert(wixProduct(productHtml(p),p.url,zuku).offers.every(o=>o._net_weight_g===grams));}
 const drip=wix.products.find(p=>p.product.urlPart==='brazil-drippack');assert(wixProduct(productHtml(drip),drip.url,zuku).offers.every(o=>o._net_weight_g===null));
 const legacy={...zuku,wix_weight_option_names:undefined};assert(wixProduct(productHtml(record),record.url,legacy).offers.every(o=>o._net_weight_g===null));
});
test('Zuku keeps one-time prices rather than subscription discounts and rejects missing one-time offers',()=>{
 const record=structuredClone(wix.products.find(p=>p.product.urlPart==='brazil-100g-200g')),source=wixProduct(productHtml(record),record.url,zuku);
 assert.equal(source.offers[0].price,'1400');assert.equal(record.product.productItems[0].subscriptionPlans.list[0].price,1260);
 for(const invalid of [null,{index:-1}]){record.product.subscriptionPlans.oneTimePurchase=invalid;assert.throws(()=>wixProduct(productHtml(record),record.url,zuku),/one-time purchase/);}
});
test('reviewed Zuku contents rules fail if the primary declaration or option contract changes',()=>{
 const original=wix.products.find(p=>p.product.id==='b0878265-807d-b50f-8dff-667ac71e137d');
 for(const mutate of [p=>p.additionalInfo=[],p=>p.options[0].title='Size']){const record=structuredClone(original);mutate(record.product);assert.throws(()=>wixProduct(productHtml(record),record.url,zuku),/contents/);}
});
test('copied Wix UUIDs in different merchants remain separate catalog source identities',()=>{
 const z=wix.products.find(p=>p.product.id==='df19c1f7-07d8-a265-42f8-e8dfa824cc6e'),t=require('./fixtures/siteSupport/toyosaki-wix.json').products.find(p=>p.product.id===z.product.id),toy=profiles.find(p=>p.name==='Toyosaki Coffee Factory');
 assert(t);assert.notEqual(z.product.name,t.product.name);assert.notEqual(productSourceKey(zuku.entity_ids[0],{source_product_id:z.product.id},z.url),productSourceKey(toy.entity_ids[0],{source_product_id:t.product.id},t.url));
 assert.throws(()=>wixProduct(productHtml(z),z.url,toy),/mismatch/);
});
test('classic BASE discovery retains only reviewed coffee cards and keeps partial-inventory proof',async()=>{
 const result=await discoverBaseProducts({website_url:'https://coffee-nakaji.com/'},nakaji,async url=>({success:true,finalUrl:url,data:base.listing.html}));assert.equal(result.urls.length,22);assert.equal(result.complete,false);assert.equal(partialScopeAllowed(nakaji,result),true);
 const extra='<div class="card"><a href="https://shop.coffee-nakaji.com/items/999"><h4 class="card-title">Coffee workshop</h4></a></div>';
 const scoped=await discoverBaseProducts({website_url:nakaji.bootstrap_url},nakaji,async url=>({success:true,finalUrl:url,data:base.listing.html+extra}));assert.equal(scoped.urls.length,22);assert.equal(scoped.evidence[0].excluded.length,1);
});
test('classic BASE product offers keep paired JPY and exact primary stock without inventing native variants',()=>{
 for(const [i,state]of [[0,'in_stock'],[1,'sold_out']]){const record=base.products[i],source=baseProduct(record.html,record.url,nakaji),offer=productOnlyOffer(source,record.url),p=normalizeProduct(structuredExtraction({html:'',url:record.url,sourceProduct:source},null).product,record.url);assert(offer);assert.equal(offer.currency,'JPY');assert.equal(offer.state,state);assert.equal(offer.net_weight_g,i===0?80:100);assert.equal(p.variants.length,0);assert.equal(p.variants_complete,false);assert.equal(productAvailability({sourceProduct:source,sourceUrl:record.url}).state,state);}
 const source=baseProduct(base.products[0].html,base.products[0].url,nakaji);assert.equal(source._product_offer.minor_units,1000);assert.equal(source._product_offer.variant_identity_complete,false);
});
test('classic BASE rejects wrong product/shop bindings, conflicting price evidence and inconsistent stock controls',()=>{
 const record=base.products[0];
 for(const mutate of [$=>$('#purchase_form input[name=shopID]').attr('value','other-shop'),$=>$('meta[property="product:price:amount"]').first().attr('content','1001'),$=>$('#purchase_form button[type=submit]').attr('disabled',''),$=>$('link[rel=canonical]').attr('href','https://foreign.example/items/163107129')]){const $=cheerio.load(record.html);mutate($);assert.throws(()=>baseProduct($.html(),record.url,nakaji),/identity|conflicting|control/);}
 assert.throws(()=>baseProduct(record.html.replaceAll('"currency":"JPY"','"currency":"USD"'),record.url,nakaji),/price evidence/);
});
test('classic BASE data extraction does not execute tracking or merchant scripts',()=>{
 const record=base.products[0];globalThis.classicScriptRan=false;assert(baseProduct(record.html+'<script>globalThis.classicScriptRan=true</script>',record.url,nakaji));assert.equal(globalThis.classicScriptRan,false);delete globalThis.classicScriptRan;
});
test('normal page visitor uses the opt-in classic BASE reader without changing the newer BASE path',async()=>{
 const record=base.products[0],{fetchPageContent}=require('../src/pageVisitor'),result=await fetchPageContent(record.url,null,{siteProfile:nakaji,fetchHtml:async()=>({success:true,status:200,data:record.html,finalUrl:record.url})});assert.equal(result.success,true);assert.equal(result.sourceProduct.productID,'base:coffeenakaji:163107129');
 assert.throws(()=>baseProduct(record.html,record.url,{...nakaji,base_classic_template:false}),/order form/);
});
