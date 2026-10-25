# Reviewed Asian BASE Storefronts

This additive reader is registered only for the three newly indexed owners:
Nano's Coffee, HOKURO ROASTERY and Specialty Coffee Soh. Other merchants keep
their existing fetch/extraction path. Soh's exact existing `lit.link/sohcoffee`
index identity leads to its verified official BASE storefront; the index URL
is not overwritten. Shared platform hosts do not establish merchant identity.

Merchant GET-only validation on October 25, 2026:

| Merchant | Reviewed public scope | Products | Product state |
| --- | --- | --- | --- |
| Nano's Coffee | Coffee-bean category 3667386 | 10 | 10 in stock |
| HOKURO ROASTERY | Published homepage cards, two subscriptions excluded | 15 | 14 in stock, one sold out |
| Specialty Coffee Soh | Published homepage cards, subscription excluded | 23 | 23 in stock |

These 48 are product-only base offers, not a claim of 48 selectable SKUs or a
complete merchant inventory. Each has exact canonical/form/shop identity,
a primary JSON-LD product, paired JPY price/currency, description/photo and an
explicit primary purchase control. The optional converted USD display is not
used. No option combination, gift-wrap price, weight or stock is invented.

HOKURO's sold-out tasting set has misleading `InStock` JSON-LD. Its disabled
primary `Sold out` button supplies the unavailable state. An enabled purchase
button cannot override schema-level unavailability. Unknown controls fail
closed. Native JSON-LD title entities are decoded before exact DOM comparison.

Discovery uses the reviewed rendered card containers, not navigation,
slideshow links or recommendations. Nano's homepage has stale slideshow links;
its current coffee-bean category provides the actual public coffee cards.
Hidden categories, pagination and size/grind combinations remain unverified.
All three readers explicitly disable omission/global-absence reconciliation.

Raw live reports are retained in `.state/naver/{nano,hokuro,soh}-live.json`.
Committed projections of the captured pages are used in `test/asianBase.test.js`.
The full regression suite passes 552 tests. Inspection makes no production
writes or model calls; production ingestion remains a separate measured step.

`node scripts/crawl-reviewed-asian-base.cjs` previews the exact three owners.
Adding `--apply` invokes the existing transactional crawler/saver only for
those IDs and writes before/after product, offer, stock and photo evidence to
`.state/naver/base-production-crawl.json`. An optional exact merchant name
limits it further. It checks source project, owner URL and running merchant
jobs before starting; it does not change the scheduler or any database index.
