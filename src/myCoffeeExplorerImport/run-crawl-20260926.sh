#!/bin/zsh
set -eu
cd /Users/allan/.openclaw/workspace/coffee-roaster-crawler
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
set -a
source .env
set +a
exec >> .state/my-coffee-explorer/2026-09-26/official-crawl.log 2>&1
node src/myCoffeeExplorerImport/targeted-crawl.js --input .state/my-coffee-explorer/2026-09-26/all-crawl-targets.ndjson --checkpoint .state/my-coffee-explorer/2026-09-26/targeted-crawl-checkpoint.json --summary .state/my-coffee-explorer/2026-09-26/targeted-crawl-summary.json --audit .state/my-coffee-explorer/2026-09-26/targeted-crawl-requests.ndjson --concurrency 2 --run
