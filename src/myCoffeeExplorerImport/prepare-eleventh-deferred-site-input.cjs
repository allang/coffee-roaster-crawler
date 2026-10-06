'use strict';
// Offline-only completion of the two origins deferred solely by the 24-site cap.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
require('./prepare-lulo-followup.cjs').offlineOnly();
const prior=require('./prepare-eleventh-site-input.cjs'),w=require('./ninth-review-workbench.cjs'),{publicUrl}=require('./product-only-network.cjs');
const BASE=__dirname,FIELDS=['id','productId','name','brand','productUrl'];
const TARGETS=Object.freeze(['thegrindcoffeeco.com','wildhighlandscoffee.com']);
const PREFIX='eleventh-deferred';
const PINS=Object.freeze({
 'prepare-eleventh-site-input.cjs':'02e1f4ddb6e9d7ab7573719bc597216f6496e378bfc2ad0de348b84a61d065ed',
 'eleventh-discovery-pool.json':'849d28a459fce421a2d876278fe56ea8ece6c7288158d9f1fb1b4e747940e95b',
 'eleventh-discovery-preview.json':'b2b42cb26021f39f32017e2ce7d0042c2bce0eb73f0ac66fc2c2a42fa7e9a624',
 'eleventh-reviewed-site-input.json':'5684e5ee0f1443f927bb550ea777a1c84762ad5c6ca3f0c32434d6f0b86aa1f9',
 'eleventh-reviewed-site-input.audit.json':'8e4048fe7389c64af528d53db591e3cdb304acfa2331a1533495c595ee8cb446',
 'eleventh-public-brand-site-review.ndjson':'2c3c6994810ed609851d4f63e38b05cde622328224cf916b73e18644e9dc92a1',
 'eleventh-public-brand-site-review.ndjson.audit.ndjson':'25b3028031302b8688b474fd43560e5d3c8700b39680c2bda9b056914d20fb00',
 'eleventh-site-discovery.receipt.json':'1325f9681dd70db4bcb8c5842c2b70f783207506b864a855b0d4fe89fbd97413'
});
const flags=Object.freeze({readOnlyDiscovery:true,staleCatalog:true,databasePlanningAllowed:false,databaseMutationAllowed:false,requiresFreshCatalogBeforeAnyDatabasePlanOrApply:true});
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function sourceProof(row,proof,read){const bytes=read(proof.file);assert.equal(sha(bytes),proof.sha256);assert(/^\/rows\/\d+$/.test(proof.pointer));const original=JSON.parse(bytes).rows[Number(proof.pointer.split('/').at(-1))];assert.deepEqual(row,original);return{...row,sourceCatalogProof:proof};}
function assertNovel(url,requestedHosts,held,visited){const u=prior.safeRoot(url),host=prior.hostname(u);assert(TARGETS.includes(host),'Outside exact two deferred origins');assert(![...requestedHosts].some(h=>prior.sameFamily(h,host)),'Previously requested host family');assert(!held.some(x=>prior.sameFamily(x.host,host)),'Prior explicit hold');assert(!visited.some(x=>prior.sameFamily(x.host,host)),'Previously selected origin');return host;}
function collect(at=new Date().toISOString()){
 assert.equal(new Date(at).toISOString(),at);const hashes={};
 const read=file=>{assert(typeof file==='string'&&!path.isAbsolute(file)&&!file.split('/').includes('..'));const real=fs.realpathSync(path.join(BASE,file));assert(real.startsWith(BASE+path.sep));const bytes=fs.readFileSync(real),h=sha(bytes);if(hashes[file])assert.equal(h,hashes[file]);hashes[file]=h;return bytes;};
 for(const[f,h]of Object.entries(PINS))assert.equal(sha(read(f)),h,'Frozen prerequisite drift: '+f);
 const baseline=JSON.parse(read('eleventh-reviewed-site-input.audit.json')),preview11=JSON.parse(read('eleventh-discovery-preview.json')),pool=JSON.parse(read('eleventh-discovery-pool.json'));
 assert.equal(preview11.priorExplicitHolds.length,29);assert.deepEqual(preview11.deferred.map(x=>x.host),TARGETS);assert.equal(pool.eligible.length,79);
 for(const[f,h]of Object.entries(baseline.inputHashes))assert.equal(sha(read(f)),h,'Frozen source/exclusion drift: '+f);
 for(const f of ['prepare-eleventh-deferred-site-input.cjs','prepare-eleventh-deferred-site-input.test.cjs','eleventh-collection.root-audit.json'])read(f);
 const plans=['plan.json',...fs.readdirSync(BASE,{withFileTypes:true}).filter(d=>d.isDirectory()&&fs.existsSync(path.join(BASE,d.name,'plan.json'))).map(d=>d.name+'/plan.json')].sort();
 assert.deepEqual(plans,Object.keys(baseline.inputHashes).filter(f=>f==='plan.json'||f.endsWith('/plan.json')).sort(),'New plan needs exclusion review');
 const manifests=fs.readdirSync(BASE,{withFileTypes:true}).filter(d=>d.isDirectory()&&d.name.startsWith('product-seed-')&&fs.existsSync(path.join(BASE,d.name,'manifest.json'))).map(d=>d.name+'/manifest.json').sort();
 assert.deepEqual(manifests,Object.keys(baseline.inputHashes).filter(f=>f.startsWith('product-seed-')&&f.endsWith('/manifest.json')).sort(),'New seed reservation needs review');
 const requestFiles=prior.requestFiles(),requestedHosts=new Set(),requestedPages=new Set();let requestRecords=0;
 function scan(v){if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach(scan);return;}for(const[k,x]of Object.entries(v)){if(['url','requestedUrl','finalUrl','requested_url','final_url','from','to'].includes(k)&&typeof x==='string'&&/^https?:\/\//.test(x)){const u=new URL(x);requestedHosts.add(prior.hostname(u));requestedPages.add(u.origin+u.pathname);}else if(x&&typeof x==='object')scan(x);}}
 for(const f of requestFiles){for(const line of read(f).toString().split('\n').filter(Boolean)){scan(JSON.parse(line));requestRecords++;}}
 assert(baseline.requestLogFiles.every(f=>requestFiles.includes(f)),'Prior request inventory missing');
 scan(JSON.parse(read('tenth-identity-followup/result.json')).pages);
 const completion=JSON.parse(read('eleventh-site-discovery.receipt.json')),cache=read('eleventh-public-brand-site-review.ndjson').toString().trim().split('\n').map(JSON.parse);
 assert.equal(completion.finished,24);assert.equal(completion.total,24);assert.equal(completion.guard.prohibitedRequestsSent,0);assert.equal(cache.length,24);
 assert.equal(completion.output_sha256,PINS['eleventh-public-brand-site-review.ndjson']);assert.equal(completion.audit_sha256,PINS['eleventh-public-brand-site-review.ndjson.audit.ndjson']);
 let completePages=0;for(const c of cache){scan(c);for(const p of c.pages){if(p.captureComplete){assert.equal(sha(p.rawHtml),p.rawHtmlSha256);assert.equal(sha(p.staticBodyText),p.staticBodyTextSha256);completePages++;}}}assert.equal(completePages,43);
 const proofs=new Map();let sourceRows=0,pages=0;
 for(const f of Object.keys(baseline.inputHashes).filter(f=>/^public-catalog-pages\/page-\d{4}\.json$/.test(f)).sort()){const page=JSON.parse(read(f));assert.equal(sha(JSON.stringify(page.rows)),page.rowsSha256);pages++;for(const[i,row]of page.rows.entries()){sourceRows++;if([79036,74411].includes(row.id)){assert(!proofs.has(row.id));proofs.set(row.id,{file:f,sha256:hashes[f],pointer:'/rows/'+i});}}}
 assert.equal(pages,741);assert.equal(sourceRows,74036);assert.equal(proofs.size,2);
 const selected=TARGETS.map(host=>{const item=pool.eligible.find(x=>x.host===host);assert(item);assertNovel(item.website_url,requestedHosts,preview11.priorExplicitHolds,preview11.selected);assert.equal(item.products.length,1);const r=item.products[0];publicUrl(r.productUrl);assert.equal(prior.hostname(r.productUrl),host);assert.equal(new URL(r.productUrl).origin,new URL(item.website_url).origin);const evidence=sourceProof(r,proofs.get(r.id),read),variants=prior.VARIANTS[host];assert(variants);
  const cautions=w.identities([item.name,...variants],[item.website_url]).map(e=>({entity_id:e.id,name:e.name,website_url:e.website_url,roles:e.roles,pending_plan:e.pending_plan,disposition:'Retained-catalog research caution, never identity binding.'}));
  return{host,name:item.name,website_url:item.website_url,identityVerified:false,discoveryOnly:true,discoveryMode:'new_page_or_alias_clarification_only_no_import',sourceProductCount:item.productCount,originalProductEvidence:[evidence],additionalNameVariantsChecked:variants,retainedCatalogCautions:cautions,originProof:{method:'Exact origin of immutable source product URL; no guessed domain or URL rewriting.',originalUrl:r.productUrl,originalProof:proofs.get(r.id)},identityReviewCautions:['Deferred solely by the prior 24-origin cap; selected for public first-party research only.','Source merchant name and current operator may differ; parent/branch/contract-roaster relations remain unproven.','All retained same-name records, including roleless records, require fresh full-identity reconciliation before any DB plan.']};});
 const input=selected.map(s=>({name:s.name,website_url:s.website_url,source:'my_coffee_explorer',source_url:'https://mycoffeeexplorer.com/coffees',productEvidence:s.originalProductEvidence.map(r=>Object.fromEntries(FIELDS.map(k=>[k,r[k]]))),productEvidenceProofs:s.originalProductEvidence.map(r=>({id:r.id,...r.sourceCatalogProof})),incompleteInventory:false,identityVerified:false,discoveryOnly:true,discovery_only_no_import:true,...flags,identityReviewCautions:s.identityReviewCautions,sourcePreview:{additionalNameVariantsChecked:s.additionalNameVariantsChecked,retainedCatalogCautions:s.retainedCatalogCautions,originProof:s.originProof}}));
 assert.equal(input.length,2);assert.equal(new Set(input.map(x=>x.website_url)).size,2);
 assert.deepEqual(prior.requestFiles(),requestFiles,'Request inventory changed during preparation');for(const[f,h]of Object.entries(hashes))assert.equal(sha(fs.readFileSync(path.join(BASE,f))),h,'Evidence changed: '+f);
 const counts={selected:2,sourceFactRows:2,priorExplicitHolds:29,completedEleventhSites:24,completedEleventhPages:43,priorRequestFiles:requestFiles.length,priorRequestRecords:requestRecords,priorRequestedHosts:requestedHosts.size,priorRequestedPages:requestedPages.size,immutableCatalogPages:741,immutableCatalogRows:74036,deferredByCapRemaining:0};
 const warning='Read-only new-page/alias research only. Stale retained catalog, no fresh absence claim, no import planning or DB authority. All previous holds and requested families excluded; the two source merchant names are not identity approvals.';
 const preview={version:1,batch:'11-deferred',at,mode:'read_only_discovery_preview',draft:false,...flags,snapshot:preview11.snapshot,supplementalExclusions:preview11.supplementalExclusions,selected,counts,warning,networkRequests:0,databaseCalls:0,identityApprovals:0};
 const inputBytes=JSON.stringify(input,null,2)+'\n',previewBytes=JSON.stringify(preview,null,2)+'\n';
 const audit={version:1,at,status:'OFFLINE_DISCOVERY_INPUT_VALIDATED_NOT_IDENTITY_APPROVED',output:PREFIX+'-reviewed-site-input.json',outputSha256:sha(inputBytes),reviewedPreview:{file:PREFIX+'-discovery-preview.json',sha256:sha(previewBytes)},inputHashes:hashes,currentSnapshot:preview11.snapshot,...flags,counts,requestLogFiles:requestFiles,method:{originalSourceFactsVerified:true,all741PagesRehashed:true,allPrior958PinsRechecked:true,all43EleventhCapturesRehashed:true,allPriorRequestedFamiliesExcluded:true,all29ExplicitHoldsPreserved:true,noNetwork:true,noDB:true},warning};
 const manifest={version:1,batch:'11-deferred',at,scope:'two_cap_deferred_origins_public_identity_discovery_only',input:{file:audit.output,sha256:audit.outputSha256},preview:audit.reviewedPreview,audit:{file:PREFIX+'-reviewed-site-input.audit.json',sha256:sha(JSON.stringify(audit,null,2)+'\n')},...flags,limits:{owners:2,initialPages:2,observedIdentityFollowupsPerOwner:2,maxPages:6,maxHtmlBytes:1048576,concurrency:2,retries:0},targets:input.map((r,index)=>({index,name:r.name,url:r.website_url,sourceOriginProof:selected[index].originProof,identityVerified:false,discovery_only_no_import:true})),warning};
 return{input,preview,audit,manifest};
}
module.exports={TARGETS,PREFIX,PINS,flags,sha,sourceProof,assertNovel,collect};
if(require.main===module){assert(process.argv.length<=3&&(!process.argv[2]||process.argv[2]==='--check'),'Offline --check only');const r=collect();console.log(JSON.stringify({status:'pass_offline',counts:r.audit.counts,networkRequests:0,databaseCalls:0}));}
