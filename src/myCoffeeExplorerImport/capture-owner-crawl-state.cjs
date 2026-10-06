'use strict';
// Read-only runtime evidence for the frozen original536 roster. Never resumes a crawl.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT='/Users/allan/.openclaw/workspace/coffee-roaster-crawler',STATE=ROOT+'/.state/my-coffee-explorer/2026-09-26',ORIGIN='https://gtlipifdfyugiwpxvuse.supabase.co';
const BASE=__dirname===ROOT+'/src/myCoffeeExplorerImport'?STATE:__dirname;
const ROSTER='original-536-crawl-reconciliation.json',ROSTER_SHA='f21d4e9778a8acbf0756b4298f24fed30020d9243eac5a7d5f7efe60186ad488';
const PINS={'snapshot-sequential-v3.cjs':'9bff32ee4385d40792431d1b1f8c1822e2f801db7497064d5f197ba7ccd05daa','product-db-fetch-gate.cjs':'a4a40c8abb95dc0f5528b9cb9c4a574ca80b5989f016af1fa27c83473563f01e'};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,HASH=/^[a-f0-9]{64}$/;
const BATCH=50,PAGE=250,MAX_REQUESTS=1000,MAX_MS=20*60*1000,MAX_SNAPSHOT_AGE=60*60*1000;
const SPECS={
 crawlState:{table:'entity_crawl_state',fields:'entity_id,allow_crawl',key:'entity_id',cap:536},
 products:{table:'products',fields:'id,entity_id,source_url,name,product_type,is_active,created_at,updated_at',key:'id',cap:50000},
 knownPages:{table:'known_pages',fields:'id,entity_id,url,status',key:'id',cap:100000},
 activeClaims:{table:'crawl_runs',fields:'id,entity_id,status,started_at,finished_at,meta',key:'id',cap:5000}
};
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),stamp=()=>new Date().toISOString();
function must(v,code){if(!v)throw Object.assign(Error(code),{code});}
function diag(e){return{code:/^[A-Za-z0-9_:-]{1,100}$/.test(e?.code||'')?e.code:'capture_failed',...(Number.isInteger(e?.http_status)?{http_status:e.http_status}:{}),...(/^[A-Z0-9]{1,16}$/.test(e?.db_code||'')?{db_code:e.db_code}:{})};}
function normalizedUrl(value){try{const u=new URL(value);u.hash='';return u.toString().replace(/\/$/,'');}catch{return null;}}
function identityScope(roster,snapshot){
 must(roster.totals?.owners===536&&Array.isArray(roster.owners)&&roster.owners.length===536,'roster_count');
 const ids=roster.owners.map(r=>r.entity_id).sort();must(new Set(ids).size===536&&ids.every(x=>UUID.test(x)),'roster_ids');
 const entities=new Map(snapshot.entities.map(r=>[r.id,r])),owners=[];
 for(const r of roster.owners){const entity=entities.get(r.entity_id),roles=snapshot.roles.filter(x=>x.entity_id===r.entity_id),canonical=snapshot.canonicalLinks.filter(x=>x.entity_id===r.entity_id||x.attribute_value===r.entity_id),holds=[];
  if(!entity)holds.push('entity_missing');else if(normalizedUrl(entity.website_url)!==normalizedUrl(r.website_url))holds.push('website_changed');
  if(!roles.some(x=>x.role==='roaster'))holds.push('roaster_role_missing');if(canonical.length)holds.push('canonical_relationship_requires_review');
  const expectedSources=r.source_ids.filter(x=>x.source==='my_coffee_explorer');must(expectedSources.length>0,'roster_mce_source_missing');
  const sourceBindings=expectedSources.map(w=>({expected:w,observed:snapshot.sourceIds.filter(x=>x.source===w.source&&x.source_id===w.source_id)}));
  for(const x of sourceBindings)if(x.observed.length!==1||x.observed[0].entity_id!==r.entity_id)holds.push('source_binding_changed:'+x.expected.source_id);
  owners.push({entity_id:r.entity_id,original_website:r.website_url,historical_execution_status:r.executionStatus,entity:entity||null,roles,canonical,sourceBindings,identityHolds:holds});
 }
 return{ids,owners,snapshotAt:snapshot.at,freshUntil:Date.parse(snapshot.at)+MAX_SNAPSHOT_AGE};
}
function loadScope(snapshotDir,snapshotSha,{base=BASE,now=Date.now()}={}){
 must(HASH.test(snapshotSha||''),'snapshot_hash_required');for(const[f,h]of Object.entries(PINS))must(sha(fs.readFileSync(path.join(__dirname,f)))===h,'code_pin');
 const raw=fs.readFileSync(path.join(base,ROSTER));must(sha(raw)===ROSTER_SHA,'roster_pin');const roster=JSON.parse(raw);
 for(const p of roster.inputPins)must(sha(fs.readFileSync(path.join(base,p.file)))===p.sha256,'roster_input_pin');
 const dir=fs.realpathSync(snapshotDir),bytes=fs.readFileSync(path.join(dir,'snapshot.json'));must(sha(bytes)===snapshotSha,'snapshot_pin');
 const snapshot=require('./snapshot-sequential-v3.cjs').loadCompleteSnapshot(dir),scope=identityScope(roster,snapshot);
 must(Number.isFinite(scope.freshUntil)&&now>=Date.parse(snapshot.at)&&now<scope.freshUntil,'snapshot_not_fresh');
 return{...scope,snapshotDir:dir,snapshotSha,rosterSha:ROSTER_SHA,pins:roster.inputPins,rosterPath:path.join(base,ROSTER)};
}
function batches(ids){return Array.from({length:Math.ceil(ids.length/BATCH)},(_,i)=>ids.slice(i*BATCH,(i+1)*BATCH));}
function descriptor(kind,ids,cursor=null,offset=0){
 must(Object.hasOwn(SPECS,kind)&&Array.isArray(ids)&&ids.length>0&&ids.length<=BATCH&&ids.every((id,i)=>UUID.test(id)&&(!i||id>ids[i-1])),'descriptor_scope');
 must(cursor===null||UUID.test(cursor),'cursor');must(Number.isInteger(offset)&&offset>=0&&offset<=BATCH,'offset');
 const s=SPECS[kind],q=new URLSearchParams({select:s.fields,entity_id:'in.('+ids.join(',')+')',order:s.key+'.asc',limit:String(PAGE)});
 if(kind==='crawlState'){must(cursor===null,'state_cursor');if(offset)q.set('offset',String(offset));}else{must(offset===0,'offset_forbidden');if(cursor)q.set('id','gt.'+cursor);}
 if(kind==='activeClaims')q.set('status','eq.running');
 return{kind,ids:[...ids],cursor,offset,url:ORIGIN+'/rest/v1/'+s.table+'?'+q};
}
function validateRows(d,rows){
 const s=SPECS[d.kind];must(Array.isArray(rows)&&rows.length<=PAGE,'row_bound');let prev=d.cursor||'';
 for(const r of rows){must(r&&typeof r==='object'&&!Array.isArray(r)&&Object.keys(r).sort().join(',')===s.fields.split(',').sort().join(','),'selected_fields');
  must(d.ids.includes(r.entity_id)&&UUID.test(r[s.key])&&r[s.key]>prev,'row_owner_or_order');prev=r[s.key];
  if(d.kind==='crawlState')must(r.allow_crawl===null||typeof r.allow_crawl==='boolean','permission_type');
  if(d.kind==='activeClaims')must(r.status==='running'&&(r.meta===null||typeof r.meta==='object'&&!Array.isArray(r.meta)),'active_claim_shape');
 }
 return rows;
}
function createReader({scope,key,delegate=globalThis.fetch.bind(globalThis),event=()=>{},now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=20000,maxBodyBytes=4*1024*1024}){
 let requests=0,stopped=false,active=false,finished=null,current;const began=now();
 const safeEvent=e=>{const out={event:e.event};for(const k of ['sequence','method','path','http_status','bytes','elapsed_ms','stopped','requests'])if(e[k]!==undefined)out[k]=e[k];if(/^[A-Z0-9]{1,16}$/.test(e.db_code||''))out.db_code=e.db_code;event(out);};
 const gate=require('./product-db-fetch-gate.cjs').createDatabaseFetchGate(async(req,init)=>{
  while(finished!==null&&now()-finished<500){must(!stopped&&now()-began<MAX_MS&&now()<scope.freshUntil&&!init.signal.aborted,'dispatch_stopped_or_deadline');await wait(500-(now()-finished));}
  must(!stopped&&now()-began<MAX_MS&&now()<scope.freshUntil&&!init.signal.aborted,'dispatch_stopped_or_deadline');
  must(req.method==='GET'&&req.url===current.url,'exact_get_required');const response=await delegate(req,init);must(response&&!response.redirected&&response.url===req.url,'exact_response_url');return response;
 },{now,wait,timeoutMs,maxBodyBytes,onEvent:safeEvent,onStop:e=>safeEvent({event:'database_stop',...e})});
 return{get requests(){return requests;},async request(kind,ids,cursor=null,offset=0){let admitted=false;try{
  must(!active&&!stopped&&requests<MAX_REQUESTS&&now()-began<MAX_MS&&now()<scope.freshUntil,'reader_stopped_or_bound');
  must(ids.every(id=>scope.ids.includes(id)),'foreign_owner_batch');current=descriptor(kind,ids,cursor,offset);const d=current;active=true;admitted=true;event({event:'read_intent',sequence:++requests,...d});
  const response=await gate.fetch(d.url,{method:'GET',headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json'},redirect:'error'}),text=await response.text();
  must(!stopped&&now()-began<MAX_MS&&now()<scope.freshUntil,'reader_stopped_or_bound');
  const json=/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||'');
  if(![200,206].includes(response.status)){let dbCode;try{dbCode=JSON.parse(text).code;}catch{}
   if(kind==='crawlState'&&cursor===null&&offset===0&&response.status===404&&dbCode==='PGRST205'&&json){event({event:'optional_permission_table_absent',http_status:404,db_code:dbCode,permission_inferred:false});return{absent:true,rows:[]};}
   throw Object.assign(Error('database_http_failure'),{code:'database_http_failure',http_status:response.status,db_code:dbCode});}
  must(json,'content_type');const rows=JSON.parse(text);validateRows(d,rows);
  const m=/^(?:(\d+)-(\d+)|\*)\/(\d+|\*)$/.exec(response.headers.get('content-range')||'');must(m&&(rows.length?Number(m[1])===offset&&Number(m[2])-Number(m[1])+1===rows.length:m[1]===undefined),'content_range');
  if(m[3]!=='*')must(Number(m[3])>=offset+rows.length&&(rows.length>0||Number(m[3])===offset),'range_total');
  event({event:'read_result',sequence:requests,kind,cursor,offset,status:response.status,body_sha256:sha(text),rows});return{absent:false,rows};
 }catch(e){stopped=true;gate.stop('owner_capture_failed');throw e;}finally{if(admitted){finished=now();active=false;}}}};
}
async function capture(scope,reader,{onPage=()=>{}}={}){
 const data={},coverage=[];let permissionTableAbsent=false;
 for(const kind of Object.keys(SPECS)){const all=[],seen=new Set();let absent=false;
  for(const ids of batches(scope.ids)){let cursor=null,offset=0,terminal=false,pages=0;
   while(pages<405){const part=await reader.request(kind,ids,cursor,offset);pages++;
    if(part.absent){must(kind==='crawlState'&&all.length===0&&coverage.every(x=>x.kind!=='crawlState'),'inconsistent_permission_schema');absent=permissionTableAbsent=true;break;}
    const d=descriptor(kind,ids,cursor,offset);validateRows(d,part.rows);
    for(const row of part.rows){const k=row[SPECS[kind].key];must(!seen.has(k),'duplicate_across_pages');seen.add(k);all.push(row);must(all.length<=SPECS[kind].cap,'table_row_cap');}
    await onPage({kind,ids,cursor,offset,rows:part.rows,terminal:part.rows.length===0});
    if(part.rows.length===0){terminal=true;break;}
    if(kind==='crawlState'){must(offset===0&&part.rows.length<=ids.length,'crawl_state_bound');offset=part.rows.length;}else cursor=part.rows.at(-1).id;
   }
   if(absent)break;must(terminal,'page_cap_without_eof');coverage.push({kind,owners:ids,requests:pages,terminal_empty:true});
  }
  data[kind]=all;if(absent)coverage.push({kind,table_absent:true,permission_inferred:false});
 }
 const owners=scope.owners.map(o=>{const products=data.products.filter(r=>r.entity_id===o.entity_id),known=data.knownPages.filter(r=>r.entity_id===o.entity_id),claims=data.activeClaims.filter(r=>r.entity_id===o.entity_id),permission=data.crawlState.find(r=>r.entity_id===o.entity_id)||null;
  const holds=[...o.identityHolds];if(claims.length)holds.push('active_claim_observed');if(permission?.allow_crawl===false)holds.push('crawl_explicitly_disabled');
  const duplicateUrls=[...new Set(products.map(r=>r.source_url).filter(Boolean))].filter(u=>products.filter(r=>r.source_url===u).length>1);
  return{...o,permission,activeClaimIds:claims.map(r=>r.id),observedCounts:{products:products.length,activeCoffeeProducts:products.filter(r=>r.product_type==='coffee'&&r.is_active===true).length,knownPages:known.length,coffeeKnownPages:known.filter(r=>r.status==='coffee').length},duplicateProductSourceUrls:duplicateUrls,coffeeKnownPagesWithoutExactOwnedProduct:known.filter(r=>r.status==='coffee'&&!products.some(p=>p.source_url===r.url)).map(r=>r.id),holds,crawlResumeAuthorized:false};});
 return{version:1,at:stamp(),status:'original_536_runtime_evidence_complete',readOnly:true,writes:0,captureComplete:true,requests:reader.requests,roster_sha256:scope.rosterSha,snapshot_sha256:scope.snapshotSha,snapshot_at:scope.snapshotAt,permissionTableAbsent,coverage,counts:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v.length])),data,owners,nontransactional:true,inventoryComplete:false,dataQualityVerified:false,crawlResumeAuthorized:false,
  limitations:['Identity comes from the pinned completed v3 snapshot; runtime rows are later sequential observations, not one transaction. Legacy crawling may change rows during or after capture.','Only running crawl_runs are captured, at the end of this readback. Historical failures are not changed, and newer completed legacy runs are not inferred from product counts.','Explicit empty keyset continuation completes each selected-owner query, not a public-site inventory or assertion that all expected products exist.','Variants, facts, media and raw metadata are not read. Product presence does not establish successful persistence of all children or factual quality.','Missing optional crawl-state table or per-owner row does not grant permission. Active claims require review; no stale-running reclassification.','Any actual resumption still requires fresh per-owner/source/canonical/claim and URL checks plus runtime coordination; this receipt never authorizes a crawl.']};
}
function sync(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function save(file,value){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}sync(path.dirname(file));}
function recheck(scope){must(sha(fs.readFileSync(scope.rosterPath))===scope.rosterSha&&sha(fs.readFileSync(path.join(scope.snapshotDir,'snapshot.json')))===scope.snapshotSha,'input_changed');}
async function main(args=process.argv.slice(2)){
 if(!args.length){console.log('Offline by default: --check|--read COMPLETE_V3_DIRECTORY SNAPSHOT_SHA256');return;}
 must(args.length===3&&['--check','--read'].includes(args[0]),'cli_scope');const scope=loadScope(args[1],args[2]);
 if(args[0]==='--check'){console.log(JSON.stringify({status:'offline_scope_verified',owners:scope.ids.length,identityHolds:scope.owners.filter(o=>o.identityHolds.length).length,groups:Object.keys(SPECS),ownerBatch:BATCH,pageSize:PAGE,maxRequests:MAX_REQUESTS,minCompletionSpacingMs:500,timeoutMs:20000,requests:0,crawlResumeAuthorized:false}));return;}
 must(fs.realpathSync(process.cwd())===ROOT&&fs.realpathSync(__dirname)===ROOT+'/src/myCoffeeExplorerImport'&&path.dirname(scope.snapshotDir)===STATE,'production_runtime_required');
 must(process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,'')===ORIGIN&&process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','fixed_origin_tls');const key=process.env.SUPABASE_SERVICE_ROLE_KEY;must(typeof key==='string'&&key.length>20&&!/\s/.test(key),'credential_missing');
 const lock=STATE+'/original-536-capture.lock',lockFd=fs.openSync(lock,'wx',0o600),inode=fs.fstatSync(lockFd).ino;let fd,dir;
 try{fs.writeSync(lockFd,JSON.stringify({pid:process.pid,at:stamp(),readOnly:true}));fs.fsyncSync(lockFd);sync(STATE);
  dir=STATE+'/original-536-state-'+crypto.randomUUID();fs.mkdirSync(dir,{mode:0o700});sync(STATE);save(dir+'/reservation.json',{at:stamp(),readOnly:true,helper_sha256:sha(fs.readFileSync(__filename)),code_pins:PINS,roster_sha256:scope.rosterSha,snapshot_sha256:scope.snapshotSha,snapshot_at:scope.snapshotAt,retries:0});
  fd=fs.openSync(dir+'/events.ndjson','wx',0o600);fs.fsyncSync(fd);sync(dir);let journalFailed=false;
  const event=e=>{must(!journalFailed,'journal_latched');try{const buf=Buffer.from(JSON.stringify({at:stamp(),...e})+'\n');let n=0;while(n<buf.length){const written=fs.writeSync(fd,buf,n,buf.length-n);must(written>0,'journal_short_write');n+=written;}fs.fsyncSync(fd);}catch(error){journalFailed=true;throw error;}};
  recheck(scope);const reader=createReader({scope,key,event}),result=await capture(scope,reader);recheck(scope);save(dir+'/result.json',result);console.log(JSON.stringify({status:result.status,directory:dir,requests:result.requests,counts:result.counts,result_sha256:sha(fs.readFileSync(dir+'/result.json')),crawlResumeAuthorized:false}));
 }catch(e){if(dir)try{save(dir+'/failure.json',{at:stamp(),captureComplete:false,writes:0,error:diag(e),note:'Partial journal only; no successful capture, absence or resumption claim.'});}catch{}throw e;}
 finally{if(fd!==undefined)fs.closeSync(fd);fs.closeSync(lockFd);if(fs.existsSync(lock)&&fs.statSync(lock).ino===inode){fs.unlinkSync(lock);sync(STATE);}}
}
module.exports={ROOT,STATE,ORIGIN,ROSTER,ROSTER_SHA,PINS,BATCH,PAGE,MAX_REQUESTS,MAX_MS,MAX_SNAPSHOT_AGE,SPECS,sha,diag,identityScope,loadScope,batches,descriptor,validateRows,createReader,capture,save,recheck,main};
if(require.main===module)main().catch(e=>{console.error(JSON.stringify(diag(e)));process.exitCode=1;});
