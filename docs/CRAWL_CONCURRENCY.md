# Concurrent roaster crawling

The crawler defaults to four simultaneous roasters and one page worker per roaster. Roasters share one bounded pool inside the current tier. A free slot starts the next roaster while slower shops continue; the next tier waits for every attempt and the existing bounded unreachable-site retry. Each roaster retains its separate inventory, known-page context, observation map and guarded merchant reader.

Within each tier and the remaining-roaster group, never-attempted sites now come first, followed by the oldest last attempt. The latest `crawl_runs.created_at` counts every attempt, including failures and running jobs; an empty history means never attempted. Stable entity IDs break ties, so restarting does not reshuffle equally old sites. The roster query returns only one latest embedded run per roaster, including across roster pagination; it does not download full history or require a migration. Missing or malformed history fails the query rather than incorrectly treating a merchant as untouched. Existing disabled-site, missing-website and 24-hour running/completed exclusions remain in force. Tier order remains 1, 2, 3, 4, 9, then remaining roasters.

Set these two values explicitly in the local crawler's private environment:

```dotenv
PARALLEL_ROASTERS=4
CRAWLER_PAGE_CONCURRENCY=1
```

An existing `PARALLEL_ROASTERS=1` overrides the new default, so source installation alone is insufficient. Both settings must be positive whole numbers; invalid values fail configuration validation before crawling. Startup logs report roaster workers, page workers per roaster and their maximum product. Keep page concurrency at one when increasing roaster concurrency so a merchant receives the existing sequential reads and delays. Four roasters with four page workers each would create up to sixteen page pipelines.

Install the tested pushed commit after all active page pipelines reach returned catalog/photo/known-page boundaries and before their next fetch. A boundary in just one pipeline does not establish safety for the other three. Preserve the current Git state and private environment, stop the old worker and wait for launcher/lock removal, then update source and only the requested settings. Start the existing LaunchAgent once. Verify the installed commit, one Node under the launcher-owned lock, startup `roasterWorkers=4`, `pageWorkersPerRoaster=1`, and four overlapping current-tier crawl attempts. Preserve saved records/caches; interrupted inventory remains incomplete and must not reconcile omissions. Keep the existing90-minute launch interval. Do not launch four separate crawler processes, reset cooldowns or re-enable canceled code-check automations.

The native-discovery URL set now uses the same normalization as the accumulator, fixing Dak's trailing-slash mismatch. This permits its reviewed URLs to reach the visitor; it does not reset Dak's existing24-hour completed-run cooldown or remove Coffee Project's explicit legacy exclusions. Pending variant-weight/typed-processing migrations remain separate and are not required or applied by the concurrency change.

CPU headroom supports testing this setting, but throughput depends on merchant inventories, cache hits, remote model/request limits and database capacity. Concurrency increases activity per hour; no four-worker throughput or cost improvement is claimed until measured. Monitor returned errors and actual successful catalog saves independently of run completion status.
