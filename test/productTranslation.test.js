'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {translateProductForSave,validate}=require('../src/productTranslation');
const {catalogPayload,productSourceKey,saveProduct}=require('../src/productSaver');
const {catalogDb,supabaseAdapter}=require('./catalogDb');
const owner='11111111-1111-4111-8111-111111111111',url='https://merchant.test/products/coffee';
const input={name:'부산 커피 200g',description_raw:'복숭아와 자스민. 200g 원두.',description_html:'<p>복숭아와 자스민. 200g 원두.</p>',attributes:{description:'복숭아와 자스민. 200g 원두.',short_description:'복숭아 커피 200g',flavor_notes:['복숭아','자스민'],is_decaf:false},source_product_id:'123',variants_complete:true,variants:[{source_id:'456',title:'200g 홀빈',weight_g:200,price:'18000',currency:'KRW',available:false}]};
const dictionary={'부산 커피 200g':'Busan Coffee 200g','복숭아와 자스민. 200g 원두.':'Peach and jasmine. 200g coffee beans.','복숭아 커피 200g':'Peach coffee 200g','복숭아':'Peach','자스민':'Jasmine','200g 홀빈':'200g Whole Bean'};
const request=async bundle=>({aiCalls:1,usage:{prompt_tokens:20,completion_tokens:10,reported_calls:1},data:{source_language:'ko',translations:bundle.texts.map(t=>({id:t.id,text:dictionary[t.text] || t.text}))}});
test('number validation separates adjacent pack counts but retains thousands and decimal quantities',()=>{
 const check=(source,target)=>validate({source_language:'ko',translations:[{id:'option',text:target}]},[{id:'option',text:source}]);
 assert.doesNotThrow(()=>check('10g×50, 12g×50','10g×50,12g×50'));
 assert.doesNotThrow(()=>check('1,000g / 1.5kg','1000g / 1.5kg'));
 assert.throws(()=>check('10g×50, 12g×50','10g×50,12g×40'),/numeric facts/);
 assert.throws(()=>check('1,000g / 1.5kg','100g / 1.6kg'),/numeric facts/);
});
test('English display text retains original schema fields, original tasting notes, native identity and market facts',async()=>{
 const p=await translateProductForSave(input,url,{request});assert.equal(input.name,'부산 커피 200g');assert.equal(p.name,'Busan Coffee 200g');
 const payload=catalogPayload(owner,p,url,null,{state:'sold_out',variants:[{source_id:'456',state:'sold_out',evidence:[]}]},'2026-10-08T22:00:00Z');
 assert.equal(payload.product.name,'Busan Coffee 200g');assert.equal(payload.product.original_title,input.name);assert.equal(payload.product.description_raw,input.description_raw);assert.equal(payload.product.description_html,input.description_html);
 assert.deepEqual(payload.product.metadata.flavor_notes,['Peach','Jasmine']);assert.equal(payload.facts.tasting_notes_raw,'복숭아, 자스민');assert.equal(payload.product.metadata._translation.source_language,'ko');
 assert.equal(productSourceKey(owner,p,url),productSourceKey(owner,input,url));assert.equal(payload.variants[0].merchant_variant_id,'456');assert.equal(payload.variants[0].weight_g,200);assert.equal(payload.variants[0].price_minor_units,18000);assert.equal(payload.variants[0].currency,'KRW');assert.equal(payload.variants[0].availability_state,'sold_out');assert.equal(payload.variants[0].provenance.original_variant_name,'200g 홀빈');
});
test('translation cache is reused on price and stock changes and invalidated on changed source text',async()=>{
 let calls=0;const r=async b=>{calls++;return request(b);};const first=await translateProductForSave(input,url,{request:r});
 const changed=structuredClone(input);changed.variants[0].price='19000';changed.variants[0].available=true;
 const second=await translateProductForSave(changed,url,{previous:first.attributes._translation,request:r});assert.equal(calls,1);assert.equal(second.variants[0].price,'19000');assert.equal(second.variants[0].available,true);
 changed.attributes.short_description='Changed English summary 200g';await translateProductForSave(changed,url,{previous:first.attributes._translation,request:r});assert.equal(calls,2);
});
test('wrong/missing fields, untranslated script and changed numeric quantities fail before any catalog write',async()=>{
 const pg=await catalogDb();try{await pg.query('insert into entities(id) values($1)',[owner]);
 for(const mutate of [r=>r.data.translations.pop(),r=>r.data.translations[0].text='부산 커피 200g',r=>r.data.translations[0].text='Busan Coffee 250g',r=>r.error='Provider refused',r=>r.data.translations[0].id='extra']){
  await assert.rejects(saveProduct(owner,input,url,new Proxy({},{get:()=>()=>{}}),{db:supabaseAdapter(pg),translationRequest:async b=>{const r=await request(b);mutate(r);return r;}}));assert.equal((await pg.query('select count(*)::int n from products')).rows[0].n,0);
 }
 }finally{await pg.close();}
});
test('translated saves adopt original-language legacy option IDs and persist English columns without changing source text or stock',async()=>{
 const pg=await catalogDb({nativeWeightCompatibility:false});try{
  const id='22222222-2222-4222-8222-222222222222',variantId='33333333-3333-4333-8333-333333333333';await pg.query('insert into entities(id) values($1)',[owner]);await pg.query('insert into products(id,entity_id,slug,name,source_url) values($1,$2,$3,$4,$5)',[id,owner,'keep-slug',input.name,url]);
  await pg.query('insert into product_variants(id,product_id,variant_name,weight_g,currency) values($1,$2,$3,200,$4)',[variantId,id,'200g 홀빈','KRW']);
  const db=supabaseAdapter(pg),saved=await saveProduct(owner,input,url,new Proxy({},{get:()=>()=>{}}),{db,translationRequest:request,availability:{state:'sold_out',variants:[{source_id:'456',state:'sold_out',evidence:[]}]}});assert.equal(saved,id);
  const p=(await pg.query('select * from products where id=$1',[id])).rows[0];assert.equal(p.name,'Busan Coffee 200g');assert.equal(p.slug,'keep-slug');assert.equal(p.original_title,input.name);assert.equal(p.description,'Peach and jasmine. 200g coffee beans.');assert.equal(p.description_raw,input.description_raw);assert.equal(p.is_available,false);
  const v=(await pg.query('select * from product_variants')).rows;assert.equal(v.length,1);assert.equal(v[0].id,variantId);assert.equal(v[0].variant_name,'200g Whole Bean');
  await saveProduct(owner,input,url,new Proxy({},{get:()=>()=>{}}),{db,translationRequest:async()=>{throw Error('Cache should be reused');},availability:{state:'sold_out'}});assert.equal((await pg.query('select count(*)::int n from product_variants')).rows[0].n,1);
 }finally{await pg.close();}
});
