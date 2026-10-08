# Isolated observed-product runner

Prepared locally for review. This implementation has not been launched in production and its tests do not write production data or request public pages. It leaves the existing crawler, scheduler, and all active/queued manifests untouched.

## Scope and prerequisites

- A finite list of exact, already observed public product URLs for already verified roaster entities. No sitemap discovery, link following, event archives, or whole-site inventory reconciliation.
- Use newly verified entities outside every active and queued target list. The first pilot must include the full independently verified exclusion union (currently 536 IDs); `excluded_entity_count` is checked against its evidence artifact, not against a hard-coded historical count.
- Each target needs an existing roaster role, exact expected website and source associations, and `allow_crawl` must not be false. These checks are refreshed before the claim, after the claim, before classification, and before every reused product/storage mutation.
- Production dependencies and credentials remain on the existing crawler host. The runner verifies the expected production Supabase origin, never prints its key, and does not use the unrelated connected Supabase project.
- `crawl_runs.meta` must exist. Read-only schema inspection confirmed it on 2026-09-26; startup checks it again. A claim has `scope: observed_product_urls_only`, `inventory_complete: false`, manifest hash, seed count, and concurrency 1.

## Manifest

The manifest and every evidence file must live under one immutable manifest directory. JSON and NDJSON evidence files are byte-hashed using SHA-256. References support a 1-based NDJSON `line` and JSON `pointer`. JSON artifact references omit `line`.

```json
{
  "version": 1,
  "scope": "observed_product_urls_only",
  "inventory_complete": false,
  "database_origin": "https://gtlipifdfyugiwpxvuse.supabase.co",
  "concurrency": 1,
  "created_at": "2026-09-26T00:00:00.000Z",
  "excluded_entity_count": 536,
  "artifacts": [
    {"id":"owners","kind":"ownership","path":"owners.ndjson","format":"ndjson","sha256":"<64 hex characters>"},
    {"id":"observations","kind":"observations","path":"observations.ndjson","format":"ndjson","sha256":"<64 hex characters>"},
    {"id":"excluded","kind":"excluded_targets","path":"excluded.json","format":"json","sha256":"<64 hex characters>"}
  ],
  "targets": [{
    "entity_id": "<verified entity UUID>",
    "website_url": "https://verified-roaster.example/",
    "source_ids": [{"source":"my_coffee_explorer","source_id":"<verified public source ID>"}],
    "owner_evidence": {"artifact_id":"owners","line":1},
    "products": [{
      "url":"https://verified-roaster.example/products/observed-coffee",
      "observation":{"artifact_id":"observations","line":1,"pointer":"/productUrl"}
    }]
  }]
}
```

An owner-evidence row contains the same `entity_id`, `website_url`, and `source_ids`. An observation pointer resolves to the exact URL string from immutable public-source evidence. Each exclusion row is `{ "entity_id": "<UUID>" }`. Evidence is not fabricated from the proposed target: the reviewer must preserve the original ownership verification and observed-page source facts.

Bounds: at most 50 targets, 100 URLs per target, 1,000 URLs total. Concurrency is fixed at one. The manifest is rejected if any owner overlaps an exclusion or any URL lacks exact source evidence.

## Commands and outputs

```sh
node product-only-crawl.cjs --manifest /absolute/path/manifest.json
node product-only-crawl.cjs --manifest /absolute/path/manifest.json --run
node --test product-only-crawl.test.cjs
```

Preview is the default. It performs read-only database checks and local audit output; it does not fetch product pages, create crawl claims, call the classifier, or save products. `--crawler-root` selects the existing production dependency root; `--output-dir` must be an owned output directory that does not overlap evidence. A scope marker prevents writing into a nonempty unrelated directory.

Per-manifest outputs are `scope.json`, `preview.json` or `summary.json`, `checkpoint.json` during a run, and `requests.ndjson` for the runtime guard/transport audit. Checkpoints retain per-URL outcomes and actual saved product IDs, entity IDs, and source URLs. A resumed coffee result is trusted only after refreshing this database proof. Old known coffee pages require the same proof; only terminal `coffee` or `irrelevant` known-page states may skip processing. Prior results are not counted again as newly observed coffees in a later claim.

## Request and persistence boundaries

- HTTPS only, certificate verification enabled, no proxy initialization, cookies, authentication, browser execution, or access-control bypass. Reserved/private DNS answers are rejected before connection and the selected public address is pinned.
- The existing legal-path guard applies before dispatch, including encoded/nested prohibited paths. Unexpected decoded legal-document titles use its full vocabulary (including Terms, Privacy, cookies, Impressum, Datenschutz, AGB, disclaimers, and French legal/privacy terms) and are rejected after fetching but before classification or persistence. This is not a claim that unexpected legal text can never be returned from an innocuous URL.
- HTML is limited to manifest product pages. Redirects stay with the verified owner (`www` alias only) and preserve the original path or land on another exact manifest product URL. Shopify JSON is limited to that product's companion `.json` URL. Images must be observed on the product page/JSON; only supported image types are accepted and image redirects cannot change host.
- Authentication/access-denial/challenge and rate-limit responses stop that entity without retries. Model quota exhaustion stops the remaining batch. Individual ordinary HTTP failures are explicit failures, not successful visits.
- Reuses `visitAndClassifyPage` and its existing saving logic only, never `crawlRoaster` or its full-inventory availability reconciliation. Normal writes to the specifically observed product, variants, facts, media, and known-page state remain in scope.
- Before every product/storage mutation, the gate refreshes owner and active-run state. Returned or thrown database/storage errors and out-of-scope table, RPC, schema, storage, and authorization denials are captured even when reused code swallows them; that URL becomes a partial failure, and further writes for it stop. A coffee requires a non-null returned product ID and an actual row with the expected entity and source URL.
- Product updates require one exact ID filter plus fresh row ownership and an unchanged source URL. Inserts require the current entity/source and no existing entity/name-slug or source-URL match. Two different observed pages cannot reuse the same coffee name to overwrite each other's source. Child-table deletes/inserts are restricted to the freshly proved current product; known-page writes stay on the current entity/URL. Storage uploads and media associations require hashes of image bytes actually fetched in that product context.
- One isolated adapter corrects a known existing classifier/saver mismatch: on `coffee_facts` insert only, if a nonempty `process` exactly equals `variety`, the insert preserves `variety` and sets `process` to null. It records a normalization count/note. A distinct processing method is retained. The core saver and existing records are not separately edited.

## Operational limits requiring review

1. A shared product-only entity lock lives under the production crawler's `.state/my-coffee-explorer/.product-only-entity-locks`, independent of manifest directories. A local manifest lock also prevents duplicate wrapper execution. Tests inject their own temporary lock directory.
2. The existing regular runner does not share this new lock. Fresh checks and the claim/recheck/write gates reduce overlap but are not an atomic database exclusion guarantee. No new database constraint/RPC was created. This is why the initial targets must be newly verified, outside all active/queued lists.
3. `crawl_runs.status=completed` means this finite subset completed, not the whole website. Existing full-site scheduling may impose its normal 24-hour cooldown after this scoped completed row. The scope remains explicit in `meta` and summaries.
4. Page processing is not a database transaction. A reported partial failure may leave earlier product writes in place. An interrupted `running` URL refuses automatic replay; inspect its checkpoint, claim, and database state before retrying. A failed URL needs explicit `--retry-failed` after review. Stale lock files must be reviewed, not blindly removed.
5. The reused saver identifies products using its existing entity/name-slug logic. The isolated gate refuses a different-source collision before any product update, and refuses inserts if that entity/slug or source already exists. Same-source updates may still update descriptions, variants, media, and individual availability. This is not a new product identity system. The initial pilot should use new verified entities/products, then inspect persisted results before any broader use.
6. A successful product proof verifies the main product's owner/source identity; child-table errors are caught by the mutation gate, but this is not a field-by-field independent content audit. Retain the source evidence and review the pilot's facts/variants/media.

Validation: 47 offline tests passed, covering ownership, immutable evidence, exclusions, legal/cross-host/private redirects, authentication/rate/quota stops, live-claim conflicts, shared locks, saved-product proof, resume behavior, swallowed errors and authorization denials, source/slug collisions, scoped child/media writes, and the cultivar/process correction. No production run was performed as part of this implementation.
