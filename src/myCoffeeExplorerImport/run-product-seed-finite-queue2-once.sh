#!/bin/zsh
set -eu
cd /Users/allan/.openclaw/workspace/coffee-roaster-crawler
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
node -e 'const fs=require("fs"),c=require("crypto");if(c.createHash("sha256").update(fs.readFileSync("/Users/allan/.openclaw/workspace/coffee-roaster-crawler/src/myCoffeeExplorerImport/finite-product-queue2.cjs")).digest("hex")!=="9cf07e38bea12503e78ce24664053a38bc59f6aa80b15663a4555b2b207f683c")throw Error("Frozen queue2 helper changed");'
set -a
source .env
set +a
exec node /Users/allan/.openclaw/workspace/coffee-roaster-crawler/src/myCoffeeExplorerImport/finite-product-queue2.cjs --run 5d651cf497a223df211769df399d6079d4e53d61e12b0a0fddb11b9cb62f4b8e
