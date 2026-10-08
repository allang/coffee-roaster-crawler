'use strict';
// One finite reviewed batch, sequenced after an existing one-off crawl.
// No recurring schedule, discoveries, retries, or changes to active inputs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const root='/Users/allan/.openclaw/workspace/coffee-roaster-crawler';
const base=path.join(root,'.state/my-coffee-explorer/2026-09-26');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const contained=value=>{const p=path.resolve(base,value);if(!p.startsWith(base+'/'))throw Error('Queue path outside state directory');return p;};
const fullCoverage=s=>s.mode==='run'&&s.finishedAt&&Array.isArray(s.results)&&Array.isArray(s.skipped)&&s.results.length+s.skipped.length>=s.targetCount;
async function main(){
  const manifestFile=contained(process.argv[2]);const m=read(manifestFile);
  if(m.version!==1||!m.input||!m.inputSha256||!m.predecessor?.label||!m.predecessor?.inputHash)throw Error('Incomplete queue manifest');
  if(!/^com\.everycoffee\.mce-[a-z0-9-]+$/.test(m.predecessor.label))throw Error('Unexpected predecessor job');
  const input=contained(m.input),summary=contained(m.summary),checkpoint=contained(m.checkpoint),audit=contained(m.audit),before=contained(m.predecessor.summary);
  if(sha(fs.readFileSync(input))!==m.inputSha256)throw Error('Queued input changed');
  const stateFile=contained(m.queueState),lock=stateFile+'.lock';
  const fd=fs.openSync(lock,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));
  const record=(status,extra={})=>{const tmp=stateFile+'.tmp';fs.writeFileSync(tmp,JSON.stringify({at:new Date().toISOString(),status,manifestSha256:sha(fs.readFileSync(manifestFile)),...extra},null,2)+'\n',{mode:0o600});fs.renameSync(tmp,stateFile);};
  try{
    record('waiting_for_predecessor');
    for(;;){
      if(fs.existsSync(before)){
        const s=read(before);
        if(s.inputHash!==m.predecessor.inputHash||!fullCoverage(s))throw Error('Predecessor did not finish its verified target set; inspect before proceeding');
        break;
      }
      let info;try{info=execFileSync('/bin/launchctl',['list',m.predecessor.label],{encoding:'utf8',stdio:['ignore','pipe','ignore']});}catch{throw Error('Predecessor job is absent without a completion summary');}
      if(!/"PID"\s*=\s*\d+/.test(info))throw Error('Predecessor stopped without a completion summary');
      await new Promise(r=>setTimeout(r,30000));
    }
    if(sha(fs.readFileSync(input))!==m.inputSha256)throw Error('Queued input changed while waiting');
    record('running');
    const args=[path.join(root,'src/myCoffeeExplorerImport/targeted-crawl.js'),'--input',input,'--checkpoint',checkpoint,'--summary',summary,'--audit',audit,'--concurrency','1','--run'];
    const code=await new Promise((resolve,reject)=>{const c=spawn(process.execPath,args,{cwd:root,stdio:'inherit'});c.once('error',reject);c.once('exit',(code,signal)=>signal?reject(Error('Crawler terminated: '+signal)):resolve(code));});
    const result=fs.existsSync(summary)?read(summary):null;
    if(!result||!fullCoverage(result))throw Error('Queued crawl did not finish its target set');
    record(code===0?'complete':'complete_with_failed_targets',{exitCode:code,completed:result.completedCount,failed:result.failedCount,skipped:result.skipped.length});
    if(code)process.exitCode=code;
  }catch(error){record('needs_attention',{error:error.message});throw error;}
  finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={fullCoverage,contained};
