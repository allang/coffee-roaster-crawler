# Verified Asian Roaster Additions

Database readback: 2026-10-25T07:20:35.887Z. Net new entries: 19.
These are index additions, not a claim that coffee ingestion succeeded.

| Roaster | Official URL | Crawl evidence |
| --- | --- | --- |
| Zuku Cafe | https://zukucafe.com/ | HTTP 200; custom site; 0 candidate product links |
| Ariowl Coffee | https://ariowlcoffee.com/ | HTTP 200; Shopify; 11 candidate product links |
| 珈琲アウラ | https://auracoffee.stores.jp/ | HTTP 403 |
| Single Origin espresso & roast | https://shopee.tw/single_origin_espresso_roast | HTTP 200; Shopee; 0 candidate product links |
| CRU Coffee Hakuraku | https://crucoffee.square.site/ | HTTP 200; Square; 0 candidate product links |
| 5F Coffee Lab | https://www.ehirix.com/ | HTTP 200; custom site; 0 candidate product links |
| COFFEE ROASTERY 101 | https://shop.roastery101.com/ | HTTP 200; Shopify; 14 candidate product links |
| Brewing Ceremony | https://smartstore.naver.com/brewingceremony | HTTP 429 |
| HOKURO ROASTERY | https://hokurocoffe.base.shop/ | BASE dry run: 15 one-time coffee base offers, two subscriptions excluded; one sold out |
| Reshock Coffee | https://www.reshockcoffee.com/ | HTTP 200; Shopify; 13 candidate product links |
| KIELO COFFEE | https://kielocoffee.jp/collections/kielo-coffee | Shopify: 17 disjoint native collection products; save validation pending |
| Kingkongdrip Roastery | https://smartstore.naver.com/kingkongdrip | HTTP 429 |
| Specialty Coffee 蒼 | https://lit.link/sohcoffee | Official hub leads to sohcoffee.thebase.in; BASE dry run: 23 one-time coffee base offers |
| New Wave Coffee Roasters | https://newwavecoffeeroasters.com/ | HTTP 200; Imweb, Naver; 0 candidate product links |
| OTC COFFEE | https://otc-coffee.com/ | HTTP 200; Shopify; 4 candidate product links |
| Nano's Coffee | https://nanoroaster.handcrafted.jp/ | BASE coffee-bean category dry run: 10 coffee base offers; stale homepage slideshow links avoided |
| Coffee Roastery Nakaji | https://coffee-nakaji.com/ | getaddrinfo ENOTFOUND coffee-nakaji.com |
| Essentia Factory | https://essentiafactory.com/ | HTTP 200; Cafe24; 50 candidate product links |
| X coffee GINZA | https://kielocoffee.jp/collections/about-us-collection | Shopify: 17 disjoint native collection products; save validation pending |

Naver benchmark: 0 successfully ingested sites and 0 coffees so far.
See ../NAVER_SMARTSTORE.md for access failures, runtime audit, draft implementation and remaining gates.

Merchant-only extraction now verifies 80 products across five of these additions:
32 KIELO/X coffees with 268 native variants, plus 48 BASE product-only offers
whose size/grind SKU identities remain incomplete. These are dry-run counts,
not production ingestion gains. See ../ASIAN_BASE_STOREFRONTS.md and each
merchant's committed extraction JSON for the exact measured scope.
