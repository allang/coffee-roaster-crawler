'use strict';
// Read-only evidence capture. No importer, crawler, retries, pagination or readiness verdict.
const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),crypto=require('node:crypto');
const ORIGIN='https://gtlipifdfyugiwpxvuse.supabase.co';
const ROOT='/Users/allan/.openclaw/workspace/coffee-roaster-crawler';
const STATE=ROOT+'/.state/my-coffee-explorer/2026-09-26';
const OUTPUT=STATE+'/read-three-positive-source-candidates';
const IDS=Object.freeze(['7647bb3e-6112-4122-9107-c4ed28e23c92','021add58-8882-4132-9916-935471f7a976','ffa52078-e72c-427d-952c-53fa417c3ee1']);
const SOURCES=Object.freeze(['roaster:youngblood-coffee-roasters','roaster:peacock-coffee-roasting-co','roaster:revel-77-coffee']);
const LIMIT=101,MAX_BYTES=1024*1024,TIMEOUT_MS=20000;
const SPECS=Object.freeze([
 Object.freeze({table:'entities',select:'id,name,slug,name_slug,website_url,primary_location,google_place_id',order:'id.asc'}),
 Object.freeze({table:'entity_roles',select:'*',order:'entity_id.asc,role.asc'}),
 Object.freeze({table:'entity_locations',select:'*',order:'entity_id.asc,id.asc'}),
 Object.freeze({table:'entity_attributes',select:'entity_id,attribute_key,attribute_value,source',order:'entity_id.asc'}),
 Object.freeze({table:'entity_source_ids',select:'id,entity_id,source,source_id,source_url,raw_data',order:'id.asc'})
]);
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function fail(code,extra={}){return Object.assign(new Error(code),{code,...extra});}
function must(ok,code){if(!ok)throw fail(code);}
function safeError(e){return{code:/^[a-zA-Z0-9_:-]{1,80}$/.test(e?.code||'')?e.code:'read_failed',...(Number.isInteger(e?.status)?{httpStatus:e.status}:{}),...(/^[A-Z0-9]{1,16}$/.test(e?.dbCode||'')?{databaseCode:e.dbCode}:{})};}
function descriptor(index){must(Number.isInteger(index)&&index>=0&&index<5,'unknown_fixed_descriptor');const s=SPECS[index],u=new URL(ORIGIN+'/rest/v1/'+s.table),q=u.searchParams,list=IDS.join(',');q.set('select',s.select);q.set('limit',String(LIMIT));q.set('order',s.order);
 if(index===0)q.set('id','in.('+list+')');
 else if(index===1||index===2)q.set('entity_id','in.('+list+')');
 else if(index===3){q.set('attribute_key','eq.canonical_roaster_entity_id');q.set('or','(entity_id.in.('+list+'),attribute_value.in.('+list+'))');}
 else q.set('or','(entity_id.in.('+list+'),and(source.eq.my_coffee_explorer,source_id.in.('+SOURCES.join(',')+')))');
 return Object.freeze({index,table:s.table,url:u.href,urlSha256:sha(u.href)});
}
function validateRows(index,rows){must(Array.isArray(rows),'response_not_array');must(rows.length<LIMIT,'row_cap_incomplete');for(const r of rows){must(r&&typeof r==='object'&&!Array.isArray(r),'invalid_row');if(index===0)must(IDS.includes(r.id),'entity_out_of_scope');else if(index===1||index===2)must(IDS.includes(r.entity_id),'entity_child_out_of_scope');else if(index===3)must(r.attribute_key==='canonical_roaster_entity_id'&&(IDS.includes(r.entity_id)||IDS.includes(r.attribute_value)),'canonical_link_out_of_scope');else must(IDS.includes(r.entity_id)||(r.source==='my_coffee_explorer'&&SOURCES.includes(r.source_id)),'source_binding_out_of_scope');}return rows;}
function runtime(env=process.env,cwd=process.cwd(),dir=__dirname,io=fs){must(io.realpathSync(cwd)===ROOT&&io.realpathSync(dir)===ROOT+'/src/myCoffeeExplorerImport','production_location_required');must(io.realpathSync(STATE)===STATE,'state_symlink_refused');let u;try{u=new URL(env.NEXT_PUBLIC_SUPABASE_URL||'');}catch{throw fail('wrong_runtime_origin');}must(u.href===ORIGIN+'/'&&!u.username&&!u.password,'wrong_runtime_origin');const key=env.SUPABASE_SERVICE_ROLE_KEY;must(typeof key==='string'&&key.length>20&&!/[\r\n\s]/.test(key),'credentials_missing_or_invalid');return key;}
// Explicit native HTTPS TLS validation; redirects are errors and are never dispatched.
function requestOnce(index,{key,requestImpl=https.request,timeoutMs=TIMEOUT_MS,onMetadata=()=>{}}){const d=descriptor(index);return new Promise((resolve,reject)=>{let req,res,timer,settled=false,bytes=0;const parts=[];
 const finish=(err,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(err){try{res?.destroy();}catch{}try{req?.destroy();}catch{}reject(err);}else resolve(value);};
 timer=setTimeout(()=>finish(fail('read_timeout')),timeoutMs);
 try{req=requestImpl(d.url,{method:'GET',agent:false,rejectUnauthorized:true,headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json','Accept-Encoding':'identity','User-Agent':'EveryCoffeeReadOnlyIdentityEvidence/1.0'}},response=>{res=response;const status=response.statusCode||0,headers=response.headers||{};const meta={descriptor:index,table:d.table,httpStatus:status,contentType:String(headers['content-type']||'').slice(0,128),contentRange:/^[0-9*\/-]{1,80}$/.test(String(headers['content-range']||''))?headers['content-range']:null};
  try{onMetadata({event:'response_headers',...meta});}catch(e){finish(fail('journal_write_failed'));return;}
  if(status>=300&&status<400){finish(fail('redirect_refused',{status}));return;}
  if(Number(headers['content-length'])>MAX_BYTES){finish(fail('body_cap_exceeded',{status}));return;}
  response.on('error',()=>finish(fail('response_stream_failed',{status})));response.on('aborted',()=>finish(fail('response_stream_aborted',{status})));
  response.on('data',chunk=>{if(settled)return;const b=Buffer.from(chunk);bytes+=b.length;if(bytes>MAX_BYTES){finish(fail('body_cap_exceeded',{status}));return;}parts.push(b);});
  response.on('end',()=>{if(settled)return;try{const body=Buffer.concat(parts),bodySha256=sha(body);let parsed;try{parsed=JSON.parse(body.toString('utf8'));}catch{throw fail(status===200?'invalid_json':'database_http_error',{status});}
   if(status!==200){const dbCode=/^[A-Z0-9]{1,16}$/.test(parsed?.code||'')?parsed.code:undefined;throw fail('database_http_error',{status,dbCode});}
   must(String(headers['content-type']||'').toLowerCase().includes('application/json'),'non_json_response');must(Array.isArray(parsed),'response_not_array');
   const result={...meta,bytes,bodySha256,rows:parsed};onMetadata({event:'response_complete',...meta,bytes,bodySha256,rowCount:parsed.length});finish(null,result);
  }catch(e){finish(e);}});
 });req.on('error',()=>finish(fail('request_failed')));req.end();}catch{finish(fail('request_failed'));}
 });}
function createReader({key,requestImpl=https.request,onEvent=()=>{},timeoutMs=TIMEOUT_MS}={}){must(typeof key==='string'&&key.length>20&&!/[\r\n\s]/.test(key),'credentials_missing_or_invalid');let next=0,active=false,stopped=false;return{get requests(){return next;},async read(index){try{must(!stopped,'read_latched_stop');must(!active,'concurrent_read_refused');must(index===next&&index<5,'fixed_query_order_required');descriptor(index);active=true;next++;onEvent({event:'request_started',descriptor:index,table:SPECS[index].table});const response=await requestOnce(index,{key,requestImpl,timeoutMs,onMetadata:onEvent});must(!stopped,'read_latched_stop');return response;}catch(e){stopped=true;try{onEvent({event:'read_stopped',descriptor:Number.isInteger(index)?index:null,...safeError(e)});}catch{}throw e;}finally{active=false;}}};}
function syncDir(dir,io=fs){const fd=io.openSync(dir,'r');try{io.fsyncSync(fd);}finally{io.closeSync(fd);}}
function writeAll(fd,bytes,io=fs){let offset=0;while(offset<bytes.length){const n=io.writeSync(fd,bytes,offset,bytes.length-offset);must(n>0,'file_write_stalled');offset+=n;}io.fsyncSync(fd);}
function save(file,value,io=fs){const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'),fd=io.openSync(file,'wx',0o600);try{writeAll(fd,bytes,io);}finally{io.closeSync(fd);}syncDir(path.dirname(file),io);return sha(bytes);}
function reserve(io=fs){io.mkdirSync(OUTPUT,{mode:0o700});syncDir(STATE,io);const fd=io.openSync(OUTPUT+'/events.ndjson','wx',0o600);syncDir(OUTPUT,io);let seq=0;return{event(value){writeAll(fd,Buffer.from(JSON.stringify({at:new Date().toISOString(),seq:++seq,...value})+'\n'),io);syncDir(OUTPUT,io);},close(){io.closeSync(fd);}};}
async function capture({reader,event,write=save}={}){const startedAt=new Date().toISOString(),responses=[];try{for(let index=0;index<5;index++){const response=await reader.read(index);const file=String(index+1).padStart(2,'0')+'-'+SPECS[index].table+'.json';const fileSha256=write(OUTPUT+'/'+file,{readOnly:true,validated:false,at:new Date().toISOString(),...response});validateRows(index,response.rows);const range=String(response.contentRange||'').match(/\/(\d+)$/);must(!range||Number(range[1])<=response.rows.length,'reported_total_incomplete');responses.push({descriptor:index,table:SPECS[index].table,file,sha256:fileSha256,rows:response.rows.length});event({event:'response_saved_and_scope_validated',...responses.at(-1)});}
  const result={status:'read_only_evidence_complete_not_identity_approved',startedAt,at:new Date().toISOString(),readOnly:true,requests:reader.requests,responses,identityApproved:false,databasePlanningAllowed:false,databaseMutationAllowed:false,newEntityAbsenceEstablished:false,fullCatalogSnapshot:false,nontransactionalReads:true,notes:['Youngblood source reportedly says closed July2026; evidence capture does not approve active/current status.','Revel source website/product assertions remain disputed; no role, website or product changes are authorized.','Forward/inbound canonical links and source ownership are captured for manual review; this does not follow linked entities or approve a merge.']};event({event:'all_five_reads_complete'});write(OUTPUT+'/result.json',result);return result;
 }catch(e){event({event:'capture_failed',...safeError(e)});write(OUTPUT+'/failed.json',{status:'incomplete_read_only_evidence',at:new Date().toISOString(),startedAt,requests:reader.requests,completedResponses:responses,error:safeError(e),retry:false,resume:false,databasePlanningAllowed:false,databaseMutationAllowed:false});throw e;}}
function cli(args){must(args.length<=1&&(!args.length||['--check','--read'].includes(args[0])),'use_check_or_read_only');return args[0]||'--check';}
async function main(args=process.argv.slice(2)){const mode=cli(args);if(mode==='--check'){const out={mode:'offline_check',owners:3,requestsPlanned:5,descriptors:SPECS.map((_,i)=>descriptor(i)),rowRejectThreshold:LIMIT,maxResponseBytes:MAX_BYTES,deadlineMs:TIMEOUT_MS,concurrency:1,retries:0,output:OUTPUT,networkRequests:0,databaseMutationAllowed:false};console.log(JSON.stringify(out));return out;}
 const key=runtime(),journal=reserve();try{save(OUTPUT+'/reservation.json',{at:new Date().toISOString(),pid:process.pid,helperSha256:sha(fs.readFileSync(__filename)),origin:ORIGIN,entityIds:IDS,sourceKeys:SOURCES,readOnly:true,requests:5,rowRejectThreshold:LIMIT,maxResponseBytes:MAX_BYTES,deadlineMs:TIMEOUT_MS,retries:0,resume:false,sensitivity:'Internal database evidence; response rows may contain source metadata. Authentication is never persisted.'});journal.event({event:'capture_started'});const reader=createReader({key,onEvent:x=>journal.event(x)});const result=await capture({reader,event:x=>journal.event(x)});console.log(JSON.stringify({status:result.status,requests:result.requests,rows:result.responses.map(r=>({table:r.table,count:r.rows})),output:OUTPUT,identityApproved:false}));return result;}finally{journal.close();}}
module.exports={ORIGIN,ROOT,STATE,OUTPUT,IDS,SOURCES,LIMIT,MAX_BYTES,TIMEOUT_MS,SPECS,sha,safeError,descriptor,validateRows,runtime,requestOnce,createReader,writeAll,save,reserve,capture,cli,main};
if(require.main===module)main().catch(e=>{console.error(JSON.stringify(safeError(e)));process.exitCode=1;});
