# Tier-one duplicate roaster merges

The user requested confirmed duplicate roasters be merged under the simpler existing slug, with previous crawler and catalog fixes preserved. A current catalog audit of all 70 reviewed tier-one IDs also found the existing Push Pull inventory owner outside that ledger. Six reviewed pairs become 65 canonical tier-one roasters.

| Roaster | Retained slug | Retired duplicate slug |
| --- | --- | --- |
| Loveless | `loveless-coffees` | `nyccafelist-loveless-coffees-df6cea` |
| Dayglow | `dayglow-coffee` | `dayglow-osm-osm-node-7905428421` |
| Glitch | `glitch` | `glitch-coffee-and-roasters` |
| Little Wolf | `little-wolf` | `little-wolf-coffee-osm-osm-node-9584127038` |
| Moonwake | `moonwake-coffee-roasters` | `moonwake-coffee-roasters-osm-osm-node-13111844361` |
| Push X Pull | `push-pull` | `push-x-pull-osm-osm-node-6111277805` |

Official domain, existing source provenance and catalog location evidence confirm these identities. Push Pull and PUSH X PULL both identify the 821 SE Stark Street business in Portland. Cafe-only Dayglow branches and the separate Little Wolf cafe are outside this merge.

`data/tier-one-entity-merges.json` records the reviewed IDs. Loveless's Shopify adapter remains intact and is bound to the retained ID. Crawl ordering replaces retired IDs and retains all 65 source names, including Preface, in tier one.

The plan retains all 884 existing product IDs and their 1,688 variants, 884 coffee facts and 1,163 existing photo links. Prices, weights, variant stock, source URLs, processing evidence and descriptions are unchanged. It carries one existing photo asset to a canonical listing that lacked a link. The 261 overlapping source identities retain their records and linked history as inactive copies, with an explicit canonical product ID and `merged_duplicate` reason. Future product adoption ignores only these reviewed copies; other ambiguous source identities still fail for review.

Source IDs, role provenance, attributes, locations, crawl runs and numeric legacy URL mappings move to the retained owner. Duplicate cached page observations are retained in the newest classification's `_entity_merge_history`. Conflicting entity fields/attributes remain in a `merged_entity:<old UUID>` attribute containing the prior record. An internal `tier_one_entity_merge` source record retains each previous entity ID and slug.

`tierOneMergePlan.cjs` prepares the plan from the complete private snapshot. `tierOneMergeSql.cjs` emits an all-or-nothing transaction with complete affected-table and foreign-key-definition fingerprints. It refuses concurrent catalog drift, preserves every existing product child row and product ID, and makes a repeat application a no-op after verifying the canonical records and merge provenance. Its default is rollback; commit must be explicitly selected.

The exact plan was exercised against production constraints inside a transaction and rolled back before application. A private complete before-state backup is stored in `everycoffee-preservation/tier-one-merges-20261008`. No production schema migration is included. The separate native variant weight index change remains pending approval.

Application and exact preservation readback passed; a repeat application changed zero rows. See `tier-one-merge-apply-result.json`, `tier-one-merge-readback.json` and `tier-one-duplicate-final-audit.json`. All 456 crawler tests and all 14 tier-planner tests passed. Mac mini installation is verified separately after the reviewed source is merged.
