import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { isPlatformAdminRequest } from "../lib/platform-admin-auth.mjs";

const migrationPaths = [
  "supabase/migrations/20260707122154_v4_production_job_queue.sql",
  "supabase/migrations/20260707133128_v4_queue_interactive_background_lanes.sql",
  "supabase/migrations/20260708043000_v4_queue_reclaim_expired_running_jobs.sql",
  "supabase/migrations/20260710055802_v4_execution_control_plane_v1.sql",
  "supabase/migrations/20260712170000_v4_balanced_provider_key_slots.sql",
  "supabase/migrations/20260712183000_refresh_v4_queue_rpc_schema.sql",
  "supabase/migrations/20260713130000_v4_stage_capacity_control.sql",
  "supabase/migrations/20260713224500_v4_tenant_fair_provider_queue.sql"
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
  return result.rows[0] || {};
}

async function verifyExecutionControlBehavior(client) {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const firstBatchFirstJobId = `migration_probe_a1_${suffix}`;
  const firstBatchSecondJobId = `migration_probe_a2_${suffix}`;
  const secondBatchJobId = `migration_probe_b1_${suffix}`;
  const firstTenantId = `migration_probe_tenant_a_${suffix}`;
  const secondTenantId = `migration_probe_tenant_b_${suffix}`;
  const workerId = `migration_probe_worker_${suffix}`;
  await client.query("begin");
  try {
    await client.query(`
      insert into public.v4_recognition_jobs(
        id, schema_version, batch_id, tenant_id, asset_id, job_type,
        provider_id, status, priority, payload, max_attempts, created_at
      ) values
        ($1, 'migration-probe-v1', $4, $6, $1, 'FINAL_ASSISTED_TITLE',
          'migration_probe', 'QUEUED', 0, '{}'::jsonb, 2, clock_timestamp() - interval '2 seconds'),
        ($2, 'migration-probe-v1', $4, $6, $2, 'FINAL_ASSISTED_TITLE',
          'migration_probe', 'QUEUED', 0, '{}'::jsonb, 2, clock_timestamp() - interval '1 second'),
        ($3, 'migration-probe-v1', $5, $7, $3, 'FINAL_ASSISTED_TITLE',
          'migration_probe', 'QUEUED', 0, '{}'::jsonb, 2, clock_timestamp())
    `, [
      firstBatchFirstJobId,
      firstBatchSecondJobId,
      secondBatchJobId,
      `batch_a_${suffix}`,
      `batch_b_${suffix}`,
      firstTenantId,
      secondTenantId
    ]);
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
  if (!isPlatformAdminRequest(req, process.env)) {
    sendJson(res, 401, { ok: false, message: "Unauthorized" });
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
    const ok = Boolean(
      verification.jobs_table
      && verification.claim_rpc
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
      && behavior.claim_ok
      && behavior.balanced_key_assignment_ok
      && behavior.tenant_fair_claim_ok
      && behavior.capacity_bound_ok
      && behavior.release_ok
      && behavior.kick_ok
      && behavior.kick_dedup_ok
      && behavior.stage_capacity_bound_ok
      && behavior.stage_capacity_release_ok
    );
    sendJson(res, ok ? 200 : 500, {
      ok,
      migration: "v4_production_job_queue_all",
      verification,
      behavior
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
