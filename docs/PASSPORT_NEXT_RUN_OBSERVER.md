# Passport observation preparation — 2026-10-08

Prepared operator tooling for the next explicitly authorized full normal Passport run. **No new crawl or model call was started**, no source was installed, and the existing Mac Mini scheduler remains running at `ff26496077ec348fc162dcb2e74ea1ccb7b477c5`. The failed C7 receipt is preserved unchanged. This preparation does not implement the coordinating thread's separate bounded job-cooldown source fix or apply the pending variant-weight migration.

## Actual C7 evidence and its limits

C7 (`c7f38e4d-99b3-4c1b-841c-0dd3f307d1e0`, source `0a1cefb760b6d90e4dbde885fcf79a1d8da44438`) ended failed: 255 visited, 98 coffees saved, 157 page errors, zero save errors. Its merchant wire records retained only `{at, method, url, status}`; model records also retained classification scope and response usage/finish metadata. It did **not** retain response headers, `createReader.requests`, or individual returned reader/page errors. Extraction observations cover pages reaching extraction and cannot explain pages that failed earlier.

The actual last failed merchant record is:

```json
{"at":"2026-10-08T18:26:46.114Z","method":"GET","url":"https://passportcoffee.com.au/products/colombia-wilton-benitez-red-bourbon-ea-locaf-espresso","status":503}
```

No later merchant fetch appears in that ledger. Historical Retry-After and exact attribution of all 157 errors remain unknown. A **separate** guarded diagnostic at18:32:07.440 UTC retained503 / raw `retry-after: "123"` / server date / content type. Its reader ledger retained `retryAfterMs:123000`, `retryDelayMs:123000`, `retryStopped:"retry_limit"`; that single-request diagnostic deliberately disabled retries. The offline default-reader test instead retains `retryStopped:"retry_after_limit"`, followed by a zero-attempt returned cooldown error. Neither diagnostic proves C7's historical header. [Factual shape and original diagnostic record](passport-c7-observation-shape-20261008.json).

## What the prepared observer records

`scripts/passport-observation.cjs` wraps the actual reader factory before the normal crawler loads. It forwards existing options, timing, retries, destination/DNS guards and returned objects. It records each wire response's allowlisted raw `retry-after`, `date` and `content-type` headers; each settled `fetchHtml` return or thrown error, including failures that make **zero** GETs; and every field in the actual reader request ledger after retry metadata has been finalized. Reader/read IDs correlate wire responses to returns. Body text is omitted from read-result records, retaining length/hash instead. Periodic checkpoints retain the active ledger during long waits. No cookie or authorization header is collected.

`scripts/observe-passport-run.cjs` calls real `crawlRoaster` with the database owner and normal full registered discovery. It does not select only formerly failed pages, clear known-page/media caches, change model/concurrency settings, or rewrite product/variant payloads. It retains baseline and after-readback products, variants, facts, media, known pages and run rows; normalized save/source observations; actual normal visitation URLs/metrics; structured Visitor/error/deferred events emitted by the reviewed source; and measured model response usage. Fresh market observations still follow the normal transactional saver.

The observer rejects page errors, residual deferred/pending pages, unvisited URLs or incomplete inventory **before** normal completion/reconciliation. The normal crawler failure path records the new run failed; existing saved checkpoints remain. It also blocks any attempted Passport omission reconciliation regardless of the run outcome. Reviewed accessory-bearing variant subsets remain intentionally incomplete and do not themselves mean that pages were deferred. The prepared observer adds no retry, wait, resume or model override of its own.

`normal_run_succeeded` is the pipeline/completeness gate. `full_catalog_readback_passed` remains **false** until a separate fresh ID/native-SKU/money/stock/weight/processing/photo validator passes. Do not use the old verifier unchanged: its source/PID assumptions are obsolete. Receipt-compatible `results`, `requests`, `saves` and `source_pages` are retained, with new reader/visit/event observations alongside them.

## Future execution gate

Without `--execute-reviewed-crawl`, the runner prints preparation status and makes no filesystem, network, model or catalog action. Activation requires the exact clean reviewed code SHA; a fresh (15-minute) read-only compatibility preflight bound to that SHA and owner, zero legacy-weight collisions and no active Passport run; original single-worker/page settings and unchanged Passport omission guards; and one existing scheduler-owned worker. The tested source checkout can be separate from the actual running checkout. Only a new private0700/0600 output directory is used. The runner neither updates nor restarts the scheduler.

After the coordinating thread supplies the tested fix and authorizes the run, use:

```sh
node scripts/observe-passport-run.cjs --execute-reviewed-crawl \
  --repo '/absolute/path/to/tested-source-checkout' \
  --runtime-repo '/Users/allan/.openclaw/workspace/coffee-roaster-crawler' \
  --sha '<exact-reviewed-fix-sha>' \
  --preflight '/absolute/path/to/fresh-private-preflight.json' \
  --output '/absolute/path/to/new-private-run-directory'
```

Preflight JSON must contain `passed:true`, `source_sha`, `owner_id`, `checked_at`, `collisions:[]`, `existing_running_runs:[]`, `reconcile_omissions:false` and `inventory_authorizes_global_absence:false`. Prepare it from fresh source/native/catalog observations after the final source is known. Preserve the current global weight index; no migration is part of this procedure. Current discovery, rather than the historical255/528 snapshot, defines the run's actual scope.

Validation: four offline regressions pass, exercising the real guarded reader's excessive Retry-After and subsequent zero-wire failure, unchanged bounded retries/waits/success return, incomplete-run failure before caller completion/reconciliation, and preparation-only CLI behavior with invalid credentials and no output directory. The complete local suite has460 total /459 passed /zero failed /one explicit native PostgreSQL unavailable skip; PGlite contract passed. This is preparation evidence, not a live recovery result or validation of the separate future cooldown fix.
