'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildPlan,deepMerge}=require('../src/tierOneMergePlan.cjs');
const {catalogDb,supabaseAdapter}=require('./catalogDb');
const {findExistingProduct,saveProduct}=require('../src/productSaver');
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
const old='33333333-3333-4333-8333-333333333333',fresh='44444444-4444-4444-8444-444444444444';
const at='2026-10-08T19:00:00Z',url='https://shop.test/products/coffee';
function snapshot() {
  return {entities:[{id:a,slug:'coffee'},{id:b,slug:'coffee-osm-record'}],products:[{id:old,entity_id:a,slug:'coffee',source_url:url+'?utm_source=old',metadata:{reviewed_photo:true},is_active:true,is_available:true,last_seen_at:'2026-01-01T00:00:00Z',source_key:null},{id:fresh,entity_id:b,slug:'coffee',source_url:url,metadata:{_normalization:{source_product_id:'123'}},is_active:true,is_available:true,last_seen_at:at,source_key:'old-owner-key'}],product_media:[{product_id:old,media_asset_id:old,sort_order:0,created_at:'2026-01-01T00:00:00Z'}],product_variants:[],coffee_facts:[],product_flavor_claims:[],product_flavor_tags:[]};
}
test('owner merge retains IDs, prefers fresh native evidence and carries a repaired photo',()=>{
  const s=snapshot(),before=structuredClone(s),p=buildPlan(s,[['Coffee',a,b]],at);
  assert.deepEqual(s,before);
  assert.equal(p.products.length,2);assert.equal(p.groups[0].archived_duplicates,1);
  assert.equal(p.products.find(p=>p.id===old).canonical_product_id,fresh);
  assert.equal(p.products.find(p=>p.id===old).source_key,null);
  assert.equal(p.products.find(p=>p.id===old).metadata.reviewed_photo,true);
  assert.equal(p.products.find(p=>p.id===fresh).source_key.length,64);
  assert.deepEqual(p.carried_media.map(m=>[m.product_id,m.media_asset_id]),[[fresh,old]]);
});
test('different source identities with the same slug remain distinct coffees',()=>{
  const s=snapshot();s.products[1].source_url='https://shop.test/products/another';
  const p=buildPlan(s,[['Coffee',a,b]],at);
  assert.equal(p.groups[0].archived_duplicates,0);
  assert.equal(new Set(p.products.map(p=>p.slug)).size,2);
});
test('merge refuses overlapping groups or a longer canonical slug',()=>{
  const s=snapshot();assert.throws(()=>buildPlan(s,[['Coffee',a,b],['Again',a,b]],at),/overlapping/);
  assert.throws(()=>buildPlan(s,[['Coffee',b,a]],at),/simpler/);
  assert.deepEqual(deepMerge({provenance:{a:1}},{provenance:{b:2}}),{provenance:{a:1,b:2}});
});
test('normal persistence reuses canonical product while retaining historical copy, variants and photos',async()=>{
  const pg=await catalogDb({nativeWeightCompatibility:false});
  try {
    await pg.query('insert into entities(id) values($1)',[a]);
    await pg.query("insert into products(id,entity_id,slug,name,source_url,metadata,is_active,is_available) values($1,$2,'historical','Coffee',$3,$4,false,false)",[old,a,url,{_entity_merge:{reason:'duplicate_source_identity',canonical_product_id:fresh}}]);
    await pg.query("insert into products(id,entity_id,slug,name,source_url) values($1,$2,'current','Coffee',$3)",[fresh,a,url]);
    await pg.query("insert into product_variants(id,product_id,variant_name,weight_g,price_cents,currency) values($1,$2,'250g',250,1000,'USD')",[old,old]);
    await pg.query("insert into media_assets(id,url) values($1,'https://images.test/repaired')",[old]);
    await pg.query('insert into product_media(product_id,media_asset_id) values($1,$1)',[old]);
    const before=(await pg.query('select * from product_variants where product_id=$1',[old])).rows;
    const db=supabaseAdapter(pg);
    assert.equal((await findExistingProduct(db,a,url,'unused')).id,fresh);
    const product={name:'Coffee',source_product_id:'123',variants:[{id:'456',title:'250g',price:'20',currency:'USD',available:true}]};
    const quiet=new Proxy({},{get:()=>()=>{}});
    assert.equal(await saveProduct(a,product,url,quiet,{db,checkedAt:at,availability:{state:'in_stock',reason:'current_source',evidence:[]}}),fresh);
    assert.equal((await pg.query('select count(*)::int as n from products')).rows[0].n,2);
    assert.deepEqual((await pg.query('select * from product_variants where product_id=$1',[old])).rows,before);
    assert.equal((await pg.query('select count(*)::int as n from product_media where product_id=$1',[old])).rows[0].n,1);
  } finally {await pg.close();}
});
