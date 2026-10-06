'use strict';
// Separate finite successor. Importing/checking this module never contacts a service.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const QUEUE1_SHA='58c2c48b4aa8bd50c16f77336699199c1fc1bd33c8c48b5e21d43e325d3191e1';
if(sha(fs.readFileSync(path.join(__dirname,'finite-product-queue.cjs')))!==QUEUE1_SHA)throw Error('queue1_helper_changed');
const prior=require('./finite-product-queue.cjs');
const {ROOT,STATE,HELPERS,receipt,pinned,outDir,terminal,validateBefore,validatePreview,validateAfter}=prior;
const QUEUE='finite-product-queue-v2',CONFIG='finite-product-queue2.config.json';
const TAGS=['product-seed-batch8a','product-seed-batch8b','product-seed-batch9a'];
const LIMITS=Object.freeze({maxBatches:3,maxTargets:50,maxUrlsPerBatch:150,concurrency:1,maxWaitMs:14400000,maxQueueMs:28800000,maxRunMs:3600000});
const HELPER_PINS=Object.freeze({...prior.FROZEN.helpers,'finite-product-queue.cjs':QUEUE1_SHA});
function must(v,c){if(!v)throw Object.assign(new Error(c),{code:c});}
function read(f){return JSON.parse(fs.readFileSync(f));}
function host(u){return new URL(u).hostname.toLowerCase().replace(/^www\./,'');}
function syncDir(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function journal(f,x){const fd=fs.openSync(f,'a',0o600);try{fs.writeSync(fd,JSON.stringify({at:new Date().toISOString(),...x})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDir(path.dirname(f));}
function livePid(pid){if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}}
function activeWorkers(){const cp=require('node:child_process');return cp.execFileSync('/bin/ps',['-axo','pid=,command='],{encoding:'utf8',maxBuffer:4*1024*1024}).split('\n').flatMap(l=>{const m=l.trim().match(/^(\d+)\s+(.+)$/);return m&&Number(m[1])!==process.pid&&/(?:^|[\s/])product-only-crawl\.cjs(?:\s|$)|(?:^|[\s/])run-product-seed-(?!finite-queue)[a-z0-9-]+\.sh(?:\s|$)/.test(m[2])?[Number(m[1])]:[];});}
function ownLock(file){const body={pid:process.pid,token:crypto.randomUUID(),scope:QUEUE,expiresAt:new Date(Date.now()+LIMITS.maxQueueMs).toISOString()};receipt(file,body);const bytes=fs.readFileSync(file);return{check(){must(fs.readFileSync(file).equals(bytes),'queue2_lock_ownership_lost');},release(){this.check();fs.unlinkSync(file);syncDir(path.dirname(file));}};}
function loadConfig(base,helpers,expectedHash){
 must(/^[a-f0-9]{64}$/.test(expectedHash||''),'frozen_config_hash_required');pinned(path.join(base,CONFIG),expectedHash);
 const c=read(path.join(base,CONFIG));
 return{config:c,configHash:expectedHash,batches:verifyConfiguration(base,helpers,c)};
}
function verifyConfiguration(base,helpers,c){
 must(c.version===1&&c.queue===QUEUE&&c.status==='frozen_not_launched'&&c.retryFailed===false,'invalid_queue2_config');
 must(JSON.stringify(c.limits)===JSON.stringify(LIMITS),'queue2_bounds_changed');
 must(JSON.stringify(c.helpers)===JSON.stringify(HELPER_PINS),'queue2_helpers_changed');
 must(JSON.stringify(c.predecessor)===JSON.stringify(prior.FROZEN.batches.at(-1)),'wrong_queue1_predecessor');
 must(c.batches.length===3&&c.batches.every((b,i)=>b.tag===TAGS[i]),'queue2_exact_three_order_required');
 for(const [f,h]of Object.entries(HELPER_PINS))pinned(path.join(helpers,f),h);
 const {loadManifest}=require(path.join(helpers,'product-only-crawl.cjs'));
 const all=[c.predecessor,...c.batches].map(b=>{
  must(Number.isInteger(b.targets)&&b.targets>0&&b.targets<=LIMITS.maxTargets&&Number.isInteger(b.urls)&&b.urls>0&&b.urls<=LIMITS.maxUrlsPerBatch,'manifest_bounds_invalid');
  const file=path.join(base,b.tag,'manifest.json');pinned(file,b.hash);const loaded=loadManifest(file);
  must(loaded.manifest.targets.length===b.targets&&loaded.total===b.urls&&loaded.manifest.concurrency===1,'manifest_counts_changed');
  return{...b,loaded};
 });
 const ids=new Set(),hosts=new Set();for(const b of all)for(const t of b.loaded.manifest.targets){must(!ids.has(t.entity_id)&&!hosts.has(host(t.website_url)),'queue2_owner_or_host_overlap');ids.add(t.entity_id);hosts.add(host(t.website_url));}
 must(Array.isArray(c.reviewReceipts)&&c.reviewReceipts.length>=3,'missing_independent_reviews');
 for(const b of c.batches){const reviews=c.reviewReceipts.filter(x=>x.manifestHash===b.hash);must(reviews.length>0,'batch_review_missing');for(const r of reviews){must(/^[a-z0-9][a-z0-9._/-]*\.json$/.test(r.file)&&!r.file.split('/').includes('..'),'unsafe_review_path');pinned(path.join(base,r.file),r.sha256);const doc=read(path.join(base,r.file));must(String(doc.result||doc.status||'').toLowerCase()==='pass'&&(doc.manifest_sha256||doc.manifestHash)===b.hash,'review_receipt_not_pass');}}
 return all;
}
function terminalReceipt(base,b,queueName,quiet={}){
 const dir=path.join(base,queueName,b.tag),proof=terminal(base,b,quiet),done=read(path.join(dir,'terminal.json'));
 must(done.terminal===true&&done.tag===b.tag&&done.manifestHash===b.hash&&done.summary_sha256===proof.summary_sha256&&done.checkpoint_sha256===proof.checkpoint_sha256,'terminal_receipt_changed');
 for(const [file,key]of [['after.json','after_sha256'],['attempt.json','attempt_sha256'],['invocation.json','invocation_sha256']])pinned(path.join(dir,file),done[key]);
 const attempt=read(path.join(dir,'attempt.json')),invocation=read(path.join(dir,'invocation.json')),exit=read(path.join(dir,'run.exit.json'));
 must(attempt.tag===b.tag&&attempt.manifestHash===b.hash&&invocation.manifestHash===b.hash&&invocation.run===true&&invocation.retryFailed===false&&invocation.priorAttempts===0,'terminal_invocation_changed');
 if(queueName===QUEUE){
  must(done.configHash===attempt.configHash&&invocation.configHash===attempt.configHash,'terminal_config_changed');
  const pf=path.join(dir,'predecessor-fresh-after.json');pinned(pf,invocation.predecessor_database_sha256);
  const saved=read(pf);must(saved.at&&Date.parse(saved.at)>=Date.parse(attempt.reservedAt),'saved_predecessor_proof_not_fresh');
  validateAfter(saved,{hash:attempt.predecessor.manifestHash},attempt.predecessor);
 }
 must(exit.signal===null&&[0,1].includes(exit.exitCode)&&(exit.exitCode===0||proof.partial),'terminal_exit_unproved');
 validateAfter(read(path.join(dir,'after.json')),b,proof);return{...proof,terminal_receipt_sha256:sha(fs.readFileSync(path.join(dir,'terminal.json')))};
}
function queue1State(base,{pidCheck=livePid,workers=activeWorkers}={}){
 const dir=path.join(base,'finite-product-queue-v1'),lf=path.join(dir,'queue.lock');
 if(fs.existsSync(lf)){must(pidCheck(read(lf).pid),'stale_queue1_lock_requires_review');return'waiting';}
 if(workers().length)return'waiting';
 const ef=path.join(dir,'events.ndjson');must(fs.existsSync(ef),'queue1_completion_event_missing');const events=fs.readFileSync(ef,'utf8').trim().split('\n').map(JSON.parse),last=events.at(-1);
 must(last?.event==='finite_queue_complete'&&last.batches===3,'queue1_not_terminal_complete');return'terminal';
}
function freshAfter(doc,b,proof,startedAt){validateAfter(doc,b,proof);must(doc.targetCount===b.targets&&Number.isFinite(Date.parse(doc.at))&&Date.parse(doc.at)>=startedAt&&Date.parse(doc.at)<=Date.now()+60000,'fresh_database_proof_required');}
function reserve(dir,b,predecessor,configHash){fs.mkdirSync(dir,{recursive:true,mode:0o700});must(!fs.existsSync(path.join(dir,'attempt.json')),'batch_already_attempted');receipt(path.join(dir,'attempt.json'),{scope:QUEUE,tag:b.tag,manifestHash:b.hash,configHash,reservedAt:new Date().toISOString(),pid:process.pid,predecessor});}
async function execute({base,helpers,configHash,control,command,workers=activeWorkers,pidCheck=livePid,wait=ms=>new Promise(r=>setTimeout(r,ms)),applyLockPath=path.join(ROOT,'.state/my-coffee-explorer/apply.lock'),verify=loadConfig}){
 const dir=path.join(base,QUEUE);fs.mkdirSync(dir,{recursive:true,mode:0o700});const lock=ownLock(path.join(dir,'queue.lock')),events=path.join(dir,'events.ndjson'),started=Date.now();let applyLock;
 const quiet={activeWorkers:workers,livePid:pidCheck};
 try{
  const frozen=verify(base,helpers,configHash);journal(events,{event:'queue_started',pid:process.pid,configHash});
  control.deadline=setTimeout(()=>{control.stopped=true;control.terminate?.();},LIMITS.maxQueueMs);control.deadline.unref();
  while(queue1State(base,{pidCheck,workers})==='waiting'){must(!control.stopped&&Date.now()-started<LIMITS.maxWaitMs,'predecessor_wait_expired');await wait(10000);}
  let previous=frozen.batches[0],previousQueue='finite-product-queue-v1';
  for(const b of frozen.batches.slice(1)){
   must(!control.stopped&&Date.now()-started<LIMITS.maxQueueMs,'queue2_stopped');lock.check();verify(base,helpers,configHash);queue1State(base,{pidCheck,workers});
   const previousProof=terminalReceipt(base,previous,previousQueue,quiet),bd=path.join(dir,b.tag),attempt=path.join(bd,'attempt.json');
   if(fs.existsSync(attempt)){
    must(read(attempt).configHash===configHash,'attempt_configuration_changed');must(fs.existsSync(path.join(bd,'terminal.json')),'prior_attempt_requires_review');
    terminalReceipt(base,b,QUEUE,quiet);journal(events,{event:'already_attempted_terminal_skip',tag:b.tag});previous=b;previousQueue=QUEUE;continue;
   }
   must(!['checkpoint.json','summary.json','runner.lock'].some(f=>fs.existsSync(path.join(outDir(base,b),f))),'unowned_prior_attempt');
   applyLock=ownLock(applyLockPath);reserve(bd,b,previousProof,configHash);journal(events,{event:'batch_reserved',tag:b.tag,manifestHash:b.hash});
   // A local success file alone is never authority to start the successor.
   const previousFile=path.join(base,previous.tag,'manifest.json'),previousAudit=path.join(bd,'predecessor-fresh-after.json'),freshStarted=Date.now();
   let result=await command([path.join(helpers,'product-seed-result-audit.cjs'),previousFile,previousAudit,'after'],b.tag+'/predecessor-fresh-after',120000);
   must(result.exitCode===0&&!result.signal,'predecessor_database_command_failed');freshAfter(read(previousAudit),previous,previousProof,freshStarted);
   const before=path.join(bd,'before.json'),previewDir=path.join(bd,'preview'),mf=path.join(base,b.tag,'manifest.json');
   result=await command([path.join(helpers,'product-seed-result-audit.cjs'),mf,before,'before'],b.tag+'/before',120000);must(result.exitCode===0&&!result.signal,'before_command_failed');validateBefore(read(before),b);
   result=await command([path.join(helpers,'product-only-crawl.cjs'),'--manifest',mf,'--output-dir',previewDir],b.tag+'/preview',300000);must(result.exitCode===0&&!result.signal,'preview_command_failed');validatePreview(read(path.join(previewDir,'preview.json')),b);
   applyLock.check();lock.check();verify(base,helpers,configHash);terminalReceipt(base,previous,previousQueue,quiet);must(queue1State(base,{pidCheck,workers})==='terminal'&&!control.stopped,'queue2_interrupted');
   receipt(path.join(bd,'invocation.json'),{manifestHash:b.hash,configHash,at:new Date().toISOString(),run:true,retryFailed:false,priorAttempts:0,predecessor_database_sha256:sha(fs.readFileSync(previousAudit))});
   applyLock.release();applyLock=null;
   receipt(path.join(bd,'preflight-lock-released.json'),{at:new Date().toISOString(),manifestHash:b.hash,globalPreflightLockReleased:true,queueLockRetained:true});
   result=await command([path.join(helpers,'product-only-crawl.cjs'),'--manifest',mf,'--run'],b.tag+'/run',LIMITS.maxRunMs);
   must(!control.stopped&&!result.signal&&[0,1].includes(result.exitCode),'runner_interrupted_or_failed');const proof=terminal(base,b,quiet);must(result.exitCode===0||proof.partial,'exit_code_summary_mismatch');
   const afterStart=Date.now();result=await command([path.join(helpers,'product-seed-result-audit.cjs'),mf,path.join(bd,'after.json'),'after'],b.tag+'/after',120000);must(result.exitCode===0&&!result.signal,'after_command_failed');freshAfter(read(path.join(bd,'after.json')),b,proof,afterStart);
   receipt(path.join(bd,'terminal.json'),{...proof,tag:b.tag,terminal:true,configHash,after_sha256:sha(fs.readFileSync(path.join(bd,'after.json'))),attempt_sha256:sha(fs.readFileSync(attempt)),invocation_sha256:sha(fs.readFileSync(path.join(bd,'invocation.json')))});
   journal(events,{event:'batch_terminal',tag:b.tag,partial:proof.partial});previous=b;previousQueue=QUEUE;
  }
  journal(events,{event:'finite_queue_complete',batches:3});return{status:'complete',batches:3,launchedRetries:0};
 }catch(e){journal(events,{event:'queue_stopped_for_review',code:String(e.code||'queue2_error').replace(/[^a-zA-Z0-9_:-]/g,'').slice(0,100)});throw e;}
 finally{clearTimeout(control.deadline);if(applyLock)applyLock.release();lock.release();}
}
async function main(){const args=process.argv.slice(2);if(args[0]==='--check'&&args.length===3){const result=loadConfig(path.resolve(args[1]),__dirname,args[2]);console.log(JSON.stringify({mode:'offline',networkRequests:0,databaseCalls:0,launched:false,configHash:result.configHash,batches:result.config.batches}));return;}
 must(args.length===2&&args[0]==='--run','usage_check_BASE_HASH_or_run_HASH');must(fs.realpathSync(__dirname)===HELPERS&&fs.realpathSync(process.cwd())===ROOT,'production_location_required');const control={stopped:false,child:null};for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{control.stopped=true;control.terminate?.();});
 const dir=path.join(STATE,QUEUE);fs.mkdirSync(dir,{recursive:true,mode:0o700});console.log(JSON.stringify(await execute({base:STATE,helpers:HELPERS,configHash:args[1],control,command:prior.commandFactory(dir,control)})));
}
if(require.main===module)main().catch(e=>{console.error(String(e.code||'queue2_failed').replace(/[^a-zA-Z0-9_:-]/g,'').slice(0,100));process.exitCode=1;});
module.exports={QUEUE,CONFIG,TAGS,LIMITS,HELPER_PINS,ROOT,STATE,HELPERS,sha,loadConfig,verifyConfiguration,terminalReceipt,queue1State,freshAfter,reserve,execute};
