# Crawl tier order

Each crawl cycle finishes eligible tier 1 roasters, then tiers 2, 3, 4 and 9, then the remaining roasters. Parallel workers operate within one phase; the next phase starts only after every attempt and the existing single unreachable-site retry have finished. Failed sites are reported and do not stall the crawler forever. Tier nine remains a feed/shopping exclusion; its catalog can still be crawled.

The existing 24-hour cooldown and disabled-roaster controls remain in force. Roasters without a website are skipped. Eligible roasters retain a randomized order within their phase. Disabled-state queries use bounded batches and fail closed when their read fails. Production currently lacks the optional `entity_crawl_state` table; an explicit missing-table response logs that fact and retains the deployed cooldown/website rules. Permission and network failures are not treated as absence.

When `entities.roaster_tier` exists, its values are authoritative, including null. Until that field is installed, `data/crawl-tier-assignments.json` supplies only the 509 reviewed stable-ID assignments from the approved mapping: 55 tier 1, 27 tier 2, 418 tier 3, no tier 4, and 9 tier 9. Preface Coffee is tier 1. The source CSV commit is `2c8733cdc6aa1abd866b4df5df766f75b6f855f5`; source/mapping hashes are retained. Ambiguous and unlisted IDs stay in the remaining phase. This fallback performs no tier import or production writes. Unrelated database/query errors do not trigger fallback.

Preview the exact catalog, cooldown and crawl-control selection without crawling or writing:

```sh
node --env-file=.env scripts/preview-crawl-tiers.js /tmp/crawl-order.json
npm test
```

Startup logs show the beginning and completion of each phase, with attempts, successes, failures and retries.

Activation is gated on resolving tier-one and missing tier-two product coverage. Preserve the Mac mini's live checkout changes and scheduler. Verify the installed commit, fresh phase logs and actual crawl results; source preparation is not a runtime update. No installation or restart has occurred as part of this scheduling change.
