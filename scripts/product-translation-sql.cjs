'use strict';
// Generate a guarded, text-only transaction. No credentials or DB writer.
const columns={products:['name','display_title','original_title','metadata','description','short_description','nano_description','country_of_origin','origin_region'],product_variants:['variant_name','provenance'],coffee_facts:['process','variety','roast_level']};
function jsonSql(value){return `convert_from(decode('${Buffer.from(JSON.stringify(value)).toString('hex')}','hex'),'UTF8')::jsonb`;}
function buildTranslationSql(plan,snapshots,{commit=false}={}){
 if(plan?.version!==1 || !Array.isArray(plan.products) || !plan.products.length)throw Error('Invalid translation review plan');
 const owner=plan.products[0].entity_id,ids=new Set(plan.products.map(p=>p.id));
 if(!/^[a-f0-9-]{36}$/.test(owner) || ids.size!==plan.products.length || plan.products.some(p=>p.entity_id!==owner))throw Error('Mixed or duplicate product identities');
 const before=snapshots.products,variants=snapshots.product_variants,facts=snapshots.coffee_facts;
 if(!Array.isArray(before) || !Array.isArray(variants) || !Array.isArray(facts) || before.length!==ids.size || before.some(p=>!ids.has(p.id)||p.entity_id!==owner))throw Error('Snapshot product identities differ');
 const seen=new Set(),payload={products:[],product_variants:[],coffee_facts:[]};
 function item(table,row,patch){
  if(Object.keys(patch).some(k=>!columns[table].includes(k)))throw Error('Non-text patch rejected: '+table);
  payload[table].push({before:row,patch});
 }
 for(const p of plan.products){
  const row=before.find(r=>r.id===p.id);
  if(!row || row.source_url!==p.source_url || p.product_patch.original_title!==(row.original_title||row.name))throw Error('Source identity or original title changed');
  if(!p.product_patch.metadata?._translation?.source_language || p.product_patch.metadata._translation.target_language!=='en')throw Error('Missing original-language provenance');
  item('products',row,p.product_patch);
  for(const v of p.variant_patches){
   const old=variants.find(r=>r.id===v.id);
   if(!old || old.product_id!==p.id || v.product_id!==p.id || seen.has(v.id) || v.provenance.original_variant_name!==(old.provenance?.original_variant_name||old.variant_name||'default'))throw Error('Variant identity or original label changed');
   seen.add(v.id);item('product_variants',old,{variant_name:v.variant_name,provenance:v.provenance});
  }
  const fact=facts.find(r=>r.product_id===p.id);
  if(fact)item('coffee_facts',fact,p.facts_patch);
 }
 if(variants.some(v=>!ids.has(v.product_id)) || seen.size!==variants.length || facts.some(f=>!ids.has(f.product_id)))throw Error('Snapshot children differ');
 const sql=['begin;','set local lock_timeout = \'5s\';','create temporary table translation_changes(product_id uuid primary key) on commit drop;','create temporary table translation_counts(kind text, changed integer) on commit drop;'];
 for(const table of Object.keys(columns)){
  const key=table==='coffee_facts'?'product_id':'id',tmp='translation_'+table;
  sql.push(`create temporary table ${tmp} on commit drop as select to_jsonb(jsonb_populate_record(null::public.${table},x->'before')) as before, to_jsonb(jsonb_populate_record(null::public.${table},(x->'before')||(x->'patch'))) as desired from jsonb_array_elements(${jsonSql(payload[table])}) x;`);
  sql.push(`select count(*) from (select r.${key} from public.${table} r join ${tmp} t on r.${key}=(t.before->>'${key}')::uuid for update of r) locked;`);
  // Both the initial snapshot and the already-applied result are accepted.
  // Any price/stock/source/photo/original-text drift aborts the transaction.
  sql.push(`do $$ begin if (select count(*) from public.${table} r join ${tmp} t on r.${key}=(t.before->>'${key}')::uuid) <> (select count(*) from ${tmp}) or exists(select 1 from public.${table} r join ${tmp} t on r.${key}=(t.before->>'${key}')::uuid where to_jsonb(r)-'updated_at' is distinct from t.before-'updated_at' and to_jsonb(r)-'updated_at' is distinct from t.desired-'updated_at') then raise exception 'Translation snapshot drift: ${table}'; end if; end $$;`);
 }
 const identityGuard=`do $$ begin if (select count(*) from public.products where entity_id='${owner}'::uuid) <> ${ids.size} or (select count(*) from public.product_variants where product_id in(select (before->>'id')::uuid from translation_products)) <> ${variants.length} or (select count(*) from public.coffee_facts where product_id in(select (before->>'id')::uuid from translation_products)) <> ${facts.length} then raise exception 'Translation identity set changed'; end if; end $$;`;
 sql.push(identityGuard);
 sql.push('create temporary table translation_media_before on commit drop as select to_jsonb(m) as value from public.product_media m where product_id in(select (before->>\'id\')::uuid from translation_products);');
 for(const table of Object.keys(columns)){
  const key=table==='coffee_facts'?'product_id':'id',tmp='translation_'+table;
  // Descriptions and origins are generated from metadata in the live schema.
  const writable=table==='products'?['name','display_title','original_title','metadata']:columns[table];
  const set=writable.map(c=>`${c}=d.${c}`).join(',');
  const parent=table==='products'?'id':'product_id';
  sql.push(`with changed as(update public.${table} r set ${set} from ${tmp} t cross join lateral jsonb_populate_record(null::public.${table},t.desired) d where r.${key}=d.${key} and to_jsonb(r)-'updated_at' is distinct from t.desired-'updated_at' returning r.${parent} as product_id), marked as(insert into translation_changes select distinct product_id from changed on conflict do nothing) insert into translation_counts select '${table}',count(*)::integer from changed;`);
  sql.push(`do $$ begin if exists(select 1 from public.${table} r join ${tmp} t on r.${key}=(t.before->>'${key}')::uuid where to_jsonb(r)-'updated_at' is distinct from t.desired-'updated_at') then raise exception 'Translation readback mismatch: ${table}'; end if; end $$;`);
 }
 sql.push(identityGuard);
 sql.push(`do $$ begin if exists((select value from translation_media_before except select to_jsonb(m) from public.product_media m where product_id in(select (before->>'id')::uuid from translation_products)) union all (select to_jsonb(m) from public.product_media m where product_id in(select (before->>'id')::uuid from translation_products) except select value from translation_media_before)) then raise exception 'Translation media changed'; end if; end $$;`);
 sql.push("insert into public.catalog_change_events(product_id,content_changed,market_changed) select product_id,true,false from translation_changes;");
 sql.push("select jsonb_build_object('mode',"+(commit?"'commit'":"'rollback-preview'")+",'changed',jsonb_object_agg(kind,changed),'events',(select count(*) from translation_changes),'market_changes',0) from translation_counts;");
 sql.push(commit?'commit;':'rollback;');return sql.join('\n')+'\n';
}
module.exports={buildTranslationSql};
