'use strict';
// One exact five-row source INSERT. No upsert, entity mutation, crawler or replay.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT='/Users/allan/.openclaw/workspace/coffee-roaster-crawler',STATE=ROOT+'/.state/my-coffee-explorer/2026-09-26',ORIGIN='https://gtlipifdfyugiwpxvuse.supabase.co';
const BASE=__dirname===ROOT+'/src/myCoffeeExplorerImport'?STATE:__dirname,TAG='profile-five-source-insert',PLAN='profile-five-source-insert-plan.json',PLAN_SHA='8ddb9343c7deb102461f3943c85a315c29a5dd8d02749ab611d9c09774d664fe';
const REVIEW='apply-profile-five-sources.independent-audit.json',TTL=600000,MAX_MS=180000,MAX_REQUESTS=33,MAX_BODY=1048576;
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),stamp=()=>new Date().toISOString();
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v),same=(a,b)=>canonical(a)===canonical(b),sorted=a=>a.map(canonical).sort();
function must(v,code){if(!v)throw Object.assign(Error(code),{code});}
function diag(e){return{code:String(e.code||'source_insert_stopped').replace(/[^A-Za-z0-9_:-]/g,'').slice(0,100),...(Number.isInteger(e.httpStatus)?{httpStatus:e.httpStatus}:{})};}
function helperSha(){return sha(fs.readFileSync(__filename));}
function loadBundle(base=BASE){
 const bytes=fs.readFileSync(path.join(base,PLAN));must(sha(bytes)===PLAN_SHA,'plan_hash');const p=JSON.parse(bytes);
 for(const[f,h]of Object.entries(p.pins)){must(!path.isAbsolute(f)&&!f.split('/').includes('..'),'pin_path');must(sha(fs.readFileSync(path.join(f.endsWith('.cjs')?__dirname:base,f)))===h,'pin_changed:'+f);}
 const pre=require('./profile-five-source-preflight.cjs'),scope=pre.loadScope(base),fresh=JSON.parse(fs.readFileSync(path.join(base,p.fresh_read.file)));
 must(p.scope==='five_existing_profile_provenance_source_inserts_only'&&p.database_origin===ORIGIN&&p.actions.length===5,'plan_scope');
 must(fresh.captureComplete===true&&fresh.writes===0&&fresh.requests===15&&fresh.helper_sha256===p.pins['profile-five-source-preflight.cjs']&&same(fresh.target_owners,pre.IDS),'fresh_read_scope');
 must(same(p.actions.map(a=>a.entity_id),pre.IDS)&&same(p.actions.map(a=>a.source_id),pre.SOURCE_IDS),'exact_targets');
 for(const[f,h]of Object.entries(fresh.evidence_pins))must(sha(fs.readFileSync(path.join(base,f)))===h,'fresh_evidence_changed');
 for(const a of p.actions){const row=a.source_insert;must(a.decision==='map_existing_provenance_only'&&row.entity_id===a.entity_id&&row.source==='my_coffee_explorer'&&row.source_id===a.source_id&&/^roaster:/.test(row.source_id),'action_scope');must(row.source_url==='https://mycoffeeexplorer.com/roasters/'+row.source_id.slice(8),'profile_url');must(same(Object.keys(row).sort(),['confidence','entity_id','id','raw_data','source','source_id','source_url'])&&row.confidence===0.95&&/^[a-f0-9-]{36}$/.test(row.id),'insert_fields');must(row.raw_data.association_scope==='business_profile_provenance_only'&&row.raw_data.asserts_own_roasting===false,'metadata_scope');}
 must(new Set(p.actions.map(a=>a.source_insert.id)).size===5&&new Set(p.actions.map(a=>a.source_id)).size===5,'duplicate_sources');
 must(fresh.state.canonical.length===0&&fresh.state.ownerSources.length===12&&fresh.state.sourceKeys.length===12,'baseline_source_or_alias');
 scope.baseline=Object.fromEntries(['entities','roles','locations','ownerSources'].map(k=>[k,fresh.state[k]]));
 return{plan:p,scope,before:fresh.state,pre};
}
function descriptor(kind,b,offset=0,at){
 if(kind==='insertSources'){must(offset===0&&typeof at==='string'&&Number.isFinite(Date.parse(at)),'insert_stamp');return{kind,offset:0,method:'POST',url:ORIGIN+'/rest/v1/entity_source_ids?select=*',body:b.plan.actions.map(a=>({...a.source_insert,last_synced_at:at}))};}
 const d=b.pre.descriptor(kind,b.scope,offset);
 if(kind==='sourceKeys'){const u=new URL(d.url),old=u.searchParams.get('or');u.searchParams.set('or','(id.in.('+b.plan.actions.map(a=>a.source_insert.id).join(',')+'),'+old.slice(1,-1)+')');d.url=u.href;}
 return d;
}
function expectedState(b,inserted=[]){const expected=structuredClone(b.before);for(const k of ['ownerSources','sourceKeys'])expected[k].push(...inserted);return expected;}
function validateState(state,b,inserted=[]){const expected=expectedState(b,inserted);must(same(Object.keys(state).sort(),b.pre.KINDS.slice().sort()),'state_groups');for(const k of b.pre.KINDS)must(same(sorted(state[k]),sorted(expected[k])),'state_drift:'+k);}
async function inspect(client,b,inserted=[]){const state={};for(const kind of b.pre.KINDS){const rows=await client.request(kind);if(rows.length)must((await client.request(kind,rows.length)).length===0,'nonempty_continuation:'+kind);state[kind]=rows;}validateState(state,b,inserted);return state;}
function verifyInserted(rows,wanted){
 must(Array.isArray(rows)&&rows.length===5&&new Set(rows.map(r=>r.id)).size===5,'insert_count_or_duplicate');
 for(const w of wanted){const r=rows.find(r=>r.id===w.id);must(r&&same(Object.keys(r).sort(),[...Object.keys(w),'created_at'].sort()),'insert_schema');const got={...r};delete got.created_at;must(Number.isFinite(Date.parse(r.created_at)),'created_timestamp');must(Number.isFinite(Date.parse(r.last_synced_at))&&Date.parse(r.last_synced_at)===Date.parse(w.last_synced_at),'synced_timestamp');got.last_synced_at=w.last_synced_at;must(same(got,w),'insert_representation');}
 return rows;
}
function validatePreview(v,b,now=Date.now()){
 must(v?.status==='preview_complete'&&v.plan_sha256===PLAN_SHA&&v.helper_sha256===helperSha()&&v.constraints_confirmed===true&&v.writes===0,'preview_identity');
 const age=now-Date.parse(v.at);must(Number.isFinite(age)&&age>=0&&age<TTL,'preview_expired');validateState(v.before,b);
}
function validateReview(v){must(v?.status==='PASS'&&v.independent===true&&v.helper_sha256===helperSha()&&v.plan_sha256===PLAN_SHA,'independent_review_required');}
async function bodyText(r,signal){const reader=r.body?.getReader();must(reader,'body_stream');let size=0;const parts=[];try{for(;;){must(!signal.aborted,'request_timeout');const v=await reader.read();if(v.done)break;size+=v.value.length;must(size<=MAX_BODY,'body_bound');parts.push(Buffer.from(v.value));}must(!signal.aborted,'request_timeout');return Buffer.concat(parts).toString();}finally{reader.releaseLock();}}
function createClient({bundle,key,allowWrites=false,delegate=globalThis.fetch.bind(globalThis),event=()=>{},checkLock=()=>{},beforeWrite=()=>{},now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=20000}){
 let count=0,active=false,stopped=false,last=null,attempted=false;const start=now();
 return{get requests(){return count;},async request(kind,offset=0,at){let timer,admitted=false;
  try{must(!stopped&&!active&&count<MAX_REQUESTS&&now()-start<MAX_MS,'transport_stopped_or_bound');active=true;admitted=true;const d=descriptor(kind,bundle,offset,at),write=d.method==='POST';must(!write||allowWrites&&!attempted,'write_denied_or_replay');
   while(last!==null&&now()-last<500){must(!stopped&&now()-start<MAX_MS,'dispatch_deadline');await wait(500-(now()-last));}
   must(!stopped&&now()-start<MAX_MS,'dispatch_deadline');checkLock();if(write){beforeWrite();attempted=true;}
   event({event:write?'post_intent_no_retry':'get_intent',request:++count,...d});
   const abort=new AbortController();timer=setTimeout(()=>abort.abort(),Math.min(timeoutMs,MAX_MS-(now()-start)));
   const r=await delegate(d.url,{method:d.method,redirect:'error',signal:abort.signal,headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json',...(write?{'Content-Type':'application/json',Prefer:'return=representation'}:{})},...(write?{body:JSON.stringify(d.body)}:{})});
   must(r&&!r.redirected&&r.url===d.url,'exact_response_url');const text=await bodyText(r,abort.signal);
   must(!stopped&&now()-start<MAX_MS,'response_deadline');if(!(write?[201]:[200,206]).includes(r.status))throw Object.assign(Error('database_http_error'),{code:'database_http_error',httpStatus:r.status});
   must(/^application\/json(?:;|$)/i.test(r.headers.get('content-type')||''),'content_type');const rows=JSON.parse(text);must(Array.isArray(rows)&&rows.length<=100&&rows.length<=(offset?1:100),'row_bound');
   if(!write){const m=/^(?:(\d+)-(\d+)|\*)\/(\d+|\*)$/.exec(r.headers.get('content-range')||'');must(m&&(rows.length?Number(m[1])===offset&&Number(m[2])-Number(m[1])+1===rows.length:m[1]===undefined),'content_range');if(m[3]!=='*')must(Number(m[3])===offset+rows.length,'reported_total_incomplete');}
   event({event:'request_result',request:count,kind,offset,method:d.method,status:r.status,body_sha256:sha(text),rows});return rows;
  }catch(e){stopped=true;event({event:'request_failure',kind,offset,error:diag(e)});throw e;}
  finally{clearTimeout(timer);if(admitted){last=now();active=false;}}
 }};
}
async function execute({bundle,client,mode='preview',preview,constraintsConfirmed=false,event=()=>{},now=Date.now,authorizeWrite=()=>{}}){
 must(['preview','apply'].includes(mode),'invalid_mode');if(mode==='apply')validatePreview(preview,bundle,now());
 const before=await inspect(client,bundle);event({event:'before_complete',before});
 if(mode==='preview')return{at:new Date(now()).toISOString(),status:'preview_complete',plan_sha256:PLAN_SHA,helper_sha256:helperSha(),before,constraints_confirmed:constraintsConfirmed,requests:client.requests,writes:0};
 must(same(before,preview.before),'preview_context_changed');validatePreview(preview,bundle,now());const completedReadAt=now();authorizeWrite(completedReadAt);
 const at=new Date(now()).toISOString(),wanted=descriptor('insertSources',bundle,0,at).body;
 const inserted=verifyInserted(await client.request('insertSources',0,at),wanted);event({event:'post_returned_verified',inserted});
 const after=await inspect(client,bundle,inserted);event({event:'full_preservation_verified',after});
 return{at:new Date(now()).toISOString(),status:'complete',plan_sha256:PLAN_SHA,helper_sha256:helperSha(),before,inserted,after,requests:client.requests,post_requests:1,source_inserts:5,entity_changes:0,role_changes:0,location_changes:0,canonical_changes:0,product_changes:0,crawl_jobs:0,limitation:'Nontransactional targeted before/after identity checks; one atomic source-only INSERT request. No cross-table lock against arbitrary external writers. No retry/resume.'};
}
function sync(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function save(file,value){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync(path.dirname(file));}
function journal(file,checkLock){const fd=fs.openSync(file,'wx',0o600);fs.fsyncSync(fd);sync(path.dirname(file));let stopped=false;return{close:()=>fs.closeSync(fd),append(e){must(!stopped,'journal_latched');try{checkLock();const bytes=Buffer.from(JSON.stringify({at:stamp(),...e})+'\n');let n=0;while(n<bytes.length){const z=fs.writeSync(fd,bytes,n,bytes.length-n);must(z>0,'journal_stalled');n+=z;}fs.fsyncSync(fd);}catch(e){stopped=true;throw e;}}};}
function cli(a){if(!a.length||same(a,['--check']))return{mode:'check'};if(a.length===3&&a[0]==='--preview'&&a[1]==='--review-sha'&&/^[a-f0-9]{64}$/.test(a[2]))return{mode:'preview',reviewSha:a[2],constraintsConfirmed:false};if(a.length===4&&a[0]==='--preview'&&a[1]==='--review-sha'&&/^[a-f0-9]{64}$/.test(a[2])&&a[3]==='--confirmed-source-unique-constraints')return{mode:'preview',reviewSha:a[2],constraintsConfirmed:true};must(a.length===6&&a[0]==='--apply'&&/^[a-f0-9]{64}$/.test(a[2])&&a[3]==='--review-sha'&&/^[a-f0-9]{64}$/.test(a[4])&&a[5]==='--confirm-five-source-only-inserts','invalid_cli');return{mode:'apply',previewFile:a[1],previewSha:a[2],reviewSha:a[4]};}
async function main(args=process.argv.slice(2)){
 const opt=cli(args),bundle=loadBundle();if(opt.mode==='check'){console.log(JSON.stringify({status:'offline_check_pass',sources:5,owners:5,preserved_competitors:2,max_POSTs:1,max_requests:MAX_REQUESTS,requests:0,writes:0,plan_sha256:PLAN_SHA}));return;}
 must(fs.realpathSync(process.cwd())===ROOT&&fs.realpathSync(__dirname)===ROOT+'/src/myCoffeeExplorerImport'&&fs.realpathSync(STATE)===STATE,'production_runtime_required');must(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL||'').href===ORIGIN+'/','database_origin');const key=process.env.SUPABASE_SERVICE_ROLE_KEY;must(typeof key==='string'&&key.length>20&&!/\s/.test(key),'credential_missing');
 const reviewBytes=fs.readFileSync(path.join(STATE,REVIEW));must(sha(reviewBytes)===opt.reviewSha,'review_hash');validateReview(JSON.parse(reviewBytes));let preview;
 if(opt.mode==='apply'){const f=fs.realpathSync(opt.previewFile);must(path.basename(f)==='result.json'&&path.dirname(path.dirname(f))===STATE&&new RegExp('^'+TAG+'-preview-[a-f0-9-]{36}$').test(path.basename(path.dirname(f))),'preview_path');const bytes=fs.readFileSync(f);must(sha(bytes)===opt.previewSha,'preview_hash');preview=JSON.parse(bytes);validatePreview(preview,bundle);}
 const {acquireLock}=require('./preflight-batch8b-paced-six.cjs'),locks=[],dir=STATE+'/'+TAG+(opt.mode==='apply'?'-apply':'-preview-'+crypto.randomUUID()),tls=process.env.NODE_TLS_REJECT_UNAUTHORIZED;let log;
 try{locks.push(acquireLock(ROOT+'/.state/my-coffee-explorer/apply.lock'));for(const id of bundle.scope.owners)locks.push(acquireLock(ROOT+'/.state/my-coffee-explorer/.product-only-entity-locks/'+id+'.lock'));const checkLock=()=>locks.forEach(l=>l.check());
  fs.mkdirSync(dir,{mode:0o700});sync(STATE);save(dir+'/reservation.json',{at:stamp(),mode:opt.mode,helper_sha256:helperSha(),plan_sha256:PLAN_SHA,review_sha256:opt.reviewSha,preview_sha256:opt.previewSha||null,one_shot:true,retries:0});log=journal(dir+'/events.ndjson',checkLock);
  process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';let completedReadAt=null;const beforeWrite=()=>{checkLock();validatePreview(preview,bundle);must(completedReadAt!==null&&Date.now()-completedReadAt>=0&&Date.now()-completedReadAt<5000,'fresh_context_expired');};
  const client=createClient({bundle,key,allowWrites:opt.mode==='apply',event:log.append,checkLock,beforeWrite}),result=await execute({bundle,client,mode:opt.mode,preview,constraintsConfirmed:opt.constraintsConfirmed,event:log.append,authorizeWrite:at=>{completedReadAt=at;}});checkLock();save(dir+'/result.json',result);console.log(JSON.stringify({status:result.status,directory:dir,result_sha256:sha(fs.readFileSync(dir+'/result.json'))}));
 }catch(e){if(log)try{save(dir+'/failure.json',{at:stamp(),status:'stopped_review_required',error:diag(e),warning:'An attempted POST may have committed. Never replay this fixed apply directory. Reconcile the exact five IDs/source keys separately; no rollback is inferred.'});}catch{}throw e;}
 finally{if(log)log.close();if(tls===undefined)delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;else process.env.NODE_TLS_REJECT_UNAUTHORIZED=tls;let failure;for(const l of locks.reverse())try{l.release();}catch(e){failure=e;}if(failure)throw failure;}
}
module.exports={ROOT,STATE,BASE,ORIGIN,TAG,PLAN,PLAN_SHA,REVIEW,TTL,MAX_MS,MAX_REQUESTS,MAX_BODY,sha,same,sorted,helperSha,loadBundle,descriptor,expectedState,validateState,inspect,verifyInserted,validatePreview,validateReview,createClient,execute,journal,save,cli,main};
if(require.main===module)main().catch(e=>{console.error(JSON.stringify(diag(e)));process.exitCode=1;});
