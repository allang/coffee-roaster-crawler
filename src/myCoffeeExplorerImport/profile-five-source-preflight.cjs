'use strict';
// Read-only source-association evidence. Never invokes an importer or crawler.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT='/Users/allan/.openclaw/workspace/coffee-roaster-crawler',STATE=ROOT+'/.state/my-coffee-explorer/2026-09-26';
const BASE=__dirname===ROOT+'/src/myCoffeeExplorerImport'?STATE:__dirname,ORIGIN='https://gtlipifdfyugiwpxvuse.supabase.co',TAG='profile-five-source-preflight';
const INPUT='profile-source-gap-triage.json',INPUT_SHA='cf762b2d841fe20ed7133448869de64fe2bccb8c4c2ad4cf4904d00ae4550e6a';
const CODE_PINS={'product-db-fetch-gate.cjs':'a4a40c8abb95dc0f5528b9cb9c4a574ca80b5989f016af1fa27c83473563f01e','preflight-batch8b-paced-six.cjs':'ac4f66448d244323574f90a68851c0132eb78d73056c7607a9b287630c545a3d'};
const IDS=['4e9f9e2a-aafe-4807-ae33-f4e44712de22','30c81c28-d8d1-403d-8f3c-5855f081a2a9','c0333237-e457-490f-8da1-b91c29e464b7','5681b04a-bcba-40fe-80c1-91c6842c931e','021add58-8882-4132-9916-935471f7a976'];
const SOURCE_IDS=['roaster:macys-european-coffeehouse','roaster:mammoth-espresso','roaster:mean-mug-coffeehouse','roaster:morning-view-coffee-house-roastery','roaster:peacock-coffee-roasting-co'];
const COMPETITORS=['def9656f-f7c8-4425-abb9-5e15facbfbca','e9a7c86b-ad6b-404f-8088-8f22e2dc7f12'];
const MAX_ROWS=100,MAX_REQUESTS=16,MAX_BODY=1024*1024,MAX_MS=5*60*1000,TIMEOUT_MS=20000;
const KINDS=['entities','roles','locations','ownerSources','sourceKeys','canonical','entityConflicts','locationConflicts'];
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),stamp=()=>new Date().toISOString();
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v),same=(a,b)=>canonical(a)===canonical(b);
function must(v,code){if(!v)throw Object.assign(Error(code),{code});}
const unique=a=>[...new Set(a.filter(x=>typeof x==='string'&&x.length))].sort();
const slug=s=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const normalized=s=>slug(s).replace(/-/g,'');
const project=(row,fields)=>Object.fromEntries(fields.map(k=>{must(Object.hasOwn(row,k),'missing_field:'+k);return[k,row[k]];}));
const sorted=(rows,key)=>[...rows].sort((a,b)=>key(a)<key(b)?-1:key(a)>key(b)?1:0);
const sourceKey=r=>r.source+'\n'+r.source_id;
function pinned(file,pin,base=BASE){must(typeof file==='string'&&!path.isAbsolute(file)&&!file.split('/').includes('..'),'unsafe_evidence_path');const bytes=fs.readFileSync(path.join(base,file));must(sha(bytes)===pin,'evidence_hash:'+file);return bytes;}
function loadScope(base=BASE){
 for(const[f,h]of Object.entries(CODE_PINS))pinned(f,h,__dirname);
 const triage=JSON.parse(pinned(INPUT,INPUT_SHA,base)),pins={[INPUT]:INPUT_SHA};
 for(const[f,h]of Object.entries(triage.input_sha256)){pinned(f,h,base);pins[f]=h;}
 const snapshot=JSON.parse(fs.readFileSync(path.join(base,'snapshot-sequential-v3-post-recovery-0912/snapshot.json'))),targets=triage.next_cases;
 must(targets.length===5&&same(targets.map(t=>t.entity_id),IDS)&&same(targets.map(t=>t.source_id),SOURCE_IDS),'five_target_scope');
 must(targets.every(t=>t.source_only===true&&['create_entity','change_roles','change_fields','change_locations','enqueue_crawl'].every(k=>t[k]===false)),'source_only_scope');
 const roasters=fs.readFileSync(path.join(base,'roasters.ndjson'),'utf8').trim().split('\n').map(JSON.parse),shops=fs.readFileSync(path.join(base,'shops.ndjson'),'utf8').trim().split('\n').map(JSON.parse);
 const owners=[...IDS,...COMPETITORS].sort(),baseline={entities:snapshot.entities.filter(r=>owners.includes(r.id)),roles:snapshot.roles.filter(r=>owners.includes(r.entity_id)),locations:snapshot.locations.filter(r=>owners.includes(r.entity_id)),ownerSources:snapshot.sourceIds.filter(r=>owners.includes(r.entity_id))};
 must(baseline.entities.length===7&&baseline.roles.length===11&&baseline.locations.length===9&&baseline.ownerSources.length===12,'baseline_counts');
 must(snapshot.canonicalLinks.every(r=>!owners.includes(r.entity_id)&&!owners.includes(r.attribute_value)),'baseline_canonical_conflict');
 const names=[],websites=[],slugs=[],addresses=[],placeIds=[];
 for(const t of targets){
  const e=baseline.entities.find(e=>e.id===t.entity_id),r=roasters[t.profile.line-1],shop=shops[t.corroborating_shop.line-1];
  must(e.name===t.current_name&&e.website_url===t.current_website_preserve,'triage_entity_drift');
  must(r.kind==='roaster'&&'roaster:'+r.sourceId===t.source_id&&r.sourceUrl===t.source_url&&r.sourceSha256===t.profile.body_sha256,'profile_pointer');
  must(shop.kind==='shop'&&'shop:'+shop.sourceId===t.corroborating_shop.source_id&&shop.address===t.corroborating_shop.address&&shop.websiteUrl===t.corroborating_shop.website_url,'shop_pointer');
  const raw=JSON.parse(pinned(t.profile.chunk,t.profile.chunk_file_sha256,base));pins[t.profile.chunk]=t.profile.chunk_file_sha256;
  must(sha(raw.body)===t.profile.body_sha256&&raw.body.slice(t.profile.address_utf16_offset,t.profile.address_utf16_offset+t.profile.address_fragment.length)===t.profile.address_fragment,'profile_raw_fragment');
  const bound=baseline.ownerSources.find(s=>s.id===t.corroborating_shop.source_row_id);must(bound&&bound.entity_id===t.entity_id&&bound.source==='my_coffee_explorer'&&bound.source_id===t.corroborating_shop.source_id,'corroborating_shop_binding');
  must(same(unique(baseline.roles.filter(r=>r.entity_id===t.entity_id).map(r=>r.role)),[...t.current_roles].sort()),'triage_role_drift');
  must(same(sorted(baseline.locations.filter(r=>r.entity_id===t.entity_id).map(r=>project(r,Object.keys(t.current_locations[0]))),r=>r.id),sorted(t.current_locations,r=>r.id)),'triage_location_drift');
  must(!snapshot.sourceIds.some(s=>s.source==='my_coffee_explorer'&&s.source_id===t.source_id),'source_not_absent_in_baseline');
  names.push(e.name,r.name,shop.name);websites.push(e.website_url,r.websiteUrl,shop.websiteUrl);slugs.push(e.slug,e.name_slug,r.slug,slug(e.name),slug(r.name),slug(shop.name));addresses.push(...baseline.locations.filter(r=>r.entity_id===t.entity_id).map(r=>r.address1),t.profile.address_fragment,shop.address);placeIds.push(e.google_place_id,shop.placeId);
 }
 // Retained same-normalized-name/host variants are exact query values, not live fuzzy scans.
 const host=u=>{try{return new URL(u).hostname.toLowerCase().replace(/^www\./,'');}catch{return null;}},hosts=new Set(websites.map(host).filter(Boolean)),norms=new Set(names.map(normalized));
 const related=snapshot.entities.filter(e=>norms.has(normalized(e.name||''))||hosts.has(host(e.website_url)));
 must(related.every(e=>owners.includes(e.id)),'retained_identity_competitor');
 for(const e of related){names.push(e.name);websites.push(e.website_url);slugs.push(e.slug,e.name_slug);}
 const sourceKeys=[...baseline.ownerSources.map(r=>({source:r.source,source_id:r.source_id})),...SOURCE_IDS.map(source_id=>({source:'my_coffee_explorer',source_id}))];
 const scope={targets,owners,targetOwners:IDS,competitors:COMPETITORS,baseline,sourceKeys,names:unique(names),websites:unique(websites),slugs:unique(slugs),addresses:unique(addresses),placeIds:unique(placeIds),pins,baseline_at:snapshot.at};
 must(sourceKeys.length===17&&new Set(sourceKeys.map(sourceKey)).size===17,'source_key_scope');
 // Overlay receipts must not change the five targets or bind a formerly absent key.
 const cafe=JSON.parse(fs.readFileSync(path.join(base,'cafe-source-links-apply/result.json'))),p11=JSON.parse(fs.readFileSync(path.join(base,'plan11-paced-apply/result.json')));
 must(cafe.status==='complete'&&p11.status==='complete','overlay_incomplete');
 for(const overlay of [cafe.inserted,p11.completed]){const text=canonical(overlay);must(![...IDS,...SOURCE_IDS].some(v=>text.includes(v)),'overlay_target_overlap');}
 return scope;
}
const quoted=s=>'"'+s.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';
const list=values=>'in.('+values.map(quoted).join(',')+')';
function descriptor(kind,s,offset=0){
 must(KINDS.includes(kind)&&Number.isInteger(offset)&&offset>=0&&offset<=MAX_ROWS,'request_scope');
 const q=new URLSearchParams({select:'*',limit:String(offset?1:MAX_ROWS+1)});let table;
 if(kind==='entities'){table='entities';q.set('id',list(s.owners));}
 if(kind==='roles'||kind==='locations'||kind==='ownerSources'){table={roles:'entity_roles',locations:'entity_locations',ownerSources:'entity_source_ids'}[kind];q.set('entity_id',list(s.owners));}
 if(kind==='sourceKeys'){table='entity_source_ids';q.set('or','('+s.sourceKeys.map(r=>'and(source.eq.'+quoted(r.source)+',source_id.eq.'+quoted(r.source_id)+')').join(',')+')');}
 if(kind==='canonical'){table='entity_attributes';q.set('attribute_key','eq.canonical_roaster_entity_id');q.set('or','(entity_id.'+list(s.owners)+',attribute_value.'+list(s.owners)+')');}
 if(kind==='entityConflicts'){table='entities';q.set('or','('+['name.'+list(s.names),'slug.'+list(s.slugs),'name_slug.'+list(s.slugs),'website_url.'+list(s.websites),...(s.placeIds.length?['google_place_id.'+list(s.placeIds)]:[])].join(',')+')');}
 if(kind==='locationConflicts'){table='entity_locations';q.set('address1',list(s.addresses));}
 q.set('order',kind==='roles'?'entity_id.asc,role.asc':'id.asc');if(offset)q.set('offset',String(offset));
 return{kind,offset,method:'GET',url:ORIGIN+'/rest/v1/'+table+'?'+q};
}
function rowKey(kind,r){return kind==='roles'?r.entity_id+'\n'+r.role:r.id;}
function validate(kind,rows,s,state={}){
 must(Array.isArray(rows)&&rows.length<=MAX_ROWS,'row_bound');let prior='';
 for(const r of rows){must(r&&typeof r==='object'&&!Array.isArray(r),'row_shape');const k=rowKey(kind,r);must(typeof k==='string'&&k>prior,'duplicate_or_unordered_row');prior=k;}
 const equalProjection=(actual,expected)=>{must(actual.length===expected.length,'baseline_count:'+kind);for(const want of expected){const got=actual.find(r=>rowKey(kind,r)===rowKey(kind,want));must(got&&same(project(got,Object.keys(want)),want),'baseline_drift:'+kind);}};
 if(['entities','roles','locations','ownerSources'].includes(kind))equalProjection(rows,s.baseline[kind]);
 else if(kind==='sourceKeys'){
  must(rows.length===s.baseline.ownerSources.length,'source_key_vacancy_or_conflict');
  for(const r of rows){must(s.sourceKeys.some(k=>sourceKey(k)===sourceKey(r)),'source_key_out_of_scope');const want=state.ownerSources?.find(x=>x.id===r.id);must(want&&same(r,want),'source_owner_or_row_drift');}
 }else if(kind==='canonical')must(rows.length===0,'canonical_closure_requires_review');
 else if(kind==='entityConflicts'){must(rows.every(r=>s.owners.includes(r.id)),'exact_identity_competitor');equalProjection(rows,s.baseline.entities);for(const r of rows)must(same(r,state.entities?.find(e=>e.id===r.id)),'entity_changed_during_reads');}
 else if(kind==='locationConflicts'){must(rows.every(r=>s.owners.includes(r.entity_id)),'exact_location_competitor');equalProjection(rows,s.baseline.locations.filter(r=>s.addresses.includes(r.address1)));for(const r of rows)must(same(r,state.locations?.find(e=>e.id===r.id)),'location_changed_during_reads');}
}
function diag(e){return{code:String(e?.code||'preflight_failed').replace(/[^A-Za-z0-9_:-]/g,'').slice(0,100),...(Number.isInteger(e.httpStatus)?{httpStatus:e.httpStatus}:{}),...(/^[A-Z0-9]{1,16}$/.test(e.dbCode||'')?{databaseCode:e.dbCode}:{})};}
function createReader({scope,key,delegate=globalThis.fetch.bind(globalThis),event=()=>{},checkLock=()=>{},now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=TIMEOUT_MS}){
 const {createDatabaseFetchGate}=require('./product-db-fetch-gate.cjs');let requests=0,active=false,stopped=false,finished=null;const start=now();
 const gate=createDatabaseFetchGate(async(request,init)=>{
  while(finished!==null&&now()-finished<500){must(!stopped&&now()-start<MAX_MS,'dispatch_deadline');await wait(500-(now()-finished));}
  must(!stopped&&now()-start<MAX_MS&&!init.signal.aborted,'dispatch_deadline');checkLock();
  must(request.method==='GET'&&request.url===descriptor(current.kind,scope,current.offset).url,'exact_get_scope');
  const response=await delegate(request,init);must(response&&!response.redirected&&response.url===request.url,'exact_response_url');return response;
 },{now,wait,timeoutMs,maxBodyBytes:MAX_BODY,onEvent:event,onStop:x=>event({event:'database_stop',...x})});
 let current;return{get requests(){return requests;},async request(kind,offset=0){let admitted=false;
  try{must(!stopped&&!active&&requests<MAX_REQUESTS&&now()-start<MAX_MS,'reader_stopped_or_bound');current=descriptor(kind,scope,offset);active=true;admitted=true;checkLock();event({event:'read_intent',request:++requests,...current});
   const response=await gate.fetch(current.url,{method:'GET',headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json'},redirect:'error'}),text=await response.text();
   if(![200,206].includes(response.status)){let dbCode;try{dbCode=JSON.parse(text).code;}catch{}throw Object.assign(Error('database_http_error'),{code:'database_http_error',httpStatus:response.status,dbCode});}
   must(/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||''),'content_type');const rows=JSON.parse(text);
   must(Array.isArray(rows)&&rows.length<=MAX_ROWS&&rows.length<=(offset?1:MAX_ROWS+1),'row_bound');
   const range=response.headers.get('content-range')||'',m=/^(?:(\d+)-(\d+)|\*)\/(\d+|\*)$/.exec(range);
   must(m&&(rows.length?Number(m[1])===offset&&Number(m[2])-Number(m[1])+1===rows.length:m[1]===undefined),'content_range');
   if(m[3]!=='*')must(Number(m[3])===offset+rows.length,'reported_total_incomplete');
   must(!stopped&&now()-start<MAX_MS,'reader_stopped_or_bound');event({event:'read_result',request:requests,kind,offset,httpStatus:response.status,contentRange:range,body_sha256:sha(text),rows});return rows;
  }catch(e){stopped=true;gate.stop('profile_read_failed');event({event:'read_failure',kind,offset,error:diag(e)});throw e;}
  finally{if(admitted){finished=now();active=false;}}
 }};
}
async function capture({scope,reader,event=()=>{}}){const state={},coverage=[];for(const kind of KINDS){const rows=await reader.request(kind);if(rows.length)must((await reader.request(kind,rows.length)).length===0,'nonempty_continuation:'+kind);validate(kind,rows,scope,state);state[kind]=rows;coverage.push({kind,rows:rows.length,empty_confirmation:rows.length>0});event({event:'group_verified',kind,rows:rows.length});}
 return{version:1,at:stamp(),status:'read_only_exact_target_evidence_complete_with_holds',readOnly:true,captureComplete:true,writes:0,requests:reader.requests,input_sha256:INPUT_SHA,helper_sha256:sha(fs.readFileSync(__filename)),code_pins:CODE_PINS,evidence_pins:scope.pins,baseline_at:scope.baseline_at,owners:scope.owners,target_owners:IDS,proposed_source_ids:SOURCE_IDS,state,coverage,holds:[{source_id:'roaster:mean-mug-coffeehouse',competitor_ids:COMPETITORS,reason:'Two retained same-name identities require address/branch/operator adjudication. Distinct physical locations alone do not prove separate legal businesses. No automatic association.'}],identityApproved:false,mutation_authorized:false,crawl_authorized:false,full_catalog_current:false,limitations:['Sequential nontransactional reads; not a write lock or fresh whole-catalog snapshot.','Only exact retained names/slugs/websites/place IDs/addresses and exact source keys are queried; unknown spelling variants, newly introduced host aliases and unrelated entities are not exhaustively excluded.','Any direct forward or inbound canonical link stops this preflight rather than following or merging it; empty adjacency is the only accepted closure.','Provenance-only context: Mammoth mixed retailer/product prose and Peacock alternate shop website do not authorize roles, website changes, products or crawling.','Full returned rows are retained. Equality to the dated baseline covers only fields that baseline actually selected; newly captured fields are evidence, not historical-preservation claims.','A complete read-only result is not a source-insert plan, mutation approval, claim reconciliation or permission to restart a crawler.']};
}
function sync(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function save(file,value){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync(path.dirname(file));}
function cli(args){must(args.length===0||(args.length===1&&['--check','--read'].includes(args[0])),'invalid_cli');return args[0]||'--check';}
async function main(args=process.argv.slice(2)){const mode=cli(args),scope=loadScope();if(mode==='--check'){console.log(JSON.stringify({status:'offline_check_pass',input_sha256:INPUT_SHA,target_owners:5,held_competitor_identities:2,proposed_sources:5,existing_sources:12,groups:KINDS.length,max_requests:MAX_REQUESTS,max_rows_per_group:MAX_ROWS,spacing_after_completion_ms:500,request_timeout_ms:TIMEOUT_MS,requests:0,writes:0}));return;}
 must(fs.realpathSync(process.cwd())===ROOT&&fs.realpathSync(__dirname)===ROOT+'/src/myCoffeeExplorerImport'&&fs.realpathSync(STATE)===STATE,'production_runtime_required');must(process.env.NEXT_PUBLIC_SUPABASE_URL===ORIGIN||process.env.NEXT_PUBLIC_SUPABASE_URL===ORIGIN+'/','database_origin');const key=process.env.SUPABASE_SERVICE_ROLE_KEY;must(typeof key==='string'&&key.length>20&&!/\s/.test(key),'credentials_missing');
 const {acquireLock}=require('./preflight-batch8b-paced-six.cjs'),locks=[],dir=STATE+'/'+TAG+'-'+crypto.randomUUID(),tls=process.env.NODE_TLS_REJECT_UNAUTHORIZED;let fd;
 try{locks.push(acquireLock(ROOT+'/.state/my-coffee-explorer/apply.lock'));for(const id of scope.owners)locks.push(acquireLock(ROOT+'/.state/my-coffee-explorer/.product-only-entity-locks/'+id+'.lock'));const checkLock=()=>locks.forEach(l=>l.check());fs.mkdirSync(dir,{mode:0o700});sync(STATE);save(dir+'/reservation.json',{at:stamp(),readOnly:true,input_sha256:INPUT_SHA,helper_sha256:sha(fs.readFileSync(__filename)),owners:scope.owners,max_requests:MAX_REQUESTS,retries:0});fd=fs.openSync(dir+'/events.ndjson','wx',0o600);fs.fsyncSync(fd);sync(dir);let journalFailed=false;
  const event=e=>{must(!journalFailed,'journal_latched_stop');try{checkLock();const b=Buffer.from(JSON.stringify({at:stamp(),...e})+'\n');let n=0;while(n<b.length){const m=fs.writeSync(fd,b,n,b.length-n);must(m>0,'journal_write_stalled');n+=m;}fs.fsyncSync(fd);}catch(error){journalFailed=true;throw error;}};
  process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';const reader=createReader({scope,key,event,checkLock}),result=await capture({scope,reader,event});save(dir+'/result.json',result);console.log(JSON.stringify({status:result.status,directory:dir,requests:result.requests,writes:0,result_sha256:sha(fs.readFileSync(dir+'/result.json'))}));
 }catch(e){if(fd!==undefined)try{save(dir+'/failure.json',{at:stamp(),status:'stopped_review_required',captureComplete:false,error:diag(e),writes:0,retries:0,mutation_authorized:false,note:'Journal retains partial rows only; no absence or successful preflight claim is made.'});}catch{}throw e;}
 finally{if(fd!==undefined)fs.closeSync(fd);if(tls===undefined)delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;else process.env.NODE_TLS_REJECT_UNAUTHORIZED=tls;let failure;for(const l of locks.reverse())try{l.release();}catch(e){failure=e;}if(failure)throw failure;}
}
module.exports={ROOT,STATE,BASE,ORIGIN,TAG,INPUT,INPUT_SHA,CODE_PINS,IDS,SOURCE_IDS,COMPETITORS,MAX_ROWS,MAX_REQUESTS,MAX_BODY,MAX_MS,TIMEOUT_MS,KINDS,sha,same,loadScope,descriptor,validate,createReader,capture,save,cli,main};
if(require.main===module)main().catch(e=>{console.error(JSON.stringify(diag(e)));process.exitCode=1;});
