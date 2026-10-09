# Latest-source Passport recovery attempt — 2026-10-08

The full normal Passport attempt on **`0a1cefb760b6d90e4dbde885fcf79a1d8da44438`** ended **failed**, run **`c7f38e4d-99b3-4c1b-841c-0dd3f307d1e0`**. Actual terminal visitor: **255 visited / 98 coffees / 0 irrelevant / 157 errors**. It ran **18:03:39.022–18:28:09.382 UTC**, **1,470.360 seconds**. Isolated Node 49636 exited naturally; session 3075 exit 1. It has not been restarted. Failed database counters were never finalized and do not replace this terminal summary.

## Verified fixes and successful subset

Read-only preflight checked all 213 retained products / 435 variants and 212 known pages against the corrected 255-product / 528-coffee-SKU source. Simulated actual v1 native/legacy adoption and the original global weight guard: **zero conflicts**. Retained saved records, classification/media caches and every historical failed run. Normal registered discovery visited the complete 255-product coffee scope, with one page/roaster worker alongside the existing scheduler; no selected failed-page retry or cache/cooldown reset.

The observer recorded **98 successful saves / zero save errors**, 61 cached classifications and 37 fresh classifications. Fresh readback at **18:32:02.130 UTC passed the successful subset**: **98 coffees / 216 exact native AUD SKUs / 65 decoded, MD5-matching public images / 34,280,210 bytes**, zero verification failures. Current native prices/currency/stock, known weights and variant names/IDs, normalized processing/co-ferment/ingredients/origin/evidence and primary source photo URLs match captured projections. Existing product/variant IDs, creation times and slugs remain preserved. This proves storage consistency with current source observations, not independent origin/processing truth or whole-catalog accuracy.

There are **36 new stable product rows** relative to this attempt's baseline; retained catalog totals are **249 products / 516 variants**, including earlier attempts. Those totals do not establish a complete fresh run or the full 528-SKU gate.

The previously failing prefixed-pouch product saved successfully through the normal pipeline, observation **18:26:28.612 UTC**, product `1bba62e7-0bf8-58da-9676-f72eabbff8d8`:

| Coffee native ID | Known net mass | Current price | Stock |
|---|---|---|---|
| `46537133424801` | 125g | AUD 36.00 | In stock |
| `44906648764577` | 250g | AUD 60.00 | In stock |
| `44906648797345` | 1,000g | AUD 218.00 | In stock |

The exact prefixed pouch is excluded. All **eight** accessory-bearing subsets were encountered and remain **variants_complete=false**. Both global omission guards remain disabled. No known-weight nulling, invented coffee SKU, historical failure relabeling or production DDL was used.

## Actual terminal blocker and diagnostic limits

Fourteen observed native HTTP429 responses recovered before the later failure. The last merchant response was a **primary HTML HTTP503 at 18:26:46.114 UTC** for `/products/colombia-wilton-benitez-red-bourbon-ea-locaf-espresso`; no subsequent merchant fetch appears in the run's request ledger before its failure. The ordinary visitor does not print individual returned page errors. The observer did not retain that response's Retry-After header. The pattern is consistent with shared host cooldown rejecting later reads, but **all 157 exact individual error causes and the historical Retry-After remain unproved**.

A fresh guarded GET at **18:32:07.440 UTC** returned **503 / Retry-After: 123 seconds**. An offline injected-header replay of the actual reader produced `retry_after_limit` on that response and `Merchant cooldown exceeds read time budget` on the following read without another simulated fetch. This verifies the relevant fail-closed branch; it does not turn the unrecorded historical header into fact. The reviewed reader preserves excessive finite Retry-After and limits read waits; these controls were not bypassed in crawler code.

Subsequent guarded diagnostics at **18:34:00.357 and 18:34:01.013 UTC** returned **200** for the failed URL and the previously visited flight product. Those current GETs show that the merchant response recovered; they are not a successful full rerun. No automatic paid full retry, new model setting, migration, scheduler restart or extra automation followed this failure. Keep the full latest-source gate **failed** until a new normal full run and fresh complete readback actually pass. Any future observer should retain reader-returned errors and selected response headers so cooldown failures can be classified directly.

Re-ran the relevant guarded-reader suite after this new runtime failure: **41/41 tests passed**, zero skips/failures, including excessive Retry-After, inherited cooldown, queued dispatch and elapsed-budget cases. No crawler source change was made. Earlier installed verification remains 451 passing tests with one explicit unavailable native-PostgreSQL-runtime skip.

## Measured performance and limits

This attempt used **40 model responses**: 37 stop / three length responses with bounded recovery, no HTTP model failures and no unreported usage. Measured usage: **68,385 input / 5,120 cached input / 135,492 output / 101,600 reasoning tokens**. API response usage is not an invoice.

The earlier full failed attempt took 5,978.088 seconds and saved 193 coffees with 62 errors, using 191 model responses / 342,939 input / 619,219 output tokens. The current shorter attempt saved fewer coffees, retained classification/media caches, and stopped after a different merchant failure. **No matched speedup, cost reduction or full inventory improvement is inferred from these two failed attempts.** Measured positive evidence is narrower: observed transient429 recovery and the exact three-coffee-SKU prefixed-pouch save; the full gate still failed.

The original scheduler remained running on source 0a1cefb, launcher/lock 43736 / Node 43745. At the fresh **18:29:20.126 UTC** handoff it was on Coffee Collective owner `39a6bb46-ad09-41ee-84e5-54320d2263d7`, run `e16f5158-ea3e-4576-9fa7-b63e35511fb1`, running since 18:24:04.952 UTC, error null, outside the six proposed duplicate-merge owners. Moonwake had completed 164 visited /145 coffees /19 irrelevant /0 errors; Little Wolf 30/18/12/0. Separate failed scheduler run `de1d47e3-4969-4c9a-9358-eb35525923ee` reports supported Shopify collection discovery failure; it is distinct from this Passport attempt. No additional job was started for any proposed duplicate-merge owner. The coordinating thread owns its tested merge/pause/install plan.

[Sanitized aggregate receipt](mac-mini-passport-recovery-attempt-20261008.json), [terminal issue log](https://github.com/allang/coffee-roaster-crawler/issues/1#issuecomment-6066473476), and [review PR #6](https://github.com/allang/coffee-roaster-crawler/pull/6). Raw checkpoints, source/native observations and full logs remain private. Pending global-weight/typed-processing schema work and whole-tier verification remain separate; no deployment or purchase.
