'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseShopifyProduct,explicitCoffeeWeight}=require('../src/shopifyProduct');
const {structuredExtraction}=require('../src/extraction');
const {normalizeProduct}=require('../src/catalogNormalization');
const {profileFor,discoverProfileProducts}=require('../src/siteSupport/discovery');
const profiles=require('../src/siteSupport/profiles.json');
const {discoverShopifyProducts,retailCoffee}=require('../src/siteSupport/shopifyDiscovery');
const {fetchShopifyProductJson,labelWeight}=require('../src/shopifyProduct');
const {productAvailability}=require('../src/productEvidence');

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
