# Production latency audit — 2026-08-02

## Scope

Read-only audit of the deployed `CSM_THIN_DIRECT` path. No provider calls,
database writes, migrations, or Cloud Run/vector/OCR services were used.

The historical request rows below belong to the earlier production baseline
`aebe5b78e02d1f48dbb89e598c48c098b82b81d5`. The current production mainline is
`5792ba2d3f72bd01a4c58e3deb6910dc0eac535c`, deployed in Vercel `hkg1` with the
same direct CSM contract and additive stage telemetry.

## Evidence

The health endpoint reports `ready=true`, model `gpt-5.6-luna`, reasoning
`none`, persistence/provider configured, and zero Cloud Run/vector/generic OCR
calls. Root and `/app` return the expected login redirect for an anonymous
request.

From the Supabase `request_logs` rows for `/api/csm-listing-title` on
2026-08-01:

- 22 requests total: 9 HTTP 200, 8 validation 400, 4 HTTP 503, 1 method 405;
- successful request duration: 3,621–5,240 ms, p50 4,082 ms, p95 5,170.5 ms;
- four 503s are not model quality failures. Three are
  `ambiguous_result_lookup_unavailable`, and one is an older request failure.

Six successful rows can be paired unambiguously with the recent direct CSM
session records. Their provider and request measurements are:

- request: 3,621–5,240 ms;
- Luna provider: 3,105–4,815 ms;
- non-provider remainder: 389–516 ms.

The session wall clock includes persistence; it is not used as a substitute for
the request log. The provider therefore dominates the ordinary long tail in
this historical sample. Current Vercel logs through the follow-up audit window
contain only anonymous redirects, health/session probes, and the intentional
method check; there is no fresh authenticated `/api/csm-listing-title` request
from which to claim a current `provider_ms` or `request_total_ms` distribution.
The HKG base-path probe was faster than the earlier `syd1` probe, but that is
not a provider measurement.

## Decision

Do not deploy an unmeasured cloud “optimization.” Stage timing is now present
in the deployed response and persisted session owner metadata; the next
measurement must come from an authorized writer request or an isolated hosted
canonical sweep. It must keep the provider boundary single-call and
retry-safe. Accuracy experiments remain evaluation-only until their independent
150-card gate passes.
