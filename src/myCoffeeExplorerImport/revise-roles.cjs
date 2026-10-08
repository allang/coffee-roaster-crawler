'use strict';
// Correct only this import's new branch roaster roles; preserve IDs and provenance.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {checkPlan}=require('./import.cjs');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
function write(p,x){fs.writeFileSync(p+'.tmp',JSON.stringify(x,null,2),{mode:0o600});fs.renameSync(p+'.tmp',p);}
function revise(p,baseline,corrections){
  checkPlan(p);const revised=structuredClone(p),byId=new Map(revised.actions.map(a=>[a.entity_id,a]));
  const oldRoles=new Set(baseline.roles.filter(r=>r.role==='roaster').map(r=>r.entity_id));
  const seen=new Set();
  for(const c of corrections){
    if(seen.has(c.entity_id)||c.entity_id===c.canonical_entity_id)throw Error('Duplicate or self correction');seen.add(c.entity_id);
    const a=byId.get(c.entity_id),canonical=byId.get(c.canonical_entity_id);
    if(!a||!a.newRoles.includes('roaster')||oldRoles.has(c.entity_id))throw Error('Not an import-owned new roaster role: '+c.entity_id);
    if(!oldRoles.has(c.canonical_entity_id)&&!canonical?.roles.includes('roaster'))throw Error('Canonical lacks roaster role');
    if(!c.evidence)throw Error('Evidence required');
    a.roles=a.roles.filter(r=>r!=='roaster');a.newRoles=a.newRoles.filter(r=>r!=='roaster');
    for(const role of c.inherited_roles||[]){if(!baseline.roles.some(r=>r.entity_id===a.entity_id&&r.role===role))throw Error('Unproven inherited role');if(!a.roles.includes(role))a.roles.push(role);}
    for(const role of c.add_roles||[]){if(role!=='cafe'||!a.locations.some(l=>l.label==='cafe'&&l.address1)||!c.corroboration?.shop_source_id)throw Error('Uncorroborated physical cafe role');if(!a.roles.includes(role))a.roles.push(role);if(!a.newRoles.includes(role))a.newRoles.push(role);}
    // A branch profile with no shop record still remains a cafe identity.
    if(!a.roles.length)throw Error('Would leave roleless entity: '+a.entity_id);
    a.crawlWebsite=null;a.crawlDeferredReason='branch_of_canonical_roaster';
    a.canonical_roaster_entity_id=c.canonical_entity_id;
    a.reasons.push({reason:'reviewed_branch_roaster_role_correction',evidence:c.evidence,canonical_entity_id:c.canonical_entity_id});
  }
  for(const c of corrections)if(seen.has(c.canonical_entity_id))throw Error('Canonical also demoted');
  revised.summary.newRoasterRoles=revised.actions.filter(a=>a.newRoles.includes('roaster')).length;
  revised.summary.newCafeRoles=revised.actions.filter(a=>a.newRoles.includes('cafe')).length;
  revised.revision={previousPlanHash:p.planHash,originalPlanHash:p.revision?.originalPlanHash||p.revision?.previousPlanHash||p.planHash,reason:'Reviewed branch identity role corrections',corrections};
  delete revised.planHash;revised.planHash=hash(revised);checkPlan(revised);return revised;
}
async function main(){
  const [mode,base,tag='role-corrections']=process.argv.slice(2);if(!['preview','apply'].includes(mode)||!base||!['role-corrections','role-corrections-followup'].includes(tag))throw Error('preview|apply BASE [role-corrections|role-corrections-followup]');
  const backup=path.join(base,'before-'+tag),journalFile=path.join(backup,'journal.json');
  const journal=fs.existsSync(journalFile)?read(journalFile):null;
  const p=journal?read(path.join(backup,'plan.json')):read(path.join(base,'plan.json')),baseline=read(path.join(base,'snapshot.json'));
  const input=read(path.join(base,tag+'.json')),corrections=Array.isArray(input)?input:input.corrections;
  if((input.planHash||input.plan_hash)&&(input.planHash||input.plan_hash)!==p.planHash)throw Error('Correction plan mismatch');
  const revised=revise(p,baseline,corrections),cp=journal?read(path.join(backup,'checkpoint.json')):read(path.join(base,'checkpoint.json'));
  if(cp.planHash!==p.planHash)throw Error('Checkpoint mismatch');
  if(journal&&(journal.oldPlanHash!==p.planHash||journal.newPlanHash!==revised.planHash))throw Error('Journal mismatch');
  for(const name of ['plan.json','checkpoint.json'])if(![p.planHash,revised.planHash].includes(read(path.join(base,name)).planHash))throw Error('Live artifact changed: '+name);
  const lock=path.resolve('.state/my-coffee-explorer/apply.lock');
  if(fs.existsSync(lock)){const old=read(lock);if(![p.planHash,revised.planHash].includes(old.planHash))throw Error('Unexpected lock');try{process.kill(old.pid,0);throw Error('Import process still running');}catch(e){if(e.code!=='ESRCH')throw e;}}
  let lockFd;
  if(mode==='apply'){
    fs.mkdirSync(backup,{recursive:true});
    if(fs.existsSync(lock))fs.renameSync(lock,path.join(backup,'stale-apply-'+Date.now()+'.lock'));
    lockFd=fs.openSync(lock,'wx',0o600);fs.writeFileSync(lockFd,JSON.stringify({pid:process.pid,planHash:p.planHash,operation:'role_revision'}));
  }
  try{
  const {createClient}=require('@supabase/supabase-js');const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const query=async(q)=>{const{data,error}=await q;if(error)throw error;return data;};
  const rows=await query(db.from('entity_roles').select('*').in('entity_id',corrections.map(c=>c.entity_id)).eq('role','roaster'));
  const inherited=await query(db.from('entity_roles').select('entity_id,role').in('entity_id',corrections.map(c=>c.entity_id)));
  for(const c of corrections)for(const role of c.inherited_roles||[])if(!inherited.some(r=>r.entity_id===c.entity_id&&r.role===role))throw Error('Inherited live role disappeared');
  for(const row of rows){const meta=row.role_metadata;const prov=meta?.provenance?.public_directories?.my_coffee_explorer;
    if(!prov?.imported_at||Object.keys(meta).some(k=>k!=='provenance')||Object.keys(meta.provenance).some(k=>k!=='public_directories')||Object.keys(meta.provenance.public_directories).some(k=>k!=='my_coffee_explorer'))throw Error('Role has unowned metadata: '+row.entity_id);
    if(Date.parse(prov.imported_at)<Date.parse(cp.startedAt)-3600000)throw Error('Role predates this import');
  }
  const audit={at:new Date().toISOString(),oldPlanHash:p.planHash,newPlanHash:revised.planHash,corrections,roleRowsBefore:rows,completed:Object.values(cp.entries).filter(e=>e.status==='complete').length};
  console.log(JSON.stringify({mode,corrections:corrections.length,ownedLiveRows:rows.length,oldPlanHash:p.planHash,newPlanHash:revised.planHash,summary:revised.summary}));
  if(mode==='preview')return;
  for(const name of ['plan.json','checkpoint.json']){const target=path.join(backup,name);if(!fs.existsSync(target))fs.copyFileSync(path.join(base,name),target,fs.constants.COPYFILE_EXCL);else if(read(target).planHash!==p.planHash)throw Error('Unexpected backup');}
  if(!fs.existsSync(path.join(backup,'audit.json')))write(path.join(backup,'audit.json'),audit);
  write(journalFile,{oldPlanHash:p.planHash,newPlanHash:revised.planHash,phase:'mutating'});
  for(const c of corrections)for(const role of c.add_roles||[]){
    await query(db.from('entity_roles').upsert({entity_id:c.entity_id,role,role_metadata:{provenance:{public_directories:{my_coffee_explorer:{imported_at:new Date().toISOString(),review:'corroborated physical cafe branch'}}}}},{onConflict:'entity_id,role',ignoreDuplicates:true}));
    const added=await query(db.from('entity_roles').select('entity_id').eq('entity_id',c.entity_id).eq('role',role));if(added.length!==1)throw Error('Required preserved role missing');
  }
  for(const row of rows){
    const deleted=await query(db.from('entity_roles').delete().eq('entity_id',row.entity_id).eq('role','roaster').eq('role_metadata',JSON.stringify(row.role_metadata)).select('entity_id'));
    if(deleted.length!==1)throw Error('Role changed concurrently: '+row.entity_id);
    fs.appendFileSync(path.join(backup,'progress.ndjson'),JSON.stringify({at:new Date().toISOString(),removed_role_entity_id:row.entity_id})+'\n',{mode:0o600});
  }
  const remaining=await query(db.from('entity_roles').select('entity_id').in('entity_id',corrections.map(c=>c.entity_id)).eq('role','roaster'));if(remaining.length)throw Error('Unexpected remaining role');
  cp.planHash=revised.planHash;cp.revisions=[...(cp.revisions||[]),{at:audit.at,from:p.planHash,to:revised.planHash}];
  write(path.join(base,'plan.json'),revised);write(path.join(base,'checkpoint.json'),cp);
  write(journalFile,{oldPlanHash:p.planHash,newPlanHash:revised.planHash,phase:'complete',verifiedAt:new Date().toISOString()});
  console.log('Verified owned role corrections; plan/checkpoint IDs preserved; stale lock archived.');
  }finally{if(lockFd!==undefined){fs.closeSync(lockFd);fs.unlinkSync(lock);}}
}
if(require.main===module)main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
module.exports={revise};
