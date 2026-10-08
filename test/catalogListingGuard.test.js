'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fetchPageContent,processFetchedPage}=require('../src/pageVisitor');
const {labelWeight}=require('../src/shopifyProduct');
test('Squarespace listing and homepage coffee cards cannot become coffee products, including cached false positives',async()=>{
 for(const [url,markup] of [
  ['https://www.lucienne.coffee/shop/merch','<div data-controller="ProductList"><a href="/shop/p/coffee">El Encanto 200g $25</a></div>'],
  ['https://www.lucienne.coffee/','<div class="sqs-block-product"><a href="/shop/p/coffee">El Encanto 200g $25</a></div>'],
 ]){
  const html='<html><head><link rel="canonical" href="https://www.lucienne.coffee/shop"></head><body class="sqs-seven-one view-list">'+markup+'</body></html>';
  const p=await fetchPageContent(url,null,{fetchHtml:async()=>({success:true,status:200,finalUrl:url,data:html})});
  assert.equal(p.nonProductReason,'catalog_listing_without_primary_product');assert(p.html.includes('/shop/p/coffee'));
  const r=await processFetchedPage('owner',url,p,null,'unknown',{knownPage:{classification:{is_coffee_page:true,product:{name:'El Encanto'}}}});
  assert.equal(r.isCoffee,false);assert.equal(r.aiCalls,0);assert.equal(r.classified,false);
 }
});
test('Squarespace native product articles and exact primary schema survive listing guard',async()=>{
 const url='https://www.lucienne.coffee/shop/p/coffee';
 for(const body of [
  '<article data-item-id="123"><h1 class="product-title">Coffee</h1></article><aside class="recommendations"><div data-controller="ProductList">Other coffee</div></aside>',
  '<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'Coffee',url,productID:'123'})+'</script>',
 ]){
  const p=await fetchPageContent(url,null,{fetchHtml:async()=>({success:true,status:200,finalUrl:url,data:'<body class="sqs-seven-one view-item">'+body+'</body>'})});assert.equal(p.nonProductReason,null);
 }
 const ordinary=await fetchPageContent('https://merchant.test/coffee',null,{fetchHtml:async()=>({success:true,status:200,data:'<h1>Coffee</h1>'})});assert.equal(ordinary.nonProductReason,null);
});
test('merchant KILO bag labels prove net kilograms independently of grind, without borrowing shipping mass',()=>{
 for(const label of ['2 KILO / Whole Bean','2 kilo / Drip/Pour Over','2 kilos / French Press'])assert.equal(labelWeight(label),2000);
 assert.equal(labelWeight('0.5 kilo'),500);assert.equal(labelWeight('Default Title'),null);
});
