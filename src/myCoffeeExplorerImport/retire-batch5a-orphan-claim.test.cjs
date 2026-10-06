'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const h=require('./retire-batch5a-orphan-claim.cjs');
const at='2026-09-27T09:05:00.000Z';
function fixture(changes={}){
  const calls=[],events=[];let stopChecks=0;
  const request=async(kind,patch)=>{calls.push(kind);if(changes[kind])return changes[kind](patch);
    return kind==='otherRuns'?[]:kind==='before'?[structuredClone(h.EXPECTED)]:[{...structuredClone(h.EXPECTED),...h.patchFor(h.EXPECTED,at)}];};
  return{calls,events,options:{request,record:(...x)=>events.push(x),assertStopped:()=>{stopChecks++;},now:()=>at},stops:()=>stopChecks};
}
test('default plan is failed/incomplete and preserves original claim provenance',()=>{
  const p=h.patchFor(structuredClone(h.EXPECTED),at);assert.equal(p.status,'failed');assert.equal(p.pages_visited,1);assert.equal(p.coffees_found,0);
  assert.equal(p.meta.manifest_sha256,h.EXPECTED.meta.manifest_sha256);assert.equal(p.meta.inventory_complete,false);
  assert.equal(p.meta.reconciliation.original_page_finished_at,'2026-09-27T02:16:35.722Z');
});
test('changed current row is not patched',()=>assert.throws(()=>h.patchFor({...h.EXPECTED,status:'completed'},at),/claim_changed/));
test('exact compare-and-set contains every captured column',()=>{
  const p=h.patchFor(h.EXPECTED,at),d=h.requestFor('patch',p),u=new URL(d.url);assert.equal(u.origin,h.ORIGIN);assert.equal(d.method,'PATCH');
  for(const key of Object.keys(h.EXPECTED))assert(u.searchParams.has(key));
  assert.equal(u.searchParams.get('finished_at'),'is.null');assert.deepEqual(d.body,p);
  assert.throws(()=>h.requestFor('patch',{...p,status:'completed'}),/patch_scope_changed/);
});
test('preview cannot mutate',async()=>{const f=fixture();const r=await h.execute({...f.options,mode:'preview'});assert.equal(r.writes,0);assert.deepEqual(f.calls,['before','otherRuns']);});
test('apply verifies exact returned and readback row',async()=>{const f=fixture();const r=await h.execute({...f.options,mode:'apply'});assert.equal(r.writes,1);assert.equal(r.queue_restarted,false);assert.equal(f.stops(),2);assert.deepEqual(f.calls,['before','otherRuns','patch','after']);});
test('another active owner run blocks before mutation',async()=>{const f=fixture({otherRuns:()=>[{id:'new'}]});await assert.rejects(h.execute({...f.options,mode:'apply'}),/another_owner_run_active/);assert(!f.calls.includes('patch'));});
test('CAS no-match is not retried',async()=>{const f=fixture({patch:()=>[]});await assert.rejects(h.execute({...f.options,mode:'apply'}),/cas_result_not_exact/);assert.deepEqual(f.calls,['before','otherRuns','patch']);});
test('readback failure is not retried or marked complete',async()=>{const f=fixture({after:()=>[]});await assert.rejects(h.execute({...f.options,mode:'apply'}),/readback_mismatch/);assert.equal(f.calls.filter(x=>x==='patch').length,1);});
test('worker reappearing blocks mutation',async()=>{const f=fixture();let n=0;await assert.rejects(h.execute({...f.options,mode:'apply',assertStopped:()=>{if(++n===2)throw Error('worker_live');}}),/worker_live/);assert(!f.calls.includes('patch'));});
