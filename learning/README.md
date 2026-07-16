# Learning exports

This directory is the local, private output boundary for the LYNCA Data Flywheel.
Generated rows are intentionally ignored by Git.

Each daily export is written atomically to:

```text
learning/YYYY-MM-DD/
  feedback/events.jsonl
  semantic/candidates.jsonl
  errors/candidates.jsonl
  golden/candidates.jsonl
  manifest.json
```

Run from a prepared bundle:

```bash
npm run export:learning -- --input /path/to/bundle.json --date YYYY-MM-DD
```

Run against the configured Supabase V4 event tables:

```bash
npm run export:learning -- --supabase --date YYYY-MM-DD
```

`YYYY-MM-DD` is a UTC event-day boundary. When `--date` is omitted, the CLI
uses the current UTC date; production scheduling must use the same boundary.

Exports keep storage references (`bucket`, `object_path`, `content_sha256`) and
strip signed URLs, embedded images, credentials, tokens, and secrets. Writer
titles are title truth; parser SEM remains `PENDING` and `OBSERVE_ONLY` until
field-level validation. Supabase exports close over parent feedback/learning
events when a validation arrives on a later day. A validated SEM still needs an
identity group plus a content-hashed image before it can enter frozen Golden
SEM.
