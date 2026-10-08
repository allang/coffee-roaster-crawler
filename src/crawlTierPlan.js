'use strict';
const manifest=require('../data/crawl-tier-assignments.json');
const TIER_ORDER=Object.freeze([1,2,3,4,9]);
function validTier(value){return TIER_ORDER.includes(value)?value:null;}
function reviewedAssignments() {
  const assignments=new Map(),counts=Object.fromEntries(TIER_ORDER.map(t=>[t,0]));
  for(const row of manifest.assignments){
    if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.entity_id) || validTier(row.tier)==null || assignments.has(row.entity_id))throw Error('Invalid or duplicate reviewed crawl tier assignment');
    assignments.set(row.entity_id,row.tier);counts[row.tier]++;
  }
  for(const tier of TIER_ORDER)if(counts[tier]!==manifest.entity_counts[tier])throw Error('Reviewed crawl tier count mismatch');
  return assignments;
}
const reviewed=reviewedAssignments();
function fallbackTier(entityId){return reviewed.get(entityId) ?? null;}
function buildCrawlPhases(roasters) {
  const groups=new Map([...TIER_ORDER,null].map(t=>[t,[]]));
  for(const roaster of roasters)groups.get(validTier(roaster.roaster_tier)).push(roaster);
  return [...groups].filter(([,rows])=>rows.length).map(([tier,rows])=>({tier,label:tier==null?'Remaining roasters':'Tier '+tier,roasters:rows}));
}
// A phase barrier includes its bounded unreachable-site retry. Concurrency is
// allowed within a tier; the next tier cannot overlap unfinished earlier work.
async function crawlTierPhases(roasters,{crawl,limit,onPhaseStart=()=>{},onPhaseComplete=()=>{},onRetry=()=>{}}) {
  const results=[],phases=[];let retriedSites=0;
  for(const phase of buildCrawlPhases(roasters)){
    await onPhaseStart(phase);
    const first=await Promise.all(phase.roasters.map(roaster=>limit(()=>crawl(roaster)))),retry=[];
    const phaseResults=[];
    first.forEach((result,index)=>{if(result.retryable)retry.push(phase.roasters[index]);else phaseResults.push(result);});
    if(retry.length){
      retriedSites+=retry.length;await onRetry({...phase,retryCount:retry.length});
      const second=await Promise.all(retry.map(roaster=>limit(()=>crawl(roaster))));
      phaseResults.push(...second.map(result=>result.retryable?{...result,success:false,error:'Website unreachable after retry'}:result));
    }
    const summary={tier:phase.tier,label:phase.label,total:phase.roasters.length,successful:phaseResults.filter(r=>r.success).length,failed:phaseResults.filter(r=>!r.success).length,retried:retry.length};
    results.push(...phaseResults);phases.push(summary);await onPhaseComplete(summary);
  }
  return {results,phases,retriedSites};
}
module.exports={TIER_ORDER,validTier,fallbackTier,buildCrawlPhases,crawlTierPhases,manifest};
