'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validHandle,discoverShopifyProducts}=require('../src/siteSupport/shopifyDiscovery');
const {profileFor}=require('../src/siteSupport/discovery');
const profiles=require('../src/siteSupport/profiles.json');
const kielo=profiles.find(p=>p.name==='KIELO COFFEE'),x=profiles.find(p=>p.name==='X coffee GINZA');
test('Unicode handles are opt-in and cannot introduce URL paths, queries or escaped separators',()=>{
 for(const value of ['バリスタにおまかせセット','colombia-sudus-la-molienda-コピー']){assert.equal(validHandle(value,kielo),true);assert.equal(validHandle(value,{}),false);}
 for(const value of ['../products','a/b','a%2fb','a?variant=1','a#fragment','a\\b','//foreign.test','a.b',''])assert.equal(validHandle(value,kielo),false);
 assert.equal(validHandle('coffee-250g',{}),true);
});
test('sister-brand registration selects the exact owner and its own coffee collection',async()=>{
 const outputs=[];
 for(const [profile,id,handle]of [[kielo,101,'バリスタにおまかせセット'],[x,202,'colombia-コピー']]){
  const roaster={id:profile.entity_ids[0],website_url:profile.bootstrap_url};assert.equal(profileFor(roaster),profile);
  const requests=[];
  const result=await discoverShopifyProducts(roaster,profile,async value=>{const url=new URL(value);requests.push(url);return {success:true,finalUrl:value,data:JSON.stringify({products:url.searchParams.get('page')==='1'?[{id,handle,title:'Roasted coffee',product_type:''},{id:id+1,handle:'subscription',title:'コーヒー定期便',product_type:''}]:[]})};});
  assert.equal(result.complete,true);assert.equal(result.urls.length,1);assert.equal(decodeURIComponent(new URL(result.urls[0]).pathname),'/products/'+handle);
  assert(requests.every(u=>u.pathname===profile.listing_paths[0]));assert.equal(requests.length,2);assert.equal(result.inventory_authorizes_global_absence,false);outputs.push(result.urls[0]);
 }
 assert.notEqual(outputs[0],outputs[1]);
 assert.equal(profileFor({id:'unreviewed-owner',website_url:kielo.bootstrap_url}),null);
});
test('captured KIELO and X collections retain all one-time coffee identities including Japanese handles',async()=>{
 const fixture=require('./fixtures/siteSupport/kielo-collections.json'),results=[];
 for(const [profile,key,expected]of [[kielo,'kielo-coffee',15],[x,'about-us-collection',17]]){
  const result=await discoverShopifyProducts({id:profile.entity_ids[0],website_url:profile.bootstrap_url},profile,async value=>({success:true,finalUrl:value,data:JSON.stringify({products:new URL(value).searchParams.get('page')==='1'?fixture.collections[key]:[]})}));
  assert.equal(result.complete,true);assert.equal(result.urls.length,expected);assert.equal(result.inventory_authorizes_global_absence,false);
  const handles=result.urls.map(u=>decodeURIComponent(new URL(u).pathname.split('/').at(-1)));
  assert(!handles.some(h=>/定期便/.test(h)));assert(handles.some(h=>/[^\x00-\x7f]/.test(h)));results.push(result.urls);
 }
 assert.equal(results[0].filter(u=>results[1].includes(u)).length,0);
});
test('Ariowl admits only its reviewed symbol handle without changing other profiles',()=>{
 const profile=profiles.find(p=>p.name==='Ariowl Coffee'),handle='\u{1f389}-happy-mix-scaj-2026-special-edition';
 assert.equal(validHandle(handle,profile),true);assert.equal(validHandle(handle,kielo),false);assert.equal(validHandle('\u{1f389}-another-coffee',profile),false);
 for(const bad of ['\u{1f389}/coffee','\u{1f389}%2fcoffee','\u{1f389}?variant=1','\u{1f389}#coffee','\u{1f389}.coffee','\u{1f389}\\coffee'])assert.equal(validHandle(bad,{allow_unicode_handles:true,reviewed_symbol_handles:[bad]}),false);
});
test('captured Ariowl and Roastery101 inventories retain native coffees and exclude subscription/equipment types',async()=>{
 const fixture=require('./fixtures/siteSupport/more-asian-shopify.json');
 for(const [name,key,count]of [['Ariowl Coffee','ariowl',23],['COFFEE ROASTERY 101','roastery101',13]]){
  const profile=profiles.find(p=>p.name===name),native=fixture.sites[key].products;
  const result=await discoverShopifyProducts({id:profile.entity_ids[0],website_url:profile.bootstrap_url},profile,async value=>({success:true,finalUrl:value,data:JSON.stringify({products:new URL(value).searchParams.get('page')==='1'?native:[]})}));
  assert.equal(result.complete,true);assert.equal(result.urls.length,count);assert.equal(result.inventory_authorizes_global_absence,false);
  const kept=result.urls.map(url=>decodeURIComponent(new URL(url).pathname.split('/').at(-1)));
  const excluded=native.filter(p=>!kept.includes(p.handle));
  assert(excluded.some(p=>/Subscription|\u5b9a\u671f\u4fbf/.test(p.title)));
  if(key==='roastery101')assert.equal(excluded.filter(p=>p.product_type==='\u30b3\u30fc\u30d2\u30fc\u5668\u5177').length,7);
  assert.equal(profileFor({id:profile.entity_ids[0],website_url:profile.bootstrap_url}),profile);
  assert.equal(profileFor({id:'unreviewed-owner',website_url:profile.bootstrap_url}),null);
 }
});
test('Ariowl uses the labeled 15g size without borrowing its 100g shipping weight',()=>{
 const {parseShopifyProduct}=require('../src/shopifyProduct'),profile=profiles.find(p=>p.name==='Ariowl Coffee');
 const raw=require('./fixtures/siteSupport/more-asian-shopify.json').sites.ariowl.products.find(p=>p.id===15416498389305);
 const parsed=parseShopifyProduct(raw,{preferLabelWeight:true,variantSizePatterns:profile.variant_size_patterns});
 assert.equal(parsed.variants[0].weightGrams,15);assert.equal(parsed.variants[0].shippingWeightGrams,100);
 const pack=require('./fixtures/siteSupport/more-asian-shopify.json').sites.ariowl.products.find(p=>p.id===10258866503993);
 assert(profile.ambiguous_net_weight_handles.includes(pack.handle));
 assert(parseShopifyProduct(pack,{preferLabelWeight:true,variantSizePatterns:profile.variant_size_patterns,netWeightUnproven:true}).variants.every(v=>v.weightGrams===null));
 const selection=require('./fixtures/siteSupport/more-asian-shopify.json').sites.ariowl.products.find(p=>p.id===10111426068793);
 assert.deepEqual(parseShopifyProduct(selection,{preferLabelWeight:true,variantSizePatterns:profile.variant_size_patterns}).variants.map(v=>v.weightGrams),[150,150,150,300,300,300]);
});
test('reviewed Japanese bag-title weights require the same native roast/grind option contract',()=>{
 const {parseShopifyProduct}=require('../src/shopifyProduct'),profile=profiles.find(p=>p.name==='COFFEE ROASTERY 101');
 const raw=require('./fixtures/siteSupport/more-asian-shopify.json').sites.roastery101.products.find(p=>p.id===7649964327156);
 const options={preferLabelWeight:true,titleNetWeightRule:profile.title_net_weight_rule};
 assert(parseShopifyProduct(raw,options).variants.every(v=>v.weightGrams===200));
 for(const mutate of [p=>p.options[0].name='Size',p=>p.options[0].values=['100g','200g'],p=>p.variants[0].option1='not a published choice',p=>p.title+='\u3010100g\u3011']){
  const changed=structuredClone(raw);mutate(changed);assert(parseShopifyProduct(changed,options).variants.every(v=>v.weightGrams===null));
 }
 assert(parseShopifyProduct(raw,{preferLabelWeight:true}).variants.every(v=>v.weightGrams===null));
});
