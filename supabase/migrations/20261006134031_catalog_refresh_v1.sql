-- REVIEW ONLY. Apply first to an isolated staging copy; never run automatically.
begin;
alter table public.products
  add column source_key text,
  add column original_title text,
  add column display_title text,
  add column availability_state text not null default 'unknown' check (availability_state in ('in_stock','sold_out','unknown','removed')),
  add column availability_evidence jsonb not null default '[]';
alter table public.products alter column is_available drop not null;
alter table public.products alter column is_available drop default;
create unique index products_source_key_unique on public.products(entity_id,source_key) where source_key is not null;
alter table public.product_variants
  add column source_key text,
  add column merchant_variant_id text,
  add column price_minor_units integer check (price_minor_units >= 0),
  add column price_amount numeric check (price_amount >= 0),
  add column currency_exponent smallint check (currency_exponent between 0 and 3),
  add column price_raw text,
  add column availability_state text not null default 'unknown' check (availability_state in ('in_stock','sold_out','unknown','removed')),
  add column availability_evidence jsonb not null default '[]',
  add column availability_checked_at timestamptz,
  add column provenance jsonb not null default '{}';
alter table public.product_variants alter column currency drop not null;
create unique index variants_source_key_unique on public.product_variants(product_id,source_key) where source_key is not null;
create table public.catalog_change_events (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products(id),
  content_changed boolean not null,
  market_changed boolean not null,
  observed_at timestamptz not null default now()
);
alter table public.catalog_change_events enable row level security;
revoke all on public.catalog_change_events from public,anon,authenticated;
grant select,insert on public.catalog_change_events to service_role;
grant usage,select on sequence public.catalog_change_events_id_seq to service_role;
create index catalog_changes_product_id on public.catalog_change_events(product_id,id);

create table public.media_source_cache (
  source_url text primary key,
  media_asset_id uuid not null references public.media_assets(id),
  checked_at timestamptz not null
);
alter table public.media_source_cache enable row level security;
revoke all on public.media_source_cache from public,anon,authenticated;
grant select,insert,update on public.media_source_cache to service_role;

create or replace function public.save_catalog_product_v1(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  p jsonb := payload->'product';
  product public.products%rowtype;
  prior public.products%rowtype;
  v jsonb;
  variant public.product_variants%rowtype;
  old_variant public.product_variants%rowtype;
  f public.coffee_facts%rowtype;
  variant_id uuid;
  seen_keys text[] := '{}';
  candidate_count integer;
  checked timestamptz := (p->>'checked_at')::timestamptz;
  content_changed boolean := false;
  market_changed boolean := false;
begin
  if p->>'source_key' is null or p->>'source_url' is null or nullif(p->>'name','') is null then raise exception 'Missing source identity or name'; end if;
  perform pg_advisory_xact_lock(hashtextextended((p->>'entity_id') || (p->>'source_key'),0));
  select * into prior from public.products where entity_id=(p->>'entity_id')::uuid and source_key=p->>'source_key' for update;
  if prior.id is null then
    select * into prior from public.products where id=(p->>'id')::uuid for update;
    if prior.id is not null and (prior.entity_id <> (p->>'entity_id')::uuid or
       (prior.source_key is not null and prior.source_key <> p->>'source_key') or
       (prior.source_key is null and prior.source_url is distinct from p->>'adopted_source_url')) then
      raise exception 'Legacy product adoption identity mismatch';
    end if;
  end if;
  if prior.id is not null and checked < greatest(prior.last_seen_at,prior.availability_checked_at) then
    return jsonb_build_object('product_id',prior.id,'content_changed',false,'market_changed',false,'stale_observation_ignored',true);
  end if;
  if prior.id is null then
    insert into public.products(id,entity_id,slug,name,source_url,source_key,original_title,display_title,product_type,is_active,first_seen_at,last_seen_at,metadata,description_html,description_raw)
    values((p->>'id')::uuid,(p->>'entity_id')::uuid,p->>'slug',p->>'name',p->>'source_url',p->>'source_key',p->>'original_title',p->>'display_title','coffee',true,checked,checked,p->'metadata',p->>'description_html',p->>'description_raw') returning * into product;
    content_changed := true;
  else
    content_changed := row(prior.name,prior.original_title,prior.display_title,prior.metadata,prior.description_html,prior.description_raw)
      is distinct from row(p->>'name',p->>'original_title',p->>'display_title',coalesce(prior.metadata,'{}') || coalesce(p->'metadata','{}'),coalesce(p->>'description_html',prior.description_html),coalesce(p->>'description_raw',prior.description_raw));
    update public.products set name=p->>'name',source_url=p->>'source_url',source_key=p->>'source_key',original_title=p->>'original_title',display_title=p->>'display_title',last_seen_at=checked,
      metadata=coalesce(prior.metadata,'{}') || coalesce(p->'metadata','{}'),description_html=coalesce(p->>'description_html',prior.description_html),description_raw=coalesce(p->>'description_raw',prior.description_raw)
      where id=prior.id returning * into product;
  end if;
  market_changed := prior.id is null or prior.availability_state is distinct from p->>'availability_state';
  update public.products set availability_state=p->>'availability_state',is_available=case p->>'availability_state' when 'in_stock' then true when 'sold_out' then false when 'removed' then false else null end,
    availability_evidence=p->'availability_evidence',availability_reason=p->>'availability_reason',availability_checked_at=checked,
    availability_last_seen_at=case when p->>'availability_state'='in_stock' then checked else availability_last_seen_at end where id=product.id;
  for v in select value from jsonb_array_elements(coalesce(payload->'variants','[]')) loop
    if v->>'source_key' = any(seen_keys) then raise exception 'Duplicate variant source key'; end if;
    seen_keys := array_append(seen_keys,v->>'source_key');
    select * into old_variant from public.product_variants where product_id=product.id and source_key=v->>'source_key' for update;
    if old_variant.id is null then
      select count(*) into candidate_count from public.product_variants where product_id=product.id and source_key is null and variant_name=v->>'variant_name' and weight_g is not distinct from (v->>'weight_g')::integer;
      if candidate_count > 1 then raise exception 'Ambiguous legacy variant adoption'; end if;
      if candidate_count = 1 then select * into old_variant from public.product_variants where product_id=product.id and source_key is null and variant_name=v->>'variant_name' and weight_g is not distinct from (v->>'weight_g')::integer for update; end if;
    end if;
    variant_id := coalesce(old_variant.id,(v->>'id')::uuid);
    variant := jsonb_populate_record(null::public.product_variants,v || jsonb_build_object('id',variant_id,'product_id',product.id));
    market_changed := market_changed or old_variant.id is null or row(old_variant.price_minor_units,old_variant.currency,old_variant.currency_exponent,old_variant.availability_state) is distinct from row(variant.price_minor_units,variant.currency,variant.currency_exponent,variant.availability_state);
    insert into public.product_variants(id,product_id,source_key,merchant_variant_id,variant_name,weight_g,price_cents,price_minor_units,price_amount,currency,currency_exponent,price_raw,availability,availability_state,availability_evidence,availability_checked_at,provenance)
      values(variant.id,product.id,variant.source_key,variant.merchant_variant_id,variant.variant_name,variant.weight_g,variant.price_cents,variant.price_minor_units,variant.price_amount,variant.currency,variant.currency_exponent,variant.price_raw,
        case when variant.availability_state='in_stock' then 'in_stock' else 'unknown' end,variant.availability_state,variant.availability_evidence,checked,variant.provenance)
      on conflict (id) do update set source_key=excluded.source_key,merchant_variant_id=excluded.merchant_variant_id,variant_name=excluded.variant_name,weight_g=excluded.weight_g,price_cents=excluded.price_cents,
        price_minor_units=excluded.price_minor_units,price_amount=excluded.price_amount,currency=excluded.currency,currency_exponent=excluded.currency_exponent,price_raw=excluded.price_raw,
        availability=excluded.availability,availability_state=excluded.availability_state,availability_evidence=excluded.availability_evidence,availability_checked_at=excluded.availability_checked_at,provenance=excluded.provenance;
  end loop;
  if payload->>'variants_complete'='true' then
    update public.product_variants set availability_state='removed',availability='unknown',availability_checked_at=checked,
      availability_evidence='[{"source":"complete_native_variant_inventory","reason":"variant_not_seen"}]'
      where product_id=product.id and source_key is not null and not(source_key=any(seen_keys)) and availability_state <> 'removed';
    if found then market_changed := true; end if;
  end if;
  f := jsonb_populate_record(null::public.coffee_facts,coalesce(payload->'facts','{}'));
  insert into public.coffee_facts(product_id,process,variety,elevation_m,roast_level,tasting_notes_raw,decaf)
    values(product.id,f.process,f.variety,f.elevation_m,f.roast_level,f.tasting_notes_raw,f.decaf)
    on conflict(product_id) do update set process=coalesce(excluded.process,coffee_facts.process),variety=coalesce(excluded.variety,coffee_facts.variety),elevation_m=coalesce(excluded.elevation_m,coffee_facts.elevation_m),
      roast_level=coalesce(excluded.roast_level,coffee_facts.roast_level),tasting_notes_raw=coalesce(excluded.tasting_notes_raw,coffee_facts.tasting_notes_raw),decaf=coalesce(excluded.decaf,coffee_facts.decaf)
    where row(coffee_facts.process,coffee_facts.variety,coffee_facts.elevation_m,coffee_facts.roast_level,coffee_facts.tasting_notes_raw,coffee_facts.decaf) is distinct from
      row(coalesce(excluded.process,coffee_facts.process),coalesce(excluded.variety,coffee_facts.variety),coalesce(excluded.elevation_m,coffee_facts.elevation_m),coalesce(excluded.roast_level,coffee_facts.roast_level),coalesce(excluded.tasting_notes_raw,coffee_facts.tasting_notes_raw),coalesce(excluded.decaf,coffee_facts.decaf));
  if content_changed or market_changed then insert into public.catalog_change_events(product_id,content_changed,market_changed,observed_at) values(product.id,content_changed,market_changed,checked); end if;
  return jsonb_build_object('product_id',product.id,'content_changed',content_changed,'market_changed',market_changed);
end;
$$;
create or replace function public.update_catalog_availability_v1(product_id uuid, observation jsonb) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
declare prior text; prior_checked timestamptz; v jsonb; changed boolean; state text := observation->>'state'; checked timestamptz := (observation->>'checkedAt')::timestamptz;
begin
  select availability_state,availability_checked_at into prior,prior_checked from public.products where id=product_id for update;
  if not found then raise exception 'Product missing for stock refresh'; end if;
  if checked < prior_checked then return; end if;
  changed := prior is distinct from state;
  update public.products set availability_state=state,is_available=case state when 'in_stock' then true when 'sold_out' then false when 'removed' then false else null end,
    availability_reason=observation->>'reason',availability_evidence=coalesce(observation->'evidence','[]'),availability_checked_at=checked,
    availability_last_seen_at=case when state='in_stock' then checked else availability_last_seen_at end where id=product_id;
  for v in select value from jsonb_array_elements(coalesce(observation->'variants','[]')) loop
    update public.product_variants pv set availability_state=v->>'state',availability_evidence=v->'evidence',availability_checked_at=checked,
      availability=case when v->>'state'='in_stock' then 'in_stock' else 'unknown' end
      where pv.product_id=update_catalog_availability_v1.product_id and merchant_variant_id=v->>'source_id' and availability_state is distinct from v->>'state';
    if found then changed:=true; end if;
  end loop;
  if state='removed' then
    update public.product_variants pv set availability_state='removed',availability='unknown',availability_checked_at=checked,availability_evidence=coalesce(observation->'evidence','[]')
      where pv.product_id=update_catalog_availability_v1.product_id and availability_state <> 'removed';
    if found then changed:=true; end if;
  end if;
  if changed then insert into public.catalog_change_events(product_id,content_changed,market_changed,observed_at) values(product_id,false,true,checked); end if;
end;
$$;
revoke all on function public.update_catalog_availability_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.update_catalog_availability_v1(uuid,jsonb) to service_role;

revoke all on function public.save_catalog_product_v1(jsonb) from public,anon,authenticated;
grant execute on function public.save_catalog_product_v1(jsonb) to service_role;
commit;
