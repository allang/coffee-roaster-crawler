# Product-page routing and 60/10-minute limits

The user selected **60 minutes per scheduled batch and 10 minutes per roaster**. These are ceilings: configuration may shorten them, but cannot disable or raise them. Four roasters still run concurrently, one page at a time per roaster. The later authorized local installation changed the Mac's launch interval from 90 minutes to **60 minutes**.

Installed source `85cc2d8f191a9adb627dd908bdb94d34aa4be23c` restarted at **2026-10-23 01:45:41 EDT / 05:45:41 UTC**. Both saved and loaded LaunchAgent intervals were verified as 3,600 seconds. The original four pipelines were parked at safe page boundaries; returned catalog/cache checkpoints were preserved. [Installation receipt](hourly-crawler-install-20261023.json). Installed full suite: 531 total / 530 pass / zero fail / one optional native PostgreSQL skip. This is runtime/configuration verification, not a full-batch performance benchmark.

## What was actually sent

A read-only, nontransactional audit captured 1,860 recent known-page classifications from 11 log-identified merchants at 2026-10-23 05:20:04 UTC. All 1,860 records have extraction mode `ai`. Failed saves are absent under the installed source; repeated requests and raw historical prompts cannot be fully reconstructed from this snapshot.

| Saved AI decision | Records | Interpretation |
| --- | ---: | --- |
| Coffee | 1,630 | Candidate coffees; the classification is not independent verification |
| Not a product | 149 | Includes 126 collection/listing URLs, five homepages, six static documents and 12 custom product-shaped URLs |
| Not coffee | 81 | Includes 75 product-shaped URLs and six listing URLs |

The rejected records retain usage reporting for **149 + 81 = 230 model requests**. This confirms unnecessary classification work in the sample; it is not a fleet-wide waste rate or a billing statement. Examples include `/collections/coffee`, `/collections/all`, `/agents.md`, a logo ornament, a mug and a baseball hat. Three separate public native JSON reads confirmed merchant product types `Mugs`, `Mugs` and `Accessories` for the latter merchandise examples; no model or catalog write was used for those checks.

Seventy-two saved coffee classifications use custom paths such as `/boutique/...`, `/kava/filtr/...` and `/shop/stardust...`; rejecting everything outside `/products/` would lose legitimate candidates. Ten collection URLs and one homepage also have prior positive coffee classifications. Those require current primary-product evidence; a cached positive decision cannot bypass the new page checks. The 12 rejected custom product-shaped URLs are retained as uncertain candidates unless fresh HTML establishes a clear non-product/removal state. Their names alone are insufficient to exclude them permanently.

The historical warning-only log subset mainly contains product URLs; it does not establish that news/policy pages caused the 14-hour example. The code path nevertheless admitted generic sitemap/BFS pages to AI. New routing prevents that category of waste directly. [Aggregate evidence](ai-routing-audit-20261023.json) contains no credentials or prompt bodies. The broad timestamp query initially hit a database statement timeout; the completed audit used bounded indexed entity filters instead, with no database changes.

## Routing before AI

| Category | Behavior |
| --- | --- |
| Static documents/assets, cart/account/search, clear policy/information/editorial URLs | Skip before merchant fetch and AI, except rechecking a previously saved coffee identity |
| Homepages, collections and explicit list markup | Fetch when needed for discovery; skip AI without primary-product evidence |
| Article, FAQ and collection structured markup on unfamiliar URLs | Skip AI when no primary product/purchase evidence is present |
| Explicit native merchandise/equipment categories | Skip coffee extraction and translation without consulting AI |
| Primary native/schema product or product purchase controls | Continue through the existing extraction, market and English-validation contract |
| Uncertain custom product candidate | Preserve AI fallback; do not infer absence from missing schema or a missing cart button |

The shared gate covers both sitemap and BFS processing, including cached false positives. Product paths win over incidental keywords in a product slug. Listing pages still contribute links in BFS. Recognized cart, recommendations and navigation cannot establish a primary purchase control. No product stock is marked removed simply because routing skips a page. Existing false-positive catalog rows are not deleted by this change; correcting those records requires separate evidence.

Each actual model request now logs URL, extraction/translation purpose and attempt number at INFO level, without prompt bodies or keys. Per-attempt metrics record page-category counts, skipped-AI counts, calls by category and separate extraction/translation totals. Extraction usage is cloned before adding translation usage, fixing an existing shared-object mutation that made historical cached coffee usage ambiguous between the two stages.

## Bounded runtime and continuation

Batch and merchant budgets propagate cancellation to ordinary HTTP/proxy requests, guarded merchant readers, OpenAI, Supabase requests, image requests and waits. Work stops early enough to reserve bounded time for failure metadata. A merchant hitting its budget fails with available partial counts and `inventoryComplete:false`; it does not complete or reconcile missing products. Later tiers and retries are not admitted after the batch expires. Previously returned catalog/cache writes remain intact. Unknown write outcomes are not automatically replayed.

The Node entry point has a batch hard-stop timer that stays armed until process exit, including if background work outlives the returned batch result. The normal launcher independently enforces elapsed time even if logs continue, sends TERM within the reserved shutdown window, then KILL by its deadline if required. This also bounds a blocked Node event loop. A forced process stop can leave an interrupted claim without final metadata if the database cannot accept the failure update; it never certifies completion. Per-roaster deadlines use request cancellation; they are not separate operating-system processes.

Later attempts sort product pages by never fetched first, then oldest fetch. Partial merchants remain failed/eligible under existing cooldown rules, and saved page timestamps let later attempts advance past recently processed pages. This is page-level continuation through the existing database, not a durable traversal checkpoint; BFS rediscovers links. Existing per-tier merchant ordering remains unchanged.

```dotenv
CRAWLER_BATCH_TIMEOUT_MS=3600000
CRAWLER_ROASTER_TIMEOUT_MS=600000
```

No migration or new dependency is required. Integrate the PR15 dependency and PR17 source without resetting remote or local work. Preserve the original environment, launcher and Git refs before any authorized installation. Install both source and launcher; an already running old process does not acquire these limits automatically. Stop it after returned page/catalog writes and verify its worker/lock have exited before restarting a single launcher. The prior [AI efficiency report](ai-efficiency-20261023.md) retains its measured replay results and limits; these new gates are not relabeled as a measured production speedup.

Tests cover URL/HTML skips, uncertain/native product preservation, cached false positives, call-category accounting, page continuation order, cancellation of HTTP/OpenAI/Supabase work, partial-run failure/no omission reconciliation, tier admission and an actual temporary launcher with a continuously logging child. The launcher fixture has a five-second limit and leaves no child or lock. A separate two-second entry-point fixture proves background work cannot disarm its hard stop. Production/model credentials are removed from the offline suite; public JSON verification used three merchant GETs only.

Final supported suite: **531 total / 530 pass / 0 fail / 1 optional native PostgreSQL skip**, 13.302 seconds. PGlite contracts pass. Bash syntax, JavaScript syntax and diff whitespace checks pass. These tests establish routing/cancellation behavior, not a measured fleet throughput improvement.
