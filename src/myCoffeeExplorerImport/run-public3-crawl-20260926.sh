#!/bin/zsh
set -eu
cd /Users/allan/.openclaw/workspace/coffee-roaster-crawler
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
set -a
source .env
set +a
exec >> .state/my-coffee-explorer/2026-09-26/public3-crawl.log 2>&1
node src/myCoffeeExplorerImport/run-verified-crawl-queue.cjs public3-queue-manifest.json
