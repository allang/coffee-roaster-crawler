'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fetchWooProduct,discoverWooProducts}=require('../src/siteSupport/woocommerce');
const {structuredExtraction}=require('../src/extraction');
const {normalizeProduct,canonicalProductUrl}=require('../src/catalogNormalization');
const {productAvailability}=require('../src/productEvidence');
const {catalogDb,supabaseAdapter}=require('./catalogDb');
const {catalogPayload,findExistingProduct}=require('../src/productSaver');
const {createReader}=require('../src/siteSupport/network');
const profile=require('../src/siteSupport/profiles.json').find(p=>p.name==='DAK Coffee Roasters');
const fixture=require('./fixtures/siteSupport/dak-woocommerce.json');
const {retailCoffee}=require('../src/siteSupport/shopifyDiscovery');
const fs=require('node:fs'),path=require('node:path');
const {routerField,hydrogenProduct,discoverHydrogenProducts}=require('../src/siteSupport/hydrogen');
const hydrogenProfile=require('../src/siteSupport/profiles.json').find(p=>p.name==='Passenger');
const hydrogenHtml=fs.readFileSync(path.join(__dirname,'fixtures/siteSupport/passenger-product-hydrogen.html'),'utf8');
const hydrogenListing=fs.readFileSync(path.join(__dirname,'fixtures/siteSupport/passenger-listing-hydrogen.html'),'utf8');
const {storeData,discoverWixProducts,wixProduct}=require('../src/siteSupport/wix');
const wixProfile=require('../src/siteSupport/profiles.json').find(p=>p.name==='The Picky Chemist');
const wixHtml=kind=>fs.readFileSync(path.join(__dirname,'fixtures/siteSupport/picky-'+kind+'-wix.html'),'utf8');
const wixPage=store=>'<script id="wix-warmup-data" type="application/json">'+JSON.stringify({appsWarmupData:{'1380b703-ce81-ff05-f115-39571d94dfcd':store}})+'</script>';
const {fetchCafe24Product}=require('../src/siteSupport/cafe24');
const aeryProfile=require('../src/siteSupport/profiles.json').find(p=>p.name==='Aery');
const aeryListing=fs.readFileSync(path.join(__dirname,'fixtures/siteSupport/aery-listing.html'),'utf8');
const aeryHtml=id=>fs.readFileSync(path.join(__dirname,'fixtures/siteSupport/aery-product-'+id+'.html'),'utf8');
function routerPage(route,field,value) {
  const table=[];
  function flatten(v){if(v===null)return -5;if(v===undefined)return -7;const index=table.length;table.push(null);table[index]=Array.isArray(v)?v.map(flatten):typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>['_'+flatten(k),flatten(x)])):v;return index;}
  flatten({loaderData:{[route]:{[field]:value}}});
  return '<script>window.__reactRouterContext.streamController.enqueue('+JSON.stringify(JSON.stringify(table))+');</script>';
}
const url=fixture.product.permalink,html='<body class="single-product postid-7748"></body>';
const response=value=>({success:true,data:JSON.stringify(value)});
const read=async value=>response([fixture.product,...fixture.variants].find(p=>String(p.id)===value.split('/').pop()));
test('captured DAK Store API pairs each exact variant with EUR money and explicit net size, never shared SKU or shipping weight',async()=>{
  const source=await fetchWooProduct(html,url,profile,read),product=normalizeProduct(structuredExtraction({html,url,sourceProduct:source},null).product,url);
  assert.equal(product.source_product_id,'7748');assert.equal(product.variants_complete,true);
  assert.deepEqual(product.variants.map(v=>v.source_id),['8755','8756','7749','7750']);
  assert.deepEqual(product.variants.map(v=>v.money.minorUnits),[7920,2195,2195,7920]);
  assert(product.variants.every(v=>v.money.currency==='EUR'));assert.deepEqual(product.variants.map(v=>v.weight_g),[1000,250,250,1000]);
  assert.equal(productAvailability({sourceProduct:source,sourceUrl:url}).state,'in_stock');
  assert.equal(canonicalProductUrl(source.offers[0].url),canonicalProductUrl(url));
  const bad=structuredClone(fixture.variants[0]);bad.parent=999;
  await assert.rejects(fetchWooProduct(html,url,profile,async value=>value.endsWith('/8755')?response(bad):read(value)),/parent mismatch/);
  const price=structuredClone(fixture.variants[0]);delete price.prices.currency_code;
  await assert.rejects(fetchWooProduct(html,url,profile,async value=>value.endsWith('/8755')?response(price):read(value)),/price\/currency/);
  await assert.rejects(fetchWooProduct('<body class="postid-7748 postid-999">',url,profile,read),/ambiguous/);
});
test('WooCommerce discovery requires complete stable published totals, preserves sold-out coffees, and excludes goods',async()=>{
  const product=structuredClone(fixture.product);product.is_in_stock=false;
  const goods={...product,id:999,categories:[{id:45}],name:'Cupping Spoon'};
  let calls=0;
  const result=await discoverWooProducts({website_url:url},profile,async value=>({success:true,catalogTotal:2,catalogPages:2,data:JSON.stringify(++calls===1?[product]:[goods])}));
  assert.equal(result.complete,true);assert.deepEqual(result.urls,[url]);assert.equal(calls,2);
  const noTotals=await discoverWooProducts({website_url:url},profile,async()=>response([product]));assert.equal(noTotals.complete,false);
  const partial=await discoverWooProducts({website_url:url},profile,async()=>({success:true,catalogTotal:2,catalogPages:1,data:JSON.stringify([product])}));assert.equal(partial.complete,false);assert.match(partial.error,/total mismatch/);
});
test('WooCommerce catalog safety rejects GET cart actions, account, basket, legal and order routes before requesting',async()=>{
  const reader=createReader(profile);
  for(const path of ['/?add-to-cart=7748','/?wc-ajax=checkout','/my-account/','/order/basket.html','/legal/','/en/terms-conditions/','/%2574erms/'])assert.equal((await reader.fetchHtml('https://www.dakcoffeeroasters.com'+path)).success,false);
  assert.equal(reader.requests.length,0);
});
test('Loveless wholesale-only tags exclude dedicated inventory while mixed retail/wholesale coffees remain in retail',()=>{
  assert.equal(retailCoffee({title:'Darling',product_type:'Coffee',tags:['Coffee','wholesale-only']},{coffee_product_types:['Coffee','']}),false);
  assert.equal(retailCoffee({title:'Daybreak',product_type:'',tags:'coffee,wholesale'},{coffee_product_types:['']}),false);
  assert.equal(retailCoffee({title:'Danche Station',product_type:'Coffee',tags:['rare']},{}),true);
  assert.equal(retailCoffee({title:'Caramel Chimera',product_type:'Coffee',tags:['Catalog','wholesale']},{}),true);
  assert.equal(retailCoffee({title:'Alma Pineda - Cup of Excellence - Honduras',product_type:'Coffee'},{}),true);
  assert.equal(retailCoffee({title:'Coffee Cup',product_type:'Coffee'},{}),false);
});
test('captured Loveless mixed-use collection keeps all 12 retail coffees and excludes five wholesale-only entries plus a gift card',async()=>{
  const profile=require('../src/siteSupport/profiles.json').find(p=>p.name==='Loveless'),fixture=require('./fixtures/siteSupport/loveless-shopify.json'),{discoverShopifyProducts}=require('../src/siteSupport/shopifyDiscovery');
  const result=await discoverShopifyProducts({website_url:'https://lovelesscoffees.coffee'},profile,async value=>response({products:new URL(value).searchParams.get('page')==='1'?fixture.products:[]}));assert.equal(result.complete,true);assert.equal(result.urls.length,12);assert(result.urls.some(u=>u.includes('caramel-chimera')));assert(!result.urls.some(u=>u.endsWith('/darling')));
});
test('Aery merchant-only discovery enumerates all 18 published coffees including sold-out lots, but missing database owner never registers a normal crawler profile',async()=>{
  const {discoverSiteProducts,discoverProfileProducts,profileFor}=require('../src/siteSupport/discovery'),roaster={website_url:'https://aerycoffee.com'},read=async()=>({success:true,data:aeryListing});
  assert.equal(profileFor(roaster),null);assert.equal((await discoverSiteProducts(roaster,{fetchHtml:read})).supported,false);
  const inventory=await discoverProfileProducts(roaster,aeryProfile,read);assert.equal(inventory.complete,true);assert.equal(inventory.urls.length,18);assert(inventory.urls.includes('https://aerycoffee.com/product/detail.html?product_no=233'));assert(!inventory.urls.includes('https://aerycoffee.com/product/detail.html?product_no=178'));
  await assert.rejects(discoverProfileProducts(roaster,{...aeryProfile},read),/Unreviewed/);
  const missing=await discoverProfileProducts(roaster,aeryProfile,async()=>({success:true,data:aeryListing.replace(/<div class="xans-element- xans-product xans-product-normalpaging[\s\S]*$/,'')}));assert.equal(missing.complete,false);
});
test('captured Aery Cafe24 single-item literals bind exact native IDs and paired USD money without JSON-LD, script execution, shipping mass or synthesized variants',async()=>{
  const read=async()=>({success:true,data:aeryListing}),url='https://aerycoffee.com/product/detail.html?product_no=233',source=await fetchCafe24Product(aeryHtml('233'),url,aeryProfile,read),normalized=normalizeProduct(structuredExtraction({html:'',url,sourceProduct:source},null).product,url);
  assert.equal(normalized.source_product_id,'233');assert.equal(normalized.variants.length,1);assert.equal(normalized.variants[0].source_id,'P00000IZ000A');assert.equal(normalized.variants[0].money.currency,'USD');assert.equal(normalized.variants[0].money.minorUnits,3800);assert.equal(normalized.variants[0].weight_g,50);assert.equal(normalized.variants[0].availability,'in_stock');assert.equal(source.offers[0]._stock_evidence.inventory_managed,false);assert.equal(source.offers[0]._stock_evidence.stock_number,0);
  assert.equal(source._description_image_urls.length,2);assert(structuredExtraction({html:'',url,sourceProduct:source},null).product.description_html.includes('https://ecimg.cafe24img.com/'));assert.equal(structuredExtraction({html:'',url,sourceProduct:source},null).product.description_raw,null);
  const oldUrl='https://aerycoffee.com/product/detail.html?product_no=132',old=await fetchCafe24Product(aeryHtml('132'),oldUrl,aeryProfile,read);assert.equal(old.offers[0]['@id'],'P00000FC000A');assert.equal(old.offers[0]._net_weight_g,30);assert.equal(productAvailability({sourceProduct:old,sourceUrl:oldUrl}).state,'sold_out');
  const managedUrl='https://aerycoffee.com/product/detail.html?product_no=212',managed=await fetchCafe24Product(aeryHtml('212'),managedUrl,aeryProfile,read);assert.equal(productAvailability({sourceProduct:managed,sourceUrl:managedUrl}).state,'in_stock');assert.equal(managed.offers[0]._stock_evidence.sellout_policy,'T');assert.equal(managed.offers[0]._stock_evidence.merchant_soldout,'F');assert.equal(managed.offers[0]._stock_evidence.stock_number,2);
  const manualUrl='https://aerycoffee.com/product/detail.html?product_no=205',manual=await fetchCafe24Product(aeryHtml('205'),manualUrl,aeryProfile,read);assert.equal(productAvailability({sourceProduct:manual,sourceUrl:manualUrl}).state,'sold_out');assert.equal(manual.offers[0]._stock_evidence.inventory_managed,false);assert.equal(manual.offers[0]._stock_evidence.sellout_policy,'F');
  await assert.rejects(fetchCafe24Product(aeryHtml('233').replace("has_option = 'F'","has_option = 'T'"),url,aeryProfile,read),/unsupported/);
  await assert.rejects(fetchCafe24Product(aeryHtml('233'),oldUrl,aeryProfile,read),/identity mismatch/);
  await assert.rejects(fetchCafe24Product(aeryHtml('233').replace('property="product:sale_price:currency"','property="unrelated-currency"'),url,aeryProfile,read),/currency missing/);
  globalThis.aeryScriptRan=false;await fetchCafe24Product(aeryHtml('233')+'<script>globalThis.aeryScriptRan=true</script>',url,aeryProfile,read);assert.equal(globalThis.aeryScriptRan,false);delete globalThis.aeryScriptRan;
});
test('captured Passenger primary Hydrogen product binds native variants, USD money and net weight without running scripts',()=>{
  const url='https://drinkpassenger.com/products/keystone-blend',source=hydrogenProduct(hydrogenHtml,url,hydrogenProfile);
  const product=normalizeProduct(structuredExtraction({html:hydrogenHtml,url,sourceProduct:source},null).product,url);
  assert.equal(product.source_product_id,'7747879370942');assert.equal(product.variants_complete,false);
  assert.equal(canonicalProductUrl(url+'?Size=250+g'),canonicalProductUrl(url));
  assert.deepEqual(product.variants.map(v=>v.source_id),['44827115061438','43033496846526','43033497075902']);
  assert.deepEqual(product.variants.map(v=>v.money.minorUnits),[2125,5600,12100]);assert(product.variants.every(v=>v.money.currency==='USD'));
  assert.deepEqual(product.variants.map(v=>v.weight_g),[250,907,2268]);
  assert.equal(productAvailability({sourceProduct:source,sourceUrl:url}).state,'in_stock');
  assert.throws(()=>hydrogenProduct(hydrogenHtml,'https://drinkpassenger.com/products/agaro',hydrogenProfile),/mismatch/);
  assert.throws(()=>hydrogenProduct(hydrogenHtml+hydrogenHtml,url,hydrogenProfile),/ambiguous/);
  globalThis.merchantScriptExecuted=false;
  assert(hydrogenProduct(hydrogenHtml+'<script>globalThis.merchantScriptExecuted=true</script>',url,hydrogenProfile));assert.equal(globalThis.merchantScriptExecuted,false);delete globalThis.merchantScriptExecuted;
});
test('Passenger Hydrogen inventory follows the exact public next cursor and fails closed on repeated pages or missing links',async()=>{
  const primary=routerField(hydrogenListing,hydrogenProfile.collection_route,'collection');assert.equal(primary.products.pageInfo.hasNextPage,true);
  let calls=0;const result=await discoverHydrogenProducts({website_url:'https://drinkpassenger.com'},hydrogenProfile,async()=>({success:true,data:hydrogenListing}));
  assert.equal(result.complete,false);assert.match(result.error,/repeated/);assert(result.urls.length>10);
  assert(!result.urls.some(u=>u.includes('subscription')));assert(result.urls.some(u=>u.includes('keystone-blend')));
  const missing=await discoverHydrogenProducts({website_url:'https://drinkpassenger.com'},hydrogenProfile,async()=>({success:true,data:hydrogenListing.replace(/<a[\s\S]*$/,'')}));
  assert.equal(missing.complete,false);assert.match(missing.error,/next-page link/);
  const last={handle:'coffee',products:{nodes:[{id:'gid://shopify/Product/999',handle:'later-coffee',productType:'Coffee',title:'Later coffee'}],pageInfo:{hasNextPage:false}}};
  const complete=await discoverHydrogenProducts({website_url:'https://drinkpassenger.com'},hydrogenProfile,async()=>({success:true,data:++calls===1?hydrogenListing:routerPage(hydrogenProfile.collection_route,'collection',last)}));
  assert.equal(complete.complete,true);assert.equal(calls,2);assert(complete.urls.includes('https://drinkpassenger.com/products/later-coffee'));
});
test('Hydrogen explicitly published backorders remain unknown immediate stock with exact merchant evidence; missing stock and wrong parent IDs fail closed',()=>{
  const product=routerField(hydrogenHtml,hydrogenProfile.product_route,'parsedProduct'),url='https://drinkpassenger.com/products/keystone-blend';
  product.variants[0].currentlyNotInStock=true;
  const source=hydrogenProduct(routerPage(hydrogenProfile.product_route,'parsedProduct',product),url,hydrogenProfile);
  const normalized=normalizeProduct(structuredExtraction({html:'',url,sourceProduct:source},null).product,url);
  assert.equal(normalized.variants[0].availability,'unknown');assert.equal(normalized.variants[0].stock_evidence.availability,'https://schema.org/BackOrder');
  assert.equal(normalized.variants[0].stock_evidence.available_for_sale,true);
  delete product.variants[0].currentlyNotInStock;assert.throws(()=>hydrogenProduct(routerPage(hydrogenProfile.product_route,'parsedProduct',product),url,hydrogenProfile),/stock missing/);
  product.variants[0].product.id='gid://shopify/Product/999';assert.throws(()=>hydrogenProduct(routerPage(hydrogenProfile.product_route,'parsedProduct',product),url,hydrogenProfile),/mismatch/);
});
test('captured Tanat wildcard grind stays one exact EUR variant with explicit net size and a scoped coffee-only API query',async()=>{
  const {product,variant}=require('./fixtures/siteSupport/tanat-woocommerce.json'),profile=require('../src/siteSupport/profiles.json').find(p=>p.name==='Tanat');
  const read=async value=>response(value.endsWith('/50836')?product:variant),url=product.permalink;
  const source=await fetchWooProduct('<body class="postid-50836">',url,profile,read);
  const normalized=normalizeProduct(structuredExtraction({html:'',url,sourceProduct:source},null).product,url);
  assert.equal(normalized.variants.length,1);assert.equal(normalized.variants[0].source_id,'50837');assert.equal(normalized.variants[0].weight_g,100);
  assert.equal(normalized.variants[0].money.currency,'EUR');assert.equal(normalized.variants[0].money.minorUnits,5990);
  const requested=[];const discovered=await discoverWooProducts({website_url:'https://tanat.coffee'},profile,async value=>{requested.push(value);return {success:true,catalogTotal:1,catalogPages:1,data:JSON.stringify([product])};});
  assert.equal(discovered.complete,true);assert.equal(new URL(requested[0]).searchParams.get('category'),'18');assert.equal(new URL(requested[0]).searchParams.get('per_page'),'50');
  assert.deepEqual(discovered.urls,[url]);
});
test('Woo native option slugs resolve only to the declared display label; multi-bag offers never become a fabricated aggregate weight',async()=>{
  const fixture=require('./fixtures/siteSupport/tanat-woocommerce.json'),profile=require('../src/siteSupport/profiles.json').find(p=>p.name==='Tanat');
  const product=structuredClone(fixture.product);product.attributes.find(a=>a.name==='Poids').terms=[{name:'1 kg',slug:'1-kg'}];product.variations[0].attributes.find(a=>a.name==='Poids').value='1-kg';
  const read=async value=>response(value.endsWith('/50836')?product:fixture.variant),url=product.permalink;
  let source=await fetchWooProduct('<body class="postid-50836">',url,profile,read),normalized=normalizeProduct(structuredExtraction({html:'',url,sourceProduct:source},null).product,url);assert.equal(normalized.variants[0].weight_g,1000);assert.equal(normalized.variants[0].source_id,'50837');
  product.attributes.find(a=>a.name==='Poids').terms=[{name:'2 x 200g',slug:'2-x-200g'}];product.variations[0].attributes.find(a=>a.name==='Poids').value='2-x-200g';source=await fetchWooProduct('<body class="postid-50836">',url,profile,read);normalized=normalizeProduct(structuredExtraction({html:'',url,sourceProduct:source},null).product,url);assert.equal(normalized.variants[0].weight_g,null);
});
test('captured Picky Chemist Wix variants retain native UUIDs, paired EUR amounts and exact net sizes without shipping weights or invented roast SKUs',()=>{
  const p=Object.values(storeData(wixHtml('managed')))[0].catalog.product,url='https://en.thepickychemist.com/product-page/'+p.urlPart;
  const source=wixProduct(wixHtml('managed'),url,wixProfile),normalized=normalizeProduct(structuredExtraction({html:'',url,sourceProduct:source},null).product,url);
  assert.equal(normalized.source_product_id,'a498a140-8280-cdd7-b962-539e07d88737');assert.equal(normalized.variants_complete,true);
  assert.deepEqual(normalized.variants.map(v=>v.source_id),p.productItems.map(v=>v.id));assert.deepEqual(normalized.variants.map(v=>v.weight_g),[80,250,80,250]);assert.deepEqual(normalized.variants.map(v=>v.money.minorUnits),[4800,14000,4800,14000]);assert(normalized.variants.every(v=>v.money.currency==='EUR' && v.availability==='sold_out'));
  assert(source.description.includes('Geisha'));assert.equal(productAvailability({sourceProduct:source,sourceUrl:url}).state,'sold_out');
  const single=Object.values(storeData(wixHtml('unmanaged')))[0].catalog.product,singleUrl='https://en.thepickychemist.com/product-page/'+single.urlPart;
  single.weight=9.9;single.productItems[0].weight=10;
  const singleSource=wixProduct(wixPage({productPage_EUR_primary:{catalog:{product:single}}}),singleUrl,wixProfile),one=normalizeProduct(structuredExtraction({html:'',url:singleUrl,sourceProduct:singleSource},null).product,singleUrl);
  assert(singleUrl.endsWith('250g'));assert.equal(one.variants.length,1);assert.equal(one.variants[0].weight_g,200);assert.equal(one.variants[0].source_id,'66fe22ad-3699-4e88-999c-a46b42f7d821');
  assert.throws(()=>wixProduct(wixHtml('managed'),singleUrl,wixProfile),/mismatch/);
  assert.throws(()=>wixProduct(wixHtml('managed')+wixHtml('managed'),url,wixProfile),/ambiguous/);
  delete p.currency;assert.throws(()=>wixProduct(wixPage({productPage_EUR_primary:{catalog:{product:p}}}),url,wixProfile),/currency missing/);
});
test('Wix current shop discovery requires the exact reviewed category and full native total; partial variant matrices never retire hidden variants',async()=>{
  const result=await discoverWixProducts({website_url:'https://en.thepickychemist.com'},wixProfile,async()=>({success:true,data:wixHtml('listing')}));assert.equal(result.complete,true);assert.equal(result.urls.length,5);
  const store=storeData(wixHtml('listing')),category=store[wixProfile.wix_listing_key].catalog.category;category.productsWithMetaData.totalCount=6;
  const incomplete=await discoverWixProducts({website_url:'https://en.thepickychemist.com'},wixProfile,async()=>({success:true,data:wixPage(store)}));assert.equal(incomplete.complete,false);assert.match(incomplete.error,/incomplete/);
  category.productsWithMetaData.totalCount=5;category.id='bdfb8557-74a4-e1ef-5c03-72bdb66615f4';assert.equal((await discoverWixProducts({website_url:'https://en.thepickychemist.com'},wixProfile,async()=>({success:true,data:wixPage(store)}))).complete,false);
  const p=Object.values(storeData(wixHtml('managed')))[0].catalog.product;p.productItems.pop();const url='https://en.thepickychemist.com/product-page/'+p.urlPart;assert.equal(wixProduct(wixPage({productPage_EUR_primary:{catalog:{product:p}}}),url,wixProfile)._variants_complete,false);
  p.productItems[0].inventory={};assert.throws(()=>wixProduct(wixPage({productPage_EUR_primary:{catalog:{product:p}}}),url,wixProfile),/stock missing/);
});
test('XLIII English native simple offers retain zero-decimal VND and explicit primary Net Weight; metadata/shipping mass cannot replace it',async()=>{
  const profile=require('../src/siteSupport/profiles.json').find(p=>p.name==='XLIII'),product=require('./fixtures/siteSupport/xliii-woocommerce.json'),html=fs.readFileSync(path.join(__dirname,'fixtures/siteSupport/xliii-product.html'),'utf8');
  const requests=[],read=async value=>{requests.push(value);return response({...product,weight:'30'});},url=product.permalink,source=await fetchWooProduct(html,url,profile,read),normalized=normalizeProduct(structuredExtraction({html,url,sourceProduct:source},null).product,url);
  assert.equal(normalized.source_product_id,'17349');assert.equal(normalized.variants.length,1);assert.equal(normalized.variants[0].money.currency,'VND');assert.equal(normalized.variants[0].money.exponent,0);assert.equal(normalized.variants[0].money.minorUnits,1000000);assert.equal(normalized.variants[0].weight_g,100);assert.equal(new URL(requests[0]).searchParams.get('lang'),'en');
  assert(source.description.includes('fertility'));
  const blankRead=async()=>response({...product,description:'<p></p>',short_description:'<p></p>'}),primaryHtml=html.replace('<h1>','<div class="inner-info-product"><h1>').replace('</h1>','</h1><p>Primary lot: washed Sydra grown in Imbabura.</p></div>')+'<aside>Other recommended coffee</aside>';
  const primarySource=await fetchWooProduct(primaryHtml,url,profile,blankRead);assert(primarySource.description.includes('washed Sydra grown in Imbabura'));assert(!primarySource.description.includes('recommended'));
  const missingWeight=await fetchWooProduct(html.replace('Net Weight','Undeclared mass'),url,profile,read);assert.equal(missingWeight.offers[0]._net_weight_g,null);
  const discovered=await discoverWooProducts({website_url:'https://xliiicoffee.com/en/'},profile,async value=>{assert.equal(new URL(value).searchParams.get('lang'),'en');return {success:true,catalogTotal:3,catalogPages:1,data:JSON.stringify([product,{...product,id:19999,name:'Discovery Subscription'},{...product,id:19998,name:'Specialty Coffee Experience'}])};});assert.equal(discovered.complete,true);assert.deepEqual(discovered.urls,[url]);
  await assert.rejects(fetchWooProduct(html.replace('100 gram','100–250 gram'),url,profile,read),/net weight invalid/);
});
test('native Shopify Size fields preserve exact bag mass across hyphenated grinds and explicit encoded size labels; ambiguous labels stay unknown',()=>{
  const {parseShopifyProduct}=require('../src/shopifyProduct'),product={title:'Tandem coffee',options:[{name:'Size',position:1,values:['12oz']},{name:'Grind',position:2,values:['Medium-Fine (Stovetop)']}],variants:[{id:1,title:'12oz / Medium-Fine (Stovetop)',option1:'12oz',option2:'Medium-Fine (Stovetop)',grams:1000}]};
  assert.equal(parseShopifyProduct(product,{preferLabelWeight:true}).variants[0].weightGrams,340);
  const captured=require('./fixtures/siteSupport/tandem-size-shopify.json');assert.equal(parseShopifyProduct(captured,{preferLabelWeight:true}).variants[0].weightGrams,227);assert.equal(captured.variants[0].grams,363);
  const fixture=require('./fixtures/siteSupport/thoughtful-shopify.json').variant_example,parsed=parseShopifyProduct(fixture,{preferLabelWeight:true});assert.equal(parsed.variants.at(-1).title,'2GOOD2GO_0814_240g');assert.equal(parsed.variants.at(-1).weightGrams,240);
  product.options[0].values=['2GOOD2GO_XX_2g2g'];product.variants[0].option1='2GOOD2GO_XX_2g2g';assert.equal(parseShopifyProduct(product,{preferLabelWeight:true}).variants[0].weightGrams,null);
  product.options[0].values=['2GOOD2GO_XXXX_240g'];product.variants[0].option1='2GOOD2GO_XXXX_240g';assert.equal(parseShopifyProduct(product,{preferLabelWeight:true}).variants[0].weightGrams,240);
});
test('Thoughtful current Special/Terroir/Process collections enumerate all 19 retail coffees, including sold-out Milan, and require empty terminal pages',async()=>{
  const profile=require('../src/siteSupport/profiles.json').find(p=>p.name==='Thoughtful Coffee'),fixture=require('./fixtures/siteSupport/thoughtful-shopify.json'),{discoverShopifyProducts}=require('../src/siteSupport/shopifyDiscovery');
  const result=await discoverShopifyProducts({website_url:'https://thoughtfulcoffee.co'},profile,async value=>{const url=new URL(value),key=url.pathname.split('/')[2];return response({products:url.searchParams.get('page')==='1'?fixture[key]:[]});});assert.equal(result.complete,true);assert.equal(result.urls.length,19);assert(result.urls.some(u=>u.includes('finca-milan')));assert(!result.urls.some(u=>u.includes('archive')));
});
test('WooCommerce and Hydrogen adopt existing IDs/slugs across native option URLs and repeated catalog saves stay idempotent',async()=>{
  const pg=await catalogDb();try{
    const woo=await fetchWooProduct(html,url,profile,read),hydrogenUrl='https://drinkpassenger.com/products/keystone-blend',hydrogen=hydrogenProduct(hydrogenHtml,hydrogenUrl,hydrogenProfile);
    const examples=[{source:woo,url,owner:profile.entity_ids[0],id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',old:fixture.variants[0].permalink},{source:hydrogen,url:hydrogenUrl,owner:hydrogenProfile.entity_ids[0],id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',old:hydrogenUrl+'?Size=250+g'}];
    for(const [i,item]of examples.entries()){
      await pg.query('insert into entities(id) values($1)',[item.owner]);await pg.query('insert into products(id,entity_id,slug,name,source_url) values($1,$2,$3,$4,$5)',[item.id,item.owner,'keep-slug-'+i,'Prior coffee',item.old]);
      const existing=await findExistingProduct(supabaseAdapter(pg),item.owner,canonicalProductUrl(item.url),'new-key');assert.equal(existing.id,item.id);
      const product=structuredExtraction({html:'',url:item.url,sourceProduct:item.source},null).product;
      const availability=productAvailability({sourceUrl:item.url,sourceProduct:item.source});
      const payload=catalogPayload(item.owner,product,item.url,existing,availability,new Date().toISOString());
      for(let n=0;n<2;n++)await pg.query('select save_catalog_product_v2($1::jsonb)',[JSON.stringify(payload)]);
      const saved=(await pg.query('select id,slug from products where id=$1',[item.id])).rows[0];assert.equal(saved.slug,'keep-slug-'+i);
    }
    assert.equal((await pg.query('select count(*)::int n from products')).rows[0].n,2);assert.equal((await pg.query('select count(*)::int n from product_variants')).rows[0].n,7);
    assert.equal((await pg.query('select count(*)::int n from product_variants where price_minor_units is not null and currency in (\'EUR\',\'USD\')')).rows[0].n,7);
  }finally{await pg.close();}
});
test('normal page visitor uses the same source adapters and fails closed for broken product data while permitting nonproduct pages',async()=>{
  const vm=require('node:vm'),{createRequire}=require('node:module'),file=path.join(__dirname,'../src/pageVisitor.js'),nativeRequire=createRequire(file),module={exports:{}};
  const empty={};function mockedRequire(name){
    if(['./gptClassifier','./knownPages','./productSaver','./config','./logger'].includes(name))return name==='./config'?{config:{crawler:{}}}:empty;
    if(name==='./availability')return{detectProductAvailability:productAvailability};
    if(name==='./httpClient')return{fetchHtml:async()=>{throw Error('Unexpected network');}};
    return nativeRequire(name);
  }
  vm.runInThisContext('(function(require,module,exports){'+fs.readFileSync(file,'utf8')+'\n})',{filename:file})(mockedRequire,module,module.exports);
  const visitor=module.exports;
  const woo=await visitor.fetchPageContent(url,null,{siteProfile:profile,fetchHtml:async value=>value===url?{success:true,status:200,finalUrl:url,data:html}:read(value)});assert.equal(woo.success,true);assert.equal(woo.sourceProduct.productID,'7748');
  const hurl='https://drinkpassenger.com/products/keystone-blend',hydrogen=await visitor.fetchPageContent(hurl,null,{siteProfile:hydrogenProfile,fetchHtml:async()=>({success:true,status:200,finalUrl:hurl+'?Size=250+g',data:hydrogenHtml})});assert.equal(hydrogen.success,true);assert.equal(hydrogen.sourceProduct.productID,'7747879370942');
  const wixUrl='https://en.thepickychemist.com/product-page/kenya-inoi-kianderi-aa-043-250g',wix=await visitor.fetchPageContent(wixUrl,null,{siteProfile:wixProfile,fetchHtml:async()=>({success:true,status:200,data:wixHtml('unmanaged')})});assert.equal(wix.success,true);assert.equal(wix.sourceProduct.productID,'e0932561-afef-78f6-2e3d-fcb4a662af73');
  const broken=await visitor.fetchPageContent(hurl,null,{siteProfile:hydrogenProfile,fetchHtml:async()=>({success:true,status:200,data:'<h1>Keystone</h1>'})});assert.equal(broken.success,false);
  const home=await visitor.fetchPageContent('https://drinkpassenger.com/',null,{siteProfile:hydrogenProfile,fetchHtml:async()=>({success:true,status:200,data:'<h1>Passenger</h1>'})});assert.equal(home.success,true);assert.equal(home.sourceProduct,null);
});
