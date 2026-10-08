'use strict';

const cheerio = require('cheerio');
const { canonicalProductUrl } = require('./catalogNormalization');
function types(node) { return [node?.['@type']].flat().map(v => String(v).split('/').pop()); }
function sameProduct(a, b) { try { return canonicalProductUrl(new URL(a, b).href) === canonicalProductUrl(b); } catch { return false; } }
function offerVariantId(offer, sourceUrl) {
  // A selector supplied by this product's offer identifies the variant even when
  // the merchant omits SKU/name. Never infer it from AI output or another product.
  if (offer.url && !sameProduct(offer.url, sourceUrl)) return null;
  const existing = offer.sku || offer['@id'];
  if (existing) return existing; // Keep identities already adopted from explicit identifiers.
  if (offer.url) {
    const selected = new URL(offer.url, sourceUrl).searchParams.getAll('variant');
    if (selected.length === 1 && /^[1-9]\d{0,39}$/.test(selected[0])) return selected[0];
  }
  return null;
}
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
  if (exact.length === 1) return cafe24Description(flattenProductGroup(exact[0],sourceUrl),$,sourceUrl);
  if (exact.length > 1) return null;
  const title = $('main h1, h1').first().text().trim().toLocaleLowerCase('en');
  const named = products.filter(p => !p.url && !p['@id'] && title && String(p.name || '').trim().toLocaleLowerCase('en') === title);
  if(named.length===1)return cafe24Description(flattenProductGroup(named[0],sourceUrl),$,sourceUrl);
  const canonical=$('link[rel="canonical"]').attr('href');
  const offered=canonical && sameProduct(canonical,sourceUrl)?products.filter(p=>{
    const offers=[p.offers || []].flat();
    return !p.url && !p['@id'] && offers.length>0 && offers.every(o=>o.url && sameProduct(o.url,sourceUrl));
  }):[];
  return offered.length===1?cafe24Description(flattenProductGroup(offered[0],sourceUrl),$,sourceUrl):require('./siteSupport/headlessShopify').headlessShopifyProduct(html,sourceUrl);
}
function cafe24Description(product,$,sourceUrl) {
  if(!product || product.description)return product;
  const profile=require('./siteSupport/profiles.json').find(p=>p.adapter==='cafe24' && p.hosts.includes(new URL(sourceUrl).hostname));
  if(!profile)return product;
  const detail=$('#prdDetail > .cont');
  if(detail.length!==1)return product;
  const primary=detail.clone();primary.find('script,style,iframe,form,.menu,.relation').remove();
  return {...product,description:primary.html() || '',_description_source:'cafe24_primary_detail_content'};
}
function flattenProductGroup(product,sourceUrl) {
  if(!types(product).includes('ProductGroup')) {
    const offers=[product.offers || []].flat();
    if(offers.length===1 && /^cafe24_/.test(product.sku || ''))return {...product,productID:product.productID || product.sku,offers:[{...offers[0],sku:offers[0].sku || product.sku,name:offers[0].name || product.name}]};
    return product;
  }
  if(!Array.isArray(product.hasVariant) || !product.hasVariant.length)return product;
  const offers=[];
  for(const variant of product.hasVariant) {
    const memberOffers=[variant.offers || []].flat();
    if(!memberOffers.length || memberOffers.some(o=>!o.url || !sameProduct(o.url,sourceUrl)))return null;
    const sizes=[variant.additionalProperty || []].flat().filter(p=>/^(?:net[_\s-]*weight|size|용량|내용량)$/i.test(p?.name || p?.propertyID || '')).map(p=>require('./shopifyProduct').labelWeight(p.value));
    const netWeight=sizes.length && sizes.every(v=>v!=null) && new Set(sizes).size===1?sizes[0]:null;
    for(const offer of memberOffers)offers.push({...offer,sku:variant.sku || offer.sku,name:variant.name,_net_weight_g:netWeight});
  }
  return {...product,productID:product.productID || product.productGroupID,description:product.description || product.hasVariant[0].description,image:product.image || product.hasVariant[0].image,offers,_market_source:'product_group_exact_variant_offers'};
}

function schemaAvailability(value) {
  const state = String(value || '').split('/').pop().toLowerCase();
  if (['instock', 'limitedavailability'].includes(state)) return 'in_stock';
  if (['outofstock', 'soldout', 'discontinued'].includes(state)) return 'sold_out';
  return 'unknown'; // PreOrder/BackOrder do not prove immediate stock.
}
function aggregateStates(states) {
  return states.includes('in_stock') ? 'in_stock' : states.length && states.every(s => s === 'sold_out') ? 'sold_out' : 'unknown';
}

function primaryShopifyPreorders(html,sourceUrl,native) {
  const result=new Map();let url;
  try{url=new URL(sourceUrl);}catch{return result;}
  const profile=require('./siteSupport/profiles.json').find(p=>p.adapter==='shopify' && p.hosts.includes(url.hostname));
  const rule=profile?.preorder_rules?.find(r=>url.pathname==='/products/'+r.handle);
  if(!profile || !native)return result;
  const tags=Array.isArray(native.tags)?native.tags:String(native.tags || '').split(/,\s*/);
  const preorder=tags.find(tag=>/^pre[-\s]?order$/i.test(String(tag).trim()));
  if(preorder && native.id!=null && url.pathname==='/products/'+native.handle) {
    for(const v of native.variants || [])if(v.id!=null)result.set(String(v.id),{source:'shopify_product_preorder_tag',url:sourceUrl,product_id:String(native.id),variant_id:String(v.id),tag:preorder});
  }
  if(!rule)return result;
  // This reviewed control is product-specific. Global nav banners and other
  // products' controls cannot override an exact variant's immediate stock.
  if(String(native.id)!==rule.product_id || native.handle!==rule.handle)throw Error('Reviewed preorder product identity mismatch');
  const $=cheerio.load(html || ''),canonical=$('link[rel="canonical"]'),controls=$(rule.control_selector);
  if(canonical.length!==1 || !sameProduct(canonical.attr('href'),sourceUrl) || controls.length!==1)throw Error('Reviewed primary preorder control missing or ambiguous');
  const text=controls.first().text().replace(/\s+/g,' ').trim();
  if(!/^pre[-\s]?order(?:\s+now)?$/i.test(text))return result;
  const variantControls=$(rule.variant_control_selector).filter((_,e)=>$(e).attr('data-variant-id')===rule.variant_id);
  if(variantControls.length!==1 || native.variants?.length!==1 || String(native.variants[0].id)!==rule.variant_id)throw Error('Reviewed preorder variant binding missing or ambiguous');
  result.set(rule.variant_id,{source:'primary_product_preorder_control',url:sourceUrl,product_id:rule.product_id,variant_id:rule.variant_id,control_selector:rule.control_selector,variant_control_selector:rule.variant_control_selector,text});
  return result;
}

function productAvailability(input = {}) {
  const checkedAt = input.checkedAt || new Date().toISOString();
  const result = (state, reason, evidence = [], variants = []) => ({ state, isAvailable: state === 'in_stock' ? true : ['sold_out', 'removed'].includes(state) ? false : null, reason, evidence, variants, checkedAt });
  if ([404,410].includes(input.status)) return result('removed', 'product_http_removed', [{ source: 'http', status: input.status, url: input.sourceUrl }]);
  if (input.status && input.status !== 200) return result('unknown', 'incomplete_fetch', [{ source: 'http', status: input.status }]);
  const primary=cheerio.load(input.html || ''),heading=(primary('main h1').first().text() || primary('h1').first().text()).trim();
  if(input.status===200 && /^(?:page not found|404(?:\s*[-–:]?\s*not found)?|product not found)$/i.test(heading))
    return result('removed','product_soft_404',[{source:'primary_product_heading',heading,status:200,url:input.sourceUrl}]);
  if (input.sourceUrl && input.finalUrl) {
    try {
      const source = new URL(input.sourceUrl), final = new URL(input.finalUrl);
      if (source.hostname === final.hostname && /\/products?\//i.test(source.pathname) && !/\/products?\//i.test(final.pathname)) return result('removed', 'product_redirected_away', [{ source: 'redirect', from: input.sourceUrl, to: input.finalUrl }]);
    } catch { return result('unknown', 'invalid_source_url'); }
  }
  if (input.shopifyProduct?.variants?.length) {
    const preorders=primaryShopifyPreorders(input.html,input.finalUrl || input.sourceUrl,input.shopifyProduct);
    const variants = input.shopifyProduct.variants.map(v => ({ source_id: v.id == null ? null : String(v.id), title: v.title, state: preorders.has(String(v.id))?'unknown':v.available === true ? 'in_stock' : v.available === false ? 'sold_out' : 'unknown', evidence: [{ source: v._availability_source || 'shopify_product_json', available: v.available ?? null },...[preorders.get(String(v.id))].filter(Boolean)], checkedAt }));
    return result(aggregateStates(variants.map(v => v.state)), preorders.size?'primary_product_preorder':'shopify_exact_variants', [{ source: 'shopify_product_json', product_id: input.shopifyProduct.id },...preorders.values()], variants);
  }
  const product = input.sourceProduct || structuredProduct(input.html, input.sourceUrl);
  if (product) {
    const offers = [product.offers || []].flat();
    const variants = offers.filter(o => o && (!o.url || sameProduct(o.url, input.sourceUrl))).map(o => ({ source_id: offerVariantId(o,input.sourceUrl), title: o.name || null, state: schemaAvailability(o.availability), evidence: [{ source: product._market_source || 'product_jsonld_offer', url:o.url || null, availability: o.availability ?? null }], checkedAt }));
    return result(aggregateStates(variants.map(v => v.state)), 'product_scoped_structured_data', [{ source: product._market_source || 'product_jsonld', name: product.name }], variants);
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

module.exports = { structuredProduct, schemaAvailability, aggregateStates, productAvailability, primaryShopifyPreorders, sameProduct, offerVariantId };
