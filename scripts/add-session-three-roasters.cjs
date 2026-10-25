'use strict';
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { stableUuid } = require('../src/catalogNormalization');
const origin = 'https://gtlipifdfyugiwpxvuse.supabase.co';
const targets = [
  {
    name: 'Toyosaki Coffee Factory', slug: 'toyosaki-coffee-factory', website_url: 'https://www.toyosakicoffeefactory.com/shop', primary_location: 'Tomigusuku, Okinawa, Japan',
    instagram: 'https://www.instagram.com/toyosakicoffeefactory/',
    identity_query: '(website_url.ilike.*toyosakicoffeefactory*,name.ilike.*toyosaki*,name.ilike.*\u8c4a\u5d0e*,name.ilike.*\u30c8\u30e8\u30b5\u30ad*,contact->>socials.ilike.*toyosakicoffeefactory*,contact->>instagram.ilike.*toyosakicoffeefactory*)',
    evidence: [{ url: 'https://www.toyosakicoffeefactory.com/blank', quote: '\u81ea\u5bb6\u7119\u714e\u73c8\u7432\u8c46', finding: 'Official factory/shop page states own-roasted coffee beans and identifies the Japanese operator, Okinawa Ueshima Coffee.' }],
    review: 'An existing Ueshima Coffee Company entity uses another published brand and merchant domain. It is preserved, not merged or overwritten. Toyosaki has its own named Japanese factory/shop identity.'
  },
  {
    name: 'Regolith Coffee', slug: 'regolith-coffee', website_url: 'https://regolith-coffee.com/', primary_location: 'Oita, Oita, Japan',
    instagram: 'https://www.instagram.com/regolith_coffee/',
    identity_query: '(website_url.ilike.*regolith*,website_url.ilike.*roasting-seminar.pages.dev*,name.ilike.*regolith*,name.ilike.*\u30ec\u30b4\u30ea\u30b9*,contact->>socials.ilike.*regolith_coffee*,contact->>instagram.ilike.*regolith_coffee*)',
    evidence: [{ url: 'https://regolith-coffee.jp/', quote: '\u81ea\u5206\u305f\u3061\u3067\u7119\u714e\u3057\u3001\u8ca9\u58f2\u3057\u3001\u5378\u3059\u3002', finding: 'Official brand site describes its own roasting, gives the Oita roastery address and links its regolith-coffee.com retail store.' }],
    review: 'Official .jp brand, .com store and seminar alias were checked together against all source entities, including non-roaster roles.'
  }
];
async function main() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '') !== origin || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw Error('Unexpected or missing source catalog configuration');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY, apply = process.argv.includes('--apply');
  const report = { checked_at: new Date().toISOString(), mode: apply ? 'apply' : 'preview', discovery_thread: '01a1721c-8db9-77e0-b390-33b080a8a0dd', hop_path: ['brewingceremony', 'prior verified graph frontier: toyosakicoffeefactory', 'regolith_coffee'], targets: [] };
  fs.mkdirSync('.state/naver', { recursive: true });
  const output = '.state/naver/session-three-index-' + report.mode + '-' + randomUUID() + '.json';
  const save = () => { const data = JSON.stringify(report, null, 2) + '\n'; fs.writeFileSync(output, data); fs.writeFileSync('.state/naver/session-three-index.json', data); };
  async function request(table, params, body) {
    const response = await fetch(origin + '/rest/v1/' + table + '?' + new URLSearchParams(params), {
      method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(30000),
      headers: { apikey: key, Authorization: 'Bearer ' + key, ...(body ? { 'content-type': 'application/json', Prefer: 'return=representation' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json(); if (!response.ok) throw Error('Catalog ' + table + ' HTTP ' + response.status + ' ' + (data.code || '')); return data;
  }
  for (const target of targets) {
    const id = stableUuid('verified-roaster', target.website_url), entity = { id, name: target.name, slug: target.slug, name_slug: target.slug, website_url: target.website_url, primary_location: target.primary_location, contact: { socials: [target.instagram] } };
    const matches = await request('entities', { select: 'id,name,website_url,contact', or: target.identity_query, limit: '1000' });
    if (matches.length > 1 || matches.length === 1 && (matches[0].id !== id || matches[0].website_url !== target.website_url)) throw Error('Existing identity requires review: ' + target.name);
    const entry = { entity, sources: target.evidence, identity_review: target.review, before: matches, writes: [] }; report.targets.push(entry); save();
    if (!apply) continue;
    if (!matches.length) {
      entry.pending = { table: 'entities', id }; save();
      entry.writes.push({ table: 'entities', rows: await request('entities', { select: 'id,name,website_url' }, entity) }); delete entry.pending; save();
    }
    const roles = await request('entity_roles', { entity_id: 'eq.' + id, role: 'eq.roaster', select: '*' });
    if (!roles.length) {
      entry.pending = { table: 'entity_roles', id }; save();
      entry.writes.push({ table: 'entity_roles', rows: await request('entity_roles', { select: '*' }, { entity_id: id, role: 'roaster', role_metadata: { verification: { checked_at: report.checked_at, sources: target.evidence, discovery_thread: report.discovery_thread, identity_review: target.review } } }) }); delete entry.pending; save();
    }
    entry.after = { entities: await request('entities', { id: 'eq.' + id, select: 'id,name,website_url,primary_location,contact' }), roles: await request('entity_roles', { entity_id: 'eq.' + id, role: 'eq.roaster', select: '*' }) };
    if (entry.after.entities.length !== 1 || entry.after.entities[0].website_url !== target.website_url || entry.after.roles.length !== 1) throw Error('Roaster readback mismatch');
    entry.status = 'verified'; save();
  }
  report.finished_at = new Date().toISOString(); save();
  console.log(JSON.stringify({ mode: report.mode, targets: report.targets.map(t => ({ id: t.entity.id, name: t.entity.name, existing: t.before.length, writes: t.writes.length, status: t.status || 'preview' })), output }));
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
