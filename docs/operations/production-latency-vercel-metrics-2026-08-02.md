# Production CSM latency — Vercel read-only measurement (2026-08-02)

## Scope

Read-only Vercel Observability queries against production project
`lynca-listing-copilot` in team scope `lyncafei-s-projects`. No deployment,
provider request, Supabase write, migration, or Cloud Run/vector/OCR call was
made by this measurement. The queries covered the preceding 24 hours and
filtered successful `POST /api/csm-listing-title` requests where the metric
supports the request path.

## Measured signal

| Signal | Aggregation | Result |
| --- | ---: | ---: |
| Vercel function duration | p50 | 4,144 ms |
| Vercel function duration | p95 | 5,327 ms |
| Vercel function duration | p99 | 5,327 ms |
| Route CPU duration | p95 | 9 ms |
| Outgoing request duration, origin `/api/csm-listing-title` | p95 | 3,219 ms |

The 12-hour slice had a p50 of 3,810 ms and the same 5,327 ms p95/p99; the
last six hours had no successful CSM samples, so it must not be reported as a
fast result. The outgoing-request metric is grouped by Vercel's origin path,
not by provider host, so it is supporting evidence rather than a direct
`provider_ms` receipt. The 24-hour success count was only `n=9`; these are
directional tail evidence, not a stable production SLO estimate.

## Interpretation

Route CPU is three orders of magnitude below end-to-end duration. The current
tail is therefore not JavaScript compute or a local concurrency loop. The
external-call measurement and the existing stage-receipt design point to the
provider/network/admission boundary, but this aggregate cannot distinguish
provider service time from durable claim/persistence time. Do not raise local
concurrency or overlap signed URL/session side effects from this evidence.

The deployed health receipt was also checked at the same time: production SHA
`56cb434353d964ca4f68cf7ad982b766077ff50a`, `CSM_THIN_DIRECT`, Luna
`gpt-5.6-luna`, reasoning `none`, persistence/provider ready, and zero Cloud
Run/vector/generic-OCR calls.

## Next gate

Use a small authorized writer request (or a hosted, isolated sweep) and read
the persisted `latency_stages_ms` map. Only then choose one reversible change:

1. `provider_ms` dominates: keep the chain single-call and tune the provider
   boundary, not Supabase or the local dispatcher.
2. `authority_dispatch_ms` dominates while `provider_ms` is stable: inspect
   claim polling and the global token/count pool.
3. Storage/session/persistence dominates: test an additive overlap or batch
   only with an explicit orphan-session and rollback guard.

Until one of those three stage patterns is measured, production code remains
unchanged.
