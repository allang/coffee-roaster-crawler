# Asian Storefront Follow-up

October 25, 2026. This checkpoint adds two independently checked roasters and
nine scoped storefront profiles, including the OTC reader. It does not install code over the Mac mini's
scheduled checkout, apply a migration or retry the exhausted API account.

## New Index Entries

| Roaster | Source identity | New entity ID |
| --- | --- | --- |
| Toyosaki Coffee Factory | https://www.toyosakicoffeefactory.com/shop | 68b94ad4-dba5-5674-a471-7cb5d70fde0d |
| Regolith Coffee | https://regolith-coffee.com/ | 84cf4258-29ac-5fa8-bde5-2a138240b185 |

The separate Safari discovery session observed the existing Toyosaki frontier
and its following-list link to Regolith. Parent checks independently verified
the official stores and queried all source entities, not only roaster roles,
for English/Japanese names, merchant domains, aliases and Instagram identity.

[Toyosaki's official factory page](https://www.toyosakicoffeefactory.com/blank)
identifies own-roasted beans and the operator, Okinawa Ueshima Coffee. Its
homepage links the same Instagram account. The similarly named existing
Ueshima Coffee Company entry has another published brand/domain; its captured
identity and role fields are unchanged in the before/after readback.
[Regolith's official brand site](https://regolith-coffee.jp/) explicitly
describes its own roasting and links its .com retail store and seminar alias.

The insert-only helper previews by default, refuses ambiguous existing matches,
retains source evidence, and reads back each entity and roaster role. Its first
apply reported two inserts per owner (entity and role); an actual rerun made
zero writes. Per-run receipt files now retain separate run identities rather
than replacing earlier runs' evidence. The original preview and current
idempotent readback are committed under `naver-20261025/`.

## Ariowl And Roastery101

| Merchant | Coffee products | Exact native variants | Observed currency |
| --- | ---: | ---: | --- |
| Ariowl Coffee | 23 | 84 | JPY |
| COFFEE ROASTERY 101 | 13 | 61 | JPY |

Both pass live GET-only inspection with every native variant priced, identified
and explicitly in/out of stock. Ariowl's one subscription and Roastery101's two
subscriptions/seven equipment products are excluded. The profiles are registered
only for their exact new catalog owners. Omission reconciliation remains off.

Ariowl's symbol-leading handle is allowed only as an exact reviewed handle;
other profiles do not gain arbitrary symbol/path handling. A 15g native size
is retained separately from its 100g shipping mass. Published selection totals
of 150g/300g are used; ambiguous brew-pack mass and unlabeled drip bags stay
unknown (15 variants), rather than borrowing shipping weight. Roastery101's
Japanese bracketed bag weights apply only while its reviewed native roast/grind
option contract remains unchanged; its drip-bag net mass remains unknown.
The future-shipment title is preserved without inventing a delivery date or
changing native stock solely from a shipping-date label.

## OTC Public Data

OTC is a headless Next storefront, not a conventional Shopify `/products.json`
shop. Its official [production notes](https://note.com/otc_coffee/n/ncbbf797049e0)
explicitly describe importing green beans, roasting and making capsules. That
primary statement supports its roaster classification separately from capsule
manufacturing alone.

The full public shop has 19 cards: eight named OTC house-capsule products, one
coffee machine and ten other-brand/unreviewed products. Discovery retains all
eight house products and logs the eleven others separately; it does not claim
complete merchant inventory or reassign imported brands to this roaster.

The reader parses literal JSON records from published Next data, never executes
merchant JavaScript or resolves/invokes server functions. Canonical URL,
rendered title, native route, observed variant ID, JPY schema/native/control
prices, primary photo and current purchase control must agree. Source coffee
details are retained. No subscription discount, SKU combination or weight is
invented. These are product-only offers with incomplete native SKU coverage.

Live inspection verifies six offers and reports two errors: the 10- and
30-capsule DECAF pages declare `OutOfStock` but show enabled one-time purchase
controls. An independent rendered-browser check confirms the 10-capsule
contradiction. Both remain held rather than published in either stock state.
The CLI intentionally exits nonzero with all eight products accounted for;
these are not reported as a wholly successful merchant ingest. No cart action
was taken. The projected fixtures omit merchant descriptive prose and unrelated
Flight records while preserving the observed identities and evidence fields.

## Regolith And Toyosaki

| Merchant | Coffee products | Exact native variants | Observed currency |
| --- | ---: | ---: | --- |
| Regolith Coffee | 27 | 111 | JPY |
| Toyosaki Coffee Factory | 22 | 22 | JPY |

Both pass live GET-only inspection with exact native identities, paired JPY
prices, explicit current stock and primary product photos. These 49 products
have not been ingested into production.

Regolith's public catalog exhausts after two populated pages (50 and 44
products) and an empty third page. The reviewed scope retains 21 one-time bean
products and six individually reviewed drip-bag handles. Thirty-four
subscription-related bean products, equipment, mixed cold-brew kits and
unreviewed gift products remain excluded. The 100g bag title applies only
while the native options retain their reviewed Japanese grind contract.
The six drip-bag offers retain unknown total net mass; their shipping grams
are not used as coffee weight.

Toyosaki's initial shop data contains only 20 of 22 products. Its own public
`/shop?page=2` link exposes all 22, with the same total and stable UUIDs.
The profile requires that complete category and an explicit reviewed product-ID
scope. Future unreviewed IDs are logged separately, not automatically treated
as coffee. Each product exposes one exact native SKU; grind, wrapping and
choose-your-coffee customizations do not create synthetic SKU combinations.
Net coffee weight comes only from the primary Japanese contents label, not
shipping fields or old URL slugs. For example, two legacy 200g slugs now have
150g published contents; the 15- and 50-drip-bag assortments explicitly declare
130g and 434g totals. Missing or ambiguous contents evidence fails closed.

Captured projected fixtures preserve these contracts without retaining the
merchant's descriptive prose. Tests cover owner scoping, real pagination,
subscription/equipment exclusion, native identities, money, stock, net contents,
customization handling and the already-working Wix path.

## CRU And Essentia

| Merchant | Coffee products | Exact native variants | Observed currency |
| --- | ---: | ---: | --- |
| CRU Coffee Hakuraku | 11 | 11 | JPY |
| Essentia Factory | 84 | 885 | KRW |

Both pass actual GET-only inspection. CRU uses the existing Square reader with
its exact site, owner and coffee category. The primary SKU price is retained
even when the product's aggregate minimum is lower: HAMA ROAST's current native
SKU is JPY 2,000, not the aggregate JPY 1,500. The reviewed title-weight fallback
applies only to a single native SKU. The three-bag assortment declares a
360-400g range, so its exact weight remains unknown. Stale category counts and
historical references do not turn eleven current public products into 61.

Essentia's bean category spans six pages, despite a five-number paging window.
Its opt-in next-control verification follows page six and rejects missing,
contradictory, foreign or wrong-category paging controls. The 85 category
listings include one business-consultation product, which is excluded. Green
beans, equipment and other categories are not traversed.

The separate opt-in Cafe24 reader parses native JSON as data, never executing
merchant scripts. It binds primary product ID, native product-code context,
rendered name, paired KRW price, primary photo and purchase controls. Every
native SKU must agree with the published option choices, absolute amount and
base-price delta. Separate size/grind selectors, combined selectors keyed by
native SKU, fixed single items and two real 180-SKU bundles are covered without
inventing combinations. Missing or duplicate matrix entries fail closed.

All 885 SKU weights are retained from reviewed size/content evidence, including
400g/1,000g two-bag packs and explicitly counted coffee assortments. Shipping
mass is not substituted. Twenty-three products are sold out. Untracked zero
or missing quantities remain distinct from tracked stock; missing tracked
quantity and contradictory stock controls are errors, not assumed availability.
Primary description images are preserved for later semantic extraction, but
this inspection makes no model or image-analysis calls. Within one reader,
short-lived category proof is shared; each product's native price/stock remains
fresh. Existing Cafe24 single-item behavior remains unchanged.

Captured projected fixtures cover eleven representative Essentia products and
all six paging states, plus CRU's public catalog/SKU evidence. CLI regression
coverage also checks that the existing Squarespace fetch callback is preserved.
The real inspections made 102 Essentia and 35 CRU GET requests, with zero
prohibited requests, model calls or production writes.

## Zuku And Nakaji

| Merchant | Coffee products | Native SKU coverage | Observed currency |
| --- | ---: | --- | --- |
| Zuku Cafe | 19 | 102 exact native variants | JPY |
| Coffee Roastery Nakaji | 22 | Product-only base offers; selectable SKU identities incomplete | JPY |

Zuku's complete public Wix shop contains 23 products. The reviewed coffee
scope excludes stickers, a cup, a tote bag and a mixed equipment starter kit.
Japanese size labels retain 100g/200g native options. Explicit contents prove
the 165g cold-brew pack and 200g four-coffee assortment. Thirty-three drip-pack
variants/offers have no proven gram amount; pack counts and shipping fields
are not turned into invented coffee weights. One coffee product is sold out.
One-time prices are retained, not the cheaper subscription prices. When plans
exist, the opt-in profile requires the native one-time purchase option too.

The same copied Wix product UUID occurs at Zuku and Toyosaki, with different
coffee names and stores. Exact owner/profile checks and entity-scoped catalog
source keys keep them separate; tests explicitly cover that collision.

Nakaji's [official shop biography](https://shop.coffee-nakaji.com/about)
identifies its own roasting and links its main site. The index still retains
the previously failing `https://coffee-nakaji.com/`; the exact-owner profile
uses `https://shop.coffee-nakaji.com/` as its verified retail fallback. A real
indexed-URL smoke test discovers 22 products and reads the first primary offer
without requesting or modifying that stored main-domain URL.

Its older BASE theme does not expose the newer JSON-LD/form structure. The
opt-in classic reader binds canonical URL, native product/shop form IDs,
rendered coffee name, paired JPY metadata, same-product published price data
and the primary enabled/disabled purchase control. Duplicate identical
metadata is allowed; conflicting amounts, foreign product IDs and mismatched
stock controls fail closed. Tracking scripts and forms are never executed.
The optional product choices are not fabricated into native SKU rows. Known
title net weights remain on the base-offer metadata. One offer is sold out.

Only the 22 reviewed bean/powder listings are admitted. Workshops, green beans,
merchandise and unreviewed IDs are excluded. The separately inspected drip-bag
category currently showed no product cards. Hidden categories/options are not
claimed complete, and omission reconciliation stays off. The CLI reports
`partial_support_verified: true`, not a fully complete merchant inventory.
The newer BASE path remains unchanged. Both source runs use zero model calls
and production writes; the fresh source readback confirms the index URL stayed
unchanged and all 21 added owners still have zero products.

## Reshock Native Data

Reshock is not yet supported or counted as an extraction pass. Its public
Shopline product page does publish a native `app.value('product', JSON.parse(...))`
object containing real variation keys, option IDs, prices and stock flags.
The captured sample has two native size variants. The bean category has two
pages and includes a custom-order listing that is not ordinary retail coffee.

`naver-20261025/reshock-source-discovery.json` records the concrete next adapter
inputs without storing merchant/customer configuration or executing scripts.
Important checks include merchant/URL binding, complete coffee-category
enumeration, membership versus one-time prices, timed sales, Chinese size
labels and native currency scale. The sample's TWD `dollars` and `cents` values
match; blindly dividing by 100 would be wrong. Zero quantity with explicit
unlimited inventory is not proof of sold-out stock. No Shopline support is
claimed from these observations alone.

## Remaining Gates

All new public inspections used zero model calls and zero catalog writes.
Expanded production readback confirms 21 net additions and zero coffee products.
Actual ingestion remains unproved after the earlier API-credit failure.
Distinct same-weight Shopify SKUs also need the separately authorized schema
change. Naver's specific security-check confirmation is still pending.

Reshock is Shopline: its `/products.json` returns HTML, so it is not registered
as Shopify. Total source-verified extraction is now 307 products across fourteen
sites, with 1,544 exact native variants plus 76 product-only offers. The fresh
10:21:12 UTC catalog readback still finds zero products across the 21 owners.
The full regression suite passes 600 tests; none of those tests proves a
completed production crawl.

The completed Mac validation session is now archived. Discovery session
`01a1721c-8db9-77e0-b390-33b080a8a0dd` is still waiting for its access approval;
it is not terminal and has not been restarted or archived as if finished.
Its remaining graph frontier remains part of the open user goal.
