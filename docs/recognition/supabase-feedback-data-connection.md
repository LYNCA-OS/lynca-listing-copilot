# Supabase Feedback Data Connection

Status: live Supabase project discovered and read-only counts verified through MCP. Local REST export path is implemented, but full candidate file generation requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in local `.env.local`.

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

Snapshot file:

- `data/recognition/reports/supabase-live-snapshot-2026-06-23.json`

## Export Command

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

## Current Blocker

Local `.env.local` in this repo does not currently contain `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`, and Supabase CLI is not installed. Therefore, the full 248 image-backed candidate manifest was not generated locally in this run.

The code path is ready and covered by tests. Once the env variables are added, rerun the export command above.
