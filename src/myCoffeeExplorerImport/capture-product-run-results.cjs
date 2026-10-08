'use strict';
// Offline by default. Usage: --check|--capture MANIFEST SHA SUMMARY SHA CHECKPOINT SHA.
// Reads only terminally reported IDs; never starts/resumes a crawl or changes data.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT='/Users/allan/.openclaw/workspace/coffee-roaster-crawler',STATE=ROOT+'/.state/my-coffee-explorer/2026-09-26';
const ORIGIN='https://gtlipifdfyugiwpxvuse.supabase.co',GATE_SHA='a4a40c8abb95dc0f5528b9cb9c4a574ca80b5989f016af1fa27c83473563f01e';
const MAX_ROWS=500,MAX_REQUESTS=10,MAX_MS=300000,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,HASH=/^[a-f0-9]{64}$/;
const TABLES={products:'products',variants:'product_variants',facts:'coffee_facts',knownPages:'known_pages',claims:'crawl_runs'};
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),stamp=()=>new Date().toISOString(),pair=(id,url)=>id+'\n'+url;
function must(v,code){if(!v)throw Object.assign(Error(code),{code});}
function terminalScope(manifest,summary,checkpoint,manifestHash){
 must(HASH.test(manifestHash)&&manifest.scope==='observed_product_urls_only'&&manifest.database_origin===ORIGIN&&manifest.inventory_complete===false,'manifest_scope');
 must(Array.isArray(manifest.targets)&&manifest.targets.length>0&&manifest.targets.length<=20,'target_bound');
 const owners=new Set(),urls=new Map();
 for(const t of manifest.targets){must(UUID.test(t.entity_id)&&!owners.has(t.entity_id)&&Array.isArray(t.products)&&t.products.length>0,'manifest_owner');owners.add(t.entity_id);
  for(const p of t.products){let u;try{u=new URL(p.url);}catch{}must(u&&u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&!u.search&&u.href===p.url,'manifest_url');const k=pair(t.entity_id,p.url);must(!urls.has(k),'duplicate_url');urls.set(k,{entity_id:t.entity_id,url:p.url});}}
 must(urls.size<=60,'url_bound');
 must(summary.scope===manifest.scope&&checkpoint.scope===manifest.scope&&summary.manifestHash===manifestHash&&checkpoint.manifestHash===manifestHash,'terminal_manifest');
 must(summary.mode==='run'&&summary.inventory_complete===false&&summary.targetCount===owners.size&&summary.urlCount===urls.size&&Array.isArray(summary.targets)&&summary.targets.length===owners.size,'terminal_shape');
 must(Number.isFinite(Date.parse(summary.startedAt))&&Number.isFinite(Date.parse(summary.finishedAt))&&Date.parse(summary.finishedAt)>=Date.parse(summary.startedAt),'terminal_time');
 must(checkpoint.results&&typeof checkpoint.results==='object'&&!Array.isArray(checkpoint.results)&&checkpoint.claims&&typeof checkpoint.claims==='object'&&!Array.isArray(checkpoint.claims),'checkpoint_shape');
 const cp=Object.values(checkpoint.results),seenOwners=new Set(),seenUrls=new Set(),products=[],claims=[],outcomes=[];
 must(cp.length<=urls.size,'checkpoint_bound');
 for(const t of summary.targets){must(owners.has(t.entity_id)&&!seenOwners.has(t.entity_id)&&['complete','failed','held','no_eligible_urls','not_attempted_after_stop'].includes(t.status)&&Array.isArray(t.results),'terminal_owner');seenOwners.add(t.entity_id);
  for(const r of t.results){const k=pair(t.entity_id,r.url);must(urls.has(k)&&!seenUrls.has(k),'terminal_url');seenUrls.add(k);
   // Fresh-run readback deliberately does not accept known/resumed page results.
   must(['complete','failed','not_attempted_after_stop'].includes(r.status),'fresh_result_status');
   const rows=cp.filter(c=>c.entityId===t.entity_id&&c.url===r.url);
   if(r.status==='not_attempted_after_stop')must(rows.length===0&&!r.productId,'unattempted_result');
   else{must(rows.length===1,'checkpoint_result_missing_or_duplicate');const c=rows[0];must(c.status===r.status&&(c.productId||null)===(r.productId||null)&&(c.isCoffee===true)===(r.isCoffee===true),'checkpoint_result_conflict');
    must(checkpoint.claims[t.entity_id]?.runId,'claim_missing');
    if(r.productId){must(UUID.test(r.productId)&&!products.some(p=>p.id===r.productId),'product_id');
     const proofs=[r.productProof,c.productProof].filter(Boolean);must(proofs.length>0,'product_proof_missing');for(const proof of proofs)must(proof.productId===r.productId&&proof.entity_id===t.entity_id&&proof.source_url===r.url,'product_proof_conflict');
     products.push({id:r.productId,entity_id:t.entity_id,url:r.url,reported_status:r.status});
    }else must(!(r.status==='complete'&&r.isCoffee===true),'coffee_id_missing');
   }
   outcomes.push({entity_id:t.entity_id,url:r.url,status:r.status,productId:r.productId||null,isCoffee:r.isCoffee===true,partialPersistence:!!r.partialPersistence});
  }
  const remaining=[...urls.values()].filter(p=>p.entity_id===t.entity_id&&!seenUrls.has(pair(p.entity_id,p.url)));
  must(!remaining.length||['held','failed','no_eligible_urls','not_attempted_after_stop'].includes(t.status),'terminal_url_coverage');
  for(const p of remaining)outcomes.push({...p,status:'not_reported_owner_'+t.status,productId:null});
 }
 for(const c of cp)must(urls.has(pair(c.entityId,c.url))&&seenUrls.has(pair(c.entityId,c.url)),'extra_checkpoint_result');
 for(const[entity_id,c]of Object.entries(checkpoint.claims)){must(owners.has(entity_id)&&UUID.test(c.runId)&&!claims.some(x=>x.id===c.runId)&&['complete','failed','running'].includes(c.status),'checkpoint_claim');claims.push({id:c.runId,entity_id,checkpoint_status:c.status});}
 return{manifestHash,owners:[...owners],urls:[...urls.values()],products,claims,outcomes,finishedAt:summary.finishedAt,globalStop:summary.globalStop||null};
}
function loadScope(args){must(args.length===6,'input_arguments');must(sha(fs.readFileSync(path.join(__dirname,'product-db-fetch-gate.cjs')))===GATE_SHA,'gate_pin');const data=[],pins=[];
 for(let i=0;i<6;i+=2){must(HASH.test(args[i+1]),'input_hash');const file=fs.realpathSync(args[i]),raw=fs.readFileSync(file);must(raw.length<=8*1024*1024&&sha(raw)===args[i+1],'input_pin');data.push(JSON.parse(raw));pins.push({file,sha256:args[i+1]});}
 must(path.dirname(pins[1].file)===path.dirname(pins[2].file),'terminal_directory');return{...terminalScope(...data,pins[0].sha256),pins,runDirectory:path.dirname(pins[1].file)};
}
function descriptor(kind,s,offset=0){must(Object.hasOwn(TABLES,kind)&&Number.isInteger(offset)&&offset>=0&&offset<=MAX_ROWS,'read_descriptor');const q=new URLSearchParams({select:'*',limit:String(offset?1:MAX_ROWS+1),order:kind==='facts'?'product_id.asc':'id.asc'}),ids=s.products.map(p=>p.id);let count;
 if(kind==='products'){count=ids.length;q.set('id','in.('+ids.join(',')+')');}
 else if(kind==='variants'||kind==='facts'){count=ids.length;q.set('product_id','in.('+ids.join(',')+')');}
 else if(kind==='claims'){count=s.claims.length;q.set('id','in.('+s.claims.map(c=>c.id).join(',')+')');}
 else{count=s.urls.length;const quote=v=>'"'+v.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';q.set('or','('+s.urls.map(p=>'and(entity_id.eq.'+p.entity_id+',url.eq.'+quote(p.url)+')').join(',')+')');}
 must(count>0,'empty_id_scope');if(offset)q.set('offset',String(offset));return{kind,offset,url:ORIGIN+'/rest/v1/'+TABLES[kind]+'?'+q};
}
function validateRows(kind,rows,s){const seen=new Set();for(const r of rows){must(r&&typeof r==='object'&&!Array.isArray(r),'row_shape');let id;
 if(kind==='products'){const p=s.products.find(p=>p.id===r.id);must(p&&r.entity_id===p.entity_id&&r.source_url===p.url,'product_owner_source');id=r.id;}
 else if(kind==='variants'||kind==='facts'){must(s.products.some(p=>p.id===r.product_id),'child_owner');id=kind==='facts'?r.product_id:r.id;must(UUID.test(id),'child_id');}
 else if(kind==='claims'){must(s.claims.some(c=>c.id===r.id&&c.entity_id===r.entity_id),'claim_owner');id=r.id;}
 else{must(UUID.test(r.id)&&s.urls.some(p=>p.entity_id===r.entity_id&&p.url===r.url),'known_page_owner_url');id=pair(r.entity_id,r.url);}
 must(!seen.has(id),'duplicate_row');seen.add(id);
 }}
function createReader({scope,key,delegate=globalThis.fetch.bind(globalThis),event=()=>{},now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=20000,maxBodyBytes=4*1024*1024}){
 let count=0,stopped=false,busy=false,finished=null;const began=now();const{createDatabaseFetchGate}=require('./product-db-fetch-gate.cjs');
 const gate=createDatabaseFetchGate(async(request,init)=>{while(finished!==null&&now()-finished<500){must(!stopped&&now()-began<MAX_MS&&!init.signal.aborted,'read_deadline');await wait(500-(now()-finished));}must(!stopped&&now()-began<MAX_MS&&!init.signal.aborted,'read_deadline');must(request.method==='GET'&&new URL(request.url).origin===ORIGIN,'read_only_origin');const response=await delegate(request,init);must(response&&!response.redirected&&response.url===request.url,'exact_response_url');return response;},{now,wait,timeoutMs,maxBodyBytes,onEvent:event,onStop:e=>event({event:'read_gate_stopped',...e})});
 return{get requests(){return count;},async request(kind,offset=0){try{must(!busy&&!stopped&&count<MAX_REQUESTS&&now()-began<MAX_MS,'read_bound_or_stopped');busy=true;const d=descriptor(kind,scope,offset);event({event:'read_intent',sequence:++count,...d});const response=await gate.fetch(d.url,{method:'GET',headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json'},redirect:'error'});must([200,206].includes(response.status),'database_http_'+response.status);must(/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||''),'content_type');const rows=JSON.parse(await response.text());must(Array.isArray(rows)&&rows.length<=MAX_ROWS&&(!offset||rows.length<=1),'row_bound');const m=/^(?:(\d+)-(\d+)|\*)\/(\d+|\*)$/.exec(response.headers.get('content-range')||'');must(m&&(rows.length?Number(m[1])===offset&&Number(m[2])-Number(m[1])+1===rows.length:m[1]===undefined),'content_range');if(m[3]!=='*')must(Number(m[3])<=MAX_ROWS&&Number(m[3])>=offset+rows.length&&(rows.length>0||Number(m[3])===offset),'content_range_total');event({event:'read_result',sequence:count,kind,offset,rows});return rows;
 }catch(e){stopped=true;gate.stop('result_capture_failed');throw e;}finally{finished=now();busy=false;}}};
}
async function capture(scope,reader){const data={},coverage=[];for(const kind of Object.keys(TABLES)){if((['products','variants','facts'].includes(kind)&&!scope.products.length)||(kind==='claims'&&!scope.claims.length)){data[kind]=[];coverage.push({kind,skipped_empty_scope:true});continue;}const rows=await reader.request(kind);validateRows(kind,rows,scope);if(rows.length)must((await reader.request(kind,rows.length)).length===0,'nonempty_eof');data[kind]=rows;coverage.push({kind,rows:rows.length,explicit_empty_observed:true});}
 return{version:1,at:stamp(),status:'exact_product_run_rows_captured',readOnly:true,writes:0,requests:reader.requests,captureComplete:true,dataQualityVerified:false,newlyCreatedIndependentlyVerified:false,inventoryComplete:false,nontransactional:true,sourcePins:scope.pins,sourceFinishedAt:scope.finishedAt,manifestHash:scope.manifestHash,globalStop:scope.globalStop,reportedProducts:scope.products,reportedClaims:scope.claims,outcomes:scope.outcomes,coverage,counts:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v.length])),data,
 findings:{missingReportedProductIds:scope.products.filter(p=>!data.products.some(r=>r.id===p.id)).map(p=>p.id),missingFactProductIds:scope.products.filter(p=>!data.facts.some(r=>r.product_id===p.id)).map(p=>p.id),missingVariantProductIds:scope.products.filter(p=>!data.variants.some(r=>r.product_id===p.id)).map(p=>p.id),missingKnownPages:scope.outcomes.filter(p=>p.status==='complete'&&!data.knownPages.some(r=>r.entity_id===p.entity_id&&r.url===p.url)).map(p=>({entity_id:p.entity_id,url:p.url})),claimIssues:scope.claims.filter(c=>{const r=data.claims.find(r=>r.id===c.id);return !r||r.status!==(c.checkpoint_status==='complete'?'completed':c.checkpoint_status)||!['completed','failed'].includes(r.status)||!r.finished_at||r.meta?.manifest_sha256!==scope.manifestHash||r.meta?.scope!=='observed_product_urls_only';}).map(c=>c.id)},
 limitations:['Only reported product IDs are read: a failed URL without an ID may have unreturned partial products; absence is not established.','Exact owner/source and child-ID membership are checked, not price, weight, stock, classification, creation time or inventory completeness.','Sequential nontransactional readback may observe concurrent changes. Retained source comparison and any correction require separate review.']};
}
function sync(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function save(file,value){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync(path.dirname(file));}
function recheck(s){for(const p of s.pins)must(sha(fs.readFileSync(p.file))===p.sha256,'input_changed');must(!fs.existsSync(path.join(s.runDirectory,'runner.lock')),'runner_still_locked');}
async function main(args=process.argv.slice(2)){if(!args.length){console.log('Offline only. Usage: --check|--capture MANIFEST SHA SUMMARY SHA CHECKPOINT SHA');return;}must(['--check','--capture'].includes(args[0]),'cli_mode');const scope=loadScope(args.slice(1));recheck(scope);if(args[0]==='--check'){console.log(JSON.stringify({status:'offline_scope_verified',products:scope.products.length,claims:scope.claims.length,urls:scope.urls.length,requests:0}));return;}
 must(fs.realpathSync(process.cwd())===ROOT&&fs.realpathSync(__dirname)===ROOT+'/src/myCoffeeExplorerImport','production_runtime');must(scope.pins.every(p=>p.file.startsWith(STATE+'/')),'production_input_location');must(process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,'')===ORIGIN&&process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','production_origin_tls');const key=process.env.SUPABASE_SERVICE_ROLE_KEY;must(typeof key==='string'&&key.length>20,'credential_missing');const dir=path.join(STATE,'product-run-readback-'+crypto.randomUUID());fs.mkdirSync(dir,{mode:0o700});sync(STATE);save(dir+'/reservation.json',{at:stamp(),readOnly:true,helper_sha256:sha(fs.readFileSync(__filename)),gate_sha256:GATE_SHA,sourcePins:scope.pins,reportedProducts:scope.products,reportedClaims:scope.claims,retries:0});let fd,failed=false;
 try{fd=fs.openSync(dir+'/events.ndjson','wx',0o600);fs.fsyncSync(fd);sync(dir);const event=e=>{must(!failed,'journal_failed');try{const raw=Buffer.from(JSON.stringify({at:stamp(),...e})+'\n');let n=0;while(n<raw.length){const size=fs.writeSync(fd,raw,n,raw.length-n);must(size>0,'journal_short_write');n+=size;}fs.fsyncSync(fd);}catch(e){failed=true;throw e;}};recheck(scope);const result=await capture(scope,createReader({scope,key,event}));recheck(scope);save(dir+'/result.json',result);console.log(JSON.stringify({status:result.status,directory:dir,counts:result.counts,findings:result.findings}));
 }catch(e){try{save(dir+'/failure.json',{at:stamp(),captureComplete:false,readOnly:true,writes:0,code:/^[A-Za-z0-9_:-]{1,90}$/.test(e.code||'')?e.code:'capture_failed',note:'Partial journal rows only. No completed capture or absence claim.'});}catch{}throw e;}finally{if(fd!==undefined)fs.closeSync(fd);}}
module.exports={ORIGIN,ROOT,STATE,GATE_SHA,MAX_ROWS,MAX_REQUESTS,MAX_MS,sha,terminalScope,loadScope,descriptor,validateRows,createReader,capture,save,recheck,main};
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({code:/^[A-Za-z0-9_:-]{1,90}$/.test(e.code||'')?e.code:'capture_failed'}));process.exitCode=1;});
