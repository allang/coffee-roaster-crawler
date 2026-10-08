# Coffee processing, co-ferments and catalog cleanup — 2026-10-07

The crawler correction is prepared on `codex/issue-1-crawler` / PR #2. It preserves full reported processing wording, adds searchable methods and separate co-ferment disclosure, and fixes two reproduced processing losses: details beyond the configured 6,000-character classifier input and null structured attributes overwriting fresh non-null extraction. The semantic prompt/parser contract is now `extract-v2-processing`; old semantic caches re-extract once rather than conceal missing fields.

This is review preparation. The running checkout is still at `d676de561005c90ecf96af123d20068374e6af88` / source `30748a20ac66f90d3f121b7298b65631fede6e49`. The previous cache/security correction `08fb0025f0973fca4901c552ef73cea72c764740` was positively re-reviewed in issuecomment-6037918271 but remains uninstalled. The October 8 compatibility follow-up also supports the installed transactional v1 catalog saver, retaining normalized processing in product metadata until the separate additive migration is installed. No new production migration, bulk correction, paid model call or crawler restart occurred in this follow-up.

## Where to find the data

Currently, source process is free text in `coffee_facts.process`, often duplicated in `products.metadata->>'process'`. Source country is in `products.metadata->>'country_of_origin'`; it is not the roaster's country and is not automatically populated into `coffee_facts.origin_hub_id`.

After the new migration and crawler update:

| Field in coffee_facts | Meaning |
|---|---|
| process | Full reported phrase, e.g. `Anaerobic Natural`; retained when a later extraction supplies no process. |
| process_methods | Multiple normalized disclosed methods, e.g. `{natural,anaerobic}`. Base processing and fermentation modifiers can coexist. |
| is_coferment | `true` when disclosed; `false` only when explicitly denied; `NULL` for unknown, silence or conflicting disclosures. |
| coferment_ingredients | Explicit added materials from supported disclosures. Empty with true/unknown means the recipe is unknown, not that nothing was added. |
| processing_evidence | Version, source wording/disclosure, conflicts and retrieval URL. |

The same normalized attributes and evidence are included in product metadata for existing consumers. Absence does not delete a previously reported raw process or optional facts. New method/evidence fields describe what the latest extraction can support, so retained historical raw text with missing current evidence still needs review.

`Anaerobic` does not imply co-ferment. Natural/honey processing, yeast inoculation, infusion or fruity tasting notes alone do not establish co-fermentation. The flag records an explicit merchant disclosure or typed structured property; it cannot identify undisclosed additions. Material names in taste notes are never promoted to ingredients. Unusual/unsupported recipes remain in source wording and may require review. This distinction follows the SCA's discussion of the different ways additions can occur and the difficulty of drawing one universal boundary: https://sca.coffee/sca-news/25/issue-24-green-coffee-identity-zht4g.

Extraction checks full current native/schema descriptions and specifically scoped product descriptions/attribute tables, including labeled process fields in English, Spanish and German. Recommendation cards/global page text are excluded from deterministic processing recovery. Other languages and unlabeled complex methods retain raw extraction or require review; broad merchant accuracy is not claimed.

Current legacy lookup (available before the new migration):

```sql
select p.id, p.name, f.process, p.metadata->>'country_of_origin' as country, p.source_url
from products p join coffee_facts f on f.product_id = p.id
where f.process ilike '%natural%' or f.process ilike '%anaerob%';
```

With the compatible crawler update, new observations also retain normalized methods, co-ferment tri-state and disclosed ingredients in `products.metadata`, with their versioned source evidence in `metadata->_normalization->processing`. They can be queried before typed processing columns are installed:

```sql
select p.id, p.name, f.process, p.metadata->'process_methods' as methods,
       p.metadata->'is_coferment' as coferment,
       p.metadata->'coferment_ingredients' as ingredients,
       p.metadata#>'{_normalization,processing}' as evidence
from products p join coffee_facts f on f.product_id = p.id
where p.metadata->'process_methods' @> '["anaerobic"]'::jsonb;
```

Existing rows without these metadata fields remain unverified until revisited. Metadata queries do not have the new typed-column indexes. After applying the additive migration, restart the crawler so it detects and uses v2; this does not automatically backfill typed fields from prior metadata.

After applying the reviewed processing migration:

```sql
select p.id, p.name, f.process, f.process_methods, f.is_coferment,
       f.coferment_ingredients, f.processing_evidence
from products p join coffee_facts f on f.product_id = p.id
where f.process_methods @> array['anaerobic']::text[];

select p.id, p.name, f.process, f.coferment_ingredients
from products p join coffee_facts f on f.product_id = p.id
where f.is_coferment is true;
```

## Read-only recent-coffee audit

Captured at **2026-10-07 10:53:12 EDT / 14:53:12 UTC**. Selected the latest 1,000 coffee products by `created_at DESC, id DESC`, spanning 57 roasters and creation times approximately October 6 20:25 through October 7 10:51 EDT. The active crawler continued; independent REST reads are not a transactionally consistent snapshot. Global captured counts: 131,464 coffee products and 174,165 variants. There are 71,809 null process fact rows, but that is not a full missing-process rate because absent fact rows/blank strings are separate.

| Sample check | Observed |
|---|---:|
| Missing/blank/null/unknown process | 665 / 1,000 |
| Present process | 335 / 1,000 |
| Process text containing natural / anaerobic | 123 / 21 |
| Missing metadata country_of_origin | 337 / 1,000 |
| Variants sampled | 1,858 |
| Complete normalized amount/currency/minor-unit/exponent tuples | 1,442 |
| Incomplete money tuples | 416 |
| Arithmetic / ISO precision discrepancies among complete tuples | 0 / 0 |
| Coffees flagged for review by the conservative offline tool | 791 |
| Missing-process candidates supported by explicit retained source labels | 0 |
| Explicit co-ferment disclosure found in retained source | 1 |

The initial broad process-word scan flagged 90 missing-process products, but it included ambiguous wording/titles/taste language. Zero qualify under the final conservative retained-source label rules. A preliminary looser parser proposed two, then regression checks excluded prose about processing/natural aromas; no proposal was applied. This demonstrates why missing fields need source re-fetching rather than bulk keyword inference. One merchant's retained description explicitly discloses cofermentation while its legacy process records anaerobic washed / yeast and watermelon fermentation. The separate flag makes that discoverable without forcing it into one process category. Its recipe is not automatically resolved from ambiguous wording.

A bounded fresh-source check selected four distinct-roaster candidates: two unsupported non-Shopify URL shapes were skipped. Two verification rounds made **four actual unauthenticated merchant GETs in total**, all returning valid current product JSON for two products. The final parser, rechecked against the saved final responses, recovered a missing `Natural` process for one and `Washed` + `Anaerobic` with explicit co-ferment disclosure for the other. No database write or paid AI call occurred. This checks those source examples and deterministic parsing, not all merchants, all origins, live quoted prices or model accuracy.

The 1,442 complete money tuples are internally consistent; that does not prove correct currency attribution, variant mapping or current merchant price. Similarly, a populated country can still be wrong. Cleanup must compare disputed fields with each product's own current source, preserve blends/multiple origins, match exact native variants, and keep unsupported currencies/origins unknown. Do not derive origin/currency from merchant location, language or domain, or 'fix' an ambiguous numeric price with a guessed currency.

Raw capture, candidate records and source responses remain private under `/Users/allan/Documents/workspace/everycoffee-preservation/process-audit-20261007/`. The checked-in `processing-audit-metrics.json` contains aggregate evidence only. The audit tool accepts an existing private snapshot and has no network client, AI call, database write or apply mode:

```sh
node scripts/audit-catalog.cjs /private/recent-products.json --output /private/review-candidates.json
```

Output is created exclusively with mode 0600; console output contains aggregates. Review flags are proposals and do not certify unflagged products.

## Cleanup cost estimate

Using the configured `gpt-5-mini`, current published standard pricing is **$0.25 per million input tokens and $2.00 per million billed output tokens**: https://developers.openai.com/api/docs/models/gpt-5-mini. Cached-input savings and Batch discounts are not assumed. Reasoning tokens are included in billed output assumptions.

Assume one targeted extraction/audit call per coffee, 2,000–4,000 input tokens, 1,000–3,000 billed output tokens, and a 25% retry allowance:

`cost = coffees × ((input_tokens × $0.25 + output_tokens × $2.00) / 1,000,000) × 1.25`

| Scope | Estimated model API cost |
|---|---:|
| Latest 1,000 coffees | $3.13–$8.75 |
| 10,000 coffees | $31.25–$87.50 |
| Entire captured catalog: 131,464 coffees | $410.83–$1,150.31 |

These are estimates, not an invoice, quality guarantee or hard spending cap. The existing live benchmark measured 150 AI calls and a $0.460351 model list-price estimate across mixed coffee/irrelevant pages; it is a different workload and cannot establish this cleanup's per-coffee cost or accuracy. A targeted product-URL audit avoids re-crawling whole sites, whose additional classification calls are outside the table. Proxy charges, bandwidth, runtime/hosting and human adjudication are excluded. A smaller pilot should report actual usage and evidence quality before scaling; the current audit spent **$0 on new model calls**.

I recommend first reviewing a recent 1,000-coffee batch. Recover exact retained facts cheaply, re-fetch product sources for disputed/missing origins and exact variant money, and use AI only where needed. Produce an ID-keyed correction ledger with source excerpts, old/new values, uncertainty, before-row hashes and paid usage. Review that concrete ledger before any guarded/idempotent application; never mass-overwrite uncertain facts or catalog prices. This follow-up prepares the audit and estimate, not a paid bulk job or mutation runner.

## Installation and verification

Review `supabase/migrations/20261007145506_coffee_processing_v1.sql`. The original applied `20261006134031_catalog_refresh_v1.sql` is unchanged. The additive migration initializes new methods/ingredients as empty and co-ferment as unknown, without inventing facts or reclassifying old rows. GIN method and partial co-ferment indexes support the queries above. Existing table grants/RLS are preserved; the new `save_catalog_product_v2` wrapper is SECURITY INVOKER and executable only by service_role. It reuses the tested v1 transaction/stale-variant guards; any processing failure rolls back product/variant changes too. Older source observations cannot overwrite newer processing. Repeated unchanged saves produce no extra catalog event.

The crawler prefers `save_catalog_product_v2`. A precise PostgREST `PGRST202` stating that `public.save_catalog_product_v2(payload)` is missing selects the already installed transactional `save_catalog_product_v1` instead. This preserves full process wording in `coffee_facts.process` and the complete normalized processing/evidence metadata in the same product/variant transaction. It logs the pending typed-column mode once per database client and detects capability again after restart. Permission errors, validation failures, unavailable databases and other missing functions remain hard failures; neither path deletes/reinserts catalog records. Missing v1 also fails. This compatible path needs the original catalog-refresh migration, which is already applied; it does not apply SQL or create typed columns automatically.

Apply the optional processing migration only with target authorization and verified schema/permissions, then restart so the matching v2 contract is selected. Use the established temporary pause/update/lockfile-install/test/resume procedure and preserve the existing schedule/configuration. Future SDK consumers may ignore metadata extensions, but displaying/filtering co-ferments in an API/UI requires adopting the new contract; those independent services were not changed here.

The four compatibility regressions exercise the actual reviewed v1 SQL against the previous schema: service-role saves, raw process plus methods/true-false-unknown disclosure/ingredients/source evidence, stable product/variant IDs and creation timestamps, retained media/unrelated metadata, fresh market values, unchanged events, stale observations and full transaction rollback. They also verify v2 remains preferred on the new schema and reject unrelated RPC/schema/permission/validation errors. These are offline schema compatibility checks; live crawler installation and source verification remain separate.

**213/213 supported tests pass**. Coverage includes truncation/null-erasure regressions, overlapping methods, multilingual labels, ingredient/taste separation, explicit/unknown/conflicting disclosures, original-source contrasts, scoped table/description data, actual SQL stable IDs/rollback/stale writes/search queries, service_role success and authenticated denial. Prompt/parser changes invalidate the previous semantic cache once. No after-change live crawl speed, model token usage, population extraction success rate or full-catalog source accuracy is claimed.
