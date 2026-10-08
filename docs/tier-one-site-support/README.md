# Tier-one crawler site support

Scope: the 35 verified tier-one coverage gaps and six unresolved names from the October 7, 2026 catalog audit. `queue.json` retains all 41 names. Work proceeds one merchant at a time; unresolved identities are not merged or created.

The isolated review branch is based on the current `codex/issue-1-crawler` source (`ed84444`), including existing refresh, native market, processing and catalog transaction fixes. The older local main checkout is preserved with its unrelated dirty files. The Mac mini SSH endpoint refused connection during this task; no production install, migration, restart, write, worker activation or order has occurred.

## Implementation and evidence

- April: migrated to a Next.js storefront with `/product/` URLs. Read primary product hydration as JSON without executing scripts, follow the public collection cursor API to the explicit final page, reject gear/gifts, and preserve old `/products/` identities during adoption. The exact requested handle, variant IDs, currency, amount and stock are scoped to one primary product. Duplicate primary objects fail closed. Public pagination does not depend on a Shopify catalog endpoint that now returns 404.
- Black & White: refresh current retail coffee and instant collections, excluding wholesale/gifts and stopping only after an empty final collection page. Existing native product/variant extraction pairs each priced offer with its exact variant ID and uses Ajax for stock.
- Coffee Collective: use the current filter and espresso collections with explicit native product type `new`; live exact-variant offers establish current DKK prices independently of the lower untaxed numeric catalog payload.
- Coffee Project NY: Square initially serves no anchors or product data. Fetch its public storefront catalog and exact SKU endpoints scoped to the merchant/site IDs in the page bootstrap. Paginate products/SKUs using explicit counts, associate each variant with its parent item, and read shipping/sellability independently from zero untracked inventory. The same adapter feeds the normal extraction and stock/persistence pipeline.
- Botz: the public coffee collection currently contains one coffee and a gift card. The coffee is explicitly sold out. Support must preserve that result rather than synthesize in-stock inventory.

Each live `*-live.json` artifact records product URLs, exact market fields, listing pages, request results and limitations. The independent merchant-only CLI has no database or AI client. The production crawler uses the same registered discovery and source parsers, and revisits existing coffees through the existing persistence path. Registered merchants use bounded, paced, GET-only reads with verified hosts and guarded redirects. Failed/incomplete discovery cannot be reported as a successful empty inventory.

```sh
node src/siteSupport/cli.js April /tmp/april-inspection.json
node src/siteSupport/cli.js 'Black & White' /tmp/black-white-inspection.json
node src/siteSupport/cli.js Botz /tmp/botz-inspection.json
npm test
```

The regression suite passed 230 checks after the first eleven integrations and guarded crawl integration. New checks cover live-captured hydration, pagination/repeated cursors, exact identity/price/stock, prohibited paths, legacy product adoption, idempotent local persistence and retail-only Shopify collections. Catalog transactions are tested only in the disposable local fixture database, using reviewed migrations. A read-only production schema check confirms the base catalog fields and v1 save/availability functions exist. The four typed processing fields and `save_catalog_product_v2` are absent; the processing migration must be validated against a staging copy and installed before this source can run. The connected Supabase account cannot access this production project. Live scheduler state remains unverified.

The user has authorized merging the completed changes and updating the current crawler after the site work is complete. Until that gate, validation remains merchant-only dry runs and disposable local database tests. Before installation, verify the running checkout, hosted schema compatibility and scheduler, preserve local work, and retain a rollback path. Completion requires fresh runtime and catalog readback evidence. The queue remains open until every site is supported and verified, or an explicit merchant/identity blocker has been documented with authoritative evidence.

Verified live dry runs so far: April **21**, Black & White **20**, Botz **1 (sold out)**, Coffee Collective **21**, Coffee Project NY **24** coffee products. Eleven of 41 names are implemented/verified; the remaining 30 are assigned to three parallel review sessions.

Flower Child: **7** public coffee products verified; one obsolete listing is a primary soft 404. A fresh unavailable page overrides cached native stock and updates only an already identified product's availability, keeping its ID/slug/content and previous sighting timestamp. Exact-variant analytics metadata can establish currency only when one same-script product/variant tuple agrees with the native decimal price; general shop currency is insufficient.

Fritz Coffee Company: **29** coffee products verified with KRW offers, including single products and ProductGroup variants. Query/canonical paths resolve to the same product number; unrelated offers are rejected. A paper shopping bag is excluded. Native grouped source does not authorize retirement of variants omitted from the published schema.

Frukt: **14** coffee products verified, including explicit sold-out variants. Goût & Co: **55** coffee products verified across its current coffee collections. Registered Shopify adapters prefer explicit net-weight labels over shipping mass; ambiguous/multipack labels remain unset.

H&S: **21** coffee products verified, with compatible metric/imperial size labels parsed as net coffee weight. All earlier registered Shopify live inspections were rerun after the size-label correction and passed.

Hatch: **29** coffee products verified across five current coffee categories on its new Subbly storefront. Native product/variant identities and flat prices are bound to the primary title/display and a checked merchant formatter contract (CAD, integer cents). Explicit stock counts follow the reviewed storefront behavior, including null for untracked inventory; missing/invalid counts remain unknown. Subscriptions, membership and gift cards are excluded. New formatter versions fail closed for review.

Registered merchants use only their reviewed discovery surface: generic sitemap/BFS reads are skipped. A completed registered inventory can reconcile without a sitemap, and omitted products are checked through the same guarded page/extraction reader. Current primary soft 404s override cached catalog JSON during those checks. Partial/empty discovery and page errors prevent reconciliation.
