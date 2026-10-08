'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const profiles=require('../src/siteSupport/profiles.json');
const {retailCoffee}=require('../src/siteSupport/shopifyDiscovery');
const {discoverShopifyProducts}=require('../src/siteSupport/shopifyDiscovery');
const {fathersProduct,discoverFathersProducts}=require('../src/siteSupport/fathers');
const {structuredExtraction}=require('../src/extraction');
const {normalizeProduct}=require('../src/catalogNormalization');
const {productAvailability}=require('../src/productEvidence');
const {mergeShopifyStock,parseShopifyProduct}=require('../src/shopifyProduct');
const {allowed,createReader}=require('../src/siteSupport/network');
const fixture=require('./fixtures/siteSupport/fathers-public.json');
const fathers=profiles.find(p=>p.name==='Fathers');
function fathersHtml(value=fixture) {return '<h1>'+value.heading+'</h1><script id="props" type="application/json">'+JSON.stringify(value.productProps)+'</script><script type="application/ld+json">'+JSON.stringify(value.group)+'</script>';}
test('Ceremony reviewed collection includes instant coffee and excludes its required subscriptions by exact merchant tag',()=>{
 const profile=profiles.find(p=>p.name==='Ceremony');
 assert(retailCoffee({title:'Instant Thesis',product_type:'',tags:[]},profile));
 assert(retailCoffee({title:'Ethiopia Keramo',product_type:'Single Origin'},profile));
 assert(!retailCoffee({title:'Relationship Driven',product_type:'Single Origin',tags:['Subscription']},profile));
 assert(!retailCoffee({title:'Gift Card',product_type:''},profile));
});
test('captured Color offers preserve all native grind/size variants and exact USD price rather than shipping mass',()=>{
 const f=require('./fixtures/siteSupport/color-shopify.json'),native=parseShopifyProduct(mergeShopifyStock(f.product,f.ajax),{preferLabelWeight:true});
 const result=normalizeProduct(structuredExtraction({html:f.html,url:f.url},{success:true,data:native}).product,f.url);
 assert.equal(result.variants.length,24);assert(result.variants.every(v=>v.money.currency==='USD' && v.money.minorUnits>0 && v.source_id));
 assert.equal(result.variants[0].weight_g,283);assert.equal(result.variants[1].weight_g,907);assert.equal(result.variants[2].weight_g,2268);
 assert.equal(result.variants_complete,true);assert.equal(result.source_product_id,String(f.product.id));
});
test('Fathers complete retail discovery binds all 42 public coffee cards/options and excludes non-coffee repeated merchandise',async()=>{
 const html='<main>'+fixture.cards+'</main><script id="props" type="application/json">'+JSON.stringify(fixture.listingProps)+'</script>';
 const result=await discoverFathersProducts({website_url:'https://fathers.cz'},fathers,async url=>({success:true,data:html,finalUrl:url}));
 assert.equal(result.complete,true);assert.equal(result.urls.length,42);assert(result.urls.includes(fixture.url));
 for(const bad of [html.replace('name="variants-','name="missing-'),html+'<a rel="next" href="?page=2">Next</a>',html+html]){
   const incomplete=await discoverFathersProducts({website_url:'https://fathers.cz'},fathers,async url=>({success:true,data:bad,finalUrl:url}));
   assert.equal(incomplete.complete,false);
 }
 const failed=await discoverFathersProducts({website_url:'https://fathers.cz'},fathers,async()=>({success:false,status:403,error:'HTTP 403'}));assert.equal(failed.complete,false);assert.match(failed.error,/403/);
});
test('captured Fathers primary UUID/variant SKUs pair Czech retail taxed prices, explicit net weights and full descriptions',()=>{
 const source=fathersProduct(fathersHtml(),fixture.url,fathers),product=normalizeProduct(structuredExtraction({html:'',url:fixture.url,sourceProduct:source}).product,fixture.url);
 assert.equal(product.source_product_id,'354ea213-c521-4684-8282-a65e9403103b');assert.deepEqual(product.variants.map(v=>v.money.minorUnits),[29985,104294,208589]);
 assert(product.variants.every(v=>v.money.currency==='CZK'));assert.deepEqual(product.variants.map(v=>v.weight_g),[250,1000,2000]);
 assert.equal(product.variants[0].source_id,'354ea213-c521-4684-8282-a65e9403103b::25622f6a');assert.equal(product.variants_complete,true);
 assert.match(product.description_raw,/Cocatrel/);assert.equal(productAvailability({sourceProduct:source,sourceUrl:fixture.url}).state,'in_stock');
 const sold=structuredClone(fixture);sold.group.hasVariant.forEach(v=>v.offers.availability='https://schema.org/OutOfStock');assert.equal(productAvailability({sourceProduct:fathersProduct(fathersHtml(sold),fixture.url,fathers),sourceUrl:fixture.url}).state,'sold_out');
});
test('Fathers single-product schemas and alternate schema currencies retain exact retail identity and ignore packaging mass',()=>{
 const f=structuredClone(fixture),v=f.productProps.product.variants[0],member=f.group.hasVariant[0];
 f.productProps.product.variants=[v];v.label.cs='100g';v.weightInGrams=250;
 f.group={...f.group,'@type':'Product',sku:member.sku,offers:member.offers,weight:member.weight};delete f.group.hasVariant;delete f.group.productGroupID;
 let source=fathersProduct(fathersHtml(f),f.url,fathers);assert.equal(source.offers[0]._net_weight_g,100);assert.equal(source.offers[0].sku,member.sku);
 v.prices.EUR={'12':{countries:['Czechia'],price:{withTax:12.34}}};f.group.offers.priceCurrency='EUR';f.group.offers.price=12.34;
 source=fathersProduct(fathersHtml(f),f.url,fathers);assert.equal(source.offers[0].priceCurrency,'CZK');assert.equal(source.offers[0].price,299.85);assert.deepEqual(source._market_context.schema_currencies,['EUR']);
 f.group.offers.price=99;assert.throws(()=>fathersProduct(fathersHtml(f),f.url,fathers),/price disagrees/);
});
test('Koppi title net size applies to proved grind choices without borrowing shipping weight or ambiguous size choices',()=>{
 const make=()=>({title:'Ethiopia - Chelbesa 250g',options:[{name:'Select variant',values:['Whole bean','Ground for filter']}],variants:[{id:1,title:'Whole bean',grams:350},{id:2,title:'Ground for filter',grams:350}]});
 let p=make();assert.deepEqual(parseShopifyProduct(p,{preferLabelWeight:true}).variants.map(v=>v.weightGrams),[250,250]);
 p.options[0].values=['250g','500g'];assert.deepEqual(parseShopifyProduct(p,{preferLabelWeight:true}).variants.map(v=>v.weightGrams),[null,null]);
 p=make();p.title='2 x Coffee 250g';assert.equal(parseShopifyProduct(p,{preferLabelWeight:true}).variants[0].weightGrams,null);
 p=make();p.variants[1].title='500g';assert.equal(parseShopifyProduct(p,{preferLabelWeight:true}).variants[0].weightGrams,null);
});
test('single-variant net description labels are scoped and never use shipping mass or unrelated recipe quantities',()=>{
 const {explicitNetWeight}=require('../src/siteSupport/netWeight');
 const p={title:'El Alisal',body_html:'<p>Variety Batian<br>Suggested for Filter, 125g</p>',variants:[{id:1,title:'Default Title',grams:250}]};
 assert.equal(parseShopifyProduct(p,{preferLabelWeight:true,descriptionWeightPrefixes:['Suggested for Filter,']}).variants[0].weightGrams,125);
 assert.equal(parseShopifyProduct(p,{preferLabelWeight:true}).variants[0].weightGrams,null);
 assert.equal(explicitNetWeight('<p>Use 15g coffee with 250g water</p>'),null);
 assert.equal(explicitNetWeight('<p>Net weight: 125g</p><p>Weight: 250g</p>'),null);
 assert.equal(explicitNetWeight('<p>Net weight: 125g</p>'),125);
});
test('Three Marks primary native variant/title/canonical scope preserves full published metafields and excludes related products',()=>{
 const f=require('./fixtures/siteSupport/three-marks-description.json'),{threeMarksDescription}=require('../src/siteSupport/threeMarks');
 const result=structuredExtraction({html:f.html,url:f.url},{success:true,data:f.native});
 assert.match(result.product.description_raw,/raised African beds for approximately 15 days/);assert.match(result.product.description_raw,/74110, 74112/);assert.match(result.product.description_raw,/2100 masl/);
 assert(!result.product.description_raw.includes('mango'));assert.equal(result.product.source_product_id,f.native.id);
 const processed=normalizeProduct(result.product,f.url).processing;assert.deepEqual(processed.process_methods,['natural']);assert.deepEqual(processed.coferment_ingredients,[]);
 for(const html of [f.html.replace('54776087085393','123'),f.html.replace('<h1>Tafese Yaau','<h1>Another'),f.html.replace('href="'+f.url+'"','href="https://www.threemarkscoffee.com/products/other"'),f.html+f.html])assert.equal(threeMarksDescription(html,f.url,f.native),null);
 assert.equal(threeMarksDescription(f.html,'https://other.example/products/tafese-yaau-g1',f.native),null);
});
test('normal page visitor uses Fathers source parser, and an unverified market fails the page instead of silently falling back',async()=>{
 const {fetchPageContent}=require('../src/pageVisitor');
 const read=async url=>({success:true,status:200,finalUrl:url,data:fathersHtml()}),page=await fetchPageContent(fixture.url,null,{siteProfile:fathers,fetchHtml:read});
 assert.equal(page.success,true);assert.equal(page.sourceProduct.productID,fixture.productProps.product.id);assert.match(page.content,/Cocatrel/);
 const bad=structuredClone(fixture);bad.productProps.currency='EUR';
 const rejected=await fetchPageContent(fixture.url,null,{siteProfile:fathers,fetchHtml:async url=>({success:true,status:200,finalUrl:url,data:fathersHtml(bad)})});
 assert.equal(rejected.success,false);assert.match(rejected.error,/market context/);
});
test('PERC empty types are accepted only in reviewed coffee collections, while drinkware gift bundles stay excluded',async()=>{
 const profile=profiles.find(p=>p.name==='PERC'),blank={id:1,handle:'rip-drip',title:'Rip & Drip',product_type:''},gift={id:2,handle:'gift',title:'Gift box - Ceramic',product_type:''},gear={id:3,handle:'unknown-gear',title:'Accessory',product_type:''};
 assert(!retailCoffee({title:'Third Wave Water',product_type:'Coffee'},profile));assert(!retailCoffee({title:'Third Wave Water Single Packet',product_type:'Coffee'},profile));
 const requested=[];const result=await discoverShopifyProducts({website_url:'https://perccoffee.com'},profile,async url=>{
  requested.push(url);const u=new URL(url),first=u.searchParams.get('page')==='1',products=!first?[]:u.pathname.includes('/all/')?[blank,gear]:u.pathname.includes('/coffee-archive/')?[]:[blank,gift];
  return {success:true,finalUrl:url,data:JSON.stringify({products})};
 });
 assert.equal(result.complete,true);assert.deepEqual(result.urls,['https://perccoffee.com/products/rip-drip']);assert(requested.some(u=>u.includes('/all/products.json')));
});
test('Fathers transaction refresh preserves an existing product ID/slug and exact native variants across repeated saves',async()=>{
 const {catalogDb,supabaseAdapter}=require('./catalogDb'),{catalogPayload,findExistingProduct}=require('../src/productSaver');
 const pg=await catalogDb();try{
  const owner=fathers.entity_ids[0],id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
  await pg.query('insert into entities(id) values($1)',[owner]);await pg.query('insert into products(id,entity_id,slug,name,source_url) values($1,$2,$3,$4,$5)',[id,owner,'keep-fathers-slug','Existing coffee',fixture.url]);
  const source=fathersProduct(fathersHtml(),fixture.url,fathers),extracted=structuredExtraction({html:'',url:fixture.url,sourceProduct:source}).product,existing=await findExistingProduct(supabaseAdapter(pg),owner,fixture.url,'unused');
  assert.equal(existing.id,id);const payload=catalogPayload(owner,extracted,fixture.url,existing,productAvailability({sourceProduct:source,sourceUrl:fixture.url}),new Date().toISOString());
  for(let i=0;i<2;i++)await pg.query('select save_catalog_product_v2($1::jsonb)',[JSON.stringify(payload)]);
  const p=(await pg.query('select id,slug from products')).rows;assert.deepEqual(p,[{id,slug:'keep-fathers-slug'}]);
  const variants=(await pg.query('select merchant_variant_id as source_id from product_variants')).rows;assert.equal(variants.length,3);assert(variants.every(v=>source.offers.some(o=>o.sku===v.source_id)));
 }finally{await pg.close();}
});
test('Fathers rejects ambiguous data, other product/variant/market offers and conflicting exact prices without running scripts',()=>{
 for(const mutate of [
   f=>{f.productProps.currency='EUR';},f=>{f.productProps.destinationCountry='Latvia';},
   f=>{f.group.productGroupID='another';},f=>{f.group.hasVariant[0].sku='another::25622f6a';},
   f=>{f.group.hasVariant[0].offers.url='https://fathers.cz/kava/espresso/another';},
   f=>{f.group.hasVariant[0].offers.price=300;},f=>{f.group.hasVariant.pop();},
 ]) {const f=structuredClone(fixture);mutate(f);assert.throws(()=>fathersProduct(fathersHtml(f),f.url,fathers));}
 assert.throws(()=>fathersProduct(fathersHtml()+fathersHtml(),fixture.url,fathers),/ambiguous/);
 assert.throws(()=>fathersProduct('<script id="props" type="application/json">(globalThis.PWNED=true,{})</script>',fixture.url,fathers),/Invalid/);assert.equal(globalThis.PWNED,undefined);
});
test('merchant guard rejects encoded legal/account/cart paths and Woo cart mutations before any request',async()=>{
 const hosts=['fathers.cz'],reader=createReader({hosts});
 for(const suffix of ['/terms','/%2574erms/anything','/pages/terms-of-service','/terms;anything','/agreement','/shop_cart','/auth/access_control.cm','/customer_authentication/redirect','/my-account','/?add-to-cart=1','/?wc-ajax=checkout']){
   assert.throws(()=>allowed('https://fathers.cz'+suffix,hosts),/Prohibited/);
   assert.equal((await reader.fetchHtml('https://fathers.cz'+suffix)).success,false);
 }
 assert.equal(reader.requests.length,0);
});
