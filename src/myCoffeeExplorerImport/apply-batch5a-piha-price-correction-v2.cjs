'use strict';
// A separate, finite, price-only repair. No network on import or default --check.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {isDeepStrictEqual:equal}=require('node:util');
const collector=require('./collect-batch5a-piha-price-source.cjs');
const {saveExclusive,syncDirectory}=require('./plan8-product-link-discovery.cjs');
const {installLegalGuard}=require('./legal-guard.cjs');
const ROOT='/Users/allan/.openclaw/workspace/coffee-roaster-crawler',STATE=ROOT+'/.state/my-coffee-explorer/2026-09-26';
const ORIGIN='https://gtlipifdfyugiwpxvuse.supabase.co',LOCK=ROOT+'/.state/my-coffee-explorer/apply.lock';
const OWNER_LOCK=ROOT+'/.state/my-coffee-explorer/.product-only-entity-locks/'+collector.OWNER+'.lock';
const ARTIFACT_BASE=__dirname===ROOT+'/src/myCoffeeExplorerImport'?STATE:__dirname;
const TAG='batch5a-piha-price-correction',PREVIEW_MAX_AGE_MS=10*60*1000,MAX_REQUESTS=50,TIMEOUT_MS=20000;
const PROOF_FILE='batch5a-two-eur-price-source-proof.json',PROOF_SHA='8f1767ce62dc43982da1f93bb668080acd29a5cbb66767f2df67ceef4e770b14';
const COLLECTOR_SHA='b54f27ef6409ff274c5fa526c868c1b92d515e509473c2c2a0018fc440410b27';
const SPEC=Object.freeze(collector.TARGETS.map((t,i)=>Object.freeze({...t,beforePrice:[120000,144000][i],afterPrice:[1200,1440][i]})));
const sha=collector.sha,rowHash=collector.rowHash,stamp=()=>new Date().toISOString();
function must(ok,code){if(!ok)throw Object.assign(Error(code),{code});}
function diag(error){return{code:String(error.code||'verification_failed').replace(/[^A-Za-z0-9_:-]/g,'').slice(0,100),...(Number.isInteger(error.status)?{status:error.status}:{}),...(/^[A-Z0-9]{1,16}$/.test(error.dbCode||'')?{databaseCode:error.dbCode}:{})};}
function readBytes(file){must(typeof file==='string'&&!path.isAbsolute(file)&&!file.split('/').includes('..'),'evidence_path_unsafe');const base=Object.hasOwn(collector.HELPER_PINS,file)||file==='collect-batch5a-piha-price-source.cjs'?__dirname:ARTIFACT_BASE;const full=fs.realpathSync(path.join(base,file));must(full.startsWith(fs.realpathSync(base)+path.sep),'evidence_outside_base');return fs.readFileSync(full);}
function pinned(file,pin){must(/^[a-f0-9]{64}$/.test(pin||''),'source_proof_not_frozen');const bytes=readBytes(file);must(sha(bytes)===pin,'evidence_hash_mismatch');return JSON.parse(bytes);}
function validatePlan(plan){
 const {planHash,...rest}=plan;must(planHash===collector.PLAN_HASH&&rowHash(rest)===collector.PLAN_HASH,'plan_hash_changed');
 must(plan.apply_ready===false&&plan.actions.length===2&&plan.allowed_entity_id===collector.OWNER,'original_plan_scope_changed');
 plan.actions.forEach((a,i)=>{const s=SPEC[i];must(a.table==='product_variants'&&equal(a.key,{id:s.variant_id,product_id:s.product_id})&&equal(a.patch,{price_cents:s.afterPrice}),'mutation_scope_changed');must(a.before.price_cents===s.beforePrice&&a.before.currency==='EUR'&&equal(a.before,a.compare_and_set),'full_before_cas_required');must(equal(a.expected_after_business_row,{...a.before,...a.patch}),'expected_after_changed');must(a.product_binding.entity_id===collector.OWNER&&a.product_binding.source_url===s.url,'product_binding_changed');});
}
function validateSourceProof(proof,plan){
 must(proof.independent_first_party_price_verified===true&&proof.apply_ready===false&&proof.databaseMutationAllowed===false&&proof.proofs?.length===2,'independent_source_approval_required');
 must(proof.original_plan.sha256===collector.PLAN_SHA256&&proof.original_plan.planHash===collector.PLAN_HASH&&proof.source_manifest.sha256===collector.MANIFEST_SHA256,'source_proof_plan_mismatch');
 const capture=pinned(proof.capture.file,proof.capture.sha256);must(capture.status==='captured_for_manual_price_verification'&&capture.failure===null&&capture.pages.length===2,'source_capture_incomplete');
 const requestBytes=readBytes(proof.capture.request_audit.file);must(sha(requestBytes)===proof.capture.request_audit.sha256,'source_audit_hash_changed');
 proof.proofs.forEach((p,i)=>{const s=SPEC[i],a=plan.actions[i],page=pinned(p.page.file,p.page.sha256);must(equal(page,collector.pointer(capture,p.page.result_pointer)),'source_page_capture_mismatch');
  must(p.product_id===s.product_id&&p.variant_id===s.variant_id&&p.entity_id===collector.OWNER&&p.source_url===s.url&&page.final_url===s.url&&page.fetched&&page.captureComplete,'source_price_binding_mismatch');
  must(sha(page.rawHtml)===p.page.raw_html_sha256&&sha(page.staticBodyText)===p.page.static_text_sha256,'source_html_hash_changed');
  function fragments(o){if(!o||typeof o!=='object')return;if(o.raw_html_utf16_range){const fragment=page.rawHtml.slice(...o.raw_html_utf16_range);must(sha(fragment)===o.raw_fragment_sha256,'source_fragment_changed');if(o.raw_fragment)must(fragment===o.raw_fragment,'source_literal_changed');}for(const v of Object.values(o))if(v&&typeof v==='object')fragments(v);}
  fragments(p);
  const f=p.woocommerce_variation_form,encoded=page.rawHtml.slice(...f.encoded_value_source.raw_html_utf16_range),decoded=encoded.replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');must(sha(decoded)===f.decoded_json_sha256,'variation_json_changed');
  const variation=collector.pointer(JSON.parse(decoded),f.parsed_row_pointer);matchesCaptured(variation,f.selected_variation,'selected_variation_changed');must(variation.variation_id===[11755,3956][i]&&variation.attributes['attribute_pa_cafe-paquet']==='cafe-paquet-250'&&variation.display_price===s.afterPrice/100,'selected_price_changed');
  const jsonLd=JSON.parse(page.rawHtml.slice(...p.product_structured_data.json_content.raw_html_utf16_range));must(jsonLd.url===s.url&&collector.pointer(jsonLd,p.product_structured_data.currency_pointer)==='EUR'&&Number(collector.pointer(jsonLd,p.product_structured_data.low_price_pointer))===s.afterPrice/100,'product_jsonld_changed');
  must(p.main_product_price.currency==='EUR'&&p.main_product_price.major_currency_amount===s.afterPrice/100&&p.main_product_price.inside_same_product_variation_form===true&&p.selected_net_size.selected_attribute_value==='cafe-paquet-250','primary_price_changed');
  must(equal(p.suggested_correction.before,a.before)&&equal(p.suggested_correction.patch,a.patch)&&p.suggested_correction.full_before_row_sha256===a.full_variant_row_sha256,'source_suggested_patch_changed');
 });
}
function loadBundle(){
 must(sha(fs.readFileSync(path.join(__dirname,'collect-batch5a-piha-price-source.cjs')))===COLLECTOR_SHA,'collector_dependency_changed');
 const c=collector.loadBundle(readBytes),plan=pinned(collector.PLAN_FILE,collector.PLAN_SHA256);validatePlan(plan);
 const proof=pinned(PROOF_FILE,PROOF_SHA);validateSourceProof(proof,plan);
 const audit=pinned('batch5a-reconciliation-first/complete.json','ac518a453cf162ee13f04224cbf3919ee90300ee35cdc1c939b846aabb59c75b');
 const originals=plan.actions.map(a=>{const p=a.product_binding,product=audit.liveReadback.products.find(x=>x.id===p.product_id),known=audit.liveReadback.knownPages.find(x=>x.id===p.known_page.id),variant=audit.liveReadback.variants.find(x=>x.id===a.key.id);
 must(equal(product,p.product_before_captured_columns)&&rowHash(product.metadata)===p.metadata_sha256,'retained_parent_mismatch');must(equal(variant,a.before),'retained_variant_mismatch');must(known.entity_id===p.entity_id&&known.url===p.source_url&&known.status==='coffee'&&rowHash(known.classification)===p.known_page.classification_sha256,'retained_known_page_mismatch');return{product,known};});
 const ownerPlan=pinned('product-seed-batch5a-reviewed/receipt-0.json','0cc8f3cfccd936861a7be2e0d21a04a80ae2f5715af171d56603d7dac51fa099');const ownerAction=one(ownerPlan.actions.filter(a=>a.entity_id===collector.OWNER),'original_owner_count');must(ownerAction.action==='create'&&ownerAction.roles.includes('roaster')&&ownerAction.sources.length===1,'original_owner_action_changed');
 return{plan,proof,originals,owner:c.targets[0].source_binding.owner,expectedEntity:ownerAction.entity,expectedSource:ownerAction.sources[0],identity:{planSha:collector.PLAN_SHA256,planHash:collector.PLAN_HASH,manifestSha:collector.MANIFEST_SHA256,sourceProofSha:PROOF_SHA,helperSha:sha(fs.readFileSync(__filename))}};
}
function eq(q,key,value){q.set(key,value===null?'is.null':'eq.'+String(value));}
function descriptor(kind,index=0,bundle){
 must(Number.isInteger(index)&&index>=0&&index<2,'invalid_target_index');const s=SPEC[index],q=new URLSearchParams({select:'*',limit:'2'});let table;
 switch(kind){
 case'owner':table='entities';eq(q,'id',collector.OWNER);break;
 case'role':table='entity_roles';eq(q,'entity_id',collector.OWNER);eq(q,'role','roaster');break;
 case'crawlState':table='entity_crawl_state';eq(q,'entity_id',collector.OWNER);break;
 case'activeRuns':table='crawl_runs';eq(q,'entity_id',collector.OWNER);eq(q,'status','running');break;
 case'source':table='entity_source_ids';eq(q,'source','my_coffee_explorer');eq(q,'source_id','roaster:public-catalog:cafepiha.com');eq(q,'entity_id',collector.OWNER);break;
 case'foreignSource':table='entity_source_ids';eq(q,'source','my_coffee_explorer');eq(q,'source_id','roaster:public-catalog:cafepiha.com');q.set('entity_id','neq.'+collector.OWNER);break;
 case'product':table='products';eq(q,'id',s.product_id);break;
 case'extraSourceProduct':table='products';eq(q,'entity_id',collector.OWNER);eq(q,'source_url',s.url);q.set('id','neq.'+s.product_id);break;
 case'known':table='known_pages';eq(q,'entity_id',collector.OWNER);eq(q,'url',s.url);break;
 case'variant':table='product_variants';eq(q,'id',s.variant_id);eq(q,'product_id',s.product_id);break;
 case'patch':{
  validatePlan(bundle.plan);table='product_variants';q.delete('limit');for(const[k,v]of Object.entries(bundle.plan.actions[index].compare_and_set)){must(v===null||['string','number','boolean'].includes(typeof v),'non_scalar_cas');eq(q,k,v);}break;
 }
 default:must(false,'request_kind_out_of_scope');
 }
 return{kind,index,method:kind==='patch'?'PATCH':'GET',url:ORIGIN+'/rest/v1/'+table+'?'+q.toString(),...(kind==='patch'?{body:{price_cents:s.afterPrice}}:{})};
}
async function responseBody(response,maxBytes=4*1024*1024){
 must(response?.body?.getReader,'response_body_missing');const reader=response.body.getReader(),chunks=[];let n=0;
 try{for(;;){const{done,value}=await reader.read();if(done)break;n+=value.length;must(n<=maxBytes,'response_too_large');chunks.push(Buffer.from(value));}return Buffer.concat(chunks).toString('utf8');}finally{await reader.cancel().catch(()=>{});}
}
function createClient({bundle,key,allowWrites=false,delegate=globalThis.fetch.bind(globalThis),event=()=>{},assertLock=()=>{}}){
 let active=false,stopped=false,count=0;const started=Date.now();
 return{get requests(){return count;},async request(kind,index=0){let timer;try{
  must(!stopped,'transport_latched_stop');must(!active,'concurrent_request_refused');must(count<MAX_REQUESTS&&Date.now()-started<10*60*1000,'request_or_time_bound');must(kind!=='patch'||allowWrites,'preview_write_refused');assertLock();
  const d=descriptor(kind,index,bundle),u=new URL(d.url);must(u.origin===ORIGIN&&u.protocol==='https:'&&!u.username&&!u.password,'database_origin_mismatch');
  active=true;count++;const controller=new AbortController();timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);
  event({event:'request_intent',request:count,kind,index,method:d.method,table:u.pathname.split('/').at(-1)});
  const response=await delegate(d.url,{method:d.method,headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json',...(d.method==='PATCH'?{'Content-Type':'application/json',Prefer:'return=representation'}:{})},redirect:'error',signal:controller.signal,...(d.body?{body:JSON.stringify(d.body)}:{})});
  must(response&&!response.redirected&&(!response.url||new URL(response.url).origin===ORIGIN),'response_redirect_or_origin');
  if(![200,206].includes(response.status)){const e=Object.assign(Error('database_http_error'),{code:'database_http_error',status:response.status});try{const data=JSON.parse(await responseBody(response,8192));if(/^[A-Z0-9]{1,16}$/.test(data.code||''))e.dbCode=data.code;}catch{}
   // Production backendFor treats this optional table's PGRST205 as absent.
   // Narrower here: only this exact GET, HTTP404 and PostgREST code qualify.
   if(kind==='crawlState'&&d.method==='GET'&&response.status===404&&e.dbCode==='PGRST205'&&/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||'')){
    event({event:'optional_crawl_state_table_absent',request:count,kind,index,method:'GET',table:'entity_crawl_state',status:404,databaseCode:'PGRST205',allowCrawlDataAvailable:false,interpretation:'Optional table absent; no allow_crawl rows are available. This is not an explicit crawl-permission grant.'});
    return [];
   }
   throw e;}
  must(/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||''),'database_content_type');
  const rows=JSON.parse(await responseBody(response));must(Array.isArray(rows)&&rows.length<=2,'invalid_response_shape');
  const range=response.headers.get('content-range');must(d.method==='PATCH'||typeof range==='string','database_content_range_missing');if(range){const match=range.match(/^(\*|0-(\d+))\/(\*|\d+)$/);must(match&&(rows.length===0?match[1]==='*':match[1]!=='*'&&Number(match[2])+1===rows.length),'database_content_range_mismatch');if(match[3]!=='*')must(Number(match[3])>=rows.length,'database_total_mismatch');}
  event({event:'request_result',request:count,kind,index,status:response.status,rowCount:rows.length,responseSha:rowHash(rows)});return rows;
 }catch(error){stopped=true;event({event:'request_failure',kind,index,...diag(error)});throw error;}finally{clearTimeout(timer);active=false;}}};
}
function one(rows,code){must(Array.isArray(rows)&&rows.length===1,code);return rows[0];}
function matchesCaptured(full,captured,code){for(const[k,v]of Object.entries(captured))must(Object.hasOwn(full,k)&&equal(full[k],v),code+':'+k);}
function variantAfter(row,before,index){const expected={...before,price_cents:SPEC[index].afterPrice};must(equal(Object.keys(row).sort(),Object.keys(before).sort()),'variant_shape_changed');for(const[k,v]of Object.entries(expected))if(k!=='updated_at')must(equal(row[k],v),'variant_preservation_failed:'+k);must(typeof row.updated_at==='string'&&Number.isFinite(Date.parse(row.updated_at))&&Date.parse(row.updated_at)>=Date.parse(before.updated_at),'server_timestamp_invalid');}
async function inspect(client,bundle,afterIndices=[]){
 const owner=one(await client.request('owner'),'owner_count');matchesCaptured(owner,bundle.expectedEntity,'owner_identity_changed');must(owner.id===collector.OWNER&&owner.name===bundle.owner.name&&owner.website_url===collector.WEBSITE,'owner_identity_changed');
 const role=one(await client.request('role'),'roaster_role_count');must(role.entity_id===collector.OWNER&&role.role==='roaster','owner_role_changed');
 const crawlState=await client.request('crawlState');must(crawlState.length<=1&&crawlState.every(r=>r.entity_id===collector.OWNER&&r.allow_crawl!==false),'owner_crawl_disabled');
 must((await client.request('activeRuns')).length===0,'active_owner_claim');
 const source=one(await client.request('source'),'source_count');matchesCaptured(source,bundle.expectedSource,'source_metadata_changed');must(source.entity_id===collector.OWNER&&source.source==='my_coffee_explorer'&&source.source_id==='roaster:public-catalog:cafepiha.com','source_owner_changed');must((await client.request('foreignSource')).length===0,'foreign_source_owner');
 const rows=[];for(let i=0;i<2;i++){
  const product=one(await client.request('product',i),'product_count');matchesCaptured(product,bundle.originals[i].product,'parent_changed');must((await client.request('extraSourceProduct',i)).length===0,'duplicate_source_product');
  const known=one(await client.request('known',i),'known_page_count');matchesCaptured(known,bundle.originals[i].known,'known_page_changed');
  const variant=one(await client.request('variant',i),'variant_count');if(afterIndices.includes(i))variantAfter(variant,bundle.plan.actions[i].before,i);else must(equal(variant,bundle.plan.actions[i].before),'variant_before_changed');rows.push({product,known,variant});
 }
 return{owner,role,crawlState,source,rows};
}
function preserved(before,after,afterIndices=[]){
 for(const k of ['owner','role','crawlState','source'])must(equal(before[k],after[k]),'owner_state_changed:'+k);
 before.rows.forEach((r,i)=>{for(const k of ['product','known'])must(equal(r[k],after.rows[i][k]),'parent_or_known_changed:'+k);if(afterIndices.includes(i))variantAfter(after.rows[i].variant,r.variant,i);else must(equal(r.variant,after.rows[i].variant),'unpatched_variant_changed');});
}
function validatePreview(preview,bundle,now=Date.now()){
 must(preview.status==='fresh_preflight_pass'&&preview.mode==='preview'&&equal(preview.identity,bundle.identity),'reviewed_preview_binding_changed');
 must(Number.isFinite(Date.parse(preview.finishedAt))&&now-Date.parse(preview.finishedAt)>=0&&now-Date.parse(preview.finishedAt)<=PREVIEW_MAX_AGE_MS,'reviewed_preview_expired');
 must(preview.before&&preview.before.rows?.length===2,'reviewed_preview_incomplete');
}
async function execute({client,bundle,mode='preview',preview,append,assertLock,now=()=>Date.now()}){
 validatePlan(bundle.plan);must(['preview','apply'].includes(mode),'mode_forbidden');must(typeof append==='function'&&typeof assertLock==='function','durable_receipts_and_lock_required');if(mode==='apply')validatePreview(preview,bundle,now());
 let attempted=0,verified=0;assertLock();append({event:'begin',mode,identity:bundle.identity});
 try{
  const before=await inspect(client,bundle);if(mode==='apply')must(equal(before,preview.before),'fresh_state_differs_from_reviewed_preview');append({event:'all_preconditions_pass',before});
  if(mode==='preview'){const result={status:'fresh_preflight_pass',mode,identity:{...bundle.identity},before,finishedAt:stamp(),changes:0};append({event:'completed',result});return result;}
  let current=before;
  for(let i=0;i<2;i++){
   validatePreview(preview,bundle,now());preserved(before,current,Array.from({length:i},(_,n)=>n));assertLock();
   // A final exact active-claim check narrows the unavoidable nontransactional race.
   must((await client.request('activeRuns')).length===0,'active_owner_claim');
   append({event:'mutation_attempt',index:i,key:bundle.plan.actions[i].key,before:current.rows[i].variant,patch:bundle.plan.actions[i].patch});assertLock();attempted++;
   const returned=one(await client.request('patch',i),'cas_return_not_one');variantAfter(returned,before.rows[i].variant,i);append({event:'mutation_returned',index:i,returned});
   const after=await inspect(client,bundle,Array.from({length:i+1},(_,n)=>n));preserved(before,after,Array.from({length:i+1},(_,n)=>n));must(equal(after.rows[i].variant,returned),'mutation_readback_differs');assertLock();verified++;append({event:'mutation_verified',index:i,after});current=after;
  }
  const final=current;preserved(before,final,[0,1]);assertLock();const result={status:'two_price_corrections_verified',mode,identity:bundle.identity,attempted,verified,before,after:final,finishedAt:stamp(),wholeBatchComplete:false};append({event:'completed',result});return result;
 }catch(error){append({event:'stopped_review_required',attempted,verified,...diag(error),automaticRetryAllowed:false});throw error;}
}
function acquireLock(file=LOCK){
 const fd=fs.openSync(file,'wx',0o600),stat=fs.fstatSync(fd),text=JSON.stringify({pid:process.pid,scope:TAG,token:crypto.randomUUID(),at:stamp()});fs.writeSync(fd,text);fs.fsyncSync(fd);syncDirectory(path.dirname(file));
 const check=()=>{const s=fs.lstatSync(file);must(s.isFile()&&!s.isSymbolicLink()&&s.ino===stat.ino&&s.dev===stat.dev&&fs.readFileSync(file,'utf8')===text,'apply_lock_ownership_lost');};
 return{check,release(){try{check();fs.unlinkSync(file);syncDirectory(path.dirname(file));}finally{fs.closeSync(fd);}}};
}
function journal(dir){fs.mkdirSync(dir,{mode:0o700});syncDirectory(path.dirname(dir));const file=path.join(dir,'events.ndjson'),fd=fs.openSync(file,'wx',0o600);fs.fsyncSync(fd);syncDirectory(dir);let failed=false,seq=0;return{append(e){must(!failed,'journal_latched_stop');try{const b=Buffer.from(JSON.stringify({seq:++seq,at:stamp(),...e})+'\n');let o=0;while(o<b.length)o+=fs.writeSync(fd,b,o,b.length-o);fs.fsyncSync(fd);}catch(error){failed=true;throw error;}},close(){fs.closeSync(fd);}};}
function cli(args){if(!args.length||equal(args,['--check']))return{mode:'check'};if(equal(args,['--preview']))return{mode:'preview'};must(args.length===4&&args[0]==='--apply'&&/^[a-f0-9]{64}$/.test(args[2])&&args[3]==='--confirm-two-price-corrections','usage_check_preview_or_apply_exact_preview_file_sha_confirm');return{mode:'apply',previewFile:args[1],previewSha:args[2]};}
function previewPath(full){must(path.dirname(path.dirname(full))===STATE&&new RegExp('^'+TAG+'-preview-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$').test(path.basename(path.dirname(full)))&&path.basename(full)==='result.json','preview_path_out_of_scope');}
async function main(args=process.argv.slice(2)){
 const options=cli(args),bundle=loadBundle();if(options.mode==='check'){console.log(JSON.stringify({status:'offline_validation_pass',identity:bundle.identity,actions:2,networkRequests:0,databaseCalls:0}));return;}
 must(fs.realpathSync(process.cwd())===ROOT&&fs.realpathSync(__dirname)===ROOT+'/src/myCoffeeExplorerImport','production_location_required');must(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL||'').href===ORIGIN+'/','runtime_database_mismatch');const key=process.env.SUPABASE_SERVICE_ROLE_KEY;must(typeof key==='string'&&key.length>20,'credentials_missing');
 let preview;if(options.mode==='apply'){const full=fs.realpathSync(options.previewFile);previewPath(full);const bytes=fs.readFileSync(full);must(sha(bytes)===options.previewSha,'reviewed_preview_hash_mismatch');preview=JSON.parse(bytes);validatePreview(preview,bundle);}
 const lock=acquireLock(),dir=options.mode==='apply'?STATE+'/'+TAG+'-apply':STATE+'/'+TAG+'-preview-'+crypto.randomUUID();let log,guard,ownerLock;
 const tls=process.env.NODE_TLS_REJECT_UNAUTHORIZED;
 try{ownerLock=acquireLock(OWNER_LOCK);const check=()=>{lock.check();ownerLock.check();};log=journal(dir);saveExclusive(path.join(dir,'reservation.json'),{at:stamp(),mode:options.mode,identity:bundle.identity,previewSha:options.previewSha||null,oneShot:true,noRetry:true});process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';guard=installLegalGuard({internalDataOrigin:ORIGIN});const client=createClient({bundle,key,allowWrites:options.mode==='apply',event:e=>log.append(e),assertLock:check});const result=await execute({client,bundle,mode:options.mode,preview,append:e=>log.append(e),assertLock:check});saveExclusive(path.join(dir,'result.json'),result);console.log(JSON.stringify({status:result.status,output:dir,resultSha:sha(fs.readFileSync(path.join(dir,'result.json')))}));}
 catch(error){if(log)try{saveExclusive(path.join(dir,'failure.json'),{at:stamp(),status:'stopped_review_required',...diag(error),noRetry:true});}catch{}throw error;}
 finally{try{guard?.uninstall();}finally{try{log?.close();}finally{if(tls===undefined)delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;else process.env.NODE_TLS_REJECT_UNAUTHORIZED=tls;try{ownerLock?.release();}finally{lock.release();}}}}
}
module.exports={ROOT,STATE,ORIGIN,LOCK,OWNER_LOCK,TAG,ARTIFACT_BASE,PROOF_FILE,PROOF_SHA,SPEC,PREVIEW_MAX_AGE_MS,MAX_REQUESTS,sha,rowHash,diag,validatePlan,validateSourceProof,loadBundle,descriptor,createClient,variantAfter,inspect,preserved,validatePreview,execute,acquireLock,journal,cli,previewPath,main};
if(require.main===module)main().catch(e=>{console.error(JSON.stringify(diag(e)));process.exitCode=1;});
