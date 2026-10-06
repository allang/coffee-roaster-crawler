'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const parsers=require('./product-value-parsers.cjs');
function load() {
  const mutations=[],log=new Proxy({}, {get:()=>()=>{}});
  const db={from(table){const query={operation:'read',select(){return this;},eq(){return this;},single(){return this;},
    delete(){this.operation='delete';return this;},insert(body){this.operation='insert';this.body=body;return this;},
    update(body){this.operation='update';this.body=body;return this;},
    then(resolve,reject){if(this.operation!=='read')mutations.push({table,operation:this.operation,body:this.body});
      return Promise.resolve({error:null,data:table==='products'&&this.operation==='insert'?{id:'test-product'}:null}).then(resolve,reject);}};return query;}};
  const module={exports:{}};
  const context={module,exports:module.exports,require(name){
    if(name==='./supabase')return{getSupabase:()=>db};
    if(name==='./logger')return log;
    if(name==='./imageDownloader')return{downloadAndSaveImage:async()=>{}};
    if(name==='./availability')return{updateProductAvailability:async()=>{}};
    if(name==='./product-value-parsers.cjs')return parsers;
    throw Error('Unexpected dependency '+name);
  }};
  const file=process.env.PRODUCT_SAVER_UNDER_TEST||require.resolve('./productSaver.js');
  vm.runInNewContext(fs.readFileSync(file,'utf8'),context,{filename:file});
  return{save:module.exports.saveProduct,mutations,exports:module.exports};
}
test('new saver preserves API and passes correct decimal-comma price to database',async()=>{
  const x=load();assert.equal(x.exports.parsePriceCents,parsers.parsePriceCents);
  assert.equal(await x.save('owner',{name:'Honey',default_price:'12,00€',variant_prices:[['250g','12,00€']],variant_price_currency:'EUR'},'https://example.com/product'),'test-product');
  const v=x.mutations.find(r=>r.table==='product_variants'&&r.operation==='insert').body[0];
  assert.equal(v.price_cents,1200);assert.equal(v.weight_g,250);assert.equal(v.currency,'EUR');
});
test('range never becomes integer overflow or invented single price',async()=>{
  const x=load();await x.save('owner',{name:'Brazil',default_price:'140,00 Kč – 1250,00 Kč',variant_price_currency:'CZK'},'https://example.com/product');
  const v=x.mutations.find(r=>r.table==='product_variants'&&r.operation==='insert').body[0];
  assert.equal(v.price_cents,null);assert.equal(v.weight_g,null);assert.equal(v.currency,'CZK');
});
test('gram abbreviation and existing same-weight grind deduplication are preserved',async()=>{
  const x=load();await x.save('owner',{name:'Coffee',variant_prices:[['340gr / whole bean','29.00'],['340gr / espresso','29.00']],variant_price_currency:'CAD'},'https://example.com/product');
  const v=x.mutations.find(r=>r.table==='product_variants'&&r.operation==='insert').body;
  assert.equal(v.length,1);assert.equal(v[0].weight_g,340);assert.equal(v[0].price_cents,2900);
});
test('observed German size/grind labels retain three distinct weights rather than nine null variants',async()=>{
  const x=load(),variant_prices=[];
  for(const [grams,price]of [[250,'8.80'],[500,'16.80'],[1000,'32.99']])
    for(const grind of ['Ganze Bohnen','Gemahlen für Siebträger','Gemahlen für Espressokocher'])variant_prices.push([`${grams} Gramm / ${grind}`,price]);
  await x.save('owner',{name:'Sunnseit',variant_prices,variant_price_currency:'EUR'},'https://example.com/product');
  const variants=x.mutations.find(r=>r.table==='product_variants'&&r.operation==='insert').body;
  assert.equal(variants.length,3);
  assert.deepEqual(Array.from(variants,v=>v.weight_g),[250,500,1000]);
  assert.deepEqual(Array.from(variants,v=>v.price_cents),[880,1680,3299]);
  assert(variants.every(v=>v.currency==='EUR'&&v.variant_name.endsWith('/ Ganze Bohnen')));
});
