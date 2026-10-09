# Concurrent roaster crawling

The crawler defaults to four simultaneous roasters and one page worker per roaster. Roasters share one bounded pool inside the current tier. A free slot starts the next roaster while slower shops continue; the next tier waits for every attempt and the existing bounded unreachable-site retry. Each roaster retains its separate inventory, known-page context, observation map and guarded merchant reader.

Set these two values explicitly in the local crawler's private environment:

```dotenv
PARALLEL_ROASTERS=4
CRAWLER_PAGE_CONCURRENCY=1
```

An existing `PARALLEL_ROASTERS=1` overrides the new default, so source installation alone is insufficient. Both settings must be positive whole numbers; invalid values fail configuration validation before crawling. Startup logs report roaster workers, page workers per roaster and their maximum product. Keep page concurrency at one when increasing roaster concurrency so a merchant receives the existing sequential reads and delays. Four roasters with four page workers each would create up to sixteen page pipelines.

Install the tested pushed commit at a returned catalog/photo/known-page boundary, preserve the current Git state and private environment, stop the old worker and wait for launcher/lock removal, then update source and only these concurrency values. Start the existing LaunchAgent once. Verify the installed commit, one Node under the launcher-owned lock, startup `roasterWorkers=4`, `pageWorkersPerRoaster=1`, and four overlapping current-tier crawl attempts. Preserve saved records/caches; interrupted inventory remains incomplete and must not reconcile omissions. Keep the existing90-minute launch interval. Do not launch four separate crawler processes, reset cooldowns or re-enable canceled code-check automations.

The native-discovery URL set now uses the same normalization as the accumulator, fixing Dak's trailing-slash mismatch. This permits its reviewed URLs to reach the visitor; it does not reset Dak's existing24-hour completed-run cooldown or remove Coffee Project's explicit legacy exclusions. Pending variant-weight/typed-processing migrations remain separate and are not required or applied by the concurrency change.

CPU headroom supports testing this setting, but throughput depends on merchant inventories, cache hits, remote model/request limits and database capacity. Concurrency increases activity per hour; no four-worker throughput or cost improvement is claimed until measured. Monitor returned errors and actual successful catalog saves independently of run completion status.
