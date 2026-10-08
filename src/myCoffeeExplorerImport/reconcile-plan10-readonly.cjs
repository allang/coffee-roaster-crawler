'use strict';
// One bounded sequential read of the attempted plan's exact IDs; no global scan or writes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {checkPlan}=require('./import.cjs'),{pinnedOrigin,readOnlyClient,targetedRows,verifyAction}=require('./verify-reviewed-plan.cjs'),{installLegalGuard}=require('./legal-guard.cjs');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
async function main(){
 const base=fs.realpathSync(process.argv[2]),file=path.join(base,'reviewed-public-brands-10/plan.json'),bytes=fs.readFileSync(file),plan=JSON.parse(bytes);
 assert.equal(sha(bytes),'3bfc871e2457cf2a4c7f7f3f8e6ce47dd58851f1e5cf2f713667da9b35f44aab');checkPlan(plan);assert.equal(plan.actions.length,12);pinnedOrigin(process.env);
 const dest=path.join(base,'reviewed-public-brands-10/partial-reconciliation.json');assert(!fs.existsSync(dest));
 const guard=installLegalGuard({internalDataOrigin:'https://gtlipifdfyugiwpxvuse.supabase.co'});
 try{
  process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';const db=readOnlyClient(require('/Users/allan/.openclaw/workspace/coffee-roaster-crawler/src/supabase.js').getSupabase()),ids=plan.actions.map(a=>a.entity_id),sources=plan.actions.flatMap(a=>a.sources.map(s=>s.source_id)),data={},startedAt=new Date().toISOString();
  for(const [key,table,column,values,source]of [['entities','entities','id',ids],['roles','entity_roles','entity_id',ids],['locations','entity_locations','entity_id',ids],['sources','entity_source_ids','entity_id',ids],['sourceOwners','entity_source_ids','source_id',sources,'my_coffee_explorer']]){
   data[key]=await targetedRows(db,table,column,values,source);console.log(JSON.stringify({read:key,count:data[key].length}));
  }
  const result={at:new Date().toISOString(),startedAt,readOnly:true,planHash:plan.planHash,planSha256:sha(bytes),databaseWrites:0,results:plan.actions.map(a=>({entity_id:a.entity_id,name:a.entity.name,...verifyAction(a,data,null)})),data};
  fs.writeFileSync(dest,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({complete:result.results.filter(r=>!r.missing.length).length,incomplete:result.results.filter(r=>r.missing.length).map(r=>({name:r.name,missing:r.missing})),receipt:dest}));
 }finally{guard.uninstall();}
}
if(require.main===module)main().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
