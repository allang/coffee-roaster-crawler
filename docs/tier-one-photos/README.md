# Tier one product photos

The October 8 read-only catalog audit found 5,223 coffees under 55 verified tier-one roaster IDs. 444 had no usable linked media URL; 45 were seen in the previous 30 days, including 35 active and currently available records. Forty of those 45 had no saved source image URL. The remaining five included a guessed example.com URL and truncated/stale merchant URLs.

Current product pages confirm photos in primary Product JSON-LD, native Shopify image fields and product-bound Open Graph metadata. Photo selection now operates on the full source HTML independently of truncated classifier text and model output. Shopify roast/size query selectors can identify the same product photo without changing price, stock or product identity rules. Structured ImageObject contentUrl, string arrays, protocol-relative and relative source URLs are supported. Guessed/model-only images, recommendations and conflicting primary objects remain unresolved. HTTP image URLs are checked over HTTPS.

The image downloader uses the product page as referer, checks actual raster image signatures, bounds response size and time, and guards destinations/redirects before fetching. It rejects HTML/error responses and generated SVG cards. Saving a coffee passes the same database client to image persistence, retains the successful source URL and reports an unresolved photo when downloading/linking fails. Existing media ordering is preserved. Expired image caches reuse existing content assets and repeated links are idempotent.

The repair utility targets existing product IDs only. Planning uses read-only catalog and merchant/image requests. It verifies current product titles as well as source URLs, holds ambiguous/changed titles, and records image hashes and provenance. Applying a reviewed plan rechecks entity/source identity, the current primary photo and bytes, and missing media immediately before linking. It does not change prices, descriptions, availability, product identity or existing photos. Repeated application skips repaired products.

```sh
node scripts/repair-tier-one-photos.js plan /tmp/tier-one-photo-plan.json
node scripts/repair-tier-one-photos.js plan /tmp/tier-one-recent-photo-plan.json --recent
# Apply only at the authorized production repair step:
node scripts/repair-tier-one-photos.js apply /tmp/tier-one-photo-plan.json /tmp/tier-one-photo-result.json
```

The plan includes only reviewed tier-one entity IDs. Ambiguous tier assignments are not silently promoted into the repair scope. A current 404, unavailable photo, source SVG text card or product title mismatch is held for review. Prepared code does not itself repair the production catalog; a verified apply and database readback are required. The Mac mini runtime update remains behind the user's tier-one and missing-tier-two coverage condition.

Validation uses the actual catalog migrations in a disposable database, a real PNG upload fixture, stored asset/link readback and a repeated repair. It also rejects invented images, unrelated product objects, conflicting schema images, identity changes, generated cards and HTML mislabeled as image data. The integrated suite passes 279 checks. Production writes and deployment during preparation: zero.
