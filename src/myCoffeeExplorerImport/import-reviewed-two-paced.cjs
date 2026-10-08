'use strict';
// Small, fixed-bundle adapter over the frozen plan11 persistence and comparison readers.
// No SDK, crawler, full snapshot, upsert, update, delete, retry or resume.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT='/Users/allan/.openclaw/workspace/coffee-roaster-crawler',STATE=ROOT+'/.state/my-coffee-explorer/2026-09-26';
const BASE=__dirname===ROOT+'/src/myCoffeeExplorerImport'?STATE:__dirname,TAG='reviewed-two-paced';
const PLAN_FILE='reviewed-public-brands-12/plan.json',PLAN_SHA='de5c7552a1fd3cd12bf8655b617d855683cb895dcd11af23a921ab4f9d7213a2';
const COMPARISON_FILE='compare-au79-letz-identities-ed9444fc-24be-4368-bb9b-cf0b50cc39f1/result.json',COMPARISON_SHA='f74a5da1a427652ce28774a2185696403a4a92e06e08e5cd39db906c2ebe72ab';
const CODE_PINS={'import-plan11-paced.cjs':'4897e42775e95c96da0bbc3ca7f06204739f5dd0c35c640f664e50c10745791e','compare-au79-letz-identities.cjs':'70cab23521d6336f9c9f0bcb564def65e746219fe711da14f6f1ea755ea6e89a'};
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),stamp=()=>new Date().toISOString();
function must(v,code){if(!v)throw Object.assign(Error(code),{code});}
function pinned(file,pin,base=BASE){const bytes=fs.readFileSync(path.join(base,file));must(sha(bytes)===pin,'pin_changed:'+file);return bytes;}
for(const[f,h]of Object.entries(CODE_PINS))pinned(f,h,__dirname);
const core=require('./import-plan11-paced.cjs'),comparison=require('./compare-au79-letz-identities.cjs');
const {same,sorted}=core,ORIGIN=core.ORIGIN,MAX_REQUESTS=80,MAX_POSTS=6,MAX_MS=180000,TTL_MS=600000;
const SPECS=[
 {id:'31258e66-c68c-5456-bf0d-0216632d7ef8',name:'AU79',slug:'au79',name_slug:'au79',website_url:'https://www.au79cafe.com.au/',primary_location:'Abbotsford VIC 3067'},
 {id:'fa9be25d-2d43-515d-8889-9f625efb3b41',name:'Lëtz Coffee',slug:'letz-coffee',name_slug:'letz-coffee',website_url:'https://letz.coffee/',primary_location:'Koetschette, Luxembourg'}
];
function validatePlan(p,scope){
 const {planHash,...body}=p;must(sha(JSON.stringify(body))===planHash&&p.source==='my_coffee_explorer','plan_hash_or_source');
 must(p.actions.length===2&&p.conflicts.length===0&&scope.candidates.length===2,'plan_scope');
 for(let i=0;i<2;i++){const a=p.actions[i],c=scope.candidates[i];must(a.action==='create'&&a.before===null&&same(a.entity,SPECS[i])&&a.entity_id===SPECS[i].id,'entity_scope');
  must(same(a.roles,['roaster'])&&same(a.newRoles,['roaster'])&&same(a.locations,[])&&same(a.patch,{})&&!Object.hasOwn(a,'crawlWebsite'),'mutation_scope');
  must(a.sources.length===1,'source_count');const s=a.sources[0],r=s.raw_data;
  must(s.source==='my_coffee_explorer'&&s.source_id===c.expected_source_key&&s.source_url==='https://mycoffeeexplorer.com/coffees','source_scope');
  must(r.sourceId===s.source_id&&r.name===a.entity.name&&r.websiteUrl===a.entity.website_url&&r.observedPrimaryLocation===a.entity.primary_location&&c.address.includes(a.entity.primary_location)&&same(r.observedPublicProducts,c.productEvidence)&&r.sourceBrandLabel===c.raw_source_name,'source_facts');
 }
}
function loadBundle(base=BASE){
 const plan=JSON.parse(pinned(PLAN_FILE,PLAN_SHA,base)),prior=JSON.parse(pinned(COMPARISON_FILE,COMPARISON_SHA,base)),scope=comparison.loadScope(base);validatePlan(plan,scope);
 must(prior.captureComplete&&prior.requests===3&&prior.writes===0&&prior.full_catalog_current===false&&same(prior.candidates,scope.candidates)&&same(prior.matched_owner_ids,[]),'targeted_comparison_binding');
 for(const kind of comparison.INITIAL)must(same(prior.state[kind],[]),'prior_probe_not_empty');
 const contexts=plan.actions.map((action,i)=>({action,names:scope.candidates[i].names,slugs:[...new Set([...scope.candidates[i].slugs,action.entity.slug])],hosts:[scope.candidates[i].host,scope.candidates[i].observed_contact_host],admittedIds:[],expected:Object.fromEntries(Object.keys(core.TABLES).map(k=>[k,[]]))}));
 return{plan,scope,contexts,prior,helperSha:sha(fs.readFileSync(__filename))};
}
function diag(e){return{code:String(e?.code||'stopped_review_required').replace(/[^A-Za-z0-9_:-]/g,'').slice(0,110),...(Number.isInteger(e?.httpStatus)?{httpStatus:e.httpStatus}:{}),...(/^[A-Z0-9]{1,16}$/.test(e?.dbCode||'')?{databaseCode:e.dbCode}:{})};}
// Both inherited clients share this admission/dispatch boundary and completion clock.
function createClients({bundle,key,allowWrites=false,delegate=globalThis.fetch.bind(globalThis),event=()=>{},checkLock=()=>{},now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 let active=false,stopped=false,last=null,current=null,controller=null,count=0,posts=0;const begun=now();
 const check=()=>must(!stopped&&now()-begun<MAX_MS,'adapter_stopped_or_deadline');
 const transport=async(input,init)=>{check();checkLock();const url=typeof input==='string'?input:input.url,method=init?.method||input.method||'GET';
  must(active&&current&&url===current.url&&method===current.method,'physical_dispatch_scope');
  if(method==='POST'){must(allowWrites&&posts<MAX_POSTS&&same(JSON.parse(init.body),current.body),'physical_post_scope');current.validateWrite();posts++;}
  must(count<MAX_REQUESTS,'request_budget');count++;
  const response=await delegate(input,{...init,signal:AbortSignal.any([init.signal,controller.signal].filter(Boolean))});
  must(response&&!response.redirected&&response.url===url,'exact_response_url');current.range=response.headers.get('content-range');return response;
 };
 const scopedEvent=family=>e=>{check();event({family,physical_request:count,...e});};
 const writes=core.createClient({key,allowWrites,delegate:transport,event:scopedEvent('plan11'),checkLock,now,wait});
 const probes=comparison.createReader({scope:bundle.scope,key,delegate:transport,event:scopedEvent('comparison'),checkLock,now,wait});
 async function call(d,fn){let admitted=false,timer;try{check();must(!active,'adapter_concurrent');active=true;admitted=true;current=d;
   while(last!==null&&now()-last<500){check();await wait(500-(now()-last));}check();checkLock();controller=new AbortController();
   timer=setTimeout(()=>controller.abort(),Math.min(20000,MAX_MS-(now()-begun)));const rows=await fn();check();
   if(d.method==='GET'){const m=/^(?:(\d+)-(\d+)|\*)\/(\d+|\*)$/.exec(current.range||'');must(m,'response_range');if(m[3]!=='*')must(Number(m[3])===(d.offset||0)+rows.length,'reported_total_incomplete');}return rows;
  }catch(e){stopped=true;throw e;}finally{clearTimeout(timer);if(admitted){active=false;last=now();current=null;controller=null;}}}
 return{get requests(){return count;},get posts(){return posts;},get stopped(){return stopped;},assertHealthy:check,
  request(kind,c,options={}){try{must(bundle.contexts.includes(c),'context_out_of_scope');validatePlan(bundle.plan,bundle.scope);const d=core.descriptor(kind,c,options);return call({...d,validateWrite:options.validateWrite},()=>writes.request(kind,c,options));}catch(e){stopped=true;return Promise.reject(e);}},
  probe(kind,offset=0){try{must(comparison.INITIAL.includes(kind),'probe_out_of_scope');return call(comparison.descriptor(kind,bundle.scope,offset),()=>probes.request(kind,offset));}catch(e){stopped=true;return Promise.reject(e);}}};
}
async function refreshProbes(client,bundle,completed=[]){
 const state={};for(const kind of comparison.INITIAL){const rows=await client.probe(kind);if(rows.length)must((await client.probe(kind,rows.length)).length===0,'nonempty_probe_continuation');comparison.validateRows(kind,rows,bundle.scope);state[kind]=rows;}
 const expected={nameHost:completed.flatMap(x=>x.after.entities),address:[],sourceProbe:completed.flatMap(x=>x.after.sources)};
 for(const kind of comparison.INITIAL)must(same(sorted(state[kind]),sorted(expected[kind])),'current_probe_drift:'+kind);return state;
}
function validatePreview(p,b,now=Date.now()){
 must(p?.status==='preview_complete'&&p.plan_sha256===PLAN_SHA&&p.helper_sha256===b.helperSha&&p.comparison_sha256===COMPARISON_SHA&&p.before.length===2&&p.writes===0,'preview_binding');
 must(now-Date.parse(p.at)>=0&&now-Date.parse(p.at)<TTL_MS,'preview_expired');
 for(const k of comparison.INITIAL)must(same(p.probes[k],[]),'preview_probe_drift');for(let i=0;i<2;i++)core.checkBefore(p.before[i],b.contexts[i]);
}
async function execute({bundle,client,mode='preview',preview,event=()=>{},checkLock=()=>{},now=Date.now}){
 must(mode==='preview'||mode==='apply','mode');validatePlan(bundle.plan,bundle.scope);if(mode==='apply')validatePreview(preview,bundle,now());
 const probes=await refreshProbes(client,bundle),before=[],completed=[];
 for(let i=0;i<2;i++){
  const c=bundle.contexts[i];if(mode==='apply'&&i)await refreshProbes(client,bundle,completed);
  const rows=await core.readContext(client,c);core.checkBefore(rows,c);before.push(rows);event({event:'owner_preflight_verified',entity_id:c.action.entity_id,rows});
  if(mode==='preview')continue;must(same(rows,preview.before[i]),'preview_context_changed');const inserted={},at=new Date(now()).toISOString();
  const authorize=()=>{validatePreview(preview,bundle,now());checkLock();};
  for(const[kind,key]of [['insertEntity','entity'],['insertRole','role'],['insertSource','source']]){authorize();const d=core.descriptor(kind,c,{at});inserted[key]=core.checkInserted(await client.request(kind,c,{at,validateWrite:authorize}),d.body);event({event:'post_returned_verified',entity_id:c.action.entity_id,kind,row:inserted[key]});}
  const after=await core.readContext(client,c,true);core.checkAfter(after,inserted);completed.push({entity_id:c.action.entity_id,after});event({event:'owner_complete',entity_id:c.action.entity_id,after});
 }
 if(mode==='apply'){for(const c of bundle.contexts){const after=await core.readContext(client,c,true);must(same(after,completed.find(x=>x.entity_id===c.action.entity_id).after),'final_target_drift');}await refreshProbes(client,bundle,completed);must(client.posts===6,'write_count');}
 client.assertHealthy();return{at:new Date(now()).toISOString(),status:mode==='preview'?'preview_complete':'complete',plan_sha256:PLAN_SHA,helper_sha256:bundle.helperSha,comparison_sha256:COMPARISON_SHA,requests:client.requests,writes:mode==='apply'?6:0,probes,before,...(mode==='apply'?{completed,verified:2,new_entities:2,roaster_roles:2,sources:2}:{}),full_catalog_current:false,automatic_crawl:false,limitations:'Targeted nontransactional identity checks and exact readback only; unknown aliases are not exhaustively excluded. Identity writers must remain paused. Any ambiguous or failed write requires separate reconciliation; no retry or resume.'};
}
function cli(a){if(!a.length||same(a,['--check']))return{mode:'check'};if(same(a,['--preview']))return{mode:'preview'};must(a.length===4&&a[0]==='--apply'&&/^[a-f0-9]{64}$/.test(a[2])&&a[3]==='--confirm-two-new-roasters-and-identity-writers-paused','invalid_cli');return{mode:'apply',previewFile:a[1],previewSha:a[2]};}
function sync(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
async function main(args=process.argv.slice(2)){
 const opts=cli(args),bundle=loadBundle();if(opts.mode==='check'){console.log(JSON.stringify({status:'offline_check_pass',plan_sha256:PLAN_SHA,owners:2,max_posts:6,max_requests:MAX_REQUESTS,max_ms:MAX_MS,requests:0}));return;}
 must(fs.realpathSync(process.cwd())===ROOT&&fs.realpathSync(__dirname)===ROOT+'/src/myCoffeeExplorerImport'&&fs.realpathSync(STATE)===STATE,'production_runtime_required');must([ORIGIN,ORIGIN+'/'].includes(process.env.NEXT_PUBLIC_SUPABASE_URL),'database_origin');const key=process.env.SUPABASE_SERVICE_ROLE_KEY;must(typeof key==='string'&&key.length>20&&!/\s/.test(key),'credentials_missing');let preview;
 if(opts.mode==='apply'){const f=fs.realpathSync(opts.previewFile);must(path.dirname(path.dirname(f))===STATE&&new RegExp('^'+TAG+'-preview-[a-f0-9-]{36}$').test(path.basename(path.dirname(f)))&&path.basename(f)==='result.json','preview_path');const bytes=fs.readFileSync(f);must(sha(bytes)===opts.previewSha,'preview_hash');preview=JSON.parse(bytes);validatePreview(preview,bundle);}
 const lock=core.acquireLock(ROOT+'/.state/my-coffee-explorer/apply.lock'),dir=STATE+'/'+TAG+(opts.mode==='apply'?'-apply':'-preview-'+crypto.randomUUID()),oldTls=process.env.NODE_TLS_REJECT_UNAUTHORIZED;let fd,client;
 try{fs.mkdirSync(dir,{mode:0o700});sync(STATE);comparison.save(dir+'/reservation.json',{at:stamp(),mode:opts.mode,helper_sha256:bundle.helperSha,plan_sha256:PLAN_SHA,comparison_sha256:COMPARISON_SHA,preview_sha256:opts.previewSha||null,max_posts:6,retries:0});fd=fs.openSync(dir+'/events.ndjson','wx',0o600);fs.fsyncSync(fd);sync(dir);let failed=false;
  const event=e=>{must(!failed,'journal_latched_stop');try{lock.check();const bytes=Buffer.from(JSON.stringify({at:stamp(),...e})+'\n');let n=0;while(n<bytes.length){const k=fs.writeSync(fd,bytes,n,bytes.length-n);must(k>0,'journal_stalled');n+=k;}fs.fsyncSync(fd);}catch(e){failed=true;throw e;}};
  process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';client=createClients({bundle,key,allowWrites:opts.mode==='apply',event,checkLock:lock.check});const result=await execute({bundle,client,mode:opts.mode,preview,event,checkLock:lock.check});comparison.save(dir+'/result.json',result);console.log(JSON.stringify({status:result.status,directory:dir,requests:result.requests,writes:result.writes,sha256:sha(fs.readFileSync(dir+'/result.json'))}));
 }catch(e){if(fd!==undefined)try{comparison.save(dir+'/failure.json',{at:stamp(),status:'stopped_review_required',error:diag(e),requests:client?.requests,post_dispatches:client?.posts,no_retry_or_resume:true,warning:'A dispatched POST may have committed. Preserve its intent and returned evidence; reconcile separately without replay.'});}catch{}throw e;}
 finally{if(fd!==undefined)fs.closeSync(fd);if(oldTls===undefined)delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;else process.env.NODE_TLS_REJECT_UNAUTHORIZED=oldTls;lock.release();}
}
module.exports={ROOT,STATE,BASE,TAG,ORIGIN,PLAN_FILE,PLAN_SHA,COMPARISON_FILE,COMPARISON_SHA,CODE_PINS,SPECS,MAX_REQUESTS,MAX_MS,TTL_MS,sha,same,loadBundle,validatePlan,createClients,refreshProbes,validatePreview,execute,cli,main};
if(require.main===module)main().catch(e=>{console.error(JSON.stringify(diag(e)));process.exitCode=1;});
