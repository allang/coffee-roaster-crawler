'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {catalogDb,supabaseAdapter}=require('../test/catalogDb');
const {saveProduct,parsePriceCents}=require('./productSaver');
const {catalogPayload}=require('./productSaver');
const owner='11111111-1111-4111-8111-111111111111',url='https://shop.test/products/coffee';
const log=new Proxy({},{get:()=>()=>{}});
test('transactional saver retains prices, exact variants and stable IDs across content/stock refreshes',async()=>{
  const pg=await catalogDb();
  try {
    await pg.query('insert into entities(id) values($1)',[owner]);
    const db=supabaseAdapter(pg),options={db,availability:{state:'in_stock',isAvailable:true,reason:'fixture',evidence:[]},checkedAt:'2026-10-06T14:00:00Z'};
    const product={name:'ETHIOPIA — BANKO',variants_complete:true,variant_price_currency:'EUR',variant_prices:[['250g / whole bean','12,00€'],['250g / espresso','12,00€']],attributes:{country_of_origin:'Ethiopia',process:'Washed',varietal:'Heirloom',flavor_notes:['Blueberries','Cotton Candy']}};
    const id=await saveProduct(owner,product,url,log,options);
    const first=await pg.query('select * from product_variants order by id');
    assert.equal(first.rows.length,2);assert(first.rows.every(v=>v.price_minor_units===1200 && v.availability_state==='unknown'));
    assert(first.rows.every(v=>v.weight_g===250));assert.equal(parsePriceCents('12,00€'),1200);
    const events=await pg.query('select * from catalog_change_events');assert.equal(events.rows.length,1);
    await saveProduct(owner,product,url,log,{...options,checkedAt:'2026-10-06T14:01:00Z'});
    assert.equal((await pg.query('select count(*)::int n from catalog_change_events')).rows[0].n,1);
    const changed={...product,name:'Ethiopia — Banko',variant_prices:[['250g / whole bean','13,00€'],['250g / espresso','13,00€']]};
    assert.equal(await saveProduct(owner,changed,url+'?utm_source=test',log,{...options,checkedAt:'2026-10-06T14:02:00Z'}),id);
    const second=await pg.query('select * from product_variants order by id');
    assert.deepEqual(second.rows.map(v=>v.id),first.rows.map(v=>v.id));assert(second.rows.every(v=>v.price_minor_units===1300));
    const facts=(await pg.query('select * from coffee_facts')).rows[0];assert.equal(facts.process,'Washed');assert.equal(facts.variety,'Heirloom');
    const p=(await pg.query('select * from products')).rows[0];assert.equal(p.display_title,'Banko');assert.equal(p.name,'Ethiopia — Banko');
    assert.equal(p.metadata._normalization.tasting_notes.notes[1].status,'unmapped');
  } finally {await pg.close();}
});
test('legacy exact source adoption preserves product/variant IDs, slug, media and optional facts',async()=>{
  const pg=await catalogDb();
  try {
    await pg.query('insert into entities(id) values($1)',[owner]);
    const id='22222222-2222-4222-8222-222222222222',variant='33333333-3333-4333-8333-333333333333';
    await pg.query('insert into products(id,entity_id,slug,name,source_url,metadata,first_seen_at) values($1,$2,$3,$4,$5,$6,$7)',[id,owner,'old-slug','Old name',url,{retained:'legacy'},'2025-01-01T00:00:00Z']);
    await pg.query("insert into product_variants(id,product_id,variant_name,weight_g,price_cents,currency) values($1,$2,'250g',250,1000,'EUR')",[variant,id]);
    await pg.query("insert into coffee_facts(product_id,process,variety,decaf) values($1,'Natural','Bourbon',false)",[id]);
    await pg.query("insert into media_assets(id,url) values($1,'https://images.test/retained')",[variant]);
    await pg.query('insert into product_media(product_id,media_asset_id) values($1,$2)',[id,variant]);
    const saved=await saveProduct(owner,{name:'New title',variant_prices:[['250g','12€']],attributes:{}},url,log,{db:supabaseAdapter(pg)});
    assert.equal(saved,id);assert.equal((await pg.query('select slug from products')).rows[0].slug,'old-slug');
    assert.equal((await pg.query('select id from product_variants')).rows[0].id,variant);
    assert.equal((await pg.query('select process from coffee_facts')).rows[0].process,'Natural');
    assert.equal((await pg.query('select count(*)::int n from product_media')).rows[0].n,1);
    assert.equal((await pg.query('select metadata from products')).rows[0].metadata.retained,'legacy');
  } finally {await pg.close();}
});
test('transaction rollback prevents partial writes and only complete native inventories retire missing variants',async()=>{
  const pg=await catalogDb();
  try {
    await pg.query('insert into entities(id) values($1)',[owner]);
    const product={name:'Coffee',variants_complete:true,variants:[{id:'v1',title:'250g',price:'12',currency:'EUR',available:true},{id:'v2',title:'500g',price:'20',currency:'EUR',available:true}]};
    const payload=catalogPayload(owner,product,url,null,{state:'in_stock',reason:'fixture'},'2026-10-06T14:00:00Z');
    const run=p=>pg.query('select save_catalog_product_v1($1::jsonb) result',[p]);
    const bad=structuredClone(payload);bad.variants[1].currency_exponent=9;
    await assert.rejects(run(bad),/check constraint/);
    assert.equal((await pg.query('select count(*)::int n from products')).rows[0].n,0);
    await run(payload);await run({...payload,variants:payload.variants.slice(0,1),variants_complete:false});
    assert((await pg.query('select * from product_variants')).rows.every(v=>v.availability_state==='in_stock'));
    await run({...payload,variants:payload.variants.slice(0,1)});
    assert.equal((await pg.query("select availability_state from product_variants where merchant_variant_id='v2'")).rows[0].availability_state,'removed');
    const stale=structuredClone(payload);stale.product.checked_at='2026-10-05T14:00:00Z';
    assert.equal((await run(stale)).rows[0].result.stale_observation_ignored,true);
    assert.equal((await pg.query("select availability_state from product_variants where merchant_variant_id='v2'")).rows[0].availability_state,'removed');
    await pg.exec('set role anon');await assert.rejects(run(payload),/permission denied/);await pg.exec('reset role');
  } finally {await pg.close();}
});
test('zero/three-decimal currencies have explicit minor units; unknown/range never invent price',()=>{
  for(const [price,currency,locale,expected] of [['1200','JPY','en-US',1200],['1.234','KWD','en-US',1234],['$12',null,null,null],['140 Kč – 1250 Kč','CZK',null,null]]) {
    const p=catalogPayload(owner,{name:'Coffee',variants:[{title:'default',price,currency,locale}]},url,null,null,'2026-10-06T14:00:00Z');
    assert.equal(p.variants[0].price_minor_units,expected);
    assert.equal(p.variants[0].availability_state,'unknown');
  }
});

test('native product identity survives source-handle changes while retrieval URL preserves observed www host',async()=>{
 const pg=await catalogDb();try{
   await pg.query('insert into entities(id) values($1)',[owner]);const options={db:supabaseAdapter(pg),checkedAt:'2026-10-06T14:00:00Z'};
   const product={name:'Coffee',source_product_id:'900',variants:[{source_id:'901',title:'250g',price:'12',currency:'EUR'}]};
   const first=await saveProduct(owner,product,'https://www.shop.test/products/old-handle',log,options);
   assert.equal((await pg.query('select source_url from products')).rows[0].source_url,'https://www.shop.test/products/old-handle');
   const variants=(await pg.query('select id from product_variants')).rows;
   const second=await saveProduct(owner,{...product,name:'Renamed coffee'},'https://www.shop.test/products/new-handle',log,{...options,checkedAt:'2026-10-06T14:01:00Z'});
   assert.equal(first,second);assert.deepEqual((await pg.query('select id from product_variants')).rows,variants);
   assert.equal((await pg.query('select count(*)::int n from products')).rows[0].n,1);
 }finally{await pg.close();}
});
