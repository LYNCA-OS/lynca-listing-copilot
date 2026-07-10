import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { isV4WorkerRequest } from "../lib/listing/v4/jobs/worker-auth.mjs";

const migrationPaths = [
  "supabase/migrations/20260707122154_v4_production_job_queue.sql",
  "supabase/migrations/20260707133128_v4_queue_interactive_background_lanes.sql",
  "supabase/migrations/20260708043000_v4_queue_reclaim_expired_running_jobs.sql",
  "supabase/migrations/20260710055802_v4_execution_control_plane_v1.sql"
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

function connectionStringForPg(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("ssl");
    return parsed.toString();
  } catch {
    return rawUrl;
  }
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
      ) as queue_kick_rpc
  `);
  return result.rows[0] || {};
}

async function verifyExecutionControlBehavior(client) {
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const jobId = `migration_probe_job_${suffix}`;
  const tenantId = `migration_probe_tenant_${suffix}`;
  const workerId = `migration_probe_worker_${suffix}`;
  await client.query("begin");
  try {
    await client.query(`
      insert into public.v4_recognition_jobs(
        id, schema_version, batch_id, tenant_id, asset_id, job_type,
        provider_id, status, priority, payload, max_attempts
      ) values ($1, 'migration-probe-v1', $2, $2, $1, 'FINAL_ASSISTED_TITLE',
        'migration_probe', 'QUEUED', 0, '{}'::jsonb, 2)
    `, [jobId, tenantId]);
    const claim = await client.query(`
      select id, status, queue_tags
      from public.claim_v4_recognition_jobs_with_capacity(
        1, $1, 60, 'background', $2, 'migration_probe', 1, 1
      )
    `, [workerId, tenantId]);
    const claimed = claim.rows[0] || {};
    const release = await client.query(
      "select public.release_v4_provider_capacity_for_job($1, $2) as released_count",
      [jobId, workerId]
    );
    const kick = await client.query(
      "select public.try_acquire_v4_queue_kick($1, $2, 500) as acquired",
      [`migration_probe_scope_${suffix}`, workerId]
    );
    return {
      claim_ok: claimed.id === jobId
        && claimed.status === "RUNNING"
        && Number(claimed.queue_tags?.provider_capacity_slot || 0) === 1
        && Number(claimed.queue_tags?.provider_key_slot || 0) === 1,
      release_ok: Number(release.rows[0]?.released_count || 0) === 1,
      kick_ok: kick.rows[0]?.acquired === true
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
      } else if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }
  if (!chunks.length) chunks.push(inlineInteractiveBackgroundLaneMigrationSql);
  return chunks.join("\n\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, message: "Method not allowed" });
    return;
  }
  if (!isV4WorkerRequest(req, process.env)) {
    sendJson(res, 401, { ok: false, message: "Unauthorized" });
    return;
  }
  const connectionString = dbUrl(process.env);
  if (!connectionString) {
    sendJson(res, 503, { ok: false, message: "Postgres URL is not configured." });
    return;
  }

  const client = new pg.Client({
    connectionString: connectionStringForPg(connectionString),
    ssl: { rejectUnauthorized: false }
  });
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
      && verification.capacity_release_rpc
      && verification.queue_kick_rpc
      && behavior.claim_ok
      && behavior.release_ok
      && behavior.kick_ok
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
