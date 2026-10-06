'use strict';
// Explicit user-requested retry. Reuse the frozen read-only transport without
// changing its original evidence, request scope, timeouts, caps, or retry policy.
const fs=require('node:fs'),path=require('node:path');
const h=require('./read-three-positive-source-candidates.cjs');
const PIN='bb82b717b9ac4df2e967ef91c40b8f72be54469852e14587632302b48dee1d19';
const OUTPUT=h.STATE+'/user-retry-positive-source-20260927-0707';
function remap(file){
  if(path.dirname(file)!==h.OUTPUT||!/^((0[1-5]-(entities|entity_roles|entity_locations|entity_attributes|entity_source_ids))|result|failed)\.json$/.test(path.basename(file)))throw Object.assign(Error('output_scope_changed'),{code:'output_scope_changed'});
  return OUTPUT+'/'+path.basename(file);
}
async function main(args=process.argv.slice(2)){
  const mode=h.cli(args);
  if(h.sha(fs.readFileSync(path.join(__dirname,'read-three-positive-source-candidates.cjs')))!==PIN)throw Object.assign(Error('transport_changed'),{code:'transport_changed'});
  if(mode==='--check'){console.log(JSON.stringify({mode,output:OUTPUT,transportSha256:PIN,networkRequests:0,maximumReadRequests:5,databaseWrites:0}));return;}
  const key=h.runtime();
  fs.mkdirSync(OUTPUT,{mode:0o700});
  const fd=fs.openSync(OUTPUT+'/events.ndjson','wx',0o600);
  let seq=0;
  const event=value=>h.writeAll(fd,Buffer.from(JSON.stringify({at:new Date().toISOString(),seq:++seq,...value})+'\n'));
  try{
    h.save(OUTPUT+'/reservation.json',{at:new Date().toISOString(),pid:process.pid,requestedByUser:'Try now.',transportSha256:PIN,wrapperSha256:h.sha(fs.readFileSync(__filename)),maximumReadRequests:5,databaseWrites:0,automaticRetries:0,priorEvidencePreserved:true});
    const reader=h.createReader({key,onEvent:event});
    const result=await h.capture({reader,event,write:(file,value)=>h.save(remap(file),value)});
    console.log(JSON.stringify({status:result.status,requests:result.requests,rows:result.responses.map(r=>({table:r.table,count:r.rows})),output:OUTPUT,identityApproved:false,databaseWrites:0}));
  }finally{fs.closeSync(fd);}
}
module.exports={OUTPUT,remap,main};
if(require.main===module)main().catch(e=>{console.error(JSON.stringify(h.safeError(e)));process.exitCode=1;});
