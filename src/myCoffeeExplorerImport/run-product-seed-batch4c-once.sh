#!/bin/zsh
set -eu
cd /Users/allan/.openclaw/workspace/coffee-roaster-crawler
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
set -a
source .env
set +a
node -e 'const fs=require("fs"),crypto=require("crypto"),h=x=>crypto.createHash("sha256").update(fs.readFileSync(x)).digest("hex");if(h("/Users/allan/.openclaw/workspace/coffee-roaster-crawler/.state/my-coffee-explorer/2026-09-26/product-seed-batch4c/manifest.json")!=="10d69c704dbeb8ede0834e91db5c5b3e4d691cd6943ae3acbf692956508d6a3c")throw Error("Manifest changed");for(const [f,expected]of Object.entries({"product-only-crawl.cjs":"a5adfd008dc68e031d7a26cc3ca47f5a9aac0a1ee9fa337ac7ab96ba83adccdf","product-only-network.cjs":"06b85be52fce083ee6d2cdf5631fa21d2ccdc7ae7a2d7e0f22549769e097ad3e"}))if(h("/Users/allan/.openclaw/workspace/coffee-roaster-crawler/src/myCoffeeExplorerImport/"+f)!==expected)throw Error("Runner changed: "+f);'
exec node src/myCoffeeExplorerImport/product-only-crawl.cjs --manifest .state/my-coffee-explorer/2026-09-26/product-seed-batch4c/manifest.json --run
