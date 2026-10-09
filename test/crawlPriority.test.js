'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {prioritizeRoasters}=require('../src/crawlPriority');
const {buildCrawlPhases,crawlTierPhases}=require('../src/crawlTierPlan');
const row=(id,tier,time=null)=>({id,roaster_tier:tier,last_crawl_attempt_at:time});

test('never-attempted roasters and oldest attempts lead every tier and the remaining group',async()=>{
  const roasters=[row('rest-new',null,'2026-10-08T00:00:00Z'),row('one-new',1,'2026-10-08T00:00:00Z'),row('rest-old',null,'2026-06-01T00:00:00Z'),row('two-new',2,'2026-10-08T00:00:00Z'),row('one-untouched',1),row('rest-untouched',null),row('one-old',1,'2026-06-01T00:00:00Z'),row('two-untouched',2)];
  const ordered=prioritizeRoasters(roasters),phases=buildCrawlPhases(ordered);
  assert.deepEqual(phases.map(p=>p.roasters.map(r=>r.id)),[['one-untouched','one-old','one-new'],['two-untouched','two-new'],['rest-untouched','rest-old','rest-new']]);
  const starts=[];await crawlTierPhases(ordered,{limit:fn=>fn(),crawl:async r=>{starts.push(r.id);return {success:true};}});
  assert.deepEqual(starts,phases.flatMap(p=>p.roasters.map(r=>r.id)));
  assert.equal(roasters[0].id,'rest-new','Sorting must not mutate input');
});
test('stable ID ties and timestamp offsets give the same ordering after restart',()=>{
  const input=[row('z',1),row('b',1,'2026-10-08T02:00:00-04:00'),row('a',1,'2026-10-08T06:00:00Z'),row('y',1)];
  assert.deepEqual(prioritizeRoasters(input).map(r=>r.id),['y','z','a','b']);
  assert.deepEqual(prioritizeRoasters([...input].reverse()).map(r=>r.id),['y','z','a','b']);
});
test('invalid attempt timestamps stop priority selection',()=>{
  assert.throws(()=>prioritizeRoasters([row('bad',1,'not-a-date')]),/Invalid last crawl attempt/);
});
