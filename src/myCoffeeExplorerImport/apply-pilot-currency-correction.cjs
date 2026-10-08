'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {backendFor,validateOwner,DB_ORIGIN}=require('./product-only-crawl.cjs');
const {installLegalGuard}=require('./legal-guard.cjs');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
async function query(q){const {data,error}=await q;if(error)throw error;return data;}
async function main(){
 const [baseArg,mode='preview']=process.argv.slice(2);assert(['preview','apply'].includes(mode));const base=path.resolve(baseArg),file=path.join(base,'pilot4-currency-correction-plan.json'),p=JSON.parse(fs.readFileSync(file));const {planHash,...body}=p;
 assert.equal(planHash,'302cd083ff08aedd9c2d457401476d5e18d8e201118a0e91c1871ae4e5af4ecc');assert.equal(hash(JSON.stringify(body)),planHash);assert.equal(p.database_origin,DB_ORIGIN);assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin,DB_ORIGIN);
 assert.deepEqual(p.actions.map(a=>a.variant_id).sort(),['67038481-ab91-4465-ab45-420fe154f432','7a8ec907-8544-492c-bc94-d8ef8327eb0e'].sort());
 for(const r of p.evidence_receipts)assert.equal(hash(fs.readFileSync(path.join(base,r.file))),r.sha256);
 const guard=installLegalGuard({internalDataOrigin:DB_ORIGIN});let fd;const lock=path.resolve('.state/my-coffee-explorer/apply.lock'),result={at:new Date().toISOString(),planHash,mode,entries:[]};
 const output=path.join(base,mode==='apply'?'pilot4-currency-correction-applied.json':'pilot4-currency-correction-preview.json');assert(!fs.existsSync(output),'Preserve existing result');
 const save=()=>{fs.writeFileSync(output+'.tmp',JSON.stringify(result,null,2)+'\n',{mode:0o600});fs.renameSync(output+'.tmp',output);};
 try{
  if(mode==='apply'){fd=fs.openSync(lock,'wx',0o600);fs.writeSync(fd,JSON.stringify({pid:process.pid,planHash,startedAt:result.at}));}
  process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';const db=require('/Users/allan/.openclaw/workspace/coffee-roaster-crawler/src/supabase.js').getSupabase(),backend=backendFor(db),target={entity_id:p.entity_id,website_url:p.website_url,source_ids:p.source_ids};
  async function inspect(a){
   validateOwner(target,await backend.state(target));assert.equal(a.table,'product_variants');assert.deepEqual(a.patch,{currency:'CAD'});assert.equal(a.before.currency,'CND');
   const product=await query(db.from('products').select('id,entity_id,source_url,metadata').eq('id',a.product_id).single());const expected=a.product_preconditions;
   for(const k of ['id','entity_id','source_url'])assert.equal(product[k],expected[k]);assert.equal(product.metadata.default_price,expected.metadata_default_price);assert.equal(hash(JSON.stringify(product.metadata)),expected.metadata_sha256);
   const variant=await query(db.from('product_variants').select('*').eq('id',a.variant_id).single());
   const already=variant.currency==='CAD';for(const [k,v]of Object.entries(a.before)){if(already&&['currency','updated_at'].includes(k))continue;assert.deepEqual(variant[k],v,'Variant changed: '+k);}
   return {variant,already,metadataHash:hash(JSON.stringify(product.metadata))};
  }
  // Validate both rows before the first mutation.
  for(const a of p.actions)await inspect(a);
  for(const a of p.actions){const before=await inspect(a),entry={variant_id:a.variant_id,product_id:a.product_id,before:before.variant,status:'checked'};result.entries.push(entry);save();
   if(mode==='apply'&&!before.already){let q=db.from('product_variants').update({currency:'CAD'});for(const [k,v]of Object.entries(a.compare_and_set.equals))q=q.eq(k,v);for(const k of a.compare_and_set.is_null)q=q.is(k,null);const changed=await query(q.select('*'));assert.equal(changed.length,1,'CAS must change exactly one variant');}
   const after=await inspect(a);if(mode==='apply')assert.equal(after.variant.currency,'CAD');entry.after=after.variant;entry.metadataHash=after.metadataHash;entry.status=mode==='apply'?'verified':'preview';save();
  }
  result.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({planHash,mode,verified:result.entries.length,onlyField:'currency',priceAndRawMetadataPreserved:true}));
 }finally{guard.uninstall();if(fd!==undefined){fs.closeSync(fd);fs.unlinkSync(lock);}}
}
main().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
