'use strict';
// New bounded collector; no existing collector, transport, guard or runner is edited.
// Pending input pins are genuinely unset. CLI and default transport stay blocked.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {pageRequest,classifyUrl,clean}=require('./validate-sites.cjs');
const {evidence}=require('./brand-site-review.cjs');
const {publicAddress,publicUrl,challengeReason,legalDocumentHtml}=require('./product-only-network.cjs');
const dns=require('node:dns/promises'),net=require('node:net');
const {installLegalGuard,safeRequestLabel}=require('./legal-guard.cjs');
const {installQuerylessGuard}=require('./plan8-product-link-discovery.cjs');
const BASE=__dirname,INPUT='tenth-reviewed-site-input.json',OUTPUT='tenth-public-brand-site-review.ndjson';
const BATCH=Object.freeze({inputFile:INPUT,inputSha256:'d2763f3aaa6c64bbd74f41f1b06e129b6ad815d94c70c2aaf41948d6a8305ba3',auditFile:'tenth-reviewed-site-input.audit.json',auditSha256:'44b83487fcf2b8e04a7f5b522499d6442f1c70a82d19887a868e8b5ef83fe607',
 previewFile:'tenth-discovery-preview.json',previewSha256:'34b2f935f32308dd12475f20354f7e6350d17e2ebec92c409ca03e79081db727',snapshotFile:'snapshot-0114.json',snapshotSha256:'c835229bf8c2abbdfcc812f6a9c841b4e6fd8e3c3eb03b8b62474964bb9a3e99',owners:24,sourceRows:63});
const HELPER_PINS=Object.freeze({
 'collect-ninth-sites.cjs':'2fc78f2bffcb1a18e864b282c14c9f9cb04a458a275ef09f6dc5e3252acfad79',
 'brand-site-review.cjs':'586ba32207bc78c59c8a7645682b4fb27528f2d7fe818787664e099591b51e8d',
 'validate-sites.cjs':'7e1e423d41139078032d81475dcc2acb70610e9fa6cdb0eb6c09d59d23ad133b',
 'product-only-network.cjs':'06b85be52fce083ee6d2cdf5631fa21d2ccdc7ae7a2d7e0f22549769e097ad3e',
 'legal-guard.cjs':'26acbcc26a6b24aaf3663b5968b6163e010a3ac323eac4cfe1dd8b5e6a16abfc',
 'plan8-product-link-discovery.cjs':'75aa82758e22574e81ae1789b26c56f0d791ece06993284ec6d502f781d05fa7'
});
const LIMITS=Object.freeze({owners:24,pagesPerOwner:3,observedFollowups:2,concurrency:2,pageDeadlineMs:20000,redirects:5,maxHtmlBytes:1024*1024});
const RUN_TOKEN=Symbol('verified CLI collection only');
const sha=v=>crypto.createHash('sha256').update(v).digest('hex'),key=r=>sha(r.name+'\n'+r.website_url),stamp=()=>new Date().toISOString();
function fail(code){throw Object.assign(new Error(code),{code});}
function safe(value){const u=publicUrl(classifyUrl(value));if(u.search)fail('queryless_discovery_required');return u;}
function installStrictDnsGuard({dnsModule=dns,onEvent=()=>{}}={}){
 // The unchanged transport reads dns.lookup dynamically and pins its selected
 // returned address in HTTPS's lookup callback. Validate the SAME resolution,
 // never a separate preflight resolution that could allow DNS rebinding.
 const original=dnsModule.lookup,stats={lookups:0,blocked:0};let installed=true;
 async function guardedLookup(host,options){
  stats.lookups++;
  if(!options||options.all!==true)fail('strict_dns_all_answers_required');
  const answers=await original.call(dnsModule,host,options);
  if(!Array.isArray(answers)||!answers.length||answers.some(a=>!a||net.isIP(a.address)!==a.family||!publicAddress(a.address))){
   stats.blocked++;onEvent({at:stamp(),type:'strict_dns_blocked',host,reason:'private_or_reserved_dns'});fail('private_or_reserved_dns');
  }
  // Detached/frozen results cannot change after the check. Legacy address
  // preference and the socket's chosen-address binding remain unchanged.
  return Object.freeze(answers.map(a=>Object.freeze({address:a.address,family:a.family})));
 }
 dnsModule.lookup=guardedLookup;
 return{stats,uninstall(){if(installed){assert.equal(dnsModule.lookup,guardedLookup,'DNS guard ownership changed');dnsModule.lookup=original;installed=false;}}};
}
function assertReady(batch=BATCH){
 for(const k of ['inputSha256','auditSha256','previewSha256','snapshotSha256'])if(!/^[a-f0-9]{64}$/.test(batch[k]||''))fail('tenth_input_pins_unset');
 assert.equal(batch.owners,LIMITS.owners);assert(Number.isSafeInteger(batch.sourceRows)&&batch.sourceRows>0,'Exact source row count required');
 for(const k of ['inputFile','auditFile','previewFile','snapshotFile'])assert(typeof batch[k]==='string'&&/^[a-z0-9][a-z0-9._/-]*\.json$/.test(batch[k])&&!batch[k].split('/').includes('..'),'Unsafe pinned evidence filename');
}
function sourcePointer(value,pointer){
 assert(/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(pointer),'Unsafe source pointer');
 for(const k of pointer.slice(1).split('/')){assert(!['__proto__','constructor','prototype'].includes(k)&&value&&Object.hasOwn(value,k),'Missing source proof');value=value[k];}return value;
}
function validateRows(rows,preview,batch,readProof){
 assert.equal(rows.length,batch.owners);assert.equal(preview.selected.length,batch.owners);
 assert.equal(new Set(rows.map(r=>safe(r.website_url).hostname.toLowerCase().replace(/^www\./,''))).size,batch.owners);
 assert.equal(rows.reduce((n,r)=>n+r.productEvidence.length,0),batch.sourceRows);
 for(const [i,r]of rows.entries()){
  const p=preview.selected[i];assert.equal(r.name,p.name);assert.equal(r.website_url,p.website_url);assert.equal(r.identityVerified,false);assert.equal(r.discoveryOnly,true);
  assert.equal(safe(r.website_url).pathname,'/');assert.deepEqual(r.productEvidence,p.originalProductEvidence.map(({sourceCatalogProof,...original})=>original));
  assert.equal(r.productEvidenceProofs.length,r.productEvidence.length);
  for(const [j,product]of r.productEvidence.entries()){
   const proof=r.productEvidenceProofs[j];assert.equal(proof.id,product.id);
   assert.deepEqual({file:proof.file,sha256:proof.sha256,pointer:proof.pointer},p.originalProductEvidence[j].sourceCatalogProof,'Reviewed source proof changed');
   assert(/^public-catalog-pages\/page-\d{4}\.json$/.test(proof.file),'Unexpected source catalog file');
   const bytes=readProof(proof.file);assert.equal(sha(bytes),proof.sha256);assert.deepEqual(sourcePointer(JSON.parse(bytes),proof.pointer),product);
  }
 }
 return rows;
}
function inputs(){
 // No file, network, or output access can bypass the absent reviewed pins.
 assertReady();
 const pins={...HELPER_PINS,[BATCH.inputFile]:BATCH.inputSha256,[BATCH.auditFile]:BATCH.auditSha256,[BATCH.previewFile]:BATCH.previewSha256,[BATCH.snapshotFile]:BATCH.snapshotSha256};
 const read=f=>{const full=fs.realpathSync(path.join(BASE,f));assert(full.startsWith(BASE+path.sep),'Evidence outside artifact directory');return fs.readFileSync(full);};
 for(const [file,h]of Object.entries(pins))assert.equal(sha(read(file)),h,'Pinned input changed: '+file);
 const rows=JSON.parse(read(INPUT)),preview=JSON.parse(read(BATCH.previewFile)),audit=JSON.parse(read(BATCH.auditFile));
 assert.equal(audit.output,INPUT);assert.equal(audit.outputSha256,BATCH.inputSha256);
 assert.deepEqual(audit.reviewedPreview,{file:BATCH.previewFile,sha256:BATCH.previewSha256});
 assert.equal(audit.inputHashes[BATCH.snapshotFile],BATCH.snapshotSha256);
 return validateRows(rows,preview,BATCH,read);
}
function staticBodyText(html){
 // Same cleanup as brand-site-review.visibleText, but WITHOUT its200k cap.
 // Navigation/footer are intentionally retained. This is static text, not a claim
 // of rendered visibility. Whole legal documents are rejected before this runs.
 return clean(String(html).replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi,' ')
  .replace(/<\/(?:p|div|h[1-6]|li|section)>/gi,'. '),Number.MAX_SAFE_INTEGER);
}
function capture(html){
 const rawHtml=String(html),staticText=staticBodyText(rawHtml);
 return{captureComplete:true,rawHtml,rawHtmlSha256:sha(rawHtml),rawHtmlUtf8Bytes:Buffer.byteLength(rawHtml),
  staticBodyText:staticText,staticBodyTextSha256:sha(staticText),staticBodyTextChars:staticText.length,
  captureEncoding:'Exact decoded HTML string returned by the unchanged HTTP transport, serialized losslessly as JSON UTF-8; not an assertion of original compressed wire bytes.',
  textPolicy:'Same static cleanup as the existing capture helper: script/style/noscript/svg and markup removed, whitespace/entities normalized, navigation/footer retained, no character clipping.'};
}
async function fetchPage(value,deps={}){
 // Fixtures inject request; real requests need the private verified main token.
 let request=deps.request;if(!request){assertReady();if(deps.token!==RUN_TOKEN)fail('verified_run_context_required');request=pageRequest;}
 const event=deps.event||(()=>{}),deadline=Date.now()+LIMITS.pageDeadlineMs,redirects=[];let url=safe(value);
 for(let hop=0;hop<=LIMITS.redirects;hop++){
  event({at:stamp(),type:'read_only_page_request',url:safeRequestLabel(url)});
  const res=await request(url,deadline);
  if([301,302,303,307,308].includes(res.status)&&res.location){if(hop===LIMITS.redirects)fail('redirect_limit');const next=safe(new URL(res.location,url));redirects.push({from:url.href,to:next.href,status:res.status});url=next;continue;}
  const page={requestedUrl:value,finalUrl:url.href,status:res.status,contentType:res.contentType,redirects,truncated:!!res.truncated};
  if([401,403,407,429].includes(res.status))return{...page,accessStop:res.status===429?'rate_limited':'authentication_or_access_denied'};
  if(res.status<200||res.status>=300)return page;
  if(res.truncated||res.html&&Buffer.byteLength(res.html)>LIMITS.maxHtmlBytes)return{...page,truncated:true,accessStop:'response_too_large',captureComplete:false};
  if(res.html){
   const challenge=challengeReason(res.html);if(challenge)return{...page,accessStop:'authentication_or_challenge_page',challengeReason:challenge};
   if(legalDocumentHtml(res.html))return{...page,legalContentExcluded:true,roastingSnippets:[],assertions:[],retailerSignals:[],furtherEvidenceUrls:[]};
   const extracted=evidence(res.html,url.href);Object.assign(page,extracted);
   // Broader metadata legal-title guard inside evidence must also suppress capture.
   if(!page.legalContentExcluded)Object.assign(page,capture(res.html));
  }
  return page;
 }
 fail('redirect_limit');
}
async function review(row,deps={}){
 const result={key:key(row),at:stamp(),candidate:row,status:'review_required',pages:[],verifiedOfficialRoaster:false};
 try{
  const root=await fetchPage(row.website_url,deps);result.pages.push(root);
  if(root.accessStop)result.status=root.accessStop;else if(root.legalContentExcluded)result.status='legal_content_excluded';else if(root.status>=400)result.status='http_'+root.status;else if(root.parkedSignals?.length)result.status='parked_or_unrelated';
  else for(const url of [...new Set(root.furtherEvidenceUrls||[])].filter(u=>u!==root.finalUrl).slice(0,LIMITS.observedFollowups)){
   try{const p=await fetchPage(url,deps);result.pages.push(p);if(p.accessStop||p.legalContentExcluded){result.status=p.accessStop||'legal_content_excluded';break;}}
   catch(e){result.pages.push({requestedUrl:url,error:e.code||'request_failed'});break;}
  }
 }catch(e){result.status='failed';result.error=e.code||'request_failed';}
 result.explicitSelfRoastingSignal=result.pages.some(p=>p.assertions?.length);result.retailerSignal=result.pages.some(p=>p.retailerSignals?.length);return result;
}
function syncDir(){const fd=fs.openSync(BASE,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function latchedEvents(write){
 let failed=false,firstFailure;
 const event=value=>{if(failed)throw firstFailure;try{return write(value);}catch(e){failed=true;firstFailure=e;throw e;}};
 event.throwIfFailed=()=>{if(failed)throw firstFailure;};return event;
}
async function runWorkers(rows,{work,onResult}){
 let cursor=0,failed=false,firstFailure;
 // Keep guards/audit descriptors installed until EVERY in-flight worker has
 // settled, even after an unexpected work/output error. Site failures normally
 // remain captured review results; only uncaught implementation/I/O errors stop
 // the batch. No new row or result write starts after that fatal flag is set.
 await Promise.allSettled(Array.from({length:LIMITS.concurrency},async()=>{
  while(!failed&&cursor<rows.length){
   const row=rows[cursor++];
   try{const result=await work(row);if(!failed)await onResult(result);}
   catch(e){if(!failed){failed=true;firstFailure=e;}throw e;}
  }
 }));
 if(failed)throw firstFailure;
}
async function main(){
 const args=process.argv.slice(2);assert(args.length===1&&['--check','--run'].includes(args[0]));const rows=inputs();
 if(args[0]==='--check'){console.log(JSON.stringify({status:'pass',owners:BATCH.owners,sourceRows:BATCH.sourceRows,networkRequests:0}));return;}
 const out=path.join(BASE,OUTPUT),audit=out+'.audit.ndjson',receiptFile=path.join(BASE,'tenth-site-discovery.receipt.json');
 assert(![out,audit,receiptFile].some(f=>fs.existsSync(f)),'A prior collection requires review, never automatic retry');
 const fd=fs.openSync(out,'wx',0o600);let af,guard,queryless,strictDns,finished=0;
 try{
  af=fs.openSync(audit,'wx',0o600);syncDir();
  const event=latchedEvents(e=>{fs.writeSync(af,JSON.stringify(e)+'\n');fs.fsyncSync(af);});
  process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';guard=installLegalGuard({onEvent:event});queryless=installQuerylessGuard({onEvent:event});strictDns=installStrictDnsGuard({onEvent:event});
  await runWorkers(rows,{work:async row=>{const result=await review(row,{event,token:RUN_TOKEN});event.throwIfFailed();return result;},onResult:result=>{fs.writeSync(fd,JSON.stringify(result)+'\n');fs.fsyncSync(fd);finished++;if(finished%4===0)console.log(JSON.stringify({at:stamp(),finished,total:rows.length}));}});
 }finally{strictDns?.uninstall();queryless?.uninstall();guard?.uninstall();fs.closeSync(fd);if(af!==undefined)fs.closeSync(af);syncDir();}
 const receipt={at:stamp(),status:'collection_finished_not_identity_approved',finished,total:rows.length,batch:BATCH,helperPins:HELPER_PINS,limits:LIMITS,
  helper_sha256:sha(fs.readFileSync(__filename)),output_sha256:sha(fs.readFileSync(out)),audit_sha256:sha(fs.readFileSync(audit)),guard:guard.stats,nativeGuard:queryless.stats,strictDnsGuard:strictDns.stats,
  scope:'24 explicit source merchant homepages and at most two homepage-observed first-party identity pages each. HTTPS GET, no query redirects, credentials, cookies, authentication, JavaScript execution, product imports, or database calls.',
  fullCapture:'Every successful allowed non-truncated HTML page retains the exact decoded raw HTML string and full static body text; legal/access/challenge content is excluded. No followup refetch or resume.'};
 const rf=fs.openSync(receiptFile,'wx',0o600);try{fs.writeFileSync(rf,JSON.stringify(receipt,null,2)+'\n');fs.fsyncSync(rf);}finally{fs.closeSync(rf);syncDir();}console.log(JSON.stringify(receipt));
}
module.exports={BATCH,HELPER_PINS,LIMITS,assertReady,inputs,validateRows,safe,staticBodyText,capture,fetchPage,review,installStrictDnsGuard,runWorkers,latchedEvents};
if(require.main===module)main().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
