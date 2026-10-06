'use strict';
// Source-result retention only. No replacement HTTP dispatch, classifier or saver.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{isDeepStrictEqual}=require('node:util');
const RUNNER='./product-only-crawl-availability.cjs';
const PINS={'product-only-crawl-availability.cjs':'6d34367914330b11f485c6573043c9065fa0e804823222a688f400238d3986b6','product-only-network.cjs':'06b85be52fce083ee6d2cdf5631fa21d2ccdc7ae7a2d7e0f22549769e097ad3e','legal-guard.cjs':'26acbcc26a6b24aaf3663b5968b6163e010a3ac323eac4cfe1dd8b5e6a16abfc','product-db-fetch-gate.cjs':'a4a40c8abb95dc0f5528b9cb9c4a574ca80b5989f016af1fa27c83473563f01e','product-availability-isolated.cjs':'b8aeeac3edc3b743ca0b088c63266e441828ac3bfc7bcceee38dca3105c56434'};
const MAX_RECORDS=64,MAX_BODY=2*1024*1024,MAX_TOTAL=32*1024*1024;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),stamp=()=>new Date().toISOString();
function must(v,code){if(!v)throw Object.assign(Error(code),{code});}
function code(e){return String(e?.code||'source_evidence_failure').replace(/[^a-zA-Z0-9_:-]/g,'').slice(0,80);}
function sync(dir,io=fs){const fd=io.openSync(dir,'r');try{io.fsyncSync(fd);}finally{io.closeSync(fd);}}
function save(file,bytes,io=fs){const fd=io.openSync(file,'wx',0o600);try{io.writeFileSync(fd,bytes);io.fsyncSync(fd);}finally{io.closeSync(fd);}sync(path.dirname(file),io);}
function jsonFile(file,data,io=fs){save(file,Buffer.from(JSON.stringify(data,null,2)+'\n'),io);}
function checkPins(){for(const[f,h]of Object.entries(PINS))must(sha(fs.readFileSync(path.join(__dirname,f)))===h,'retention_code_pin:'+f);}
function serialize(kind,data){
 if(kind==='html'){must(typeof data==='string','retention_html_shape');return Buffer.from(data,'utf8');}
 must(kind==='json','retention_kind');const text=JSON.stringify(data);
 // Preserve actual parsed values; never silently turn Infinity/-0/undefined into
 // null/0/omission. The unchanged transport already performed JSON.parse.
 must(typeof text==='string'&&isDeepStrictEqual(JSON.parse(text),data),'retention_json_not_lossless');return Buffer.from(text+'\n','utf8');
}
function createSink({directory,manifestHash,io=fs}){
 must(/^[a-f0-9]{64}$/.test(manifestHash),'retention_manifest_hash');const dir=path.resolve(directory),parent=path.dirname(dir);
 must(io.realpathSync(parent)===parent,'retention_parent_symlink');io.mkdirSync(dir,{mode:0o700});sync(parent,io);
 jsonFile(dir+'/reservation.json',{at:stamp(),manifest_sha256:manifestHash,wrapper_sha256:sha(fs.readFileSync(__filename)),code_pins:PINS,max_records:MAX_RECORDS,max_body_bytes:MAX_BODY,max_total_bytes:MAX_TOTAL,headers_retained:false,images_retained:false,format:{html:'Exact decoded HTML string returned by the unchanged guarded transport, encoded as UTF-8; not compressed/wire-byte evidence.',json:'JSON serialization of the actual already-parsed response value returned by the unchanged guarded transport; not original JSON text or wire bytes.'}},io);
 const fd=io.openSync(dir+'/records.ndjson','wx',0o600);io.fsyncSync(fd);sync(dir,io);let failed=null,closed=false,total=0;const records=[];
 const event=e=>{const bytes=Buffer.from(JSON.stringify({at:stamp(),...e})+'\n');let n=0;while(n<bytes.length){const wrote=io.writeSync(fd,bytes,n,bytes.length-n);must(wrote>0,'retention_journal_stalled');n+=wrote;}io.fsyncSync(fd);};
 return{directory:dir,get count(){return records.length;},get failed(){return failed;},retain(meta,bytes){
  try{must(!closed&&!failed,'retention_sink_stopped');must(Buffer.isBuffer(bytes)&&bytes.length<=MAX_BODY&&records.length<MAX_RECORDS&&total+bytes.length<=MAX_TOTAL,'retention_bound');
   const index=records.length+1,bodyHash=sha(bytes),file=String(index).padStart(3,'0')+'-'+bodyHash.slice(0,16)+(meta.kind==='html'?'.html':'.parsed.json');
   save(dir+'/'+file,bytes,io);const record={...meta,index,file,body_sha256:bodyHash,utf8_bytes:bytes.length,manifest_sha256:manifestHash};
   event({event:'source_response_retained',...record});records.push(record);total+=bytes.length;return record;
  }catch(e){failed ||= code(e);throw e;}
 },finish(runError=null){
  must(!closed,'retention_sink_closed');try{jsonFile(dir+'/result.json',{at:stamp(),status:failed?'evidence_incomplete_requires_review':runError?'retained_evidence_runner_failed':'retained_evidence_only_not_crawl_verification',manifest_sha256:manifestHash,records,total_body_bytes:total,retention_error:failed,runner_error:runError?code(runError):null,header_capture:false,image_capture:false,wire_byte_capture:false,note:'Runner summary/checkpoint and later DB readback remain authoritative for crawl and persistence outcomes. This receipt only covers successful source results durably retained before return; earlier writes are not rolled back if a later response cannot be retained.'},io);}finally{closed=true;io.closeSync(fd);}
 }};
}
function installRetention({network,getSink,allowed,manifestHash}){
 must(network&&typeof network.createTransport==='function'&&typeof getSink==='function'&&Array.isArray(allowed),'retention_install_arguments');
 const original=network.createTransport;let failure=null;const seen=new WeakMap();
 const stop=c=>{failure ||= Object.assign(Error('source_evidence_retention_failed'),{code:'source_evidence_retention_failed'});if(c){c.hardStop ||= failure.code;c.networkErrors ||= [];if(!c.networkErrors.includes(failure.code))c.networkErrors.push(failure.code);}return failure;};
 const wrapped=function(options){
  const transport=original.call(this,options);must(typeof options?.context==='function','retention_context_missing');
  const wrap=kind=>async function(value,...args){const c=options.context();if(failure)throw stop(c);
   // Original transport owns scope, DNS, redirects, auth/legal/challenge checks,
   // pacing and caches. Failed responses and images are never retained here.
   const result=await transport[kind==='html'?'fetchHtml':'fetchJson'].call(transport,value,...args);
   if(failure)throw stop(c);if(!result?.success)return result;
   try{
    must(c&&c===options.context()&&c.target&&typeof c.runId==='string'&&c.runId,'retention_product_context');
    must(allowed.some(a=>a.entity_id===c.target.entity_id&&a.url===c.url&&a.website_url===c.target.website_url),'retention_manifest_owner');
    const requested=network.publicUrl(value),final=network.ownerUrl(result.finalUrl,c.target.website_url),product=network.publicUrl(c.url);
    must(result.status>=200&&result.status<300,'retention_success_status');
    const expected=kind==='html'?product:new URL(product.href);if(kind==='json'){expected.pathname=expected.pathname.replace(/\/$/,'')+'.json';expected.search='';}
    must(requested.href===expected.href,'retention_request_binding');
    const meta={kind,entity_id:c.target.entity_id,claim_id:c.runId,product_url:c.url,requested_url:requested.href,final_url:final.href,status:result.status,captured_at:stamp(),representation:kind==='html'?'decoded_html_utf8':'parsed_json_value',wire_bytes:false};
    const bytes=serialize(kind,result.data),signature=JSON.stringify({...meta,captured_at:null,body_sha256:sha(bytes),manifestHash}),prior=seen.get(result);
    if(prior){must(prior===signature,'retention_cached_result_changed');return result;}
    const sink=getSink();must(sink,'retention_sink_missing');sink.retain(meta,bytes);seen.set(result,signature);return result;
   }catch(e){throw stop(c);}
  };
  return{...transport,fetchHtml:wrap('html'),fetchJson:wrap('json')};
 };
 network.createTransport=wrapped;return{get failure(){return failure;},uninstall(){must(network.createTransport===wrapped,'retention_hook_ownership_lost');network.createTransport=original;}};
}
function cli(args){const o={mode:'check'},seen=new Set();for(let i=0;i<args.length;i++){
 const a=args[i];must(!seen.has(a),'duplicate_argument');seen.add(a);
 if(['--check','--preview','--run'].includes(a)){must(!o.explicitMode,'duplicate_mode');o.mode=a.slice(2);o.explicitMode=true;}
 else if(['--manifest','--output-dir','--crawler-root'].includes(a)){must(args[i+1]&&!args[i+1].startsWith('--'),'missing_argument');o[a.slice(2).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=args[++i];}
 else must(false,'unknown_argument');
 }must(o.manifest,'manifest_required');if(o.mode!=='check')must(o.outputDir,'output_dir_required');return o;}
async function execute(options,{network=require('./product-only-network.cjs'),loadRunner=()=>require(RUNNER),isRunnerLoaded=()=>!!require.cache[require.resolve(RUNNER)]}={}){
 checkPins();must(!isRunnerLoaded(),'availability_runner_already_loaded');let sink,hook,runError;const allowed=[];
 // Hook precedes runner's destructured createTransport import. Loading modules
 // does not create a DB client. Default --check never calls runner.run.
 hook=installRetention({network,getSink:()=>sink,allowed,manifestHash:null});
 try{
  const runner=loadRunner(),loaded=runner.loadManifest(options.manifest);runner.freshManifest(loaded);
  for(const t of loaded.manifest.targets)for(const p of t.products)allowed.push({entity_id:t.entity_id,website_url:t.website_url,url:p.url});
  if(options.mode==='check')return{status:'offline_check_pass',manifest_sha256:loaded.manifestHash,products:loaded.total,code_pins:PINS,website_requests:0,database_requests:0};
  must(['preview','run'].includes(options.mode)&&options.outputDir,'execution_mode');
  const out=path.resolve(options.outputDir),evidence=out+'.source-evidence';
  must([...loaded.evidencePaths].every(p=>p!==out&&!p.startsWith(out+path.sep)&&p!==evidence&&!p.startsWith(evidence+path.sep)),'retention_output_overlaps_input');
  if(options.mode==='run')sink=createSink({directory:evidence,manifestHash:loaded.manifestHash});
  const summary=await runner.run({manifest:options.manifest,outputDir:out,...(options.crawlerRoot?{crawlerRoot:options.crawlerRoot}:{}),run:options.mode==='run',retryFailed:false});
  if(hook.failure)throw hook.failure;return summary;
 }catch(e){runError=e;throw e;}
 finally{try{if(sink)sink.finish(runError);}finally{hook.uninstall();}}
}
async function main(args=process.argv.slice(2)){const result=await execute(cli(args));if(result.status==='offline_check_pass')console.log(JSON.stringify(result));else{console.log(JSON.stringify({mode:result.mode,targetCount:result.targetCount,urlCount:result.urlCount,statuses:result.targets.map(t=>({entity_id:t.entity_id,status:t.status,error:t.error}))}));if(result.targets.some(t=>['held','failed','not_attempted_after_stop'].includes(t.status)))process.exitCode=1;}}
module.exports={PINS,MAX_RECORDS,MAX_BODY,MAX_TOTAL,sha,serialize,checkPins,createSink,installRetention,cli,execute,main};
if(require.main===module)main().catch(e=>{console.error(code(e));process.exitCode=1;});
