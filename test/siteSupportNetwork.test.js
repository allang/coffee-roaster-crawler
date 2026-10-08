'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createReader}=require('../src/siteSupport/network');
const url='https://merchant.test/products/coffee',epoch=Date.parse('2026-10-08T14:00:00Z');

function fixture(steps,{profile={hosts:['merchant.test']},sleepHook,lookupHook,...options}={}) {
  let clock=epoch;
  const calls=[],lookups=[],sleeps=[],cancelled=[];
  const response=(status,headers={},body='Coffee page')=>{
    const result=new Response(body,{status,headers});
    const cancel=result.body.cancel.bind(result.body);
    result.body.cancel=async()=>{cancelled.push(status);await cancel();};
    return result;
  };
  const reader=createReader(profile,{
    ...options,
    now:()=>clock,
    sleep:async milliseconds=>{sleeps.push(milliseconds);clock+=milliseconds;if(sleepHook)await sleepHook(milliseconds,profile);},
    lookup:async(host,settings)=>{lookups.push({host,settings});return lookupHook?lookupHook(lookups.length,host):[{address:'8.8.8.8',family:4}];},
    fetch:async(value,settings)=>{
      calls.push({url:value.href,settings,at:clock});
      const step=steps[calls.length-1];
      assert(step,'Unexpected merchant request');
      if(typeof step==='function')return step({clock,advance:ms=>{clock+=ms;},response,settings});
      return response(step.status,step.headers,step.body);
    },
  });
  return {reader,calls,lookups,sleeps,cancelled,advance:ms=>{clock+=ms;},now:()=>clock};
}

test('429 then 200 actually retries the guarded GET after two seconds and records both statuses',async()=>{
  const f=fixture([{status:429},{status:200,headers:{'x-wp-total':'12','x-wp-totalpages':'2'},body:'Recovered coffee page'}]);
  const result=await f.reader.fetchHtml(url);
  assert.equal(result.success,true);assert.equal(result.status,200);assert.equal(result.data,'Recovered coffee page');
  assert.equal(result.finalUrl,url);assert.equal(result.catalogTotal,12);assert.equal(result.catalogPages,2);
  assert.equal(result.attempts,2);assert.equal(result.retries,1);
  assert.deepEqual(f.sleeps,[2000]);assert.deepEqual(f.calls.map(call=>call.at-epoch),[0,2000]);
  assert.deepEqual(f.reader.requests.map(request=>request.status),[429,200]);
  assert.deepEqual(f.reader.requests.map(request=>request.retry),[0,1]);
  assert.deepEqual(f.reader.requests.map(request=>request.attempt),[1,2]);
  assert.equal(f.reader.requests[0].retryDelayMs,2000);assert.equal(f.lookups.length,2);assert.deepEqual(f.cancelled,[429]);
  for(const call of f.calls){assert.equal(call.url,url);assert.equal(call.settings.method,'GET');assert.equal(call.settings.redirect,'manual');assert(call.settings.signal instanceof AbortSignal);}
});

test('normal crawl resumes a 123-second merchant cooldown and reduces later request pressure',async()=>{
  const f=fixture([{status:503,headers:{'retry-after':'123'}},{status:200},{status:200}],{resumeCooldowns:true});
  const first=await f.reader.fetchHtml(url),second=await f.reader.fetchHtml(url+'.json');
  assert(first.success&&second.success);assert.equal(first.cooldownResumptions,1);
  assert.deepEqual(f.sleeps,[123000,2000]);assert.equal(f.calls[1].at-epoch,123000);assert.equal(f.calls[2].at-f.calls[1].at,2000);
  assert.equal(f.reader.requests[0].retryAfter,'123');assert.equal(f.reader.returnedErrors.length,0);
  assert.equal(f.reader.cooldownEvents[0].requestSpacingMs,2000);
});

test('queued native reads get their own bounded read budget after a resumed merchant wait',async()=>{
  const f=fixture([{status:503,headers:{'retry-after':'123'}},{status:200},{status:200}],{resumeCooldowns:true});
  const [html,native]=await Promise.all([f.reader.fetchHtml(url),f.reader.fetchHtml(url+'.json')]);
  assert(html.success&&native.success);assert.deepEqual(f.calls.map(c=>c.url),[url,url,url+'.json']);
  assert.equal(f.calls[1].at-epoch,123000);assert.equal(f.calls[2].at-f.calls[1].at,2000);
});

test('long cooldown waits share the five-minute cap across the entire merchant reader',async()=>{
  const f=fixture([{status:503,headers:{'retry-after':'200'}},{status:503,headers:{'retry-after':'200'}}],{resumeCooldowns:true});
  const r=await f.reader.fetchHtml(url);
  assert.equal(r.success,false);assert.equal(r.merchantCooldownExceeded,true);
  assert.equal(r.cooldownRecovery.stopped,'total_wait_limit');assert.equal(r.cooldownRecovery.waitedMs,200000);
  assert.deepEqual(f.sleeps,[200000]);assert.equal(f.calls.length,2);assert.equal(f.reader.returnedErrors.length,1);
  assert.equal(f.reader.getCooldownFailure().error,'HTTP 503');
  const following=await f.reader.fetchHtml(url+'/next');assert.equal(following.merchantCooldownExceeded,true);
  assert.equal(f.calls.length,2);
});

test('long cooldown resumptions are capped at three even when the wait budget remains',async()=>{
  const f=fixture(Array.from({length:4},()=>({status:503,headers:{'retry-after':'31'}})),{resumeCooldowns:true});
  const r=await f.reader.fetchHtml(url);
  assert.equal(r.merchantCooldownExceeded,true);assert.equal(r.cooldownRecovery.stopped,'resumption_limit');
  assert.deepEqual(f.sleeps,[31000,31000,31000]);assert.equal(f.calls.length,4);
  assert.deepEqual(f.reader.cooldownEvents.map(e=>e.requestSpacingMs),[2000,4000,5000]);
});

test('cooldown resumption rechecks destination and DNS without sending an unsafe request',async()=>{
  const f=fixture([{status:503,headers:{'retry-after':'123'}}],{resumeCooldowns:true,lookupHook:n=>[{address:n===1?'8.8.8.8':'127.0.0.1',family:4}]});
  const r=await f.reader.fetchHtml(url);assert.equal(r.success,false);assert.match(r.error,/Nonpublic DNS/);
  assert.equal(f.calls.length,1);assert.equal(f.lookups.length,2);assert.deepEqual(f.sleeps,[123000]);
});

test('ordinary exhausted retries without a long Retry-After keep the original attempt bound',async()=>{
  const f=fixture(Array.from({length:4},()=>({status:503})),{resumeCooldowns:true});
  const r=await f.reader.fetchHtml(url);assert.equal(r.success,false);assert.equal(r.retryStopped,'retry_limit');
  assert.equal(f.calls.length,4);assert.equal(f.reader.cooldownEvents.length,0);assert.equal(r.merchantCooldownExceeded,undefined);
});

test('503 retries stop after four failed attempts with bounded exponential waits and final failure',async()=>{
  const f=fixture(Array.from({length:5},()=>({status:503})));
  const result=await f.reader.fetchHtml(url);
  assert.equal(result.success,false);assert.equal(result.status,503);assert.equal(result.error,'HTTP 503');
  assert.equal(result.attempts,4);assert.equal(result.retries,3);assert.equal(result.retryStopped,'retry_limit');
  assert.deepEqual(f.sleeps,[2000,4000,8000]);assert.equal(f.now()-epoch,14000);
  assert.deepEqual(f.reader.requests.map(request=>request.status),[503,503,503,503]);
  assert.equal(f.reader.requests.at(-1).retryStopped,'retry_limit');assert.equal(f.reader.requests.at(-1).retryDelayMs,15000);
  assert.equal(f.calls.length,4);assert.equal(f.lookups.length,4);assert.deepEqual(f.cancelled,[503,503,503,503]);
});

for(const status of [502,504])test(`transient gateway HTTP ${status} recovers with bounded GET retry`,async()=>{
  const f=fixture([{status},{status:200}]);const result=await f.reader.fetchHtml(url);
  assert.equal(result.success,true);assert.deepEqual(f.reader.requests.map(request=>request.status),[status,200]);assert.deepEqual(f.sleeps,[2000]);
});

for(const status of [400,401,403,404,410,500])test(`HTTP ${status} remains terminal without speculative retries`,async()=>{
  const f=fixture([{status},{status:200}]);const result=await f.reader.fetchHtml(url);
  assert.equal(result.success,false);assert.equal(result.status,status);assert.equal(result.error,'HTTP '+status);
  assert.equal(result.attempts,1);assert.equal(result.retries,0);assert.equal(f.calls.length,1);assert.deepEqual(f.sleeps,[]);
});

for(const header of ['7',new Date(epoch+7000).toUTCString()])test(`Retry-After ${header} is fully honored before retry`,async()=>{
  const f=fixture([{status:429,headers:{'retry-after':header}},{status:200}]);const result=await f.reader.fetchHtml(url);
  assert.equal(result.success,true);assert.deepEqual(f.sleeps,[7000]);assert.equal(f.reader.requests[0].retryAfterMs,7000);assert.equal(f.calls[1].at-epoch,7000);
});

for(const header of ['0','invalid-date','-1','99999999999999999999999'])test(`invalid, expired or zero Retry-After ${header} retains minimum backoff`,async()=>{
  const f=fixture([{status:503,headers:{'retry-after':header}},{status:200}]);const result=await f.reader.fetchHtml(url);
  assert.equal(result.success,true);assert.deepEqual(f.sleeps,[2000]);assert.equal(f.calls.length,2);
});

test('excessive Retry-After stops this read and subsequent pages cannot fetch early',async()=>{
  const f=fixture([{status:429,headers:{'retry-after':'120'}},{status:200}]);
  const first=await f.reader.fetchHtml(url);
  assert.equal(first.success,false);assert.equal(first.status,429);assert.equal(first.retryStopped,'retry_after_limit');
  assert.equal(f.reader.requests[0].retryAfterMs,120000);assert.equal(f.calls.length,1);assert.deepEqual(f.sleeps,[]);
  const second=await f.reader.fetchHtml(url+'-second');
  assert.equal(second.success,false);assert.equal(second.status,undefined);assert.equal(second.attempts,0);assert.equal(second.retryStopped,'time_limit');
  assert.equal(f.calls.length,1);assert.deepEqual(f.sleeps,[]);
  f.advance(100000);
  const third=await f.reader.fetchHtml(url+'-third');
  assert.equal(third.success,true);assert.deepEqual(f.sleeps,[20000]);assert.equal(f.calls[1].at-epoch,120000);
});

test('an exhausted Retry-After cooldown persists to the following page and clears only after success',async()=>{
  const f=fixture([{status:429,headers:{'retry-after':'20'}},{status:200},{status:200}],{maxRetries:0});
  const first=await f.reader.fetchHtml(url);assert.equal(first.success,false);assert.equal(first.retryStopped,'retry_limit');
  const second=await f.reader.fetchHtml(url+'-second');assert.equal(second.success,true);assert.deepEqual(f.sleeps,[20000]);
  await f.reader.fetchHtml(url+'-third');assert.deepEqual(f.sleeps,[20000,500]);
  assert.deepEqual(f.calls.map(call=>call.at-epoch),[0,20000,20500]);
});

test('repeated failed pages inherit host cooldown instead of restarting a rapid failure cascade',async()=>{
  const f=fixture([{status:429},{status:503},{status:200}],{maxRetries:0});
  assert.equal((await f.reader.fetchHtml(url)).success,false);
  assert.equal((await f.reader.fetchHtml(url+'-second')).success,false);
  assert.equal((await f.reader.fetchHtml(url+'-third')).success,true);
  assert.deepEqual(f.sleeps,[2000,4000]);assert.deepEqual(f.calls.map(call=>call.at-epoch),[0,2000,6000]);
});

test('queued concurrent pages observe the first throttle before dispatch',async()=>{
  const f=fixture([{status:429,headers:{'retry-after':'10'}},{status:200}],{maxRetries:0});
  const [first,second]=await Promise.all([f.reader.fetchHtml(url),f.reader.fetchHtml(url+'-second')]);
  assert.equal(first.success,false);assert.equal(second.success,true);assert.deepEqual(f.sleeps,[10000]);assert.equal(f.calls[1].at-epoch,10000);
});

test('elapsed budget includes response time and cooldown and prevents an extra attempt',async()=>{
  const f=fixture([({advance,response})=>{advance(3000);return response(503);},{status:503},{status:200}],{maxElapsedMs:7000});
  const result=await f.reader.fetchHtml(url);
  assert.equal(result.success,false);assert.equal(result.status,503);assert.equal(result.retryStopped,'time_limit');
  assert.equal(f.calls.length,2);assert.deepEqual(f.sleeps,[2000]);assert.equal(f.now()-epoch,5000);
});

test('a late response cannot be reported successful after the elapsed budget',async()=>{
  const f=fixture([({advance,response})=>{advance(5001);return response(200);}],{maxElapsedMs:5000});
  const result=await f.reader.fetchHtml(url);
  assert.equal(result.success,false);assert.equal(result.status,200);assert.equal(result.retryStopped,'time_limit');assert.equal(f.calls.length,1);assert.deepEqual(f.cancelled,[200]);
});

test('three retries and sixty-second elapsed cap remain hard bounds even when configured higher',async()=>{
  const f=fixture(Array.from({length:6},()=>({status:429,headers:{'retry-after':'30'}})),{maxRetries:100,maxElapsedMs:120000});
  const result=await f.reader.fetchHtml(url);
  assert.equal(result.success,false);assert.equal(result.status,429);assert.equal(result.retryStopped,'time_limit');
  assert.equal(f.calls.length,2);assert.deepEqual(f.sleeps,[30000]);assert.equal(f.now()-epoch,30000);
});

test('retry allowance is shared across redirects and cannot restart for a new path',async()=>{
  const f=fixture([{status:503},{status:302,headers:{location:'/products/coffee-new'}},{status:503},{status:503},{status:503},{status:200}]);
  const result=await f.reader.fetchHtml(url);
  assert.equal(result.success,false);assert.equal(result.status,503);assert.equal(result.retryStopped,'retry_limit');
  assert.equal(result.attempts,5);assert.equal(result.retries,3);
  assert.deepEqual(f.reader.requests.map(request=>request.status),[503,302,503,503,503]);
  assert.equal(f.calls.at(-1).url,'https://merchant.test/products/coffee-new');assert.equal(f.lookups.length,5);
});

for(const suffix of ['/terms','/%74erms','/%2574erms','/checkout','/accounts/login'])test(`prohibited initial destination ${suffix} is rejected before DNS, sleep or fetch`,async()=>{
  const f=fixture([{status:200}]);const result=await f.reader.fetchHtml('https://merchant.test'+suffix);
  assert.equal(result.success,false);assert.match(result.error,/Prohibited/);assert.equal(f.calls.length,0);assert.equal(f.lookups.length,0);assert.equal(f.reader.requests.length,0);assert.deepEqual(f.sleeps,[]);
});

for(const location of ['/terms','/%2574erms','https://other.test/products/coffee'])test(`prohibited or unverified redirect ${location} after a retry remains unfetched`,async()=>{
  const f=fixture([{status:429},{status:302,headers:{location}},{status:200}]);const result=await f.reader.fetchHtml(url);
  assert.equal(result.success,false);assert.match(result.error,/Prohibited|Unverified/);
  assert.deepEqual(f.reader.requests.map(request=>request.status),[429,302]);assert.equal(f.calls.length,2);assert(f.calls.every(call=>call.url===url));assert.equal(f.lookups.length,2);
});

test('path allowlist is revalidated after cooldown before a retry is fetched',async()=>{
  const profile={hosts:['merchant.test'],host_path_prefixes:{'merchant.test':'/products/'}};
  const f=fixture([{status:429},{status:200}],{profile,sleepHook:()=>{profile.host_path_prefixes['merchant.test']='/reviewed-other-path/';}});
  const result=await f.reader.fetchHtml(url);assert.equal(result.success,false);assert.match(result.error,/Unverified catalog path/);assert.equal(f.calls.length,1);assert.equal(f.lookups.length,1);
});

test('DNS is checked again after retry wait and a newly private address is never fetched',async()=>{
  const f=fixture([{status:429},{status:200}],{lookupHook:count=>[{address:count===1?'8.8.8.8':'127.0.0.1',family:4}]});
  const result=await f.reader.fetchHtml(url);assert.equal(result.success,false);assert.match(result.error,/Nonpublic DNS/);assert.equal(f.lookups.length,2);assert.equal(f.calls.length,1);assert.deepEqual(f.reader.requests.map(request=>request.status),[429]);
});

test('redirect to an allowed hostname still checks public DNS before fetching it',async()=>{
  const profile={hosts:['merchant.test','auxiliary.test']};
  const f=fixture([{status:302,headers:{location:'https://auxiliary.test/products/coffee'}},{status:200}],{profile,lookupHook:(_,host)=>[{address:host==='merchant.test'?'8.8.8.8':'10.0.0.2',family:4}]});
  const result=await f.reader.fetchHtml(url);assert.equal(result.success,false);assert.match(result.error,/Nonpublic DNS/);assert.equal(f.calls.length,1);assert.equal(f.lookups.length,2);
});

test('reader retains bounded response bodies and marks an oversized 200 response as a failure',async()=>{
  const f=fixture([{status:200,body:'Too many response bytes'}],{maxBytes:3});const result=await f.reader.fetchHtml(url);
  assert.equal(result.success,false);assert.equal(result.status,200);assert.match(result.error,/Response too large/);assert.equal(f.calls.length,1);assert.equal(f.reader.requests[0].status,200);assert.match(f.reader.requests[0].error,/Response too large/);
});

for(const phase of ['DNS','fetch','body'])test(`timeout bounds an unresponsive ${phase} without reporting success or inventing requests`,async()=>{
  // AbortSignal.timeout uses an unreferenced timer; keep this short offline
  // test alive until the deadline, then clean up the fake stream if needed.
  const keepAlive=setTimeout(()=>{},1000);let bodyController;
  try {
    const pending=()=>new Promise(()=>{});
    const steps=[phase==='fetch'?pending:phase==='body'?()=>new Response(new ReadableStream({start(controller){bodyController=controller;}})):{status:200}];
    const f=fixture(steps,{timeoutMs:10,...(phase==='DNS'?{lookupHook:pending}:{})});
    const started=Date.now(),result=await f.reader.fetchHtml(url);
    assert.equal(result.success,false);assert.match(result.error,/timeout|aborted/i);assert(Date.now()-started<500);
    assert.equal(f.calls.length,phase==='DNS'?0:1);assert.equal(f.reader.requests.length,phase==='DNS'?0:1);
    if(phase==='body'){assert.equal(result.status,200);assert.equal(f.reader.requests[0].status,200);}
    else assert.equal(result.status,undefined);
    assert.deepEqual(f.sleeps,[]);
  }finally{if(bodyController)bodyController.error(new Error('Offline fixture cleanup'));clearTimeout(keepAlive);}
});

test('reader never forwards arbitrary caller credentials or headers during retries',async()=>{
  const f=fixture([{status:503},{status:200}]);await f.reader.fetchHtml(url,{headers:{authorization:'secret',cookie:'secret'},credentials:'include'});
  for(const call of f.calls){assert.equal(call.settings.headers.authorization,undefined);assert.equal(call.settings.headers.cookie,undefined);assert.equal(call.settings.credentials,undefined);assert.equal(call.settings.headers.accept,'text/html,application/json');}
});

test('Imweb referer validation occurs before any request and is retained during recovery',async()=>{
  const profile={hosts:['merchant.test'],adapter:'imweb',product_api_path:'/ajax/get_product'};
  const blocked=fixture([{status:200}],{profile});const invalid=await blocked.reader.fetchHtml('https://merchant.test/ajax/get_product',{referer:'https://merchant.test/terms'});
  assert.equal(invalid.success,false);assert.match(invalid.error,/Prohibited/);assert.equal(blocked.calls.length,0);assert.equal(blocked.reader.requests.length,0);
  const f=fixture([{status:429},{status:200}],{profile});const result=await f.reader.fetchHtml('https://merchant.test/ajax/get_product',{referer:'https://merchant.test/shop_view?idx=1'});
  assert.equal(result.success,true);for(const call of f.calls){assert.equal(call.settings.headers['x-requested-with'],'XMLHttpRequest');assert.equal(call.settings.headers.referer,'https://merchant.test/shop_view?idx=1');}
});
