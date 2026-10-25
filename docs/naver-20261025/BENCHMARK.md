# Asian Storefront Benchmark

October 25, 2026. This benchmark covers the 21 net verified additions from the
current Brewing Ceremony / Instagram discovery work, not a rerun of the older
2,379-URL stockist-import audit. An index addition, an extracted product and a
successfully saved coffee are reported separately.

The independent source-catalog baseline at 07:55:03 UTC found zero products
across the initial 19 owners. Toyosaki and Regolith were subsequently added
with insert-only identity checks and readback. The expanded 08:57:26 UTC
readback confirms 21 roaster owners and zero coffee products. A further
10:21:12 UTC readback after Zuku/Nakaji extraction confirms the same.
A 10:43:07 UTC readback after Reshock extraction again finds 21 owners and
zero saved products. Live merchant GET-only inspection verifies the following:

| Merchant | Coffee products extracted | Native variants verified | Production products before | After actual crawl | Current blocker |
| --- | ---: | ---: | ---: | ---: | --- |
| Nano's Coffee | 10 | Not complete; product-only base offers | 0 | 0 | First translation returned OpenAI 429: no credits remaining |
| HOKURO ROASTERY | 15 | Not complete; product-only base offers | 0 | 0 | Shared process quota guard stopped translation |
| Specialty Coffee Soh | 23 | Not complete; product-only base offers | 0 | 0 | Shared process quota guard stopped translation |
| KIELO COFFEE | 15 | 121 | 0 | Not attempted | Existing weight-only unique index conflicts with distinct grind SKUs; migration approval pending |
| X coffee GINZA | 17 | 147 | 0 | Not attempted | Same weight-index save gate; migration approval pending |
| Ariowl Coffee | 23 | 84 | 0 | Not attempted | API-credit and distinct same-weight SKU save gates remain |
| COFFEE ROASTERY 101 | 13 | 61 | 0 | Not attempted | Same gates; subscriptions/equipment excluded, source bag weights retained |
| OTC COFFEE | 6 verified, 2 held | Product-only; SKU inventory incomplete | 0 | Not attempted | Both DECAF sizes have conflicting stock evidence; merchant inspection correctly remains failed |
| Regolith Coffee | 27 | 111 | 0 | Not attempted | API-credit and distinct same-weight SKU save gates remain; only reviewed one-time coffee scope included |
| Toyosaki Coffee Factory | 22 | 22 | 0 | Not attempted | Source inspection passes; actual production pipeline awaits API credits and separate runtime validation |
| CRU Coffee Hakuraku | 11 | 11 | 0 | Not attempted | Source inspection passes; actual production pipeline awaits API credits and separate runtime validation |
| Essentia Factory | 84 | 885 | 0 | Not attempted | Source inspection passes, including 23 sold-out products; API-credit and distinct same-weight SKU save gates remain |
| Zuku Cafe | 19 | 102 | 0 | Not attempted | One-time source inspection passes; merchandise excluded; API-credit and same-weight SKU save gates remain |
| Coffee Roastery Nakaji | 22 | Incomplete; product-only base offers | 0 | Not attempted | Verified classic BASE fallback works without changing the indexed URL; hidden inventory/native SKU sets remain incomplete; API-credit gate remains |
| Reshock Coffee | 41 verified, 2 held | 70 exact native variants plus 9 product-only offers | 0 | Not attempted | Expired collection offer and conflicting gift-box stock/price remain held; actual saves await API credit and runtime validation |
| Brewing Ceremony | 0 | Not observed | 0 | 0 | Public HTTP 429; Safari security CAPTCHA not completed |

Measured extraction: **348 products from fifteen sites**, including 524 exact native
Shopify variants, 124 Wix variants, 11 Square variants, 885 Cafe24 variants,
70 Shopline variants, 70 BASE product-only offers, six OTC product-only offers
and nine Shopline product-only offers. Total exact native variants: **1,614**;
product-only offers: **85**. Reshock adds 41 source-extracted products to the
previous 307-product checkpoint, not 41 saved coffees.
OTC and Reshock each retain two page errors; neither is counted as a wholly
successful merchant. This is not a 348-coffee
ingestion gain. Newly saved products from the real attempts: **0**. Newly
successful complete merchant ingests: **0**. The 21 index additions remain a
separate, verified outcome.

## Actual BASE Runtime

The one-off production validation used exact commit
`0adc69837a64fe75cb5f50dfebf4b241e4249f4a` in an isolated detached Mac mini
checkout, not its scheduled checkout. It ran from 07:58:26.972 to 07:58:45.139
UTC, with one roaster / one page worker and 180s / 600s budgets. It discovered
10 / 15 / 23 URLs and visited one product per owner before the quota guard
stopped further work. All three runs failed. The first translation was the
only model request; no extraction-model calls were needed.

Run IDs:

- Nano: `00ea6254-7342-474e-9272-12a47ec690d4`
- HOKURO: `28e0952e-2ff2-4593-b45c-ca7b192ef5e1`
- Soh: `cd7e0735-998d-4931-9352-5adcc61d611a`

There were zero product-save events, new products, variants or photo links.
Run records and classification checkpoints were written; those are not saved
catalog products. No price, identity, translation or stock guard was bypassed.
No migration, scheduler/source rollout, service restart or omission
reconciliation occurred. The isolated checkout was removed only after its
reports were preserved. The existing scheduled job remained running on
`85cc2d8`, with the hourly interval unchanged.

Independent parent readback at 08:02:14 UTC confirms all three runs failed,
all three owners still have zero products, and all have finished timestamps.
`base-runtime-summary.json` contains the sanitized runtime reason;
`base-independent-readback.json` contains the independent catalog evidence.
`catalog-before-base-validation.json` is the 19-owner baseline. Detailed Mac
receipts are preserved under
`/Users/allan/Documents/workspace/everycoffee-preservation/asian-base-validation-20261025T0758Z`.

## Other New Sites

These remain discovery/reachability results, not successful ingestion claims:

| Merchant | Last verified result / next need |
| --- | --- |
| Kingkongdrip | Naver HTTP 429; product data unavailable |
| New Wave Coffee Roasters | Official homepage works and links its Naver store; real retail catalog access unvalidated |
| Single Origin espresso & roast | Official Shopee shop now verified to redirect the anonymous browser to sign-in; automated catalog extraction remains unvalidated |
| 5F Coffee Lab | Official equipment-oriented homepage reachable; coffee retail destination still needed |
| Coffee Aura | Normal browser exposes 4 coffees / 29 native options; HTTP and isolated browser probes return 403; no automated access fix shipped |

The additional GET-only results, exact source scopes, own-roasting evidence,
deduplication and stock holds are documented in
[the follow-up](../ASIAN_STOREFRONT_FOLLOWUP.md). Its runtime is not activated in
the scheduled Mac checkout. Latest full regression result: 621 passed tests.
`post-new-store-readback.json` records the fresh 21-owner/zero-product source
readback. `post-essentia-cru-readback.json` confirms that result again at
09:53:01 UTC. Each merchant's `*-extraction.json` records actual GET requests,
product and variant counts, errors and zero production writes/model calls.
`post-zuku-nakaji-readback.json` confirms the 21-owner/zero-product result again
at 10:21:12 UTC. `nakaji-indexed-url-smoke.json` proves the live fallback from
the unchanged indexed URL. `reshock-extraction.json` records the later real
52-GET inspection: 41 verified products, 70 native variants, nine product-only
offers and two held pages. Its overall `passed` remains false.
`post-reshock-readback.json` confirms the 21-owner/zero-product result at
10:43:07 UTC. Earlier Shopline source-discovery-only evidence is retained as
a dated observation, not a passing extraction result.

The [public access recheck](PUBLIC_ACCESS_RECHECK.md) records Aura's normal-browser
source evidence, Single Origin's sign-in gate, 5F's equipment-only observed
homepage links and the unsuccessful direct Naver-product search. These are not
new automated extraction passes. The fresh 11:07:50 UTC readback in
`post-access-recheck-readback.json` still finds 21 owners and zero products.

## Next Gates

Restore API credit or identify an existing authorized API configuration before
retrying BASE ingestion; do not purchase credits or silently change accounts.
Complete Naver's CAPTCHA only after the requested specific confirmation, then
capture real listing/product data before claiming Naver support. Apply no
global index migration without approval of `VARIANT_SAVE_GATE.md` and a fresh
schema preflight. Keep Instagram verification/deduplication and the existing
working-site regression suite in place. The broader goal remains open.
