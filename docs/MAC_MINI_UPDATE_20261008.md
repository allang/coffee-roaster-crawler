# Mac Mini crawler update — 2026-10-08

**Superseded runtime:** recovery main `0a1cefb760b6d90e4dbde885fcf79a1d8da44438` is now installed and running after a 34.296-second pause, startup **16:53:47.157 UTC**, launcher/lock **43736**, Node **43745**. Installed tests: 451 passed, zero failures, one explicit unavailable native-runtime skip. The prepared compatibility migration is unapplied. See the [recovery installation, actual preceding errors and fresh index preflight](MAC_MINI_RECOVERY_UPDATE_20261008.md). The observations below are dated earlier installation/restart history.

**Latest direct-user restart:** fetched origin again; main is still `28de9b55a1c039a5b3581a9595357d0fe4cf1095`, already installed and unchanged from the 406-test verification. Forced a fresh scheduler-owned launch at **15:41:48.177 UTC**, Node startup **15:41:48.552 UTC**. Current launcher/lock **36917**, Node **36926**, one worker, unchanged 90-minute schedule/configuration, tier 1 first with 69 eligible roasters and a fresh running database crawl row; zero logged errors at 15:42:59.206 UTC. Old worker/lock exited; only its exact interrupted run was marked failed. Passport was preserved during restart and subsequently finished failed at 15:42:41.324 UTC. Its [terminal report](MAC_MINI_PASSPORT_FAILURE_20261008.md) records 193 successful saves and 62 errors; full coverage remains incomplete. [New restart receipt](mac-mini-restart-20261008.json). The installation observations below remain dated evidence of the preceding update; they are not the new worker's PIDs. Hydrangea later failed at 15:54:10.252 UTC with six page errors; the worker continued to Taith. The current global same-weight uniqueness index was confirmed read-only and needs a reviewed compatibility plan. See the terminal report for exact evidence and cause limits. A full hour after the fresh restart is 16:41:48 UTC; no duplicate automation was created.

Installed exact merged main **`28de9b55a1c039a5b3581a9595357d0fe4cf1095`**, tree `2d157172b100eb94ce8f92d7696d5f71cfa500a0`, byte-identical to independently tested source `003a60c775832a0e938a752129141eda5f01f15f`. [Merged-main CI passed](https://github.com/allang/coffee-roaster-crawler/actions/runs/37789119163/job/113351457354). Installed verification passed **406/406 tests**, zero failures/skips, **9.234 seconds**; isolated verification passed 406/406 in 9.172 seconds. Locked dependency installation, shell syntax and diff checks passed; npm reported zero dependency vulnerabilities.

Fresh human instruction was to install latest now, leave the crawler running, and inspect errors after an hour. This waived the earlier final-Passport completion gate for the local update. Passport's progressing isolated verification was left running and subsequently finished failed; its full gate remains incomplete. The terminal report distinguishes verified successful saves from missing pages. This report does not certify all four merchants, whole live tier transitions or historical catalog cleanup.

## Actual runtime

| Check | Observed |
|---|---|
| Installation verified / resume requested | 2026-10-08 **15:29:36.836 UTC** |
| New crawler startup | **15:29:37.046 UTC** |
| Pause | 15:28:28.239–15:29:36.836 UTC; **68.597 seconds** |
| LaunchAgent | `com.openclaw.coffee-roaster-crawler`, running |
| Launcher / lock owner | **35205** |
| Scheduler-owned Node | **35215**, original checkout cwd |
| Parallel roaster workers / interval | **1 / 5,400 seconds** |
| First phase | **Tier 1**, **69 eligible roasters** |
| First actual roaster ID | `0abbc586-467e-4bfe-b431-248941145733`, reviewed tier 1 |
| Fresh startup errors | **0** at the receipt timestamp |
| Configuration / plist / working tree | Byte-identical configuration and plist; clean checkout |

Original HEAD `d676de561005c90ecf96af123d20068374e6af88`, Git history/refs/stash, configuration, launcher, launch-agent file, active log and lock/process evidence were preserved privately. Earlier unpublished-work preservation remains recoverable. The update was a local fast-forward; no remote work was overwritten or force-pushed. The old launcher/Node exited and removed their lock first. Only interrupted scheduler run `5342638b-154d-400b-aec1-170506bf784a` was marked failed with an operator-pause reason; saved records/checkpoints and historical stale runs remain preserved.

Model `gpt-5-mini`, credentials, initial 4,000-token output limit, 6,000-character classifier setting, one worker and scheduler ownership remain unchanged. Reviewed source permits one bounded 8,000-token recovery request after actual output truncation and counts both requests' reported usage. Other empty/invalid/refused/authorization failures remain failures. No new SQL was applied. Installed transactional v1 retains normalized processing/evidence in metadata when the precise missing-v2 response selects compatibility mode. Tier ordering uses the reviewed stable-ID mapping while the optional tier column is absent.

The delegating thread is arranging the one-hour error check, retimed after the forced restart to approximately **16:42 UTC**; this thread created no duplicate automation. Startup is not that future check. [Aggregate runtime/product receipt](mac-mini-update-20261008.json) retains actual timestamps, test results, source identity, lock ownership and scope.

## Product verification

Fresh readbacks at **14:16:32.773 UTC** passed for Aery **18 coffees / 18 native SKUs**, Apiary **6 / 6**, Colorfull **14 / 27**: **38 current source coffees / 51 exact native SKUs** and **42 distinct public linked images / 10,229,120 decoded bytes**. Checked exact ownership/native IDs, USD amount/currency/minor-unit/exponent tuples, fresh stock states/check times, process/co-ferment/ingredient/evidence metadata, primary source image URLs, pixel decoding and stored MD5 matches. Baseline Colorfull product/variant UUIDs, creation times and slugs remain preserved. Its totals increased from 16 products / 26 variants to 24 / 41; eight stable rows were added, without claiming eight distinct new coffees after legacy deduplication.

Aery/Apiary executed processing correction `4fa7eba395196ffd2f0e8173b343feb7d4e07198`; Colorfull executed preceding main `73d857ca391f56a928d754bdacea1197b66ed582` with a private recovery observer. Successful run IDs, durations, actual AI calls/cache hits and tokens remain in the receipt; these are not relabeled as final-main runs or a matched speed comparison.

Passport's normal source `003a60c` run **finished failed at 15:42:41.324 UTC**, with **255 visited / 193 successful saves / 62 errors** (53 HTTP 429, eight HTTP 503 and one accessory-related unique-weight save failure). The earlier running checkpoint's zero-error figure omitted failures before extraction and was incomplete. A separate fresh successful-subset readback passed **193 products / 387 native AUD variants / 133 public decoded/hash-matching images**; the full **255-product** gate remains failed. The prior 529-SKU target contains the discovered non-coffee pouch; the corrected captured baseline is 528 coffee SKUs, pending fresh full-run revalidation. Six targeted failed/interrupted runs remain truthful and preserved. See the [terminal receipt, exact causes and limits](MAC_MINI_PASSPORT_FAILURE_20261008.md). Initial interrupted model usage is incomplete; no total account billing claim is made. Whole tier transitions and thousands of queued roasters have not completed.

The [previous matched ten-roaster performance report](LOCAL_RUN_REPORT.md) retains its measured releases and caveats. This update changes merchant coverage, processing and output recovery; no new matched speed/cost savings percentage is claimed.

## Processing and cleanup cost

Raw process remains in `coffee_facts.process`. New observations retain separate `process_methods`, nullable `is_coferment`, disclosed `coferment_ingredients` and versioned source evidence in `products.metadata`. Natural and anaerobic can coexist. Co-ferment is true when disclosed, false only when explicitly denied, and unknown otherwise. Anaerobic fermentation and fruit tasting notes alone do not set it. Source `4fa7eba` excludes negated processing labels from positive methods. The prepared typed-column migration remains unapplied; compatibility retains these attributes without it.

```sql
select p.id, p.name, f.process,
       p.metadata->>'country_of_origin' as origin,
       p.metadata->'process_methods' as methods,
       p.metadata->'is_coferment' as coferment,
       p.metadata->'coferment_ingredients' as ingredients
from products p join coffee_facts f on f.product_id = p.id
where p.metadata->'process_methods' @> '["anaerobic"]'::jsonb
   or p.metadata->'is_coferment' = 'true'::jsonb;
```

The [October 7 latest-1,000 audit](PROCESSING_AND_CATALOG_AUDIT.md) found **665 missing processes**, **337 missing metadata origins**, and **416 incomplete money tuples among 1,858 variants**. Presence/arithmetic does not certify current prices, exact variant mapping or correct origins. Source-based cleanup must preserve blends/multiple origins, exact native SKUs, old/new values, quoted evidence, uncertainty and paid usage. No paid historical bulk cleanup was applied.

| Source-check scope | Estimated model API cost |
|---|---:|
| 1,000 coffees | **$3.13–$8.75** |
| 10,000 coffees | **$31.25–$87.50** |

Uses [published gpt-5-mini pricing](https://developers.openai.com/api/docs/models/gpt-5-mini): $0.25/million input, $2/million billed output, assuming one 2,000–4,000-input / 1,000–3,000-output call per coffee and a 25% retry allowance. Reasoning is included in output. Estimates are not hard caps or invoices; long recovery can exceed those assumptions. Proxy, bandwidth, runtime and manual review are excluded. A recent 1,000-coffee source-check pilot should measure actual usage before scaling.

No hosted website/API/purchasing deployment, additional production migration, purchasing-worker activation or real purchase occurred. Raw data, diagnostics, credentials and runtime logs remain private. [Issue #1](https://github.com/allang/coffee-roaster-crawler/issues/1) links resolving/report commits and reviewer comments.
