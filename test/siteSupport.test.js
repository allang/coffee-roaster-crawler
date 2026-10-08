'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {headlessShopifyProduct,flightObjects,isCoffee}=require('../src/siteSupport/headlessShopify');
const {discoverSiteProducts}=require('../src/siteSupport/discovery');
const {allowed}=require('../src/siteSupport/network');
const {structuredExtraction}=require('../src/extraction');
const {productAvailability}=require('../src/productEvidence');
const {canonicalProductUrl,normalizeProduct}=require('../src/catalogNormalization');
const {catalogDb,supabaseAdapter}=require('./catalogDb');
const {catalogPayload,findExistingProduct}=require('../src/productSaver');
const {discoverShopifyProducts}=require('../src/siteSupport/shopifyDiscovery');
const {fetchSquareProduct,bootstrap}=require('../src/siteSupport/square');
const {createReader}=require('../src/siteSupport/network');
const html=fs.readFileSync(path.join(__dirname,'fixtures/siteSupport/april-product-flight.html'),'utf8');
const url='https://www.aprilcoffeeroasters.com/product/gesha-village-ethiopia-natural-geisha-oma-142';
const owner='3a71024e-eb30-4778-927b-580e3bc3b62e';
function flight(value){return '<script>self.__next_f.push('+JSON.stringify([1,'10:'+JSON.stringify(value)+'\n'])+')</script>';}
test('captured April storefront resolves exact product, DKK prices, native variants, weights and stock without script execution',()=>{
  const source=headlessShopifyProduct(html,url);assert.equal(source.productID,'10948877353306');
  const extracted=structuredExtraction({html,url,finalUrl:url},null),product=normalizeProduct(extracted.product,url);
  assert.equal(product.variants.length,3);assert.deepEqual(product.variants.map(v=>v.money.currency),['DKK','DKK','DKK']);
  assert.deepEqual(product.variants.map(v=>v.money.minorUnits),[37500,59900,221800]);assert.deepEqual(product.variants.map(v=>v.weight_g),[125,250,1000]);
  assert.equal(productAvailability({html,status:200,sourceUrl:url}).state,'in_stock');
  assert.equal(headlessShopifyProduct(html,'https://www.aprilcoffeeroasters.com/product/another-coffee'),null);
  assert.equal(flightObjects('<script>self.__next_f.push((globalThis.PWNED=true,[1,"{}"]))</script>').length,0);assert.equal(globalThis.PWNED,undefined);
  assert.equal(headlessShopifyProduct(html+html,url),null);
});
test('headless inventory follows explicit cursors, includes coffee on later pages, excludes gear and refuses truncated/repeated cursors',async()=>{
  const coffee={id:'gid://shopify/Product/1',handle:'coffee',title:'Coffee',description:'Roasted Coffee Beans',tags:[]};
  const listing=flight(['$',null,null,{collection:'everything',initialProducts:[{...coffee,title:'Brewer + Coffee',handle:'bundle'}],initialPageInfo:{hasNextPage:true,endCursor:'next'}}]);
  const seen=[];const fetchHtml=async value=>{seen.push(value);return{success:true,data:seen.length===1?listing:JSON.stringify({products:[coffee],pageInfo:{hasNextPage:false,endCursor:null}}),finalUrl:value};};
  const result=await discoverSiteProducts({id:owner,website_url:'https://www.aprilcoffeeroasters.com'},{fetchHtml});
  assert.deepEqual(result.urls,['https://www.aprilcoffeeroasters.com/product/coffee']);assert.equal(result.complete,true);assert(seen[1].includes('/api/collections/products?collection=everything&cursor=next'));
  const repeated=await discoverSiteProducts({id:owner,website_url:'https://www.aprilcoffeeroasters.com'},{fetchHtml:async value=>({success:true,data:value.includes('/api/')?JSON.stringify({products:[coffee],pageInfo:{hasNextPage:true,endCursor:'next'}}):listing,finalUrl:value})});
  assert.equal(repeated.complete,false);assert.match(repeated.error,/cursor/);
  assert(!isCoffee({...coffee,title:'April E-Giftcard'}));assert(isCoffee({...coffee,description:'',tags:['April Coffee','Drip Pack']}));
});
test('storefront path migration adopts the old stable product ID and remains idempotent in the real catalog transaction',async()=>{
  const pg=await catalogDb();try{
    const existingId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',oldUrl=url.replace('/product/','/products/');
    await pg.query('insert into entities(id) values($1)',[owner]);await pg.query('insert into products(id,entity_id,slug,name,source_url) values($1,$2,$3,$4,$5)',[existingId,owner,'keep-existing-slug','Old April coffee',oldUrl]);
    assert.equal(canonicalProductUrl(url),canonicalProductUrl(oldUrl));
    const source=structuredExtraction({html,url,finalUrl:url},null).product,availability=productAvailability({html,status:200,sourceUrl:url});
    const db=supabaseAdapter(pg),existing=await findExistingProduct(db,owner,canonicalProductUrl(url),'unadopted-key');assert.equal(existing.id,existingId);
    const payload=catalogPayload(owner,source,url,existing,availability,new Date().toISOString());
    assert.equal(payload.product.source_url,url);assert.equal(payload.product.id,existingId);assert.equal(payload.product.slug,'keep-existing-slug');
    const first=(await pg.query('select save_catalog_product_v2($1::jsonb) result',[JSON.stringify(payload)])).rows[0].result;
    await pg.query('select save_catalog_product_v2($1::jsonb)',[JSON.stringify(payload)]);
    assert.equal((await pg.query('select count(*)::int n from products')).rows[0].n,1);assert.equal((await pg.query('select count(*)::int n from product_variants')).rows[0].n,3);
    assert.equal((await pg.query('select source_url from products')).rows[0].source_url,url);
  }finally{await pg.close();}
});
test('merchant reader rejects legal paths, credentials and owner redirects before requesting them',()=>{
  const hosts=['www.aprilcoffeeroasters.com'];
  for(const suffix of ['/terms','/%74erms','/TERMS/anything','/checkout','/account'])assert.throws(()=>allowed('https://www.aprilcoffeeroasters.com'+suffix,hosts),/Prohibited/);
  assert.throws(()=>allowed('https://other.test/product/a',hosts),/Unverified/);
  assert.throws(()=>allowed('https://key:secret@www.aprilcoffeeroasters.com/product/a',hosts),/Unverified/);
});
test('Shopify retail discovery refreshes coffee URLs, excludes wholesale/gifts and requires an empty final page',async()=>{
  const profile={hosts:['shop.test'],listing_paths:['/collections/coffee/products.json'],coffee_product_types:['Retail SO']};
  const products=[{id:1,title:'Single Origin',handle:'single',product_type:'Retail SO'},{id:2,title:'Gift Card',handle:'gift',product_type:'Retail SO'},{id:3,title:'Wholesale Coffee',handle:'wholesale',product_type:'Coffee'}];
  const requested=[];
  const result=await discoverShopifyProducts({website_url:'https://shop.test'},profile,async value=>{requested.push(value);return {success:true,finalUrl:value,data:JSON.stringify({products:requested.length===1?products:[]})};});
  assert.equal(requested.length,2);assert.deepEqual(result.urls,['https://shop.test/products/single']);assert.equal(result.complete,true);
  const loop=await discoverShopifyProducts({website_url:'https://shop.test'},profile,async value=>({success:true,finalUrl:value,data:JSON.stringify({products})}));
  assert.equal(loop.complete,false);assert.match(loop.error,/repeated/);
});
test('captured Coffee Project Square catalog resolves exact variants and never treats untracked zero inventory as sold out',async()=>{
  const fixture=require('./fixtures/siteSupport/coffee-project-square.json'),profile=require('../src/siteSupport/profiles.json').find(p=>p.adapter==='square');
  const html='<script>window.__BOOTSTRAP_STATE__ = '+JSON.stringify(fixture.context)+';</script>',url=fixture.product.absolute_site_link;
  const read=async value=>({success:true,data:JSON.stringify(value.includes('/skus?')?fixture.skus:{data:fixture.product})});
  const source=await fetchSquareProduct(html,url,profile,read),extracted=structuredExtraction({html:'',url,sourceProduct:source},null),product=normalizeProduct(extracted.product,url);
  assert.equal(product.variants.length,2);assert.deepEqual(product.variants.map(v=>v.money.currency),['USD','USD']);
  assert.deepEqual(product.variants.map(v=>v.money.minorUnits),[2950,1475]);assert.equal(product.variants_complete,true);
  assert.equal(productAvailability({sourceProduct:source,sourceUrl:url}).state,'in_stock');
  assert(product.variants.every(v=>fixture.skus.data.some(s=>s.id===v.source_id)));
  assert.equal(bootstrap(html+html),null);
  const bad=structuredClone(fixture.skus);bad.data[0].product_square_id='other-product';
  await assert.rejects(fetchSquareProduct(html,url,profile,async value=>({success:true,data:JSON.stringify(value.includes('/skus?')?bad:{data:fixture.product})})),/variant mismatch/);
});
test('Square API reader rejects another merchant path and account endpoints without any request',async()=>{
  const profile=require('../src/siteSupport/profiles.json').find(p=>p.adapter==='square'),reader=createReader(profile);
  const other=await reader.fetchHtml('https://cdn5.editmysite.com/app/store/api/v28/editor/users/other/sites/other/products');assert.equal(other.success,false);
  const account=await reader.fetchHtml('https://coffeeprojectnyshop.square.site/app/accounts/v1/customers/me');assert.equal(account.success,false);
  assert.equal(reader.requests.length,0);
});
