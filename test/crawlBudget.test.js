'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module');
const budget=require('../src/crawlBudget');
test('batch and roaster limits default to the approved 60/10 minutes and cannot be disabled or raised',()=>{
 assert.deepEqual(budget.limits({}),{batchMs:3600000,roasterMs:600000});
 for(const env of [{CRAWLER_BATCH_TIMEOUT_MS:'0'},{CRAWLER_BATCH_TIMEOUT_MS:'3600001'},{CRAWLER_ROASTER_TIMEOUT_MS:'600001'}])assert.throws(()=>budget.limits(env),/Invalid/);
});
test('nested merchant work observes the earlier batch deadline and aborts outstanding work before new calls',async t=>{
 const alive=setInterval(()=>{},10);t.after(()=>clearInterval(alive));let started=0;
 await assert.rejects(budget.withBudget('batch',80,()=>budget.withBudget('roaster',1000,async()=>{started++;await budget.wait(500);started++;})),e=>e.code==='CRAWL_BUDGET_EXCEEDED');
 assert.equal(started,1);assert.equal(budget.expired(),false);
});
test('actual HTTP client propagates the merchant deadline and makes no retry after cancellation',async t=>{
 const alive=setInterval(()=>{},10);t.after(()=>clearInterval(alive));let requests=0;
 const file=path.join(__dirname,'../src/httpClient.js'),real=createRequire(file),module={exports:{}};
 const axios={get:async(_,options)=>{requests++;assert(options.signal);return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));}};
 vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(file,'utf8')}\n})`,{filename:file})(n=>n==='axios'?axios:real(n),module,module.exports);
 await assert.rejects(budget.withBudget('roaster',80,()=>module.exports.fetchHtml('https://merchant.test/products/coffee')),e=>e.code==='CRAWL_BUDGET_EXCEEDED');
 assert.equal(requests,1);
});
test('Supabase requests use the active deadline through the configured custom fetch, without replaying a write',async t=>{
 const alive=setInterval(()=>{},10);t.after(()=>clearInterval(alive));let requests=0;
 t.mock.method(globalThis,'fetch',async(_,options)=>{requests++;assert(options.signal);return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));});
 const client=require('@supabase/supabase-js').createClient('https://catalog.test','offline-fixture-key',{global:{fetch:budget.boundedFetch}});
 const result=await budget.withBudget('roaster',80,()=>client.from('crawl_runs').update({status:'failed'}).eq('id','fixture'));
 assert(result.error);assert.equal(requests,1);
});
