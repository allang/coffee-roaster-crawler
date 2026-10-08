# Momos scheduled-run save failure — 2026-10-08

All **32** returned page errors in scheduled Momos run **870b5b0c-ccb9-4a17-9a58-16f318a76ff9** are individually bound to **SQLSTATE 23505** from `save_catalog_product_v1`, naming `product_variants_unique_weight_per_product`. This is the existing database index that prevents two variants of a product from sharing any non-null weight. The prepared compatibility migration remains unapplied. This investigation found no additional source defect requiring a crawler change or restart.

Installed source is exact merged main **99721e64fe8440e7cc3c68054c412fef5230c8a2**. The run belongs to Momos Coffee, owner **c2941ba0-1481-4b69-b800-0d911f2797c3**, whose configured English website is `https://en.momos.co.kr`; the reviewed registered adapter uses the Korean storefront `https://momos.co.kr` and KRW native options. The database run started **20:16:46.135 UTC** and failed naturally at **20:38:00.258 UTC**. Its actual terminal visitor reports **57 visited / 25 coffees / zero irrelevant / 32 errors**, with **25 successful ProductSaver events**. All 25 logged saved IDs occur in the owner-bound catalog readback. The failed database row's zero counters and empty metadata are unfinalized counters, not a claim that nothing was visited or saved. The failed row and existing history were preserved.

## Exact historical error evidence

The [structured receipt](mac-mini-momos-save-failures-20261008.json) records every failing URL, reviewed native product identity, exact product UUID, rejected weight, UTC second, SQLSTATE, save function and error text. All 32 local Visitor JSON errors explicitly name this index. Each database event was opened in the authenticated Supabase retained Postgres ERROR log; its Overview Query invokes `save_catalog_product_v1` and its Details names the product UUID and weight. Product IDs bind independently through existing owner-bound rows or the installed `productSourceKey`/`stableUuid` functions applied to the exact native identities in the dated [Momos KR source receipt](tier-one-site-support/momos-kr-live.json). The binding does not rely on matching event counts or order.

The first event's Raw JSON provides additional precision: **f2006403-cbb1-46df-9382-69c111eb8365**, **20:17:48.071 UTC**, SQLSTATE **23505**, product **d942b61e-1377-5d17-aea8-56c1d22ab3ce**, weight **200 g**, `save_catalog_product_v1(jsonb)` line 61 inserting into `public.product_variants`. The remaining event times are recorded at the UI's displayed second precision.

These 32 persistence-catch Visitor errors contain only `url` and `error`; historical merchant HTTP status, `retryStopped` and cooldown fields were not retained there. Receipt nulls mean **unrecorded**. The scoped local log contains no recorded merchant 429/503 or cooldown failure. Separate SQLSTATE 57014 timeout events in the same dashboard window are not bound to these 32 saver errors and are not counted among them. This report does not infer historical wire status or cooldown behavior from the error total.

## Fresh native reproduction without writes

At **20:42:28.982 UTC**, the actual installed reader and Imweb parser fetched [the first failed product](https://momos.co.kr/shop_view?idx=7450) and its exact native OMS endpoint with two GETs. Both returned **HTTP 200**, no Retry-After header, zero returned reader errors and zero cooldown events. No model, catalog save or merchant mutation was invoked.

The current native response produces the same product UUID as the historical database error and **12 distinct native options**: six grind options at **200 g / KRW 26,000**, and six at **500 g / KRW 52,000**. Every option retains a distinct merchant variant ID and source key, and its known weight. The receipt includes all 12 exact identities, names and prices. This is a fresh diagnostic sample, not retroactive evidence of the original run's merchant HTTP responses. `variants_complete` remains false.

Read-only production index inspection at **20:41:54.26452 UTC**, role `postgres`, confirms both indexes are valid, ready and unique:

- `product_variants_unique_weight_per_product`: `(product_id, weight_g) WHERE weight_g IS NOT NULL`.
- `variants_source_key_unique`: `(product_id, source_key) WHERE source_key IS NOT NULL`.

The first index rejects legitimate same-weight native SKUs even though their source identities are distinct. The already prepared [20261008155858_native_variant_weight_compat.sql](../supabase/migrations/20261008155858_native_variant_weight_compat.sql) keeps source-key uniqueness and limits the legacy weight guard to rows without source keys. Application remains a separate authorization and schema preflight; this investigation performed only SELECTs and GETs. It did not apply that migration, merge variants, clear known weights or replay the failed run.

## Preserved continuing worker

The read-only checkpoint at **20:48:16.981 UTC** confirms clean original checkout at exact **99721e6**, byte-identical environment, LaunchAgent and launcher, unchanged failed C7 receipt, and the same scheduler Node **59674** with launcher/lock owner **59662**. The worker has progressed to Airship Coffee, owner **8528a70e-2033-4fc5-b5c6-1c5f73c0a989**, current run **7886ad66-2602-4ae1-988d-a8c0e277caaa**, started **20:38:00.887 UTC**, running with error null. Active-run final counters remain unfinalized.

This is a failure investigation and preservation checkpoint. The separately coordinated full-hour audit is scheduled for **21:10 UTC**, at least one hour after the latest actual resume at **20:09:39.715 UTC**. That audit has not yet occurred. No restart, setting change, schema mutation, run relabeling, paid retry, deployment or purchase was performed here.

Documentation verification checks all 32 independent SQL bindings, the 57/25/0/32 terminal metrics, saved-ID readback, fresh sample identity and distinct SKU groups, runtime preservation and receipt/report consistency. Source is unchanged from the installation's **467 passing tests / zero failures / one explicit unavailable-native-PostgreSQL skip**, with PGlite passing. Linked issue and PR review feeds were reread before this milestone; exact documentation SHA, CI and post-push review follow in issue #1.
