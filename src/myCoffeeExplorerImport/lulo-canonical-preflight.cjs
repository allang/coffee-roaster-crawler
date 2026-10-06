'use strict';
// Exact-scope read-only gate for eight newly observed canonical URLs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {loadManifest,DB_ORIGIN}=require('./product-only-crawl.cjs');
const {installLegalGuard}=require('./legal-guard.cjs');
async function main(){
 const [manifestFile,outFile]=process.argv.slice(2);assert(manifestFile&&outFile);
 const loaded=loadManifest(manifestFile);assert.equal(loaded.manifestHash,'ef1370a10e5134f4e1780db6b93aa33318af6f8ebb215e574b66b74f70372625');
 assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin,DB_ORIGIN);
 assert.equal(loaded.manifest.targets.length,1);const t=loaded.manifest.targets[0];assert.equal(t.entity_id,'ba539dac-1bf3-4cd7-98c5-0013f27502f4');assert.equal(t.products.length,8);
 const guard=installLegalGuard({internalDataOrigin:DB_ORIGIN});
 try{
  const db=require('/Users/allan/.openclaw/workspace/coffee-roaster-crawler/src/supabase.js').getSupabase();
  const urls=t.products.map(p=>p.url);
  const {data,error,count}=await db.from('known_pages').select('entity_id,url,status,classification',{count:'exact'}).eq('entity_id',t.entity_id).in('url',urls).limit(100);
  if(error)throw error;assert(Array.isArray(data));assert.equal(data.length,count);assert.equal(count,0,'Canonical URL has already been classified; stop for review');
  const proof={at:new Date().toISOString(),readOnly:true,databaseWrites:0,websiteRequests:0,manifestHash:loaded.manifestHash,entity_id:t.entity_id,urls,knownCanonicalCount:count,rows:data};
  fs.writeFileSync(path.resolve(outFile),JSON.stringify(proof,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({at:proof.at,manifestHash:proof.manifestHash,knownCanonicalCount:count,databaseWrites:0}));
 }finally{guard.uninstall();}
}
if(require.main===module)main().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
