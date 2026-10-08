#!/bin/zsh
set -eu
cd /Users/allan/.openclaw/workspace/coffee-roaster-crawler
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
set -a
source .env
set +a
exec >> .state/my-coffee-explorer/2026-09-26/continuation-crawl.log 2>&1
node src/myCoffeeExplorerImport/targeted-crawl.js --input .state/my-coffee-explorer/2026-09-26/continuation-crawl-targets.ndjson --checkpoint .state/my-coffee-explorer/2026-09-26/continuation-crawl-checkpoint.json --summary .state/my-coffee-explorer/2026-09-26/continuation-crawl-summary.json --audit .state/my-coffee-explorer/2026-09-26/continuation-crawl-requests.ndjson --concurrency 1 --run
