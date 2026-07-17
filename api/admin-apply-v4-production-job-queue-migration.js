import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { runtimeMigrationAuth } from "../lib/platform-admin-auth.mjs";

const migrationPaths = [
  "supabase/migrations/20260707122154_v4_production_job_queue.sql",
  "supabase/migrations/20260707133128_v4_queue_interactive_background_lanes.sql",
  "supabase/migrations/20260708043000_v4_queue_reclaim_expired_running_jobs.sql",
  "supabase/migrations/20260710055802_v4_execution_control_plane_v1.sql",
  "supabase/migrations/20260712170000_v4_balanced_provider_key_slots.sql",
  "supabase/migrations/20260712183000_refresh_v4_queue_rpc_schema.sql",
  "supabase/migrations/20260713130000_v4_stage_capacity_control.sql",
  "supabase/migrations/20260713224500_v4_tenant_fair_provider_queue.sql",
  "supabase/migrations/20260715064500_ensure_v4_learning_events_dataset_disposition_for_queue.sql",
  "supabase/migrations/20260715065752_track_d_feedback_capture_v1.sql",
  "supabase/migrations/20260715065803_track_c_tenant_foundation_expand.sql",
  "supabase/migrations/20260715065830_track_d_data_flywheel_convergence.sql",
  "supabase/migrations/20260717100000_fix_v4_queue_atomic_rpc_signature.sql"
].map((path) => join(process.cwd(), path));

const inlineInteractiveBackgroundLaneMigrationSql = `
alter table if exists public.v4_recognition_jobs
  add column if not exists lane text not null default 'background',
  add column if not exists parent_job_id text,
  add column if not exists paired_job_id text,
  add column if not exists stage_result jsonb not null default '{}'::jsonb;

alter table if exists public.v4_recognition_sessions
  add column if not exists l1_status text not null default 'PENDING',
  add column if not exists l1_title text,
  add column if not exists l1_ready_at timestamptz,
  add column if not exists l1_route text,
  add column if not exists l1_timing jsonb not null default '{}'::jsonb,
  add column if not exists l2_status text not null default 'PENDING',
  add column if not exists l2_title text,
  add column if not exists l2_ready_at timestamptz,
  add column if not exists l2_route text,
  add column if not exists l2_timing jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'v4_recognition_jobs_lane_check') then
    alter table public.v4_recognition_jobs
      add constraint v4_recognition_jobs_lane_check
      check (lane in ('interactive', 'background'));
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'v4_recognition_sessions_l1_status_check') then
    alter table public.v4_recognition_sessions
      add constraint v4_recognition_sessions_l1_status_check
      check (l1_status in ('PENDING', 'RUNNING', 'READY', 'FAILED', 'SKIPPED'));
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'v4_recognition_sessions_l2_status_check') then
    alter table public.v4_recognition_sessions
      add constraint v4_recognition_sessions_l2_status_check
      check (l2_status in ('PENDING', 'RUNNING', 'READY', 'FAILED', 'SKIPPED'));
  end if;
end $$;

create index if not exists v4_recognition_jobs_lane_claim_idx
  on public.v4_recognition_jobs(lane, status, not_before, priority, created_at)
  where status in ('QUEUED', 'RETRYING');

create index if not exists v4_recognition_jobs_parent_idx
  on public.v4_recognition_jobs(parent_job_id);

create index if not exists v4_recognition_jobs_paired_idx
  on public.v4_recognition_jobs(paired_job_id);

create index if not exists v4_recognition_jobs_tenant_lane_idx
  on public.v4_recognition_jobs(tenant_id, lane, status, priority, created_at)
  where status in ('QUEUED', 'RETRYING', 'RUNNING');

drop function if exists public.claim_v4_recognition_jobs(integer, text, integer);

create or replace function public.claim_v4_recognition_jobs(
  p_limit integer default 1,
  p_worker_id text default 'worker',
  p_lease_seconds integer default 90,
  p_lane text default null,
  p_tenant_id text default null
)
returns setof public.v4_recognition_jobs
language plpgsql
as $$
begin
  return query
  with next_jobs as (
    select id
    from public.v4_recognition_jobs
    where status in ('QUEUED', 'RETRYING')
      and not_before <= now()
      and (lease_expires_at is null or lease_expires_at < now())
      and (p_lane is null or lane = p_lane)
      and (p_tenant_id is null or tenant_id = p_tenant_id)
    order by
      case when lane = 'interactive' then 0 else 1 end,
      priority asc,
      created_at asc
    limit greatest(1, least(coalesce(p_limit, 1), 25))
    for update skip locked
  )
  update public.v4_recognition_jobs jobs
  set status = 'RUNNING',
      lease_owner = coalesce(nullif(p_worker_id, ''), 'worker'),
      lease_expires_at = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 90), 900))),
      started_at = coalesce(jobs.started_at, now()),
      attempt_count = jobs.attempt_count + 1,
      updated_at = now()
  from next_jobs
  where jobs.id = next_jobs.id
  returning jobs.*;
end;
$$;

revoke all on function public.claim_v4_recognition_jobs(integer, text, integer, text, text) from public;
grant execute on function public.claim_v4_recognition_jobs(integer, text, integer, text, text) to service_role;
`;

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function dbUrl(env = process.env) {
  return String(env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL || "").trim();
}

async function verify(client) {
  const result = await client.query(`
    select
      exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = 'v4_recognition_jobs'
      ) as jobs_table,
      exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'claim_v4_recognition_jobs'
          and p.pronargs = 5
      ) as claim_rpc
      ,
      exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname = 'enqueue_v4_recognition_batch_atomic'
            and p.pronargs = 5
            and p.prorettype = 'jsonb'::regtype
            and pg_catalog.pg_get_function_identity_arguments(p.oid) =
            'p_batch jsonb, p_jobs jsonb, p_operator_id text, p_sessions jsonb, p_tenant_id text'
      ) as enqueue_atomic_rpc
      ,
      exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = 'tenants'
      ) as tenants_table,
      exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = 'users'
      ) as users_table,
      exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = 'tenant_members'
      ) as tenant_members_table,
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
        and table_name = 'v4_recognition_jobs'
          and column_name = 'lane'
      ) as lane_column,
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'v4_recognition_sessions'
          and column_name = 'l1_title'
      ) as l1_session_column
      ,
      exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = 'v4_provider_capacity_leases'
      ) as provider_capacity_table,
      exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'claim_v4_recognition_jobs_with_capacity'
          and p.pronargs = 8
      ) as capacity_claim_rpc,
      exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'claim_v4_recognition_jobs_with_balanced_capacity'
          and p.pronargs = 9
      ) as balanced_capacity_claim_rpc,
      exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'release_v4_provider_capacity_for_job'
          and p.pronargs = 2
      ) as capacity_release_rpc,
      exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'try_acquire_v4_queue_kick'
          and p.pronargs = 3
      ) as queue_kick_rpc,
      exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'acquire_v4_stage_capacity'
          and p.pronargs = 5
      ) as stage_capacity_acquire_rpc,
      exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'release_v4_stage_capacity'
          and p.pronargs = 3
      ) as stage_capacity_release_rpc,
      exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'claim_v4_recognition_jobs_with_balanced_capacity'
          and p.pronargs = 9
          and position('nullif(jobs.tenant_id' in pg_get_functiondef(p.oid)) > 0
          and position('nullif(jobs.tenant_id' in pg_get_functiondef(p.oid))
            < position('nullif(jobs.batch_id' in pg_get_functiondef(p.oid))
      ) as tenant_fair_scheduler
  `);
  const verification = result.rows?.[0] || {};
  verification.legacy_principal_ready = false;
  verification.legacy_tenant_ready = false;
  verification.legacy_user_ready = false;
  verification.legacy_membership_ready = false;

  if (verification.tenants_table && verification.users_table && verification.tenant_members_table) {
    const legacyResult = await client.query(`
      select
        exists (
          select 1
          from public.tenant_members member
          join public.users app_user on app_user.id = member.user_id
          join public.tenants tenant on tenant.id = member.tenant_id
          where member.status = 'ACTIVE'
            and member.disabled_at is null
            and member.role in ('OWNER', 'MANAGER', 'WRITER')
            and app_user.status = 'ACTIVE'
            and app_user.disabled_at is null
            and tenant.status = 'ACTIVE'
            and tenant.disabled_at is null
        ) as legacy_principal_ready,
        exists (
          select 1
          from public.tenants tenant
          where tenant.id = 'tenant_legacy'
            and tenant.status = 'ACTIVE'
            and tenant.disabled_at is null
        ) as legacy_tenant_ready,
        exists (
          select 1
          from public.users app_user
          where app_user.id = 'user_legacy'
            and app_user.status = 'ACTIVE'
            and app_user.session_version >= 1
            and app_user.disabled_at is null
        ) as legacy_user_ready,
        exists (
          select 1
          from public.tenant_members member
          join public.tenants tenant on tenant.id = member.tenant_id
          join public.users app_user on app_user.id = member.user_id
          where member.tenant_id = 'tenant_legacy'
            and member.user_id = 'user_legacy'
            and member.role = 'OWNER'
            and member.status = 'ACTIVE'
            and member.disabled_at is null
            and tenant.status = 'ACTIVE'
            and tenant.disabled_at is null
            and app_user.status = 'ACTIVE'
            and app_user.disabled_at is null
        ) as legacy_membership_ready
    `);
    const legacyVerification = legacyResult.rows?.[0] || {};
    Object.assign(verification, legacyVerification);
  }

  return verification;
}

async function verifyAtomicEnqueueV4FunctionBehavior(client) {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  const tenantId = "tenant_legacy";
  const operatorId = "user_legacy";
  const sessionId = `probe_session_${suffix}`;
  const jobId = `probe_job_${suffix}`;
  const batchId = `probe_batch_${suffix}`;
  const clientAssetRef = `probe_ref_${suffix}`;
  const probeHex = `${Date.now().toString(16)}${suffix.replace(/[^a-f0-9]/g, "").toLowerCase()}`
    .slice(0, 32).padEnd(32, "0");
  const assetId = `asset_${probeHex.slice(0, 8)}-${probeHex.slice(8, 12)}-4${probeHex.slice(12, 15)}-8${probeHex.slice(15, 18)}-${probeHex.slice(18, 30)}`;
  const probeBatch = {
    id: batchId,
    tenant_id: tenantId,
    operator_id: operatorId,
    item_count: 1,
    metadata: {
      schema_version: "v1",
      source: "v4-queue-production-migration-probe",
      enqueue_identity_sha256: "0".repeat(64)
    }
  };
  const probeSession = {
    id: sessionId,
    tenant_id: tenantId,
    operator_id: operatorId,
    user_id: operatorId,
    asset_id: assetId,
    client_asset_ref: clientAssetRef,
    identity_snapshot: {
      tenant_id: tenantId,
      operator_id: operatorId,
      user_id: operatorId,
      asset_id: assetId,
      client_asset_ref: clientAssetRef,
      asset_fingerprint: "0".repeat(64),
      image_references: []
    }
  };
  const probeJob = {
    id: jobId,
    tenant_id: tenantId,
    operator_id: operatorId,
    batch_id: batchId,
    asset_id: assetId,
    recognition_session_id: sessionId,
    job_type: "FINAL_ASSISTED_TITLE",
    payload: {
      tenant_id: tenantId,
      operator_id: operatorId,
      asset_id: assetId,
      recognition_session_id: sessionId
    },
    max_attempts: 2,
    status: "CREATED",
    priority: 100
  };
  await client.query("begin");
  try {
    await client.query(`
      insert into public.listing_assets (id)
      values ($1)
      on conflict (id) do nothing
    `, [assetId]);

    const result = await client.query(`
      select public.enqueue_v4_recognition_batch_atomic(
        $1::jsonb,
        $2::jsonb,
        $3::text,
        $4::jsonb,
        $5::text
      ) as probe_transaction
    `, [probeBatch, [probeJob], operatorId, [probeSession], tenantId]);
    const transaction = result.rows?.[0]?.probe_transaction;
    const transactionReason = transaction && typeof transaction === "object"
      ? String(transaction.reason || "").trim()
      : "";
    const transactionSaved = transaction && typeof transaction === "object"
      ? Boolean(transaction.saved)
      : false;
    const acceptedCount = Number(transaction?.accepted_count || 0);
    const sessionRowsWritten = Number(transaction?.session_rows_written || 0);
    const jobRowsWritten = Number(transaction?.job_rows_written || 0);
    const [batchRows, sessionRows, jobRows] = await Promise.all([
      client.query(`
        select 1
        from public.v4_recognition_batches
        where id = $1
          and tenant_id = $2
          and created_by_user_id = $3
          and item_count = 1
      `, [batchId, tenantId, operatorId]),
      client.query(`
        select 1
        from public.v4_recognition_sessions
        where id = $1
          and tenant_id = $2
          and operator_id = $3
          and user_id = $3
          and asset_id = $4
      `, [sessionId, tenantId, operatorId, assetId]),
      client.query(`
        select 1
        from public.v4_recognition_jobs
        where id = $1
          and tenant_id = $2
          and operator_id = $3
          and recognition_session_id = $4
      `, [jobId, tenantId, operatorId, sessionId])
    ]);
    const batchRowsVisible = batchRows.rowCount === 1;
    const sessionRowsVisible = sessionRows.rowCount === 1;
    const jobRowsVisible = jobRows.rowCount === 1;
    const canaryAssertionPassed = transactionSaved
      && acceptedCount === 1
      && sessionRowsWritten === 1
      && jobRowsWritten === 1
      && batchRowsVisible
      && sessionRowsVisible
      && jobRowsVisible;
    return {
      probe_rpc_ok: true,
      probe_rpc_saved: transactionSaved,
      probe_rpc_reason: transactionReason || null,
      probe_expected_operator_not_active_member: transactionReason === "operator_not_active_member",
      probe_expected_atomic_acceptance: canaryAssertionPassed,
      probe_accepted_count: acceptedCount,
      probe_session_rows_written: sessionRowsWritten,
      probe_job_rows_written: jobRowsWritten,
      probe_batch_rows_visible: batchRowsVisible,
      probe_session_rows_visible: sessionRowsVisible,
      probe_job_rows_visible: jobRowsVisible,
      probe_canary_assertions_passed: canaryAssertionPassed,
      probe_rpc_error_class: canaryAssertionPassed ? null : "atomic_queue_canary_assertion_mismatch",
      probe_rpc_error_sqlstate: String(transaction?.sqlstate || "")
    };
  } catch (error) {
    return {
      probe_rpc_ok: false,
      probe_rpc_saved: false,
      probe_rpc_reason: String(error?.message || error || "unknown_error").slice(0, 240),
      probe_rpc_error_class: "atomic_queue_canary_execution_error",
      probe_rpc_error_sqlstate: String(error?.code || "unknown")
    };
  } finally {
    await client.query("rollback");
  }
}

async function verifyExecutionControlBehavior(client) {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const firstBatchFirstJobId = `migration_probe_a1_${suffix}`;
  const firstBatchSecondJobId = `migration_probe_a2_${suffix}`;
  const secondBatchJobId = `migration_probe_b1_${suffix}`;
  const firstTenantId = `migration_probe_tenant_a_${suffix}`;
  const secondTenantId = `migration_probe_tenant_b_${suffix}`;
  const firstOperatorId = `migration_probe_operator_a_${suffix}`;
  const secondOperatorId = `migration_probe_operator_b_${suffix}`;
  const workerId = `migration_probe_worker_${suffix}`;
  const firstBatchFirstSessionId = `migration_probe_session_a1_${suffix}`;
  const firstBatchSecondSessionId = `migration_probe_session_a2_${suffix}`;
  const secondBatchSessionId = `migration_probe_session_b1_${suffix}`;
  const firstBatchId = `batch_a_${suffix}`;
  const secondBatchId = `batch_b_${suffix}`;
  const escapeSql = (value) => `'${String(value).replace(/'/g, "''")}'`;
  await client.query("begin");
  try {
    await client.query(`
      insert into public.v4_recognition_sessions (
        id, schema_version, status, tenant_id, operator_id, asset_id
      ) values
        (${escapeSql(firstBatchFirstSessionId)}, 'migration-probe-v1', 'CREATED', ${escapeSql(firstTenantId)}, ${escapeSql(firstOperatorId)}, null),
        (${escapeSql(firstBatchSecondSessionId)}, 'migration-probe-v1', 'CREATED', ${escapeSql(firstTenantId)}, ${escapeSql(firstOperatorId)}, null),
        (${escapeSql(secondBatchSessionId)}, 'migration-probe-v1', 'CREATED', ${escapeSql(secondTenantId)}, ${escapeSql(secondOperatorId)}, null)
    `);
    await client.query(`
      insert into public.v4_recognition_jobs(
        id, schema_version, batch_id, tenant_id, asset_id, job_type,
        operator_id, recognition_session_id, provider_id, status, priority, payload,
        max_attempts, created_at
      ) values
        (${escapeSql(firstBatchFirstJobId)}, 'migration-probe-v1', ${escapeSql(firstBatchId)}, ${escapeSql(firstTenantId)}, null, 'FINAL_ASSISTED_TITLE',
          ${escapeSql(firstOperatorId)}, ${escapeSql(firstBatchFirstSessionId)}, 'migration_probe', 'QUEUED', 0,
          jsonb_build_object(
            'recognition_session_id', ${escapeSql(firstBatchFirstSessionId)},
            'asset_id', null
          ), 2, clock_timestamp() - interval '2 seconds'),
        (${escapeSql(firstBatchSecondJobId)}, 'migration-probe-v1', ${escapeSql(firstBatchId)}, ${escapeSql(firstTenantId)}, null, 'FINAL_ASSISTED_TITLE',
          ${escapeSql(firstOperatorId)}, ${escapeSql(firstBatchSecondSessionId)}, 'migration_probe', 'QUEUED', 0,
          jsonb_build_object(
            'recognition_session_id', ${escapeSql(firstBatchSecondSessionId)},
            'asset_id', null
          ), 2, clock_timestamp() - interval '1 second'),
        (${escapeSql(secondBatchJobId)}, 'migration-probe-v1', ${escapeSql(secondBatchId)}, ${escapeSql(secondTenantId)}, null, 'FINAL_ASSISTED_TITLE',
          ${escapeSql(secondOperatorId)}, ${escapeSql(secondBatchSessionId)}, 'migration_probe', 'QUEUED', 0,
          jsonb_build_object(
            'recognition_session_id', ${escapeSql(secondBatchSessionId)},
            'asset_id', null
          ), 2, clock_timestamp())
    `);
    const claim = await client.query(`
      select id, status, queue_tags
      from public.claim_v4_recognition_jobs_with_balanced_capacity(
        2, $1, 60, 'background', null, 'migration_probe', 2, 2, 2
      )
    `, [workerId]);
    const claimedIds = new Set(claim.rows.map((row) => row.id));
    const blockedByCapacity = await client.query(`
      select id
      from public.claim_v4_recognition_jobs_with_balanced_capacity(
        1, $1, 60, 'background', null, 'migration_probe', 2, 2, 2
      )
    `, [`${workerId}_overflow`]);
    let releasedCount = 0;
    for (const row of claim.rows) {
      const release = await client.query(
        "select public.release_v4_provider_capacity_for_job($1, $2) as released_count",
        [row.id, workerId]
      );
      releasedCount += Number(release.rows[0]?.released_count || 0);
    }
    const kickScope = `migration_probe_scope_${suffix}`;
    const firstKick = await client.query(
      "select public.try_acquire_v4_queue_kick($1, $2, 500) as acquired",
      [kickScope, workerId]
    );
    const duplicateKick = await client.query(
      "select public.try_acquire_v4_queue_kick($1, $2, 500) as acquired",
      [kickScope, `${workerId}_duplicate`]
    );
    const stageId = `migration_probe_stage_${suffix}`;
    const firstStageSlot = await client.query(
      "select public.acquire_v4_stage_capacity($1, $2, $3, 2, 60) as slot",
      [stageId, `${firstBatchFirstJobId}_stage`, workerId]
    );
    const secondStageSlot = await client.query(
      "select public.acquire_v4_stage_capacity($1, $2, $3, 2, 60) as slot",
      [stageId, `${secondBatchJobId}_stage`, workerId]
    );
    const blockedStageSlot = await client.query(
      "select public.acquire_v4_stage_capacity($1, $2, $3, 2, 60) as slot",
      [stageId, `overflow_${suffix}`, workerId]
    );
    const releasedStageSlot = await client.query(
      "select public.release_v4_stage_capacity($1, $2, $3) as released_count",
      [stageId, `${firstBatchFirstJobId}_stage`, workerId]
    );
    const reusedStageSlot = await client.query(
      "select public.acquire_v4_stage_capacity($1, $2, $3, 2, 60) as slot",
      [stageId, `replacement_${suffix}`, workerId]
    );
    const assignedKeySlots = new Set(
      claim.rows.map((row) => Number(row.queue_tags?.provider_key_slot || 0))
    );
    return {
      claim_ok: claim.rows.length === 2
        && claim.rows.every((row) => row.status === "RUNNING")
        && claim.rows.every((row) => Number(row.queue_tags?.provider_capacity_slot || 0) > 0)
        && claim.rows.every((row) => Number(row.queue_tags?.provider_key_slot || 0) > 0),
      balanced_key_assignment_ok: assignedKeySlots.size === 2
        && assignedKeySlots.has(1)
        && assignedKeySlots.has(2)
        && claim.rows.every((row) => row.queue_tags?.provider_key_assignment === "balanced_round_robin_v1"),
      tenant_fair_claim_ok: claimedIds.has(firstBatchFirstJobId)
        && claimedIds.has(secondBatchJobId)
        && !claimedIds.has(firstBatchSecondJobId)
        && claim.rows.every((row) => row.queue_tags?.scheduling_fairness_scope === "tenant")
        && new Set(claim.rows.map((row) => row.queue_tags?.scheduling_fairness_key)).size === 2,
      capacity_bound_ok: blockedByCapacity.rows.length === 0,
      release_ok: releasedCount === 2,
      kick_ok: firstKick.rows[0]?.acquired === true,
      kick_dedup_ok: duplicateKick.rows[0]?.acquired === false,
      stage_capacity_bound_ok: Number(firstStageSlot.rows[0]?.slot || 0) > 0
        && Number(secondStageSlot.rows[0]?.slot || 0) > 0
        && firstStageSlot.rows[0]?.slot !== secondStageSlot.rows[0]?.slot
        && blockedStageSlot.rows[0]?.slot === null,
      stage_capacity_release_ok: Number(releasedStageSlot.rows[0]?.released_count || 0) === 1
        && Number(reusedStageSlot.rows[0]?.slot || 0) === Number(firstStageSlot.rows[0]?.slot || 0)
    };
  } finally {
    await client.query("rollback");
  }
}

async function readMigrationSql() {
  const chunks = [];
  for (const path of migrationPaths) {
    try {
      chunks.push(await readFile(path, "utf8"));
    } catch (error) {
      if (path.includes("20260707133128_v4_queue_interactive_background_lanes")) {
        chunks.push(inlineInteractiveBackgroundLaneMigrationSql);
      } else if (error?.code === "ENOENT") {
        throw new Error(`required_migration_not_bundled:${path.split("/").pop()}`);
      } else {
        throw error;
      }
    }
  }
  return chunks.join("\n\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, message: "Method not allowed" });
    return;
  }
  const auth = runtimeMigrationAuth(req, process.env);
  if (!auth.ok) {
    sendJson(res, auth.statusCode, { ok: false, message: auth.error });
    return;
  }
  const connectionString = dbUrl(process.env);
  if (!connectionString) {
    sendJson(res, 503, { ok: false, message: "Postgres URL is not configured." });
    return;
  }

  const client = new pg.Client({ connectionString });
  try {
    const sql = await readMigrationSql();
    await client.connect();
    await client.query(sql);
    const verification = await verify(client);
    const behavior = await verifyExecutionControlBehavior(client);
    const atomicProbe = await verifyAtomicEnqueueV4FunctionBehavior(client);
    const ok = Boolean(
      verification.jobs_table
      && verification.claim_rpc
      && verification.tenants_table
      && verification.users_table
      && verification.tenant_members_table
      && verification.legacy_tenant_ready
      && verification.legacy_user_ready
      && verification.legacy_membership_ready
      && verification.legacy_principal_ready
      && verification.lane_column
      && verification.l1_session_column
      && verification.provider_capacity_table
      && verification.capacity_claim_rpc
      && verification.balanced_capacity_claim_rpc
      && verification.capacity_release_rpc
      && verification.queue_kick_rpc
      && verification.stage_capacity_acquire_rpc
      && verification.stage_capacity_release_rpc
      && verification.tenant_fair_scheduler
      && verification.enqueue_atomic_rpc
      && behavior.claim_ok
      && behavior.balanced_key_assignment_ok
      && behavior.tenant_fair_claim_ok
      && behavior.capacity_bound_ok
      && behavior.release_ok
      && behavior.kick_ok
      && behavior.kick_dedup_ok
      && behavior.stage_capacity_bound_ok
      && behavior.stage_capacity_release_ok
      && atomicProbe.probe_rpc_ok
      && atomicProbe.probe_canary_assertions_passed
    );
    sendJson(res, ok ? 200 : 500, {
      ok,
      migration: "v4_production_job_queue_all",
      verification,
      behavior,
      atomic_probe: atomicProbe
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      migration: "v4_production_job_queue_all",
      message: String(error?.message || error || "migration_failed").slice(0, 500)
    });
  } finally {
    try {
      await client.end();
    } catch {
      // ignore close errors
    }
  }
}
