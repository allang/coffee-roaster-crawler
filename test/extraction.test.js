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

test('AI fallback cannot invent native product/variant identities or complete inventory evidence',async()=>{
 const r=await extractPage({page:{url,html:'<p>Coffee</p>',content:'Coffee'},classify:async()=>({data:{is_coffee_page:true,product:{name:'Coffee',source_product_id:'invented',variants_complete:true,variants:[{id:'fake',source_id:'fake',title:'250g',price:'12',currency:'EUR'}]}}}),model,now});
 assert.equal(r.data.product.source_product_id,null);assert.equal(r.data.product.variants[0].source_id,null);assert.equal(r.data.product.variants_complete,false);
});

test('unpaired native numeric prices never borrow currency from page offers or inferred classification',async()=>{
 const {normalizeProduct}=require('../src/catalogNormalization'),native={id:1,title:'Coffee',currency:null,variants:[{id:'11',title:'250g',price:'24.00',sku:'native-sku'}]};
 const result=await extractPage({page:page({price:'18.00'}),shopifyJson:{success:true,data:native},classify:async()=>({data:{is_coffee_page:true,product:{name:'Coffee',variant_price_currency:'USD'}}}),model,now});
 const v=normalizeProduct(result.data.product,url).variants[0];assert.equal(v.price,'24.00');assert.equal(v.money.currency,null);assert.equal(v.money.minorUnits,null);
 const {mergeGptAndJsonData}=require('../src/shopifyProduct');assert.equal(mergeGptAndJsonData({variant_price_currency:'GBP'}, {success:true,data:native}).variants[0].currency,null);
});
test('exact native-variant JSON-LD offer preserves its own amount/currency and conflicting offers remain unknown',()=>{
 const {structuredExtraction}=require('../src/extraction'),{normalizeProduct}=require('../src/catalogNormalization');
 const native={id:1,title:'Coffee',variants:[{id:'11',title:'250g',price:'24.00',sku:'sku-11'},{id:'12',title:'500g',price:'40.00',sku:'sku-12'}]};
 const make=offers=>({url,html:`<script type="application/ld+json">${JSON.stringify({'@type':'Product',url,name:'Coffee',offers})}</script>`});
 const offer={url:url+'?variant=11',sku:'sku-11',price:'18.00',priceCurrency:'EUR'};
 let p=structuredExtraction(make([offer]),{success:true,data:native}).product,v=normalizeProduct(p,url).variants;
 assert.equal(v[0].source_id,'11');assert.equal(v[0].money.minorUnits,1800);assert.equal(v[0].money.currency,'EUR');assert.equal(v[0].price_source,'jsonld_exact_variant_offer');assert.equal(v[1].money.currency,null);
 p=structuredExtraction(make([offer,{...offer,price:'19',priceCurrency:'GBP'}]),{success:true,data:native}).product;assert.equal(normalizeProduct(p,url).variants[0].money.currency,null);
});
test('explicit unknown variant currency does not inherit another offer currency while legacy bulk pairs still work',()=>{
 const {normalizeProduct}=require('../src/catalogNormalization');const p=normalizeProduct({name:'Coffee',variant_price_currency:'EUR',variants:[{title:'unknown',price:'12',currency:null},{title:'legacy',price:'12'}]},url);
 assert.equal(p.variants[0].money.currency,null);assert.equal(p.variants[0].money.minorUnits,null);assert.equal(p.variants[1].money.minorUnits,1200);
});

test('JSON-LD selector identity is product-scoped and conflicting duplicate offers remain rejected',()=>{
 const {structuredExtraction}=require('../src/extraction'),{catalogPayload}=require('../src/productSaver');
 const make=offers=>({url,html:`<script type="application/ld+json">${JSON.stringify({'@type':'Product',url,name:'Coffee',offers})}</script>`});
 const offer={url:url+'?variant=11',price:18,priceCurrency:'NZD'};
 const p=structuredExtraction(make([offer,{...offer,url:'https://other.test/products/coffee?variant=99'}]),null).product;
 assert.deepEqual(p.variants.map(v=>v.source_id),['11']);
 assert.equal(structuredExtraction(make([{...offer,sku:'sku-11'}]),null).product.variants[0].source_id,'sku-11');
 assert.equal(structuredExtraction(make([{...offer,'@id':'offer-11'}]),null).product.variants[0].source_id,'offer-11');
 const ambiguous=structuredExtraction(make([{...offer,url:url+'?variant=11&variant=12'}]),null).product;
 assert.equal(ambiguous.variants[0].source_id,null);
 const conflict=structuredExtraction(make([offer,{...offer,price:19,priceCurrency:'USD'}]),null).product;
 assert.throws(()=>catalogPayload('11111111-1111-4111-8111-111111111111',conflict,url,null,null,new Date().toISOString()),/Duplicate source variant identity/);
});
