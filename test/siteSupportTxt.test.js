'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const txt=require('../src/siteSupport/txt'),fixture=require('./fixtures/siteSupport/txt-public-products.json'),profile=fixture.profile;
const {structuredExtraction,extractPage}=require('../src/extraction');
const {normalizeProduct}=require('../src/catalogNormalization');
const {productAvailability,productOnlyOffer}=require('../src/productEvidence');
function page(f=fixture.products[0]) {return {url:f.url,html:f.html,content:f.html,sourceProduct:txt.txtProduct(f.html,f.url,profile)};}
test('.txt current English source retains seven native products, paired USD base offers and exact photos without fabricated variants',()=>{
  assert.equal(fixture.products.length,7);
  for(const f of fixture.products) {
    const p=page(f),product=normalizeProduct(structuredExtraction(p).product,f.url),availability=productAvailability({sourceProduct:p.sourceProduct,sourceUrl:f.url});
    assert.equal(product.source_product_id,['imweb','EN',profile.imweb_site_code,profile.imweb_unit_code,f.native_code].join(':'));
    assert.deepEqual(product.variants,[]);assert.deepEqual(product.variant_prices,[]);assert.equal(product.variants_complete,false);
    assert.equal(product.attributes._product_offer.price,f.base_price);assert.equal(product.attributes._product_offer.currency,'USD');assert.equal(product.attributes._product_offer.minor_units,f.base_price*100);
    assert.equal(product.attributes.product_image_url,f.image);assert.equal(availability.state,'sold_out');assert.deepEqual(availability.variants,[]);
    assert.equal(product.attributes._market_context.inventory_complete,false);assert.equal(productOnlyOffer(p.sourceProduct,'https://txtcoffeeen.imweb.me/shop_view/?idx=1'),null);
  }
});
test('.txt source validation rejects another native product/unit, mismatched title/price/stock, unpaired currency and ambiguous schemas',()=>{
 const f=fixture.products[0];
 for(const [from,to] of [
   ['"prod_idx":207','"prod_idx":182'],['u2025091568c79f6d083ba','u201809265bab93e02c7bd'],
   ['"prod_price":10','"prod_price":11'],['"priceCurrency":"USD"','"priceCurrency":"KRW"'],
   ['"is_soldout":true','"is_soldout":false'],['<h1>Melting Blend','<h1>Another Coffee'],
   ['cdn-optimized.imweb.me/upload/S201809265bab93e020b92','cdn-optimized.imweb.me/upload/S00000000'],
   ['"only_regularly":null','"only_regularly":true'],
 ])assert.throws(()=>txt.txtProduct(f.html.replace(from,to),f.url,profile));
 assert.throws(()=>txt.txtProduct(f.html+f.html,f.url,profile),/context mismatch|ambiguous/);
 assert.throws(()=>txt.txtProduct(f.html.replace(/SITE_SHOP_DETAIL\.initDetail\(\{/, 'SITE_SHOP_DETAIL.initDetail((globalThis.TXT_EXECUTED=true,{'),f.url,profile),/not JSON/);assert.equal(globalThis.TXT_EXECUTED,undefined);
 assert.throws(()=>txt.txtProduct(f.html,'https://other.example/shop_view/?idx=207',profile),/unreviewed/);
});
test('.txt scoped discovery compares both public listings and fails closed on truncation, pagination, identity and read errors',async()=>{
 const read=async u=>({success:true,data:fixture.listings[u],finalUrl:u});
 const d=await txt.discoverTxtProducts({},profile,read);assert.equal(d.complete,false);assert.equal(d.observed_scope_complete,true);assert.equal(d.inventory_complete,false);assert.equal(d.urls.length,7);assert.equal(txt.partialScopeAllowed(profile,d),true);assert.equal(d.reconcile_omissions,false);
 for(const patch of [
   html=>html.replace('var page_count = 1','var page_count = 2'),
   html=>html.replace(/<div data-product-properties=.*?<\/div>/,''),
   html=>html.replace('s201809285bade00dec890','s201809285bade00dec891'),
   html=>html+'<a rel="next" href="?page=2">Next</a>',
 ]) {
   const bad=await txt.discoverTxtProducts({},profile,async u=>({success:true,data:u.endsWith('/coffeesubscriptions')?patch(fixture.listings[u]):fixture.listings[u],finalUrl:u}));assert.equal(bad.observed_scope_complete,false);assert.equal(txt.partialScopeAllowed(profile,bad),false);assert.deepEqual(bad.urls,[]);assert(bad.error);
 }
 const failed=await txt.discoverTxtProducts({},profile,async()=>({success:false,error:'HTTP 429'}));assert.equal(txt.partialScopeAllowed(profile,failed),false);assert.equal(failed.urls.length,0);
 for(const mutation of [{allow_partial_inventory:false},{reconcile_omissions:true},{inventory_authorizes_global_absence:true},{adapter:'imweb'}])assert.equal(txt.partialScopeAllowed({...profile,...mutation},d),false);
});
test('.txt source remains product-only after semantic AI and cached classifications contain invented sizes/default prices',async()=>{
 const p=page(),now=Date.now(),model='fixture-model';let calls=0;
 const classify=async()=>{calls++;return {data:{is_product:true,is_coffee_page:true,product:{name:'Melting Blend',default_price:999,variant_price_currency:'KRW',variants_complete:true,source_product_id:'fake',variants:[{source_id:'made-up-150g',title:'150g',price:999,currency:'KRW',available:true}]}}};};
 const first=await extractPage({page:p,classify,now,model});assert.equal(first.mode,'structured_product_only');assert.equal(first.aiCalls,0);assert.equal(first.data.product.source_product_id,p.sourceProduct.productID);assert.deepEqual(first.data.product.variants,[]);assert.deepEqual(first.data.product.variant_prices,[]);assert.equal(first.data.product.default_price,undefined);assert.equal(first.data.product.variants_complete,false);assert.equal(first.data.product.attributes.country_of_origin,undefined);
 const corrupt=structuredClone(first.cache);corrupt.product.variants=[{source_id:'invented',title:'150g',price:999,currency:'KRW'}];corrupt.product.default_price=999;corrupt.product.variant_prices=[['150g',999]];
 const second=await extractPage({page:p,classify,now:now+1000,model,cache:corrupt});assert.equal(calls,0);assert.equal(second.mode,'cache');assert.deepEqual(second.data.product.variants,[]);assert.deepEqual(second.data.product.variant_prices,[]);assert.equal(second.data.product.default_price,undefined);assert.equal(second.data.product.attributes._product_offer.currency,'USD');
 const availability=productAvailability({sourceUrl:p.url,sourceProduct:{...p.sourceProduct,_product_offer:{...p.sourceProduct._product_offer,source_product_id:'other'}}});assert.equal(availability.state,'unknown');
});
test('.txt repeated transactional saves preserve native identity, legacy slug, sold-out state, incomplete options and one primary photo',async()=>{
 const {catalogDb,supabaseAdapter}=require('./catalogDb'),{saveProduct,catalogPayload}=require('../src/productSaver'),{downloadAndSaveImage}=require('../src/imageDownloader');
 const pg=await catalogDb();try {
   const owner=profile.entity_ids[0],legacy='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',p=page(),product=structuredExtraction(p).product,availability=productAvailability({sourceProduct:p.sourceProduct,sourceUrl:p.url}),db=supabaseAdapter(pg),log=new Proxy({},{get:()=>()=>{}});
   await pg.query('insert into entities(id) values($1)',[owner]);await pg.query('insert into products(id,entity_id,slug,name,source_url) values($1,$2,$3,$4,$5)',[legacy,owner,'keep-txt-slug','Previous name',p.url]);
   // A product-only observation must leave prior known option rows untouched.
   const prior=catalogPayload(owner,{...product,variants:[{source_id:'historical-option',title:'Historical verified option',price:10,currency:'USD',availability:'sold_out',weight_g:null}]},p.url,{id:legacy,slug:'keep-txt-slug',source_url:p.url},availability,new Date(Date.now()-1000).toISOString());await pg.query('select save_catalog_product_v2($1::jsonb)',[JSON.stringify(prior)]);
   let reads=0,uploads=0;db.storage={from(){return{async upload(){uploads++;return{error:null};},getPublicUrl(){return{data:{publicUrl:'https://storage.test/txt-photo'}};}};}};
   const photoOptions={db,fetchImage:async url=>{assert.equal(url,fixture.products[0].image);reads++;return{success:true,data:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMoDtQpDtRhgFAAG2oDwc8b69cAAAAASUVORK5CYII=','base64')}}};
   const opts={db,availability,downloadImage:async(id,url,logger)=>downloadAndSaveImage(id,url,logger,photoOptions)};
   assert.equal(await saveProduct(owner,product,p.url,log,opts),legacy);assert.equal(await saveProduct(owner,product,p.url,log,opts),legacy);
   const saved=(await pg.query('select id,slug,metadata,is_available,availability_state,original_image_url from products')).rows[0];assert.equal(saved.id,legacy);assert.equal(saved.slug,'keep-txt-slug');assert.equal(saved.is_available,false);assert.equal(saved.availability_state,'sold_out');assert.equal(saved.original_image_url,fixture.products[0].image);assert.equal(saved.metadata._normalization.source_product_id,p.sourceProduct.productID);assert.equal(saved.metadata._product_offer.currency,'USD');assert.equal(saved.metadata._product_offer.price,10);
   assert.equal((await pg.query('select count(*)::int n from products')).rows[0].n,1);assert.deepEqual((await pg.query('select merchant_variant_id,availability_state from product_variants')).rows,[{merchant_variant_id:'historical-option',availability_state:'sold_out'}]);
   assert.equal(reads,1);assert.equal(uploads,1);assert.equal((await pg.query('select count(*)::int n from product_media')).rows[0].n,1);
 }finally{await pg.close();}
});
test('registered .txt page visitor deterministically saves all seven product photos with zero model calls and reuses current source semantics',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{createRequire}=require('node:module'),file=path.join(__dirname,'../src/pageVisitor.js'),nativeRequire=createRequire(file),module={exports:{}},saved=[],known=new Map(),log=new Proxy({},{get:()=>()=>{}});
 const mocks={
   './logger':log,'./gptClassifier':{MODEL:'unused-test-model',classifyPage:async()=>{throw Error('Product-only source must not call a model');}},
   './knownPages':{saveKnownPage:async(_,url,status,data)=>{assert.equal(status,'coffee');known.set(url,{classification:data.classification,times_seen:1});if(data.classification._extraction.mode==='structured_product_only')assert.equal(data.classifiedBy,'structured-product-only-v1');}},
   './productSaver':{...nativeRequire('./productSaver'),saveProduct:async(_,product,url,logger,options)=>{assert.deepEqual(product.variants,[]);assert.equal(product.variants_complete,false);assert.equal(product.attributes.country_of_origin,undefined);assert.equal(options.availability.state,'sold_out');saved.push({product,url});return product.source_product_id;}},
   './config':{config:{crawler:{requestDelayMs:0}}},'./httpClient':{fetchHtml:async()=>{throw Error('Unguarded reader must not run');},jitteredSleep:async()=>{}},
 };
 vm.runInThisContext('(function(require,module,exports){'+fs.readFileSync(file,'utf8')+'\n})',{filename:file})(name=>mocks[name] || nativeRequire(name),module,module.exports);
 const registered=require('../src/siteSupport/profiles.json').find(p=>p.name==='.txt'),byUrl=new Map(fixture.products.map(p=>[p.url,p])),fetchHtml=async url=>({success:true,status:200,finalUrl:url,data:byUrl.get(url).html}),options={siteProfile:registered,fetchHtml,knownPages:known},accumulator={markVisited(){}},urls=fixture.products.map(p=>p.url);
 const first=await module.exports.visitAllPages(registered.entity_ids[0],urls,accumulator,log,'unknown',options);assert.equal(first.errors,0);assert.equal(first.coffeeFound,7);assert.equal(first.aiCalls,0);assert.equal(first.structuredPages,7);assert.equal(first.structuredProductOnlyPages,7);
 const second=await module.exports.visitAllPages(registered.entity_ids[0],urls,accumulator,log,'unknown',options);assert.equal(second.errors,0);assert.equal(second.cacheHits,7);assert.equal(second.aiCalls,0);assert.equal(saved.length,14);
 for(const {product,url} of saved)assert.equal(product.attributes.product_image_url,byUrl.get(url).image);
 const bad=await module.exports.fetchPageContent(urls[0],null,{siteProfile:registered,fetchHtml:async url=>({success:true,status:200,finalUrl:url,data:fixture.products[0].html.replace('"prod_price":10','"prod_price":11')})});assert.equal(bad.success,false);assert.match(bad.error,/disagreement/);
});
