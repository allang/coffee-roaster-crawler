'use strict';
// Offline replay of the real visitor, saver and catalog functions. The model,
// merchant and image boundaries are deterministic fixtures; no network/keys.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const {catalogDb,supabaseAdapter}=require('../test/catalogDb');
const {fixture,html,visitor,owner,url,log}=require('../test/aiEfficiencyFixtures.cjs');
const baseline=process.argv[2],output=process.argv[3];
if(!/^[a-f0-9]{40}$/.test(baseline || '')||!output)throw Error('Usage: node scripts/benchmark-ai-efficiency.cjs BASELINE_SHA OUTPUT_JSON');
async function replay(root,failedSave){
 const pg=await catalogDb({nativeWeightCompatibility:!failedSave});try{
  await pg.query('insert into entities(id) values($1)',[owner]);
  if(failedSave)await pg.query('create unique index product_variants_unique_weight_per_product on product_variants(product_id,weight_g) where weight_g is not null');
  const state=fixture(),module=visitor(supabaseAdapter(pg),state,root),passes=[];
  for(let i=0;i<(failedSave?3:2);i++){
   if(i){state.html=html('Cart and recommendations changed '+i);state.native.variants[0].price='14.00';state.native.variants[0].available=false;}
   if(i===2)await pg.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261008155858_native_variant_weight_compat.sql'),'utf8'));
   const prior=state.aiCalls+state.translationCalls,knownPages=new Map((await pg.query('select * from known_pages')).rows.map(r=>[r.url,r]));
   const result=await module.visitAllPages(owner,[url],{markVisited(){}},log,'shopify',{knownPages});
   passes.push({pass:i+1,errors:result.errors,classification_cache_hits:result.cacheHits,model_requests:state.aiCalls+state.translationCalls-prior});
  }
  const variants=(await pg.query('select merchant_variant_id,price_minor_units,currency,weight_g,availability_state from product_variants order by merchant_variant_id')).rows;
  assert.equal(variants.length,2);assert.equal(variants[0].price_minor_units,1400);assert.equal(variants[0].availability_state,'sold_out');
  return{passes,total_model_requests:state.aiCalls+state.translationCalls,classification_requests:state.aiCalls,translation_requests:state.translationCalls,final_variants:variants};
 }finally{await pg.close();}
}
(async()=>{
 const project=path.resolve(__dirname,'..'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'coffee-ai-replay-'));
 const archive=cp.execFileSync('git',['archive',baseline,'src','data'],{cwd:project,maxBuffer:20*1024*1024});cp.execFileSync('tar',['-x','-C',directory],{input:archive});fs.symlinkSync(path.join(project,'node_modules'),path.join(directory,'node_modules'),'dir');
 const scenarios=[];
 for(const [name,failed]of [['ordinary_refresh',false],['failed_catalog_save_then_recovery',true]]){
  const before=await replay(path.join(directory,'src'),failed),after=await replay(path.join(project,'src'),failed);assert.deepEqual(after.final_variants,before.final_variants);
  scenarios.push({name,baseline:before,optimized:after,requests_avoided:before.total_model_requests-after.total_model_requests,reduction_percent:100*(1-after.total_model_requests/before.total_model_requests)});
 }
 const result={generated_at:new Date().toISOString(),baseline_sha:baseline,scope:'Offline deterministic replay using the real extraction/translation/saver/catalog paths. Model, merchant and image calls are mocked. No paid API calls, production writes or live crawl. This measures request avoidance and output parity, not production wall-clock speed, output quality under lower reasoning, or fleet-wide savings.',scenarios};
 fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
