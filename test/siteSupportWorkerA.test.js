'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {labelWeight,parseShopifyProduct}=require('../src/shopifyProduct');
const {retailCoffee,discoverShopifyProducts}=require('../src/siteSupport/shopifyDiscovery');
test('Hydrangea current retail includes sold-out rested coffees and excludes exact recurring subscriptions',()=>{
 const p=require('../src/siteSupport/profiles.json').find(p=>p.name==='Hydrangea');
 assert(retailCoffee({title:'[Rested] Gesha',product_type:'Rested Coffee',handle:'rested-gesha'},p));
 assert(retailCoffee({title:'Castillo Rose Tea',product_type:'',handle:'rose'},p));
 assert(!retailCoffee({title:'Hydrangea Drops',product_type:'Coffee',handle:'sub'},p));
 assert(!retailCoffee({title:'Roaster Choice Subscription',product_type:'Coffee',handle:'2-bag-roasters-choice'},p));
});
test('dated explicit dual-unit net labels survive roast-date suffixes without accepting shipping mass or multipack ambiguity',()=>{
 assert.equal(labelWeight('8oz (227g) -10/4'),227);assert.equal(labelWeight('4oz (114g) - 8/23'),114);
 assert.equal(labelWeight('2 x 8oz (227g) - 10/4'),null);assert.equal(labelWeight('8oz (400g) - 10/4'),null);
 const p=parseShopifyProduct({title:'Rested coffee',variants:[{id:1,title:'8oz (227g) - 10/4',grams:400},{id:2,title:'Default Title',grams:400}]},{preferLabelWeight:true});
 assert.deepEqual(p.variants.map(v=>v.weightGrams),[227,null]);
});
test('live inspection cannot pass a partially priced or unidentified variant or unknown stock',()=>{
 const {inspectionErrors}=require('../src/siteSupport/cli');
 const p={source_product_id:'1',variants:[{source_id:'2',money:{minorUnits:2500,currency:'USD'},availability:'sold_out'}]};
 assert.deepEqual(inspectionErrors(p,{state:'sold_out'}),[]);
 assert.match(inspectionErrors({...p,variants:[...p.variants,{source_id:'3',money:{minorUnits:2000,currency:null},availability:'unknown'}]},{state:'sold_out'}).join(' '),/currency.*stock/);
 assert.match(inspectionErrors({...p,variants:[...p.variants,...p.variants]},{state:'sold_out'}).join(' '),/identities/);
});
test('captured ILSE public product keeps exact USD variant offers and independent sold-out size while excluding wholesale tags',()=>{
 const f=require('./fixtures/siteSupport/ilse-product.json'),{mergeShopifyStock,parseShopifyProduct}=require('../src/shopifyProduct'),{structuredExtraction}=require('../src/extraction'),{normalizeProduct}=require('../src/catalogNormalization');
 const html='<script type="application/ld+json">'+JSON.stringify(f.schema)+'</script>'+ (f.analytics?'<script>ShopifyAnalytics.meta.currency = '+JSON.stringify(f.analytics.currency)+'; var meta = '+JSON.stringify({product:f.analytics.product})+';</script>':'');
 const raw=mergeShopifyStock(f.product,f.ajax),p=normalizeProduct(structuredExtraction({html,url:f.url},{success:true,data:parseShopifyProduct(raw,{preferLabelWeight:true})}).product,f.url);
 assert.equal(p.source_product_id,'8137992994918');assert.deepEqual(p.variants.map(v=>v.money.minorUnits),[2900,5500,17000]);assert(p.variants.every(v=>v.money.currency==='USD'));
 assert.deepEqual(p.variants.map(v=>v.availability),['sold_out','in_stock','in_stock']);assert.deepEqual(p.variants.map(v=>v.weight_g),[125,250,907]);
 const profile=require('../src/siteSupport/profiles.json').find(p=>p.name==='ILSE');
 assert(!retailCoffee({title:'Faro Blend',product_type:'',tags:['wholesale-only'],body_html:'Coffee',handle:'faro-blend'},profile));
 assert(!retailCoffee({title:'Mystery object',product_type:'',body_html:'Home goods'},profile));
});
test('Leaves captured Nuxt primary JSON pairs JPY prices with exact native stock and rejects wrong identities without executing scripts',async()=>{
 const fs=require('node:fs'),{fetchNuxtShopifyProduct,nuxtPrimaryProduct}=require('../src/siteSupport/nuxtShopify'),{structuredExtraction}=require('../src/extraction'),{normalizeProduct}=require('../src/catalogNormalization');
 const html=fs.readFileSync(require('node:path').join(__dirname,'fixtures/siteSupport/leaves-nuxt-product.html'),'utf8'),stock=require('./fixtures/siteSupport/leaves-stock.json'),profile=require('../src/siteSupport/profiles.json').find(p=>p.name==='Leaves'),url='https://leavescoffee.jp/en/products/costa-rica-don-eli-1';
 const read=async u=>{assert.equal(u,'https://shop.leavescoffee.jp/products/costa-rica-don-eli-1.js');return {success:true,data:JSON.stringify(stock)};};
 const source=await fetchNuxtShopifyProduct(html,url,profile,read),p=normalizeProduct(structuredExtraction({html:'',sourceProduct:source,url},null).product,url);
 assert.deepEqual(p.variants.map(v=>v.money.minorUnits),[6000,24000]);assert(p.variants.every(v=>v.money.currency==='JPY'&&v.money.exponent===0));assert.deepEqual(p.variants.map(v=>v.weight_g),[100,500]);assert(p.variants_complete);
 assert.notEqual(stock.variants[0].price,p.variants[0].money.minorUnits);
 await assert.rejects(fetchNuxtShopifyProduct(html,url.replace('don-eli-1','other'),profile,read),/Exact Nuxt/);
 for(const bad of [{...stock,id:1},{...stock,variants:stock.variants.slice(0,1)},{...stock,variants:[stock.variants[0],stock.variants[0]]}])await assert.rejects(fetchNuxtShopifyProduct(html,url,profile,async()=>({success:true,data:JSON.stringify(bad)})),/mismatch/);
 assert.equal(nuxtPrimaryProduct(html+html),null);assert.equal(nuxtPrimaryProduct('<script id="__NUXT_DATA__" type="application/json">(globalThis.PWNED=true,[])</script>'),null);assert.equal(globalThis.PWNED,undefined);
});
test('Leaves listing exhausts native catalog but preserves original public product URLs and rejects unreviewed auxiliary routes',async()=>{
 const {createReader}=require('../src/siteSupport/network'),profile=require('../src/siteSupport/profiles.json').find(p=>p.name==='Leaves'),requests=[];
 const result=await discoverShopifyProducts({website_url:'https://leavescoffee.jp/en'},profile,async u=>{requests.push(u);return {success:true,finalUrl:u,data:JSON.stringify({products:requests.length===1?[{id:1,title:'Coffee',handle:'coffee',product_type:'Coffee'}]:[]})};});
 assert.equal(result.complete,true);assert.deepEqual(result.urls,['https://leavescoffee.jp/en/products/coffee']);assert(requests.every(u=>new URL(u).hostname==='shop.leavescoffee.jp'));
 const reader=createReader(profile);for(const path of ['/admin/api/2026-01/graphql.json','/api/2026-01/graphql.json','/en/pages/legal-notice','/terms'])assert.equal((await reader.fetchHtml('https://shop.leavescoffee.jp'+path)).success,false);assert.equal(reader.requests.length,0);
});
test('Loquat Square coffee categories exclude a brewer while retaining explicit sold-out coffee and fail on another owner',async()=>{
 const {discoverSquareProducts}=require('../src/siteSupport/square'),profile={...require('../src/siteSupport/profiles.json').find(p=>p.name==='Loquat'),coffee_category_ids:['E2NAAAIQSSCHVFYWD4T727FT']},context=require('./fixtures/siteSupport/loquat-context.json'),html='<script>window.__BOOTSTRAP_STATE__ = '+JSON.stringify(context)+';</script>';
 const coffee={id:'COFFEE',owner_id:profile.square_owner_id,categoryIds:profile.coffee_category_ids,visibility:'visible',name:'Sold out coffee',absolute_site_link:'https://www.loquatcoffee.com/product/sold-coffee/123'},brewer={...coffee,id:'BREWER',name:'OREA X Loquat O1 Brewer (Limited Edition)',absolute_site_link:'https://www.loquatcoffee.com/product/brewer/456'};
 const read=async u=>({success:true,data:u==='https://www.loquatcoffee.com/'?html:JSON.stringify({data:[coffee,brewer],meta:{pagination:{current_page:1,total_pages:1,total:2}}})});
 const r=await discoverSquareProducts({website_url:'https://www.loquatcoffee.com/'},profile,read);assert.equal(r.complete,true);assert.deepEqual(r.urls,[coffee.absolute_site_link]);
 const bad=await discoverSquareProducts({website_url:'https://www.loquatcoffee.com/'},profile,async u=>u.endsWith('/')?read(u):{success:true,data:JSON.stringify({data:[{...coffee,owner_id:'other'}],meta:{pagination:{current_page:1,total_pages:1,total:1}}})});assert.equal(bad.complete,false);assert.match(bad.error,/different merchant/);
});
test('Loquat explicit coffee volume is net mass and shipping weight, paid per-kg cost, or conflicting pack sizes cannot supply it',()=>{
 const {explicitNetWeight}=require('../src/siteSupport/netWeight');assert.equal(explicitNetWeight('<p>Volume: 60g</p><p>The price paid: USD 277.65 / KG</p>'),60);assert.equal(explicitNetWeight('<p>Volume: 20g</p>','Coffee (20g) *LAST BATCH*'),20);
 for(const value of ['<p>Shipping Weight: 260g</p>','<p>Weight: 2 x 250g</p>','<p>Volume: 100g / 500g</p>','<p>Volume: 20g</p><p>Net Weight: 60g</p>'])assert.equal(explicitNetWeight(value),null);
});
test('explicit bundled coffee total is retained without deriving total from a multipack or shipping mass',()=>{
 const {explicitNetWeight}=require('../src/siteSupport/netWeight');assert.equal(explicitNetWeight('<p>Total Coffee:<br>12 boxes × 200g<br><strong>2.4 kg of coffee in total</strong></p>'),2400);assert.equal(explicitNetWeight('<p>12 boxes × 200g</p>'),null);
 assert.equal(parseShopifyProduct({title:'Tier 1',body_html:'<p>2.4 kg of coffee in total</p>',variants:[{id:1,title:'Default Title',grams:2900}]},{preferLabelWeight:true}).variants[0].weightGrams,2400);
});
test('Luminous captured native tier description explicitly declares 2.4kg total rather than its shipping mass',()=>{
 const f=require('./fixtures/siteSupport/luminous-tier.json');assert.equal(parseShopifyProduct(f,{preferLabelWeight:true}).variants[0].weightGrams,2400);
 const profile=require('../src/siteSupport/profiles.json').find(p=>p.name==='Luminous');assert(retailCoffee({title:'Mexico Lot 41',product_type:'drop-store'},profile));assert(!retailCoffee({title:'COFFEE PROCESSING T-SHIRT MOSS',product_type:'drop-store'},profile));
});
test('Monogram preserves current US market URLs and adopts old base product identity',()=>{
 const {canonicalProductUrl}=require('../src/catalogNormalization'),profile=require('../src/siteSupport/profiles.json').find(p=>p.name==='Monogram');assert.equal(profile.product_path,'/en-us/products/');assert.equal(canonicalProductUrl('https://monogramcoffee.com/en-us/products/warmth-filter-blend'),canonicalProductUrl('https://monogramcoffee.com/products/warmth-filter-blend'));
 const f=require('./fixtures/siteSupport/monogram-product.json'),{mergeShopifyStock}=require('../src/shopifyProduct'),{structuredExtraction}=require('../src/extraction'),{normalizeProduct}=require('../src/catalogNormalization');
 const html='<script type="application/ld+json">'+JSON.stringify(f.schema)+'</script>'+(f.analytics?'<script>ShopifyAnalytics.meta.currency = '+JSON.stringify(f.analytics.currency)+'; var meta = '+JSON.stringify({product:f.analytics.product})+';</script>':'');
 const p=normalizeProduct(structuredExtraction({html,url:f.url},{success:true,data:parseShopifyProduct(mergeShopifyStock(f.product,f.ajax),{preferLabelWeight:true})}).product,f.url);
 assert.equal(p.variants.length,3);assert(p.variants.every(v=>v.money.currency==='USD'));assert.deepEqual(p.variants.map(v=>v.money.minorUnits),[1800,4900,11700]);assert.deepEqual(p.variants.map(v=>v.weight_g),[300,907,2268]);
});
test('Namusairo exact Korean size/grind SKUs retain KRW offers, net weights, and primary merchant description',()=>{
 const fs=require('fs'),path=require('path'),group=require('./fixtures/siteSupport/namusairo-group.json'),url='https://namusairo.com/product/detail.html?product_no=1148',html='<script type="application/ld+json">'+JSON.stringify(group)+'</script>'+fs.readFileSync(path.join(__dirname,'fixtures/siteSupport/namusairo-detail.html'),'utf8'),{structuredExtraction}=require('../src/extraction'),{normalizeProduct}=require('../src/catalogNormalization');
 const p=normalizeProduct(structuredExtraction({html,url},null).product,url);assert.equal(p.source_product_id,'cafe24_namusairocoffee_1_1148');assert.equal(p.variants.length,3);assert(p.variants.every(v=>v.money.currency==='KRW'&&v.money.minorUnits===12000&&v.weight_g===100&&v.availability==='in_stock'));assert.match(p.description_raw,/Jesus Arbey Iquira/);assert(!p.variants_complete);
 const bad=structuredClone(group);bad.hasVariant[0].offers.url='https://namusairo.com/product/other/999/';assert.equal(structuredExtraction({html:'<script type="application/ld+json">'+JSON.stringify(bad)+'</script>',url},null).product,null);
});
test('Cafe24 discovery deduplicates category/path aliases by product number and rejects malformed public product links',async()=>{
 const profile=require('../src/siteSupport/profiles.json').find(p=>p.name==='Namusairo'),{discoverDomProducts}=require('../src/siteSupport/domDiscovery'),html='<ul class="xans-product-listnormal"><li><div class="thumbnail"><a href="/product/coffee/1148/category/91/display/1/">Coffee</a></div></li><li><div class="thumbnail"><a href="/product/coffee/1148/category/113/display/1/">Coffee</a></div></li></ul><div class="xans-product-normalpaging"><ol><a class="this">1</a></ol></div>';
 const r=await discoverDomProducts({website_url:'https://namusairo.com'},profile,async u=>({success:true,finalUrl:u,data:html}));assert(r.complete);assert.deepEqual(r.urls,['https://namusairo.com/product/detail.html?product_no=1148']);
 const bad=await discoverDomProducts({website_url:'https://namusairo.com'},profile,async u=>({success:true,finalUrl:u,data:html.replaceAll('/1148/','/wrong/')}));assert.equal(bad.complete,false);assert.match(bad.error,/Invalid merchant/);
});
test('guarded reader rejects Cafe24 accounts/legal routes and every terms variant before any request',async()=>{
 const {createReader}=require('../src/siteSupport/network'),profile=require('../src/siteSupport/profiles.json').find(p=>p.name==='Namusairo'),reader=createReader(profile);
 for(const p of ['/terms','/terms-of-service','/legal-notice','/member/login.html','/myshop/index.html','/shopinfo/guide.html','/customer_authentication/redirect'])assert.equal((await reader.fetchHtml('https://namusairo.com'+p)).success,false);assert.equal(reader.requests.length,0);
});
test('Obadiah approved coffee packs use native identity while unknown untyped equipment remains excluded',async()=>{
 const profile=require('../src/siteSupport/profiles.json').find(p=>p.name==='Obadiah'),{fetchShopifyProductJson,mergeShopifyStock}=require('../src/shopifyProduct'),{structuredExtraction}=require('../src/extraction'),{normalizeProduct}=require('../src/catalogNormalization');assert(retailCoffee({title:'Chelin Pack',handle:'chelin-pack',product_type:''},profile));assert(!retailCoffee({title:'Option-O Lagom Casa',handle:'option-o-lagom-casa',product_type:''},profile));
 let reads=0;const bad=await fetchShopifyProductJson('https://obadiahcoffee.com/products/tinamit-honey',null,{fetchJson:async()=>{reads++;return {success:true,data:{product:{id:1,handle:'another-coffee',variants:[]}}};}});assert.equal(bad.success,false);assert.match(bad.error,/identity mismatch/);assert.equal(reads,1);
 const f=require('./fixtures/siteSupport/obadiah-product.json'),html='<script type="application/ld+json">'+JSON.stringify(f.schema)+'</script>'+(f.analytics?'<script>ShopifyAnalytics.meta.currency = '+JSON.stringify(f.analytics.currency)+'; var meta = '+JSON.stringify({product:f.analytics.product})+';</script>':'');
 const p=normalizeProduct(structuredExtraction({html,url:f.url},{success:true,data:parseShopifyProduct(mergeShopifyStock(f.product,f.ajax),{preferLabelWeight:true})}).product,f.url);assert(p.variants.every(v=>v.money.currency==='USD'));assert.deepEqual(p.variants.map(v=>v.money.minorUnits),[2493,4178,7816]);assert.deepEqual(p.variants.map(v=>v.weight_g),[250,500,1000]);
});
test('ONA exact blend and grind/size variants keep paired AUD money and reject recurring coffee subscriptions',()=>{
 assert(retailCoffee({title:'Raspberry Candy',product_type:'Coffee',tags:['subscription'],handle:'raspberry-candy'},require('../src/siteSupport/profiles.json').find(p=>p.name==='ONA')));
 const profile=require('../src/siteSupport/profiles.json').find(p=>p.name==='ONA'),f=require('./fixtures/siteSupport/ona-product.json'),{mergeShopifyStock}=require('../src/shopifyProduct'),{structuredExtraction}=require('../src/extraction'),{normalizeProduct}=require('../src/catalogNormalization'),html='<script type="application/ld+json">'+JSON.stringify(f.schema)+'</script>'+(f.analytics?'<script>ShopifyAnalytics.meta.currency = '+JSON.stringify(f.analytics.currency)+'; var meta = '+JSON.stringify({product:f.analytics.product})+';</script>':'');
 const p=normalizeProduct(structuredExtraction({html,url:f.url},{success:true,data:parseShopifyProduct(mergeShopifyStock(f.product,f.ajax),{preferLabelWeight:true})}).product,f.url);assert(p.variants.length>1);assert(p.variants.every(v=>v.money.currency==='AUD'&&v.money.minorUnits!=null&&v.source_id&&v.weight_g));assert.equal(new Set(p.variants.map(v=>v.source_id)).size,p.variants.length);
 assert(!retailCoffee({title:'Single Origin Subscription (Filter Coffee)',product_type:'Coffee'},profile));assert(retailCoffee({title:'Reserve Instant Coffee',product_type:'Coffee'},profile));
});
test('reviewed ONA four-coffee bundle leaves combined net mass unset when its option does not state per-bag versus total',()=>{
 const profile=require('../src/siteSupport/profiles.json').find(p=>p.name==='ONA');assert(profile.ambiguous_net_weight_handles.includes('milk-blend-bundle'));
 const native=parseShopifyProduct({title:'Milk-Blend Bundle',handle:'milk-blend-bundle',body_html:'Includes 1x Raspberry Candy 1x Gateway 1x Aspen 1x Maple. Available in 200g or 1kg options.',variants:[{id:1,title:'200g',grams:2000},{id:2,title:'1kg',grams:4000}]},{preferLabelWeight:true,netWeightUnproven:true});assert.deepEqual(native.variants.map(v=>v.weightGrams),[null,null]);
 const {structuredExtraction}=require('../src/extraction'),{normalizeProduct}=require('../src/catalogNormalization'),url='https://onacoffee.com.au/products/milk-blend-bundle',product=normalizeProduct(structuredExtraction({html:'',url},{success:true,data:native}).product,url);assert.deepEqual(product.variants.map(v=>v.weight_g),[null,null]);assert.deepEqual(normalizeProduct(product,url).variants.map(v=>v.weight_g),[null,null]);
});
