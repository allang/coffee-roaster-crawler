'use strict';
const dns=require('node:dns/promises');
const {allowed}=require('./siteSupport/network');
const {publicAddress}=require('./myCoffeeExplorerImport/product-only-network.cjs');

function imageFormat(buffer) {
  if(buffer.length<12)return null;
  if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {contentType:'image/png',extension:'.png'};
  if(buffer[0]===255 && buffer[1]===216 && buffer[2]===255)return {contentType:'image/jpeg',extension:'.jpg'};
  if(/^GIF8[79]a$/.test(buffer.subarray(0,6).toString()))return {contentType:'image/gif',extension:'.gif'};
  if(buffer.subarray(0,4).toString()==='RIFF' && buffer.subarray(8,12).toString()==='WEBP')return {contentType:'image/webp',extension:'.webp'};
  if(buffer.subarray(4,8).toString()==='ftyp' && /(?:avif|avis)/.test(buffer.subarray(8,32).toString()))return {contentType:'image/avif',extension:'.avif'};
  return null;
}
async function fetchSourceImage(value,{referer,timeout=30000,maxBytes=20*1024*1024}={}) {
  let url;const signal=AbortSignal.timeout(timeout);
  try {
    url=new URL(value);
    for(let hop=0;hop<5;hop++) {
      // Apply the legal/account boundary before every fetch, including redirects.
      allowed(url.href,[url.hostname]);
      const addresses=await dns.lookup(url.hostname,{all:true});
      if(!addresses.length || addresses.some(a=>!publicAddress(a.address)))throw Error('Nonpublic image destination');
      const response=await fetch(url,{redirect:'manual',signal,headers:{'user-agent':'EveryCoffeeCrawler/1.0 (+https://every.coffee)',accept:'image/avif,image/webp,image/png,image/jpeg,image/gif',...(referer?{referer}:{})}});
      if(response.status>=300 && response.status<400){await response.body?.cancel();url=new URL(response.headers.get('location'),url);continue;}
      if(response.status!==200){await response.body?.cancel();throw Error('Image HTTP '+response.status);}
      const chunks=[];let size=0;
      for await(const chunk of response.body){size+=chunk.length;if(size>maxBytes)throw Error('Image exceeds size limit');chunks.push(chunk);}
      const buffer=Buffer.concat(chunks),format=imageFormat(buffer);
      if(!format)throw Error('Response is not a supported product image');
      return {success:true,data:buffer,headers:{'content-type':format.contentType},finalUrl:url.href};
    }
    throw Error('Image redirect limit');
  }catch(error){return {success:false,error:error.message+(error.cause?.code?' ('+error.cause.code+')':''),finalUrl:url?.href};}
}
module.exports={imageFormat,fetchSourceImage};
