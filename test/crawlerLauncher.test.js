'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
test('launcher enforces a wall deadline despite continuous logs and releases the lock only after child exit',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'crawler-deadline-'));
 fs.copyFileSync(path.join(__dirname,'../run-crawler.sh'),path.join(root,'run-crawler.sh'));
 fs.writeFileSync(path.join(root,'.env'),'CRAWLER_BATCH_TIMEOUT_MS=2000\n');
 fs.writeFileSync(path.join(root,'index.js'),"require('fs').writeFileSync('node.pid',String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>console.log('still active'),30);\n");
 const started=Date.now(),child=spawn('/bin/bash',[path.join(root,'run-crawler.sh')],{cwd:root,env:{...process.env,CRAWLER_BATCH_TIMEOUT_MS:'2000',CRAWLER_STALL_TIMEOUT_SECONDS:'99999',CRAWLER_WATCHDOG_CHECK_SECONDS:'60'},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',x=>{output+=x;});child.stderr.on('data',x=>{output+=x;});
 const timer=setTimeout(()=>child.kill('SIGKILL'),8000);t.after(()=>{clearTimeout(timer);if(fs.existsSync(path.join(root,'node.pid'))){try{process.kill(Number(fs.readFileSync(path.join(root,'node.pid'))),'SIGKILL');}catch{}}});
 const code=await new Promise(resolve=>child.on('exit',resolve));
 assert.notEqual(code,0);assert(Date.now()-started<7000,output);assert(output.includes('runtime/stall limit reached'),output);
 const pid=Number(fs.readFileSync(path.join(root,'node.pid')));assert.throws(()=>process.kill(pid,0));assert.equal(fs.existsSync(path.join(root,'.crawler.lock')),false);
});
