# Every Coffee implementation handoff — 2026-10-06

All three authorized code workstreams are complete on pushed review branches. They remain unmerged and undeployed. No production migration, running-crawler replacement, live purchase worker or real purchase occurred. The original issue remains the authoritative goal: https://github.com/allang/coffee-roaster-crawler/issues/1.

## Repositories, review and tested source commits

| Workstream | Repository / PR | Resolving source SHA | Verification |
|---|---|---|---|
| Crawler | https://github.com/allang/coffee-roaster-crawler/pull/2 | `02a4715aa927eef3892e473fc761ea7f04ad160a` | 183/183 local tests; both CI runs pass. |
| Catalog/feed/shopping API | https://github.com/allang/everycoffee-api/pull/1 | `58115f77843bdf6305c345b8a1a6db792a778601` | 16/16 local tests; both CI runs pass. |
| Codex purchasing service | https://github.com/allang/everycoffee-shopping-agent/pull/1 | `567282c23e95deebc0303d0a745264361998adfd` | 21/21 local tests; final CI status linked in issue. |

Branches: `codex/issue-1-crawler`, `codex/issue-1-api`, `codex/issue-1-shopping-agent`. Documentation-only completion commits follow the resolving source SHAs and are recorded in the issue. All PRs are ready for review. Main branches were not overwritten or force-pushed.

Original crawler reconciliation: inspected original checkout at HEAD `0036963c1c3371ab4f54f2ed040c05bef76f4f32`; saved history bundle, binary tracked diff and all untracked source to `/Users/allan/Documents/workspace/everycoffee-preservation/20261006T133525Z`. Preserved local changes were committed in review clone as `98f5aeaceea95016f0d5f7a1131ad71867d5c3c2` on top of remote history. Final recheck: original tracked diff matches backup and all **160 untracked files** match; original source/config/state remain in place.

## Requirement audit

Completion here means prepared implementation and relevant local/CI evidence under the user's no-deploy/no-purchase restriction. It does not mean live hosting, updated production rows or certified merchant/payment integrations.

| Authoritative checklist item | Prepared result / evidence |
|---|---|
| Paired international money/precision | ISO amount/currency/precision normalization, unknown ambiguity, exact source pairing; parser and native mixed-source regressions. |
| Original/display titles and identity | Original title retained, readable separate display title, anchored origin removal/acronyms, identity independent of names. |
| Tasting taxonomy | Versioned canonical/hierarchical notes retain source, uncertainty and unmapped wording. |
| Four-state product/variant availability | Scoped product/native-ID evidence, timestamps, unknown/removed semantics, uncapped complete inventory required for retirement. |
| sitemapResult scope | Existing local correction preserved/reassessed, shared sitemap/BFS regression coverage. |
| Structured-first full extraction | Shared flow, 17 attributes retained, explicit complete source contract skips AI; partial source falls back. |
| Versioned change-aware cache and market refresh | Version/model/hash/TTL cache, fresh stock/price overlays, independent market observations. |
| Images and DB churn | Source/content image cache, atomic nondestructive RPC upserts, retained IDs/media/facts; local SQL tests. |
| Stable normalized catalog/source IDs | Native product/variant IDs, URL fallback/adoption, original retrieval URL and source trace; additive reviewed SQL only. |
| Regression/content comparison | 183 tests, actual baseline function comparison and aggregate read-only catalog baseline, limitations reported. |
| Authenticated hosted API preparation | Catalog/feed/shopping modules, Supabase identity validation, tenant policies, signed cursors and separate serving process. |
| Shared pools/per-user ranked IDs/activity | Bounded shared pools, cached ranked IDs, preference/activity invalidation and cursor revisions; 16 API tests. |
| Independent fresh market/feed ordering | Hydration refreshes market while rank stays stable; content outbox invalidation consumes individual event IDs. |
| Exact variant verification/carts/final quotes | Owned exact cart/version, live verification adapter and quote-only capability contract; unsupported totals stay unknown. |
| Isolated workers/deploy configuration | Separate server/worker credentials/processes, bounded claims/heartbeats, disabled defaults, Docker/compose and operating instructions. |
| Backend exact selector | Authenticated policy + stable intent; hard preference/stock/currency/budget filters, exact native variant, selection script and SQL/API tests. |
| Durable queue/isolation/audit/retries | Claims/leases, encrypted job-bound sessions, persisted progress/audit and bounded prepayment recovery. |
| Actual Codex browser runtime | Actual CLI 0.160.0 + isolated Chrome completed one local mock checkout preparation; captured latency/tools/tokens, zero payment requests. |
| Native capability and browser fallback | Verified native feature/customer/conditional-total contract preferred; controlled capable browser fallback, no assumed merchant support. |
| Sold-out/temporary/alternate recovery | Bounded replacement preserves constraints and clears approval; browser uncertainty/shipping/over-budget recovery included. |
| Authorized total and confirmation | Fresh proof, exact customer/job/variant/quantity/destination/total, capability before fence, one-use authorization, confirmed matching order only. |
| Ambiguous-payment reconciliation/duplicates | Durable fence/key generations, expiry/lost DB reply barriers, authoritative final absence or receipt only, bounded unknown lookups and manual hold. |
| Exception reporting and scale benchmark | Exception CLI + 100 offline jobs + actual mock Codex probe + capacity estimates; live completed-order benchmark **not performed** because real purchases are prohibited. |
| Measured impact and limits | Three impact reports distinguish fixtures, read-only baseline, captured model usage, estimates and unavailable production results. |
| Deployment instructions and remaining prerequisites | Prepared staging/roles/auth/merchant/credential/network/worker/recovery instructions in every repository; external execution requires later approval. |

## Measured outcomes versus estimates

| Measurement | Result | Practical limit |
|---|---|---|
| Crawler paired money correctness | 3/8 baseline → 8/8 proposed cases | Targeted defect fixtures, not merchant prevalence. |
| Crawler scoped availability | 2/7 → 7/7 cases | Targeted fixtures, not live stock accuracy. |
| Crawler content coverage baseline | 100 recent active coffees: 167 variants; 154 legacy prices, 112 weights, 79 origins, 83 note metadata | Aggregate convenience sample; 167 legacy in-stock labels are unverified; production after-coverage unavailable. |
| Structured/warm classifier routing | Zero additional classifier calls in complete/warm fixtures; changed market still refreshes | Simulated classifier counters; production call reduction unmeasured. |
| Crawler verification model usage | Paid model requests/tokens 0/0 | Offline tests; actual production duration/cost/savings unavailable. |
| Warm feed | p50/p95 1.647/2.186ms over 200 local requests; rank revision stable | PGlite + Fastify injection/mock auth, excludes network/auth/concurrency; not production SLO. |
| Actual Codex mock preparation | 22.158s, five successful browser tools, correct variant/destination/EUR 1800 total, zero payment requests | One corrected local mock case, not a completed order or live merchant success rate. |
| Captured successful Codex usage | 122,156 input (101,888 cached) / 240 output tokens | Runtime-default model; exact backend model request count and billed cost not exposed/measured. Two setup probes failed tool approval; one had measured usage and one did not. |
| Offline purchasing workload | 100 jobs in 999.6ms after setup; p50/p95 8.86/12.69ms; 90 mock confirmations, five shipping exceptions, five unresolved held outcomes | Deterministic adapters/mock approval, backoff bypassed; zero AI requests/real purchases; fixed 90%/10% ratios are not production rates. |

Planning estimates: at an assumed 5–10 active minutes per purchase and 50% utilization, one slot supports the arithmetic average of 100/week, 1–2 for 1,000/week, 5–10 for 5,000/week and 10–20 for 10,000/week. No distributed/hardware capacity measurement supports those figures yet. A token extrapolation from one mock case is explicitly a fixture estimate, not a dollar forecast.

Production crawl duration/cost/after-coverage, real feed latency, live native checkout coverage, live purchase/intervention/duplicate/settlement/fulfillment rates and container deployment are unavailable. Broad historical crawler tests remain separate: earlier 321/352 pass with missing private evidence/schema artifacts; the supported 183-test suite passes clean CI. No report claims an unchanged historical suite fully passes.

## Operating handoff and review

Read [crawler deployment](DEPLOYMENT.md) and [crawler impact](IMPACT_REPORT.md); [API deployment](https://github.com/allang/everycoffee-api/blob/codex/issue-1-api/docs/DEPLOYMENT.md) / [API impact](https://github.com/allang/everycoffee-api/blob/codex/issue-1-api/docs/IMPACT_REPORT.md); [agent deployment](https://github.com/allang/everycoffee-shopping-agent/blob/codex/issue-1-shopping-agent/docs/DEPLOYMENT.md) / [merchant contract](https://github.com/allang/everycoffee-shopping-agent/blob/codex/issue-1-shopping-agent/docs/MERCHANT_CONTRACT.md) / [agent impact](https://github.com/allang/everycoffee-shopping-agent/blob/codex/issue-1-shopping-agent/docs/IMPACT_REPORT.md).

Future rollout needs separately approved staging DB/migrations and non-owner roles, real Supabase auth and egress checks, verified merchant quote/checkout/customer-payment mapping, a secure credential broker for protected payment-ready sessions and target-environment Codex/browser doctor. No live merchant is registered; protected login/card entry, cross-origin checkout, 3DS/CAPTCHA and generic authoritative browser order search need integration/intervention. Docker packaging was not built on this host. Keep payment flags false until a separately authorized exact order is reviewed; never reset an ambiguous payment to ready.

Issue and every linked PR conversation, inline and review surface were checked before milestones and after pushes. No reviewer findings were present at the recorded checks; that is not review approval. WORK_LOG.md exists in all three repositories and the issue links resolving commits/CI. Final comment/status check follows publication of this report. No required authorized code work remains; deployment and real-order measurements are explicit future actions outside this implementation scope.
