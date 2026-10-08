# Airship catalog repair

Airship's Webflow/Shopyflow pages contained a hidden `sf-cart-popup` with the literal title “Product Title”, fake prices and generic option labels. The normal generic crawl incorrectly saved seven placeholders, five collection/shop-by pages, and a Fellow Espresso Series 1 machine as coffees.

The official site's declared Shopyflow installation identifies Shopify shop 6290581 at `airshipcoffee.myshopify.com`. Only that reviewed backend, the official public site, and exact owner `8528a70e-2033-4fc5-b5c6-1c5f73c0a989` are registered. No client token or account endpoint is used. Public GET inspection paginated all 81 native products to an explicit empty final page and verified 12 retail coffees with 145 exact native options. Price/currency pairs, stock and photos are product-bound. “Roaster's Choice” explicitly offers a one-time purchase and optional subscription; the equipment and hidden/wholesale inventory are excluded.

The crawler removes hidden cart markup before classification, image or structured evidence extraction and rejects a Shopyflow shell without a primary product identity, including contaminated cached classifications. Discovery links remain available. Real native `/products/<handle>` URLs share identity with the explicitly reviewed official host, preserving existing product IDs, slugs and photos. Retrieval and provenance retain the actual fetched host. No unrelated merchant host is aliased.

Both omission guards remain false: this native sales channel does not prove global absence of products on every other channel. Three older product-page records not in the current listing remain held unchanged; they are not treated as removed. The old production same-weight variant index still blocks legitimate grind options. The separate compatibility migration remains prepared and unapplied pending explicit approval; known weights and native options are not discarded.

## Invalid-source cleanup

`data/airship-invalid-source-repair.json` pins 13 exact IDs, source URLs and full-row fingerprints. `node scripts/airship-source-repair.cjs` prints a dry-run transaction ending in `ROLLBACK`; it never connects to a database. Identity or record drift aborts the entire transaction. The repair sets these invalid records inactive and appends source-repair provenance; all product records and children remain retained.

The dry run and repeat were tested in a rolled-back transaction (13 changes, then zero), with all product and child fingerprints unchanged afterward. The authorized error cleanup committed at 2026-10-08 21:13:43 UTC. Readback retained all 28 product IDs, left all 15 real product rows unchanged, and preserved counts and hashes in all eight referencing tables. A repeat dry run made zero changes. No schema change was applied.

Evidence: `airship-native-inspection-20261008.json`, `airship-invalid-source-evidence-20261008.json`, `airship-source-repair-dryrun-20261008.json`, and `airship-source-repair-readback-20261008.json`. Private full-record recovery backup: `/Users/allan/Documents/workspace/everycoffee-preservation/airship-source-repair-20261008`.

Stock endpoint failures also retain the actual HTTP status, source stage, retry stop and cooldown evidence through the normal visitor. A failed native stock read cannot be replaced by cached or model-inferred stock, and no extra retry batch is introduced. Earlier September failures remain failed; a later diagnostic read is separate evidence of recovery.
