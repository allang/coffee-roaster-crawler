'use strict';
// Filesystem-only progress; distinguishes observed checkpoint results from DB read-back.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=process.argv[2]||__dirname,sha=x=>crypto.createHash('sha256').update(x).digest('hex'),read=f=>fs.existsSync(f)?JSON.parse(fs.readFileSync(f)):null;
const batches=[],owners=new Set(),urls=new Set(),observedProducts=new Set(),verifiedProducts=new Set();
const superseded=new Map((read(path.join(base,'product-seed-reviewed-subsets.receipt.json'))?.entries||[]).map(e=>[e.original_manifest.file,{hash:e.original_manifest.sha256,replacement:e.reviewed_manifest.file}]));
for(const tag of fs.readdirSync(base).filter(x=>/^product-seed-[a-z0-9-]+$/.test(x)&&fs.statSync(path.join(base,x)).isDirectory())){
 const dir=path.join(base,tag),mf=path.join(dir,'manifest.json');if(!fs.existsSync(mf))continue;
 const bytes=fs.readFileSync(mf),hash=sha(bytes),m=JSON.parse(bytes),out=path.join(dir,'product-only-'+hash.slice(0,12)),cp=read(path.join(out,'checkpoint.json')),summary=read(path.join(out,'summary.json'));
 const queueDirs=['finite-product-queue-v1','finite-product-queue-v2','finite-product-queue-v3'].map(q=>path.join(base,q,tag)).filter(d=>fs.existsSync(d));
 if(queueDirs.length>1)throw Error('Owner batch reserved in multiple queues '+tag);
 const queueDir=queueDirs[0]||path.join(base,'finite-product-queue-v1',tag),terminal=read(path.join(queueDir,'terminal.json'));
 if(terminal&&(terminal.manifestHash!==hash||terminal.terminal!==true||!fs.existsSync(path.join(queueDir,'after.json'))||terminal.after_sha256!==sha(fs.readFileSync(path.join(queueDir,'after.json')))))throw Error('Invalid finite queue terminal receipt '+tag);
 const before=read(path.join(dir,'preflight.json'))||read(path.join(queueDir,'before.json')),audit=read(path.join(dir,'result-audit.json'))||(terminal?read(path.join(queueDir,'after.json')):null);
 const replacement=superseded.get(tag+'/manifest.json');if(replacement){if(replacement.hash!==hash||cp||summary||audit)throw Error('Supersession no longer unlaunched '+tag);batches.push({tag,manifestHash:hash,status:'superseded_unlaunched_do_not_run',replacement:replacement.replacement,targetCount:m.targets.length,urlCount:m.targets.reduce((n,t)=>n+t.products.length,0),verifiedNewProducts:null});continue;}
 for(const doc of [cp,summary,before,audit])if(doc&&doc.manifestHash!==hash)throw Error('Wrong scope receipt '+tag);
 const allowed=new Set(m.targets.flatMap(t=>t.products.map(p=>t.entity_id+'\n'+p.url)));
 for(const t of m.targets){owners.add(t.entity_id);for(const p of t.products)urls.add(t.entity_id+'\n'+p.url);}
 const states={},errors={};for(const r of Object.values(cp?.results||{})){if(!allowed.has(r.entityId+'\n'+r.url))throw Error('Checkpoint outside manifest '+tag);states[r.status]=(states[r.status]||0)+1;if(r.error)errors[r.error]=(errors[r.error]||0)+1;if(r.status==='complete'&&r.isCoffee&&r.productId)observedProducts.add(r.productId);}
 let verifiedNewProducts=null;
 if(audit){if(audit.unexpectedProducts.length||audit.duplicateSources.length||audit.contaminatedProcess.length)throw Error('Unaudited product issue '+tag);if(before?.productCount===0){verifiedNewProducts=audit.products.length;for(const p of audit.products)verifiedProducts.add(p.id);}}
 batches.push({tag,manifestHash:hash,targetCount:m.targets.length,urlCount:m.targets.reduce((n,t)=>n+t.products.length,0),checkpointStates:states,errors,finishedAt:summary?.finishedAt||null,databaseReadbackAt:audit?.at||null,verifiedNewProducts,scope:'observed_product_urls_only',inventoryComplete:false});
}
const report={at:new Date().toISOString(),offlineOnly:true,distinctSeedOwners:owners.size,distinctObservedSeedUrls:urls.size,checkpointCoffeeProductIds:observedProducts.size,verifiedNewProductIds:verifiedProducts.size,batches,limits:['Counts cover finite observed product URLs, not complete site inventories.','Verified new products require zero-product preflight and exact-owner/source post-run DB read-back.','Product field quality corrections are separate audited receipts; this report proves persistence and identity, not every extracted attribute.','Prepared manifests are reservations, not proof that a job ran.']};
fs.writeFileSync(path.join(base,'product-seed-status.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));
