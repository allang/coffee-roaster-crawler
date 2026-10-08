# Tier-one photo repair result

The user requested unblocking after the reviewed catalog and photo changes were prepared. The first photo apply repaired 222 products. Eight changed primary image URLs were freshly reverified and repaired; one formerly valid product page now returns 404 and remains held.

**230 product photos are linked in production.** A repeated apply found all 230 already linked and made no further changes. The repair only adds verified media links and source image URLs, preserving product names, stock, pricing and existing media. Public asset responses are checked for full raster decoding and exact saved byte hashes.

The original read-only plan still records 221 held historical cases, mostly changed product identities, removed pages, missing primary images or generated SVG text cards. These are not resolved by inventing a photo. Recent coverage originally had 47 missing photos; all 37 available verified primary product photos were repaired, leaving ten cases without a verified usable photo.

Evidence: [first apply](apply-result.json), [fresh recheck](rechecked-plan.json), [second apply](rechecked-apply-result.json), [repeat apply](idempotence-result.json), [public byte verification](applied-photo-verification.json).
