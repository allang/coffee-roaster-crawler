#!/bin/zsh
set -eu
cd /Users/allan/.openclaw/workspace/coffee-roaster-crawler
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
set -a
source .env
set +a
export CLASSIFIER_MAX_CHARS=20000
node -e 'const fs=require("fs"),crypto=require("crypto"),h=x=>crypto.createHash("sha256").update(fs.readFileSync(x)).digest("hex"),mf="/Users/allan/.openclaw/workspace/coffee-roaster-crawler/.state/my-coffee-explorer/2026-09-26/product-seed-lulo-canonical/manifest.json";if(h(mf)!=="ef1370a10e5134f4e1780db6b93aa33318af6f8ebb215e574b66b74f70372625")throw Error("Manifest changed");for(const [f,expected]of Object.entries({"product-only-crawl.cjs":"a5adfd008dc68e031d7a26cc3ca47f5a9aac0a1ee9fa337ac7ab96ba83adccdf","product-only-network.cjs":"06b85be52fce083ee6d2cdf5631fa21d2ccdc7ae7a2d7e0f22549769e097ad3e","legal-guard.cjs":"26acbcc26a6b24aaf3663b5968b6163e010a3ac323eac4cfe1dd8b5e6a16abfc"}))if(h("/Users/allan/.openclaw/workspace/coffee-roaster-crawler/src/myCoffeeExplorerImport/"+f)!==expected)throw Error("Runner changed: "+f);const m=JSON.parse(fs.readFileSync(mf));if(JSON.stringify(m.required_execution_environment)!==JSON.stringify({CLASSIFIER_MAX_CHARS:"20000"})||process.env.CLASSIFIER_MAX_CHARS!=="20000")throw Error("One-shot classifier limit mismatch");'
exec node src/myCoffeeExplorerImport/product-only-crawl.cjs --manifest .state/my-coffee-explorer/2026-09-26/product-seed-lulo-canonical/manifest.json --run
