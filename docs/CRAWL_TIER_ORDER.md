# Crawl tier order

Each crawl cycle finishes eligible tier 1 roasters, then tiers 2, 3, 4 and 9, then the remaining roasters. Parallel workers operate within one phase; the next phase starts only after every attempt and the existing single unreachable-site retry have finished. Failed sites are reported and do not stall the crawler forever. Tier nine remains a feed/shopping exclusion; its catalog can still be crawled.

The existing 24-hour cooldown and disabled-roaster controls remain in force. Roasters without a website are skipped. Eligible roasters retain a randomized order within their phase. Disabled-state queries use bounded batches and fail closed when their read fails. Production currently lacks the optional `entity_crawl_state` table; an explicit missing-table response logs that fact and retains the deployed cooldown/website rules. Permission and network failures are not treated as absence.

When `entities.roaster_tier` exists, its values are authoritative, including null. Until that field is installed, `data/crawl-tier-assignments.json` supplies the 529 reviewed stable-ID assignments: 70 tier 1, 32 tier 2, 418 tier 3, no tier 4, and 9 tier 9. Preface Coffee is tier 1. The source CSV commit is `2c8733cdc6aa1abd866b4df5df766f75b6f855f5`; source/mapping hashes and reviewed identity follow-ups are retained. Ambiguous and unlisted IDs stay in the remaining phase. This fallback performs no tier import or production writes. Unrelated database/query errors do not trigger fallback.

Preview the exact catalog, cooldown and crawl-control selection without crawling or writing:

```sh
node --env-file=.env scripts/preview-crawl-tiers.js /tmp/crawl-order.json
npm test
```

Startup logs show the beginning and completion of each phase, with attempts, successes, failures and retries.

On October 8, a fresh human instruction authorized updating the Mac Mini before the final Passport product-verification pass finished. Exact merged main `28de9b55a1c039a5b3581a9595357d0fe4cf1095` is installed, with 406/406 installed tests and the original scheduler/configuration preserved. Fresh logs prove 69 eligible tier-one roasters began first; full live tier transitions remain pending. Passport's isolated normal run later failed with 193 successful saves and 62 errors; its successful-subset readback passed, while full coverage remains incomplete. See [terminal evidence](MAC_MINI_PASSPORT_FAILURE_20261008.md). See [actual update and limitations](MAC_MINI_UPDATE_20261008.md). Future updates must preserve local work/scheduler and verify source, lock/process ownership, fresh phase logs and actual results.

Recovery main `0a1cefb760b6d90e4dbde885fcf79a1d8da44438` was installed on the Mac Mini with preserved configuration at 16:53:47.157 UTC. Fresh logs prove tier 1 first with 66 currently eligible roasters, while three previous completed roasters retain their normal cooldowns. [Latest installation evidence and limits](MAC_MINI_RECOVERY_UPDATE_20261008.md).
