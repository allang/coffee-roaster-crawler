'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function roastersModule({entities=[],missingTier=false,error=null,states=[],stateError=null,recent=[]}={}) {
  const calls=[],stateCalls=[],log=new Proxy({},{get:()=>()=>{}}),db={from(table){
    let fields='';const ordering=[],limits=[],q={select(value){fields=value;return q;},eq(){return q;},order(key,options){ordering.push({key,options});return q;},limit(count,options){limits.push({count,options});return q;},
      async range(a,b){assert.deepEqual(ordering,[{key:'id',options:{ascending:true}},{key:'created_at',options:{referencedTable:'latest_crawl',ascending:false}}]);assert.deepEqual(limits,[{count:1,options:{referencedTable:'latest_crawl'}}]);assert(fields.includes('latest_crawl:crawl_runs(created_at)'));calls.push({fields,a,b});return {data:error?null:missingTier && fields.includes('roaster_tier')?null:entities.slice(a,b+1).map(r=>({latest_crawl:[],...r})),error:error || (missingTier && fields.includes('roaster_tier')?{code:'42703',message:'column entities.roaster_tier does not exist'}:null)};},
      async in(key,ids){assert.equal(table,'entity_crawl_state');assert.equal(key,'entity_id');stateCalls.push(ids);return {data:states.filter(s=>ids.includes(s.entity_id)),error:stateError};},
    };return q;
  }};
  const file=path.join(__dirname,'../src/roasters.js'),module={exports:{}};
  vm.runInThisContext('(function(require,module,exports){'+fs.readFileSync(file,'utf8')+'\n})',{filename:file})(name=>{
    if(name==='./supabase')return {getSupabase:()=>db};if(name==='./crawlRuns')return {getRecentCrawlRuns:async()=>recent};if(name==='./logger')return log;if(name==='./crawlTierPlan')return require('../src/crawlTierPlan');if(name==='./crawlPriority')return require('../src/crawlPriority');throw Error('Unexpected dependency');
  },module,module.exports);return {...module.exports,calls,stateCalls};
}
test('missing tier column falls back only to the reviewed stable IDs',async()=>{
  const m=roastersModule({missingTier:true,entities:[{id:'fee5aaa2-09c2-4bde-949d-16471a91793c',name:'Preface Coffee'},{id:'11a426df-0146-4a5c-a123-ef7725c13926',name:'Dak'},{id:'2442b266-fb8c-43f6-a7e5-589c6bf94bc5',name:'Luna Coffee Roasters'},{id:'outside',name:'New roaster'}]});
  const rows=await m.getRoasterEntities();assert.deepEqual(rows.map(r=>r.roaster_tier),[1,1,null,null]);assert(rows.every(r=>r.crawl_tier_source==='reviewed_mapping'));assert.equal(m.calls.length,2);
});
test('database assignments, including null and tier nine, override the fallback manifest',async()=>{
  const m=roastersModule({entities:[{id:'fee5aaa2-09c2-4bde-949d-16471a91793c',roaster_tier:9},{id:'8f69eeb4-2d62-4aea-8024-d2855b01e593',roaster_tier:null}]});
  const rows=await m.getRoasterEntities();assert.deepEqual(rows.map(r=>r.roaster_tier),[9,null]);assert(rows.every(r=>r.crawl_tier_source==='database'));assert.equal(m.calls.length,1);
});
test('deployed schema fallback assigns the curated existing and new records by ID',async()=>{
  const curated=require('../data/reddit-roaster-tier-update.json').assignments;
  const m=roastersModule({missingTier:true,entities:curated.map(t=>({id:t.id,name:t.name,website_url:t.website_url}))});
  const rows=await m.getRoasterEntities();
  assert.deepEqual(rows.map(r=>r.roaster_tier),curated.map(t=>t.tier));
  assert(rows.every(r=>r.crawl_tier_source==='reviewed_mapping'));
});
test('permissions or unrelated query errors do not silently select fallback tiers',async()=>{
  const error={code:'42501',message:'permission denied for entities'},m=roastersModule({error});await assert.rejects(m.getRoasterEntities(),e=>e===error);assert.equal(m.calls.length,1);
});
test('catalog pagination keeps a stable ID order and preserves every returned roaster',async()=>{
  const entities=Array.from({length:1001},(_,i)=>({id:String(i).padStart(4,'0'),roaster_tier:null})),m=roastersModule({entities});
  const result=await m.getRoasterEntities();assert.equal(result.length,1001);assert.deepEqual(m.calls.map(c=>c.a),[0,1000]);assert.equal(new Set(result.map(r=>r.id)).size,1001);
});
test('tier ordering retains disabled, no-website and 24-hour exclusions with bounded state queries',async()=>{
  const entities=Array.from({length:53},(_,i)=>({id:'id-'+i,name:'Roaster '+i,website_url:i===2?' ': 'https://merchant.test',roaster_tier:1}));
  const m=roastersModule({states:[{entity_id:'id-3',allow_crawl:false},{entity_id:'id-52',allow_crawl:false}],recent:[{entity_id:'id-0',status:'completed'},{entity_id:'id-1',status:'running'}]});
  const eligible=await m.filterRoastersForCrawling(entities);assert.equal(eligible.length,48);assert(!eligible.some(r=>['id-0','id-1','id-2','id-3','id-52'].includes(r.id)));assert.deepEqual(m.stateCalls.map(ids=>ids.length),[50,3]);
});
test('failed eligibility reads prevent crawling rather than losing disabled-roaster controls',async()=>{
  const error={code:'42501',message:'permission denied'},m=roastersModule({stateError:error});await assert.rejects(m.filterRoastersForCrawling([{id:'one',website_url:'https://merchant.test'}]),e=>e===error);
});
test('an explicitly absent optional control table preserves the deployed cooldown rules',async()=>{
  const m=roastersModule({stateError:{code:'PGRST205',message:"Could not find the table 'public.entity_crawl_state' in the schema cache"},recent:[{entity_id:'recent'}]});
  const eligible=await m.filterRoastersForCrawling([{id:'recent',website_url:'https://merchant.test'},{id:'one',website_url:'https://merchant.test'},{id:'missing',website_url:null}]);
  assert.deepEqual(eligible.map(r=>r.id),['one']);assert.equal(m.stateCalls.length,1);
});
test('latest attempt includes failed history and orders untouched, oldest, then recent attempts',async()=>{
  const m=roastersModule({entities:[
    {id:'recent-failure',website_url:'https://merchant.test',latest_crawl:[{created_at:'2026-10-09T03:23:50Z'}]},
    {id:'untouched-b',website_url:'https://merchant.test'},
    {id:'old',website_url:'https://merchant.test',latest_crawl:[{created_at:'2026-08-01T00:00:00Z'}]},
    {id:'untouched-a',website_url:'https://merchant.test'},
  ]});
  const rows=await m.getRoasterEntities(),eligible=await m.filterRoastersForCrawling(rows);
  assert.deepEqual(eligible.map(r=>r.id),['untouched-a','untouched-b','old','recent-failure']);
  assert.equal(eligible.at(-1).last_crawl_attempt_at,'2026-10-09T03:23:50Z');
});
test('unknown or malformed attempt history fails instead of labeling a roaster untouched',async()=>{
  for(const latest_crawl of [null,[{created_at:null}],[{created_at:'invalid'}],[{created_at:'2026-10-09T00:00:00Z'},{created_at:'2026-10-08T00:00:00Z'}]]) {
    const m=roastersModule({entities:[{id:'one',latest_crawl}]});await assert.rejects(m.getRoasterEntities(),/Invalid latest crawl history/);
  }
});
