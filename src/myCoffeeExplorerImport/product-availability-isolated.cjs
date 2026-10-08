'use strict';
// Future-run adapter only. No network, DB client, schema changes or repair execution.
const {AsyncLocalStorage}=require('node:async_hooks');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const SOURCE_PINS=Object.freeze({
 'src/productSaver.js':'4dfcfdeb2cdfe4baa93d893fb0e1818eb0d043e798a21f7251fd489a7ce1b151',
 'src/shopifyProduct.js':'12930f5caec09e94cbdb66946f95c0abf3c744911f9c8b256e450b98fbfc1839',
 'src/availability.js':'9ff30c96cd9060ee18f6215fca05af665280c28d8b4d8ab5761c71edceb38e1b',
 'src/pageVisitor.js':'3dcc4d208d8cfd3d07d33189ae8e13eb61521b7fd8baf83a661176bd5fe3cd6f'
});
const PARENT_FIELDS=new Set(['is_available','availability_checked_at','availability_last_seen_at','availability_reason']);
const SCHEMA_RECEIPT=Object.freeze({file:'production-availability-schema-and-log-correction-1109.json',sha256:'40b5f1a43bae59a13fd931a0facf957340a4a57c2345a2da57d1a2d4f5f783a4',project_id:'gtlipifdfyugiwpxvuse'});
function fail(code){throw Object.assign(Error(code),{code});}
function must(ok,code){if(!ok)fail(code);}
function tri(value){return typeof value==='boolean'?value:null;}
function aggregate(variants){
 if(!Array.isArray(variants)||!variants.length)return{isAvailable:null,reason:'shopify_variant_availability_unknown'};
 const values=variants.map(v=>tri(v?.available));
 if(values.includes(true))return{isAvailable:true,reason:'shopify_variant_available'};
 if(values.every(v=>v===false))return{isAvailable:false,reason:'shopify_variants_explicitly_unavailable'};
 return{isAvailable:null,reason:'shopify_variant_availability_unknown'};
}
function variantEvidence(variants){
 const map=new Map();for(const v of Array.isArray(variants)?variants:[]){if(typeof v?.title!=='string'||!v.title.trim())continue;const key=v.title;
  // A repeated label cannot safely identify a single retained variant.
  map.set(key,map.has(key)?null:tri(v.available));
 }return map;
}
function stockValue(value){return value===true?'in_stock':value===false?'out_of_stock':'unknown';}
function numericId(value){return (typeof value==='string'&&/^[1-9]\d*$/.test(value))||(typeof value==='number'&&Number.isSafeInteger(value)&&value>0)?String(value):null;}
function productRoute(value,base){try{const u=new URL(value,base);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return null;return{url:u,host:u.hostname.toLowerCase().replace(/^www\./,''),path:u.pathname.replace(/\/+$/,'')};}catch{return null;}}
function sameProductUrl(value,source){if(typeof value!=='string')return false;const a=productRoute(value,source),b=productRoute(source);return !!(a&&b&&a.host===b.host&&a.path===b.path&&a.url.protocol===b.url.protocol&&a.url.port===b.url.port);}
function dataScripts(html){
 // Deliberately small, quote-aware HTML scanner. Never execute script text or
 // accept apparent tags within comments, raw text elements or inert templates.
 const out=[];let cursor=0,templateDepth=0;
 while(cursor<html.length){const start=html.indexOf('<',cursor);if(start<0)break;
  if(html.startsWith('<!--',start)){const end=html.indexOf('-->',start+4);if(end<0)break;cursor=end+3;continue;}
  if(html.startsWith('<![CDATA[',start)){const end=html.indexOf(']]>',start+9);if(end<0)break;cursor=end+3;continue;}
  if(html.startsWith('<!',start)||html.startsWith('<?',start)){const end=html.indexOf('>',start+2);if(end<0)break;cursor=end+1;continue;}
  const prefix=/^<(\/?)([A-Za-z][A-Za-z0-9:-]*)\b/.exec(html.slice(start));if(!prefix){cursor=start+1;continue;}
  let end=start+prefix[0].length,quote=null;for(;end<html.length;end++){const ch=html[end];if(quote){if(ch===quote)quote=null;}else if(ch==='"'||ch==="'")quote=ch;else if(ch==='>')break;}if(end>=html.length)break;
  cursor=end+1;const name=prefix[2].toLowerCase(),closing=!!prefix[1];
  if(name==='template'){templateDepth=Math.max(0,templateDepth+(closing?-1:1));continue;}if(closing)continue;
  if(name==='plaintext')break;
  if(['script','style','textarea','title','xmp','iframe','noembed','noframes','noscript'].includes(name)){
   const close=new RegExp('</'+name+'\\s*>','ig');close.lastIndex=cursor;const finish=close.exec(html);if(!finish)break;const content=html.slice(cursor,finish.index);cursor=close.lastIndex;
   if(name!=='script'||templateDepth)continue;
   const opening=html.slice(start+prefix[0].length,end),attrs={};let offset=0,valid=true;
   while(offset<opening.length){const ws=/^\s*/.exec(opening.slice(offset))[0];offset+=ws.length;if(offset===opening.length)break;
    const key=/^[^\s=<>/'"]+/.exec(opening.slice(offset));if(!key){valid=false;break;}const lower=key[0].toLowerCase();offset+=key[0].length;
    if(Object.hasOwn(attrs,lower)){valid=false;break;}offset+=/^\s*/.exec(opening.slice(offset))[0].length;let value='';
    if(opening[offset]==='='){offset++;offset+=/^\s*/.exec(opening.slice(offset))[0].length;const q=opening[offset];if(q==='"'||q==="'"){const stop=opening.indexOf(q,++offset);if(stop<0){valid=false;break;}value=opening.slice(offset,stop);offset=stop+1;}else{const v=/^[^\s<>`='"]+/.exec(opening.slice(offset));if(!v){valid=false;break;}value=v[0];offset+=v[0].length;}}
    attrs[lower]=value;
   }
   if(valid&&['application/json','application/ld+json'].includes(attrs.type?.toLowerCase()))out.push({type:attrs.type.toLowerCase(),data:content,index:start,0:html.slice(start,cursor)});
  }
 }return out;
}
function resolveShopifyEvidence(raw,html,sourceUrl,{status=200,finalUrl=sourceUrl}={}){
 const variants=Array.isArray(raw?.variants)?raw.variants:[],source=productRoute(sourceUrl),proofs=[],byId=new Map(),counts=new Map();
 const unknown=()=>({variants:variants.map(v=>({...v,available:null})),proofs});
 if(status!==200||!sameProductUrl(finalUrl,sourceUrl))return unknown();
 // Raw booleans remain useful without an HTML match. HTML fallback is enabled
 // only for an exact product id + handle/path and exact variant ids, never text.
 for(const v of variants){const id=numericId(v?.id);if(id)counts.set(id,(counts.get(id)||0)+1);}
 for(const v of variants){const id=numericId(v?.id);if(id&&counts.get(id)===1)byId.set(id,{title:v.title,values:new Set(typeof v.available==='boolean'?[v.available]:[])});}
 const rawId=numericId(raw?.id),handle=typeof raw?.handle==='string'?raw.handle:null;
 const canMatch=rawId&&handle&&source&&source.path.endsWith('/products/'+handle)&&typeof html==='string'&&Buffer.byteLength(html,'utf8')<=4*1024*1024;
 function add(id,value,kind,match){const entry=byId.get(id);if(!entry||typeof value!=='boolean')return;entry.values.add(value);proofs.push({kind,variant_id:id,available:value,utf16_offset:match.index,utf16_length:match[0].length,sha256:crypto.createHash('sha256').update(match[0]).digest('hex')});}
 function offerId(offer){if(typeof offer?.url!=='string'||!sameProductUrl(offer.url,sourceUrl))return null;const u=productRoute(offer.url,sourceUrl).url,entries=[...u.searchParams];if(entries.length!==1||entries[0][0]!=='variant'||u.hash)return null;return numericId(entries[0][1]);}
 function productGroup(group,match){
  if(group?.['@type']!=='ProductGroup'||numericId(group.productGroupID)!==rawId||!sameProductUrl(group.url,sourceUrl)||!Array.isArray(group.hasVariant))return;
  for(const v of group.hasVariant){if(v?.['@type']!=='Product')continue;const offers=Array.isArray(v.offers)?v.offers:[v.offers];for(const offer of offers){if(offer?.['@type']!=='Offer')continue;const id=offerId(offer);if(!id)continue;
    // Optional @id must independently name the same exact offer variant.
    if(v['@id']){const r=productRoute(v['@id'],sourceUrl);if(!r||!sameProductUrl(v['@id'],sourceUrl)||r.url.searchParams.get('variant')!==id||[...r.url.searchParams].length!==1)continue;}
    const value=/^https?:\/\/schema\.org\/InStock$/.test(offer.availability)?true:/^https?:\/\/schema\.org\/OutOfStock$/.test(offer.availability)?false:null;
    add(id,value,'exact_product_group_offer',match);
   }}
 }
 if(canMatch)for(const match of dataScripts(html)){
  const type=match.type;let data;try{data=JSON.parse(match.data);}catch{continue;}
  if(type==='application/json'&&data&&numericId(data.id)===rawId&&data.handle===handle&&Array.isArray(data.variants))for(const v of data.variants){const id=numericId(v?.id),entry=byId.get(id);if(entry&&v.title===entry.title)add(id,tri(v.available),'exact_product_json_variant',match);}
  if(type==='application/ld+json'){const nodes=Array.isArray(data)?data:[data];for(const node of nodes){productGroup(node,match);if(Array.isArray(node?.['@graph']))for(const child of node['@graph'])productGroup(child,match);}}
 }
 return{variants:variants.map(v=>{const id=numericId(v?.id),entry=byId.get(id);const value=id?(entry?.values.size===1?[...entry.values][0]:null):tri(v?.available);return{...v,available:value};}),proofs};
}
function schemaContract(c){
 // The reviewed caller must bind a real schema-verification receipt. No live
 // schema read is performed by this module, and the default is hard blocked.
 must(c?.verified===true&&c.availability_type==='text'&&c.availability_nullable===false&&c.availability_default==='unknown'&&Array.isArray(c.allowed_values)&&c.allowed_values.length===3&&['in_stock','out_of_stock','unknown'].every(v=>c.allowed_values.includes(v))&&/^[a-f0-9]{64}$/.test(c.receipt_sha256||''),'availability_schema_not_verified');
 return Object.freeze({...c,allowed_values:Object.freeze([...c.allowed_values])});
}
function loadVerifiedSchema(base){const bytes=fs.readFileSync(path.join(base,SCHEMA_RECEIPT.file));must(crypto.createHash('sha256').update(bytes).digest('hex')===SCHEMA_RECEIPT.sha256,'availability_schema_receipt_drift');const r=JSON.parse(bytes),s=r.availability_schema?.['product_variants.availability'],p=r.availability_schema?.['products.is_available'];must(r.project_id===SCHEMA_RECEIPT.project_id&&p?.type==='boolean'&&p.nullable===false&&p.default===true,'availability_parent_schema_mismatch');return schemaContract({verified:true,availability_type:s?.type,availability_nullable:s?.nullable,availability_default:s?.default,allowed_values:s?.allowed,receipt_sha256:SCHEMA_RECEIPT.sha256});}
function createAdapter({getContext,schema,onFailure=()=>{}}={}){
 must(typeof getContext==='function','availability_context_required');schemaContract(schema);
 const frames=new AsyncLocalStorage(),evidence=new WeakMap(),rawEvidence=new WeakMap();let poisoned=false;
 function reject(e){if(!poisoned){poisoned=true;onFailure({code:e?.code||'availability_adapter_failed'});}throw e;}
 function attempt(fn){return function(...args){try{must(!poisoned,'availability_adapter_stopped');return fn.apply(this,args);}catch(e){return reject(e);}};}
 function context(){const c=getContext();must(c?.target?.entity_id&&typeof c.url==='string'&&!c.hardStop,'availability_page_context_required');return c;}
 function frame(){const f=frames.getStore(),c=context();must(f&&f.entityId===c.target.entity_id&&f.url===c.url,'availability_save_context_required');return{f,c};}
 function wrapMerge(original){must(typeof original==='function','availability_merge_missing');return attempt(function(product,json){const result=original.apply(this,arguments);if(json?.success){const c=context(),variants=json.raw?.variants;
   must(result&&typeof result==='object','availability_merge_result_missing');
   const record={entityId:c.target.entity_id,url:c.url,byName:variantEvidence(variants),aggregate:aggregate(variants)};evidence.set(result,record);if(json.raw&&typeof json.raw==='object')rawEvidence.set(json.raw,record);
  }return result;});}
 function wrapDetect(original){must(typeof original==='function','availability_detector_missing');return attempt(function(input={}){
  const c=context();must(input.sourceUrl===c.url,'availability_detection_source_mismatch');
  if(input.shopifyProduct!==null&&input.shopifyProduct!==undefined){const resolved=resolveShopifyEvidence(input.shopifyProduct,input.html,input.sourceUrl,input),value=aggregate(resolved.variants),record=rawEvidence.get(input.shopifyProduct);
   if(record){must(record.entityId===c.target.entity_id&&record.url===c.url,'availability_detection_context_mismatch');record.byName=variantEvidence(resolved.variants);record.aggregate=value;record.proofs=resolved.proofs;}
   return value;
  }
  // Keep non-Shopify explicit signals unchanged. Missing evidence is unknown,
  // not an instruction to overwrite a previously known parent state.
  const result=original.apply(this,arguments);
  if(!result||['empty_product_html','buy_signal_missing','missing_source_url'].includes(result.reason))return{isAvailable:null,reason:'product_availability_unknown'};
  return result;
 });}
 function wrapUpdate(original){must(typeof original==='function','availability_updater_missing');return async function(productId,value,...rest){try{must(!poisoned,'availability_adapter_stopped');const{f,c}=frame();must(productId===c.productId,'availability_parent_scope_mismatch');
   if(f.aggregate.isAvailable===null)return{updated:false,reason:'availability_unknown_preserved',availabilityUnknown:true};
   must(value?.isAvailable===f.aggregate.isAvailable,'availability_parent_evidence_mismatch');return await original.call(this,productId,f.aggregate,...rest);
  }catch(e){return reject(e);}};}
 function wrapSave(original){must(typeof original==='function','availability_saver_missing');return async function(entityId,data,url,log,options={}){try{must(!poisoned,'availability_adapter_stopped');const c=context();must(entityId===c.target.entity_id&&url===c.url,'availability_saver_scope_mismatch');must(!frames.getStore(),'availability_nested_save');
   const e=evidence.get(data);if(e)must(e.entityId===entityId&&e.url===url,'availability_evidence_scope_mismatch');
   const value=e?.aggregate||(typeof options.availability?.isAvailable==='boolean'?options.availability:{isAvailable:null,reason:'product_availability_unknown'});
   const f={entityId,url,byName:e?.byName||new Map(),aggregate:value};
   return await frames.run(f,()=>original.call(this,entityId,data,url,log,{...options,availability:value}));
  }catch(e){return reject(e);}};}
 function transform(table,method,body){
  const{f,c}=frame(),many=Array.isArray(body),rows=many?body:[body];must(rows.length&&rows.every(r=>r&&typeof r==='object'),'availability_payload_required');
  if(table==='product_variants'&&method==='insert')return many?rows.map(variant):variant(rows[0]);
  function variant(row){must(row.product_id===c.productId&&c.productId,'availability_variant_scope_mismatch');return{...row,availability:stockValue(f.byName.get(row.variant_name))};}
  if(table==='products'&&method==='insert'){
   must(f.aggregate.isAvailable!==null,'new_product_availability_unknown');
   const next=rows.map(row=>{must(row.entity_id===f.entityId&&row.source_url===f.url,'availability_parent_insert_scope_mismatch');return{...row,is_available:f.aggregate.isAvailable};});return many?next:next[0];
  }
  if(table==='products'&&method==='update'&&f.aggregate.isAvailable===null)must(rows.every(r=>Object.keys(r).every(k=>!PARENT_FIELDS.has(k))),'unknown_parent_availability_write_forbidden');
  return body;
 }
 function wrapClient(gatedClient){
  must(gatedClient&&typeof gatedClient.from==='function','guarded_client_required');
  return new Proxy(gatedClient,{get(db,key){if(key!=='from'){const v=Reflect.get(db,key);return typeof v==='function'?v.bind(db):v;}return table=>{
   const inner=db.from(table);if(!['products','product_variants'].includes(table))return inner;
   function wrap(builder){return new Proxy(builder,{get(q,k){const v=Reflect.get(q,k);if(typeof v!=='function')return v;if(k==='then')return v.bind(q);return attempt(function(...args){if(['insert','update'].includes(k))args=[transform(table,k,args[0]),...args.slice(1)];const next=v.apply(q,args);return next&&typeof next==='object'?wrap(next):next;});}});}
   return wrap(inner);
  };}});
 }
 return{wrapMerge,wrapDetect,wrapUpdate,wrapSave,wrapClient,get stopped(){return poisoned;}};
}
function installIsolated({root,gatedClient,supabaseModule,getContext,schema,onFailure,requireModule=require}={}){
 must(typeof root==='string'&&path.isAbsolute(root),'availability_root_required');
 for(const[file,pin]of Object.entries(SOURCE_PINS)){const absolute=path.join(root,file);must(crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')===pin,'availability_runtime_source_drift');must(!require.cache[require.resolve(absolute)],'availability_core_module_preloaded');}
 must(supabaseModule&&typeof supabaseModule.getSupabase==='function','availability_supabase_module_required');
 const adapter=createAdapter({getContext,schema,onFailure}),originalDb=supabaseModule.getSupabase,client=adapter.wrapClient(gatedClient);const restore=[];
 function replace(obj,key,wrapped){const old=obj[key];obj[key]=wrapped;restore.push(()=>{must(obj[key]===wrapped,'availability_restore_conflict');obj[key]=old;});}
 try{
  // getSupabase and updateProductAvailability must be wrapped before the core
  // saver destructures them; pageVisitor must be loaded only after installation.
  supabaseModule.getSupabase=()=>client;restore.push(()=>{supabaseModule.getSupabase=originalDb;});
  const availability=requireModule(path.join(root,'src/availability.js')),shopify=requireModule(path.join(root,'src/shopifyProduct.js'));
  replace(shopify,'mergeGptAndJsonData',adapter.wrapMerge(shopify.mergeGptAndJsonData));
  replace(availability,'detectProductAvailability',adapter.wrapDetect(availability.detectProductAvailability));
  replace(availability,'updateProductAvailability',adapter.wrapUpdate(availability.updateProductAvailability));
  const saver=requireModule(path.join(root,'src/productSaver.js'));replace(saver,'saveProduct',adapter.wrapSave(saver.saveProduct));
 }catch(e){for(const undo of restore.reverse())undo();throw e;}
 let released=false;return{adapter,uninstall(){must(!released,'availability_already_uninstalled');released=true;for(const undo of restore.reverse())undo();}};
}
module.exports={SOURCE_PINS,SCHEMA_RECEIPT,PARENT_FIELDS,tri,aggregate,variantEvidence,stockValue,numericId,productRoute,sameProductUrl,dataScripts,resolveShopifyEvidence,schemaContract,loadVerifiedSchema,createAdapter,installIsolated};
