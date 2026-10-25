'use strict';
const fs = require('node:fs');
const cheerio = require('cheerio');
const { createReader } = require('../src/siteSupport/network');

async function main() {
  const root = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (root !== 'https://gtlipifdfyugiwpxvuse.supabase.co') throw Error('Unexpected catalog project');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const query = new URLSearchParams({ select: 'id,name,website_url,created_at,entity_roles!inner(role,role_metadata)', created_at: 'gte.2026-10-25T06:45:00Z', 'entity_roles.role': 'eq.roaster', order: 'created_at.asc' });
  const response = await fetch(root + '/rest/v1/entities?' + query, { headers: { apikey: key, Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error('Catalog read failed: HTTP ' + response.status);
  const journal = fs.readFileSync('/Users/allan/Documents/workspace/everycoffee/tmp/asian-roasters-instagram/2026-10-25-journal.jsonl', 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const targets = new Set(['499e57b1-2c67-5b34-928f-9b7de559f87d', 'a3ed7572-b082-4ac1-ab88-c7d9826654f6', '33f05bef-1553-484b-8604-4972704afa45', ...journal.filter(event => event.event === 'readback').map(event => event.entity?.id)]);
  const rows = (await response.json()).filter(row => targets.has(row.id));
  const report = { checked_at: new Date().toISOString(), mode: 'homepage-get-only', catalog_writes: 0, product_writes: 0, ai_calls: 0, sites: [] };
  fs.mkdirSync('.state/naver', { recursive: true });
  for (const row of rows) {
    const site = new URL(row.website_url), hosts = [site.hostname, site.hostname.startsWith('www.') ? site.hostname.slice(4) : 'www.' + site.hostname];
    const reader = createReader({ hosts }, { maxRetries: 0, timeoutMs: 10000, maxElapsedMs: 15000 });
    const result = await reader.fetchHtml(site.href);
    const entry = { entity_id: row.id, name: row.name, url: site.href, success: result.success, status: result.status || null, final_url: result.finalUrl, error: result.error || null, requests: reader.requests.length };
    if (result.success) {
      const $ = cheerio.load(result.data);
      entry.title = $('title').text().trim();
      entry.platforms = Object.entries({ Shopify: /shopify/i, WooCommerce: /woocommerce/i, Imweb: /cdn\.imweb\.me/i, Cafe24: /cafe24/i, Square: /square\.site|weebly|squarecdn/i, BASE: /thebase\.in|base\.shop|BASEec/i, Shopee: /shopee/i, Naver: /smartstore\.naver/i }).filter(([, pattern]) => pattern.test(site.href + ' ' + result.data)).map(([name]) => name);
      const links = [...new Set($('a[href]').map((_, e) => $(e).attr('href')).get())];
      entry.product_links = links.filter(value => /\/(?:products?|items?)\/|shop_view|product_no=|product\/detail/i.test(value)).slice(0, 50);
      entry.external_shop_links = links.filter(value => /smartstore\.naver|shopee\.|stores\.jp|base\.shop|thebase\.in|handcrafted\.jp|shop-pro\.jp/i.test(value));
      entry.product_schema_present = $('script[type="application/ld+json"]').toArray().some(e => /"@type"\s*:\s*"Product"/.test($(e).text()));
      entry.challenge_present = /captcha|verify you are human|security verification|접속이 불가합니다/i.test(result.data);
    }
    report.sites.push(entry);
    fs.writeFileSync('.state/naver/new-sites-audit.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ name: entry.name, status: entry.status, success: entry.success, platforms: entry.platforms, product_links: entry.product_links?.length || 0, error: entry.error }));
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
