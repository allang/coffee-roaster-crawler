# Tier two roaster support and verification

Nine assigned roasters have reviewed merchant adapters and complete public coffee inventory reads. The normal runtime uses guarded GET requests. The tenth roaster, .txt, remains blocked because its public storefronts do not prove a complete inventory with exact variant identities.

| Roaster | Coffee products | Native variants | Evidence |
| --- | ---: | ---: | --- |
| Ceremony | 18 | 66 | ceremony-live.json |
| Color | 29 | 620 | color-live.json |
| Fathers | 42 | 107 | fathers-live.json |
| Koppi | 7 | 14 | koppi-live.json |
| La Cabra | 15 | 25 | la-cabra-live.json |
| Modcup | 16 | 39 | modcup-live.json |
| Mother Tongue | 9 | 108 | mother-tongue-live.json |
| PERC | 122 | 594 | perc-live.json |
| Three Marks | 15 | 78 | three-marks-live.json |

Shopify discovery exhausts every reviewed collection with an explicit empty final page, deduplicates URLs, and retains sold-out coffee. PERC includes its public archive; exact exclusions remove drinkware gift boxes and two Third Wave Water mineral products despite the merchant assigning them a Coffee type. Blank product types are accepted only in its curated coffee collections. Ceremony's two required subscription products are excluded by their exact merchant Subscription tag. Modcup's featured collection adds Carmen Montoya, and Three Marks' all collection adds capsules and drip bags outside its main coffee collection.

Fathers reads published JSON without executing scripts, binds all 42 rendered coffee cards to native UUIDs and variant selectors, and pairs every offer to its exact UUID plus variant ID. The selected primary market is Czechia, CZK, B2c, with tax. EUR schema offers must independently agree with the same variant's EUR market table before the paired CZK retail table is used. Net weight comes from explicit coffee labels; the 100g Ombligon packaging mass of 250g is ignored. A local database regression preserves an existing product ID and slug and retains three exact native variants after two repeated saves. Historical Fathers URLs need a separate verified alias mapping before production adoption; this change does not infer aliases.

Koppi's explicit trailing title weight applies only to proved grind choices. A single-variant description weight requires an explicit net-weight label or a reviewed merchant prefix; Three Marks' El Alisal declares 125g despite a 250g shipping field. Case packs, mixed bundles, and undeclared sizes remain unknown. Three Marks' primary product metafields are scoped by canonical URL, heading, and native variant ID, preserving full farm and processing text while excluding recommendations.

.txt's official Korean Naver shop returns HTTP 429. The official English link and matching business registration prove merchant ownership, not inventory equivalence. Authorized read-only Imweb option POSTs returned seven English coffees, all sold out. Melting Blend exposes Type IDs, but dependent 150g, 400g, and 850g rows omit weight value IDs; the other six coffees likewise omit their selectable native value IDs. Labels and base prices cannot supply exact complete variant identities. Sanitized requests and rows are retained in txt-blocked-live.json; no .txt runtime profile or POST capability is registered, and no absent Korean product is treated as removed.

Validation covers captured merchant fixtures, market and identity mismatches, incomplete inventory, shipping versus net weight, primary description scoping, prohibited paths, and repeat-save behavior. All 243 tests pass. The fresh inventories contain 273 coffee products and 1,651 native variants, each with a paired price and currency and known stock. PERC’s Brazil Instant Packet has an empty native body and no scoped primary page description; that field remains unknown. Detailed results are recorded in validation-d.json. Every live report records zero production writes, zero AI calls, and zero prohibited requests. Central crawler/roaster integration remains with the coordinating change; neither src/crawler.js nor src/roasters.js was edited. Shared extraction and net-weight helpers may overlap the tier-one worker's edits and must retain both sets of supported cases when combined.

The October 8 [fresh `.txt` follow-up](txt-followup.md) confirms the same external blocker, with seven native product codes, nine closed public option reads and exact active-unit USD price pairing. Other storefront-unit prices are explicitly unused. Published native size/combination IDs and complete retail scope, or an authoritative merchant export, are required before a verified adapter can be registered. No runtime or production changes were made. The follow-up is integrated and its worker session archived.
