'use strict';
const cheerio = require('cheerio');
const { parseMoney } = require('../catalogNormalization');
const { schemaAvailability } = require('../productEvidence');
const SOURCE = 'base_primary_product_offer';
const EXCLUDE = /subscription|green\s+coffee|grinder|gift\s*card|\u5b9a\u671f\u4fbf|\u30b5\u30d6\u30b9\u30af|\u751f\u8c46|\u5668\u5177|\u30de\u30b0|\u30df\u30eb|\u30c9\u30ea\u30c3\u30d1\u30fc|\u306f\u3061\u307f\u3064/i;

function owned(value, profile, product = false) {
  const url = new URL(value), base = new URL(profile.bootstrap_url);
  const match = url.pathname.match(/^\/items\/([1-9]\d*)\/?$/);
  if (url.protocol !== 'https:' || url.origin !== base.origin || url.username || url.password || url.port || url.search || url.hash || !(match || !product && (url.pathname === '/' || /^\/categories\/[1-9]\d*\/?$/.test(url.pathname)))) throw Error('BASE unreviewed store/product URL');
  return { url, product: match?.[1] || null };
}
function identityMatches(value, profile) {
  try {
    const url = new URL(value); url.search = ''; url.hash = '';
    return url.origin === new URL(profile.bootstrap_url).origin || profile.identity_urls?.includes(url.href) === true;
  } catch { return false; }
}
function schemas($) {
  const out = [];
  function add(value) { if (Array.isArray(value)) return value.forEach(add); if (!value || typeof value !== 'object') return; out.push(value); if (value['@graph']) add(value['@graph']); }
  $('script[type="application/ld+json"]').each((_, e) => { try { add(JSON.parse($(e).text())); } catch {} });
  return out;
}
function document(html, url, profile) {
  owned(url, profile);
  const $ = cheerio.load(html || ''), declarations = $('link[rel="canonical"]');
  if (declarations.length !== 1 || owned(declarations.attr('href'), profile).url.href !== new URL(url).href) throw Error('BASE primary canonical identity missing/mismatched');
  return $;
}
async function discoverBaseProducts(roaster, profile, fetchHtml) {
  const urls = new Set(), evidence = [];
  try {
    if (!identityMatches(roaster.website_url, profile)) throw Error('BASE index identity mismatch');
    for (const path of profile.listing_paths) {
      const url = new URL(path, profile.bootstrap_url).href, response = await fetchHtml(url);
      if (!response.success) throw Error(response.error || 'BASE listing unavailable');
      if (new URL(response.finalUrl || url).href !== url) throw Error('BASE listing redirected outside reviewed scope');
      const $ = document(response.data, url, profile), cards = $('[data-parts="items-grid"] li[class*="itemListLI"] a[href]');
      const found = new Set(), excluded = [];
      if (!cards.length) throw Error('BASE published product cards missing');
      cards.each((_, e) => {
        const href = new URL($(e).attr('href'), url).href;
        owned(href, profile, true);
        const title = $(e).find('[class*="itemTitleText"]').text().trim();
        if (!title) throw Error('BASE published product title missing');
        if (EXCLUDE.test(title)) { excluded.push({ url: href, title }); return; }
        found.add(href); urls.add(href);
      });
      if (!found.size) throw Error('BASE one-time product cards missing');
      evidence.push({ listing: url, product_urls: [...found], excluded });
    }
    // These rendered cards do not prove hidden categories or all native options.
    return { supported: true, urls: [...urls], complete: false, observed_scope_complete: true, inventory_complete: false,
      inventory_scope: 'base_published_one_time_cards', market_scope: 'JPY_public_offer', reconcile_omissions: false, inventory_authorizes_global_absence: false, evidence };
  } catch (error) { return { supported: true, urls: [], complete: false, observed_scope_complete: false, inventory_complete: false, error: error.message, evidence }; }
}
function partialScopeAllowed(profile, discovery) {
  if (!(profile?.adapter === 'base' && profile.allow_partial_inventory === true && profile.reconcile_omissions === false && profile.inventory_authorizes_global_absence === false && discovery.supported === true && !discovery.error && discovery.complete === false && discovery.observed_scope_complete === true && discovery.inventory_complete === false && discovery.inventory_scope === 'base_published_one_time_cards' && discovery.market_scope === 'JPY_public_offer' && discovery.reconcile_omissions === false && discovery.inventory_authorizes_global_absence === false && discovery.urls?.length && discovery.evidence?.length === profile.listing_paths.length)) return false;
  try {
    const proved = new Set();
    for (let i = 0; i < discovery.evidence.length; i++) {
      const row = discovery.evidence[i];
      if (row.listing !== new URL(profile.listing_paths[i], profile.bootstrap_url).href || !row.product_urls?.length) return false;
      for (const value of row.product_urls) { owned(value, profile, true); proved.add(value); }
    }
    return proved.size === discovery.urls.length && new Set(discovery.urls).size === discovery.urls.length && discovery.urls.every(value => proved.has(value));
  } catch { return false; }
}
function baseProduct(html, url, profile) {
  const target = owned(url, profile, true), $ = document(html, url, profile), forms = $('form.cot-itemOrder-form');
  if (forms.length !== 1) throw Error('BASE primary order form missing/ambiguous');
  const form = forms.first();
  if (form.attr('data-item-id') !== target.product || form.attr('data-shop-id') !== profile.base_shop_id || form.find('input[name="id"]').attr('value') !== target.product || form.find('input[name="shopID"]').attr('value') !== profile.base_shop_id || form.attr('data-community-limited-item') !== 'false') throw Error('BASE native product/shop identity mismatch');
  const products = schemas($).filter(p => p['@type'] === 'Product');
  if (products.length !== 1) throw Error('BASE primary product schema missing/ambiguous');
  const primary = products[0], headings = $('[class*="item-detail_itemTitle_"]');
  // BASE JSON-LD sometimes retains HTML entities already decoded in the DOM.
  const name = typeof primary.name === 'string' ? cheerio.load(primary.name).text().trim() : '';
  if (!name || headings.length !== 1 || headings.text().trim() !== name || EXCLUDE.test(name)) throw Error('BASE primary one-time title missing/mismatched');
  if ((primary.url && primary.url !== url) || (primary['@id'] && primary['@id'] !== url)) throw Error('BASE schema product identity mismatch');
  const text = [name, primary.description].filter(Boolean).join(' ');
  if (!/coffee|roast|\u30b3[\u30fc\u2015]\u30d2\u30fc|\u7119\u714e|\u539f\u7523\u56fd|\u30c9\u30ea\u30c3\u30d7/i.test(text)) throw Error('BASE roasted coffee identity missing');
  const offers = [primary.offers || []].flat();
  if (offers.length !== 1 || offers[0]['@type'] !== 'Offer' || offers[0].priceCurrency !== 'JPY' || offers[0].url && offers[0].url !== url) throw Error('BASE exact primary JPY offer missing');
  const offer = offers[0], money = parseMoney(offer.price, { currency: 'JPY', locale: 'ja-JP' });
  if (money.minorUnits == null) throw Error('BASE exact base price missing');
  const controls = form.find('button.cot-itemOrder-submit[type="submit"]');
  if (controls.length !== 1) throw Error('BASE primary purchase control missing/ambiguous');
  const control = controls.first(), label = control.text().replace(/\s+/g, ' ').trim(), disabled = control.is('[disabled], [aria-disabled="true"]') || control.attr('data-disabled') === 'true';
  let state;
  if (/^(?:sold\s*out|\u58f2\u308a\u5207\u308c)$/i.test(label) && disabled) state = 'sold_out';
  else if (/^(?:add to cart|\u30ab\u30fc\u30c8\u306b\u5165\u308c\u308b)$/i.test(label) && !disabled && control.attr('data-disabled') === 'false' && schemaAvailability(offer.availability) === 'in_stock') state = 'in_stock';
  else throw Error('BASE exact primary purchasability missing/conflicting');
  const description = cheerio.load(primary.description || ''); description('script,style,iframe,form').remove();
  const productID = 'base:' + profile.base_shop_id + ':' + target.product;
  const productOffer = { source: SOURCE, source_url: url, source_product_id: productID, price: money.amount, currency: 'JPY', minor_units: money.minorUnits,
    availability: 'https://schema.org/' + (state === 'in_stock' ? 'InStock' : 'OutOfStock'), state, variant_identity_complete: false,
    stock_control: { source: 'base_primary_purchase_control', product_id: target.product, shop_id: profile.base_shop_id, text: label, disabled }, schema_availability: offer.availability || null };
  return { '@type': 'Product', url, productID, name, category: 'Coffee', description: description.html(), image: primary.image, additionalProperty: primary.additionalProperty || [],
    offers: [], _product_only: true, _product_offer: productOffer, _variants_complete: false, _market_source: SOURCE,
    _market_context: { scope: 'base_public_primary_offer', currency: 'JPY', inventory_complete: false, variant_identity_complete: false, base_price_only: true } };
}
module.exports = { SOURCE, owned, identityMatches, discoverBaseProducts, partialScopeAllowed, baseProduct };
