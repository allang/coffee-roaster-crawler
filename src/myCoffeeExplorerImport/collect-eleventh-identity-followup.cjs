'use strict';
// Separate one-shot, explicit observed identity pages only. No DB/product crawler.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {createTransport,ownerUrl,publicUrl}=require('./product-only-network.cjs');
const {installLegalGuard}=require('./legal-guard.cjs');
const {installQuerylessGuard,saveExclusive,openRequestAudit,syncDirectory,decode}=require('./plan8-product-link-discovery.cjs');
const {capture,latchedEvents}=require('./collect-tenth-sites.cjs');
const {identity}=require('./validate-sites.cjs');
const BASE=__dirname,TAG='eleventh-identity-followup',MANIFEST_FILE='eleventh-identity-followup.manifest.json';
const MANIFEST_SHA256='a3fd2e9e0abe81535dc2ff27b18257dd93d1267636613ad840a93001c9a4f588';
const LIMITS=Object.freeze({maxOwners:3,maxPages:3,pagesPerOwner:1,concurrency:1,requestTimeoutMs:20000,maxHtmlBytes:1048576,maxRedirects:5,retries:0});
const HELPER_PINS=Object.freeze({
 ...require('./collect-tenth-sites.cjs').HELPER_PINS,
 'collect-tenth-sites.cjs':'1e0979428ffa97f0290c9637b116eacc30d0de9eb21bc13d042534c7e4fe75f5',
 'collect-tenth-identity-followup.cjs':'1d0510de0790aad4f5fc28e58353538ec2cd4a3da4b10765fed562bf132d4bce'
});
const REVIEW_PINS=Object.freeze({
 'eleventh-public-review-a.json':'584ad5eb0e02b4037c75ab12d9094f377377abcc8d7a6e38268f05b540acd94a',
 'eleventh-public-review-b.json':'f07f2a7505f480f4650726f26c27309a8a9f97edbb423b06cf229929452f49c0'
});
const EXPECTED=Object.freeze([
 {input_index:23,owner:'https://www.sastostadores.com/',url:'https://sastostadores.com/quienes-somos/',family:'sastostadores.com'},
 {input_index:4,owner:'https://bbs.cafe/',url:'https://bbs.cafe/pages/equipo',family:'bbs.cafe'},
 {input_index:5,owner:'https://en.sarutahiko.jp/',url:'https://brand.sarutahiko.jp/brand',family:'sarutahiko.jp'}
]);
const TOKEN=Symbol('verified explicit CLI run'),sha=v=>crypto.createHash('sha256').update(v).digest('hex'),stamp=()=>new Date().toISOString();
function must(ok,code){if(!ok)throw Object.assign(Error(code),{code});}
function strictUrl(value,owner){const original=new URL(value);must(!original.search&&!original.hash,'query_or_fragment_forbidden');const u=owner?ownerUrl(original,owner):publicUrl(original);must(u.href===value,'url_must_be_exact');return u;}
function pointer(doc,p){must(/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(p),'invalid_proof_pointer');for(const k of p.slice(1).split('/')){must(!['__proto__','prototype','constructor'].includes(k)&&doc&&Object.hasOwn(doc,k),'missing_proof_pointer');doc=doc[k];}return doc;}
function pageKey(value){const u=new URL(value);return u.hostname.toLowerCase().replace(/^www\./,'')+(u.pathname.replace(/\/$/,'')||'/');}
function transportOwner(t){return strictUrl(t.url).origin+'/';}
function validateManifest(m,read){
 assert.equal(m.version,1);assert.equal(m.scope,'explicit_observed_identity_pages_only');assert.equal(m.readOnlyDiscovery,true);assert.equal(m.executionAuthorized,false);
 assert.equal(m.staleCatalog,true);assert.equal(m.databasePlanningAllowed,false);assert.equal(m.databaseMutationAllowed,false);assert.equal(m.requiresFreshCatalogBeforeAnyDatabasePlanOrApply,true);
 assert.deepEqual(m.limits,LIMITS);assert.equal(m.targets.length,3);assert.equal(new Set(m.targets.map(t=>t.url)).size,3);assert.equal(new Set(m.targets.map(t=>t.input_index)).size,3);
 const docs=new Map();for(const[file,pin]of Object.entries({...m.inputHashes,...REVIEW_PINS})){assert(/^[a-z0-9][a-zA-Z0-9._/-]*$/.test(file)&&!file.split('/').includes('..'));assert.match(pin,/^[a-f0-9]{64}$/);const bytes=read(file);assert.equal(sha(bytes),pin,'Pinned evidence changed: '+file);docs.set(file,bytes);}
 const json=f=>{assert(docs.has(f),'Unpinned evidence');return JSON.parse(docs.get(f));};
 const inputFile='eleventh-reviewed-site-input.json',cacheFile='eleventh-public-brand-site-review.ndjson';
 const inputs=json(inputFile),lines=docs.get(cacheFile).toString().trim().split('\n'),cache=lines.map(JSON.parse),fetched=new Set();
 function scan(value){if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(scan);return;}for(const[k,v]of Object.entries(value)){if(['url','requestedUrl','finalUrl','requested_url','final_url','from','to'].includes(k)&&typeof v==='string'&&/^https?:\/\//.test(v))fetched.add(pageKey(v));else if(v&&typeof v==='object')scan(v);}}
 const priorAudit=json('eleventh-reviewed-site-input.audit.json');
 const requiredFiles=[...new Set([...priorAudit.requestLogFiles,cacheFile,cacheFile+'.audit.ndjson'])];assert.equal(requiredFiles.length,45);
 for(const file of requiredFiles){assert(docs.has(file),'Missing novelty ledger');if(priorAudit.inputHashes[file])assert.equal(m.inputHashes[file],priorAudit.inputHashes[file]);for(const line of docs.get(file).toString().split('\n').filter(Boolean))scan(JSON.parse(line));}
 const priorFollowups=json('tenth-identity-followup/result.json');assert.equal(priorFollowups.pages.length,5);scan(priorFollowups.pages);
 for(const [index,t]of m.targets.entries()){
  const e=EXPECTED[index];assert.equal(t.input_index,e.input_index);assert.equal(t.owner_url,e.owner);assert.equal(t.url,e.url);assert.equal(t.observed_same_domain_family,e.family);
  assert.equal(t.candidate_name,inputs[t.input_index].name);assert.equal(t.owner_url,inputs[t.input_index].website_url);assert.equal(t.fetched,false);assert.equal(t.identityVerified,false);assert.equal(t.target_id,sha(t.owner_url+'\n'+t.url));
  strictUrl(t.owner_url);strictUrl(t.url,transportOwner(t));for(const value of [t.owner_url,t.url]){const host=new URL(value).hostname.replace(/^www\./,'');assert(host===e.family||host.endsWith('.'+e.family));}
  assert(!fetched.has(pageKey(t.url)),'Already requested identity page');assert.equal(t.source_cache_file,cacheFile);assert.equal(t.source_cache_sha256,m.inputHashes[cacheFile]);
  assert(Number.isSafeInteger(t.source_cache_line)&&t.source_cache_line>0&&t.source_cache_line<=lines.length);assert.equal(sha(lines[t.source_cache_line-1]),t.source_cache_line_sha256);
  const c=cache[t.source_cache_line-1];assert.equal(c.key,t.source_cache_key);assert.equal(c.candidate.website_url,t.owner_url);assert.equal(c.status,'review_required');assert(!c.pages.some(p=>p.accessStop||p.legalContentExcluded),'Prior access/legal stop excludes owner');
  const p=c.pages[t.source_page_index];assert.equal(t.source_page_index,0);assert(p&&p.captureComplete&&!p.truncated&&p.status>=200&&p.status<300);assert.equal(p.finalUrl,t.source_page);assert.equal(sha(p.rawHtml),t.source_raw_html_sha256);assert.equal(sha(p.staticBodyText),t.source_static_text_sha256);strictUrl(t.source_page,t.owner_url);
  const[start,end]=t.raw_html_utf16_range;assert(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&end>start&&end<=p.rawHtml.length);
  const anchor=p.rawHtml.slice(start,end);assert.equal(anchor,t.anchor_html);assert.equal(sha(anchor),t.anchor_sha256);assert(/^<a\b[^>]*>[\s\S]*<\/a>$/i.test(anchor));
  const staticMarkup=p.rawHtml.replace(/<!--[\s\S]*?-->|<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,x=>' '.repeat(x.length));assert.equal(staticMarkup.slice(start,end),anchor,'Anchor is not static markup');
  const match=/^<a\b([^>]*)>/i.exec(anchor),href=/(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(match[1]);assert(href);assert.equal(href[1]??href[2],t.raw_href);assert.equal(new URL(decode(t.raw_href),t.source_page).href,t.url,'Observed href URL drift');
  const[hstart,hend]=t.raw_href_html_utf16_range;assert(Number.isSafeInteger(hstart)&&Number.isSafeInteger(hend)&&hstart>=start&&hend<=end);assert.equal(p.rawHtml.slice(hstart,hend),t.raw_href);
  const review=json(t.input_index===23?'eleventh-public-review-b.json':'eleventh-public-review-a.json'),decision=review.reviews.find(r=>(r.input_index??r.index)===t.input_index);assert(decision);assert.equal(decision.status,'hold');assert.equal(decision.databasePlanningAllowed,false);assert.equal(decision.databaseMutationAllowed,false);
 }
 return m;
}
function loadManifest(){
 must(/^[a-f0-9]{64}$/.test(MANIFEST_SHA256||''),'manifest_pin_unset');
 const read=f=>{const p=fs.realpathSync(path.join(BASE,f));must(p.startsWith(BASE+path.sep),'evidence_outside_base');return fs.readFileSync(p);};
 for(const[f,h]of Object.entries(HELPER_PINS))assert.equal(sha(read(f)),h,'Pinned helper changed: '+f);
 const bytes=read(MANIFEST_FILE);assert.equal(sha(bytes),MANIFEST_SHA256);return validateManifest(JSON.parse(bytes),read);
}
async function collectPages(m,{transportFactory=createTransport,event=()=>{},onPage=()=>{},token}={}){
 if(transportFactory===createTransport)must(token===TOKEN,'explicit_verified_run_required');
 let context;const transport=transportFactory({context:()=>context,onEvent:event}),stops=new Map(),results=[];
 for(const t of m.targets){
  if(stops.has(t.input_index)){const record={target_id:t.target_id,input_index:t.input_index,requested_url:t.url,status:'not_requested_prior_owner_stop',stop_reason:stops.get(t.input_index),fetched:false};results.push(record);await onPage(record,null);continue;}
  const u=strictUrl(t.url,transportOwner(t));context={target:{entity_id:null,website_url:transportOwner(t),products:[]},url:u.href,images:new Set(),networkErrors:[]};
  const record={target_id:t.target_id,input_index:t.input_index,candidate_name:t.candidate_name,requested_url:t.url,source_anchor:t,started_at:stamp(),fetched:false,identityVerified:false};
  event({channel:'explicit_identity_page',at:stamp(),target_id:t.target_id,url:u.href,disposition:'starting'});
  const response=await transport.fetchHtml(u.href);event.throwIfFailed?.();
  if(!response.success){record.status='failed';record.error=response.error;record.hard_stop=context.hardStop||null;record.challenge_reason=context.challengeReason||null;stops.set(t.input_index,record.hard_stop||record.error||'request_failed');}
  else{
   const final=strictUrl(response.finalUrl,transportOwner(t));assert.equal(final.pathname.replace(/\/$/,''),u.pathname.replace(/\/$/,''),'Changed-path response forbidden');assert(typeof response.data==='string'&&Buffer.byteLength(response.data)<=LIMITS.maxHtmlBytes);
   Object.assign(record,{status:response.status,final_url:final.href,fetched:true,content_type:response.headers['content-type'],metadata:identity(response.data),...capture(response.data)});
   if(record.metadata.parkedSignals.length){record.status='parked_or_unrelated';stops.set(t.input_index,record.status);}
  }
  record.finished_at=stamp();results.push(record);await onPage(record,record.rawHtml??null);
 }
 return results;
}
async function run(m,token){
 must(token===TOKEN,'explicit_verified_run_required');assert.deepEqual(loadManifest(),m);const directory=path.join(BASE,TAG);fs.mkdirSync(directory,{mode:0o700});syncDirectory(BASE);
 saveExclusive(path.join(directory,'reservation.json'),{at:stamp(),pid:process.pid,manifest_sha256:MANIFEST_SHA256,helper_sha256:sha(fs.readFileSync(__filename)),limits:LIMITS,no_resume_or_retry:true,scope:m.scope});
 const audit=openRequestAudit(path.join(directory,'requests.ndjson')),event=latchedEvents(e=>audit.append(e));let legal,native,pages=[],failure=null;
 try{
  process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';legal=installLegalGuard({onEvent:event});native=installQuerylessGuard({onEvent:event});
  await collectPages(m,{event,token,onPage:record=>{saveExclusive(path.join(directory,'page-'+record.target_id+'.json'),record);pages.push(record);}});
 }catch(e){failure={code:String(e.code||'identity_followup_failed').replace(/[^A-Za-z0-9_:-]/g,'').slice(0,100)};}
 finally{try{native?.uninstall();}finally{try{legal?.uninstall();}finally{audit.close();}}}
 const result={version:1,at:stamp(),status:failure?'failed_for_review':'finished_for_factual_review',failure,manifest_sha256:MANIFEST_SHA256,helper_sha256:sha(fs.readFileSync(__filename)),limits:LIMITS,pages,request_audit_file:'requests.ndjson',request_audit_sha256:sha(fs.readFileSync(path.join(directory,'requests.ndjson'))),legal_guard:legal?.stats,native_guard:native?.stats,staleCatalog:true,databasePlanningAllowed:false,databaseMutationAllowed:false,requiresFreshCatalogBeforeAnyDatabasePlanOrApply:true,network_scope:'Exact previously unrequested static identity pages only; no link expansion, product requests, JSON APIs, media requests, JS execution, auth, cookies or retries.'};
 saveExclusive(path.join(directory,'result.json'),result);return{status:result.status,output:directory,pages:pages.length,result_sha256:sha(fs.readFileSync(path.join(directory,'result.json')))};
}
async function main(args=process.argv.slice(2)){assert(args.length<=1&&(!args[0]||['--check','--run'].includes(args[0])));const m=loadManifest();if(args[0]!=='--run'){console.log(JSON.stringify({status:'pass',pages:m.targets.length,owners:new Set(m.targets.map(t=>t.input_index)).size,networkRequests:0,databaseCalls:0}));return;}console.log(JSON.stringify(await run(m,TOKEN)));}
module.exports={LIMITS,HELPER_PINS,REVIEW_PINS,EXPECTED,pageKey,transportOwner,MANIFEST_FILE,MANIFEST_SHA256,sha,strictUrl,pointer,validateManifest,loadManifest,collectPages,main};
if(require.main===module)main().catch(e=>{console.error(String(e.code||'identity_followup_failed').replace(/[^A-Za-z0-9_:-]/g,'').slice(0,100));process.exitCode=1;});

