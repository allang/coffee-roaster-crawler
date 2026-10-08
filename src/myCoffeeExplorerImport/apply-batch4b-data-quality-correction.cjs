'use strict';
// Exactly two reviewed corrections. No network or mutations on module import.
// CLI (crawler repo cwd): node SCRIPT BASE [--preview | --apply]
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{isDeepStrictEqual:equal}=require('node:util');
const {backendFor,validateOwner,DB_ORIGIN}=require('./product-only-crawl.cjs');
const {installLegalGuard,assertAllowedUrl}=require('./legal-guard.cjs');
const PLAN='batch4b-data-quality-correction-plan.json';
const PLAN_HASH='cc5c62422b6a0bfbde7832fd78ee5e0727f860a871d6efdb4367cc8f0ec2ffbe';
const PLAN_FILE_HASH='45150abdc1f499d61e617992528f563e6b2be5ef26408e16d47fdcd3711c57d2';
const JOURNAL='batch4b-data-quality-correction.receipts.ndjson';
const SPEC=[{table:'product_variants',key:{id:'0d8ce08e-479f-455b-a41a-04d06e29a3d4',product_id:'ae80159f-6f71-45a5-8abd-caf976af8ad0'},patch:{weight_g:null}},{table:'coffee_facts',key:{product_id:'bf1b1c01-d7c9-4217-a5de-d112a7c3b37a'},patch:{decaf:true}}];
const sha=x=>crypto.createHash('sha256').update(Buffer.isBuffer(x)||typeof x==='string'?x:JSON.stringify(x)).digest('hex');
function must(ok,code){if(!ok)throw Object.assign(new Error(code),{code});}
function pinnedOrigin(env){const u=new URL(env.NEXT_PUBLIC_SUPABASE_URL||'https://invalid.invalid');must(u.href===DB_ORIGIN+'/'&&!u.username&&!u.password,'runtime_database_mismatch');return DB_ORIGIN;}
function validatePlan(p){
 const {planHash,...body}=p;must(planHash===PLAN_HASH&&sha(body)===PLAN_HASH,'pinned_plan_hash_mismatch');
 must(p.database_origin===DB_ORIGIN&&p.action_count===2&&p.actions.length===2&&p.raw_metadata_write_allowed===false&&p.global_core_changes===false,'plan_scope_mismatch');
 p.actions.forEach((a,i)=>{const s=SPEC[i];must(a.table===s.table&&equal(a.key,s.key)&&equal(a.patch,s.patch),'exact_correction_scope_mismatch');must(equal(a.before,a.compare_and_set)&&equal(a.expected_after,{...a.before,...a.patch}),'full_before_cas_required');for(const [k,v]of Object.entries(a.key))must(a.before[k]===v,'row_key_mismatch');must(a.product_binding.product_id===a.key.product_id,'product_binding_mismatch');assertAllowedUrl(a.product_binding.source_url);assertAllowedUrl(a.product_binding.owner.website_url);});
}
function confinedRead(base,file){
 must(typeof file==='string'&&!path.isAbsolute(file),'evidence_path_outside_base');const resolved=fs.realpathSync(path.resolve(base,file));must(resolved.startsWith(base+path.sep),'evidence_path_outside_base');return fs.readFileSync(resolved);
}
function loadBundle(baseArg){
 const base=fs.realpathSync(baseArg),bytes=confinedRead(base,PLAN);must(sha(bytes)===PLAN_FILE_HASH,'pinned_plan_file_mismatch');const plan=JSON.parse(bytes);validatePlan(plan);
 for(const r of plan.evidence_receipts)must(sha(confinedRead(base,r.file))===r.sha256,'evidence_hash_mismatch:'+r.file);
 const read=f=>JSON.parse(confinedRead(base,'product-seed-batch4b/'+f)),manifest=read('manifest.json'),audit=read('result-audit.json'),preflight=read('preflight.json'),owners=read('ownership.json');
 must(sha(confinedRead(base,'product-seed-batch4b/manifest.json'))===plan.manifest_sha256&&audit.manifestHash===plan.manifest_sha256&&preflight.manifestHash===plan.manifest_sha256&&preflight.productCount===0,'batch_receipt_mismatch');
 for(const r of manifest.artifacts)must(sha(confinedRead(base,'product-seed-batch4b/'+r.path))===r.sha256,'manifest_artifact_hash_mismatch:'+r.path);
 const products=plan.actions.map(a=>{const p=a.product_binding,found=audit.products.filter(x=>x.id===p.product_id),target=manifest.targets.find(t=>t.entity_id===p.entity_id);must(found.length===1&&found[0].entity_id===p.entity_id&&found[0].source_url===p.source_url&&found[0].name===p.name&&sha(found[0].metadata)===p.metadata_sha256,'saved_product_binding_mismatch');must(equal(owners.find(o=>o.entity_id===p.entity_id),p.owner)&&target&&target.website_url===p.owner.website_url&&equal(target.source_ids,p.owner.source_ids)&&target.products.some(x=>equal(x,p.manifest_product)),'manifest_owner_binding_mismatch');must(equal((a.table==='product_variants'?audit.variants:audit.facts).find(x=>Object.entries(a.key).every(([k,v])=>x[k]===v)),a.before),'saved_before_row_mismatch');return found[0];});
 return{base,plan,products};
}
async function rows(q){const {data,error}=await q;if(error)throw error;must(Array.isArray(data),'query_rows_missing');return data;}
function rowState(a,row){
 must(equal(Object.keys(row).sort(),Object.keys(a.before).sort()),'row_shape_changed');const already=Object.entries(a.patch).every(([k,v])=>equal(row[k],v)),expected=already?a.expected_after:a.before;
 for(const [k,v]of Object.entries(expected)){if(already&&k==='updated_at')continue;must(equal(row[k],v),'row_precondition_changed:'+k);}return already;
}
function withoutUpdated(row){const {updated_at,...other}=row;return other;}
async function inspect(db,backend,bundle,a,index){
 const b=a.product_binding,t=b.owner,state=await backend.state(t),entity=validateOwner(t,state);must(state.entities.length===1&&entity.website_url===t.website_url,'exact_owner_website_mismatch');
 for(const source of t.source_ids){const owners=await rows(db.from('entity_source_ids').select('entity_id,source,source_id').eq('source',source.source).eq('source_id',source.source_id).limit(2));must(owners.length===1&&owners[0].entity_id===b.entity_id,'source_ownership_not_unique');}
 const products=await rows(db.from('products').select('*').eq('id',b.product_id).limit(2));must(products.length===1,'product_count_mismatch');const product=products[0],original=bundle.products[index];
 for(const [k,v]of Object.entries(original))must(equal(product[k],v),'product_precondition_changed:'+k);must(sha(product.metadata)===b.metadata_sha256,'product_metadata_changed');
 const sameSource=await rows(db.from('products').select('id,entity_id,source_url').eq('entity_id',b.entity_id).eq('source_url',b.source_url).limit(2));must(sameSource.length===1&&sameSource[0].id===b.product_id,'product_source_not_unique');
 let q=db.from(a.table).select('*');for(const [k,v]of Object.entries(a.key))q=q.eq(k,v);const found=await rows(q.limit(2));must(found.length===1,'target_row_count_mismatch');
 return{row:found[0],already:rowState(a,found[0]),product,ownerState:state};
}
function assertUnchangedProducts(initial,current){initial.forEach((x,i)=>must(equal(x.product,current[i].product),'product_changed_during_execution'));}
async function execute({db,bundle,mode='preview',append,assertLock}){
 must(['preview','apply'].includes(mode),'invalid_mode');validatePlan(bundle.plan);must(typeof append==='function'&&typeof assertLock==='function','durable_receipt_and_lock_required');const backend=backendFor(db),plan=bundle.plan;
 const all=()=>Promise.all(plan.actions.map((a,i)=>inspect(db,backend,bundle,a,i)));
 assertLock();append({event:'started',mode});
 try{
  const initial=await all();append({event:'all_preconditions_verified',entries:initial.map((x,i)=>({key:plan.actions[i].key,before:x.row,already:x.already,product:x.product,ownerState:x.ownerState}))});
  let changed=0;
  for(let i=0;i<plan.actions.length;i++){
   // Recheck BOTH products, rows and owner/source bindings before each write.
   const current=await all();assertUnchangedProducts(initial,current);const a=plan.actions[i],before=current[i];assertLock();
   append({event:'before_action',index:i,table:a.table,key:a.key,before:before.row,patch:a.patch,already:before.already,metadata_sha256:sha(before.product.metadata)});
   if(mode==='apply'&&!before.already){
    assertLock();let q=db.from(a.table).update(a.patch);for(const [k,v]of Object.entries(a.compare_and_set))q=v===null?q.is(k,null):q.eq(k,v);
    const updated=await rows(q.select('*'));must(updated.length===1,'cas_row_count_not_one');must(equal(withoutUpdated(updated[0]),withoutUpdated(a.expected_after)),'mutation_return_mismatch');changed++;
   }
   const after=await inspect(db,backend,bundle,a,i);must(equal(before.product,after.product),'product_changed_after_action');if(mode==='apply')must(after.already,'correction_not_visible');else must(equal(after.row,before.row),'preview_row_changed');
   append({event:'action_verified',index:i,key:a.key,status:mode==='preview'?'preview':before.already?'already_applied':'applied',before:before.row,after:after.row,metadata_sha256:sha(after.product.metadata)});
  }
  const final=await all();assertUnchangedProducts(initial,final);if(mode==='apply')must(final.every(x=>x.already),'final_correction_missing');assertLock();const result={planHash:PLAN_HASH,mode,verified:2,changed,rawMetadataPreserved:true,finishedAt:new Date().toISOString()};append({event:'completed',result});return result;
 }catch(e){append({event:'failed',code:e.code||'verification_failed',message:e.message});throw e;}
}
function acquireLock(lock){
 const token=crypto.randomUUID(),body=JSON.stringify({pid:process.pid,token,planHash:PLAN_HASH,startedAt:new Date().toISOString()});const fd=fs.openSync(lock,'wx',0o600);fs.writeSync(fd,body);fs.fsyncSync(fd);
 const check=()=>must(fs.readFileSync(lock,'utf8')===body,'shared_lock_ownership_lost');
 return{check,release(){try{check();fs.unlinkSync(lock);}finally{fs.closeSync(fd);}}};
}
function openJournal(base,mode){
 const file=path.join(base,JOURNAL),runId=crypto.randomUUID();let seq=0;if(fs.existsSync(file)){must(fs.lstatSync(file).isFile()&&!fs.lstatSync(file).isSymbolicLink(),'unsafe_journal_path');const bytes=fs.readFileSync(file,'utf8');must(!bytes||bytes.endsWith('\n'),'incomplete_journal_tail');for(const line of bytes.split('\n').filter(Boolean)){const r=JSON.parse(line);must(r.planHash===PLAN_HASH&&r.seq===++seq,'invalid_prior_receipt');}}
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_APPEND|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW,0o600);
 return{runId,file,append(event){const row={...event,seq:++seq,at:new Date().toISOString(),runId,mode,planHash:PLAN_HASH};const bytes=Buffer.from(JSON.stringify(row)+'\n');let offset=0;while(offset<bytes.length)offset+=fs.writeSync(fd,bytes,offset,bytes.length-offset);fs.fsyncSync(fd);},close(){fs.closeSync(fd);}};
}
function cliArgs(args){must(args.length>=1&&args.length<=2&&(!args[1]||['--preview','--apply'].includes(args[1])),'usage_BASE_optional_apply');return{baseArg:args[0],mode:args[1]==='--apply'?'apply':'preview'};}
async function main(){
 const {baseArg,mode}=cliArgs(process.argv.slice(2)),bundle=loadBundle(baseArg);pinnedOrigin(process.env);const lock=acquireLock(path.resolve('.state/my-coffee-explorer/apply.lock'));let journal,guard;
 try{journal=openJournal(bundle.base,mode);guard=installLegalGuard({internalDataOrigin:DB_ORIGIN});process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';const db=require('/Users/allan/.openclaw/workspace/coffee-roaster-crawler/src/supabase.js').getSupabase();const result=await execute({db,bundle,mode,append:e=>journal.append(e),assertLock:()=>lock.check()});console.log(JSON.stringify({...result,receipt:journal.file,runId:journal.runId}));}
 finally{if(guard)guard.uninstall();if(journal)journal.close();lock.release();}
}
module.exports={PLAN,PLAN_HASH,PLAN_FILE_HASH,JOURNAL,SPEC,pinnedOrigin,validatePlan,loadBundle,rowState,inspect,execute,acquireLock,openJournal,cliArgs,sha};
if(require.main===module)main().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
