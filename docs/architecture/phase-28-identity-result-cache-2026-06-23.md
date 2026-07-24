# Phase 28 Identity Result Cache

Date: 2026-06-23
Branch: `v2_pai`

## Goal

Reduce repeated legacy vision provider and recognition-worker calls for identical uploaded card images without weakening the Identity Resolution gate.

This phase adds a short-lived server-side cache keyed by verified primary-image content hashes. It is a cost and latency fast path only. It is not approved memory, not feedback retention, and not a training table.

## What Changed

New module:

- `lib/listing/cache/identity-result-cache.mjs`

New API behavior:

- `api/listing-copilot-title.js` checks the cache after approved-memory lookup and before recognition/provider calls.
- Cache reads require primary images with durable Supabase image verification and matching `content_sha256`.
- Cache writes happen only after the normal evidence-grounded path returns a cacheable identity result.

New migration:

- `supabase/migrations/20260623_listing_identity_result_cache.sql`

New test:

- `scripts/identity-result-cache.test.mjs`

## Safety Contract

The cache may store only:

- `CONFIRMED` identity results by default.
- `RESOLVED` identity results only when `LISTING_IDENTITY_CACHE_WRITE_RESOLVED=true`.
- Completed, non-technical `ABSTAIN` results with a final writer-ready L2 title. Replay preserves the original status and cannot promote identity confidence; structured identity completeness remains a requirement for `CONFIRMED` / `RESOLVED` writes, not for idempotent safe-draft replay.
- Final title, normalized public card fields, identity status, source provider,
  and the complete version vector. Original evidence and execution traces stay
  with their tenant-local request and are not shared.
- Verified image roles and content hashes, without tenant ids, object paths,
  asset ids, user data, or signed URLs.

The cache rejects:

- `ABSTAIN`.
- `AMBIGUOUS`.
- Missing final title.
- Missing year, product, or subject.
- Unverified image storage.
- Missing or mismatched content hash.

## Supabase Boundary

The table is public schema but server-only:

- RLS is enabled.
- `anon` and `authenticated` access is explicitly revoked.
- service role receives explicit table grants for Supabase REST/Data API access.

Supabase changed new-table Data API exposure behavior in 2026, so deployment must verify the table is reachable by service role and not reachable by browser roles.

## Operational Impact

On an exact verified image-content match:

- provider calls: `0`
- recognition worker calls: `0`
- retrieval calls: `0`
- route: `IDENTITY_RESULT_CACHE`
- source/provider: `internal_identity_result_cache`

The v3 key is global for identical verified image content and requires an exact
pipeline-fingerprint match. Each decision owner publishes its version into the single
`recognition_pipeline_fingerprint`, including provider/OCR, Evidence and normalization,
Resolver, Route Planner, exact-anchor, crop, vector, worker, SEM, candidate policy,
catalog, Renderer, and title profile. A stale row is reported as `cached_result_version_mismatch`
and falls through to recognition; it is never returned as current L2. Each
request still owns its tenant-local asset, queue, session, and audit records;
only the anonymous card result is shared. In-flight request coalescing remains
tenant-scoped because a running pipeline result has not yet crossed the
anonymous cache-write boundary.

Runtime telemetry is explicit on both hit and miss paths:

- `identity_cache_hit`
- `identity_cache_miss_reason`
- `provider_call_skipped`
- `cached_result_version_match`

Evaluation uses three non-interchangeable profiles:

- `cold_algorithm_benchmark`: disables cache read/write, approved memory, writer-final replay,
  and in-flight replay; every completed card must report exactly one provider call.
- `exact_replay_benchmark`: cold phase writes once, replay phase reads once; the replay must use
  zero provider calls and preserve the exact title and canonical Resolver state.
- `production_workload_benchmark`: leaves production reuse enabled and reports the observed hit rate.

Exact-result authority is fixed as `WRITER_FINAL_REPLAY`, then
`APPROVED_IDENTITY_MEMORY`, then `AI_TERMINAL_L2_REPLAY`, then full recognition.
AI terminal replay is idempotence only: it is never identity truth, training eligible, or
catalog-promotion eligible.

Catalog invalidation is automatic. Committed decision changes on active catalog tables
advance `listing_active_catalog_snapshot.content_revision`; no environment knob or manual
cache bump is accepted. No-op update statements do not advance the revision.

This helps the low-cost target for duplicate or repeated upload workflows, while preserving the original identity-resolution trace for audit and replay.

## Rollout Controls

Environment toggles:

- `LISTING_IDENTITY_CACHE_ENABLED`
- `LISTING_IDENTITY_CACHE_READ_ENABLED`
- `LISTING_IDENTITY_CACHE_WRITE_ENABLED`
- `LISTING_IDENTITY_CACHE_WRITE_RESOLVED`
- `LISTING_IDENTITY_CACHE_TTL_DAYS`

Recommended rollout:

1. Apply migration and verify service-role-only REST access.
2. Enable read only.
3. Enable write for `CONFIRMED` only.
4. Review cache-hit traces.
5. Consider `RESOLVED` writes only after enough manual QA.
