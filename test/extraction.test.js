'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ATTRIBUTES,extractPage,CACHE_TTL_MS}=require('../src/extraction');
const {parseShopifyProduct}=require('../src/shopifyProduct');
const now=Date.parse('2026-10-06T14:00:00Z'),url='https://shop.test/products/coffee',model='fixture-model';
function page({price='12',stock='InStock',description='Coffee from Ethiopia',extra=''}={}) {
  const values={country_of_origin:'Ethiopia',process:'Washed',varietal:'Heirloom',flavor_notes:['Blueberries','Cotton Candy'],is_decaf:false};
  const schema={'@type':'Product',url,name:'COFFEE',category:'coffee',description,additionalProperty:ATTRIBUTES.filter(k=>k!=='product_image_url').map(k=>({name:k,value:values[k]??null})),offers:{price,priceCurrency:'EUR',availability:'https://schema.org/'+stock}};
  return {url,finalUrl:url,html:`<main><h1>COFFEE</h1><p>${description}</p>${extra}</main><script type="application/ld+json">${JSON.stringify(schema)}</script>`,content:description,status:200,success:true};
}
test('complete source attribute contract skips AI while retaining all fields and uncertainty',async()=>{
  let calls=0;const r=await extractPage({page:page(),classify:async()=>{calls++;throw Error('unexpected AI')},model,now});
  assert.equal(calls,0);assert.equal(r.aiCalls,0);assert.equal(r.mode,'structured');
  for(const attr of ATTRIBUTES.filter(k=>k!=='product_image_url')) assert(Object.hasOwn(r.data.product.attributes,attr));
  assert.deepEqual(r.data.product.attributes.flavor_notes,['Blueberries','Cotton Candy']);
});
test('fresh price/stock overlays preserve cached semantics; content/version/model/TTL invalidates cache',async()=>{
  const classify=async()=>({data:{is_coffee_page:true,product:{name:'COFFEE',attributes:{producer:'Fixture producer'}}},usage:{prompt_tokens:42,completion_tokens:7},aiCalls:1});
  const initial=await extractPage({page:page(),classify,model,now});
  const changed=await extractPage({page:page({price:'13',stock:'OutOfStock'}),cache:initial.cache,classify,model,now:now+60000});
  assert.equal(changed.mode,'cache');assert.equal(changed.aiCalls,0);assert.equal(changed.data.product.variants[0].price,'13');assert.equal(changed.data.product.variants[0].availability,'sold_out');
  for(const spec of [{page:page({description:'Different coffee facts'}),now:now+60000},{page:page(),model:'new-model',now:now+60000},{page:page(),now:now+CACHE_TTL_MS},{page:page({extra:'<p>Producer: New Farm</p>'}),now:now+60000}]) {
    const r=await extractPage({page:page(),cache:initial.cache,classify,model,now,...spec});assert.notEqual(r.mode,'cache');
  }
  const old=structuredClone(initial.cache);old._extraction.version='old';assert.notEqual((await extractPage({page:page(),cache:old,classify,model,now})).mode,'cache');
});
test('partial structured data falls back to AI without losing full coffee attribute coverage',async()=>{
  const p=page();p.html=p.html.replace(/"additionalProperty":\[[\s\S]*?\],"offers"/, '"offers"');
  const attributes=Object.fromEntries(ATTRIBUTES.map(k=>[k,`source-${k}`]));
  const r=await extractPage({page:p,classify:async()=>({data:{is_coffee_page:true,product:{name:'Original',attributes}},usage:{prompt_tokens:50,completion_tokens:10},aiCalls:1}),model,now});
  assert.equal(r.mode,'ai');assert.equal(r.aiCalls,1);assert.equal(r.usage.prompt_tokens,50);
  for(const k of ATTRIBUTES.filter(k=>k!=='description')) assert.equal(r.data.product.attributes[k],attributes[k]);
  assert.equal(r.data.product.name,'COFFEE');assert.equal(r.data.product.variants[0].currency,'EUR');
});
test('native Shopify data preserves exact IDs/stock/weights and never defaults currency',async()=>{
  const native={id:123,title:'Coffee',product_type:'Coffee',body_html:'<p>Coffee beans</p>',variants:[{id:456,title:'250g / espresso',price:'12.00',grams:250},{id:457,title:'250g / beans',price:'12.00',grams:250,available:false}],tags:['Coffee']};
  const parsed=parseShopifyProduct(native);assert.equal(parsed.id,'123');assert.equal(parsed.currency,null);assert.equal(parsed.variants[0].available,undefined);
  const p={url,html:'<h1>Coffee</h1>',content:'Coffee',status:200};
  const r=await extractPage({page:p,shopifyJson:{success:true,data:parsed,raw:native},classify:async()=>({data:{is_coffee_page:true,product:{name:'Coffee',variant_price_currency:null,attributes:{producer:'Farm'}}}}),model,now});
  assert.equal(r.data.product.variants.length,2);assert.equal(r.data.product.variants[0].source_id,'456');assert.equal(r.data.product.variant_price_currency,null);assert.equal(r.data.product.attributes.producer,'Farm');
});
test('malformed/error responses are never cached as irrelevant products',async()=>{
  for(const response of [{data:{}},{error:'quota',quotaExceeded:true,aiCalls:2}]) {
    const r=await extractPage({page:{url,html:'<p>Unknown</p>',content:'Unknown'},classify:async()=>response,model,now});assert(r.error);assert.equal(r.cache,undefined);
  }
});
test('retried requests without usage remain explicitly unreported even when final response reports tokens',()=>{
  const {addExtractionMetrics,extractionMetrics}=require('../src/pageVisitor');
  const metrics=extractionMetrics();
  addExtractionMetrics(metrics,{aiCalls:3,usage:{prompt_tokens:50,completion_tokens:10}});
  assert.equal(metrics.aiCalls,3);assert.equal(metrics.aiUsage.unreported_calls,2);assert.equal(metrics.aiUsage.prompt_tokens,50);
});
