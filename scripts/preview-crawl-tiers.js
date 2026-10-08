#!/usr/bin/env node
'use strict';
// Reads the same catalog and eligibility controls as startup; never crawls or writes.
const fs=require('node:fs');
const {getRoasterEntities,filterRoastersForCrawling}=require('../src/roasters');
const {buildCrawlPhases,manifest}=require('../src/crawlTierPlan');
async function main() {
  const roasters=await getRoasterEntities(),eligible=await filterRoastersForCrawling(roasters);
  const phases=buildCrawlPhases(eligible).map(p=>({tier:p.tier,label:p.label,count:p.roasters.length,roasters:[...p.roasters].sort((a,b)=>a.id.localeCompare(b.id)).map(r=>({id:r.id,name:r.name,tier_source:r.crawl_tier_source}))}));
  const tierOne=phases.find(p=>p.tier===1)?.roasters || [],tierOneIds=new Set(tierOne.map(r=>r.id));
  const report={checked_at:new Date().toISOString(),mode:'read-only-crawl-order-preview',source_commit:manifest.source_commit,total_roasters:roasters.length,eligible_roasters:eligible.length,production_writes:0,phases:phases.map(({roasters,...phase})=>phase),tier_one_roasters:tierOne,
    reviewed_tier_one_ids:manifest.entity_counts['1'],currently_ineligible_reviewed_tier_one:manifest.assignments.filter(r=>r.tier===1 && !tierOneIds.has(r.entity_id)),preface_in_tier_one:tierOneIds.has('fee5aaa2-09c2-4bde-949d-16471a91793c')};
  if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({...report,tier_one_roasters:undefined},null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
