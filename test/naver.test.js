'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const naver = require('../src/siteSupport/naver');
const { createReader } = require('../src/siteSupport/network');
const { profileFor } = require('../src/siteSupport/discovery');
const { structuredExtraction } = require('../src/extraction');
const { productOnlyOffer, productAvailability } = require('../src/productEvidence');
const { canonicalProductUrl } = require('../src/catalogNormalization');
const profile = require('../src/siteSupport/profiles.json').find(p => p.name === 'Brewing Ceremony');
const home = profile.bootstrap_url, listing = 'https://smartstore.naver.com/brewingceremony/category/ALL';
const url = 'https://smartstore.naver.com/brewingceremony/products/123456789';
// Standards-based synthetic fixtures: these are not a successful live Naver crawl.
const native = () => ({ '@type': 'Product', url, name: '에티오피아 원두 200g', category: '원두', description: 'Ethiopian roasted coffee beans.', image: 'https://shop-phinf.pstatic.net/coffee.jpg', offers: { '@type': 'Offer', url, price: '18000', priceCurrency: 'KRW', availability: 'https://schema.org/InStock' } });
function html(value, current = url) { return '<link rel="canonical" href="' + current + '"><main><h1>' + (value.name || 'Shop') + '</h1><script type="application/ld+json">' + JSON.stringify(value) + '</script></main>'; }

test('Naver identities keep stores distinct and normalize mobile product aliases only', () => {
  assert.equal(canonicalProductUrl(url + '?nt_source=ig'), url);
  assert.equal(canonicalProductUrl(url.replace('smartstore.', 'm.smartstore.')), url);
  assert.notEqual(canonicalProductUrl(url.replace('brewingceremony', 'other')), url);
  for (const value of ['https://smartstore.naver.com/other/products/123456789', 'https://smartstore.naver.com/brewingceremony-extra/products/123456789', 'https://smartstore.naver.com/brewingceremony/%70roducts/123456789', 'https://smartstore.naver.com/brewingceremony/checkout', 'http://smartstore.naver.com/brewingceremony']) assert.throws(() => naver.owned(value, profile));
  assert(profileFor({ id: profile.entity_ids[0], website_url: home }));
  assert.equal(profileFor({ id: profile.entity_ids[0], website_url: 'https://smartstore.naver.com/other' }), null);
  assert.equal(profileFor({ id: 'unreviewed-roaster', website_url: home }), null);
  const newwave=profileFor({id:'a3ed7572-b082-4ac1-ab88-c7d9826654f6',website_url:'https://newwavecoffeeroasters.com/'});
  assert.equal(newwave.naver_store,'newwavecoffeeroasters');
  assert.equal(profileFor({id:newwave.entity_ids[0],website_url:home}),null);
});
test('Naver primary KRW offers retain exact product money and stock without inventing SKUs', () => {
  const sourceProduct = naver.naverProduct(html(native()), url, profile);
  assert.equal(sourceProduct.productID, 'naver_smartstore:brewingceremony:123456789');
  assert.equal(productOnlyOffer(sourceProduct, url).minor_units, 18000);
  const extracted = structuredExtraction({ html: html(native()), sourceProduct, url });
  assert.equal(extracted.coffee, true); assert.equal(extracted.product._product_only, true);
  assert.deepEqual(extracted.product.variants, []); assert.equal(extracted.product.variants_complete, false);
  assert.equal(productAvailability({ sourceProduct, sourceUrl: url }).state, 'in_stock');
  const facts=native();facts.additionalProperty=[{'@type':'PropertyValue',name:'country_of_origin',value:'Ethiopia'}];
  const detailed=structuredExtraction({html:html(facts),sourceProduct:naver.naverProduct(html(facts),url,profile),url});
  assert.equal(detailed.product.attributes.country_of_origin,'Ethiopia');
  const sold = native(); sold.offers.availability = 'https://schema.org/OutOfStock';
  assert.equal(productAvailability({ sourceProduct: naver.naverProduct(html(sold), url, profile), sourceUrl: url }).state, 'sold_out');
});
test('the page visitor uses the registered Naver parser and catalog payload retains product-only uncertainty', async () => {
  const { fetchPageContent } = require('../src/pageVisitor'), { catalogPayload } = require('../src/productSaver');
  const page = await fetchPageContent(url, null, { siteProfile: profile, fetchHtml: async () => ({ success: true, status: 200, finalUrl: url, data: html(native()) }) });
  assert.equal(page.success, true); assert.equal(page.sourceProduct._market_source, naver.SOURCE);
  const product = structuredExtraction({ ...page, url }).product;
  const payload = catalogPayload(profile.entity_ids[0], product, url, null, productAvailability({ sourceProduct: page.sourceProduct, sourceUrl: url }), new Date().toISOString());
  assert.equal(payload.product.metadata._product_offer.currency, 'KRW'); assert.equal(payload.product.metadata._product_offer.minor_units, 18000);
  assert.deepEqual(payload.variants, []); assert.equal(payload.variants_complete, false);
});
test('Naver extraction rejects recommendation identity, ambiguous offers, unknown money/stock and equipment', () => {
  for (const mutate of [p => p.url = p.offers.url = url.replace('brewingceremony', 'other'), p => p.offers.priceCurrency = 'USD', p => delete p.offers.availability, p => p.offers.price = '18000-20000', p => p.offers = { '@type': 'AggregateOffer', lowPrice: '18000', priceCurrency: 'KRW' }, p => p.name = '원두 보관통', p => p.name = '생두 1kg']) {
    const value = native(); mutate(value); assert.throws(() => naver.naverProduct(html(value), url, profile));
  }
  assert.throws(() => naver.naverProduct(html(native(), 'https://smartstore.naver.com/other/products/123456789'), url, profile));
  assert.throws(() => naver.naverProduct('<form id="frmNIDLogin"><input name="id"></form>', url, profile), /naver_login_required/);
  const spoof = naver.naverProduct(html(native()), url, profile); spoof.productID = 'naver_smartstore:other:123456789'; spoof._product_offer.source_product_id = spoof.productID;
  assert.equal(productOnlyOffer(spoof, url), null);
});
test('Naver discovery admits only observed own-store links and never claims full inventory', async () => {
  const page = html({ '@type': 'ItemList', itemListElement: [{ url }, { url: url.replace('brewingceremony', 'other') }] }, listing);
  const found = await naver.discoverNaverProducts({ website_url: home }, profile, async value => ({ success: true, status: 200, finalUrl: value, data: page }));
  assert.deepEqual(found.urls, [url]); assert.equal(found.complete, false); assert.equal(naver.partialScopeAllowed(profile, found), true);
  for (const mutate of [r => r.error = 'HTTP 429', r => r.evidence = [], r => r.urls = [url.replace('brewingceremony', 'other')], r => r.complete = true, r => r.inventory_scope = 'all', r => r.urls.push(url)]) {
    const other = structuredClone(found); mutate(other); assert.equal(naver.partialScopeAllowed(profile, other), false);
  }
});
test('Naver 429 and login redirects produce explicit incomplete failures', async () => {
  const blocked = await naver.discoverNaverProducts({ website_url: home }, profile, async () => ({ success: false, status: 429, error: 'HTTP 429' }));
  assert.equal(blocked.complete, false); assert.deepEqual(blocked.urls, []); assert.match(blocked.error, /naver_rate_limited/);
  let calls = 0;
  const reader = createReader(profile, { maxRetries: 0, lookup: async () => [{ address: '1.1.1.1' }], fetch: async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://nid.naver.com/nidlogin.login' } }); } });
  const response = await reader.fetchHtml(home);
  assert.equal(response.success, false); assert.equal(response.failureCategory, 'naver_login_required'); assert.equal(calls, 1);
  const denied = await reader.fetchHtml('https://smartstore.naver.com/other/products/123');
  assert.equal(denied.success, false); assert.equal(calls, 1);
});
