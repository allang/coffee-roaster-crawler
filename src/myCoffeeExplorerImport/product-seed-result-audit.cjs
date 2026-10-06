'use strict';
// Read-only live proof. Credentials remain in the production runtime.
const fs=require('node:fs'),path=require('node:path');
const {loadManifest,DB_ORIGIN}=require('./product-only-crawl.cjs');
const {installLegalGuard}=require('./legal-guard.cjs');
async function query(q){const {data,error}=await q;if(error)throw error;return data||[];}
async function main(){
 const [file,output,mode='after']=process.argv.slice(2);if(!file||!output||!['before','after'].includes(mode))throw Error('Expected manifest output before|after');
 const loaded=loadManifest(file),targets=loaded.manifest.targets;if(targets.length>50)throw Error('Bound exceeded');
 if(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin!==DB_ORIGIN)throw Error('Wrong runtime');
 const guard=installLegalGuard({internalDataOrigin:DB_ORIGIN});process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';
 try {
  const db=require('/Users/allan/.openclaw/workspace/coffee-roaster-crawler/src/supabase.js').getSupabase();
  const ids=targets.map(t=>t.entity_id),products=await query(db.from('products').select('id,entity_id,name,slug,source_url,metadata,is_active').in('entity_id',ids).limit(1000));
  if(products.length>=1000)throw Error('Result may be truncated');
  const pids=products.map(p=>p.id),facts=pids.length?await query(db.from('coffee_facts').select('*').in('product_id',pids)):[],variants=pids.length?await query(db.from('product_variants').select('*').in('product_id',pids)):[],media=pids.length?await query(db.from('product_media').select('*').in('product_id',pids)):[];
  const runs=await query(db.from('crawl_runs').select('id,entity_id,status,started_at,finished_at,pages_visited,coffees_found,error,meta').in('entity_id',ids).order('started_at',{ascending:false}).limit(100));
  const unexpectedProducts=products.filter(p=>!targets.find(t=>t.entity_id===p.entity_id)?.products.some(u=>u.url===p.source_url));
  const duplicateSources=products.filter((p,i)=>products.findIndex(q=>q.entity_id===p.entity_id&&q.source_url===p.source_url)!==i);
  const contaminatedProcess=facts.filter(f=>f.process&&f.process===f.variety);
  const proof={at:new Date().toISOString(),readOnly:true,mode,manifestHash:loaded.manifestHash,targetCount:ids.length,productCount:products.length,variantCount:variants.length,factCount:facts.length,mediaLinkCount:media.length,unexpectedProducts,duplicateSources,contaminatedProcess,products,facts,variants,media,runs};
  fs.writeFileSync(path.resolve(output),JSON.stringify(proof,null,2)+'\n',{mode:0o600,flag:'wx'});
  if(mode==='before'&&(products.length||runs.some(r=>r.status==='running')))throw Error('Pilot preflight requires zero existing products and no active run');
  if(unexpectedProducts.length||duplicateSources.length||contaminatedProcess.length)throw Error('Product result needs review');
  console.log(JSON.stringify({at:proof.at,mode,targetCount:ids.length,products:products.length,variants:variants.length,facts:facts.length,mediaLinks:media.length,runs:runs.map(r=>({entity_id:r.entity_id,status:r.status,pages_visited:r.pages_visited,coffees_found:r.coffees_found,scope:r.meta?.scope}))}));
 }finally{guard.uninstall();}
}
main().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
