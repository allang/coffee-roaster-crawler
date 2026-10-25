'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), cheerio = require('cheerio');
const base = require('../src/siteSupport/base'), profiles = require('../src/siteSupport/profiles.json');
const fixture = require('./fixtures/siteSupport/asian-base.json').pages;
const { structuredExtraction } = require('../src/extraction');
const { productOnlyOffer, productAvailability } = require('../src/productEvidence');
const { profileFor } = require('../src/siteSupport/discovery');
const { createReader } = require('../src/siteSupport/network');
const names = { nano: "Nano's Coffee", hokuro: 'HOKURO ROASTERY', soh: 'Specialty Coffee Soh' };
const profile = key => profiles.find(p => p.name === names[key]);
function change(page, edit) { const $ = cheerio.load(page.html); edit($); return $.html(); }

test('captured BASE products fill a missing exact identity without inventing option SKUs', () => {
  for (const [key, name] of Object.entries(names)) {
    const p = profile(key), page = fixture[key];
    assert.equal(structuredExtraction({ html: page.html, url: page.url }).product, null, name + ' baseline');
    const sourceProduct = base.baseProduct(page.html, page.url, p), offer = productOnlyOffer(sourceProduct, page.url);
    const extraction = structuredExtraction({ html: page.html, url: page.url, sourceProduct });
    assert.equal(extraction.coffee, true); assert.equal(extraction.product._product_only, true);
    assert.equal(offer.currency, 'JPY'); assert(offer.minor_units > 0);
    assert.deepEqual(extraction.product.variants, []); assert.equal(extraction.product.variants_complete, false);
    assert(extraction.product.description_raw.length > 100); assert(extraction.product.attributes.product_image_url);
  }
  const source = base.baseProduct(fixture.nano.html, fixture.nano.url, profile('nano'));
  assert.equal(source._product_offer.minor_units, 980); // Gift wrap is not the base offer.
  assert.equal(source.productID, 'base:nanoroaster-handcrafted-jp:11217345');
});
test('the primary sold-out purchase control overrides misleading BASE JSON-LD stock', () => {
  const page = fixture.hokuro, sourceProduct = base.baseProduct(page.html, page.url, profile('hokuro'));
  assert.equal(sourceProduct._product_offer.schema_availability, 'http://schema.org/InStock');
  assert.equal(productAvailability({ sourceProduct, sourceUrl: page.url }).state, 'sold_out');
  const nano = base.baseProduct(fixture.nano.html, fixture.nano.url, profile('nano'));
  assert.equal(productAvailability({ sourceProduct: nano, sourceUrl: fixture.nano.url }).state, 'in_stock');
  for (const edit of [
    $ => $('.cot-itemOrder-submit').attr('data-disabled', 'true'),
    $ => $('.cot-itemOrder-submit').text('Coming soon'),
    $ => { const e = $('script[type="application/ld+json"]'), value = JSON.parse(e.text()); value.offers.availability = 'https://schema.org/OutOfStock'; e.text(JSON.stringify(value)); },
  ]) assert.throws(() => base.baseProduct(change(fixture.nano, edit), fixture.nano.url, profile('nano')), /purchasability/);
});
test('BASE title comparison decodes native JSON-LD entities without accepting different titles', () => {
  const page = fixture.nano_geisha, p = profile('nano');
  const source = base.baseProduct(page.html, page.url, p);
  assert(source.name.includes('"')); assert(!source.name.includes('&quot;'));
  assert.throws(() => base.baseProduct(change(page, $ => $('[class*="item-detail_itemTitle_"]').text('A different coffee')), page.url, p), /title/);
});
test('BASE product extraction fails closed on cross-store, canonical, form, price and merchandise changes', () => {
  const page = fixture.nano, p = profile('nano');
  for (const edit of [
    $ => $('link[rel="canonical"]').attr('href', fixture.hokuro.url),
    $ => $('form').attr('data-item-id', '999'),
    $ => $('form').attr('data-shop-id', 'another-shop'),
    $ => $('form').attr('data-community-limited-item', 'true'),
    $ => $('input[name="id"]').attr('value', '999'),
    $ => $('form').remove(),
    $ => $('script[type="application/ld+json"]').clone().appendTo('body'),
    $ => { const e = $('script[type="application/ld+json"]'), value = JSON.parse(e.text()); value.offers.priceCurrency = 'USD'; e.text(JSON.stringify(value)); },
    $ => { const e = $('script[type="application/ld+json"]'), value = JSON.parse(e.text()); value.offers.price = '980-1500'; e.text(JSON.stringify(value)); },
    $ => { const e = $('script[type="application/ld+json"]'), value = JSON.parse(e.text()); value.name = 'Coffee grinder'; e.text(JSON.stringify(value)); $('[class*="item-detail_itemTitle_"]').text(value.name); },
  ]) assert.throws(() => base.baseProduct(change(page, edit), page.url, p));
  const spoof = base.baseProduct(page.html, page.url, p); spoof._product_offer.stock_control.product_id = '999';
  assert.equal(productOnlyOffer(spoof, page.url), null);
});
test('only exact newly indexed BASE owners and the reviewed Soh hub can use the reader', async () => {
  for (const key of Object.keys(names)) {
    const p = profile(key), row = { id: p.entity_ids[0], website_url: p.bootstrap_url };
    assert.equal(profileFor(row), p); assert.equal(profileFor({ ...row, id: 'unreviewed-owner' }), null);
    assert.equal(profileFor({ ...row, website_url: 'https://another.thebase.in/' }), null);
  }
  const p = profile('soh');
  assert.equal(profileFor({ id: p.entity_ids[0], website_url: 'https://lit.link/sohcoffee' }), p);
  assert.equal(profileFor({ id: p.entity_ids[0], website_url: 'https://lit.link/other' }), null);
  let calls = 0;
  const reader = createReader(p, { maxRetries: 0, lookup: async () => [{ address: '1.1.1.1' }], fetch: async () => { calls++; return new Response('ok'); } });
  for (const url of ['https://sohcoffee.thebase.in/cart/add/sohcoffee', 'https://sohcoffee.thebase.in/items/123?x=1', 'https://sohcoffee.thebase.in/items/%31%32%33', 'https://lit.link/other', 'https://foreign.thebase.in/items/123']) assert.equal((await reader.fetchHtml(url)).success, false);
  assert.equal(calls, 0);
});
test('published BASE cards exclude subscriptions and keep observed inventory explicitly partial', async () => {
  for (const key of Object.keys(names)) {
    const p = profile(key), page = fixture[key + '_listing'];
    const found = await base.discoverBaseProducts({ website_url: p.bootstrap_url }, p, async url => ({ success: true, data: page.html, finalUrl: url }));
    assert.equal(base.partialScopeAllowed(p, found), true, found.error);
    assert.equal(found.inventory_complete, false); assert.equal(found.complete, false);
    assert.equal(found.reconcile_omissions, false); assert.equal(found.inventory_authorizes_global_absence, false);
    if (key === 'hokuro') { assert.equal(found.urls.length, 15); assert.equal(found.evidence[0].excluded.length, 2); }
    if (key === 'soh') { assert.equal(found.urls.length, 23); assert.equal(found.evidence[0].excluded.length, 1); }
    for (const edit of [d => d.error = 'HTTP 429', d => d.urls.push(d.urls[0]), d => d.evidence = [], d => d.evidence[0].listing = 'https://foreign.test/', d => d.complete = true, d => d.reconcile_omissions = true]) {
      const changed = structuredClone(found); edit(changed); assert.equal(base.partialScopeAllowed(p, changed), false);
    }
  }
});
test('the production page visitor and catalog payload preserve product-only JPY evidence', async () => {
  const page = fixture.hokuro, p = profile('hokuro'), { fetchPageContent } = require('../src/pageVisitor'), { catalogPayload } = require('../src/productSaver');
  const fetched = await fetchPageContent(page.url, null, { siteProfile: p, fetchHtml: async () => ({ success: true, status: 200, finalUrl: page.url, data: page.html }) });
  assert.equal(fetched.success, true, fetched.error);
  const product = structuredExtraction({ ...fetched, url: page.url }).product;
  const payload = catalogPayload(p.entity_ids[0], product, page.url, null, productAvailability({ sourceProduct: fetched.sourceProduct, sourceUrl: page.url }), new Date().toISOString());
  assert.equal(payload.product.metadata._product_offer.currency, 'JPY'); assert.equal(payload.product.metadata._product_offer.state, 'sold_out');
  assert.deepEqual(payload.variants, []); assert.equal(payload.variants_complete, false);
});
test('the focused BASE production helper defaults to a nonmutating exact-owner preview', () => {
  const { spawnSync } = require('node:child_process'), path = require('node:path'), cwd = path.join(__dirname, '..');
  const run = spawnSync(process.execPath, ['scripts/crawl-reviewed-asian-base.cjs'], { cwd, encoding: 'utf8', env: {} });
  assert.equal(run.status, 0, run.stderr);
  const preview = JSON.parse(run.stdout); assert.equal(preview.writes, 0); assert.equal(preview.merchants.length, 3);
  assert.deepEqual(preview.merchants.map(p => p.entity_id).sort(), Object.keys(names).map(key => profile(key).entity_ids[0]).sort());
});
test('the focused BASE helper refuses an unknown owner or a nonproduction project before loading the crawler', () => {
  const { spawnSync } = require('node:child_process'), path = require('node:path'), cwd = path.join(__dirname, '..');
  for (const args of [['Unknown shop'], ['--apply']]) {
    const run = spawnSync(process.execPath, ['scripts/crawl-reviewed-asian-base.cjs', ...args], { cwd, encoding: 'utf8', env: {} });
    assert.equal(run.status, 1); assert.match(run.stderr, /reviewed BASE|Unexpected source catalog/);
  }
});
