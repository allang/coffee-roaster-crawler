'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const {performance}=require('node:perf_hooks');
const storage=new AsyncLocalStorage();
function limits(env=process.env){
 function limit(key,fallback,max){const n=env[key]==null?fallback:Number(env[key]);if(!Number.isSafeInteger(n)||n<1000||n>max)throw Error('Invalid '+key);return n;}
 const batchMs=limit('CRAWLER_BATCH_TIMEOUT_MS',3600000,3600000);
 return {batchMs,roasterMs:limit('CRAWLER_ROASTER_TIMEOUT_MS',Math.min(600000,batchMs),Math.min(600000,batchMs))};
}
function budgetError(kind){return Object.assign(Error('Crawl '+kind+' time budget exhausted'),{code:'CRAWL_BUDGET_EXCEEDED',budgetKind:kind});}
function current(){return storage.getStore();}
function signal(){return current()?.signal;}
function expired(){const state=current();return !!state && (state.signal.aborted || performance.now()>=state.deadline);}
function check(){const state=current();if(expired())throw state.signal.reason || budgetError(state.kind);}
async function withBudget(kind,ms,action){
 const parent=current(),reserve=Math.min(kind==='batch'?30000:5000,ms/10),deadline=Math.min(parent?.deadline??Infinity,performance.now()+ms-reserve),controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(budgetError(kind)),Math.max(0,deadline-performance.now()));timer.unref?.();
 const state={kind,deadline,signal:parent?AbortSignal.any([parent.signal,controller.signal]):controller.signal};
 try{return await storage.run(state,async()=>{check();return action();});}finally{clearTimeout(timer);}
}
// Reserve bounded time to mark an interrupted attempt failed after work aborts.
async function finalize(action){return storage.run(undefined,()=>withBudget('finalization',4000,action));}
function wait(ms){
 check();const active=signal();
 return new Promise((resolve,reject)=>{const finish=()=>{active?.removeEventListener('abort',abort);resolve();},timer=setTimeout(finish,ms),abort=()=>{clearTimeout(timer);active.removeEventListener('abort',abort);reject(active.reason);};active?.addEventListener('abort',abort,{once:true});});
}
function combinedSignal(other,timeoutMs){check();const signals=[signal(),other,timeoutMs?AbortSignal.timeout(timeoutMs):null].filter(Boolean);return signals.length?AbortSignal.any(signals):undefined;}
function observe(promise){const active=signal();if(!active)return promise;check();return new Promise((resolve,reject)=>{const abort=()=>reject(active.reason);active.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(resolve,reject).finally(()=>active.removeEventListener('abort',abort));});}
function boundedFetch(input,options={}){return fetch(input,{...options,signal:combinedSignal(options.signal,30000)});}
module.exports={limits,current,signal,expired,check,withBudget,finalize,wait,combinedSignal,boundedFetch,observe};
