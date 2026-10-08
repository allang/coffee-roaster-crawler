'use strict';
const {canonicalProductUrl,stableKey}=require('./catalogNormalization');
const {isDeepStrictEqual}=require('node:util');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function deepMerge(a,b) {
  if(a && b && typeof a==='object' && typeof b==='object' && !Array.isArray(a) && !Array.isArray(b)) {
    const result={...b,...a};
    for(const k of Object.keys(b))if(Object.hasOwn(a,k))result[k]=deepMerge(a[k],b[k]);
    return result;
  }
  return a==null || a==='' ? b : a;
}
function nativeId(p) {
  const value=p.metadata?._normalization?.source_product_id;
  return typeof value==='string' && value.trim() && value!=='null' && value.length<=200 || typeof value==='number' && Number.isSafeInteger(value) && value>0 ? String(value) : null;
}
function timestamp(p) {return Math.max(Date.parse(p.last_seen_at)||0,Date.parse(p.availability_last_seen_at)||0);}
function buildPlan(snapshot,pairs,mergedAt) {
  const all=new Set(),operations=[],groups=[];
  for(const [name,canonical,duplicate] of pairs) {
    if(!UUID.test(canonical)||!UUID.test(duplicate)||canonical===duplicate||all.has(canonical)||all.has(duplicate))throw Error('Invalid or overlapping merge IDs');
    all.add(canonical);all.add(duplicate);
    const a=snapshot.entities.find(e=>e.id===canonical),b=snapshot.entities.find(e=>e.id===duplicate);
    if(!a || !b)throw Error('Both reviewed entities must exist when preparing a new plan');
    if(a.slug.length>b.slug.length)throw Error('Canonical slug is not the simpler existing slug');
    const products=snapshot.products.filter(p=>[canonical,duplicate].includes(p.entity_id));
    const url=new Map(),native=new Map(),parents=new Map(products.map(p=>[p.id,p.id]));
    const find=id=>parents.get(id)===id?id:(parents.set(id,find(parents.get(id))),parents.get(id));
    const union=(id,prior)=>{if(prior)parents.set(find(id),find(prior));};
    for(const p of products) {
      let key;try{key=canonicalProductUrl(p.source_url);}catch{key='unresolved:'+p.id;}
      union(p.id,url.get(key));url.set(key,p.id);
      const id=nativeId(p);if(id){union(p.id,native.get(id));native.set(id,p.id);}
    }
    const grouped=new Map();for(const p of products){const k=find(p.id);if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(p);}
    const winners=[];
    for(const members of grouped.values()) {
      members.sort((x,y)=>Number(Boolean(nativeId(y)))-Number(Boolean(nativeId(x))) || timestamp(y)-timestamp(x) || Number(y.entity_id===canonical)-Number(x.entity_id===canonical) || x.id.localeCompare(y.id));
      const winner=members[0];winners.push(winner);
      for(const p of members) {
        const alias=p.id!==winner.id;
        const marker={reason:alias?'duplicate_source_identity':'entity_reassigned',canonical_entity_id:canonical,original_entity_id:p.entity_id,original_source_key:p.source_key,original_slug:p.slug,was_active:p.is_active,was_available:p.is_available,merged_at:mergedAt,...(alias?{canonical_product_id:winner.id}:{})};
        let sourceKey=p.source_key;
        if(alias)sourceKey=null;
        else if(sourceKey!=null) {let source;try{source=canonicalProductUrl(p.source_url);}catch{throw Error('Cannot safely re-key native product with invalid source URL');}sourceKey=stableKey(canonical,nativeId(p)?['native',nativeId(p)]:['url',source]);}
        operations.push({id:p.id,entity_id:canonical,slug:alias?`${p.slug.slice(0,120)}-merged-${p.id}`:p.slug,source_key:sourceKey,metadata:{...(p.metadata||{}),_entity_merge:marker},is_active:alias?false:p.is_active,is_available:alias?false:p.is_available,availability_reason:alias?'merged_duplicate':p.availability_reason,alias,canonical_product_id:winner.id});
      }
    }
    const used=new Set();
    for(const op of operations.filter(p=>p.entity_id===canonical).sort((x,y)=>Number(x.alias)-Number(y.alias)||x.id.localeCompare(y.id))) {
      if(used.has(op.slug))op.slug=`${op.slug.slice(0,120)}-merged-${op.id}`;
      if(used.has(op.slug))throw Error('Unresolved product slug collision');used.add(op.slug);
    }
    const keys=operations.filter(p=>p.entity_id===canonical&&p.source_key!=null).map(p=>p.source_key);
    if(new Set(keys).size!==keys.length)throw Error('Unresolved native source identity collision');
    groups.push({name,canonical_id:canonical,canonical_slug:a.slug,duplicate_id:duplicate,duplicate_slug:b.slug,products:products.length,retained_products:winners.length,archived_duplicates:products.length-winners.length,canonical_entity:a,duplicate_entity:b});
  }
  const carried_media=[];
  for(const winner of operations.filter(p=>!p.alias)) {
    if(snapshot.product_media.some(m=>m.product_id===winner.id))continue;
    const aliases=new Set(operations.filter(p=>p.alias&&p.canonical_product_id===winner.id).map(p=>p.id)),seen=new Set();
    for(const m of snapshot.product_media.filter(m=>aliases.has(m.product_id))) {
      if(seen.has(m.media_asset_id))continue;seen.add(m.media_asset_id);
      carried_media.push({...m,product_id:winner.id,created_at:mergedAt});
    }
  }
  return {version:1,merged_at:mergedAt,groups,products:operations,carried_media,preserved_tables:['product_variants','product_media','coffee_facts','product_flavor_claims','product_flavor_tags'],all_entity_ids:[...all]};
}
function assertPreserved(before,after,plan) {
  const sorted=rows=>[...rows].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  for(const table of plan.preserved_tables) {
    if(table==='product_media') {
      if(!before[table].every(p=>after[table].some(q=>isDeepStrictEqual(p,q)))||after[table].length!==before[table].length+plan.carried_media.length)throw Error('Changed existing product photos');
    } else if(!isDeepStrictEqual(sorted(before[table]),sorted(after[table])))throw Error('Changed preserved table: '+table);
  }
  if(before.products.length!==after.products.length)throw Error('Product records were lost');
  const untouched=['id','source_url','original_title','display_title','name','description','description_raw','description_html','original_image_url','availability_state','availability_evidence','availability_checked_at','availability_last_seen_at'];
  for(const p of before.products) {
    const q=after.products.find(v=>v.id===p.id);if(!q)throw Error('Product ID was lost');
    for(const k of untouched)if(!isDeepStrictEqual(p[k],q[k]))throw Error('Changed product evidence: '+k);
  }
}
module.exports={buildPlan,deepMerge,assertPreserved};
