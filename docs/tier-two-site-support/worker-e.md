# Tier-two worker E

Worktree: `coffee-roaster-crawler-tier-two-e`, branch `codex/tier-two-roasters-e`, base `4eb4482`. All source, fixtures and evidence changes are confined to this worktree. `src/crawler.js` and `src/roasters.js` are unchanged. No production database writes, migrations, installs, scheduler changes, deployment or orders occurred.

## Verified public inventory

| Merchant | Coffee products | Coffee variants | Market | Registration limit |
| --- | ---: | ---: | --- | --- |
| Apiary | 6 | 6 | USD | No verified database entity ID |
| Colorfull | 14 | 27 | USD | Existing entity has no roaster role |
| Klatch | 43 | 475 | USD | Merchant root versus cafe candidates require identity review |
| Onyx | 42 | 176 | USD | Audited roaster ID registered |
| Passport | 255 | 529 | AUD | Brisbane merchant verified; database identity unresolved |
| Pilgrim | 7 | 16 | USD | Audited roaster ID registered |
| Square Mile | 11 | 23 | GBP | Audited roaster ID registered |

The seven `*-live.json` reports contain **378 coffee products**, **1,252 exact merchant variants**, **1,174 guarded HTTPS GET request records**, zero production writes, zero AI calls, and zero prohibited requests. They include **222 fully sold-out coffees** and **465 sold-out variants**. Every included variant has an exact identity and paired currency/amount. Two Onyx products (four variants) explicitly declare preorder and have **unknown immediate stock**; all other included variants have known stock. Every included product has a description and image. Discovery requires an explicit empty final Shopify page and never filters by stock.

The recorded market is the public request context, established by exact variant offers or agreeing same-script product/variant analytics tuples. Colorfull's public request context is USD; CAD is not inferred from its Canadian location. No currency conversion is performed. Shipping mass never becomes net coffee weight. Ambiguous/plain multipacks remain unset. A label such as `200gm (10x20gm vac seal pouch)` provides an explicit total, accepted only when its quantity and component weight agree.

Apiary's single-variant descriptions explicitly declare 100g or 250g of whole-bean coffee. One coffee has no net declaration and remains unknown. Default variants at Colorfull and Pilgrim similarly retain unknown net weight instead of their shipping masses.

Passport's full published `Coffee`/`Blend` catalog includes 217 sold-out products. Its $3 `Vac Sealed Pouch Option (per pouch)` accessory is excluded from coffee market/availability evidence. Filtered variants do not authorize retirement of unobserved existing variants. The native `Coffee` type also mislabels a gift voucher: a regression excludes financial gifts. After encountering it during inspection, fresh discovery with the corrected title rule exactly matched all 255 remaining inspected coffee URLs. The report preserves that explicit revalidation and excluded product evidence. Its five declared total/pouch weights were reprocessed from captured exact variant labels after adding the guarded weight rule.

Onyx covers its coffee, instant, coffee-only box sets and Cometeer collections, plus the independently advertised 2026 Advent product. A mixed coffee/MiiR gear box is excluded by exact merchant product ID. The old coffee archive and subscriptions are outside current retail listing discovery. Pilgrim's differently named Rosado product declares schema category `Wine`, and Square Mile's zero-price samples explicitly require another purchase at checkout; these are not ordinary retail coffee offers.

The coordinator confirmed the established brewing-coffee scope: whole-bean/ground, instant, drip bags, coffee-only sets and Cometeer. Onyx's mixed tea/coffee Cafe Expressions group and Passport's pickup-only bottled/canned cold-brew products are ready-to-drink exclusions, consistent with the reviewed Hatch beverage exclusions. `worker-e-exclusions.json` records exact public merchant product/variant IDs and primary definitions for this boundary.

Onyx Advent's Ajax `available=true` proves sellability, while its primary `Pre-Order Now` control overrides immediate stock to unknown. The reviewed rule requires its exact URL/canonical, product ID `7773746823266`, primary hero button, and add-to-cart variant binding `43221087649890`. Its exact $189 USD price and variant identity remain intact. Monarch carries the same site-wide Advent banner and remains unaffected. Ecuador Jose Jijon separately has an exact native `Preorder` tag, which also makes its three variants unknown immediate stock. Shipping-date tags/text alone do not establish preorder. The other six assigned merchants' complete public listing surfaces have no explicit preorder tags. Captured control/tag fixtures, primary evidence and the fresh 42-product Onyx dry run document this correction.

## Evidence-backed blockers

- **Apiary:** official Apiary Coffee Co. merchant and all six coffees verified. The reviewed audit and coordinator's broader catalog search did not establish an existing entity. Profile inspection works without creating or guessing an ID; normal registration still requires an exact database ID.
- **Colorfull:** official merchant name and exact domain match existing `f4635ada-5e28-4376-9b38-a1256113d34d`. The coordinator's fresh read-only search found no `entity_roles`. Its prepared profile uses that real ID, but the parent must review roaster classification before normal selection. No duplicate entity or role was written.
- **Klatch:** the root candidate `7d74081f-e742-4158-ada6-c67dcd7430f9` is recommended for review. The other candidate's Rancho Cucamonga page redirects to a cafe ordering host. Neither candidate was automatically assigned or merged.
- **Obscure Coffee Roasters:** its exact public Square owner/site namespace returns only two Coffee Discovery Subscription products. Single Origin, Blends and Collabs categories each explicitly report `total=0`. This is a concrete absence of one-time public retail inventory, not permission for absent-product reconciliation. No successful-empty adapter was registered.
- **Onyx Tonics:** existing `9106cd47-0112-4ee6-834b-fac38fe97374` is cafe-only with no website, according to the coordinator's fresh read-only search. Its official Burlington site identifies a bar serving a rotation from other roasters, and exposes no identifiable priced coffee catalog. It must not be substituted with Onyx Coffee Lab or assigned other roasters' products.
- **Passport:** pinned tier-source CSV rows S19 and S30 locate the intended roaster in Australia/Brisbane. Its official site confirms Passport Specialty Coffee, Northgate. Arizona's Passport Coffee & Tea is a different business. No audited existing database ID is proven for the Brisbane merchant.

## Validation and integration

`node --test test/*.test.js src/*.test.cjs` passed **237/237**, with no skips or failures, using Node 22.19.0 and the disposable embedded Postgres fixture. Seven new regression tests cover captured exact Apiary data and descriptions, Passport accessory/stock/net-weight behavior, separately featured product discovery, gift exclusion, strict coffee types, merchant inspection without invented database ownership, and product-scoped preorder evidence. The preorder tests verify both extraction and persistence payloads keep stock unknown without changing the price, product ID or existing slug; unrelated banners and shipping dates are ignored, and ambiguous/mismatched primary bindings fail closed. The validation JSON also confirms all unassigned tier-two queue rows are unchanged.

Parent integration should combine profile additions and the small `shopifyProduct.js`, `shopifyDiscovery.js`, CLI and discovery edits with the parallel workers' changes. There are no absolute external runtime imports. The stricter CLI requires complete discovery, exact product/variant IDs and a paired price for every variant. The new profile-level inspection helper allows unresolved merchant evidence while `profileFor` retains exact-ID registration. Missing role/identity and merchant inventory blockers remain explicit rollout-gate decisions for the coordinator. No production activation is authorized within this worker.
