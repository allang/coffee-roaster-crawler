# Crawler deployment preparation — no deployment performed

The current Mac Mini crawler, launch agents, locks, logs and credentials are untouched. Do not run `index.js` or `run-crawler.sh` from the review checkout against production. This document describes a **future separately authorized** rollout; creating this PR does not authorize it.

## Prerequisites and local verification

Use Node.js 22+, a full-history clone, `npm ci --ignore-scripts` and `npm test`. The tests use local PGlite with a sanitized schema fixture and no network credentials. Run `node scripts/compare-fixtures.cjs` for the deterministic baseline comparison. CI runs offline tests only. Historical one-off import tests require local evidence artifacts and are not a production action or automatic release step.

Create a distinct staging Supabase project or local database using a structural copy of the existing catalog: products, product_variants, coffee_facts, known_pages, media_assets, product_media, entities and existing crawler control tables. Compare the live schema/constraints with the fixture before applying the proposed migration. Pin Supabase JS to the lockfile; no automatic dependency/model upgrade is required.

Required server-only staging variables follow `.env.example`: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY and optionally OPENAI_MODEL. Despite its legacy prefix, the service role key must never enter a frontend. Retain the configured model until separately changed. Tune page concurrency conservatively (default one), use the existing crawl delay/proxy settings, and verify merchant request policies. Keep staging credentials separate from the running crawler.

## Staging migration and compatibility checks

Review `supabase/migrations/20261006134031_catalog_refresh_v1.sql`. It adds source identity, title, currency precision, normalized availability/evidence, a catalog event outbox, image source cache, and transactional service-role-only RPCs. This migration is **not applied to production** and no command auto-applies it.

After separately authorizing staging setup, use the Supabase CLI appropriate to that project to apply the reviewed migration. Verify it against the actual schema, not only the test fixture. Inspect advisors, existing grants and RLS policies. New internal outbox/cache tables have RLS and no anon/authenticated access; public RPC execution is revoked and granted only to service_role. RPCs use SECURITY INVOKER. Do not grant public execution to work around a permission error.

Verify these gates on staging:

1. Existing product/variant IDs, slugs, first-seen timestamps, facts and media links remain stable after refresh. Ambiguous exact source/variant matches fail for review. Do not resolve duplicates by deleting records automatically.
2. JPY and KWD round-trip using explicit minor units/exponent. Existing `price_cents` is the legacy hundredths representation; migrate consumers to `price_minor_units` + `currency_exponent` before enabling purchasing. A null currency/price is not purchasable.
3. `is_available` can now be null. Consumers must use `availability_state` and stock timestamps/evidence, treating unknown as unverified. Existing rows start unknown until observed; do not bulk-mark them in stock.
4. Native inventories retire missing variants only when complete. Child-sitemap errors/truncation and page errors prevent inventory reconciliation. Missing sitemap membership alone does not remove a product.
5. Cache invalidates on changed content, model, extractor version, or seven-day semantic expiry. Market overlays refresh every processed page; image URLs revalidate after seven days. Bump EXTRACTION_VERSION for semantic prompt/parser changes.
6. Content/market changes emit durable catalog_change_events for the API worker. Unchanged successful stock/removal checks advance timestamp/evidence without extra events. Give a variant a newer timestamp than its product, then test an intermediate older stock-only/full-save/inventory-removal observation: that variant's stock, money and evidence must remain unchanged while eligible siblings update. Both removal paths guard each variant independently; actual accepted state/price changes emit market events.
7. Trigger simulated failures during catalog writes to verify rollback and bounded error handling. A missing RPC/schema is a hard failure; the code does not fall back to delete/reinsert.

## Future rollout, monitoring and rollback

Only after explicit rollout authorization, a passing staging comparison and PR review should an operator choose a maintenance window, back up catalog/schema, snapshot the running source/launch configuration, and point the existing launcher at the reviewed release. Stop/swap/restart actions are intentionally not included in this run. Leave Mac Mini ownership and current scheduling intact until that decision.

Measure the same merchant/product cohort before and after: origin/process/variety/notes/weight/price coverage, exact stock checks, elapsed crawl time, request counts, real API tokens, errors, cache hits, DB changes and image downloads. Inspect `crawl_runs.meta.extraction` and distinguish unreported retry usage. Alert on rising unknown currency/stock, missing RPCs, adoption conflicts and partial inventories. Do not compare only completely structured products.

Rollback code by restoring the preserved release/launcher configuration after authorization. Keep additive columns and stable IDs/data; reverting destructive schema changes is not necessary for code rollback. Review compatibility of null legacy currency/availability with old consumers before rollback. The local preservation bundle/patch/untracked copy is retained at the path in WORK_LOG.md. No rollback/deploy/purchase automation is armed by this repository.

Shopify stock integration also reads locale-aware product.js and joins matching native IDs only. Its prices are not used for decimal JSON price parsing. Only matching uncapped inventories authorize missing-variant retirement; validate multi-currency context and shipping eligibility in staging before relying on availability for purchasing.
