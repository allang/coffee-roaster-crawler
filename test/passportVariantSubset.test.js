'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const {fetchShopifyProductJson,verifiedShopifyVariantScope}=require('../src/shopifyProduct');
const {structuredExtraction}=require('../src/extraction');
const {normalizeProduct}=require('../src/catalogNormalization');
const {catalogPayload}=require('../src/productSaver');
const {productAvailability}=require('../src/productEvidence');
const {catalogDb}=require('./catalogDb');
const f=require('./fixtures/siteSupport/passport-product.json');
const profile=require('../src/siteSupport/profiles.json').find(p=>p.name==='Passport');
const quiet=new Proxy({},{get:()=>()=>{}});
const html='<h1>'+f.product.title+'</h1><script>window.ShopifyAnalytics.meta.currency = '+JSON.stringify(f.analytics_currency)+'; var meta = '+JSON.stringify({product:f.analytics_product})+';</script>';
const nativeFor=(product=f.product,ajax=f.ajax)=>fetchShopifyProductJson(f.url,quiet,{fetchJson:async url=>({success:true,data:url.endsWith('.js')?ajax:{product}})});

test('reviewed accessory subset proves the entire original native set while withholding omission authority',async()=>{
  const native=await nativeFor(),proof=native.data.reviewedAccessorySubset;
  assert.equal(verifiedShopifyVariantScope(native,f.url),true);assert.equal(native.data.variantsComplete,false);
  assert.deepEqual(proof.original_variant_ids,f.product.variants.map(v=>String(v.id)));
  assert.deepEqual(proof.retained_variant_ids,f.product.variants.slice(0,3).map(v=>String(v.id)));
  assert.deepEqual(proof.excluded_variants,f.product.variants.slice(3).map(v=>({id:String(v.id),title:v.title})));
  const product=normalizeProduct(structuredExtraction({html,url:f.url},native).product,f.url);
  assert.equal(product.variants_complete,false);assert.deepEqual(product.variants.map(v=>v.money.minorUnits),[3000,5700,20300]);
  assert(product.variants.every(v=>v.money.currency==='AUD'));
});

test('accessory filtering does not authorize incomplete, mismatched, capped or unknown native stock sets',async()=>{
  const wrong=structuredClone(f.ajax);wrong.id=1;
  const missing=structuredClone(f.ajax);missing.variants.pop();
  const extra=structuredClone(f.ajax);extra.variants.push({...extra.variants[0],id:999});
  const duplicate=structuredClone(f.ajax);duplicate.variants[1].id=duplicate.variants[0].id;
  const unknown=structuredClone(f.ajax);delete unknown.variants[0].available;
  for(const ajax of [null,wrong,missing,extra,duplicate,unknown])assert.equal(verifiedShopifyVariantScope(await nativeFor(f.product,ajax),f.url),false);
  const capped=structuredClone(f.product);capped.variants=Array.from({length:250},(_,i)=>({...f.product.variants[0],id:1000+i,title:i===249?'Vac Sealed Pouch Option (per pouch)':'250gm'}));
  const ajax={id:capped.id,variants:capped.variants.map(v=>({id:v.id,available:true}))};
  assert.equal(verifiedShopifyVariantScope(await nativeFor(capped,ajax),f.url),false);
  const spoofed=structuredClone(f.product);spoofed._reviewed_accessory_subset=(await nativeFor()).raw._reviewed_accessory_subset;
  assert.equal(verifiedShopifyVariantScope(await nativeFor(spoofed,missing),f.url),false);
  const proof=await nativeFor();proof.raw._reviewed_accessory_subset.excluded_variants[0].title='Unknown missing coffee size';
  assert.equal(verifiedShopifyVariantScope(proof,f.url),false);
});

test('registered page visitor admits only the proven subset with fresh paired money and native stock',async()=>{
  let saved=0,classified=0;
  const file=path.join(__dirname,'../src/pageVisitor.js'),realRequire=createRequire(file),module={exports:{}};
  const mocks={
    './gptClassifier':{MODEL:'fixture',classifyPage:async()=>{classified++;return {data:{is_product:true,is_coffee_page:true,product:{name:f.product.title,attributes:{}}},aiCalls:0,skipped:true};}},
    './productSaver':{...realRequire('./productSaver'),saveProduct:async()=>{saved++;return '22222222-2222-4222-8222-222222222222';}},
    './knownPages':{saveKnownPage:async()=>{}},
  };
  vm.runInNewContext('(function(module,exports,require){'+fs.readFileSync(file,'utf8')+'\n})',{process,console,URL,Buffer,setTimeout})(module,module.exports,name=>mocks[name] || realRequire(name));
  const run=(pageHtml,ajax=f.ajax)=>module.exports.processFetchedPage(profile.entity_ids[0],f.url,{success:true,status:200,html:pageHtml,finalUrl:f.url,content:'Coffee'},quiet,'shopify',{siteProfile:profile,fetchJson:async url=>({success:true,data:url.endsWith('.js')?ajax:{product:f.product}})});
  const good=await run(html);assert.equal(good.isCoffee,true);assert.equal(good.productId,'22222222-2222-4222-8222-222222222222');assert.equal(saved,1);
  const unpaired=await run('<h1>Coffee</h1>');assert.match(unpaired.error,/exact current coffee SKU money or stock/);assert.equal(saved,1);
  const unknown=structuredClone(f.ajax);delete unknown.variants[0].available;
  const invalid=await run(html,unknown);assert.match(invalid.error,/Registered Shopify source incomplete/);assert.equal(saved,1);assert.equal(classified,2);
});

test('saving the filtered coffee SKUs retains an earlier accessory variant instead of retiring it',async()=>{
  const pg=await catalogDb();
  try {
    const owner=profile.entity_ids[0],native=await nativeFor(),source=structuredExtraction({html,url:f.url},native).product;
    await pg.query('insert into entities(id) values($1)',[owner]);
    const payload=catalogPayload(owner,source,f.url,null,productAvailability({shopifyProduct:native.raw,sourceUrl:f.url}),'2026-10-08T14:00:00Z');
    assert.equal(payload.variants_complete,false);
    await pg.query('select save_catalog_product_v2($1::jsonb)',[JSON.stringify(payload)]);
    const accessory='33333333-3333-4333-8333-333333333333';
    await pg.query("insert into product_variants(id,product_id,source_key,variant_name,currency,availability_state,availability_checked_at) values($1,$2,'retained-accessory','Prior accessory','AUD','in_stock','2026-10-08T13:00:00Z')",[accessory,payload.product.id]);
    payload.product.checked_at='2026-10-08T14:01:00Z';
    await pg.query('select save_catalog_product_v2($1::jsonb)',[JSON.stringify(payload)]);
    assert.equal((await pg.query('select availability_state from product_variants where id=$1',[accessory])).rows[0].availability_state,'in_stock');
    const coffees=(await pg.query('select merchant_variant_id,price_minor_units from product_variants where merchant_variant_id is not null order by price_minor_units')).rows;
    assert.deepEqual(coffees.map(v=>v.price_minor_units),[3000,5700,20300]);assert.equal(coffees.length,3);
  } finally {await pg.close();}
});
