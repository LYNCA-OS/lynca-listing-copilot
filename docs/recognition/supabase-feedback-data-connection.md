# Supabase Feedback Data Connection

Status: live Supabase project discovered and read-only counts verified through MCP. Two local export paths are now available:

1. REST export when a server-only `SUPABASE_SERVICE_ROLE_KEY` is present.
2. SQL/MCP rows import when service-role REST access is unavailable.

## Live Project

- Supabase project: `Listing Copilot`
- Project ref: `osrrujmpxxiefppjfgpd`
- Region: `ap-southeast-2`
- Database: Postgres 17

## Verified Tables

Remote tables visible in the live project:

- `public.listing_title_feedback`
- `storage.objects`
- `storage.buckets`

The newer migration tables such as `listing_assets`, `listing_analysis_runs`, and `listing_reviews` are present in repo migrations but were not visible in the live project table listing during this check.

## Live Counts

Read-only MCP queries on 2026-06-23 showed:

- `public.listing_title_feedback`: 351 rows
- rows with `front_image_url`: 248
- rows with `back_image_url`: 247
- rows with at least one image URL: 248
- rows with `corrected_title`: 351
- `storage.objects`: 495 objects
- storage bucket: `listing-feedback-images`
- created_at window: `2026-06-21 09:30:11.126+00` through `2026-06-22 11:25:29.12+00`

Recognition candidate status:

- 351 total feedback table records are confirmed.
- 248 records have at least one image URL and are usable as image-backed Recognition candidates.
- 103 records are title-feedback-only rows at this stage and are intentionally not emitted into the image Recognition candidate manifest.
- The current local ignored export generated `data/recognition/manifests/supabase-feedback-candidates.json` with 248 `NEEDS_REVIEW` items and validation `ok: true`.

Snapshot file:

- `data/recognition/reports/supabase-live-snapshot-2026-06-23.json`

## REST Export Command

After configuring local server-only Supabase env:

```bash
set -a
source .env.local
set +a
npm run recognition:supabase:candidates -- \
  --limit 1000 \
  --output data/recognition/manifests/supabase-feedback-candidates.json \
  --report-output data/recognition/reports/supabase-feedback-candidates-report.json
```

Required local env:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

The script reads `listing_title_feedback` through Supabase REST and writes local Recognition Dataset candidates.

Current Vercel production env check on 2026-06-23 showed `SUPABASE_URL` is present but `SUPABASE_SERVICE_ROLE_KEY` is empty. Using the anon key for REST returned 0 rows, which means RLS is correctly preventing public reads of internal feedback data. Do not weaken RLS or expose `listing_title_feedback` to anon just to export candidates.

## MCP / SQL Rows Export

When service-role REST access is unavailable, use the read-only SQL file:

```sql
supabase/queries/export_recognition_feedback_rows_for_mcp.sql
```

For a small result, save the SQL/MCP JSON result to a local file, then convert it into the same candidate manifest shape:

```bash
npm run recognition:supabase:rows -- \
  --input data/recognition/reports/supabase-feedback-rows-mcp.json \
  --output data/recognition/manifests/supabase-feedback-candidates.json \
  --report-output data/recognition/reports/supabase-feedback-candidates-report.json
```

The rows importer accepts:

- a raw JSON array of rows
- `{ "rows": [...] }`
- `{ "data": [...] }`
- Supabase MCP `{ "result": "Below is ... <untrusted-data-...>[...]</untrusted-data-...>" }` payloads

This keeps internal feedback rows private while still making Codex/MCP exports usable as local, repeatable test data.

For the live 2026-06-23 dataset, prefer chunked MCP export so large result payloads are not manually copied:

1. Run the chunked query template in `supabase/queries/export_recognition_feedback_rows_for_mcp.sql` through Supabase MCP with offsets `0, 50, 100, 150, 200`.
2. Use a stable prefix such as `LYNCA_SUPABASE_FEEDBACK_EXPORT_20260623_` and unique chunk ids ending in `0000`, `0050`, etc.
3. Extract the MCP results from the local Codex session JSONL:

```bash
npm run recognition:supabase:mcp-session -- \
  --session /Users/paidaxin/.codex/sessions/2026/06/22/rollout-2026-06-22T09-25-08-019eecee-67fb-72d2-af34-c9f16bf1d104.jsonl \
  --chunk-prefix LYNCA_SUPABASE_FEEDBACK_EXPORT_20260623_ \
  --expected-rows 248 \
  --expected-chunks 5 \
  --output data/recognition/reports/supabase-feedback-rows-mcp.json \
  --report-output data/recognition/reports/supabase-feedback-mcp-session-export-report.json
```

Then run the normal rows conversion command shown above.

The chunked query can return `front_bucket/front_object_path` and `back_bucket/back_object_path` instead of full authenticated storage URLs. The candidate converter supports these fields, which keeps the local dataset usable for later signed-URL generation without carrying full authenticated object URLs in the exported rows.

If an earlier MCP run already produced a single `rows_json` aggregate payload, the same extractor can recover that payload from the Codex session JSONL without chunk ids. The 2026-06-23 local export used this fallback mode to extract 248 image-backed rows from a previous complete MCP result.

## Data Boundary

The export intentionally creates `NEEDS_REVIEW` candidate items.

It does not treat:

- `corrected_title`
- `generated_title`
- Agnes output
- GPT output
- marketplace title text

as field-level ground truth.

Each exported item keeps corrected/generated titles under `source_titles` only so reviewers can see why the row exists.

## Image Path Normalization

Source URLs like:

`/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/.../front.jpg`

are normalized to:

- `bucket`: `listing-feedback-images`
- `object_path`: `feedback/2026-06/.../front.jpg`
- `role`: `front_original` or `back_original`

This keeps candidate data usable by future storage signed-URL generation without storing service-role keys in the dataset.

## Current Limitation

Local `.env.local` can be populated from Vercel, but the current Vercel production environment does not include a non-empty `SUPABASE_SERVICE_ROLE_KEY`. Supabase CLI is not installed locally.

The REST code path, SQL/MCP rows importer, and chunked MCP session extractor are ready and covered by tests. Once either a service role key is added locally or chunked MCP SQL rows are present in the session JSONL, rerun the relevant export command above.
