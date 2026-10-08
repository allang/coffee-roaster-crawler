'use strict';
// Isolated, one-shot repair. No product pipeline, media download, claim or variant writes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT='/Users/allan/.openclaw/workspace/coffee-roaster-crawler',STATE=ROOT+'/.state/my-coffee-explorer/2026-09-26',ORIGIN='https://gtlipifdfyugiwpxvuse.supabase.co';
const TAG='batch5a-partial-null-fills',BASE=__dirname===ROOT+'/src/myCoffeeExplorerImport'?STATE:__dirname;
const PROPOSAL_FILE='batch5a-partial-product-null-fill-proposal.json',PROPOSAL_SHA='5eb241d3b736139b4f68993dc232ca1230598f0f577c26984ab78580ea290b8f';
const PRIOR_PLAN='batch5a-minimal-variant-repair-plan.json',PRIOR_SHA='c481658b11370c87b90256d2abfe3a4636d1a9476dc348d837fbd05374e2899d',PRIOR_RESULT='batch5a-minimal-variant-repair-apply/result.json';
const IDS=['06358c18-7284-4838-82ae-0a00e30028e0','0fffb375-1e44-46da-959c-37a6acdd4e0c','8112377f-6bab-49d6-b474-d889d403ce72','8d7554ce-0248-42b6-a004-1a99120bd24f','d411d1d8-1920-4629-ad1a-3fdcaf83d027'];
const FACT_FIELDS=['product_id','origin_hub_id','process','variety','elevation_m','roast_level','tasting_notes_raw','decaf','created_at','updated_at'];
const READS=['owners','roles','sources','sourceKeys','canonicalOut','canonicalIn','crawlState','activeClaims','parents','sourceProducts','variants','facts','media','assets','knownPages','claims','ownerClaims'];
const TTL=15*60*1000,MAX_REQUESTS=450,MAX_TIME=20*60*1000;
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),stamp=()=>new Date().toISOString(),canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v),same=(a,b)=>canonical(a)===canonical(b),copy=x=>JSON.parse(JSON.stringify(x)),sorted=x=>x.map(canonical).sort();
function must(ok,code){if(!ok)throw Object.assign(Error(code),{code});}
function diag(e){return{code:String(e.code||'verification_failed').replace(/[^A-Za-z0-9_:-]/g,'').slice(0,90),...(Number.isInteger(e.httpStatus)?{httpStatus:e.httpStatus}:{}),...(/^[A-Z0-9]{1,16}$/.test(e.dbCode||'')?{databaseCode:e.dbCode}:{})};}
function pointer(x,p){return p.split('/').slice(1).reduce((v,k)=>v[k.replace(/~1/g,'/').replace(/~0/g,'~')],x);}
function sync(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function save(file,value){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync(path.dirname(file));}
function loadBundle(base=BASE){
 const read=f=>{must(!path.isAbsolute(f)&&!f.split('/').includes('..'),'evidence_path');return fs.readFileSync(path.join(base,f));};
 const raw=read(PROPOSAL_FILE);must(sha(raw)===PROPOSAL_SHA,'proposal_hash');const proposal=JSON.parse(raw);
 for(const[f,h]of Object.entries(proposal.pins))must(sha(read(f))===h,'evidence_hash');
 const priorRaw=read(PRIOR_PLAN);must(sha(priorRaw)===PRIOR_SHA,'prior_plan_hash');const prior=JSON.parse(priorRaw),result=JSON.parse(read(PRIOR_RESULT));
 must(result.status==='minimal_variant_repair_verified'&&result.plan_sha256===PRIOR_SHA,'prior_repair_not_verified');
 const baseline=copy(result.after);baseline.sourceKeys=copy(baseline.sources);baseline.ownerClaims=copy(baseline.claims);
 const products=proposal.products;must(same(products.map(p=>p.product_id),IDS)&&new Set(products.map(p=>p.entity_id)).size===5,'proposal_scope');
 const actions=[];
 for(const p of products){
  const target=prior.targets.find(t=>t.product_id===p.product_id),parent=pointer(result,p.parent_before_pointer);
  must(target&&parent.id===p.product_id&&parent.entity_id===p.entity_id&&parent.source_url===target.source_url&&parent.original_image_url===null,'product_binding');
  const html=read(p.source.file);must(sha(html)===p.source.sha256,'html_hash');const capture=pointer(JSON.parse(read(p.source.capture_file)),p.source.capture_pointer);
  must(capture.captureComplete===true&&capture.status===200&&capture.product_id===p.product_id&&capture.entity_id===p.entity_id&&sha(capture.staticBodyText)===p.source.static_text_sha256,'capture_binding');
  must(capture.final_url===target.observed_canonical_url,'canonical_source_binding');
  for(const f of p.factual_proofs){const text=pointer(JSON.parse(read(f.file)),f.pointer),fragment=text.slice(f.utf16_offset,f.utf16_offset+f.utf16_length);must(sha(text)===f.static_text_sha256&&fragment===f.text&&sha(fragment)===f.sha256,'fact_fragment');}
  const im=p.original_image_url,pr=im.proof,fragment=html.toString('utf8').slice(pr.utf16_offset,pr.utf16_offset+pr.utf16_length);
  must(im.before===null&&im.operation==='null_only_parent_fill'&&pr.file===p.source.file&&sha(fragment)===pr.sha256&&(!pr.fragment||fragment===pr.fragment),'image_fragment');
  if(pr.json_pointer){const match=/^<script\b[^>]*>([\s\S]*)<\/script>$/i.exec(fragment);must(match,'image_jsonld_script');const obj=JSON.parse(match[1]);must(pointer(obj,pr.json_pointer)===im.value&&pointer(obj,pr.product_url_pointer)===pr.product_url&&pr.product_url===capture.final_url,'image_product_binding');}
  else must(fragment.includes('content="'+im.value+'"'),'image_value_binding');
  const imageUrl=new URL(im.value);must(imageUrl.protocol==='https:'&&!imageUrl.username&&!imageUrl.password,'image_url');
  const f=p.coffee_facts;
  if(p.product_id===IDS[0]){must(f.operation==='null_only_patch_existing'&&same(f.changes,{process:'Anaerobic Natural',elevation_m:1950}),'cognito_scope');const before=pointer(result,f.before_pointer);must(before.product_id===p.product_id&&before.process===null&&before.elevation_m===null,'cognito_before');actions.push({kind:'patchFact',product_id:p.product_id,entity_id:p.entity_id,body:copy(f.changes)});}
  else{must(f.operation==='insert_only_if_still_absent'&&f.values.product_id===p.product_id,'insert_scope');const body={product_id:p.product_id,origin_hub_id:null,process:null,variety:null,elevation_m:null,roast_level:null,tasting_notes_raw:null,decaf:null,...f.values};must(Object.keys(f.values).every(k=>['product_id','process','tasting_notes_raw','roast_level'].includes(k))&&body.decaf===null,'unknown_fact_defaults');actions.push({kind:'insertFact',product_id:p.product_id,entity_id:p.entity_id,body});}
 }
 must(same(actions.map(a=>[a.product_id,a.body.process,a.body.roast_level??null,a.body.tasting_notes_raw??null]),[[IDS[0],'Anaerobic Natural',null,null],[IDS[1],'Natural',null,'Hořká čokoláda, Chmel, Mango'],[IDS[2],'Natural',null,'hazelnut, toffee, panela sugar'],[IDS[3],'Washed','Medium','Cocoa, chocolate, nuts'],[IDS[4],'Natural + Washed',null,'Dark Chocolate, Cacao']]),'exact_fact_values');
 for(const p of products)actions.push({kind:'patchImage',product_id:p.product_id,entity_id:p.entity_id,body:{original_image_url:p.original_image_url.value}});
 must(baseline.parents.length===5&&baseline.variants.length===9&&baseline.facts.length===1&&baseline.facts[0].product_id===IDS[0]&&baseline.sources.length===5&&baseline.claims.length===5&&baseline.claims.every(c=>c.status==='failed'),'baseline_counts');
 const bundle={proposal,prior,baseline,actions,products};validateState(baseline,baseline);return bundle;
}
function descriptor(kind,b,offset=0,actionIndex,expected){
 const owners=b.products.map(p=>p.entity_id).sort(),urls=[...new Set(b.prior.targets.flatMap(t=>[t.source_url,t.observed_canonical_url]))],q=new URLSearchParams({select:'*',limit:'100'});let table,method='GET',body;
 const inList=(k,v)=>q.set(k,'in.('+v.map(x=>/[(),"]/.test(x)?'"'+x.replace(/"/g,'\\"')+'"':x).join(',')+')'),eq=(k,v)=>q.set(k,v===null?'is.null':'eq.'+(typeof v==='object'?JSON.stringify(v):String(v)));
 if(kind==='owners'){table='entities';inList('id',owners);q.set('order','id.asc');}
 else if(kind==='roles'||kind==='sources'){table=kind==='roles'?'entity_roles':'entity_source_ids';inList('entity_id',owners);q.set('order',kind==='roles'?'entity_id.asc,role.asc':'id.asc');}
 else if(kind==='sourceKeys'){table='entity_source_ids';eq('source','my_coffee_explorer');inList('source_id',b.baseline.sources.map(s=>s.source_id));q.set('order','id.asc');}
 else if(kind==='canonicalOut'||kind==='canonicalIn'){table='entity_attributes';eq('attribute_key','canonical_roaster_entity_id');inList(kind==='canonicalOut'?'entity_id':'attribute_value',owners);q.set('order','id.asc');}
 else if(kind==='crawlState'){table='entity_crawl_state';inList('entity_id',owners);q.set('order','entity_id.asc');}
 else if(kind==='activeClaims'||kind==='ownerClaims'){table='crawl_runs';inList('entity_id',owners);if(kind==='activeClaims')eq('status','running');q.set('order','id.asc');}
 else if(kind==='claims'){table='crawl_runs';inList('id',b.baseline.claims.map(c=>c.id));q.set('order','id.asc');}
 else if(kind==='parents'){table='products';inList('id',IDS);q.set('order','id.asc');}
 else if(kind==='sourceProducts'){table='products';inList('source_url',urls);q.set('select','id,entity_id,source_url');q.set('order','id.asc');}
 else if(kind==='variants'||kind==='facts'||kind==='media'){table={variants:'product_variants',facts:'coffee_facts',media:'product_media'}[kind];inList('product_id',IDS);q.set('order',kind==='facts'?'product_id.asc':kind==='media'?'product_id.asc,media_asset_id.asc':'id.asc');}
 else if(kind==='assets'){table='media_assets';inList('id',b.baseline.assets.map(a=>a.id));q.set('order','id.asc');}
 else if(kind==='knownPages'){table='known_pages';inList('entity_id',owners);inList('url',urls);q.set('order','entity_id.asc,url.asc');}
 else if(kind==='mutation'){
  must(Number.isInteger(actionIndex)&&actionIndex>=0&&actionIndex<10&&offset===0,'mutation_scope');const a=b.actions[actionIndex];body=copy(a.body);q.delete('limit');
  if(a.kind==='insertFact'){table='coffee_facts';method='POST';must(!expected.facts.some(f=>f.product_id===a.product_id),'fact_already_exists');}
  else if(a.kind==='patchFact'){table='coffee_facts';method='PATCH';const before=expected.facts.find(f=>f.product_id===a.product_id);must(before&&before.process===null&&before.elevation_m===null,'fact_not_null');for(const[k,v]of Object.entries(before))eq(k,v);}
  else if(a.kind==='patchImage'){table='products';method='PATCH';const before=expected.parents.find(p=>p.id===a.product_id);must(before&&before.entity_id===a.entity_id&&before.original_image_url===null,'image_not_null');for(const k of ['id','entity_id','source_url','updated_at','original_image_url'])eq(k,before[k]);}
  else must(false,'mutation_kind');
 }else must(false,'request_out_of_scope');
 must(Number.isInteger(offset)&&offset>=0&&offset<100,'offset_scope');if(offset){must(READS.includes(kind),'offset_scope');q.set('offset',String(offset));q.set('limit','1');}
 return{kind,method,url:ORIGIN+'/rest/v1/'+table+'?'+q,body,offset,...(kind==='mutation'?{actionIndex}:{})};
}
async function responseText(r){must(r.body?.getReader,'streaming_body_required');const reader=r.body.getReader(),parts=[];let size=0;try{for(;;){const{done,value}=await reader.read();if(done)break;size+=value.length;must(size<=4*1024*1024,'response_too_large');parts.push(Buffer.from(value));}return Buffer.concat(parts).toString('utf8');}finally{reader.releaseLock();}}
function createClient({bundle,key,allowWrites=false,delegate=globalThis.fetch.bind(globalThis),event=()=>{},checkLock=()=>{},validateWrite=()=>{},now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 let active=false,stopped=false,count=0,finished=null;const writes=new Set(),started=now();
 return{get requests(){return count;},async request(kind,offset=0,actionIndex,expected){let timer,admitted=false;try{
  must(!active&&!stopped,'transport_stopped_or_concurrent');must(count<MAX_REQUESTS&&now()-started<MAX_TIME,'request_or_time_bound');active=true;admitted=true;
  const d=descriptor(kind,bundle,offset,actionIndex,expected),writing=d.method!=='GET';must(!writing||allowWrites,'preview_write_refused');if(writing)must(!writes.has(actionIndex),'mutation_retry_forbidden');checkLock();
  while(finished!==null&&now()-finished<500){must(!stopped&&now()-started<MAX_TIME,'transport_stopped_or_time_bound');await wait(500-(now()-finished));}
  must(!stopped&&now()-started<MAX_TIME,'transport_stopped_or_time_bound');checkLock();if(writing){validateWrite();writes.add(actionIndex);}count++;
  event({event:'request_intent',request:count,kind,offset,method:d.method,descriptor_sha256:sha(canonical(d)),...(writing?{actionIndex,body:d.body,cas_url:d.method==='PATCH'?d.url:null}:{})});
  const abort=new AbortController();timer=setTimeout(()=>abort.abort(),20000);
  const r=await delegate(d.url,{method:d.method,headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json',...(writing?{'Content-Type':'application/json',Prefer:'return=representation'}:{})},redirect:'error',signal:abort.signal,...(writing?{body:JSON.stringify(d.body)}:{})});
  must(r&&!r.redirected&&r.url===d.url,'response_url_redirect');const text=await responseText(r),jsonType=/^application\/json(?:;|$)/i.test(r.headers.get('content-type')||'');
  if(!(d.method==='POST'?[201]:writing?[200]:[200,206]).includes(r.status)){const e=Object.assign(Error('database_http_error'),{code:'database_http_error',httpStatus:r.status});try{e.dbCode=JSON.parse(text).code;}catch{}if(kind==='crawlState'&&r.status===404&&e.dbCode==='PGRST205'&&jsonType){event({event:'optional_crawl_state_table_absent',permission_inferred:false});return[];}throw e;}
  must(jsonType,'response_content_type');const rows=JSON.parse(text);must(Array.isArray(rows)&&rows.length<100,'response_shape_or_bound');
  if(!writing){const m=/^(?:(\d+)-(\d+)|\*)\/(?:\d+|\*)$/.exec(r.headers.get('content-range')||'');must(m&&(rows.length?Number(m[1])===offset&&Number(m[2])-Number(m[1])+1===rows.length:m[1]===undefined),'content_range');}
  event({event:'request_result',request:count,kind,offset,status:r.status,...(writing?{actionIndex}:{}),rows});return rows;
 }catch(e){stopped=true;event({event:'request_failure',kind,offset,...(Number.isInteger(actionIndex)?{actionIndex}:{}),...diag(e)});throw e;}finally{clearTimeout(timer);if(admitted){finished=now();active=false;}}}};
}
function validateState(actual,expected){
 must(same(Object.keys(actual).sort(),READS.slice().sort())&&same(Object.keys(expected).sort(),READS.slice().sort()),'context_schema');
 for(const k of READS)must(Array.isArray(actual[k])&&same(sorted(actual[k]),sorted(expected[k])),k+'_drift');
 for(const k of ['canonicalOut','canonicalIn','activeClaims','knownPages'])must(actual[k].length===0,k+'_conflict');
 must(actual.crawlState.every(r=>r.allow_crawl!==false),'crawl_disabled');must(actual.claims.every(r=>r.status==='failed'),'claim_state');
}
async function inspect(c){const state={};for(const k of READS){state[k]=await c.request(k);if(state[k].length)must((await c.request(k,state[k].length)).length===0,'nonempty_continuation:'+k);}return state;}
function helperSha(){return sha(fs.readFileSync(__filename));}
function validatePreview(p,b,now=Date.now()){must(p.status==='preview_complete'&&p.proposal_sha256===PROPOSAL_SHA&&p.helper_sha256===helperSha(),'preview_binding');const age=now-Date.parse(p.at);must(Number.isFinite(age)&&age>=0&&age<TTL,'preview_expired');validateState(p.before,b.baseline);}
function validateReturned(rows,a,expected){
 must(rows.length===1,'mutation_not_one');const row=rows[0];
 if(a.kind==='insertFact'){must(same(Object.keys(row).sort(),FACT_FIELDS.slice().sort()),'fact_schema');for(const[k,v]of Object.entries(a.body))must(same(row[k],v),'insert_fact_value:'+k);for(const k of ['created_at','updated_at'])must(typeof row[k]==='string'&&Number.isFinite(Date.parse(row[k])),'fact_timestamp');}
 else{const before=(a.kind==='patchFact'?expected.facts:expected.parents).find(r=>(r.product_id||r.id)===a.product_id),wanted={...before,...a.body};must(same(Object.keys(row).sort(),Object.keys(wanted).sort()),'returned_schema');for(const[k,v]of Object.entries(wanted))if(k!=='updated_at')must(same(row[k],v),'preservation:'+k);must(typeof row.updated_at==='string'&&Number.isFinite(Date.parse(row.updated_at))&&Date.parse(row.updated_at)>=Date.parse(before.updated_at),'updated_at_invalid');}
 return copy(row);
}
async function execute({client,bundle,mode='preview',preview,append=()=>{},checkLock=()=>{},now=Date.now}){
 must(mode==='preview'||mode==='apply','invalid_mode');if(mode==='apply')validatePreview(preview,bundle,now());
 const before=await inspect(client);validateState(before,bundle.baseline);append({event:'before_complete',before});
 if(mode==='preview')return{at:new Date(now()).toISOString(),status:'preview_complete',proposal_sha256:PROPOSAL_SHA,helper_sha256:helperSha(),before,requests:client.requests,writes:0,full_product_completion:false};
 validatePreview(preview,bundle,now());validateState(before,preview.before);const expected=copy(before),returned=[];
 for(let i=0;i<bundle.actions.length;i++){
  validatePreview(preview,bundle,now());const fresh=await inspect(client);validateState(fresh,expected);validatePreview(preview,bundle,now());checkLock();
  const a=bundle.actions[i];append({event:'mutation_attempt_no_retry',actionIndex:i,action:a});const rows=await client.request('mutation',0,i,expected),row=validateReturned(rows,a,expected);returned.push({actionIndex:i,row});append({event:'mutation_verified',actionIndex:i,row});
  const key=a.kind==='patchImage'?'parents':'facts';expected[key]=expected[key].filter(r=>(r.product_id||r.id)!==a.product_id).concat(row);
 }
 const after=await inspect(client);validateState(after,expected);append({event:'after_verified',after});return{at:new Date(now()).toISOString(),status:'partial_null_fills_verified',proposal_sha256:PROPOSAL_SHA,helper_sha256:helperSha(),requests:client.requests,mutation_requests:10,fact_patch_fields:2,fact_insert_rows:4,parent_image_fields:5,before,returned,after,full_product_completion:false,crawl_completion_claimed:false,variant_changes:0,media_changes:0,claim_changes:0,known_page_changes:0,description_changes:0,nontransactional_caveat:'Fresh full-row checks and null/version CAS do not form a transaction. Parent image PATCH bodies contain only original_image_url. Any attempted request with an error requires separate read-only reconciliation; no replay.'};
}
function acquireLock(file){const fd=fs.openSync(file,'wx',0o600),stat=fs.fstatSync(fd),text=JSON.stringify({pid:process.pid,scope:TAG,token:crypto.randomUUID(),at:stamp()});fs.writeSync(fd,text);fs.fsyncSync(fd);sync(path.dirname(file));const check=()=>{const s=fs.lstatSync(file);must(s.isFile()&&!s.isSymbolicLink()&&s.ino===stat.ino&&s.dev===stat.dev&&fs.readFileSync(file,'utf8')===text,'lock_ownership_lost');};return{check,release(){try{check();fs.unlinkSync(file);sync(path.dirname(file));}finally{fs.closeSync(fd);}}};}
function cli(args){if(!args.length||same(args,['--check']))return{mode:'check'};if(same(args,['--preview']))return{mode:'preview'};must(args.length===4&&args[0]==='--apply'&&/^[a-f0-9]{64}$/.test(args[2])&&args[3]==='--confirm-ten-null-fill-writes','invalid_cli');return{mode:'apply',previewFile:args[1],previewSha:args[2]};}
async function main(){
 const opts=cli(process.argv.slice(2)),bundle=loadBundle();if(opts.mode==='check'){console.log(JSON.stringify({status:'offline_check_pass',proposal_sha256:PROPOSAL_SHA,products:5,mutation_requests:10,fact_patch_fields:2,fact_insert_rows:4,parent_image_fields:5,networkRequests:0}));return;}
 must(fs.realpathSync(process.cwd())===ROOT&&fs.realpathSync(__dirname)===ROOT+'/src/myCoffeeExplorerImport','production_runtime_required');must(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL||'').href===ORIGIN+'/','database_origin');const key=process.env.SUPABASE_SERVICE_ROLE_KEY;must(typeof key==='string'&&key.length>20,'credentials_missing');let preview;
 if(opts.mode==='apply'){const file=fs.realpathSync(opts.previewFile);must(path.dirname(path.dirname(file))===STATE&&new RegExp('^'+TAG+'-preview-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$').test(path.basename(path.dirname(file)))&&path.basename(file)==='result.json','preview_path');const raw=fs.readFileSync(file);must(sha(raw)===opts.previewSha,'preview_hash');preview=JSON.parse(raw);validatePreview(preview,bundle);}
 const locks=[],dir=STATE+'/'+TAG+(opts.mode==='apply'?'-apply':'-preview-'+crypto.randomUUID()),tls=process.env.NODE_TLS_REJECT_UNAUTHORIZED;let fd;
 try{locks.push(acquireLock(ROOT+'/.state/my-coffee-explorer/apply.lock'));for(const id of bundle.products.map(p=>p.entity_id).sort())locks.push(acquireLock(ROOT+'/.state/my-coffee-explorer/.product-only-entity-locks/'+id+'.lock'));const checkLock=()=>locks.forEach(l=>l.check());
  fs.mkdirSync(dir,{mode:0o700});sync(STATE);save(path.join(dir,'reservation.json'),{at:stamp(),mode:opts.mode,proposal_sha256:PROPOSAL_SHA,helper_sha256:helperSha(),preview_sha256:opts.previewSha||null,owners:bundle.products.map(p=>p.entity_id),retries:0});
  fd=fs.openSync(path.join(dir,'events.ndjson'),'wx',0o600);fs.fsyncSync(fd);sync(dir);let stopped=false;const append=e=>{must(!stopped,'journal_latched_stop');try{const bytes=Buffer.from(JSON.stringify({at:stamp(),...e})+'\n');let n=0;while(n<bytes.length){const wrote=fs.writeSync(fd,bytes,n,bytes.length-n);must(wrote>0,'journal_short_write');n+=wrote;}fs.fsyncSync(fd);}catch(e){stopped=true;throw e;}};
  process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';const client=createClient({bundle,key,allowWrites:opts.mode==='apply',event:append,checkLock,validateWrite:()=>validatePreview(preview,bundle)});const result=await execute({client,bundle,mode:opts.mode,preview,append,checkLock});save(path.join(dir,'result.json'),result);console.log(JSON.stringify({status:result.status,directory:dir,sha256:sha(fs.readFileSync(path.join(dir,'result.json')))}));
 }catch(e){if(fd!==undefined)try{save(path.join(dir,'failure.json'),{at:stamp(),status:'stopped_review_required',error:diag(e),warning:'Any attempted write may have committed. Never retry or resume this apply directory; independently reconcile exact rows.'});}catch{}throw e;}finally{if(fd!==undefined)fs.closeSync(fd);if(tls===undefined)delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;else process.env.NODE_TLS_REJECT_UNAUTHORIZED=tls;let failure;for(const l of locks.reverse())try{l.release();}catch(e){failure=e;}if(failure)throw failure;}
}
module.exports={ROOT,STATE,ORIGIN,TAG,PROPOSAL_FILE,PROPOSAL_SHA,PRIOR_PLAN,PRIOR_SHA,IDS,FACT_FIELDS,READS,TTL,MAX_REQUESTS,MAX_TIME,sha,same,canonical,copy,loadBundle,descriptor,createClient,inspect,validateState,validatePreview,validateReturned,execute,acquireLock,cli,main};
if(require.main===module)main().catch(e=>{console.error(JSON.stringify(diag(e)));process.exitCode=1;});
