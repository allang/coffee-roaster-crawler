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
