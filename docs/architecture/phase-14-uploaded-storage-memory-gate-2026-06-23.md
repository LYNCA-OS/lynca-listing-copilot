# Phase 14 - Uploaded Storage And Memory Gate

Date: 2026-06-23

## Purpose

Production recognition should start from uploaded card images, not from external marketplace image URLs. The storage layer must be fast and stable now, while feedback-data retention and training reuse stay disabled until the commercial phase.

## Current Boundary

- Supabase Storage upload, verification, object-path handling, and short-lived signed read URLs remain active infrastructure.
- Browser uploads include client-side SHA-256. Server verification records object paths, metadata, and hash status when the object bytes are available.
- Agnes recognition should use controlled storage signed read URLs.
- Marketplace or external image URLs are allowed only for pilot stress testing and are not production recognition inputs.
- The current marketplace real-photo pilot attempted 10 external URLs, evaluated 6, hit 4 provider errors/timeouts, and accepted 0/6 evaluated titles under the stricter critical-field policy. This is input-pipeline evidence, not a commercial accuracy claim.
- Feedback review persistence is opt-in through `LISTING_FEEDBACK_RETENTION_ENABLED=true`.
- Approved-memory retrieval is opt-in through `LISTING_APPROVED_MEMORY_ENABLED=true`.
- Both switches default to off so manual tests and agent tests do not become training or stable approved memory.

## Future Commercial Loop

When commercial data retention is approved:

1. Browser uploads original card images to private object storage.
2. Server verifies MIME, size, dimensions, signature, object path, and content hash where possible.
3. Recognition uses short-lived signed read URLs created from durable object paths.
4. Review approval writes cleaned rows only when feedback retention is enabled.
5. Accepted unchanged reviews become `approved_clean`.
6. Corrected or title-override reviews become `reviewed_correction`.
7. Future assets can query by `asset_fingerprint` or content hash before calling Agnes.
8. Stable approved samples can later feed product training and regression evaluation.

## Non-Goals In This Phase

- Do not upload current agent test data or manual test feedback as training data.
- Do not claim commercial accuracy from public card references or marketplace image pilots.
- Do not let seller titles become ground truth.
- Do not unlock B-end publishing from a skipped feedback-retention response.

## Verification

Run:

```bash
node scripts/storage-signed-url.test.mjs
node scripts/feedback-review.test.mjs
node scripts/retrieval.test.mjs
```

The feedback test confirms the default API response is accepted but not retained, and that the legacy retained path still works only after enabling the retention switch.
