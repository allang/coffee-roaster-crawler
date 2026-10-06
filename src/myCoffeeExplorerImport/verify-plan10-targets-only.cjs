'use strict';
// Targeted-only readback: no global counts, no database mutation, no inferred totals.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {pinnedOrigin,readOnlyClient,targetedRows,verifyAction,validatePlan,writeOutputs}=require('./verify-reviewed-plan.cjs');
const {installLegalGuard}=require('./legal-guard.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');let phase='local';
async function main(){
 const base=fs.realpathSync(process.argv[2]),dir=path.join(base,'reviewed-public-brands-10'),planBytes=fs.readFileSync(path.join(dir,'plan.json')),beforeBytes=fs.readFileSync(path.join(base,'continuation-8/snapshot.json'));
 assert.equal(sha(planBytes),'3bfc871e2457cf2a4c7f7f3f8e6ce47dd58851f1e5cf2f713667da9b35f44aab');assert.equal(sha(beforeBytes),'c835229bf8c2abbdfcc812f6a9c841b4e6fd8e3c3eb03b8b62474964bb9a3e99');
 const plan=JSON.parse(planBytes),before=JSON.parse(beforeBytes);validatePlan(plan,before);assert.equal(plan.actions.length,12);assert(plan.actions.every(a=>a.action==='create'));pinnedOrigin(process.env);
 assert(!fs.existsSync(path.join(dir,'verification.json'))&&!fs.existsSync(path.join(dir,'verification.targets.ndjson')));
 const guard=installLegalGuard({internalDataOrigin:'https://gtlipifdfyugiwpxvuse.supabase.co'});
 try{
  process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';const db=readOnlyClient(require('/Users/allan/.openclaw/workspace/coffee-roaster-crawler/src/supabase.js').getSupabase()),ids=plan.actions.map(a=>a.entity_id),sourceIds=plan.actions.flatMap(a=>a.sources.map(s=>s.source_id)),data={};
  for(const [key,table,column,values,source]of [['entities','entities','id',ids],['roles','entity_roles','entity_id',ids],['locations','entity_locations','entity_id',ids],['sources','entity_source_ids','entity_id',ids],['sourceOwners','entity_source_ids','source_id',sourceIds,'my_coffee_explorer']]){
   phase=key;data[key]=await targetedRows(db,table,column,values,source);console.log(JSON.stringify({read:key,count:data[key].length}));
  }
  phase='validation';const targets=[],preservation=[],failures=[];
  for(const a of plan.actions){const r=verifyAction(a,data,before);if(r.missing.length)failures.push({id:a.entity_id,name:a.entity.name,missing:r.missing});else{preservation.push(r.preservation);if(r.target)targets.push(r.target);}}
  assert.deepEqual(failures,[]);assert.equal(preservation.length,12);assert.equal(targets.length,12);
  const targetBody=targets.map(JSON.stringify).join('\n')+'\n',result={at:new Date().toISOString(),planHash:plan.planHash,verified:12,expected:12,failures,unresolved:0,counts:null,globalCountsStatus:'not_queried_target_only_verification',crawlTargets:12,targetsSha256:sha(targetBody),method:'Five sequential bounded reads of exact planned IDs/source keys, full source-payload equality and before-snapshot preservation. No global HEAD count queries or inferred catalog totals.',readOnly:true,targetedReadBounds:{maxActions:12,idsPerBatch:25,pageSize:200,maxRowsPerBatch:5000},preservation,inputReceipts:{planSha256:sha(planBytes),beforeSnapshotSha256:sha(beforeBytes),beforeSnapshotAt:before.at}};
  assert(fs.readFileSync(path.join(dir,'plan.json')).equals(planBytes));writeOutputs(dir,{result,targets,targetBody});console.log(JSON.stringify(result));
 }finally{guard.uninstall();}
}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({phase,code:e.code||null,message:e.message||null}));process.exitCode=1;});
