-- Additive review-only migration; do not edit/reapply catalog_refresh_v1.
begin;
alter table public.coffee_facts
  add column process_methods text[] not null default '{}',
  add column is_coferment boolean,
  add column coferment_ingredients text[] not null default '{}',
  add column processing_evidence jsonb not null default '{}';
alter table public.coffee_facts
  add constraint coffee_process_methods_known check (process_methods <@ array['washed','natural','honey','wet_hulled','anaerobic','aerobic','carbonic_maceration','lactic_fermentation','thermal_shock']::text[] and array_position(process_methods,null) is null),
  add constraint coffee_coferment_ingredients_disclosed check (array_position(coferment_ingredients,null) is null and (is_coferment is true or cardinality(coferment_ingredients)=0)),
  add constraint coffee_processing_evidence_object check (jsonb_typeof(processing_evidence)='object');
comment on column public.coffee_facts.process is 'Full reported processing wording; methods may overlap (e.g. anaerobic natural).';
comment on column public.coffee_facts.is_coferment is 'True: disclosed co-fermentation. False: explicitly denied. NULL: unknown/undisclosed/conflicting. Fruity tasting notes are not evidence.';
comment on column public.coffee_facts.coferment_ingredients is 'Only explicitly disclosed added materials; empty does not mean no ingredient when co-ferment is true or unknown.';
create index coffee_facts_process_methods_idx on public.coffee_facts using gin(process_methods);
create index coffee_facts_coferment_idx on public.coffee_facts(product_id) where is_coferment is true;

-- Keep the existing tested transaction/stale-variant guards intact. The wrapper
-- and base save run in the same transaction; any processing failure rolls back both.
create or replace function public.save_catalog_product_v2(payload jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare result jsonb; prior public.coffee_facts%rowtype; observed public.coffee_facts%rowtype;
  processing_changed boolean; saved_product_id uuid;
begin
  if payload->'facts'->'processing_evidence'->>'version' is distinct from 'processing-v1'
    or jsonb_typeof(payload->'facts'->'processing_evidence') is distinct from 'object'
    or jsonb_typeof(payload->'facts'->'process_methods') is distinct from 'array'
    or jsonb_typeof(payload->'facts'->'coferment_ingredients') is distinct from 'array'
    or coalesce(jsonb_typeof(payload->'facts'->'is_coferment'),'missing') not in ('boolean','null') then
    raise exception 'Missing or invalid processing-v1 contract';
  end if;
  result := public.save_catalog_product_v1(payload);
  if result->>'stale_observation_ignored'='true' then return result; end if;
  saved_product_id := (result->>'product_id')::uuid;
  select * into prior from public.coffee_facts where coffee_facts.product_id=saved_product_id for update;
  observed := jsonb_populate_record(null::public.coffee_facts,payload->'facts');
  processing_changed := row(prior.process,prior.process_methods,prior.is_coferment,prior.coferment_ingredients,prior.processing_evidence)
    is distinct from row(coalesce(observed.process,prior.process),observed.process_methods,observed.is_coferment,observed.coferment_ingredients,observed.processing_evidence);
  if processing_changed then
    update public.coffee_facts set process=coalesce(observed.process,prior.process),process_methods=observed.process_methods,is_coferment=observed.is_coferment,
      coferment_ingredients=observed.coferment_ingredients,processing_evidence=observed.processing_evidence
      where coffee_facts.product_id=saved_product_id;
    if result->>'content_changed' is distinct from 'true' then
      insert into public.catalog_change_events(product_id,content_changed,market_changed,observed_at)
        values(saved_product_id,true,false,(payload->'product'->>'checked_at')::timestamptz);
    end if;
    result := result || jsonb_build_object('content_changed',true);
  end if;
  return result;
end;
$$;
revoke all on function public.save_catalog_product_v2(jsonb) from public,anon,authenticated;
grant execute on function public.save_catalog_product_v2(jsonb) to service_role;
commit;
