# Authorized directory export importer

This tool imports a directory export that you are authorized to use. It does not crawl or fetch the source directory. JSON, NDJSON/JSONL, and CSV are accepted. Every row must include `name`, an official website, and an absolute source-profile URL; descriptions, contact data, location fields, and a bounded `source_metadata` object for per-property dataset/license attribution are optional.

Dry-run is the default. It snapshots every entity before exact-host matching and writes a private (`0600`) plan file:

```sh
node src/directoryImport/cli.js \
  --input /path/to/authorized-export.ndjson \
  --source-name "Licensed Roast Local export" \
  --authorization-note "Received under written license on YYYY-MM-DD"
```

Review the plan. Rows marked `reject` or `conflict` must be corrected before apply. To write the reviewed import:

```sh
node src/directoryImport/cli.js \
  --apply \
  --plan /path/to/authorized-export.ndjson.import-plan.json
```

Apply is serialized and checkpointed. Re-run the identical command after an interruption to resume. Existing records match only by their exact canonical host (`www` is treated as equivalent); names are never used for automatic matching. A strict normalized-name collision, including a same-name direct parent/subdomain, is sent to manual review rather than created. Existing populated enrichment fields are never overwritten. Source provenance and per-record metadata are stored idempotently under `entity_roles.role_metadata.provenance.authorized_exports`.
