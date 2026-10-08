# Mac Mini duplicate-merge source update — 2026-10-08

Merged [PR #8](https://github.com/allang/coffee-roaster-crawler/pull/8), exact main **`ff26496077ec348fc162dcb2e74ea1ccb7b477c5`**, is installed and the existing single scheduled crawler is **running**. The coordinating thread confirmed the six-owner catalog merge, preservation readback and zero-change rerun before installation. This local update performed no schema migration or merge DML.

The scheduler resumed **19:02:34.401 UTC / 3:02:34 PM Eastern**; Node started **19:02:34.615 UTC**. Pause duration was **945.539 seconds (15m45.539s)** from the recorded 18:46:48.862 pause. The original checkout is clean at that main SHA. Launcher and lock PID **54930**, sole scheduler Node **54939**, and actual working directory `/Users/allan/.openclaw/workspace/coffee-roaster-crawler` were verified. Environment, plist, launcher, caches and original **5,400-second interval / one worker** are preserved. The prior Manta Ray interruption remains recorded as failed with its operator reason.

The installed ledger has **524 assignments / 65 canonical tier-one IDs**. All **59 site profiles** retain their configuration; Loveless now binds solely to retained owner **`d85c4ca3-b86e-43b6-8822-aaef6472126a`**. None of the six retired owner IDs remains in the catalog, ledger or profiles. The actual scheduler started **tier one with 57 eligible roasters**, first H+S Coffee Roasters, owner `e00c05fa-623e-4284-adfc-420e81dd472c`, run `115ff53d-4e51-494a-9b83-312da3a5f564`. Eligible counts reflect existing crawl filters and differ from the complete ledger count. Phase ordering remains covered by the installed planner regressions.

Normal-scheduler persistence is confirmed for product **`08d0fc20-b669-545d-ad7b-bbc50399f5e0`**, `/products/burundi-mikuba-8`: both catalog `last_seen_at` and known-page checkpoint are **19:03:18.467 UTC**, after this startup. No startup severity error was recorded in the dated runtime receipt. Existing missing optional tier/control fields and processing-v2 RPC use the reviewed compatibility fallbacks. This establishes startup and a fresh write; it does not certify the complete merchant run or whole tier.

## Read-only Loveless check

At **19:02:19.481 UTC**, installed-source `profileFor` selected the retained Loveless Shopify adapter/owner. Catalog readback retained **40 product IDs: 36 current listings and four inactive historical copies**. Actual `findExistingProduct` URL fallback selected the intended canonical listing for **all four** overlapping identities, excluding the reviewed historical copies. An exact native source-key lookup also adopted the canonical Kamavindi product `db0fcdc0-d38f-5514-b543-615c4298b648`, native product **`9173057765531`**, with four current native variants.

Its guarded primary HTML, native `.json` and native `.js` GETs each returned **200**. The catalog before/after readback was identical. This check made **zero writes and zero model calls**; it verifies adapter registration, current native identity and canonical adoption, without claiming a new full Loveless market-data audit.

## Validation and limits

Installed source tests: **456 total / 455 passed / zero failed / one explicit native PostgreSQL unavailable skip**, **11.050694 seconds**. The equivalent PGlite contract passed. The coordinating thread separately reported **456 tests passed**, and both exact premerge-head CI checks passed on `12112153b67c678610353ad1fc71e9372168895f`. Local profile preservation, source/configuration identity, ledger/retired-owner assertions, actual process/lock/cwd and read-only adoption checks passed. [Dated machine-readable receipt](mac-mini-duplicate-merge-update-20261008.json).

The variant-index and typed-processing migrations remain unapplied. The failed isolated Passport process was not restarted; its terminal receipt is byte-identical. Its full gate remains failed, with the separately verified 98-coffee / 216-SKU / 65-image subset retained. No hosted deployment, purchase, cooldown reset or new automation was performed. No performance improvement is inferred from this source installation or checkpoint.
