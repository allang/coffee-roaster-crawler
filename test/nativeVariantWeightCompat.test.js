'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const {PGlite}=require('@electric-sql/pglite');
const {catalogPayload}=require('../src/productSaver');
const root=path.resolve(__dirname,'..');
const fixture=fs.readFileSync(path.join(__dirname,'fixtures/catalogSchema.sql'),'utf8');
const base=fs.readFileSync(path.join(root,'supabase/migrations/20261006134031_catalog_refresh_v1.sql'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261008155858_native_variant_weight_compat.sql'),'utf8');
const rollback=fs.readFileSync(path.join(root,'docs/NATIVE_VARIANT_WEIGHT_COMPATIBILITY.md'),'utf8').match(/```sql\n([\s\S]*?)\n```/)[1];
const oldDefinition='CREATE UNIQUE INDEX product_variants_unique_weight_per_product ON public.product_variants USING btree (product_id, weight_g) WHERE (weight_g IS NOT NULL)';
const newDefinition='CREATE UNIQUE INDEX product_variants_unique_weight_per_product ON public.product_variants USING btree (product_id, weight_g) WHERE ((weight_g IS NOT NULL) AND (source_key IS NULL))';
const sourceDefinition='CREATE UNIQUE INDEX variants_source_key_unique ON public.product_variants USING btree (product_id, source_key) WHERE (source_key IS NOT NULL)';
const literal=s=>"'"+String(s).replace(/'/g,"''")+"'";
const owner='11111111-1111-4111-8111-111111111111',productId='22222222-2222-4222-8222-222222222222',variantId='33333333-3333-4333-8333-333333333333',url='https://merchant.test/products/same-weight-coffee';
async function pgliteDriver(){const pg=new PGlite();return {version:async()=>((await pg.query('show server_version')).rows[0].server_version),exec:async sql=>{try{return await pg.exec(sql);}catch(error){await pg.exec('rollback');throw error;}},json:async sql=>(await pg.query(`select coalesce(json_agg(q),'[]'::json) as rows from (${sql}) q`)).rows[0].rows,close:()=>pg.close()};}
const pgBin=process.env.PG_BIN || '/opt/homebrew/opt/postgresql@17/bin';
const nativeAvailable=process.platform!=='win32' && process.getuid?.()!==0 && ['postgres','initdb','pg_ctl','psql'].every(name=>fs.existsSync(path.join(pgBin,name)));
async function nativeDriver(){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ec-weight-')),data=path.join(temp,'db');
  const env={...process.env};for(const name of Object.keys(env))if(/^PG/.test(name))delete env[name];
  function run(name,args,input){const r=spawnSync(path.join(pgBin,name),args,{encoding:'utf8',env,input,maxBuffer:8*1024*1024});if(r.status!==0)throw Error(r.stderr || r.error?.message || name+' failed');return r.stdout.trim();}
  let started=false;
  try{
    run('initdb',['-D',data,'-U','weight_test_admin','--auth=trust','--encoding=UTF8','--no-locale']);
    fs.appendFileSync(path.join(data,'postgresql.conf'),`\nlisten_addresses=''\nunix_socket_directories='${temp}'\nmax_connections=8\nshared_buffers='16MB'\n`);
    run('pg_ctl',['-D',data,'-l',path.join(temp,'postgres.log'),'-w','start']);started=true;
  }catch(error){if(started)run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);fs.rmSync(temp,{recursive:true,force:true});throw error;}
  const query=sql=>run('psql',['-X','--host',temp,'--port','5432','--username','weight_test_admin','--dbname','postgres','--set','ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet'],sql);
  return {version:async()=>query('show server_version'),exec:async sql=>query(sql),json:async sql=>JSON.parse(query(`select coalesce(json_agg(q),'[]'::json) from (${sql}) q`)),close:async()=>{try{run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);}finally{fs.rmSync(temp,{recursive:true,force:true});}}};
}
async function exercise(db,t){
  t.diagnostic('PostgreSQL '+await db.version());
  await db.exec(fixture+base);
  const index=async()=>(await db.json("select c.oid,pg_get_indexdef(c.oid) definition,i.indisvalid,i.indisready from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_index i on i.indexrelid=c.oid where n.nspname='public' and c.relname='product_variants_unique_weight_per_product'")).at(0);
  const snapshot=async()=>({products:await db.json('select * from public.products order by id'),variants:await db.json('select * from public.product_variants order by id'),facts:await db.json('select * from public.coffee_facts order by product_id'),media:await db.json('select * from public.product_media order by product_id,media_asset_id'),events:await db.json('select * from public.catalog_change_events order by id')});
  const apply=sql=>db.exec(sql),save=p=>db.exec(`set role service_role;select public.save_catalog_product_v1(${literal(JSON.stringify(p))}::jsonb);reset role;`);
  // Fresh catalog initialization remains compatible with the shared structural fixture.
  await apply(migration);assert.equal((await index()).definition,newDefinition);
  await apply(rollback);assert.equal((await index()).definition,oldDefinition);
  await db.exec(`insert into public.entities(id) values('${owner}');
    insert into public.products(id,entity_id,slug,name,source_url,metadata,first_seen_at) values('${productId}','${owner}','retained-slug','Original coffee','${url}','{"unrelated":"retained"}','2025-01-01T00:00:00Z');
    insert into public.product_variants(id,product_id,variant_name,weight_g,price_cents,currency) values('${variantId}','${productId}','250g / Whole bean',250,1500,'USD');
    insert into public.coffee_facts(product_id,variety) values('${productId}','Retained variety');
    insert into public.media_assets(id,url) values('${variantId}','https://images.test/preserved');
    insert into public.product_media(product_id,media_asset_id) values('${productId}','${variantId}');`);
  const before=await snapshot(),product={name:'Same weight coffee',source_product_id:'900',attributes:{process:'Washed'},variants_complete:true,variants:[{source_id:'101',title:'250g / Whole bean',weight_g:250,price:'20',currency:'USD',available:true},{source_id:'102',title:'250g / Espresso',weight_g:250,price:'21',currency:'USD',available:true}]};
  const payload=catalogPayload(owner,product,url,{id:productId,slug:'retained-slug',source_url:url},{state:'in_stock',evidence:[]},'2026-10-08T16:00:00Z');
  await assert.rejects(save(payload),/product_variants_unique_weight_per_product/);assert.deepEqual(await snapshot(),before);
  await apply(migration);assert.deepEqual(await snapshot(),before);assert.equal((await index()).definition,newDefinition);
  const firstIndex=await index();await apply(migration);assert.deepEqual(await index(),firstIndex);assert.deepEqual(await snapshot(),before);
  // Rollback can restore the old guard only while the existing rows are compatible.
  await apply(rollback);assert.equal((await index()).definition,oldDefinition);assert.deepEqual(await snapshot(),before);
  const restored=await index();await apply(rollback);assert.deepEqual(await index(),restored);
  await apply(migration);await save(payload);
  const first=await snapshot();assert.equal(first.products[0].id,productId);assert.equal(first.products[0].slug,'retained-slug');assert.equal(first.products[0].first_seen_at,before.products[0].first_seen_at);assert.equal(first.products[0].created_at,before.products[0].created_at);assert.equal(first.products[0].metadata.unrelated,'retained');assert.deepEqual(first.media,before.media);
  assert.deepEqual(first.variants.map(v=>v.weight_g),[250,250]);assert(first.variants.some(v=>v.id===variantId && v.merchant_variant_id==='101'));assert.equal(new Set(first.variants.map(v=>v.source_key)).size,2);assert.deepEqual(first.variants.map(v=>v.merchant_variant_id).sort(),['101','102']);
  payload.product.checked_at='2026-10-08T16:01:00Z';payload.variants.forEach(v=>v.availability_checked_at=payload.product.checked_at);await save(payload);
  const repeated=await snapshot();assert.deepEqual(repeated.variants.map(v=>[v.id,v.created_at,v.weight_g]),first.variants.map(v=>[v.id,v.created_at,v.weight_g]));assert.equal(repeated.events.length,first.events.length);
  // Stable source-keyed labels without native IDs use the same installed identity contract.
  const labels=catalogPayload(owner,{name:'Label choices',attributes:{},variant_prices:[['250g / Whole bean','USD 22'],['250g / Espresso','USD 23']]},'https://merchant.test/products/label-choices',null,null,'2026-10-08T16:02:00Z');
  await save(labels);const labelRows=await db.json(`select id,source_key,merchant_variant_id,weight_g,created_at from public.product_variants where product_id='${labels.product.id}' order by id`);
  assert.equal(labelRows.length,2);assert(labelRows.every(v=>v.merchant_variant_id===null && v.source_key && v.weight_g===250));
  await save(labels);assert.deepEqual(await db.json(`select id,source_key,merchant_variant_id,weight_g,created_at from public.product_variants where product_id='${labels.product.id}' order by id`),labelRows);
  // Legacy rows without source identities still cannot duplicate a known weight.
  await db.exec(`insert into public.product_variants(product_id,variant_name,weight_g,currency) values('${productId}','Legacy unknown identity',250,'USD');`);
  await assert.rejects(db.exec(`insert into public.product_variants(product_id,variant_name,weight_g,currency) values('${productId}','Other unknown identity',250,'USD');`),/product_variants_unique_weight_per_product/);
  const key=first.variants[0].source_key;
  await assert.rejects(db.exec(`insert into public.product_variants(product_id,source_key,variant_name,weight_g,currency) values('${productId}',${literal(key)},'Duplicate identified SKU',500,'USD');`),/variants_source_key_unique/);
  const stable=await snapshot(),stableIndex=await index();
  await assert.rejects(apply(rollback),/Cannot restore global weight uniqueness: distinct same-weight variants exist/);assert.deepEqual(await snapshot(),stable);assert.deepEqual(await index(),stableIndex);
  await apply(migration);assert.deepEqual(await snapshot(),stable);assert.deepEqual(await index(),stableIndex);
  // Changed predicates and constraint-owned indexes must not be silently replaced.
  await db.exec('drop index public.product_variants_unique_weight_per_product;create unique index product_variants_unique_weight_per_product on public.product_variants(product_id,weight_g) where weight_g<0;');
  const wrong=await index();await assert.rejects(apply(migration),/Unexpected weight uniqueness index definition/);await assert.rejects(apply(rollback),/Unexpected rollback weight index definition/);assert.deepEqual(await index(),wrong);assert.deepEqual(await snapshot(),stable);
  await db.exec('drop index public.product_variants_unique_weight_per_product;alter table public.product_variants add constraint product_variants_unique_weight_per_product unique(product_id,source_key);');
  const owned=await index();await assert.rejects(apply(migration),/constraint-owned/);await assert.rejects(apply(rollback),/non-constraint-owned/);assert.deepEqual(await index(),owned);assert.deepEqual(await snapshot(),stable);
  await db.exec('alter table public.product_variants drop constraint product_variants_unique_weight_per_product;'+newDefinition+';');
  await db.exec('drop index public.variants_source_key_unique;create unique index variants_source_key_unique on public.product_variants(product_id,source_key) where source_key<>\'\';');
  await assert.rejects(apply(migration),/requires the valid installed source-key uniqueness index/);assert.deepEqual(await snapshot(),stable);
  await db.exec('drop index public.variants_source_key_unique;'+sourceDefinition+';drop index public.product_variants_unique_weight_per_product;');
  await assert.rejects(apply(migration),/Weight uniqueness index missing on populated catalog/);assert.equal(await index(),undefined);assert.deepEqual(await snapshot(),stable);
  t.diagnostic('Verified old failure, atomic preservation, source/native/label identity, repeat save/migration, legacy duplicate denial, safe/refused rollback and fail-closed schema drift');
}
test('weight compatibility migration preserves identified same-weight variants in PostgreSQL/PGlite',async t=>{const db=await pgliteDriver();try{await exercise(db,t);}finally{await db.close();}});
test('weight compatibility migration executes against isolated native PostgreSQL', {skip:nativeAvailable?false:'Native PostgreSQL unavailable; PGlite contract test still runs'},async t=>{const db=await nativeDriver();try{await exercise(db,t);}finally{await db.close();}});
test('shared catalog fixture explicitly selects the latest or pre-compatibility index state',async()=>{
  const {catalogDb}=require('./catalogDb'),latest=await catalogDb(),previous=await catalogDb({nativeWeightCompatibility:false});
  try {
    assert.equal((await latest.query("select pg_get_indexdef(to_regclass('public.product_variants_unique_weight_per_product')) definition")).rows[0].definition,newDefinition);
    assert.equal((await previous.query("select to_regclass('public.product_variants_unique_weight_per_product') weight_index")).rows[0].weight_index,null);
    assert.notEqual((await previous.query("select to_regprocedure('public.save_catalog_product_v2(jsonb)') processing_rpc")).rows[0].processing_rpc,null);
    await previous.exec(oldDefinition+';');
    assert.equal((await previous.query("select pg_get_indexdef(to_regclass('public.product_variants_unique_weight_per_product')) definition")).rows[0].definition,oldDefinition);
  } finally {await latest.close();await previous.close();}
});
