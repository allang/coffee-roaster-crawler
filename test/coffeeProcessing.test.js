'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {processingForProduct,scopedDescription}=require('../src/coffeeProcessing');
const {catalogPayload}=require('../src/productSaver');
const {catalogDb}=require('./catalogDb');
const make=(text,attributes={})=>processingForProduct({name:'Coffee',attributes,description_html:text});
test('natural and anaerobic remain simultaneous searchable methods with original wording',()=>{
 const p=make('<dl><dt>Process</dt><dd>Double Anaerobic Natural</dd></dl>');
 assert.equal(p.process,'Double Anaerobic Natural');assert.deepEqual(p.process_methods,['natural','anaerobic']);assert.equal(p.is_coferment,null);
});
test('source processing labels retain multilingual methods',()=>{
 assert.deepEqual(make('<p>Proceso: Natural anaeróbico</p>').process_methods,['natural','anaerobic']);
 assert.deepEqual(make('<p>Aufbereitung: Anaerobe gewaschen</p>').process_methods,['washed','anaerobic']);
});
test('processing prose cannot turn natural aromas into a process, while inline labels remain supported',()=>{
 const p=make('<p>Processing this coffee preserves natural aromas and honey sweetness.</p>');assert.equal(p.process,null);assert.deepEqual(p.process_methods,[]);
 assert.deepEqual(make('<div><span>Processing</span><span>Anaerobic Natural</span></div>').process_methods,['natural','anaerobic']);
 assert.equal(make('<p><strong>Process</strong>: Anaerobic Natural</p>').process,'Anaerobic Natural');
});
test('disclosed co-fermentation is separate from processing and keeps only added materials',()=>{
 const p=make('<p>Process: Anaerobic Natural</p><p>Co-fermented with watermelon and pineapple.</p><p>Tasting notes: Strawberry.</p>');
 assert.deepEqual(p.process_methods,['natural','anaerobic']);assert.equal(p.is_coferment,true);assert.deepEqual(p.coferment_ingredients,['watermelon','pineapple']);
 assert(p.evidence.coferment[0].quote.includes('Co-fermented'));assert.equal(p.evidence.coferment_conflict,false);
});
test('fruity notes, natural sweetness, anaerobic processing, infusion and yeast do not infer co-fermentation',()=>{
 for(const text of ['<p>Natural sweetness with honey and strawberry notes.</p>','<p>Process: Anaerobic Natural</p><p>Notes of watermelon.</p>','<p>Fermented with yeast.</p>','<p>Infused with cinnamon.</p>']){
  const p=make(text,{is_coferment:true,coferment_ingredients:['strawberry']});assert.equal(p.is_coferment,null);assert.deepEqual(p.coferment_ingredients,[]);
 }
 assert.deepEqual(make('<p>Natural sweetness with honey and strawberry notes.</p>').process_methods,[]);
});
test('explicit denial is false, silence is unknown, and conflicting disclosures stay unknown',()=>{
 assert.equal(make('<p>Process: Washed</p><p>Not co-fermented.</p>').is_coferment,false);
 assert.equal(make('<p>Process: Washed</p>').is_coferment,null);
 const conflict=make('<p>Co-fermented with pineapple.</p><p>This is not co-fermented.</p>');assert.equal(conflict.is_coferment,null);assert.equal(conflict.evidence.coferment_conflict,true);assert.deepEqual(conflict.coferment_ingredients,[]);
});
test('co-ferment wording never turns tasting notes into ingredients and unknown recipes remain empty',()=>{
 const p=make('<p>This coffee is cofermented.</p><p>Notes of strawberries and mango.</p>',{coferment_ingredients:['strawberries','mango']});
 assert.equal(p.is_coferment,true);assert.deepEqual(p.coferment_ingredients,[]);
});
test('contrast with prior offerings does not hide a current explicit disclosure',()=>{
 assert.equal(make('<p>Unlike earlier offerings, this coffee is a traditional cofermented coffee.</p>').is_coferment,true);
 assert.equal(make('<p>This coffee is not only co-fermented but also naturally dried.</p>').is_coferment,true);
 assert.equal(make('<p>Could this coffee be co-fermented?</p>').is_coferment,null);
 assert.equal(make('<p>Unlike co-fermented coffees, this is a standard washed coffee.</p>').is_coferment,null);
});
test('current structured boolean disclosure is typed and does not depend on description inference',()=>{
 const p=processingForProduct({name:'Coffee',attributes:{}},{sourceAttributes:{is_coferment:true,coferment_ingredients:['watermelon'],process_methods:['natural']}});
 assert.equal(p.is_coferment,true);assert.deepEqual(p.coferment_ingredients,['watermelon']);assert.deepEqual(p.process_methods,['natural']);
 assert.equal(processingForProduct({name:'Coffee'},{sourceAttributes:{is_coferment:false}}).is_coferment,false);
 assert.equal(processingForProduct({name:'Coffee'},{sourceAttributes:{is_coferment:'true'}}).is_coferment,true);
 assert.equal(processingForProduct({name:'Coffee'},{sourceAttributes:{is_coferment:'No'}}).is_coferment,false);
 assert.equal(processingForProduct({name:'Coffee'},{sourceAttributes:{is_coferment:'possibly'}}).is_coferment,null);
});
test('scoped descriptions ignore recommendation cards and unscoped page wording',()=>{
 const html='<main><div class="product__description"><p>Process: Washed</p><aside>Co-fermented with pineapple.</aside></div><div class="related-products"><p>Co-fermented with mango.</p></div></main>';
 const p=make(scopedDescription(html));assert.equal(p.process,'Washed');assert.equal(p.is_coferment,null);
 assert.equal(scopedDescription('<main><h1>Coffee</h1><div class="related-products">Co-ferment coffee</div></main>'),null);
});
test('uncertain processes retain raw wording without definite taxonomy and Unicode co-ferment is captured',()=>{
 const p=make('',{process:'Possibly anaerobic natural?'});assert.equal(p.process,'Possibly anaerobic natural?');assert.deepEqual(p.process_methods,[]);
 assert.equal(make('<p>Co\u2011fermented with watermelon.</p>').is_coferment,true);
});
test('processing SQL save is atomic, stable, stale-guarded and avoids unchanged events',async()=>{
 const pg=await catalogDb(),owner='11111111-1111-4111-8111-111111111111',url='https://shop.test/products/coffee';
 const payload=(coferment,time)=>catalogPayload(owner,{name:'Coffee',description_html:`<p>Process: Anaerobic Natural</p><p>${coferment?'Co-fermented with watermelon.':'Not co-fermented.'}</p>`,variants:[{id:'11',title:'250g',price:'20',currency:'USD',available:true}]},url,null,{state:'in_stock',evidence:[]},time);
 const save=async p=>(await pg.query('select save_catalog_product_v2($1) result',[p])).rows[0].result;
 const facts=async()=>(await pg.query('select * from coffee_facts')).rows[0];
 const events=async()=>(await pg.query('select count(*)::int n from catalog_change_events')).rows[0].n;
 try{
  await pg.query('insert into entities(id) values($1)',[owner]);
  await save(payload(true,'2026-10-07T14:00:00Z'));
  const initial=await facts(),variant=(await pg.query('select * from product_variants')).rows[0];
  assert.equal(initial.process,'Anaerobic Natural');assert.deepEqual(initial.process_methods,['natural','anaerobic']);assert.equal(initial.is_coferment,true);assert.deepEqual(initial.coferment_ingredients,['watermelon']);assert.equal(await events(),1);
  assert.equal(initial.processing_evidence.source_url,url);
  assert.equal((await pg.query("select count(*)::int n from coffee_facts where process_methods @> array['natural','anaerobic'] and is_coferment is true")).rows[0].n,1);
  assert.equal((await save(payload(true,'2026-10-07T14:01:00Z'))).content_changed,false);assert.equal(await events(),1);
  await save(payload(false,'2026-10-07T14:02:00Z'));assert.equal((await facts()).is_coferment,false);assert.equal(await events(),2);
  assert.equal((await save(payload(true,'2026-10-07T14:01:30Z'))).stale_observation_ignored,true);assert.equal((await facts()).is_coferment,false);assert.equal(await events(),2);
  const after=(await pg.query('select * from product_variants')).rows[0];assert.equal(after.id,variant.id);assert.deepEqual(after.created_at,variant.created_at);
  const bad=payload(false,'2026-10-07T14:03:00Z');bad.product.name='Invalid update';bad.variants[0].price_minor_units=500;bad.facts.coferment_ingredients=['pineapple'];
  await assert.rejects(save(bad),/coffee_coferment_ingredients_disclosed/);
  assert.equal((await pg.query('select name from products')).rows[0].name,'Coffee');assert.equal((await pg.query('select price_minor_units from product_variants')).rows[0].price_minor_units,2000);assert.equal(await events(),2);
  await pg.exec('set role service_role');assert.equal((await save(payload(false,'2026-10-07T14:04:00Z'))).content_changed,false);
  await pg.exec('reset role');
  await pg.exec('set role authenticated');await assert.rejects(save(payload(true,'2026-10-07T14:04:00Z')),/permission denied/);
 }finally{await pg.close();}
});
