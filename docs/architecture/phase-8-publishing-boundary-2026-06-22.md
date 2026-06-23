# Phase 8 Publishing Boundary

Date: 2026-06-22

## Scope

This phase establishes the publishing contract without inventing a real B-end merchant-system API. Publishing remains separate from AI recognition, retrieval, resolver, renderer, and feedback flows.

## Added Modules

- `lib/listing/publishing/listing-draft.mjs`
- `lib/listing/publishing/publisher-contract.mjs`
- `lib/listing/publishing/mock-publisher.mjs`
- `lib/listing/publishing/publisher-registry.mjs`
- `lib/listing/publishing/publish-audit-store.mjs`
- `lib/listing/publishing/publish-listing-draft.mjs`

## ListingDraft Contract

The publishing service accepts a reviewed listing draft:

```json
{
  "asset_id": "",
  "review_id": "",
  "final_title": "",
  "resolved_fields": {},
  "modules": {},
  "review_status": "APPROVED",
  "approved_by": "",
  "approved_at": "",
  "publish_status": "READY"
}
```

The approval gate rejects drafts unless:

- `review_status = APPROVED`
- `approved_by` is present
- `approved_at` is present
- `publish_status = READY`
- `asset_id`, `review_id`, `final_title`, and `resolved_fields` are present

## Publisher Adapter

Only one destination is active:

- `mock_b_end`

The mock publisher returns a deterministic external id and echoes the submitted draft. It is a contract test adapter, not a real upload integration.

No real B-end endpoint, authentication format, payload shape, or destination URL has been invented.

## API

Added:

- `POST /api/listing-publish-draft`

The route is authenticated with the existing internal session cookie. It calls `publishListingDraft()` and returns publish status, idempotency key, audit job, and mock response.

## Frontend Boundary

The asset workbench now exposes a mock publish action only after the feedback save returns a server-side approved review:

- `review.id` becomes the `ListingDraft.review_id`
- `review.operator_id` becomes `approved_by`
- `review.approved_at` must be present
- current corrected resolved fields and modules become the draft payload
- the UI destination is fixed to `mock_b_end`
- the UI sends `dry_run: true`

If the saved review is `REJECTED`, `TECHNICAL_FAILURE`, `NON_STANDARD_MANUAL`, or a pending `TARGETED_RESCAN_REQUIRED` result with no `approved_at`, no publish button is shown. Editing the title or any module clears the current publish state and requires a new review save before another publish attempt.

## Idempotency And Audit

`publishListingDraft()` computes or accepts an idempotency key and checks the audit store before publishing. If a previous job with the same idempotency key is already `PUBLISHED`, it returns `SKIPPED_DUPLICATE` and does not call the publisher again.

Audit stores:

- Supabase REST store when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured.
- In-memory fallback for local unconfigured development and tests.

## Migration

Migration:

- `supabase/migrations/20260622_listing_publish_jobs.sql`

Rollback:

- `supabase/migrations/20260622_listing_publish_jobs_rollback.sql`

Table:

- `listing_publish_jobs`

Columns include:

- `asset_id`
- `review_id`
- `destination`
- `idempotency_key`
- `status`
- `request_snapshot`
- `response_snapshot`
- `attempts`
- timestamps

## Retry Policy

`PUBLISH_MAX_ATTEMPTS` controls bounded retry count. Default behavior is two attempts, capped at five.

Retries apply only when the publisher marks an error as retryable.

## Tests

Added:

- `scripts/publishing.test.mjs`

Coverage includes:

- unapproved drafts are rejected
- approved drafts publish through the mock adapter
- idempotency prevents duplicate publisher calls
- retry succeeds after a transient mock failure
- retry exhaustion records a failed audit job
- API returns 403 for unapproved drafts
- API returns a mock publish result for approved drafts
- frontend exposes `/api/listing-publish-draft` only through an approved `ListingDraft` mock-publish path

## Known Gaps

- There is no real B-end adapter because no B-end API documentation is present.
- No live Supabase migration was applied in this local run.
- In-memory audit fallback is not durable across serverless cold starts.
- The frontend still does not expose a production publish button; the current control is mock-only and dry-run until real B-end API documentation exists.
