'use strict';
// Public factual directory ingestion: reviewed plan, immutable IDs, null-only writes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const SOURCE = 'my_coffee_explorer';
const now = () => new Date().toISOString();
const empty = x => x === null || x === undefined || x === '';
const clean = x => typeof x === 'string' ? x.normalize('NFKC').replace(/\s+/g, ' ').trim() : x;
const norm = x => (clean(x) || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const slug = x => norm(x).replace(/ /g, '-').slice(0, 110) || 'coffee';
const stable = x => JSON.stringify(x);
const hash = x => crypto.createHash('sha256').update(typeof x === 'string' ? x : stable(x)).digest('hex');
const compact = x => Object.fromEntries(Object.entries(x).filter(([, v]) => !empty(v)));
const STATES = Object.fromEntries('Alabama:AL|Alaska:AK|Arizona:AZ|Arkansas:AR|California:CA|Colorado:CO|Connecticut:CT|Delaware:DE|District of Columbia:DC|Florida:FL|Georgia:GA|Hawaii:HI|Idaho:ID|Illinois:IL|Indiana:IN|Iowa:IA|Kansas:KS|Kentucky:KY|Louisiana:LA|Maine:ME|Maryland:MD|Massachusetts:MA|Michigan:MI|Minnesota:MN|Mississippi:MS|Missouri:MO|Montana:MT|Nebraska:NE|Nevada:NV|New Hampshire:NH|New Jersey:NJ|New Mexico:NM|New York:NY|North Carolina:NC|North Dakota:ND|Ohio:OH|Oklahoma:OK|Oregon:OR|Pennsylvania:PA|Rhode Island:RI|South Carolina:SC|South Dakota:SD|Tennessee:TN|Texas:TX|Utah:UT|Vermont:VT|Virginia:VA|Washington:WA|West Virginia:WV|Wisconsin:WI|Wyoming:WY'.split('|').map(x=>x.split(':')).map(([k,v])=>[norm(k),v]));
const state = x => STATES[norm(x)] || (clean(x) || '').toUpperCase();
const country = x => ['us','usa','united states','united states of america'].includes(norm(x)) ? 'US' : (clean(x) || '').toUpperCase();
function write(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2), { mode: 0o600 }); fs.renameSync(file + '.tmp', file); }
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function ndjson(file) { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse); }
function official(value) {
  try {
    const u = new URL(value); if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (/(^|\.)(facebook\.com|instagram\.com|linktr\.ee|linktree\.com|fb\.me|fb\.com|m\.me|g\.page|goo\.gl|maps\.apple\.com|threads\.net|threads\.com|t\.co|youtu\.be|google\.com|maps\.app\.goo\.gl|yelp\.com|tripadvisor\.com|mycoffeeexplorer\.com|toasttab\.com|squareup\.com|tiktok\.com|youtube\.com|x\.com|twitter\.com|visiteurekasprings\.com|visitnatchez\.org)$/.test(host)) return null;
    if (/(^|\/)(terms[^/]*|legal[^/]*|privacy[^/]*|cookie[^/]*)(\/|$)/i.test(decodeURIComponent(u.pathname))) return null;
    u.hash = ''; for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(k)) u.searchParams.delete(k);
    return u.href;
  } catch { return null; }
}
function host(value) { try { return new URL(value).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, ''); } catch { return null; } }
function brand(value) { return norm(value).replace(/\b(coffee|coffees|co|company|roasting|roasters|roaster|roastery|cafe|llc|inc|the)\b/g, '').replace(/\s+/g, ' ').trim(); }
function related(a, b) { return norm(a) === norm(b) || (brand(a).length >= 4 && brand(a) === brand(b)); }
function hostRelated(a,b) { if(related(a,b))return true; const x=norm(String(a).split(/\s+[–—-]\s+/)[0]),y=norm(String(b).split(/\s+[–—-]\s+/)[0]);return (related(x,y)||x.replace(/ /g,'')===y.replace(/ /g,'')) && brand(x).length>=4; }
function addressNorm(x) { return norm(String(x||'').replace(/#/g,' unit ')).replace(/\b(street|avenue|road|boulevard|drive|lane|highway|suite|unit|north|south|east|west)\b/g, s => ({ street:'st', avenue:'ave', road:'rd', boulevard:'blvd', drive:'dr', lane:'ln', highway:'hwy', suite:'ste', unit:'ste', north:'n', south:'s', east:'e', west:'w' }[s])); }
function location(raw, context = {}) {
  let city = clean(raw.city || raw.addressLocality || context.city || context.name);
  let region = clean(raw.region || raw.stateAbbrev || raw.addressRegion || context.stateAbbrev || raw.state || context.state);
  let address = clean(raw.address1 || raw.address || raw.streetAddress) || null;
  let zip = raw.postal_code || raw.postalCode || (address?.match(/\b\d{5}(?:-\d{4})?\b(?=\s*(?:,?\s*(?:USA|US|United States))?$)/)?.[0]) || null;
  // A guide may cover neighboring states or a scenic route; use the physical address.
  const physical = address?.match(/^(.*),\s*([^,]+),\s*([A-Z]{2})(?:\s+(\d{5}(?:-\d{4})?))?(?:,?\s*(?:USA|US|United States))?\s*$/);
  if (physical) { address = physical[1].trim(); city = physical[2].trim(); region = physical[3]; zip = physical[4] || zip; }
  if (address && city) {
    const parts = address.split(',').map(s => s.trim());
    const cityIndex = parts.findIndex((p, i) => i > 0 && norm(p) === norm(city));
    if (cityIndex > 0) address = parts.slice(0, cityIndex).join(', ');
  }
  if (address && (!/^\d+[A-Za-z]?\b/.test(address) || /^(?:various|multiple|across|downtown)\b/i.test(address))) address = null;
  if (city && /(?:trail|scenic|route\s*\d|coffee tour|coffee guide)/i.test(city)) { city = null; if (!physical) region = null; }
  const lat = raw.lat ?? raw.latitude, lng = raw.lng ?? raw.longitude;
  const out = compact({ label: clean(raw.label) || 'cafe', address1: address, address2:clean(raw.address2), city, region: state(region), postal_code: clean(zip), country: country(raw.country || 'US') });
  if (!empty(lat) && !empty(lng) && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180 && !(Number(lat) === 0 && Number(lng) === 0)) { out.lat = Number(lat); out.lng = Number(lng); }
  return (address || city || 'lat' in out) ? out : null;
}
function samePlace(a, b) {
  if (!a || !b) return false;
  a = location(a); b = location(b); if(!a||!b)return false;
  if (a.country && b.country && country(a.country)!==country(b.country)) return false;
  if (a.region && b.region && state(a.region)!==state(b.region)) return false;
  if (a.city && b.city && norm(a.city)!==norm(b.city)) return false;
  if(a.address2 && b.address2 && addressNorm(a.address2)!==addressNorm(b.address2))return false;
  if (a.address1 && b.address1 && addressNorm(a.address1) === addressNorm(b.address1) && norm(a.city) && norm(a.city) === norm(b.city)) return true;
  if(a.address1 && b.address1) {
    if(a.address1.match(/^\d+[A-Za-z]?/)?.[0]!==b.address1.match(/^\d+[A-Za-z]?/)?.[0])return false;
    const unit = x => addressNorm(x).match(/(?:\bste\s*|#\s*)([a-z0-9]+)/)?.[1];
    if(unit(a.address1)&&unit(b.address1)&&unit(a.address1)!==unit(b.address1))return false;
    if(addressNorm(a.address1).replace(/\bste\s*[a-z0-9]+.*$/,'').trim()!==addressNorm(b.address1).replace(/\bste\s*[a-z0-9]+.*$/,'').trim())return false;
  }
  const values = [a.lat,a.lng,b.lat,b.lng];
  return values.every(x => !empty(x) && Number.isFinite(Number(x))) && Math.abs(Number(a.lat)-Number(b.lat)) < 0.0003 && Math.abs(Number(a.lng)-Number(b.lng)) < 0.0003;
}
function normalizeRecord(raw, kind) {
  // Collector emits explicit factual fields, tolerate raw and standardized forms.
  const name = clean(raw.name || raw.roaster?.name);
  const sourceId = raw.source_id || raw.sourceId || `${kind}:${raw.slug}`;
  const candidateSite = official(raw.website_url || raw.websiteUrl || raw.official_website);
  const site = official(Object.hasOwn(raw,'accepted_website') ? raw.accepted_website : candidateSite);
  const ctx = raw.city_context || raw.city || {};
  const locs = (raw.accepted_locations || raw.locations || (raw.location ? [raw.location] : kind === 'shop' ? [raw] : [])).map(l => location(l, typeof ctx === 'object' ? ctx : {city:ctx,stateAbbrev:raw.stateAbbrev})).filter(Boolean);
  return { kind, source_id: sourceId.startsWith(kind + ':') ? sourceId : `${kind}:${sourceId}`, name, slug: raw.slug, website_url: site, host: host(site||candidateSite), locations: locs, isRoaster: !raw.classification_conflict && (kind === 'roaster' || raw.isRoaster === true || raw.is_roaster === true), source_url: raw.source_url || raw.sourceUrl || raw.sourcePage || raw.source_profile || `https://mycoffeeexplorer.com/${kind === 'shop' ? 'shops' : 'roasters'}/${raw.slug}`, raw };
}
function dbClient() { const {createClient} = require('@supabase/supabase-js'); if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing database environment'); return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false,autoRefreshToken:false}}); }
async function query(promise, context) { const {data,error} = await promise; if(error) throw new Error(`${context}: ${error.message}`); return data; }
async function all(db, table, fields, orders=['id']) { const rows=[]; for(let i=0;;i+=1000) {let q=db.from(table).select(fields); for(const o of orders) q=q.order(o); const part=await query(q.range(i,i+999),table); rows.push(...part); if(part.length<1000) break;} return rows; }
async function snapshot(db) {
  const [entities,roles,locations,sourceIds] = await Promise.all([
    all(db,'entities','id,name,slug,name_slug,website_url,primary_location,google_place_id'),
    all(db,'entity_roles','entity_id,role',['entity_id','role']),
    all(db,'entity_locations','id,entity_id,label,address1,address2,city,region,postal_code,country,lat,lng,is_primary'),
    all(db,'entity_source_ids','id,entity_id,source,source_id,source_url')
  ]); return {at:now(),entities,roles,locations,sourceIds};
}
function indexSnapshot(s) {
  const byId=new Map(s.entities.map(e=>[e.id,{...e,roles:new Set(),locations:[]}])), byHost=new Map(), byName=new Map(), bySource=new Map(), byAddress=new Map(), byGeo=new Map();
  for(const r of s.roles) byId.get(r.entity_id)?.roles.add(r.role);
  for(const l of s.locations) byId.get(l.entity_id)?.locations.push(l);
  const add = e => {byId.set(e.id,e); const h=host(official(e.website_url)),n=norm(e.name); if(h){if(!byHost.has(h))byHost.set(h,[]); if(!byHost.get(h).some(x=>x.id===e.id))byHost.get(h).push(e);} if(n){if(!byName.has(n))byName.set(n,[]); if(!byName.get(n).some(x=>x.id===e.id))byName.get(n).push(e);} for(const loc of e.locations){const l=location(loc);if(l?.address1&&l.city){const k=addressNorm(l.address1)+'|'+norm(l.city);if(!byAddress.has(k))byAddress.set(k,[]);if(!byAddress.get(k).some(v=>v.id===e.id))byAddress.get(k).push(e);}if(l&&'lat' in l){const k=Math.floor(l.lat*1000)+':'+Math.floor(l.lng*1000);if(!byGeo.has(k))byGeo.set(k,[]);if(!byGeo.get(k).some(v=>v.id===e.id))byGeo.get(k).push(e);}} };
  for(const e of byId.values())add(e);
  for(const sId of s.sourceIds) if(sId.source===SOURCE)bySource.set(sId.source_id,sId.entity_id);
  return {byId,byHost,byName,bySource,byAddress,byGeo,add};
}
function resolve(r, ix) {
  const sid=ix.bySource.get(r.source_id); if(sid)return {entity:ix.byId.get(sid),reason:'source_id'};
  if(r.raw.placeId){const candidates=[...ix.byId.values()].filter(e=>e.google_place_id===r.raw.placeId);if(candidates.length===1&&hostRelated(candidates[0].name,r.name))return {entity:candidates[0],reason:'google_place_id_and_name'};if(candidates.length)return {conflict:candidates.map(e=>e.id),reason:'google_place_identity_requires_review'};}
  const hosts=r.host ? ix.byHost.get(r.host)||[] : [];
  const names=ix.byName.get(norm(r.name))||[];
  const addresses=r.locations.flatMap(l=>l.address1&&l.city?ix.byAddress.get(addressNorm(l.address1)+'|'+norm(l.city))||[]:[]);
  const geo=[];for(const l of r.locations)if('lat' in l)for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)geo.push(...(ix.byGeo.get((Math.floor(l.lat*1000)+x)+':'+(Math.floor(l.lng*1000)+y))||[]));
  const pool=[...new Map([...hosts,...names,...addresses,...geo].map(e=>[e.id,e])).values()];
  const atPlace=pool.filter(e=>hostRelated(e.name,r.name)&&e.locations.some(l=>r.locations.some(v=>samePlace(l,v))));
  if(atPlace.length===1)return {entity:atPlace[0],reason:'name_and_exact_location'};
  if(atPlace.length>1) { const roasters=atPlace.filter(e=>e.roles.has('roaster')); if(r.kind==='roaster'&&roasters.length===1)return {entity:roasters[0],reason:'roaster_at_exact_location'}; const cafes=atPlace.filter(e=>e.roles.has('cafe')&&!e.roles.has('roaster'));if(r.kind==='shop'&&cafes.length===1)return {entity:cafes[0],reason:'cafe_at_exact_location'}; return {conflict:atPlace.map(e=>e.id),reason:'duplicate_existing_location'}; }
  // Roaster entities are brand-level; cafe branches match only with location evidence.
  const brandHosts=hosts.filter(e=>e.roles.has('roaster')&&hostRelated(e.name,r.name));
  if(brandHosts.length===1)return {entity:brandHosts[0],reason:'roaster_brand_and_host'};
  if(r.kind==='roaster') {
    const hostRoasters=hosts.filter(e=>e.roles.has('roaster'));
    if(hostRoasters.length===1 && hostRelated(hostRoasters[0].name,r.name))return {entity:hostRoasters[0],reason:'unique_roaster_host'};
    if(hostRoasters.length===1 && !hostRelated(hostRoasters[0].name,r.name))return {conflict:hostRoasters.map(e=>e.id),reason:'host_name_disagreement'};
    const namedHosts=hosts.filter(e=>related(e.name,r.name));
    if(namedHosts.length===1 && r.locations.some(l=>namedHosts[0].locations.some(v=>norm(l.city)===norm(v.city))))return {entity:namedHosts[0],reason:'host_name_and_city'};
  }
  const locatedNames=names.filter(e=>e.locations.some(raw=>{const l=location(raw);return l&&r.locations.some(v=>norm(v.city)&&norm(v.city)===norm(l.city)&&(!v.region||!l.region||state(v.region)===state(l.region)));}));
  if(locatedNames.length===1 && r.kind==='roaster')return {entity:locatedNames[0],reason:'exact_name_and_city'};
  if(r.kind==='roaster' && names.length===1 && !names[0].website_url && brand(r.name).length>=5)return {entity:names[0],reason:'distinctive_exact_name_missing_site'};
  if(r.kind==='roaster' && (hostRoasterConflict(hosts,r)||names.some(e=>e.roles.has('roaster'))))return {conflict:pool.map(e=>e.id),reason:'unresolved_existing_roaster_identity'};
  return {reason:'new_identity'};
}
function hostRoasterConflict(hosts,r) { return hosts.filter(e=>e.roles.has('roaster')).length>1 && hosts.some(e=>related(e.name,r.name)); }
function planRecords(records,s,overrides={}) {
  const ix=indexSnapshot(s), actions=new Map(), conflicts=[], used=new Set(s.entities.flatMap(e=>[e.slug,e.name_slug]).filter(Boolean));
  for(const r of records) {
    if(!r.name || !r.source_id || /undefined/.test(r.source_id))throw new Error('Incomplete source identity');
    const override=overrides[r.source_id];
    if(override?.hold){conflicts.push({record:r,reason:override.evidence,entityIds:override.entityIds||[]});continue;}
    const match=override?{entity:ix.byId.get(override.entity_id),reason:'reviewed_identity: '+override.evidence}:resolve(r,ix);
    if(override&&!match.entity)throw new Error('Reviewed identity missing');
    if(match.conflict){conflicts.push({record:r,reason:match.reason,entityIds:match.conflict});continue;}
    let e=match.entity,a;
    if(!e) {
      let entitySlug=slug(r.name),i=2; while(used.has(entitySlug))entitySlug=`${slug(r.name).slice(0,100)}-${i++}`;used.add(entitySlug);
      e={id:crypto.randomUUID(),name:r.name,slug:entitySlug,name_slug:entitySlug,website_url:r.website_url,primary_location:null,roles:new Set(),locations:[],planned:true};ix.add(e);
    }
    if(!actions.has(e.id))actions.set(e.id,{entity_id:e.id,action:e.planned?'create':'enrich',entity:compact({id:e.id,name:e.name,slug:e.slug,name_slug:e.name_slug,website_url:e.website_url,primary_location:e.primary_location}),before:e.planned?null:{website_url:e.website_url,primary_location:e.primary_location},roles:[],newRoles:[],locations:[],sources:[],reasons:[],patch:{}});
    a=actions.get(e.id);
    const knownBrand=r.kind==='shop'&&[...(ix.byHost.get(r.host)||[]),...(ix.byName.get(norm(r.name))||[])].some(v=>v.id!==e.id&&v.roles.has('roaster')&&hostRelated(v.name,r.name));
    for(const role of (r.kind==='shop'?['cafe',...(r.isRoaster&&!knownBrand?['roaster']:[])]:r.isRoaster?['roaster']:['cafe'])) {
      if(!a.roles.includes(role))a.roles.push(role);
      if(!e.roles.has(role)){a.newRoles.push(role);e.roles.add(role);}
    }
    if(!e.website_url&&r.website_url){e.website_url=r.website_url;a.patch.website_url=r.website_url;ix.add(e);}
    if(!e.google_place_id&&r.raw.placeId&&/^ChI[A-Za-z0-9_-]+$/.test(r.raw.placeId)){a.patch.google_place_id=r.raw.placeId;e.google_place_id=r.raw.placeId;}
    for(const l of r.locations) if((l.address1||'lat' in l)&&!a.locations.some(v=>samePlace(v,l)||stable(v)===stable(l)))a.locations.push(l);
    for(const l of r.locations)if(!e.locations.some(v=>samePlace(v,l)||stable(v)===stable(l)))e.locations.push(l);
    ix.add(e);
    if(!e.primary_location && r.locations[0]){a.patch.primary_location=[r.locations[0].city,r.locations[0].region,r.locations[0].country].filter(Boolean).join(', ');e.primary_location=a.patch.primary_location;}
    a.sources.push({source:SOURCE,source_id:r.source_id,source_url:r.source_url,raw_data:r.raw});a.reasons.push({source_id:r.source_id,reason:match.reason});ix.bySource.set(r.source_id,e.id);
  }
  const output={version:1,source:SOURCE,plannedAt:now(),inputCounts:{records:records.length,roasters:records.filter(r=>r.kind==='roaster').length,shops:records.filter(r=>r.kind==='shop').length},snapshotCounts:{entities:s.entities.length,roles:s.roles.length,locations:s.locations.length},actions:[...actions.values()],conflicts};
  output.summary={entities:output.actions.length,create:output.actions.filter(a=>a.action==='create').length,enrich:output.actions.filter(a=>a.action==='enrich').length,newRoasterRoles:output.actions.filter(a=>a.newRoles.includes('roaster')).length,newCafeRoles:output.actions.filter(a=>a.newRoles.includes('cafe')).length,sources:output.actions.reduce((n,a)=>n+a.sources.length,0),conflicts:conflicts.length};output.planHash=hash(output);return output;
}
function checkPlan(p){const {planHash,...body}=p;if(hash(body)!==planHash)throw new Error('Plan hash mismatch');if(p.source!==SOURCE)throw new Error('Wrong source');}
async function applyAction(db,a,entry,save) {
  // Identity and ownership checks precede every mutation, including resume.
  const sources=await query(db.from('entity_source_ids').select('id,entity_id,source_id').eq('source',SOURCE).in('source_id',a.sources.map(s=>s.source_id)),'source check');
  if(sources.some(s=>s.entity_id!==a.entity_id))throw new Error('Source ID belongs to another entity');
  let e=await query(db.from('entities').select('id,name,slug,website_url,primary_location,google_place_id').eq('id',a.entity_id).maybeSingle(),'entity');
  if(!e) {
    if(a.action!=='create')throw new Error('Existing entity disappeared');
    e=await query(db.from('entities').insert({...a.entity,...a.patch}).select('id,name,slug,website_url,primary_location').single(),'create entity');
    entry.created=true;save();
  } else if(e.slug!==a.entity.slug || norm(e.name)!==norm(a.entity.name))throw new Error('Entity identity changed since planning');
  if(a.action==='enrich' && a.before?.website_url && host(e.website_url)!==host(a.before.website_url))throw new Error('Entity website changed since planning');
  for(const [key,value] of Object.entries(a.patch)) {
    if(empty(e[key])&&!empty(value)) {let q=db.from('entities').update({[key]:value}).eq('id',a.entity_id);q=e[key]===null?q.is(key,null):q.eq(key,e[key]);const changed=await query(q.select('id'),`null-only ${key}`);if(!changed.length)(entry.preservedConcurrentFields||=[]).push(key);}
    else if(!empty(value)&&stable(e[key])!==stable(value))(entry.preservedConcurrentFields||=[]).push(key);
  }
  const roles=await query(db.from('entity_roles').select('role').eq('entity_id',a.entity_id),'roles');
  const missingRoles=a.roles.filter(r=>!roles.some(v=>v.role===r));
  if(missingRoles.length)await query(db.from('entity_roles').upsert(missingRoles.map(role=>({entity_id:a.entity_id,role,role_metadata:{provenance:{public_directories:{[SOURCE]:{imported_at:now()}}}}})),{onConflict:'entity_id,role',ignoreDuplicates:true}),'roles insert');
  const locs=await query(db.from('entity_locations').select('id,label,address1,address2,city,region,postal_code,country,lat,lng,is_primary').eq('entity_id',a.entity_id),'locations');
  for(const l of a.locations) {
    const old=locs.find(v=>samePlace(v,l) || (!l.address1&&!v.address1&&norm(v.city)&&norm(v.city)===norm(l.city)&&norm(v.region)===norm(l.region)));
    if(old) {for(const [k,v] of Object.entries(l))if(empty(old[k])&&!empty(v)){let q=db.from('entity_locations').update({[k]:v}).eq('id',old.id);q=old[k]===null?q.is(k,null):q.eq(k,old[k]);await query(q,`location ${k}`);old[k]=v;}}
    else {const added=await query(db.from('entity_locations').insert({entity_id:a.entity_id,...l,is_primary:!locs.some(v=>v.is_primary)}).select('*').single(),'location insert');locs.push(added);}
  }
  const pending=a.sources.filter(s=>!sources.some(v=>v.source_id===s.source_id));
  if(pending.length)await query(db.from('entity_source_ids').insert(pending.map(s=>({...s,entity_id:a.entity_id,confidence:0.95,last_synced_at:now()}))),'source insert');
  entry.status='complete';entry.completedAt=now();save();
}
async function apply(db,p,file) {
  checkPlan(p);
  const lock=path.resolve('.state/my-coffee-explorer/apply.lock');fs.mkdirSync(path.dirname(lock),{recursive:true});const lockFd=fs.openSync(lock,'wx',0o600);fs.writeFileSync(lockFd,JSON.stringify({pid:process.pid,planHash:p.planHash,startedAt:now()}));
  try {
  const cp=fs.existsSync(file)?read(file):{planHash:p.planHash,startedAt:now(),entries:{}};if(cp.planHash!==p.planHash)throw new Error('Checkpoint mismatch');
  const save=()=>write(file,cp);let cursor=0,failed=false;
  async function worker(){while(cursor<p.actions.length&&!failed){const a=p.actions[cursor++];let e=cp.entries[a.entity_id];if(e?.status==='complete')continue;e=cp.entries[a.entity_id]={...e,status:'working',action:a.action};save();try{await applyAction(db,a,e,save);}catch(err){e.status='failed';e.error=err.message;failed=true;save();throw err;}const complete=Object.values(cp.entries).filter(e=>e.status==='complete').length;if(complete%25===0)console.log(JSON.stringify({complete,total:p.actions.length,at:now()}));}}
  const outcomes=await Promise.allSettled(Array.from({length:4},worker));const failure=outcomes.find(r=>r.status==='rejected');if(failure)throw failure.reason;cp.finishedAt=now();save();console.log(JSON.stringify({complete:Object.values(cp.entries).filter(e=>e.status==='complete').length,total:p.actions.length,conflicts:p.conflicts.length}));
  } finally {fs.closeSync(lockFd);fs.unlinkSync(lock);}
}
async function verify(db,p,file) {
  checkPlan(p);const s=await snapshot(db),ix=indexSnapshot(s),failures=[],targets=[];let verified=0;
  for(const a of p.actions){const e=ix.byId.get(a.entity_id);const missing=[];if(!e)missing.push('entity');else {
    for(const r of a.roles)if(!e.roles.has(r))missing.push('role:'+r);
    for(const [k,v]of Object.entries({...a.entity,...a.patch}))if(['website_url','primary_location'].includes(k)&&!empty(v)&&empty(e[k]))missing.push(k);
    for(const l of a.locations)if(!e.locations.some(v=>samePlace(v,l)||(!l.address1&&norm(v.city)===norm(l.city)&&norm(v.region)===norm(l.region))))missing.push('location:'+stable(l));
    for(const src of a.sources)if(ix.bySource.get(src.source_id)!==e.id)missing.push('source:'+src.source_id);
  }
  if(missing.length)failures.push({id:a.entity_id,name:a.entity.name,missing});else {verified++;if(e.roles.has('roaster')&&a.crawlWebsite&&official(e.website_url)===official(a.crawlWebsite)&&a.newRoles.includes('roaster'))targets.push({entity_id:e.id,website_url:e.website_url,reason:a.action==='create'?'new_roaster_entity':'new_roaster_role',source_ids:a.sources.map(s=>({source:s.source,source_id:s.source_id}))});}}
  const result={at:now(),planHash:p.planHash,verified,expected:p.actions.length,failures,unresolved:p.conflicts.length,counts:{entities:s.entities.length,roasters:s.roles.filter(r=>r.role==='roaster').length,cafes:s.roles.filter(r=>r.role==='cafe').length,sourceIds:s.sourceIds.filter(r=>r.source===SOURCE).length},crawlTargets:targets.length};write(file,result);
  fs.writeFileSync(file.replace(/\.json$/,'.targets.ndjson'),targets.map(t=>JSON.stringify(t)).join('\n')+'\n',{mode:0o600});console.log(JSON.stringify({...result,failures:failures.length}));if(failures.length)throw new Error('Verification failed');
}
function selfTest(){const assert=require('node:assert/strict');assert(related('Owl Coffee Roasters','Owl Coffee Roasters'));assert(!related('Owl Coffee','Owl Cafe'));assert(samePlace({address1:'12 Main Street',city:'New York'},{address1:'12 Main St',city:'New York'}));assert(!samePlace({address1:'12 Main Street',city:'New York'},{address1:'12 Main St',city:'Portland'}));assert.equal(official('https://facebook.com/coffee'),null);const s={entities:[{id:'1',name:'Sample Coffee',website_url:'https://sample.com'}],roles:[{entity_id:'1',role:'cafe'}],locations:[{entity_id:'1',address1:'1 A St',city:'Town'}],sourceIds:[]};const ix=indexSnapshot(s);assert(!resolve({source_id:'shop:s',name:'Sample Coffee',host:'sample.com',kind:'shop',locations:[{address1:'2 B St',city:'Town'}]},ix).entity);assert.equal(resolve({source_id:'shop:s',name:'Sample Coffee',host:'sample.com',kind:'shop',locations:[{address1:'1 A Street',city:'Town'}]},ix).entity.id,'1');console.log('Matching, branch isolation, address, and website tests passed');}
async function main(){const [command,base=__dirname]=process.argv.slice(2);if(command==='self-test')return selfTest();const db=dbClient();if(command==='snapshot'){const s=await snapshot(db);write(path.join(base,'snapshot.json'),s);console.log(JSON.stringify({entities:s.entities.length,roles:s.roles.length,locations:s.locations.length,sourceIds:s.sourceIds.length}));return;}if(command==='plan'){const s=fs.existsSync(path.join(base,'snapshot.json'))?read(path.join(base,'snapshot.json')):await snapshot(db);const rs=ndjson(path.join(base,'roasters.ndjson')).map(r=>normalizeRecord(r,'roaster'));const ss=ndjson(path.join(base,'shops.ndjson')).map(r=>normalizeRecord(r,'shop'));const p=planRecords([...rs,...ss],s);write(path.join(base,'plan.json'),p);console.log(JSON.stringify(p.summary));return;}const p=read(path.join(base,'plan.json'));if(command==='apply')return apply(db,p,path.join(base,'checkpoint.json'));if(command==='verify')return verify(db,p,path.join(base,'verification.json'));throw new Error('Expected self-test snapshot plan apply verify');}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={normalizeRecord,location,samePlace,related,official,resolve,indexSnapshot,planRecords,checkPlan};
