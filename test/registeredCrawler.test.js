'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const url='https://merchant.test/products/coffee',roaster={id:'reviewed-owner',name:'Reviewed Merchant',website_url:'https://merchant.test'};
function crawler(state) {
  const log=new Proxy({},{get:()=>()=>{}}),reader={fetchHtml:async value=>{state.reads.push(value);return {success:true,status:200,data:'Shopify',finalUrl:value};}};
  const mocks={
    './supabase':{},'./sitemap':{discoverSitemapUrl:async()=>{state.sitemaps++;throw Error('Generic sitemap should not run');}},
    './httpClient':{jitteredSleep:async()=>{}},'./urlAccumulator':require('../src/urlAccumulator'),'./blacklist':{},
    './knownPages':{getKnownPagesForEntity:async()=>state.knownPages || new Map(),saveBlacklistedPages:async()=>{}},
    './pageVisitor':{visitAllPages:async(...args)=>{state.visits++;state.visitedUrls=args[1].map(r=>r.url);state.visitOptions=args[5];return {visited:args[1].length,coffeeFound:args[1].length,errors:state.pageErrors || 0};},fetchPageContent:async(value,_,options)=>{state.checkOptions=options;return options.fetchHtml(value);}},
    './crawlRuns':{waitForCrawlAdmission:async()=>{},createCrawlRun:async()=>{state.created++;return {id:'run'};},completeCrawlRun:async(_,metrics)=>{state.completed++;state.metrics=metrics;},failCrawlRun:async()=>{state.failed++;}},
    './bfsCrawler':{bfsCrawl:async()=>{state.bfs++;throw Error('BFS should not run');}},'./config':{config:{crawler:{requestDelayMs:0}}},'./logger':{createScopedLogger:()=>log},
    './availability':{reconcileRoasterAvailability:async options=>{state.reconciled++;state.reconcileOptions=options;await options.fetchPage(url);}},
    './siteSupport/discovery':{profileFor:()=>state.profile || {name:'Reviewed Merchant'},discoverSiteProducts:async roaster=>{state.discoveryRoaster=roaster;return state.discovery;}},'./siteSupport/network':{createReader:()=>reader,allowed:require('../src/siteSupport/network').allowed},'./crawlTierPlan':require('../src/crawlTierPlan'),
    './siteSupport/squareInventory':require('../src/siteSupport/squareInventory'),
    './siteSupport/txt':require('../src/siteSupport/txt'),
    './crawlConcurrency':require('../src/crawlConcurrency'),
  };
  const module={exports:{}},file=path.join(__dirname,'../src/crawler.js');
  vm.runInThisContext('(function(require,module,exports){'+fs.readFileSync(file,'utf8')+'\n})',{filename:file})(name=>{if(!(name in mocks))throw Error('Unexpected dependency: '+name);return mocks[name];},module,module.exports);
  return {crawl:module.exports.crawlRoaster,reader};
}
function state(){return {reads:[],sitemaps:0,bfs:0,visits:0,created:0,completed:0,failed:0,reconciled:0,discovery:{supported:true,complete:true,urls:[url]}};}
test('Dak native inventory URLs with trailing slashes reach the actual normalized crawl queue',async()=>{
  const evidence=require('../docs/tier-one-site-support/dak-live.json'),profile=require('../src/siteSupport/profiles.json').find(p=>p.name==='DAK Coffee Roasters');
  const s=state();s.discovery=evidence.discovery;s.profile=profile;
  const result=await crawler(s).crawl({id:profile.entity_ids[0],name:'Dak',website_url:'https://www.dakcoffeeroasters.com/'},[]);
  assert.equal(result.visitResults.visited,evidence.discovery.urls.length);
  assert.equal(result.visitResults.coffeeFound,23);
  assert.deepEqual(s.visitedUrls,evidence.discovery.urls.map(value=>new URL(value).href.replace(/\/+$/,'')));
  assert.equal(s.completed,1);assert.equal(s.failed,0);
});
test('normalizing native URL membership retains explicit exclusions and admits cached irrelevant pages for reevaluation',async()=>{
  const s=state();s.discovery.urls=[url+'/',url+'-excluded/',url+'-cached/'];
  s.knownPages=new Map([[url+'-excluded',{status:'skip'}],[url+'-cached',{status:'irrelevant'}]]);
  await crawler(s).crawl(roaster,[]);
  assert.deepEqual(s.visitedUrls,[url,url+'-cached']);assert.equal(s.metrics.coffeesFound,2);
});
test('registered inventory uses only its guarded reader and reconciles without a generic sitemap',async()=>{
  const s=state(),c=crawler(s),result=await c.crawl(roaster,[]);
  assert.equal(result.success,true);assert.equal(s.sitemaps,0);assert.equal(s.bfs,0);assert.equal(s.visits,1);assert.equal(s.reconciled,1);
  assert.deepEqual(s.reconcileOptions.surfaceUrls,[url]);assert.equal(s.visitOptions.fetchHtml,c.reader.fetchHtml);assert.equal(s.checkOptions.fetchHtml,c.reader.fetchHtml);assert.equal(s.completed,1);
});
test('incomplete or empty reviewed inventory fails without falling back or reconciling',async()=>{
  for(const discovery of [{supported:true,complete:false,urls:[url]},{supported:true,complete:true,urls:[]}]){
    const s=state();s.discovery=discovery;await assert.rejects(crawler(s).crawl(roaster,[]),/Incomplete or empty/);
    assert.equal(s.visits,0);assert.equal(s.reconciled,0);assert.equal(s.sitemaps,0);assert.equal(s.bfs,0);assert.equal(s.failed,1);assert.equal(s.completed,0);
  }
});
test('registered page failures prevent availability reconciliation',async()=>{
  const s=state();s.pageErrors=1;await assert.rejects(crawler(s).crawl(roaster,[]),/Registered merchant product verification failed/);assert.equal(s.reconciled,0);assert.equal(s.completed,0);assert.equal(s.failed,1);
});
test('verified subscription-only public inventory completes zero coffees without generic crawling or catalog reconciliation',async()=>{
 const {profile,result}=require('./fixtures/siteSupport/obscure-square.json');
 const s=state();s.profile=profile;s.discovery=result;
 const run=await crawler(s).crawl({...roaster,id:profile.entity_ids[0],website_url:'https://www.obscure.coffee'},[]);
 assert.equal(run.success,true);assert.equal(run.visitResults.coffeeFound,0);assert.equal(run.visitResults.aiCalls,0);assert.equal(run.visitResults.verifiedEmptyInventory,true);
 assert.equal(s.visits,0);assert.equal(s.bfs,0);assert.equal(s.sitemaps,0);assert.equal(s.reconciled,0);assert.equal(s.failed,0);assert.equal(s.completed,1);
 for(const mutate of [r=>delete r.empty_inventory_proof,r=>r.complete=false,r=>r.empty_inventory_proof.reference_checks.pop(),r=>r.empty_inventory_proof.reference_checks[0].status=503]){
  const other=state();other.profile=profile;other.discovery=structuredClone(result);mutate(other.discovery);
  await assert.rejects(crawler(other).crawl(roaster,[]),/Incomplete or empty/);assert.equal(other.completed,0);assert.equal(other.reconciled,0);assert.equal(other.bfs,0);
 }
});
test('reviewed alternate market bootstrap stays guarded and does not reconcile a different unavailable market',async()=>{
  for(const field of ['reconcile_omissions','inventory_authorizes_global_absence']){
    const s=state();s.profile={name:'Reviewed Merchant',hosts:['merchant.test','retail.test'],bootstrap_url:'https://retail.test/',[field]:false};
    await crawler(s).crawl(roaster,[]);assert.deepEqual(s.reads,['https://retail.test/']);assert.equal(s.discoveryRoaster.website_url,'https://retail.test/');assert.equal(s.discoveryRoaster.id,roaster.id);assert.equal(roaster.website_url,'https://merchant.test');
    assert.equal(s.visits,1);assert.equal(s.reconciled,0);assert.equal(s.completed,1);
  }
});
test('bootstrap cannot introduce an unverified host, HTTP or prohibited legal path',async()=>{
  for(const bootstrap_url of ['https://foreign.test/','http://merchant.test/','https://merchant.test/%74erms']){
    const s=state();s.profile={hosts:['merchant.test'],bootstrap_url};await assert.rejects(crawler(s).crawl(roaster,[]),/Unverified|Prohibited/);assert.equal(s.reads.length,0);assert.equal(s.created,0);
  }
});
test('registered .txt scope visits proved public coffee cards with explicit partial metrics and no omission reconciliation',async()=>{
 const profile=require('../src/siteSupport/profiles.json').find(p=>p.name==='.txt'),fixture=require('./fixtures/siteSupport/txt-public-products.json');
 const discovery=await require('../src/siteSupport/txt').discoverTxtProducts({},profile,async u=>({success:true,data:fixture.listings[u],finalUrl:u}));
 const s=state();s.profile=profile;s.discovery=discovery;const run=await crawler(s).crawl({id:profile.entity_ids[0],name:'.txt',website_url:profile.bootstrap_url},[]);
 assert.equal(run.success,true);assert.equal(run.visitResults.coffeeFound,7);assert.equal(s.visits,1);assert.equal(s.reconciled,0);assert.equal(s.sitemaps,0);assert.equal(s.bfs,0);assert.equal(s.completed,1);
 assert.equal(run.visitResults.inventoryComplete,false);assert.equal(run.visitResults.partialInventory,true);assert.equal(run.visitResults.inventoryScope,'published_english_homepage_and_coffee_collection');assert.equal(run.visitResults.omissionReconciliation,false);assert.equal(s.metrics.metrics.inventoryComplete,false);
 for(const mutate of [d=>d.error='HTTP 429',d=>d.observed_scope_complete=false,d=>d.urls=[],d=>delete d.evidence,d=>d.inventory_scope='unverified_catalog',d=>d.market_scope='KR',d=>d.urls[0]='https://foreign.test/shop_view/?idx=207',d=>d.evidence[0].native_indices.pop()]){
   const other=state();other.profile=profile;other.discovery=structuredClone(discovery);mutate(other.discovery);await assert.rejects(crawler(other).crawl(roaster,[]),/Supported merchant discovery failed/);assert.equal(other.visits,0);assert.equal(other.reconciled,0);assert.equal(other.completed,0);
 }
 const errors=state();errors.profile=profile;errors.discovery=discovery;errors.pageErrors=1;await assert.rejects(crawler(errors).crawl(roaster,[]),/Registered merchant product verification failed/);assert.equal(errors.completed,0);assert.equal(errors.reconciled,0);
});
