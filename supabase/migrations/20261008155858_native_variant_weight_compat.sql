-- PREPARATION ONLY. Requires a fresh production index/constraint preflight and
-- explicit target migration authorization; no crawler command applies this SQL.
-- Historical live definition is pinned by apply-strawanzer-six-weight-fill.cjs
-- to receipt SHA-256 d9c7c98d0c44ba8dc74350d4fd02ab9978eb9a9476f1340370b48d6e4791821c.
-- Source-keyed native or label/SKU identities can share a proven net weight.
-- Preserve every row/value and the legacy guard for rows without source keys.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '5s';
lock table public.product_variants in share mode;
do $$
declare
  weight_index oid := to_regclass('public.product_variants_unique_weight_per_product');
  source_index oid := to_regclass('public.variants_source_key_unique');
  previous_definition constant text := 'CREATE UNIQUE INDEX product_variants_unique_weight_per_product ON public.product_variants USING btree (product_id, weight_g) WHERE (weight_g IS NOT NULL)';
  compatible_definition constant text := 'CREATE UNIQUE INDEX product_variants_unique_weight_per_product ON public.product_variants USING btree (product_id, weight_g) WHERE ((weight_g IS NOT NULL) AND (source_key IS NULL))';
  source_definition constant text := 'CREATE UNIQUE INDEX variants_source_key_unique ON public.product_variants USING btree (product_id, source_key) WHERE (source_key IS NOT NULL)';
  current_definition text;
begin
  if pg_get_indexdef(source_index) is distinct from source_definition
    or not exists(select 1 from pg_index where indexrelid=source_index and indisunique and indisvalid and indisready) then
    raise exception 'Native weight compatibility requires the valid installed source-key uniqueness index';
  end if;
  if weight_index is null then
    -- Fresh empty structural fixtures can initialize this invariant. A populated
    -- target with a missing historical index requires separate schema review.
    if exists(select 1 from public.product_variants) then
      raise exception 'Weight uniqueness index missing on populated catalog; fresh schema review required';
    end if;
  else
    if exists(select 1 from pg_constraint where conindid=weight_index) then
      raise exception 'Weight uniqueness index is constraint-owned; schema review required';
    end if;
    if not exists(select 1 from pg_index where indexrelid=weight_index and indisunique and indisvalid and indisready) then
      raise exception 'Weight uniqueness index is not valid, ready and unique';
    end if;
    current_definition := pg_get_indexdef(weight_index);
    if current_definition=compatible_definition then return; end if;
    if current_definition is distinct from previous_definition then
      raise exception 'Unexpected weight uniqueness index definition; schema review required';
    end if;
    drop index public.product_variants_unique_weight_per_product;
  end if;
  create unique index product_variants_unique_weight_per_product
    on public.product_variants using btree(product_id,weight_g)
    where weight_g is not null and source_key is null;
end;
$$;
commit;
