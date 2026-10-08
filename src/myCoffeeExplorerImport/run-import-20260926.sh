#!/bin/zsh
set -eu
cd /Users/allan/.openclaw/workspace/coffee-roaster-crawler
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
set -a
source .env
set +a
exec >> .state/my-coffee-explorer/2026-09-26/import-and-crawl.log 2>&1
node src/myCoffeeExplorerImport/import.cjs apply .state/my-coffee-explorer/2026-09-26
node src/myCoffeeExplorerImport/import.cjs verify .state/my-coffee-explorer/2026-09-26
# Targeted official-site crawl starts separately after final identity review.
