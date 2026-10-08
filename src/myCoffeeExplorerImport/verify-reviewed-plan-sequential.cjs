'use strict';
// Bounded read-only verification. Never scans global entity/location payloads.
// CLI: node verify-reviewed-plan.cjs BASE PLAN-DIRECTORY [BEFORE-SNAPSHOT.json]
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{isDeepStrictEqual:equal}=require('node:util');
const {checkPlan,samePlace}=require('./import.cjs');
const {DB_ORIGIN}=require('./product-only-crawl.cjs');
const {installLegalGuard}=require('./legal-guard.cjs');
const SOURCE='my_coffee_explorer',MAX_ACTIONS=1000,MAX_SOURCES=10000,BATCH=25,PAGE=200,MAX_ROWS_PER_BATCH=5000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLES=new Set(['entities','entity_roles','entity_locations','entity_source_ids']);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const empty=x=>x===undefined||x===null||x==='';
const sourceKey=s=>s.source+'\0'+s.source_id;
const norm=x=>String(x||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const locationMatch=(actual,planned)=>samePlace(actual,planned)||(!actual.address1&&!planned.address1&&norm(actual.city)&&norm(actual.city)===norm(planned.city)&&norm(actual.region)===norm(planned.region)&&norm(actual.country||'US')===norm(planned.country||'US'));
function must(ok,code){if(!ok)throw Object.assign(new Error(code),{code});}
function pinnedOrigin(env){
 const u=new URL(env.NEXT_PUBLIC_SUPABASE_URL||'https://invalid.invalid');
 must(u.href===DB_ORIGIN+'/'&&!u.username&&!u.password,'runtime_database_mismatch');
 return DB_ORIGIN;
}
// Defense in depth: this helper exposes no mutation, RPC, auth or storage API.
function readOnlyClient(db){
 function query(q){return new Proxy(q,{get(o,k){if(k==='then')return o.then.bind(o);if(!['select','eq','in','order','range'].includes(k))throw Error('verification_read_only');return(...args)=>query(o[k](...args));}});}
 return{from(table){must(TABLES.has(table),'verification_table_out_of_scope');return query(db.from(table));}};
}
function validatePlan(plan,before){
 checkPlan(plan);must(Array.isArray(plan.actions)&&plan.actions.length>0&&plan.actions.length<=MAX_ACTIONS,'verification_action_bounds');
 if(before)must(['entities','roles','locations','sourceIds'].every(k=>Array.isArray(before[k])),'invalid_before_snapshot');
 const ids=new Set(),sources=new Set();let n=0;
 for(const a of plan.actions){
  must(UUID.test(a.entity_id||'')&&!ids.has(a.entity_id)&&a.entity?.id===a.entity_id,'verification_plan_entity');ids.add(a.entity_id);
  must(['create','enrich'].includes(a.action)&&Array.isArray(a.roles)&&Array.isArray(a.newRoles)&&Array.isArray(a.locations)&&Array.isArray(a.sources)&&a.sources.length>0,'verification_plan_shape');
  for(const role of a.newRoles){must(a.roles.includes(role),'new_role_missing_from_planned_roles');must(!before?.roles.some(r=>r.entity_id===a.entity_id&&r.role===role),'new_role_already_in_before');}
  for(const s of a.sources){must(s.source===SOURCE&&typeof s.source_id==='string'&&!!s.source_id&&!sources.has(sourceKey(s))&&s.raw_data&&typeof s.raw_data==='object','verification_plan_source');sources.add(sourceKey(s));n++;}
  if(a.action==='enrich'){
   const original=before?.entities.find(e=>e.id===a.entity_id);must(original,'before_snapshot_required_for_existing_entity');
   for(const [key,value]of Object.entries(a.patch||{}))must(empty(original[key])||equal(original[key],value),'planned_non_null_overwrite');
  }
 }
 must(n<=MAX_SOURCES,'verification_source_bounds');
}
async function targetedRows(db,table,column,values,source){
 const out=[];
 for(let start=0;start<values.length;start+=BATCH){
  const batch=values.slice(start,start+BATCH),seen=new Set();let expected=null,offset=0;
  do{
   let q=db.from(table).select('*',{count:'exact'}).in(column,batch);
   if(source)q=q.eq('source',source);
   q=table==='entity_roles'?q.order('entity_id').order('role'):q.order('id');
   const {data,error,count}=await q.range(offset,offset+PAGE-1);if(error)throw error;
   must(Array.isArray(data)&&Number.isSafeInteger(count)&&count>=0&&count<=MAX_ROWS_PER_BATCH,'target_read_count_or_bound');
   if(expected===null)expected=count;must(count===expected,'target_changed_during_pagination');
   must(data.length===Math.min(PAGE,expected-offset),'target_read_truncated');
   for(const row of data){
    must(batch.includes(row[column])&&(!source||row.source===source),'target_read_out_of_scope');
    const id=table==='entity_roles'?row.entity_id+'\0'+row.role:row.id;
    must(id&&!seen.has(id),'target_read_duplicate');seen.add(id);out.push(row);
   }
   offset+=data.length;
  }while(offset<expected);
 }
 return out;
}
async function exactCount(q){const {count,error}=await q;if(error)throw error;must(Number.isSafeInteger(count)&&count>=0,'global_head_count_missing');return count;}
function fieldsMatch(actual,expected,missing,label){
 for(const [k,v]of Object.entries(expected))if(!equal(actual?.[k],v))missing.push(label+':'+k);
}
function verifyAction(a,data,before){
 const missing=[],entities=data.entities.filter(e=>e.id===a.entity_id),e=entities[0];
 if(entities.length!==1)return{missing:['entity_count:'+entities.length]};
 const roles=data.roles.filter(r=>r.entity_id===a.entity_id),locations=data.locations.filter(l=>l.entity_id===a.entity_id),sources=data.sources.filter(s=>s.entity_id===a.entity_id);
 const original=before?.entities.find(x=>x.id===a.entity_id),priorRoles=before?.roles.filter(x=>x.entity_id===a.entity_id)||[],priorLocations=before?.locations.filter(x=>x.entity_id===a.entity_id)||[],priorSources=before?.sourceIds.filter(x=>x.entity_id===a.entity_id)||[];
 fieldsMatch(e,{...a.entity,...a.patch},missing,'planned_entity');
 if(a.action==='create'&&original)missing.push('created_entity_already_in_before');
 if(a.action==='enrich'){
  if(!original)missing.push('missing_before_entity');
  else fieldsMatch(e,{...original,...a.patch},missing,'preserved_entity');
  // The explicit plan precondition fields are also checked, except planned edits.
  fieldsMatch(e,{...a.before,...a.patch},missing,'before_entity');
 }
 const expectedRoles=new Set([...a.roles,...priorRoles.map(r=>r.role)]),actualRoles=new Set(roles.map(r=>r.role));
 for(const role of expectedRoles)if(!actualRoles.has(role))missing.push('role:'+role);
 for(const role of actualRoles)if(!expectedRoles.has(role))missing.push('unexpected_role:'+role);
 for(const r of priorRoles){const now=roles.find(x=>x.role===r.role);fieldsMatch(now,r,missing,'preserved_role:'+r.role);}
 const accountedLocations=new Set();
 for(const old of priorLocations){
  const now=locations.find(l=>l.id===old.id);if(!now){missing.push('preserved_location_missing:'+old.id);continue;}
  const expected={...old};for(const planned of a.locations)if(locationMatch(old,planned))for(const [k,v]of Object.entries(planned))if(empty(old[k])&&!empty(v))expected[k]=v;
  fieldsMatch(now,expected,missing,'preserved_location:'+old.id);accountedLocations.add(now.id);
 }
 for(let index=0;index<a.locations.length;index++){
  const planned=a.locations[index],candidates=locations.filter(l=>locationMatch(l,planned));
  if(candidates.length!==1){missing.push('planned_location_count:'+index+':'+candidates.length);continue;}
  const now=candidates[0],old=priorLocations.find(l=>l.id===now.id),expected={};
  for(const [k,v]of Object.entries(planned))expected[k]=old&&!empty(old[k])?old[k]:v;
  fieldsMatch(now,expected,missing,'planned_location:'+index);accountedLocations.add(now.id);
 }
 for(const l of locations)if(!accountedLocations.has(l.id))missing.push('unexpected_location:'+l.id);
 for(const old of priorSources){const now=sources.find(x=>x.id===old.id);if(!now)missing.push('preserved_source_missing:'+old.id);else fieldsMatch(now,old,missing,'preserved_source:'+old.id);}
 const allowedSources=new Set([...priorSources,...a.sources].map(sourceKey));
 for(const s of sources)if(!allowedSources.has(sourceKey(s)))missing.push('unexpected_source:'+s.source+':'+s.source_id);
 for(const source of a.sources){
  const found=data.sourceOwners.filter(s=>sourceKey(s)===sourceKey(source));
  if(found.length!==1){missing.push('source_count:'+source.source_id+':'+found.length);continue;}
  if(found[0].entity_id!==a.entity_id)missing.push('source_owner:'+source.source_id);
  fieldsMatch(found[0],source,missing,'source_payload:'+source.source_id);
  const owned=sources.filter(s=>sourceKey(s)===sourceKey(source));
  if(owned.length!==1)missing.push('entity_source_count:'+source.source_id);else fieldsMatch(owned[0],{...source,entity_id:a.entity_id},missing,'entity_source_payload:'+source.source_id);
 }
 if(a.newRoles.includes('roaster')&&a.crawlWebsite&&e.website_url!==a.crawlWebsite)missing.push('exact_crawl_website');
 const preservation={entity_id:e.id,name:e.name,beforeSnapshotCompared:a.action==='enrich',entityFieldsChecked:Object.keys(a.action==='enrich'?{...original,...a.entity,...a.before,...a.patch}:{...a.entity,...a.patch}),priorRolesChecked:priorRoles.length,priorLocationsChecked:priorLocations.length,priorSourcesChecked:priorSources.length,plannedSourcesChecked:a.sources.length};
 const target=!missing.length&&actualRoles.has('roaster')&&a.newRoles.includes('roaster')&&a.crawlWebsite&&e.website_url===a.crawlWebsite?{entity_id:e.id,website_url:e.website_url,reason:a.action==='create'?'new_roaster_entity':'new_roaster_role',source_ids:a.sources.map(s=>({source:s.source,source_id:s.source_id}))}:null;
 return{missing,preservation,target};
}
async function verify(dbInput,plan,before){
 validatePlan(plan,before);const db=readOnlyClient(dbInput),ids=plan.actions.map(a=>a.entity_id),sourceIds=plan.actions.flatMap(a=>a.sources.map(s=>s.source_id));
 // Five bounded target reads, never an unrestricted payload-table scan.
 const data={};
 data.entities=await targetedRows(db,'entities','id',ids);
 data.roles=await targetedRows(db,'entity_roles','entity_id',ids);
 data.locations=await targetedRows(db,'entity_locations','entity_id',ids);
 data.sources=await targetedRows(db,'entity_source_ids','entity_id',ids);
 data.sourceOwners=await targetedRows(db,'entity_source_ids','source_id',sourceIds,SOURCE);
 const failures=[],targets=[],preservation=[];let verified=0;
 for(const a of plan.actions){const checked=verifyAction(a,data,before);if(checked.missing.length)failures.push({id:a.entity_id,name:a.entity.name,missing:checked.missing});else{verified++;preservation.push(checked.preservation);if(checked.target)targets.push(checked.target);}}
 const entities=await exactCount(db.from('entities').select('id',{head:true,count:'exact'}));
 const roasters=await exactCount(db.from('entity_roles').select('entity_id',{head:true,count:'exact'}).eq('role','roaster'));
 const cafes=await exactCount(db.from('entity_roles').select('entity_id',{head:true,count:'exact'}).eq('role','cafe'));
 const sourceCount=await exactCount(db.from('entity_source_ids').select('id',{head:true,count:'exact'}).eq('source',SOURCE));
 const targetBody=targets.map(JSON.stringify).join('\n')+(targets.length?'\n':'');
 const result={at:new Date().toISOString(),planHash:plan.planHash,verified,expected:plan.actions.length,failures,unresolved:plan.conflicts?.length||0,counts:{entities,roasters,cafes,sourceIds:sourceCount},crawlTargets:targets.length,targetsSha256:sha(targetBody),method:'Exact planned IDs and source-key read-back; raw source payload equality; before-snapshot entity/role/location/source preservation; global counts use HEAD only.',readOnly:true,targetedReadBounds:{maxActions:MAX_ACTIONS,idsPerBatch:BATCH,pageSize:PAGE,maxRowsPerBatch:MAX_ROWS_PER_BATCH},preservation};
 return{result,targets,targetBody};
}
function writeOutputs(dir,checked){
 const vf=path.join(dir,'verification.json'),tf=path.join(dir,'verification.targets.ndjson');
 must(!fs.existsSync(vf)&&!fs.existsSync(tf),'preserve_existing_verification');
 fs.writeFileSync(tf,checked.targetBody,{flag:'wx',mode:0o600});
 fs.writeFileSync(vf,JSON.stringify(checked.result,null,2)+'\n',{flag:'wx',mode:0o600});
}
async function main(argv=process.argv.slice(2)){
 const [baseArg,planDirectory,beforeFile,...extra]=argv;
 must(baseArg&&planDirectory&&!extra.length&&/^[a-z0-9-]+$/.test(planDirectory),'usage_BASE_PLAN_DIRECTORY_OPTIONAL_BEFORE_SNAPSHOT');
 const base=fs.realpathSync(baseArg),dir=fs.realpathSync(path.join(base,planDirectory));must(dir.startsWith(base+path.sep),'plan_directory_outside_base');
 const planBytes=fs.readFileSync(path.join(dir,'plan.json')),plan=JSON.parse(planBytes);let before,beforeBytes;
 if(beforeFile){const file=fs.realpathSync(path.resolve(base,beforeFile));must(file.startsWith(base+path.sep),'before_snapshot_outside_base');beforeBytes=fs.readFileSync(file);before=JSON.parse(beforeBytes);}
 validatePlan(plan,before);pinnedOrigin(process.env);
 must(!fs.existsSync(path.join(dir,'verification.json'))&&!fs.existsSync(path.join(dir,'verification.targets.ndjson')),'preserve_existing_verification');
 const guard=installLegalGuard({internalDataOrigin:DB_ORIGIN});
 try{
  process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';
  const db=require('/Users/allan/.openclaw/workspace/coffee-roaster-crawler/src/supabase.js').getSupabase();
  const checked=await verify(db,plan,before);
  checked.result.inputReceipts={planSha256:sha(planBytes),beforeSnapshotSha256:beforeBytes?sha(beforeBytes):null,beforeSnapshotAt:before?.at||null};
  must(fs.readFileSync(path.join(dir,'plan.json')).equals(planBytes),'plan_changed_during_verification');
  writeOutputs(dir,checked);console.log(JSON.stringify(checked.result));if(checked.result.failures.length)process.exitCode=1;
 }finally{guard.uninstall();}
}
if(require.main===module)main().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
module.exports={pinnedOrigin,readOnlyClient,validatePlan,targetedRows,verifyAction,verify,writeOutputs,MAX_ACTIONS,BATCH,PAGE};

