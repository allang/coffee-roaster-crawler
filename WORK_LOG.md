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

## 2026-10-06 — Shopify endpoint evidence follow-up

- While completing API live verification, official Shopify docs confirmed that public Ajax product.js exposes exact variant sellability, uses presentment-currency price integers with special zero-decimal representation, and caps its variants array at 250. This justified a narrow crawler integration correction rather than guessing missing product.json flags. Issue and both linked PR comments checked before the follow-up: no findings.
- Crawler now fetches locale-preserving Ajax stock and joins only matching product/native variant IDs; original decimal price/title/body fields remain intact. Evidence identifies Ajax as the stock source. Complete inventory is asserted only when matching uncapped Ajax IDs exactly cover the priced JSON list; missing/capped/inconsistent inventories do not retire variants.
- Verification: **178/178 tests pass** (2.40 seconds). Three new regressions verify ID binding, preserving JPY-style decimal JSON price despite different Ajax integer price, locale URLs and incomplete/capped inventory. No live merchant request, production write or original checkout modification.
- Additional Ajax I/O is intentional for stock correctness; production crawl latency/cost impact remains unmeasured. Documentation: https://shopify.dev/docs/api/ajax/reference/product and https://shopify.dev/docs/api/liquid/objects/variant.

## 2026-10-06 — native product identity and source retrieval follow-up

- Shopify endpoint follow-up SHA: `951a09c7477e870c184a58401df9c27b860f3049`. After-push issue/both-PR comments checked: no findings.
- Source-native product IDs now anchor product identity when verified source extraction supplies them, so handle/title changes retain product and variant IDs. Legacy URL matches still adopt existing IDs; unsupported/missing native identities retain stable canonical URL keys. AI-only extraction cannot invent native IDs or complete-inventory evidence.
- Retrieval source_url preserves the observed www hostname while a separate canonical key/metadata retains normalized identity. This avoids turning valid merchant source URLs into a different origin before the API's strict same-origin verifier; identity does not come from display titles.
- Verification: **180/180 tests pass**, including real SQL native-ID handle-change preservation, observed retrieval host, and rejection of invented AI identity/completeness. Original running checkout remains untouched.

## 2026-10-06 — final currency source-pairing audit

Prior crawler SHA `8fa527f525a7049a0cc02946864b9095acb7e7bf`; both CI runs passed. All issue and three linked PR conversation/inline/review comments checked before this milestone: no reviewer findings. Final implementation audit found a real source-pairing gap: native product JSON lacking currency could borrow the page offer's currency while retaining a different native numeric price.

- Numeric native amount/currency now require their own source pair. An exact unique native variant URL/SKU offer can instead contribute both its own amount and currency. Unmatched/conflicting offers remain unknown rather than relabeling a separate amount. Legacy merge helper cannot substitute inferred currency for native numeric prices; explicit unknown variant currency cannot inherit another offer's currency. Native IDs, stock, raw prices and coffee attributes remain preserved.
- **183/183 tests pass**, 3.00s, including three new source-pairing/unknown regressions. Reproducible baseline comparison remains 3/8→8/8 monetary cases and 2/7→7/7 scoped stock cases, 87.8ms local fixture time, paid AI calls/tokens 0/0. These targeted cases are not representative merchant rates or crawl duration.
- Original checkout tracked diff and all 160 untracked sources rechecked unchanged. No migration change, deployment or crawler replacement. Source-pairing uncertainty may yield more honest unknown prices until a verified pair is available; production coverage/cost impact remains unmeasured.

## 2026-10-06 — consolidated completion audit

Resolving crawler source SHA `02a4715aa927eef3892e473fc761ea7f04ad160a`: 183 tests and CI runs 37488708717 / 37488701351 pass. API source `58115f77843bdf6305c345b8a1a6db792a778601`: 16 tests and CI pass. Agent source `567282c23e95deebc0303d0a745264361998adfd`: 21 tests locally, CI status recorded in issue; PR is ready for review. All issue/PR comment surfaces checked after the final code pushes: no reviewer findings.

Added docs/FINAL_REPORT.md mapping every authoritative requirement to prepared implementation/evidence, exact resolving source SHAs, preservation verification, measured correctness/feed/runtime results, labeled estimates and unavailable live outcomes. Original source/config/state remain untouched. Deployment/production migrations/real orders are explicitly future actions requiring separate approval; no implementation work is withheld behind a new permission request.

## 2026-10-06 — cloud review: independent variant freshness

- Reviewed all issue and three linked PR conversation/inline/review comments before this milestone. Accepted [crawler P1/P2 findings](https://github.com/allang/coffee-roaster-crawler/pull/2#issuecomment-6022908929) and the [tracking follow-up](https://github.com/allang/coffee-roaster-crawler/issues/1#issuecomment-6022964770). Starting branch SHA `c33c6bd194b903acb646ebbea838fc0475fd8d43`; fetched remote and confirmed no divergence before editing. Review branch and PR remain `codex/issue-1-crawler`, https://github.com/allang/coffee-roaster-crawler/pull/2.
- Four new actual local SQL regressions initially failed on the reviewed code. They reproduce unchanged native-stock freshness, stock-only stale variant overwrites, full-save stale stock/price/currency/exponent/evidence/provenance overwrites, and complete-inventory removal of a newer variant.
- The existing, still-unapplied migration now locks and checks each variant's own `availability_checked_at` before writes. Full saves retain an independently newer variant observation, including all monetary fields; source presence is still recorded. Stock-only and both removal paths accept timestamp/evidence refreshes even for unchanged states, while outbox events reflect actual accepted state/money changes. Newer variants remain untouched when the observation is between the product and variant watermarks.
- Verification: **187/187 tests pass**, 0 skipped/failed, 3.48 seconds; the four new regressions pass after the fix. Tests verify unchanged evidence/timestamps advance without extra events and accepted changes still publish events. `git diff --check` passes. No new dependency, rewrite or production database access was needed; grants and SECURITY INVOKER restrictions are preserved.
- API cart completeness is the next resolving milestone. Exact resolving SHAs, post-push comments and CI results are recorded in the authoritative issue. Original running checkout/config/state are untouched; no merge, deployment, migration outside disposable local SQL tests, live worker or purchase occurred.

## 2026-10-06 — review resolution handoff

- Crawler resolving source SHA `2c8bea9678423f13df769ccf7a1dc0ff1e5af622`: 187/187 local tests, both CI runs 37513628016 / 37513622478 pass. [Response to P1/P2](https://github.com/allang/coffee-roaster-crawler/pull/2#issuecomment-6023093206) records all four protected write paths and unchanged-check refresh semantics.
- API resolving source SHA `713aeb16b352edca5289d8201c7d4efad47d874d`: 24/24 local tests, including eight new restricted-role/identity/freshness/preparation regressions; both CI runs 37514244107 / 37514237642 pass. [Response to remaining P1](https://github.com/allang/everycoffee-api/pull/1#issuecomment-6023179664) records complete persisted-line hydration and exact quoted evidence. API fixture uses the corrected crawler migration. No agent source changes or additional actionable agent finding.
- Updated consolidated/impact reports and crawler staging checks to reflect these corrections and exact source SHAs. Both new repositories verified private. Rechecked preservation: original HEAD remains `0036963c1c3371ab4f54f2ed040c05bef76f4f32`, tracked patch matches backup, all 160 preserved untracked files are identical. No source/config/state change in the running checkout.
- All issue and linked PR conversation/inline/review surfaces checked before this documentation milestone and after code pushes. Findings are implemented with regression evidence; they are not dismissed as review approval. All branches remain unmerged and undeployed. No production migration, live worker or purchase occurred. No new live performance or merchant-coverage measurement is claimed.
