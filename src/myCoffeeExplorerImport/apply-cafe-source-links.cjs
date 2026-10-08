'use strict';
// Exact ten source INSERTs and four cafe-role INSERTs. No general importer/pipeline.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT='/Users/allan/.openclaw/workspace/coffee-roaster-crawler',STATE=ROOT+'/.state/my-coffee-explorer/2026-09-26',ORIGIN='https://gtlipifdfyugiwpxvuse.supabase.co';
const TAG='cafe-source-links',LOCK=ROOT+'/.state/my-coffee-explorer/apply.lock',PLAN_FILE='cafe-source-links-plan.json',PLAN_SHA='e936e8d43a3d5e89e08b5660b1ac00be3f9ae30ec4be69f6b8a0ef66b4b8775f';
const BASE=__dirname===ROOT+'/src/myCoffeeExplorerImport'?STATE:__dirname,sha=x=>crypto.createHash('sha256').update(x).digest('hex'),stamp=()=>new Date().toISOString();
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v),same=(a,b)=>canonical(a)===canonical(b),sorted=rows=>rows.map(canonical).sort();
function must(ok,code){if(!ok)throw Object.assign(Error(code),{code});}
function diag(e){return{code:String(e.code||'verification_failed').replace(/[^A-Za-z0-9_:-]/g,'').slice(0,90),...(Number.isInteger(e.httpStatus)?{httpStatus:e.httpStatus}:{}),...(/^[A-Z0-9]{1,16}$/.test(e.dbCode||'')?{databaseCode:e.dbCode}:{})};}
function sync(dir){const f=fs.openSync(dir,'r');try{fs.fsyncSync(f);}finally{fs.closeSync(f);}}
function save(file,value){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync(path.dirname(file));}
function loadPlan(base=BASE){const bytes=fs.readFileSync(path.join(base,PLAN_FILE));must(sha(bytes)===PLAN_SHA,'plan_hash_mismatch');const p=JSON.parse(bytes);for(const[f,h]of Object.entries(p.pins)){const dir=f.endsWith('.cjs')?__dirname:base;must(sha(fs.readFileSync(path.join(dir,f)))===h,'evidence_hash_mismatch');}validatePlan(p);return p;}
function validatePlan(p){
 must(p.database_origin===ORIGIN&&p.actions.length===10,'wrong_plan_scope');must(new Set(p.actions.map(a=>a.entity_id)).size===10&&new Set(p.actions.map(a=>a.source_id)).size===10,'duplicate_identity');
 must(p.actions.filter(a=>a.role_insert).length===4,'wrong_role_count');
 for(const a of p.actions){must(a.source_insert.entity_id===a.entity_id&&a.source_insert.source==='my_coffee_explorer'&&a.source_insert.source_id===a.source_id&&a.source_id==='shop:'+a.source_insert.raw_data.sourceId,'source_scope');must(a.before.entity.id===a.entity_id&&a.before.locations.length===1,'target_identity');must(a.role_insert?same(a.before.roles,[])&&a.role_insert.entity_id===a.entity_id&&a.role_insert.role==='cafe':same(a.before.roles,[{entity_id:a.entity_id,role:'cafe'}]),'role_scope');}
}
function descriptor(kind,p,offset=0){
 const ids=p.actions.map(a=>a.entity_id).sort(),sourceIds=p.actions.map(a=>a.source_id).sort(),q=new URLSearchParams({select:'*',limit:'100'});let table,method='GET',body;
 if(kind==='entities'){table='entities';q.set('id','in.('+ids.join(',')+')');q.set('order','id.asc');}
 else if(['locations','roles','ownerSources'].includes(kind)){table={locations:'entity_locations',roles:'entity_roles',ownerSources:'entity_source_ids'}[kind];q.set('entity_id','in.('+ids.join(',')+')');q.set('order',kind==='roles'?'entity_id.asc,role.asc':'id.asc');if(offset){q.set('offset',String(offset));q.set('limit','1');}}
 else if(kind==='sourceKeys'){table='entity_source_ids';q.set('source','eq.my_coffee_explorer');q.set('source_id','in.('+sourceIds.join(',')+')');q.set('order','id.asc');}
 else if(kind==='canonicalOut'||kind==='canonicalIn'){table='entity_attributes';q.set('attribute_key','eq.canonical_roaster_entity_id');q.set(kind==='canonicalOut'?'entity_id':'attribute_value','in.('+ids.join(',')+')');q.set('limit','1');}
 else if(kind==='insertSources'||kind==='insertRoles'){table=kind==='insertSources'?'entity_source_ids':'entity_roles';method='POST';body=p.actions.flatMap(a=>kind==='insertSources'?[a.source_insert]:a.role_insert?[a.role_insert]:[]);q.delete('limit');}
 else throw Object.assign(Error('request_out_of_scope'),{code:'request_out_of_scope'});
 must(Number.isInteger(offset)&&offset>=0&&offset<100,'invalid_offset');return{kind,method,url:ORIGIN+'/rest/v1/'+table+'?'+q,body,offset};
}
async function bodyText(response){let size=0;const parts=[];must(response.body?.getReader,'streaming_body_required');const reader=response.body.getReader();try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;must(size<=2*1024*1024,'response_too_large');parts.push(Buffer.from(value));}return Buffer.concat(parts).toString('utf8');}finally{reader.releaseLock();}}
function createClient({plan,key,allowWrites=false,delegate=globalThis.fetch.bind(globalThis),event=()=>{},checkLock=()=>{},wait=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}){
 let count=0,active=false,stopped=false,lastCompleted=null;const start=now(),writes=new Set();return{get requests(){return count;},async request(kind,offset=0){let timer;try{
  must(!stopped&&!active,'transport_stopped_or_concurrent');must(count<22&&now()-start<15*60*1000,'request_or_time_bound');const d=descriptor(kind,plan,offset);must(d.method!=='POST'||allowWrites,'preview_write_refused');must(!writes.has(kind),'post_retry_forbidden');checkLock();active=true;
  if(lastCompleted!==null&&now()-lastCompleted<500)await wait(500-(now()-lastCompleted));checkLock();count++;if(d.method==='POST')writes.add(kind);
  event({event:'request_intent',request:count,kind,offset,method:d.method,descriptor_sha256:sha(canonical(d))});const controller=new AbortController();timer=setTimeout(()=>controller.abort(),20000);
  const response=await delegate(d.url,{method:d.method,headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json',...(d.method==='POST'?{'Content-Type':'application/json',Prefer:'return=representation'}:{})},redirect:'error',signal:controller.signal,...(d.body?{body:JSON.stringify(d.body)}:{})});
  must(response&&!response.redirected&&(!response.url||new URL(response.url).origin===ORIGIN),'response_origin_redirect');const text=await bodyText(response);
  if(!(d.method==='POST'?[201]:[200,206]).includes(response.status)){const e=Object.assign(Error('database_http_error'),{code:'database_http_error',httpStatus:response.status});try{e.dbCode=JSON.parse(text).code;}catch{}throw e;}
  must(/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||''),'response_content_type');const rows=JSON.parse(text);must(Array.isArray(rows)&&rows.length<100,'response_bound_or_shape');
  const range=response.headers.get('content-range');if(d.method==='GET'){const m=/^(?:(\d+)-(\d+)|\*)\/(?:\d+|\*)$/.exec(range||'');must(m&&(rows.length?Number(m[1])===offset&&Number(m[2])-Number(m[1])+1===rows.length:m[1]===undefined),'content_range_mismatch');}
  event({event:'request_result',request:count,kind,offset,status:response.status,rows});return rows;
 }catch(e){stopped=true;event({event:'request_failure',kind,offset,...diag(e)});throw e;}finally{clearTimeout(timer);lastCompleted=now();active=false;}}};
}
function projection(row,expected){return Object.fromEntries(Object.keys(expected).map(k=>[k,row[k]]));}
function exactProjected(rows,expected,code){must(rows.length===expected.length,code+'_count');const project=expected.map(e=>{const matches=rows.filter(r=>Object.hasOwn(e,'id')?r.id===e.id:r.entity_id===e.entity_id&&r.role===e.role);must(matches.length===1,code+'_key');return projection(matches[0],e);});must(same(sorted(project),sorted(expected)),code+'_changed');}
async function inspect(c,p,phase='before',before=null,inserted={sources:[],roles:[]}){
 const current={};for(const kind of ['entities','locations','roles','ownerSources','sourceKeys','canonicalOut','canonicalIn']){current[kind]=await c.request(kind);if(['locations','roles','ownerSources'].includes(kind)&&current[kind].length)must((await c.request(kind,current[kind].length)).length===0,'nonempty_continuation:'+kind);}
 must(!current.canonicalOut.length&&!current.canonicalIn.length,'canonical_alias_conflict');
 if(phase==='before'){
  exactProjected(current.entities,p.actions.map(a=>a.before.entity),'entity');exactProjected(current.locations,p.actions.flatMap(a=>a.before.locations),'location');exactProjected(current.roles,p.actions.flatMap(a=>a.before.roles),'role');exactProjected(current.ownerSources,p.actions.flatMap(a=>a.before.sources),'source');must(!current.sourceKeys.length,'source_already_owned');
 }else{
  for(const key of ['entities','locations'])must(same(sorted(current[key]),sorted(before[key])),key+'_preservation');
  must(same(sorted(current.roles),sorted([...before.roles,...inserted.roles])),'roles_preservation');must(same(sorted(current.ownerSources),sorted([...before.ownerSources,...inserted.sources])),'sources_preservation');must(same(sorted(current.sourceKeys),sorted(inserted.sources)),'source_key_readback');
 }
 return current;
}
function validateInserted(rows,expected,code){must(rows.length===expected.length,code+'_row_count');exactProjected(rows,expected,code);}
function validatePreview(v,p,at=Date.now()){must(v.status==='preview_complete'&&v.plan_sha256===PLAN_SHA&&v.helper_sha256===sha(fs.readFileSync(__filename)),'preview_identity');must(Number.isFinite(Date.parse(v.at))&&at-Date.parse(v.at)>=0&&at-Date.parse(v.at)<15*60*1000,'preview_expired');must(v.before&&v.constraints_confirmed===true,'preview_context_or_constraints');validatePlan(p);}
async function execute({client,plan,mode='preview',preview,append=()=>{},checkLock=()=>{},constraintsConfirmed=false}){
 must(mode==='preview'||mode==='apply','invalid_mode');if(mode==='apply')validatePreview(preview,plan);const before=await inspect(client,plan);append({event:'before_complete',before});
 if(mode==='preview')return{at:stamp(),status:'preview_complete',plan_sha256:PLAN_SHA,helper_sha256:sha(fs.readFileSync(__filename)),constraints_confirmed:constraintsConfirmed,before,requests:client.requests,writes:0};
 must(same(before,preview.before),'fresh_context_changed');validatePreview(preview,plan);checkLock();const inserted={sources:[],roles:[]};
 for(const[kind,key,expected]of [['insertSources','sources',plan.actions.map(a=>a.source_insert)],['insertRoles','roles',plan.actions.flatMap(a=>a.role_insert?[a.role_insert]:[])]]){append({event:'write_attempt_no_retry',kind,expected});checkLock();inserted[key]=await client.request(kind);validateInserted(inserted[key],expected,kind);append({event:'write_returned',kind,rows:inserted[key]});}
 const after=await inspect(client,plan,'after',before,inserted);append({event:'after_verified',after});return{at:stamp(),status:'complete',plan_sha256:PLAN_SHA,helper_sha256:sha(fs.readFileSync(__filename)),source_inserts:10,cafe_role_inserts:4,requests:client.requests,before,inserted,after};
}
function acquireLock(file=LOCK){const fd=fs.openSync(file,'wx',0o600),stat=fs.fstatSync(fd),text=JSON.stringify({pid:process.pid,scope:TAG,token:crypto.randomUUID(),at:stamp()});fs.writeSync(fd,text);fs.fsyncSync(fd);sync(path.dirname(file));const check=()=>{const s=fs.lstatSync(file);must(s.isFile()&&!s.isSymbolicLink()&&s.ino===stat.ino&&s.dev===stat.dev&&fs.readFileSync(file,'utf8')===text,'lock_ownership_lost');};return{check,release(){try{check();fs.unlinkSync(file);sync(path.dirname(file));}finally{fs.closeSync(fd);}}};}
function cli(a){if(!a.length||same(a,['--check']))return{mode:'check'};if(same(a,['--preview']))return{mode:'preview',constraintsConfirmed:false};if(same(a,['--preview','--confirmed-unique-constraints']))return{mode:'preview',constraintsConfirmed:true};must(a.length===4&&a[0]==='--apply'&&/^[a-f0-9]{64}$/.test(a[2])&&a[3]==='--confirm-ten-source-four-cafe-inserts','invalid_cli');return{mode:'apply',previewFile:a[1],previewSha:a[2]};}
async function main(){const opts=cli(process.argv.slice(2)),plan=loadPlan();if(opts.mode==='check'){console.log(JSON.stringify({status:'offline_check_pass',plan_sha256:PLAN_SHA,summary:plan.summary,networkRequests:0}));return;}
 must(fs.realpathSync(process.cwd())===ROOT&&fs.realpathSync(__dirname)===ROOT+'/src/myCoffeeExplorerImport','production_location_required');must(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL||'').href===ORIGIN+'/','database_origin');const key=process.env.SUPABASE_SERVICE_ROLE_KEY;must(typeof key==='string'&&key.length>20,'runtime_credentials_missing');let preview;
 if(opts.mode==='apply'){const f=fs.realpathSync(opts.previewFile);must(path.dirname(path.dirname(f))===STATE&&new RegExp('^'+TAG+'-preview-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$').test(path.basename(path.dirname(f)))&&path.basename(f)==='result.json','preview_path');const raw=fs.readFileSync(f);must(sha(raw)===opts.previewSha,'preview_sha');preview=JSON.parse(raw);validatePreview(preview,plan);}
 const lock=acquireLock(),dir=STATE+'/'+TAG+(opts.mode==='apply'?'-apply':'-preview-'+crypto.randomUUID());let fd;const tls=process.env.NODE_TLS_REJECT_UNAUTHORIZED;
 try{fs.mkdirSync(dir,{mode:0o700});sync(STATE);save(path.join(dir,'reservation.json'),{at:stamp(),mode:opts.mode,plan_sha256:PLAN_SHA,helper_sha256:sha(fs.readFileSync(__filename)),preview_sha256:opts.previewSha||null});fd=fs.openSync(path.join(dir,'events.ndjson'),'wx',0o600);fs.fsyncSync(fd);sync(dir);let failed=false;const append=e=>{must(!failed,'journal_latched_stop');try{const data=Buffer.from(JSON.stringify({at:stamp(),...e})+'\n');let offset=0;while(offset<data.length)offset+=fs.writeSync(fd,data,offset,data.length-offset);fs.fsyncSync(fd);}catch(e){failed=true;throw e;}};process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';const client=createClient({plan,key,allowWrites:opts.mode==='apply',event:append,checkLock:lock.check});const result=await execute({client,plan,mode:opts.mode,preview,append,checkLock:lock.check,constraintsConfirmed:opts.constraintsConfirmed});save(path.join(dir,'result.json'),result);console.log(JSON.stringify({status:result.status,directory:dir,sha256:sha(fs.readFileSync(path.join(dir,'result.json')))}));
 }catch(e){if(fd!==undefined)try{save(path.join(dir,'failure.json'),{at:stamp(),status:'stopped_review_required',error:diag(e),warning:'A returned or ambiguous POST may already have committed. No retry; separately reconcile exact IDs before any further mutation.'});}catch{}throw e;}finally{if(fd!==undefined)fs.closeSync(fd);if(tls===undefined)delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;else process.env.NODE_TLS_REJECT_UNAUTHORIZED=tls;lock.release();}
}
module.exports={ROOT,STATE,ORIGIN,TAG,PLAN_FILE,PLAN_SHA,sha,canonical,same,loadPlan,validatePlan,descriptor,createClient,inspect,validateInserted,validatePreview,execute,acquireLock,cli,main};
if(require.main===module)main().catch(e=>{console.error(JSON.stringify(diag(e)));process.exitCode=1;});
