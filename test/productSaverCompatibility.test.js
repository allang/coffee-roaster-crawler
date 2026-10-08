'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {catalogDb,supabaseAdapter}=require('./catalogDb');
const {saveProduct}=require('../src/productSaver');
const owner='11111111-1111-4111-8111-111111111111',url='https://shop.test/products/coffee';
const missing={code:'PGRST202',message:'Could not find the function public.save_catalog_product_v2(payload) in the schema cache'};
const quiet=new Proxy({},{get:()=>()=>{}});
async function previousCatalog() {
  const pg=new PGlite();
  await pg.exec(fs.readFileSync(path.join(__dirname,'fixtures/catalogSchema.sql'),'utf8'));
  await pg.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261006134031_catalog_refresh_v1.sql'),'utf8'));
  await pg.query('insert into entities(id) values($1)',[owner]);
  return pg;
}
function restAdapter(pg) {
  const db=supabaseAdapter(pg),actual=db.rpc,calls=[];
  db.rpc=async(name,args)=>{
    calls.push(name);
    const result=await actual(name,args);
    // PGlite produces PostgreSQL's undefined-function error; PostgREST reports
    // the corresponding missing RPC before invoking the database function.
    if(name==='save_catalog_product_v2' && result.error?.code==='42883')return {data:null,error:missing};
    return result;
  };
  return {db,calls};
}
const coffee=(disclosure,price='20')=>({name:'Coffee',description_html:`<p>Process: Anaerobic Natural</p>${disclosure?`<p>${disclosure}</p>`:''}`,variants:[{id:'11',title:'250g',price,currency:'USD',available:true}]});
const options=(db,time)=>({db,checkedAt:time,availability:{state:'in_stock',reason:'current_source',evidence:[]}});

test('previous catalog retains complete processing metadata, legacy identities and current market data',async()=>{
  const pg=await previousCatalog();
  try {
    const id='22222222-2222-4222-8222-222222222222',variant='33333333-3333-4333-8333-333333333333';
    await pg.query("insert into products(id,entity_id,slug,name,source_url,metadata,first_seen_at) values($1,$2,'retained-slug','Old coffee',$3,$4,'2025-01-01T00:00:00Z')",[id,owner,url,{unrelated:'preserved'}]);
    await pg.query("insert into product_variants(id,product_id,variant_name,weight_g,price_cents,currency) values($1,$2,'250g',250,1000,'USD')",[variant,id]);
    await pg.query("insert into media_assets(id,url) values($1,'https://images.test/retained')",[variant]);
    await pg.query('insert into product_media(product_id,media_asset_id) values($1,$2)',[id,variant]);
    const prior=(await pg.query('select * from products')).rows[0],priorVariant=(await pg.query('select * from product_variants')).rows[0];
    await pg.exec('set role service_role');
    const {db,calls}=restAdapter(pg),warnings=[],log={...quiet,warn:(...args)=>warnings.push(args),info:()=>{}};
    const product=coffee('Co-fermented with watermelon.'),time='2026-10-08T14:00:00Z';
    assert.equal(await saveProduct(owner,product,url,log,options(db,time)),id);
    const first=(await pg.query('select * from products')).rows[0],v=(await pg.query('select * from product_variants')).rows[0];
    assert.equal(first.slug,'retained-slug');assert.equal(first.metadata.unrelated,'preserved');
    assert.deepEqual(first.first_seen_at,prior.first_seen_at);assert.deepEqual(first.created_at,prior.created_at);
    assert.deepEqual(first.metadata.process_methods,['natural','anaerobic']);assert.equal(first.metadata.is_coferment,true);
    assert.deepEqual(first.metadata.coferment_ingredients,['watermelon']);
    assert.equal(first.metadata._normalization.processing.version,'processing-v1');
    assert.equal(first.metadata._normalization.processing.source_url,url);
    assert(first.metadata._normalization.processing.coferment[0].quote.includes('Co-fermented'));
    assert.equal((await pg.query('select process from coffee_facts')).rows[0].process,'Anaerobic Natural');
    assert.equal(v.id,variant);assert.deepEqual(v.created_at,priorVariant.created_at);assert.equal(v.merchant_variant_id,'11');assert.equal(v.price_minor_units,2000);assert.equal(v.availability_state,'in_stock');
    assert.equal((await pg.query('select count(*)::int n from product_media')).rows[0].n,1);
    assert.equal((await pg.query("select count(*)::int n from information_schema.columns where table_name='coffee_facts' and column_name='process_methods'")).rows[0].n,0);
    assert.equal(await saveProduct(owner,product,url,log,options(db,'2026-10-08T14:01:00Z')),id);
    assert.deepEqual(calls,['save_catalog_product_v2','save_catalog_product_v1','save_catalog_product_v1']);assert.equal(warnings.length,1);
    assert.equal((await pg.query('select count(*)::int n from catalog_change_events')).rows[0].n,1);
    await saveProduct(owner,coffee('Not co-fermented.','25'),url,log,options(db,'2026-10-08T14:02:00Z'));
    let current=(await pg.query('select * from products')).rows[0];
    assert.equal(current.metadata.is_coferment,false);assert.deepEqual(current.metadata.coferment_ingredients,[]);
    assert.equal((await pg.query('select price_minor_units from product_variants')).rows[0].price_minor_units,2500);
    await saveProduct(owner,coffee(null,'25'),url,log,options(db,'2026-10-08T14:03:00Z'));
    current=(await pg.query('select * from products')).rows[0];assert.equal(current.metadata.is_coferment,null);
    const currentVariants=(await pg.query('select * from product_variants')).rows;
    await saveProduct(owner,product,url,log,options(db,'2026-10-08T14:01:30Z'));
    assert.deepEqual((await pg.query('select * from products')).rows[0],current);
    assert.deepEqual((await pg.query('select * from product_variants')).rows,currentVariants);
  } finally {await pg.close();}
});

test('compatible v1 save still rolls back a failing catalog transaction',async()=>{
  const pg=await previousCatalog();
  try {
    await pg.exec("create function reject_catalog_variant() returns trigger language plpgsql as $$ begin raise exception 'Fixture variant rejected'; end $$; create trigger reject_catalog_variant before insert on product_variants for each row execute function reject_catalog_variant();");
    const {db,calls}=restAdapter(pg);
    await assert.rejects(saveProduct(owner,coffee('Co-fermented with watermelon.'),url,quiet,options(db,'2026-10-08T14:00:00Z')),/Fixture variant rejected/);
    assert.deepEqual(calls,['save_catalog_product_v2','save_catalog_product_v1']);
    for(const table of ['products','product_variants','coffee_facts','catalog_change_events'])assert.equal((await pg.query(`select count(*)::int n from ${table}`)).rows[0].n,0);
  } finally {await pg.close();}
});

test('installed v2 saver remains preferred and persists searchable processing fields',async()=>{
  const pg=await catalogDb();
  try {
    await pg.query('insert into entities(id) values($1)',[owner]);
    const {db,calls}=restAdapter(pg);
    await saveProduct(owner,coffee('Co-fermented with watermelon.'),url,quiet,options(db,'2026-10-08T14:00:00Z'));
    assert.deepEqual(calls,['save_catalog_product_v2']);
    const facts=(await pg.query('select * from coffee_facts')).rows[0];
    assert.deepEqual(facts.process_methods,['natural','anaerobic']);assert.equal(facts.is_coferment,true);
    assert.deepEqual(facts.coferment_ingredients,['watermelon']);assert.equal(facts.processing_evidence.source_url,url);
  } finally {await pg.close();}
});

test('only the precise missing v2 RPC permits compatibility; database and permission errors remain failures',async()=>{
  const pg=await previousCatalog();
  try {
    for(const error of [
      {code:'42501',message:'permission denied for function save_catalog_product_v2'},
      {code:'23514',message:'coffee_coferment_ingredients_disclosed'},
      {code:'PGRST202',message:'Could not find the function public.some_other_rpc(payload) in the schema cache'},
      {code:'PGRST202',message:'Could not find the function public.save_catalog_product_v2(other_payload) in the schema cache'},
      {code:'PGRST204',message:'Could not find processing_evidence in the schema cache'},
      {code:'PGRST000',message:'Could not query the database for the schema cache'}
    ]) {
      const db=supabaseAdapter(pg),calls=[];
      db.rpc=async name=>{calls.push(name);return {data:null,error};};
      await assert.rejects(saveProduct(owner,coffee(null),url,quiet,options(db,'2026-10-08T14:00:00Z')),actual=>actual===error);
      assert.deepEqual(calls,['save_catalog_product_v2']);
    }
    const db=supabaseAdapter(pg),calls=[],v1Error={code:'42501',message:'permission denied for function save_catalog_product_v1'};
    db.rpc=async name=>{calls.push(name);return {data:null,error:name==='save_catalog_product_v2'?missing:v1Error};};
    await assert.rejects(saveProduct(owner,coffee(null),url,quiet,options(db,'2026-10-08T14:00:00Z')),actual=>actual===v1Error);
    assert.deepEqual(calls,['save_catalog_product_v2','save_catalog_product_v1']);
  } finally {await pg.close();}
});
