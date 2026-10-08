'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseShopifyProduct,explicitCoffeeWeight}=require('../src/shopifyProduct');
const {structuredExtraction}=require('../src/extraction');
const {normalizeProduct}=require('../src/catalogNormalization');
const {profileFor,discoverProfileProducts}=require('../src/siteSupport/discovery');
const profiles=require('../src/siteSupport/profiles.json');
const {discoverShopifyProducts,retailCoffee}=require('../src/siteSupport/shopifyDiscovery');
const {fetchShopifyProductJson,labelWeight,mergeShopifyStock}=require('../src/shopifyProduct');
const {productAvailability}=require('../src/productEvidence');
const {catalogPayload}=require('../src/productSaver');

test('captured Apiary exact variant price and explicit coffee weight override shipping mass',()=>{
  const f=require('./fixtures/siteSupport/apiary-product.json');
  const native=parseShopifyProduct(f.product,{preferLabelWeight:true,singleVariantDescriptionWeight:true});
  const html='<script>window.ShopifyAnalytics.meta.currency = '+JSON.stringify(f.analytics_currency)+'; var meta = '+JSON.stringify({product:f.analytics_product})+';</script>';
  const p=normalizeProduct(structuredExtraction({html,url:f.url},{success:true,data:native}).product,f.url);
  assert.equal(p.source_product_id,String(f.product.id));assert.equal(p.variants[0].source_id,String(f.product.variants[0].id));
  assert.equal(p.variants[0].money.minorUnits,2700);assert.equal(p.variants[0].money.currency,'USD');assert.equal(p.variants[0].money.exponent,2);
  assert.equal(p.variants[0].weight_g,250);assert.equal(native.variants[0].shippingWeightGrams,264);
  assert.equal(explicitCoffeeWeight('<p>100g Whole Bean Coffee</p>'),100);
  for(const h of ['<p>Shipping weight: 264g</p>','<p>2 x 250g Whole Bean Coffee</p>','<p>250g Whole Bean Coffee</p><p>100g Whole Bean Coffee</p>','<p>Our recipe uses 20g coffee.</p>'])assert.equal(explicitCoffeeWeight(h),null);
  const multi={...f.product,variants:[...f.product.variants,{...f.product.variants[0],id:2}]};
  assert(parseShopifyProduct(multi,{preferLabelWeight:true,singleVariantDescriptionWeight:true}).variants.every(v=>v.weightGrams===null));
});

test('captured Passport accessory variant cannot set coffee minimum price, weight or availability',async()=>{
  const f=require('./fixtures/siteSupport/passport-product.json'),noop={info(){},warn(){}};
  const fetchJson=async url=>({success:true,data:url.endsWith('.js')?f.ajax:{product:f.product}});
  const native=await fetchShopifyProductJson(f.url,noop,{fetchJson});
  assert.deepEqual(native.data.variants.map(v=>v.id),f.product.variants.slice(0,3).map(v=>String(v.id)));
  assert.deepEqual(native.data.variants.map(v=>v.weightGrams),[100,250,1000]);assert.equal(native.data.variantsComplete,false);
  const html='<script>window.ShopifyAnalytics.meta.currency = '+JSON.stringify(f.analytics_currency)+'; var meta = '+JSON.stringify({product:f.analytics_product})+';</script>';
  const p=normalizeProduct(structuredExtraction({html,url:f.url},native).product,f.url);
  assert.deepEqual(p.variants.map(v=>v.money.minorUnits),[3000,5700,20300]);assert(p.variants.every(v=>v.money.currency==='AUD'));
  const ajax=structuredClone(f.ajax);ajax.variants.slice(0,3).forEach(v=>v.available=false);
  const sold=await fetchShopifyProductJson(f.url,noop,{fetchJson:async url=>({success:true,data:url.endsWith('.js')?ajax:{product:f.product}})});
  assert.equal(productAvailability({shopifyProduct:sold.raw,sourceUrl:f.url}).state,'sold_out');
  assert.equal(labelWeight('250gm'),250);assert.equal(labelWeight('4 x 20gm'),null);
  assert.equal(labelWeight('200gm (10x20gm vac seal pouch)'),200);assert.equal(labelWeight('200gm (10x25gm vac seal pouch)'),null);
  assert.equal(retailCoffee({id:1,title:'Filter Coffee Server',product_type:'Filter Coffee Server'},profiles.find(p=>p.name==='Passport')),false);
  assert.equal(retailCoffee({id:2,title:'Gift Voucher - Online Shop Only',product_type:'Coffee'},profiles.find(p=>p.name==='Passport')),false);
});

test('featured coffee outside collections requires exact native identity and reviewed path',async()=>{
  const roaster={website_url:'https://shop.test'},profile={hosts:['shop.test'],listing_paths:['/collections/coffee/products.json'],additional_product_paths:['/products/advent'],coffee_product_types:['Coffee'],exclude_product_ids:['2']};
  const product={id:1,title:'Advent Coffee',handle:'advent',product_type:'Coffee'};
  const read=async url=>({success:true,finalUrl:url,data:JSON.stringify(url.endsWith('.json')?{product}:{products:[]})});
  const result=await discoverShopifyProducts(roaster,profile,read);
  assert.equal(result.complete,true);assert.deepEqual(result.urls,['https://shop.test/products/advent']);
  assert.equal(retailCoffee({...product,id:2},profile),false);
  const mismatch=await discoverShopifyProducts(roaster,profile,async url=>({success:true,finalUrl:url,data:JSON.stringify(url.endsWith('.json')?{product:{...product,handle:'other'}}:{products:[]})}));
  assert.equal(mismatch.complete,false);assert.match(mismatch.error,/identity/);
  const legal=await discoverShopifyProducts(roaster,{...profile,additional_product_paths:['/terms']},read);
  assert.equal(legal.complete,false);assert.match(legal.error,/Unreviewed/);
});

test('unresolved reviewed merchants can be inspected without registering invented database owners',async()=>{
  const profile=profiles.find(p=>p.name==='Apiary'),roaster={website_url:'https://apiary.coffee'};
  assert.equal(profileFor(roaster),null);assert.equal(profileFor({...roaster,id:'unreviewed-id'}),null);
  const f=require('./fixtures/siteSupport/apiary-product.json'),seen=[];
  const result=await discoverProfileProducts(roaster,profile,async url=>{seen.push(url);return {success:true,finalUrl:url,data:JSON.stringify({products:seen.length===1?[f.product]:[]})};});
  assert.equal(result.complete,true);assert.deepEqual(result.urls,[f.url]);
  await assert.rejects(discoverProfileProducts(roaster,{...profile},async()=>{}),/Unreviewed/);
});

test('captured Onyx Advent primary preorder overrides Ajax sellability while preserving exact market identity',async()=>{
  const f=require('./fixtures/siteSupport/onyx-advent-preorder.json'),noop={info(){},warn(){}};
  assert.equal(Object.hasOwn(f.product.variants[0],'available'),false);assert.equal(f.ajax.variants[0].available,true);
  const native=await fetchShopifyProductJson(f.url,noop,{fetchJson:async url=>({success:true,data:url.endsWith('.js')?f.ajax:{product:f.product}})});
  const html=f.primary_html+f.global_banner_html+'<script>window.ShopifyAnalytics.meta.currency = '+JSON.stringify(f.analytics_currency)+'; var meta = '+JSON.stringify({product:f.analytics_product})+';</script>';
  const availability=productAvailability({html,status:200,sourceUrl:f.url,shopifyProduct:native.raw});
  assert.equal(availability.state,'unknown');assert.equal(availability.isAvailable,null);assert.equal(availability.reason,'primary_product_preorder');
  assert.equal(availability.variants[0].source_id,'43221087649890');assert.equal(availability.variants[0].state,'unknown');
  assert.equal(availability.variants[0].evidence[0].available,true);assert.equal(availability.variants[0].evidence[1].text,'Pre-Order Now');
  const source=structuredExtraction({html,url:f.url},native).product,p=normalizeProduct(source,f.url);
  assert.equal(p.source_product_id,'7773746823266');assert.equal(p.variants[0].source_id,'43221087649890');
  assert.equal(p.variants[0].money.minorUnits,18900);assert.equal(p.variants[0].money.currency,'USD');assert.equal(p.variants[0].availability,'unknown');
  const saved=catalogPayload('b765bee5-9622-4735-a948-7816736da3e5',source,f.url,{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',slug:'keep-advent-slug'},availability,new Date().toISOString());
  assert.equal(saved.product.id,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');assert.equal(saved.product.slug,'keep-advent-slug');
  assert.equal(saved.product.availability_state,'unknown');assert.equal(saved.variants[0].availability_state,'unknown');assert.equal(saved.variants[0].price_minor_units,18900);
});

test('Onyx preorder controls are scoped to exact product/variant and never inferred from global banners or shipping dates',()=>{
  const f=require('./fixtures/siteSupport/onyx-advent-preorder.json'),raw={...f.product,variants:f.product.variants.map((v,i)=>({...v,...f.ajax.variants[i]}))};
  const url='https://onyxcoffeelab.com/products/monarch',other={id:'4478727356514',handle:'monarch',variants:[{id:'31891529547874',available:true}]};
  const otherPage='<link rel="canonical" href="'+url+'">'+f.global_banner_html+'<main><h1>Monarch</h1><button>Add to Cart</button></main>';
  assert.equal(productAvailability({html:otherPage,sourceUrl:url,shopifyProduct:other}).state,'in_stock');
  const ordinary=f.primary_html.replace('Pre-Order Now','Shop Now')+'<p>Shipping begins November 2026.</p>'+f.global_banner_html;
  assert.equal(productAvailability({html:ordinary,sourceUrl:f.url,shopifyProduct:raw}).state,'in_stock');
  for(const html of [f.primary_html.replace('data-variant-id="43221087649890"','data-variant-id="999"'),f.primary_html.replace('<main>','<main><button class="atc" data-variant-id="43221087649890">Add to Cart</button>')])assert.throws(()=>productAvailability({html,sourceUrl:f.url,shopifyProduct:raw}),/variant binding/);
  assert.throws(()=>productAvailability({html:f.primary_html,sourceUrl:f.url,shopifyProduct:{...raw,id:'another-product'}}),/identity mismatch/);
});

test('captured Onyx explicit native preorder tag overrides sellability; a shipping-date tag alone does not',()=>{
  const f=require('./fixtures/siteSupport/onyx-jijon-preorder.json'),raw=mergeShopifyStock(f.product,f.ajax);
  const result=productAvailability({sourceUrl:f.url,shopifyProduct:raw});
  assert.equal(result.state,'unknown');assert(result.variants.every(v=>v.state==='unknown'));
  assert.deepEqual(result.variants.map(v=>v.source_id),f.product.variants.map(v=>String(v.id)));
  assert.equal(result.variants[0].evidence[1].source,'shopify_product_preorder_tag');
  const ordinary={...raw,tags:raw.tags.split(/,\s*/).filter(t=>!/^preorder$/i.test(t))};
  assert(ordinary.tags.some(t=>t.startsWith('preorder-ship-date:')));
  assert.equal(productAvailability({sourceUrl:f.url,shopifyProduct:ordinary}).state,'in_stock');
  assert.equal(productAvailability({sourceUrl:f.url,shopifyProduct:{...ordinary,tags:['Not a preorder','preorder-ship-date:2099-01-01']}}).state,'in_stock');
});
