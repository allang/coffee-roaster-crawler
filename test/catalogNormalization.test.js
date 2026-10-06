'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMoney, displayTitle, tastingNotes, normalizeProduct, stableUuid, canonicalProductUrl } = require('../src/catalogNormalization');
const { productAvailability } = require('../src/productEvidence');

for (const [raw, options, amount, currency, minor] of [
  ['12,00€', {}, '12.00', 'EUR', 1200],
  ['EUR 1.234,56', {locale:'de-DE'}, '1234.56', 'EUR', 123456],
  ['USD 1,234.56', {locale:'en-US'}, '1234.56', 'USD', 123456],
  ['JPY 1,200', {locale:'en-US'}, '1200', 'JPY', 1200],
  ['KWD 1.234', {locale:'en-US'}, '1.234', 'KWD', 1234],
  ['CHF 1’234.50', {locale:'de-CH'}, '1234.50', 'CHF', 123450],
  ['12.50', {}, '12.50', null, null],
  ['US$12.50', {}, '12.50', 'USD', 1250],
  ['usd 12.50', {}, '12.50', 'USD', 1250],
]) test(`money ${raw}`, () => { const value = parseMoney(raw,options); assert.equal(value.amount,amount); assert.equal(value.currency,currency); assert.equal(value.minorUnits,minor); });
for (const [raw,options,reason] of [
  ['$12.00', {}, 'unknown_currency'], ['USD 12-20', {}, 'missing_or_range_price'], ['JPY 1.20', {}, 'currency_precision'],
  ['EUR 1.234', {}, 'locale_required'], ['€12', {currency:'USD'}, 'conflicting_or_invalid_currency'],
  ['1,2,3 EUR', {}, 'invalid_amount'], ['price is 12 EUR', {}, 'price_prose'], ['USD 999999999999', {}, 'amount_overflow'],
]) test(`reject or retain uncertainty ${raw}`,()=>assert.equal(parseMoney(raw,options).reason,reason));

test('display titles retain originals, acronyms and distinctive casing; origins require captured fields', () => {
  assert.equal(displayTitle('ETHIOPIA — BANKO GOTTI EA', {country_of_origin:'Ethiopia'}),'Banko Gotti EA');
  assert.equal(displayTitle('ETHIOPIA — BANKO GOTTI EA'),'Ethiopia — Banko Gotti EA');
  assert.equal(displayTitle('La EsPeRanZa SL28'), 'La EsPeRanZa SL28');
  assert.equal(displayTitle('ETHIOPIA', {country_of_origin:'Ethiopia'}), 'Ethiopia');
  const p=normalizeProduct({name:'ETHIOPIA — BANKO',attributes:{country_of_origin:'Ethiopia'}},'https://shop.test/products/banko');
  assert.equal(p.original_title,'ETHIOPIA — BANKO'); assert.equal(p.display_title,'Banko');
});
test('taxonomy retains all source wording including uncertain and unmapped notes', () => {
  const notes=tastingNotes(['Blueberries','hint of jasmine','Cotton candy','Chocolat noir']);
  assert.equal(notes.version,'tasting-v1'); assert.deepEqual(notes.notes.map(n=>n.source),notes.source);
  assert.deepEqual(notes.notes[0].categories,['fruit','berry']); assert.equal(notes.notes[1].status,'uncertain');
  assert.equal(notes.notes[2].status,'unmapped'); assert.equal(notes.notes[3].canonical,'dark chocolate');
});
test('identity uses source URL or native variant, retaining identity query parameters', () => {
  assert.equal(canonicalProductUrl('https://WWW.shop.test/product?id=12&utm_source=test&variant=1#x'),'https://shop.test/product?id=12');
  assert.notEqual(stableUuid('owner','https://shop.test/product?id=12'),stableUuid('owner','https://shop.test/product?id=13'));
  const p=normalizeProduct({name:'Coffee',variant_prices:[['250g / whole bean','12€'],['250g / espresso','12€']]},'https://shop.test/products/x');
  assert.equal(p.variants.length,2); assert(p.variants.every(v=>v.availability==='unknown'));
});
test('Shopify variants with missing availability remain unknown',()=>{
  const r=productAvailability({shopifyProduct:{id:1,variants:[{id:2,title:'250g',available:false},{id:3,title:'500g'}]}});
  assert.equal(r.state,'unknown'); assert.equal(r.isAvailable,null); assert.equal(r.variants[1].state,'unknown');
});
test('primary Shopify JSON outranks unrelated recommendations and source states carry timestamps',()=>{
  const r=productAvailability({html:'<script>{"availability":"https://schema.org/InStock"}</script>',shopifyProduct:{variants:[{id:1,available:false}]},checkedAt:'2026-10-06T14:00:00Z'});
  assert.equal(r.state,'sold_out'); assert.equal(r.checkedAt,'2026-10-06T14:00:00Z'); assert(r.evidence.length);
});
test('JSON-LD availability is tied to the requested product',()=>{
  const url='https://shop.test/products/coffee';
  const html='<script type="application/ld+json">'+JSON.stringify([{'@type':'Product',name:'Main',url,offers:{availability:'https://schema.org/OutOfStock'}},{'@type':'Product',name:'Other',url:'https://shop.test/products/other',offers:{availability:'https://schema.org/InStock'}}])+'</script>';
  assert.equal(productAvailability({html,sourceUrl:url}).state,'sold_out');
});
test('page-wide stock text, price-only and unscoped buttons do not prove product stock',()=>{
  for(const html of ['<p>Sold out. Recommended product in stock</p>','<button>Add to cart</button>','<p>12 EUR</p>','']) assert.equal(productAvailability({html,allowPriceOnly:true}).state,'unknown');
  assert.equal(productAvailability({html:'<form id="product-form"><button>Add to cart</button></form>'}).state,'in_stock');
});
test('only definitive removal evidence marks removed; blocked fetch is unknown',()=>{
  assert.equal(productAvailability({status:404}).state,'removed'); assert.equal(productAvailability({status:429}).state,'unknown');
});
