# V4 L1 Latency Diagnosis

Source report:

`data/eval/workflow-sidecar-smoke/v4-fast-scout-one-image-final-smoke-5-2026-07-07T07-30-58-467Z.json`

## Baseline

The latest 5-card V4 fast-scout smoke was functionally successful but still not architecturally progressive:

| Metric | Value |
| --- | ---: |
| success | 5/5 |
| route | 5/5 `COLD_START_SAFE_DRAFT` |
| title stage | 5/5 `L1_WRITER_SAFE_DRAFT` |
| L1 input image | 5/5 `front_original` only |
| L1 p50 / p95 | 9.573s / 10.769s |
| wall p50 / p95 | 15.987s / 17.368s |

The gap between L1 model work and user-visible wall clock is roughly 5-7 seconds. Before this patch, the V4 title API still awaited the full `persistPipelineResult()` before returning the L1 response.

## Blocking Diagnosis

The previous implementation allowed these modules to block L1 even after the fast scout draft was ready:

| Module | Previous L1 behavior | New L1 behavior |
| --- | --- | --- |
| recognition session create/update | blocking | scheduled/background for fast-scout L1 |
| field evidence persistence | blocking through `persistPipelineResult()` | deferred |
| candidate trace persistence | blocking through `persistPipelineResult()` | deferred |
| catalog gap queue write | blocking through `persistPipelineResult()` | deferred |
| production quality ledger | blocking through `persistPipelineResult()` | deferred |
| L2 assisted draft | scheduled, but L1 still waited for persistence | scheduled after L1 persistence |
| vector/external/full assist | not part of fast scout, but may run in L2 | deferred |

## Per-card Timing Fields

The source report can provide high-level fields:

- `wall_clock_ms`
- `time_to_l1_safe_draft_ms`
- route / stage / image count / image role

The source report did not yet provide enough module-level timing to fully break down:

- `signed_url_ms`
- `image_verify_ms`
- `session_persist_ms`
- `field_evidence_persist_ms`
- `quality_ledger_persist_ms`
- `catalog_gap_persist_ms`
- `sidecar_dispatch_ms`
- `l2_background_ms`
- `response_serialization_ms`

This patch adds first-pass instrumentation for fast scout image access:

- `fast_scout.signed_url_ms`
- `fast_scout.image_verify_ms`
- `timing.signed_url_ms`
- `timing.image_verify_ms`

It also adds response-level return-barrier diagnostics:

- `l1_return_barrier_version`
- `l1_blocking_modules`
- `l1_deferred_modules`
- `deferred_persistence_status`
- `l2_background_status`
- `fast_scout_cache_hit`
- `fast_scout_cache_status`
- `fast_scout_prewarmer_used`
- `fast_scout_blocking_call_used`

## New L1 Return Barrier

L1 is allowed to block only on:

- signed/current image access
- fast scout, or cached fast scout result
- minimal safety normalization
- deterministic renderer

L1 must not block on:

- recognition session persistence
- field evidence persistence
- candidate trace persistence
- production quality ledger
- catalog gap queue write
- sidecar dispatch
- L2 assisted draft
- vector retrieval
- external retrieval
- full evidence persistence

## Prewarm Path

Durable endpoint:

`POST /api/v4/listing-job-prewarm`

`POST /api/v4/fast-scout-prewarm` is now a cache-only probe. It never calls a
paid provider. Actual prewarm work is persisted as a `FAST_SCOUT_DRAFT` queue
job first, then runs through the normal capacity, retry, cost and event path.

New batch command:

```bash
node scripts/v4-prewarm-fast-scout-for-batch.mjs \
  --batch=data/eval/ebay-reference/ebay-c100-cloud-eval-dataset-20260707.json \
  --base-url=https://YOUR-VERCEL-PREVIEW.vercel.app \
  --limit=5 \
  --concurrency=1
```

The batch command enqueues durable L1-only jobs and reports queued/reused counts.
It does not claim that cache creation succeeded until the worker completes the
persisted job. No final listing title or catalog promotion is created.

## Expected Validation

Run two smokes on the same 5-card set:

1. no prewarm
2. prewarm then title generation

The required report fields are:

- `fast_scout_blocking_call_used`
- `fast_scout_cache_hit`
- `l1_deferred_modules`
- `time_after_l1_spent_on_persistence`

Expected direction:

- no-prewarm wall clock should move closer to L1 model time because persistence is no longer awaited.
- prewarmed wall clock should avoid the blocking GPT fast-scout call and should target 1-3s if image access and session overhead are low.
