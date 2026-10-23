# Crawler AI calls and elapsed time — October 23, 2026

The crawl is making avoidable model requests and spending too long waiting on remote services. This change addresses cache loss, noisy cache invalidation, model request budgets and excessive HTTP cooldown waits. It keeps the existing model and extraction/English translation contract. The running crawler has not been updated or restarted for this work.

## What the live evidence establishes

Read-only investigation on October 23 used the installed source `a569c75d8e9fcfe92a9303da1a0f917d2edaec2a`, completed crawl metrics and `crawler-2026-10-21.log`. The log count below was rechecked at 05:06:20 UTC.

| Observation | Measured value |
| --- | ---: |
| Philocoffea elapsed time | 14h 15m (14.257656 hours) |
| Philocoffea visited pages | 546 |
| Philocoffea successful coffee-page saves | 123 |
| Philocoffea recorded AI requests | 1,509 |
| Philocoffea extraction cache hits | 0 |
| Philocoffea output-limit recovery warnings/extra requests | 530 |
| Philocoffea transient model retries | 3 |
| Philocoffea translation validation errors | 279 |

The 738-page figure belongs to Sey, a separate failed merchant attempt. It must not be combined with Philocoffea's duration or request count. A saved coffee counter includes refreshes; it is not a count of independently verified new coffees. Failed merchant rows do not currently retain all of the same request metrics, so these are not whole-fleet totals.

One coffee page can invoke extraction and then English translation/validation. Each stage can also make one output-limit recovery request. The 530 recoveries account for 35.1% of Philocoffea's recorded requests; these were not ordinary transient failures. Historical logs do not label extraction versus translation for each recovery, so an exact stage split is unavailable. The new diagnostics label the operation. The 279 validation errors indicate rejected translations, not successful saves or necessarily additional internal retries.

Elapsed time includes HTTP waits, model requests and recovery, translation, database calls, and failed work. A four-roaster setting permits four merchant pipelines, with one page at a time in each. It does not create four page workers for one slow merchant. Tier barriers can leave other slots idle behind the last merchant in a tier. The existing 90-minute launch interval does not terminate an active crawl after 90 minutes.

## Changes

1. Cache valid extraction before translation/catalog persistence. Cache validated, exact-source translation before the catalog transaction. A later database failure can retry persistence without paying for the same successful model work again. A known-page coffee classification is not evidence of a successful catalog save or complete inventory. Hard 404/410 observations update only existing catalog stock; they cannot create an unsaved cached product or retranslate/rewrite its old content.
2. Exclude recognized cart, recommendations, cookie and search UI from the semantic fingerprint and model input. Keep unrecognized body text, native descriptions, product identity and variant labels. Retain page-title evidence when a structured product identity is unavailable. Real descriptions, labels or other source-fact changes still invalidate extraction. The seven-day expiration and model pin remain in force.
3. Upgrade old extraction caches only when their exact previous fingerprint still matches. Changed legacy inputs require extraction once; the new cache cannot safely infer that an old difference was only cart noise.
4. Set supported GPT-5 models to explicit `low` reasoning. Preserve `gpt-5-mini`; no model migration. Default to one transient retry and a 90-second timeout per request, while preserving explicit operator overrides. Retain one output-limit recovery and usage accounting. Permanent API errors cannot accidentally retry merely because their message contains “rate” or “timeout.”
5. Defer a merchant when its HTTP Retry-After exceeds the configured backoff budget (30 seconds by default), rather than holding a worker for potentially hours. Respect shorter server cooldowns exactly. Do not bypass the long cooldown using a different URL or proxy. The page result reports incomplete/deferred work and does not authorize omission reconciliation.

The current source did not specify reasoning effort. [OpenAI's GPT-5 guide](https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_new_params_and_tools) documents a medium default, and [the reasoning guide](https://developers.openai.com/api/docs/guides/reasoning) describes the speed/token tradeoff from reducing effort. Whether `low` reduces these particular truncations without reducing extraction quality still requires a bounded live evaluation. The offline tests do not establish that result.

Current native price, currency, stock and product images are rebuilt on every fetch. Cached coffee semantics require current structured variant evidence or the existing reviewed product-only offer path. Pages lacking that evidence still require fresh inference. English validation and original-language retention remain mandatory; Latin characters alone do not establish that a page is English. Partial structured data does not bypass the full coffee-fact contract.

## Measured offline request avoidance

The repeatable replay uses the actual visitor, extraction, translation, saver and transactional catalog code, comparing the installed source SHA above with this branch. Merchant/model/image boundaries are deterministic fixtures; PGlite is an isolated local database. No merchant or paid model request, production write or live crawl is part of the replay.

| Scenario | Baseline requests by attempt | Updated requests by attempt | Total reduction |
| --- | --- | --- | ---: |
| Initial visit, then cart changes plus fresh price/stock | 2, 1 | 2, 0 | 3 → 2 (33.3%) |
| Two failed catalog saves, then recovery | 2, 2, 2 | 2, 0, 0 | 6 → 2 (66.7%) |

Both versions finish with identical variant data: two separate native 250g SKUs, one updated to EUR 14.00/sold out and the other EUR 12.00/in stock. The failure case deliberately reproduces the old global weight uniqueness constraint, then applies the existing compatibility migration only inside the test database. Production migration state is untouched. Additional regressions cover changed source facts/labels, title-only evidence, legacy upgrade, incomplete current market evidence, malformed translations, exact-source checks and retry limits.

[Aggregate replay output](ai-efficiency-replay-20261023.json). Reproduce from this checkout with existing lockfile dependencies:

```sh
npm test
node scripts/benchmark-ai-efficiency.cjs a569c75d8e9fcfe92a9303da1a0f917d2edaec2a /tmp/ai-efficiency-replay.json
```

Full supported suite: **513 total / 512 pass / 0 fail / 1 optional native PostgreSQL skip**, 13.491 seconds. PGlite transactional contracts pass. Tests ran with production/model credentials removed; no dependencies were added.

These percentages describe the two fixtures, not expected fleet savings. They cannot convert the 14-hour crawl into a defensible new duration. No live output-quality comparison, billed dollar saving or production speedup is claimed. Avoiding all 530 recoveries would be an upper-bound opportunity of 530 requests for this observed attempt, not a measured or promised result.

## Installation and remaining constraints

This branch is stacked on `codex/four-roaster-concurrency`, preserving the installed priority, concurrency and reviewed tier changes. Review that dependency when integrating into main. No package or migration changes are required for the cache/request policy changes themselves.

For an eventual authorized rollout: preserve the live checkout/configuration, park all active pipelines after returned writes, stop the existing launcher/worker and verify the lock is gone, then fast-forward to the reviewed integrated source. Do not reset the live branch or overwrite remote work. Keep the existing model, four roaster workers, one page worker, output allowance and schedule. The new defaults can be made explicit:

```dotenv
OPENAI_REASONING_EFFORT=low
OPENAI_MAX_TRANSIENT_RETRIES=1
OPENAI_REQUEST_TIMEOUT_MS=90000
```

Run the offline tests without production/model credentials. Resume only one normal launcher, then use a small matched live cohort to measure requests, truncation rate, successful saves, semantic quality, elapsed time and current stock/price. Compare first and cached passes separately. Restore the preserved source/settings if translation/extraction correctness regresses. This document describes the rollout; this task did not perform it or schedule a monitor.

The unapplied native-weight compatibility migration still blocks legitimate separate SKUs sharing a weight. This change retains reusable AI results across that failure; it does not make the database accept those writes. Proxy HTTP 402 failures and merchant/network failures also remain separate constraints. The current tier barrier and failed-run metric retention are unchanged. Those facts limit a full-run speed estimate; they are not reasons to discard coffee facts, fabricate weights or apply production migrations in this task.
