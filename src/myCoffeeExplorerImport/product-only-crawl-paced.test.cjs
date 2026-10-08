'use strict';
// All production modules, fetch and file faults are isolated fixtures. No network.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const original=require('./product-only-crawl.cjs'),paced=require('./product-only-crawl-paced.cjs'),network=require('./product-only-network.cjs');
const {createDatabaseFetchGate}=require('./product-db-fetch-gate.cjs');
const ROOT=__dirname,ORIGIN=original.DB_ORIGIN,ID='11111111-1111-4111-8111-111111111111',SECOND='22222222-2222-4222-8222-222222222222',EXCLUDED='33333333-3333-4333-8333-333333333333';
function fixture(t){
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mce-paced-test-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const owners=[ID,SECOND].map((id,i)=>({entity_id:id,website_url:'https://example'+(i+1)+'.com/',source_ids:[{source:'my_coffee_explorer',source_id:'fixture-'+i}]}));
  const observations=owners.map(o=>o.website_url+'products/coffee');
  const m={version:1,scope:original.SCOPE,database_origin:ORIGIN,inventory_complete:false,concurrency:1,created_at:'2026-09-27T00:00:00.000Z',excluded_entity_count:1,artifacts:[],targets:owners.map((o,i)=>({...o,owner_evidence:{artifact_id:'owners',pointer:'/'+i},products:[{url:observations[i],observation:{artifact_id:'observations',pointer:'/'+i}}]}))};
  for(const [id,kind,data]of[['owners','ownership',owners],['observations','observations',observations],['excluded','excluded_targets',[{entity_id:EXCLUDED}]]]){
    const bytes=JSON.stringify(data),name=id+'.json';fs.writeFileSync(path.join(dir,name),bytes);m.artifacts.push({id,kind,path:name,format:'json',sha256:original.sha(bytes)});
  }
  const manifest=path.join(dir,'manifest.json'),out=path.join(dir,'output'),root=path.join(dir,'crawler');fs.mkdirSync(root);fs.writeFileSync(manifest,JSON.stringify(m));
  return{dir,manifest,out,root,m,options:{manifest,outputDir:out,crawlerRoot:root,run:true},checkpoint:()=>JSON.parse(fs.readFileSync(path.join(out,'checkpoint.json')))};
}
function isolated(f,scenario={}){
  const state={requests:[],clients:[],visits:[],singletonCalls:0,clock:0,guardRemoved:0,checkpointFaults:0,gate:null};
  const data={entities:f.m.targets.map(t=>({id:t.entity_id,name:'Fixture',website_url:t.website_url})),entity_roles:f.m.targets.map(t=>({entity_id:t.entity_id,role:'roaster'})),entity_crawl_state:[],entity_source_ids:f.m.targets.flatMap(t=>t.source_ids.map(s=>({...s,entity_id:t.entity_id}))),crawl_runs:[],products:[],known_pages:[],product_variants:[]};
  const fakeFs=new Proxy(fs,{get(o,k){if(k==='renameSync')return(from,to)=>{if(to===path.join(f.out,'checkpoint.json')&&scenario.checkpointFault?.(JSON.parse(fs.readFileSync(from)),state)){state.checkpointFaults++;throw Object.assign(Error('fixture disk'),{code:'EIO'});}return fs.renameSync(from,to);};return o[k];}});
  const delegate=async(request)=>{
    const u=new URL(request.url),table=u.pathname.split('/').pop(),query=JSON.parse(u.searchParams.get('fixture')),method=request.method;
    const payload=method==='GET'?null:JSON.parse(await request.text()),event={table,method,query,payload,at:state.clock};state.requests.push(event);
    const fault=scenario.fault?.(event,state,data);
    if(fault?.throw)throw Object.assign(Error('fixture network'),{code:'ECONNRESET'});
    if(fault)return new Response(JSON.stringify(fault.body||{code:fault.code}),{status:fault.status||400,headers:{'content-type':'application/json'}});
    let found=(data[table]||[]).filter(r=>query.filters.every(([op,k,v])=>op==='contains'?Object.entries(v).every(([a,b])=>r[k]?.[a]===b):r[k]===v));
    if(method==='POST'){
      const record={...payload};if(!record.id)record.id=table==='crawl_runs'?'claim-'+(data.crawl_runs.length+1):'product-'+(data.products.length+1);
      data[table] ||= [];data[table].push(record);found=[record];
    }else if(method==='PATCH'){for(const row of found)Object.assign(row,payload);}
    if(query.limit!==null)found=found.slice(0,query.limit);
    const result=query.single?found[0]||null:found;
    return new Response(JSON.stringify(result),{status:method==='POST'?201:200,headers:{'content-type':'application/json'}});
  };
  const singleton={getSupabase(){state.singletonCalls++;throw Error('singleton must not be used');}};
  function createClient(url,key,options){
    assert.equal(url,ORIGIN);assert.equal(key,'fixture-secret-not-written');assert.equal(typeof options.global.fetch,'function');state.clients.push({url,auth:options.auth});
    return{from(table){
      const q={filters:[],limit:null,single:false};let method='GET',body;
      return{select(){return this;},eq(k,v){q.filters.push(['eq',k,v]);return this;},contains(k,v){q.filters.push(['contains',k,v]);return this;},limit(n){q.limit=n;return this;},single(){q.single=true;return this;},
        insert(b){method='POST';body=b;return this;},update(b){method='PATCH';body=b;return this;},upsert(b){method='POST';body=b;return this;},
        then(ok,bad){const u=new URL(ORIGIN+'/rest/v1/'+table);u.searchParams.set('fixture',JSON.stringify(q));
          return options.global.fetch(u,{method,...(body?{body:JSON.stringify(body)}:{})}).then(async response=>{const parsed=await response.json();return response.ok?{data:parsed,error:null}:{data:null,error:parsed};}).then(ok,bad);}
      };
    }};
  }
  const classifier={classifyPage:async()=>({success:true,data:{is_coffee_page:false}})},http={hasProxies:()=>false};
  class Accumulator{addUrl(){}}
  const visitor=async(entity,url)=>{
    state.visits.push(entity);
    if(scenario.visitor)return scenario.visitor({entity,url,db:singleton.getSupabase(),state,data});
    return{classified:true,isCoffee:false};
  };
  const safeRequire=id=>{
    if(id==='node:fs')return fakeFs;
    if(id==='./legal-guard.cjs')return{assertAllowedUrl:()=>{},installLegalGuard:()=>({stats:{},uninstall(){state.guardRemoved++;}})};
    if(id==='./product-only-network.cjs')return{...network,createTransport:({context})=>({fetchHtml:async()=>{
      if(scenario.accessHold&&context().target.entity_id===ID){context().hardStop='authentication_or_access_denied';return{success:false,error:'authentication_or_access_denied'};}
      return{success:true,data:'<html>coffee</html>'};
    }})};
    if(id==='./product-db-fetch-gate.cjs')return{createDatabaseFetchGate:(delegate,options)=>{
      state.gate=createDatabaseFetchGate(delegate,{...options,now:()=>state.clock,wait:async ms=>{state.clock+=ms;}});return state.gate;
    }};
    if(id===path.join(f.root,'src/config.js'))return scenario.wrongConfig?{supabase:{url:ORIGIN}}:{config:{supabase:{url:scenario.wrongOrigin?'https://other.invalid':ORIGIN,serviceRoleKey:'fixture-secret-not-written'}}};
    if(id===path.join(f.root,'src/supabase.js'))return singleton;
    if(id===path.join(f.root,'node_modules/@supabase/supabase-js'))return{createClient};
    if(id===path.join(f.root,'src/httpClient.js'))return http;
    if(id===path.join(f.root,'src/gptClassifier.js'))return classifier;
    if(id===path.join(f.root,'src/pageVisitor.js'))return{visitAndClassifyPage:visitor};
    if(id===path.join(f.root,'src/urlAccumulator.js'))return{UrlAccumulator:Accumulator};
    if(id.startsWith('node:'))return require(id);
    throw Error('Unexpected fixture module: '+id);
  };
  safeRequire.cache={};safeRequire.resolve=id=>id;
  const sandbox={require:safeRequire,module:{exports:{}},Buffer,URL,Request,Response,AbortController,setTimeout,clearTimeout,console,process:{pid:process.pid,env:{NEXT_PUBLIC_SUPABASE_URL:ORIGIN}},fetch:delegate};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT,'product-only-crawl-paced.cjs'),'utf8'),sandbox,{filename:'product-only-crawl-paced.cjs'});
  return{run:()=>sandbox.module.exports.run(f.options),api:sandbox.module.exports,state,data,delegate,sandbox};
}
function writes(s,table,method){return s.requests.filter(r=>r.table===table&&r.method===method);}
function assertStop(f,summary,code){assert.equal(summary.globalStop,code);assert.equal(summary.targets[1].status,'not_attempted_after_stop');assert.equal(f.checkpoint().batchStop.code,code);assert.equal(JSON.parse(fs.readFileSync(path.join(f.out,'batch-stop.json'))).code,code);}
test('production {config} export initializes one isolated client before visitor; all traffic is paced',async t=>{
  const f=fixture(t),h=isolated(f),before=globalThis.fetch,s=await h.run();assert.equal(h.state.clients.length,1);assert.equal(h.state.singletonCalls,0);
  assert.equal(JSON.stringify(h.state.clients[0].auth),JSON.stringify({persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}));
  assert.deepEqual(Array.from(s.targets,x=>x.status),['complete','complete']);assert.equal(writes(h.state,'crawl_runs','POST').length,2);assert.equal(writes(h.state,'crawl_runs','PATCH').length,2);
  for(let i=1;i<h.state.requests.length;i++)assert.ok(h.state.requests[i].at-h.state.requests[i-1].at>=500);
  assert.equal(globalThis.fetch,before);assert.equal(h.sandbox.fetch,h.delegate);assert.equal(s.globalStop,null);assert.equal(h.state.guardRemoved,1);
});
test('preview uses same isolated gate but sends no claims, products or website requests',async t=>{const f=fixture(t),h=isolated(f);f.options.run=false;const s=await h.run();assert.equal(s.mode,'preview');assert.equal(h.state.requests.some(r=>r.method!=='GET'),false);assert.equal(h.state.visits.length,0);});
test('different config origin fails before first database request',async t=>{const f=fixture(t),h=isolated(f,{wrongOrigin:true});await assert.rejects(h.run(),/runtime_database_mismatch/);assert.equal(h.state.requests.length,0);});
test('nontransient swallowed variant error persists global stop before one healthy failed finalization',async t=>{
  const f=fixture(t);let laterWrite;
  const h=isolated(f,{fault:e=>{if(e.table==='crawl_runs'&&e.method==='PATCH')assert.equal(f.checkpoint().batchStop.code,'persistence_error_requires_review');return e.table==='product_variants'&&e.method==='POST'?{status:400,code:'22003'}:null;},
    visitor:async({entity,url,db})=>{
      const p=await db.from('products').insert({entity_id:entity,source_url:url,product_type:'coffee',slug:'coffee'}).select().single();
      await db.from('product_variants').insert({product_id:p.data.id,currency:'CAD',price_cents:144000});
      try{laterWrite=await db.from('known_pages').upsert({entity_id:entity,url,status:'coffee'},{onConflict:'entity_id,url'});}catch{}
      return{classified:true,isCoffee:true,productId:p.data.id};
    }});
  const s=await h.run();assertStop(f,s,'persistence_error_requires_review');assert.equal(h.state.visits.length,1);assert.equal(writes(h.state,'product_variants','POST').length,1);
  assert.equal(writes(h.state,'known_pages','POST').length,0);assert.equal(laterWrite,undefined);assert.equal(writes(h.state,'crawl_runs','PATCH').length,1);assert.equal(writes(h.state,'crawl_runs','PATCH')[0].payload.status,'failed');
  assert.equal(s.targets[0].results[0].partialPersistence,true);assert.equal(s.targets[0].results[0].persistenceErrors[0].code,'22003');
});
test('normal finalization failure is never retried by outer catch and stops later owners',async t=>{
  const f=fixture(t),h=isolated(f,{fault:e=>e.table==='crawl_runs'&&e.method==='PATCH'?{status:400,code:'22003'}:null});
  const s=await h.run();assertStop(f,s,'claim_finalization_failure_requires_review');assert.equal(writes(h.state,'crawl_runs','PATCH').length,1);assert.equal(f.checkpoint().claims[ID].status,'running');
});
test('ambiguous claim creation is not replayed and blocks every later owner',async t=>{
  const f=fixture(t),h=isolated(f,{fault:e=>e.table==='crawl_runs'&&e.method==='POST'?{status:400,code:'claim_response_invalid'}:null});
  const s=await h.run();assertStop(f,s,'claim_creation_failure_requires_review');assert.equal(writes(h.state,'crawl_runs','POST').length,1);assert.equal(writes(h.state,'crawl_runs','PATCH').length,0);assert.equal(h.state.visits.length,0);
});
test('transient gate stop during claim leaves it unresolved without finalization or queued dispatch',async t=>{
  const f=fixture(t),h=isolated(f,{fault:e=>e.table==='crawl_runs'&&e.method==='POST'?{status:503,code:'PGRST001'}:null});
  const s=await h.run();assertStop(f,s,'database_gate_stop_requires_review');assert.equal(writes(h.state,'crawl_runs','POST').length,1);assert.equal(writes(h.state,'crawl_runs','PATCH').length,0);
  assert.equal(s.databaseGate.stopped.http_status,503);assert.equal(h.state.visits.length,0);
});
test('transient GET from owner Promise.all drains pending requests without additional dispatch',async t=>{
  const f=fixture(t),h=isolated(f,{fault:e=>e.table==='entities'?{status:500,code:'57014'}:null});
  const s=await h.run();assertStop(f,s,'database_gate_stop_requires_review');assert.equal(h.state.requests.length,2);assert.equal(s.databaseGate.queued,0);assert.equal(s.databaseGate.active,0);
});
test('batch stop marker blocks preview/run/retry resume before any database schema call',async t=>{
  const f=fixture(t),h=isolated(f,{fault:e=>e.method==='POST'?{status:400,code:'22003'}:null});await h.run();
  for(const options of [{run:false},{run:true},{run:true,retryFailed:true}]){
    const fresh=isolated(f);await assert.rejects(fresh.api.run({...f.options,...options}),/checkpoint_batch_stop_requires_review/);assert.equal(fresh.state.requests.length,0);assert.equal(fresh.state.clients.length,0);
  }
});
test('checkpoint batch stop alone cannot be bypassed by retry flag',async t=>{
  const f=fixture(t),h=isolated(f);f.options.run=false;await h.run();
  fs.writeFileSync(path.join(f.out,'checkpoint.json'),JSON.stringify({version:1,scope:original.SCOPE,manifestHash:paced.loadManifest(f.manifest).manifestHash,claims:{},results:{},batchStop:{code:'review'}}));
  const fresh=isolated(f);await assert.rejects(fresh.api.run({...f.options,run:true,retryFailed:true}),/checkpoint_batch_stop_requires_review/);assert.equal(fresh.state.requests.length,0);
});
test('checkpoint failure after successful finish stops batch and never finalizes twice',async t=>{
  const f=fixture(t),h=isolated(f,{checkpointFault:(cp,s)=>cp.claims[ID]?.status==='complete'&&s.checkpointFaults===0});
  const s=await h.run();assert.equal(s.globalStop,'checkpoint_persistence_failure_requires_review');assert.equal(s.targets[1].status,'not_attempted_after_stop');
  assert.equal(writes(h.state,'crawl_runs','PATCH').length,1);assert.equal(writes(h.state,'crawl_runs','POST').length,1);
  const fresh=isolated(f);await assert.rejects(fresh.run(),/checkpoint_batch_stop_requires_review/);assert.equal(fresh.state.requests.length,0);
});
test('checkpoint failure immediately after claim does not issue any further DB mutation',async t=>{
  const f=fixture(t),h=isolated(f,{checkpointFault:(cp,s)=>!!cp.claims[ID]&&s.checkpointFaults===0});
  const s=await h.run();assert.equal(s.globalStop,'checkpoint_persistence_failure_requires_review');assert.equal(s.targets[1].status,'not_attempted_after_stop');
  assert.equal(writes(h.state,'crawl_runs','POST').length,1);assert.equal(writes(h.state,'crawl_runs','PATCH').length,0);assert.equal(h.state.visits.length,0);
});
test('source access hold remains owner-scoped while next owner completes',async t=>{
  const f=fixture(t),h=isolated(f,{accessHold:true}),s=await h.run();assert.equal(s.targets[0].status,'failed');assert.equal(s.targets[1].status,'complete');assert.equal(s.globalStop,null);assert.equal(fs.existsSync(path.join(f.out,'batch-stop.json')),false);assert.equal(writes(h.state,'crawl_runs','PATCH').length,2);
});
test('healthy completed checkpoint remains resumable without second claim or website visit',async t=>{
  const f=fixture(t),h=isolated(f);await h.run();const next=isolated(f),s=await next.run();assert.deepEqual(Array.from(s.targets,x=>x.status),['no_eligible_urls','no_eligible_urls']);assert.equal(writes(next.state,'crawl_runs','POST').length,0);assert.equal(next.state.visits.length,0);
});
test('new runner default output cannot share the historical default checkpoint directory',async t=>{
  const f=fixture(t),h=isolated(f);delete f.options.outputDir;f.options.run=false;await h.run();const suffix=paced.loadManifest(f.manifest).manifestHash.slice(0,12);
  assert.equal(fs.existsSync(path.join(f.dir,'product-only-paced-'+suffix,'preview.json')),true);assert.equal(fs.existsSync(path.join(f.dir,'product-only-'+suffix)),false);
});
test('ownership, source, mutation authorization, legal input and currency contracts are byte-equivalent functions',()=>{
  for(const key of ['loadManifest','validateOwner','normalizeCoffeeFacts','guardClassifierCurrency','guardedClient','authorizeProductMutation','backendFor'])assert.equal(paced[key].toString(),original[key].toString(),key);
});
test('transient product write latches gate and leaves existing claim unresolved without a finalization request',async t=>{
  const f=fixture(t),h=isolated(f,{fault:e=>e.table==='products'&&e.method==='POST'?{status:400,code:'57014'}:null,visitor:async({entity,url,db})=>{
    await db.from('products').insert({entity_id:entity,source_url:url,product_type:'coffee',slug:'coffee'}).select().single();return{classified:true,isCoffee:false};
  }});
  const s=await h.run();assertStop(f,s,'database_gate_stop_requires_review');assert.equal(writes(h.state,'products','POST').length,1);assert.equal(writes(h.state,'crawl_runs','PATCH').length,0);assert.equal(f.checkpoint().claims[ID].status,'running');assert.equal(s.targets[0].claimFinalizationError,'database_gate_stopped');
});
test('historical runner stays byte-identical',()=>{assert.equal(original.sha(fs.readFileSync(path.join(ROOT,'product-only-crawl.cjs'))),'a5adfd008dc68e031d7a26cc3ca47f5a9aac0a1ee9fa337ac7ab96ba83adccdf');});
