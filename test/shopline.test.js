'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const profiles=require('../src/siteSupport/profiles.json');
const fixture=require('./fixtures/siteSupport/reshock-shopline.json');
const {field,shoplineProduct}=require('../src/siteSupport/shopline');
const {profileFor,discoverSiteProducts}=require('../src/siteSupport/discovery');
const {createReader}=require('../src/siteSupport/network');
const {productOnlyOffer,productAvailability}=require('../src/productEvidence');
const {structuredExtraction}=require('../src/extraction');
const {normalizeProduct}=require('../src/catalogNormalization');
const {inspectionErrors}=require('../src/siteSupport/cli');
const profile=profiles.find(p=>p.name==='Reshock Coffee');
const now=()=>Date.parse('2026-10-25T12:00:00Z');
const prefixes={config:'window.mainConfig = ',sdk:'var appExtensionSdkData = ',product:"app.value('product', ",products:"app.value('products', ",features:"app.constant('FEATURES_LIMIT', "};
function literal(name,value){const data=JSON.stringify(JSON.stringify(value)).slice(1,-1).replace(/'/g,"\\'");return '<script>'+prefixes[name]+"JSON.parse('"+data+"')"+(['config','sdk'].includes(name)?'':')')+';</script>';}
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function html(record){return literal('config',record.config)+literal('sdk',record.sdk)+literal('features',record.features)+literal('product',record.product)+'<link rel="canonical" href="'+escape(record.canonical)+'"><h1 class="Product-title">'+escape(record.heading)+'</h1><script type="application/ld+json">'+JSON.stringify(record.schema).replace(/</g,'\\u003c')+'</script>';}
function listing(record){return literal('config',record.config)+literal('sdk',record.sdk)+literal('products',record.products)+record.cards+record.pagination;}
function extract(record){return shoplineProduct(html(record),record.url,profile,{now});}
const first=fixture.products[0];

test('Shopline support is scoped to the verified Reshock owner and disables omission reconciliation',()=>{
  assert.equal(profileFor({id:profile.entity_ids[0],website_url:profile.bootstrap_url}),profile);
  assert.equal(profileFor({id:'another-owner',website_url:profile.bootstrap_url}),null);
  assert.equal(profileFor({id:profile.entity_ids[0],website_url:'https://other.example/'}),null);
  assert.equal(profile.reconcile_omissions,false);assert.equal(profile.inventory_authorizes_global_absence,false);
});
test('captured Shopline pagination discovers 43 reviewed coffees without custom orders, tea or mixed cracker kits',async()=>{
  const requests=[],pages=new Map(fixture.listings.map(r=>[r.url,listing(r)]));
  const result=await discoverSiteProducts({id:profile.entity_ids[0],website_url:profile.bootstrap_url},{fetchHtml:async url=>{requests.push(url);return {success:true,finalUrl:url,data:pages.get(url)};}});
  assert.equal(result.complete,true);assert.equal(result.urls.length,43);assert.equal(requests.length,9);
  assert.equal(new Set(result.urls).size,43);assert.equal(result.inventory_authorizes_global_absence,false);
  assert(!result.urls.some(u=>/customerbooking|tea-coffee|cracker/.test(u)));
  assert(result.evidence.some(e=>e.published_products===0));
  const incomplete=await discoverSiteProducts({id:profile.entity_ids[0],website_url:profile.bootstrap_url},{fetchHtml:async url=>({success:true,finalUrl:url,data:pages.get(fixture.listings[0].url)})});
  assert.equal(incomplete.complete,false);assert.match(incomplete.error,/pagination|repeated|context/);
});
test('all captured supported Reshock pages normalize 41 products, 70 native SKUs and nine product-only offers',()=>{
  let products=0,variants=0,only=0;const held=[];
  for(const record of fixture.products){if(!profile.shopline_reviewed_product_ids.includes(record.product._id))continue;
    let source;try{source=extract(record);}catch(e){held.push({id:record.product._id,error:e.message});continue;}
    const data=html(record),p=normalizeProduct(structuredExtraction({html:data,url:record.url,sourceProduct:source},null).product,record.url),availability=productAvailability({sourceProduct:source,sourceUrl:record.url}),po=Boolean(productOnlyOffer(source,record.url));
    assert.deepEqual(inspectionErrors(p,availability,{allowProductOnly:po}),[]);assert.equal(availability.state,'in_stock');assert(p.variants.every(v=>v.money.currency==='TWD'));
    assert.equal(p.variants_complete,!po);assert(p.description_raw);products++;variants+=p.variants.length;only+=Number(po);
  }
  assert.deepEqual({products,variants,only},{products:41,variants:70,only:9});assert.equal(held.length,2);
  assert.match(held.find(e=>e.id==='6a4aae5905887566338b1874').error,/window_closed/);
  assert.match(held.find(e=>e.id==='63b226d80c2da4000e77ae5a').error,/stock disagreement/);
});
test('Shopline keeps TWD amounts at the declared merchant scale and never substitutes member/parent/add-on prices',()=>{
  const record=structuredClone(first);record.product.member_price={dollars:1,cents:1,currency_iso:'TWD',label:'NT$1'};
  const source=extract(record);assert.deepEqual(source.offers.map(o=>o.price),['950.00','2150.00']);
  const p=normalizeProduct(structuredExtraction({html:'',url:record.url,sourceProduct:source},null).product,record.url);
  assert.deepEqual(p.variants.map(v=>v.money.minorUnits),[95000,215000]);
  const sale=extract(fixture.products.find(p=>p.product._id==='69987ac08281744a3c10869f'));
  assert.deepEqual(sale.offers.map(o=>o.price),['650.00','1475.00']);
  const addons=extract(fixture.products.find(p=>p.product._id==='6167bd000443410023ad789d'));
  assert.equal(addons.offers.length,0);assert.equal(addons._product_offer.price,'1090.00');
});
test('invalid native money, missing SKU prices, wrong market and conflicting schema fail closed',()=>{
  const mutations=[r=>r.product.variations[0].price.cents=9.5,r=>r.product.variations[0].price.currency_iso='USD',r=>r.product.variations[0].price.label='NT$1',r=>r.product.variations[0].price=null,r=>r.product.variations[0].price_sale={dollars:960,cents:960,currency_iso:'TWD',label:'NT$960'},r=>r.config.merchantData.base_currency.subunit_to_unit=100,r=>r.config.currentUser={id:'member'},r=>r.sdk.loadedCurrency='usd',r=>r.schema.offers.price=1];
  for(const mutate of mutations){const r=structuredClone(first);mutate(r);assert.throws(()=>extract(r),/amount|currency|scale|guest|market|price|disagreement/);}
});
test('unlimited stock is not inferred from a zero quantity, and finite stock requires consistent unmasked evidence',()=>{
  const source=extract(first);assert(source.offers.every(o=>o.availability.endsWith('/InStock')));
  const r=structuredClone(first);r.product.unlimited_quantity=false;r.product.variations[0].quantity=3;r.product.total_orderable_quantity=3;r.product.quantity=3;
  assert.deepEqual(extract(r).offers.map(o=>o.availability.split('/').at(-1)),['InStock','OutOfStock']);
  r.product.variations[0].quantity=0;r.product.quantity=0;r.product.total_orderable_quantity=0;r.product.sold_out=true;r.schema.offers.availability='https://schema.org/OutOfStock';
  assert(extract(r).offers.every(o=>o.availability.endsWith('/OutOfStock')));
  for(const mutate of [p=>p.features.mask_check_stock_api_quantity=true,p=>p.product.sold_out=false,p=>p.product.is_stock_shared=true,p=>p.product.is_preorder=true,p=>p.product.out_of_stock_orderable=true]){const copy=structuredClone(r);mutate(copy);assert.throws(()=>extract(copy),/stock/);}
});
test('expired and not-yet-open native sale windows remain held despite schema InStock',()=>{
  const record=fixture.products.find(r=>r.product._id==='6a4aae5905887566338b1874');
  assert.throws(()=>extract(record),/window_closed/);
  assert.throws(()=>shoplineProduct(html(record),record.url,profile,{now:()=>Date.parse('2026-07-09T12:00:00Z')}),/window_closed/);
  const during=shoplineProduct(html(record),record.url,profile,{now:()=>Date.parse('2026-07-12T12:00:00Z')});assert.equal(during._product_offer.price,'9900.00');
});
test('native primary product identity binds merchant, canonical, schema, heading and reviewed ID',()=>{
  const mutations=[r=>r.product.owner_id='foreign',r=>r.product.link.value_id='foreign',r=>r.sdk.pdpProduct.id='foreign',r=>r.schema.sku='foreign',r=>r.canonical='https://foreign.example/products/coffee',r=>r.heading='Another product',r=>r.product._id='ffffffffffffffffffffffff',r=>r.config.currentPath='https://foreign.example'+new URL(r.url).pathname];
  for(const mutate of mutations){const r=structuredClone(first);mutate(r);assert.throws(()=>extract(r),/identity|context/);}
  for(const record of fixture.products.filter(r=>/%/.test(r.url) && !/collection/.test(r.url)))assert(extract(record));
});
test('Shopline requires a complete native SKU/option matrix and does not fabricate cross-products',()=>{
  const mutations=[r=>r.sdk.pdpProduct.variation_ids.pop(),r=>r.product.variations[0].key=r.product.variations[1].key,r=>r.product.variations[0].variant_option_ids[0]=r.product.variations[1].variant_option_ids[0],r=>r.product.variations[0].fields[0].name='wrong',r=>r.product.variant_options.push({...r.product.variant_options[0],key:'ffffffffffffffffffffffff'})];
  for(const mutate of mutations){const r=structuredClone(first);mutate(r);assert.throws(()=>extract(r),/variation|option/);}
});
test('published gram labels survive while shipping mass, half-pound conventions and pack counts remain unknown',()=>{
  const r=structuredClone(first);r.product.variations.forEach(v=>v.weight=99);
  assert.deepEqual(extract(r).offers.map(o=>o._net_weight_g),[100,null]);
  const pack=extract(fixture.products.find(r=>r.product._id==='6226c1a3a371490032fc428e'));assert(pack.offers.every(o=>o._net_weight_g===null));
});
test('Shopline product-only offers prove primary money and stock without manufacturing a native variant ID',()=>{
  const r=fixture.products.find(r=>r.product._id==='69a803dfd058640012cdf221'),source=extract(r),offer=productOnlyOffer(source,r.url);
  assert(offer);assert.equal(offer.price,'100.00');assert.equal(offer.currency,'TWD');assert.equal(offer.variant_identity_complete,false);assert.equal(source.offers.length,0);
  assert.equal(productAvailability({sourceProduct:source,sourceUrl:r.url}).state,'in_stock');
  for(const mutate of [p=>p._product_offer.stock_control.merchant_id='foreign',p=>p._product_offer.stock_control.product_id='foreign',p=>p._product_offer.stock_control.masked_quantity=true,p=>p._product_offer.price='1.00',p=>p._product_offer.stock_control.sold_out=true]){const copy=structuredClone(source);mutate(copy);assert.equal(productOnlyOffer(copy,r.url),null);}
});
test('literal decoding preserves apostrophes without executing merchant or tracking scripts',()=>{
  const r=fixture.products.find(r=>r.product._id==='6167bd65adb8c300264ec11a');assert.match(field(html(r),'product').summary_translations['zh-hant'],/Tfu'ya/);
  globalThis.shoplineScriptRan=false;assert(shoplineProduct(html(r)+'<script>globalThis.shoplineScriptRan=true</script>',r.url,profile,{now}));assert.equal(globalThis.shoplineScriptRan,false);delete globalThis.shoplineScriptRan;
  assert.throws(()=>field(literal('product',r.product)+literal('product',r.product),'product'),/ambiguous/);
});
test('normal page visitor uses the scoped Shopline reader and preserves parse failures',async()=>{
  const {fetchPageContent}=require('../src/pageVisitor');
  const result=await fetchPageContent(first.url,null,{siteProfile:profile,fetchHtml:async()=>({success:true,status:200,data:html(first),finalUrl:first.url})});
  assert.equal(result.success,true);assert.equal(result.sourceProduct._market_source,'shopline_primary_exact_variant');
  const bad=structuredClone(first);bad.product.owner_id='foreign';const failure=await fetchPageContent(first.url,null,{siteProfile:profile,fetchHtml:async()=>({success:true,status:200,data:html(bad),finalUrl:first.url})});assert.equal(failure.success,false);
});
test('Shopline reader makes only guarded public GETs, with no cookies or account/cart/API reads',async()=>{
  const sent=[],reader=createReader(profile,{delayMs:0,lookup:async()=>[{address:'93.184.216.34'}],fetch:async(url,options)=>{sent.push({url:String(url),options});return new Response(html(first),{status:200});}});
  for(const path of ['/cart','/checkout','/account','/api/products','/categories/other','/products/coffee?currency=USD'])assert.equal((await reader.fetchHtml(new URL(path,profile.bootstrap_url).href)).success,false);
  assert.equal((await reader.fetchHtml('https://foreign.example/products/coffee')).success,false);assert.equal(sent.length,0);
  assert.equal((await reader.fetchHtml(first.url)).success,true);assert.equal(sent.length,1);assert.equal(sent[0].options.method,'GET');assert.equal(sent[0].options.headers.cookie,undefined);assert.equal(sent[0].options.headers.authorization,undefined);
});
