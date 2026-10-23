# Passport full crawl and fresh verification — 2026-10-08

**The full normal Passport crawl and independent catalog readback passed** on exact installed main 99721e64fe8440e7cc3c68054c412fef5230c8a2, run 29d25480-cdac-4759-a63d-f5d3afad7cb1. The visitor recorded **255 visited / 255 coffees / 0 irrelevant / 0 errors**. Fresh readback verified **528 native coffee SKUs**, their current AUD prices and stock, known net weights, processing/co-ferment/evidence metadata, stable product/variant IDs and creation times, and **169 public images / 81,070,834 decoded, hash-matching bytes**.

The crawl ran 2026-10-08T19:56:36.640Z to 2026-10-08T20:09:38.233Z, taking **781.593 seconds**. PID 60576/session 18288 exited naturally. The controller resumed the original scheduler Node 59674 with SIGCONT at 2026-10-08T20:09:39.715Z; launcher/lock 59662, original environment, launcher, 5,400-second interval and source remained unchanged. The temporary verification suspension prevented the scheduler’s already loaded Passport queue from overlapping. It is separate from the 59.434-second installation pause.

Controller PID 60564 / session 18288 preserved scheduler state T during verification. Its exact resume handlers were tested against separately owned idle processes for successful child exit, nonzero child exit and spawn error, all three passing without production signals. The actual same-PID scheduler resume was independently checked after normal observer exit. The verification suspension lasted **784.887 seconds**. A fresh normal Luminous product and known-page checkpoint both persisted at **20:12:55.187 UTC**, proving the resumed worker is actively writing.

Fresh preflight 2026-10-08T19:54:04.220Z read the actual full native collection through an empty final page: 255 coffees/528 coffee SKUs/eight accessory subsets, unchanged from the reviewed identity scope. It simulated actual v1 native/legacy adoption against all 249 retained products/516 variants with zero global-weight collisions or known weight nulling. A fresh SQL SELECT confirmed the OLD global non-null weight unique index plus source-key uniqueness. No migration, model/output setting change, global cooldown reset or omission reconciliation was applied.

All **eight accessory subsets remain variants_complete=false**. Both global omission flags remain false. The full coffee-product run does not turn accessory subsets into complete native inventories or authorize merchant-wide absence changes. All historical failed Passport rows and receipts remain truthful and unchanged; all prior product/variant IDs and creation times are retained. New stable products this attempt: 6. Retained catalog totals are 255 products / 528 variants, distinct from independently checked current source scope.

| Measured result | This completed run | Previous C7 failed attempt |
|---|---:|---:|
| Elapsed seconds | 781.593 | 1470.360 |
| Successful coffee saves | 255 | 98 |
| Save failures | 0 | 0 |
| Terminal page errors | 0 | 157 |
| Cached / AI pages | 249 / 6 | 61 / 37 |
| Model responses | 6 | 40 |
| Input / cached input / output tokens | 10,039 / 0 / 19,482 | 68,385 / 5,120 / 135,492 |

These are measured attempt results, **not a matched code-only speedup**. This run reused classifications and media from earlier attempts and took place in a different merchant traffic window. Earlier C7 failed before completing 157 pages; its headers and individual reader failures were not retained. We cannot attribute all elapsed or model differences to the new cooldown code, infer the 157 missing causes, or treat a prior partial attempt as the same workload. No invoice amount or dollar savings is claimed.

The actual reader made **790 wire attempts: 774 HTTP 200 responses and 16 HTTP 429 responses**, all recovered. Those 429 responses had no Retry-After header; the actual retry ledger records a 2,000ms delay for each, totaling 32 seconds of declared short retry delays. Returned reader errors: 0. Long finite cooldown resumptions: 0; declared additional waits: 0ms. The long Retry-After recovery and adaptive spacing path was not required in this live attempt; its bounded behavior is established by the reviewed offline regressions.

The installed normal reader retains max 3 finite long cooldown resumptions/300 seconds total extra waiting, max 3 active-read retries/ 60 seconds, and URL/DNS/redirect/body limits. Exhaustion stops deferred/unvisited pages and fails before completion or omission reconciliation. The full normal discovery/reader/visitor/cache/extraction/save path was used; no selection of old failed pages, forced cache reset, custom retry or model override.

Processing method counts: {"washed":68,"natural":158,"honey":15,"anaerobic":63,"thermal_shock":21,"carbonic_maceration":8,"lactic_fermentation":6}. Co-ferment disclosure is unknown for all 255 products. A separate scan of fresh native titles/descriptions found no explicit co-ferment wording; two coffees described mosto/yeast starter infusion without explicitly labeling it a co-ferment. Unknown disclosure stays unknown. Normalized methods, co-ferment/ingredients and source evidence are in product metadata while the typed processing migration remains unapplied; reported process wording is also checked in coffee_facts. This validates source-to-database fidelity, not independent farm/origin truth or historical catalog sanitation.

Independent validation reread catalog records after completion, compared exact SKU identity/weights/current native price and stock projections, stock freshness, process/co-ferment/evidence/photo sources and stable IDs/creation. Public assets were fetched from guarded public storage URLs, decoded fully with Sharp and checked against stored MD5 hashes. Price/stock expectations came from current primary/.json/.js observations, not old snapshot prices. The fresh full collection preflight supplied an independent native product/SKU/label-weight identity scope.

The eleven previously proven Hydrangea/Taith unique-weight save failures remain a separate schema compatibility blocker. This Passport scope fits the existing index; passing it does not fix those merchants, certify all tiers/all roasters or approve either pending migration. No hosted deployment or real purchase was made.

[Sanitized measured receipt](mac-mini-passport-cooldown-run-20261008.json) · [Installation/start report](MAC_MINI_COOLDOWN_UPDATE_20261008.md) · [PR6](https://github.com/allang/coffee-roaster-crawler/pull/6) · [Tracking issue1](https://github.com/allang/coffee-roaster-crawler/issues/1). Exact report commit, CI and review follow in the issue log.
