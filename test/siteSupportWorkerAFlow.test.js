'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{createRequire}=require('node:module');
const {catalogDb,supabaseAdapter}=require('./catalogDb');
test('Leaves normal visitor adopts legacy identity, keeps merchant JPY money and refreshes exact stock idempotently',async()=>{
 const pg=await catalogDb();try{
  const profile=require('../src/siteSupport/profiles.json').find(p=>p.name==='Leaves'),owner=profile.entity_ids[0],url='https://leavescoffee.jp/en/products/costa-rica-don-eli-1',existingId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await pg.query('insert into entities(id) values($1)',[owner]);await pg.query('insert into products(id,entity_id,slug,name,source_url) values($1,$2,$3,$4,$5)',[existingId,owner,'preserve-leaves-slug','Legacy Leaves coffee',url.replace('/en/products/','/products/')]);
  const db=supabaseAdapter(pg),stock=structuredClone(require('./fixtures/siteSupport/leaves-stock.json')),html=fs.readFileSync(path.join(__dirname,'fixtures/siteSupport/leaves-nuxt-product.html'),'utf8'),log=new Proxy({},{get:()=>()=>{}}),modules=new Map();let aiCalls=0;
  function load(file){file=path.resolve(file);if(modules.has(file))return modules.get(file).exports;const module={exports:{}};modules.set(file,module);const native=createRequire(file);
   function read(name){if(name==='./supabase')return{getSupabase:()=>db};if(name==='./logger')return log;if(name==='./config')return{config:{crawler:{requestDelayMs:0}}};if(name==='./gptClassifier')return{...native(name),MODEL:'fixture-model',classifyPage:async()=>{aiCalls++;return{aiCalls:1,data:{is_coffee_page:true,product:{name:'Coffee',default_price:999,currency:'USD',attributes:{}}}}}};if(name==='./imageDownloader')return{downloadAndSaveImage:async()=>null};if(name==='./shopifyProduct')return{...native(name),fetchShopifyProductJson:async()=>{throw Error('Headless storefront must retain paired JPY source');}};if(name.startsWith('./')&&!name.endsWith('.json')&&!name.endsWith('.cjs'))return load(native.resolve(name));return native(name);}
   vm.runInThisContext('(function(require,module,exports){'+fs.readFileSync(file,'utf8')+'\n})',{filename:file})(read,module,module.exports);return module.exports;
  }
  const visitor=load(path.join(__dirname,'../src/pageVisitor.js'));
  const fetchHtml=async u=>({success:true,status:200,finalUrl:u,data:u.endsWith('.js')?JSON.stringify(stock):html});
  const run=async()=>{const fetched=await visitor.fetchPageContent(url,null,{siteProfile:profile,fetchHtml});assert(fetched.sourceProduct);const known=(await pg.query('select * from known_pages where url=$1',[url])).rows[0];return visitor.processFetchedPage(owner,url,fetched,log,'shopify',{siteProfile:profile,knownPage:known});};
  const first=await run();assert.equal(first.error,undefined);assert.equal(first.productId,existingId);assert.equal(first.isCoffee,true);
  assert.deepEqual((await pg.query('select price_minor_units,currency from product_variants order by merchant_variant_id')).rows,[{price_minor_units:6000,currency:'JPY'},{price_minor_units:24000,currency:'JPY'}]);
  stock.variants.forEach(v=>v.available=false);const second=await run();assert.equal(second.error,undefined);assert.equal(second.mode,'cache');assert.equal(aiCalls,1);
  assert.equal((await pg.query('select count(*)::int n from products')).rows[0].n,1);assert.equal((await pg.query('select count(*)::int n from product_variants')).rows[0].n,2);
  const row=(await pg.query('select id,slug,availability_state from products')).rows[0];assert.deepEqual(row,{id:existingId,slug:'preserve-leaves-slug',availability_state:'sold_out'});
 }finally{await pg.close();}
});
test('Momos normal visitor keeps Korean native market separate from English records and refreshes exact stock idempotently',async()=>{
 const pg=await catalogDb();try{
  const profile=require('../src/siteSupport/profiles.json').find(p=>p.name==='Momos'),owner=profile.entity_ids[0],f=require('./fixtures/siteSupport/momos-kr-product.json'),url=f.url,oldId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',oldUrl='https://en.momos.co.kr/shop_view?idx=4183';
  await pg.query('insert into entities(id) values($1)',[owner]);const oldKey=require('../src/productSaver').productSourceKey(owner,{source_product_id:f.native.code},oldUrl);
  await pg.query('insert into products(id,entity_id,slug,name,source_url,source_key,availability_state) values($1,$2,$3,$4,$5,$6,$7)',[oldId,owner,'preserve-english-slug','English market coffee',oldUrl,oldKey,'in_stock']);
  const db=supabaseAdapter(pg),stock=structuredClone(f.native),html=[f.store,f.primary].map(n=>'<script type="application/ld+json">'+JSON.stringify(n)+'</script>').join(''),log=new Proxy({},{get:()=>()=>{}}),modules=new Map();let aiCalls=0;
  function load(file){file=path.resolve(file);if(modules.has(file))return modules.get(file).exports;const module={exports:{}};modules.set(file,module);const native=createRequire(file);
   function read(name){if(name==='./supabase')return{getSupabase:()=>db};if(name==='./logger')return log;if(name==='./config')return{config:{crawler:{requestDelayMs:0}}};if(name==='./gptClassifier')return{...native(name),MODEL:'fixture-model',classifyPage:async()=>{aiCalls++;return{aiCalls:1,data:{is_coffee_page:true,product:{name:'Coffee',default_price:999,currency:'USD',attributes:{}}}}}};if(name==='./imageDownloader')return{downloadAndSaveImage:async()=>null};if(name.startsWith('./')&&!name.endsWith('.json')&&!name.endsWith('.cjs'))return load(native.resolve(name));return native(name);}
   vm.runInThisContext('(function(require,module,exports){'+fs.readFileSync(file,'utf8')+'\n})',{filename:file})(read,module,module.exports);return module.exports;
  }
  const visitor=load(path.join(__dirname,'../src/pageVisitor.js'));
  const fetchHtml=async(u,opts)=>{if(u.includes('/ajax/')){assert.equal(opts.referer,url);return{success:true,status:200,finalUrl:u,data:JSON.stringify({msg:'SUCCESS',data:stock})};}return{success:true,status:200,finalUrl:u,data:html};};
  const run=async()=>{const fetched=await visitor.fetchPageContent(url,null,{siteProfile:profile,fetchHtml});assert(fetched.sourceProduct);const known=(await pg.query('select * from known_pages where url=$1',[url])).rows[0];return visitor.processFetchedPage(owner,url,fetched,log,'unknown',{siteProfile:profile,knownPage:known});};
  const first=await run();assert.equal(first.error,undefined);assert.notEqual(first.productId,oldId);assert.equal(first.isCoffee,true);assert.equal((await pg.query('select count(*)::int n from product_variants where currency=$1',['KRW'])).rows[0].n,12);
  stock.options_detail.forEach(v=>v.status='SOLDOUT');const second=await run();assert.equal(second.error,undefined);assert.equal(second.mode,'cache');assert.equal(second.productId,first.productId);assert.equal(aiCalls,1);assert.equal((await pg.query('select count(*)::int n from products')).rows[0].n,2);assert.equal((await pg.query('select count(*)::int n from product_variants')).rows[0].n,12);
  assert.deepEqual((await pg.query('select slug,source_url,availability_state from products where id=$1',[oldId])).rows[0],{slug:'preserve-english-slug',source_url:oldUrl,availability_state:'in_stock'});assert.equal((await pg.query('select availability_state from products where id=$1',[first.productId])).rows[0].availability_state,'sold_out');
 }finally{await pg.close();}
});
