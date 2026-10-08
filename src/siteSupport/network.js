'use strict';
const dns=require('node:dns/promises');
const {publicAddress}=require('../myCoffeeExplorerImport/product-only-network.cjs');
function allowed(value,hosts) {
  const url=new URL(value);let path=url.pathname;
  for(let i=0;i<4;i++){try{const next=decodeURIComponent(path);if(next===path)break;path=next;}catch{throw Error('Invalid encoded path');}}
  if(url.protocol!=='https:' || url.username || url.password || url.port || !hosts.includes(url.hostname.toLowerCase()))throw Error('Unverified destination');
  if(/(?:^|\/)(?:terms(?:-[^/]*)?|policies|privacy(?:-[^/]*)?|legal(?:-[^/]*)?|cart|basket|checkout|my-account|accounts?|customers|customer_authentication|members?|myshop|orders?|payments|login|admin|wp-admin)(?:[/.]|$)/i.test(path) || /^\/shopinfo\/guide\.html$/i.test(path) || [...url.searchParams.keys()].some(k=>/^(?:add-to-cart|wc-ajax)$/i.test(k)))throw Error('Prohibited path');
  return url;
}
function createReader(profile,{delayMs=500,timeoutMs=15000,maxBytes=4*1024*1024}={}) {
  const requests=[];let last=0;
  async function fetchHtml(value,options={}) {
    function destination(value){const url=allowed(value,profile.hosts);const prefix=profile.host_path_prefixes?.[url.hostname];if(prefix && ![prefix].flat().some(p=>url.pathname.startsWith(p)))throw Error('Unverified catalog path');return url;}
    let url;try{url=destination(value);}catch(error){return {success:false,error:error.message};}
    let attempt=null;
    try {
      for(let hops=0;hops<5;hops++) {
        const addresses=await dns.lookup(url.hostname,{all:true});
        if(!addresses.length || addresses.some(a=>!publicAddress(a.address)))throw Error('Nonpublic DNS address');
        const pause=delayMs-(Date.now()-last);if(pause>0)await new Promise(r=>setTimeout(r,pause));last=Date.now();
        attempt={method:'GET',url:url.href,status:null,at:new Date().toISOString()};requests.push(attempt);
        const headers={'user-agent':'EveryCoffeeCrawler/1.0 (+https://every.coffee)','accept':'text/html,application/json'};
        // Imweb's read-only native product response requires its Ajax protocol.
        // No arbitrary caller headers, cookies or credentials are forwarded.
        if(profile.adapter==='imweb' && url.pathname===profile.product_api_path) {
          headers['x-requested-with']='XMLHttpRequest';
          const referer=destination(options.referer);
          if(referer.origin!==url.origin || !/^\/shop_view\/?$/.test(referer.pathname))throw Error('Invalid native product referer');
          headers.referer=referer.href;
        }
        const result=await fetch(url,{method:'GET',redirect:'manual',headers,signal:AbortSignal.timeout(timeoutMs)});
        attempt.status=result.status;
        if(result.status>=300 && result.status<400){await result.body?.cancel();url=destination(new URL(result.headers.get('location'),url).href);continue;}
        if(result.status!==200){await result.body?.cancel();return {success:false,status:result.status,error:'HTTP '+result.status,finalUrl:url.href};}
        const chunks=[];let size=0;
        for await(const chunk of result.body){size+=chunk.length;if(size>maxBytes)throw Error('Response too large');chunks.push(chunk);}
        const integerHeader=name=>{const value=result.headers.get(name);return /^\d+$/.test(value || '') && Number.isSafeInteger(Number(value))?Number(value):null;};
        return {success:true,status:200,data:Buffer.concat(chunks).toString('utf8'),finalUrl:url.href,catalogTotal:integerHeader('x-wp-total'),catalogPages:integerHeader('x-wp-totalpages')};
      }
      throw Error('Redirect limit');
    }catch(error){const detail=error.message+(error.cause?.code?' ('+error.cause.code+')':'');if(attempt)attempt.error=detail;return {success:false,error:detail,finalUrl:url.href};}
  }
  return {fetchHtml,requests};
}
module.exports={allowed,createReader};
