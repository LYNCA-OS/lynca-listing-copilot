# Production CSM latency-stage telemetry — 2026-08-02

## Purpose

The direct CSM route already records request wall time and provider latency,
but the difference was only available as an inferred remainder. This additive
receipt records the bounded stage timings needed to distinguish a cloud-chain
regression from a Luna/provider tail. It does not alter scheduling, prompts,
image detail, retries, persistence ordering, or paid-call count.

## Recorded fields

`v4_recognition_sessions.csm_owner_versions.latency_stages_ms` is a small,
sanitized integer map. Current keys are:

- `preflight_ms`: cached or cold CSM/pacer readiness;
- `image_manifest_ms`: durable asset and verified-image reads;
- `signed_url_ms`: Supabase Storage signed URL calls;
- `recognition_session_ms`: idempotent recognition-session creation;
- `provider_prepare_ms`: the whole paid model/CSM preparation boundary;
- `provider_ms`: provider-reported request latency when available;
- `authority_dispatch_ms`: durable admission through checkpoint settlement.

The successful API response additionally carries `csm_persistence_ms` and
`request_total_ms` for immediate diagnostics. They are not used to decide
whether a title is usable; CSM remains fail-closed on persistence.

Only non-negative finite numbers and bounded field names are retained. No
tenant identifiers, image URLs, prompt text, or provider response bodies are
included.

## Interpretation gate

Do not change production concurrency or add a second model call from aggregate
request means. After enough fresh production traffic exists, compare p50/p95
for each stage and the total:

1. If `provider_ms` tracks the long tail, the binding resource is Luna/provider
   service time; local queue or Supabase rewrites cannot claim the gain.
2. If `authority_dispatch_ms` dominates while `provider_ms` is stable, inspect
   the global token/count pool and claim polling before changing the provider.
3. If Storage or session stages dominate, test only an additive, reversible
   overlap or batching change with a paired hosted screen.

The receipt is diagnostic evidence only. It does not establish an accuracy
gain or a production SLO by itself.
