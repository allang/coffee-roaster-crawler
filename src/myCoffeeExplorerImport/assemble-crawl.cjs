'use strict';
const fs=require('node:fs'),path=require('node:path');
const {checkPlan}=require('./import.cjs');
const base=process.argv[2];if(!base)throw Error('BASE required');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8')),targets=new Map(),plans=[];
for(const part of ['','delta','supplemental','sello-rojo']){
  const dir=path.join(base,part),p=read(path.join(dir,'plan.json')),v=read(path.join(dir,'verification.json'));checkPlan(p);
  if(v.planHash!==p.planHash||v.failures.length||v.verified!==p.actions.length||v.expected!==p.actions.length)throw Error('Unverified plan '+part);
  const rows=fs.readFileSync(path.join(dir,'verification.targets.ndjson'),'utf8').split('\n').filter(Boolean).map(JSON.parse);
  for(const t of rows){const old=targets.get(t.entity_id);if(old&&old.website_url!==t.website_url)throw Error('Conflicting target');targets.set(t.entity_id,t);}
  plans.push({part:part||'main',hash:p.planHash,summary:p.summary,verifiedAt:v.at});
}
const file=path.join(base,'all-crawl-targets.ndjson');if(fs.existsSync(file))throw Error('Preserve immutable existing crawl input');
fs.writeFileSync(file,[...targets.values()].map(JSON.stringify).join('\n')+'\n',{flag:'wx',mode:0o600});
fs.writeFileSync(path.join(base,'crawl-input-manifest.json'),JSON.stringify({at:new Date().toISOString(),targetCount:targets.size,plans},null,2),{flag:'wx',mode:0o600});
console.log(JSON.stringify({verifiedPlans:plans.length,crawlTargets:targets.size}));
