#!/usr/bin/env node
'use strict';
// Reads the same catalog and eligibility controls as startup; never crawls or writes.
const fs=require('node:fs');
const {getRoasterEntities,filterRoastersForCrawling}=require('../src/roasters');
const {buildCrawlPhases,manifest}=require('../src/crawlTierPlan');
async function main() {
  const roasters=await getRoasterEntities(),eligible=await filterRoastersForCrawling(roasters);
  const phases=buildCrawlPhases(eligible).map(p=>({tier:p.tier,label:p.label,count:p.roasters.length,roasters:p.roasters.map(r=>({id:r.id,name:r.name,tier_source:r.crawl_tier_source}))}));
  const report={checked_at:new Date().toISOString(),mode:'read-only-crawl-order-preview',source_commit:manifest.source_commit,total_roasters:roasters.length,eligible_roasters:eligible.length,production_writes:0,phases};
  if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({...report,phases:phases.map(({roasters,...phase})=>phase)},null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
