'use strict';
// Finite read-only reconciliation of the stopped price correction; never resumes it.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const h=require('./apply-batch5a-piha-price-correction-v2.cjs');
const {saveExclusive}=require('./plan8-product-link-discovery.cjs');
const {installLegalGuard}=require('./legal-guard.cjs');
async function main(){
 assert.equal(process.argv.length,2);
 assert.equal(fs.realpathSync(process.cwd()),h.ROOT);
 assert.equal(fs.realpathSync(__dirname),h.ROOT+'/src/myCoffeeExplorerImport');
 assert.equal(h.sha(fs.readFileSync(path.join(__dirname,'apply-batch5a-piha-price-correction-v2.cjs'))),'cadfad3ba859151b77fb3f001d4ac93b1c736cd7f1444d82293e18e0916c3f4d');
 assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin,h.ORIGIN);
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;assert(key&&key.length>20);
 const bundle=h.loadBundle(),attemptBytes=fs.readFileSync(h.STATE+'/batch5a-piha-price-correction-apply/events.ndjson');
 assert.equal(h.sha(attemptBytes),'e46b7304870cc613eec9f0a0e16b9a681f183cf72b2032142cef4eba948fbbeb');
 const events=attemptBytes.toString().trim().split('\n').map(JSON.parse);
 const returned=events.filter(e=>e.event==='mutation_returned');
 assert.equal(returned.length,1);assert.equal(returned[0].index,0);
 assert.equal(events.filter(e=>e.event==='mutation_attempt').length,1);
 const last=events.at(-1);assert.equal(last.event,'stopped_review_required');assert.equal(last.attempted,1);assert.equal(last.verified,0);assert.equal(last.databaseCode,'57014');
 h.variantAfter(returned[0].returned,bundle.plan.actions[0].before,0);
 const dir=h.STATE+'/batch5a-piha-price-attempt-readback',lock=h.acquireLock();let ownerLock,log,guard;
 const priorTls=process.env.NODE_TLS_REJECT_UNAUTHORIZED;
 try{
  ownerLock=h.acquireLock(h.OWNER_LOCK);const check=()=>{lock.check();ownerLock.check();};
  log=h.journal(dir);saveExclusive(dir+'/reservation.json',{at:new Date().toISOString(),scope:'Two exact variant GETs only; no repair retry',helperSha:h.sha(fs.readFileSync(__filename)),attemptEventsSha:h.sha(attemptBytes),maximumDatabaseRequests:2,databaseMutationAllowed:false});
  process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';guard=installLegalGuard({internalDataOrigin:h.ORIGIN});
  const client=h.createClient({bundle,key,allowWrites:false,event:e=>log.append(e),assertLock:check}),rows=[];
  for(let i=0;i<2;i++){
   const found=await client.request('variant',i);assert.equal(found.length,1);const row=found[0];
   saveExclusive(dir+'/variant-'+i+'.json',row);rows.push(row);
   assert.deepEqual(row,i===0?returned[0].returned:bundle.plan.actions[1].before);
  }
  assert.equal(client.requests,2);check();
  const result={at:new Date().toISOString(),status:'first_price_correction_readback_verified_second_unattempted',databaseGetRequests:2,databaseWrites:0,rows,pricesEur:[rows[0].price_cents/100,rows[1].price_cents/100],sourcePricesEur:[12,14.4],wholeBatchComplete:false,secondCorrectionApplied:false,fullPostWriteContextVerificationComplete:false,automaticRetryAllowed:false};
  saveExclusive(dir+'/result.json',result);log.append({event:'readback_completed',status:result.status});console.log(JSON.stringify({status:result.status,output:dir,resultSha:h.sha(fs.readFileSync(dir+'/result.json'))}));
 }catch(error){if(log)saveExclusive(dir+'/failure.json',{at:new Date().toISOString(),...h.diag(error),databaseMutationAllowed:false,noRetry:true});throw error;}
 finally{try{guard?.uninstall();}finally{try{log?.close();}finally{if(priorTls===undefined)delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;else process.env.NODE_TLS_REJECT_UNAUTHORIZED=priorTls;try{ownerLock?.release();}finally{lock.release();}}}}
}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify(h.diag(e)));process.exitCode=1;});
