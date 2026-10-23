'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module');
function client(steps){
 const file=path.join(__dirname,'../src/httpClient.js'),real=createRequire(file),requests=[],delays=[],module={exports:{}};
 const axios={get:async url=>{requests.push(url);const step=steps[requests.length-1];if(step instanceof Error)throw step;if(!step)throw Error('Unexpected request');return step;}};
 const timeout=(fn,ms)=>{delays.push(ms);fn();};
 vm.runInThisContext(`(function(require,module,exports,process,setTimeout){${fs.readFileSync(file,'utf8')}\n})`,{filename:file})(name=>name==='axios'?axios:real(name),module,module.exports,{env:{CRAWLER_PER_DOMAIN_DELAY_MS:'0'}},timeout);
 return {...module.exports,requests,delays};
}
const error=(status,after)=>Object.assign(Error('HTTP '+status),{response:{status,headers:{'retry-after':after}}});
test('hour-long Retry-After defers without occupying a worker, proxy bypass or another URL attempt',async()=>{
 const http=client([error(503,'4563')]),r=await http.fetchHtml('https://merchant.test/products/coffee',{useUrlFallback:true});
 assert.equal(r.success,false);assert.equal(r.retryStopped,'retry_after_limit');assert.equal(r.merchantCooldownExceeded,true);assert.equal(r.cooldown.retryAfterMs,4563000);assert.equal(http.requests.length,1);assert.deepEqual(http.delays,[]);
});
test('a short server Retry-After is respected exactly before the bounded retry',async()=>{
 const http=client([error(503,'2'),{data:'Coffee',status:200,headers:{}}]);
 const r=await http.fetchHtml('https://merchant.test/products/coffee',{useProxyFallback:false});assert.equal(r.success,true);assert.deepEqual(http.delays,[2000]);assert.equal(http.requests.length,2);
});
test('permanent HTTP payment/auth failures do not sleep or retry the same URL',async()=>{
 for(const status of [401,402,403]){const http=client([error(status,'4563')]),r=await http.fetchHtml('https://merchant.test/products/coffee',{useProxyFallback:false});assert.equal(r.success,false);assert.equal(http.requests.length,1);assert.deepEqual(http.delays,[]);}
});
