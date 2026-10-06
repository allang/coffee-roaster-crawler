# Crawler impact report — 2026-10-06

Scope and authorization: https://github.com/allang/coffee-roaster-crawler/issues/1. These changes are on a review branch and remain undeployed. The production crawler still uses its original checkout.

## Measured offline correctness and coverage

The reproducible comparison uses actual functions from preserved baseline commit `98f5aeaceea95016f0d5f7a1131ad71867d5c3c2` and current code. Database transports in that comparison are simulated. Fixtures target known failure modes; they are not a representative merchant sample. Run `node scripts/compare-fixtures.cjs` from a full-history checkout. Detailed observations are in `fixture-comparison.cjs`.

| Metric | Preserved baseline | Proposed code | Evidence / limit |
|---|---:|---:|---|
| Paired amount/currency and ISO minor-unit correctness | 3/8 cases | 8/8 cases | Decimal comma/grouping, unknown $, dirty EUR label, JPY/KWD, range rejection. Legacy hundredths are compared with the new explicit ISO minor-unit field; historical price_cents is not silently reinterpreted. |
| Product-scoped availability correctness | 2/7 cases | 7/7 cases | Unknown/missing stock, unrelated recommended product, exact native stock, removal. |
| Reusable regression suite | 139 pass before new tests | 178 pass after changes | Includes local Postgres migrations/RPCs, permissions, rollback, stale writes, legacy IDs/media/facts and both crawler paths. |
| Attribute coverage on shared-flow fixtures | Contract formerly extracted through AI | Every populated contract field retained in both paths | 17 named attributes include typed decaf, process versus variety, descriptions, harvest, notes and original image source. Null fields remain unknown; no claim of new real-merchant coverage. |
| Exact same-weight grind variants | Legacy saver collapsed by weight | Both fixture variants retained | Stable source IDs survive stock/price refresh and title edits. |
| Repeat image source requests | Legacy checks hashes after download | One download/upload across two requests | Local Postgres and simulated image transport; stale cache downloads again without another upload. |
| Full structured attribute fixture | AI route required by old orchestration | 0 classifier invocations | Complete source contract only. Partial contracts still fall back to AI. |
| Warm semantic fixture with changed price/stock | Known pages skipped semantic work | 0 additional classifier invocations; price/stock updated | Both sitemap and BFS exercised with simulated classifier and HTTP transport. |

The comparison invocation recorded approximately 90 ms locally. This is a CPU/VM fixture comparison, **not crawl duration**. The integrated suite runs in a few seconds locally; hardware/load affect that duration. The earlier broad historical run passed 321/352; evidence-bound scripts need private local historical snapshots/schema artifacts. Those tests are retained separately as `npm run test:historical`, with no claim that the broad historical suite passes in a clean clone. A fixture-timestamp regression at `fe69660a4130062c4be44a6a652267d72bbfb643` was corrected without weakening stale-write rejection; see WORK_LOG.md.

## Measured read-only production baseline

`catalog-baseline-summary.cjs` records an aggregate-only convenience sample of the 100 most recently seen active coffees at 2026-10-06T13:49:13Z. There were 167 variants, 154 non-null legacy prices (92.2%), 112 non-null weights (67.1%), 79 products with origin metadata and 83 with tasting-note metadata. Currency values included the malformed `EUR €`. All 167 variants were labelled `in_stock` by the old schema. These labels are **not verified live stock** and should not be treated as a purchasing benchmark. No raw rows or credentials were published.

Production after-coverage is unavailable while this branch stays undeployed. Titles remain original for identity/audit; separate display titles, versioned note categories and raw unmapped phrases are available after an authorized rollout. Legacy ambiguous identities require manual resolution rather than automatic merges.

## Actual AI usage, estimates and unavailable measurements

Actual paid AI requests/tokens during this offline verification: **0 / 0**. Simulated classifier counters in tests prove accounting and routing, not production model quality or billed cost. Crawl metrics now store request/retry counts and API-reported prompt/completion/cache tokens in `crawl_runs.meta.extraction`; retries lacking a usage response stay explicitly unreported. Usage shape follows the [OpenAI Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

Production crawl duration, actual production AI requests/tokens/cost and percentage savings are **unavailable**. Existing visited-page counters are not reliable AI-call evidence. Do not infer 100% savings from a complete structured fixture. Expected directional benefits are fewer classification calls for unchanged/fully structured pages, no duplicate image downloads within the cache lifetime, and fewer destructive database operations. These are hypotheses until a controlled, authorized rollout measures them.

For a future measured cost report: chargeable uncached prompt tokens × input rate + cached prompt tokens × cache rate + completion tokens × output rate, each per million tokens. Use current rates for the actual model/tier and state the observation window. Missing usage means an incomplete cost estimate. No numeric production savings estimate is claimed here.

Feed latency and purchasing success/intervention rates belong to subsequent repositories. They are currently unavailable; real order benchmarks require specific order authorization and are not part of this implementation run.

## Remaining limitations and deployment gates

Use DEPLOYMENT.md before any separately authorized staging/production action. PGlite validates actual SQL/PLpgSQL behavior; it is not a Supabase integration or multi-host concurrency benchmark. Current merchant fixtures do not prove broad storefront coverage, AI semantic correctness or live price/stock accuracy. Currency evidence remains unknown where merchant JSON/HTML does not provide it. Generic pages without product-scoped evidence remain unknown rather than being guessed available. The first deployment needs the additive migration and consumers updated to use `price_minor_units`, `currency_exponent` and `availability_state`. Public catalog RLS policies/roles must be checked in staging; no production policy changes were made.

Follow-up verification now passes 178 tests. Shopify stock flags are joined from the documented locale-aware Ajax endpoint by exact product/variant ID. Its monetary integers are not mixed with decimal product JSON prices; capped/mismatched lists cannot prove retirement. This adds a stock GET, so overall production crawl latency/cost remains unmeasured. See the [Ajax Product reference](https://shopify.dev/docs/api/ajax/reference/product) and [variant monetary representation](https://shopify.dev/docs/api/liquid/objects/variant).
