'use strict';
// One read-only API metadata request. No table rows, mutation, retry or settings changes.
const fs=require('node:fs'),crypto=require('node:crypto');
const ROOT='/Users/allan/.openclaw/workspace/coffee-roaster-crawler';
const ORIGIN='https://gtlipifdfyugiwpxvuse.supabase.co';
async function main(){
  if(process.argv[2]!=='--read'||process.argv.length!==3||fs.realpathSync(process.cwd())!==ROOT)throw Error('explicit_production_read_required');
  if(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin!==ORIGIN)throw Error('wrong_database');
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(typeof key!=='string'||key.length<20)throw Error('missing_credential');
  process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';
  const url=ORIGIN+'/rest/v1/',abort=new AbortController(),timer=setTimeout(()=>abort.abort(),20000);
  try{
    const response=await fetch(url,{method:'GET',redirect:'error',signal:abort.signal,headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/openapi+json'}});
    if(response.url!==url||response.redirected||response.status!==200)throw Error('metadata_http_'+response.status);
    if(!/^(?:application\/openapi\+json|application\/json)(?:;|$)/i.test(response.headers.get('content-type')||''))throw Error('unexpected_metadata_type');
    const chunks=[];let bytes=0;
    for await(const chunk of response.body){bytes+=chunk.length;if(bytes>4194304)throw Error('metadata_size_limit');chunks.push(chunk);}
    const body=Buffer.concat(chunks),schema=JSON.parse(body),definition=schema.definitions?.entity_source_ids;
    if(!definition||!schema.paths?.['/entity_source_ids'])throw Error('source_schema_absent');
    const result={at:new Date().toISOString(),status:'read_only_api_metadata',database:ORIGIN,request:url,requests:1,writes:0,bytes,body_sha256:crypto.createHash('sha256').update(body).digest('hex'),definition,path:schema.paths['/entity_source_ids'],limitation:'API schema-cache metadata; does not reveal current pg_constraint validation state or prove cache freshness.'};
    const file=ROOT+'/.state/my-coffee-explorer/2026-09-26/source-api-schema-'+crypto.randomUUID()+'.json';
    fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
    console.log(JSON.stringify({file,requests:1,writes:0,definition}));
  }finally{clearTimeout(timer);}
}
main().catch(e=>{console.error(JSON.stringify({status:'stopped_no_retry',error:String(e.message).slice(0,100),writes:0}));process.exitCode=1;});
