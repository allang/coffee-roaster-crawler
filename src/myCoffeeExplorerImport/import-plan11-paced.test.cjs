'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const h=require('./import-plan11-paced.cjs'),bundle=h.loadBundle(),clone=structuredClone;
function fixture(){
 const data={};for(const k of Object.keys(h.TABLES)){const all=bundle.contexts.flatMap(c=>c.expected[k]);data[k]=[...new Map(all.map(r=>[k==='roles'?r.entity_id+':'+r.role:r.id,r])).values()].map(r=>clone(r));}
 const calls=[],events=[];let time=1000,fault=()=>{},busy=0,maxBusy=0;
 const response=(rows,offset=0,status=200)=>new Response(JSON.stringify(rows),{status,headers:{'content-type':'application/json','content-range':rows.length?offset+'-'+(offset+rows.length-1)+'/*':'*/*'}});
 const delegate=async(url,init)=>{
  busy++;maxBusy=Math.max(maxBusy,busy);try{
   const u=new URL(url),kind=Object.keys(h.TABLES).find(k=>'/rest/v1/'+h.TABLES[k]===u.pathname),offset=Number(u.searchParams.get('offset')||0),body=init.body?JSON.parse(init.body):null;
   const id=body?.entity_id||body?.id||decodeURIComponent(url).match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/)?.[0],c=bundle.contexts.find(c=>c.action.entity_id===id);assert(c,'only frozen owner descriptors');
   calls.push({kind,method:init.method,id,body,start:time,url,init});const override=await fault({kind,method:init.method,c,offset,body,data,calls});if(override)return override;
   if(init.method==='POST'){
    const row={...clone(body),...(kind==='roles'?{}:{id:body.id||'new-source-'+id}),created_at:'2026-09-27T10:00:00Z'};data[kind].push(row);return response([row],0,201);
   }
   const after=u.searchParams.get('select')==='*',ids=new Set(after?[id]:[id,...c.admittedIds]);let rows=data[kind].filter(r=>{
    if(kind==='entities')return after?r.id===id:h.matchesEntity(r,c)||c.hosts.some(x=>String(r.website_url||'').toLowerCase().includes(x));
    if(kind==='sources')return ids.has(r.entity_id)||r.source==='my_coffee_explorer'&&r.source_id===c.action.sources[0].source_id;
    if(kind==='canonical')return r.attribute_key==='canonical_roaster_entity_id'&&(ids.has(r.entity_id)||ids.has(r.attribute_value));
    return ids.has(r.entity_id);
   });rows.sort((a,b)=>(a.id||a.entity_id+':'+a.role).localeCompare(b.id||b.entity_id+':'+b.role));rows=rows.slice(offset,offset+Number(u.searchParams.get('limit')));return response(rows.map(r=>after?clone(r):h.project(r,h.FIELDS[kind])),offset);
  }finally{busy--;}
 };
 const client=(allowWrites=false)=>h.createClient({key:'test-only-never-real',allowWrites,delegate,event:e=>events.push(e),now:()=>time,wait:async ms=>{time+=ms;}});
 return{data,calls,events,client,response,setFault:f=>fault=f,posts:()=>calls.filter(x=>x.method==='POST'),get maxBusy(){return maxBusy;}};
}
async function preview(f){return h.execute({bundle,client:f.client()});}
async function apply(f,p,extra={}){return h.execute({bundle,client:f.client(true),mode:'apply',preview:p,...extra});}
test('frozen bundle is create-only, excludes five held cases, and allows only reviewed baseline generic names',()=>{
 assert.equal(bundle.contexts.length,28);assert.equal(new Set(bundle.contexts.flatMap(c=>c.admittedIds)).size,161);
 assert(bundle.contexts.some(c=>c.expected.entities.some(e=>c.names.some(n=>h.norm(e.name)===h.norm(n)))));
 for(const c of bundle.contexts){assert.equal(c.action.action,'create');assert.equal(c.action.sources.length,1);assert.equal(c.action.locations.length,0);assert.equal(c.expected.entities.length,c.admittedIds.length);}
});
test('offline CLI is default and rejects resume, arbitrary base, missing explicit confirmation',()=>{
 assert.equal(h.cli([]).mode,'check');assert.equal(h.cli(['--check']).mode,'check');assert.equal(h.cli(['--preview']).mode,'preview');
 for(const x of [['--resume'],['apply','/tmp/x'],['--apply','x','0'.repeat(64),'yes']])assert.throws(()=>h.cli(x));
 assert.equal(h.cli(['--apply','x','0'.repeat(64),'--confirm-28-new-roasters-and-identity-writers-paused']).mode,'apply');
});
test('all generated descriptors have fixed HTTPS origin, read scopes, no count, upsert, update, delete or RPC',()=>{
 for(const c of bundle.contexts)for(const k of [...Object.keys(h.TABLES),'insertEntity','insertRole','insertSource']){
  const d=h.descriptor(k,c,k.startsWith('insert')?{at:'2026-09-27T10:00:00Z'}:{}),u=new URL(d.url);
  assert.equal(u.origin,h.ORIGIN);assert(['GET','POST'].includes(d.method));assert(u.pathname.startsWith('/rest/v1/'));assert(!u.searchParams.has('on_conflict'));assert(!u.searchParams.has('count'));
  if(d.method==='POST')assert(['entities','entity_roles','entity_source_ids'].some(t=>u.pathname==='/rest/v1/'+t));
 }
 assert.throws(()=>h.descriptor('delete',bundle.contexts[0]),/scope/);
});
test('host parsing rejects suffix lookalikes, accepts exact family and keeps raw source/official host distinctions',()=>{
 const c=bundle.contexts[0];assert.equal(h.matchesEntity({id:'x',website_url:'https://blackpearlcoffee.ca/'},c),false);assert.equal(h.matchesEntity({id:'x',website_url:'https://coffee.ca.evil.example/'},c),false);
 assert.equal(h.matchesEntity({id:'x',website_url:'https://www.coffee.ca/'},c),true);assert.equal(h.matchesEntity({id:'x',website_url:'https://shop.coffee.ca/'},c),true);
});
test('preview makes only paced sequential bounded GETs and preserves all admitted baseline rows',async()=>{
 const f=fixture(),p=await preview(f);assert.equal(p.status,'preview_complete');assert.equal(p.before.length,28);assert.equal(f.posts().length,0);assert.equal(f.maxBusy,1);assert(f.calls.length<300);
 for(let i=1;i<f.calls.length;i++)assert(f.calls[i].start-f.calls[i-1].start>=500);
});
test('apply makes exactly 84 one-row plain inserts, target readback28, no existing-field mutation or crawler targets',async()=>{
 const f=fixture(),p=await preview(f),old=clone(f.data);f.calls.length=0;const out=await apply(f,p);assert.equal(out.verified,28);assert.equal(out.writes,84);assert.equal(out.crawl_targets,0);assert.equal(f.posts().length,84);assert.equal(f.maxBusy,1);
 for(let i=0;i<84;i+=3){assert.deepEqual(f.posts().slice(i,i+3).map(x=>x.kind),['entities','roles','sources']);assert.equal(new Set(f.posts().slice(i,i+3).map(x=>x.id)).size,1);}
 for(const k of Object.keys(h.TABLES))for(const r of old[k])assert(f.data[k].some(x=>h.same(x,r)),'existing '+k+' preserved');
 assert.equal(f.data.locations.length,old.locations.length);assert.equal(f.data.canonical.length,old.canonical.length);
});
for(const[name,change]of[
 ['new ID', (f,c)=>f.data.entities.push({...c.action.entity})],
 ['new same-name identity',(f,c)=>f.data.entities.push({...c.action.entity,id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',slug:'other',name_slug:'other',website_url:null})],
 ['new exact slug identity',(f,c)=>f.data.entities.push({...c.action.entity,id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',name:'Other',website_url:null})],
 ['new official-host owner',(f,c)=>f.data.entities.push({...c.action.entity,id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',name:'Other',slug:'other',name_slug:'other'})],
 ['source on other owner',(f,c)=>f.data.sources.push({id:'x',entity_id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',...c.action.sources[0]})],
 ['incoming canonical link',(f,c)=>f.data.canonical.push({id:'x',entity_id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',attribute_key:'canonical_roaster_entity_id',attribute_value:c.action.entity_id,source:'other'})],
 ['outgoing canonical link',(f,c)=>f.data.canonical.push({id:'x',entity_id:c.action.entity_id,attribute_key:'canonical_roaster_entity_id',attribute_value:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',source:'other'})]
])test('preflight stops on '+name+' with zero POST',async()=>{const f=fixture();change(f,bundle.contexts[0]);await assert.rejects(preview(f),/identity_drift/);assert.equal(f.posts().length,0);});
for(const kind of ['entities','roles','locations','sources','canonical'])test('baseline '+kind+' identity evidence changes stop without overwriting existing matches',async()=>{
 const f=fixture(),c=bundle.contexts.find(c=>c.expected[kind].length);if(!c)return;const r=c.expected[kind][0],live=f.data[kind].find(x=>kind==='roles'?x.entity_id===r.entity_id&&x.role===r.role:x.id===r.id);
 if(kind==='entities')live.name+=' changed';else if(kind==='roles')live.role='changed';else if(kind==='locations')live.city='changed';else if(kind==='sources')live.source_url='https://other.example';else live.attribute_value='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';await assert.rejects(preview(f),/identity_drift/);assert.equal(f.posts().length,0);
});
test('apply rechecks baseline against preview and aborts before first INSERT after drift',async()=>{
 const f=fixture(),p=await preview(f);f.data.entities.find(x=>x.id===bundle.contexts[0].admittedIds[0]).name+=' changed';await assert.rejects(apply(f,p),/identity_drift/);assert.equal(f.posts().length,0);
});
test('incomplete responses cannot masquerade as complete: nonempty explicit EOF stops',async()=>{
 const f=fixture();f.setFault(({kind,offset})=>kind==='entities'&&offset?f.response([{id:'truncated'}],offset):null);await assert.rejects(preview(f),/nonempty_continuation/);assert.equal(f.posts().length,0);
});
test('first database failure is latched and prevents any retry or next call',async()=>{
 const f=fixture();f.setFault(()=>new Response('{"code":"57014","message":"never log me"}',{status:500,headers:{'content-type':'application/json'}}));const c=f.client();await assert.rejects(c.request('entities',bundle.contexts[0]),/database_http/);await assert.rejects(c.request('entities',bundle.contexts[0]),/transport_stopped/);assert.equal(f.calls.length,1);assert(!JSON.stringify(f.events).includes('never log me'));
});
for(const failedKind of ['entities','roles','sources'])test('ambiguous '+failedKind+' POST has durable intent and no replay, successor or automatic rollback',async()=>{
 const f=fixture(),p=await preview(f);f.calls.length=0;f.setFault(({kind,method})=>{if(method==='POST'&&kind===failedKind)throw Error('ambiguous network failure');});await assert.rejects(apply(f,p),/ambiguous/);assert.equal(f.posts().length,['entities','roles','sources'].indexOf(failedKind)+1);assert(f.events.some(e=>e.event==='post_intent_no_retry'));assert(f.calls.every(x=>['GET','POST'].includes(x.method)));
});
test('incorrect returned row stops before the next mutation',async()=>{
 const f=fixture(),p=await preview(f);f.setFault(({method,body})=>method==='POST'?f.response([{...body,name:'Wrong'}],0,201):null);await assert.rejects(apply(f,p),/representation/);assert.equal(f.posts().length,1);
});
test('post-return readback drift is failed, not called complete',async()=>{
 const f=fixture(),p=await preview(f);f.setFault(({method,kind,data})=>{if(method==='GET'&&kind==='entities'&&f.posts().length===3)data.entities.find(x=>x.id===bundle.contexts[0].action.entity_id).name='Changed';});await assert.rejects(apply(f,p),/readback/);assert.equal(f.posts().length,3);
});
test('journal or lost lock before mutation prevents dispatch',async()=>{
 for(const fault of ['journal','lock']){const f=fixture(),p=await preview(f);let n=0;const c=h.createClient({key:'test-only',allowWrites:true,delegate:async()=>{n++;throw Error('unexpected');},event:()=>{if(fault==='journal')throw Error('journal');},checkLock:()=>{if(fault==='lock')throw Error('lock');}});await assert.rejects(c.request('insertEntity',bundle.contexts[0],{at:p.at,validateWrite:()=>{}}),new RegExp(fault));assert.equal(n,0);}
});
test('preview clients cannot write and each POST operation is at-most-once within a client',async()=>{
 const f=fixture(),c=f.client(true),ctx=bundle.contexts[0],at=new Date().toISOString(),validateWrite=()=>{};await assert.rejects(f.client().request('insertEntity',ctx,{at}),/preview_write/);await c.request('insertEntity',ctx,{at,validateWrite});await assert.rejects(c.request('insertEntity',ctx,{at,validateWrite}),/replay/);assert.equal(f.posts().length,1);
});
test('slow response body and durable event work precede full completion cooldown',async()=>{
 let t=0;const starts=[],waits=[];const c=h.createClient({key:'test-only',now:()=>t,wait:async ms=>{waits.push(ms);t+=ms;},event:e=>{if(e.event==='request_result')t+=77;},delegate:async()=>{starts.push(t);t+=1000;return new Response(new ReadableStream({start(ctrl){t+=234;ctrl.enqueue(Buffer.from('[]'));ctrl.close();}}),{headers:{'content-type':'application/json','content-range':'*/*'}});}});
 await c.request('entities',bundle.contexts[0]);await c.request('roles',bundle.contexts[0]);assert.deepEqual(waits,[500]);assert.equal(starts[1]-starts[0],1000+234+77+500);
});
test('early timer wake is followed by another wait before dispatch',async()=>{
 let time=1000;const starts=[],waits=[];const c=h.createClient({key:'test-only',now:()=>time,wait:async ms=>{waits.push(ms);time+=waits.length===1?ms-1:ms;},delegate:async()=>{starts.push(time);return new Response('[]',{headers:{'content-type':'application/json','content-range':'*/*'}});}});
 await c.request('entities',bundle.contexts[0]);await c.request('roles',bundle.contexts[0]);assert.deepEqual(waits,[500,1]);assert.equal(starts[1]-starts[0],500);
});
test('preview expiry after an owner preflight stops before its INSERT',async()=>{
 const f=fixture(),p=await preview(f);let sawPreflight=false;await assert.rejects(apply(f,p,{append:e=>{if(e.event==='owner_preflight_verified'){sawPreflight=true;p.at=new Date(Date.now()-900001).toISOString();}}}),/preview_expired/);assert(sawPreflight);assert.equal(f.posts().length,0);
});
test('write authorization is checked after pacing, before POST intent or dispatch',async()=>{
 let time=0,allowed=true,dispatches=0;const events=[];const c=h.createClient({key:'test-only',allowWrites:true,now:()=>time,wait:async ms=>{time+=ms;allowed=false;},event:e=>events.push(e),delegate:async()=>{dispatches++;return new Response('[]',{headers:{'content-type':'application/json','content-range':'*/*'}});}});
 await c.request('entities',bundle.contexts[0]);await assert.rejects(c.request('insertEntity',bundle.contexts[0],{at:new Date().toISOString(),validateWrite:()=>{assert(allowed,'preview_expired');}}),/preview_expired/);assert.equal(dispatches,1);assert(!events.some(e=>e.event==='post_intent_no_retry'));
});
test('concurrent denial during cooldown cancels the queued admission before network dispatch',async()=>{
 let time=0,release,dispatches=0;const c=h.createClient({key:'test-only',now:()=>time,wait:()=>new Promise(r=>{release=()=>{time+=500;r();};}),delegate:async()=>{dispatches++;return new Response('[]',{headers:{'content-type':'application/json','content-range':'*/*'}});}});
 await c.request('entities',bundle.contexts[0]);const queued=c.request('roles',bundle.contexts[0]);await assert.rejects(c.request('sources',bundle.contexts[0]),/concurrent/);release();await assert.rejects(queued,/stopped/);assert.equal(dispatches,1);
});
test('only SQL source timestamp accepts equivalent UTC spelling; differing instant or changed JSON is refused',()=>{
 const expected=h.descriptor('insertSource',bundle.contexts[0],{at:'2026-09-27T10:00:00.123Z'}).body;
 const row={...clone(expected),id:'server-id',last_synced_at:'2026-09-27T10:00:00.123+00:00'};assert.equal(h.checkInserted([row],expected),row);
 assert.throws(()=>h.checkInserted([{...row,last_synced_at:'2026-09-27T10:00:00.124+00:00'}],expected),/timestamp/);
 assert.throws(()=>h.checkInserted([{...row,last_synced_at:'not-a-date'}],expected),/timestamp/);
 const changed=clone(row);changed.raw_data.name='Different';assert.throws(()=>h.checkInserted([changed],expected),/representation/);
});
test('malformed/truncated/content-type/redirect/body overflow all fail closed',async()=>{
 const cases=[()=>new Response('{}',{headers:{'content-type':'application/json','content-range':'*/*'}}),()=>new Response('[]',{headers:{'content-type':'text/html'}}),()=>new Response('[]',{headers:{'content-type':'application/json'}}),()=>({redirected:true}),()=>new Response(JSON.stringify(Array(251).fill({})),{headers:{'content-type':'application/json','content-range':'0-250/*'}}),()=>new Response('x'.repeat(4*1024*1024+1),{headers:{'content-type':'application/json'}})];
 for(const bad of cases){const f=fixture();f.setFault(bad);await assert.rejects(preview(f));assert.equal(f.posts().length,0);}
});
test('plan tampering, wrong helper/hash/expiry preview, and unknown CLI flags are refused',async()=>{
 const p=clone(bundle.plan);p.actions[0].locations.push({city:'Other'});assert.throws(()=>h.validatePlan(p));const f=fixture(),v=await preview(f);
 for(const patch of [{plan_sha256:'x'},{helper_sha256:'x'},{at:new Date(Date.now()-900001).toISOString()},{at:new Date(Date.now()+10000).toISOString()}])assert.throws(()=>h.validatePreview({...v,...patch},bundle));
});
test('exclusive shared lock refuses duplicates and cannot unlink replacement lock',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'plan11-test-')),file=path.join(dir,'apply.lock'),a=h.acquireLock(file);assert.throws(()=>h.acquireLock(file),/EEXIST/);a.check();a.release();assert(!fs.existsSync(file));fs.rmdirSync(dir);
});
test('source preserves exact factual payload; no unsupported alias declaration or locations',()=>{
 for(const c of bundle.contexts){const d=h.descriptor('insertSource',c,{at:'2026-09-27T10:00:00Z'});assert.deepEqual(d.body.raw_data,c.action.sources[0].raw_data);assert.equal(d.body.raw_data.sourceLabelsAreNotDeclaredAliases,true);assert.deepEqual(d.body.raw_data.accepted_locations,[]);}
});
