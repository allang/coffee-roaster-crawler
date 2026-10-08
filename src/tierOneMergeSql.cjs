'use strict';
const {deepMerge}=require('./tierOneMergePlan.cjs');
const lit=v=>v==null?'NULL':typeof v==='boolean'?(v?'TRUE':'FALSE'):"'"+String(v).replace(/'/g,"''")+"'";
const json=v=>lit(JSON.stringify(v))+'::jsonb';
const list=ids=>ids.map(lit).join(',');
function filters(snapshot,plan) {
  const owners=list(plan.all_entity_ids),products=list(snapshot.products.map(p=>p.id));
  const result={entities:`id IN (${owners})`};
  for(const t of ['products','crawl_runs','known_pages','entity_source_ids','entity_media','entity_roles','entity_locations','entity_attributes','roasters_url_mapping'])result[t]=`entity_id IN (${owners})`;
  result.specialty_signals=`entity_id IN (${owners}) OR source_entity_id IN (${owners})`;
  result.dedupe_clusters=`canonical_entity_id IN (${owners})`;
  for(const t of plan.preserved_tables)result[t]=products?`product_id IN (${products})`:'FALSE';
  return result;
}
function fingerprintsExpression(snapshot,plan) {
  const schema="'_entity_reference_schema',(SELECT md5(jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,'definition',pg_get_constraintdef(c.oid)) ORDER BY c.conname)::text) FROM pg_constraint c WHERE c.contype='f' AND c.confrelid='public.entities'::regclass)";
  return 'jsonb_build_object('+Object.entries(filters(snapshot,plan)).map(([t,where])=>`${lit(t)},(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) FROM public.${t} t WHERE ${where})`).join(',')+','+schema+')';
}
function fingerprintSql(snapshot,plan) {return 'BEGIN READ ONLY; SELECT '+fingerprintsExpression(snapshot,plan)+'; ROLLBACK;';}
function mergeSql(snapshot,plan,fingerprints,{commit=false}={}) {
  const lines=[],ids=list(plan.all_entity_ids),dupes=list(plan.groups.map(g=>g.duplicate_id)),canons=list(plan.groups.map(g=>g.canonical_id));
  lines.push(`IF NOT EXISTS(SELECT 1 FROM public.entities WHERE id IN (${dupes})) THEN
    IF (SELECT count(*) FROM public.entities WHERE id IN (${canons})) <> ${plan.groups.length} THEN RAISE EXCEPTION 'Canonical merge records are missing'; END IF;
    IF (SELECT count(*) FROM public.entity_source_ids WHERE source='tier_one_entity_merge' AND source_id IN (${list(plan.groups.map(g=>g.duplicate_id))}) AND entity_id IN (${canons})) <> ${plan.groups.length} THEN RAISE EXCEPTION 'Merge provenance is missing'; END IF;
    IF (SELECT count(*) FROM public.products WHERE id IN (${list(snapshot.products.map(p=>p.id))}) AND entity_id IN (${canons})) <> ${snapshot.products.length} THEN RAISE EXCEPTION 'Merged product records are missing'; END IF;
    RETURN;
  END IF;`);
  lines.push(`PERFORM 1 FROM public.entities WHERE id IN (${ids}) ORDER BY id FOR UPDATE;`);
  lines.push(`IF (SELECT count(*) FROM pg_constraint WHERE contype='f' AND confrelid='public.entities'::regclass) <> 12 THEN RAISE EXCEPTION 'Entity reference schema changed; review all references'; END IF;`);
  lines.push(`IF ${fingerprintsExpression(snapshot,plan)} IS DISTINCT FROM ${json(fingerprints)} THEN RAISE EXCEPTION 'Catalog changed since preview; regenerate the plan'; END IF;`);
  // Stage both uniqueness keys inside the transaction before assigning final keys.
  if(snapshot.products.length)lines.push(`UPDATE public.products SET source_key=NULL,slug='entity-merge-stage-'||id::text WHERE id IN (${list(snapshot.products.map(p=>p.id))});`);
  for(const p of plan.products) lines.push(`UPDATE public.products SET entity_id=${lit(p.entity_id)}::uuid,slug=${lit(p.slug)},source_key=${lit(p.source_key)},metadata=${json(p.metadata)},is_active=${lit(p.is_active)},is_available=${lit(p.is_available)},availability_reason=${lit(p.availability_reason)} WHERE id=${lit(p.id)}::uuid;`);
  for(const m of plan.carried_media)lines.push(`INSERT INTO public.product_media(product_id,media_asset_id,sort_order,created_at) VALUES(${lit(m.product_id)}::uuid,${lit(m.media_asset_id)}::uuid,${Number(m.sort_order)||0},${lit(m.created_at)}) ON CONFLICT(product_id,media_asset_id) DO NOTHING;`);
  for(const g of plan.groups) {
    const a=g.canonical_id,b=g.duplicate_id;
    const fields=['website_url','description_raw','description_html','short_description','logo_url','primary_brand_color','secondary_brand_color','tertiary_brand_color','primary_location','location_hub_id','google_place_id','brand_name','enriched_at','specialty_score','category_confidence'];
    const fill=fields.filter(k=>(g.canonical_entity[k]==null||g.canonical_entity[k]==='')&&g.duplicate_entity[k]!=null&&g.duplicate_entity[k]!=='').map(k=>`${k}=${lit(g.duplicate_entity[k])}`);
    fill.push('contact='+json(deepMerge(g.canonical_entity.contact,g.duplicate_entity.contact)));
    lines.push(`UPDATE public.entities SET ${fill.join(',')} WHERE id=${lit(a)}::uuid;`);
    const roles=snapshot.entity_roles.filter(r=>r.entity_id===a||r.entity_id===b);
    for(const role of new Set(roles.map(r=>r.role))) {
      const old=roles.find(r=>r.entity_id===a&&r.role===role),other=roles.find(r=>r.entity_id===b&&r.role===role);
      const meta=deepMerge(old?.role_metadata,other?.role_metadata)||{};
      lines.push(`INSERT INTO public.entity_roles(entity_id,role,role_metadata) VALUES(${lit(a)}::uuid,${lit(role)},${json(meta)}) ON CONFLICT(entity_id,role) DO UPDATE SET role_metadata=excluded.role_metadata;`);
    }
    lines.push(`DELETE FROM public.entity_roles WHERE entity_id=${lit(b)}::uuid;`);
    lines.push(`UPDATE public.entity_source_ids SET entity_id=${lit(a)}::uuid WHERE entity_id=${lit(b)}::uuid;`);
    lines.push(`INSERT INTO public.entity_source_ids(entity_id,source,source_id,source_url,raw_data) VALUES(${lit(a)}::uuid,'tier_one_entity_merge',${lit(b)},${lit(g.canonical_entity.website_url)},${json({old_slug:g.duplicate_slug,canonical_slug:g.canonical_slug,merged_at:plan.merged_at})}) ON CONFLICT(source,source_id) DO UPDATE SET entity_id=excluded.entity_id;`);
    lines.push(`INSERT INTO public.entity_media(entity_id,media_asset_id,media_type,sort_order,source,created_at) SELECT ${lit(a)}::uuid,media_asset_id,media_type,sort_order,source,created_at FROM public.entity_media WHERE entity_id=${lit(b)}::uuid ON CONFLICT(entity_id,media_asset_id) DO NOTHING; DELETE FROM public.entity_media WHERE entity_id=${lit(b)}::uuid;`);
    lines.push(`INSERT INTO public.entity_attributes(entity_id,attribute_key,attribute_value,source,created_at) SELECT ${lit(a)}::uuid,attribute_key,attribute_value,source,created_at FROM public.entity_attributes WHERE entity_id=${lit(b)}::uuid ON CONFLICT(entity_id,attribute_key) DO UPDATE SET attribute_value=coalesce(nullif(entity_attributes.attribute_value,''),excluded.attribute_value); DELETE FROM public.entity_attributes WHERE entity_id=${lit(b)}::uuid;`);
    const provenance={duplicate_entity:g.duplicate_entity,roles:roles.filter(r=>r.entity_id===b),attributes:snapshot.entity_attributes.filter(r=>r.entity_id===b),merged_at:plan.merged_at};
    lines.push(`INSERT INTO public.entity_attributes(entity_id,attribute_key,attribute_value,source) VALUES(${lit(a)}::uuid,'merged_entity:'||${lit(b)},${lit(JSON.stringify(provenance))},'manual:tier-one-duplicate-merge:2026-10-08') ON CONFLICT(entity_id,attribute_key) DO NOTHING;`);
    lines.push(`INSERT INTO public.entity_attributes(entity_id,attribute_key,attribute_value,source) VALUES(${lit(a)}::uuid,'roaster_tier','1','manual:tier-one-duplicate-merge:2026-10-08') ON CONFLICT(entity_id,attribute_key) DO UPDATE SET attribute_value='1';`);
    const locations=snapshot.entity_locations.filter(r=>r.entity_id===a||r.entity_id===b);
    const primary=[...locations].sort((x,y)=>Number(y.lat!=null&&y.lng!=null)-Number(x.lat!=null&&x.lng!=null)||Number(y.entity_id===a)-Number(x.entity_id===a)||Number(y.is_primary)-Number(x.is_primary)||x.id.localeCompare(y.id))[0];
    lines.push(`UPDATE public.entity_locations SET is_primary=FALSE WHERE entity_id IN (${lit(a)}::uuid,${lit(b)}::uuid); UPDATE public.entity_locations SET entity_id=${lit(a)}::uuid WHERE entity_id=${lit(b)}::uuid;`);
    if(primary)lines.push(`UPDATE public.entity_locations SET is_primary=TRUE WHERE id=${lit(primary.id)}::uuid;`);
    for(const [table,column] of [['crawl_runs','entity_id'],['roasters_url_mapping','entity_id'],['specialty_signals','entity_id'],['specialty_signals','source_entity_id'],['dedupe_clusters','canonical_entity_id']])lines.push(`UPDATE public.${table} SET ${column}=${lit(a)}::uuid WHERE ${column}=${lit(b)}::uuid;`);
    if(g.duplicate_entity.route_id!=null)lines.push(`INSERT INTO public.roasters_url_mapping(requested_id,entity_id,old_name) SELECT ${g.duplicate_entity.route_id},${lit(a)}::uuid,${lit(g.duplicate_entity.name)} WHERE NOT EXISTS(SELECT 1 FROM public.roasters_url_mapping WHERE requested_id=${g.duplicate_entity.route_id});`);
    const pages=snapshot.known_pages.filter(p=>p.entity_id===a||p.entity_id===b),byUrl=new Map();
    for(const p of pages){if(!byUrl.has(p.url))byUrl.set(p.url,[]);byUrl.get(p.url).push(p);}
    for(const members of byUrl.values()) {
      members.sort((x,y)=>(Date.parse(y.last_classified_at)||0)-(Date.parse(x.last_classified_at)||0)||(Date.parse(y.last_seen_at)||0)-(Date.parse(x.last_seen_at)||0)||x.id.localeCompare(y.id));
      const winner=members[0],others=members.slice(1);
      if(others.length)lines.push(`DELETE FROM public.known_pages WHERE id IN (${list(others.map(p=>p.id))});`);
      const classification=others.length?{...(winner.classification||{}),_entity_merge_history:others.map(p=>p)}:winner.classification;
      const times=members.reduce((n,p)=>n+(p.times_seen||0),0);
      const earliest=members.map(p=>p.first_seen_at).filter(Boolean).sort()[0]||null,latest=members.map(p=>p.last_seen_at).filter(Boolean).sort().at(-1)||null;
      lines.push(`UPDATE public.known_pages SET entity_id=${lit(a)}::uuid,classification=${classification==null?'NULL':json(classification)},times_seen=${times},first_seen_at=${lit(earliest)},last_seen_at=${lit(latest)} WHERE id=${lit(winner.id)}::uuid;`);
    }
    lines.push(`DELETE FROM public.entities WHERE id=${lit(b)}::uuid;`);
  }
  for(const table of plan.preserved_tables) {
    const added=table==='product_media'&&plan.carried_media.length?' AND NOT ('+plan.carried_media.map(m=>`(product_id=${lit(m.product_id)}::uuid AND media_asset_id=${lit(m.media_asset_id)}::uuid)`).join(' OR ')+')':'';
    lines.push(`IF (SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) FROM public.${table} t WHERE ${filters(snapshot,plan)[table]}${added}) IS DISTINCT FROM ${lit(fingerprints[table])} THEN RAISE EXCEPTION 'Product child records changed: ${table}'; END IF;`);
  }
  lines.push(`IF (SELECT count(*) FROM public.products WHERE id IN (${list(snapshot.products.map(p=>p.id))})) <> ${snapshot.products.length} THEN RAISE EXCEPTION 'Product records were lost'; END IF;`);
  let tag='$ec_tier_one_merge$';while(lines.join('\n').includes(tag))tag=tag.slice(0,-1)+'x$';
  return `BEGIN; SET LOCAL standard_conforming_strings=on;\nDO ${tag}\nBEGIN\n${lines.join('\n')}\nEND;\n${tag};\nSELECT jsonb_build_object('canonical_entities',(SELECT count(*) FROM public.entities WHERE id IN (${canons})),'duplicate_entities',(SELECT count(*) FROM public.entities WHERE id IN (${dupes})),'products',(SELECT count(*) FROM public.products WHERE id IN (${list(snapshot.products.map(p=>p.id))})),'archived_product_copies',(SELECT count(*) FROM public.products WHERE entity_id IN (${canons}) AND metadata->'_entity_merge'->>'reason'='duplicate_source_identity'));\n${commit?'COMMIT':'ROLLBACK'};\n`;
}
module.exports={fingerprintSql,mergeSql};
