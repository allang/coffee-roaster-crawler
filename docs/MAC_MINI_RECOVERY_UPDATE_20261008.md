# Mac Mini recovery-source installation — 2026-10-08

Merged main **`0a1cefb760b6d90e4dbde885fcf79a1d8da44438`** is installed and running in the original Mac Mini checkout. This includes [reviewed recovery PR #7](https://github.com/allang/coffee-roaster-crawler/pull/7), source `181ca65cd4a0da6ff1c3a5e5b953bbd0afcc0b2b`: bounded merchant HTTP 429/502/503/504 GET recovery and the precise weight-prefixed Passport pouch exclusion. The **prepared production index compatibility migration remains unapplied**. Latest-source full Passport revalidation and full live tier completion are not certified.

## Follow-up after a full hour

The single requested runtime audit at **17:57:29.429 UTC / 1:57:29 PM Eastern** occurred **3,822.469 seconds** after the latest resume request: one hour, three minutes and 42 seconds. Installed SHA/tree still match the reviewed recovery main; a fresh remote main lookup returned the same `0a1cefb760b6d90e4dbde885fcf79a1d8da44438`. The original checkout remains clean. LaunchAgent/lock **43736** owns exactly one Node **43745** in the original cwd; private configuration and plist remain byte-identical and the **5,400-second** schedule is unchanged. Logs were updated **15.783 seconds** before the audit. Actual current phase remains **tier 1**, initially 66 eligible roasters; no subsequent tier transition was observed.

| Scheduler-owned run since resume | Actual result at audit |
|---|---|
| Thankfully `e1b0dd0e-c21b-4b70-9057-434870a9f662` | Completed 16:57:46.076 UTC; **12 visited / 7 coffees / 5 irrelevant / 0 errors**; database error null; seven fresh product sightings |
| Moonwake `76e725a4-1895-4a7a-8d13-21beb5edf9ff` | Running since 17:01:03.831 UTC; **118 successful-save log events and 118 fresh product sightings**, latest 17:57:12.958 UTC; database error null; terminal counters unfinalized |

No failed scheduler run, severity-error/fatal entry or completed visitor page error was recorded since this resume. The active ordinary visitor does not print every returned page error, so this does **not** certify Moonwake's eventual zero-error outcome. Fresh product timestamps establish ongoing catalog writes; they do not prove complete inventories, SKU accuracy, source provenance, prices, origins or public images.

Warning classes remain separate: **11 optional Shopify JSON 404 warnings** on Thankfully, **272 HTTP 404 warning entries across 17 distinct previously known product paths**, three token-limit retry warnings on Moonwake, and three expected schema-compatibility fallback notices. The logged Thankfully availability reconciliation checked 18 records, recorded **17 removed / 1 unknown**, and reused seven current observations; those missing-page probes are separate from its completed visitor's zero page/save errors. Tier ordering uses the reviewed stable-ID manifest while the optional database tier/control fields are absent; normalized processing/co-ferment/source evidence remains in product metadata while the v2 processing RPC is unavailable. No other native JSON warning was observed. The [sanitized dated receipt](mac-mini-one-hour-health-20261008.json) includes exact run IDs, timestamps, counters and warning categories; complete raw logs remain private.

This audit was read-only and left the worker running. It created no automation, restarted no process, and neither queried nor changed schema. The coordinating thread's index-migration approval remained separately pending; the runtime result does not resolve the proven historical unique-weight save blocker or certify the full latest-source Passport gate. No matched performance improvement is inferred from these different roasters and unfinished work.

## Installed runtime and verification

| Observation | Actual result |
|---|---|
| Installed main / tree | `0a1cefb760b6d90e4dbde885fcf79a1d8da44438` / `1c3af8dd71d28a6720178c9a51093ff141178a15` |
| Pause / resume request | **16:53:12.664 / 16:53:46.960 UTC**; **34.296 seconds** |
| New Node startup | **16:53:47.157 UTC** (12:53:47 PM Eastern) |
| Launcher / lock / Node | **43736 / 43736 / 43745**; one scheduler-owned worker |
| Checkout / private configuration | Original cwd; clean fast-forward; byte-identical environment/plist |
| Schedule | Original **5,400-second / 90-minute** LaunchAgent |
| First phase | **Tier 1**, **66 eligible roasters**, matching unchanged cooldown behavior |
| First actual owner | Thankfully Coffee `7b9bba3a-d037-46b8-a27f-7849ba5f181f`, reviewed tier 1 |
| Fresh actual run | `e1b0dd0e-c21b-4b70-9057-434870a9f662`, running from **16:54:08.691 UTC** |
| Isolated local tests | **452 total / 451 pass / 0 fail / 1 skip**, **10.7116 seconds** |
| Installed local tests | **452 total / 451 pass / 0 fail / 1 skip**, **12.1538 seconds** |

The explicit skip is the isolated native PostgreSQL runtime, unavailable on this Mac. The equivalent **PGlite 18.3** compatibility/rollback contract test passed locally. The separately reviewed source passed **452/452**, including native PostgreSQL **17.11**; this report does not claim that native test ran here. Both [source PR checks](https://github.com/allang/coffee-roaster-crawler/pull/7/checks) succeeded. Dependency manifests/lock are unchanged from the prior tested installation; no redundant dependency reinstall. Shell syntax/diff checks passed.

Preserved Git bundle/refs/stash and private configuration/launcher/process/log/checkpoint evidence before changing the original checkout. The old scheduler launcher 36917 and Node 36926 exited and released their lock before installation. Only exact interrupted Shoebox run **`6a39edb0-85db-4677-8136-fd321d4db048`** was marked failed with the operator-update reason. Prior failed runs and successful catalog records are retained. No global cooldown, data or cache reset.

At **16:55:07.745 UTC**, new logs contained zero `ERROR`/fatal/failed-run entries. They did contain **five Shopify JSON 404 warnings** for Thankfully Coffee; these remain explicit in the receipt and are not classified as a completed clean crawl. That ordinary site's optional native JSON failed while the run continued. Startup and a running database row establish installation/process ownership, not full normal-run success or full-hour health. An hour after this new startup is **17:53:47 UTC / 1:53:47 PM Eastern**; the coordinating thread owns follow-up health work. No duplicate maintenance worker or health automation was created.

The human-authorized hourly readiness heartbeat was removed after this requested code installation and startup verification; it will not keep restarting the crawler. Prepared schema application remains a separate authorized action.

Later full normal Passport recovery on this installed source ended failed at 18:28 UTC: **255 visited /98 saved /157 errors**, after a primary 503 response; the exact prefixed-pouch case passed. The fresh successful subset verifies98 coffees/216 native AUD SKUs/65 decoded/hash-matching images; it does not satisfy full coverage. [Actual terminal attempt and diagnostic limits](MAC_MINI_PASSPORT_RECOVERY_ATTEMPT_20261008.md). The dated full-hour runtime receipt above remains a separate earlier observation.

## Actual preceding full-hour health

The prior human-forced restart at **15:41:48.177 UTC** ran the earlier main `28de9b5`. Observation after the full hour at **16:52:33 UTC** recorded:

| Previous normal run | Terminal visitor counts | Actual run status |
|---|---|---|
| Hydrangea `090e6f80-37a8-4fb7-a647-f66eaa256d57` | **28 visited / 22 coffees / 6 errors** | Failed |
| Taith `6233ab44-b1d1-4700-9c8e-c9e00793b9d8` | **31 / 26 / 5 errors** | Failed |
| DAK `37b2b4a2-9825-4e58-a3d1-5b700be6acfa` | No ordinary visitor summary captured | Completed |
| Loveless `c0f8baa3-b851-4aab-818c-55efc9dc597b` | **12 / 12 / 0 errors** | Completed |
| Obadiah `854a10c5-e03a-4420-90ec-6c52ff6baa0d` | **68 / 68 / 0 errors** | Completed |
| Shoebox `6a39edb0-85db-4677-8136-fd321d4db048` | In progress when source update paused it | Failed, operator-interrupted |

The ordinary visitor omits individual returned error causes. A later read-only retained Postgres log inspection **resolved that uncertainty**: all six Hydrangea and five Taith failures are SQLSTATE **23505** from `save_catalog_product_v1`, citing `product_variants_unique_weight_per_product`. Their exact product IDs/known weights were independently bound to the correct catalog owner or deterministic reviewed source identity. Hydrangea failures occurred at 15:47:23, 15:49:35, 15:50:00, 15:50:20, 15:51:23 and 15:53:01 UTC (227g, 114g, then four 227g conflicts); Taith failures at 16:02:34, 16:02:59, 16:03:24, 16:03:48 and 16:05:08 UTC all conflict at 100g. [Exact eleven-event receipt, product URLs and bindings](mac-mini-preceding-save-failures-20261008.json). These are actual coffee-save failures, distinct from the optional Thankfully JSON-404 warnings. A separate 16:06:13 UTC SQLSTATE 57014 sample is not a saver RPC and is not counted among them. Failed-run database counters were never finalized and cannot substitute for terminal visitor logs. These measurements belong to the **previous source**, not the newly installed recovery. The [Passport failed-run and successful-subset report](MAC_MINI_PASSPORT_FAILURE_20261008.md) remains historical evidence: 193 successful products / 387 native AUD SKUs / 133 verified public images, with the full gate failed.

## Fresh read-only schema and IPv4 connection preflight

A read-only query at **16:50:40.886542 UTC** confirms project **gtlipifdfyugiwpxvuse**, production **PostgreSQL 17.6**, current role **postgres**. Both targeted indexes are **unique, valid and ready**, owned by **postgres**, on `public.product_variants` owned by **postgres**, with **no pg_constraint ownership**. Exact definitions remain:

```sql
CREATE UNIQUE INDEX product_variants_unique_weight_per_product
ON public.product_variants USING btree (product_id, weight_g)
WHERE (weight_g IS NOT NULL);

CREATE UNIQUE INDEX variants_source_key_unique
ON public.product_variants USING btree (product_id, source_key)
WHERE (source_key IS NOT NULL);
```

`information_schema` independently reports `product_id uuid NOT NULL`, `weight_g integer NULL`, `source_key text NULL`, `merchant_variant_id text NULL`. The [fresh preflight receipt](native-variant-weight-production-preflight-20261008.json) includes `pg_get_indexdef`, validity/readiness/uniqueness, ownership and constraint evidence. No DDL or catalog mutation was performed by this inspection.

The actual project Connect panel advertises an existing **IPv4 session pooler**: **`aws-1-us-east-2.pooler.supabase.com:5432`**, database **postgres**, user **`postgres.gtlipifdfyugiwpxvuse`**. DNS returned IPv4 addresses and a TCP connection succeeded from this Mac. This does not prove password authentication or reachability from the other host. No password was read, transferred, entered or reset; the observed endpoint is `aws-1`, not a guessed regional pooler. The existing authenticated SQL browser also supplied the read-only preflight.

`supabase/migrations/20261008155858_native_variant_weight_compat.sql` remains **prepared only**. It preserves source-key uniqueness and legacy no-source-key weight uniqueness, with exact-schema guards and rollback instructions; [reviewed plan](NATIVE_VARIANT_WEIGHT_COMPATIBILITY.md). Production application requires separate authorization and a fresh application-time preflight. Known weights and distinct legitimate native SKUs have not been nulled/deleted as a workaround. Until that compatibility change is applied, legitimate same-weight options remain a known catalog persistence blocker.

Canonical reviewed Passport evidence is now **255 coffees / 528 coffee SKUs** after removing the exact prefixed pouch. Eight accessory-bearing source subsets remain explicitly incomplete and global omission reconciliation remains disabled. A fresh full normal run/readback still needs to confirm the latest code and current inventory; historical failures are not relabeled or made complete by the source update.

No hosted services or purchase workers were deployed; no real purchase, production schema application or unrelated source/configuration rewrite. [Aggregate installation and preceding-health receipt](mac-mini-recovery-update-20261008.json). Exact documentation commits/reviews/checks are linked in [issue #1](https://github.com/allang/coffee-roaster-crawler/issues/1).
