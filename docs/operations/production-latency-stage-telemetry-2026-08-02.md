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

The same owner-version receipt also records `provider_attempt_number` and
`provider_retry_count`. These are counters, not durations: they distinguish a
slow first provider attempt from a request that spent its tail in retry or
admission. They are populated only after a provider attempt has been durably
claimed, so a pre-provider storage/session failure cannot be misclassified as
a model retry.

## Interpretation gate

## Regional provider gate

The first authenticated production probe on 2026-08-02 reached the CSM route
but the provider returned HTTP 403 with `Country, region, or territory not
supported`. Vercel identified the execution region as `hkg1`. A matching
image-bearing request from the local evaluation environment returned HTTP 200,
so this was a deployment-region rejection, not a Luna latency tail or an image
quality result. The Hong Kong placement is therefore a negative production
asset for this provider and is replaced by the supported `iad1` region before
any latency comparison. The probe must be repeated after that deployment; the
pre-change 2.5–3.2 second failures are not provider-latency samples.

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
