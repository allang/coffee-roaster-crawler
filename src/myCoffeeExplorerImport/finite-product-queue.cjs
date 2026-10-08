'use strict';
// Explicit finite queue, staged only. No automatic retries, discovery, or scheduler edits.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const ROOT='/Users/allan/.openclaw/workspace/coffee-roaster-crawler';
const STATE=ROOT+'/.state/my-coffee-explorer/2026-09-26',HELPERS=ROOT+'/src/myCoffeeExplorerImport';
const SCOPE='observed_product_urls_only',QUEUE='finite-product-queue-v1';
const FROZEN=Object.freeze({
 predecessor:{tag:'product-seed-lulo-followup',hash:'300e9531793c13154becec5989cac312ad6a5404cfcc25b64ef3e2d4cec71608',targets:1,urls:8},
 batches:[
  {tag:'product-seed-existing-roles',hash:'58bf08e8d9d6ac730e731263c7968a2d340df7bb652467d5d82155b923892860',targets:2,urls:6},
  {tag:'product-seed-batch4d-reviewed',hash:'f95f64ad4db321fe8d5e0d0372abeb35e6cbcebb2bb9025c4b8230ec4b76ad52',targets:20,urls:57},
  {tag:'product-seed-batch5a-reviewed',hash:'114fa0f38cf1a4285213aeb583a00f5ffee77e5d661df2171c433e56fd9b30a3',targets:20,urls:58}],
 helpers:{'product-only-crawl.cjs':'a5adfd008dc68e031d7a26cc3ca47f5a9aac0a1ee9fa337ac7ab96ba83adccdf','product-only-network.cjs':'06b85be52fce083ee6d2cdf5631fa21d2ccdc7ae7a2d7e0f22549769e097ad3e','legal-guard.cjs':'26acbcc26a6b24aaf3663b5968b6163e010a3ac323eac4cfe1dd8b5e6a16abfc','product-seed-result-audit.cjs':'182a6eaf39d4f468d8af038bc1dff47327d5d83c51cda02ecc6f404833083d78'},
 supersession:{file:'product-seed-reviewed-subsets.receipt.json',hash:'57018f9cb35be526256f721f2a5d1924b1c208d973d968c64d193edfd6fd3c2b'},
 bannedTags:['product-seed-batch4d','product-seed-batch5a'],maxWaitMs:60*60*1000,maxQueueMs:4*60*60*1000,maxRunMs:60*60*1000
});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function fail(code){throw Object.assign(new Error(code),{code});}
function must(value,code){if(!value)fail(code);}
function read(file){return JSON.parse(fs.readFileSync(file));}
function pinned(file,expected){must(sha(fs.readFileSync(file))===expected,'frozen_hash_mismatch:'+path.basename(file));}
function syncDir(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function receipt(file,data){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(data,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDir(path.dirname(file));}
function journal(file,data){const fd=fs.openSync(file,'a',0o600);try{fs.writeSync(fd,JSON.stringify({at:new Date().toISOString(),...data})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDir(path.dirname(file));}
function lock(file){const body={pid:process.pid,token:crypto.randomUUID(),scope:QUEUE,expiresAt:new Date(Date.now()+FROZEN.maxQueueMs).toISOString()};receipt(file,body);const bytes=fs.readFileSync(file);return{check(){must(fs.readFileSync(file).equals(bytes),'queue_lock_ownership_lost');},release(){this.check();fs.unlinkSync(file);syncDir(path.dirname(file));}};}
function outDir(base,batch){return path.join(base,batch.tag,'product-only-'+batch.hash.slice(0,12));}
function host(u){return new URL(u).hostname.replace(/^www\./,'').toLowerCase();}
function verifyFrozen(base,helpers,config=FROZEN){
 must(JSON.stringify(config)===JSON.stringify(FROZEN),'queue_configuration_not_frozen');
 for(const [file,hash]of Object.entries(config.helpers))pinned(path.join(helpers,file),hash);
 pinned(path.join(base,config.supersession.file),config.supersession.hash);
 const supersession=read(path.join(base,config.supersession.file));
 const {loadManifest}=require(path.join(helpers,'product-only-crawl.cjs'));
 const batches=[config.predecessor,...config.batches].map(b=>{must(!config.bannedTags.includes(b.tag),'superseded_manifest_refused');const file=path.join(base,b.tag,'manifest.json');pinned(file,b.hash);const loaded=loadManifest(file);must(loaded.manifest.targets.length===b.targets&&loaded.total===b.urls,'manifest_bounds_changed');return{...b,loaded};});
 const ids=new Set(),hosts=new Set();for(const b of batches)for(const t of b.loaded.manifest.targets){must(!ids.has(t.entity_id)&&!hosts.has(host(t.website_url)),'queue_owner_or_host_overlap');ids.add(t.entity_id);hosts.add(host(t.website_url));}
 for(const tag of config.bannedTags){const e=supersession.entries.find(x=>x.original_manifest.file===tag+'/manifest.json');must(e&&e.original_manifest.status==='superseded_unlaunched_per_root_confirmation','supersession_authority_missing');const b=batches.find(x=>x.tag===tag+'-reviewed');must(e.reviewed_manifest.sha256===b.hash,'supersession_reviewed_hash_mismatch');
  pinned(path.join(base,e.original_manifest.file),e.original_manifest.sha256);pinned(path.join(base,e.curation.file),e.curation.sha256);
  const removed=new Set(e.removed.map(r=>r.entity_id+'\n'+r.url));must(b.loaded.manifest.targets.every(t=>t.products.every(p=>!removed.has(t.entity_id+'\n'+p.url))),'curated_exclusion_reintroduced');
  const oldOut=outDir(base,{tag,hash:e.original_manifest.sha256});must(!['checkpoint.json','summary.json','runner.lock'].some(f=>fs.existsSync(path.join(oldOut,f))),'superseded_original_was_attempted');
 }
 return batches;
}
function livePid(pid){if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;return true;}}
function activeWorkers(){const text=cp.execFileSync('/bin/ps',['-axo','pid=,command='],{encoding:'utf8',maxBuffer:4*1024*1024});return text.split('\n').flatMap(line=>{const m=line.trim().match(/^(\d+)\s+(.+)$/);if(!m||Number(m[1])===process.pid)return[];return /(?:^|[\s/])product-only-crawl\.cjs(?:\s|$)|(?:^|[\s/])run-product-seed-(?!finite-queue)[a-z0-9-]+\.sh(?:\s|$)/.test(m[2])?[Number(m[1])]:[];});}
function noWorker(b,base,deps={}){
 must(!(deps.activeWorkers||activeWorkers)().length,'active_product_worker');
 const file=path.join(outDir(base,b),'runner.lock');if(fs.existsSync(file)){const l=read(file);must(!(deps.livePid||livePid)(l.pid),'live_predecessor_pid');fail('stale_runner_lock_requires_review');}
}
function terminal(base,b,options={}){
 noWorker(b,base,options);
 const dir=outDir(base,b),sf=path.join(dir,'summary.json');must(fs.existsSync(sf),'predecessor_summary_missing');const s=read(sf),cf=path.join(dir,'checkpoint.json');must(fs.existsSync(cf),'terminal_checkpoint_missing');const c=read(cf);
 must(s.manifestHash===b.hash&&c.manifestHash===b.hash&&s.scope===SCOPE&&c.scope===SCOPE&&s.mode==='run'&&s.inventory_complete===false,'terminal_scope_mismatch');
 must(Number.isFinite(Date.parse(s.startedAt))&&Number.isFinite(Date.parse(s.finishedAt))&&Date.parse(s.finishedAt)>=Date.parse(s.startedAt),'terminal_timestamp_missing');
 must(s.targetCount===b.targets&&s.urlCount===b.urls&&s.targets.length===b.targets,'incomplete_terminal_targets');
 const expected=new Map(b.loaded.manifest.targets.map(t=>[t.entity_id,t])),seen=new Set();
 for(const item of s.targets){const t=expected.get(item.entity_id);must(t&&!seen.has(item.entity_id),'unexpected_terminal_owner');seen.add(item.entity_id);must(['complete','failed','held','no_eligible_urls','not_attempted_after_stop'].includes(item.status),'nonterminal_target');must(!item.claimFinalizationError,'claim_finalization_failed');must(!['quota_exceeded','checkpoint_quota_stop_requires_review'].includes(item.error),'quota_stop_requires_review');
  must(item.status!=='held','held_owner_requires_review');
  const urls=new Set();for(const r of item.results){must(t.products.some(p=>p.url===r.url)&&!urls.has(r.url),'unexpected_terminal_url');urls.add(r.url);must(['complete','known','checkpoint_complete','failed','failed_requires_retry_flag','not_attempted_after_stop'].includes(r.status),'nonterminal_url');must(!r.partialPersistence&&!r.persistenceErrors?.length,'partial_persistence_requires_review');must(r.error!=='quota_exceeded'&&r.hardStop!=='quota_exceeded','quota_stop_requires_review');}
  if(['complete','failed'].includes(item.status))must(urls.size===t.products.length,'incomplete_terminal_target');
  const attempted=item.results.filter(r=>r.status!=='not_attempted_after_stop');
  for(const sr of attempted){const matches=Object.values(c.results||{}).filter(r=>r.entityId===item.entity_id&&r.url===sr.url);must(matches.length===1,'summary_checkpoint_result_missing_or_duplicate');}
  if(attempted.length){const claim=c.claims?.[item.entity_id];must(claim&&claim.runId&&['complete','failed'].includes(claim.status),'summary_checkpoint_claim_missing');}
 }
 for(const [id,claim]of Object.entries(c.claims||{}))must(expected.has(id)&&claim.runId&&['complete','failed'].includes(claim.status),'unresolved_checkpoint_claim');
 must(new Set(Object.values(c.claims||{}).map(x=>x.runId)).size===Object.keys(c.claims||{}).length,'duplicate_checkpoint_claim_id');
 must(!c.quotaStop,'checkpoint_quota_requires_review');
 for(const r of Object.values(c.results||{})){
  must(expected.get(r.entityId)?.products.some(p=>p.url===r.url)&&['complete','known','failed'].includes(r.status),'nonterminal_checkpoint');
  must(!r.partialPersistence&&!r.persistenceErrors?.length,'checkpoint_partial_persistence_requires_review');must(r.error!=='quota_exceeded'&&r.hardStop!=='quota_exceeded','checkpoint_quota_requires_review');
  const sr=s.targets.find(t=>t.entity_id===r.entityId)?.results.find(x=>x.url===r.url);
  const compatible={complete:['complete','checkpoint_complete'],known:['known','checkpoint_complete'],failed:['failed','failed_requires_retry_flag']};
  must(sr&&compatible[r.status].includes(sr.status),'summary_checkpoint_status_mismatch');
  must((sr.isCoffee===true)===(r.isCoffee===true)&&(sr.productId||null)===(r.productId||null),'summary_checkpoint_product_mismatch');
 }
 must(s.guard&&s.guard.prohibitedRequestsSent===0,'missing_or_violated_legal_guard');
 return{manifestHash:b.hash,summary_sha256:sha(fs.readFileSync(sf)),checkpoint_sha256:sha(fs.readFileSync(cf)),finishedAt:s.finishedAt,partial:s.targets.some(t=>t.status!=='complete'),claimIds:Object.values(c.claims||{}).map(x=>x.runId),claims:Object.entries(c.claims||{}).map(([entity_id,x])=>({entity_id,runId:x.runId,status:x.status}))};
}
function validateBefore(doc,b){must(doc.readOnly===true&&doc.mode==='before'&&doc.manifestHash===b.hash&&doc.targetCount===b.targets,'before_scope_mismatch');must(doc.productCount===0&&doc.products.length===0&&doc.variantCount===0&&doc.factCount===0&&doc.mediaLinkCount===0,'nonempty_product_baseline');must(!doc.runs.some(r=>r.status==='running'),'active_database_claim');for(const k of ['unexpectedProducts','duplicateSources','contaminatedProcess'])must(doc[k].length===0,'before_quality_issue');}
function validatePreview(doc,b){must(doc.mode==='preview'&&doc.manifestHash===b.hash&&doc.targets.length===b.targets,'preview_scope_mismatch');for(const t of doc.targets){const owner=b.loaded.manifest.targets.find(x=>x.entity_id===t.entity_id);must(owner&&t.status==='preview'&&t.results.length===owner.products.length&&t.results.every(r=>r.status==='eligible'&&owner.products.some(p=>p.url===r.url)),'owner_claim_preflight_failed');}}
function validateAfter(doc,b,term){must(doc.readOnly===true&&doc.mode==='after'&&doc.manifestHash===b.hash,'after_scope_mismatch');for(const k of ['unexpectedProducts','duplicateSources','contaminatedProcess'])must(doc[k].length===0,'after_quality_issue');must(!doc.runs.some(r=>r.status==='running'),'active_database_claim');for(const id of term.claimIds){const r=doc.runs.find(x=>x.id===id),c=term.claims?.find(x=>x.runId===id);must(r&&c&&r.entity_id===c.entity_id&&r.status===(c.status==='complete'?'completed':'failed')&&r.meta?.manifest_sha256===b.hash&&r.meta?.scope===SCOPE&&r.finished_at,'terminal_database_claim_unproved');}}
function reserve(dir,b,predecessor){fs.mkdirSync(dir,{recursive:true,mode:0o700});const file=path.join(dir,'attempt.json');must(!fs.existsSync(file),'batch_already_attempted');receipt(file,{scope:QUEUE,tag:b.tag,manifestHash:b.hash,reservedAt:new Date().toISOString(),pid:process.pid,predecessor});return file;}
function commandFactory(queueDir,control){return async function(args,label,timeoutMs){must(!control.stopped,'queue_interrupted');const log=fs.openSync(path.join(queueDir,label+'.log'),'wx',0o600);let child,timeout,killTimer,childError;try{return await new Promise((resolve,reject)=>{child=cp.spawn(process.execPath,args,{cwd:ROOT,env:{...process.env,NODE_TLS_REJECT_UNAUTHORIZED:'1'},stdio:['ignore',log,log]});control.child=child;
  control.terminate=()=>{control.stopped=true;child.kill('SIGTERM');if(!killTimer)killTimer=setTimeout(()=>child.kill('SIGKILL'),10000);};
  child.once('spawn',()=>{try{receipt(path.join(queueDir,label+'.pid.json'),{pid:child.pid,startedAt:new Date().toISOString(),command:label});}catch(e){childError=e;control.terminate();}});
  timeout=setTimeout(()=>control.terminate(),timeoutMs);
  child.once('error',()=>{childError=Object.assign(new Error('child_spawn_failed'),{code:'child_spawn_failed'});});
  child.once('close',(code,signal)=>{const result={exitCode:code,signal,finishedAt:new Date().toISOString()};try{receipt(path.join(queueDir,label+'.exit.json'),result);if(childError)reject(childError);else resolve(result);}catch(e){reject(e);}});
 });}finally{clearTimeout(timeout);clearTimeout(killTimer);control.child=null;control.terminate=null;fs.fsyncSync(log);fs.closeSync(log);}};}
async function execute({base,helpers,control,command,workers=activeWorkers,pidCheck=livePid,wait=ms=>new Promise(r=>setTimeout(r,ms)),applyLockPath=path.join(ROOT,'.state/my-coffee-explorer/apply.lock')}){
 const queueDir=path.join(base,QUEUE);fs.mkdirSync(queueDir,{recursive:true,mode:0o700});const qlock=lock(path.join(queueDir,'queue.lock'));const events=path.join(queueDir,'events.ndjson'),started=Date.now();let applyLock;
 try{
  let batches=verifyFrozen(base,helpers),previous=batches[0];journal(events,{event:'queue_started',pid:process.pid});
  const deadline=setTimeout(()=>{control.stopped=true;control.terminate?.();},FROZEN.maxQueueMs);deadline.unref();control.deadline=deadline;
  const waitStarted=Date.now();while(workers().length){must(!control.stopped&&Date.now()-waitStarted<FROZEN.maxWaitMs,'predecessor_wait_expired');await wait(10000);}
  let previousProof=terminal(base,previous,{activeWorkers:workers,livePid:pidCheck});
  for(const b of batches.slice(1)){
   must(!control.stopped&&Date.now()-started<FROZEN.maxQueueMs,'queue_stopped');qlock.check();verifyFrozen(base,helpers);previousProof=terminal(base,previous,{activeWorkers:workers,livePid:pidCheck});
   const dir=path.join(queueDir,b.tag),attempt=path.join(dir,'attempt.json'),done=path.join(dir,'terminal.json');
   if(fs.existsSync(attempt)){
    const a=read(attempt);must(a.manifestHash===b.hash&&a.tag===b.tag,'attempt_scope_mismatch');must(fs.existsSync(done),'prior_attempt_requires_review');const stored=read(done),actual=terminal(base,b,{activeWorkers:workers,livePid:pidCheck});must(stored.terminal===true&&stored.tag===b.tag&&stored.manifestHash===b.hash&&stored.summary_sha256===actual.summary_sha256&&stored.checkpoint_sha256===actual.checkpoint_sha256,'terminal_receipt_changed');must(fs.existsSync(path.join(dir,'run.exit.json'))&&sha(fs.readFileSync(path.join(dir,'after.json')))===stored.after_sha256&&sha(fs.readFileSync(attempt))===stored.attempt_sha256&&sha(fs.readFileSync(path.join(dir,'invocation.json')))===stored.invocation_sha256,'completion_receipt_missing');validateAfter(read(path.join(dir,'after.json')),b,actual);journal(events,{event:'already_attempted_terminal_skip',tag:b.tag});previous=b;previousProof=actual;continue;
   }
   must(!['checkpoint.json','summary.json','runner.lock'].some(f=>fs.existsSync(path.join(outDir(base,b),f))),'unowned_prior_attempt');
   applyLock=lock(applyLockPath);reserve(dir,b,previousProof);journal(events,{event:'batch_reserved',tag:b.tag,manifestHash:b.hash});
   const before=path.join(dir,'before.json'),previewDir=path.join(dir,'preview'),mf=path.join(base,b.tag,'manifest.json');
   let result=await command([path.join(helpers,'product-seed-result-audit.cjs'),mf,before,'before'],b.tag+'/before',120000);must(result.exitCode===0&&!result.signal,'before_command_failed');validateBefore(read(before),b);
   result=await command([path.join(helpers,'product-only-crawl.cjs'),'--manifest',mf,'--output-dir',previewDir],b.tag+'/preview',300000);must(result.exitCode===0&&!result.signal,'preview_command_failed');validatePreview(read(path.join(previewDir,'preview.json')),b);
   applyLock.check();qlock.check();verifyFrozen(base,helpers);terminal(base,previous,{activeWorkers:workers,livePid:pidCheck});must(!control.stopped,'queue_interrupted');
   receipt(path.join(dir,'invocation.json'),{manifestHash:b.hash,at:new Date().toISOString(),run:true,retryFailed:false,priorAttempts:0});
   applyLock.release();applyLock=null;
   receipt(path.join(dir,'preflight-lock-released.json'),{manifestHash:b.hash,at:new Date().toISOString(),globalPreflightLockReleased:true,queueLockRetained:true,runnerEntityLocksAndLiveOwnerGatesUnchanged:true});
   result=await command([path.join(helpers,'product-only-crawl.cjs'),'--manifest',mf,'--run'],b.tag+'/run',FROZEN.maxRunMs);must(!control.stopped&&!result.signal&&[0,1].includes(result.exitCode),'runner_interrupted_or_failed');
   const proof=terminal(base,b,{activeWorkers:workers,livePid:pidCheck});must(result.exitCode===0||proof.partial,'exit_code_summary_mismatch');
   result=await command([path.join(helpers,'product-seed-result-audit.cjs'),mf,path.join(dir,'after.json'),'after'],b.tag+'/after',120000);must(result.exitCode===0&&!result.signal,'after_command_failed');validateAfter(read(path.join(dir,'after.json')),b,proof);
   receipt(done,{...proof,tag:b.tag,terminal:true,after_sha256:sha(fs.readFileSync(path.join(dir,'after.json'))),attempt_sha256:sha(fs.readFileSync(attempt)),invocation_sha256:sha(fs.readFileSync(path.join(dir,'invocation.json')))});journal(events,{event:'batch_terminal',tag:b.tag,partial:proof.partial});
   previous=b;previousProof=proof;
  }
  journal(events,{event:'finite_queue_complete',batches:3});return{status:'complete',batches:3,launchedRetries:0};
 }catch(e){journal(events,{event:'queue_stopped_for_review',code:String(e.code||'queue_error').replace(/[^a-zA-Z0-9_:-]/g,'').slice(0,100)});throw e;}
 finally{clearTimeout(control.deadline);if(applyLock)applyLock.release();qlock.release();}
}
async function main(){const args=process.argv.slice(2);if(args[0]==='--check'&&args.length===2){const list=verifyFrozen(path.resolve(args[1]),__dirname);console.log(JSON.stringify({mode:'offline',predecessor:list[0].tag,batches:list.slice(1).map(b=>({tag:b.tag,manifestHash:b.hash,targets:b.targets,urls:b.urls})),networkRequests:0,databaseCalls:0,launched:false}));return;}
 must(args.length===1&&args[0]==='--run','usage_check_PATH_or_run');must(fs.realpathSync(__dirname)===HELPERS&&fs.realpathSync(process.cwd())===ROOT,'production_location_required');
 const control={stopped:false,child:null};for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{control.stopped=true;control.terminate?.();});
 const dir=path.join(STATE,QUEUE);fs.mkdirSync(dir,{recursive:true,mode:0o700});const result=await execute({base:STATE,helpers:HELPERS,control,command:commandFactory(dir,control)});console.log(JSON.stringify(result));
}
if(require.main===module)main().catch(e=>{console.error(String(e.code||'queue_failed').replace(/[^a-zA-Z0-9_:-]/g,'').slice(0,100));process.exitCode=1;});
module.exports={FROZEN,ROOT,STATE,HELPERS,sha,pinned,verifyFrozen,terminal,validateBefore,validatePreview,validateAfter,reserve,receipt,outDir,noWorker,execute,commandFactory};
