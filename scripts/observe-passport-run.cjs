#!/usr/bin/env node
'use strict';
// Operator preparation only by default. Execution requires a reviewed SHA and
// a fresh source/legacy-weight preflight; this file never installs source.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {AsyncLocalStorage}=require('node:async_hooks');
const {installReaderObservation,installVisitObservation}=require('./passport-observation.cjs');
const OWNER='c978d995-9310-4c54-945b-5211ccdddf7a';
async function main(argv=process.argv.slice(2)) {
  if(!argv.includes('--execute-reviewed-crawl')) {
    process.stdout.write(JSON.stringify({prepared_only:true,crawl_started:false,production_writes:0,model_calls:0,usage:'--execute-reviewed-crawl --repo TESTED_CHECKOUT --runtime-repo ORIGINAL_CHECKOUT --sha REVIEWED_SHA --preflight PRIVATE_JSON --output NEW_PRIVATE_DIRECTORY'})+'\n');return;
  }
  const arg=name=>argv[argv.indexOf(name)+1],repo=path.resolve(arg('--repo')||''),runtime=path.resolve(arg('--runtime-repo')||''),expected=arg('--sha'),preflightPath=arg('--preflight'),output=arg('--output');
  for(const flag of ['--repo','--runtime-repo','--sha','--preflight','--output'])if(!argv.includes(flag)||!arg(flag)||arg(flag).startsWith('--'))throw Error('Missing '+flag);
  const git=(cwd,args)=>cp.execFileSync('git',args,{cwd,encoding:'utf8'}).trim(),hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if(!/^[a-f0-9]{40}$/.test(expected)||git(repo,['rev-parse','HEAD'])!==expected||git(repo,['status','--porcelain']))throw Error('Exact clean reviewed source required');
  const preflight=JSON.parse(fs.readFileSync(preflightPath));
  if(!preflight.passed||preflight.source_sha!==expected||preflight.owner_id!==OWNER||Date.now()-Date.parse(preflight.checked_at)>900000||Date.parse(preflight.checked_at)>Date.now()||!Number.isFinite(Date.parse(preflight.checked_at))||!Array.isArray(preflight.collisions)||preflight.collisions.length||!Array.isArray(preflight.existing_running_runs)||preflight.existing_running_runs.length||preflight.reconcile_omissions!==false||preflight.inventory_authorizes_global_absence!==false)throw Error('Fresh matching read-only compatibility preflight required');
  for(const line of fs.readFileSync(runtime+'/.env','utf8').split(/\r?\n/)){
    const m=line.match(/^\s*(?:export\s+)?([A-Za-z_][\w]*)=(.*)$/);if(!m)continue;let value=m[2].trim();if((value[0]==='"'&&value.at(-1)==='"')||(value[0]==="'"&&value.at(-1)==="'"))value=value.slice(1,-1);process.env[m[1]]=value;
  }
  if(Number(process.env.PARALLEL_ROASTERS||1)!==1||Number(process.env.CRAWLER_PAGE_CONCURRENCY||1)!==1)throw Error('Expected preserved single-worker/page settings');
  const target=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);if(target.hostname!=='gtlipifdfyugiwpxvuse.supabase.co')throw Error('Unexpected catalog project');
  const profile=require(repo+'/src/siteSupport/profiles.json').find(p=>p.name==='Passport');
  if(!profile?.entity_ids.includes(OWNER)||profile.reconcile_omissions!==false||profile.inventory_authorizes_global_absence!==false)throw Error('Passport owner/omission guards changed');
  const lock=Number(fs.readFileSync(runtime+'/.crawler.lock/pid','utf8').trim()),processes=cp.execFileSync('ps',['-ax','-o','pid=,ppid=,command='],{encoding:'utf8'}).split('\n').map(l=>l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean),nodes=processes.filter(p=>Number(p[2])===lock&&/\/node index\.js$/.test(p[3]));
  if(nodes.length!==1)throw Error('Expected existing single scheduler-owned worker');
  const plist=process.env.HOME+'/Library/LaunchAgents/com.openclaw.coffee-roaster-crawler.plist';
  const preserved={runtime_sha:git(runtime,['rev-parse','HEAD']),runtime_branch:git(runtime,['branch','--show-current']),scheduler_lock_pid:lock,scheduler_node_pid:Number(nodes[0][1]),runtime_env_sha256:hash(runtime+'/.env'),runtime_plist_sha256:hash(plist),runtime_launcher_sha256:hash(runtime+'/run-crawler.sh')};
  const secretValues=[process.env.SUPABASE_SERVICE_ROLE_KEY,process.env.OPENAI_API_KEY].filter(Boolean),redact=text=>secretValues.reduce((s,v)=>s.split(v).join('[redacted]'),String(text)).replace(/sk-(?:proj-)?[A-Za-z0-9_-]{12,}/g,'[redacted]');
  process.umask(0o077);fs.mkdirSync(output,{mode:0o700});
  const put=(name,value)=>fs.writeFileSync(path.join(output,name),redact(JSON.stringify(value,null,2)),{flag:'wx',mode:0o600});
  put('preflight.json',preflight);put('preservation.json',preserved);
  const originalFetch=global.fetch;
  async function rows(table,params) {
    const result=[];for(let offset=0;;offset+=500){const url=new URL('/rest/v1/'+table,target);for(const[k,v]of Object.entries({...params,order:params.order||'id.asc',limit:'500',offset:String(offset)}))url.searchParams.set(k,v);
      const response=await originalFetch(url,{headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY},signal:AbortSignal.timeout(30000)});if(!response.ok){const error=await response.json().catch(()=>({}));throw Error('Catalog GET '+table+': HTTP '+response.status+' '+(error.code||''));}const page=await response.json();result.push(...page);if(page.length<500)return result;}
  }
  async function capture(){const [entities,roles,products,runs,known_pages]=await Promise.all([rows('entities',{select:'id,name,website_url',id:'eq.'+OWNER}),rows('entity_roles',{select:'entity_id,role',entity_id:'eq.'+OWNER,order:'entity_id.asc,role.asc'}),rows('products',{select:'*,product_variants(*),coffee_facts(*),product_media(*,media_assets(*))',entity_id:'eq.'+OWNER}),rows('crawl_runs',{select:'*',entity_id:'eq.'+OWNER}),rows('known_pages',{select:'id,url,status,last_fetched_at',entity_id:'eq.'+OWNER})]);return{checked_at:new Date().toISOString(),entities,roles,products,runs,known_pages};}
  const before=await capture();put('before.json',before);
  if(before.entities.length!==1||!before.roles.some(r=>r.role==='roaster')||before.runs.some(r=>r.status==='running'))throw Error('Passport owner/role/active-run gate failed');
  const state={source_sha:expected,started_at:new Date().toISOString(),mode:'full-normal-discovery-observed',max_roaster_concurrency:1,page_concurrency:1,process:{pid:process.pid,cwd:repo,scheduler_lock_pid:lock,scheduler_node_pid:Number(nodes[0][1]),max_roaster_jobs:2},discovery:[],visits:[],saves:[],source_pages:[],page_events:[],requests:[],omission_reconciliation_attempts:[],credential_stop_observed:false};
  put('process.json',state.process);const journal=path.join(output,'events.jsonl'),log=fs.createWriteStream(path.join(output,'crawl.log'),{flags:'wx',mode:0o600});let lastCheckpoint=0;
  function event(value){fs.appendFileSync(journal,redact(JSON.stringify({...value,observed_at:new Date().toISOString()}))+'\n',{mode:0o600});}
  function checkpoint(force=false){if(!force&&Date.now()-lastCheckpoint<1000)return;lastCheckpoint=Date.now();state.checked_at=new Date().toISOString();fs.writeFileSync(path.join(output,'checkpoint.json'),redact(JSON.stringify(state)),{mode:0o600});}
  const checkpointTimer=setInterval(()=>checkpoint(true),10000);checkpointTimer.unref();
  for(const method of ['log','info','warn','error'])console[method]=(...args)=>log.write(redact(args.map(a=>typeof a==='string'?a:JSON.stringify(a)).join(' '))+'\n');
  const modelScope=new AsyncLocalStorage();
  global.fetch=async(...args)=>{
    const value=args[0],url=String(value?.url||value?.href||value),entry={at:new Date().toISOString(),url,method:args[1]?.method||value?.method||'GET',status:null,classification_scope:modelScope.getStore()||null};state.requests.push(entry);
    try{const response=await originalFetch(...args);entry.status=response.status;entry.response_headers=Object.fromEntries(['retry-after','date','content-type'].map(n=>[n,response.headers.get(n)]));
      if(new URL(url).hostname==='api.openai.com'){const body=await response.clone().json().catch(()=>({}));entry.model_response={http_status:response.status,finish_reason:body.choices?.[0]?.finish_reason||null,content_chars:body.choices?.[0]?.message?.content?.length||0,usage:body.usage||null,error_code:body.error?.code||null};if([401,403].includes(response.status)||body.error?.code==='insufficient_quota')state.credential_stop_observed=true;}
      return response;
    }catch(error){entry.error=redact(error.message);throw error;}finally{event({kind:'wire_response',request:entry});checkpoint();}
  };
  const network=require(repo+'/src/siteSupport/network');installReaderObservation(network,{state,redact,onChange:e=>{event(e);checkpoint();}});
  const logger=require(repo+'/src/logger'),scoped=logger.createScopedLogger;
  logger.createScopedLogger=(...args)=>{const original=scoped(...args);return new Proxy(original,{get(target,key){const method=target[key];if(typeof method!=='function')return method;return(...values)=>{const[context,message,data]=values;if(context==='Visitor'||data?.url&&(data.error||data.deferred||/error|defer|incomplete/i.test(message||''))){const entry={at:new Date().toISOString(),level:key,context,message,data};state.page_events.push(entry);event({kind:'page_event',event:entry});}return method.apply(target,values);};}});};
  const discovery=require(repo+'/src/siteSupport/discovery'),discover=discovery.discoverSiteProducts;
  discovery.discoverSiteProducts=async(...args)=>{const result=await discover(...args),entry={entity_id:args[0].id,at:new Date().toISOString(),result};state.discovery.push(entry);event({kind:'normal_discovery',observation:entry});checkpoint(true);return result;};
  const availability=require(repo+'/src/availability');availability.reconcileRoasterAvailability=async options=>{state.omission_reconciliation_attempts.push({entity_id:options.entityId,at:new Date().toISOString()});event({kind:'blocked_omission_reconciliation',entity_id:options.entityId});throw Error('Passport observer forbids omission reconciliation');};
  const classifier=require(repo+'/src/gptClassifier'),classify=classifier.classifyPage;classifier.classifyPage=(...args)=>modelScope.run({url:args[1]},()=>classify(...args));
  const extraction=require(repo+'/src/extraction'),extract=extraction.extractPage,normalize=require(repo+'/src/catalogNormalization').normalizeProduct;
  extraction.extractPage=async args=>{const structured=extraction.structuredExtraction(args.page,args.shopifyJson),entry={url:args.page.url,checked_at:new Date().toISOString(),source:structured.product?normalize(structured.product,args.page.url):null,native_variant_scope:args.shopifyJson?.data?.reviewedAccessorySubset||null};state.source_pages.push(entry);try{const result=await extract(args);Object.assign(entry,{mode:result.mode,ai_calls:result.aiCalls,usage:result.usage||null,error:result.error?redact(result.error):null,is_coffee:result.data?.is_coffee_page===true});return result;}catch(error){entry.thrown_error=redact(error.message);throw error;}finally{event({kind:'extraction',observation:entry});}};
  const saver=require(repo+'/src/productSaver'),save=saver.saveProduct;saver.saveProduct=async(entityId,product,url,log,options)=>{const entry={entity_id:entityId,url,checked_at:options?.checkedAt,normalized:normalize(product,url),availability:options?.availability};state.saves.push(entry);try{entry.id=await save(entityId,product,url,log,options);return entry.id;}catch(error){entry.error=redact(error.message);throw error;}finally{event({kind:'save',observation:entry});checkpoint(true);}};
  installVisitObservation(require(repo+'/src/pageVisitor'),{state,redact,onChange:e=>{event(e);checkpoint(true);}});
  process.chdir(repo);checkpoint(true);
  try{state.result=await require(repo+'/src/crawler').crawlRoaster(before.entities[0],await require(repo+'/src/blacklist').getBlacklistTerms());}catch(error){state.error=redact(error.message);}
  state.results=[{entity_id:OWNER,name:before.entities[0].name,started_at:state.started_at,finished_at:new Date().toISOString(),result:state.result,error:state.error}];
  state.finished_at=new Date().toISOString();put('after.json',await capture());
  state.runtime_preserved=hash(runtime+'/.env')===preserved.runtime_env_sha256&&hash(plist)===preserved.runtime_plist_sha256&&hash(runtime+'/run-crawler.sh')===preserved.runtime_launcher_sha256&&git(runtime,['rev-parse','HEAD'])===preserved.runtime_sha&&Number(fs.readFileSync(runtime+'/.crawler.lock/pid','utf8').trim())===lock;
  state.source_preserved=git(repo,['rev-parse','HEAD'])===expected&&!git(repo,['status','--porcelain']);
  state.normal_run_succeeded=state.result?.success===true&&state.discovery.length===1&&state.discovery[0].result.complete===true&&!state.discovery[0].result.error&&state.visits.length===1&&state.visits[0].gate.successful&&state.saves.every(s=>s.id&&!s.error)&&!state.credential_stop_observed&&state.omission_reconciliation_attempts.length===0&&state.runtime_preserved&&state.source_preserved;
  state.full_catalog_readback_passed=false;
  clearInterval(checkpointTimer);checkpoint(true);put('receipt.json',state);await new Promise(resolve=>log.end(resolve));
  process.stdout.write(JSON.stringify({finished:true,normal_run_succeeded:state.normal_run_succeeded,full_catalog_readback_passed:false,source_sha:expected,discovered:state.discovery[0]?.result.urls?.length,metrics:state.visits[0]?.metrics,saved:state.saves.filter(s=>s.id&&!s.error).length,error:state.error||state.result?.error||null,omission_reconciliation_attempts:state.omission_reconciliation_attempts.length,runtime_preserved:state.runtime_preserved})+'\n');
  if(!state.normal_run_succeeded)process.exitCode=1;
}
if(require.main===module)main().catch(error=>{process.stderr.write(JSON.stringify({error:error.message})+'\n');process.exitCode=1;});
module.exports={main};
