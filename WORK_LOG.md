# Every Coffee work log

Authoritative scope: https://github.com/allang/coffee-roaster-crawler/issues/1

## 2026-10-06 — preservation and reconciliation

- Original checkout: `/Users/allan/.openclaw/workspace/coffee-roaster-crawler`.
- Local HEAD and fetched remote main: `0036963c1c3371ab4f54f2ed040c05bef76f4f32`. No divergent remote commits.
- Preserved Git history, binary tracked patch, and all 160 untracked files under `/Users/allan/Documents/workspace/everycoffee-preservation/20261006T133525Z`.
- Implementation checkout: `/Users/allan/Documents/workspace/coffee-roaster-crawler-review`; branch `codex/issue-1-crawler`.
- Original files, ignored credentials/state, scheduled jobs, and the running crawler are unchanged.
- Preserve unpublished HTTP resilience, crawler admission cooldown, sitemap scope/lifecycle repair, value parsing, and import/validation tooling and tests. Historical source backups, scheduler plists and crawl-status JSON remain in the preservation directory and original checkout rather than published source.
- Portability repair: parser integration test now defaults to the repository saver instead of a vanished temporary repair directory. Added a discoverable test command.
- Credential-pattern scan of tracked and unpublished source: no detected token/JWT/database-password literals. No environment files copied to review checkout.
- Reviewed issue and PR list before starting: no findings and no PRs.
- Verification and publication results will be recorded after running the offline suite.

## Milestone plan

1. Publish reconciled unpublished code to a review PR.
2. Crawler normalization/traceability and meaningful regressions.
3. Shared structured-first extraction, versioned cache, independent market refresh, stable persistence, deployment instructions and measured impact report.
4. Only after crawler workstream: create `everycoffee-api` with catalog/feed/shopping, authentication, isolated workers and tests.
5. Only after API workstream: create `everycoffee-shopping-agent` with exact-spec selector, durable leases/audit/recovery, runtime probes, checkout guards and tests.

At each milestone, read issue and all linked PR conversation/review comments before work and after push. Respond to valid findings with resolving commits, or document evidence for disagreement. Do not merge, deploy, apply production migrations, replace the current crawler, activate purchase workers, or make purchases. Report production measurements unavailable where applicable.

### Baseline test evidence

- Initial broad source suite: 352 tests, 321 pass, 31 fail (7.84 seconds). Most failures require omitted historical production evidence JSON/schema files; those private/runtime snapshots remain in the original checkout. Historical scripts and tests are preserved as source and available through `npm run test:historical`, but are not reusable CI fixtures.
- Three reusable acceptance tests also depended on wall-clock time after their August fixtures expired. Added explicit clock injection for acceptance verification and passed the test fixture clock; production CLI continues to use actual time.
- Default `npm test` covers reusable import/validation/parser tests; historical evidence-bound runs are separately documented without claiming they passed.

- Reusable baseline verification after portability fixes: **139/139 pass**, 0 skipped, 0 failed; `git diff --check` and `bash -n run-crawler.sh` pass. No network crawler or production database write executed.

## 2026-10-06 — normalization and stock evidence

- Preservation published as `98f5aeaceea95016f0d5f7a1131ad71867d5c3c2`, PR https://github.com/allang/coffee-roaster-crawler/pull/2. Read issue/PR comments after push and before this milestone; no reviewer findings.
- Added deterministic amount/currency parser with locale grouping, ISO currency precision, exact integer conversion, overflow/range rejection and unknown ambiguous currencies. Separate display titles preserve source titles and acronym/distinctive casing; source URLs/native variant identity underpin keys.
- Added versioned tasting taxonomy with hierarchical categories; every source phrase is retained including unmapped/uncertain notes.
- Product-scoped JSON-LD/Shopify availability evidence includes check time and variant states; global stock text/prices and missing variant flags produce unknown. Definitive HTTP 404/410 produces removed.
- Read-only production REST schema inspection grounded integration in actual columns; no production writes. Existing price_cents historical semantics require explicit new minor-unit/exponent fields rather than silently reinterpreting old rows.
- Verification: **164/164 reusable tests pass**, including 25 normalization/evidence regressions; working diff whitespace check passes. These pure helpers will be wired into both crawler paths and persistence in the next milestone.
- Seven inherited archival trailing-blank-line warnings in the preservation commit were not removed; no functional archival rewrites made.

## 2026-10-06 — integrated crawler refresh and catalog transactions

- Prior normalization milestone exact SHA: `ba669a02cc99e76bfcecf6b4e5a0f91c22d907e4`. Issue and PR conversation/inline/review comments checked before this milestone and again before publication; no findings yet.
- Sitemap visitor and BFS share extraction/persistence. Complete structured attribute contracts skip AI; partial source data falls back for full semantics. Cache is versioned by extraction/model/content hash with seven-day semantic expiry, including description/DOM attribute changes. Native price/variant/stock overlay always refreshes independently. Explicit skip pages remain excluded.
- Known coffee/irrelevant pages can refresh instead of being permanently excluded. Full attributes, original descriptions, typed decaf values, source titles, exact same-weight grind variants and missing/unmapped notes survive persistence.
- Additive **review-only** catalog migration and service-role-only SECURITY INVOKER RPCs preserve existing IDs/slugs/first-seen/media/optional facts and adopt only exact source/variant identities. No delete/reinsert loop; writes are transactional with source locks, bounded identity queries, stale-observation rejection and content/market outbox events. Ambiguous legacy identity fails for review. Old `price_cents` representation remains separate from new ISO minor units/exponent. Missing currency is nullable.
- Availability uses explicit nullable truth and normalized state/evidence/time. Product removal reaches variants. Complete native inventories retire missing source variants; partial extracted lists do not. Surface omission alone never proves removal. Reconciliation reuses freshly persisted observations to avoid a second download.
- Durable seven-day image URL cache reuses linked assets before downloading; expired caches recheck content. Reusable image tests prove two identical requests cause one download/upload; a stale cache triggers a new download without duplicate upload.
- Crawl metrics count actual classifier requests/retries and API-reported input/output/cache tokens; missing usage remains explicitly unreported. No paid model calls were made during offline tests. Added test-only PGlite Postgres 0.5.8, pinned Supabase 2.89.0, and CI that runs only offline tests.
- Read-only baseline convenience sample: 100 latest active coffees, 167 variants, 154 prices, 112 weights, 79 origins, 83 tasting-note fields. All 167 variants use the legacy in_stock value, which is not proof of current stock. Raw rows/credentials were not copied into the repository. Aggregate evidence: `docs/catalog-baseline-summary.cjs`.
- Verification correction: the first 173-test integrated run passed, but the latest 174-test run was **173 pass, 1 fail**: an identity/price fixture reused an older timestamp after a newer warm refresh, correctly triggering stale-observation rejection. The passing-result statement was prematurely written before inspecting that summary. Local SQL checks include actual local SQL migration/RPC execution, permission rejection, identity preservation, rollback, image reuse and both crawler paths with simulated classifiers/transports. Working diff whitespace check passes. The original checkout's tracked patch and all preserved untracked source hashes were revalidated unchanged. No production writes or running-crawler changes.
- Next: reproducible fixture comparison, impact/deployment report and final crawler review, then workstream 2. Production crawl latency, token/cost savings and catalog-after coverage remain unmeasured while undeployed.

### Integration correction

- Integrated milestone `fe69660a4130062c4be44a6a652267d72bbfb643` was pushed with the stale fixture failure described above. Corrected the changed-price fixture to use a newer observation time, preserving the stale-write guard and its dedicated negative test. Subsequent tests and pushes use strict shell failure gates.
- Removed accidentally staged Supabase CLI version-cache file and ignored CLI temporary state. Original checkout remains unchanged. No reviewer findings at the after-push check.

## 2026-10-06 — crawler impact and deployment preparation

- Corrected suite now **175/175 pass** (2.59 seconds), 0 failures/skips. Dedicated stale-observation negative test still passes. Retry usage accounting retains unknown retry costs even when the final response reports tokens. Removed the CLI cache artifact.
- Reproducible actual-function fixture comparison against `98f5aeaceea95016f0d5f7a1131ad71867d5c3c2`: paired ISO amount/currency correctness **3/8 -> 8/8**, scoped availability correctness **2/7 -> 7/7**. Cases target known defects; no broad merchant/population success rate claimed. Comparison is about 90 ms of offline fixture work, not crawl duration.
- Added README, staging environment template, DEPLOYMENT.md and IMPACT_REPORT.md. Report separates deterministic fixture measurements, read-only catalog sample, simulated classifier routing, estimates/hypotheses and unavailable production crawl/feed/purchase outcomes. Actual paid AI requests/tokens in this verification: 0/0.
- GitHub CI on the integration commit failed on the same stale-timestamp fixture; corrective commit will trigger a fresh run. No production migrations, crawler replacement, deployments or purchases performed.
- Issue/PR comments checked before this milestone; no reviewer findings. Crawler code/report is ready for review; workstream 2 starts after the corrective push/CI check. Future live validation is explicitly gated by separate rollout authorization.
