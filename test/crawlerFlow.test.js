'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module');
const {catalogDb,supabaseAdapter}=require('./catalogDb');
const {parseShopifyProduct}=require('../src/shopifyProduct');
const {ATTRIBUTES}=require('../src/extraction');
const owner='11111111-1111-4111-8111-111111111111',url='https://shop.test/products/coffee',log=new Proxy({},{get:()=>()=>{}});
function modules(db,state) {
  const modules=new Map(),root=path.join(__dirname,'../src');
  function load(file) {
    file=path.resolve(file);if(modules.has(file))return modules.get(file).exports;
    const module={exports:{}};modules.set(file,module);const nativeRequire=createRequire(file);
    function requireMock(name) {
      if(name==='./supabase')return{getSupabase:()=>db};
      if(name==='./logger')return log;
      if(name==='./config')return{config:{crawler:{requestDelayMs:0,maxBfsPages:20}}};
      if(name==='./gptClassifier')return{MODEL:'fixture-model',classifyPage:async()=>{state.aiCalls++;return{aiCalls:1,usage:{prompt_tokens:50,completion_tokens:10},data:{is_coffee_page:true,product:state.extracted}};}};
      if(name==='./imageDownloader')return{downloadAndSaveImage:async()=>null};
      if(name==='./httpClient')return{fetchHtml:async()=>({success:true,data:state.html,status:200,finalUrl:url}),jitteredSleep:async()=>{}};
      if(name==='./shopifyProduct')return{...nativeRequire(name),fetchShopifyProductJson:async()=>({success:true,raw:state.native,data:parseShopifyProduct(state.native)})};
      if(name.startsWith('./') && !name.endsWith('.cjs') && !name.endsWith('.json'))return load(nativeRequire.resolve(name));
      return nativeRequire(name);
    }
    vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(file,'utf8')}\n})`,{filename:file})(requireMock,module,module.exports);return module.exports;
  }
  return{visitor:load(path.join(root,'pageVisitor.js')),bfs:load(path.join(root,'bfsCrawler.js')),availability:load(path.join(root,'availability.js')),accumulator:load(path.join(root,'urlAccumulator.js')).UrlAccumulator};
}
function fixture() {
  const attrs=Object.fromEntries(ATTRIBUTES.map(k=>[k,null]));Object.assign(attrs,{country_of_origin:'Ethiopia',origin_region:'Yirgacheffe',process:'Washed',varietal:'Heirloom',is_decaf:false,flavor_notes:['Blueberries','Cotton Candy'],producer:'Banko',altitude:'1800m',description:'Coffee beans from Banko',short_description:'Coffee',nano_description:'Banko',grind_size_offered:['whole bean','espresso'],brew_as:['Filter'],roast_darkness:'light',harvest_date:'2025'});
  const native={id:123,title:'ETHIOPIA — BANKO',currency:'EUR',product_type:'Coffee',body_html:'<p>Coffee beans from Banko</p>',variants:[{id:1,title:'250g / whole bean',price:'12.00',grams:250,available:true},{id:2,title:'250g / espresso',price:'12.00',grams:250,available:false}]};
  return {aiCalls:0,html:'<main><h1>ETHIOPIA — BANKO</h1><p>Coffee beans from Banko</p></main>',native,extracted:{name:'ETHIOPIA — BANKO',attributes:attrs}};
}
for(const mode of ['sitemap','bfs']) test(`${mode} path persists complete attributes, reuses semantics and refreshes exact variant price/stock`,async()=>{
  const pg=await catalogDb();try{
    await pg.query('insert into entities(id) values($1)',[owner]);const db=supabaseAdapter(pg),state=fixture(),m=modules(db,state),acc=new m.accumulator(owner,'Fixture',log);acc.addUrl(url);
    const run=async()=>mode==='bfs'?m.bfs.bfsCrawl(owner,url,[],acc,log,'shopify'):
      m.visitor.visitAllPages(owner,[{url}],acc,log,'shopify',{knownPages:new Map((await pg.query('select * from known_pages')).rows.map(r=>[r.url,r]))});
    const first=await run();assert.equal(first.errors,0);assert.equal(first.coffeeFound,1);assert.equal(first.aiCalls,1);assert.equal(first.aiUsage.prompt_tokens,50);
    const p=(await pg.query('select * from products')).rows[0],ids=(await pg.query('select id from product_variants order by id')).rows;
    for(const key of ATTRIBUTES.filter(k=>state.extracted.attributes[k]!=null))assert.notEqual(p.metadata[key],undefined,key);
    state.native.variants[0].available=false;state.native.variants[0].price='14.00';
    const second=await run();assert.equal(second.errors,0);assert.equal(second.cacheHits,1);assert.equal(second.aiCalls,0);assert.equal(state.aiCalls,1);
    assert.deepEqual((await pg.query('select id from product_variants order by id')).rows,ids);
    const v=(await pg.query("select * from product_variants where merchant_variant_id='1'")).rows[0];assert.equal(v.price_minor_units,1400);assert.equal(v.availability_state,'sold_out');
    assert.equal((await pg.query('select availability_state from products')).rows[0].availability_state,'sold_out');
    assert.equal((await pg.query('select * from coffee_facts')).rows[0].process,'Washed');
    const e=(await pg.query('select * from catalog_change_events order by id')).rows;assert.equal(e[1].content_changed,false);assert.equal(e[1].market_changed,true);
  }finally{await pg.close();}
});
test('stock-only transaction emits invalidation and removal reaches every variant',async()=>{
  const pg=await catalogDb();try {
    await pg.query('insert into entities(id) values($1)',[owner]);const state=fixture(),m=modules(supabaseAdapter(pg),state),acc=new m.accumulator(owner,'Fixture',log);acc.addUrl(url);
    const observed=new Map();await m.visitor.visitAllPages(owner,[{url}],acc,log,'shopify',{observed});
    const reconciliation=await m.availability.reconcileRoasterAvailability({entityId:owner,surfaceUrls:[url],observed,log});assert.equal(reconciliation.reused,1);assert.equal(reconciliation.checked,0);
    const p=(await pg.query('select id from products')).rows[0];
    await pg.query('select update_catalog_availability_v1($1,$2)',[p.id,{state:'removed',checkedAt:new Date().toISOString(),reason:'404',evidence:[{source:'http',status:404}]}]);
    assert((await pg.query('select availability_state from product_variants')).rows.every(v=>v.availability_state==='removed'));
    assert.equal((await pg.query('select is_available from products')).rows[0].is_available,false);
    const e=(await pg.query('select * from catalog_change_events order by id desc')).rows[0];assert.equal(e.content_changed,false);assert.equal(e.market_changed,true);
  } finally{await pg.close();}
});
