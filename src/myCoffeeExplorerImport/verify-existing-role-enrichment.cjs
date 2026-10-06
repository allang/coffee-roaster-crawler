'use strict';
// Targeted read-back avoids scanning unrelated large location tables.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {checkPlan}=require('./import.cjs'),{DB_ORIGIN}=require('./product-only-crawl.cjs'),{installLegalGuard}=require('./legal-guard.cjs');
async function q(query){const {data,error}=await query;if(error)throw error;return data;}
async function count(query){const {count,error}=await query;if(error)throw error;assert(Number.isSafeInteger(count));return count;}
async function main(){
 const base=path.resolve(process.argv[2]),dir=path.join(base,'existing-roaster-role-enrichment'),plan=JSON.parse(fs.readFileSync(path.join(dir,'plan.json'))),before=JSON.parse(fs.readFileSync(path.join(base,'continuation-3/snapshot.json')));checkPlan(plan);assert.equal(plan.actions.length,2);assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin,DB_ORIGIN);
 const guard=installLegalGuard({internalDataOrigin:DB_ORIGIN});try{process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';const db=require('/Users/allan/.openclaw/workspace/coffee-roaster-crawler/src/supabase.js').getSupabase(),targets=[],preservation=[];
 for(const a of plan.actions){
  const [e,roles,locations,sources]=await Promise.all([q(db.from('entities').select('*').eq('id',a.entity_id).single()),q(db.from('entity_roles').select('*').eq('entity_id',a.entity_id)),q(db.from('entity_locations').select('*').eq('entity_id',a.entity_id)),q(db.from('entity_source_ids').select('*').eq('entity_id',a.entity_id))]);
  const original=before.entities.find(e=>e.id===a.entity_id);assert(original);for(const [k,v]of Object.entries(original))assert.deepEqual(e[k],k==='website_url'?a.patch.website_url:v,'Entity field changed: '+k);
  for(const r of before.roles.filter(r=>r.entity_id===e.id))assert(roles.some(x=>x.role===r.role));assert(roles.some(r=>r.role==='roaster'));
  for(const l of before.locations.filter(l=>l.entity_id===e.id)){const now=locations.find(x=>x.id===l.id);assert(now);for(const [k,v]of Object.entries(l))assert.deepEqual(now[k],v,'Location changed: '+k);}
  for(const s of before.sourceIds.filter(s=>s.entity_id===e.id)){const now=sources.find(x=>x.id===s.id);assert(now);for(const [k,v]of Object.entries(s))assert.deepEqual(now[k],v,'Existing source changed: '+k);}
  for(const s of a.sources){const now=sources.find(x=>x.source===s.source&&x.source_id===s.source_id);assert(now);assert.equal(now.entity_id,e.id);for(const [k,v]of Object.entries(s))assert.deepEqual(now[k],v,'New source mismatch: '+k);}
  targets.push({entity_id:e.id,website_url:e.website_url,reason:'new_roaster_role',source_ids:a.sources.map(s=>({source:s.source,source_id:s.source_id}))});preservation.push({entity_id:e.id,name:e.name,website_url:e.website_url,roles:roles.map(r=>r.role),priorEntityFieldsPreservedExceptNullWebsite:true,priorRolesPreserved:true,priorLocationsAndSourcesPreserved:true});
 }
 const counts={entities:await count(db.from('entities').select('id',{head:true,count:'exact'})),roasters:await count(db.from('entity_roles').select('entity_id',{head:true,count:'exact'}).eq('role','roaster')),cafes:await count(db.from('entity_roles').select('entity_id',{head:true,count:'exact'}).eq('role','cafe')),sourceIds:await count(db.from('entity_source_ids').select('id',{head:true,count:'exact'}).eq('source','my_coffee_explorer'))};
 const result={at:new Date().toISOString(),planHash:plan.planHash,verified:targets.length,expected:plan.actions.length,failures:[],unresolved:0,counts,crawlTargets:targets.length,method:'Targeted exact entity/source/role read-back, full prior field/role/location/source preservation, independent exact table counts.',preservation};
 fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});fs.writeFileSync(path.join(dir,'verification.targets.ndjson'),targets.map(JSON.stringify).join('\n')+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result));
 }finally{guard.uninstall();}
}
main().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
