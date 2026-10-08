'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {isDeepStrictEqual: equal} = require('node:util');
const ORIGIN = 'https://gtlipifdfyugiwpxvuse.supabase.co';
const ROOT = '/Users/allan/.openclaw/workspace/coffee-roaster-crawler';
const STATE = ROOT + '/.state/my-coffee-explorer/2026-09-26';
const ID = 'ee9c83bc-4a86-44ae-b6f6-437c23a9dec4';
const OWNER = '6aac08ac-a27e-4fd8-9281-af9642d14f20';
const MANIFEST = '114fa0f38cf1a4285213aeb583a00f5ffee77e5d661df2171c433e56fd9b30a3';
const CHECKPOINT_SHA = '363aa9fd1f5a5e4f696d679b24a6d69cf6e313221a18533786d8d9640e97149c';
const READBACK_SHA = 'eb794b691f3675bf4a07312ec899ce46f66c3dfb066ccb673a5bf2b5239bbebd';
const FIELDS = 'id,entity_id,status,started_at,finished_at,pages_visited,coffees_found,error,meta';
const EXPECTED = Object.freeze({id:ID,entity_id:OWNER,status:'running',started_at:'2026-09-27T02:14:51.75+00:00',finished_at:null,pages_visited:0,coffees_found:0,error:null,
  meta:{scope:'observed_product_urls_only',concurrency:1,seed_url_count:3,manifest_sha256:MANIFEST,inventory_complete:false}});
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function must(value, code) { if (!value) throw Object.assign(Error(code),{code}); }
function patchFor(before, at) {
  must(equal(before,EXPECTED),'claim_changed');
  must(Number.isFinite(Date.parse(at)) && Date.parse(at)>Date.parse(before.started_at),'invalid_reconciliation_time');
  return {status:'failed',finished_at:at,pages_visited:1,coffees_found:0,
    error:'Partial product persistence (22003); original claim finalization timed out (57014). Stopped worker confirmed; claim closed by reconciliation, not successful completion.',
    meta:{...before.meta,reconciliation:{at,reason:'orphaned_failed_import',readback_sha256:READBACK_SHA,checkpoint_sha256:CHECKPOINT_SHA,
      attempted_product_urls:1,fully_saved_products:0,partial_product_ids:['0fffb375-1e44-46da-959c-37a6acdd4e0c'],
      original_page_finished_at:'2026-09-27T02:16:35.722Z',inventory_complete:false}}};
}
function requestFor(kind, patch) {
  const q = new URLSearchParams({select:FIELDS,limit:'2'});
  let method='GET';
  if (kind==='otherRuns') { q.set('entity_id','eq.'+OWNER);q.set('status','eq.running');q.set('id','neq.'+ID); }
  else {
    must(['before','patch','after'].includes(kind),'unknown_request');q.set('id','eq.'+ID);q.set('entity_id','eq.'+OWNER);
    if(kind==='patch') {
      method='PATCH';q.delete('limit');
      for(const [key,value] of Object.entries(EXPECTED)) {
        if(['id','entity_id'].includes(key))continue;
        q.set(key,value===null?'is.null':'eq.'+(typeof value==='object'?JSON.stringify(value):String(value)));
      }
      must(equal(patch,patchFor(EXPECTED,patch?.finished_at)),'patch_scope_changed');
    }
  }
  return {url:ORIGIN+'/rest/v1/crawl_runs?'+q,method,...(method==='PATCH'?{body:patch}:{})};
}
async function execute({request, mode, assertStopped, record, now=()=>new Date().toISOString()}) {
  must(['preview','apply'].includes(mode),'mode_invalid');
  assertStopped();
  const rows=await request('before');must(rows.length===1&&equal(rows[0],EXPECTED),'claim_changed');
  must((await request('otherRuns')).length===0,'another_owner_run_active');
  const before=rows[0],patch=patchFor(before,now());record('preconditions_verified',{before,patch});
  if(mode==='preview')return{status:'preview',before,patch,writes:0};
  assertStopped();record('mutation_attempt',{id:ID,patch});
  const returned=await request('patch',patch);
  must(returned.length===1&&equal(returned[0],{...before,...patch}),'cas_result_not_exact');
  record('mutation_returned',{row:returned[0]});
  const after=await request('after');must(after.length===1&&equal(after[0],returned[0]),'readback_mismatch');
  return{status:'verified_failed_claim_retired',before,after:after[0],writes:1,inventory_complete:false,queue_restarted:false};
}
function stoppedWorkerProof(ownedLockInode=null) {
  const batch=STATE+'/product-seed-batch5a-reviewed/product-only-114fa0f38cf1';
  const checkpoint=batch+'/checkpoint.json';
  must(sha(fs.readFileSync(checkpoint))===CHECKPOINT_SHA,'checkpoint_changed');
  const bytes=fs.readFileSync(STATE+'/batch5a-reconciliation-post-recovery-0855/complete.json');
  must(sha(bytes)===READBACK_SHA,'readback_changed');
  const capture=JSON.parse(bytes);
  must(capture.captureComplete===true&&capture.manifestHash===MANIFEST&&equal(capture.liveReadback.runs.find(r=>r.id===ID),EXPECTED),'readback_binding_changed');
  const jobs=execFileSync('/bin/launchctl',['list'],{encoding:'utf8'}).split('\n');
  must(!jobs.some(line=>/com\.everycoffee\.mce/.test(line)&&/^\d+\s/.test(line)),'mce_worker_active');
  const processes=execFileSync('/bin/ps',['-axo','pid=,command='],{encoding:'utf8'}).split('\n');
  must(!processes.some(line=>/node.*(?:product-only-crawl|finite-product-queue).*\.cjs/.test(line)),'finite_crawl_process_active');
  must(!fs.existsSync(batch+'/runner.lock'),'batch_filesystem_lock_present');
  const ownerLock=ROOT+'/.state/my-coffee-explorer/.product-only-entity-locks/'+OWNER+'.lock';
  must(ownedLockInode===null?!fs.existsSync(ownerLock):fs.existsSync(ownerLock)&&fs.statSync(ownerLock).ino===ownedLockInode,'owner_filesystem_lock_changed');
}
async function main() {
  const [mode='--check',output,...rest]=process.argv.slice(2);
  must(!rest.length,'extra_arguments');
  if(mode==='--check'){must(!output,'check_no_output');console.log(JSON.stringify({status:'offline_check',claimId:ID,owner:OWNER,maximumWrites:1,queueRestart:false}));return;}
  must(['--preview','--apply'].includes(mode),'use_check_preview_apply');
  must(fs.realpathSync(process.cwd())===ROOT&&fs.realpathSync(__dirname)===ROOT+'/src/myCoffeeExplorerImport','wrong_runtime');
  must(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL||'').href===ORIGIN+'/','wrong_database');
  must(typeof process.env.SUPABASE_SERVICE_ROLE_KEY==='string'&&process.env.SUPABASE_SERVICE_ROLE_KEY.length>20,'credentials_missing');
  must(path.dirname(path.resolve(output||''))===STATE&&/^batch5a-orphan-retirement-[a-z0-9-]+$/.test(path.basename(output)),'new_scoped_output_required');
  fs.mkdirSync(output,{mode:0o700});
  const save=(name,value)=>{const fd=fs.openSync(path.join(output,name),'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
  const record=(event,data)=>{const fd=fs.openSync(path.join(output,'events.ndjson'),'a',0o600);try{fs.writeSync(fd,JSON.stringify({at:new Date().toISOString(),event,...data})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
  let requests=0,writes=0,previous=0,stopped=false;
  const request=async(kind,patch)=>{
    must(!stopped,'no_retry_after_failure');
    const spec=requestFor(kind,patch);must(++requests<=4,'request_bound');
    if(spec.method==='PATCH')must(mode==='--apply'&&++writes===1,'write_bound');
    const delay=Math.max(0,500-(Date.now()-previous));if(delay)await new Promise(r=>setTimeout(r,delay));
    record('request',{kind,method:spec.method});
    try {
      const response=await fetch(spec.url,{method:spec.method,redirect:'error',signal:AbortSignal.timeout(20000),
        headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,
          ...(spec.body?{'Content-Type':'application/json',Prefer:'return=representation'}:{})},
        ...(spec.body?{body:JSON.stringify(spec.body)}:{})});
      const text=await response.text();must(text.length<65536,'response_too_large');
      must(response.ok,'http_'+response.status);const rows=JSON.parse(text);must(Array.isArray(rows)&&rows.length<=2,'invalid_rows');
      return rows;
    } catch(error){stopped=true;throw error;}finally{previous=Date.now();}
  };
  process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';
  save('reservation.json',{at:new Date().toISOString(),mode,helper_sha256:sha(fs.readFileSync(__filename)),id:ID,owner:OWNER,maximumWrites:1});
  const ownerLock=ROOT+'/.state/my-coffee-explorer/.product-only-entity-locks/'+OWNER+'.lock';let lockFd,lockInode;
  try{stoppedWorkerProof();lockFd=fs.openSync(ownerLock,'wx',0o600);lockInode=fs.fstatSync(lockFd).ino;fs.writeSync(lockFd,JSON.stringify({pid:process.pid,scope:'orphan_claim_retirement',id:ID}));fs.fsyncSync(lockFd);
    const result=await execute({request,mode:mode.slice(2),assertStopped:()=>stoppedWorkerProof(lockInode),record});save('result.json',result);console.log(JSON.stringify({status:result.status,requests,writes,output}));}
  catch(error){save('failure.json',{at:new Date().toISOString(),code:error.code||error.name,requests,writes,automaticRetryAllowed:false});throw error;}
  finally{if(lockFd!==undefined){fs.closeSync(lockFd);if(fs.existsSync(ownerLock)&&fs.statSync(ownerLock).ino===lockInode)fs.unlinkSync(ownerLock);}}
}
module.exports={ORIGIN,ID,OWNER,EXPECTED,patchFor,requestFor,execute};
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({code:e.code||e.name}));process.exitCode=1;});
