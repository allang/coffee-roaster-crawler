#!/usr/bin/env node
'use strict';
// Planning reads only. Applying requires an explicit reviewed plan and verifies
// each product identity, current primary photo, bytes and absent media again.
const fs=require('node:fs');
const {getSupabase}=require('../src/supabase');
const {createReader}=require('../src/siteSupport/network');
const {fetchSourceImage}=require('../src/sourceImage');
const {hasPhoto,inspectPhoto,applyPhoto}=require('../src/photoRepair');
const manifest=require('../data/crawl-tier-assignments.json');
const profiles=require('../src/siteSupport/profiles.json');
const owners=new Map(manifest.assignments.filter(a=>a.tier===1).map(a=>[a.entity_id,a.name]));
async function allRows(db,table,select,ids) {
  const rows=[];
  for(let i=0;i<ids.length;i+=20)for(let offset=0;;offset+=1000){const {data,error}=await db.from(table).select(select).in(table==='entities'?'id':'entity_id',ids.slice(i,i+20)).order('id').range(offset,offset+999);if(error)throw error;rows.push(...data);if(data.length<1000)break;}
  return rows;
}
function merchantReader(entity) {
  const url=new URL(entity.website_url),host=url.hostname.toLowerCase().replace(/^www\./,'');
  const profile=profiles.find(p=>p.entity_ids.includes(entity.id));
  return createReader({hosts:[...new Set([host,'www.'+host,...profile?.hosts || []])]});
}
async function main(args=process.argv.slice(2)) {
  const [mode,file,resultFile]=args;
  if(!['plan','apply'].includes(mode) || !file || mode==='apply' && !resultFile)throw Error('Usage: repair-tier-one-photos.js plan PLAN.json [--recent] | apply PLAN.json RESULT.json');
  const db=getSupabase(),entities=await allRows(db,'entities','id,name,website_url',[...owners.keys()]),byId=new Map(entities.map(e=>[e.id,e]));
  const readers=new Map();
  function dependencies(owner){if(!owners.has(owner) || !byId.get(owner)?.website_url)throw Error('Unverified tier one owner or missing official website');if(!readers.has(owner))readers.set(owner,merchantReader(byId.get(owner)));return {db,fetchPage:readers.get(owner).fetchHtml,fetchImage:fetchSourceImage};}
  let entries=[],productsRead=0;
  if(mode==='plan') {
    const products=await allRows(db,'products','id,entity_id,name,source_url,product_type,is_active,is_available,last_seen_at,availability_last_seen_at,product_media(media_assets(url))',[...owners.keys()]);productsRead=products.length;
    const cutoff=Date.now()-30*86400_000;
    const reviewIndex=args.indexOf('--review-plan');
    const prior=reviewIndex>=0?JSON.parse(fs.readFileSync(args[reviewIndex+1],'utf8')):null;
    if(prior && (prior.version!==1 || prior.mode!=='read-only-photo-plan' || prior.source_commit!==manifest.source_commit))throw Error('Invalid prior read-only plan');
    const priorReady=prior?new Set(prior.entries.filter(e=>e.status==='ready').map(e=>e.product_id)):null;
    if(prior)entries=prior.entries.filter(e=>e.status!=='ready');
    const missing=products.filter(p=>p.product_type==='coffee' && (priorReady?priorReady.has(p.id):!hasPhoto(p)) && (!args.includes('--recent') || ['last_seen_at','availability_last_seen_at'].some(k=>Date.parse(p[k])>=cutoff)));
    // Sequential within each merchant; different merchants can be checked together.
    const groups=[...new Set(missing.map(p=>p.entity_id))].map(id=>missing.filter(p=>p.entity_id===id));let index=0;
    await Promise.all(Array.from({length:3},async()=>{while(index<groups.length){const group=groups[index++];for(const product of group){try{entries.push({...await inspectPhoto({...product,roaster:owners.get(product.entity_id)},dependencies(product.entity_id)),roaster:owners.get(product.entity_id)});}catch(error){entries.push({product_id:product.id,entity_id:product.entity_id,source_url:product.source_url,name:product.name,roaster:owners.get(product.entity_id),status:'held',reason:error.message});}}console.log(JSON.stringify({roaster:owners.get(group[0].entity_id),checked:group.length,ready:entries.filter(e=>e.entity_id===group[0].entity_id && e.status==='ready').length}));}}));
  } else {
    const plan=JSON.parse(fs.readFileSync(file,'utf8'));
    if(plan.version!==1 || plan.mode!=='read-only-photo-plan' || plan.source_commit!==manifest.source_commit)throw Error('Unrecognized or outdated reviewed photo plan');
    for(const entry of plan.entries.filter(e=>e.status==='ready')) {try{entries.push(await applyPhoto(entry,dependencies(entry.entity_id)));}catch(error){entries.push({product_id:entry.product_id,status:'failed',reason:error.message});}}
  }
  entries.sort((a,b)=>a.product_id.localeCompare(b.product_id));
  const counts=entries.reduce((m,e)=>(m[e.status]=(m[e.status] || 0)+1,m),{});
  const report={version:1,mode:mode==='plan'?'read-only-photo-plan':'photo-repair-result',checked_at:new Date().toISOString(),source_commit:manifest.source_commit,products_read:productsRead,scope:args.includes('--recent')?'seen_in_last_30_days':'all_verified_tier_one_coffees',production_writes:mode==='plan'?0:undefined,counts,entries};
  fs.writeFileSync(mode==='plan'?file:resultFile,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({mode:report.mode,scope:report.scope,products_read:productsRead,counts,output:mode==='plan'?file:resultFile}));
  if(counts.failed)process.exitCode=1;
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main,merchantReader};
