# Production cloud runtime evidence — 2026-08-02

## Scope

This is a read-only launch audit, not a recognition accuracy or production SLO
claim. The production aliases were checked after deployment `799bb1ea`:

- `https://listing.lyncafei.team`
- `https://lynca-listing-copilot.vercel.app`

Both aliases returned the same production health receipt: `CSM_THIN_DIRECT`,
GPT-5.6 Luna with reasoning `none`, and zero Cloud Run, vector, and generic OCR
calls. The login document returned HTTP 200 with the expected title. The
unauthenticated CSM endpoint remains correctly fail-closed with `AUTH_REQUIRED`.

## What is and is not measured

The post-deploy Supabase read-only audit found zero `v4_recognition_sessions`
created after `2026-08-02T00:00:00Z` (and zero after `2026-08-01T18:00:00Z`).
Therefore there is no authorized, successful production recognition request from
which to calculate `latency_stages_ms`, provider tails, persistence time, or an
end-to-end upload-to-title latency. The stage telemetry added to the route is
present but currently unobserved in production traffic.

As a static edge sanity probe, five requests to `/api/health` returned HTTP 200;
four warm samples were 0.32–0.58 s and one cold sample was 6.33 s. Five
`/app/login` requests returned HTTP 200 in 0.32–1.03 s. These are Vercel edge /
function observations only; they do not measure Luna or the CSM persistence
chain and must not be used as an accuracy or production-concurrency result.

## Gate

Keep the cloud latency work in `UNMEASURED_PRODUCTION_TRAFFIC` until a real
authenticated upload produces a persisted CSM session. Then compare the
recorded stage p50/p95 values before changing concurrency, image detail, or
request ordering. No provider call, Cloud Run call, vector lookup, OCR sidecar,
or second model call was made by this audit.
