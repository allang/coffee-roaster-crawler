#!/bin/zsh
set -eu
cd /Users/allan/.openclaw/workspace/coffee-roaster-crawler
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
set -a
source .env
set +a
node -e 'const fs=require("fs"),crypto=require("crypto");const p=".state/my-coffee-explorer/2026-09-26/product-seed-batch4a/manifest.json";if(crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")!=="765dc9a52043b53950f879ef5a39410fe9ab09b9e236e432dcba9a5d9de40684")throw Error("Manifest changed");'
exec node src/myCoffeeExplorerImport/product-only-crawl.cjs --manifest .state/my-coffee-explorer/2026-09-26/product-seed-batch4a/manifest.json --run
