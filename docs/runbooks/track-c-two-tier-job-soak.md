# Track C two-tier job soak

The queue reliability gate has two independent layers. Neither layer is an
accuracy test or a provider-throughput benchmark.

## Layer 1: disposable cloud database

Workflow: `track-c-cloud-1000-job-soak.yml`

- Runs automatically for queue, migration, or soak-test changes.
- Starts a temporary Supabase PostgreSQL database on a standard GitHub-hosted
  runner and applies the repository's real migrations from zero.
- Calls no GPT, OCR, Storage, image, Vercel, or hosted Supabase service.
- Requires all 1,000 deterministic jobs to reach one terminal result with zero
  lost jobs, duplicate claims, cross-tenant claims, or leaked capacity slots.
- Also verifies heartbeat fencing, expired-lease recovery, response-loss
  reconciliation, duplicate-wake idempotence, bounded retry, and manual rerun.
- Missing database configuration is a hard failure in this workflow; the
  credential-free offline suite may still skip the PostgreSQL-only test.

## Layer 2: dedicated hosted integration

Workflow: `track-c-hosted-3x100-soak.yml`

- Manual only and protected by the `listing-soak` GitHub Environment.
- Requires a Vercel Preview URL and a dedicated non-production Supabase project.
- Rejects the production Listing hostname and a mismatched Supabase project ref.
- Runs three sequential waves of 100 `CONTROL_PLANE_SOAK` jobs and cleans each
  wave before starting the next one.
- Uses real PostgREST, internal wake, Preview worker, claim/lease, heartbeat,
  retry, completion, event persistence, and network boundaries.
- `CONTROL_PLANE_SOAK` is not accepted by the public queue normalizer. The
  worker executes it only when both `VERCEL_ENV=preview` and
  `V4_CONTROL_PLANE_SOAK_ENABLED=true`; otherwise it fails final before any
  provider call.
- Every completed soak job records `provider_calls=0` and
  `provider_call_skipped=true`.

Required `listing-soak` secrets:

- `SOAK_SUPABASE_URL`
- `SOAK_SUPABASE_SERVICE_ROLE_KEY`
- `SOAK_V4_WORKER_SECRET`
- `SOAK_VERCEL_AUTOMATION_BYPASS_SECRET` when Preview protection is enabled

The Preview deployment must point at the same dedicated Supabase project and
use the same worker secret. Never reuse production Supabase or the production
domain as a fallback.
