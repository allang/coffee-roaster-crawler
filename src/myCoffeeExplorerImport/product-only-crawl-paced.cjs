'use strict';

// Finite observed-product crawl. Preview by default. Never invokes crawlRoaster,
// sitemap/BFS discovery, or whole-inventory availability reconciliation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { installLegalGuard, assertAllowedUrl } = require('./legal-guard.cjs');
const { ownerUrl, publicUrl, createTransport } = require('./product-only-network.cjs');
const { createDatabaseFetchGate } = require('./product-db-fetch-gate.cjs');
const SCOPE = 'observed_product_urls_only';
const DB_ORIGIN = 'https://gtlipifdfyugiwpxvuse.supabase.co';
const DEFAULT_ROOT = '/Users/allan/.openclaw/workspace/coffee-roaster-crawler';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
const WRITE_TABLES = new Set(['products','product_variants','coffee_facts','media_assets','product_media','known_pages']);
// Explicit supported ISO 4217 retail-currency codes, not an alias dictionary.
// Unsupported, missing or malformed codes require review; never infer USD or
// globally convert source typos (for example CND) to a different currency.
const SUPPORTED_VARIANT_CURRENCIES = new Set(('AED ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SOS SRD SSP STN SVC SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VND VUV WST XAF XCD XOF XPF YER ZAR ZMW').split(' '));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const errorCode = e => String(e?.code || e?.name || 'failed').replace(/[^a-zA-Z0-9_:-]/g,'').slice(0,100);
function fail(code) { throw Object.assign(new Error(code), { code }); }
function canonical(value) { return publicUrl(value).href.replace(/\/$/,''); }
function privateJson(file, object) {
  const temp = file + '.' + process.pid + '.tmp';
  const fd=fs.openSync(temp,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(object,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temp,file);
  const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
function pointer(value, p = '') {
  if (!p) return value;
  if (!p.startsWith('/')) fail('invalid_evidence_pointer');
  for (const key of p.slice(1).split('/').map(k=>k.replace(/~1/g,'/').replace(/~0/g,'~'))) {
    if (!value || !Object.hasOwn(value,key) || ['__proto__','prototype','constructor'].includes(key)) fail('missing_evidence_pointer');
    value = value[key];
  }
  return value;
}
function evidenceValue(ref, artifacts) {
  const a = artifacts.get(ref?.artifact_id); if (!a) fail('missing_evidence_artifact');
  let value = a.value;
  if (a.format === 'ndjson') {
    if (!Number.isSafeInteger(ref.line) || ref.line < 1 || ref.line > value.length) fail('invalid_evidence_line');
    value = value[ref.line-1];
  } else if (ref.line !== undefined) fail('unexpected_evidence_line');
  return pointer(value, ref.pointer || '');
}
function sourceKey(s) { return `${s.source}\u0000${s.source_id}`; }
function loadManifest(file) {
  const full = fs.realpathSync(file), base = path.dirname(full), bytes = fs.readFileSync(full), m = JSON.parse(bytes);
  if (m.version !== 1 || m.scope !== SCOPE || m.database_origin !== DB_ORIGIN || m.inventory_complete !== false || m.concurrency !== 1) fail('manifest_scope_or_database');
  if (!Number.isFinite(Date.parse(m.created_at || ''))) fail('manifest_timestamp');
  if (!Array.isArray(m.artifacts) || !m.artifacts.length || !Array.isArray(m.targets) || !m.targets.length || m.targets.length > 50) fail('manifest_bounds');
  const artifacts = new Map(); const evidencePaths = new Set([full]);
  for (const a of m.artifacts) {
    if (!a.id || artifacts.has(a.id) || !SHA.test(a.sha256 || '') || !['json','ndjson'].includes(a.format) || !['ownership','observations','excluded_targets'].includes(a.kind)) fail('invalid_evidence_artifact');
    const resolved = fs.realpathSync(path.resolve(base,a.path));
    if (!resolved.startsWith(base + path.sep)) fail('evidence_outside_manifest_directory');
    const b = fs.readFileSync(resolved); if (sha(b) !== a.sha256) fail('evidence_hash_mismatch');
    const value = a.format === 'ndjson' ? b.toString('utf8').split(/\r?\n/).filter(x=>x.trim()).map(JSON.parse) : JSON.parse(b);
    artifacts.set(a.id,{...a,value,resolved}); evidencePaths.add(resolved);
  }
  const excluded = new Set();
  for (const a of artifacts.values()) if (a.kind === 'excluded_targets') {
    if (!Array.isArray(a.value)) fail('invalid_exclusion_artifact');
    for (const row of a.value) { if (!UUID.test(row.entity_id || '')) fail('invalid_exclusion_id'); excluded.add(row.entity_id); }
  }
  if (!Number.isSafeInteger(m.excluded_entity_count) || m.excluded_entity_count < 1 || excluded.size !== m.excluded_entity_count) fail('exclusion_coverage_mismatch');
  const entityIds = new Set(), urlKeys = new Set(); let total = 0;
  for (const t of m.targets) {
    if (!UUID.test(t.entity_id || '') || entityIds.has(t.entity_id) || excluded.has(t.entity_id)) fail('duplicate_or_excluded_owner');
    entityIds.add(t.entity_id); publicUrl(t.website_url);
    if (!Array.isArray(t.source_ids) || !t.source_ids.length || t.source_ids.some(s=>!s.source || !s.source_id)) fail('missing_owner_sources');
    const owner = evidenceValue(t.owner_evidence, artifacts);
    if (artifacts.get(t.owner_evidence.artifact_id).kind !== 'ownership' || owner.entity_id !== t.entity_id || canonical(owner.website_url) !== canonical(t.website_url)) fail('owner_evidence_mismatch');
    const ownerSources = new Set((owner.source_ids || []).map(s=>typeof s === 'string' ? `my_coffee_explorer\u0000${s}` : sourceKey(s)));
    if (t.source_ids.some(s=>!ownerSources.has(sourceKey(s)))) fail('owner_source_evidence_mismatch');
    if (!Array.isArray(t.products) || !t.products.length || t.products.length > 100) fail('product_bounds');
    for (const product of t.products) {
      const u = ownerUrl(product.url,t.website_url);
      if (u.pathname === '/' || /\.(?:json|xml|pdf|js|css|jpe?g|png|webp|gif|svg)$/i.test(u.pathname)) fail('not_a_product_page');
      if (artifacts.get(product.observation?.artifact_id)?.kind !== 'observations') fail('missing_product_observation');
      const observed = evidenceValue(product.observation,artifacts);
      if (typeof observed !== 'string' || publicUrl(observed).href !== u.href) fail('observed_product_url_mismatch');
      const key = t.entity_id+'\n'+u.href; if (urlKeys.has(key)) fail('duplicate_product_url'); urlKeys.add(key); total++;
    }
  }
  if (total > 1000) fail('batch_product_limit');
  return { manifest:m,manifestHash:sha(bytes),full,base,artifacts,evidencePaths,total };
}
function validateOwner(t,state,ownRunId = null) {
  const e = state.entities.find(x=>x.id===t.entity_id);
  if (!e || canonical(e.website_url) !== canonical(t.website_url)) fail('owner_website_mismatch');
  if (!state.roles.some(x=>x.entity_id===t.entity_id && x.role==='roaster')) fail('owner_roaster_role_missing');
  if (state.crawlStates.some(x=>x.entity_id===t.entity_id && x.allow_crawl===false)) fail('crawl_disabled');
  if (t.source_ids.some(s=>!state.sourceIds.some(x=>x.entity_id===t.entity_id && x.source===s.source && x.source_id===s.source_id))) fail('owner_source_mismatch');
  if (state.runs.some(x=>x.entity_id===t.entity_id && x.status==='running' && x.id!==ownRunId)) fail('concurrent_crawl');
  if (ownRunId && !state.runs.some(x=>x.id===ownRunId && x.entity_id===t.entity_id && x.status==='running' && x.meta?.scope===SCOPE)) fail('own_claim_not_running');
  return e;
}
function normalizeCoffeeFacts(input) {
  let count=0;
  const normalize=row=>{if(row && typeof row.process==='string' && row.process.trim() && row.process===row.variety){count++;return {...row,process:null};}return row;};
  return {value:Array.isArray(input)?input.map(normalize):normalize(input),count};
}
function guardClassifierCurrency(classifyPage, recordRejection = () => {}) {
  if(typeof classifyPage!=='function')fail('classifier_function_missing');
  return async function(...args) {
    const result=await classifyPage.apply(this,args);
    // Preserve classifier errors/quota control unchanged. Coffee with no GPT
    // price still needs currency: Shopify merging may supply its prices later.
    if(result?.error || result?.quotaExceeded)return result;
    const data=result?.data;
    if(data?.is_coffee_page===true && data.is_product!==false && data.product && (!Object.hasOwn(data.product,'variant_price_currency') || !SUPPORTED_VARIANT_CURRENCIES.has(data.product.variant_price_currency))) {
      const code='invalid_classifier_currency';recordRejection({code});
      return {success:false,error:code};
    }
    return result;
  };
}
function guardedClient(db, authorizeWrite, recordMutationError = () => {}, recordNormalization = () => {}, recordMutationSuccess = () => {}) {
  function deny(table,operation,code){recordMutationError({table,operation,code});fail(code);}
  async function execute(table, mutation, operation) {
    if (!mutation) return await operation();
    let result;
    try {
      if (!WRITE_TABLES.has(table) && table !== 'storage.assets') fail('table_write_out_of_scope');
      if (table === 'product_variants' && mutation.operation === 'insert') {
        const body=mutation.args?.[0], records=Array.isArray(body)?body:[body];
        if (!records.length || records.some(r=>!r || typeof r.currency!=='string' || !SUPPORTED_VARIANT_CURRENCIES.has(r.currency))) fail('invalid_variant_currency');
      }
      await authorizeWrite({table,mutation});
      if(mutation.normalizedProcessCount)recordNormalization({field:'coffee_facts.process',count:mutation.normalizedProcessCount,note:'Omitted cultivar copied into processing method; variety preserved.'});
      result = await operation();
      if(!result?.error)await recordMutationSuccess({table,mutation,result});
    }
    catch (error) { recordMutationError({table,operation:mutation.operation,code:errorCode(error)}); throw error; }
    if (result?.error) recordMutationError({table,operation:mutation.operation,code:errorCode(result.error)});
    return result;
  }
  function query(builder,table,mutation,filters=[]) {
    return new Proxy(builder,{ get(o,key) {
      if (key==='then' && typeof o.then==='function') return (ok,bad)=>execute(table,mutation?{...mutation,filters}:null,()=>o).then(ok,bad);
      const value=o[key]; if(typeof value!=='function') return value;
      return (...args)=>{let normalizedProcessCount=0;if(table==='coffee_facts'&&key==='insert'){const normalized=normalizeCoffeeFacts(args[0]);args=[normalized.value,...args.slice(1)];normalizedProcessCount=normalized.count;}const next=value.apply(o,args), mut=['insert','upsert','update','delete'].includes(key)?{operation:key,args,normalizedProcessCount}:mutation;const nextFilters=['eq','neq','gt','gte','lt','lte','like','ilike','is','in','contains','containedBy','rangeGt','rangeGte','rangeLt','rangeLte','rangeAdjacent','overlaps','textSearch','match','not','or','filter'].includes(key)?[...filters,{operation:key,args}]:filters;return next && typeof next==='object'?query(next,table,mut,nextFilters):next; };
    }});
  }
  return new Proxy(db,{get(o,key) {
    if(key==='from') return table=>query(o.from(table),table,null);
    if(key==='rpc') return ()=>deny('rpc','rpc','rpc_out_of_scope');
    if(key==='schema') return ()=>deny('schema','schema','schema_out_of_scope');
    if(key==='storage') return {from:bucket=>{
      if(bucket!=='assets') return deny('storage','from','storage_bucket_out_of_scope'); const b=o.storage.from(bucket);
      return new Proxy(b,{get(obj,k){const value=obj[k];if(k==='upload') return (...args)=>execute('storage.assets',{operation:'upload',args,filters:[]},()=>value.apply(obj,args));if(k==='getPublicUrl')return value.bind(obj);if(typeof value==='function'||['remove','update','move','copy','createSignedUploadUrl'].includes(k))return ()=>deny('storage.assets',String(k),'storage_operation_out_of_scope');return value;}});
    }};
    const value=o[key];return typeof value==='function'?value.bind(o):value;
  }});
}
async function rows(query) { const {data,error}=await query; if(error) throw error; return data || []; }
async function authorizeProductMutation(db,c,{table,mutation}){
  if(!c?.target||!c.url)fail('missing_product_context');
  const op=mutation.operation,body=mutation.args?.[0],filters=mutation.filters||[];
  const exactFilter=column=>{const found=filters.filter(f=>f.operation==='eq'&&f.args[0]===column);if(found.length!==1||!found[0].args[1]||filters.some(f=>f.operation!=='eq'))fail('mutation_exact_filter_required');return found[0].args[1];};
  const recordList=()=>{const list=Array.isArray(body)?body:[body];if(!list.length||list.some(r=>!r||typeof r!=='object'))fail('mutation_records_required');return list;};
  async function ownedProduct(id){
    const found=await rows(db.from('products').select('id,entity_id,source_url,slug').eq('id',id).limit(2));
    if(found.length!==1||found[0].entity_id!==c.target.entity_id||found[0].source_url!==c.url)fail('product_owner_or_source_mismatch');
    return found[0];
  }
  async function childProduct(id){if(!c.productId||id!==c.productId)fail('child_product_scope_mismatch');return ownedProduct(id);}
  if(table==='products'){
    if(op==='update'){
      const id=exactFilter('id'),existing=await ownedProduct(id);
      if(!body||Array.isArray(body)||body.entity_id!==undefined&&body.entity_id!==c.target.entity_id||body.source_url!==undefined&&body.source_url!==c.url||body.id!==undefined&&body.id!==id||body.slug!==undefined&&body.slug!==existing.slug||body.product_type!==undefined&&body.product_type!=='coffee')fail('product_update_scope_mismatch');
      if(c.productId&&c.productId!==id)fail('different_product_in_page');c.productId=id;return;
    }
    if(op!=='insert')fail('product_operation_out_of_scope');
    const records=recordList();if(records.length!==1)fail('one_product_per_page_required');const r=records[0];
    if(r.entity_id!==c.target.entity_id||r.source_url!==c.url||r.product_type!=='coffee'||typeof r.slug!=='string'||!r.slug)fail('product_insert_scope_mismatch');
    if((await rows(db.from('products').select('id,source_url').eq('entity_id',c.target.entity_id).eq('slug',r.slug).limit(2))).length)fail('product_slug_collision');
    if((await rows(db.from('products').select('id').eq('entity_id',c.target.entity_id).eq('source_url',c.url).limit(2))).length)fail('product_source_already_present');
    return;
  }
  if(['product_variants','coffee_facts','product_media'].includes(table)){
    if(op==='delete'&&table!=='product_media'){await childProduct(exactFilter('product_id'));return;}
    if(op!=='insert')fail('child_operation_out_of_scope');
    for(const row of recordList()){
      await childProduct(row.product_id);
      if(table==='product_media'){
        const assets=await rows(db.from('media_assets').select('id,content_hash').eq('id',row.media_asset_id).limit(2));
        if(assets.length!==1||!c.imageHashes?.has(assets[0].content_hash))fail('unobserved_media_link');
      }
    }
    return;
  }
  if(table==='known_pages'){
    if(op!=='upsert'||mutation.args?.[1]?.onConflict!=='entity_id,url')fail('known_page_operation_out_of_scope');
    const records=recordList();if(records.length!==1)fail('one_known_page_required');
    for(const row of records){if(row.entity_id!==c.target.entity_id||row.url!==c.url||!['coffee','irrelevant'].includes(row.status))fail('known_page_scope_mismatch');if(row.status==='coffee')await childProduct(c.productId);}
    return;
  }
  if(table==='storage.assets'){
    const [key,bytes]=mutation.args||[],m=typeof key==='string'&&key.match(/^products\/([^/]+)\/([a-f0-9]{32})\.(?:jpg|png|webp|avif|gif)$/);
    if(op!=='upload'||!m||!Buffer.isBuffer(bytes)||!c.imageHashes?.has(m[2])||crypto.createHash('md5').update(bytes).digest('hex')!==m[2])fail('storage_product_scope_mismatch');
    await childProduct(m[1]);return;
  }
  if(table==='media_assets'){
    if(op!=='insert')fail('media_operation_out_of_scope');
    for(const row of recordList()){
      if(!c.imageHashes?.has(row.content_hash))fail('unobserved_media_asset');
      const u=new URL(row.url),prefix='/storage/v1/object/public/assets/',key=decodeURIComponent(u.pathname.slice(prefix.length));
      if(u.origin!==DB_ORIGIN||!u.pathname.startsWith(prefix)||!c.uploadedPaths?.has(key)||!key.match(new RegExp('/'+row.content_hash+'\\.(?:jpg|png|webp|avif|gif)$')))fail('media_asset_upload_proof_missing');
    }
    return;
  }
  fail('table_write_out_of_scope');
}
function backendFor(db) {
  async function productProof(t,url,productId) {
    let query=db.from('products').select('id,entity_id,source_url').eq('entity_id',t.entity_id).eq('source_url',url);
    if(productId)query=query.eq('id',productId);
    const found=await rows(query.limit(2));
    if(found.length!==1 || found[0].entity_id!==t.entity_id || found[0].source_url!==url || !found[0].id || productId&&found[0].id!==productId)return null;
    return {productId:found[0].id,entity_id:found[0].entity_id,source_url:found[0].source_url};
  }
  return {
    productProof,
    async state(t) { const id=t.entity_id; const [entities,roles,crawlStates,sourceIds,runs]=await Promise.all([
      rows(db.from('entities').select('id,name,website_url').eq('id',id)),
      rows(db.from('entity_roles').select('entity_id,role').eq('entity_id',id)),
      rows(db.from('entity_crawl_state').select('entity_id,allow_crawl').eq('entity_id',id)).catch(e=>{if(e.code==='PGRST205')return [];throw e;}),
      rows(db.from('entity_source_ids').select('entity_id,source,source_id').eq('entity_id',id)),
      rows(db.from('crawl_runs').select('id,entity_id,status,meta').eq('entity_id',id).eq('status','running')),
    ]); if([sourceIds,roles,runs].some(x=>x.length>=1000))fail('state_may_be_truncated');return {entities,roles,crawlStates,sourceIds,runs}; },
    async schema() { const {error}=await db.from('crawl_runs').select('id,meta').limit(0);if(error)fail('scoped_crawl_runs_unsupported');return true; },
    async known(t,url) {
      const found=await rows(db.from('known_pages').select('url,status').eq('entity_id',t.entity_id).eq('url',url).limit(2));
      if(found.length!==1 || !['coffee','irrelevant'].includes(found[0].status))return null;
      if(found[0].status==='irrelevant')return {classified:true,isCoffee:false,knownStatus:'irrelevant',productId:null};
      const proof=await productProof(t,url);return proof?{classified:true,isCoffee:true,knownStatus:'coffee',productId:proof.productId,productProof:proof}:null;
    },
    async claim(t,manifestHash,count) {
      const record={entity_id:t.entity_id,status:'running',platform:'unknown',started_at:new Date().toISOString(),meta:{scope:SCOPE,inventory_complete:false,manifest_sha256:manifestHash,seed_url_count:count,concurrency:1}};
      const {data,error}=await db.from('crawl_runs').insert(record).select('id,entity_id,status,meta').single();if(error)throw error;if(!data?.id || data.meta?.manifest_sha256!==manifestHash || data.meta?.scope!==SCOPE)fail('claim_not_verified');return data.id;
    },
    async finish(t,id,status,stats,manifestHash) {
      const result=await db.from('crawl_runs').update({status,finished_at:new Date().toISOString(),pages_discovered:stats.count,pages_visited:stats.visited,pages_sent_to_gpt:stats.classified,coffees_found:stats.coffees,error:status==='failed'?'product_only_batch_incomplete':null})
        .eq('id',id).eq('entity_id',t.entity_id).eq('status','running').contains('meta',{scope:SCOPE,manifest_sha256:manifestHash}).select('id,meta');
      if(result.error)throw result.error;if(result.data?.length!==1)fail('claim_finish_compare_and_set_failed');
    },
  };
}
function validateCheckpoint(checkpoint, hash) {
  if(checkpoint.version!==1 || checkpoint.scope!==SCOPE || checkpoint.manifestHash!==hash || !checkpoint.results || !checkpoint.claims)fail('checkpoint_manifest_mismatch');
  if(checkpoint.batchStop)fail('checkpoint_batch_stop_requires_review');
  if(Object.values(checkpoint.results).some(x=>x.status==='running'))fail('interrupted_url_requires_review');
}
function cliArgs(argv) {
  const o={run:false,retryFailed:false,crawlerRoot:DEFAULT_ROOT};
  for(let i=0;i<argv.length;i++){const a=argv[i];if(a==='--run')o.run=true;else if(a==='--retry-failed')o.retryFailed=true;else if(a==='--help')o.help=true;else if(['--manifest','--output-dir','--crawler-root'].includes(a)){if(!argv[i+1]||argv[i+1].startsWith('--'))fail('missing_argument');o[a.slice(2).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=argv[++i];}else fail('unknown_argument');}
  return o;
}

async function run(options, deps = {}) {
  const loaded=loadManifest(options.manifest), {manifest:m,manifestHash}=loaded;
  const out=path.resolve(options.outputDir || path.join(loaded.base,'product-only-paced-'+manifestHash.slice(0,12)));
  if(loaded.evidencePaths.has(out) || [...loaded.evidencePaths].some(p=>p.startsWith(out+path.sep)))fail('output_overlaps_evidence');
  fs.mkdirSync(out,{recursive:true,mode:0o700});
  const scopeFile=path.join(out,'scope.json');
  if(fs.existsSync(scopeFile)){const prior=JSON.parse(fs.readFileSync(scopeFile));if(prior.scope!==SCOPE || prior.manifestHash!==manifestHash)fail('output_scope_mismatch');}
  else{if(fs.readdirSync(out).length)fail('output_directory_not_owned');privateJson(scopeFile,{scope:SCOPE,manifestHash,inventory_complete:false});}
  const stopFile=path.join(out,'batch-stop.json');
  if(fs.existsSync(stopFile))fail('checkpoint_batch_stop_requires_review');
  const checkpointFile=path.join(out,'checkpoint.json'),summaryFile=path.join(out,options.run?'summary.json':'preview.json');
  const checkpoint=fs.existsSync(checkpointFile)?JSON.parse(fs.readFileSync(checkpointFile)):{version:1,scope:SCOPE,manifestHash,results:{},claims:{}};
  validateCheckpoint(checkpoint,manifestHash);
  // A process restart is not permission to move past an access/safety stop.
  // Old checkpoints contain the stop on the attempted URL, even when the other
  // URLs were never checkpointed. Keep that entity stopped until explicit review
  // and --retry-failed; a fresh attempt still passes every unchanged page guard.
  const priorStops=new Map();
  if(!options.retryFailed)for(const result of Object.values(checkpoint.results))if(result.hardStop)priorStops.set(result.entityId,result.hardStop);
  const summary={version:1,scope:SCOPE,inventory_complete:false,mode:options.run?'run':'preview',manifestHash,startedAt:new Date().toISOString(),targetCount:m.targets.length,urlCount:loaded.total,targets:[],notes:['A completed crawl_runs row means this seed subset completed, not full inventory. Existing full-site schedulers may impose their normal 24-hour cooldown.']};
  const context=new AsyncLocalStorage(); let backend=deps.backend,visitor=deps.visitor,Accumulator=deps.Accumulator,transport=deps.transport;
  let dbGate,guard,lockFd,auditFd,cleanup=()=>{},globalStop=[...priorStops.values()].includes('quota_exceeded')?'checkpoint_quota_stop_requires_review':null; const batchLock=path.join(out,'runner.lock');
  let checkpointWriteFailed=false;
  function stopBatch(code){
    globalStop ||= code;
    if(!checkpoint.batchStop){
      checkpoint.batchStop={code:globalStop,at:new Date().toISOString(),manifestHash};
      // Separate durable marker also covers a checkpoint-write failure. Neither
      // restart nor --retry-failed is authority to reopen this stopped batch.
      privateJson(stopFile,checkpoint.batchStop);
      if(!checkpointWriteFailed)saveCheckpoint();
    }
  }
  function saveCheckpoint(){
    try{privateJson(checkpointFile,checkpoint);}
    catch(error){checkpointWriteFailed=true;stopBatch('checkpoint_persistence_failure_requires_review');throw error;}
  }
  const log=deps.log || Object.fromEntries(['info','warn','error','success','header','headerWhite','divider'].map(k=>[k,()=>{}]));
  try {
    if(options.run){lockFd=fs.openSync(batchLock,'wx',0o600);fs.writeFileSync(lockFd,JSON.stringify({pid:process.pid,manifestHash,startedAt:summary.startedAt}));}
    if(!backend){
      if(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL||'https://invalid.invalid').origin!==DB_ORIGIN)fail('runtime_database_mismatch');
      auditFd=fs.openSync(path.join(out,'requests.ndjson'),'a',0o600);
      const audit=e=>fs.writeSync(auditFd,JSON.stringify(e)+'\n');
      guard=installLegalGuard({internalDataOrigin:DB_ORIGIN,context:()=>{const c=context.getStore();return c?{entityId:c.target.entity_id,scope:SCOPE}:null;},onEvent:audit});
      const root=fs.realpathSync(options.crawlerRoot||DEFAULT_ROOT),supabaseModule=require(path.join(root,'src/supabase.js'));
      process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';
      const {config}=require(path.join(root,'src/config.js'));
      if(new URL(config.supabase.url).href!==DB_ORIGIN+'/')fail('runtime_database_mismatch');
      const {createClient}=require(path.join(root,'node_modules/@supabase/supabase-js'));
      dbGate=createDatabaseFetchGate(globalThis.fetch.bind(globalThis),{
        onEvent:e=>audit({at:new Date().toISOString(),...e}),
        onStop:e=>{stopBatch('database_gate_stop_requires_review');audit({at:new Date().toISOString(),event:'database_gate_stopped',...e});},
      });
      const db=createClient(config.supabase.url,config.supabase.serviceRoleKey,{
        auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:dbGate.fetch},
      }); backend=backendFor(db);
      if(options.run){
        const httpClient=require(path.join(root,'src/httpClient.js'));
        process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';
        if(httpClient.hasProxies())fail('proxy_pool_must_be_empty');
        transport=createTransport({context:()=>context.getStore(),onEvent:audit});
        const saved={fetchHtml:httpClient.fetchHtml,fetchJson:httpClient.fetchJson,fetchImage:httpClient.fetchImage,getSupabase:supabaseModule.getSupabase};
        Object.assign(httpClient,transport);
        const gated=guardedClient(db,async descriptor=>{const c=context.getStore();if(globalStop)fail(globalStop);if(!c || c.hardStop)fail(c?.hardStop||'missing_product_context');try{validateOwner(c.target,await backend.state(c.target),c.runId);await authorizeProductMutation(db,c,descriptor);}catch(error){c.hardStop=errorCode(error);throw error;}},error=>{stopBatch('persistence_error_requires_review');const c=context.getStore();if(c){c.persistenceErrors ||= [];c.persistenceErrors.push(error);c.hardStop ||= 'persistence_error';}},note=>{const c=context.getStore();if(c){c.normalizations ||= [];c.normalizations.push(note);}},({table,mutation,result})=>{const c=context.getStore();if(table==='products'&&mutation.operation==='insert'){if(!result.data?.id)fail('inserted_product_id_missing');c.productId=result.data.id;}if(table==='storage.assets'){c.uploadedPaths ||= new Set();c.uploadedPaths.add(mutation.args[0]);}});
        supabaseModule.getSupabase=()=>gated;
        cleanup=()=>{Object.assign(httpClient,{fetchHtml:saved.fetchHtml,fetchJson:saved.fetchJson,fetchImage:saved.fetchImage});supabaseModule.getSupabase=saved.getSupabase;};
        // Intercept before pageVisitor captures classifyPage by destructuring.
        // This stops the core's missing-currency USD fallback without editing it.
        const classifier=require(path.join(root,'src/gptClassifier.js')),originalClassify=classifier.classifyPage,restoreTransportAndDb=cleanup;
        classifier.classifyPage=guardClassifierCurrency(originalClassify,error=>{const c=context.getStore();if(!c)fail('missing_product_context');c.classificationErrors ||= [];c.classificationErrors.push(error);c.hardStop ||= error.code;});
        cleanup=()=>{classifier.classifyPage=originalClassify;restoreTransportAndDb();};
        // Must load after all isolated transport, classifier and write gates.
        const modulePath=path.join(root,'src/pageVisitor.js');if(require.cache[require.resolve(modulePath)])fail('page_visitor_preloaded');
        visitor=require(modulePath).visitAndClassifyPage;
        Accumulator=require(path.join(root,'src/urlAccumulator.js')).UrlAccumulator;
      }
    }
    await backend.schema();
    for(const t of m.targets){
      const item={entity_id:t.entity_id,website_url:t.website_url,status:'preview',urlCount:t.products.length,results:[]};summary.targets.push(item);
      if(globalStop){item.status='not_attempted_after_stop';item.error=globalStop;continue;}
      if(priorStops.has(t.entity_id)){
        item.status='held';item.error='checkpoint_hard_stop_requires_review';item.hardStop=priorStops.get(t.entity_id);
        item.priorStopEvidence=Object.values(checkpoint.results).filter(r=>r.entityId===t.entity_id&&r.hardStop).map(r=>({url:r.url,error:r.error,hardStop:r.hardStop,challengeReason:r.challengeReason||null,finishedAt:r.finishedAt||null}));
        item.results=t.products.map(p=>({url:p.url,status:'not_attempted_after_stop',hardStop:item.hardStop}));
        continue;
      }
      let ownRunId=null,entityLockFd,entityLock,finishAttempted=false;
      const finishOnce=async(status,stats)=>{
        if(finishAttempted)fail('claim_finalization_already_attempted');
        finishAttempted=true;
        try{
          if(checkpointWriteFailed)fail('checkpoint_persistence_failure_requires_review');
          if(dbGate?.state().stopped)fail('database_gate_stopped');
          await backend.finish(t,ownRunId,status,stats,manifestHash);
        }catch(error){
          stopBatch('claim_finalization_failure_requires_review');
          item.claimFinalizationError=errorCode(error);
          throw error;
        }
      };
      try {
        validateOwner(t,await backend.state(t));
        for(const p of t.products){
          const url=publicUrl(p.url).href,key=sha(t.entity_id+'\n'+url),prior=checkpoint.results[key];
          if(prior?.status==='complete'||prior?.status==='known'){
            let proof=null;
            if(prior.isCoffee){if(!prior.productId)fail('checkpoint_product_id_missing');proof=await backend.productProof(t,url,prior.productId);if(!proof)fail('checkpoint_product_proof_missing');}
            item.results.push({url:p.url,status:'checkpoint_complete',classified:prior.classified===true,isCoffee:prior.isCoffee===true,productId:proof?.productId||null,productProof:proof});
          }else if(prior?.status==='failed'&&!options.retryFailed)item.results.push({url:p.url,status:'failed_requires_retry_flag',error:prior.error||null,hardStop:prior.hardStop||null,partialPersistence:prior.partialPersistence===true,persistenceErrors:prior.persistenceErrors||[]});
          else item.results.push({url:p.url,status:'eligible'});
        }
        if(!options.run)continue;
        if(!item.results.some(x=>x.status==='eligible')){item.status=item.results.some(x=>x.status==='failed_requires_retry_flag')?'failed':'no_eligible_urls';continue;}
        const locks=deps.lockDirectory||path.join(options.crawlerRoot||DEFAULT_ROOT,'.state/my-coffee-explorer/.product-only-entity-locks');
        fs.mkdirSync(locks,{recursive:true,mode:0o700});entityLock=path.join(locks,t.entity_id+'.lock');entityLockFd=fs.openSync(entityLock,'wx',0o600);fs.writeFileSync(entityLockFd,JSON.stringify({pid:process.pid,manifestHash}));
        validateOwner(t,await backend.state(t));
        try{ownRunId=await backend.claim(t,manifestHash,t.products.length);}catch(error){stopBatch('claim_creation_failure_requires_review');throw error;}
        checkpoint.claims[t.entity_id]={runId:ownRunId,status:'running'};saveCheckpoint();
        validateOwner(t,await backend.state(t),ownRunId);
        const accumulator=new Accumulator(t.entity_id,t.name||t.entity_id,log);
        let stop=false;
        for(let index=0;index<t.products.length;index++){
          const product=t.products[index],result=item.results[index];if(result.status!=='eligible')continue;
          if(stop||globalStop){result.status='not_attempted_after_stop';continue;}
          const url=publicUrl(product.url).href,key=sha(t.entity_id+'\n'+url);
          validateOwner(t,await backend.state(t),ownRunId);
          const known=await backend.known(t,url);
          if(known){checkpoint.results[key]={entityId:t.entity_id,url,status:'known',...known,finishedAt:new Date().toISOString()};Object.assign(result,{status:'known'},known);saveCheckpoint();continue;}
          checkpoint.results[key]={entityId:t.entity_id,url,status:'running',startedAt:new Date().toISOString()};saveCheckpoint();
          const c={target:t,url,runId:ownRunId,images:new Set(),networkErrors:[]};
          const processed=await context.run(c,async()=>{
            try {
              const fetched=await transport.fetchHtml(url);
              if(!fetched.success)fail(c.hardStop||fetched.error||'fetch_failed');
              validateOwner(t,await backend.state(t),ownRunId);
              accumulator.addUrl(url,'manual');
              const platform=/shopify|cdn\.shopify\.com/i.test(String(fetched.data))?'shopify':'unknown';
              const visited=await visitor(t.entity_id,url,accumulator,log,platform);
              if(c.hardStop)fail(c.hardStop);
              if(visited.quotaExceeded){c.hardStop='quota_exceeded';fail('quota_exceeded');}
              if(visited.error || !visited.classified)fail('page_processing_failed');
              if(visited.isCoffee && !visited.productId)fail('coffee_not_saved');
              const proof=visited.isCoffee?await backend.productProof(t,url,visited.productId):null;
              if(visited.isCoffee && !proof)fail('saved_product_proof_missing');
              return {status:'complete',classified:true,isCoffee:visited.isCoffee===true,productId:proof?.productId||null,productProof:proof,networkWarnings:c.networkErrors,normalizations:c.normalizations||[]};
            }catch(error){return {status:'failed',error:errorCode(error),hardStop:c.hardStop||null,challengeReason:c.challengeReason||null,partialPersistence:!!c.persistenceErrors?.length,persistenceErrors:c.persistenceErrors||[],normalizations:c.normalizations||[]};}
          });
          Object.assign(result,processed);checkpoint.results[key]={...checkpoint.results[key],...processed,finishedAt:new Date().toISOString()};saveCheckpoint();
          if(processed.hardStop || processed.error==='concurrent_crawl')stop=true;
          if(processed.error==='quota_exceeded')stopBatch('quota_exceeded');
        }
        const failed=item.results.some(x=>['failed','failed_requires_retry_flag','not_attempted_after_stop'].includes(x.status));
        item.status=failed?'failed':'complete';
        const stats={count:t.products.length,visited:item.results.filter(x=>['complete','failed'].includes(x.status)).length,classified:item.results.filter(x=>x.status==='complete'&&x.classified).length,coffees:item.results.filter(x=>x.status==='complete'&&x.isCoffee).length};
        await finishOnce(item.status==='complete'?'completed':'failed',stats);checkpoint.claims[t.entity_id].status=item.status;saveCheckpoint();
      }catch(error){
        item.status='held';item.error=errorCode(error);
        if(ownRunId&&!finishAttempted){try{await finishOnce('failed',{count:t.products.length,visited:item.results.filter(x=>['complete','failed'].includes(x.status)).length,classified:item.results.filter(x=>x.status==='complete'&&x.classified).length,coffees:item.results.filter(x=>x.status==='complete'&&x.isCoffee).length});checkpoint.claims[t.entity_id].status='failed';saveCheckpoint();}catch(finishError){item.claimFinalizationError=errorCode(finishError);}}
      }finally{if(entityLockFd!==undefined){fs.closeSync(entityLockFd);fs.unlinkSync(entityLock);}}
    }
    return summary;
  }finally{
    if(dbGate)await dbGate.drain();
    summary.globalStop=globalStop;summary.databaseGate=dbGate?dbGate.state():null;
    summary.finishedAt=new Date().toISOString();summary.guard=guard?{...guard.stats}:null;
    try{privateJson(summaryFile,summary);}finally{cleanup();if(guard)guard.uninstall();if(auditFd!==undefined)fs.closeSync(auditFd);if(lockFd!==undefined){fs.closeSync(lockFd);fs.unlinkSync(batchLock);}}
  }
}
if(require.main===module){const options=cliArgs(process.argv.slice(2));if(options.help)console.log('node product-only-crawl-paced.cjs --manifest FILE [--output-dir DIRECTORY] [--crawler-root DIRECTORY] [--run] [--retry-failed]\nPreview is default; concurrency is fixed at1. No sitemap/BFS or inventory reconciliation.');else if(!options.manifest){console.error('manifest_required');process.exitCode=1;}else run(options).then(s=>{console.log(JSON.stringify({scope:s.scope,mode:s.mode,targetCount:s.targetCount,urlCount:s.urlCount,statuses:s.targets.map(x=>({entity_id:x.entity_id,status:x.status,error:x.error}))},null,2));if(s.targets.some(x=>['held','failed','not_attempted_after_stop'].includes(x.status)))process.exitCode=1;}).catch(e=>{console.error(errorCode(e));process.exitCode=1;});}
module.exports={SCOPE,DB_ORIGIN,loadManifest,validateOwner,normalizeCoffeeFacts,guardClassifierCurrency,guardedClient,authorizeProductMutation,backendFor,validateCheckpoint,cliArgs,run,sha};
