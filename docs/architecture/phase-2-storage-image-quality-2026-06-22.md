# Phase 2 Storage And Image Quality

Status: storage signed URL slice, first heuristic image quality gate, targeted crop generation, and focused Agnes crop reread orchestration implemented
Date: 2026-06-22

## What Changed

This phase starts the production image path required for Agnes:

- `api/listing-image-upload-url.js`
- `api/listing-image-verify-upload.js`
- `lib/listing/storage/storage-config.mjs`
- `lib/listing/storage/supabase-image-storage.mjs`
- `lib/listing/storage/storage-verification-store.mjs`
- `lib/listing/storage/storage-retention.mjs`
- `lib/listing/image-quality/quality-gate.mjs`
- `lib/listing/image-quality/crop-planner.mjs`
- `supabase/migrations/20260622_listing_image_storage.sql`
- `supabase/migrations/20260622_listing_image_storage_rollback.sql`
- `supabase/migrations/20260622_listing_image_verifications.sql`
- `supabase/migrations/20260622_listing_image_verifications_rollback.sql`
- `scripts/storage-signed-url.test.mjs`
- `scripts/storage-migration.test.mjs`
- `scripts/storage-verification-record.test.mjs`
- `scripts/storage-retention.test.mjs`
- `scripts/storage-retention-api.test.mjs`
- `scripts/image-quality-gate.test.mjs`
- `scripts/image-crop-planner.test.mjs`

The browser can now ask the server for a Supabase Storage signed upload URL, upload the original image directly to the private bucket, and keep the returned object path on the image record.

`api/listing-copilot-title.js` converts storage object paths into short-lived signed read URLs only inside the server-side Agnes request path. Signed read URLs are not saved as long-lived record fields.

The browser computes a first-pass capture-quality report from the decoded preview canvas and sends it with each asset request. The backend returns this report in `capture_quality` and includes it in provider prompt context.

When the quality report marks high-value critical regions as `REVIEW` or `OCCLUDED`, the browser creates targeted JPEG crops from the same decoded image canvas. Crop images keep source-image/source-region metadata and are sent to the provider payload alongside the original front/back image records. If Storage is configured, crop images are uploaded with crop-specific storage roles such as `serial_crop`, `card_code_crop`, `grade_label_crop`, and `year_product_crop`.

## Storage Flow

```text
Browser selects file
  -> browser creates compressed preview/data URL for legacy compatibility
  -> browser sends MIME, byte size, dimensions, and first-byte signature metadata
  -> server creates signed upload URL
  -> browser uploads original file directly to Supabase Storage
  -> server verifies stored object prefix, MIME, size, signature, and parseable dimensions
  -> server saves a durable verification record when Supabase REST is configured
  -> server returns a scoped storage verification token
  -> browser sends object_path in title request
  -> server validates the token, or a matching durable verification record after token expiry, before creating a short-lived signed read URL
  -> Agnes receives image_url
```

## Security Boundaries

- `SUPABASE_SERVICE_ROLE_KEY` remains server-side.
- Browser receives a signed upload URL and object path, not the service role key.
- Object paths are generated server-side with sanitized asset, role, and image identifiers.
- Browser does not mark an object path as usable until the server verifies the stored object after upload.
- Browser must send the server-issued storage verification token with the title request; the title API rejects unverified or mismatched object references before creating signed read URLs.
- If the token is missing or expired, the title API can fall back to a matching server-side `listing_image_verifications` row. Invalid or mismatched tokens still fail instead of being ignored.
- Signed read URLs are generated immediately before the provider call and are not persisted by this app.
- MIME type, upload size, image dimensions, and file signature are checked before a signed upload URL is created.
- Stored object verification re-reads a bounded prefix with the server-side service role and does not expose the service role key, Authorization header, signed read URL, or signature prefix back to the browser.
- If post-upload verification fails, the server attempts to delete the uploaded object and returns only sanitized cleanup status.
- Login, title generation, signed image upload/verification, provider status, module rendering, feedback, and publish API handlers now use per-client rate limits. All listing data mutation/readiness endpoints require the signed internal session cookie, while retention cleanup requires the cron bearer secret. Client keys are hashed and 429 responses expose only bounded limit metadata.
- The default `listing-card-images` Storage migration creates a private bucket with the same MIME family and default 25MB object-size limit as the application validation layer. It does not grant anonymous browser policies; the trusted server path creates signed upload/read URLs with the service role key.
- Storage retention cleanup is server-side and opt-in. `LISTING_IMAGE_RETENTION_DAYS` must be configured, manual script runs default to dry-run, and actual manual deletion requires `node scripts/storage-retention-cleanup.mjs --apply`.
- Production scheduled retention cleanup is a protected Vercel Cron route at `GET /api/listing-storage-retention-cleanup`, configured in `vercel.json` for `0 9 * * *`. It requires an `Authorization` bearer value derived from `CRON_SECRET`, defaults to apply mode for authorized cron requests, supports `?dry_run=true` for manual verification, and returns only a sanitized summary.

## Current Limits

Implemented:

- Supabase Storage readiness check
- signed upload URL creation
- first-byte signature validation for JPEG, PNG, WebP, and HEIC/HEIF upload requests
- configurable upload byte-size, long-edge, and total-pixel limits
- post-upload stored object verification for actual MIME, size, signature bytes, and parseable PNG/JPEG/WebP dimensions
- server-signed storage verification tokens scoped to object path, bucket, MIME, byte size, and dimensions
- durable `listing_image_verifications` persistence for server-verified object metadata when Supabase REST is configured
- best-effort cleanup delete for objects that fail post-upload verification
- direct browser upload path
- signed read URL creation for Agnes
- object path propagation to provider requests
- `capture_profile_id` with default `standard-card-v1`
- blur, glare, perspective, crop, readability, and resolution scores
- critical-region occlusion keys for subject, year/product, card type, serial, collector number, checklist code, grade label, autograph, and patch/relic
- conservative glare route output: `GLARE_CLEAR`, `GLARE_RECOVERED`, or `TARGETED_RESCAN_REQUIRED`
- multi-view critical-region recovery: if one image has a glare-occluded region and another image has the same region clear, the asset summary records `GLARE_RECOVERED` with `recovered_regions` instead of requesting targeted rescan
- targeted crop planning for serial, checklist code, collector number, grade label, and year/product regions
- derived crop image records with source region, crop role, and source image metadata
- storage mock coverage
- image-quality mock coverage for clear, textured white, glare-occluded, unresolved glare, and alternate-view recovered samples
- crop-planner mock coverage
- API rate-limit mock coverage for bucket reset, env overrides, hashed client identifiers, 429 responses, and headers
- Storage migration coverage for private bucket settings, MIME constraints, service-role-only policy intent, and rollback shape
- Storage verification record coverage for row shaping, upsert, readback, metadata mismatch rejection, missing records, and sanitized responses
- Storage retention coverage for disabled mode, date-prefix planning, dry-run behavior, batch deletion, and sanitized summaries
- Storage retention API coverage for cron authentication, authorized apply behavior, manual dry-run behavior, and sanitized responses

Still pending:

- live application of the Supabase Storage migration against a real project
- database persistence for `listing_assets.front_object_path`, `back_object_path`, and additional image paths
- live validation of cleanup delete behavior against real Supabase Storage policies
- byte-level HEIC/HEIF dimension parsing beyond the current metadata and signature validation
- live validation of durable verification record writes against a migrated Supabase project
- live validation of the scheduled retention cleanup route in production
- multiple capture profiles and admin configuration
- stronger glare segmentation and blur detection
- live focused reread validation against Agnes with configured signed crop images
- targeted rescan orchestration after focused reread cannot recover the blocked region
- live storage smoke test against a real bucket

## Validation

Current validation commands:

```text
npm run check
npm test
node scripts/storage-signed-url.test.mjs
node scripts/storage-migration.test.mjs
node scripts/storage-verification-record.test.mjs
node scripts/storage-retention.test.mjs
node scripts/storage-retention-api.test.mjs
node scripts/image-quality-gate.test.mjs
node scripts/image-crop-planner.test.mjs
```

Mock tests verify the REST paths and payload shapes. They do not prove a real Supabase bucket, policy, or signed upload works until live credentials and a bucket are configured.

Image-quality tests verify the current heuristic behavior only. They do not claim industrial glare segmentation, OCR readiness, or production recovery rates.
