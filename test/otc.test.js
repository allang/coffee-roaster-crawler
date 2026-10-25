'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), cheerio = require('cheerio');
const otc = require('../src/siteSupport/otc'), fixture = require('./fixtures/siteSupport/otc-public.json');
const profile = require('../src/siteSupport/profiles.json').find(p => p.name === 'OTC COFFEE');
const { productOnlyOffer, productAvailability } = require('../src/productEvidence');
const { structuredExtraction, extractPage } = require('../src/extraction');
const listing = fixture.pages.find(p => p.url.endsWith('/shop')), decaf = fixture.pages.find(p => p.url.endsWith('/7831883382845'));
const held = fixture.pages.filter(p => /\/(?:7831883382845|7805540401213)$/.test(p.url)), valid = fixture.pages.filter(p => p !== listing && !held.includes(p));
function change(page, edit) { const $ = cheerio.load(page.html); edit($); return $.html(); }
function changeRecords(page, edit) {
  const $ = cheerio.load(page.html), rows = otc.records($); edit(rows);
  $('script:not([src])').filter((_, e) => $(e).text().includes('self.__next_f.push')).remove();
  const stream = [...rows].map(([key, data]) => key + ':' + JSON.stringify(data)).join('\n');
  $('body').append('<script>self.__next_f.push(' + JSON.stringify([1, stream]) + ')</script>'); return $.html();
}
test('captured OTC pages verify six exact JPY one-time offers without inventing complete native SKU sets', async () => {
  assert.equal(valid.length, 6);
  for (const page of valid) {
    const sourceProduct = otc.otcProduct(page.html, page.url, profile), offer = productOnlyOffer(sourceProduct, page.url);
    assert.equal(offer.currency, 'JPY'); assert(offer.minor_units > 0); assert.equal(offer.state, 'in_stock');
    assert.match(offer.observed_variant_id, /^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/);
    const result = await extractPage({ page: { html: page.html, url: page.url, sourceProduct }, classify: async () => { throw Error('Product-only evidence must not invoke semantic AI'); }, model: 'unused' });
    assert.equal(result.mode, 'structured_product_only'); assert.equal(result.aiCalls, 0);
    assert.equal(result.data.product.variants_complete, false); assert.deepEqual(result.data.product.variants, []);
    assert.equal(productAvailability({ sourceProduct, sourceUrl: page.url }).state, 'in_stock');
    assert(result.data.product.attributes.country_of_origin); assert(result.data.product.attributes.varietal); assert(result.data.product.description_raw); assert(result.data.product.attributes.product_image_url);
  }
});
test('OTC DECAF is held on a real schema/purchase-control disagreement rather than silently accepting either state', () => {
  for(const page of held)assert.throws(() => otc.otcProduct(page.html, page.url, profile), /otc_conflicting_stock_evidence/);
});
test('OTC rejects changed canonical, title, currency, money, control or photo evidence', () => {
  const page = valid[0];
  for (const edit of [
    $ => $('link[rel="canonical"]').attr('href', valid[1].url),
    $ => $('main h1').first().text('Another coffee'),
    $ => $('main button').attr('disabled', ''),
    $ => $('main button').filter((_, e) => $(e).text().includes('\u5358\u54c1')).text('\u5358\u54c1\u3092\u30ab\u30fc\u30c8\u306b\u5165\u308c\u308b \uffe5100'),
    $ => { const e = $('script[type="application/ld+json"]'), data = JSON.parse(e.text()); data.offers.priceCurrency = 'USD'; e.text(JSON.stringify(data)); },
    $ => { const e = $('script[type="application/ld+json"]'), data = JSON.parse(e.text()); data.offers.price = '3500-4000'; e.text(JSON.stringify(data)); },
    $ => { const e = $('script[type="application/ld+json"]'), data = JSON.parse(e.text()); data.image = 'https://foreign.test/image.jpg'; e.text(JSON.stringify(data)); },
  ]) assert.throws(() => otc.otcProduct(change(page, edit), page.url, profile));
});
test('OTC native route is bound to this exact public product page and literal scripts are never executed', () => {
  const page = valid[0];
  assert.throws(() => otc.otcProduct(changeRecords(page, rows => { rows.get('0').c[4] = '999'; }), page.url, profile), /route\/product/);
  const script = change(page, $ => $('body').append('<script>throw new Error("must never execute merchant code")</script>'));
  assert.equal(otc.otcProduct(script, page.url, profile)._product_offer.state, 'in_stock');
  assert.throws(() => otc.otcProduct(change(page, $ => $('script:not([src])').filter((_, e) => $(e).text().includes('self.__next_f.push')).remove()), page.url, profile), /route\/product/);
});
test('OTC only admits exact owned JP product paths and fresh product-only purchase proof', () => {
  const page = valid[0];
  for (const url of ['http://otc-coffee.com/jp/shop/items/123', 'https://foreign.test/jp/shop/items/123', 'https://otc-coffee.com/en/shop/items/123', 'https://otc-coffee.com/jp/shop/items/%31%32%33', page.url + '?currency=USD', page.url + '#other', 'https://otc-coffee.com/jp/cart']) assert.throws(() => otc.owned(url, profile, true));
  const source = otc.otcProduct(page.html, page.url, profile); source._product_offer.stock_control.enabled = false;
  assert.equal(productOnlyOffer(source, page.url), null);
});
test('OTC discovery keeps all eight house products including held DECAF and explicitly records other brands/equipment outside that scope', async () => {
  const result = await otc.discoverOtcProducts({ website_url: 'https://otc-coffee.com/' }, profile, async url => ({ success: true, data: listing.html, finalUrl: url }));
  assert.equal(result.urls.length, 8); assert(held.every(page=>result.urls.includes(page.url))); assert.equal(otc.partialScopeAllowed(profile, result), true);
  assert.equal(result.evidence[0].excluded.length,11);assert(result.evidence[0].excluded.some(p=>p.reason==='coffee_machine'));assert(result.evidence[0].excluded.some(p=>p.title.startsWith('Colonna Coffee')));
  assert.equal(result.complete, false); assert.equal(result.inventory_complete, false); assert.equal(result.reconcile_omissions, false);
  for (const edit of [d => d.error = 'HTTP 429', d => d.urls.push(d.urls[0]), d => d.evidence[0].listing = 'https://foreign.test/', d => d.market_scope = 'all', d => d.inventory_complete = true]) {
    const changed = structuredClone(result); edit(changed); assert.equal(otc.partialScopeAllowed(profile, changed), false);
  }
});
test('the actual page visitor applies the OTC guard before AI or persistence', async () => {
  const { fetchPageContent } = require('../src/pageVisitor');
  for (const page of [...held, ...valid]) {
    const response = await fetchPageContent(page.url, null, { siteProfile: profile, fetchHtml: async () => ({ success: true, data: page.html, status: 200, finalUrl: page.url }) });
    if (held.includes(page)) { assert.equal(response.success, false); assert.match(response.error, /conflicting_stock_evidence/); }
    else { assert.equal(response.success, true, response.error); assert.equal(structuredExtraction({ ...response, url: page.url }).product._product_only, true); }
  }
});
