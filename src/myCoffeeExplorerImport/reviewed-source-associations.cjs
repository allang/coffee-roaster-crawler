'use strict';
// Reusable, reviewed, source-only adapter over the previously tested fixed readers.
// One atomic INSERT at most; no entity/role/location changes, upsert, retry or resume.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT='/Users/allan/.openclaw/workspace/coffee-roaster-crawler';
const STATE=ROOT+'/.state/my-coffee-explorer/2026-09-26';
const BASE=__dirname===ROOT+'/src/myCoffeeExplorerImport'?STATE:__dirname;
const ORIGIN='https://gtlipifdfyugiwpxvuse.supabase.co';
const PINNED_CODE={
  'preflight-batch8b-paced-six.cjs':'ac4f66448d244323574f90a68851c0132eb78d73056c7607a9b287630c545a3d',
  'profile-five-source-preflight.cjs':'cb609af123d55af22fc5734d2445c724864721e2c0965e346fd70dd923ba8da6',
  'apply-profile-five-sources.cjs':'c959d69a2f93acd599f3aedddcffa33ecc10aee577e90baa6785d883831a30af',
  'snapshot-sequential-v3.cjs':'9bff32ee4385d40792431d1b1f8c1822e2f801db7497064d5f197ba7ccd05daa'
};
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x);
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const same=(a,b)=>stable(a)===stable(b),unique=a=>[...new Set(a)].sort();
function must(v,code){if(!v)throw Object.assign(Error(code),{code});}
function pin(file,digest,base=BASE){must(typeof file==='string'&&!path.isAbsolute(file)&&!file.split('/').includes('..'),'pin_path');const root=fs.realpathSync(base),p=fs.realpathSync(path.join(root,file));must(p.startsWith(root+path.sep),'pin_outside_root');const raw=fs.readFileSync(p);must(sha(raw)===digest,'pin_changed:'+file);return raw;}
function dependencies(){for(const[f,h]of Object.entries(PINNED_CODE))pin(f,h,__dirname);return{pre:require('./profile-five-source-preflight.cjs'),core:require('./apply-profile-five-sources.cjs'),snapshot:require('./snapshot-sequential-v3.cjs')};}
function validatePlan(p){
 must(p.version===1&&p.scope==='reviewed_existing_entity_source_associations'&&p.database_origin===ORIGIN,'plan_scope');
 must(/^[a-z][a-z0-9-]{2,60}$/.test(p.tag)&&Array.isArray(p.actions)&&p.actions.length>0&&p.actions.length<=20,'plan_bounds');
 must(Array.isArray(p.owners)&&p.owners.length>0&&p.owners.length<=30&&p.owners.every(uuid)&&same(p.owners,unique(p.owners)),'owner_scope');
 must(p.snapshot&&/^[a-f0-9]{64}$/.test(p.snapshot.sha256)&&p.snapshot.file.endsWith('/snapshot.json'),'snapshot_pin');
 const ids=[],keys=[];
 for(const a of p.actions){const r=a.source_insert;
  must(a.decision==='map_existing_provenance_only'&&p.owners.includes(a.entity_id)&&typeof a.reason==='string'&&a.reason.length>=20,'action_review');
  must(r&&same(Object.keys(r).sort(),['confidence','entity_id','id','raw_data','source','source_id','source_url']),'source_fields');
  must(uuid(r.id)&&r.entity_id===a.entity_id&&r.source==='my_coffee_explorer'&&r.confidence===0.95,'source_identity');
  must(/^(?:shop|roaster):[a-z0-9][a-z0-9-]*$/.test(r.source_id),'directory_key');
  const [kind,slug]=r.source_id.split(':');must(r.source_url===`https://mycoffeeexplorer.com/${kind==='shop'?'shops':'roasters'}/${slug}`,'directory_url');
  must(r.raw_data?.association_scope==='business_profile_provenance_only'&&r.raw_data.asserts_own_roasting===false,'provenance_only');
  must(a.evidence?.file&&/^[a-f0-9]{64}$/.test(a.evidence.sha256)&&/^\/conflicts\/\d+\/record$/.test(a.evidence.pointer),'evidence_binding');
  ids.push(r.id);keys.push(r.source_id);
 }
 must(unique(ids).length===ids.length&&unique(keys).length===keys.length,'duplicate_sources');
 must(p.probes&&same(Object.keys(p.probes).sort(),['addresses','names','placeIds','slugs','websites']),'probe_keys');
 for(const key of ['names','slugs','websites','addresses','placeIds'])must(Array.isArray(p.probes[key])&&p.probes[key].length<=150&&p.probes[key].every(v=>typeof v==='string'&&v.length>0&&v.length<1000),'probe_scope');
 must(p.probes.names.length&&p.probes.slugs.length&&p.probes.addresses.length&&p.probes.websites.length,'required_identity_probes');
}
function validateBaseline(baseline,actions){for(const v of Object.values(baseline))must(v.length<=100,'baseline_rows');must(baseline.ownerSources.length+actions.length<=100,'resulting_source_rows');}
function loadBundle(file,digest,base=BASE){
 const d=dependencies(),plan=JSON.parse(pin(file,digest,base));validatePlan(plan);
 const constraintEvidence={file:'production-unique-index-verification-0942.json',sha256:'07b9e1aa9ba9d87d99aa700bf2cf88738765ff7c63edb5777a249901b5fd16b2'};
 const constraints=JSON.parse(pin(constraintEvidence.file,constraintEvidence.sha256,base));
 must(constraints.database_project==='gtlipifdfyugiwpxvuse'&&constraints.results.some(r=>r.table==='public.entity_source_ids'&&r.name==='entity_source_ids_source_source_id_key'&&r.unique===true&&r.valid===true&&r.ready===true&&r.definition==='CREATE UNIQUE INDEX entity_source_ids_source_source_id_key ON public.entity_source_ids USING btree (source, source_id)'),'source_unique_evidence');
 const raw=pin(plan.snapshot.file,plan.snapshot.sha256,base),snapshot=d.snapshot.loadCompleteSnapshot(path.dirname(path.join(base,plan.snapshot.file)));must(same(JSON.parse(raw),snapshot),'snapshot_content');
 for(const a of plan.actions){const r=JSON.parse(pin(a.evidence.file,a.evidence.sha256,base));let source=r;for(const k of a.evidence.pointer.split('/').slice(1))source=source[k];
  must(source?.source_id===a.source_insert.source_id&&source.source_url===a.source_insert.source_url&&same(source.raw,a.source_insert.raw_data.original_record),'literal_source_binding');
 }
 const baseline={entities:snapshot.entities.filter(e=>plan.owners.includes(e.id)),roles:snapshot.roles.filter(e=>plan.owners.includes(e.entity_id)),locations:snapshot.locations.filter(e=>plan.owners.includes(e.entity_id)),ownerSources:snapshot.sourceIds.filter(e=>plan.owners.includes(e.entity_id))};
 must(baseline.entities.length===plan.owners.length,'snapshot_owner_missing');
 must(!snapshot.canonicalLinks.some(e=>plan.owners.includes(e.entity_id)||plan.owners.includes(e.attribute_value)),'canonical_review_required');
 for(const a of plan.actions)must(!snapshot.sourceIds.some(s=>s.id===a.source_insert.id||s.source==='my_coffee_explorer'&&s.source_id===a.source_insert.source_id),'source_occupied');
 const sourceKeys=[...baseline.ownerSources.map(s=>({source:s.source,source_id:s.source_id})),...plan.actions.map(a=>({source:'my_coffee_explorer',source_id:a.source_insert.source_id}))];
 const scope={...plan.probes,owners:plan.owners,baseline,sourceKeys};
 // Probe result sets are projected against this fresh snapshot; no unreviewed owner may be admitted.
 validateBaseline(baseline,plan.actions);
 return{plan,planSha:digest,planFile:file,scope,pre:d.pre,core:d.core,constraintEvidence,helperSha:sha(fs.readFileSync(__filename))};
}
async function inspectBefore(client,b){const state={};for(const kind of b.pre.KINDS){const rows=await client.request(kind);if(rows.length)must((await client.request(kind,rows.length)).length===0,'nonempty_continuation:'+kind);b.pre.validate(kind,rows,b.scope,state);state[kind]=rows;}return state;}
function previewValid(p,b,at=Date.now()){
 must(p?.status==='preview_complete'&&p.plan_sha256===b.planSha&&p.helper_sha256===b.helperSha&&p.writes===0,'preview_binding');
 const age=at-Date.parse(p.at);must(Number.isFinite(age)&&age>=0&&age<600000,'preview_expired');
 must(same(Object.keys(p.before||{}).sort(),b.pre.KINDS.slice().sort()),'preview_groups');
 for(const kind of b.pre.KINDS)b.pre.validate(kind,p.before[kind],b.scope,p.before);
}
function verifyInserted(rows,wanted){must(Array.isArray(rows)&&rows.length===wanted.length&&unique(rows.map(r=>r.id)).length===wanted.length,'insert_count');
 for(const w of wanted){const r=rows.find(x=>x.id===w.id);must(r&&same(Object.keys(r).sort(),[...Object.keys(w),'created_at'].sort()),'insert_schema');const got={...r};delete got.created_at;
  must(Number.isFinite(Date.parse(r.created_at))&&Date.parse(r.last_synced_at)===Date.parse(w.last_synced_at),'insert_timestamp');got.last_synced_at=w.last_synced_at;must(same(got,w),'insert_content');}return rows;}
async function execute({bundle:b,client,mode='preview',preview,event=()=>{},now=Date.now,authorizeWrite=()=>{}}){
 must(['preview','apply'].includes(mode),'mode');if(mode==='apply')previewValid(preview,b,now());
 const before=await inspectBefore(client,b);event({event:'before_verified',before});
 if(mode==='preview')return{at:new Date(now()).toISOString(),status:'preview_complete',plan_sha256:b.planSha,helper_sha256:b.helperSha,before,requests:client.requests,writes:0};
 must(same(before,preview.before),'preview_context_changed');previewValid(preview,b,now());b.before=before;authorizeWrite(now());
 const at=new Date(now()).toISOString(),wanted=b.core.descriptor('insertSources',b,0,at).body;
 const inserted=verifyInserted(await client.request('insertSources',0,at),wanted);event({event:'post_verified',inserted});
 const after=await b.core.inspect(client,b,inserted);event({event:'preservation_verified',after});
 return{at:new Date(now()).toISOString(),status:'complete',plan_sha256:b.planSha,helper_sha256:b.helperSha,before,inserted,after,requests:client.requests,post_requests:1,source_inserts:inserted.length,entity_changes:0,role_changes:0,location_changes:0,canonical_changes:0,product_changes:0,crawl_jobs:0};
}
function cli(a){must(a.length>=3&&['--check','--preview','--apply'].includes(a[0])&&/^[a-z][a-z0-9-]*\.json$/.test(a[1])&&/^[a-f0-9]{64}$/.test(a[2]),'cli');
 if(a[0]!=='--apply'){must(a.length===3,'cli');return{mode:a[0].slice(2),file:a[1],sha:a[2]};}
 must(a.length===6&&/^[a-f0-9]{64}$/.test(a[4])&&a[5]==='--confirm-source-only-and-identity-writers-paused','cli');return{mode:'apply',file:a[1],sha:a[2],preview:a[3],previewSha:a[4]};}
function diag(e){return{code:String(e?.code||'source_association_stopped').replace(/[^A-Za-z0-9_:-]/g,'').slice(0,100),...(Number.isInteger(e?.httpStatus)?{httpStatus:e.httpStatus}:{})};}
async function main(args=process.argv.slice(2)){
 const o=cli(args),b=loadBundle(o.file,o.sha);if(o.mode==='check'){console.log(JSON.stringify({status:'offline_check_pass',owners:b.plan.owners.length,sources:b.plan.actions.length,writes:0,requests:0,plan_sha256:o.sha}));return;}
 must(fs.realpathSync(process.cwd())===ROOT&&fs.realpathSync(__dirname)===ROOT+'/src/myCoffeeExplorerImport','production_runtime');must([ORIGIN,ORIGIN+'/'].includes(process.env.NEXT_PUBLIC_SUPABASE_URL),'database_origin');const key=process.env.SUPABASE_SERVICE_ROLE_KEY;must(typeof key==='string'&&key.length>20&&!/\s/.test(key),'credential_missing');
 // Prevent overlap with the identity snapshot as well as other known writers.
 must(!fs.existsSync(STATE+'/snapshot-sequential.lock'),'snapshot_in_progress');let preview;
 if(o.mode==='apply'){const p=fs.realpathSync(o.preview);must(path.basename(p)==='result.json'&&path.dirname(path.dirname(p))===STATE&&path.basename(path.dirname(p)).startsWith(b.plan.tag+'-preview-'),'preview_path');const bytes=fs.readFileSync(p);must(sha(bytes)===o.previewSha,'preview_hash');preview=JSON.parse(bytes);previewValid(preview,b);}
 const {acquireLock}=require('./preflight-batch8b-paced-six.cjs'),locks=[],dir=STATE+'/'+b.plan.tag+(o.mode==='apply'?'-apply':'-preview-'+crypto.randomUUID());let log;const oldTls=process.env.NODE_TLS_REJECT_UNAUTHORIZED;
 try{locks.push(acquireLock(ROOT+'/.state/my-coffee-explorer/apply.lock'));for(const id of b.plan.owners)locks.push(acquireLock(ROOT+'/.state/my-coffee-explorer/.product-only-entity-locks/'+id+'.lock'));const checkLock=()=>locks.forEach(l=>l.check());
  fs.mkdirSync(dir,{mode:0o700});b.core.save(dir+'/reservation.json',{at:new Date().toISOString(),mode:o.mode,plan_sha256:o.sha,helper_sha256:b.helperSha,preview_sha256:o.previewSha||null,retries:0,one_shot:true});log=b.core.journal(dir+'/events.ndjson',checkLock);
  process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';let readAt=null;const beforeWrite=()=>{checkLock();previewValid(preview,b);must(readAt!==null&&Date.now()-readAt>=0&&Date.now()-readAt<5000,'fresh_read_expired');};
  const client=b.core.createClient({bundle:b,key,allowWrites:o.mode==='apply',event:log.append,checkLock,beforeWrite});const result=await execute({bundle:b,client,mode:o.mode,preview,event:log.append,authorizeWrite:at=>{readAt=at;}});checkLock();b.core.save(dir+'/result.json',result);console.log(JSON.stringify({status:result.status,directory:dir,requests:result.requests,source_inserts:result.source_inserts||0,result_sha256:sha(fs.readFileSync(dir+'/result.json'))}));
 }catch(e){if(log)try{b.core.save(dir+'/failure.json',{at:new Date().toISOString(),status:'stopped_review_required',error:diag(e),warning:'An attempted atomic INSERT may have committed. No automatic replay; reconcile exact IDs/source keys.'});}catch{}throw e;}
 finally{log?.close();if(oldTls===undefined)delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;else process.env.NODE_TLS_REJECT_UNAUTHORIZED=oldTls;let error;for(const l of locks.reverse())try{l.release();}catch(e){error=e;}if(error)throw error;}
}
module.exports={ROOT,STATE,BASE,ORIGIN,PINNED_CODE,sha,same,validatePlan,validateBaseline,loadBundle,inspectBefore,previewValid,verifyInserted,execute,cli,main};
if(require.main===module)main().catch(e=>{console.error(JSON.stringify(diag(e)));process.exitCode=1;});
