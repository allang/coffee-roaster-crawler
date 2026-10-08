'use strict';
// Two exact historical decimal-comma price corrections; never alter parent, weights, stock or runtime.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT='/Users/allan/.openclaw/workspace/coffee-roaster-crawler',STATE=ROOT+'/.state/my-coffee-explorer/2026-09-26',BASE=__dirname===ROOT+'/src/myCoffeeExplorerImport'?STATE:__dirname;
const ORIGIN='https://gtlipifdfyugiwpxvuse.supabase.co',TAG='blommers-two-price-repair',PLAN='blommers-two-price-repair-plan.json',PLAN_SHA='855453532ed9d60e76b32a472ba00bf39cf5705d632a48e3f7809d6ac2d6f9da';
const OWNER='295aa49e-b7b0-4b6b-a3de-3df6ea611b4a',OWNERS=[OWNER],PRODUCT='db62b01b-374a-4b71-9b4a-bef6e657897f';
const FIXED=[['5ac6ec2f-0c73-4d1f-a29e-286e7886ab05',289500,2895,'2x 250 Gram'],['acdce6a9-072b-4c71-a0bd-53d19b320b71',899500,8995,'2x 1000 Gram']];
const READS=['owner','roles','sources','canonicalOut','canonicalIn','activeClaims','parent','variants'],COLLECTIONS=new Set(['roles','sources','variants']),TTL=600000,MAX_TIME=300000,MAX_BODY=4194304;
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),canon=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v),same=(a,b)=>canon(a)===canon(b),copy=x=>JSON.parse(JSON.stringify(x)),stamp=()=>new Date().toISOString();
function must(v,c){if(!v)throw Object.assign(Error(c),{code:c});}
function diag(e){return{code:String(e.code||'repair_failed').replace(/[^a-zA-Z0-9_:-]/g,'').slice(0,90),...(Number.isInteger(e.httpStatus)?{httpStatus:e.httpStatus}:{}),...(/^[A-Z0-9]{1,16}$/.test(e.dbCode||'')?{databaseCode:e.dbCode}:{})};}
must(sha(fs.readFileSync(path.join(__dirname,'apply-batch8b-four-remaining-fields.cjs')))==='69e042a81cc0a276e4268f1848854c90c9b91061d2a5070353249017fa1ea600','timestamp_dependency_changed');
must(sha(fs.readFileSync(path.join(__dirname,'apply-batch5a-partial-null-fills.cjs')))==='d9b45e194440104fef42f1e83434ddfaf4fd0f5e9f8dc8f7bf96dbedf3668856','lock_dependency_changed');
const {afterRow}=require('./apply-batch8b-four-remaining-fields.cjs'),{acquireLock}=require('./apply-batch5a-partial-null-fills.cjs');
function sorted(a){return a.map(canon).sort();}
function rowFor(s,a){return s.variants.find(v=>v.id===a.id);}
function one(rows){must(rows.length===1,'exact_one_row');return rows[0];}
function loadBundle(base=BASE){
 const read=f=>{must(!path.isAbsolute(f)&&!f.split('/').includes('..'),'unsafe_pin_path');return fs.readFileSync(path.join(f.endsWith('.cjs')?__dirname:base,f));},raw=read(PLAN);must(sha(raw)===PLAN_SHA,'plan_changed');const b=JSON.parse(raw);
 for(const[f,pin]of Object.entries(b.pins))must(sha(read(f))===pin,'evidence_pin_changed');
 must(b.scope==='blommers_exact_two_price_only_repair'&&b.owner.id===OWNER&&b.product.id===PRODUCT&&b.product.entity_id===OWNER&&b.variants.length===2&&b.actions.length===2,'plan_scope');
 for(let i=0;i<2;i++){const a=b.actions[i],f=FIXED[i],v=b.variants.find(v=>v.id===f[0]);must(a.table==='product_variants'&&a.id===f[0]&&a.product_id===PRODUCT&&same(a.patch,{price_cents:f[2]})&&same(a.before,v)&&v.product_id===PRODUCT&&v.price_cents===f[1]&&v.currency==='EUR'&&v.variant_name===f[3],'exact_two_prices');}
 const html=read('blommers-one-price-www-source/source.html').toString();
 for(const f of ['blommers-one-price-www-source/factual-review.json','blommers-one-price-www-source/second-pack-price-addendum.json']){const p=JSON.parse(read(f));for(const q of p.fragments||[p.fragment])must(q&&sha(html.slice(q.utf16_offset,q.utf16_offset+q.utf16_length))===(q.sha256||q.fragment_sha256),'source_fragment');}
 must(html.includes('<option value="304867157" selected="selected">2x 250 Gram - €28,95</option>')&&html.includes('<option value="304895529">2x 1000 Gram - €89,95</option>'),'same_product_options');
 const m=[...html.matchAll(/<button\b[^>]*data-metadata='([^']+)'[^>]*id="add-to-cart-button"[^>]*>/g)];must(m.length===1,'own_product_form');const p=JSON.parse(m[0][1]);must(p.id===153497791&&p.vid===304867157&&p.price.price===28.95,'own_product_price');return b;
}
function descriptor(kind,b,offset=0,index,expected){
 must(Number.isInteger(offset)&&offset>=0&&offset<25&&(!offset||COLLECTIONS.has(kind)),'offset_scope');const q=new URLSearchParams({select:'*',limit:'25'}),eq=(k,v)=>q.set(k,v===null?'is.null':'eq.'+String(v));let table,body,method='GET';
 if(kind==='owner'){table='entities';eq('id',OWNER);q.set('limit','2');}
 else if(kind==='roles'||kind==='sources'){table=kind==='roles'?'entity_roles':'entity_source_ids';eq('entity_id',OWNER);q.set('order',kind==='roles'?'role.asc':'id.asc');}
 else if(kind==='canonicalOut'||kind==='canonicalIn'){table='entity_attributes';eq('attribute_key','canonical_roaster_entity_id');eq(kind==='canonicalOut'?'entity_id':'attribute_value',OWNER);q.set('limit','1');}
 else if(kind==='activeClaims'){table='crawl_runs';eq('entity_id',OWNER);eq('status','running');q.set('limit','1');}
 else if(kind==='parent'){table='products';eq('id',PRODUCT);q.set('limit','2');}
 else if(kind==='variants'){table='product_variants';eq('product_id',PRODUCT);q.set('order','id.asc');}
 else{must(Number.isInteger(index)&&index>=0&&index<2&&expected&&offset===0,'action_scope');const a=b.actions[index],f=FIXED[index],v=rowFor(expected,a);must(a.table==='product_variants'&&a.id===f[0]&&a.product_id===PRODUCT&&same(a.patch,{price_cents:f[2]})&&v?.product_id===PRODUCT,'fixed_action');q.set('limit','2');
  if(kind==='criticalOwner'){table='entities';eq('id',OWNER);}
  else if(kind==='criticalParent'){table='products';eq('id',PRODUCT);}
  else if(kind==='criticalRow'){table='product_variants';eq('id',f[0]);}
  else if(kind==='mutation'){table='product_variants';method='PATCH';body=copy(a.patch);q.delete('limit');for(const[k,x]of Object.entries(v)){must(x===null||['string','number','boolean'].includes(typeof x),'full_scalar_cas');eq(k,x);}}
  else must(false,'request_scope');
 }
 if(offset){q.set('offset',String(offset));q.set('limit','1');}return{kind,offset,index,method,url:ORIGIN+'/rest/v1/'+table+'?'+q,body};
}
async function bodyText(r){must(r.body?.getReader,'streaming_body');const reader=r.body.getReader(),parts=[];let n=0;try{for(;;){const x=await reader.read();if(x.done)break;n+=x.value.length;must(n<=MAX_BODY,'body_limit');parts.push(Buffer.from(x.value));}return Buffer.concat(parts).toString();}finally{reader.releaseLock();}}
function createClient({bundle,key,mode='preview',delegate=globalThis.fetch.bind(globalThis),event=()=>{},checkLock=()=>{},validateWrite=()=>{},now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 must(['preview','apply'].includes(mode),'invalid_mode');let active=false,stopped=false,count=0,done=null,optionalAbsent=false;const started=now(),writes=new Set(),max=mode==='preview'?11:32;
 return {get requests(){return count;},get optionalAbsent(){return optionalAbsent;},async request(kind,offset=0,index,expected){let timer,admitted=false;try{
  must(!active&&!stopped,'stopped_or_concurrent');must(count<max&&now()-started<MAX_TIME,'request_time_bound');active=true;admitted=true;const d=descriptor(kind,bundle,offset,index,expected),writing=d.method==='PATCH';must(!writing||mode==='apply','preview_write_denied');if(writing)must(!writes.has(index),'mutation_replay_denied');checkLock();
  while(done!==null&&now()-done<500){must(!stopped&&now()-started<MAX_TIME,'stopped_or_deadline');await wait(500-(now()-done));}must(!stopped&&now()-started<MAX_TIME,'stopped_or_deadline');checkLock();if(writing){validateWrite();writes.add(index);}count++;event({event:'request_intent',request:count,...d});const abort=new AbortController();timer=setTimeout(()=>abort.abort(),20000);
  const r=await delegate(d.url,{method:d.method,headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json',...(writing?{'Content-Type':'application/json',Prefer:'return=representation'}:{})},redirect:'error',signal:abort.signal,...(writing?{body:JSON.stringify(d.body)}:{})});must(r&&!r.redirected&&r.url===d.url,'exact_response_url');const text=await bodyText(r),json=/^application\/json(?:;|$)/i.test(r.headers.get('content-type')||'');
  if(!(writing?[200]:[200,206]).includes(r.status)){const e=Object.assign(Error('database_error'),{code:'database_error',httpStatus:r.status});try{e.dbCode=JSON.parse(text).code;}catch{}if(kind==='crawlState'&&offset===0&&r.status===404&&e.dbCode==='PGRST205'&&json){optionalAbsent=true;event({event:'optional_crawl_state_absent',permission_inferred:false});return[];}throw e;}
  must(json,'json_required');const rows=JSON.parse(text);must(Array.isArray(rows)&&rows.length<25&&(writing||rows.length<=Number(new URL(d.url).searchParams.get('limit'))),'row_bound');if(!writing){const m=/^(?:(\d+)-(\d+)|\*)\/(?:\d+|\*)$/.exec(r.headers.get('content-range')||'');must(m&&(rows.length?Number(m[1])===offset&&Number(m[2])-Number(m[1])+1===rows.length:m[1]===undefined),'content_range');}event({event:'request_result',request:count,kind,offset,index,status:r.status,rows});return rows;
 }catch(e){stopped=true;event({event:'request_failure',kind,index,error:diag(e)});throw e;}finally{clearTimeout(timer);if(admitted){done=now();active=false;}}}};
}

function validate(s,b,expected){
 must(same(Object.keys(s).sort(),[...READS].sort())&&READS.every(k=>Array.isArray(s[k])),'state_shape');const owner=one(s.owner),parent=one(s.parent);
 must(owner.id===OWNER&&owner.name===b.owner.name&&owner.website_url===b.owner.website_url,'owner_identity');must(parent.id===PRODUCT&&parent.entity_id===OWNER&&parent.source_url===b.product.source_url,'parent_source_owner');
 must(s.roles.some(x=>x.role==='roaster')&&s.roles.every(x=>x.entity_id===OWNER)&&new Set(s.roles.map(x=>x.role)).size===s.roles.length,'roaster_roles');
 must(s.sources.every(x=>x.entity_id===OWNER)&&new Set(s.sources.map(x=>x.id)).size===s.sources.length,'source_scope');
 for(const k of ['canonicalOut','canonicalIn','activeClaims'])must(s[k].length===0,k+'_conflict');
 const baseline=expected||{parent:[b.product],variants:b.variants};for(const k of expected?READS:['parent','variants'])must(same(sorted(s[k]),sorted(baseline[k])),k+'_drift');
}
async function inspect(c){const s={};for(const k of READS){s[k]=await c.request(k);if(COLLECTIONS.has(k)&&s[k].length)must((await c.request(k,s[k].length)).length===0,'nonempty_eof:'+k);}return s;}
function helperSha(){return sha(fs.readFileSync(__filename));}
function validatePreview(p,b,now=Date.now()){must(p?.status==='two_prices_preview_pass'&&p.plan_sha256===PLAN_SHA&&p.helper_sha256===helperSha(),'preview_identity');const age=now-Date.parse(p.at);must(Number.isFinite(age)&&age>=0&&age<TTL,'preview_expired');validate(p.before,b);}
async function execute({client,bundle,mode='preview',preview,append=()=>{},checkLock=()=>{},now=Date.now}){
 must(['preview','apply'].includes(mode),'mode');if(mode==='apply')validatePreview(preview,bundle,now());const before=await inspect(client);validate(before,bundle);append({event:'all_preconditions_pass',before});
 if(mode==='preview')return{at:new Date(now()).toISOString(),status:'two_prices_preview_pass',helper_sha256:helperSha(),plan_sha256:PLAN_SHA,before,requests:client.requests,writes:0};
 validatePreview(preview,bundle,now());validate(before,bundle,preview.before);const expected=copy(before),returned=[];
 for(let i=0;i<2;i++){checkLock();validatePreview(preview,bundle,now());for(const[k,r]of [['criticalOwner',expected.owner[0]],['criticalParent',expected.parent[0]],['criticalRow',rowFor(expected,bundle.actions[i])]])must(same(one(await client.request(k,0,i,expected)),r),k+'_drift');must((await client.request('activeClaims')).length===0,'active_claim_before_patch');checkLock();validatePreview(preview,bundle,now());const a=bundle.actions[i],old=rowFor(expected,a);append({event:'mutation_attempt_no_retry',index:i,action:a,before:old});const row=afterRow(await client.request('mutation',0,i,expected),old,a);append({event:'mutation_returned_preserved',index:i,row});returned.push(row);expected.variants=expected.variants.map(x=>x===old?row:x);}
 const after=await inspect(client);validate(after,bundle,expected);checkLock();append({event:'final_readback_verified',after});return{at:new Date(now()).toISOString(),status:'two_prices_verified',helper_sha256:helperSha(),plan_sha256:PLAN_SHA,before,returned,after,requests:client.requests,writes:2,other_fields_changed:false,full_inventory_complete:false,automatic_retry:false};
}
function sync(d){const fd=fs.openSync(d,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function save(p,x){const fd=fs.openSync(p,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(x,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync(path.dirname(p));}
function cli(a){if(!a.length||same(a,['--check']))return{mode:'check'};if(same(a,['--preview']))return{mode:'preview'};must(a.length===4&&a[0]==='--apply'&&/^[a-f0-9]{64}$/.test(a[2])&&a[3]==='--confirm-two-blommers-prices','invalid_cli');return{mode:'apply',file:a[1],hash:a[2]};}
async function main(){const opts=cli(process.argv.slice(2)),bundle=loadBundle();if(opts.mode==='check'){console.log(JSON.stringify({status:'offline_check_pass',plan_sha256:PLAN_SHA,actions:2,network_requests:0}));return;}
 must(fs.realpathSync(process.cwd())===ROOT&&fs.realpathSync(__dirname)===ROOT+'/src/myCoffeeExplorerImport','production_runtime_required');must(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL||'').href===ORIGIN+'/','origin_mismatch');const key=process.env.SUPABASE_SERVICE_ROLE_KEY;must(typeof key==='string'&&key.length>20,'credentials_missing');let preview;
 if(opts.mode==='apply'){const f=fs.realpathSync(opts.file);must(path.dirname(path.dirname(f))===STATE&&new RegExp('^'+TAG+'-preview-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$').test(path.basename(path.dirname(f)))&&path.basename(f)==='result.json','preview_path');const raw=fs.readFileSync(f);must(sha(raw)===opts.hash,'preview_hash');preview=JSON.parse(raw);validatePreview(preview,bundle);}
 const locks=[],out=STATE+'/'+TAG+(opts.mode==='apply'?'-apply':'-preview-'+crypto.randomUUID()),oldTls=process.env.NODE_TLS_REJECT_UNAUTHORIZED;let fd;
 try{locks.push(acquireLock(ROOT+'/.state/my-coffee-explorer/apply.lock'));for(const id of OWNERS)locks.push(acquireLock(ROOT+'/.state/my-coffee-explorer/.product-only-entity-locks/'+id+'.lock'));const checkLock=()=>locks.forEach(l=>l.check());fs.mkdirSync(out,{mode:0o700});sync(STATE);save(out+'/reservation.json',{at:stamp(),plan_sha256:PLAN_SHA,helper_sha256:helperSha(),mode:opts.mode,reviewed_preview_sha256:opts.hash||null,one_shot:true,retries:0});fd=fs.openSync(out+'/events.ndjson','wx',0o600);sync(out);let failed=false;
 const append=e=>{must(!failed,'journal_latched');try{const bytes=Buffer.from(JSON.stringify({at:stamp(),...e})+'\n');let n=0;while(n<bytes.length){const wrote=fs.writeSync(fd,bytes,n,bytes.length-n);must(wrote>0,'short_journal_write');n+=wrote;}fs.fsyncSync(fd);}catch(e){failed=true;throw e;}};
 process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';const client=createClient({bundle,key,mode:opts.mode,event:append,checkLock,validateWrite:()=>validatePreview(preview,bundle)}),result=await execute({client,bundle,mode:opts.mode,preview,append,checkLock});save(out+'/result.json',result);console.log(JSON.stringify({status:result.status,output:out,result_sha256:sha(fs.readFileSync(out+'/result.json'))}));
 }catch(e){if(fd!==undefined)try{save(out+'/failure.json',{at:stamp(),status:'stopped_review_required',error:diag(e),warning:'Attempted PATCH may have committed. Do not retry or resume; reconcile exact attempted rows separately.'});}catch{}throw e;}finally{if(fd!==undefined)fs.closeSync(fd);if(oldTls===undefined)delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;else process.env.NODE_TLS_REJECT_UNAUTHORIZED=oldTls;let e;for(const l of locks.reverse())try{l.release();}catch(x){e=x;}if(e)throw e;}
}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify(diag(e)));process.exitCode=1;});

module.exports={ROOT,STATE,BASE,ORIGIN,TAG,PLAN,PLAN_SHA,PRODUCT,OWNER,READS,COLLECTIONS,TTL,loadBundle,descriptor,createClient,inspect,validate,validatePreview,execute,cli,rowFor,sha,same,helperSha,afterRow};
