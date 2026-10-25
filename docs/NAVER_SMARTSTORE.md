# Naver Smartstore investigation

Status: implementation prepared, live product ingestion remains blocked. This is
not a verified Naver rollout and has not been installed on the Mac mini.

## Verified identities

Brewing Ceremony's current Instagram bio links
`https://m.smartstore.naver.com/brewingceremony`. The desktop alias is
`https://smartstore.naver.com/brewingceremony`.
The [roaster's Korea Coffee Week profile](https://www.koreacoffeeweek.com/104)
describes its own roasting. Its
[green coffee supplier](https://coffeemeup.kr/2314) links the same store.
Catalog entity `499e57b1-2c67-5b34-928f-9b7de559f87d` and its roaster role were
created and read back on October 25, 2026.

New Wave's working [official homepage](https://newwavecoffeeroasters.com/) links
`https://smartstore.naver.com/newwavecoffeeroasters` as its retail shop. Its exact
entity `a3ed7572-b082-4ac1-ab88-c7d9826654f6` has a separate reviewed profile.
Store identity includes the first URL path segment: Naver's shared hostname is
not sufficient for deduplication or product ownership.

## Measured Benchmark

| Target / check | Before | Current result | Coffee products ingested |
| --- | --- | --- | ---: |
| Brewing Ceremony, desktop HTTP | 429 error page | 429; classified `naver_rate_limited` | 0 |
| Brewing Ceremony, mobile HTTP | 429 error page | Same access limitation | 0 |
| Brewing Ceremony, anonymous in-app browser | Not checked | Redirects to Naver sign-in, including category/ALL | 0 |
| Brewing Ceremony, user's Safari context | Not checked | Security verification/CAPTCHA; not completed | 0 |
| Brewing Ceremony, Mac mini public HTTP | Not checked | Desktop and mobile each 429; no product state | 0 |
| Brewing Ceremony, exact registered crawler | Not indexed | Failed run `d86b317f-0855-4828-8275-8afce2dc423b`, HTTP 429 | 0 |
| New Wave homepage | Not checked | HTTP 200, Imweb homepage linking Naver shop | 0 |
| Single Origin's old domain | Not checked | DNS failure; official current Shopee link verified in Safari and catalog corrected | 0 |

Nominal measured gain in Naver sites successfully ingested: **0**. Nominal
measured gain in coffees: **0**. Catalog additions are a separate outcome and do
not prove successful scraping. Discovery continues in the companion Instagram
session; its journal and the database are authoritative for the latest additions.

Raw local receipts (ignored runtime data) are under `.state/naver/`:
`brewing-ceremony-index.json`, `brewing-ceremony-live.json`,
`brewing-ceremony-crawl.json`, and `added-roaster-readback.json`.

## Implemented Path

1. Match exact reviewed entity IDs plus the correct store path or a reviewed
   official homepage alias. Other sites retain their existing crawler path.
2. Use the existing bounded merchant reader, constrained to the store's own
   public pages. Naver access errors stop without repeated host/proxy attempts.
3. Discover same-store product URLs from public main-content links or JSON-LD
   ItemList data. Follow explicit next-page links with bounded pagination.
4. Verify a product's canonical page and exact primary JSON-LD Product/Offer.
   Preserve paired KRW price, explicit stock, description, photo and declared
   attributes. Reject another store's products, aggregate/range prices,
   ambiguous offers and unverified roasted-coffee identity.
5. A public base offer does not establish Naver option/SKU identities. Save
   product-level offer evidence through the existing product-only contract;
   retain incomplete-variant flags and do not fabricate weight/variant rows.
6. Public links do not prove complete merchant inventory. Record a partial
   scope and forbid omission reconciliation. Login, 403 and 429 responses are
   failures, never empty catalogs or removed products.

These parsers currently have standards-based **synthetic fixtures**, not a
captured successful Naver product page. Live compatibility and product/options
coverage remain unproved. Do not describe passing tests as a successful crawl.

## Access Route Still Needed

Try the normal Safari public storefront separately from the in-app browser,
and repeat the small public GET probe from the Mac mini. A working public page
should supply a real listing and product fixture before this draft is promoted.
If only rendered pages expose product data, add a bounded public browser reader
and inspect the actual hydrated state before implementing native option mapping.
Do not invent private endpoints from old scraper examples.

The old Shopping Search API is not an available fallback: Naver's
[official notice](https://developers.naver.com/notice/) states its shopping
search service ended July 31, 2026. The
[Commerce API](https://github.com/commerce-api-naver/commerce-api) is a seller
integration, not anonymous access to every merchant's catalog. No seller
credentials are available in this task. If the public route remains gated,
merchant-provided catalog feeds or an authorized API integration are additional
routes to evaluate; neither has been obtained or claimed working here.

## Verification And Commands

The full installed-source suite plus Naver tests passed: **539 tests, 0 failures**
using bundled Node 24.19.0. The system Node 23.7.0 intermittently hung while
draining V8 background tasks after tests; those test workers were sampled and
stopped, and the suite rerun with the bundled runtime. No production process was
affected. Existing merchant, catalog, price/stock, partial-scope and saver tests
are included in the suite.

```sh
node src/siteSupport/cli.js 'Brewing Ceremony' .state/naver/live.json
node --env-file=/path/to/catalog.env scripts/add-brewing-ceremony.cjs
node --env-file=/path/to/catalog.env scripts/add-brewing-ceremony.cjs --apply
node --env-file=/path/to/catalog.env scripts/crawl-brewing-ceremony.cjs
npm test
```

The index helper previews by default. The crawl command writes an actual crawl
attempt and, when access permits, uses the standard product pipeline. It is not
a dry run. The live attempt above failed before any product or AI work.

Next acceptance gates: obtain a successful live listing/product response, verify
native product/option identity and prices from it, rerun the benchmark, validate
all newly added storefronts, and deploy only tested source to the actual managed
Mac mini checkout. The goal remains open until those results and the Instagram
discovery frontier are verified.

## Current Mac Mini Audit

A separate read-only remote session inspected the real machine on October 25
at 03:07 Eastern. Source was clean at
`85cc2d8f191a9adb627dd908bdb94d34aa4be23c`, branch `codex/issue-1-crawler`.
The loaded LaunchAgent interval was 3600 seconds; no crawler/lock PID was active
at the check. The latest batch ran 01:33:55.877-02:33:26.030 Eastern, ending at
its batch budget. Recent logged starts were about 1h59m30s apart despite the
hourly setting. This discrepancy is observed and has not been repaired here.

The latest batch had 62 merchant starts across 59 distinct merchants, 1323 save
events and two fully completed merchants (Bonanza, 5 coffees; Radio, 16). Save
events are not new distinct products. There were 619 page-error events including
391 variant-weight uniqueness errors, 63 ambiguous legacy identities and 24
duplicate variant identities, plus translation errors and HTTP 402 proxy
failures. Deferred budget entries overlap the failure summary; they are not
additional attempted merchants. These are existing production problems, separate
from whether the Naver adapter can fetch a page. No production source/schema,
schedule or running service was changed by this investigation.

## Discovery Checkpoint

Two Safari discovery sessions followed the verified Asian-roaster graph and
saved evidence and a remaining frontier in
`/Users/allan/Documents/workspace/everycoffee/tmp/asian-roasters-instagram/2026-10-25-brewing-ceremony.md`.
Completed discovery/audit sessions were archived. The original goal remains
active; the graph is not exhausted.

Independent parent reconciliation checked the new records against 9183 indexed
roasters plus targeted all-entity domain reads. It undid our Amsterdam Re-Co
insert and our duplicate GLITCH insert after verifying 13 dependent references
were empty, preserving the original Glitch entity and all preexisting data.
The Korean New Wave and similarly named US New Wave are distinct businesses.
Hosted-platform identities use the exact merchant hostname/path, not a shared
platform domain.

KIELO COFFEE and X coffee are published sister brands. Their two official native
collections expose 17 products each with no overlapping product IDs. Their new
catalog rows are scoped to those separate collection URLs; brand-specific crawl
registration and complete save validation remain to be done. The current
homepage-only audit records reachability and candidate links, not successful
product ingestion. Single Origin's obsolete domain was replaced with its
verified official Shopee link. Coffee Roastery Nakaji still needs an accessible
current destination: the direct check returned a DNS error despite Safari
previously displaying its site.

## Follow-up: Reachable Shopify Merchants

KIELO and X coffee now have exact-owner, separate native collection profiles.
Unicode handles are enabled only for these reviewed profiles. The native live
inspection passes for 15 KIELO coffees / 121 variants and 17 X coffee coffees /
147 variants. All prices are paired with the actual observed USD market;
stock is explicit, and product IDs do not overlap. Four bundle/drip-pack weights
remain unknown. Japanese subscriptions are explicitly excluded from the
one-time coffee scope. No product was saved to production by those inspections.

The expanded full suite passes **542 tests**. The current production weight
index was independently inspected through Safari and still rejects distinct
same-weight SKUs. See [the reviewable save-gate plan](naver-20261025/VARIANT_SAVE_GATE.md)
for the exact preflight, already tested migration, preservation guarantees and
required approval before applying this global schema change.
