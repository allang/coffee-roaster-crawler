# Production Variant Save Gate

Read-only preflight on October 25, 2026 through the existing authenticated
Safari Supabase dashboard for project `gtlipifdfyugiwpxvuse` confirms:

| Index | Predicate | Unique / valid / ready | Constraint owned |
| --- | --- | --- | --- |
| product_variants_unique_weight_per_product | weight_g IS NOT NULL | true / true / true | false |
| variants_source_key_unique | source_key IS NOT NULL | true / true / true | false |

The installed `public.save_catalog_product_v1(payload jsonb)` handles source
keys and variant completeness. Its current definition MD5 is
`e5159a8debc8bd3da29ec5847bd33c56`. Version 2 is absent; the crawler already has
an explicit v1 compatibility path. The preflight made no database changes.

Current screenshots and accessibility receipts are retained locally in
`.state/naver/variant-index-preflight.png`, `variant-index-preflight-ui.txt`,
and `variant-saver-preflight-ui.txt`.

## Measured Merchant Evidence

Live merchant-only inspection now passes for KIELO COFFEE (15 one-time coffees,
121 native variants) and X coffee GINZA (17 coffees, 147 native variants).
Their product IDs are disjoint. All 268 variants have paired price/currency and
explicit stock; the observed public market is USD. Four bundle/drip-pack weights
remain unknown rather than borrowing shipping mass. The two explicitly named
Japanese subscriptions are excluded from KIELO's one-time collection.

These merchants have multiple grind SKUs for the same 100g/200g/400g weights.
The global weight index rejects those legitimate distinct identities. The
production Mac's latest audited batch already recorded 391 errors from that
index. A completed extraction report does not mean those variants were saved.

## Proposed Change

Apply only the already prepared, fail-closed migration:

`supabase/migrations/20261008155858_native_variant_weight_compat.sql`

It changes the weight index predicate to:

```sql
weight_g IS NOT NULL AND source_key IS NULL
```

The existing unique `(product_id, source_key)` index continues to guard source
identity. Legacy variants without source keys retain the weight uniqueness
guard. The migration changes no rows, weights, IDs, slugs, saver functions,
permissions or policies. It verifies the current exact index definitions and
validity, refuses unexpected schema state, and has a five-second lock timeout.

The full suite passes **542 tests**, including isolated native PostgreSQL and
PGlite migration/saver contracts, preservation checks and new merchant scope /
Unicode-handle tests. Public live extraction used no model or catalog writes.

This is a global production schema change, beyond the new merchant profiles.
The repository's rollout instructions explicitly require target authorization.
It has **not been applied**. After authorization, repeat the live preflight,
apply the exact guarded SQL, verify both index definitions again, then run a
bounded crawl of the new merchants with full variant/price/stock readback.

The rollback script in `docs/NATIVE_VARIANT_WEIGHT_COMPATIBILITY.md` refuses to
restore the old global index once legitimate same-weight identities exist.
Those variants must be preserved; do not delete them or null known weights to
force a rollback.
