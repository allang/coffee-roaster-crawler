'use strict';
// Exact five separately guarded PATCHes; no crawler/saver, inserts, deletes or automatic retry.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT='/Users/allan/.openclaw/workspace/coffee-roaster-crawler',STATE=ROOT+'/.state/my-coffee-explorer/2026-09-26',BASE=__dirname===ROOT+'/src/myCoffeeExplorerImport'?STATE:__dirname;
const ORIGIN='https://gtlipifdfyugiwpxvuse.supabase.co',TAG='batch8b-five-field-repair',PLAN='batch8b-five-field-repair-plan.json',PLAN_SHA='29da0b7771070a88a62d1b14d0492cf7051f9d3017afa88e890e7b05122fe987';
const DEP_SHA='d9b45e194440104fef42f1e83434ddfaf4fd0f5e9f8dc8f7bf96dbedf3668856';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),canon=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v),same=(a,b)=>canon(a)===canon(b),copy=x=>JSON.parse(JSON.stringify(x)),stamp=()=>new Date().toISOString();
const READS=['owners','roles','sources','canonicalOut','canonicalIn','crawlState','activeClaims','parents','variants','facts'],COLLECTIONS=new Set(['roles','sources','crawlState','variants','facts']);
const PRODUCTS=['a3156bbf-f620-48a9-91d6-7e3f04f93dac','d3cd356b-c660-4fbb-8bb3-0b1e59d52309'],OWNERS=['02bc6001-5b9c-4713-8ade-ff1fe4514a4f','73199495-d6f9-4922-a63d-a37448aebf66'];
const FIXED=[['products',PRODUCTS[0],{is_available:true,availability_reason:null,availability_checked_at:'2026-09-27T16:31:50.750Z'}],['product_variants','74bc5e71-e0dd-4ce5-8fe0-a8023173b0d5',{weight_g:227}],['product_variants','a72bbdc8-1672-4afd-b25c-803f374c8be9',{availability:'out_of_stock'}],['product_variants','f145a3ad-de3e-4bf2-96e7-7257973436e6',{availability:'out_of_stock'}],['coffee_facts',PRODUCTS[1],{process:'Black Honey'}]];
const TTL=600000,MAX_TIME=300000,MAX_BODY=4194304;
function must(v,c){if(!v)throw Object.assign(Error(c),{code:c});}
function diag(e){return{code:String(e.code||'repair_failed').replace(/[^a-zA-Z0-9_:-]/g,'').slice(0,90),...(Number.isInteger(e.httpStatus)?{httpStatus:e.httpStatus}:{}),...(/^[A-Z0-9]{1,16}$/.test(e.dbCode||'')?{databaseCode:e.dbCode}:{})};}
must(sha(fs.readFileSync(path.join(__dirname,'apply-batch5a-partial-null-fills.cjs')))===DEP_SHA,'lock_dependency_changed');
const {acquireLock}=require('./apply-batch5a-partial-null-fills.cjs');
function sorted(v){return v.map(canon).sort();}
function rowFor(state,a){return state[a.table==='products'?'parents':a.table==='product_variants'?'variants':'facts'].find(r=>a.table==='coffee_facts'?r.product_id===a.product_id:r.id===a.id);}
function loadBundle(base=BASE){
 const read=f=>{must(!path.isAbsolute(f)&&!f.split('/').includes('..'),'unsafe_pin_path');return fs.readFileSync(path.join(f.endsWith('.cjs')?__dirname:base,f));},raw=read(PLAN);must(sha(raw)===PLAN_SHA,'plan_changed');const b=JSON.parse(raw);
 for(const[f,h]of Object.entries(b.pins))must(sha(read(f))===h,'source_pin_changed');must(b.scope==='batch8b_exact_five_field_repair'&&b.actions.length===5&&same(b.owners.map(o=>o.entity_id),OWNERS),'plan_scope');
 must(b.source_at===FIXED[0][2].availability_checked_at&&same(b.actions.map(a=>[a.table,a.id||a.product_id,a.patch]),FIXED),'exact_actions');
 const proof=JSON.parse(read('batch8b-two-offers-source-refresh-1631/factual-review.json'));
 function verify(v){if(v&&typeof v==='object'){if(v.fragment_sha256){const text=read('batch8b-two-offers-source-refresh-1631/'+v.file).toString().slice(v.utf16_offset,v.utf16_offset+v.utf16_length);must(sha(text)===v.fragment_sha256,'source_fragment');}Object.values(v).forEach(verify);}}verify(proof);
 const blueText=read('batch8b-two-offers-source-refresh-1631/0.html').toString(),blackText=read('batch8b-two-offers-source-refresh-1631/2.html').toString(),blueScript=blueText.match(/<script type="application\/json" id="ProductJson-product-template">([\s\S]*?)<\/script>/),blue=JSON.parse(blueScript?.[1]||'null');
 must(blue?.id===10591951439&&blue.available===true&&blue.variants.length===1&&blue.variants[0].id===41047002218599&&blue.variants[0].available===true&&blue.description.includes('8oz bag: $11'),'blue_source_binding');
 const groups=[...blackText.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m=>JSON.parse(m[1])).filter(j=>j['@type']==='ProductGroup');must(groups.length===1,'own_product_group');const g=groups[0];must(g.productGroupID==='8451222143151'&&g.url==='https://www.cavalierroasters.com/products/costa-rica-black-diamond'&&g.hasVariant.length===6&&g.hasVariant.every(v=>v.offers.availability==='http://schema.org/OutOfStock'),'black_source_binding');must(/Process:\s*Black Honey<br\s*\/>/.test(blackText),'process_source');
 must(b.baseline.parents.length===2&&b.baseline.variants.length===3&&b.baseline.facts.length===2,'baseline_scope');
 for(const a of b.actions){const r=rowFor(b.baseline,a),p=b.baseline.parents.find(p=>p.id===a.product_id);must(r&&p?.entity_id===a.entity_id&&OWNERS.includes(a.entity_id),'action_owner');for(const k of Object.keys(a.patch))must(Object.hasOwn(r,k),'missing_target_field');}
 must(rowFor(b.baseline,b.actions[0]).is_available===false&&rowFor(b.baseline,b.actions[0]).availability_reason==='shopify_variants_unavailable'&&rowFor(b.baseline,b.actions[1]).weight_g===null&&[2,3].every(i=>rowFor(b.baseline,b.actions[i]).availability==='in_stock')&&rowFor(b.baseline,b.actions[4]).process===null,'before_fields');
 must(b.baseline.parents[1].is_available===false&&b.baseline.parents[1].availability_reason==='structured_data_not_in_stock','black_parent_preserved');return b;
}
function descriptor(kind,b,offset=0,index,expected){
 const q=new URLSearchParams({select:'*',limit:'25'}),list=(k,v)=>q.set(k,'in.('+v.join(',')+')'),eq=(k,v)=>q.set(k,v===null?'is.null':'eq.'+String(v));let table,body,method='GET';
 must(Number.isInteger(offset)&&offset>=0&&offset<25&&(!offset||COLLECTIONS.has(kind)),'offset_scope');
 if(kind==='owners'){table='entities';list('id',OWNERS);q.set('order','id.asc');}
 else if(kind==='roles'){table='entity_roles';list('entity_id',OWNERS);q.set('order','entity_id.asc,role.asc');}
 else if(kind==='sources'){table='entity_source_ids';eq('source','my_coffee_explorer');list('source_id',b.owners.map(o=>o.source_ids[0].source_id));q.set('order','id.asc');}
 else if(kind==='canonicalOut'||kind==='canonicalIn'){table='entity_attributes';eq('attribute_key','canonical_roaster_entity_id');list(kind==='canonicalOut'?'entity_id':'attribute_value',OWNERS);q.set('limit','1');}
 else if(kind==='crawlState'){table='entity_crawl_state';list('entity_id',OWNERS);q.set('order','entity_id.asc');}
 else if(kind==='activeClaims'){table='crawl_runs';list('entity_id',OWNERS);eq('status','running');q.set('limit','1');}
 else if(kind==='parents'){table='products';list('id',PRODUCTS);q.set('order','id.asc');}
 else if(kind==='variants'||kind==='facts'){table=kind==='variants'?'product_variants':'coffee_facts';list('product_id',PRODUCTS);q.set('order',kind==='variants'?'id.asc':'product_id.asc');}
 else{
  must(Number.isInteger(index)&&index>=0&&index<5&&offset===0&&expected,'action_request_scope');const a=b.actions[index];must(same([a.table,a.id||a.product_id,a.patch],FIXED[index])&&a.product_id===PRODUCTS[index<2?0:1]&&a.entity_id===OWNERS[index<2?0:1],'fixed_action_scope');const r=rowFor(expected,a),p=expected.parents.find(p=>p.id===a.product_id);must(r&&p?.entity_id===a.entity_id,'action_binding');q.set('limit','2');
  if(kind==='criticalOwner'){table='entities';eq('id',a.entity_id);}
  else if(kind==='criticalSource'){table='entity_source_ids';const s=expected.sources.find(s=>s.entity_id===a.entity_id);must(s,'source_missing');eq('id',s.id);}
  else if(kind==='criticalParent'){table='products';eq('id',a.product_id);}
  else if(kind==='criticalRow'){table=a.table;eq(table==='coffee_facts'?'product_id':'id',a.id||a.product_id);}
  else if(kind==='mutation'){table=a.table;method='PATCH';body=copy(a.patch);q.delete('limit');
   if(table==='products'){for(const k of ['id','entity_id','source_url','updated_at',...Object.keys(a.patch)]){must(Object.hasOwn(r,k),'missing_cas_field');eq(k,r[k]);}}
   else for(const[k,v]of Object.entries(r)){must(v===null||['string','number','boolean'].includes(typeof v),'nonscalar_child_cas');eq(k,v);}
  }else must(false,'request_scope');
 }
 if(offset){q.set('offset',String(offset));q.set('limit','1');}return {kind,offset,index,method,url:ORIGIN+'/rest/v1/'+table+'?'+q,body};
}
async function bodyText(r){must(r.body?.getReader,'streaming_body');const reader=r.body.getReader(),parts=[];let n=0;try{for(;;){const x=await reader.read();if(x.done)break;n+=x.value.length;must(n<=MAX_BODY,'body_limit');parts.push(Buffer.from(x.value));}return Buffer.concat(parts).toString();}finally{reader.releaseLock();}}
function createClient({bundle,key,mode='preview',delegate=globalThis.fetch.bind(globalThis),event=()=>{},checkLock=()=>{},validateWrite=()=>{},now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 must(['preview','apply'].includes(mode),'invalid_mode');let active=false,stopped=false,count=0,done=null,optionalAbsent=false;const started=now(),writes=new Set(),max=mode==='preview'?15:60;
 return {get requests(){return count;},get optionalAbsent(){return optionalAbsent;},async request(kind,offset=0,index,expected){let timer,admitted=false;try{
  must(!active&&!stopped,'stopped_or_concurrent');must(count<max&&now()-started<MAX_TIME,'request_time_bound');active=true;admitted=true;const d=descriptor(kind,bundle,offset,index,expected),writing=d.method==='PATCH';must(!writing||mode==='apply','preview_write_denied');if(writing)must(!writes.has(index),'mutation_replay_denied');checkLock();
  while(done!==null&&now()-done<500){must(!stopped&&now()-started<MAX_TIME,'stopped_or_deadline');await wait(500-(now()-done));}must(!stopped&&now()-started<MAX_TIME,'stopped_or_deadline');checkLock();if(writing){validateWrite();writes.add(index);}count++;event({event:'request_intent',request:count,...d});const abort=new AbortController();timer=setTimeout(()=>abort.abort(),20000);
  const r=await delegate(d.url,{method:d.method,headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json',...(writing?{'Content-Type':'application/json',Prefer:'return=representation'}:{})},redirect:'error',signal:abort.signal,...(writing?{body:JSON.stringify(d.body)}:{})});must(r&&!r.redirected&&r.url===d.url,'exact_response_url');const text=await bodyText(r),json=/^application\/json(?:;|$)/i.test(r.headers.get('content-type')||'');
  if(!(writing?[200]:[200,206]).includes(r.status)){const e=Object.assign(Error('database_error'),{code:'database_error',httpStatus:r.status});try{e.dbCode=JSON.parse(text).code;}catch{}if(kind==='crawlState'&&offset===0&&r.status===404&&e.dbCode==='PGRST205'&&json){optionalAbsent=true;event({event:'optional_crawl_state_absent',permission_inferred:false});return[];}throw e;}
  must(json,'json_required');const rows=JSON.parse(text);must(Array.isArray(rows)&&rows.length<25&&(writing||rows.length<=Number(new URL(d.url).searchParams.get('limit'))),'row_bound');if(!writing){const m=/^(?:(\d+)-(\d+)|\*)\/(?:\d+|\*)$/.exec(r.headers.get('content-range')||'');must(m&&(rows.length?Number(m[1])===offset&&Number(m[2])-Number(m[1])+1===rows.length:m[1]===undefined),'content_range');}event({event:'request_result',request:count,kind,offset,index,status:r.status,rows});return rows;
 }catch(e){stopped=true;event({event:'request_failure',kind,index,error:diag(e)});throw e;}finally{clearTimeout(timer);if(admitted){done=now();active=false;}}}};
}
function validate(s,b,expected){
 must(same(Object.keys(s).sort(),[...READS].sort()),'state_shape');for(const k of READS)must(Array.isArray(s[k]),'state_array');
 must(s.owners.length===2&&new Set(s.owners.map(r=>r.id)).size===2,'owners_count');for(const o of b.owners){const r=s.owners.find(r=>r.id===o.entity_id);must(r&&r.name===o.name&&r.website_url===o.website_url,'owner_identity');must(s.roles.some(r=>r.entity_id===o.entity_id&&r.role==='roaster'),'roaster_role');const source=s.sources.filter(r=>r.source==='my_coffee_explorer'&&r.source_id===o.source_ids[0].source_id);must(source.length===1&&source[0].entity_id===o.entity_id,'source_owner');}
 must(s.sources.length===2&&s.roles.every(r=>OWNERS.includes(r.entity_id))&&new Set(s.roles.map(r=>r.entity_id+':'+r.role)).size===s.roles.length,'role_source_scope');
 for(const k of ['canonicalOut','canonicalIn','activeClaims'])must(s[k].length===0,k+'_conflict');must(s.crawlState.every(r=>OWNERS.includes(r.entity_id)&&r.allow_crawl!==false)&&new Set(s.crawlState.map(r=>r.entity_id)).size===s.crawlState.length,'crawl_disabled_or_scope');
 const baseline=expected||b.baseline;for(const k of expected?READS:['parents','variants','facts'])must(same(sorted(s[k]),sorted(baseline[k])),k+'_drift');
}
async function inspect(c){const s={};for(const k of READS){s[k]=await c.request(k);if(COLLECTIONS.has(k)&&s[k].length)must((await c.request(k,s[k].length)).length===0,'nonempty_eof:'+k);}return s;}
function helperSha(){return sha(fs.readFileSync(__filename));}
function validatePreview(p,b,now=Date.now()){must(p?.status==='five_fields_preview_pass'&&p.plan_sha256===PLAN_SHA&&p.helper_sha256===helperSha(),'preview_identity');const age=now-Date.parse(p.at);must(Number.isFinite(age)&&age>=0&&age<TTL,'preview_expired');validate(p.before,b);}
function one(rows){must(rows.length===1,'exact_one_row');return rows[0];}
function afterRow(rows,before,a){const row=one(rows),wanted={...before,...a.patch};must(same(Object.keys(row).sort(),Object.keys(wanted).sort()),'row_schema');for(const[k,v]of Object.entries(wanted))if(k!=='updated_at')must(same(row[k],v),'preservation:'+k);must(Number.isFinite(Date.parse(row.updated_at))&&Date.parse(row.updated_at)>=Date.parse(before.updated_at),'updated_timestamp');return copy(row);}
async function critical(c,b,expected,i){const a=b.actions[i];for(const[k,known]of [['criticalOwner',expected.owners.find(r=>r.id===a.entity_id)],['criticalSource',expected.sources.find(r=>r.entity_id===a.entity_id)],['criticalParent',expected.parents.find(r=>r.id===a.product_id)]])must(same(one(await c.request(k,0,i,expected)),known),k+'_drift');if(a.table!=='products')must(same(one(await c.request('criticalRow',0,i,expected)),rowFor(expected,a)),'criticalRow_drift');must((await c.request('activeClaims')).length===0,'active_claim_before_patch');}
async function execute({client,bundle,mode='preview',preview,append=()=>{},checkLock=()=>{},now=Date.now}){
 must(['preview','apply'].includes(mode),'invalid_mode');if(mode==='apply')validatePreview(preview,bundle,now());const before=await inspect(client);validate(before,bundle);append({event:'all_preconditions_pass',before});
 if(mode==='preview')return {at:new Date(now()).toISOString(),status:'five_fields_preview_pass',plan_sha256:PLAN_SHA,helper_sha256:helperSha(),before,requests:client.requests,writes:0,optional_crawl_state_absent:client.optionalAbsent,permission_inferred:false};
 validatePreview(preview,bundle,now());validate(before,bundle,preview.before);const expected=copy(before),returned=[];
 for(let i=0;i<5;i++){validatePreview(preview,bundle,now());checkLock();await critical(client,bundle,expected,i);validatePreview(preview,bundle,now());checkLock();const a=bundle.actions[i],old=rowFor(expected,a);append({event:'mutation_attempt_no_retry',index:i,action:a,before:old});const row=afterRow(await client.request('mutation',0,i,expected),old,a);append({event:'mutation_returned_preserved',index:i,row});returned.push(row);const k=a.table==='products'?'parents':a.table==='product_variants'?'variants':'facts';expected[k]=expected[k].map(r=>r===old?row:r);}
 const after=await inspect(client);validate(after,bundle,expected);checkLock();append({event:'final_readback_verified',after});return {at:new Date(now()).toISOString(),status:'five_fields_verified',plan_sha256:PLAN_SHA,helper_sha256:helperSha(),before,returned,after,requests:client.requests,writes:5,full_inventory_complete:false,other_product_fields_changed:false,media_claim_knownpage_changes:0,automatic_retry:false};
}
function sync(d){const fd=fs.openSync(d,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function save(p,x){const fd=fs.openSync(p,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(x,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync(path.dirname(p));}
function cli(a){if(!a.length||same(a,['--check']))return{mode:'check'};if(same(a,['--preview']))return{mode:'preview'};must(a.length===4&&a[0]==='--apply'&&/^[a-f0-9]{64}$/.test(a[2])&&a[3]==='--confirm-five-field-repair','invalid_cli');return{mode:'apply',file:a[1],hash:a[2]};}
async function main(){const opts=cli(process.argv.slice(2)),bundle=loadBundle();if(opts.mode==='check'){console.log(JSON.stringify({status:'offline_check_pass',plan_sha256:PLAN_SHA,actions:5,network_requests:0}));return;}
 must(fs.realpathSync(process.cwd())===ROOT&&fs.realpathSync(__dirname)===ROOT+'/src/myCoffeeExplorerImport','production_runtime_required');must(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL||'').href===ORIGIN+'/','origin_mismatch');const key=process.env.SUPABASE_SERVICE_ROLE_KEY;must(typeof key==='string'&&key.length>20,'credentials_missing');let preview;
 if(opts.mode==='apply'){const f=fs.realpathSync(opts.file);must(path.dirname(path.dirname(f))===STATE&&new RegExp('^'+TAG+'-preview-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$').test(path.basename(path.dirname(f)))&&path.basename(f)==='result.json','preview_path');const raw=fs.readFileSync(f);must(sha(raw)===opts.hash,'preview_hash');preview=JSON.parse(raw);validatePreview(preview,bundle);}
 const locks=[],out=STATE+'/'+TAG+(opts.mode==='apply'?'-apply':'-preview-'+crypto.randomUUID()),oldTls=process.env.NODE_TLS_REJECT_UNAUTHORIZED;let fd;
 try{locks.push(acquireLock(ROOT+'/.state/my-coffee-explorer/apply.lock'));for(const id of OWNERS)locks.push(acquireLock(ROOT+'/.state/my-coffee-explorer/.product-only-entity-locks/'+id+'.lock'));const checkLock=()=>locks.forEach(l=>l.check());fs.mkdirSync(out,{mode:0o700});sync(STATE);save(out+'/reservation.json',{at:stamp(),plan_sha256:PLAN_SHA,helper_sha256:helperSha(),mode:opts.mode,reviewed_preview_sha256:opts.hash||null,one_shot:true,retries:0});fd=fs.openSync(out+'/events.ndjson','wx',0o600);sync(out);let failed=false;
 const append=e=>{must(!failed,'journal_latched');try{const bytes=Buffer.from(JSON.stringify({at:stamp(),...e})+'\n');let n=0;while(n<bytes.length){const wrote=fs.writeSync(fd,bytes,n,bytes.length-n);must(wrote>0,'short_journal_write');n+=wrote;}fs.fsyncSync(fd);}catch(e){failed=true;throw e;}};
 process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';const client=createClient({bundle,key,mode:opts.mode,event:append,checkLock,validateWrite:()=>validatePreview(preview,bundle)}),result=await execute({client,bundle,mode:opts.mode,preview,append,checkLock});save(out+'/result.json',result);console.log(JSON.stringify({status:result.status,output:out,result_sha256:sha(fs.readFileSync(out+'/result.json'))}));
 }catch(e){if(fd!==undefined)try{save(out+'/failure.json',{at:stamp(),status:'stopped_review_required',error:diag(e),warning:'Attempted PATCH may have committed. Do not retry or resume; reconcile exact attempted rows separately.'});}catch{}throw e;}finally{if(fd!==undefined)fs.closeSync(fd);if(oldTls===undefined)delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;else process.env.NODE_TLS_REJECT_UNAUTHORIZED=oldTls;let e;for(const l of locks.reverse())try{l.release();}catch(x){e=x;}if(e)throw e;}
}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify(diag(e)));process.exitCode=1;});
module.exports={ROOT,STATE,ORIGIN,TAG,PLAN,PLAN_SHA,PRODUCTS,OWNERS,READS,COLLECTIONS,TTL,loadBundle,descriptor,createClient,validate,inspect,validatePreview,afterRow,critical,execute,cli,rowFor,sha,same,helperSha};
