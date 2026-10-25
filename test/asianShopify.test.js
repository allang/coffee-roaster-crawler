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
