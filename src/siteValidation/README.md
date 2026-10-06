# Official-site candidate validator

This isolated validator checks importer-ready Overture candidates against each candidate's own official website. It does not crawl Roast Local, discover extra pages, or connect to Supabase.

For each candidate it:

- fetches the applicable `robots.txt` and honors the most specific matching rule;
- requests only the supplied official URL plus redirects, with a 512 KiB response cap;
- rate-limits requests globally and per hostname;
- blocks Roast Local, localhost, private-network, and reserved-IP destinations at every redirect;
- pins every live socket to the public DNS result that passed validation, while retaining the original hostname for HTTP `Host`, TLS SNI, and certificate verification;
- records the Overture `source_record_id`, canonical requested/final hosts, HTTP status, final URL, redirects, content type, bounded evidence, deterministic reason code, and errors;
- extracts bounded factual observations from that same fetched page: recognized
  Organization/LocalBusiness/CafeOrCoffeeShop JSON-LD names, final URL,
  schema or visible contact/address facts, social links, and explicit roasting
  statements, each with an official-page provenance pointer;
- flags permanently closed, parked/for-sale, cafe-only, and generic directory/social URLs;
- appends one complete NDJSON row at a time so an interrupted run can resume.

Before making any request, it also groups the complete input by canonical host.
Every row in a shared-host group receives an offline `shared_host_conflict`
result. This prevents franchise/store-location URLs and other shared domains
from being mistaken for many independent roasters or consuming a large crawl.

Run a small review batch first:

```sh
node src/siteValidation/cli.js \
  --input .state/overture/coffee-roastery-import-ready.ndjson \
  --limit 20
```

The default output is `<input>.validation.ndjson`. Rerunning the same command skips completed record keys. `--retry-errors` retries only `unreachable`, `http_error`, and `robots_unavailable` results.

The classifier is deliberately conservative:

- `likely_roaster`: the page explicitly says it roasts coffee;
- `possible_roaster`: several coffee-product signals, but no explicit roasting statement;
- `unlikely_roaster`: parked/missing-site evidence;
- `permanently_closed`: explicit permanent-closure evidence;
- `cafe_only`: cafe/food-service evidence without an explicit roasting statement;
- `unsupported_host`: a directory, social profile, or link aggregator rather than an official site;
- `needs_review`: reachable HTML without enough evidence;
- `robots_blocked`, `robots_unavailable`, `http_error`, `non_html`, `unreachable`, or `input_error`: not classified.

Both `likely_roaster` and `possible_roaster` set `plausibleRoaster: true`, but `possible_roaster` should still receive human review before import. A successful validation is evidence about the website, not authorization to write the database. The importer remains a separate dry-run/review/apply workflow.

Do not send the raw validation checkpoint to the importer. Produce the much
smaller approved artifact and a complete decision report offline:

```sh
node src/siteValidation/accept-cli.js \
  --input .state/overture/coffee-roastery-import-ready.ndjson.validation.ndjson
```

Automatic acceptance requires all of the following: a matching validator key,
a validation no more than seven days old, a clean 2xx HTML response allowed by
robots, no canonical-host change, one narrowly explicit coffee-roasting signal,
and conservative candidate identity evidence in the fetched page title. Bare
mentions of “coffee roasters,” generic “we roast” language, cross-host redirects,
and ambiguous identities remain manual review. Negative classifications are
rejected. The approved output contains hashed acceptance metadata; changing the
candidate or validator result invalidates it.

To create a separate official-site-sourced candidate artifact, run the offline
converter on the approved output:

```sh
node src/siteValidation/official-convert-cli.js \
  --input .state/overture/approved.validation.ndjson
```

The converter never fetches a page. It requires an unambiguous high-confidence
business name from recognized JSON-LD, matching page identity, and explicit
roasting evidence. It emits only the name, final website, contact, and location
facts that the official page itself supplied. Overture identifiers may remain
under `source_metadata.discovery_lineage`, but discovery names, contact data,
and locations are not copied into the official-source fields. The transformed
record receives its own hashed acceptance artifact and remains compatible with
the existing importer verification gate.

Every converted row carries `legal_review.status = "requires_review"`. This
records the unresolved publication/licensing question without claiming that a
factual observation is legally cleared. It is a review flag, not a legal
conclusion.

For explicitly coordinated sharding, pass `--shard-count N --shard-index I` and use a distinct output file per shard. Keep the aggregate request rate respectful; the defaults are one new request per second globally and five seconds between requests to the same host in each process.
