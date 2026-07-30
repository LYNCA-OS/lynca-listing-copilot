# Track C production operations runbook

Status: rollout procedure only. Preview and production are unchanged; see the linked Production Readiness Report for the current evidence and blockers. This document is not evidence that Track C has been deployed.

## Non-negotiable boundaries

- Production and preview must use different Supabase databases/projects or isolated Supabase branches, including separate service-role credentials and storage configuration. A preview deployment must never inherit the production Supabase URL, database URL, service-role key, or storage namespace.
- The production deploy workflow does **not** apply schema migrations. Schema maintenance is a separate, approved maintenance-window operation; the workflow only performs read-only schema preflights and fails closed when the schema is not ready.
- Legacy runtime migration handlers are disabled by default and cannot be enabled in a production runtime. `LYNCA_RUNTIME_MIGRATIONS_ENABLED=true` is only for an isolated non-production rehearsal with separate credentials; it is not a production break-glass path.
- Never run `supabase db reset`, an unscoped migration push, or a destructive down migration against production.
- Use the direct `POSTGRES_URL_NON_POOLING` connection only from the approved ephemeral maintenance runner. Reference the environment variable in commands; never paste or print its literal value, or copy it into an artifact.

## 1. Prepare and rehearse

1. Choose the exact reviewed `main` commit and record its SHA.
2. Rehearse the migrations and application against an isolated clone of the verified existing-staging baseline on the same PostgreSQL major version. Its schema and Supabase migration history must match the recorded baseline through `20260714174210`; do not start from an empty database while the clean-bootstrap blockers in the readiness report remain open. Confirm the preview environment does not reference production Supabase before starting.
3. Schedule a write maintenance window. Drain uploads/enqueues and allow current jobs to finish; do not rewrite `RUNNING` jobs by hand.
4. Create and verify a provider-managed recovery point/PITR checkpoint immediately before migration. Record its timestamp and restore instructions. Treat any logical dump as customer data: encrypt it, restrict access, and set a deletion date.
5. Record migration checksums:

```bash
shasum -a 256 \
  supabase/migrations/20260715065803_track_c_tenant_foundation_expand.sql \
  supabase/migrations/20260715065808_track_c_retry_state_machine_hardening.sql \
  supabase/migrations/20260715065812_track_c_tenant_settings.sql \
  supabase/migrations/20260715065820_track_c_preingestion_ocr_durable_leases.sql
```

The foundation migration performs backfills, constraints, indexes, triggers, grants, and RLS changes. The OCR durable-lease migration updates running OCR rows, validates new constraints, and creates a partial claim index. Both can wait for or take table locks. Before proceeding, inspect active transactions and the largest affected tables:

```bash
psql "$POSTGRES_URL_NON_POOLING" -X -v ON_ERROR_STOP=1 <<'SQL'
begin read only;
select pid, usename, application_name, backend_type, state,
       wait_event_type, wait_event, query_id,
       clock_timestamp() - xact_start as transaction_age,
       clock_timestamp() - query_start as query_age
from pg_stat_activity
where datname = current_database()
  and pid <> pg_backend_pid()
  and (state <> 'idle' or xact_start is not null)
order by xact_start nulls last;

select relname, pg_size_pretty(pg_total_relation_size(oid)) as total_size
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in (
    'listing_assets', 'listing_reviews', 'v4_recognition_sessions',
    'v4_recognition_jobs', 'v4_writer_feedback_events',
    'v4_writer_export_batches', 'v4_writer_export_items',
    'preingestion_jobs'
  )
order by pg_total_relation_size(oid) desc;
rollback;
SQL
```

Do not start while an unexplained long transaction is open. Set a short lock timeout so maintenance fails instead of blocking production indefinitely; investigate a timeout before retrying.

## 2. Apply schema maintenance in order

Use the approved, migration-history-aware Supabase release runner. Before any write, `supabase migration list` must show that remote history matches the verified baseline through `20260714174210` and that the only pending files are the four reviewed Track C migrations in the order below. Any missing, duplicate, or unexpected migration blocks the release.

The `65803` and `65808` files do not contain their own `BEGIN`/`COMMIT` wrappers. The selected release runner must have demonstrated in the isolated rehearsal that a statement failure rolls back the whole migration while keeping `supabase_migrations.schema_migrations` consistent. If that atomicity evidence is absent, stop; do not fall back to bare `psql`, do not use `--include-all`, and do not manufacture history with `migration repair`.

Run from the approved ephemeral maintenance runner. `POSTGRES_URL_NON_POOLING` must be a percent-encoded direct connection URL supplied by the secret store. Preserve the command result as restricted release evidence without printing the URL.

```bash
export PGOPTIONS='-c lock_timeout=5s -c statement_timeout=15min'

supabase migration list --db-url "$POSTGRES_URL_NON_POOLING"
# Human approval gate: baseline matches and only 65803, 65808, 65812, 65820 are pending.
supabase migration up --db-url "$POSTGRES_URL_NON_POOLING"
supabase migration list --db-url "$POSTGRES_URL_NON_POOLING"

unset PGOPTIONS
```

The second list must show all four versions in remote history. Stop on the first error. Do not deploy application code over a partially applied schema, do not skip ahead in the sequence, and do not attempt an ad-hoc repair during the same window.

## 3. Run the read-only schema preflight

### Writer Intake v1 maintenance addendum

Writer Intake is a later, separately reviewed expansion at migration
`20260730065921_v4_writer_intake_ledger_v1.sql`. It is not applied by the
application deploy. Before deploying application code that imports
`lib/listing/intake/*`, use the same approved migration-history-aware runner and
apply this migration in its own maintenance window.

The gate is exact, not “apply everything pending”:

1. pin the reviewed `main` SHA and record the migration SHA-256;
2. verify the production history through the immediately preceding expected
   migration for that SHA;
3. require the dry-run pending set to contain exactly `20260730065921`, with no
   missing, duplicate, earlier, or later migration;
4. verify the read-only source audit still accounts for every existing
   `FINALIZED` asset before allowing the write;
5. run `supabase migration up` without `--include-all` or history repair;
6. re-list history and require `20260730065921` present exactly once;
7. run the Writer Intake schema checker below before reopening application
   deployment.

```bash
shasum -a 256 supabase/migrations/20260730065921_v4_writer_intake_ledger_v1.sql

export PGOPTIONS='-c lock_timeout=5s -c statement_timeout=15min'
supabase migration list --db-url "$POSTGRES_URL_NON_POOLING"
supabase db push --dry-run --db-url "$POSTGRES_URL_NON_POOLING"
# Human/automation approval: the only pending version is 20260730065921.
supabase migration up --db-url "$POSTGRES_URL_NON_POOLING"
supabase migration list --db-url "$POSTGRES_URL_NON_POOLING"

node scripts/check-writer-intake-production-schema.mjs \
  --out /tmp/writer-intake-production-schema-maintenance.json

unset PGOPTIONS
```

This migration takes locks on `listing_assets`, creates two operational ledger
tables, installs two service-only RPCs, and may backfill 2,684 known FINALIZED
rows from the maximum verified clock of their complete current canonical
original set. The checked-in read-only audit found zero rows without that
source, but the migration itself still fails closed if production changed.
Do not substitute migration-time `now()` for a missing historical clock.

The deployment workflow now requires a direct `POSTGRES_URL_NON_POOLING` Writer
Intake preflight both before and after the code deploy. REST/OpenAPI is not an
acceptable fallback for this contract because it cannot prove trigger, function
body, exact index/constraint, ACL, or canonical queue-link semantics.

### Administrator Journey replay-isolation maintenance addendum

Administrator Production Writer Journeys deliberately exercise real ACCEPT and
EDIT persistence with a synthetic title. That event is audit evidence only; it
must never become `listing_writer_final_replay` authority. The database boundary
for this rule is migration
`20260730120000_admin_test_writer_final_replay_isolation_v1.sql`, applied only
after Writer Intake migration `20260730065921` is present exactly once.

The reviewed migration checksum is:

```text
ff0a401eedb97f6ecbd1a9df21aa4ced66921920b7222c68f2dd5544f8d6934f  supabase/migrations/20260730120000_admin_test_writer_final_replay_isolation_v1.sql
```

Apply it in its own approved maintenance window. Before any write, migration
history must be complete through `20260730065921`; the dry-run pending set must
be exactly `{20260730120000}`. A missing predecessor, duplicate history row, or
any additional pending version blocks the operation.

```bash
shasum -a 256 \
  supabase/migrations/20260730120000_admin_test_writer_final_replay_isolation_v1.sql
# Require the exact checksum recorded above.

export PGOPTIONS='-c lock_timeout=5s -c statement_timeout=15min'
supabase migration list --db-url "$POSTGRES_URL_NON_POOLING"
supabase db push --dry-run --db-url "$POSTGRES_URL_NON_POOLING"
# Human/automation approval: pending set is exactly {20260730120000}.
supabase migration up --db-url "$POSTGRES_URL_NON_POOLING"
supabase migration list --db-url "$POSTGRES_URL_NON_POOLING"

node scripts/check-admin-test-replay-production-schema.mjs \
  --out /tmp/admin-test-replay-production-schema-maintenance.json

unset PGOPTIONS
```

The migration preserves audit facts. Its only data repair tombstones active
replay rows whose current `source_feedback_event_id` still points to an
immutable `ADMIN_TEST_ONLY` feedback event; a row already superseded by normal
writer feedback is not changed. It also makes the trigger fail closed unless
the linked feedback explicitly says `OBSERVE_ONLY`, installs a service-only
bounded proof RPC, and adds the exact remediation lookup index.

The checker is mandatory before and after application deployment and requires
the direct PostgreSQL URL. It opens a repeatable-read, read-only transaction and
attests the migration history and checksum, function owner/security/search path
and ACL, trigger timing/events/update columns/WHEN/body ordering, exact partial
index, and zero active `ADMIN_TEST_ONLY` replay rows. REST/OpenAPI is not an
acceptable fallback. On failure, keep application deployment closed and use a
reviewed forward-fix migration; never edit migration history or run a broad
pending migration set to make the gate green.

The preflight opens `BEGIN READ ONLY` and checks the tenant/RBAC foundation, tenant-scoped core tables, RLS policies, immutable-tenant triggers, retry projection, settings, OCR durable lease columns/index, key RPCs, and validated constraints. It also fails closed unless browser roles have no direct `storage.objects` ACL and the paid-execution heartbeat is service-only with `RUNNING` + owner + unexpired guards.

```bash
node scripts/check-track-c-production-schema.mjs \
  --out /tmp/track-c-production-schema-preflight.json

node -e '
  const report = require("/tmp/track-c-production-schema-preflight.json");
  if (report.ok !== true || report.read_only !== true || report.failed_check_count !== 0) process.exit(1);
  console.log(JSON.stringify({ok: report.ok, checked_at: report.checked_at}));
'
```

Archive the JSON with the migration checksums and recovery-point timestamp. Any failed check blocks deployment.

## 4. Deploy the reviewed commit

The manual workflow repeats code gates and the schema preflight before triggering Vercel. It must not be used to bootstrap the Track C schema.

```bash
export EXPECTED_SHA="$(git rev-parse HEAD)"
gh workflow run deploy-production.yml --ref main

for _attempt in $(seq 1 12); do
  RUN_ID="$(gh run list --workflow deploy-production.yml --commit "$EXPECTED_SHA" \
    --limit 1 --json databaseId --jq '.[0].databaseId')"
  test -n "$RUN_ID" && break
  sleep 5
done
test -n "$RUN_ID"
gh run watch "$RUN_ID" --exit-status
```

Watch the selected run to completion and retain its `production-release-evidence` artifact. Confirm the run SHA equals `EXPECTED_SHA`; do not treat a green deployment for a different commit as approval.

## 5. Verify health and tenant isolation

```bash
export BASE_URL='https://listing.lyncafei.team'
curl -fsS "$BASE_URL/api/v4/health" -o /tmp/v4-health.json
node -e '
  const h = require("/tmp/v4-health.json");
  const checks = {
    ready: h.ready === true,
    commit: h.deployment?.git_commit_sha === process.env.EXPECTED_SHA,
    queue: h.production_queue?.configured === true,
    worker_secret: h.production_queue?.worker_secret_configured === true,
    tables: h.supabase?.configured === true
  };
  console.log(checks);
  if (Object.values(checks).some((value) => value !== true)) process.exit(1);
'
```

Using dedicated pilot test accounts, complete all of the following before reopening writes:

- Owner and Manager can upload/enqueue, view team status, and use tenant ops; Writer sees only assigned work.
- Tenant A cannot read Tenant B's known job/session/asset IDs; the API returns the same not-found response as an unknown ID.
- One card completes through upload, durable enqueue, recognition, feedback, and export, with its `request_id`, `tenant_id`, `batch_id`, `job_id`, and `session_id` traceable.
- `/api/v4/ops-snapshot?window_hours=24` reports plausible queue/failure/latency values for the logged-in tenant. Only Owner cost fields are expected.

## 6. Manually retry a failed job

Use a logged-in Owner or Manager session for the job's tenant. Writer sessions are intentionally denied. Manual retry is valid for `FAILED` or `CANCELLED`; repeating it for an already `QUEUED`, `RETRYING`, or `RUNNING` job is idempotent.

```bash
export JOB_ID='v4job_replace_me'
export JOB_ID_ENCODED="$(node -p 'encodeURIComponent(process.env.JOB_ID)')"

curl -fsS -b /tmp/lynca-cookies.txt \
  "$BASE_URL/api/v4/listing-job-status?job_id=$JOB_ID_ENCODED" \
  -o /tmp/job-before-retry.json

curl -fsS -b /tmp/lynca-cookies.txt \
  -H 'content-type: application/json' \
  --data "$(node -e 'process.stdout.write(JSON.stringify({job_id: process.env.JOB_ID}))')" \
  "$BASE_URL/api/v4/listing-job-retry" \
  -o /tmp/job-retry.json

node -e '
  const r = require("/tmp/job-retry.json");
  if (r.ok !== true || !["RETRYING", "QUEUED", "RUNNING"].includes(r.job?.status)) process.exit(1);
  console.log(JSON.stringify({job_id: r.job.job_id, tenant_id: r.job.tenant_id, already_active: r.already_active}));
'
```

Never retry by directly patching job status, attempts, leases, or capacity slots in SQL.

## 7. Tenant incident triage

1. Capture customer, tenant, time range, `request_id`, `batch_id`, `job_id`, `session_id`, and observed HTTP status. Do not request API keys, cookies, signed URLs, or raw image payloads in a support ticket.
2. Reproduce with an authorized account for that tenant and read job status plus `/api/v4/ops-snapshot?window_hours=24`.
3. Correlate logs in a read-only database transaction. Always bind the tenant filter; never start with an unscoped customer-data query.

```bash
psql "$POSTGRES_URL_NON_POOLING" -X -v ON_ERROR_STOP=1 \
  -v tenant_id="$TENANT_ID" -v job_id="$JOB_ID" <<'SQL'
begin read only;
with correlated_requests as (
  select request_id from job_attempt_events
  where tenant_id = :'tenant_id' and job_id = nullif(:'job_id', '')
  union
  select request_id from production_events
  where tenant_id = :'tenant_id' and job_id = nullif(:'job_id', '')
  union
  select request_id from error_logs
  where tenant_id = :'tenant_id' and job_id = nullif(:'job_id', '')
)
select logs.request_id, logs.tenant_id, logs.user_id, logs.api,
       logs.status_code, logs.duration_ms, logs."timestamp"
from request_logs logs
where logs.tenant_id = :'tenant_id'
  and (
    nullif(:'job_id', '') is null
    or logs.request_id in (select request_id from correlated_requests where request_id is not null)
  )
order by "timestamp" desc
limit 100;

select tenant_id, job_id, session_id, attempt_no, event_type,
       canonical_status, retry_delay_ms, error_code, recoverable, occurred_at
from job_attempt_events
where tenant_id = :'tenant_id'
  and job_id = :'job_id'
order by occurred_at, attempt_no;

select tenant_id, job_id, session_id, error_type, recoverable, created_at
from error_logs
where tenant_id = :'tenant_id'
  and (job_id = :'job_id' or nullif(:'job_id', '') is null)
order by created_at desc
limit 100;
rollback;
SQL
```

Interpretation:

- Growing queue depth with no running jobs: verify health, worker/cron configuration, then pump evidence; do not manufacture claims in SQL.
- `RETRYABLE_FAILED`: confirm `next_retry_at` and attempt events before intervening.
- `FAILED_FINAL`: classify the last error; fix input/configuration first, then use the manual retry API if appropriate.
- Only one tenant affected: compare that tenant's failure/latency window with the system window and inspect membership, assignment, asset ownership, and provider events scoped to the same tenant.
- Suspected cross-tenant exposure: stop affected customer access, preserve request/log evidence, and escalate as a security incident; do not “repair” ownership by updating `tenant_id`.

## 8. Rollback boundaries

- Application rollback: redeploy the last known-good commit only if its code is compatible with the expanded schema. Keep the Track C schema in place and prefer a forward fix.
- Database rollback: do not drop tenant columns/tables, reverse the scheduler-scope rename, remove RLS, or decrement retry state after customer writes. These migrations include backfills and ownership constraints and have no safe generic down migration.
- Restore from the pre-migration recovery point only when the migration cannot be repaired and before new customer writes are accepted. A restore after reopening writes loses post-checkpoint data and requires incident approval and reconciliation.
- During an incident, first stop new uploads/enqueues and pause scheduled queue pumping through the deployment control plane. Let active leases settle; do not bulk-edit `RUNNING` rows.
- After any rollback or forward repair, rerun the read-only preflight, health checks, two-tenant negative-access test, and one complete card flow before reopening writes.

Code references: [production workflow](../../.github/workflows/deploy-production.yml), [schema preflight](../../scripts/check-track-c-production-schema.mjs), [manual retry API](../../api/v4/listing-job-retry.js), and [Production Readiness Report](../reports/production-readiness-track-c-2026-07-15.md).
