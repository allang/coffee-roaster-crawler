'use strict';
// One-shot, create-only plan11 executor. No SDK, crawler, upsert, update, delete or resume.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT='/Users/allan/.openclaw/workspace/coffee-roaster-crawler',STATE=ROOT+'/.state/my-coffee-explorer/2026-09-26',ORIGIN='https://gtlipifdfyugiwpxvuse.supabase.co';
const TAG='plan11-paced',LOCK=ROOT+'/.state/my-coffee-explorer/apply.lock',BASE=__dirname===ROOT+'/src/myCoffeeExplorerImport'?STATE:__dirname;
const PINS={
 'reviewed-public-brands-11/plan.json':'8de1622cbe2bca397cc3016909aae8a540d262c3cd3ac9bd34ba2901d97a3a7e',
 'reviewed-public-brands-11/independent-audit.json':'f0a06fa166e0e804d99ffc0ac6144b091515f114406e1e3669afadbf3c25b69a',
 'pending33-fresh-adjudication.json':'ada1f344b928fe6eddc540328ed84c7ca564b46b74b956ed3bbc5f5abd36693b',
 'snapshot-sequential-v3-post-recovery-0912/snapshot.json':'d1ec273070f07c4d2a3b15e68aa42be5028d7b85dcb4d4c759ab5db360f94c64',
 'cafe-source-links-apply/result.json':'7fb03c1d6310ccb5101c5472c272e0936afc1d45e228b55f7269e055883d5915'
};
const PLAN_SHA=PINS['reviewed-public-brands-11/plan.json'],FIELDS={entities:'id,name,slug,name_slug,website_url,primary_location,google_place_id',roles:'entity_id,role',locations:'id,entity_id,label,address1,address2,city,region,postal_code,country,lat,lng,is_primary',sources:'id,entity_id,source,source_id,source_url',canonical:'id,entity_id,attribute_key,attribute_value,source'};
const TABLES={entities:'entities',roles:'entity_roles',locations:'entity_locations',sources:'entity_source_ids',canonical:'entity_attributes'};
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),stamp=()=>new Date().toISOString();
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v),same=(a,b)=>canonical(a)===canonical(b),sorted=a=>a.map(canonical).sort();
const project=(row,fields)=>Object.fromEntries(fields.split(',').map(k=>[k,row[k]]));
function must(ok,code){if(!ok)throw Object.assign(Error(code),{code});}
function safeError(e){return{code:String(e.code||'verification_failed').replace(/[^a-zA-Z0-9_:-]/g,'').slice(0,90),...(Number.isInteger(e.httpStatus)?{httpStatus:e.httpStatus}:{}),...(/^[A-Z0-9]{1,16}$/.test(e.dbCode||'')?{databaseCode:e.dbCode}:{})};}
function norm(x){return String(x||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
function slug(x){return norm(x).replace(/ /g,'-');}
function quote(x){must(typeof x==='string'&&x.length>0&&x.length<250&&!/[\x00-\x1f%_*]/.test(x),'unsafe_filter_value');return '"'+x.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';}
function websiteMatch(url,hosts){try{const h=new URL(url).hostname.toLowerCase().replace(/^www\./,'');return hosts.some(x=>h===x||h.endsWith('.'+x)||x.endsWith('.'+h));}catch{return false;}}
function validatePlan(p){
 const {planHash,...body}=p;must(sha(JSON.stringify(body))===planHash,'plan_content_hash');must(p.actions.length===28&&p.conflicts.length===0&&p.source==='my_coffee_explorer','plan_scope');
 for(const a of p.actions){must(a.action==='create'&&a.before===null&&same(a.patch,{})&&same(a.locations,[])&&same(a.roles,['roaster'])&&same(a.newRoles,['roaster'])&&!Object.hasOwn(a,'crawlWebsite'),'action_scope');must(a.entity.id===a.entity_id&&same(Object.keys(a.entity).sort(),['id','name','name_slug','slug','website_url']),'entity_scope');must(a.sources.length===1&&a.sources[0].source==='my_coffee_explorer'&&a.sources[0].source_id.startsWith('roaster:public-catalog:')&&a.sources[0].source_url==='https://mycoffeeexplorer.com/coffees','source_scope');}
 for(const values of [p.actions.map(a=>a.entity_id),p.actions.map(a=>a.entity.slug),p.actions.map(a=>a.sources[0].source_id)])must(new Set(values).size===28,'duplicate_target');
}
function loadBundle(base=BASE){
 const j={};for(const[f,h]of Object.entries(PINS)){const b=fs.readFileSync(path.join(base,f));must(sha(b)===h,'pin_changed');j[f]=JSON.parse(b);}
 const plan=j['reviewed-public-brands-11/plan.json'],snapshot=j['snapshot-sequential-v3-post-recovery-0912/snapshot.json'],adjudication=j['pending33-fresh-adjudication.json'],overlay=j['cafe-source-links-apply/result.json'];validatePlan(plan);
 must(overlay.status==='complete'&&overlay.source_inserts===10&&overlay.cafe_role_inserts===4,'overlay_scope');snapshot.sourceIds.push(...overlay.inserted.sources.map(r=>project(r,FIELDS.sources)));snapshot.roles.push(...overlay.inserted.roles.map(r=>project(r,FIELDS.roles)));
 const contexts=plan.actions.map(a=>{
  const r=adjudication.reviews.find(r=>r.key===a.sources[0].raw_data.firstPartyReview.candidateKey);must(r&&r.decision==='approve_new'&&r.source.source_id===a.sources[0].source_id&&r.name===a.entity.name&&r.website_url===a.entity.website_url,'review_binding');
  const names=[...new Set([...r.names_checked,a.entity.name])],normalized=new Set(names.map(norm));
  const ids=new Set([...r.current_cautions.map(c=>c.entity_id),...snapshot.entities.filter(e=>normalized.has(norm(e.name))).map(e=>e.id)]);
  for(const id of ids)must(r.current_cautions.some(c=>c.entity_id===id),'unreviewed_baseline_match');
  const slugs=[...new Set([a.entity.slug,a.entity.name_slug,...names.map(slug)].filter(Boolean))];
  const c={action:a,names,slugs,hosts:r.hosts_checked.map(h=>h.toLowerCase()),admittedIds:[...ids].sort()};
  c.expected={entities:snapshot.entities.filter(e=>matchesEntity(e,c)).map(e=>project(e,FIELDS.entities))};
  must(c.expected.entities.every(e=>ids.has(e.id)),'unreviewed_baseline_identity');must(!snapshot.entities.some(e=>e.id===a.entity_id||e.slug===a.entity.slug||e.name_slug===a.entity.name_slug||websiteMatch(e.website_url,c.hosts)),'planned_identity_occupied');
  const ownerIds=new Set([...ids,a.entity_id]);
  for(const [kind,key]of [['roles','roles'],['locations','locations'],['sources','sourceIds'],['canonical','canonicalLinks']])c.expected[kind]=snapshot[key].filter(row=>ownerIds.has(row.entity_id)||(kind==='canonical'&&ownerIds.has(row.attribute_value))||(kind==='sources'&&row.source==='my_coffee_explorer'&&row.source_id===a.sources[0].source_id)).map(row=>project(row,FIELDS[kind]));
  must(!c.expected.sources.some(s=>s.source==='my_coffee_explorer'&&s.source_id===a.sources[0].source_id),'source_already_owned');
  for(const rows of Object.values(c.expected))must(rows.length<251,'baseline_bound');return c;
 });
 return{plan,contexts};
}
function matchesEntity(e,c){return e.id===c.action.entity_id||c.admittedIds.includes(e.id)||c.names.some(n=>n.toLowerCase()===String(e.name||'').toLowerCase())||c.slugs.includes(e.slug)||c.slugs.includes(e.name_slug)||websiteMatch(e.website_url,c.hosts);}
function descriptor(kind,c,{offset=0,after=false,at=null}={}){
 must(Object.hasOwn(TABLES,kind)||['insertEntity','insertRole','insertSource'].includes(kind),'request_out_of_scope');must(Number.isInteger(offset)&&offset>=0&&offset<251,'offset_bound');const a=c.action;
 const q=new URLSearchParams({select:after?'*':FIELDS[kind]||'*'});let method='GET',table=TABLES[kind],body;
 if(kind.startsWith('insert')){
  must(!offset&&!after&&typeof at==='string'&&Number.isFinite(Date.parse(at)),'insert_descriptor');method='POST';table={insertEntity:'entities',insertRole:'entity_roles',insertSource:'entity_source_ids'}[kind];
  body=kind==='insertEntity'?a.entity:kind==='insertRole'?{entity_id:a.entity_id,role:'roaster',role_metadata:{provenance:{public_directories:{my_coffee_explorer:{imported_at:at}}}}}:{...a.sources[0],entity_id:a.entity_id,confidence:0.95,last_synced_at:at};
 }else{
  const ids=after?[a.entity_id]:[a.entity_id,...c.admittedIds],idList='('+ids.join(',')+')';q.set('limit',offset?'1':'251');q.set('order',kind==='roles'?'entity_id.asc,role.asc':'id.asc');if(offset)q.set('offset',String(offset));
  if(kind==='entities'){
   if(after)q.set('id','eq.'+a.entity_id);else q.set('or','('+['id.in.'+idList,...c.names.map(n=>'name.ilike.'+quote(n)),...c.slugs.flatMap(s=>['slug.eq.'+quote(s),'name_slug.eq.'+quote(s)]),...c.hosts.map(h=>'website_url.ilike."*'+quote(h).slice(1,-1)+'*"')].join(',')+')');
  }else if(kind==='sources')q.set('or','(entity_id.in.'+idList+',and(source.eq.my_coffee_explorer,source_id.eq.'+quote(a.sources[0].source_id)+'))');
  else if(kind==='canonical'){q.set('attribute_key','eq.canonical_roaster_entity_id');q.set('or','(entity_id.in.'+idList+',attribute_value.in.'+idList+')');}
  else q.set('entity_id','in.'+idList);
 }
 return{kind,method,url:ORIGIN+'/rest/v1/'+table+'?'+q,body,offset,entity_id:a.entity_id};
}
async function bodyText(response){let size=0;const parts=[];must(response.body?.getReader,'streaming_body_required');const r=response.body.getReader();try{for(;;){const v=await r.read();if(v.done)break;size+=v.value.length;must(size<=4*1024*1024,'response_too_large');parts.push(Buffer.from(v.value));}return Buffer.concat(parts).toString('utf8');}finally{r.releaseLock();}}
function createClient({key,allowWrites=false,delegate=globalThis.fetch.bind(globalThis),event=()=>{},checkLock=()=>{},wait=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}){
 let active=false,stopped=false,count=0,last=null;const begun=now(),attempted=new Set();return{get requests(){return count;},async request(kind,c,options={}){let timer;try{
  must(!stopped&&!active,'transport_stopped_or_concurrent');active=true;must(count<1200&&now()-begun<20*60*1000,'request_or_time_bound');const d=descriptor(kind,c,options),keyId=d.entity_id+':'+kind;must(d.method!=='POST'||allowWrites,'preview_write_refused');must(d.method!=='POST'||!attempted.has(keyId),'post_replay_forbidden');checkLock();while(last!==null&&now()-last<500){must(!stopped&&now()-begun<20*60*1000,'transport_stopped_or_expired');await wait(500-(now()-last));}must(!stopped&&now()-begun<20*60*1000,'transport_stopped_or_expired');checkLock();
  if(d.method==='POST'){must(typeof options.validateWrite==='function','write_authorization_required');options.validateWrite();}
  count++;if(d.method==='POST')attempted.add(keyId);event({event:d.method==='POST'?'post_intent_no_retry':'get_intent',request:count,kind,entity_id:d.entity_id,offset:d.offset,descriptor_sha256:sha(canonical(d)),...(d.body?{body:d.body}:{})});
  const controller=new AbortController();timer=setTimeout(()=>controller.abort(),20000);const response=await delegate(d.url,{method:d.method,headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json',...(d.method==='POST'?{'Content-Type':'application/json',Prefer:'return=representation'}:{})},redirect:'error',signal:controller.signal,...(d.body?{body:JSON.stringify(d.body)}:{})});
  must(response&&!response.redirected&&(!response.url||response.url===d.url),'response_origin_or_redirect');const text=await bodyText(response);
  if(!(d.method==='POST'?[201]:[200,206]).includes(response.status)){const e=Object.assign(Error('database_http_error'),{code:'database_http_error',httpStatus:response.status});try{e.dbCode=JSON.parse(text).code;}catch{}throw e;}
  must(/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||''),'response_content_type');const rows=JSON.parse(text);must(Array.isArray(rows)&&rows.length<251,'response_bound_or_shape');
  if(d.method==='GET'){const m=/^(?:(\d+)-(\d+)|\*)\/(?:\d+|\*)$/.exec(response.headers.get('content-range')||'');must(m&&(rows.length?Number(m[1])===d.offset&&Number(m[2])-Number(m[1])+1===rows.length:m[1]===undefined),'content_range_mismatch');}
  event({event:'request_result',request:count,kind,entity_id:d.entity_id,status:response.status,rows});return rows;
 }catch(e){stopped=true;event({event:'request_failure',kind,entity_id:c?.action?.entity_id,...safeError(e)});throw e;}finally{clearTimeout(timer);last=now();active=false;}}};
}
async function readContext(client,c,after=false){const rows={};for(const kind of Object.keys(TABLES)){rows[kind]=await client.request(kind,c,{after});if(rows[kind].length)must((await client.request(kind,c,{after,offset:rows[kind].length})).length===0,'nonempty_continuation:'+kind);}
 // URL substring retrieval is only a superset: e.g. blackpearlcoffee.ca is not coffee.ca.
 // The unfiltered response remains in the journal; absence is tested only after complete EOF.
 if(!after)rows.entities=rows.entities.filter(e=>matchesEntity(e,c));return rows;
}
function checkBefore(rows,c){for(const kind of Object.keys(TABLES))must(same(sorted(rows[kind]),sorted(c.expected[kind])),'identity_drift:'+kind);}
function checkInserted(rows,expected){must(rows.length===1,'insert_representation_mismatch');const got=project(rows[0],Object.keys(expected).join(','));
 // SQL timestamptz output may spell the same instant +00:00 instead of Z.
 if(Object.hasOwn(expected,'last_synced_at')){must(Number.isFinite(Date.parse(got.last_synced_at))&&Date.parse(got.last_synced_at)===Date.parse(expected.last_synced_at),'source_timestamp_mismatch');got.last_synced_at=expected.last_synced_at;}
 must(same(got,expected),'insert_representation_mismatch');return rows[0];}
function checkAfter(rows,inserted){for(const[kind,key]of [['entities','entity'],['roles','role'],['sources','source']])must(same(rows[kind],[inserted[key]]),'target_readback_mismatch:'+kind);must(rows.locations.length===0&&rows.canonical.length===0,'unexpected_location_or_alias');}
function validatePreview(p,b,at=Date.now()){must(p.status==='preview_complete'&&p.plan_sha256===PLAN_SHA&&p.helper_sha256===sha(fs.readFileSync(__filename))&&p.before.length===28,'preview_identity');must(at-Date.parse(p.at)>=0&&at-Date.parse(p.at)<15*60*1000,'preview_expired');for(let i=0;i<28;i++)checkBefore(p.before[i],b.contexts[i]);}
async function execute({bundle,client,mode='preview',preview,append=()=>{},checkLock=()=>{}}){
 must(mode==='preview'||mode==='apply','invalid_mode');if(mode==='apply')validatePreview(preview,bundle);const before=[],completed=[];
 for(let i=0;i<bundle.contexts.length;i++){
  const c=bundle.contexts[i],rows=await readContext(client,c);checkBefore(rows,c);before.push(rows);append({event:'owner_preflight_verified',index:i,entity_id:c.action.entity_id,rows});
  if(mode==='preview')continue;
  must(same(rows,preview.before[i]),'preview_context_changed');const inserted={},at=stamp();
  for(const[kind,key]of [['insertEntity','entity'],['insertRole','role'],['insertSource','source']]){validatePreview(preview,bundle);checkLock();const d=descriptor(kind,c,{at});inserted[key]=checkInserted(await client.request(kind,c,{at,validateWrite:()=>validatePreview(preview,bundle)}),d.body);append({event:'post_returned_verified',entity_id:c.action.entity_id,kind,row:inserted[key]});}
  const after=await readContext(client,c,true);checkAfter(after,inserted);append({event:'owner_complete',entity_id:c.action.entity_id,after});completed.push({entity_id:c.action.entity_id,after});
 }
 // Final target-only readback rechecks every completed owner; no global counts/snapshot.
 if(mode==='apply')for(const c of bundle.contexts){const prior=completed.find(x=>x.entity_id===c.action.entity_id),after=await readContext(client,c,true);must(same(after,prior.after),'final_target_drift');}
 return{at:stamp(),status:mode==='preview'?'preview_complete':'complete',plan_sha256:PLAN_SHA,helper_sha256:sha(fs.readFileSync(__filename)),requests:client.requests,writes:mode==='apply'?84:0,before,...(mode==='apply'?{completed,verified:28,new_entities:28,roaster_roles:28,sources:28,crawl_targets:0}:{}),limitations:'Sequential, nontransactional fixed-identity checks, not a new full catalog snapshot. Reviewed baseline generic-name matches are preserved. Identity writers must remain paused under the shared import lock. Any failure requires separate exact-ID reconciliation; this helper cannot resume.'};
}
function sync(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function save(file,value){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync(path.dirname(file));}
function acquireLock(file=LOCK){const fd=fs.openSync(file,'wx',0o600),stat=fs.fstatSync(fd),body=JSON.stringify({pid:process.pid,scope:TAG,token:crypto.randomUUID(),at:stamp()});fs.writeSync(fd,body);fs.fsyncSync(fd);sync(path.dirname(file));const check=()=>{const s=fs.lstatSync(file);must(s.isFile()&&!s.isSymbolicLink()&&s.ino===stat.ino&&s.dev===stat.dev&&fs.readFileSync(file,'utf8')===body,'lock_ownership_lost');};return{check,release(){try{check();fs.unlinkSync(file);sync(path.dirname(file));}finally{fs.closeSync(fd);}}};}
function cli(a){if(!a.length||same(a,['--check']))return{mode:'check'};if(same(a,['--preview']))return{mode:'preview'};must(a.length===4&&a[0]==='--apply'&&/^[a-f0-9]{64}$/.test(a[2])&&a[3]==='--confirm-28-new-roasters-and-identity-writers-paused','invalid_cli');return{mode:'apply',previewFile:a[1],previewSha:a[2]};}
async function main(){
 const opts=cli(process.argv.slice(2)),bundle=loadBundle();if(opts.mode==='check'){console.log(JSON.stringify({status:'offline_check_pass',plan_sha256:PLAN_SHA,owners:28,admitted_baseline_identities:new Set(bundle.contexts.flatMap(c=>c.admittedIds)).size,requests:0}));return;}
 must(fs.realpathSync(process.cwd())===ROOT&&fs.realpathSync(__dirname)===ROOT+'/src/myCoffeeExplorerImport','production_location_required');must(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL||'').href===ORIGIN+'/','database_origin');const key=process.env.SUPABASE_SERVICE_ROLE_KEY;must(typeof key==='string'&&key.length>20,'runtime_credentials_missing');let preview;
 if(opts.mode==='apply'){const f=fs.realpathSync(opts.previewFile);must(path.dirname(path.dirname(f))===STATE&&new RegExp('^'+TAG+'-preview-[a-f0-9-]{36}$').test(path.basename(path.dirname(f)))&&path.basename(f)==='result.json','preview_path');const bytes=fs.readFileSync(f);must(sha(bytes)===opts.previewSha,'preview_hash');preview=JSON.parse(bytes);validatePreview(preview,bundle);}
 const lock=acquireLock(),dir=STATE+'/'+TAG+(opts.mode==='apply'?'-apply':'-preview-'+crypto.randomUUID());let fd;const tls=process.env.NODE_TLS_REJECT_UNAUTHORIZED;
 try{
  fs.mkdirSync(dir,{mode:0o700});sync(STATE);save(path.join(dir,'reservation.json'),{at:stamp(),mode:opts.mode,plan_sha256:PLAN_SHA,helper_sha256:sha(fs.readFileSync(__filename)),preview_sha256:opts.previewSha||null});
  fd=fs.openSync(path.join(dir,'events.ndjson'),'wx',0o600);fs.fsyncSync(fd);sync(dir);let failed=false;const append=e=>{must(!failed,'journal_latched_stop');try{const b=Buffer.from(JSON.stringify({at:stamp(),...e})+'\n');let n=0;while(n<b.length)n+=fs.writeSync(fd,b,n,b.length-n);fs.fsyncSync(fd);}catch(e){failed=true;throw e;}};
  process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';const client=createClient({key,allowWrites:opts.mode==='apply',event:append,checkLock:lock.check}),result=await execute({bundle,client,mode:opts.mode,preview,append,checkLock:lock.check});save(path.join(dir,'result.json'),result);console.log(JSON.stringify({status:result.status,directory:dir,sha256:sha(fs.readFileSync(path.join(dir,'result.json')))}));
 }catch(e){if(fd!==undefined)try{save(path.join(dir,'failure.json'),{at:stamp(),status:'stopped_review_required',error:safeError(e),warning:'A returned or ambiguous POST may already have committed. The fixed apply directory forbids any retry or resume; reconcile exact journal IDs separately.'});}catch{}throw e;}finally{if(fd!==undefined)fs.closeSync(fd);if(tls===undefined)delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;else process.env.NODE_TLS_REJECT_UNAUTHORIZED=tls;lock.release();}
}
module.exports={ROOT,STATE,ORIGIN,PINS,PLAN_SHA,FIELDS,TABLES,sha,canonical,same,sorted,project,norm,loadBundle,validatePlan,matchesEntity,descriptor,createClient,readContext,checkBefore,checkInserted,checkAfter,validatePreview,execute,acquireLock,cli,main};
if(require.main===module)main().catch(e=>{console.error(JSON.stringify(safeError(e)));process.exitCode=1;});
