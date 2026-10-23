'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {catalogDb,supabaseAdapter}=require('./catalogDb');
const {parseShopifyProduct}=require('../src/shopifyProduct');
const {extractPage,structuredExtraction,legacySemanticHash,EXTRACTION_VERSION}=require('../src/extraction');
const {aiRequestPolicy}=require('../src/aiRequestPolicy');
const {classificationContent}=require('../src/productSemanticContent');
const {fixture,html,sourcePage,visitor,owner,url,model,log}=require('./aiEfficiencyFixtures.cjs');
const now=Date.parse('2026-10-23T04:00:00Z');
test('cart, recommendation, document-title and transactional changes reuse semantics; source facts and variant labels do not',async()=>{
 const state=fixture();let calls=0;const classify=async content=>{calls++;state.inputs.push(content);return {aiCalls:1,data:{is_coffee_page:true,product:state.extracted}};};
 const native=()=>({success:true,data:parseShopifyProduct(state.native)});
 const first=await extractPage({page:sourcePage(),shopifyJson:native(),classify,model,now});assert.equal(calls,1);
 assert(!state.inputs[0].includes('Unrelated Kenya'));assert(state.inputs[0].includes('Primary additional fact: 1800m'));assert(state.inputs[0].includes('Product/page title: Coffee Ethiopia'));
 state.native.variants[0].price='14.00';state.native.variants[0].available=false;
 const second=await extractPage({page:sourcePage(html('Changed cart and recommendations')),shopifyJson:native(),cache:first.cache,classify,model,now:now+1000});
 assert.equal(second.mode,'cache');assert.equal(calls,1);assert.equal(second.data.product.variants[0].price,'14.00');assert.equal(second.data.product.variants[0].available,false);
 await extractPage({page:sourcePage(html('Changed','Farm B')),shopifyJson:native(),cache:second.cache,classify,model,now:now+2000});assert.equal(calls,2);
 state.native.variants[0].title='250g / Filter';await extractPage({page:sourcePage(html('Changed')),shopifyJson:native(),cache:second.cache,classify,model,now:now+3000});assert.equal(calls,3);
});
test('unstructured pages retain title-only evidence in model input and cache identity',async()=>{
 let calls=0;const classify=async content=>{calls++;assert(content.includes('Product/page title:'));return {aiCalls:1,data:{is_coffee_page:false}};};
 const page=title=>({url,html:`<html><title>${title}</title><body>Details unavailable</body></html>`});
 const first=await extractPage({page:page('Equipment'),classify,model,now});
 const second=await extractPage({page:page('Coffee Ethiopia'),cache:first.cache,classify,model,now:now+1});
 assert.equal(calls,2);assert.equal(second.mode,'ai');assert(classificationContent(page('Coffee Ethiopia'),{}).includes('Coffee Ethiopia'));
});
test('exact legacy hashes upgrade without inference; changed legacy inputs require extraction',async()=>{
 const state=fixture(),p=sourcePage(),native={success:true,data:parseShopifyProduct(state.native)};let calls=0;const classify=async()=>{calls++;return {aiCalls:1,data:{is_coffee_page:true,product:state.extracted}};};
 const first=await extractPage({page:p,shopifyJson:native,classify,model,now});
 const old=structuredClone(first.cache);old._extraction.version='extract-v2-processing';old._extraction.semantic_hash=legacySemanticHash(p,structuredExtraction(p,native));
 const upgraded=await extractPage({page:p,shopifyJson:native,cache:old,classify,model,now:now+1});assert.equal(calls,1);assert.equal(upgraded.mode,'cache');assert.equal(upgraded.cache._extraction.version,EXTRACTION_VERSION);
 await extractPage({page:sourcePage(html('Different old input')),shopifyJson:native,cache:old,classify,model,now:now+2});assert.equal(calls,2);
});
test('failed catalog transactions retain paid extraction and translation; retry publishes only fresh market data',async()=>{
 const pg=await catalogDb({nativeWeightCompatibility:false});try{
  await pg.query('insert into entities(id) values($1)',[owner]);
  await pg.query('create unique index product_variants_unique_weight_per_product on product_variants(product_id,weight_g) where weight_g is not null');
  const state=fixture(),module=visitor(supabaseAdapter(pg),state),acc={markVisited(){}};
  const run=async()=>module.visitAllPages(owner,[url],acc,log,'shopify',{knownPages:new Map((await pg.query('select * from known_pages')).rows.map(r=>[r.url,r]))});
  const first=await run();assert.equal(first.errors,1);assert.equal(state.aiCalls,1);assert.equal(state.translationCalls,1);assert.equal((await pg.query('select count(*)::int n from products')).rows[0].n,0);
  const cached=(await pg.query('select classification from known_pages')).rows[0].classification;assert(cached._prepared_translation);assert.equal(cached._extraction.version,EXTRACTION_VERSION);
  state.native.variants[0].price='14.00';state.native.variants[0].available=false;state.html=html('Changed cart');
  const second=await run();assert.equal(second.errors,1);assert.equal(second.aiCalls,0);assert.equal(state.aiCalls,1);assert.equal(state.translationCalls,1);assert.equal((await pg.query('select count(*)::int n from products')).rows[0].n,0);
  await pg.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261008155858_native_variant_weight_compat.sql'),'utf8'));
  const third=await run();assert.equal(third.errors,0);assert.equal(third.aiCalls,0);assert.equal(state.aiCalls,1);assert.equal(state.translationCalls,1);
  const v=(await pg.query("select * from product_variants where merchant_variant_id='1'")).rows[0];assert.equal(v.price_minor_units,1400);assert.equal(v.availability_state,'sold_out');
  assert.equal((await pg.query('select count(*)::int n from product_variants')).rows[0].n,2);
  state.native.body_html='<p>Coffee from Ethiopia with apricot, washed.</p>';state.html=state.html.replace('Coffee from Ethiopia, washed.','Coffee from Ethiopia with apricot, washed.');
  const changed=await run();assert.equal(changed.errors,0);assert.equal(state.aiCalls,2);assert.equal(state.translationCalls,2);
 }finally{await pg.close();}
});
test('model defaults bound transient retries and retain explicit operator settings',()=>{
 assert.deepEqual(aiRequestPolicy('gpt-5-mini',{}),{reasoningEffort:'low',maxTransientRetries:1,requestTimeoutMs:90000});
 assert.deepEqual(aiRequestPolicy('gpt-5-mini',{OPENAI_REASONING_EFFORT:'medium',OPENAI_MAX_TRANSIENT_RETRIES:'5',OPENAI_REQUEST_TIMEOUT_MS:'12345'}),{reasoningEffort:'medium',maxTransientRetries:5,requestTimeoutMs:12345});
 assert.equal(aiRequestPolicy('other-model',{}).reasoningEffort,null);
 for(const env of [{OPENAI_REASONING_EFFORT:'invalid'},{OPENAI_MAX_TRANSIENT_RETRIES:'6'},{OPENAI_REQUEST_TIMEOUT_MS:'NaN'}])assert.throws(()=>aiRequestPolicy('gpt-5-mini',env),/Invalid OPENAI/);
});
test('hard removals use cached identity only to update existing stock, with no model calls or catalog creation',async()=>{
 const pg=await catalogDb();try{
  await pg.query('insert into entities(id) values($1)',[owner]);
  const state=fixture(),module=visitor(supabaseAdapter(pg),state),knownPage={status:'coffee',classification:{is_coffee_page:true,product:state.extracted}};
  for(const status of [404,410]){
   const r=await module.processFetchedPage(owner,url,{success:false,status},log,'shopify',{knownPage});
   assert.equal(r.aiCalls,0);assert.equal(r.isCoffee,false);assert.equal((await pg.query('select count(*)::int n from products')).rows[0].n,0);
  }
  const saved=await module.visitAllPages(owner,[url],{markVisited(){}},log,'shopify');assert.equal(saved.errors,0);
  const before=(await pg.query('select id,name,metadata,last_seen_at from products')).rows[0],calls=state.aiCalls+state.translationCalls;
  for(const status of [404,410]){
   await module.processFetchedPage(owner,url,{success:false,status},log,'shopify',{knownPage});
   assert.deepEqual((await pg.query('select id,name,metadata,last_seen_at from products')).rows[0],before);
   assert.equal((await pg.query('select availability_state from products')).rows[0].availability_state,'removed');
   assert((await pg.query('select availability_state from product_variants')).rows.every(v=>v.availability_state==='removed'));
   assert.equal(state.aiCalls+state.translationCalls,calls);
  }
 }finally{await pg.close();}
});
test('translation usage is counted separately without mutating the persisted extraction usage',async()=>{
 const pg=await catalogDb();try{
  await pg.query('insert into entities(id) values($1)',[owner]);
  const state=fixture();state.extractionUsage={prompt_tokens:11,reported_calls:1};state.translationUsage={prompt_tokens:22,reported_calls:1};
  const module=visitor(supabaseAdapter(pg),state),result=await module.visitAllPages(owner,[url],{markVisited(){}},log,'shopify');
  assert.equal(result.errors,0);assert.equal(result.extractionCalls,1);assert.equal(result.translationCalls,1);assert.equal(result.aiUsage.prompt_tokens,33);
  const stored=(await pg.query('select classification from known_pages')).rows[0].classification;
  assert.equal(stored._extraction.usage.prompt_tokens,11);assert.equal(stored._extraction.usage.reported_calls,1);
 }finally{await pg.close();}
});
