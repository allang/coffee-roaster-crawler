# Worker C: assigned merchant support

All ten assigned merchants have reviewed parser work and passing merchant-only inventory runs: 355 public packaged-coffee products and 833 native offers. Aery is inspection-only because its audit has no catalog owner. Original entity IDs, candidate mappings and identity statuses remain unchanged. No tier import, production write, AI call, merchant script execution, deployment or restart occurred. Prohibited requests: **0**.

| Merchant | Coffees | Native offers | Explicit net mass | Product stock in/sold/unknown | Evidence |
|---|---:|---:|---:|---|---|
| Aery | 18 | 18 | 18/18 | 9/9/0 | [aery-live.json](aery-live.json) |
| DAK Coffee Roasters | 23 | 62 | 60/62 | 23/0/0 | [dak-live.json](dak-live.json) |
| Loveless | 12 | 48 | 48/48 | 9/3/0 | [loveless-live.json](loveless-live.json) |
| Luna | 6 | 12 | 12/12 | 3/3/0 | [luna-live.json](luna-live.json) |
| Passenger | 24 | 56 | 56/56 | 24/0/0 | [passenger-live.json](passenger-live.json) |
| Tanat | 64 | 118 | 90/118 | 44/7/13 | [tanat-live.json](tanat-live.json) |
| Tandem | 18 | 266 | 258/266 | 17/1/0 | [tandem-live.json](tandem-live.json) |
| The Picky Chemist | 5 | 14 | 14/14 | 0/5/0 | [picky-chemist-live.json](picky-chemist-live.json) |
| Thoughtful Coffee | 19 | 73 | 70/73 | 18/1/0 | [thoughtful-live.json](thoughtful-live.json) |
| XLIII | 166 | 166 | 159/166 | 35/128/3 | [xliii-live.json](xliii-live.json) |

## Inventory and identity boundaries

- Aery: current shop 67 includes 18 coffees and three excluded UFO drippers. Its native single-item data supplies exact IDs, USD amounts, stock and explicit listing Weight. Native image-based descriptions are preserved as HTML and image links; textual facts are not guessed. `entity_ids=[]` keeps normal registration disabled. Corrected identity evidence is in [aery-blocker.json](aery-blocker.json).
- DAK, Loveless, Luna, Passenger and Tandem retain their ambiguous audit mappings. Supported profiles require the exact existing candidate ID and verified host; no duplicate merge or tier selection occurred. Luna and Passenger alternate domains are distinct merchants. Tandem’s alternate host redirected outside its allowlist and was not followed.
- Loveless: generic wholesale tags also label retail products. Twelve retail coffees remain; five explicit wholesale-only entries and one gift card are excluded.
- Passenger: its complete public two-page coffee collection supplies 24 retail products. Exact current retail variants are retained, while `variants_complete=false` prevents retiring hidden wholesale/market native options. Two Divino Niño sizes are explicit backorders with unknown immediate stock. The native indexed JSON parser scopes only primary loader fields and never executes scripts. The constants follow [turbo-stream v2.4.1](https://github.com/jacob-ebey/turbo-stream/blob/v2.4.1/src/utils.ts); native variant scope evidence is retained in the report.
- Tanat: category 18 provides the complete 67-entry coffee catalog across two pages; three subscriptions are excluded. Null grind attributes explicitly share one native SKU. Native backorders retain unknown immediate stock. Native term labels resolve `1-kg` to the declared `1 kg`; multi-bag labels retain unknown aggregate mass.
- Tandem: all 18 retail coffees include Cup of Excellence, instant coffee and samplers. Labeled Weight/Size fields establish net mass independently of hyphenated grind text and shipping mass.
- Picky Chemist: its current shop category declares all five coffees and all are sold out; the separate historical Archive is excluded. Native managed variants retain their UUIDs. Optional unmanaged roast choices share one native UUID. Current 200 g product names override stale 250g slugs.
- Thoughtful: current Special/Terroir/Process collections supply 19 coffees, including sold-out Milan. Archived and popup-only offerings are outside the current packaged shop. Encoded native Size labels with ambiguous text remain unknown.
- XLIII: complete English catalog declares 169 native entries over four pages, yielding 166 packaged coffees after excluding two subscriptions and one café tasting reservation. This retains public 100 g pages and sold-out inventory absent from the 17-product coffee-beans category. VND exponent 0 is native, never paired with USD sourcing-cost labels. Seven old sold-out lots have unknown net mass; three native backorders have unknown immediate stock. Three empty API descriptions are completed from primary product-info panels.

## Integration

New adapters: `woocommerce.js`, `hydrogen.js`, `wix.js`, and narrowly gated native single-item `cafe24.js`. The normal page visitor uses the same adapters. Native IDs, exact prices/currencies, availability evidence and proven net size flow through the existing extraction/normalization pipeline. Woo option query keys and Passenger’s published Size selector normalize to existing product identity; PGlite regression saves preserve prior product IDs/slugs and remain idempotent.

Merge shared changes in profiles, discovery, CLI, network, DOM discovery, Shopify discovery/product parsing, pageVisitor, catalogNormalization, extraction and productEvidence with other workers. `discoverProfileProducts(roaster, profile, fetchHtml)` matches worker E’s merchant-only contract; `profileFor` remains exact-ID gated. Reader changes add native pagination headers and block legal/account/basket/cart-action destinations before GET.

## Validation

Node.js 22.19.0: `node --test test/*.test.js src/*.test.cjs` completed **243/243**, including 19 new worker regressions. Coverage includes captured primary merchant data, incomplete pagination, native stock/money binding, image descriptions, wholesale-only versus mixed retail tags, native size fields, no script execution, normal page visitor integration and disposable local PGlite identity/idempotency checks. All final merchant reports pass; [worker-c-validation.json](worker-c-validation.json) records totals. `git diff --check` passed. The npm script initially selected system Node 23.7.0 and its catalogFreshness child stayed open; that incomplete run was terminated and did not count as verification.
