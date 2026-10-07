# Crawler rollout and deployment instructions

The original review preparation did not authorize production changes. On 2026-10-06 EDT the user separately authorized a temporary local crawler pause/update/run and its required catalog migration. Migration `20261006134031` is applied and recorded in the crawler's production catalog; corrected source `30748a20ac66f90d3f121b7298b65631fede6e49` is installed in the original Mac checkout and passes 190/190 supported tests. The ten-roaster first/cached comparison and separate corrected-merchant check are complete. The existing launch agent resumed at 2026-10-06 23:12:41 EDT, with its unchanged 90-minute schedule and one worker. See [LOCAL_RUN_REPORT.md](LOCAL_RUN_REPORT.md) for measured results/limits and [WORK_LOG.md](../WORK_LOG.md) for preservation and schema/permission checks. Do not reapply that recorded migration to this catalog.

The instructions below remain the preparation/reference gates for another environment or future rollout. Creating the PR alone never authorizes deployment. API/service deployment, purchase-worker activation and real purchases remain outside this local crawler authorization.

## Readiness follow-up after the local rollout

The review branch contains a subsequent cache/market correction and dependency patches, verified with **196/196 supported tests**, an additional local HTTP/redirect/proxy integration test, and zero findings from `npm audit`. This follow-up is prepared for review; the running checkout still uses source `30748a20ac66f90d3f121b7298b65631fede6e49` and its original lockfile.

Install the follow-up before relying on refreshed variant market values. The installed release can reuse an HTML-only coffee's cached price/stock when no fresh structured variant overlay is available, then give the old values a current checked-at timestamp. The correction requires fresh fallback extraction for such coffee pages and records unsupported exact variant stock as unknown. A structured Product name/description, or even complete coffee attributes, does not prove current variants. Structured variant overlays and irrelevant-page semantic caches still avoid AI when otherwise eligible. The model, semantic cache version and seven-day lifetime are unchanged; existing cache entries are safely gated at reuse. Unstructured coffee pages may incur more AI calls; their post-correction production cost/latency is unmeasured.

Only affected locked dependencies and their required transitives were refreshed within existing package ranges: axios, follow-redirects, form-data, undici, ws and drizzle-orm. The Supabase client remains pinned to 2.89.0 and OpenAI SDK/model settings are unchanged. No additional migration or data backfill is required. On a future local update, preserve configuration, install this lockfile with `npm ci --ignore-scripts`, run the supported tests, and use the existing temporary pause/update/resume procedure. Existing data is corrected as pages are revisited; the code patch does not retroactively certify previous price/stock observations.

## Prerequisites and local verification

Use Node.js 22+, a full-history clone, `npm ci --ignore-scripts` and `npm test`. The tests use local PGlite with a sanitized schema fixture and no network credentials. Run `node scripts/compare-fixtures.cjs` for the deterministic baseline comparison. CI runs offline tests only. Historical one-off import tests require local evidence artifacts and are not a production action or automatic release step.

Create a distinct staging Supabase project or local database using a structural copy of the existing catalog: products, product_variants, coffee_facts, known_pages, media_assets, product_media, entities and existing crawler control tables. Compare the live schema/constraints with the fixture before applying the proposed migration. Pin Supabase JS to the lockfile; no automatic dependency/model upgrade is required.

Required server-only staging variables follow `.env.example`: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY and optionally OPENAI_MODEL. Despite its legacy prefix, the service role key must never enter a frontend. Retain the configured model until separately changed. Tune page concurrency conservatively (default one), use the existing crawl delay/proxy settings, and verify merchant request policies. Keep staging credentials separate from the running crawler.

Keep TLS certificate verification enabled. Merchant HTTP support no longer changes the process-wide TLS validation setting, which also affects authenticated OpenAI/Supabase requests. A certificate error must defer the fetch and retain prior catalog evidence; fix the site's certificate/trust chain instead of setting `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Staging migration and compatibility checks

Review `supabase/migrations/20261006134031_catalog_refresh_v1.sql`. It adds source identity, title, currency precision, normalized availability/evidence, a catalog event outbox, image source cache, and transactional service-role-only RPCs. It was applied to the existing crawler catalog only after the later explicit authorization above; no repository command auto-applies it. Check target migration history before applying it to a different environment.

After separately authorizing staging setup, use the Supabase CLI appropriate to that project to apply the reviewed migration. Verify it against the actual schema, not only the test fixture. Inspect advisors, existing grants and RLS policies. New internal outbox/cache tables have RLS and no anon/authenticated access; public RPC execution is revoked and granted only to service_role. RPCs use SECURITY INVOKER. Do not grant public execution to work around a permission error.

Verify these gates on staging:

1. Existing product/variant IDs, slugs, first-seen timestamps, facts and media links remain stable after refresh. Ambiguous exact source/variant matches fail for review. Do not resolve duplicates by deleting records automatically.
2. JPY and KWD round-trip using explicit minor units/exponent. Existing `price_cents` is the legacy hundredths representation; migrate consumers to `price_minor_units` + `currency_exponent` before enabling purchasing. A null currency/price is not purchasable.
3. `is_available` can now be null. Consumers must use `availability_state` and stock timestamps/evidence, treating unknown as unverified. Existing rows start unknown until observed; do not bulk-mark them in stock.
4. Native inventories retire missing variants only when complete. Child-sitemap errors/truncation and page errors prevent inventory reconciliation. Missing sitemap membership alone does not remove a product.
5. Cache invalidates on changed content, model, extractor version, or seven-day semantic expiry. Coffee caches additionally require a current structured variant overlay; otherwise run fresh fallback extraction. Prices must come from the current fetch/extraction, and unsupported exact variant stock stays unknown. A failed fallback must not save cached market values as a successful current observation. Image URLs revalidate after seven days. Bump EXTRACTION_VERSION for semantic prompt/parser changes.
6. Content/market changes emit durable catalog_change_events for the API worker. Unchanged successful stock/removal checks advance timestamp/evidence without extra events. Give a variant a newer timestamp than its product, then test an intermediate older stock-only/full-save/inventory-removal observation: that variant's stock, money and evidence must remain unchanged while eligible siblings update. Both removal paths guard each variant independently; actual accepted state/price changes emit market events.
7. Trigger simulated failures during catalog writes to verify rollback and bounded error handling. A missing RPC/schema is a hard failure; the code does not fall back to delete/reinsert.

## Future rollout, monitoring and rollback

For a future rollout, obtain explicit authorization, compare staging and review findings, back up catalog/schema, and snapshot running source/launch configuration before pointing the existing launcher at the reviewed release. The separately authorized 2026-10-06 local rollout and benchmark are recorded in WORK_LOG.md; they do not authorize additional deployment actions. Preserve Mac Mini ownership and scheduling when resuming it.

Measure the same merchant/product cohort before and after: origin/process/variety/notes/weight/price coverage, exact stock checks, elapsed crawl time, request counts, real API tokens, errors, cache hits, DB changes and image downloads. Inspect `crawl_runs.meta.extraction` and distinguish unreported retry usage. Alert on rising unknown currency/stock, missing RPCs, adoption conflicts and partial inventories. Do not compare only completely structured products.

Rollback code by restoring the preserved release/launcher configuration after authorization. Keep additive columns and stable IDs/data; reverting destructive schema changes is not necessary for code rollback. Review compatibility of null legacy currency/availability with old consumers before rollback. The local preservation bundle/patch/untracked copy is retained at the path in WORK_LOG.md. No rollback/deploy/purchase automation is armed by this repository.

Shopify stock integration also reads locale-aware product.js and joins matching native IDs only. Its prices are not used for decimal JSON price parsing. Only matching uncapped inventories authorize missing-variant retirement; validate multi-currency context and shipping eligibility in staging before relying on availability for purchasing.
