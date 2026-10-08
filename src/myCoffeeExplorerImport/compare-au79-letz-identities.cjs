'use strict';
// Bounded evidence capture only: no importer, database mutation or website fetch.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT='/Users/allan/.openclaw/workspace/coffee-roaster-crawler',STATE=ROOT+'/.state/my-coffee-explorer/2026-09-26';
const BASE=__dirname===ROOT+'/src/myCoffeeExplorerImport'?STATE:__dirname,ORIGIN='https://gtlipifdfyugiwpxvuse.supabase.co',TAG='compare-au79-letz-identities';
const PINS={'next-unvisited-six-reviewed-site-input.json':'a6b448da7f188bb018d36fbef97fa42f8751b0fb637ab49aa5b17268b039559b','next-unvisited-six-public-brand-site-review.ndjson':'797103e3874433ceb78d7a2846e3df077cd4d54df7fed0ba9015b416e3298734','next-unvisited-six-site-discovery.receipt.json':'d8d54bf1e8d67de1c615e3052160a0b55656df8cf20bacc549b29ebacd0854d9','next-unvisited-six-factual-review.json':'0baf7badc1dad08c4e9aa501ec992b481f90c670a73230aa28fc798e737b9ea9'};
const CODE_PINS={'product-db-fetch-gate.cjs':'a4a40c8abb95dc0f5528b9cb9c4a574ca80b5989f016af1fa27c83473563f01e','preflight-batch8b-paced-six.cjs':'ac4f66448d244323574f90a68851c0132eb78d73056c7607a9b287630c545a3d'};
const CANDIDATES=[
 {index:1,name:'AU79',host:'au79cafe.com.au',observed_contact_host:'au79coffee.com.au',names:['AU79','AU79 Cafe'],name_probes:['AU79*','AU 79*'],slugs:['au79','au79-cafe'],address:'27-29 Nicholson Street, Abbotsford VIC 3067',fragments:[{page:1,text:'The simple idea was to share our passion for coffee, thus having a roastery on site'},{page:2,text:'27/29 Nicholson St, Abbotsford VIC 3067'},{page:0,text:'abbotsford@au79coffee.com.au'}]},
 {index:4,name:'Lëtz Coffee',host:'letz.coffee',observed_contact_host:'letzcoffee.com',names:['Lëtz Coffee','Letz Coffee'],name_probes:['*lëtz*coffee*','*letz*coffee*'],slugs:['letz-coffee','lëtz-coffee'],address:'ZAE Riesenhaff, Bâtiment 5, 8821 Koetschette, Luxembourg',fragments:[{page:0,text:"Lëtz Coffee, ce sont des cafés torréfiés en petites quantités et emballés au Luxembourg par Olivier, un passionné 'du grain' de longue date."},{page:0,text:'ZAE Riesenhaff, Bâtiment 5, 8821 Koetschette, Luxembourg'},{page:0,text:'hello@letzcoffee.com'}]},
];
const INITIAL=['nameHost','address','sourceProbe'],CONTEXT=['entities','roles','locations','sources','canonical'];
const MAX_ROWS=50,MAX_OWNERS=20,MAX_REQUESTS=16,MAX_BODY=2*1024*1024,MAX_MS=180000,TIMEOUT_MS=20000;
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),stamp=()=>new Date().toISOString(),unique=a=>[...new Set(a)].sort();
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v),same=(a,b)=>stable(a)===stable(b);
function must(v,code){if(!v)throw Object.assign(Error(code),{code});}
function pinned(file,pin,base=BASE){must(!path.isAbsolute(file)&&!file.split('/').includes('..'),'evidence_path');const b=fs.readFileSync(path.join(base,file));must(sha(b)===pin,'evidence_hash:'+file);return b;}
function loadScope(base=BASE){
 for(const[f,h]of Object.entries(CODE_PINS))pinned(f,h,__dirname);
 const input=JSON.parse(pinned('next-unvisited-six-reviewed-site-input.json',PINS['next-unvisited-six-reviewed-site-input.json'],base));
 const records=pinned('next-unvisited-six-public-brand-site-review.ndjson',PINS['next-unvisited-six-public-brand-site-review.ndjson'],base).toString().trim().split('\n').map(JSON.parse);
 const receipt=JSON.parse(pinned('next-unvisited-six-site-discovery.receipt.json',PINS['next-unvisited-six-site-discovery.receipt.json'],base));
 const review=JSON.parse(pinned('next-unvisited-six-factual-review.json',PINS['next-unvisited-six-factual-review.json'],base));
 must(receipt.status==='collection_finished_not_identity_approved'&&receipt.finished===6&&receipt.output_sha256===PINS['next-unvisited-six-public-brand-site-review.ndjson'],'collection_binding');
 const pins={...PINS},candidates=CANDIDATES.map(c=>{
  const source=input[c.index],r=records[c.index];must(source&&same(r.candidate,source)&&new URL(source.website_url).hostname.replace(/^www\./,'')===c.host,'candidate_binding');
  const factual=review.reviews[c.index];must(factual.input_index===c.index&&factual.public_name===c.name&&factual.database_identity_approved===false&&factual.disposition==='verified_first_party_candidate_pending_fresh_catalog'&&same(factual.product_evidence,source.productEvidence),'factual_review_binding');
  for(const e of factual.evidence){const p=r.pages[e.page_index];must(e.field==='staticBodyText'&&p.finalUrl===e.url&&p.staticBodyText.slice(e.utf16_offset,e.utf16_offset+e.utf16_length)===e.excerpt&&sha(e.excerpt)===e.excerpt_sha256,'factual_excerpt_pointer');}
  must(source.readOnlyDiscovery&&source.staleCatalog&&source.databasePlanningAllowed===false&&source.databaseMutationAllowed===false&&source.identityVerified===false,'discovery_only');
  must(r.pages.length===(c.index===1?3:2),'page_count');
  const pages=r.pages.map((p,i)=>{must(p.status===200&&p.captureComplete&&!p.truncated&&sha(p.rawHtml)===p.rawHtmlSha256&&sha(p.staticBodyText)===p.staticBodyTextSha256,'page_hash');must(new URL(p.finalUrl).hostname.replace(/^www\./,'')===c.host,'page_host');return{page:i,url:p.finalUrl,raw_sha256:p.rawHtmlSha256,text_sha256:p.staticBodyTextSha256};});
  const fragments=c.fragments.map(f=>{const text=r.pages[f.page].staticBodyText,start=text.indexOf(f.text);must(start>=0,'literal_source_fragment');return{...f,utf16_start:start,utf16_length:f.text.length,sha256:sha(f.text)};});
  must(source.productEvidence.length===3&&source.productEvidenceProofs.length===3,'source_fact_count');
  for(let i=0;i<3;i++){const p=source.productEvidenceProofs[i],raw=JSON.parse(pinned(p.file,p.sha256,base));pins[p.file]=p.sha256;const row=p.pointer.split('/').slice(1).reduce((v,k)=>v[k],raw),fact=source.productEvidence[i];must(row&&['id','productId','name','brand','productUrl'].every(k=>same(row[k],fact[k])),'product_source_pointer');}
  return{...c,raw_source_name:source.name,source:'my_coffee_explorer',expected_source_key:'roaster:public-catalog:'+c.host,source_url:source.source_url,pages,fragments,productEvidence:source.productEvidence};
 });
 return{candidates,pins,source_at:receipt.at,owners:[]};
}
const quote=s=>'"'+s.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"',list=a=>'in.('+a.map(quote).join(',')+')';
function descriptor(kind,s,offset=0){
 must([...INITIAL,...CONTEXT].includes(kind)&&Number.isInteger(offset)&&offset>=0&&offset<=MAX_ROWS,'request_scope');
 const q=new URLSearchParams({select:'*',limit:String(offset?1:MAX_ROWS+1)}),hosts=s.candidates.flatMap(c=>[c.host,c.observed_contact_host]);let table;
 if(kind==='nameHost'){
  table='entities';q.set('or','('+s.candidates.flatMap(c=>[...c.name_probes.map(n=>'name.ilike.'+quote(n)),...unique([...c.slugs,c.raw_source_name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')]).flatMap(n=>['slug.eq.'+quote(n),'name_slug.eq.'+quote(n)])]).concat(hosts.map(h=>'website_url.ilike.'+quote('*'+h+'*'))).join(',')+')');
 }else if(kind==='address'){
  table='entity_locations';q.set('or','(address1.ilike."*27*29*Nicholson*",and(address1.ilike."*Nicholson*",city.ilike."Abbotsford"),address1.ilike."*Riesenhaff*",city.ilike."Koetschette")');
 }else if(kind==='sourceProbe'){
  table='entity_source_ids';q.set('or','('+['source_id.ilike."*au79*"','source_id.ilike."*au-79*"','source_id.ilike."*lëtz*"','source_id.ilike."*letz*"',...hosts.map(h=>'source_url.ilike.'+quote('*'+h+'*')),...s.candidates.map(c=>'and(source.eq.my_coffee_explorer,source_id.eq.'+quote(c.expected_source_key)+')')].join(',')+')');
 }else{
  must(s.owners.length>0&&s.owners.length<=MAX_OWNERS&&s.owners.every(uuid),'owner_scope');
  table={entities:'entities',roles:'entity_roles',locations:'entity_locations',sources:'entity_source_ids',canonical:'entity_attributes'}[kind];
  if(kind==='canonical'){q.set('attribute_key','eq.canonical_roaster_entity_id');q.set('or','(entity_id.'+list(s.owners)+',attribute_value.'+list(s.owners)+')');}
  else q.set(kind==='entities'?'id':'entity_id',list(s.owners));
 }
 q.set('order',kind==='roles'?'entity_id.asc,role.asc':'id.asc');if(offset)q.set('offset',String(offset));
 return{kind,offset,method:'GET',url:ORIGIN+'/rest/v1/'+table+'?'+q};
}
const rowKey=(kind,r)=>kind==='roles'?r.entity_id+'\n'+r.role:r.id;
function validateRows(kind,rows,s){must(Array.isArray(rows)&&rows.length<=MAX_ROWS,'row_bound');let prev='';const pairs=new Set();for(const r of rows){must(r&&typeof r==='object'&&!Array.isArray(r),'row_shape');const key=rowKey(kind,r);must(typeof key==='string'&&key>prev,'duplicate_or_unordered');prev=key;
 if(kind==='roles')must(uuid(r.entity_id)&&typeof r.role==='string'&&r.role.length,'role_shape');else must(uuid(r.id),'row_id');
 if(!['nameHost','entities'].includes(kind))must(uuid(r.entity_id),'owner_id');
 if(CONTEXT.includes(kind)&&kind!=='canonical')must(s.owners.includes(kind==='entities'?r.id:r.entity_id),'foreign_context_row');
 if(kind==='canonical')must(r.attribute_key==='canonical_roaster_entity_id'&&uuid(r.attribute_value)&&(s.owners.includes(r.entity_id)||s.owners.includes(r.attribute_value)),'canonical_scope');
 if(['sourceProbe','sources'].includes(kind)){must(typeof r.source==='string'&&typeof r.source_id==='string','source_shape');const p=r.source+'\n'+r.source_id;must(!pairs.has(p),'duplicate_source_key');pairs.add(p);}
 }}
function diag(e){return{code:String(e?.code||'comparison_failed').replace(/[^A-Za-z0-9_:-]/g,'').slice(0,100),...(Number.isInteger(e.httpStatus)?{httpStatus:e.httpStatus}:{}),...(/^[A-Z0-9]{1,16}$/.test(e.dbCode||'')?{databaseCode:e.dbCode}:{})};}
function createReader({scope,key,delegate=globalThis.fetch.bind(globalThis),event=()=>{},checkLock=()=>{},now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=TIMEOUT_MS}){
 const{createDatabaseFetchGate}=require('./product-db-fetch-gate.cjs');let count=0,active=false,stopped=false,finished=null,current;const start=now();
 const gate=createDatabaseFetchGate(async(request,init)=>{
  while(finished!==null&&now()-finished<500){must(!stopped&&now()-start<MAX_MS,'dispatch_deadline');await wait(500-(now()-finished));}
  must(!stopped&&now()-start<MAX_MS&&!init.signal.aborted,'dispatch_deadline');checkLock();must(request.method==='GET'&&request.url===descriptor(current.kind,scope,current.offset).url,'exact_get_scope');
  const response=await delegate(request,init);must(response&&!response.redirected&&response.url===request.url,'exact_response_url');return response;
 },{now,wait,timeoutMs,maxBodyBytes:MAX_BODY,onEvent:event,onStop:e=>event({event:'database_stop',...e})});
 return{get requests(){return count;},async request(kind,offset=0){let admitted=false,timer;try{
  must(!stopped&&!active&&count<MAX_REQUESTS&&now()-start<MAX_MS,'reader_stopped_or_bound');current=descriptor(kind,scope,offset);active=true;admitted=true;checkLock();event({event:'read_intent',request:++count,...current});
  const deadline=new AbortController();timer=setTimeout(()=>deadline.abort(),MAX_MS-(now()-start));const r=await gate.fetch(current.url,{method:'GET',headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json'},redirect:'error',signal:deadline.signal}),text=await r.text();
  if(![200,206].includes(r.status)){let dbCode;try{dbCode=JSON.parse(text).code;}catch{}throw Object.assign(Error('database_http_error'),{code:'database_http_error',httpStatus:r.status,dbCode});}
  must(/^application\/json(?:;|$)/i.test(r.headers.get('content-type')||''),'content_type');const rows=JSON.parse(text);must(Array.isArray(rows)&&rows.length<=MAX_ROWS&&(!offset||rows.length<=1),'row_bound');
  const range=r.headers.get('content-range')||'',m=/^(?:(\d+)-(\d+)|\*)\/(\d+|\*)$/.exec(range);must(m&&(rows.length?Number(m[1])===offset&&Number(m[2])-Number(m[1])+1===rows.length:m[1]===undefined),'content_range');if(m[3]!=='*')must(Number(m[3])===offset+rows.length,'reported_total_incomplete');
  must(!stopped&&now()-start<MAX_MS,'reader_stopped_or_bound');event({event:'read_result',request:count,kind,offset,httpStatus:r.status,contentRange:range,body_sha256:sha(text),rows});return rows;
 }catch(e){stopped=true;gate.stop('identity_comparison_failed');event({event:'read_failure',kind,offset,error:diag(e)});throw e;}finally{clearTimeout(timer);if(admitted){active=false;finished=now();}}}};
}
async function capture({scope,reader,event=()=>{}}){
 const state={},coverage=[];const group=async kind=>{const rows=await reader.request(kind);if(rows.length)must((await reader.request(kind,rows.length)).length===0,'nonempty_continuation:'+kind);validateRows(kind,rows,scope);state[kind]=rows;coverage.push({kind,rows:rows.length,empty_confirmation:!!rows.length});event({event:'group_complete',kind,rows:rows.length});};
 for(const kind of INITIAL)await group(kind);
 scope.owners=unique([...state.nameHost.map(r=>r.id),...state.address.map(r=>r.entity_id),...state.sourceProbe.map(r=>r.entity_id)]);must(scope.owners.length<=MAX_OWNERS&&scope.owners.every(uuid),'owner_bound');
 if(scope.owners.length){for(const kind of CONTEXT)await group(kind);must(same(state.entities.map(r=>r.id),scope.owners),'matched_owner_missing');
  for(const[kind,next]of [['nameHost','entities'],['address','locations'],['sourceProbe','sources']])for(const r of state[kind])must(same(r,state[next].find(x=>x.id===r.id)),'row_changed_during_reads:'+kind);
 }else for(const kind of CONTEXT){state[kind]=[];coverage.push({kind,skipped:true,reason:'No matching owner IDs; no empty IN query or invented live absence.'});}
 return{at:stamp(),status:'bounded_read_only_comparison_complete_requires_identity_review',readOnly:true,captureComplete:true,writes:0,requests:reader.requests,helper_sha256:sha(fs.readFileSync(__filename)),evidence_pins:scope.pins,code_pins:CODE_PINS,source_at:scope.source_at,candidates:scope.candidates,matched_owner_ids:scope.owners,state,coverage,canonical_review_required:state.canonical.length>0,identityApproved:false,full_catalog_current:false,databasePlanningAllowed:false,databaseMutationAllowed:false,limitations:['Observed contact-email domains are caution probes, not asserted business aliases or visited websites.','Fixed name/slug/host substrings, observed address tokens and source keys only; unknown names, hidden JSON aliases, spelling changes and unobserved operators are not exhaustively excluded.','A same-address, name, substring or source hit is not a merge decision; all returned candidates remain for human identity review.','Canonical links are captured in both directions for matched owners. Any link requires separate adjudication; no recursive graph expansion or empty-closure claim for linked owners.','Sequential nontransactional reads. Empty bounded probes are not a fresh whole-catalog snapshot, an import plan, or authority to crawl or mutate.']};
}
function sync(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function save(file,data){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(data,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync(path.dirname(file));}
function cli(args){must(args.length===0||(args.length===1&&['--check','--read'].includes(args[0])),'invalid_cli');return args[0]||'--check';}
async function main(args=process.argv.slice(2)){
 const mode=cli(args),scope=loadScope();if(mode==='--check'){console.log(JSON.stringify({status:'offline_check_pass',candidates:scope.candidates.map(c=>c.name),evidence_pins:scope.pins,max_requests:MAX_REQUESTS,max_rows:MAX_ROWS,max_matching_owners:MAX_OWNERS,requests:0,writes:0}));return;}
 must(fs.realpathSync(process.cwd())===ROOT&&fs.realpathSync(__dirname)===ROOT+'/src/myCoffeeExplorerImport'&&fs.realpathSync(STATE)===STATE,'production_runtime_required');must([ORIGIN,ORIGIN+'/'].includes(process.env.NEXT_PUBLIC_SUPABASE_URL),'database_origin');const key=process.env.SUPABASE_SERVICE_ROLE_KEY;must(typeof key==='string'&&key.length>20&&!/\s/.test(key),'credentials_missing');
 const{acquireLock}=require('./preflight-batch8b-paced-six.cjs'),lock=acquireLock(ROOT+'/.state/my-coffee-explorer/apply.lock'),dir=STATE+'/'+TAG+'-'+crypto.randomUUID(),oldTls=process.env.NODE_TLS_REJECT_UNAUTHORIZED;let fd;
 try{fs.mkdirSync(dir,{mode:0o700});sync(STATE);save(dir+'/reservation.json',{at:stamp(),readOnly:true,helper_sha256:sha(fs.readFileSync(__filename)),evidence_pins:scope.pins,max_requests:MAX_REQUESTS,retries:0});fd=fs.openSync(dir+'/events.ndjson','wx',0o600);fs.fsyncSync(fd);sync(dir);let journalFailed=false;
  const event=e=>{must(!journalFailed,'journal_failed');try{lock.check();const b=Buffer.from(JSON.stringify({at:stamp(),...e})+'\n');let n=0;while(n<b.length){const wrote=fs.writeSync(fd,b,n,b.length-n);must(wrote>0,'journal_stalled');n+=wrote;}fs.fsyncSync(fd);}catch(e){journalFailed=true;throw e;}};
  process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';const reader=createReader({scope,key,event,checkLock:()=>lock.check()}),result=await capture({scope,reader,event});save(dir+'/result.json',result);console.log(JSON.stringify({status:result.status,directory:dir,requests:result.requests,writes:0,result_sha256:sha(fs.readFileSync(dir+'/result.json'))}));
 }catch(e){if(fd!==undefined)try{save(dir+'/failure.json',{at:stamp(),status:'stopped_review_required',captureComplete:false,error:diag(e),writes:0,retries:0,note:'Only partial journal evidence; no successful absence or identity conclusion.'});}catch{}throw e;}
 finally{if(fd!==undefined)fs.closeSync(fd);if(oldTls===undefined)delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;else process.env.NODE_TLS_REJECT_UNAUTHORIZED=oldTls;lock.release();}
}
module.exports={ROOT,STATE,BASE,ORIGIN,TAG,PINS,CODE_PINS,CANDIDATES,INITIAL,CONTEXT,MAX_ROWS,MAX_OWNERS,MAX_REQUESTS,MAX_BODY,MAX_MS,TIMEOUT_MS,sha,same,loadScope,descriptor,validateRows,createReader,capture,save,cli,main};
if(require.main===module)main().catch(e=>{console.error(JSON.stringify(diag(e)));process.exitCode=1;});
