# LYNCA Production Readiness Report — Track C

Date: 2026-07-15
Branch: `codex/track-c-production-engineering`
Baseline: `main@2aab0b5`
Scope: production engineering only; V4 recognition-quality tuning remains a separate workstream.

## Executive decision

**Code readiness: existing-staging upgrade ready. Pilot deployment and production promotion are not yet authorized by this report.**

The branch establishes a trusted tenant boundary from login through storage, durable paid execution, jobs, feedback, export, logs, and metrics. It also closes legacy human endpoints whose global persistence model cannot be made tenant-safe in the expand phase. All four Track C migrations replay cleanly on representative PostgreSQL 16 and 17 schemas, but the repository still has two older migration defects that block a clean database bootstrap/disaster-recovery rehearsal. Pilot preview remains gated on an isolated Supabase branch, two-tenant deployed negative checks, Vercel preview binding, and advisor review.

## Readiness matrix

| Area | Status | Evidence |
| --- | --- | --- |
| Multi-tenant | Implemented; preview migration pending | `tenants`, `users`, `tenant_members`; Owner-only allowlisted tenant settings; fail-closed `tenant_id` on customer operational data; immutable ownership and parent-lineage constraints; tenant-prefixed Storage objects; service-role queries use trusted tenant predicates; direct authenticated table and `storage.objects` ACLs are revoked. |
| RBAC | Implemented | Explicit Owner/Manager/Writer matrix; unknown permissions fail closed; member management Owner-only; Writer operations require assignment; direct RLS does not expose the team directory to Writers. |
| Retry | Implemented and locally verified | Canonical five-state projection; one initial attempt plus three retries at 10/30/120 seconds; transactional failure RPC; exhausted leases become final failures; manual rerun; explicit retry diagnostics columns; pre-ingestion OCR uses renewable owner leases and bounded stale recovery. |
| Production logs | Implemented | Correlated request, error, attempt, and recognition event ledgers; required lifecycle events; request id propagation; bounded/sanitized metadata and stack traces; append-only grants. |
| Metrics | Implemented and locally verified | Tenant ops RPC and `/ops` dashboard for live queue, lanes, running/completed/failure/retry, wait p50/p95, first writer-visible p50/p95, card-level success, feedback, calls/tokens/cost, and coverage. Missing/partial pricing never renders as `$0`. |
| Operations | Implemented; deployment not authorized | Runbook, code gates, and read-only fail-closed schema preflight are wired into the production workflow; deployment never mutates schema; health, worker, and platform-admin credentials remain separate; unsafe legacy human recognition/feedback/publish paths return `410`. Preview deployment, advisor review, and clean-bootstrap repair remain gated. |

## Multi-tenant controls

- Tenant selection comes only from a signed server session plus an active database membership. Payload `tenant_id`, operator ids, object paths, and batch ids are not authorization inputs.
- Core customer data covered: image assets and verification, pre-ingestion bundles/jobs, batches, recognition sessions/jobs, title/review/learning records, feedback, exports, identity/fast-scout caches, vector telemetry, workflow/annotation data, request/error/recognition/attempt logs.
- Shared SEM definitions, official catalog/reference data, vector index snapshots, and provider-capacity leases remain platform-owned. Customer feedback cannot automatically promote into shared catalog knowledge.
- Historical scheduler use of `v4_recognition_jobs.tenant_id` is preserved as `legacy_scheduler_scope_id`; old customer-generated rows are backfilled into the explicit `tenant_legacy` compatibility tenant.
- Storage paths use `tenants/{tenant_id}/listing-assets/...`; database lineage triggers reject a child row whose explicit tenant disagrees with its durable parent.
- Browser roles cannot list/read/write `storage.objects` directly. Upload and read URLs are minted only by backend APIs after tenant permission and Writer assignment checks, preventing a same-tenant Writer from browsing another Writer's card images.
- The V4-to-core bridge overwrites all tenant/actor/session aliases from trusted context. A tenant-B verification token/object path is rejected before any Storage or provider request when invoked under tenant A.
- The database prevents deleting or demoting the last active Owner under concurrent requests using a tenant-scoped advisory transaction lock.
- Tenant settings accept only the documented Owner-configurable keys and cannot be used to patch tenant identity, plan, status, or arbitrary JSON.

## RBAC summary

| Capability | Owner | Manager | Writer |
| --- | --- | --- | --- |
| Manage members/configuration | Yes | No | No |
| View all tenant work/team | Yes | Yes | No |
| Upload/create/assign/retry work | Yes | Yes | No |
| View/edit/feedback on assigned work | Yes | No | Yes |
| Export | Yes | No | No |
| View cost | Yes | No | No |

All protected APIs are statically classified as public, internal-secret, or tenant-auth. The current contract inventory reports zero unclassified or known access gaps.

## Job reliability

External state contract:

```text
QUEUED -> RUNNING -> SUCCESS
             |----> RETRYABLE_FAILED (physical RETRYING) -> RUNNING
             `----> FAILED_FINAL
```

`QUEUED` is the initial/manual-enqueue state. An eligible physical `RETRYING` row is claimed directly into `RUNNING`; the API does not expose an intermediate retry-to-`QUEUED` transition. Physical `CANCELLED` is projected as `FAILED_FINAL` until an authorized manual rerun.

- `max_retry=3` is implemented as `max_attempts=4`.
- Retry delays are exactly 10, 30, and 120 seconds.
- `retry_count`, `last_error`, `error_type`, and `next_retry_at` are generated from the transactional source-of-truth fields and exposed by job status.
- Failure classification separates retryable provider/network/timeouts from permanent input/auth/policy failures.
- A claim increments attempts and writes an append-only attempt event in the same transaction.
- Failure transition, retry eligibility, capacity release, and failure event are one RPC transaction.
- Expired leases at the attempt ceiling are finalized and cannot loop forever.
- Manual rerun is tenant-scoped and state-conditional.
- Paid recognition can start only from the durable worker path after its tenant-scoped job and session have been persisted. Direct customer execution returns `V4_DURABLE_ENQUEUE_REQUIRED`; critical persistence failure is retryable and fail-closed.
- Before any session/provider side effect, the worker endpoint atomically extends only a matching, unexpired `RUNNING` lease. Stale, expired, and completed jobs stop before session writes; heartbeat ownership loss aborts the in-flight fast-scout/full-L2 provider signal.
- Assignment is session/card-scoped: paired L1/L2 jobs move together, while another card in the same batch is unchanged. Direct session/job mismatches are rejected by immediate/deferred database invariants.
- Pre-ingestion OCR claims use `lease_owner` and `lease_expires_at`; renew/complete/requeue compare tenant, running state, and owner. Expired work is recovered, max-attempt work is finalized, and a stale owner cannot overwrite the new owner.
- A real PostgreSQL integration soak durably inserted 1,000 jobs, produced 1,000 unique claims and 1,000 attempt events across concurrent database claim clients/worker identities, completed all 1,000 through SQL state transitions, reclaimed one expired lease exactly once, rejected its stale owner, verified 10/30/120-second retry events, finalized attempt four, and manually reran attempt five to success. It is database-queue evidence, not a real HTTP worker or paid-provider load test.

## Logging and metrics contracts

The operational correlation tuple is `request_id`, `tenant_id`, `user_id`, `batch_id`, `job_id`, and `session_id`. Implemented lifecycle events are:

- `upload_started`
- `job_created`
- `recognition_started`
- `provider_called`
- `recognition_completed`
- `recognition_failed`
- `feedback_saved`
- `export_generated`

Operational logs reject or redact secrets, Authorization/Cookie values, signed URLs, image payloads, raw prompts, and provider response bodies. Metrics are tenant-scoped at the RPC input and again in every aggregate predicate. Retryable failures do not inflate final card failure, repeated attempts do not duplicate cards, and L1/L2 jobs sharing a session contribute only the first writer-visible success latency.

## Verification evidence

Local verification completed:

- Clean baseline `npm run check` passed before Track C changes.
- Production-engineering syntax and contract suites passed.
- PostgreSQL 16.14 and 17.10 replayed all four Track C migrations (`65803`, `65808`, `65812`, `65820`) twice on a representative full schema; all Track C foreign keys/checks were validated, the OCR lease index was valid/ready, and live tenant defaults were zero.
- SQL assertions covered tenant exclusion, queue-window semantics, retry-after-success, duplicate completion events, partial pricing, Owner invariant, and L1/L2 first-visible latency.
- The real PostgreSQL 1,000-job queue integration test completed without missing/duplicate claims or leaked leases, rejected wrong/stale/expired/completed heartbeat owners, and cleaned all test rows.
- PostgreSQL privilege evidence confirms `authenticated` has no `storage.objects` SELECT/INSERT/UPDATE/DELETE privilege while `service_role` retains server access; the read-only preflight now enforces this boundary and the atomic paid-execution lease fence.
- The V4-to-core cross-tenant image integration test rejected a foreign tenant token/path before external access.

Final branch gates:

- `npm run check`: passed (exit 0)
- `npm test`: passed independently (exit 0)
- Track C read-only schema preflight on PostgreSQL 16.14: passed, `read_only=true`, zero failed checks
- API access inventory: 55 routes classified (`public=4`, `internal_secret=23`, `tenant_auth=28`), zero known gaps
- PostgreSQL queue reliability: 1,000 persisted / 1,000 uniquely claimed / 1,000 completed / 1,000 durable attempt events
- Supabase isolated branch migration: pending explicit cost confirmation
- Supabase security/performance advisors: pending isolated branch
- Vercel preview deployment and smoke: pending isolated branch binding

## Current risks and rollout controls

1. **Production is intentionally unchanged.** Applying these expand migrations to production requires a reviewed maintenance/rollback window and is outside this preview task.
2. **Clean bootstrap / disaster recovery is blocked by older migrations.** `20260626051832_promote_card_reference_to_approved.sql` alters a missing `vector_fingerprints.model_revision`; `20260706130000_catalog_search_blob_materialized_v1.sql` uses non-immutable functions in a stored generated expression. These require a separate migration-hygiene owner or a verified baseline before the system can claim clean-environment readiness.
3. **The Track C foundation and OCR migrations are not online zero-lock migrations.** The foundation migration backfills customer tables, builds indexes, and validates constraints. The OCR migration updates running `preingestion_jobs`, validates lease constraints, and builds a partial claim index. Production requires a measured staging-clone rehearsal, lock/backfill timings for both, a maintenance window, and a rollback decision.
4. **Preview database cost requires explicit confirmation.** Supabase quoted US$0.01344/hour for a development branch; no branch is created until that cost is explicitly accepted.
5. **Legacy human endpoints are closed, not silently emulated.** Legacy title recognition, global feedback, and publish-draft endpoints return `410` so a client cannot bypass tenant ownership. Clients must move to V4 tenant APIs before pilot use.
6. **Legacy identity is compatibility-only.** Historical data maps to `tenant_legacy`; real pilot users require Supabase Auth identities and explicit memberships.
7. **Provider capacity remains two.** Track C does not raise the known stable GPT concurrency envelope and makes no recognition-accuracy claim.
8. **The 1,000-job soak tests the database queue, not paid-provider throughput.** A real external-provider soak still belongs to the controlled launch benchmark.
9. **Cost quality is coverage-gated.** Average cost/card is null until every counted provider event has a configured estimate.
10. **The API rate limiter is process-local.** It is useful as a pilot guardrail but is not a global multi-instance tenant quota. Production should add a distributed limiter or Vercel Firewall rule before materially increasing traffic.
11. **Standard migration order is a deploy precondition.** Apply `65803 → 65808 → 65812 → 65820`; the hardened claim RPC also requires the earlier queue-lane migration. The read-only preflight blocks code deployment when any required relation, constraint, index, policy, or RPC is missing.
12. **Member attachment is not an invitation system.** The member API can attach an existing Auth-linked user; pilot identity provisioning/invitation and membership activation remain an explicit operator step.

## Recommended production promotion sequence

1. After cost confirmation, create an isolated Supabase development branch cloned from the verified existing-staging baseline with matching migration history through `20260714174210`. Do not use an empty database while the older bootstrap defects remain open.
2. Apply `65803` tenant foundation, `65808` retry hardening, `65812` tenant settings, then `65820` OCR durable leases; run the read-only Track C preflight plus schema/data/RLS/advisor checks.
3. Bind only the Vercel preview environment to branch URL/keys and add separate worker/admin secrets.
4. Smoke login, two tenants, cross-tenant negative access, upload, enqueue, retry, feedback, export, ops, and log correlation.
5. Re-freeze/delete the test branch when evidence is captured if it is no longer needed.
6. Review the [production operations runbook](../runbooks/track-c-production-operations.md), this report, and migration lock/backfill timings before authorizing any production database change. The deploy workflow is code-only and must not be used to bootstrap schema.
