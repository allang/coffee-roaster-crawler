'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildCrawlPhases,crawlTierPhases,fallbackTier,manifest}=require('../src/crawlTierPlan');
const row=(id,tier)=>({id,name:id,roaster_tier:tier});
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
test('all manual tiers precede unassigned/invalid tiers; Preface is in the verified tier-one ledger',()=>{
  const phases=buildCrawlPhases([row('remaining',null),row('nine',9),row('one',1),row('two',2),row('invalid',5),row('four',4),row('three',3)]);
  assert.deepEqual(phases.map(p=>p.tier),[1,2,3,4,9,null]);assert.deepEqual(phases.at(-1).roasters.map(r=>r.id),['remaining','invalid']);
  assert.equal(fallbackTier('fee5aaa2-09c2-4bde-949d-16471a91793c'),1);assert.equal(fallbackTier('11a426df-0146-4a5c-a123-ef7725c13926'),1);assert.equal(fallbackTier('not-listed'),null);
  assert.equal(fallbackTier('2442b266-fb8c-43f6-a7e5-589c6bf94bc5'),null); // Wisconsin Luna is a different brand
  assert.equal(fallbackTier('4e4926f4-fdab-4e69-b28a-0f067b2b6720'),null); // German Passenger is a different brand
  assert.equal(manifest.entity_counts['1'],70);assert.equal(manifest.entity_counts['2'],32);
  assert.equal(fallbackTier('7d74081f-e742-4158-ada6-c67dcd7430f9'),2);assert.equal(fallbackTier('23bca0e3-978f-430c-a307-ec815a1a42ae'),2);
  assert.equal(manifest.assignments.length,529);assert.equal(manifest.source_commit,'2c8733cdc6aa1abd866b4df5df766f75b6f855f5');
});
test('parallel work stays within a tier until its final crawl finishes',async()=>{
  const limit=(await import('p-limit')).default(2),blocked=deferred(),started=deferred(),events=[];
  const running=crawlTierPhases([row('rest',null),row('tier2',2),row('slow1',1),row('fast1',1),row('tier9',9)],{limit,crawl:async r=>{
    events.push('start:'+r.id);if(r.id==='slow1'){started.resolve();await blocked.promise;}events.push('end:'+r.id);return {success:true,roasterName:r.name};
  }});
  await started.promise;assert(!events.includes('start:tier2'));assert(!events.includes('start:rest'));
  blocked.resolve();const result=await running;
  assert(events.indexOf('start:tier2')>events.indexOf('end:slow1'));assert(events.indexOf('start:rest')>events.indexOf('end:tier9'));assert.deepEqual(result.phases.map(p=>p.tier),[1,2,9,null]);
});
test('unreachable retries finish within their tier before lower tiers start',async()=>{
  const limit=(await import('p-limit')).default(2),blocked=deferred(),retryStarted=deferred(),calls=[],attempts=new Map();
  const running=crawlTierPhases([row('tier2',2),row('tier1',1)],{limit,crawl:async r=>{
    const n=(attempts.get(r.id)||0)+1;attempts.set(r.id,n);calls.push(r.id+':'+n);
    if(r.id==='tier1' && n===1)return {success:false,retryable:true};
    if(r.id==='tier1'){retryStarted.resolve();await blocked.promise;}return {success:true};
  }});
  await retryStarted.promise;assert.deepEqual(calls,['tier1:1','tier1:2']);blocked.resolve();const result=await running;
  assert.deepEqual(calls,['tier1:1','tier1:2','tier2:1']);assert.equal(result.retriedSites,1);assert.equal(result.phases[0].successful,1);
});
test('repeated unreachable results are bounded and reported before the remaining phase',async()=>{
  const calls=[],result=await crawlTierPhases([row('rest',null),row('down',1)],{limit:fn=>fn(),crawl:async r=>{calls.push(r.id);return r.id==='down'?{success:false,retryable:true}:{success:true};}});
  assert.deepEqual(calls,['down','down','rest']);assert.equal(result.phases[0].failed,1);assert.equal(result.retriedSites,1);assert.equal(result.results[0].error,'Website unreachable after retry');
});
