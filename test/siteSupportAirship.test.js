'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const profile=require('../src/siteSupport/profiles.json').find(p=>p.name==='Airship');
const listing=require('./fixtures/siteSupport/airship-retail-listing.json');
const fixture=require('./fixtures/siteSupport/airship-native-product.json');
const {retailCoffee,discoverShopifyProducts}=require('../src/siteSupport/shopifyDiscovery');
const {canonicalProductUrl,normalizeProduct}=require('../src/catalogNormalization');
const {fetchShopifyProductJson}=require('../src/shopifyProduct');
const {structuredExtraction}=require('../src/extraction');
test('Airship native inventory includes retail coffee and optional one-time choice, excludes machines and partner wholesale',async()=>{
 const coffees=listing.products.filter(p=>retailCoffee(p,profile));
 assert.equal(coffees.length,12);assert(coffees.some(p=>p.handle==='roasterschoice'));
 assert(!coffees.some(p=>p.handle==='espresso-series-1'));assert(coffees.every(p=>p.product_type==='Coffee' || p.handle==='roasterschoice'));
 const reads=[],d=await discoverShopifyProducts({website_url:profile.bootstrap_url},profile,async url=>{reads.push(url);const page=Number(new URL(url).searchParams.get('page'));return {success:true,finalUrl:url,data:JSON.stringify({products:listing.products.slice((page-1)*50,page*50)})};});
 assert.equal(d.complete,true);assert.equal(d.urls.length,12);assert.equal(reads.length,3);assert.equal(d.inventory_authorizes_global_absence,false);assert.equal(profile.reconcile_omissions,false);
 assert(d.urls.every(u=>u.startsWith(profile.bootstrap_url+'/products/')));
});
test('Airship native aliases adopt the existing product URL identity and retain the real retrieval host',()=>{
 const old='https://www.airshipcoffee.com/products/roasterschoice?variant=1',native=fixture.url;
 assert.equal(canonicalProductUrl(old),canonicalProductUrl(native));
 assert.equal(require('../src/productSaver').retrievalUrl(native),native);
 assert.equal(canonicalProductUrl('https://foreign.myshopify.com/products/roasterschoice'),'https://foreign.myshopify.com/products/roasterschoice');
 assert.equal(canonicalProductUrl('https://airshipcoffee.myshopify.com/collections/light-roast'),'https://airshipcoffee.myshopify.com/collections/light-roast');
});
test('Airship adopts the existing catalog ID and slug across the verified native host without creating another coffee',async()=>{
 const {catalogDb,supabaseAdapter}=require('./catalogDb'),{findExistingProduct,catalogPayload,productSourceKey}=require('../src/productSaver');
 const pg=await catalogDb();try{
  const owner=profile.entity_ids[0],id='11111111-2222-4333-8444-555555555555',old='https://www.airshipcoffee.com/products/roasterschoice';
  await pg.query('insert into entities(id) values($1)',[owner]);await pg.query('insert into products(id,entity_id,slug,name,source_url) values($1,$2,$3,$4,$5)',[id,owner,'roasters-choice-original','Old title',old]);
  const product={name:fixture.product.title,source_product_id:fixture.product.id,attributes:{},variants:[]};
  const existing=await findExistingProduct(supabaseAdapter(pg),owner,canonicalProductUrl(fixture.url),productSourceKey(owner,product,fixture.url));
  assert.equal(existing.id,id);assert.equal(existing.slug,'roasters-choice-original');
  const payload=catalogPayload(owner,product,fixture.url,existing,null,'2026-10-08T21:00:00Z');assert.equal(payload.product.id,id);assert.equal(payload.product.slug,existing.slug);assert.equal(payload.product.adopted_source_url,old);assert.equal(payload.product.source_url,fixture.url);
 }finally{await pg.close();}
});
test('Airship current native options retain exact identities, paired USD prices, known bag weights and stock',async()=>{
 const native=await fetchShopifyProductJson(fixture.url,null,{fetchJson:async url=>({success:true,data:url.endsWith('.json')?{product:fixture.product}:fixture.ajax})});
 assert.equal(native.success,true);
 const p=normalizeProduct(structuredExtraction({url:fixture.url,html:fixture.html},native).product,fixture.url);
 assert.equal(String(p.source_product_id),'7282620235811');assert.equal(p.variants_complete,true);assert.equal(p.variants.length,15);
 for(const v of p.variants){const raw=fixture.product.variants.find(r=>String(r.id)===String(v.source_id));assert(raw);assert.equal(v.money.currency,'USD');assert.equal(v.money.minorUnits,Math.round(Number(raw.price)*100));assert.equal(v.availability,'in_stock');assert([250,750,2000].includes(v.weight_g));}
 assert.equal(new Set(p.variants.map(v=>String(v.source_id))).size,15);
 assert.equal(p.variants.filter(v=>v.weight_g===250).length,5);
 assert(p.attributes.product_image_url);
});
test('hidden Shopyflow cart cannot classify as coffee or reuse a contaminated cached classification',async()=>{
 const {fetchPageContent,processFetchedPage}=require('../src/pageVisitor'),url='https://www.airshipcoffee.com/collections/light-roast';
 const html='<html><head><title>Airship</title><script data-shop-id="gid://shopify/Shop/6290581" src="/shopyflow.js"></script></head><body><main><h1>Light Roast</h1><a href="/products/roasterschoice">Coffee</a></main><div sf-cart-popup="1"><div sf-show-title="1">Product Title</div><p>250G Coffee $0</p><img src="https://example.test/cart.jpg"></div></body></html>';
 const page=await fetchPageContent(url,null,{fetchHtml:async()=>({success:true,data:html,status:200,finalUrl:url})});
 assert.equal(page.success,true);assert(!page.content.includes('Product Title'));assert(!page.html.includes('sf-cart-popup'));assert(page.html.includes('/products/roasterschoice'));
 const r=await processFetchedPage(profile.entity_ids[0],url,page,null,'shopify',{siteProfile:profile,knownPage:{status:'coffee',classification:{is_coffee_page:true,product:{name:'Product Title'}}}});
 assert.equal(r.isCoffee,false);assert.equal(r.aiCalls,0);assert.equal(r.reason,'headless_storefront_shell_without_product_identity');
 const real=await fetchPageContent(fixture.url,null,{fetchHtml:async()=>({success:true,status:200,data:fixture.html,finalUrl:fixture.url})});assert.equal(real.nonProductReason,null);
});
test('registered stock failures retain status and cooldown proof through the visitor without classification or saving',async()=>{
 const failure={success:false,status:503,error:'HTTP 503',retryStopped:'merchant_cooldown_limit',merchantCooldownExceeded:true,cooldown:{retry_after_raw:'123'},cooldownRecovery:{resumptions:3}};
 const fetchJson=async url=>url.endsWith('.json')?{success:true,data:{product:fixture.product}}:failure;
 const native=await fetchShopifyProductJson(fixture.url,null,{fetchJson});
 assert.equal(native.success,false);assert.equal(native.sourceStage,'shopify_product_stock');assert.equal(native.status,503);assert.deepEqual(native.cooldown,failure.cooldown);
 const {processFetchedPage}=require('../src/pageVisitor'),r=await processFetchedPage(profile.entity_ids[0],fixture.url,{success:true,html:fixture.html,finalUrl:fixture.url,status:200},null,'shopify',{siteProfile:profile,fetchJson});
 assert.equal(r.aiCalls,0);assert.equal(r.classified,false);assert.equal(r.status,503);assert.equal(r.sourceStage,'shopify_product_stock');assert.equal(r.merchantCooldownExceeded,true);assert.deepEqual(r.cooldownRecovery,failure.cooldownRecovery);assert.match(r.error,/Shopify stock fetch failed: HTTP 503/);
});
