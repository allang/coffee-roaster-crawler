'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const realNetwork=require('../src/siteSupport/network');
const {installReaderObservation,installVisitObservation,visitGate}=require('../scripts/passport-observation.cjs');
const profile={name:'Passport',hosts:['passportcoffee.com.au']},url='https://passportcoffee.com.au/products/coffee';
const lookup=async()=>[{address:'93.184.216.34'}];
test('observer retains actual Retry-After, completed retry ledger and zero-wire cooldown error',async()=>{
  const network={...realNetwork},state={};installReaderObservation(network,{state});let calls=0;
  const reader=network.createReader(profile,{now:()=>0,lookup,fetch:async()=>{calls++;return new Response('',{status:503,headers:{'retry-after':'123',date:'Thu, 08 Oct 2026 18:32:07 GMT','content-type':'application/json','set-cookie':'private'}});}});
  const first=await reader.fetchHtml(url),second=await reader.fetchHtml(url+'-next');
  assert.equal(first.error,'HTTP 503');assert.equal(first.retryStopped,'retry_after_limit');
  assert.equal(second.error,'Merchant cooldown exceeds read time budget');assert.equal(second.attempts,0);assert.equal(calls,1);
  assert.equal(state.merchant_wire_requests[0].response_headers['retry-after'],'123');assert(!('set-cookie' in state.merchant_wire_requests[0].response_headers));
  assert.equal(state.readers[0].requests[0].retryAfterMs,123000);assert.equal(state.readers[0].requests[0].retryStopped,'retry_after_limit');
  assert.equal(state.reader_results.length,2);assert.equal(state.reader_results[1].result.attempts,0);
});
test('observer preserves bounded retries, sleep behavior and the returned success object',async()=>{
  const network={...realNetwork},state={};installReaderObservation(network,{state});let time=0,calls=0;const waits=[];
  const reader=network.createReader(profile,{now:()=>time,lookup,sleep:async ms=>{waits.push(ms);time+=ms;},fetch:async()=>++calls===1?new Response('',{status:429,headers:{'retry-after':'2'}}):new Response('fresh native body',{status:200})});
  const result=await reader.fetchHtml(url);
  assert(result.success);assert.equal(result.data,'fresh native body');assert.deepEqual(waits,[2000]);assert.equal(calls,2);
  assert.equal(state.readers[0].requests.length,2);assert.equal(state.readers[0].requests[0].retryAfterMs,2000);assert.equal(state.reader_results[0].result.retries,1);
  assert(!('data' in state.reader_results[0].result));assert.equal(state.reader_results[0].result.body_chars,17);
  const originalResult={success:true,data:'same',future_job_metadata:{long_resumptions:1}};
  const stub={createReader:()=>({requests:[],fetchHtml:async()=>originalResult})};const stubState={};installReaderObservation(stub,{state:stubState});
  assert.equal(await stub.createReader(profile).fetchHtml(url),originalResult);assert.deepEqual(stubState.reader_results[0].result.future_job_metadata,{long_resumptions:1});
});
test('deferred or incomplete page sets fail before caller completion and omission reconciliation',async()=>{
  for(const metrics of [{visited:2,errors:1},{visited:1,errors:0},{visited:2,errors:0,deferredPages:['pending']},{visited:2,errors:0,inventoryComplete:false}]){
    const visitor={visitAllPages:async()=>metrics},state={};installVisitObservation(visitor,{state});let completed=false,reconciled=false;
    await assert.rejects(async()=>{await visitor.visitAllPages('owner',['one','two']);completed=true;reconciled=true;},/Observer full-run gate failed/);
    assert(!completed&&!reconciled);assert(!state.visits[0].gate.successful);assert.deepEqual(state.visits[0].metrics,metrics);
  }
  const complete={visited:2,errors:0,coffeeFound:2,variants_complete:false},visitor={visitAllPages:async()=>complete};installVisitObservation(visitor,{state:{}});
  assert.equal(await visitor.visitAllPages('owner',['one','two']),complete);
  assert(visitGate(complete,['one','two']).successful,'Reviewed accessory variant subsets do not mean unvisited pages');
});
test('runner without explicit activation does not read credentials, create output or start a crawl',()=>{
  const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
  const output=path.join(os.tmpdir(),'passport-observer-unstarted-'+crypto.randomUUID());
  const result=cp.spawnSync(process.execPath,[path.join(__dirname,'../scripts/observe-passport-run.cjs'),'--output',output],{encoding:'utf8',env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'invalid',OPENAI_API_KEY:''}});
  assert.equal(result.status,0);const receipt=JSON.parse(result.stdout);assert(receipt.prepared_only&&!receipt.crawl_started);assert.equal(receipt.production_writes,0);assert.equal(receipt.model_calls,0);assert(!fs.existsSync(output));
});
