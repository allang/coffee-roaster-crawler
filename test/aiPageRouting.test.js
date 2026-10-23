'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {urlRoute,pageRoute,pageOrder}=require('../src/aiPageRouting');
const {visitAndClassifyPage,processFetchedPage,addExtractionMetrics,extractionMetrics}=require('../src/pageVisitor');
const log=new Proxy({},{get:()=>()=>{}}),base='https://merchant.test';
test('obvious non-product URLs never fetch, call AI or write the database',async()=>{
 for(const path of ['/blogs/news/new-coffee','/en/pages/contact','/policies/refund-policy','/cart','/search?q=coffee','/agents.md','/catalog.pdf','/products/catalog.pdf','/%70rivacy-policy']){
  const url=base+path;assert.equal(urlRoute(url).skip,true,path);
  const result=await visitAndClassifyPage('owner',url,{markVisited(){}},log);
  assert.equal(result.aiCalls,0);assert.equal(result.aiSkipped,true);assert.equal(result.classified,false);
 }
});
test('listing/home pages are discovery-only and related coffee cards do not establish a primary product',async()=>{
 for(const path of ['/','/en','/collections/all','/collections/エチオピア','/shop','/coffee']){
  const url=base+path,html='<h1>Our coffees</h1><a href="/products/a">Coffee A</a><a href="/products/b">Coffee B</a><aside><form action="/cart/add">Other product</form></aside>';
  const route=pageRoute({url,html});assert.equal(route.skip,true,path);
  const result=await processFetchedPage('owner',url,{success:true,status:200,html},log);
  assert.equal(result.aiCalls,0);assert.equal(result.isCoffee,false);
 }
});
test('native/primary product evidence and uncertain custom product URLs retain extraction coverage',()=>{
 for(const path of ['/products/about-the-natural','/collections/news/products/coffee','/shop/p/coffee','/store/p/coffee','/kava/filtr/ethiopia','/boutique/elto','/shop/coffee','/shop_view/?idx=10'])assert.equal(urlRoute(base+path).skip,false,path);
 assert.equal(pageRoute({url:base+'/collections/seasoning-beans',sourceProduct:{name:'Seasoning coffee',url:base+'/collections/seasoning-beans'},html:''}).skip,false);
 assert.equal(pageRoute({url:base+'/',html:'<main><h1>Our coffee</h1><form action="/cart/add"><input name="id" value="1"></form></main>'}).skip,false);
 assert.equal(pageRoute({url:base+'/boutique/ethiopia',html:'<h1>Ethiopia coffee</h1><p>Washed, 250g, 20 EUR.</p>'}).category,'ambiguous_product_candidate');
 for(const type of ['Equipment','Merchandise','Apparel','Gift Card'])assert.equal(pageRoute({url:base+'/products/item',native:{title:'Store item',productType:type},html:''}).category,'non_coffee_product');
 assert.equal(pageRoute({url:base+'/products/coffee-gift',native:{title:'Coffee Gift Set',productType:'Coffee'},html:''}).skip,false);
});
test('fresh HTML gating also rejects cached false positives and reports calls separately by page category and purpose',async()=>{
 const result=await processFetchedPage('owner',base+'/collections/coffee',{success:true,status:200,html:'<h1>Coffees</h1>'},log,'unknown',{knownPage:{status:'coffee',classification:{is_coffee_page:true,product:{name:'False coffee'}}}});
 assert.equal(result.aiSkipped,true);assert.equal(result.pageCategory,'listing');
 const metrics=extractionMetrics();addExtractionMetrics(metrics,result);addExtractionMetrics(metrics,{aiCalls:3,extractionCalls:2,translationCalls:1,pageCategory:'product_candidate'});
 assert.equal(metrics.aiSkipped,1);assert.equal(metrics.extractionCalls,2);assert.equal(metrics.translationCalls,1);assert.deepEqual(metrics.aiCallsByCategory,{listing:0,product_candidate:3});
});
test('explicit article, FAQ and list markup is skipped even on unfamiliar URL paths',()=>{
 for(const [type,category] of [['Article','editorial'],['FAQPage','information'],['ItemList','listing']]){
  const html='<h1>Coffee information</h1><script type="application/ld+json">'+JSON.stringify({'@context':'https://schema.org','@type':type})+'</script>';
  assert.deepEqual(pageRoute({url:base+'/read/custom-entry',html}),{category,skip:true});
 }
 assert.equal(pageRoute({url:base+'/shop/merch',html:'<h1>Our shop</h1><div data-controller="ProductList"><a href="/shop/p/a">Coffee A</a></div>'}).category,'listing');
});
test('later batches prioritize never-fetched pages then the oldest observation without reshuffling equal priorities',()=>{
 const known=new Map([['newer',{last_fetched_at:'2026-10-23T00:00:00Z'}],['older',{last_fetched_at:'2026-10-21T00:00:00Z'}]]);
 assert.deepEqual(['newer','unknown-b','older','unknown-a'].sort(pageOrder(known)),['unknown-b','unknown-a','older','newer']);
});
