'use strict';
const fs = require('node:fs');
const ids = new Set(['ca9a6fff-1d2d-4e3f-83d4-e29ec8f966f7', '50c59e18-865f-4e1f-99e7-1682132ca2eb', '9d723869-f652-49f3-a69c-92740948fd77']);
const profiles = require('../src/siteSupport/profiles.json').filter(p => p.adapter === 'base' && p.entity_ids.some(id => ids.has(id)));
const base = require('../src/siteSupport/base');

async function main() {
  const name = process.argv.slice(2).find(arg => !arg.startsWith('--'));
  const targets = name ? profiles.filter(p => p.name === name) : profiles;
  if (!targets.length || targets.some(p => p.entity_ids.length !== 1)) throw Error('Choose a reviewed BASE merchant name');
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ mode: 'preview', merchants: targets.map(p => ({ name: p.name, entity_id: p.entity_ids[0], website: p.bootstrap_url })), writes: 0, note: 'Pass --apply only to run the targeted production crawler. No schema or scheduler changes.' }, null, 2));
    return;
  }
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://gtlipifdfyugiwpxvuse.supabase.co') throw Error('Unexpected source catalog project');
  process.env.PARALLEL_ROASTERS = '1'; process.env.CRAWLER_PAGE_CONCURRENCY = '1';
  const { getSupabase } = require('../src/supabase'), { crawlRoaster } = require('../src/crawler'), { getBlacklistTerms } = require('../src/blacklist');
  const db = getSupabase(), blacklist = await getBlacklistTerms(), report = { started_at: new Date().toISOString(), mode: 'targeted-production-crawl', schema_changes: 0, scheduler_changes: 0, merchants: [] };
  fs.mkdirSync('.state/naver', { recursive: true });
  const output = '.state/naver/base-production-crawl.json';
  const persist = () => fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  for (const profile of targets) {
    const id = profile.entity_ids[0];
    const { data: roaster, error } = await db.from('entities').select('id,name,website_url,entity_roles!inner(role)').eq('id', id).eq('entity_roles.role', 'roaster').single();
    if (error) throw error;
    if (!base.identityMatches(roaster.website_url, profile)) throw Error('Indexed merchant URL changed: ' + profile.name);
    const active = await db.from('crawl_runs').select('id').eq('entity_id', id).eq('status', 'running');
    if (active.error) throw active.error;
    if (active.data.length) throw Error('Merchant crawl already running: ' + profile.name);
    const before = await db.from('products').select('id,source_url').eq('entity_id', id);
    if (before.error) throw before.error;
    const entry = { name: profile.name, entity_id: id, started_at: new Date().toISOString(), before_products: before.data, result: null };
    report.merchants.push(entry); persist();
    try { entry.result = await crawlRoaster(roaster, blacklist); }
    catch (error) { entry.result = { success: false, error: error.message }; }
    persist();
    const runs = await db.from('crawl_runs').select('*').eq('entity_id', id).gte('started_at', entry.started_at);
    if (runs.error) throw runs.error;
    const products = await db.from('products').select('id,name,source_url,source_key,metadata,original_title,description_raw,availability_state,is_available,original_image_url').eq('entity_id', id);
    if (products.error) throw products.error;
    const ids = products.data.map(p => p.id), variants = ids.length ? await db.from('product_variants').select('id,product_id,merchant_variant_id,price_minor_units,currency').in('product_id', ids) : { data: [] };
    if (variants.error) throw variants.error;
    const media = ids.length ? await db.from('product_media').select('product_id,media_asset_id').in('product_id', ids) : { data: [] };
    if (media.error) throw media.error;
    entry.runs = runs.data; entry.products = products.data; entry.variants = variants.data; entry.media = media.data;
    entry.new_product_ids = ids.filter(value => !before.data.some(row => row.id === value));
    entry.verified_product_offers = products.data.filter(row => {
      const offer = row.metadata?._product_offer, product = row.metadata?._normalization?.source_product_id;
      try { return Boolean(row.source_key && row.original_title && row.description_raw && offer && base.owned(row.source_url, profile, true) && baseProductOffer(row, product, offer)); }
      catch { return false; }
    }).length;
    entry.verified_photo_products = ids.filter(value => media.data.some(row => row.product_id === value)).length;
    entry.finished_at = new Date().toISOString(); persist();
    console.log(JSON.stringify({ name: profile.name, success: entry.result.success, before: before.data.length, after: ids.length, added: entry.new_product_ids.length, verified_offers: entry.verified_product_offers, photos: entry.verified_photo_products, variants: variants.data.length, output }));
    if (!entry.result.success || entry.verified_product_offers !== ids.length || entry.verified_photo_products !== ids.length || !ids.length) process.exitCode = 1;
  }
  report.finished_at = new Date().toISOString(); persist();
}
function baseProductOffer(row, productID, offer) {
  const evidence = require('../src/productEvidence').productOnlyOffer({ productID, offers: [], _product_only: true, _market_source: base.SOURCE, _product_offer: offer }, row.source_url);
  return evidence && evidence.state === row.availability_state && row.is_available === (evidence.state === 'in_stock');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
