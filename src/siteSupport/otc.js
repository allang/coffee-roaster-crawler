'use strict';
const cheerio = require('cheerio');
const { jsonLiteral } = require('./jsonLiteral');
const { parseMoney } = require('../catalogNormalization');
const { schemaAvailability } = require('../productEvidence');
const SOURCE = 'otc_next_primary_product_offer';
const houseCapsuleTitle = value => /^OTC\s+.+\s+\d+\u30ab\u30d7\u30bb\u30eb$/.test(String(value || '').trim());

function owned(value, profile, product = false) {
  const url = new URL(value), match = url.pathname.match(/^\/jp\/shop\/items\/([1-9]\d*)$/);
  if (url.protocol !== 'https:' || url.hostname !== 'otc-coffee.com' || !profile.hosts.includes(url.hostname) || url.port || url.username || url.password || url.search || url.hash || !(match || !product && ['/', '/jp', '/jp/shop'].includes(url.pathname))) throw Error('OTC unreviewed public destination');
  return { url, product: match?.[1] || null };
}
function document(html, url, profile) {
  owned(url, profile); const $ = cheerio.load(html || ''), canonical = $('link[rel="canonical"]');
  if (canonical.length !== 1 || canonical.attr('href') !== url) throw Error('OTC primary canonical mismatch');
  return $;
}
function records($) {
  let stream = '';
  $('script:not([src])').each((_, e) => {
    const script = $(e).text();
    for (const match of script.matchAll(/\bself\.__next_f\.push\s*\(/g)) {
      const chunk = jsonLiteral(script, match.index + match[0].length);
      if (chunk?.[0] === 1 && typeof chunk[1] === 'string') stream += chunk[1];
    }
  });
  if (stream.length > 1000000) throw Error('OTC public data limit');
  const rows = new Map();
  // Read only literal JSON records from the published Flight stream. References,
  // code, text records and server functions are never evaluated or invoked.
  for (const line of stream.split('\n')) {
    const match = line.match(/^([0-9a-f]+):([\[{].*)$/); if (!match) continue;
    let data; try { data = JSON.parse(match[2]); } catch { continue; }
    if (rows.has(match[1]) || rows.size >= 1000) throw Error('OTC duplicate/excess public records'); rows.set(match[1], data);
  }
  return rows;
}
async function discoverOtcProducts(roaster, profile, fetchHtml) {
  const urls = new Set(), evidence = [];
  try {
    for (const path of profile.listing_paths) {
      const url = new URL(path, profile.bootstrap_url).href, response = await fetchHtml(url);
      if (!response.success) throw Error(response.error || 'OTC listing unavailable');
      if ((response.finalUrl || url) !== url) throw Error('OTC listing redirected');
      const $ = document(response.data, url, profile), found = new Set(), excluded = [];
      $('main a[href]').filter((_, e) => !$(e).parents('aside,nav,footer,header').length).each((_, e) => {
        let target; try { target = owned(new URL($(e).attr('href'), url).href, profile, true); } catch { return; }
        const title = $(e).find('h3').text().trim();
        if (!title) throw Error('OTC primary public card title missing');
        if (!houseCapsuleTitle(title)) { excluded.push({ url: target.url.href, title, reason: title === 'OTC ZERO' ? 'coffee_machine' : 'different_brand_or_unreviewed_product' }); return; }
        found.add(target.url.href); urls.add(target.url.href);
      });
      if (!found.size) throw Error('OTC primary public coffee links missing');
      evidence.push({ listing: url, product_urls: [...found], excluded });
    }
    return { supported: true, urls: [...urls], complete: false, observed_scope_complete: true, inventory_complete: false, inventory_scope: 'otc_public_japanese_house_capsules', market_scope: 'JP', reconcile_omissions: false, inventory_authorizes_global_absence: false, evidence };
  } catch (error) { return { supported: true, urls: [], complete: false, observed_scope_complete: false, inventory_complete: false, error: error.message, evidence }; }
}
function partialScopeAllowed(profile, discovery) {
  if (!(profile?.adapter === 'otc_next' && profile.allow_partial_inventory === true && profile.reconcile_omissions === false && profile.inventory_authorizes_global_absence === false && discovery.supported === true && !discovery.error && discovery.complete === false && discovery.observed_scope_complete === true && discovery.inventory_complete === false && discovery.inventory_scope === 'otc_public_japanese_house_capsules' && discovery.market_scope === 'JP' && discovery.reconcile_omissions === false && discovery.inventory_authorizes_global_absence === false && discovery.urls?.length && discovery.evidence?.length === profile.listing_paths.length)) return false;
  try {
    const proved = new Set();
    for (let i = 0; i < discovery.evidence.length; i++) {
      const row = discovery.evidence[i]; if (row.listing !== new URL(profile.listing_paths[i], profile.bootstrap_url).href || !row.product_urls?.length) return false;
      for (const value of row.product_urls) { owned(value, profile, true); proved.add(value); }
    }
    return proved.size === discovery.urls.length && new Set(discovery.urls).size === discovery.urls.length && discovery.urls.every(value => proved.has(value));
  } catch { return false; }
}
function otcProduct(html, url, profile) {
  const target = owned(url, profile, true), $ = document(html, url, profile), rows = records($), route = rows.get('0');
  if (!Array.isArray(route?.c) || route.c.join('/') !== target.url.pathname) throw Error('OTC native route/product mismatch');
  const products = $('script[type="application/ld+json"]').toArray().map(e => { try { return JSON.parse($(e).text()); } catch { return null; } }).filter(p => p?.['@type'] === 'Product');
  if (products.length !== 1) throw Error('OTC primary product missing/ambiguous');
  const primary = products[0], name = String(primary.name || '').trim(), headings = $('main h1').map((_, e) => $(e).text().trim()).get();
  if (!houseCapsuleTitle(name) || !headings.length || headings.some(value => value !== name)) throw Error('OTC primary coffee capsule title mismatch');
  if ((primary.url && primary.url !== url) || (primary['@id'] && primary['@id'] !== url)) throw Error('OTC schema product mismatch');
  const offers = [primary.offers || []].flat();
  if (offers.length !== 1 || offers[0]['@type'] !== 'Offer' || offers[0].priceCurrency !== 'JPY' || offers[0].url && offers[0].url !== url) throw Error('OTC exact primary JPY offer missing');
  const offer = offers[0], money = parseMoney(offer.price, { currency: 'JPY', locale: 'ja-JP' });
  if (money.minorUnits == null) throw Error('OTC exact primary money missing');
  let reads = 0; const native = [];
  function walk(value, depth = 0) {
    if (++reads > 100000 || depth > 80) throw Error('OTC public data traversal limit');
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value) && typeof value.title === 'string' && value.title.trim() === name && /^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/.test(value.variantId || '') && value.amount != null) native.push(value);
    for (const child of Object.values(value)) walk(child, depth + 1);
  }
  for (const value of rows.values()) walk(value);
  const candidates = [...new Map(native.map(p => [JSON.stringify(p), p])).values()];
  if (candidates.length !== 1 || parseMoney(candidates[0].amount, { currency: 'JPY' }).minorUnits !== money.minorUnits) throw Error('OTC exact native primary price/identity missing');
  const data = candidates[0], controls = $('main button').filter((_, e) => $(e).text().trim().startsWith('\u5358\u54c1\u3092\u30ab\u30fc\u30c8\u306b\u5165\u308c\u308b'));
  if (!controls.length || controls.toArray().some(e => $(e).is('[disabled],[aria-disabled="true"]') || parseMoney($(e).text().trim().replace(/^\u5358\u54c1\u3092\u30ab\u30fc\u30c8\u306b\u5165\u308c\u308b\s*/, ''), { currency: 'JPY', locale: 'ja-JP' }).minorUnits !== money.minorUnits)) throw Error('OTC exact primary purchase control unavailable');
  if (schemaAvailability(offer.availability) === 'sold_out') throw Error('otc_conflicting_stock_evidence: enabled primary purchase control contradicts OutOfStock JSON-LD');
  if (schemaAvailability(offer.availability) !== 'in_stock') throw Error('OTC explicit primary stock missing');
  if (!data.description || data.images?.[0]?.url !== primary.image) throw Error('OTC primary description/photo disagreement');
  const description = cheerio.load(data.description); description('script,style,iframe,form').remove();
  const aliases = { country: 'country_of_origin', variety: 'varietal', process: 'process', producer: 'producer', region: 'origin_region', 'coffee-roast': 'roast_darkness' };
  const properties = (data.detail?.textDetails || []).filter(p => Object.hasOwn(aliases, p.key) && typeof p.value === 'string').map(p => ({ name: aliases[p.key], value: p.value }));
  if (data.detail?.flavorTags?.every(value => typeof value === 'string')) properties.push({ name: 'flavor_notes', value: data.detail.flavorTags });
  const productID = 'otc_public_product:' + target.product;
  const productOffer = { source: SOURCE, source_url: url, source_product_id: productID, price: money.amount, currency: 'JPY', minor_units: money.minorUnits, availability: offer.availability, state: 'in_stock', variant_identity_complete: false, observed_variant_id: data.variantId, stock_control: { source: 'otc_primary_purchase_control', product_id: target.product, enabled: true } };
  return { '@type': 'Product', url, productID, name, category: 'Coffee', description: description.html(), image: primary.image, additionalProperty: properties, offers: [], _product_only: true, _product_offer: productOffer, _variants_complete: false, _market_source: SOURCE, _market_context: { scope: 'otc_japanese_public_one_time_offer', currency: 'JPY', inventory_complete: false, variant_identity_complete: false } };
}
module.exports = { SOURCE, owned, records, discoverOtcProducts, partialScopeAllowed, otcProduct };
