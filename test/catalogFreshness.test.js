'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {catalogDb} = require('./catalogDb');
const {catalogPayload} = require('../src/productSaver');
const {structuredExtraction} = require('../src/extraction');
const {productAvailability} = require('../src/productEvidence');

const owner = '11111111-1111-4111-8111-111111111111';
const times = ['2026-10-06T14:00:00Z', '2026-10-06T14:01:00Z', '2026-10-06T14:02:00Z', '2026-10-06T14:03:00Z', '2026-10-06T14:04:00Z'];
const product = {
  name: 'Coffee', variants_complete: true,
  variants: [
    {id: 'v1', title: '250g', price: '12', currency: 'EUR', available: true},
    {id: 'v2', title: '500g', price: '20', currency: 'EUR', available: true},
  ],
};
async function fixture() {
  const pg = await catalogDb();
  await pg.query('insert into entities(id) values($1)', [owner]);
  const payload = catalogPayload(owner, product, 'https://shop.test/products/coffee', null,
    {state: 'in_stock', reason: 'fixture', evidence: []}, times[0]);
  const save = async value => (await pg.query('select save_catalog_product_v1($1) result', [value])).rows[0].result;
  const refresh = value => pg.query('select update_catalog_availability_v1($1,$2)', [payload.product.id, value]);
  const variant = async id => (await pg.query('select * from product_variants where merchant_variant_id=$1', [id])).rows[0];
  const eventCount = async () => (await pg.query('select count(*)::int n from catalog_change_events')).rows[0].n;
  await save(payload);
  return {pg, payload, save, refresh, variant, eventCount};
}
async function newerVariant(pg) {
  await pg.query(`update product_variants set availability_state='sold_out', availability='unknown',
    availability_checked_at=$1, availability_evidence=$2, price_minor_units=1500, price_amount=1.5,
    currency='KWD', currency_exponent=3, price_raw='1.500', provenance=$3 where merchant_variant_id='v1'`,
    [times[2], [{source: 'newer_api_observation'}], {last_live_verification: 'newer_api_observation'}]);
}

test('same-label JSON-LD offers retain exact URL variant identities across reordered refreshes', async () => {
  const pg = await catalogDb(), url = 'https://shop.test/products/coffee';
  const offer = (id, price, stock='InStock') => ({url:url+'?variant='+id,price,priceCurrency:'NZD',availability:'https://schema.org/'+stock});
  const make = (offers, checkedAt) => {
    const html = `<script type="application/ld+json">${JSON.stringify({'@type':'Product',url,name:'Coffee',offers})}</script>`;
    return catalogPayload(owner, structuredExtraction({url,html}, {success:false}).product, url, null,
      productAvailability({sourceUrl:url,html,checkedAt}), checkedAt);
  };
  try {
    await pg.query('insert into entities(id) values($1)', [owner]);
    const initial = make([offer('11',18),offer('12',18,'OutOfStock'),offer('13',65)], times[0]);
    assert.deepEqual(initial.variants.map(v=>v.merchant_variant_id), ['11','12','13']);
    assert.equal(initial.variants_complete, false);
    assert(initial.variants.every(v=>v.weight_g==null)); // Absent labels/weights are not inferred.
    await pg.query('select save_catalog_product_v1($1)', [initial]);
    const before = (await pg.query('select * from product_variants order by merchant_variant_id')).rows;
    const refreshed = make([offer('13',66),offer('11',18),offer('12',18)], times[1]);
    await pg.query('select save_catalog_product_v1($1)', [refreshed]);
    const after = (await pg.query('select * from product_variants order by merchant_variant_id')).rows;
    assert.equal(after.length,3);
    assert.deepEqual(after.map(v=>v.id),before.map(v=>v.id));
    assert.deepEqual(after.map(v=>v.created_at),before.map(v=>v.created_at));
    assert.deepEqual(after.map(v=>v.price_minor_units),[1800,1800,6600]);
    assert(after.every(v=>v.currency==='NZD'&&v.currency_exponent===2));
    assert.equal(after[1].availability_state,'in_stock');
    assert(after.every(v=>v.availability_evidence[0].source==='product_jsonld_offer'));
    assert(after.every(v=>Date.parse(v.availability_checked_at)===Date.parse(times[1])));
  } finally {await pg.close();}
});

test('identical native stock checks advance variant evidence and timestamps without outbox events', async () => {
  const {pg, payload, refresh, variant, eventCount} = await fixture();
  try {
    for (const checkedAt of times.slice(1, 3)) {
      const evidence = [{source: 'native_stock', checkedAt}];
      await refresh({state: 'in_stock', checkedAt, evidence, variants: [{source_id: 'v1', state: 'in_stock', evidence}]});
      const v = await variant('v1');
      assert.equal(Date.parse(v.availability_checked_at), Date.parse(checkedAt));
      assert.deepEqual(v.availability_evidence, evidence);
      assert.equal(v.availability_state, 'in_stock');
      assert.equal(v.price_minor_units, 1200);
      const p = (await pg.query('select availability_checked_at from products where id=$1', [payload.product.id])).rows[0];
      assert.equal(Date.parse(p.availability_checked_at), Date.parse(checkedAt));
      assert.equal(await eventCount(), 1);
    }
  } finally {await pg.close();}
});

test('stock-only refresh and product removal preserve newer per-variant observations', async () => {
  const {pg, refresh, variant, eventCount} = await fixture();
  try {
    await newerVariant(pg);
    const newer = await variant('v1');
    await refresh({state: 'in_stock', checkedAt: times[1], evidence: [], variants: [
      {source_id: 'v1', state: 'in_stock', evidence: [{source: 'older_crawler'}]},
      {source_id: 'v2', state: 'sold_out', evidence: [{source: 'accepted_crawler'}]},
    ]});
    assert.deepEqual(await variant('v1'), newer);
    assert.equal((await variant('v2')).availability_state, 'sold_out');
    assert.equal(await eventCount(), 2);
    const intermediate = '2026-10-06T14:01:30Z';
    await refresh({state: 'removed', checkedAt: intermediate, evidence: [{source: 'http', status: 404}]});
    assert.deepEqual(await variant('v1'), newer);
    assert.equal((await variant('v2')).availability_state, 'removed');
    assert.equal(Date.parse((await variant('v2')).availability_checked_at), Date.parse(intermediate));
    assert.equal(await eventCount(), 3);
    await refresh({state: 'removed', checkedAt: times[3], evidence: [{source: 'http', status: 410}]});
    assert.equal((await variant('v1')).availability_state, 'removed');
    assert.equal(await eventCount(), 4);
    await refresh({state: 'removed', checkedAt: times[4], evidence: [{source: 'http', status: 404}]});
    assert.equal(Date.parse((await variant('v1')).availability_checked_at), Date.parse(times[4]));
    assert.deepEqual((await variant('v2')).availability_evidence, [{source: 'http', status: 404}]);
    assert.equal(await eventCount(), 4);
  } finally {await pg.close();}
});

test('full-save upserts protect newer variant stock, money, evidence and provenance independently', async () => {
  const {pg, payload, save, variant, eventCount} = await fixture();
  try {
    await newerVariant(pg);
    const newer = await variant('v1');
    const older = structuredClone(payload);
    older.product.checked_at = times[1];
    Object.assign(older.variants[0], {price_minor_units: 500, price_amount: 5, currency: 'USD', currency_exponent: 2});
    Object.assign(older.variants[1], {price_minor_units: 2100, price_amount: 21});
    assert.equal((await save(older)).market_changed, true);
    assert.deepEqual(await variant('v1'), newer);
    assert.equal((await variant('v2')).price_minor_units, 2100);
    assert.equal(Date.parse((await variant('v2')).availability_checked_at), Date.parse(times[1]));
    assert.equal(await eventCount(), 2);
    older.product.checked_at = '2026-10-06T14:01:30Z';
    older.variants = older.variants.slice(0, 1);
    older.variants_complete = false;
    assert.equal((await save(older)).market_changed, false);
    assert.deepEqual(await variant('v1'), newer);
    assert.equal(await eventCount(), 2);
  } finally {await pg.close();}
});

test('complete-inventory removal checks each variant timestamp and refreshes unchanged removal evidence', async () => {
  const {pg, payload, save, variant, eventCount} = await fixture();
  try {
    await newerVariant(pg);
    const newer = await variant('v1');
    const missingNewer = structuredClone(payload);
    missingNewer.product.checked_at = times[1];
    missingNewer.variants = [payload.variants[1]];
    assert.equal((await save(missingNewer)).market_changed, false);
    assert.deepEqual(await variant('v1'), newer);
    assert.equal(await eventCount(), 1);
    const missingOlder = structuredClone(payload);
    missingOlder.product.checked_at = '2026-10-06T14:01:30Z';
    missingOlder.variants = [payload.variants[0]];
    assert.equal((await save(missingOlder)).market_changed, true);
    assert.deepEqual(await variant('v1'), newer);
    assert.equal((await variant('v2')).availability_state, 'removed');
    assert.equal(await eventCount(), 2);
    missingOlder.product.checked_at = '2026-10-06T14:01:45Z';
    assert.equal((await save(missingOlder)).market_changed, false);
    assert.equal(Date.parse((await variant('v2')).availability_checked_at), Date.parse(missingOlder.product.checked_at));
    assert.deepEqual((await variant('v2')).availability_evidence, [{source: 'complete_native_variant_inventory', reason: 'variant_not_seen'}]);
    assert.equal(await eventCount(), 2);
  } finally {await pg.close();}
});
