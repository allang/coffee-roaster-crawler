# Verified Asian Roaster Additions

Database readback: 2026-10-25T10:21:12.333Z. Net new entries: 21.
These are index additions, not a claim that coffee ingestion succeeded.

| Roaster | Official URL | Crawl evidence |
| --- | --- | --- |
| Zuku Cafe | https://zukucafe.com/ | GET-only Wix extraction: 19 one-time coffees, 102 native JPY variants; four merchandise/mixed-equipment listings excluded; no product saves |
| Ariowl Coffee | https://ariowlcoffee.com/ | GET-only native extraction: 23 coffees, 84 variants, JPY; no product saves |
| 珈琲アウラ | https://auracoffee.stores.jp/ | HTTP 403 |
| Single Origin espresso & roast | https://shopee.tw/single_origin_espresso_roast | HTTP 200; Shopee; 0 candidate product links |
| CRU Coffee Hakuraku | https://crucoffee.square.site/ | GET-only Square extraction: 11 coffees, 11 native variants, JPY; no product saves |
| 5F Coffee Lab | https://www.ehirix.com/ | HTTP 200; custom site; 0 candidate product links |
| COFFEE ROASTERY 101 | https://shop.roastery101.com/ | GET-only native extraction: 13 coffees, 61 variants, JPY; no product saves |
| Brewing Ceremony | https://smartstore.naver.com/brewingceremony | HTTP 429 |
| HOKURO ROASTERY | https://hokurocoffe.base.shop/ | BASE dry run: 15 one-time coffee base offers, two subscriptions excluded; one sold out |
| Reshock Coffee | https://www.reshockcoffee.com/ | Native Shopline product/variation data found in public HTML; adapter not implemented or counted as a pass |
| KIELO COFFEE | https://kielocoffee.jp/collections/kielo-coffee | GET-only extraction: 15 one-time coffees, 121 native variants, USD; save validation pending |
| Kingkongdrip Roastery | https://smartstore.naver.com/kingkongdrip | HTTP 429 |
| Specialty Coffee 蒼 | https://lit.link/sohcoffee | Official hub leads to sohcoffee.thebase.in; BASE dry run: 23 one-time coffee base offers |
| New Wave Coffee Roasters | https://newwavecoffeeroasters.com/ | HTTP 200; Imweb, Naver; 0 candidate product links |
| OTC COFFEE | https://otc-coffee.com/ | Next public data: six house-coffee offers verified, both DECAF sizes held on stock conflict; overall inspection fails explicitly |
| Nano's Coffee | https://nanoroaster.handcrafted.jp/ | BASE coffee-bean category dry run: 10 coffee base offers; stale homepage slideshow links avoided |
| Coffee Roastery Nakaji | https://coffee-nakaji.com/ | Classic BASE shop fallback extracts 22 product-only JPY offers; original indexed URL unchanged; SKU/hidden-inventory coverage incomplete; no product saves |
| Essentia Factory | https://essentiafactory.com/ | GET-only Cafe24 extraction: 84 coffees, 885 native variants, KRW; 23 products sold out; no product saves |
| X coffee GINZA | https://kielocoffee.jp/collections/about-us-collection | GET-only extraction: 17 coffees, 147 native variants, USD; save validation pending |
| Toyosaki Coffee Factory | https://www.toyosakicoffeefactory.com/shop | GET-only Wix extraction: 22 coffees, 22 native variants, JPY; no product saves |
| Regolith Coffee | https://regolith-coffee.com/ | GET-only Shopify extraction: 27 coffees, 111 native variants, JPY; no product saves |

Naver benchmark: 0 successfully ingested sites and 0 coffees so far.
See ../NAVER_SMARTSTORE.md for access failures, runtime audit, draft implementation and remaining gates.

Merchant-only extraction now verifies 307 products across fourteen of these additions:
231 Shopify/Wix/Square/Cafe24 coffees with 1,544 native variants, plus 70 BASE and
six OTC product-only offers whose SKU sets remain incomplete. OTC's other two
house products remain errors, so this is not fourteen fully successful ingests.
These are dry-run counts,
not production ingestion gains. See ../ASIAN_BASE_STOREFRONTS.md and each
merchant's committed extraction JSON for the exact measured scope.

The subsequent isolated Mac mini BASE attempt saved zero products because the
configured OpenAI account has no API credits. All three runs failed before
catalog persistence. See [the actual before/after benchmark](BENCHMARK.md);
the dry-run extraction totals above must not be counted as coffees ingested.
