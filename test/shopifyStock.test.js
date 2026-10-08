'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {mergeShopifyStock,fetchShopifyProductJson}=require('../src/shopifyProduct');
const log=new Proxy({},{get:()=>()=>{}});
test('Ajax stock is joined by product/variant identity and never changes decimal JSON prices',()=>{
 const product={id:1,variants:[{id:11,price:'1200'},{id:12,price:'2200'}]};
 const merged=mergeShopifyStock(product,{id:1,variants:[{id:12,available:false,price:220000},{id:11,available:true,price:120000}]});
 assert.equal(merged.variants[0].available,true);assert.equal(merged.variants[1].available,false);assert.equal(merged.variants[0].price,'1200');assert.equal(merged._variants_complete,true);assert.equal(product.variants[0].available,undefined);
 const foreign=mergeShopifyStock(product,{id:2,variants:[{id:11,available:true}]});assert.equal(foreign.variants[0].available,undefined);assert.equal(foreign._variants_complete,false);
});
test('missing/capped/incomplete Ajax inventories never authorize retirement of unseen variants',()=>{
 const product={id:1,variants:[{id:11,price:'12.00'}]};
 for(const ajax of [null,{id:1,variants:[{id:11},{id:12}]},{id:1,variants:Array.from({length:250},(_,i)=>({id:i,available:true}))}])assert.equal(mergeShopifyStock(product,ajax)._variants_complete,false);
});
test('crawler transport fetches locale-preserving Ajax once and records original stock source',async()=>{
 const urls=[];const r=await fetchShopifyProductJson('https://shop.test/de/products/coffee',log,{fetchJson:async url=>{urls.push(url);return {success:true,data:url.endsWith('.json')?{product:{id:1,title:'Coffee',variants:[{id:11,title:'250g',price:'12.00'}]}}:{id:1,variants:[{id:11,available:false,price:1200}]}};}});
 assert.deepEqual(urls,['https://shop.test/de/products/coffee.json','https://shop.test/de/products/coffee.js']);assert.equal(r.raw.variants[0].available,false);assert.equal(r.data.variants[0].price,'12.00');assert.equal(r.data.variants[0].availabilitySource,'shopify_ajax_product_js');assert.equal(r.data.variantsComplete,true);
});
