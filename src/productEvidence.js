'use strict';

const cheerio = require('cheerio');
const { canonicalProductUrl } = require('./catalogNormalization');
function types(node) { return [node?.['@type']].flat().map(v => String(v).split('/').pop()); }
function sameProduct(a, b) { try { return canonicalProductUrl(new URL(a, b).href) === canonicalProductUrl(b); } catch { return false; } }
function structuredProduct(html, sourceUrl) {
  const $ = cheerio.load(html || '');
  const nodes = [];
  $('script[type="application/ld+json"]').each((i, element) => {
    try {
      const value = JSON.parse($(element).text());
      for (const node of [value].flat()) {
        nodes.push(node, ...[node?.['@graph'] || []].flat());
        if (types(node).includes('WebPage') && sameProduct(node.url || node['@id'], sourceUrl) && node.mainEntity) nodes.push(node.mainEntity);
      }
    } catch { /* Invalid structured data is not trustworthy evidence. */ }
  });
  const products = nodes.filter(n => types(n).some(t => ['Product', 'IndividualProduct', 'ProductGroup'].includes(t)));
  const exact = products.filter(p => (p.url || p['@id']) && sameProduct(p.url || p['@id'], sourceUrl));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const title = $('main h1, h1').first().text().trim().toLocaleLowerCase('en');
  const named = products.filter(p => !p.url && !p['@id'] && title && String(p.name || '').trim().toLocaleLowerCase('en') === title);
  return named.length === 1 ? named[0] : null;
}

function schemaAvailability(value) {
  const state = String(value || '').split('/').pop().toLowerCase();
  if (['instock', 'limitedavailability', 'onlineonly'].includes(state)) return 'in_stock';
  if (['outofstock', 'soldout', 'discontinued'].includes(state)) return 'sold_out';
  return 'unknown'; // PreOrder/BackOrder do not prove immediate stock.
}
function aggregateStates(states) {
  return states.includes('in_stock') ? 'in_stock' : states.length && states.every(s => s === 'sold_out') ? 'sold_out' : 'unknown';
}

function productAvailability(input = {}) {
  const checkedAt = input.checkedAt || new Date().toISOString();
  const result = (state, reason, evidence = [], variants = []) => ({ state, isAvailable: state === 'in_stock' ? true : ['sold_out', 'removed'].includes(state) ? false : null, reason, evidence, variants, checkedAt });
  if ([404,410].includes(input.status)) return result('removed', 'product_http_removed', [{ source: 'http', status: input.status, url: input.sourceUrl }]);
  if (input.status && input.status !== 200) return result('unknown', 'incomplete_fetch', [{ source: 'http', status: input.status }]);
  if (input.sourceUrl && input.finalUrl) {
    try {
      const source = new URL(input.sourceUrl), final = new URL(input.finalUrl);
      if (source.hostname === final.hostname && /\/products?\//i.test(source.pathname) && !/\/products?\//i.test(final.pathname)) return result('removed', 'product_redirected_away', [{ source: 'redirect', from: input.sourceUrl, to: input.finalUrl }]);
    } catch { return result('unknown', 'invalid_source_url'); }
  }
  if (input.shopifyProduct?.variants?.length) {
    const variants = input.shopifyProduct.variants.map(v => ({ source_id: v.id == null ? null : String(v.id), title: v.title, state: v.available === true ? 'in_stock' : v.available === false ? 'sold_out' : 'unknown', evidence: [{ source: 'shopify_product_json', available: v.available ?? null }], checkedAt }));
    return result(aggregateStates(variants.map(v => v.state)), 'shopify_exact_variants', [{ source: 'shopify_product_json', product_id: input.shopifyProduct.id }], variants);
  }
  const product = structuredProduct(input.html, input.sourceUrl);
  if (product) {
    const offers = [product.offers || []].flat();
    const variants = offers.filter(o => o && (!o.url || sameProduct(o.url, input.sourceUrl))).map(o => ({ source_id: o.sku || o['@id'] || null, title: o.name || null, state: schemaAvailability(o.availability), evidence: [{ source: 'product_jsonld_offer', availability: o.availability ?? null }], checkedAt }));
    return result(aggregateStates(variants.map(v => v.state)), 'product_scoped_structured_data', [{ source: 'product_jsonld', name: product.name }], variants);
  }
  const $ = cheerio.load(input.html || '');
  // Only the primary product's own form can prove stock. Recommended cards/global text cannot.
  const scopes = $('main > [itemscope][itemtype$="/Product"], main > [data-product-id], form#product-form, form[data-primary-product="true"]');
  if (scopes.length === 1) {
    const controls = scopes.find('button, input[type="submit"]');
    const states = [];
    controls.each((i, el) => {
      const control = $(el), text = `${control.text()} ${control.attr('value') || ''}`.trim();
      if (/sold\s*out|out\s*of\s*stock/i.test(text)) states.push('sold_out');
      else if (/add\s*to\s*(?:cart|bag)|buy\s*now/i.test(text)) states.push(control.is('[disabled], [aria-disabled="true"]') ? 'unknown' : 'in_stock');
    });
    if (states.length) return result(aggregateStates(states), 'primary_product_controls', [{ source: 'primary_product_form', states }]);
  }
  return result('unknown', 'product_stock_evidence_missing');
}

module.exports = { structuredProduct, schemaAvailability, aggregateStates, productAvailability, sameProduct };
