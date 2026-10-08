'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const profiles=require('../src/siteSupport/profiles.json');
const {profileFor}=require('../src/siteSupport/discovery');
const {mergeShopifyStock,parseShopifyProduct}=require('../src/shopifyProduct');
const {structuredExtraction}=require('../src/extraction');
const {normalizeProduct}=require('../src/catalogNormalization');
const {productAvailability}=require('../src/productEvidence');
for(const fixture of require('./fixtures/siteSupport/assigned-shopify.json'))test(`captured ${fixture.name} exact variants pair price/currency/stock and ignore shipping weight`,()=>{
 const profile=profiles.find(p=>p.name===fixture.name);
 assert.equal(profileFor({id:profile.entity_ids[0],website_url:fixture.url}),profile);
 assert.equal(profileFor({id:'other-owner',website_url:fixture.url}),null);
 const raw=mergeShopifyStock(fixture.product,fixture.ajax),nativeOptions={preferLabelWeight:true,variantSizePrefix:profile.variant_size_prefix,variantSizePatterns:profile.variant_size_patterns},native=parseShopifyProduct(raw,nativeOptions);
 const source=structuredExtraction({html:fixture.html,url:fixture.url,finalUrl:fixture.finalUrl},{success:true,data:native}),product=normalizeProduct(source.product,fixture.url);
 assert.equal(product.source_product_id,String(raw.id));assert.equal(product.variants.length,raw.variants.length);
 assert(product.variants.every(v=>v.source_id&&v.money.currency&&v.money.minorUnits!==null&&v.availability!=='unknown'));
 assert.deepEqual(product.variants.map(v=>({id:v.source_id,currency:v.money.currency,minor:v.money.minorUnits,state:v.availability,weight:v.weight_g})),fixture.expected);
 assert.equal(productAvailability({html:fixture.html,sourceUrl:fixture.url,shopifyProduct:raw}).state,fixture.expected.some(v=>v.state==='in_stock')?'in_stock':'sold_out');
 const changed=structuredClone(fixture.ajax);changed.variants.forEach(v=>v.available=false);
 assert.equal(productAvailability({sourceUrl:fixture.url,shopifyProduct:mergeShopifyStock(fixture.product,changed)}).state,'sold_out');
 const wrong=structuredClone(fixture.ajax);wrong.id='unrelated';
 assert(mergeShopifyStock({...fixture.product,variants:fixture.product.variants.map(v=>({...v,available:undefined}))},wrong).variants.every(v=>v.available===undefined));
 const masses=structuredClone(raw);masses.variants.forEach(v=>v.grams=99999);
 assert.deepEqual(parseShopifyProduct(masses,nativeOptions).variants.map(v=>v.weightGrams),native.variants.map(v=>v.weightGrams));
});
test('S&W Square context binds numeric site IDs to exact USD variants and rejects another merchant SKU',async()=>{
 const fixture=require('./fixtures/siteSupport/sw-square.json'),profile=profiles.find(p=>p.name==='S&W Craft Roasting');
 const {fetchSquareProduct}=require('../src/siteSupport/square'),html='<script>window.__BOOTSTRAP_STATE__ = '+JSON.stringify(fixture.context)+';</script>';
 const fetchHtml=async u=>({success:true,data:JSON.stringify(u.includes('/skus?')?fixture.skus:{data:fixture.product})});
 const source=await fetchSquareProduct(html,fixture.url,profile,fetchHtml);
 const product=normalizeProduct(structuredExtraction({html,url:fixture.url,sourceProduct:source},null).product,fixture.url);
 assert.equal(product.source_product_id,'7TYNEQTQ5CENNQN565C55YKD');assert.equal(product.variants[0].source_id,'KNOSL4TS6WTLZPMPXIYK3JHZ');
 assert.equal(product.variants[0].money.currency,'USD');assert.equal(product.variants[0].money.minorUnits,2280);assert.equal(product.variants[0].weight_g,300);
 assert.equal(productAvailability({sourceProduct:source,sourceUrl:fixture.url}).state,'in_stock');
 const bad=structuredClone(fixture.skus);bad.data[0].owner_id='another-merchant';
 await assert.rejects(fetchSquareProduct(html,fixture.url,profile,async u=>({success:true,data:JSON.stringify(u.includes('/skus?')?bad:{data:fixture.product})})),/variant mismatch/);
});
test('S&W coffee discovery excludes primary tip/cascara identities but retains archived sold-out coffee',async()=>{
 const fixture=require('./fixtures/siteSupport/sw-square.json'),profile=profiles.find(p=>p.name==='S&W Craft Roasting');
 const {discoverSquareProducts}=require('../src/siteSupport/square');
 const home='<script>window.__BOOTSTRAP_STATE__ = '+JSON.stringify(fixture.context)+';</script>';
 const result=await discoverSquareProducts({website_url:'https://www.swroasting.coffee'},profile,async value=>{
  if(!value.includes('/products?'))return{success:true,data:home};
  const category=new URL(value).searchParams.get('categories[]');
  const items=[{...fixture.product,categoryIds:[category],visibility:'visible'},...profile.exclude_product_ids.map(id=>({...fixture.product,id,name:'Non-coffee catalog item',categoryIds:[category],visibility:'visible'}))];
  return{success:true,data:JSON.stringify({data:items,meta:{pagination:{current_page:1,total_pages:1,total:items.length}}})};
 });
 assert.equal(result.complete,true);assert.deepEqual(result.urls,[fixture.url]);assert.equal(result.evidence.length,4);
});
test('primary net contents are explicit and exclude recipes, shipping mass and conflicting bag sizes',()=>{
 const {descriptionNetWeight}=require('../src/siteSupport/netWeight');
 assert.equal(descriptionNetWeight('<p>Sold in 300 g bags.</p>'),300);
 assert.equal(descriptionNetWeight('<p>Place this item to add one 2oz bag, your choice of origin.</p>'),57);
 assert.equal(descriptionNetWeight('<p>Sold in three 100g bags, totaling 300g</p>'),300);
 assert.equal(descriptionNetWeight('Brew 30g coffee. Shipping weight 300g.'),null);
 assert.equal(descriptionNetWeight('Brew a recipe with water totaling 300g.'),null);
 assert.equal(descriptionNetWeight('Shipping parcel total net weight: 300g.'),null);
 assert.equal(descriptionNetWeight('Sold in 100g bags. Available in 300g bags.'),null);
 const {coffeeBundleWeight}=require('../src/siteSupport/netWeight');
 const description='<p>It includes 4 x 80g bags of coffees selected by our team.</p><p>1x Third Wave Water sachet (for 4L/1gal of water)</p>';
 assert.equal(coffeeBundleWeight(description),320);assert.equal(coffeeBundleWeight('<p>Brew water contains 4 x 80g bags of coffee.</p>'),null);
 const bundle={id:1,title:'Sample box',body_html:description,variants:[{id:10,title:'Default Title',grams:350}]};
 assert.equal(parseShopifyProduct(bundle,{preferLabelWeight:true,bundleNetWeightProductIds:['1']}).variants[0].weightGrams,320);
 assert.equal(parseShopifyProduct(bundle,{preferLabelWeight:true,bundleNetWeightProductIds:['another']}).variants[0].weightGrams,null);
 assert.equal(coffeeBundleWeight('<p>Includes 4 x 80g bags of coffees.</p><p>Contains 3 x 100g bags of coffee.</p>'),null);
});
test('Square mixed sample excludes the verified tea SKU, reads stated bag weight and does not retire omitted variants',async()=>{
 const fixture=structuredClone(require('./fixtures/siteSupport/sw-square.json')),profile=profiles.find(p=>p.name==='S&W Craft Roasting');
 const {fetchSquareProduct}=require('../src/siteSupport/square');
 fixture.product.short_description='<p>Place this item to add one 2oz bag, your choice of origin.</p>';
 fixture.skus.data.push({...fixture.skus.data[0],id:profile.exclude_sku_ids[0],name:'Cascara coffee cherry Tea'});
 fixture.skus.meta.pagination.total=2;
 const html='<script>window.__BOOTSTRAP_STATE__ = '+JSON.stringify(fixture.context)+';</script>';
 const source=await fetchSquareProduct(html,fixture.url,profile,async u=>({success:true,data:JSON.stringify(u.includes('/skus?')?fixture.skus:{data:fixture.product})}));
 assert.equal(source.offers.length,1);assert.equal(source._variants_complete,false);
 // A variant's explicit size overrides a general bag statement.
 assert.equal(source.offers[0]._net_weight_g,300);
 fixture.skus.data[0].name='Selected coffee';
 const sample=await fetchSquareProduct(html,fixture.url,profile,async u=>({success:true,data:JSON.stringify(u.includes('/skus?')?fixture.skus:{data:fixture.product})}));
 assert.equal(normalizeProduct(structuredExtraction({sourceProduct:sample,url:fixture.url},null).product,fixture.url).variants[0].weight_g,57);
});
test('Square pagination rejects a repeated catalog identity even when the declared total agrees',async()=>{
 const {paged}=require('../src/siteSupport/square');
 await assert.rejects(paged('https://shop.test/products',async u=>({success:true,data:JSON.stringify({data:[{id:'same'}],meta:{pagination:{current_page:Number(new URL(u).searchParams.get('page')),total_pages:2,total:2}}})})),/Repeated/);
});
test('normal page visitor consumes the reviewed Square source and fails closed on incomplete SKU reads',async()=>{
 const fixture=require('./fixtures/siteSupport/sw-square.json'),profile=profiles.find(p=>p.name==='S&W Craft Roasting');
 const {fetchPageContent}=require('../src/pageVisitor');
 const html='<main><h1>'+fixture.product.name+'</h1></main><script>window.__BOOTSTRAP_STATE__ = '+JSON.stringify(fixture.context)+';</script>';
 const read=async u=>({success:true,data:u===fixture.url?html:JSON.stringify(u.includes('/skus?')?fixture.skus:{data:fixture.product}),status:200,finalUrl:u});
 const page=await fetchPageContent(fixture.url,null,{siteProfile:profile,fetchHtml:read});
 assert.equal(page.success,true);assert.equal(page.sourceProduct.productID,fixture.product.id);
 assert.equal(structuredExtraction({...page,url:fixture.url},null).product.variants[0].source_id,fixture.skus.data[0].id);
 const incomplete=await fetchPageContent(fixture.url,null,{siteProfile:profile,fetchHtml:async u=>u.includes('/skus?')?{success:false,error:'HTTP 503'}:read(u)});
 assert.equal(incomplete.success,false);assert.match(incomplete.error,/503/);
});
test('Square adoption preserves existing product ID/slug and remains idempotent with native SKU identity',async()=>{
 const {catalogDb,supabaseAdapter}=require('./catalogDb'),{catalogPayload,findExistingProduct,productSourceKey}=require('../src/productSaver');
 const fixture=require('./fixtures/siteSupport/sw-square.json'),profile=profiles.find(p=>p.name==='S&W Craft Roasting');
 const {fetchSquareProduct}=require('../src/siteSupport/square'),{canonicalProductUrl}=require('../src/catalogNormalization');
 const html='<script>window.__BOOTSTRAP_STATE__ = '+JSON.stringify(fixture.context)+';</script>';
 const source=await fetchSquareProduct(html,fixture.url,profile,async u=>({success:true,data:JSON.stringify(u.includes('/skus?')?fixture.skus:{data:fixture.product})}));
 const product=structuredExtraction({sourceProduct:source,url:fixture.url},null).product,availability=productAvailability({sourceProduct:source,sourceUrl:fixture.url}),pg=await catalogDb();
 try{
  const owner=profile.entity_ids[0],id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await pg.query('insert into entities(id) values($1)',[owner]);await pg.query('insert into products(id,entity_id,slug,name,source_url) values($1,$2,$3,$4,$5)',[id,owner,'stable-sw-slug','Older title',fixture.url]);
  const db=supabaseAdapter(pg),existing=await findExistingProduct(db,owner,canonicalProductUrl(fixture.url),productSourceKey(owner,product,fixture.url));
  const payload=catalogPayload(owner,product,fixture.url,existing,availability,new Date().toISOString());
  await pg.query('select save_catalog_product_v2($1::jsonb)',[JSON.stringify(payload)]);await pg.query('select save_catalog_product_v2($1::jsonb)',[JSON.stringify(payload)]);
  assert.deepEqual((await pg.query('select id,slug from products')).rows,[{id,slug:'stable-sw-slug'}]);
  const variants=(await pg.query('select merchant_variant_id,price_minor_units,currency,weight_g from product_variants')).rows;
  assert.deepEqual(variants,[{merchant_variant_id:fixture.skus.data[0].id,price_minor_units:2280,currency:'USD',weight_g:300}]);
 }finally{await pg.close();}
});
test('September DOM facts require exact primary identity and exclude recommendations or duplicated product fields',()=>{
 const f=require('./fixtures/siteSupport/assigned-shopify.json').find(f=>f.name==='September'),profile=profiles.find(p=>p.name==='September');
 const {structuredProduct}=require('../src/productEvidence'),{shopifyPageFields}=require('../src/siteSupport/shopifyPageFields');
 const native=parseShopifyProduct(mergeShopifyStock(f.product,f.ajax),{preferLabelWeight:true}),schema=structuredProduct(f.html,f.finalUrl);
 const enriched=shopifyPageFields(f.html,native,schema,profile);
 assert(enriched.description.includes('Zeolite Natural'));assert.equal(enriched.variants[0].weightGrams,125);
 const wrong=shopifyPageFields(f.html,native,{...schema,productID:'unrelated'},profile);assert.equal(wrong.description,'');assert.equal(wrong.variants[0].weightGrams,null);
 const withRecommendation=f.html+'<aside class="recommendations"><div class="product-info-new">Foreign coffee</div><div class="product-form__custom-liquid"><div class="right-side-info"><p class="quantity">1kg</p></div></div></aside>';
 assert.equal(shopifyPageFields(withRecommendation,native,schema,profile).variants[0].weightGrams,125);
 assert.equal(shopifyPageFields(f.html+'<div class="product-info-new">Another product</div>',native,schema,profile).description,'');
});
test('captured SEY archive descriptions require exact analytics and canonical identity and omit CSS/recommendations',()=>{
 const f=require('./fixtures/siteSupport/sey-archive.json'),profile=profiles.find(p=>p.name==='SEY'),{shopifyPageFields}=require('../src/siteSupport/shopifyPageFields');
 const native=parseShopifyProduct(mergeShopifyStock(f.product,f.ajax),{preferLabelWeight:true}),result=shopifyPageFields(f.html,native,null,profile);
 assert.equal(native.description,'');assert.match(result.description,/Carmen Aragon/);assert.match(result.description,/Dry fermented for 18 hours/);assert(!result.description.includes('<style'));
 const product=normalizeProduct(structuredExtraction({html:f.html,url:f.url},{success:true,data:native}).product,f.url);
 assert.equal(product.variants[0].source_id,'31886302150752');assert.equal(product.variants[0].money.currency,'USD');assert.equal(product.variants[0].money.minorUnits,2000);assert.equal(product.variants[0].availability,'sold_out');assert.equal(product.variants[0].weight_g,null);
 for(const html of [f.html.replace('href="'+f.url+'"','href="https://www.seycoffee.com/products/another"'),f.html.replace('var meta =','var foreignMeta =')])assert.equal(shopifyPageFields(html,native,null,profile).description,'');
 const extra=f.html+'<aside><div class="coffee_longBlurb">Foreign coffee</div></aside>';
 assert(!shopifyPageFields(extra,native,null,profile).description.includes('Foreign coffee'));
});
test('captured Shoebox labels preserve exact garage-sale, drum and roast-date sizes without shipping mass',()=>{
 const profile=profiles.find(p=>p.name==='Shoebox'),options={preferLabelWeight:true,variantSizePrefix:profile.variant_size_prefix,variantSizePatterns:profile.variant_size_patterns,variantPriceSuffix:true,fixedRetailBagLabel:true};
 const fixtures=require('./fixtures/siteSupport/shoebox-sizes.json'),expected=[Array.from({length:22},(_,i)=>i===9||i===10?250:125),[900,400,600,200,400,350,200,250,200,150,125,140,180,200,250],[250,1000],[125,null],[125],[125,125]];
 fixtures.forEach((f,i)=>{const raw=structuredClone(f.product);raw.variants.forEach(v=>v.grams=99999);assert.deepEqual(parseShopifyProduct(raw,options).variants.map(v=>v.weightGrams),expected[i]);});
 const foreign=structuredClone(fixtures[0].product);foreign.options[0].product_id='unrelated';assert.equal(parseShopifyProduct(foreign,options).variants[0].weightGrams,null);
 const changed=structuredClone(fixtures[0].product);changed.options[0].name='Choose size';assert.equal(parseShopifyProduct(changed,options).variants[0].weightGrams,null);
 for(const title of ['Coffee 2 x 125g - $ 15','Coffee 125-250g - $20','Coffee 125g - 250g - $20'])assert.equal(parseShopifyProduct({id:1,title:'Coffee',variants:[{id:10,title,grams:99999}]},options).variants[0].weightGrams,null);
});
test('captured Substance public WooCommerce products pair EUR minor amounts and simple SKU stock, separate from shipping weight',async()=>{
 const {fetchWooProduct,decimalPrice}=require('../src/siteSupport/woocommerce'),profile=profiles.find(p=>p.name==='Substance');
 for(const f of require('./fixtures/siteSupport/substance-woo.json')){
  const raw=structuredClone(f.product);raw.weight='99999';
  const source=await fetchWooProduct(f.html,f.url,profile,async()=>({success:true,data:JSON.stringify([raw])})),product=normalizeProduct(structuredExtraction({sourceProduct:source,url:f.url},null).product,f.url);
  assert.equal(product.source_product_id,String(raw.id));assert.equal(product.variants[0].source_id,String(raw.id));assert.equal(product.variants[0].money.currency,'EUR');assert.equal(product.variants[0].money.minorUnits,raw.id===4240?4500:6000);assert.equal(product.variants[0].weight_g,100);
  assert.equal(productAvailability({sourceProduct:source,sourceUrl:f.url}).state,raw.is_in_stock?'in_stock':'sold_out');assert.equal(product.variants_complete,true);
  const backorder={...raw,is_in_stock:true,is_on_backorder:true};assert.equal(productAvailability({sourceProduct:await fetchWooProduct(f.html,f.url,profile,async()=>({success:true,data:JSON.stringify([backorder])})),sourceUrl:f.url}).state,'unknown');
 }
 assert.throws(()=>decimalPrice({price:'4500',currency_code:'EUR',currency_minor_unit:0,price_range:null}),/minor-unit/);
 assert.throws(()=>decimalPrice({price:'4500',currency_code:'EUR',currency_minor_unit:2,price_range:{min_amount:'4000',max_amount:'4500'}}),/exact market/);
});
test('WooCommerce reader rejects wrong page/category identity, variable SKU groups and duplicate inventory entries',async()=>{
 const f=require('./fixtures/siteSupport/substance-woo.json')[0],profile=profiles.find(p=>p.name==='Substance'),{fetchWooProduct,discoverWooProducts}=require('../src/siteSupport/woocommerce');
 for(const change of [p=>p.id=777,p=>p.categories=[],p=>p.type='variable',p=>p.variations=[{id:777}],p=>p.is_password_protected=true]){const raw=structuredClone(f.product);change(raw);await assert.rejects(fetchWooProduct(f.html,f.url,profile,async()=>({success:true,data:JSON.stringify([raw])})));}
 await assert.rejects(fetchWooProduct(f.html+f.html,f.url,profile,async()=>({success:true,data:JSON.stringify([f.product])})),/page identity/);
 const result=await discoverWooProducts({website_url:f.url},profile,async u=>({success:true,data:JSON.stringify(new URL(u).searchParams.get('page')==='1'?[f.product]:[])}));assert.equal(result.complete,true);assert.deepEqual(result.urls,[f.url]);assert.equal(result.evidence.at(-1).products,0);
 const repeated=await discoverWooProducts({website_url:f.url},profile,async()=>({success:true,data:JSON.stringify([f.product])}));assert.equal(repeated.complete,false);assert.match(repeated.error,/repeated/);
});
test('normal WooCommerce page reader consumes public product evidence and stops on an API failure',async()=>{
 const f=require('./fixtures/siteSupport/substance-woo.json')[0],profile=profiles.find(p=>p.name==='Substance'),{fetchPageContent}=require('../src/pageVisitor');
 const read=async u=>u===f.url?{success:true,data:f.html,status:200,finalUrl:u}:{success:true,data:JSON.stringify([f.product]),finalUrl:u};
 const result=await fetchPageContent(f.url,null,{siteProfile:profile,fetchHtml:read});assert.equal(result.success,true);assert.equal(result.sourceProduct.productID,'4240');
 const failed=await fetchPageContent(f.url,null,{siteProfile:profile,fetchHtml:async u=>u===f.url?read(u):{success:false,error:'HTTP 503'}});assert.equal(failed.success,false);assert.match(failed.error,/503/);
});
test('regional September URLs preserve the existing canonical product identity',()=>{
 const {canonicalProductUrl}=require('../src/catalogNormalization');
 assert.equal(canonicalProductUrl('https://september.coffee/en-us/products/el-paraiso-zeo-colombia-2026?variant=43350505521250'),canonicalProductUrl('https://september.coffee/products/el-paraiso-zeo-colombia-2026'));
});
test('captured September fixed-size style and roast-date options preserve every native SKU without shipping mass',()=>{
 const {structuredProduct}=require('../src/productEvidence'),{shopifyPageFields}=require('../src/siteSupport/shopifyPageFields'),profile=profiles.find(p=>p.name==='September');
 for(const f of require('./fixtures/siteSupport/september-options.json')){
  const native=parseShopifyProduct(mergeShopifyStock(f.product,f.ajax),{preferLabelWeight:true}),schema=structuredProduct(f.html,f.url);
  const result=shopifyPageFields(f.html,native,schema,profile);
  assert.equal(result.variants.length,2);assert(result.variants.every(v=>v.weightGrams===f.expected_weight));
  const sizes=structuredClone(native);sizes.options[0].name='Size';
  assert(shopifyPageFields(f.html,sizes,schema,profile).variants.every(v=>v.weightGrams===null));
 }
});
test('Shopify native handles permit observed SEY underscores and reject path escapes',async()=>{
 const {discoverShopifyProducts}=require('../src/siteSupport/shopifyDiscovery'),profile=profiles.find(p=>p.name==='SEY');
 for(const handle of ['lost-origin-001_001','../terms']){
  const result=await discoverShopifyProducts({website_url:'https://www.seycoffee.com'}, {...profile,listing_paths:['/collections/archived-coffees/products.json']},async u=>({success:true,data:JSON.stringify({products:new URL(u).searchParams.get('page')==='1'?[{id:8081293181182,title:'Gesha coffee',handle,product_type:'Coffees'}]:[]})}));
  assert.equal(result.complete,handle==='lost-origin-001_001');
  if(result.complete)assert.deepEqual(result.urls,['https://www.seycoffee.com/products/lost-origin-001_001']);
 }
});
test('overlapping native inventory pages and duplicated Ajax SKU identities cannot authorize completion',async()=>{
 const {discoverShopifyProducts}=require('../src/siteSupport/shopifyDiscovery'),profile=profiles.find(p=>p.name==='SEY');
 const product={id:1,title:'Coffee',handle:'coffee',product_type:'Coffees'};
 const result=await discoverShopifyProducts({website_url:'https://www.seycoffee.com'}, {...profile,listing_paths:['/collections/coffee/products.json']},async u=>({success:true,data:JSON.stringify({products:new URL(u).searchParams.get('page')==='1'?[product]:[{...product},{...product,id:2,handle:'second'}]})}));
 assert.equal(result.complete,false);assert.match(result.error,/identity.*repeated/);
 assert.equal(mergeShopifyStock({id:1,variants:[{id:10},{id:20}]},{id:1,variants:[{id:10,available:true},{id:10,available:true}]})._variants_complete,false);
});
test('a complete regional September inventory does not reconcile global absence',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module'),path=require('node:path');
 const file=path.join(__dirname,'../src/crawler.js'),nativeRequire=createRequire(file),log=new Proxy({},{get:()=>()=>{}}),url='https://september.coffee/en-us/products/coffee';
 for(const authorize of [false,true]){
  let reconciliations=0;
  const profile={...profiles.find(p=>p.name==='September'),inventory_authorizes_global_absence:authorize},noop=async()=>{},mock={
   './supabase':{getSupabase:()=>{throw Error('No DB access permitted');}},'./logger':{...log,createScopedLogger:()=>log},
   './httpClient':{jitteredSleep:noop},'./config':{config:{crawler:{requestDelayMs:0}}},
   './sitemap':{discoverSitemapUrl:async()=>url+'/sitemap',crawlSitemap:async()=>({urls:[{url}],sitemaps:[],inventoryComplete:true})},
   './blacklist':{filterUrlsWithBlacklist:urls=>({passed:urls,blacklisted:[]})},
   './knownPages':{getKnownPagesForEntity:async()=>new Map(),saveBlacklistedPages:noop},
   './pageVisitor':{visitAllPages:async()=>({visited:1,coffeeFound:1,errors:0})},
   './crawlRuns':{waitForCrawlAdmission:noop,createCrawlRun:async()=>({id:'fixture-run'}),completeCrawlRun:noop,failCrawlRun:noop},
   './availability':{reconcileRoasterAvailability:async()=>{reconciliations++;}},
   './siteSupport/discovery':{profileFor:()=>profile,discoverSiteProducts:async()=>({supported:true,complete:true,urls:[url]})},
   './siteSupport/network':{createReader:()=>({fetchHtml:async()=>({success:true,data:'Shopify',finalUrl:'https://september.coffee'})})}
  },module={exports:{}};
  const logger=new Proxy(mock['./logger'],{get:(t,k)=>t[k] || (()=>{})});mock['./logger']=logger;
  vm.runInThisContext('(function(require,module,exports){'+fs.readFileSync(file,'utf8')+'\n})',{filename:file})(name=>Object.hasOwn(mock,name)?mock[name]:nativeRequire(name),module,module.exports);
  assert.equal((await module.exports.crawlRoaster({id:profile.entity_ids[0],name:'September',website_url:'https://september.coffee'},[])).success,true);
  assert.equal(reconciliations,authorize?1:0);
 }
});
test('registered Shopify endpoint rejects another primary handle and duplicate or unsafe native identities',async()=>{
 const f=require('./fixtures/siteSupport/assigned-shopify.json').find(f=>f.name==='Prodigal'),{fetchShopifyProductJson}=require('../src/shopifyProduct'),log=new Proxy({},{get:()=>()=>{}});
 for(const change of [p=>p.handle='other-coffee',p=>p.variants.push({...p.variants[0]}),p=>p.id=Number.MAX_SAFE_INTEGER+1]){
  const raw=structuredClone(f.product);change(raw);let reads=0;
  const result=await fetchShopifyProductJson(f.url,log,{fetchJson:async()=>{reads++;return{success:true,data:{product:raw}};}});
  assert.equal(result.success,false);assert.match(result.error,/identity/);assert.equal(reads,1);
 }
});
test('registered Shopify product source failure stops normal classification and persistence',async()=>{
 const f=require('./fixtures/siteSupport/assigned-shopify.json').find(f=>f.name==='Prodigal'),profile=profiles.find(p=>p.name==='Prodigal'),{processFetchedPage}=require('../src/pageVisitor');
 const log=new Proxy({},{get:()=>()=>{}});
 const result=await processFetchedPage(profile.entity_ids[0],f.url,{success:true,status:200,html:f.html,finalUrl:f.url,content:'Coffee'},log,'custom',{siteProfile:profile,fetchJson:async()=>({success:false,error:'HTTP 503'})});
 assert.equal(result.classified,false);assert.equal(result.aiCalls,0);assert.match(result.error,/source incomplete.*503/);
});
test('explicit merchant bag labels remain separate from roast dates, recipes, ranges and shipping weights',()=>{
 const {sizeLabel,nativeDescriptionWeight}=require('../src/siteSupport/shopifyPageFields');
 assert.equal(sizeLabel('250G - Roasted on June 29th'),250);assert.equal(sizeLabel('125-250g'),null);
 assert.equal(sizeLabel('7oz / 200g'),200);assert.equal(sizeLabel('7oz / 500g'),null);assert.equal(sizeLabel('125g / 250g'),null);
 assert.equal(nativeDescriptionWeight('<p><strong>250g</strong> This is a natural coffee from Ethiopia.</p>'),250);
 assert.equal(nativeDescriptionWeight('<p><strong>18g</strong> coffee with 300g water</p>'),null);
 assert.equal(nativeDescriptionWeight('<p>Shipping weight 250g</p>'),null);
 assert.equal(nativeDescriptionWeight('<p><b>125g</b></p><p><b>250g</b></p>'),null);
 for(const [title,expected] of [['BC-25 - 125g',125],['BC-25 - 125-250g',null],['BC-25 - 2 x 125g',null],['OTHER-25 - 125g',null]]){
  const product=parseShopifyProduct({id:1,title:'Coffee',variants:[{id:10,title,grams:99999}]},{preferLabelWeight:true,variantSizePrefix:'BC'});
  assert.equal(product.variants[0].weightGrams,expected);
 }
});
test('captured Taith native variants establish exact GBP offers and distinguish untracked from exhausted stock',async()=>{
 const f=require('./fixtures/siteSupport/taith-squarespace.json'),profile=profiles.find(p=>p.name==='Taith'),{fetchSquarespaceProduct,variantOffer}=require('../src/siteSupport/squarespace');
 const html=f.html.replace('</article>','<h1>LOT INFORMATION</h1></article>')+'<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'Stale product name',offers:{'@type':'AggregateOffer',lowPrice:1,highPrice:999,priceCurrency:'USD'}})+'</script>';
 const source=await fetchSquarespaceProduct(html,f.url,profile,async()=>({success:true,data:JSON.stringify(f.data)})),product=normalizeProduct(structuredExtraction({sourceProduct:source,html,url:f.url},null).product,f.url);
 assert.equal(product.source_product_id,f.data.item.id);assert.equal(product.name,f.data.item.title);
 assert.deepEqual(product.variants.map(v=>({id:v.source_id,minor:v.money.minorUnits,currency:v.money.currency,weight:v.weight_g,state:v.availability})),[
  {id:'0c1a2dc3-e2de-49f0-808e-f3b0f25544c2',minor:2700,currency:'GBP',weight:125,state:'in_stock'},
  {id:'5a3adb57-ea74-49a7-beeb-5011c4b9faba',minor:20000,currency:'GBP',weight:1000,state:'in_stock'}]);
 const variant=structuredClone(f.data.item.structuredContent.variants[0]);variant.unlimited=false;assert.equal(variantOffer(variant,f.url,2,f.data.item.title).availability,'https://schema.org/OutOfStock');
 variant.qtyInStock=1;assert.equal(variantOffer(variant,f.url,2,f.data.item.title).availability,'https://schema.org/InStock');delete variant.unlimited;assert.equal(variantOffer(variant,f.url,2,f.data.item.title).availability,null);
 variant.onSale=true;variant.salePrice=2200;variant.salePriceMoney={currency:'GBP',value:'22.00'};assert.equal(variantOffer(variant,f.url,2,f.data.item.title).price,'22.00');
 variant.salePriceMoney.value='23.00';assert.throws(()=>variantOffer(variant,f.url,2,f.data.item.title),/paired variant money/);
});
test('Squarespace product evidence requires merchant, canonical page, taxonomy and complete native SKU identities',async()=>{
 const f=require('./fixtures/siteSupport/taith-squarespace.json'),profile=profiles.find(p=>p.name==='Taith'),{fetchSquarespaceProduct}=require('../src/siteSupport/squarespace');
 for(const change of [d=>d.website.id='other-owner',d=>d.collection.id='other-collection',d=>d.item.categoryIds=[],d=>d.item.fullUrl='/shop/p/another-coffee',d=>d.item.structuredContent.isSubscribable=true,d=>d.item.structuredContent.variants.push({...d.item.structuredContent.variants[0]}),d=>d.item.structuredContent.variants=[]]){
  const data=structuredClone(f.data);change(data);await assert.rejects(fetchSquarespaceProduct(f.html,f.url,profile,async()=>({success:true,data:JSON.stringify(data)})));
 }
 for(const html of [f.html+f.html,f.html.replace(f.data.item.id,'aaaaaaaaaaaaaaaaaaaaaaaa'),f.html.replace(f.data.item.title,'Different coffee')])await assert.rejects(fetchSquarespaceProduct(html,f.url,profile,async()=>({success:true,data:JSON.stringify(f.data)})),/page identity/);
 await assert.rejects(fetchSquarespaceProduct(f.html,f.url,profile,async()=>({success:true,data:JSON.stringify(f.data),finalUrl:'https://another-owner.example/shop'})),/owner/);
});
test('Taith discovery keeps an unproven count mismatch incomplete and rejects repeated or pending inventory pages',async()=>{
 const f=require('./fixtures/siteSupport/taith-squarespace.json'),profile=profiles.find(p=>p.name==='Taith'),{discoverSquarespaceProducts}=require('../src/siteSupport/squarespace');
 const read=data=>async()=>({success:true,data:JSON.stringify(data)}),roaster={website_url:'https://taithcoffee.com'};
 const result=await discoverSquarespaceProducts(roaster,profile,read(f.listing));assert.equal(result.complete,false);assert.equal(result.urls.length,33);assert.match(result.error,/49 returned \/ 187 declared/);assert.equal(result.inventory_authorizes_global_absence,false);
 assert(result.urls.some(u=>u.includes('26/e-04-')));assert(!result.urls.some(u=>/subscription|monthly/.test(u)));
 const complete=structuredClone(f.listing);complete.collection.itemCount=complete.items.length;
 assert.equal((await discoverSquarespaceProducts(roaster,profile,read(complete))).complete,true);
 complete.pagination={nextPage:true};assert.equal((await discoverSquarespaceProducts(roaster,profile,read(complete))).complete,false);
 complete.items.push({...complete.items[0]});complete.collection.itemCount=complete.items.length;const repeated=await discoverSquarespaceProducts(roaster,profile,read(complete));assert.equal(repeated.complete,false);assert.match(repeated.error,/identity repeated/);
});
test('normal Squarespace page processing uses native variant evidence and stops on a public-source failure',async()=>{
 const f=require('./fixtures/siteSupport/taith-squarespace.json'),profile=profiles.find(p=>p.name==='Taith'),{fetchPageContent}=require('../src/pageVisitor');
 const read=async u=>({success:true,data:u===f.url?f.html:JSON.stringify(f.data),status:200,finalUrl:u});
 const page=await fetchPageContent(f.url,null,{siteProfile:profile,fetchHtml:read});assert.equal(page.success,true);assert.equal(page.sourceProduct.productID,f.data.item.id);assert.equal(page.sourceProduct._variants_complete,true);
 const failed=await fetchPageContent(f.url,null,{siteProfile:profile,fetchHtml:async u=>u===f.url?read(u):{success:false,error:'HTTP 503'}});assert.equal(failed.success,false);assert.match(failed.error,/503/);
});
test('Taith primary gallery uses current native item images instead of a stale thumbnail or recommendations',async()=>{
 const f=require('./fixtures/siteSupport/taith-squarespace.json'),profile=profiles.find(p=>p.name==='Taith'),{fetchSquarespaceProduct}=require('../src/siteSupport/squarespace'),data=structuredClone(f.data),current=data.item.assetUrl;
 data.item.items=[{assetUrl:current}];data.item.assetUrl=current.replace(/\/[^/]+$/,'/stale-thumbnail.jpg');
 const html=f.html.replace('</article>','<img class="product-gallery-slides-item-image" data-src="'+current+'"><aside class="recommendations"><img class="product-gallery-slides-item-image" data-src="https://other.example/another-coffee.jpg"></aside></article>');
 const read=async()=>({success:true,data:JSON.stringify(data)});assert.equal((await fetchSquarespaceProduct(html,f.url,profile,read)).image,current);
 const mismatched=html.replace(current,'https://other.example/foreign.jpg');await assert.rejects(fetchSquarespaceProduct(mismatched,f.url,profile,read),/primary image/);
 const foreign=structuredClone(data);foreign.item.items[0].assetUrl='https://other.example/foreign.jpg';await assert.rejects(fetchSquarespaceProduct(f.html,f.url,profile,async()=>({success:true,data:JSON.stringify(foreign)})),/image owner/);
});
test('captured Taith published customer inventory requires an uncapped page and exact native, frontend and rendered identities',async()=>{
 const f=require('./fixtures/siteSupport/taith-storefront.json'),profile=profiles.find(p=>p.name==='Taith'),{discoverSquarespaceProducts}=require('../src/siteSupport/squarespace'),roaster={website_url:f.url};
 const read=(listing=f.listing,html=f.html)=>async u=>({success:true,data:new URL(u).searchParams.get('format')==='json'?JSON.stringify(listing):html,status:200,finalUrl:u});
 const result=await discoverSquarespaceProducts(roaster,profile,read());assert.equal(result.complete,true);assert.equal(result.urls.length,33);assert.equal(result.inventory_authorizes_global_absence,false);assert.deepEqual(result.evidence.at(-1),{listing:f.url,published_items:49,configured_page_size:999,native_frontend_and_rendered_identities_match:true,inventory_scope:'published_storefront'});
 for(const change of [d=>d.collection.pageSize=40,d=>delete d.collection.pageSize,d=>d.pagination={nextPage:true},d=>d.pagination={pageSize:20},d=>d.items[0].workflowState=3,d=>d.collection.itemCount=48]){const listing=structuredClone(f.listing);change(listing);assert.equal((await discoverSquarespaceProducts(roaster,profile,read(listing))).complete,false);}
 const cheerio=require('cheerio');
 for(const change of [c=>c.collectionContext.websiteId='other-owner',c=>c.collectionId='other-collection',c=>c.collectionContext.fullUrl='/another-shop',c=>c.items[0].published=false,c=>c.items[0].title='Another product',c=>c.items[0].fullUrl='/shop/p/another-product',c=>c.items.pop(),c=>c.items[0]=c.items[1],c=>c.hasMore=true]){const $=cheerio.load(f.html),root=$('[data-controller="ProductList"]'),context=JSON.parse(root.attr('data-context'));change(context);root.attr('data-context',JSON.stringify(context));assert.equal((await discoverSquarespaceProducts(roaster,profile,read(f.listing,$.html()))).complete,false);}
 for(const change of [$=>$('.product-list-item').first().remove(),$=>$('.product-list-item').first().attr('data-product-id',$('.product-list-item').last().attr('data-product-id')),$=>$('.product-list-item-link').first().attr('href','/shop/p/another-product'),$=>$('[data-controller="ProductList"]').after($('[data-controller="ProductList"]').clone())]){const $=cheerio.load(f.html);change($);assert.equal((await discoverSquarespaceProducts(roaster,profile,read(f.listing,$.html()))).complete,false);}
 const failed=await discoverSquarespaceProducts(roaster,profile,async u=>new URL(u).search?read()(u):{success:false,error:'HTTP 503'});assert.equal(failed.complete,false);assert.match(failed.error,/503/);
});
test('WooCommerce and Squarespace sources adopt existing product IDs and slugs with idempotent exact variant saves',async()=>{
 const {catalogDb,supabaseAdapter}=require('./catalogDb'),{catalogPayload,findExistingProduct,productSourceKey}=require('../src/productSaver'),{canonicalProductUrl}=require('../src/catalogNormalization');
 for(const name of ['Substance','Taith']){
  const profile=profiles.find(p=>p.name===name),f=name==='Substance'?require('./fixtures/siteSupport/substance-woo.json')[0]:require('./fixtures/siteSupport/taith-squarespace.json');
  const source=name==='Substance'?await require('../src/siteSupport/woocommerce').fetchWooProduct(f.html,f.url,profile,async()=>({success:true,data:JSON.stringify([f.product])})):await require('../src/siteSupport/squarespace').fetchSquarespaceProduct(f.html,f.url,profile,async()=>({success:true,data:JSON.stringify(f.data)}));
  const product=normalizeProduct(structuredExtraction({sourceProduct:source,url:f.url},null).product,f.url),availability=productAvailability({sourceProduct:source,sourceUrl:f.url}),pg=await catalogDb();
  try{
   const owner=profile.entity_ids[0],id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';await pg.query('insert into entities(id) values($1)',[owner]);await pg.query('insert into products(id,entity_id,slug,name,source_url) values($1,$2,$3,$4,$5)',[id,owner,'existing-coffee-slug','Older title',f.url]);
   const existing=await findExistingProduct(supabaseAdapter(pg),owner,canonicalProductUrl(f.url),productSourceKey(owner,product,f.url)),payload=catalogPayload(owner,product,f.url,existing,availability,new Date().toISOString());
   await pg.query('select save_catalog_product_v2($1::jsonb)',[JSON.stringify(payload)]);await pg.query('select save_catalog_product_v2($1::jsonb)',[JSON.stringify(payload)]);
   assert.deepEqual((await pg.query('select id,slug from products')).rows,[{id,slug:'existing-coffee-slug'}]);
   const variants=(await pg.query('select merchant_variant_id,price_minor_units,currency,weight_g from product_variants order by merchant_variant_id')).rows;
   assert.deepEqual(variants,product.variants.map(v=>({merchant_variant_id:v.source_id,price_minor_units:v.money.minorUnits,currency:v.money.currency,weight_g:v.weight_g})).sort((a,b)=>a.merchant_variant_id.localeCompare(b.merchant_variant_id)));
  }finally{await pg.close();}
 }
});
