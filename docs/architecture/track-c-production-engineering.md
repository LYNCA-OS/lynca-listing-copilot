# Track C: Production Engineering

Status: implementation branch `codex/track-c-production-engineering`
Baseline: `main@2aab0b5`
Database compatibility gate: PostgreSQL 16.14 and 17.10
Deployment state: preview and production are unchanged; this document describes the reviewed implementation and rollout contract only.

## Outcome

A customer request must carry one trusted tenant context from authentication to storage, queueing, persistence, logs, and operational metrics. A client-supplied `tenant_id`, batch id, asset id, or object path is never an authorization decision.

```text
authenticated identity
        |
        v
active tenant membership + role
        |
        v
AuthContext { requestId, tenantId, userId, role }
        |
        +--> requirePermission()
        +--> tenant-scoped database predicates
        +--> tenant-prefixed Storage paths
        +--> job/session/feedback/export propagation
        +--> request/error/recognition events
        +--> tenant ops snapshot
```

## First-principles boundaries

1. Tenant identity is an authorization fact, not a scheduler label. Historical `v4_recognition_jobs.tenant_id` values came from batch ids and are preserved separately as `legacy_scheduler_scope_id` before backfill.
2. Customer operational data is tenant-owned. It receives a direct `tenant_id` even when the tenant can also be derived through a parent, which keeps service-role queries and RLS auditable. Browser roles have no direct `storage.objects` grants; tenant- and assignment-aware backend APIs mint bounded upload/read URLs for tenant-prefixed objects.
3. Platform reference data is shared, read-only knowledge. Official catalogs, canonical SEM definitions, and provider-capacity leases are not assigned to an arbitrary customer. Any customer-derived promotion into shared knowledge requires an explicit event with `source_tenant_id` and sharing approval.
4. RLS is defense in depth. The server currently uses `service_role`, which bypasses RLS, so every service-role query must also carry a tenant predicate enforced by the application context.
5. Compatibility is deliberate. The initial rollout uses expand/backfill/contract, keeps existing physical job states, and isolates historical data inside a bounded `tenant_legacy` tenant.
6. Paid recognition is durable-first. A customer request may enqueue work, but only a worker reconstructing identity from a persisted tenant-scoped job may invoke the recognition core. Immediately before any session/provider side effect, an atomic heartbeat must prove the job is still `RUNNING`, owned by that worker, and unexpired. Lease loss aborts the in-flight provider signal. The retired legacy title/render endpoints cannot use a worker secret to select an arbitrary tenant.
7. Deployment is code-only. Database migrations run in a separate approved maintenance window; the production workflow performs read-only schema preflights before and after deployment and never calls runtime migration APIs.

## Roles and permissions

| Capability | Owner | Manager | Writer |
| --- | --- | --- | --- |
| Manage tenant members/configuration | yes | no | no |
| View all tenant work | yes | yes | no |
| View assigned work | yes | yes | yes |
| Upload and create jobs | yes | yes | no |
| Assign or retry jobs | yes | yes | no |
| Edit a title and submit feedback | yes | no | assigned only |
| Export tenant data | yes | no | no |
| View usage cost | yes | no | no |

Workers use a separate internal context authenticated by the worker secret. A trusted tenant filter may narrow scheduler polling, but resource ownership and creator/assignee identity are reconstructed from the persisted job/session. A tenant value in a new worker payload never authorizes access or overrides persisted ownership.

Tenant configuration is an Owner-only, allowlisted JSON object. Reads and writes use the same trusted tenant context as the rest of the API; arbitrary keys and tenant aliases are rejected.

A writer assignment is scoped to one recognition session (one card). Paired L1/L2 jobs move atomically with that session. A batch can contain independently assigned cards, so its historical `assigned_to_user_id` field is deprecated and is not an authorization or assignment source.

## Retry contract

`max_retry=3` means one initial attempt plus at most three retries (`max_attempts=4`). The retry schedule is 10 seconds, 30 seconds, then 120 seconds. The existing database states remain compatible while API output exposes the canonical state:

| Physical state | Canonical state |
| --- | --- |
| `QUEUED` | `QUEUED` |
| `RUNNING` | `RUNNING` |
| `L1_READY`, `L2_READY` | `SUCCESS` |
| `RETRYING` | `RETRYABLE_FAILED` |
| `FAILED`, `CANCELLED` | `FAILED_FINAL` |

An expired `RUNNING` lease is claimable only while `attempt_count < max_attempts`. An exhausted lease transitions atomically to final failure and emits an append-only attempt event; it must never be reclaimed forever.

Pre-ingestion OCR has its own durable lease (`lease_owner`, `lease_expires_at`) and attempt ceiling. Claim, renewal, completion, requeue, and stale recovery are tenant- and owner-conditional. A stale worker cannot complete over a new owner, and an expired legacy lease is recovered after the bounded grace period.

## Observability contract

- Request log: request id, tenant id, user id, method/path, status, duration, timestamp.
- Recognition ledger: tenant/session/job ids, model and prompt version, route, latency, tokens, estimated cost, success.
- Error log: sanitized error type, fingerprint, bounded stack, session/job ids, recoverability.
- Job attempt event: append-only state transition, attempt number, ready/run/failure timestamps, retry delay and safe error code.

Never persist API keys, cookies, Authorization headers, signed URLs, image bytes/URLs, raw prompts, provider response bodies, or seller-title labels in operational logs.

## Dashboard metric definitions

- Queue: `QUEUED + RETRYING`, separately grouped by lane.
- Processing: `RUNNING` with an unexpired lease.
- Final failure: terminal `FAILED` or `CANCELLED` inside the selected window; retryable attempts are not counted as final failures.
- Average wait and p50/p95 wait: `started_at - created_at` for jobs started inside the selected window.
- Writer-visible p50/p95 latency: earliest successful L1/L2 completion per card minus that card's earliest job creation time; paired jobs are counted once.
- AI success rate: the latest non-retryable terminal `production_events` outcome per card/session/job inside the selected window; later success supersedes earlier failed attempts.
- Accept/Edit/Reject: writer feedback events divided by sessions with feedback; feedback coverage is shown separately.
- Average cost/card: configured estimated cost divided only by successfully completed cards. Missing pricing is displayed as unconfigured, never `$0`.

## Rollout order

1. Rehearse and checksum the four reviewed migrations on an isolated clone of the verified existing-staging baseline, including matching migration history: `65803` tenant foundation, `65808` retry hardening, `65812` tenant settings, then `65820` OCR durable leases. Do not use an empty database until the older clean-bootstrap blockers in the readiness report are repaired.
2. In a maintenance window, apply those files in that exact order and stop on the first error. Preserve old scheduler labels as `legacy_scheduler_scope_id`, create `tenant_legacy`, and backfill before enforcing ownership.
3. Run `scripts/check-track-c-production-schema.mjs` over a direct PostgreSQL connection. It opens a read-only transaction and fails closed on missing tables, columns, RLS policies, immutable-tenant triggers, constraints, indexes, or runtime RPC signatures.
4. Deploy application code only after the preflight passes. The deployment workflow repeats the read-only preflight after deployment; it does not mutate schema.
5. Verify zero null tenant ids, zero cross-tenant child rows, retry exhaustion, OCR stale-lease recovery, two-tenant negative access, and one complete upload-to-export flow.
6. Remove the bounded `tenant_legacy` compatibility path and runtime admin migration endpoints only after pilot backfill evidence is accepted.

## Parallel engineering boundary

This work was developed in the isolated worktree `lynca-listing-copilot-track-c`; it does not rewrite another engineer's checkout. Track C owns tenant context, RBAC, retry policy, durable execution, production event logging, schema preflight, and the ops snapshot. Changes to shared HTTP boundaries and tests are limited to enforcing those contracts. Catalog/data-asset changes should arrive through stable Track D interfaces rather than copied worktree changes.
