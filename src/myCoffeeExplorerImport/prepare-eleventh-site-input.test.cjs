'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const h=require('./prepare-eleventh-site-input.cjs');
test('24-origin cap does not relax explicit prior holds or requested-host-family exclusions',()=>{
 const pool=Array.from({length:30},(_,i)=>({host:'candidate'+i+'.example',website_url:'https://candidate'+i+'.example/'}));
 const picked=h.choose(pool,[{host:'candidate0.example'}],[{host:'candidate1.example'}],new Set(['shop.candidate2.example']));
 assert.equal(picked.visited.length,1);assert.equal(picked.explicitHolds.length,1);assert.equal(picked.newlyRequested.length,1);assert.equal(picked.remaining.length,27);assert.equal(picked.selected.length,24);assert.equal(picked.deferred.length,3);
});
test('same parent/subdomain/www families are exclusions, not exact-name identity claims',()=>{
 for(const pair of [['shop.example.com','example.com'],['www.example.com','example.com'],['us.example.com','example.com']])assert(h.sameFamily(...pair));assert(!h.sameFamily('notexample.com','example.com'));
});
for(const u of ['https://example.com/terms','https://example.com/%2574erms','https://example.com/privacy','https://example.com/login','https://example.com/api/items','https://example.com/?token=x','https://example.com/#x','http://example.com/','https://127.0.0.1/'])test('initial root guard rejects '+u,()=>assert.throws(()=>h.safeRoot(u)));
test('landing evidence is labeled honestly, never silently turned into product evidence',()=>{
 assert.equal(h.kind('https://example.com/'),'homepage_or_language_landing_reference');assert.equal(h.kind('https://example.com/en/'),'homepage_or_language_landing_reference');assert.equal(h.kind('https://example.com/collections/coffee'),'category_or_brand_landing_reference');assert.equal(h.kind('https://example.com/products/'),'category_or_brand_landing_reference');assert.equal(h.kind('https://example.com/products/coffee'),'individual_product_path_candidate_not_live_verified');
});
test('name similarity alone does not prevent scoped new-page discovery',()=>{
 const result=h.choose([{host:'unvisited.example',website_url:'https://unvisited.example/',name:'Existing Generic Coffee'}],[],[],new Set());assert.equal(result.selected.length,1);
});
test('no HTTP or subprocess may be used during selection',()=>{
 assert.throws(()=>fetch('https://example.com/'),/offline_builder/);assert.throws(()=>require('node:https').get('https://example.com/'),/offline_builder/);assert.throws(()=>require('node:child_process').spawn('curl'),/offline_builder/);
});
test('real offline bundle preserves stale-catalog/no-write flags and exact immutable source facts',()=>{
 const {input,preview,audit,manifest}=h.collect();assert.equal(input.length,24);assert.equal(preview.selected.length,24);assert.equal(manifest.targets.length,24);
 assert.equal(audit.counts.retainedPool,79);assert.equal(audit.counts.tenthVisited,24);assert.equal(audit.counts.priorExplicitHolds,29);assert.equal(audit.counts.deferredByCap,2);assert.equal(audit.counts.immutableCatalogPages,741);assert.equal(audit.counts.immutableCatalogRows,74036);
 assert(input.every(r=>r.discovery_only_no_import&&r.identityVerified===false&&r.databasePlanningAllowed===false&&r.databaseMutationAllowed===false));
 assert.equal(preview.snapshot.file,'snapshot-0114.json');assert.equal(preview.snapshot.status,'stale_retained_catalog_not_refreshed');assert.equal(audit.staleCatalog,true);assert.equal(manifest.databaseMutationAllowed,false);
 assert.equal(audit.outputSha256,h.sha(JSON.stringify(input,null,2)+'\n'));assert.equal(audit.reviewedPreview.sha256,h.sha(JSON.stringify(preview,null,2)+'\n'));assert.equal(manifest.audit.sha256,h.sha(JSON.stringify(audit,null,2)+'\n'));
 assert(!input.some(r=>r.productEvidence.some(p=>p.id===30694)));assert.equal(audit.counts.sourceRowsExcludedAsNonCoffee,1);
});
