# Mac Mini crawler: final full-hour audit, October 8, 2026

The read-only audit collected at **5:10:36.062 PM Eastern (21:10:36.062 UTC)**, **3,656.347 seconds — one hour and 56.347 seconds — after the actual same-process resume at4:09:39.715 PM**. Readback finished at5:10:36.619. The original worker remains operational and preserved. **The hour was not error-free, and catalog validity is not certified:** two runs failed with38 terminal page errors, the active run had three additional returned source-completeness errors, and seven confirmed Airship placeholders were active at the snapshot. A separately applied quarantine after this snapshot is distinguished below.

The [dated structured receipt](mac-mini-cooldown-one-hour-audit-20261008.json) separates runtime preservation, exact run/log evidence, known data-integrity findings, later source diagnostics and their limits. Collection was time-guarded; no final audit was performed before the full hour elapsed. No restart, signal, settings change, schema migration, run relabeling, catalog repair, paid classifier retry, deployment or purchase was performed by this audit. The native-weight compatibility migration remains unapplied pending the separate human reply.

## Runtime and continuing writes

- Installed and freshly queried remote main are both **99721e64fe8440e7cc3c68054c412fef5230c8a2**, tree **b074d971b2b8945b400b4034050f48061924d4f4**; original checkout is clean.
- Sole crawler Node **59674**, parent/launcher/lock/LaunchAgent PID **59662**, both actual process state **S**, both cwd `/Users/allan/.openclaw/workspace/coffee-roaster-crawler`. Environment, LaunchAgent plist and launcher are byte-identical; one worker, original **5,400-second /90-minute** schedule. The prior failed C7 receipt is unchanged.
- Current phase **tier1**, whose original phase-start entry has56 eligible roasters. This is phase evidence, not proof that the whole tier has completed. Log modified at5:10:15.878,20.184 seconds before the snapshot.
- Current **September Coffee** run **c7e438da-5231-44d0-ac78-2b8d96e6f46d**, owner **8b9eb5a0-b53e-4ca1-94fc-86a854f26659**, started4:53:53.150, running/errornull at audit. Its log has32 successful saves and three returned errors; active final metrics remain unfinalized.
- Latest persisted coffee **ea6d375b-5a6a-5bd9-b59b-3a637c39dce6**, **Jose Lizardo Cuellar - Geisha**, [source](https://september.coffee/en-us/products/jose-lizardo-cuellar-gesha), last_seen **5:10:09.484 PM**, updated **5:10:14.314149 PM**. This proves continued writing, not complete source/SKU/price/origin/photo truth.

Across the five observed owners, the actual-resume window contains117 fresh product sightings, including the seven invalid Airship placeholders. Whole-run save log counts also include eight Luminous saves before this latest resume. Neither number is a count of verified unique coffees or a matched throughput improvement.

## Runs since actual resume

Luminous began before the temporary verification guard and completed after resume; its metrics cover the full run. Other rows began after resume. Failed database rows can retain zero unfinalized counters: the table uses actual terminal visitor logs, or finalized Airship BFS/database extraction metrics, rather than those zero counters.

| Roaster | Run status at audit | Visited | Coffee results | Irrelevant | Returned errors | Successful save log events |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Luminous | Completed4:15:59 |20|20|0|0|20|
| Momos | Failed4:38:00 |57|25|0|32|25|
| Airship | Completed4:50:09; integrity defect |47|26|21|0|26|
| Hydrangea | Failed4:53:52 |28|22|0|6|22|
| September | Running |Unfinalized|Unfinalized|Unfinalized|3 observed so far|32 so far|

Exact IDs/start/finish times, owner-bound latest sightings and raw returned-error messages are retained in the receipt. The completed/failed runs have38 terminal page errors; including the active September observations gives **41 individual returned page errors** at the snapshot. Failure-summary/severity lines are retained separately and are not counted again as page errors. All five rows match the actual normal scheduler's installation log.

**Momos:** all32 errors are independently bound to retained **SQLSTATE23505**, `save_catalog_product_v1`, exact native/product UUID/weight/time and `product_variants_unique_weight_per_product`; [diagnosis and native proof](MAC_MINI_MOMOS_SAVE_FAILURES_20261008.md). This audit confirms its failed row and all32 error messages are unchanged. Dated20:41 index SELECT still shows the global non-null-weight guard; no new schema inspection or migration is claimed here.

**Hydrangea:** its six new individual returned errors name that same unique-weight index. Exact failed URLs are `salma-bermudez`, `rested-gesha-salma-bermudez-finca-el-paraiso`, `castillo-lychee-finca-el-paraiso-copy`, `rested-caturra-semi-washed-finca-el-sendero`, `rested-sl34-sl28-ruiru-11-batian-washed-karinga-ab`, and `rested-castillo-lulo-washed-finca-santa-monica`, each under `https://hydrangea.coffee/products/`. This audit does not claim fresh retained server SQLSTATE/product/weight bindings for this new six-event run. They are distinct from optional native JSON warnings and Airship's source-integrity defect.

**Airship:** pipeline completion included seven active collection records literally named `Product Title`, whose source text was a cart template rather than a primary product identity. [Independent exact-row/checkpoint/source evidence](MAC_MINI_AIRSHIP_PLACEHOLDER_FINDINGS_20261008.md) and the5:10 audit's exact-ID read found all seven active. No repair was applied by this audit. The coordinating thread then reported a reversible13-record quarantine committed at **5:13:43 PM** (12 verified collection/shop-by shells plus Fellow equipment), with histories preserved. A separate minimal readback at **5:16:32.938 PM** independently confirms these same **seven literal-placeholder IDs are now inactive**, updated5:13:42.235038. The receipt retains both dated states. This supplemental seven-ID read does not independently certify the broader13-record/history repair; those proofs belong to the coordinating thread. Its Airship native profile/source guard was still unmerged when reported.

## September: three exact source-completeness errors

The failed URLs and literal native reasons are below. A supplementary owner-bound known-page read at **5:12:35.260 PM** establishes prior-known versus new exact URL. The lookup is scoped to exact `known_pages` keys; absence does not establish whether a coffee already has a product under another canonical/native alias.

| Exact source URL | Literal returned error/native reason | Prior known exact URL? |
| --- | --- | --- |
| `https://september.coffee/en-us/products/jorge-rojas-colombia-washed-geisha-2026` | `Registered Shopify source incomplete: HTTP 500` |Yes; first_seen2026-09-06T23:11:29.629Z; known-pagea5e726dc-7b95-4260-ad81-3fd5724880a2, statuscoffee, times_seen1|
| `https://september.coffee/en-us/products/golden-hour` | `Registered Shopify source incomplete: incomplete SKU set` |Yes; first_seen2026-09-06T23:04:22.618Z; known-page3ab2e55c-fa1f-4403-8893-4dd8d02e566c, statuscoffee, times_seen1|
| `https://september.coffee/en-us/products/rung-eto-kii-aa` | `Registered Shopify source incomplete: incomplete SKU set` |No exact-URL checkpoint present at supplementary read|

For Jorge Rojas the retained warning binds the error to the **`.json`** endpoint: `https://september.coffee/en-us/products/jorge-rojas-colombia-washed-geisha-2026.json`, `ShopifyJSON Failed to fetch`, error `HTTP500`. Installed `fetchShopifyProductJson` requests product `.json` first, then `.js` for exact-ID sellability/SKU completeness. No historical response headers/cooldown ledger were retained for these native failures. For Golden Hour and Rung Eto Kii AA, the original native Ajax status/body/mismatch detail is not recorded; **incomplete SKU set** is the actual guard reason, not proof of a particular historical HTTP status. These guards return before classification/save, retaining old checkpoints and avoiding an unproven new save. They are not SQL weight errors.

Four fresh bounded diagnostic GETs, ending **5:14:05.286 PM**, subsequently returned200 for both products' `.json` and `.js` endpoints, with zero reader errors/cooldowns/retries, zero model calls and zero catalog/merchant writes. **Golden Hour:** product7724924895330, matching native variant43018412720226 in both responses. **Rung Eto Kii AA:** product7806220206178, matching variant43350501359714 in both. Both current Ajax variants have boolean availability and complete exact-ID sets. This is evidence of current recovery; it does **not** reconstruct the original failed responses or change their historical run results. September was not restarted or replayed, and no classification or persistence was invoked for these diagnostics.

## Preserved measured Passport result and limits

The previous independent full Passport validation remains **passed:255 current source coffees /528 native AUD SKUs /169 decoded and MD5-matching public images**, run **29d25480-cdac-4759-a63d-f5d3afad7cb1**, validated4:10:54.280 PM. This audit reads the retained validation artifact and does not rerun that validation or extend it to other roasters. The successful781.593-second normal Passport run,249 cache/6 model pages,16 recovered429 responses and measured model usage remain in the [measured Passport report](MAC_MINI_PASSPORT_COOLDOWN_RUN_20261008.md). Cache/merchant conditions differ from earlier failed runs; no matched code-only speedup, invoice saving or whole-tier sanitation is claimed.

Runtime preservation passes; an error-free crawl and catalog-validity gate do not. The native-weight schema blocker and Airship source guard remain concrete next work in the coordinating thread; the separately applied quarantine is dated above. Active September totals can grow after this snapshot. Documentation checks verify timing/process/source/configuration, all five run bindings,38 terminal/41 observed errors, seven active placeholders at the snapshot and their later inactive state, three exact September reasons/prior-known distinctions and four fresh diagnostic responses. No source edit or redundant paid/test crawl was made. Exact documentation SHA, CI and before/after review-feed reads follow in tracking issue #1/PR6.
