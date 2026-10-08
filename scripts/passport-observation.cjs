'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const crypto=require('node:crypto');
const HEADER_NAMES=['retry-after','date','content-type'];
function resultMetadata(result,redact=value=>value) {
  if(!result||typeof result!=='object')return result;
  const clean={};
  for(const[key,value]of Object.entries(result)) {
    if(['data','html','content','body','headers','request_headers'].includes(key))continue;
    clean[key]=value;
  }
  if(typeof result.data==='string'){
    clean.body_chars=result.data.length;
    clean.body_sha256=crypto.createHash('sha256').update(result.data).digest('hex');
  }
  return JSON.parse(redact(JSON.stringify(clean)));
}
function installReaderObservation(network,{state,onChange=()=>{},redact=value=>value,now=()=>new Date().toISOString()}={}) {
  const original=network.createReader,scope=new AsyncLocalStorage();
  state.readers ||= [];state.reader_results ||= [];state.merchant_wire_requests ||= [];
  network.createReader=function(profile,options={}) {
    const entry={reader_id:state.readers.length+1,profile_name:profile.name||null,requests:[]};state.readers.push(entry);
    const nativeFetch=options.fetch||((...args)=>globalThis.fetch(...args));
    const reader=original(profile,{...options,fetch:async(...args)=>{
      const value=args[0],request={reader_id:entry.reader_id,read_id:scope.getStore()||null,at:now(),method:args[1]?.method||value?.method||'GET',url:String(value?.url||value?.href||value),status:null};
      state.merchant_wire_requests.push(request);
      try {
        const response=await nativeFetch(...args);request.status=response.status;
        request.response_headers=Object.fromEntries(HEADER_NAMES.map(name=>[name,response.headers.get(name)]));
        return response;
      }catch(error){request.error=redact(error.message);throw error;}
    }});
    entry.requests=reader.requests;
    const fetchHtml=reader.fetchHtml;let journaledRequests=0;
    reader.fetchHtml=async(...args)=>{
      const observation={read_id:state.reader_results.length+1,reader_id:entry.reader_id,requested_url:String(args[0]),started_at:now(),result:null};state.reader_results.push(observation);
      // Expose the active ledger to periodic checkpoints during a long wait.
      entry.requests=reader.requests;
      try {
        const result=await scope.run(observation.read_id,()=>fetchHtml(...args));
        observation.result=resultMetadata(result,redact);return result;
      }catch(error){observation.thrown_error=redact(error.message);throw error;}
      finally {
        observation.finished_at=now();
        // Copy after settlement: retry metadata is added after the wire response.
        // Zero-attempt cooldown failures still have their own returned result.
        entry.requests=JSON.parse(redact(JSON.stringify(reader.requests)));
        const requests=entry.requests.slice(journaledRequests);journaledRequests=entry.requests.length;
        onChange({kind:'reader_settled',observation,reader_id:entry.reader_id,requests});
      }
    };
    return reader;
  };
  return ()=>{network.createReader=original;};
}
function visitGate(metrics,plannedUrls) {
  const reasons=[];
  if(!Number.isInteger(metrics?.visited)||metrics.visited!==plannedUrls.length)reasons.push('unvisited_or_unexpected_pages');
  if(!Number.isInteger(metrics?.errors)||metrics.errors!==0)reasons.push('page_errors');
  for(const key of ['deferred','deferredPages','deferred_pages','pending','remaining','unvisited']) {
    const value=metrics?.[key];
    if(Array.isArray(value)?value.length>0:typeof value==='number'?value!==0:value===true)reasons.push(key);
  }
  if(metrics?.inventoryComplete===false||metrics?.inventory_complete===false||metrics?.quotaExceeded===true)reasons.push('incomplete_inventory_or_quota');
  return {successful:reasons.length===0,reasons,planned_pages:plannedUrls.length,visited:metrics?.visited??null,errors:metrics?.errors??null};
}
function installVisitObservation(visitor,{state,onChange=()=>{},redact=value=>value,now=()=>new Date().toISOString()}={}) {
  const original=visitor.visitAllPages;state.visits ||= [];
  visitor.visitAllPages=async function(entityId,urls,...args) {
    const entry={entity_id:entityId,started_at:now(),planned_urls:urls.map(u=>typeof u==='string'?u:u.url)};state.visits.push(entry);
    try {
      const result=await original.call(this,entityId,urls,...args);entry.metrics=JSON.parse(redact(JSON.stringify(result)));entry.gate=visitGate(result,entry.planned_urls);
      if(!entry.gate.successful) {
        const error=new Error('Observer full-run gate failed before completion/reconciliation: '+entry.gate.reasons.join(', '));error.code='OBSERVER_INCOMPLETE_RUN';throw error;
      }
      return result;
    }catch(error){entry.error=redact(error.message);throw error;}
    finally{entry.finished_at=now();onChange({kind:'visit_settled',observation:entry});}
  };
  return ()=>{visitor.visitAllPages=original;};
}
module.exports={installReaderObservation,installVisitObservation,resultMetadata,visitGate,HEADER_NAMES};
