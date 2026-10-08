'use strict';
// Separate one-shot repair of only the unattempted Decaf variant; no network by default.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {isDeepStrictEqual:equal}=require('node:util');
const h=require('./apply-batch5a-piha-price-correction-v2.cjs');
const {saveExclusive}=require('./plan8-product-link-discovery.cjs');
const {installLegalGuard}=require('./legal-guard.cjs');
const HELPER_PIN='cadfad3ba859151b77fb3f001d4ac93b1c736cd7f1444d82293e18e0916c3f4d';
const PROPOSAL='batch5a-piha-remaining-second-price-proposal.json',PROPOSAL_SHA='9f2b7f91c46d587c5e34cc7ccc5a70bc1252ec614d71e6f17cb74fc99f379b77',PROPOSAL_ROW_HASH='88be82599a47109c21145e2ab1b25afcbe2a0adbe229f74a90dc5003be1d5116';
const TAG='batch5a-piha-remaining-second-price',KINDS=Object.freeze(['owner','role','source','product','known','variant','crawlState','activeRuns']);
const OWNER='d11e3f98-4506-4435-90cd-dff1634cc974',PRODUCT='c66abd24-7e76-4937-939e-509b9f47e1b4',VARIANT='b9c867c4-d2b3-4fbc-b62a-545d6e99f1a6';
const KNOWN='f525fa13-67b2-445c-bec7-f12b8a87199d',SOURCE='3cf8b4a7-6fcb-4b34-8347-8f403b3cc6e7';
const stamp=()=>new Date().toISOString();
function must(ok,code){if(!ok)throw Object.assign(Error(code),{code});}
function validateBundle(b){must(h.rowHash(b.proposal)===PROPOSAL_ROW_HASH,'proposal_changed');h.validatePlan(b.sourceBundle.plan);must(equal(b.proposal.soleAction.compare_and_set,b.sourceBundle.plan.actions[1].before),'before_binding_changed');}
function loadBundle(){
 must(h.sha(fs.readFileSync(path.join(__dirname,'apply-batch5a-piha-price-correction-v2.cjs')))===HELPER_PIN,'transport_dependency_changed');
 const bytes=fs.readFileSync(path.join(h.ARTIFACT_BASE,PROPOSAL));must(h.sha(bytes)===PROPOSAL_SHA,'proposal_hash_changed');const proposal=JSON.parse(bytes);
 for(const[file,pin]of Object.entries(proposal.provenance.pins)){must(!path.isAbsolute(file)&&!file.split('/').includes('..'),'pin_path_unsafe');const base=file.endsWith('.cjs')?__dirname:h.ARTIFACT_BASE;must(h.sha(fs.readFileSync(path.join(base,file)))===pin,'evidence_hash_changed');}
 const sourceBundle=h.loadBundle(),b={proposal,sourceBundle,identity:{proposalSha:PROPOSAL_SHA,sourceIdentity:sourceBundle.identity,helperSha:h.sha(fs.readFileSync(__filename))}};validateBundle(b);return b;
}
function descriptor(kind,b){
 validateBundle(b);must(KINDS.includes(kind)||kind==='patch','request_kind_out_of_scope');
 // Frozen transport always addresses index1. Only these two GET selectors change.
 const d=h.descriptor(kind,1,b.sourceBundle);
 if(kind==='source'||kind==='known'){const q=new URLSearchParams({select:'*',limit:'2',id:'eq.'+(kind==='source'?SOURCE:KNOWN)});d.url=h.ORIGIN+'/rest/v1/'+(kind==='source'?'entity_source_ids':'known_pages')+'?'+q;}
 if(kind==='patch')must(equal(d.body,{price_cents:1440})&&new URL(d.url).searchParams.get('id')==='eq.'+VARIANT,'patch_scope_changed');
 return d;
}
function createClient({bundle,mode='preview',key,delegate=globalThis.fetch.bind(globalThis),event=()=>{},assertLock=()=>{}}){
 must(['preview','apply'].includes(mode),'mode_forbidden');let active=false,stopped=false,currentKind;
 const maximum=mode==='preview'?8:18;
 const inner=h.createClient({bundle:bundle.sourceBundle,key,allowWrites:mode==='apply',event,assertLock,delegate:async(url,options)=>{
  must(active&&currentKind,'adapter_without_request');const old=h.descriptor(currentKind,1,bundle.sourceBundle),d=descriptor(currentKind,bundle);
  must(url===old.url&&options.method===d.method&&equal(options.body?JSON.parse(options.body):undefined,d.body),'adapter_scope_changed');
  // No discarded selector is sent: actual request uses only the fixed descriptor above.
  return delegate(d.url,options);
 }});
 return{get requests(){return inner.requests;},async request(kind){try{
  must(!stopped,'transport_latched_stop');must(!active,'concurrent_request_refused');must(inner.requests<maximum,'request_bound');must(KINDS.includes(kind)||(kind==='patch'&&mode==='apply'),'request_kind_or_write_forbidden');
  descriptor(kind,bundle);active=true;currentKind=kind;return await inner.request(kind,1);
 }catch(error){stopped=true;throw error;}finally{active=false;currentKind=undefined;}}};
}
function one(rows,code){must(Array.isArray(rows)&&rows.length===1,code);return rows[0];}
async function inspect(client,b,after=false){
 validateBundle(b);const rows={};for(const kind of KINDS){const result=await client.request(kind);
  if(kind==='activeRuns'){must(result.length===0,'active_owner_claim');rows[kind]=result;}
  else if(kind==='crawlState'){must(result.length<=1&&result.every(r=>r.entity_id===OWNER&&r.allow_crawl!==false),'owner_crawl_disabled');rows[kind]=result;}
  else{rows[kind]=one(result,kind+'_count');if(kind==='variant'&&after)h.variantAfter(rows[kind],b.proposal.baseline.rows.variant,1);else must(equal(rows[kind],b.proposal.baseline.rows[kind]),kind+'_baseline_changed');}
 }
 must(rows.owner.id===OWNER&&rows.source.entity_id===OWNER&&rows.product.entity_id===OWNER&&rows.known.entity_id===OWNER&&rows.variant.product_id===PRODUCT,'owner_binding_changed');
 must(rows.known.url===rows.product.source_url&&rows.known.status==='coffee'&&rows.variant.id===VARIANT,'product_binding_changed');return rows;
}
function preserved(before,after){for(const kind of KINDS)if(kind!=='variant')must(equal(before[kind],after[kind]),'context_changed:'+kind);h.variantAfter(after.variant,before.variant,1);}
function validatePreview(p,b,now=Date.now()){
 must(p?.status==='remaining_second_price_preflight_pass'&&p.mode==='preview'&&equal(p.identity,b.identity),'preview_binding_changed');
 must(Number.isFinite(Date.parse(p.finishedAt))&&now-Date.parse(p.finishedAt)>=0&&now-Date.parse(p.finishedAt)<=h.PREVIEW_MAX_AGE_MS,'preview_expired');
 must(p.before&&equal(Object.keys(p.before).sort(),[...KINDS].sort()),'preview_incomplete');
}
async function execute({client,bundle,mode='preview',preview,append,assertLock,now=()=>Date.now()}){
 must(['preview','apply'].includes(mode),'mode_forbidden');must(typeof append==='function'&&typeof assertLock==='function','durability_and_locks_required');validateBundle(bundle);if(mode==='apply')validatePreview(preview,bundle,now());let attempted=0,verified=0;
 try{
  assertLock();append({event:'begin',mode,identity:bundle.identity});const before=await inspect(client,bundle);if(mode==='apply')must(equal(before,preview.before),'fresh_context_differs_from_preview');append({event:'all_preconditions_pass',before});
  if(mode==='preview'){must(client.requests===8,'preview_request_count');const result={status:'remaining_second_price_preflight_pass',mode,identity:structuredClone(bundle.identity),before,finishedAt:stamp(),changes:0};append({event:'completed',result});return result;}
  validatePreview(preview,bundle,now());assertLock();must((await client.request('activeRuns')).length===0,'active_owner_claim');
  validatePreview(preview,bundle,now());append({event:'mutation_attempt',key:{id:VARIANT,product_id:PRODUCT},before:before.variant,patch:{price_cents:1440}});assertLock();attempted=1;
  const returned=one(await client.request('patch'),'cas_return_not_one');h.variantAfter(returned,before.variant,1);append({event:'mutation_returned',returned});
  const after=await inspect(client,bundle,true);preserved(before,after);must(equal(returned,after.variant),'mutation_readback_differs');assertLock();must(client.requests===18,'apply_request_count');verified=1;append({event:'mutation_verified',after});
  const result={status:'remaining_second_price_verified',mode,identity:structuredClone(bundle.identity),attempted,verified,before,after,finishedAt:stamp(),databaseRequests:18,firstPriceRequests:0,firstPriceMutation:false,wholeBatchComplete:false,automaticRetryAllowed:false};append({event:'completed',result});return result;
 }catch(error){append({event:'stopped_review_required',attempted,verified,...h.diag(error),automaticRetryAllowed:false});throw error;}
}
function cli(args){if(!args.length||equal(args,['--check']))return{mode:'check'};if(equal(args,['--preview']))return{mode:'preview'};must(args.length===4&&args[0]==='--apply'&&/^[a-f0-9]{64}$/.test(args[2])&&args[3]==='--confirm-one-decaf-price-correction','usage_check_preview_or_apply_exact_preview_sha_confirm');return{mode:'apply',previewFile:args[1],previewSha:args[2]};}
function previewPath(file){must(path.dirname(path.dirname(file))===h.STATE&&new RegExp('^'+TAG+'-preview-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$').test(path.basename(path.dirname(file)))&&path.basename(file)==='result.json','preview_path_out_of_scope');}
async function main(args=process.argv.slice(2)){
 const options=cli(args),bundle=loadBundle();if(options.mode==='check'){console.log(JSON.stringify({status:'offline_validation_pass',identity:bundle.identity,actions:1,networkRequests:0,databaseCalls:0}));return;}
 must(fs.realpathSync(process.cwd())===h.ROOT&&fs.realpathSync(__dirname)===h.ROOT+'/src/myCoffeeExplorerImport','production_location_required');must(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL||'').href===h.ORIGIN+'/','database_origin_mismatch');const key=process.env.SUPABASE_SERVICE_ROLE_KEY;must(typeof key==='string'&&key.length>20,'credentials_missing');
 let preview;if(options.mode==='apply'){const file=fs.realpathSync(options.previewFile);previewPath(file);const bytes=fs.readFileSync(file);must(h.sha(bytes)===options.previewSha,'reviewed_preview_hash_mismatch');preview=JSON.parse(bytes);validatePreview(preview,bundle);}
 const lock=h.acquireLock(),dir=h.STATE+'/'+TAG+(options.mode==='apply'?'-apply':'-preview-'+crypto.randomUUID());let ownerLock,log,guard;const priorTls=process.env.NODE_TLS_REJECT_UNAUTHORIZED;
 try{ownerLock=h.acquireLock(h.OWNER_LOCK);const check=()=>{lock.check();ownerLock.check();};log=h.journal(dir);saveExclusive(dir+'/reservation.json',{at:stamp(),mode:options.mode,identity:bundle.identity,previewSha:options.previewSha||null,oneShot:true,noRetry:true,maximumDatabaseRequests:options.mode==='apply'?18:8});process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';guard=installLegalGuard({internalDataOrigin:h.ORIGIN});
  const client=createClient({bundle,mode:options.mode,key,event:e=>log.append(e),assertLock:check}),result=await execute({client,bundle,mode:options.mode,preview,append:e=>log.append(e),assertLock:check});saveExclusive(dir+'/result.json',result);console.log(JSON.stringify({status:result.status,output:dir,resultSha:h.sha(fs.readFileSync(dir+'/result.json'))}));
 }catch(error){if(log)try{saveExclusive(dir+'/failure.json',{at:stamp(),status:'stopped_review_required',error:h.diag(error),noRetry:true});}catch{}throw error;}
 finally{try{guard?.uninstall();}finally{try{log?.close();}finally{if(priorTls===undefined)delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;else process.env.NODE_TLS_REJECT_UNAUTHORIZED=priorTls;try{ownerLock?.release();}finally{lock.release();}}}}
}
module.exports={TAG,PROPOSAL,PROPOSAL_SHA,PROPOSAL_ROW_HASH,HELPER_PIN,OWNER,PRODUCT,VARIANT,KNOWN,SOURCE,KINDS,loadBundle,validateBundle,descriptor,createClient,inspect,preserved,validatePreview,execute,cli,previewPath,main};
if(require.main===module)main().catch(e=>{console.error(JSON.stringify(h.diag(e)));process.exitCode=1;});
