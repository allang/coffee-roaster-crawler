# Native variant weight compatibility — preparation only

The production index `product_variants_unique_weight_per_product` currently enforces one known weight per product. Distinct native SKUs or explicit source-keyed grind/roast choices can legitimately share that weight. The migration changes only this index's predicate to `weight_g IS NOT NULL AND source_key IS NULL`. The installed `variants_source_key_unique` continues to prevent duplicate `(product_id, source_key)` identities. Legacy rows without a source key retain their weight guard. No row, ID, slug, known weight, saver function, grant or policy is changed.

The exact historical definition and receipt SHA-256 are pinned in `src/myCoffeeExplorerImport/apply-strawanzer-six-weight-fill.cjs`: `d9c7c98d0c44ba8dc74350d4fd02ab9978eb9a9476f1340370b48d6e4791821c`. This is preparation, not production application. Before applying, obtain a fresh target snapshot of `pg_get_indexdef`, `pg_index` validity/readiness, `pg_constraint` ownership and all other variant indexes; confirm the installed source-key saver/index contract. Explicit production migration authorization is still required.

The transaction waits at most five seconds for locks. It refuses wrong predicates, constraint-owned or invalid indexes, a missing index on a populated catalog, or a missing/changed source-key uniqueness index. It permits empty fixture initialization and returns without rebuilding an already compatible index. Applying it does not retry previously failed crawls; use the normal targeted crawler after source and target validation.

The focused test models the pinned old index, reproduces the real SQL save failure for distinct 250g SKUs, then verifies repeat saves retain IDs, slugs, timestamps, known weights and unrelated metadata. It also covers source-keyed labels without merchant IDs, remaining legacy uniqueness and migration/rollback refusal cases. It runs the same checks in PGlite and, when native PostgreSQL binaries are available, a fresh private Unix-socket-only cluster; no existing database URL or credentials are accepted.

## Guarded rollback

Restore the old global index only if **every** known weight is still unique within its product. If newly admitted variants share a weight, this rollback refuses. Keep the compatible index and roll back application code if necessary; do not delete variants, merge identities or null known weights to force the old index back.

The following is a reviewed rollback plan, also exercised by the focused test. It requires the same fresh schema review and target authorization as forward application.

```sql
begin;
set local search_path = pg_catalog;
set local lock_timeout = '5s';
lock table public.product_variants in share mode;
do $$
declare
  weight_index oid := to_regclass('public.product_variants_unique_weight_per_product');
  previous_definition constant text := 'CREATE UNIQUE INDEX product_variants_unique_weight_per_product ON public.product_variants USING btree (product_id, weight_g) WHERE (weight_g IS NOT NULL)';
  compatible_definition constant text := 'CREATE UNIQUE INDEX product_variants_unique_weight_per_product ON public.product_variants USING btree (product_id, weight_g) WHERE ((weight_g IS NOT NULL) AND (source_key IS NULL))';
  current_definition text;
begin
  if weight_index is null
    or exists(select 1 from pg_constraint where conindid=weight_index)
    or not exists(select 1 from pg_index where indexrelid=weight_index and indisunique and indisvalid and indisready) then
    raise exception 'Rollback requires the valid non-constraint-owned reviewed weight index';
  end if;
  current_definition := pg_get_indexdef(weight_index);
  if current_definition not in(previous_definition,compatible_definition) then
    raise exception 'Unexpected rollback weight index definition; schema review required';
  end if;
  if exists(select 1 from public.product_variants where weight_g is not null group by product_id,weight_g having count(*)>1) then
    raise exception 'Cannot restore global weight uniqueness: distinct same-weight variants exist; preserve their IDs and known weights';
  end if;
  if current_definition=previous_definition then return; end if;
  drop index public.product_variants_unique_weight_per_product;
  create unique index product_variants_unique_weight_per_product
    on public.product_variants using btree(product_id,weight_g)
    where weight_g is not null;
end;
$$;
commit;
```
