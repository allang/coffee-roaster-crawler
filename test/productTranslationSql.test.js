'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {catalogDb}=require('./catalogDb');
const {buildTranslationSql}=require('../scripts/product-translation-sql.cjs');
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',vid='33333333-3333-4333-8333-333333333333';
async function fixture(){
 const db=await catalogDb({nativeWeightCompatibility:false});
 await db.query('insert into entities(id) values($1)',[owner]);
 await db.query("insert into products(id,entity_id,slug,name,original_title,source_url,description_raw,metadata) values($1,$2,'keep','부산 200g','부산 200g','https://merchant.test/coffee','원본 설명', '{}')",[id,owner]);
 await db.query("insert into product_variants(id,product_id,variant_name,weight_g,price_cents,currency) values($1,$2,'200g 홀빈',200,18000,'KRW')",[vid,id]);
 await db.query("insert into coffee_facts(product_id,process,tasting_notes_raw) values($1,'워시드','복숭아')",[id]);
 await db.query("insert into media_assets(id,url) values($1,'https://merchant.test/photo.jpg')",[vid]);
 await db.query('insert into product_media(product_id,media_asset_id) values($1,$2)',[id,vid]);
 const snapshots={};for(const t of ['products','product_variants','coffee_facts'])snapshots[t]=(await db.query(`select to_jsonb(r) value from ${t} r`)).rows.map(r=>r.value);
 const plan={version:1,products:[{id,entity_id:owner,source_url:'https://merchant.test/coffee',product_patch:{name:'Busan 200g',display_title:'Busan 200g',original_title:'부산 200g',metadata:{_translation:{source_language:'ko',target_language:'en'}}},variant_patches:[{id:vid,product_id:id,variant_name:'200g Whole Bean',provenance:{original_variant_name:'200g 홀빈',original_language:'ko'}}],facts_patch:{process:'Washed'}}]};
 return {db,snapshots,plan};
}
test('text-only translation preview rolls back; apply retains originals/media/market values and repeat makes zero events',async()=>{
 const {db,snapshots,plan}=await fixture();try{
  await db.exec(buildTranslationSql(plan,snapshots));assert.equal((await db.query('select name from products')).rows[0].name,'부산 200g');
  await db.exec(buildTranslationSql(plan,snapshots,{commit:true}));
  const p=(await db.query('select * from products')).rows[0],v=(await db.query('select * from product_variants')).rows[0],f=(await db.query('select * from coffee_facts')).rows[0];
  assert.equal(p.name,'Busan 200g');assert.equal(p.slug,'keep');assert.equal(p.original_title,'부산 200g');assert.equal(p.description_raw,'원본 설명');assert.equal(v.id,vid);assert.equal(v.weight_g,200);assert.equal(v.price_cents,18000);assert.equal(v.variant_name,'200g Whole Bean');assert.equal(f.process,'Washed');assert.equal(f.tasting_notes_raw,'복숭아');assert.equal((await db.query('select count(*)::int n from product_media')).rows[0].n,1);
  assert.deepEqual((await db.query('select content_changed,market_changed from catalog_change_events')).rows,[{content_changed:true,market_changed:false}]);
  await db.exec(buildTranslationSql(plan,snapshots,{commit:true}));assert.equal((await db.query('select count(*)::int n from catalog_change_events')).rows[0].n,1);
 }finally{await db.close();}
});
test('changed stock or prices abort translation before any text update',async()=>{
 const {db,snapshots,plan}=await fixture();try{await db.query('update product_variants set price_cents=19000');await assert.rejects(db.exec(buildTranslationSql(plan,snapshots,{commit:true})),/snapshot drift/);await db.exec('rollback');assert.equal((await db.query('select name from products')).rows[0].name,'부산 200g');assert.equal((await db.query('select price_cents from product_variants')).rows[0].price_cents,19000);assert.equal((await db.query('select count(*)::int n from catalog_change_events')).rows[0].n,0);}finally{await db.close();}
});
test('non-text patches and altered original option names are rejected',async()=>{
 const {db,snapshots,plan}=await fixture();try{const bad=structuredClone(plan);bad.products[0].product_patch.is_available=true;assert.throws(()=>buildTranslationSql(bad,snapshots),/Non-text/);plan.products[0].variant_patches[0].provenance.original_variant_name='invented';assert.throws(()=>buildTranslationSql(plan,snapshots),/original label/);}finally{await db.close();}
});
