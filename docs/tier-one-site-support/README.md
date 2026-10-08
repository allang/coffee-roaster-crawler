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

The regression suite passed 224 checks after the first ten integrations. New checks cover live-captured hydration, pagination/repeated cursors, exact identity/price/stock, prohibited paths, legacy product adoption, idempotent local persistence and retail-only Shopify collections. Catalog transactions are tested only in the disposable local fixture database, using reviewed migrations. Full hosted schema parity and live scheduler state remain unverified.

This is preparation and live-site dry-run verification. Production deployment and imports remain outside the authorization in this chat. The queue remains open until every site is supported and verified, or an explicit merchant/identity blocker has been documented with authoritative evidence.

Verified live dry runs so far: April **21**, Black & White **20**, Botz **1 (sold out)**, Coffee Collective **21**, Coffee Project NY **24** coffee products. Ten of 41 names are implemented/verified; the remaining 31 stay in the open queue.

Flower Child: **7** public coffee products verified; one obsolete listing is a primary soft 404. A fresh unavailable page overrides cached native stock and updates only an already identified product's availability, keeping its ID/slug/content and previous sighting timestamp. Exact-variant analytics metadata can establish currency only when one same-script product/variant tuple agrees with the native decimal price; general shop currency is insufficient.

Fritz Coffee Company: **29** coffee products verified with KRW offers, including single products and ProductGroup variants. Query/canonical paths resolve to the same product number; unrelated offers are rejected. A paper shopping bag is excluded. Native grouped source does not authorize retirement of variants omitted from the published schema.

Frukt: **14** coffee products verified, including explicit sold-out variants. Goût & Co: **55** coffee products verified across its current coffee collections. Registered Shopify adapters prefer explicit net-weight labels over shipping mass; ambiguous/multipack labels remain unset.

H&S: **21** coffee products verified, with compatible metric/imperial size labels parsed as net coffee weight. All earlier registered Shopify live inspections were rerun after the size-label correction and passed.
