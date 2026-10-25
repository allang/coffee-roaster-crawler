'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { stableUuid } = require('../src/catalogNormalization');

const origin = 'https://gtlipifdfyugiwpxvuse.supabase.co';
const website = 'https://smartstore.naver.com/brewingceremony';
const id = stableUuid('verified-roaster', website);
const evidence = [
  { url: 'https://www.koreacoffeeweek.com/104', finding: 'Brand statement: roasting and brewing coffee in Seongsu since 2019.' },
  { url: 'https://coffeemeup.kr/2314', finding: 'Green coffee supplier links the roaster name, official Instagram and exact Naver store.' },
];
const entity = {
  id, name: 'Brewing Ceremony', slug: 'brewing-ceremony', name_slug: 'brewing-ceremony',
  website_url: website, primary_location: 'Seongsu, Seoul, South Korea',
  contact: { socials: ['https://www.instagram.com/brewingceremony/'] },
};
const output = path.resolve('.state/naver/brewing-ceremony-index.json');
const apply = process.argv.includes('--apply');

async function main() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '') !== origin) throw Error('Unexpected catalog project');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw Error('Catalog credentials missing');
  const headers = { apikey: key, Authorization: 'Bearer ' + key };
  async function request(table, params, body) {
    const url = new URL('/rest/v1/' + table, origin);
    url.search = new URLSearchParams(params).toString();
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(30000),
      headers: { ...headers, ...(body ? { 'content-type': 'application/json', Prefer: 'return=representation' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw Error('Catalog request failed: HTTP ' + response.status + ' ' + (data.code || ''));
    return data;
  }
  const matches = await request('entities', {
    select: 'id,name,slug,name_slug,website_url,contact', limit: '1000',
    or: '(id.eq.' + id + ',website_url.ilike.*brewingceremony*,name.ilike.*brewing*ceremony*,name.ilike.*세레모니*,slug.eq.brewing-ceremony,contact->>socials.ilike.*brewingceremony*,contact->>instagram.ilike.*brewingceremony*)',
  });
  if (matches.length > 1 || matches.length === 1 && (matches[0].id !== id || matches[0].website_url !== website)) throw Error('Existing identity requires reconciliation');
  const report = { at: new Date().toISOString(), mode: apply ? 'apply' : 'preview', entity, evidence, before: matches, writes: [] };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  function save() { fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); }
  save();
  if (apply) {
    if (!matches.length) {
      report.pending = { table: 'entities', id }; save();
      report.writes.push({ table: 'entities', rows: await request('entities', { select: '*' }, entity) });
      delete report.pending; save();
    }
    const roles = await request('entity_roles', { entity_id: 'eq.' + id, role: 'eq.roaster', select: '*' });
    if (!roles.length) {
      report.pending = { table: 'entity_roles', id }; save();
      report.writes.push({ table: 'entity_roles', rows: await request('entity_roles', { select: '*' }, {
        entity_id: id, role: 'roaster', role_metadata: { verification: { checked_at: report.at, sources: evidence } },
      }) });
      delete report.pending; save();
    }
    report.after = {
      entities: await request('entities', { id: 'eq.' + id, select: '*' }),
      roles: await request('entity_roles', { entity_id: 'eq.' + id, role: 'eq.roaster', select: '*' }),
    };
    if (report.after.entities.length !== 1 || report.after.entities[0].website_url !== website || report.after.roles.length !== 1) throw Error('Catalog readback mismatch');
    report.status = 'verified'; save();
  }
  console.log(JSON.stringify({ mode: report.mode, entity_id: id, existing: matches.length, writes: report.writes.length, status: report.status || 'preview', report: output }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
