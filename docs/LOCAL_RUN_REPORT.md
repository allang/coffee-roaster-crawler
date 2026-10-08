# Local crawler rollout and live comparison — 2026-10-06 EDT

The local crawler is running corrected source `30748a20ac66f90d3f121b7298b65631fede6e49` on its existing 90-minute launch schedule. The authorized ten-roaster comparison is complete: recorded time was 17.9% lower on the first pass and 69.5% lower on the cached pass than the historical matched runs. Between the two new passes, actual AI calls fell from 129 to 14. These twenty runs used the preceding release; the corrected release separately passed the affected merchant's first/cached validation with zero page errors. Results, failures and measurement limits are recorded below.

A later readiness audit reproduced an additional cache fallback defect: absent a current structured variant overlay, old cached money/stock could be written with a fresh timestamp. The review branch now requires fresh extraction for those coffee pages and leaves unsupported variant stock unknown; it also patches the six inherited dependency audit findings. **196/196 supported tests**, a separate local HTTP/redirect/proxy test and `npm audit` with zero findings pass. This follow-up has not been installed or benchmarked live. Its safer fallback can increase AI calls on unstructured coffee pages, so the cached-call and timing results below must not be treated as predictions for this follow-up release. See [DEPLOYMENT.md](DEPLOYMENT.md#readiness-follow-up-after-the-local-rollout).

## Update, migration and preservation

The user explicitly authorized temporarily pausing/updating/running the local crawler, applying its required crawler-only catalog migration, and running a matched ten-roaster first/cached benchmark before resuming the regular schedule. This is the later, limited exception to the original deployment prohibition in [tracking issue #1](https://github.com/allang/coffee-roaster-crawler/issues/1). The API and purchasing repositories remain private; their deployment and real purchases are outside this rollout.

The primary benchmark ran reviewed source `f96b06d23239a22a3e4d1de0ef6bc796ee927298` in the original checkout, `/Users/allan/.openclaw/workspace/coffee-roaster-crawler`, on `codex/issue-1-crawler`. That release contains the cloud review fixes in `2c8bea9678423f13df769ccf7a1dc0ff1e5af622`: independent variant freshness guards and successful unchanged-stock checks that advance evidence/time without emitting extra change events. That installed release passed **187/187 tests**, with no failures/skips, in 3.529 seconds. The rollout documentation milestone `3e2d5c784e22ac2fc5a6d93016a8c97ca7b5a1e6` also passed both GitHub checks. The subsequent correction, installed tests and separate live validation are recorded below.

Private preservation includes the old Git history, tracked patch and files, all 160 untracked files, credentials, launch configuration and runtime logs. The old tracked changes also remain in local stash `2a801af1ff44310ef3158c42ba1da2aa5fae9499`. No shared history or remote main was overwritten. A ~509 MiB read-only REST catalog snapshot was taken while the old crawler ran; it is **not a transactionally consistent database backup**. The dashboard also reported an existing scheduled backup from approximately 20 hours earlier. See [WORK_LOG.md](../WORK_LOG.md) for the private preservation location and reconciliation details.

Migration `20261006134031` / `catalog_refresh_v1` was applied to Every Coffee Production and recorded in migration history. Its reviewed file SHA-256 is `adf5c0af43bd6d9a34b4796ae8ce2e1ba72c836b5165cc07284b501a3aebd53a`. Local cohort validation checked the inspected live constraints/triggers and retained legacy values. Live verification confirmed matching function bodies, SECURITY INVOKER, service-role-only RPC execution and restricted access/RLS on the two internal tables. The stored SQL history copy initially lost four delimiter characters during loading; that exact history record was corrected to the original 14,875 characters. Executed function bodies were already correct, and no business-data correction was needed.

The migration itself left all five catalog row counts unchanged:

| Table | Before migration | After migration |
|---|---:|---:|
| Products | 130,634 | 130,634 |
| Variants | 169,976 | 169,976 |
| Coffee facts | 130,380 | 130,380 |
| Media assets | 103,222 | 103,222 |
| Product/media links | 122,907 | 122,907 |

Subsequent benchmark saves are ordinary crawler writes and are measured separately below. The migration must not be reapplied to this catalog. [DEPLOYMENT.md](DEPLOYMENT.md) retains instructions for another environment, compatibility checks and rollback guidance.

## Measurement design

The convenience cohort comprises five Shopify, two WooCommerce and three custom shops. Selection used each entity's most recent completed positive-coffee run with at least three visited pages, at most 30 discovered pages and under 15 minutes of recorded duration. It favors small, recently successful inventories and does not represent all ~8,350 eligible roasters.

Both new passes use the same ten shops, order, Node 22.22.0, `gpt-5-mini`, one roaster/page worker, existing proxies and request delays. Existing settings include a 6,000-character classifier input limit and 4,000 maximum output tokens. Dependencies were installed from the lockfile without an automatic model/dependency upgrade. That inherited lockfile had six dependency audit findings: one moderate and five high. The later readiness follow-up lockfile has zero current audit findings; the live measurements retain their original dependency versions.

The first pass populates the new versioned semantic and image caches. The immediate second pass measures their actual reuse while fetching pages and refreshing market evidence. Direct cohort invocation deliberately bypasses the global 24-hour roaster cooldown. The existing launch agent is unloaded during the measurement; the harness owns its lock, preventing overlap.

Historical baseline runs occurred October 2–6. Their recorded `finished_at - started_at` durations are compared with the same boundaries in new `crawl_runs` rows. Those boundaries exclude initial platform detection and post-completion inventory reconciliation. New full-roaster wall time also measures these stages and is reported separately; there is no corresponding legacy full-wall-time measurement. Network/model/merchant changes and host load are uncontrolled, so historical differences are observations, not isolated causal effects of the code.

The private harness counts Axios/fetch requests, including observed retry attempts, during each roaster. Setup and evidence-snapshot queries are excluded. API-reported usage is also stored in `crawl_runs.meta.extraction`. The legacy `pages_sent_to_gpt` field simply copied visited-page counts, so it cannot establish old actual requests, tokens or billing. Coffee counters count classified page detections; they are not a verified count of distinct saleable products or ground-truth coverage.

The seven-day legacy context contained 1,607 completed runs, 39,447 visited pages and 12,493 coffee detections. Recorded duration median was 31.047 seconds and p95 1,230.013 seconds. Many historical runs skipped known pages; these population timings must not be compared directly with an explicit full refresh of this cohort.

## Results

The ten-roaster first pass ran from 02:24:37 to 02:55:54 UTC on October 7; the cached pass ran from 02:55:55 to 03:07:44 UTC. All twenty database run rows were matched to the private harness by entity and start/end time. Both passes used source `f96b06d23239a22a3e4d1de0ef6bc796ee927298`; the subsequent correction and its separate validation are described below.

| Metric | Historical matched runs | New first pass | New cached pass |
|---|---:|---:|---:|
| Comparable recorded crawl time | 2,256.051s (37m36s) | 1,853.148s (30m53s) | 687.627s (11m28s) |
| Change from historical time | — | 17.9% lower | 69.5% lower |
| Full new pass wall time | Unavailable | 1,877.256s (31m17s) | 709.388s (11m49s) |
| Visited pages | 129 | 129 | 129 |
| Successful coffee-page counter | 69 | 62 | 62 |
| Page errors | Not comparable | 7 | 7 |
| Actual AI requests | Unavailable | 129 | 14 |
| Semantic cache hits | Unavailable | 0 | 115 / 129 (89.1%) |
| Structured-only classifications | Unavailable | 0 | 0 |
| Successful market-check counter | Unavailable | 62 | 62 |
| API-reported input tokens | Unavailable | 173,140 | 18,989 |
| Included cached input tokens | Unavailable | 7,552 | 0 |
| API-reported output tokens | Unavailable | 160,188 | 29,504 |
| Calls with unreported usage | Unavailable | 0 | 0 |
| Estimated model list-price cost | Unavailable | $0.361962 | $0.063755 |
| Process CPU time during roasters | Unavailable | 19.399s | 13.164s |

Recorded time fell **62.9% between the new passes**, actual AI calls fell **89.1%**, and estimated model cost fell **82.4%**. The immediate repeat establishes observed cache reuse; it does not establish the same rates over days, changed inventories or the full queue. Eight merchants made no AI requests in the cached pass. Allies repeated seven failed saves, which had not been cached; Clearbrook made seven calls after its recorded semantic hashes changed. The remaining Clearbrook pages reused six classifications. Hash changes do not by themselves prove meaningful merchant content changes or AI accuracy.

Both new passes reported completed/successful roaster runs despite the seven page errors. Those flags must not be interpreted as an error-free crawl. The historical timing comparison is also affected by the failed work and different page classifications. Excluding Allies entirely, nine error-free merchants took 1,693.400s in the first pass versus 2,015.669s historically, an observed 16.0% reduction. See-Bohne was slower on the first pass than historically, and its cached run still took 290.854s with zero AI calls. Fetch/save/request-delay overhead remains substantial; request latency by category was not separately instrumented.

### Per-roaster comparison

Times below use the database run boundaries consistently. Full wall times, exact run IDs and unrounded aggregate values are retained in the accompanying [aggregate evidence](local-run-metrics.json).

| Roaster | Historical seconds | First seconds | Cached seconds | First / cached AI calls | Cached hits | First / cached page errors |
|---|---:|---:|---:|---:|---:|---:|
| La Venta Café | 113.142 | 66.913 | 10.435 | 6 / 0 | 6 | 0 / 0 |
| Shooke Coffee Roasters | 225.266 | 178.143 | 24.482 | 18 / 0 | 18 | 0 / 0 |
| Kickturn Coffee Roasters | 141.198 | 115.434 | 19.160 | 13 / 0 | 13 | 0 / 0 |
| Allies Coffee | 240.382 | 159.748 | 134.770 | 15 / 7 | 8 | 7 / 7 |
| KLETS Coffee Roasters | 269.693 | 147.770 | 17.561 | 10 / 0 | 10 | 0 / 0 |
| See-Bohne Kaffeemanufaktur GmbH | 632.097 | 694.588 | 290.854 | 29 / 0 | 29 | 0 / 0 |
| Clearbrook Coffee Company | 178.491 | 158.285 | 135.091 | 13 / 7 | 6 | 0 / 0 |
| Talisman Coffee | 106.238 | 80.990 | 4.826 | 5 / 0 | 5 | 0 / 0 |
| Ombre Coffee | 127.504 | 74.275 | 7.392 | 7 / 0 | 7 | 0 / 0 |
| Qualia Coffee | 222.040 | 177.002 | 43.056 | 13 / 0 | 13 | 0 / 0 |

### Requests, images and write activity

| Observed HTTP category | First requests | Cached requests | Detail |
|---|---:|---:|---|
| Merchant pages/platform detection | 153 | 141 | First: 141 HTTP 200, 12 failed network attempts; cached: all 141 HTTP 200. |
| Sitemaps | 56 | 57 | First: all 200; cached: 56 HTTP 200 plus one failed network attempt. |
| Native product endpoints | 34 | 34 | All HTTP 200; HTTP success does not prove valid product JSON. |
| OpenAI | 129 | 14 | All HTTP 200; actual usage reported for every call. |
| Images | 51 | 4 | First: 47 successful fetches plus four 404 attempts; cached: only four 404 attempts. |
| Supabase Storage | 22 | 0 | Actual uploads avoided on the repeat. |
| Supabase REST | 624 | 420 | 32.7% fewer requests; setup/evidence snapshot reads excluded. |

The four image 404 attempts in each pass came from two Shooke image URLs containing an unresolved `{width}` template, with retries. They remain a source-image limitation; successful existing images were reused. The first REST count includes 48 HTTP 406 responses for expected missing-row lookups, plus 458 HTTP 200, 106 HTTP 201 and 12 HTTP 204 responses. The repeat had 398 HTTP 200, ten HTTP 201 and twelve HTTP 204 responses. These HTTP categories do not measure SQL statements or rows changed: one atomic RPC can update multiple rows, and unchanged stock checks still write freshness evidence.

The first pass produced 62 catalog events; the repeat added six, all at Clearbrook (five content-only and one content/market). **87 retained variants advanced their check timestamp while their stock state, normalized money, currency and precision stayed unchanged.** Freshness therefore continued despite cache reuse. The new event totals do not establish legacy write savings; old SQL/HTTP/write counts were not instrumented. Observed peak RSS was 156.7 MiB by the first pass and 254.9 MiB by the second; these are cumulative process peaks from a shared process, with no measured legacy comparator, so no memory improvement is claimed.

### Catalog retention and field coverage

After the two primary passes, all **67 original product IDs**, their slugs/creation/first-seen timestamps, all **102 original variant IDs and creation timestamps**, all 67 fact rows, all 59 existing media links and all 190 known-page IDs remained. Totals became 71 products, 139 variants, 71 fact rows, 85 media links and 191 known pages. The four added products and 37 added variants are observed candidates, not independently verified distinct-product coverage gains. Three variants were added during Clearbrook's repeat: explicit bag labels appeared where the prior extraction had one `default` variant, without native IDs or proven currency. Existing rows were retained; ambiguous mappings need review rather than an automatic merge.

The comparison below uses the same original 67 products / 102 variants, avoiding denominator changes from new candidates. The baseline snapshot was taken after the additive migration and before the first crawl, when new normalized fields had not yet been populated.

| Present field on retained records | Before | After cached pass |
|---|---:|---:|
| Product source key / original title / display title (each) | 0 / 67 | 58 / 67 |
| Product note-normalization record | 0 / 67 | 58 / 67 |
| Product origin metadata | 39 / 67 | 41 / 67 |
| Product region metadata | 27 / 67 | 28 / 67 |
| Product description | 64 / 67 | 64 / 67 |
| Facts: process | 10 / 67 | 32 / 67 |
| Facts: variety | 10 / 67 | 10 / 67 |
| Facts: roast | 29 / 67 | 29 / 67 |
| Facts: raw tasting notes | 50 / 67 | 53 / 67 |
| Facts: typed decaf value | 0 / 67 | 33 / 67 |
| Facts: elevation | 0 / 67 | 0 / 67 |
| Variant weight | 40 / 102 | 40 / 102 |
| Variant amount/currency/exponent/minor units together | 0 / 102 | 24 / 102 |
| Variant non-null legacy currency | 102 / 102 | 81 / 102 |

Presence is not a human-validated accuracy score. A note-normalization record does not mean a populated canonical note category. Five display titles differed from original titles. Across all 139 variants, only **44** had fully specified normalized money; **37** had unknown currency. The malformed legacy `EUR (€)` value disappeared, and unproven currencies were cleared rather than treating old inference as source evidence.

The full cohort's product states were 14 in stock, five sold out and 52 unknown; variant states were nine in stock, eight sold out and 122 unknown. No gone state was inferred in these snapshots. Twenty-seven products and 91 variants had fresh evidence/check times, including unknown observations. Unknown states, missing weights and missing native IDs remain explicit limitations; a crawler observation is not a final checkout quote.

## Corrected release validation and schedule restoration

The first benchmark exposed an actual fallback-identity defect at Allies. Product-scoped JSON-LD offers had distinct numeric `?variant=` URLs but no SKU, offer ID or labels. Eight offers collapsed into one `default` identity and the guarded saves failed. A source-only replay reproduced the failure without AI or database writes. Resolving source **`30748a20ac66f90d3f121b7298b65631fede6e49`** uses the explicit numeric selector only for the same product and shares that identity with stock evidence. Existing SKU/offer IDs retain priority; other-product URLs, ambiguous selectors and conflicting duplicates remain rejected. Unknown labels/weights and incomplete inventory remain explicit.

This source also removes the pre-existing process-wide TLS-validation bypass from merchant HTTP support. The primary/historical code used that inherited bypass; these measurements must not be relabeled as final-release TLS performance. The corrected runtime leaves certificate validation enabled. Read-only merchant/Supabase/OpenAI HTTPS probes passed, followed by the actual affected-merchant crawl with no override. Other merchants' certificate compatibility remains unmeasured; certificate failures now defer the fetch.

All three added regressions failed before correction. **190/190 supported tests** passed after correction in the review checkout and again after installing it in the original checkout, with zero skips/failures (installed suite: 4.103 seconds). Both source CI checks passed: [run 37564379667](https://github.com/allang/coffee-roaster-crawler/actions/runs/37564379667) and [run 37564384683](https://github.com/allang/coffee-roaster-crawler/actions/runs/37564384683). The migration file hash is unchanged; no further migration, dependency or model change was needed.

After the primary harness exited and released its lock, the original checkout fast-forwarded to the corrected source. A separate first/cached Allies validation ran from **03:08:32 to 03:11:29 UTC**:

| Corrected Allies measurement | First validation pass | Cached validation pass |
|---|---:|---:|
| Recorded crawl time | 154.845s | 19.033s |
| Full pass wall time | 155.338s | 19.370s |
| Visited / successful coffee pages | 15 / 8 | 15 / 8 |
| Page errors | 0 | 0 |
| Actual AI calls | 7 | 0 |
| Semantic cache hits | 8 | 15 |
| Successful market checks | 8 | 8 |
| Input / included cached / output tokens | 9,920 / 9,216 / 17,114 | 0 / 0 / 0 |
| Estimated model list-price cost | $0.034634 | $0 |

Exact run IDs are `a8589572-db7b-4838-8d85-4d193e85904d` and `380d149f-3f3f-460f-b06b-b1eb5767197a`. This is a narrow recovery check, not another ten-roaster comparison or a fully cold cache: eight prior classifications were already reusable. The seven previously failed pages now saved successfully. They contributed **56 explicitly identified offers** across seven products, each with paired NZD amount/currency/precision, source stock evidence and a stable numeric selector. Missing new weights remain unknown. All 15 prior variant IDs were retained; the resulting 71 variant IDs and creation times remained stable on repeat. Fifty-seven unchanged variant observations advanced their check times, and the cached check added no catalog change event (eight events before/after). Legacy variants without a proven mapping remain unknown; offer data does not authorize retiring them or guessing labels/weights. Source observations still need checkout verification before purchasing.

The complete authorized measurement used **150 actual AI calls**: 129 first-pass, 14 cached-pass and seven correction-validation calls. Its combined reported usage was 202,049 input tokens (16,768 included cached tokens) and 206,806 output tokens. The combined model list-price estimate is **$0.460351**, excluding the regular crawler after resumption and all non-model costs.

The launch agent was restored at **2026-10-07 03:12:41.665 UTC / 2026-10-06 23:12:41 EDT**, after a 53m57s pause. Its plist and `.env` are byte-identical to the preserved originals. Verified launch state is running, interval **5,400 seconds**, one Node 22.22.0 crawler under its launcher-owned lock, one roaster worker and unchanged `gpt-5-mini`/request settings. Startup validated configuration, loaded existing proxies/blacklist, found **8,316 eligible roasters**, and began the regular queue. This confirms restart and initial progress; the full queue was not completed as part of the approved bounded comparison. The pause removed no historical stale runs, and source/docs remain on the review branch without merging main.

## Interpretation and limits

The report separates measured runtime, actual requests/tokens, catalog retention and observed field coverage from model-price estimates. Dollar estimates use the published GPT-5 Mini input/cached-input/output rates of $0.25/$0.025/$2.00 per million tokens, checked October 7 UTC, from the [official model page](https://developers.openai.com/api/docs/models/gpt-5-mini). They exclude proxy, database, storage, infrastructure, taxes and any account-specific discount; they are not invoices. Historical dollar savings remain unavailable.

The earlier [IMPACT_REPORT.md](IMPACT_REPORT.md) documents targeted offline correctness cases. Those fixture improvements and complete-structured-page AI avoidance must not be recast as representative production rates. This live cohort separately establishes what happened here, including failures and unknown monetary/stock evidence.

No real order, shopping-worker activation, API deployment or additional production migration is part of this comparison. Live purchasing success remains unmeasured.
