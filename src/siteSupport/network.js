'use strict';
const dns=require('node:dns/promises');
const {publicAddress}=require('../myCoffeeExplorerImport/product-only-network.cjs');
function allowed(value,hosts) {
  const url=new URL(value);let path=url.pathname;
  for(let i=0;i<4;i++){try{const next=decodeURIComponent(path);if(next===path)break;path=next;}catch{throw Error('Invalid encoded path');}}
  if(url.protocol!=='https:' || url.username || url.password || url.port || !hosts.includes(url.hostname.toLowerCase()))throw Error('Unverified destination');
  if(/(?:^|\/)(?:terms(?:[-_][^/]*)?|policies|privacy(?:-[^/]*)?|legal(?:-[^/]*)?|agreement|cart|shop_cart|basket|checkout|my-account|shop_mypage|accounts?|customers|customer_authentication|members?|myshop|orders?|payments|login|logout\.cm|auth|admin|wp-admin)(?:[/.;]|$)/i.test(path) || /^\/shopinfo\/guide\.html$/i.test(path) || [...url.searchParams.keys()].some(k=>/^(?:add-to-cart|wc-ajax)$/i.test(k)))throw Error('Prohibited path');
  return url;
}
const RETRY_STATUSES=new Set([429,502,503,504]);
const MAX_RETRIES=3,MAX_ELAPSED_MS=60000,INITIAL_BACKOFF_MS=2000,MAX_BACKOFF_MS=15000,MAX_RETRY_AFTER_MS=30000;
const MAX_COOLDOWN_WAIT_MS=300000,MAX_COOLDOWN_RESUMPTIONS=3;
function boundedNumber(value,fallback,maximum,minimum=0) {
  return Number.isFinite(value) && value>=minimum?Math.min(Math.floor(value),maximum):fallback;
}
function retryAfterMs(header,now) {
  if(typeof header!=='string' || !header.trim())return null;
  const value=header.trim();
  if(/^\d+$/.test(value)){const ms=Number(value)*1000;return Number.isSafeInteger(ms)?ms:null;}
  const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,date-now):null;
}
function abortable(action,signal) {
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason);
    if(signal.aborted){abort();return;}
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve().then(action).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
function createReader(profile,{delayMs=500,timeoutMs=15000,maxBytes=4*1024*1024,maxRetries=MAX_RETRIES,maxElapsedMs=MAX_ELAPSED_MS,
  resumeCooldowns=false,maxCooldownWaitMs=MAX_COOLDOWN_WAIT_MS,maxCooldownResumptions=MAX_COOLDOWN_RESUMPTIONS,
  fetch:fetchImpl=(...args)=>fetch(...args),lookup:lookupImpl=(...args)=>dns.lookup(...args),
  sleep:sleepImpl=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now:nowImpl=Date.now}={}) {
  delayMs=boundedNumber(delayMs,500,MAX_ELAPSED_MS);
  timeoutMs=boundedNumber(timeoutMs,15000,MAX_ELAPSED_MS,1);
  maxBytes=boundedNumber(maxBytes,4*1024*1024,Number.MAX_SAFE_INTEGER,1);
  maxRetries=boundedNumber(maxRetries,MAX_RETRIES,MAX_RETRIES);
  maxElapsedMs=boundedNumber(maxElapsedMs,MAX_ELAPSED_MS,MAX_ELAPSED_MS,1);
  maxCooldownWaitMs=boundedNumber(maxCooldownWaitMs,MAX_COOLDOWN_WAIT_MS,MAX_COOLDOWN_WAIT_MS);
  maxCooldownResumptions=boundedNumber(maxCooldownResumptions,MAX_COOLDOWN_RESUMPTIONS,MAX_COOLDOWN_RESUMPTIONS);
  resumeCooldowns=resumeCooldowns===true;
  const requests=[],returnedErrors=[],cooldownEvents=[],cooldowns=new Map(),hostDelays=new Map();let last=null,queue=Promise.resolve(),cooldownWaitedMs=0,cooldownResumptions=0;
  function destination(value){const url=allowed(value,profile.hosts);const prefix=profile.host_path_prefixes?.[url.hostname];if(prefix && ![prefix].flat().some(p=>url.pathname.startsWith(p)))throw Error('Unverified catalog path');return url;}
  async function read(initial,options,started) {
    let url=initial,attempt=null,retries=0,hops=0,attempts=0;
    const remaining=()=>maxElapsedMs-(nowImpl()-started);
    const failure=(error,extra={})=>{
      const state=cooldowns.get(url.hostname);
      return {success:false,error,finalUrl:url.href,...(attempt?.status!=null?{status:attempt.status}:{}),attempts,retries,
        ...(state?{cooldown:{host:url.hostname,...state,remainingMs:Math.max(0,state.nextAt-nowImpl())}}:{}),...extra};
    };
    try {
      while(hops<5) {
        url=destination(url.href);
        const state=cooldowns.get(url.hostname),spacing=Math.max(delayMs,hostDelays.get(url.hostname)||0),pause=Math.max(0,(last===null?0:last+spacing)-nowImpl(),(state?.nextAt || 0)-nowImpl());
        if(remaining()<=0)return failure('Merchant read time budget exhausted',{retryStopped:'time_limit'});
        if(pause>=remaining())return failure('Merchant cooldown exceeds read time budget',{retryStopped:'time_limit'});
        if(pause>0)await sleepImpl(pause);
        // A cooldown can outlive this read. Recheck all destination and DNS
        // guards after waiting, immediately before each actual GET.
        url=destination(url.href);
        if(remaining()<=0)return failure('Merchant read time budget exhausted',{retryStopped:'time_limit'});
        const signal=AbortSignal.timeout(Math.min(timeoutMs,Math.max(1,Math.floor(remaining()))));
        const addresses=await abortable(()=>lookupImpl(url.hostname,{all:true}),signal);
        if(!addresses.length || addresses.some(a=>!publicAddress(a.address)))throw Error('Nonpublic DNS address');
        url=destination(url.href);
        if(remaining()<=0)return failure('Merchant read time budget exhausted',{retryStopped:'time_limit'});
        const headers={'user-agent':'EveryCoffeeCrawler/1.0 (+https://every.coffee)','accept':'text/html,application/json'};
        // Imweb's read-only native product response requires its Ajax protocol.
        // No arbitrary caller headers, cookies or credentials are forwarded.
        if(profile.adapter==='imweb' && url.pathname===profile.product_api_path) {
          headers['x-requested-with']='XMLHttpRequest';
          const referer=destination(options.referer);
          if(referer.origin!==url.origin || !/^\/shop_view\/?$/.test(referer.pathname))throw Error('Invalid native product referer');
          headers.referer=referer.href;
        }
        last=nowImpl();
        if(state?.failures)state.nextAt=Math.max(state.nextAt,last+INITIAL_BACKOFF_MS);
        attempt={method:'GET',url:url.href,status:null,at:new Date(last).toISOString(),attempt:++attempts,retry:retries};requests.push(attempt);
        const result=await abortable(()=>fetchImpl(url,{method:'GET',redirect:'manual',headers,signal}),signal);
        attempt.status=result.status;
        if(remaining()<=0){await abortable(()=>result.body?.cancel(),signal);return failure('Merchant read time budget exhausted',{retryStopped:'time_limit'});}
        if(result.status>=300 && result.status<400){await abortable(()=>result.body?.cancel(),signal);url=destination(new URL(result.headers.get('location'),url).href);hops++;continue;}
        if(result.status!==200) {
          await abortable(()=>result.body?.cancel(),signal);
          if(!RETRY_STATUSES.has(result.status))return failure('HTTP '+result.status);
          const failures=(cooldowns.get(url.hostname)?.failures || 0)+1;
          const backoff=Math.min(INITIAL_BACKOFF_MS*2**Math.min(failures-1,10),MAX_BACKOFF_MS);
          const retryAfter=retryAfterMs(result.headers.get('retry-after'),nowImpl());
          const retryDelay=Math.max(backoff,retryAfter || 0);
          // Preserve even an excessive finite Retry-After in host state. Later
          // reads fail closed or wait fully; they never bypass an exhausted read.
          cooldowns.set(url.hostname,{failures,nextAt:nowImpl()+retryDelay,retryAfterMs:retryAfter,status:result.status});
          attempt.retryDelayMs=retryDelay;
          if(result.headers.get('retry-after')!=null)attempt.retryAfter=result.headers.get('retry-after');
          if(retryAfter!==null)attempt.retryAfterMs=retryAfter;
          const stop=retries>=maxRetries?'retry_limit':retryAfter>MAX_RETRY_AFTER_MS?'retry_after_limit':retryDelay>=remaining()?'time_limit':null;
          if(stop){attempt.retryStopped=stop;return failure('HTTP '+result.status,{retryStopped:stop});}
          retries++;continue;
        }
        const chunks=[];let size=0;
        await abortable(async()=>{for await(const chunk of result.body){size+=chunk.length;if(size>maxBytes)throw Error('Response too large');chunks.push(chunk);}},signal);
        if(remaining()<=0)return failure('Merchant read time budget exhausted',{retryStopped:'time_limit'});
        cooldowns.delete(url.hostname);
        const integerHeader=name=>{const value=result.headers.get(name);return /^\d+$/.test(value || '') && Number.isSafeInteger(Number(value))?Number(value):null;};
        return {success:true,status:200,data:Buffer.concat(chunks).toString('utf8'),finalUrl:url.href,catalogTotal:integerHeader('x-wp-total'),catalogPages:integerHeader('x-wp-totalpages'),attempts,retries};
      }
      throw Error('Redirect limit');
    }catch(error){const detail=error.message+(error.cause?.code?' ('+error.cause.code+')':'');if(attempt)attempt.error=detail;return failure(detail);}
  }
  async function fetchHtml(value,options={}) {
    let initial;try{initial=destination(value);}catch(error){return {success:false,error:error.message};}
    const started=nowImpl(),result=queue.then(async()=>{
      let response=await read(initial,options,resumeCooldowns?nowImpl():started),resumed=0;
      while(resumeCooldowns && !response.success && response.cooldown?.retryAfterMs>MAX_RETRY_AFTER_MS && response.cooldown.remainingMs>0) {
        const wait=response.cooldown.remainingMs;
        if(cooldownResumptions>=maxCooldownResumptions || wait>maxCooldownWaitMs-cooldownWaitedMs) {
          response={...response,merchantCooldownExceeded:true,cooldownRecovery:{waitedMs:cooldownWaitedMs,resumptions:cooldownResumptions,stopped:cooldownResumptions>=maxCooldownResumptions?'resumption_limit':'total_wait_limit'}};
          break;
        }
        cooldownResumptions++;resumed++;cooldownWaitedMs+=wait;
        const spacing=Math.min(5000,Math.max(2000,(hostDelays.get(response.cooldown.host)||1000)*2));
        hostDelays.set(response.cooldown.host,spacing);
        cooldownEvents.push({url:response.finalUrl,host:response.cooldown.host,waitMs:wait,resumeAt:response.cooldown.nextAt,status:response.cooldown.status,retryAfterMs:response.cooldown.retryAfterMs,requestSpacingMs:spacing});
        await sleepImpl(wait);
        // A new bounded read revalidates the URL, DNS and every redirect. Host
        // cooldown is retained; no request is sent before the merchant deadline.
        response=await read(initial,options,nowImpl());
      }
      if(resumed)response={...response,cooldownResumptions:resumed};
      if(!response.success)returnedErrors.push({url:initial.href,...response});
      return response;
    });
    // Serialize a reader's merchant requests so queued calls observe a throttle
    // before dispatching, while rejected reads cannot poison the queue.
    queue=result.then(()=>undefined,()=>undefined);
    return result;
  }
  return {fetchHtml,requests,returnedErrors,cooldownEvents,getCooldownFailure:()=>returnedErrors.findLast(result=>result.merchantCooldownExceeded)||null};
}
module.exports={allowed,createReader};
