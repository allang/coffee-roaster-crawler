'use strict';
const cheerio = require('cheerio');
const { parseMoney } = require('../catalogNormalization');
const { schemaAvailability } = require('../productEvidence');
const SOURCE = 'naver_smartstore_primary_product_offer';
const HOSTS = new Set(['smartstore.naver.com', 'm.smartstore.naver.com']);

function identity(value) {
  const url = new URL(value);
  const match = url.pathname.match(/^\/([a-z0-9_-]+)(?:\/(?:products\/([1-9]\d*)|category\/([a-zA-Z0-9_-]+)))?\/?$/);
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.port || url.username || url.password || !match) throw Error('Unverified Naver store URL');
  return { url, store: match[1], product: match[2] || null };
}
function owned(value, profile, product = false) {
  const result = identity(value);
  if (result.store !== profile.naver_store || !profile.hosts.includes(result.url.hostname) || product && !result.product) throw Error('Naver store/product owner mismatch');
  return result;
}
function canonical(value) {
  const result = identity(value);
  result.url.hostname = 'smartstore.naver.com';
  result.url.search = ''; result.url.hash = '';
  result.url.pathname = result.url.pathname.replace(/\/$/, '');
  return result.url.href;
}
function failureCategory(response) {
  try { if (new URL(response.finalUrl).hostname === 'nid.naver.com') return 'naver_login_required'; } catch {}
  if (response.status === 429) return 'naver_rate_limited';
  if (response.status === 403) return 'naver_access_blocked';
  return 'naver_fetch_failed';
}
function document(html, url, profile) {
  owned(url, profile);
  const $ = cheerio.load(html || '');
  if ($('input[name="id"],input[name="pw"],form#frmNIDLogin').length || /nid\.naver\.com\/nidlogin/.test($('form').attr('action') || '')) throw Error('naver_login_required');
  const declarations = $('link[rel="canonical"],meta[property="og:url"]').map((_, e) => $(e).attr('href') || $(e).attr('content')).get();
  if (!declarations.length || declarations.some(value => canonical(value) !== canonical(url))) throw Error('Naver primary page identity missing/mismatched');
  return $;
}
function schemas($) {
  const out = [];
  function add(value) { if (Array.isArray(value)) return value.forEach(add); if (!value || typeof value !== 'object') return; out.push(value); if (value['@graph']) add(value['@graph']); }
  $('script[type="application/ld+json"]').each((_, e) => { try { add(JSON.parse($(e).text())); } catch {} });
  return out;
}
async function discoverNaverProducts(roaster, profile, fetchHtml) {
  const urls = new Set(), evidence = [], visited = new Set();
  let next = new URL(profile.listing_paths[0], profile.bootstrap_url).href;
  try {
    owned(roaster.website_url, profile);
    while (next) {
      if (visited.size >= 30 || visited.has(next)) throw Error('Naver listing pagination incomplete/repeated');
      owned(next, profile); visited.add(next);
      const response = await fetchHtml(next);
      if (!response.success) throw Error(failureCategory(response) + ': ' + (response.error || response.status));
      const final = response.finalUrl || next, $ = document(response.data, final, profile), found = new Set();
      const lists = schemas($).filter(node => node['@type'] === 'ItemList');
      const links = lists.flatMap(node => (node.itemListElement || []).map(item => item.url || item.item?.url));
      $('main a[href], [role="main"] a[href]').filter((_, e) => !$(e).parents('aside,nav,footer,header,[class*="recommend"]').length).each((_, e) => links.push($(e).attr('href')));
      for (const href of links.filter(Boolean)) {
        let candidate;
        try { candidate = new URL(href, final).href; const target = owned(candidate, profile); if (!target.product) continue; } catch { continue; }
        found.add(canonical(candidate)); urls.add(canonical(candidate));
      }
      if (!found.size) throw Error('Naver public product links missing; rendering or access may be required');
      evidence.push({ listing: final, product_urls: [...found] });
      const later = $('a[rel="next"]').map((_, e) => $(e).attr('href')).get();
      if (later.length > 1) throw Error('Naver next page ambiguous');
      next = later.length ? new URL(later[0], final).href : null;
    }
    // Public cards cannot prove that Naver exposed every category/hidden option.
    return { supported: true, urls: [...urls], complete: false, observed_scope_complete: true, inventory_complete: false,
      inventory_scope: 'naver_public_product_links', market_scope: 'KR', reconcile_omissions: false, inventory_authorizes_global_absence: false, evidence };
  } catch (error) { return { supported: true, urls: [], complete: false, observed_scope_complete: false, inventory_complete: false, error: error.message, evidence }; }
}
function partialScopeAllowed(profile, discovery) {
  if (!(profile?.adapter === 'naver_smartstore' && profile.allow_partial_inventory === true && profile.reconcile_omissions === false && profile.inventory_authorizes_global_absence === false && discovery.supported === true && !discovery.error && discovery.complete === false && discovery.inventory_complete === false && discovery.observed_scope_complete === true && discovery.inventory_scope === 'naver_public_product_links' && discovery.market_scope === 'KR' && discovery.reconcile_omissions === false && discovery.inventory_authorizes_global_absence === false && discovery.urls?.length && discovery.evidence?.length)) return false;
  try {
    const proved = new Set();
    for (const row of discovery.evidence) { owned(row.listing, profile); if (!row.product_urls?.length) return false; for (const value of row.product_urls) { owned(value, profile, true); proved.add(canonical(value)); } }
    return proved.size === discovery.urls.length && new Set(discovery.urls.map(canonical)).size === discovery.urls.length && discovery.urls.every(value => { owned(value, profile, true); return proved.has(canonical(value)); });
  } catch { return false; }
}
function naverProduct(html, url, profile) {
  const target = owned(url, profile, true), $ = document(html, url, profile), sourceUrl = canonical(url);
  const same = value => { try { return canonical(value) === sourceUrl; } catch { return false; } };
  const products = schemas($).filter(p => p['@type'] === 'Product' && (same(p.url || p['@id']) || !p.url && !p['@id'] && [p.offers || []].flat().some(o => same(o.url))));
  if (products.length !== 1) throw Error('Naver primary product missing/ambiguous');
  const primary = products[0], text = [primary.name, primary.category, primary.description].filter(Boolean).join(' ');
  if (!primary.name || !/(?:원두|볶은\s*커피|roasted\s+coffee|coffee\s+beans)/i.test(text) || /(?:생두|그라인더|보관|머그|드리퍼|커피머신|green\s+coffee|grinder|mug|storage\s+container)/i.test(primary.name)) throw Error('Naver roasted coffee identity unverified');
  const offers = [primary.offers || []].flat();
  if (offers.length !== 1 || offers[0]['@type'] !== 'Offer' || !same(offers[0].url) || offers[0].priceCurrency !== 'KRW') throw Error('Naver exact primary KRW offer missing');
  const offer = offers[0], money = parseMoney(offer.price, { currency: offer.priceCurrency, locale: 'ko-KR' }), state = schemaAvailability(offer.availability);
  if (money.minorUnits == null || !['in_stock', 'sold_out'].includes(state)) throw Error('Naver exact primary price/stock missing');
  const productID = 'naver_smartstore:' + target.store + ':' + target.product;
  const description = cheerio.load(primary.description || ''); description('script,style,iframe,form').remove();
  const productOffer = { source: SOURCE, source_url: sourceUrl, source_product_id: productID, price: money.amount, currency: 'KRW', minor_units: money.minorUnits, availability: offer.availability, state, variant_identity_complete: false };
  return { '@type': 'Product', url: sourceUrl, productID, name: primary.name, category: 'Coffee', description: description.html(), image: primary.image, additionalProperty: primary.additionalProperty || [],
    offers: [], _product_only: true, _product_offer: productOffer, _variants_complete: false, _market_source: SOURCE,
    _market_context: { scope: 'naver_public_product', currency: 'KRW', inventory_complete: false, variant_identity_complete: false } };
}
module.exports = { SOURCE, identity, owned, canonical, failureCategory, discoverNaverProducts, partialScopeAllowed, naverProduct };
