#!/bin/zsh
set -eu
cd /Users/allan/.openclaw/workspace/coffee-roaster-crawler
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
node -e 'const fs=require("fs"),c=require("crypto");if(c.createHash("sha256").update(fs.readFileSync("/Users/allan/.openclaw/workspace/coffee-roaster-crawler/src/myCoffeeExplorerImport/finite-product-queue.cjs")).digest("hex")!=="58c2c48b4aa8bd50c16f77336699199c1fc1bd33c8c48b5e21d43e325d3191e1")throw Error("Frozen queue helper changed");'
set -a
source .env
set +a
exec node /Users/allan/.openclaw/workspace/coffee-roaster-crawler/src/myCoffeeExplorerImport/finite-product-queue.cjs --run
