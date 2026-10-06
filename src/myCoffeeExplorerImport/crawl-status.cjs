'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const base=process.argv[2]||__dirname;
const read=n=>{const p=path.join(base,n);return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):null;};
const entries=[
  {tag:'pilot',targetCount:3,checkpoint:'pilot-crawl-targets.ndjson.crawl-checkpoint.json'},
  {tag:'main',targetCount:333,checkpoint:'targeted-crawl-checkpoint.json',label:'com.everycoffee.mce-crawl-20260926'},
  {tag:'continuation',targetCount:17,checkpoint:'continuation-crawl-checkpoint.json',label:'com.everycoffee.mce-continuation-crawl-20260926'}
];
for(const f of fs.readdirSync(base).filter(f=>/^public\d+-queue-manifest\.json$/.test(f))){const m=read(f),tag=f.replace('-queue-manifest.json','');entries.push({tag,targetCount:m.targetCount,checkpoint:m.checkpoint,queueState:m.queueState,label:'com.everycoffee.mce-'+tag+'-crawl-20260926',planHash:m.planHash});}
const unique=new Map();
const batches=entries.map(e=>{
  const cp=read(e.checkpoint),counts={complete:0,failed:0,running:0},rows=Object.entries(cp?.results||{});
  for(const [id,r] of rows){counts[r.status]=(counts[r.status]||0)+1;const old=unique.get(id);if(!old||Date.parse(r.finishedAt||r.startedAt)>Date.parse(old.finishedAt||old.startedAt))unique.set(id,r);}
  let pid=null,launchStatus='not_applicable';if(e.label){try{const l=execFileSync('/bin/launchctl',['list',e.label],{encoding:'utf8',stdio:['ignore','pipe','ignore']});pid=Number(l.match(/"PID"\s*=\s*(\d+)/)?.[1])||null;launchStatus=pid?'running':'exited';}catch{launchStatus='not_loaded';}}
  return {...e,inputHash:cp?.inputHash||null,updatedAt:cp?.updatedAt||null,pid,launchStatus,counts,completedSiteCoffees:rows.filter(([,r])=>r.status==='complete').reduce((n,[,r])=>n+(r.coffeesFound||0),0),queue: e.queueState?read(e.queueState):null};
});
const states=[...unique.values()];const output={at:new Date().toISOString(),host:'Allans-Mac-mini.local',distinctTargetCount:entries.filter(e=>e.tag!=='pilot').reduce((n,e)=>n+e.targetCount,0),completedSites:states.filter(r=>r.status==='complete').length,failedSites:states.filter(r=>r.status==='failed').length,runningSites:states.filter(r=>r.status==='running').length,coffeesFoundOnCompletedSites:states.filter(r=>r.status==='complete').reduce((n,r)=>n+(r.coffeesFound||0),0),batches,limits:['The three pilot entities are contained in the main333 target set, not additional targets.','Site completion does not imply every page succeeded or returned coffee.','coffeesFound is the crawler result count, not a guaranteed count of new unique product rows.','Waiting queue processes are not active crawl workers.']};
fs.writeFileSync(path.join(base,'crawl-status.json'),JSON.stringify(output,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({...output,batches:output.batches.map(b=>({tag:b.tag,counts:b.counts,pid:b.pid,queue:b.queue?.status}))}));
