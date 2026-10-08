'use strict';
// Eleven exact null-only PATCHes; no inserts/deletes or crawler pipeline.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT='/Users/allan/.openclaw/workspace/coffee-roaster-crawler',STATE=ROOT+'/.state/my-coffee-explorer/2026-09-26',ORIGIN='https://gtlipifdfyugiwpxvuse.supabase.co';
const TAG='batch4d-eleven-field-repair',BASE=__dirname===ROOT+'/src/myCoffeeExplorerImport'?STATE:__dirname;
const PROPOSAL_FILE='batch4d-eleven-field-proposal.json',PROPOSAL_SHA='182163d431880888b91673aa4e39e9714a1c050d060044858741942fc26ac90c';
const READBACK='finite-product-queue-v1/product-seed-batch4d-reviewed/after.json',SNAPSHOT='snapshot-sequential-v3-post-recovery-0912/snapshot.json';
const READS=['owners','roles','sources','sourceKeys','canonicalOut','canonicalIn','crawlState','activeClaims','parents','sourceProducts','variants','facts','media','knownPages','claims','ownerClaims'];
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
 for(const[f,h]of Object.entries(proposal.evidence_pins))must(sha(read(f))===h,'evidence_hash');
 const {proposalHash,...content}=proposal;must(sha(canonical(content))===proposalHash,'proposal_content_hash');
 const receipt=JSON.parse(read(READBACK)),snapshot=JSON.parse(read(SNAPSHOT)),actions=proposal.actions;
 must(proposal.database_origin===ORIGIN&&actions.length===11&&proposal.excluded_actions.length===9,'proposal_scope');
 must(same(actions.map(a=>[a.table,a.original_action_index,a.patch]),[['coffee_facts',0,{decaf:true}],['coffee_facts',1,{decaf:true}],['coffee_facts',2,{decaf:true}],['coffee_facts',3,{decaf:true}],['coffee_facts',4,{decaf:true}],['product_variants',5,{weight_g:250}],['product_variants',8,{weight_g:250}],['product_variants',11,{weight_g:250}],['product_variants',14,{weight_g:283}],['product_variants',18,{weight_g:283}],['product_variants',19,{weight_g:2268}]]),'exact_action_scope');
 const ids=[...new Set(actions.map(a=>a.key.product_id))].sort(),owners=proposal.owners.map(o=>o.entity.id).sort();
 must(ids.length===10&&new Set(owners).size===6,'target_counts');
 for(const a of actions){
  const p=pointer(receipt,a.product_binding.product_receipt.pointer),r=pointer(receipt,a.row_receipt.pointer),e=a.evidence;
  must(a.product_binding.product_receipt.file===READBACK&&a.row_receipt.file===READBACK&&proposal.evidence_pins[READBACK]===a.row_receipt.sha256&&a.row_receipt.sha256===a.product_binding.product_receipt.sha256,'row_receipt_binding');
  must(p.id===a.key.product_id&&p.entity_id===a.product_binding.entity_id&&p.source_url===a.product_binding.source_url&&p.is_active===true&&owners.includes(p.entity_id),'product_binding');
  must(sha(canonical(p))===a.product_binding.retained_full_product_sha256&&sha(canonical(p.metadata))===a.product_binding.retained_metadata_sha256,'product_projection_hash');
  must(same(r,a.retained_before)&&sha(canonical(r))===a.retained_before_sha256&&r.product_id===p.id,'retained_row');
  const field=a.table==='coffee_facts'?'decaf':'weight_g';must(r[field]===null,'retained_not_null');
  if(field==='weight_g')must(r.id===a.key.id&&/^(?:whole bean|default title)$/i.test(r.variant_name),'whole_bean_scope');
  const text=pointer(receipt,e.field_pointer);must(typeof text==='string'&&sha(text)===e.full_field_utf8_sha256&&text.slice(e.field_utf16_offset,e.field_utf16_offset+e.exact_fragment.length)===e.exact_fragment&&sha(e.exact_fragment)===e.fragment_sha256,'source_fragment');
  const cat=pointer(JSON.parse(read(e.catalog.file)),e.catalog.pointer);must(proposal.evidence_pins[e.catalog.file]===e.catalog.sha256&&same(cat,e.catalog.facts)&&cat.productUrl===p.source_url,'catalog_binding');
 }
 const productSet=new Set(ids),ownerSet=new Set(owners);
 const historical={
  owners:snapshot.entities.filter(x=>ownerSet.has(x.id)),roles:snapshot.roles.filter(x=>ownerSet.has(x.entity_id)),
  sources:snapshot.sourceIds.filter(x=>ownerSet.has(x.entity_id)),parents:receipt.products.filter(x=>productSet.has(x.id)),
  variants:receipt.variants.filter(x=>productSet.has(x.product_id)),facts:receipt.facts.filter(x=>productSet.has(x.product_id)),media:receipt.media.filter(x=>productSet.has(x.product_id)),
  claims:receipt.runs.filter(x=>ownerSet.has(x.entity_id))
 };
 historical.sourceKeys=copy(historical.sources);historical.ownerClaims=copy(historical.claims);historical.sourceProducts=historical.parents.map(p=>({id:p.id,entity_id:p.entity_id,source_url:p.source_url}));
 must(historical.owners.length===6&&historical.sources.length===6&&historical.claims.length===6&&historical.parents.length===10&&historical.variants.length===20&&historical.facts.length===10&&historical.media.length===9,'retained_counts');
 must(snapshot.canonicalLinks.every(l=>!ownerSet.has(l.entity_id)&&!ownerSet.has(l.attribute_value)),'retained_canonical_conflict');
 for(const o of proposal.owners){must(same(historical.owners.find(x=>x.id===o.entity.id),o.entity)&&same(sorted(historical.sources.filter(x=>x.entity_id===o.entity.id)),sorted(o.snapshot_source_rows)),'owner_source_binding');must(historical.roles.some(r=>r.entity_id===o.entity.id&&r.role==='roaster'),'roaster_role_required');}
 for(const e of proposal.excluded_actions){const row=historical.variants.find(v=>v.id===e.key.id);must(row&&row.product_id===e.key.product_id&&row.variant_name===e.retained_variant_name&&row.weight_g===null&&!actions.some(a=>a.key.id===row.id),'excluded_ground_binding');}
 const bundle={proposal,actions,ids,owners,historical,products:historical.parents};
 validateHistorical({...copy(historical),canonicalOut:[],canonicalIn:[],crawlState:[],activeClaims:[],knownPages:[]},bundle);
 return bundle;
}
function descriptor(kind,b,offset=0,actionIndex,expected){
 const q=new URLSearchParams({select:'*',limit:'100'}),urls=b.products.map(p=>p.source_url);let table,method='GET',body;
 const inList=(k,v)=>q.set(k,'in.('+v.map(x=>/[(),"]/.test(x)?'"'+x.replace(/"/g,'\\"')+'"':x).join(',')+')'),eq=(k,v)=>q.set(k,v===null?'is.null':'eq.'+(typeof v==='object'?JSON.stringify(v):String(v)));
 if(kind==='owners'){table='entities';inList('id',b.owners);q.set('order','id.asc');}
 else if(kind==='roles'||kind==='sources'){table=kind==='roles'?'entity_roles':'entity_source_ids';inList('entity_id',b.owners);q.set('order',kind==='roles'?'entity_id.asc,role.asc':'id.asc');}
 else if(kind==='sourceKeys'){table='entity_source_ids';eq('source','my_coffee_explorer');inList('source_id',b.historical.sources.map(s=>s.source_id));q.set('order','id.asc');}
 else if(kind==='canonicalOut'||kind==='canonicalIn'){table='entity_attributes';eq('attribute_key','canonical_roaster_entity_id');inList(kind==='canonicalOut'?'entity_id':'attribute_value',b.owners);q.set('order','id.asc');}
 else if(kind==='crawlState'){table='entity_crawl_state';inList('entity_id',b.owners);q.set('order','entity_id.asc');}
 else if(kind==='activeClaims'||kind==='ownerClaims'){table='crawl_runs';inList('entity_id',b.owners);if(kind==='activeClaims')eq('status','running');q.set('order','id.asc');}
 else if(kind==='claims'){table='crawl_runs';inList('id',b.historical.claims.map(c=>c.id));q.set('order','id.asc');}
 else if(kind==='parents'){table='products';inList('id',b.ids);q.set('order','id.asc');}
 else if(kind==='sourceProducts'){table='products';inList('source_url',urls);q.set('select','id,entity_id,source_url');q.set('order','id.asc');}
 else if(kind==='variants'||kind==='facts'||kind==='media'){table={variants:'product_variants',facts:'coffee_facts',media:'product_media'}[kind];inList('product_id',b.ids);q.set('order',kind==='facts'?'product_id.asc':kind==='media'?'product_id.asc,media_asset_id.asc':'id.asc');}
 else if(kind==='knownPages'){table='known_pages';inList('entity_id',b.owners);inList('url',urls);q.set('order','entity_id.asc,url.asc');}
 else if(kind==='mutation'){
  must(Number.isInteger(actionIndex)&&actionIndex>=0&&actionIndex<11&&offset===0,'mutation_scope');const a=b.actions[actionIndex];table=a.table;method='PATCH';body=copy(a.patch);q.delete('limit');
  const rows=table==='coffee_facts'?expected.facts:expected.variants,before=rows.find(r=>table==='coffee_facts'?r.product_id===a.key.product_id:r.id===a.key.id);
  must(before&&before.product_id===a.key.product_id&&before[table==='coffee_facts'?'decaf':'weight_g']===null,'target_not_null');
  if(table==='product_variants')weightVacancy(expected,a);
  for(const[k,v]of Object.entries(before))eq(k,v);
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
function rowKey(k,r){return k==='roles'?r.entity_id+'|'+r.role:k==='media'?r.product_id+'|'+r.media_asset_id:k==='facts'?r.product_id:r.id;}
function historicalRows(actual,wanted,k){
 must(Array.isArray(actual)&&actual.length===wanted.length,k+'_historical_count');
 const seen=new Set();for(const r of actual){const key=rowKey(k,r);must(key&&!seen.has(key),k+'_duplicate');seen.add(key);}
 for(const old of wanted){const row=actual.find(r=>rowKey(k,r)===rowKey(k,old));must(row,k+'_historical_missing');const projection=Object.fromEntries(Object.keys(old).map(key=>[key,row[key]]));must(same(projection,old),k+'_historical_drift');if(['variants','facts','media'].includes(k))must(same(row,old),k+'_schema_drift');}
}
function checkContext(state,b){
 must(same(Object.keys(state).sort(),READS.slice().sort()),'context_schema');for(const k of READS)must(Array.isArray(state[k]),'context_array');
 for(const k of ['canonicalOut','canonicalIn','activeClaims'])must(state[k].length===0,k+'_conflict');
 must(state.crawlState.every(r=>b.owners.includes(r.entity_id)&&r.allow_crawl!==false),'crawl_disabled');
 must(state.claims.every(r=>['failed','completed'].includes(r.status)),'claim_state');
 for(const row of state.knownPages)must(b.products.some(p=>p.entity_id===row.entity_id&&p.source_url===row.url),'known_page_scope');
 const pairs=new Set();for(const v of state.variants)if(v.weight_g!==null){const pair=v.product_id+'|'+v.weight_g;must(!pairs.has(pair),'duplicate_product_weight');pairs.add(pair);}
}
function weightVacancy(state,a){must(!state.variants.some(v=>v.product_id===a.key.product_id&&v.weight_g===a.patch.weight_g),'target_weight_occupied');}
function validateHistorical(state,b){
 checkContext(state,b);for(const[k,wanted]of Object.entries(b.historical))historicalRows(state[k],wanted,k);
 for(const a of b.actions){const row=(a.table==='coffee_facts'?state.facts:state.variants).find(r=>a.table==='coffee_facts'?r.product_id===a.key.product_id:r.id===a.key.id);must(row&&same(row,a.retained_before),'target_row_drift');if(a.table==='product_variants')weightVacancy(state,a);}
}
function validateState(actual,expected,b){checkContext(actual,b);checkContext(expected,b);for(const k of READS)must(same(sorted(actual[k]),sorted(expected[k])),k+'_drift');}
async function inspect(c){const state={};for(const k of READS){state[k]=await c.request(k);if(state[k].length)must((await c.request(k,state[k].length)).length===0,'nonempty_continuation:'+k);}return state;}
function helperSha(){return sha(fs.readFileSync(__filename));}
function validatePreview(p,b,now=Date.now()){must(p.status==='preview_complete'&&p.proposal_sha256===PROPOSAL_SHA&&p.helper_sha256===helperSha(),'preview_binding');const age=now-Date.parse(p.at);must(Number.isFinite(age)&&age>=0&&age<TTL,'preview_expired');validateHistorical(p.before,b);}
function validateReturned(rows,a,expected){
 must(rows.length===1,'mutation_not_one');const row=rows[0],before=(a.table==='coffee_facts'?expected.facts:expected.variants).find(r=>a.table==='coffee_facts'?r.product_id===a.key.product_id:r.id===a.key.id),wanted={...before,...a.patch};
 must(same(Object.keys(row).sort(),Object.keys(wanted).sort()),'returned_schema');for(const[k,v]of Object.entries(wanted))if(k!=='updated_at')must(same(row[k],v),'preservation:'+k);
 must(typeof row.updated_at==='string'&&Number.isFinite(Date.parse(row.updated_at))&&Date.parse(row.updated_at)>=Date.parse(before.updated_at),'updated_at_invalid');return copy(row);
}
async function execute({client,bundle,mode='preview',preview,append=()=>{},checkLock=()=>{},now=Date.now}){
 must(mode==='preview'||mode==='apply','invalid_mode');if(mode==='apply')validatePreview(preview,bundle,now());
 const before=await inspect(client);validateHistorical(before,bundle);append({event:'before_complete',before});
 if(mode==='preview')return{at:new Date(now()).toISOString(),status:'preview_complete',proposal_sha256:PROPOSAL_SHA,helper_sha256:helperSha(),before,requests:client.requests,writes:0,historical_projections_verified:true,current_full_rows_captured:true,nontransactional:true};
 validatePreview(preview,bundle,now());validateState(before,preview.before,bundle);const expected=copy(before),returned=[];
 for(let i=0;i<bundle.actions.length;i++){
  validatePreview(preview,bundle,now());const fresh=await inspect(client);validateState(fresh,expected,bundle);validatePreview(preview,bundle,now());checkLock();
  const a=bundle.actions[i];if(a.table==='product_variants')weightVacancy(fresh,a);append({event:'mutation_attempt_no_retry',actionIndex:i,key:a.key,table:a.table,patch:a.patch});
  const rows=await client.request('mutation',0,i,expected),row=validateReturned(rows,a,expected);returned.push({actionIndex:i,row});append({event:'mutation_verified',actionIndex:i,row});
  const key=a.table==='coffee_facts'?'facts':'variants';expected[key]=expected[key].filter(r=>a.table==='coffee_facts'?r.product_id!==a.key.product_id:r.id!==a.key.id).concat(row);
 }
 const after=await inspect(client);validateState(after,expected,bundle);append({event:'after_verified',after});return{at:new Date(now()).toISOString(),status:'eleven_field_repair_verified',proposal_sha256:PROPOSAL_SHA,helper_sha256:helperSha(),requests:client.requests,mutation_requests:11,decaf_null_fills:5,weight_null_fills:6,ground_variants_preserved:9,before,returned,after,inserts:0,deletes:0,price_changes:0,parent_changes:0,media_changes:0,claim_changes:0,known_page_changes:0,full_product_completion:false,crawl_completion_claimed:false,nontransactional_caveat:'Historical product and identity projections are checked against fresh complete rows. Every write is null/full-child-row CAS after fresh context verification. This is not a transaction; ambiguous failures require separate read-only reconciliation, never replay.'};
}
function acquireLock(file){const fd=fs.openSync(file,'wx',0o600),stat=fs.fstatSync(fd),text=JSON.stringify({pid:process.pid,scope:TAG,token:crypto.randomUUID(),at:stamp()});fs.writeSync(fd,text);fs.fsyncSync(fd);sync(path.dirname(file));const check=()=>{const s=fs.lstatSync(file);must(s.isFile()&&!s.isSymbolicLink()&&s.ino===stat.ino&&s.dev===stat.dev&&fs.readFileSync(file,'utf8')===text,'lock_ownership_lost');};return{check,release(){try{check();fs.unlinkSync(file);sync(path.dirname(file));}finally{fs.closeSync(fd);}}};}
function cli(args){if(!args.length||same(args,['--check']))return{mode:'check'};if(same(args,['--preview']))return{mode:'preview'};must(args.length===4&&args[0]==='--apply'&&/^[a-f0-9]{64}$/.test(args[2])&&args[3]==='--confirm-eleven-field-writes','invalid_cli');return{mode:'apply',previewFile:args[1],previewSha:args[2]};}
async function main(){
 const opts=cli(process.argv.slice(2)),bundle=loadBundle();if(opts.mode==='check'){console.log(JSON.stringify({status:'offline_check_pass',proposal_sha256:PROPOSAL_SHA,products:10,owners:6,mutation_requests:11,decaf_null_fills:5,weight_null_fills:6,networkRequests:0}));return;}
 must(fs.realpathSync(process.cwd())===ROOT&&fs.realpathSync(__dirname)===ROOT+'/src/myCoffeeExplorerImport','production_runtime_required');must(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL||'').href===ORIGIN+'/','database_origin');const key=process.env.SUPABASE_SERVICE_ROLE_KEY;must(typeof key==='string'&&key.length>20,'credentials_missing');let preview;
 if(opts.mode==='apply'){const file=fs.realpathSync(opts.previewFile);must(path.dirname(path.dirname(file))===STATE&&new RegExp('^'+TAG+'-preview-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$').test(path.basename(path.dirname(file)))&&path.basename(file)==='result.json','preview_path');const raw=fs.readFileSync(file);must(sha(raw)===opts.previewSha,'preview_hash');preview=JSON.parse(raw);validatePreview(preview,bundle);}
 const locks=[],dir=STATE+'/'+TAG+(opts.mode==='apply'?'-apply':'-preview-'+crypto.randomUUID()),tls=process.env.NODE_TLS_REJECT_UNAUTHORIZED;let fd;
 try{locks.push(acquireLock(ROOT+'/.state/my-coffee-explorer/apply.lock'));for(const id of bundle.owners)locks.push(acquireLock(ROOT+'/.state/my-coffee-explorer/.product-only-entity-locks/'+id+'.lock'));const checkLock=()=>locks.forEach(l=>l.check());
  fs.mkdirSync(dir,{mode:0o700});sync(STATE);save(path.join(dir,'reservation.json'),{at:stamp(),mode:opts.mode,proposal_sha256:PROPOSAL_SHA,helper_sha256:helperSha(),preview_sha256:opts.previewSha||null,owners:bundle.owners,retries:0});
  fd=fs.openSync(path.join(dir,'events.ndjson'),'wx',0o600);fs.fsyncSync(fd);sync(dir);let stopped=false;const append=e=>{must(!stopped,'journal_latched_stop');try{const bytes=Buffer.from(JSON.stringify({at:stamp(),...e})+'\n');let n=0;while(n<bytes.length){const wrote=fs.writeSync(fd,bytes,n,bytes.length-n);must(wrote>0,'journal_short_write');n+=wrote;}fs.fsyncSync(fd);}catch(e){stopped=true;throw e;}};
  process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';const client=createClient({bundle,key,allowWrites:opts.mode==='apply',event:append,checkLock,validateWrite:()=>validatePreview(preview,bundle)});const result=await execute({client,bundle,mode:opts.mode,preview,append,checkLock});save(path.join(dir,'result.json'),result);console.log(JSON.stringify({status:result.status,directory:dir,sha256:sha(fs.readFileSync(path.join(dir,'result.json')))}));
 }catch(e){if(fd!==undefined)try{save(path.join(dir,'failure.json'),{at:stamp(),status:'stopped_review_required',error:diag(e),warning:'Any attempted write may have committed. Never retry or resume this apply directory; independently reconcile exact rows.'});}catch{}throw e;}finally{if(fd!==undefined)fs.closeSync(fd);if(tls===undefined)delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;else process.env.NODE_TLS_REJECT_UNAUTHORIZED=tls;let failure;for(const l of locks.reverse())try{l.release();}catch(e){failure=e;}if(failure)throw failure;}
}
module.exports={ROOT,STATE,ORIGIN,TAG,PROPOSAL_FILE,PROPOSAL_SHA,READBACK,SNAPSHOT,READS,TTL,MAX_REQUESTS,MAX_TIME,sha,same,canonical,copy,loadBundle,descriptor,createClient,inspect,validateHistorical,validateState,validatePreview,validateReturned,weightVacancy,execute,acquireLock,cli,main};
if(require.main===module)main().catch(e=>{console.error(JSON.stringify(diag(e)));process.exitCode=1;});

