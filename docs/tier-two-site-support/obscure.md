# Obscure Coffee Roasters

The current public shop has two required Coffee Discovery Subscription listings and **zero one-time retail coffees**. The existing roaster record `ac3ab5f1-ca53-4a82-8125-ee6aefc930d9` is now registered for guarded native Square reads.

The category metadata advertises 30 Single Origin products, three Blends and one Collabs product. Those groups reference 33 unique product identifiers. A fresh read checked every reference: all 33 return HTTP 404. The complete public catalog, read without a fulfillment exclusion, returns the two subscriptions; all three current category product queries return zero. The implementation records this disagreement and checks the actual resources on every crawl instead of interpreting the metadata count as current inventory.

The crawler can accept this specific, proven subscription-only result. It records zero coffees, performs no generic sitemap/BFS or model classification, and does not reconcile or change existing product availability. A plain empty response, a missing reference check, a live unaccounted-for product, an HTTP 429/503, a changed merchant/category, a truncated catalog or an unknown product type fails verification. New one-time coffee products are processed by the existing exact-product/variant Square parser when the public catalog and category results agree.

Registered product-page failures now mark the run failed before completion. An incomplete native source cannot receive a successful completion or its resulting daily cooldown.

Validation: the fresh GET-only inspection passed with two excluded subscriptions, all 33 unavailable references, zero AI calls and zero prohibited requests. All **353** crawler tests pass. Captured cases include source disagreement, malformed identity/type/pagination, recovery when a new coffee is published, false empty claims and the normal crawler's zero-inventory/failure paths. No production catalog or runtime changes were made.

The current receipt is [obscure-live.json](obscure-live.json). The earlier [blocker report](obscure-blocker.json) is historical and is superseded by this registered implementation.
