# .txt public inventory follow up

This historical option-investigation report is superseded for product support by the October 8, 2026 product-only adapter and [registered live receipt](txt-registered-live.json). The public English homepage and coffee collection agree on seven native coffee products. The registered parser can save each real product identity, primary photo, explicit sold-out state, description and paired USD base offer. It creates zero variants because the public size/combination IDs remain unavailable. The base offer is retained in `metadata._product_offer`; it is not presented as a selectable size or default variant.

The source identity includes the English market, Imweb site code, active English unit code and native product code, so an English offer cannot inherit a domestic product's price or stock. The native primary configuration, exact primary Product offer, heading and primary photo must agree before a product is accepted. Pencil and memo-pad products are excluded by their verified native codes. Missing or repeated native cards, changed pagination, mismatched listing scopes, failed pages and conflicting primary price/stock fail validation.

This is deliberately partial product coverage: discovery records `complete: false`, `observed_scope_complete: true` and `inventory_complete: false`. Both profile and discovery disable omission reconciliation, and crawl-run metrics retain the public English scope and partial state. The inspector reports `partial_support_verified: true` and `passed: false` for complete-inventory support. Domestic inventory and native variants remain unverified. The implementation does not retry the Naver 429 or call account, cart or order endpoints. The registered receipt contains nine guarded GET requests, zero model calls, zero production writes and zero prohibited requests.

Regression coverage in `test/siteSupportTxt.test.js` and `test/registeredCrawler.test.js` checks all seven actual product codes, paired USD offers and exact primary photo URLs; rejects mismatched product/unit/title/price/currency/stock and forged partial scopes; proves the normal page visitor saves all seven products without semantic AI; and proves repeated transactional saves preserve the legacy ID/slug, prior option rows, sold-out state and a single cached photo asset. Unpublished semantic coffee facts stay unset. The earlier complete-option findings below remain accurate for their timestamp.

.txt remains blocked after fresh public reads on October 8, 2026 at 3:43 AM EDT. The official Korean Naver shop still returns HTTP 429. The official English homepage publishes nine product links: seven coffees and two stationery products. Every coffee's primary native configuration and Product offer report sold out. The English reads establish this published homepage scope; they do not prove complete Korean inventory or authorize global absence reconciliation.

| Public product index | English coffee | Native product code | Verified USD base price |
| --- | --- | --- | ---: |
| 207 | [Melting Blend](https://txtcoffeeen.imweb.me/shop_view/?idx=207) | s20260717b4233092c4221 | $10 |
| 182 | [Ethiopia Arbegona](https://txtcoffeeen.imweb.me/shop_view/?idx=182) | s201809285bade00dec890 | $12 |
| 180 | [Ethiopia Karamo Bura AH](https://txtcoffeeen.imweb.me/shop_view/?idx=180) | s201809275bacc98d5f798 | $20 |
| 184 | [Colombia El Obraje Geisha](https://txtcoffeeen.imweb.me/shop_view/?idx=184) | s201809285bade2f766ea8 | $20 |
| 183 | [Panama Chevas Fresa Geisha YN](https://txtcoffeeen.imweb.me/shop_view/?idx=183) | s201809285bade24d832f7 | $26 |
| 181 | [Panama Adaura Lorayne Geisha HW](https://txtcoffeeen.imweb.me/shop_view/?idx=181) | s201809285baddf165dcf8 | $26 |
| 202 | [Drip Bags 15g x 6 (Melting Blend)](https://txtcoffeeen.imweb.me/shop_view/?idx=202) | s20250210cd2290c6f82db | $12 |

Melting Blend publishes Type option O202607171591bd85be394 and two Type value IDs: Filter O202607170105af2781a52 and Espresso O202607171622da333b5ed. A public product-option read for each known Type value returns the three Net weight rows below. Their selectors are return false; the native size value IDs and priced combination IDs are absent. The other six coffees also publish size or box labels and prices without selectable native value IDs. These labels cannot supply fabricated IDs or default variants.

| Product index | Published size dimension option ID | Published rows with missing native value IDs |
| --- | --- | --- |
| 207 | O20260717d35ec16c82353 | 150g $10.00; 400g $18.00; 850g $34.00 |
| 182 | O202003215e7592431d61b | 150g $12.00 |
| 180 | O201809275bacc8627302b | 150g $20.00 |
| 184 | O202003215e759282169c0 | 105g $20.00 |
| 183 | O201809275bacc8627302b | 60g $26.00 |
| 181 | O201809275bacc8627302b | 60g $26.00 |
| 202 | O202003215e7592431d61b | 1박스(6개입) $12.00 |

The active English unit is u2025091568c79f6d083ba under site S201809265bab93e020b92. For every product, its active unit's native price-map entry agrees with both the primary product offer's USD amount and the published product configuration. The response also supplies another storefront unit's price, u201809265bab93e02c7bd. For example, Melting Blend's active unit amount is 10 USD; the other unit amount is 13000 with no currency paired by this English response. The other unit's amounts are retained as unused evidence, never assigned USD or used to establish domestic product/inventory equivalence. The 40-character options hash is opaque and supplies no missing option identity.

The merchant's own published site_shop.js still defines the read-only loadOption product POST to /shop/load_option.cm. The fresh trace contains 13 GETs and nine option POSTs. Each POST contains only type=prod, a product index and edit timestamp read from that current public product page, and, for the two dependent reads, the previously published Type option/value IDs. No scripts were executed. No unpublished or private API, access-control, cart, order or customer endpoint was called. Merchant ownership was rechecked through the official store links, matching business registration 288-07-00706 and the public owner name.

Parent compatibility was reviewed at a2449c63d7795d2692cf5ab0069b61e9ac1dbb54. Its separate Imweb adapter uses a merchant-specific public native product path; that path was not published by the inspected .txt frontend, and it was not probed. No runtime profile, adapter, normalized variant IDs or absence authority were added. This follow-up changes only sanitized evidence, this report and the .txt queue row. Temporary inspection code, tests and raw source pages were removed.

A verified adapter requires an external source change: the English public option response must expose stable native value/combination IDs paired to every offered price, currency and stock state, with a complete retail listing scope, or the merchant must supply an authoritative export containing those fields. Retail options becoming publicly selectable may provide those IDs; a stock label alone is insufficient. Complete domestic support separately requires accessible official Korean retail inventory or a merchant feed/export that identifies that market. English availability does not establish Korean availability, completeness or product removal.

The fresh evidence assertions verified all seven product codes, exact active-unit USD pairings, both dependent Type reads, the missing value IDs, and all 22 guarded request destinations and closed POST bodies. Production writes, AI calls and prohibited requests were zero. The machine-readable receipt is txt-followup-live.json.
