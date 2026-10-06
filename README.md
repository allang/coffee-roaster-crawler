# Coffee roaster crawler

Preserved Mac Mini crawler plus proposed Every Coffee catalog improvements. Authoritative checklist: https://github.com/allang/coffee-roaster-crawler/issues/1. Review branch: `codex/issue-1-crawler`; PR: https://github.com/allang/coffee-roaster-crawler/pull/2. **Undeployed.** The original running checkout is unchanged.

For offline verification on Node.js 22+: `npm ci --ignore-scripts`, then `npm test`. Tests include real local Postgres/PLpgSQL via PGlite, simulated HTTP/classifier flows, structured extraction, caching, stable identity, stock evidence, currency precision, notes, rollback and image reuse. No production credentials are needed. `node scripts/compare-fixtures.cjs` compares deterministic failure fixtures with the full-history preserved baseline. Evidence-bound historical tests remain separately available with `npm run test:historical` and require local artifacts.

See [WORK_LOG.md](WORK_LOG.md), [impact report](docs/IMPACT_REPORT.md), and [deployment preparation](docs/DEPLOYMENT.md). No command in CI deploys or applies production migrations. Live crawler entry points require server credentials and are intentionally not run during this task.
