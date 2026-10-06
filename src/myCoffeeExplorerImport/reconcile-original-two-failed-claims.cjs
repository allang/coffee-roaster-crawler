'use strict';
// Exact historical failed-attempt cleanup; no crawler control or claim replay.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT='/Users/allan/.openclaw/workspace/coffee-roaster-crawler',STATE=ROOT+'/.state/my-coffee-explorer/2026-09-26';
const BASE=__dirname===ROOT+'/src/myCoffeeExplorerImport'?STATE:__dirname,ORIGIN='https://gtlipifdfyugiwpxvuse.supabase.co';
const TAG='original-two-failed-claims',TTL=600000,MAX_MS=150000;
const TARGETS=[
 {id:'558685eb-8b08-4e0b-85ca-91610b0f1218',entity_id:'31e6ac6f-0c70-4e66-b36e-6eb86da76c11',name:'Opening Bell Coffee',started_at:'2026-09-27T00:52:50.158Z',attempt_finished_at:'2026-09-27T01:40:28.561Z',checkpoint_error:'crawl_failed'},
 {id:'4b635387-d502-4001-8349-7598bfba1084',entity_id:'cde7f913-97b3-47f5-af83-36cd9577bd06',name:"Rembrandt's Coffee House",started_at:'2026-09-27T01:53:53.734Z',attempt_finished_at:'2026-09-27T01:55:02.537Z',checkpoint_error:'57014'}
];
const PINS={
 'product-db-fetch-gate.cjs':'a4a40c8abb95dc0f5528b9cb9c4a574ca80b5989f016af1fa27c83473563f01e',
 'original-536-crawl-reconciliation.json':'f21d4e9778a8acbf0756b4298f24fed30020d9243eac5a7d5f7efe60186ad488',
 'original-536-state-v2-c56bb4e6-99b0-4b51-b9e5-a8cb79c02c00/result.json':'7f39f28cabe7c7f5b34bb40f9014089d7f3730d4435ffe50b47c265519559f23'
};
const FIELDS=['coffees_found','created_at','entity_id','error','finished_at','id','meta','pages_discovered','pages_sent_to_gpt','pages_visited','platform','started_at','status'];
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v),same=(a,b)=>stable(a)===stable(b),stamp=()=>new Date().toISOString();
function must(v,code){if(!v)throw Object.assign(Error(code),{code});}
function safeError(e){return{code:String(e?.code||'claim_cleanup_stopped').replace(/[^A-Za-z0-9_:-]/g,'').slice(0,80)};}
function helperSha(){return sha(fs.readFileSync(__filename));}
function loadEvidence(base=BASE){
 for(const[f,h]of Object.entries(PINS))must(sha(fs.readFileSync(path.join(f.endsWith('.cjs')?__dirname:base,f)))===h,'evidence_changed');
 const roster=JSON.parse(fs.readFileSync(path.join(base,'original-536-crawl-reconciliation.json'))),capture=JSON.parse(fs.readFileSync(path.join(base,Object.keys(PINS)[2])));
 must(capture.captureComplete===true&&capture.writes===0&&capture.roster_sha256===PINS['original-536-crawl-reconciliation.json'],'capture_incomplete');
 for(const t of TARGETS){const row=capture.data.activeClaims.find(r=>r.id===t.id),owner=roster.owners.find(r=>r.entity_id===t.entity_id),attempt=owner?.executions.find(e=>e.run==='main');
  must(row?.entity_id===t.entity_id&&row.status==='running'&&row.finished_at===null&&Date.parse(row.started_at)===Date.parse(t.started_at),'claim_provenance');
  must(attempt?.status==='failed'&&attempt.finishedAt===t.attempt_finished_at&&attempt.error?.code===t.checkpoint_error,'failed_attempt_provenance');
 }return {targets:TARGETS,pins:PINS};
}
function validateRow(row,t){
 must(row&&same(Object.keys(row).sort(),FIELDS),'row_schema');
 must(row.id===t.id&&row.entity_id===t.entity_id&&row.status==='running'&&row.finished_at===null&&Date.parse(row.started_at)===Date.parse(t.started_at),'claim_changed');
 must(Number.isFinite(Date.parse(row.created_at))&&(row.error===null||typeof row.error==='string')&&row.meta!==undefined,'row_values');return row;
}
function validateSet(rows){must(Array.isArray(rows)&&rows.length===2&&new Set(rows.map(r=>r.id)).size===2,'exact_two_claims');return TARGETS.map(t=>validateRow(rows.find(r=>r.id===t.id),t));}
function validatePreview(p,now=Date.now()){must(p?.status==='preview_complete'&&p.helper_sha256===helperSha()&&same(p.evidence_pins,PINS)&&p.writes===0,'preview_binding');must(now-Date.parse(p.at)>=0&&now-Date.parse(p.at)<TTL,'preview_expired');validateSet(p.before);}
function patchFor(before,t,at){
 validateRow(before,t);must(new Date(at).toISOString()===at&&Date.parse(at)>Date.parse(t.attempt_finished_at),'cleanup_time');
 const note=`Reconciled at ${at}: original targeted attempt for ${t.entity_id} recorded failed at ${t.attempt_finished_at} (checkpoint ${t.checkpoint_error}); database terminal status was not persisted. finished_at is reconciliation time, not original completion; no success inferred; original counters and metadata preserved.`;
 return{status:'failed',finished_at:at,error:(before.error?before.error+'\n':'')+note};
}
function descriptor(kind,index,before,patch){
 const q=new URLSearchParams({select:'*',order:'id.asc',limit:kind==='all'?'3':'2'}),eq=(k,v)=>q.set(k,v===null?'is.null':'eq.'+(typeof v==='object'?JSON.stringify(v):String(v)));let method='GET';
 if(kind==='all')q.set('or','('+TARGETS.map(t=>`and(id.eq.${t.id},entity_id.eq.${t.entity_id})`).join(',')+')');
 else{must(Number.isInteger(index)&&index>=0&&index<2,'claim_index');const t=TARGETS[index];eq('id',t.id);eq('entity_id',t.entity_id);
  if(kind==='patch'){must(same(patch,patchFor(before,t,patch?.finished_at)),'patch_scope');method='PATCH';q.delete('order');q.delete('limit');for(const[k,v]of Object.entries(before))eq(k,v);}
  else must(kind==='one','request_kind');
 }return{kind,index,method,url:ORIGIN+'/rest/v1/crawl_runs?'+q,...(method==='PATCH'?{body:patch}:{})};
}
function verifyPreserved(row,before,patch){const expected={...before,...patch};must(row&&same(Object.keys(row).sort(),FIELDS),'returned_schema');for(const k of FIELDS)must(k==='finished_at'?Number.isFinite(Date.parse(row[k]))&&Date.parse(row[k])===Date.parse(expected[k]):same(row[k],expected[k]),'changed_field:'+k);return row;}
function createClient({mode,key,delegate=globalThis.fetch.bind(globalThis),event=()=>{},checkLock=()=>{},beforeWrite=()=>{},now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=20000}){
 must(['preview','apply'].includes(mode),'client_mode');must(sha(fs.readFileSync(path.join(__dirname,'product-db-fetch-gate.cjs')))===PINS['product-db-fetch-gate.cjs'],'gate_changed');
 const {createDatabaseFetchGate}=require('./product-db-fetch-gate.cjs');let stopped=false,active=false,last=null,count=0,current=null;const start=now(),attempted=new Set();
 const gate=createDatabaseFetchGate(async(request,options)=>{must(!stopped&&current&&request.url===current.url&&request.method===current.method,'dispatch_scope');checkLock();must(now()-start<MAX_MS,'global_deadline');if(current.method==='PATCH')beforeWrite();const response=await delegate(request,options);must(response&&!response.redirected&&response.url===request.url,'exact_response_url');return response;},{now,wait,timeoutMs,maxBodyBytes:1048576,onEvent:e=>event(e),onStop:()=>{stopped=true;}});
 return{get requests(){return count;},stop(){stopped=true;gate.stop('cleanup_stopped');},async request(kind,index,before,patch){let timer;try{
  must(!stopped&&!active&&count<(mode==='preview'?1:6)&&now()-start<MAX_MS,'stopped_or_bound');active=true;const d=descriptor(kind,index,before,patch);must(d.method==='GET'||mode==='apply'&&!attempted.has(index),'write_or_replay_denied');
  while(last!==null&&now()-last<500){must(!stopped&&now()-start<MAX_MS,'global_deadline');await wait(500-(now()-last));}must(!stopped&&now()-start<MAX_MS,'global_deadline');checkLock();if(d.method==='PATCH'){beforeWrite();attempted.add(index);}current=d;event({event:'request_intent_no_retry',request:++count,...d});
  const controller=new AbortController();timer=setTimeout(()=>controller.abort(),Math.min(timeoutMs,MAX_MS-(now()-start)));
  const response=await gate.fetch(d.url,{method:d.method,redirect:'error',signal:controller.signal,headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json',Prefer:d.method==='PATCH'?'return=representation':'count=exact',...(d.body?{'Content-Type':'application/json'}:{})},...(d.body?{body:JSON.stringify(d.body)}:{})});
  must(!stopped&&now()-start<MAX_MS,'stopped_after_response');must(response.status===200||d.method==='GET'&&response.status===206,'database_http');must(/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||''),'content_type');const rows=await response.json();must(Array.isArray(rows)&&rows.length<(kind==='all'?3:2),'row_cap');
  if(d.method==='GET'){const m=/^(?:(\d+)-(\d+)|\*)\/(\d+)$/.exec(response.headers.get('content-range')||'');must(m&&Number(m[3])===rows.length&&(rows.length?Number(m[1])===0&&Number(m[2])+1===rows.length:m[1]===undefined),'incomplete_read');}
  event({event:'request_result',request:count,kind,index,status:response.status,rows});return rows;
 }catch(e){stopped=true;gate.stop('cleanup_failure');event({event:'request_failure',error:safeError(e)});throw e;}finally{clearTimeout(timer);last=now();current=null;active=false;}}};
}
async function execute({client,mode,preview,event=()=>{},now=Date.now}){
 try{must(['preview','apply'].includes(mode),'mode');if(mode==='apply')validatePreview(preview,now());const before=validateSet(await client.request('all'));event({event:'before_verified',before});
  if(mode==='preview')return{at:new Date(now()).toISOString(),status:'preview_complete',helper_sha256:helperSha(),evidence_pins:PINS,before,requests:client.requests,writes:0};
  must(same(before,preview.before),'preview_row_drift');const returned=[],patches=[];
  for(let i=0;i<2;i++){validatePreview(preview,now());const fresh=await client.request('one',i);must(fresh.length===1&&same(fresh[0],before[i]),'prewrite_row_drift');validatePreview(preview,now());const patch=patchFor(before[i],TARGETS[i],new Date(now()).toISOString());event({event:'mutation_intent_no_retry',index:i,before:before[i],patch});const result=await client.request('patch',i,before[i],patch);must(result.length===1,'patch_not_exact_one');returned.push(verifyPreserved(result[0],before[i],patch));patches.push(patch);}
  const after=await client.request('all');must(after.length===2&&new Set(after.map(r=>r.id)).size===2,'readback_set');for(let i=0;i<2;i++)verifyPreserved(after.find(r=>r.id===TARGETS[i].id),before[i],patches[i]);event({event:'readback_verified',after});return{at:new Date(now()).toISOString(),status:'verified_two_historical_failed_claims_reconciled',helper_sha256:helperSha(),evidence_pins:PINS,before,patches,returned,after,requests:client.requests,writes:2,original_attempts:TARGETS,counters_meta_owner_and_start_preserved:true,worker_changed:false,limitation:'Sequential exact-row checks, not a global transaction. finished_at denotes reconciliation; checkpoint terminal-attempt timestamps remain in attribution. No other claim, product, owner, scheduler or crawler action.'};
 }catch(e){client.stop?.();throw e;}
}
function sync(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function save(file,value){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync(path.dirname(file));}
function acquireLock(file){const fd=fs.openSync(file,'wx',0o600),stat=fs.fstatSync(fd),text=JSON.stringify({pid:process.pid,scope:TAG,token:crypto.randomUUID()});fs.writeSync(fd,text);fs.fsyncSync(fd);sync(path.dirname(file));const check=()=>{const s=fs.lstatSync(file);must(s.isFile()&&!s.isSymbolicLink()&&s.ino===stat.ino&&s.dev===stat.dev&&fs.readFileSync(file,'utf8')===text,'lock_lost');};return{check,release(){try{check();fs.unlinkSync(file);sync(path.dirname(file));}finally{fs.closeSync(fd);}}};}
function cli(a){if(!a.length||same(a,['--check']))return{mode:'check'};if(same(a,['--preview']))return{mode:'preview'};must(a.length===4&&a[0]==='--apply'&&/^[a-f0-9]{64}$/.test(a[2])&&a[3]==='--confirm-two-failed-claims','cli');return{mode:'apply',previewFile:a[1],previewSha:a[2]};}
async function main(args=process.argv.slice(2)){
 const opt=cli(args);loadEvidence();if(opt.mode==='check'){console.log(JSON.stringify({status:'offline_check_pass',claims:2,patch_fields:['status','finished_at','error'],maximum_apply_requests:6,writes:0}));return;}
 must(fs.realpathSync(process.cwd())===ROOT&&fs.realpathSync(__dirname)===ROOT+'/src/myCoffeeExplorerImport','production_runtime');must([ORIGIN,ORIGIN+'/'].includes(process.env.NEXT_PUBLIC_SUPABASE_URL),'database_origin');const key=process.env.SUPABASE_SERVICE_ROLE_KEY;must(typeof key==='string'&&key.length>20&&!/\s/.test(key),'credential_missing');let preview;
 if(opt.mode==='apply'){const f=fs.realpathSync(opt.previewFile);must(path.basename(f)==='result.json'&&path.dirname(path.dirname(f))===STATE&&new RegExp('^'+TAG+'-preview-[a-f0-9-]{36}$').test(path.basename(path.dirname(f))),'preview_path');const bytes=fs.readFileSync(f);must(sha(bytes)===opt.previewSha,'preview_hash');preview=JSON.parse(bytes);validatePreview(preview);}
 const locks=[],out=STATE+'/'+TAG+(opt.mode==='apply'?'-apply':'-preview-'+crypto.randomUUID()),oldTls=process.env.NODE_TLS_REJECT_UNAUTHORIZED;let fd,failed=false;
 try{locks.push(acquireLock(ROOT+'/.state/my-coffee-explorer/apply.lock'));for(const t of TARGETS)locks.push(acquireLock(ROOT+'/.state/my-coffee-explorer/.product-only-entity-locks/'+t.entity_id+'.lock'));const checkLock=()=>locks.forEach(l=>l.check());fs.mkdirSync(out,{mode:0o700});sync(STATE);save(out+'/reservation.json',{at:stamp(),mode:opt.mode,helper_sha256:helperSha(),evidence_pins:PINS,preview_sha256:opt.previewSha||null,claim_ids:TARGETS.map(t=>t.id),one_shot:true,retries:0});fd=fs.openSync(out+'/events.ndjson','wx',0o600);sync(out);
  const event=e=>{must(!failed,'journal_latched');try{checkLock();const bytes=Buffer.from(JSON.stringify({at:stamp(),...e})+'\n');let at=0;while(at<bytes.length){const n=fs.writeSync(fd,bytes,at,bytes.length-at);must(n>0,'journal_short_write');at+=n;}fs.fsyncSync(fd);}catch(e){failed=true;throw e;}};process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';const client=createClient({mode:opt.mode,key,event,checkLock,beforeWrite:()=>validatePreview(preview)});const result=await execute({client,mode:opt.mode,preview,event});checkLock();save(out+'/result.json',result);console.log(JSON.stringify({status:result.status,output:out,result_sha256:sha(fs.readFileSync(out+'/result.json'))}));
 }catch(e){if(fd!==undefined)try{save(out+'/failure.json',{at:stamp(),status:'stopped_review_required',error:safeError(e),warning:'An attempted PATCH may have committed; do not replay or resume. Inspect only attempted exact claim IDs before any further proposal.'});}catch{}throw e;}finally{if(fd!==undefined)fs.closeSync(fd);if(oldTls===undefined)delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;else process.env.NODE_TLS_REJECT_UNAUTHORIZED=oldTls;let err;for(const l of locks.reverse())try{l.release();}catch(e){err=e;}if(err)throw err;}
}
module.exports={ROOT,STATE,BASE,ORIGIN,TAG,TTL,MAX_MS,TARGETS,PINS,FIELDS,sha,same,helperSha,loadEvidence,validateRow,validateSet,validatePreview,patchFor,descriptor,verifyPreserved,createClient,execute,save,acquireLock,cli,main};
if(require.main===module)main().catch(e=>{console.error(JSON.stringify(safeError(e)));process.exitCode=1;});
