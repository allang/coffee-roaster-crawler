# Passport normal crawl failure and verified subset — 2026-10-08

The isolated Passport normal crawl **failed**. The terminal visitor completed all **255 page visits**, with **193 successful coffee saves**, **0 irrelevant pages** and **62 page errors**. The full **255-coffee** gate has not passed. The earlier 529-SKU target includes the newly identified pouch accessory; the corrected captured baseline has **528 coffee SKUs**, which still requires a fresh complete normal-run check. Successful data and all failed runs are preserved. The regular scheduler remains running on unchanged main `28de9b55a1c039a5b3581a9595357d0fe4cf1095`; diagnosis did not change source, model settings, schema or scheduling.

## Actual execution and counts

| Observation | Measured result |
|---|---:|
| Isolated execution source | `003a60c775832a0e938a752129141eda5f01f15f` (same tree as installed main) |
| Passport owner | `c978d995-9310-4c54-945b-5211ccdddf7a` |
| Exact crawl run | `1d573313-4d89-4283-b1de-6df52a7d2135` |
| Started / failed | 14:03:03.236 / 15:42:41.324 UTC (10:03:03 / 11:42:41 AM Eastern) |
| Normal-run duration | **5,978.088 seconds** (99 minutes 38 seconds) |
| Unified session | 21938, terminal exit **1** |
| Normal visitor counts | **255 visited / 193 coffees / 0 irrelevant / 62 errors** |
| Save observer | **194 attempts / 193 successful / 1 transactional failure** |
| Exact successful native variants | **387** |
| Fresh catalog totals across attempts | **213 products / 435 variants / 213 linked photos** |

The failed run's database counters are all zero because the completion function never ran. The actual visitor counts come from its terminal log and receipt. Catalog totals include earlier attempts; they cannot replace same-run coverage. Five earlier targeted failed/interrupted runs retain failed status; this is a sixth failed targeted run. Separately interrupted scheduler runs remain independently recorded.

Earlier running progress reports counted only errors reaching extraction and missed HTML/native fetch failures before extraction. Their “zero observed page errors” figure was incomplete. This terminal report supersedes those running checkpoints and does not retroactively label failed attempts successful.

## Failure evidence and smallest recovery

**53 pages failed on HTTP 429; eight failed on HTTP 503; one failed in transactional persistence.** Across the 61 HTTP failures, 22 were HTML requests, 31 required native `.json` requests and eight required native `.js` requests. The registered reader uses a 500ms minimum spacing and currently returns the first non-200 without bounded retry/backoff. A successful HTML request cannot establish complete native SKU prices and stock when the following native response fails.

The first failure was **page 18**, [Burundi Nemba 48hr Oro Yeast Filter](https://passportcoffee.com.au/products/burundi-nemba-48hr-oro-yeast-filter). HTML returned 200 at **14:03:49.730 UTC**; its `.json` request returned **429 at 14:03:50.232 UTC**. This begins the 53-page 429 burst ending at 14:04:42.915 UTC. Later 503 examples include `colombia-las-moras-natural-filter` (14:14:04.761 UTC), `panama-hartmann-pacamara-winey-filter` (15:31:42.721 UTC), and `png-baroida-filter.js` (15:32:39.457 UTC). The aggregate JSON records all 62 unresolved pages and their actual request statuses/times.

The persistence failure was [Colombia Penas Blancas Geisha Natural Filter](https://passportcoffee.com.au/products/colombia-penas-blancas-geisha-natural-filter), native product **8223558533281**, at **14:14:57.775 UTC**. Its source set contains:

| Native SKU | Exact source label | AUD price | Normalized grams |
|---|---|---:|---:|
| 46537133424801 | 125gm | 36.00 | 125 |
| 44906648764577 | 250gm | 60.00 | 250 |
| 44906648797345 | 1KG | 218.00 | 1,000 |
| 46621928095905 | 250gm Vac Sealed Pouch Option (per pouch) | 3.00 | 250 |

The last item is a pouch accessory. Passport's existing exact accessory pattern `^Vac Sealed Pouch Option \(per pouch\)$` does not match its added `250gm` prefix. The extracted set therefore incorrectly marked all four variants complete, with no reviewed subset proof. The accessory and real 250gm coffee collide on `product_variants_unique_weight_per_product`; the transaction returned HTTP 409 and rolled back. This is an additional accessory-bearing product beyond the seven previously captured subsets. Recovery should extend the source-scoped accessory recognition for this exact label while proving the complete original native ID/stock set, retaining coffee SKU money, marking filtered variants explicitly incomplete and retaining the global omission prohibition. Accessory handling should not drop real coffee variants or infer prices/stock from stale cache. The separate global same-weight compatibility finding below requires a reviewed schema plan; it is not resolved by accessory exclusion.

Fresh guarded source reads at **15:55:01.515–15:55:02.519 UTC** returned HTTP **200** for primary HTML, native `.json` and native `.js`. All four original JSON/Ajax IDs match and each stock flag is boolean. The three coffee SKUs above are in stock at AUD 36.00 / 60.00 / 218.00; the exact pouch add-on is sold out at AUD 3.00. This confirms the prefix defect with current primary evidence, without model calls or database writes. [Fresh status/time/native-price receipt](passport-prefixed-addon-live-20261008.json).

The prior registered receipt's **529 variants already include this non-coffee SKU**; it is absent from the seven pinned subset receipts. Excluding that one known accessory yields a corrected captured baseline of **528 coffee variants** across 255 products, subject to fresh full-run revalidation. The previous 529 “coffee SKU” description was inaccurate. Recovery must update the reviewed inventory/count assertion as well as extraction; retaining 529 by inventing a replacement variant would be incorrect.

Bounded transient retry/backoff that respects merchant throttling and precise accessory handling are necessary for a fresh normal-run completion. Source work is coordinated with the other thread; this report adds evidence only. No retry was launched just to observe the failed job.

## Verified successful subset

Fresh readback completed at **15:52:45.237 UTC** and passed for all **193 successful-save products / 387 native AUD variants**. Assertions checked owner, active coffee/native product ID, exact independently reviewed native coffee SKU sets, amounts/currency/minor units/exponents, current stock/check times, raw process, searchable methods, tri-state co-ferment, disclosed ingredients, origin when supplied, quoted processing evidence and native primary photo URLs. Existing baseline product/variant IDs, creation timestamps and slugs are preserved for the checked products. Seven reviewed accessory subsets stay explicitly incomplete, and Passport's global omission guards remain disabled.

All linked public images for this subset were fetched without credentials and verified using full pixel decoding and matching stored MD5 hashes: **133 distinct assets / 61,082,019 bytes**, zero failures. Shared assets explain why the distinct image count is lower than product count. These successful-subset checks do not certify the missing 62 products or the full corrected inventory gate.

## Current scheduler errors and schema compatibility

The current scheduler remained alive and moved to Taith, but its first Hydrangea run **failed at 15:54:10.252 UTC**, after **28 pages / 22 coffee saves / 0 irrelevant / six errors**. Exact run `090e6f80-37a8-4fb7-a647-f66eaa256d57` has failed status and the matching registered-merchant error. Taith run `6233ab44-b1d1-4700-9c8e-c9e00793b9d8` began at 15:54:10.469 UTC and is running at the dated observation. This is a failure observed before the separately scheduled one-hour review; startup's dated zero-error observation does not imply a clean full-hour run. [Scheduler observation](mac-mini-scheduler-observation-20261008.json).

A fresh read-only production SQL query at **15:57:26.189857 UTC** confirms that `product_variants_unique_weight_per_product` is valid, ready and unique with this exact definition:

```sql
CREATE UNIQUE INDEX product_variants_unique_weight_per_product
ON public.product_variants USING btree (product_id, weight_g)
WHERE (weight_g IS NOT NULL)
```

There is no native/legacy condition: distinct known-weight variants of the same product collide even when their native IDs differ. Production separately retains the valid/ready native source-key uniqueness index on `(product_id, source_key) WHERE source_key IS NOT NULL` and the primary key. [Exact current index/constraint receipt](current-variant-index-20261008.json). The connected MCP account denied target access; the existing authenticated Supabase SQL tab supplied this read-only result. No migration, index drop or data mutation was made.

Hydrangea's historical primary inventory provides real same-weight roast-date options, for example native product `10281858007362` has coffee SKUs `56084974043458` (`4oz (114g) - 9/27`) and `56129663697218` (`4oz (114g) - 10/4`), both 114g. Neither may be discarded or have its known weight nulled merely to fit the legacy index. The historical receipt has 32 products while the current run visited 28; its ten products without a fresh save are not a list of the six current errors. The normal visitor does not emit each returned page-error cause, so assigning all six to the index would exceed captured evidence. A tested native-identity compatibility migration/plan is being prepared in the other source thread; production application requires separate authorization. This evidence-only milestone keeps the current scheduler and configuration unchanged.

## Model usage and performance limits

This attempt recorded **191 model responses**, all with reported usage: **177 `stop` / 14 initial `length`**. The 14 truncations used the existing bounded recovery. No credential/quota stop or unrecovered classifier failure accounts for the final 62 page errors.

| Usage | Measured tokens |
|---|---:|
| Input | 342,939 |
| Included cached input | 26,880 |
| Billed output | 619,219 |
| Included reasoning output | 450,944 |
| Unreported calls in this attempt | 0 |

Using the [published gpt-5-mini list rates](https://developers.openai.com/api/docs/models/gpt-5-mini) retained in the update report, the observed token usage estimates **$1.31812475** in model cost. This is an estimate from reported usage, not an invoice or a complete cross-attempt billing ledger; interrupted earlier in-flight usage is unavailable. Merchant/proxy/bandwidth/runtime and manual review costs are excluded. The 99-minute duration is a failed-run measurement, with throttled pages failing quickly; it does not establish full-catalog throughput or matched improvement over a previous release.

The scheduler's latest authorized restart remains **15:41:48.177 UTC**, launcher/lock **36917**, Node **36926**, with the preserved configuration and 90-minute schedule. The other thread owns the existing **16:42 UTC** one-hour runtime review. No additional automation, scheduler restart, migration, hosted deployment or purchase was performed here.

[Aggregate terminal receipt and unresolved pages](mac-mini-passport-failure-20261008.json). [Tracking issue](https://github.com/allang/coffee-roaster-crawler/issues/1#issuecomment-6063755381). [Current update chronology](MAC_MINI_UPDATE_20261008.md).
