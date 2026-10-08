'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {checkPlan,samePlace}=require('./import.cjs');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
function write(p,v){fs.writeFileSync(p+'.tmp',JSON.stringify(v,null,2),{mode:0o600});fs.renameSync(p+'.tmp',p);}
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function main(){
  const [mode,base,reviewKey='aliases']=process.argv.slice(2);if(!['preview','apply'].includes(mode)||!base||!['aliases','enrich_profile_aliases_review'].includes(reviewKey))throw Error('preview|apply BASE [aliases|enrich_profile_aliases_review]');
  const backup=path.join(base,reviewKey==='aliases'?'before-alias-reconciliation':'before-source-binding-correction'),journalPath=path.join(backup,'journal.json');
  const journal=fs.existsSync(journalPath)?read(journalPath):null;
  if(journal?.phase==='complete'){
    const installed=read(path.join(base,'plan.json')),installedCp=read(path.join(base,'checkpoint.json'));checkPlan(installed);
    if(installed.planHash!==journal.newPlanHash||installedCp.planHash!==journal.newPlanHash)throw Error('Completed reconciliation does not match installed plan/checkpoint');
    console.log('Alias reconciliation already complete; installed checkpoint preserved.');return;
  }
  const p=read(path.join(journal?backup:base,'plan.json')),cp=read(path.join(journal?backup:base,'checkpoint.json'));checkPlan(p);
  if(cp.planHash!==p.planHash||p.actions.some(a=>cp.entries[a.entity_id]?.status!=='complete'))throw Error('Main import must finish first');
  const verification=read(path.join(journal?backup:base,'verification.json'));
  if(verification.planHash!==p.planHash||verification.verified!==p.actions.length||verification.expected!==p.actions.length||!Array.isArray(verification.failures)||verification.failures.length||!cp.finishedAt||!(Date.parse(verification.at)>=Date.parse(cp.finishedAt)))throw Error('Successful verification of the completed current plan is required');
  const baseline=read(path.join(base,'snapshot.json')),input=read(path.join(base,'profile-aliases.json'));
  const aliases=input[reviewKey],ids=new Set(aliases.map(a=>a.entity_id));
  if(ids.size!==aliases.length||!aliases.length)throw Error('Invalid aliases');
  const oldIds=new Set(baseline.entities.map(e=>e.id)),actions=new Map(p.actions.map(a=>[a.entity_id,a]));
  for(const r of aliases){const a=actions.get(r.entity_id);
    const scoped=a&&(reviewKey==='aliases'?a.action==='create'&&!oldIds.has(a.entity_id):a.action==='enrich'&&oldIds.has(a.entity_id)&&!baseline.roles.some(v=>v.entity_id===a.entity_id)&&!a.locations.length&&!Object.keys(a.patch).length);
    if(!scoped||a.roles.join(',')!=='roaster'||!a.newRoles.includes('roaster')||a.sources.some(s=>!s.source_id.startsWith('roaster:'))||ids.has(r.canonical_entity_id)||!r.evidence)throw Error('Not a reviewed import-owned profile-only role: '+r.entity_id);
  }
  const lock=path.resolve('.state/my-coffee-explorer/apply.lock');let lockFd;
  if(fs.existsSync(lock))throw Error('Import/revision lock exists; inspect owner before recovery');
  if(mode==='apply'){lockFd=fs.openSync(lock,'wx',0o600);fs.writeFileSync(lockFd,JSON.stringify({pid:process.pid,planHash:p.planHash,operation:'alias_reconciliation'}));}
  try{
    const{createClient}=require('@supabase/supabase-js'),db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const q=async promise=>{const{data,error}=await promise;if(error)throw error;return data;};
    const allIds=[...new Set([...ids,...aliases.map(a=>a.canonical_entity_id)])];
    const entities=await q(db.from('entities').select('id,name,slug,name_slug,website_url,primary_location').in('id',allIds));
    const roles=await q(db.from('entity_roles').select('*').in('entity_id',allIds));
    const allSources=await q(db.from('entity_source_ids').select('*').in('entity_id',allIds));
    const sources=allSources.filter(s=>s.source==='my_coffee_explorer');
    const runs=await q(db.from('crawl_runs').select('entity_id,id').in('entity_id',[...ids]).limit(1));if(runs.length)throw Error('HOLD alias with any crawl history: '+runs[0].entity_id);
    const products=await q(db.from('products').select('entity_id,id').in('entity_id',[...ids]).limit(1));if(products.length)throw Error('HOLD alias with attached product: '+products[0].entity_id);
    // Production has entity_attributes, but not the repository's newer entity_merges migration.
    const merges=await q(db.from('entity_attributes').select('entity_id,attribute_key,attribute_value,source').in('entity_id',[...ids]));
    const byId=new Map(entities.map(e=>[e.id,e]));
    const revised=journal?read(path.join(backup,'revised-plan.json')):structuredClone(p);
    if(journal){checkPlan(revised);if(revised.planHash!==journal.newPlanHash||hash(revised.aliasRevision.aliases)!==hash(aliases))throw Error('Frozen alias revision mismatch');}
    else revised.actions=revised.actions.filter(a=>!ids.has(a.entity_id));
    const revisedById=new Map(revised.actions.map(a=>[a.entity_id,a]));
    for(const r of aliases){
      const a=actions.get(r.entity_id),e=byId.get(r.entity_id),canonical=byId.get(r.canonical_entity_id);
      if(!e||e.name!==a.entity.name||e.slug!==a.entity.slug||!canonical||!roles.some(v=>v.entity_id===canonical.id&&v.role==='roaster'))throw Error('Live identity/role mismatch');
      const ownedRoles=roles.filter(v=>v.entity_id===e.id);if(ownedRoles.some(v=>v.role!=='roaster'))throw Error('Alias acquired another role');
      for(const row of ownedRoles){const m=row.role_metadata;if(!m?.provenance?.public_directories?.my_coffee_explorer?.imported_at||Object.keys(m).join(',')!=='provenance'||Object.keys(m.provenance).join(',')!=='public_directories'||Object.keys(m.provenance.public_directories).join(',')!=='my_coffee_explorer')throw Error('Unowned role metadata');}
      for(const s of a.sources){const owner=sources.find(v=>v.source_id===s.source_id);if(!owner||![e.id,canonical.id].includes(owner.entity_id))throw Error('Source ownership changed');}
      if(allSources.some(s=>s.entity_id===e.id&&!a.sources.some(v=>v.source_id===s.source_id&&s.source===v.source)&&!(reviewKey==='enrich_profile_aliases_review'&&baseline.sourceIds.some(v=>v.id===s.id&&v.entity_id===s.entity_id&&v.source===s.source&&v.source_id===s.source_id))))throw Error('HOLD alias with unreviewed source association: '+e.id);
      if(reviewKey==='aliases'&&merges.some(m=>m.entity_id===e.id&&(m.attribute_key!=='canonical_roaster_entity_id'||m.attribute_value!==canonical.id||m.source!=='my_coffee_explorer')))throw Error('HOLD alias with conflicting or unreviewed attributes: '+e.id);
      if(journal)continue;
      let target=revisedById.get(canonical.id);
      if(!target){target={entity_id:canonical.id,action:'enrich',entity:canonical,before:{website_url:canonical.website_url,primary_location:canonical.primary_location},roles:['roaster'],newRoles:[],locations:[],sources:[],reasons:[],patch:{}};revised.actions.push(target);revisedById.set(canonical.id,target);}
      for(const s of a.sources)if(!target.sources.some(v=>v.source_id===s.source_id))target.sources.push(s);
      for(const l of a.locations)if(!target.locations.some(v=>samePlace(v,l)))target.locations.push(l);
      target.reasons.push({reason:'reviewed_profile_alias',alias_entity_id:e.id,evidence:r.evidence});
    }
    if(!journal){revised.summary={...revised.summary,entities:revised.actions.length,create:revised.actions.filter(a=>a.action==='create').length,enrich:revised.actions.filter(a=>a.action==='enrich').length,newRoasterRoles:revised.actions.filter(a=>a.newRoles.includes('roaster')).length,sources:revised.actions.reduce((n,a)=>n+a.sources.length,0)};
    revised.aliasRevision={previousPlanHash:p.planHash,aliases};delete revised.planHash;revised.planHash=hash(revised);checkPlan(revised);
    }
    if(journal&&journal.newPlanHash!==revised.planHash)throw Error('Revision changed on retry');
    const revisedCp=journal?read(path.join(backup,'revised-checkpoint.json')):structuredClone(cp);
    if(journal){if(revisedCp.planHash!==revised.planHash||hash(revisedCp)!==journal.newCheckpointHash)throw Error('Frozen checkpoint mismatch');}
    else {for(const r of aliases){(revisedCp.retiredAliases||={})[r.entity_id]=revisedCp.entries[r.entity_id];delete revisedCp.entries[r.entity_id];delete revisedCp.entries[r.canonical_entity_id];}revisedCp.planHash=revised.planHash;delete revisedCp.finishedAt;}
    console.log(JSON.stringify({mode,aliases:aliases.length,newPlanHash:revised.planHash,summary:revised.summary}));if(mode==='preview')return;
    fs.mkdirSync(backup,{recursive:true});
    for(const n of ['plan.json','checkpoint.json','verification.json'])if(!fs.existsSync(path.join(backup,n)))fs.copyFileSync(path.join(base,n),path.join(backup,n),fs.constants.COPYFILE_EXCL);
    if(!fs.existsSync(path.join(backup,'audit.json')))write(path.join(backup,'audit.json'),{at:new Date().toISOString(),entities,roles,sources:allSources,aliases,reviewKey});
    if(!journal){write(path.join(backup,'revised-plan.json'),revised);write(path.join(backup,'revised-checkpoint.json'),revisedCp);}
    const journalHashes={oldPlanHash:p.planHash,newPlanHash:revised.planHash,newCheckpointHash:hash(revisedCp)};
    write(journalPath,{...journalHashes,phase:'mutating'});
    for(const r of aliases){const a=actions.get(r.entity_id);
      if(reviewKey==='aliases'){
      await q(db.from('entity_attributes').upsert({entity_id:r.entity_id,attribute_key:'canonical_roaster_entity_id',attribute_value:r.canonical_entity_id,source:'my_coffee_explorer'},{onConflict:'entity_id,attribute_key',ignoreDuplicates:true}));
      const binding=await q(db.from('entity_attributes').select('attribute_value,source').eq('entity_id',r.entity_id).eq('attribute_key','canonical_roaster_entity_id').single());
      if(binding.attribute_value!==r.canonical_entity_id||binding.source!=='my_coffee_explorer')throw Error('Alias binding changed concurrently');
      }
      for(const s of a.sources){
        const source=sources.find(v=>v.source_id===s.source_id);
        if(source.entity_id===r.entity_id){const changed=await q(db.from('entity_source_ids').update({entity_id:r.canonical_entity_id}).eq('id',source.id).eq('entity_id',r.entity_id).select('id'));if(changed.length!==1)throw Error('Source moved concurrently');}
      }
      for(const row of roles.filter(v=>v.entity_id===r.entity_id)){const removed=await q(db.from('entity_roles').delete().eq('entity_id',row.entity_id).eq('role','roaster').eq('role_metadata',JSON.stringify(row.role_metadata)).select('entity_id'));if(removed.length!==1)throw Error('Alias role changed concurrently');}
      fs.appendFileSync(path.join(backup,'progress.ndjson'),JSON.stringify({at:new Date().toISOString(),alias:r.entity_id,canonical:r.canonical_entity_id})+'\n',{mode:0o600});
    }
    const remaining=await q(db.from('entity_roles').select('entity_id').in('entity_id',[...ids]).eq('role','roaster'));if(remaining.length)throw Error('Alias role remains');
    write(path.join(base,'plan.json'),revised);write(path.join(base,'checkpoint.json'),revisedCp);
    write(journalPath,{...journalHashes,phase:'complete',at:new Date().toISOString()});
    console.log('Profile sources moved to canonical brands; alias entities retained with merge audit. Run apply and verify.');
  }finally{if(lockFd!==undefined){fs.closeSync(lockFd);fs.unlinkSync(lock);}}
}
if(require.main===module)main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
