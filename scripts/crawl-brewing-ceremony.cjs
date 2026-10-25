'use strict';
const fs = require('node:fs');
const { getSupabase } = require('../src/supabase');
const { crawlRoaster } = require('../src/crawler');
const { getBlacklistTerms } = require('../src/blacklist');
const id = require('../src/siteSupport/profiles.json').find(p => p.name === 'Brewing Ceremony').entity_ids[0];

(async () => {
  const db = getSupabase();
  const { data: roaster, error } = await db.from('entities').select('id,name,website_url').eq('id', id).single();
  if (error) throw error;
  if (roaster.website_url !== 'https://smartstore.naver.com/brewingceremony') throw Error('Roaster store changed');
  const active = await db.from('crawl_runs').select('id').eq('entity_id', id).eq('status', 'running');
  if (active.error) throw active.error;
  if (active.data.length) throw Error('A Brewing Ceremony crawl is already running');
  const before = await db.from('crawl_runs').select('id').eq('entity_id', id);
  if (before.error) throw before.error;
  const at = new Date().toISOString();
  const result = await crawlRoaster(roaster, await getBlacklistTerms());
  const runs = await db.from('crawl_runs').select('*').eq('entity_id', id).gte('started_at', at);
  if (runs.error) throw runs.error;
  const products = await db.from('products').select('id,name,source_url').eq('entity_id', id);
  if (products.error) throw products.error;
  const report = { checked_at: new Date().toISOString(), roaster, result, runs: runs.data.filter(row => !before.data.some(old => old.id === row.id)), products: products.data };
  fs.mkdirSync('.state/naver', { recursive: true });
  fs.writeFileSync('.state/naver/brewing-ceremony-crawl.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ success: result.success, runs: report.runs.map(row => ({ id: row.id, status: row.status, error: row.error })), products: report.products.length }));
  if (!result.success) process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
