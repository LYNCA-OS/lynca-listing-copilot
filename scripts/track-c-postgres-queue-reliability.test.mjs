#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { writeFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = String(process.env.TRACK_C_TEST_DATABASE_URL || "").trim();
const databaseRequired = /^(?:1|true|yes)$/i.test(String(process.env.TRACK_C_REQUIRE_DATABASE || ""));
const reportPath = String(process.env.TRACK_C_REPORT_PATH || "").trim();

if (!databaseUrl) {
  if (databaseRequired) {
    throw new Error("TRACK_C_TEST_DATABASE_URL is required for the cloud 1000-job soak");
  }
  console.log(JSON.stringify({
    ok: true,
    skipped: true,
    reason: "TRACK_C_TEST_DATABASE_URL is not configured",
    scope: "postgres_queue_reliability"
  }, null, 2));
  process.exit(0);
}

const runSuffix = `${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
const tenantId = `tenant_tcpg_${runSuffix}`;
const idPrefix = `tcpg_${runSuffix}`;
const mainBatchId = `batch_${idPrefix}_main`;
const leaseBatchId = `batch_${idPrefix}_lease`;
const retryBatchId = `batch_${idPrefix}_retry`;
const capacityBatchId = `batch_${idPrefix}_capacity`;
const responseLossBatchId = `batch_${idPrefix}_response_loss`;
const crossTenantId = `tenant_tcpg_cross_${runSuffix}`;
const crossTenantBatchId = `batch_${idPrefix}_cross_tenant`;
const leaseJobId = `${idPrefix}_lease`;
const retryJobId = `${idPrefix}_retry`;
const responseLossJobId = `${idPrefix}_response_loss`;
const crossTenantJobId = `${idPrefix}_cross_tenant`;
const expectedRetryDelaysMs = [10_000, 30_000, 120_000];

const pool = new Pool({
  connectionString: databaseUrl,
  max: 12,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: true,
  application_name: "lynca_track_c_queue_reliability"
});

pool.on("connect", (client) => {
  void client.query("set statement_timeout = '45s'");
  void client.query("set lock_timeout = '10s'");
});

function count(value) {
  const number = Number(value);
  assert.ok(Number.isFinite(number), `expected a finite count, received ${String(value)}`);
  return number;
}

async function preflight() {
  const objects = await pool.query(`
    select
      pg_catalog.to_regclass('public.tenants') as tenants_table,
      pg_catalog.to_regclass('public.v4_recognition_batches') as batches_table,
      pg_catalog.to_regclass('public.v4_recognition_jobs') as jobs_table,
      pg_catalog.to_regclass('public.job_attempt_events') as attempts_table,
      pg_catalog.to_regclass('public.v4_provider_capacity_leases') as capacity_leases_table,
      pg_catalog.to_regprocedure(
        'public.claim_v4_recognition_jobs(integer,text,integer,text,text)'
      ) as claim_function,
      pg_catalog.to_regprocedure(
        'public.fail_v4_recognition_job(text,text,jsonb,boolean,boolean)'
      ) as fail_function,
      pg_catalog.to_regprocedure(
        'public.heartbeat_v4_recognition_job(text,text,integer)'
      ) as heartbeat_function,
      pg_catalog.to_regprocedure(
        'public.claim_v4_recognition_jobs_with_balanced_capacity(integer,text,integer,text,text,text,integer,integer,integer)'
      ) as balanced_claim_function,
      pg_catalog.to_regprocedure(
        'public.release_v4_provider_capacity_for_job(text,text)'
      ) as capacity_release_function,
      pg_catalog.to_regprocedure(
        'public.try_acquire_v4_queue_kick(text,text,integer)'
      ) as queue_kick_function
  `);
  const objectRow = objects.rows[0] || {};
  for (const [name, value] of Object.entries(objectRow)) {
    assert.ok(value, `Track C PostgreSQL preflight failed: missing ${name}`);
  }

  const requiredColumns = new Set([
    "tenant_id",
    "lane",
    "stage_result",
    "attempt_count",
    "max_attempts",
    "lease_owner",
    "lease_expires_at",
    "not_before",
    "canonical_state",
    "retry_count",
    "last_error",
    "error_type",
    "next_retry_at"
  ]);
  const columns = await pool.query(`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'v4_recognition_jobs'
  `);
  const availableColumns = new Set(columns.rows.map((row) => row.column_name));
  const missingColumns = [...requiredColumns].filter((column) => !availableColumns.has(column));
  assert.deepEqual(
    missingColumns,
    [],
    `Track C PostgreSQL preflight failed: missing queue columns ${missingColumns.join(", ")}`
  );
}

async function createBatch(batchId, itemCount, purpose, batchTenantId = tenantId) {
  await pool.query(`
    insert into public.v4_recognition_batches (
      id,
      tenant_id,
      status,
      item_count,
      metadata
    ) values ($1, $2, 'QUEUED', $3, pg_catalog.jsonb_build_object(
      'integration_test', true,
      'purpose', $4::text,
      'run_suffix', $5::text
    ))
  `, [batchId, batchTenantId, itemCount, purpose, runSuffix]);
}

async function insertJob({ id, batchId, priority = 100, lane = "background", jobTenantId = tenantId }) {
  await pool.query(`
    insert into public.v4_recognition_jobs (
      id,
      schema_version,
      batch_id,
      tenant_id,
      job_type,
      provider_id,
      status,
      priority,
      lane,
      payload,
      max_attempts,
      not_before,
      created_at,
      updated_at
    ) values (
      $1,
      'v4-recognition-session-v1',
      $2,
      $3,
      'FINAL_ASSISTED_TITLE',
      'openai_legacy',
      'QUEUED',
      $4,
      $5,
      pg_catalog.jsonb_build_object('integration_test', true, 'run_suffix', $6::text),
      4,
      pg_catalog.clock_timestamp() - interval '1 second',
      pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp()
    )
  `, [id, batchId, jobTenantId, priority, lane, runSuffix]);
}

async function claimJobs({ limit = 25, workerId, leaseSeconds = 300, lane = null }) {
  const result = await pool.query(`
    select
      id,
      tenant_id,
      status,
      lane,
      attempt_count,
      max_attempts,
      lease_owner,
      lease_expires_at,
      canonical_state,
      retry_count
    from public.claim_v4_recognition_jobs($1, $2, $3, $4, $5)
  `, [limit, workerId, leaseSeconds, lane, tenantId]);
  return result.rows;
}

async function claimJobsWithCapacity({
  limit = 25,
  workerId,
  leaseSeconds = 300,
  lane = null,
  claimTenantId = tenantId,
  providerCapacity = 8
}) {
  const result = await pool.query(`
    select *
    from public.claim_v4_recognition_jobs_with_balanced_capacity(
      $1, $2, $3, $4, $5, 'openai_legacy', $6, $6, 1
    )
  `, [limit, workerId, leaseSeconds, lane, claimTenantId, providerCapacity]);
  return result.rows;
}

async function releaseCapacity(jobIds, workerId = null) {
  if (!jobIds.length) return 0;
  const result = await pool.query(`
    select coalesce(sum(public.release_v4_provider_capacity_for_job(job_id, $2)), 0) as released
    from pg_catalog.unnest($1::text[]) as job_id
  `, [jobIds, workerId]);
  return count(result.rows[0]?.released || 0);
}

async function completeClaimedJobs(ids, workerId = null) {
  const result = await pool.query(`
    update public.v4_recognition_jobs jobs
    set status = 'L2_READY',
        result = pg_catalog.jsonb_build_object(
          'ok', true,
          'integration_test', true,
          'run_suffix', $3::text
        ),
        stage_result = pg_catalog.jsonb_build_object(
          'ok', true,
          'integration_test', true
        ),
        completed_at = pg_catalog.clock_timestamp(),
        lease_owner = null,
        lease_expires_at = null,
        updated_at = pg_catalog.clock_timestamp()
    where jobs.tenant_id = $1
      and jobs.id = any($2::text[])
      and jobs.status = 'RUNNING'
      and ($4::text is null or jobs.lease_owner = $4)
    returning jobs.id
  `, [tenantId, ids, runSuffix, workerId]);
  return result.rows.map((row) => row.id);
}

async function heartbeatJob(jobId, workerId, leaseSeconds = 30) {
  const result = await pool.query(`
    select public.heartbeat_v4_recognition_job($1, $2, $3) as extended
  `, [jobId, workerId, leaseSeconds]);
  return result.rows[0]?.extended === true;
}

async function failClaimedJob({ jobId, workerId, attempt }) {
  const result = await pool.query(`
    select
      id,
      status,
      canonical_state,
      attempt_count,
      max_attempts,
      retry_count,
      last_error,
      error_type,
      next_retry_at,
      completed_at
    from public.fail_v4_recognition_job(
      $1,
      $2,
      $3::jsonb,
      true,
      false
    )
  `, [
    jobId,
    workerId,
    JSON.stringify({
      message: `integration timeout attempt ${attempt}`,
      code: "PROVIDER_TIMEOUT",
      integration_test: true
    })
  ]);
  assert.equal(result.rows.length, 1, `attempt ${attempt} failure RPC must update exactly one job`);
  return result.rows[0];
}

async function cleanup() {
  await pool.query("begin");
  try {
    await pool.query(`
      delete from public.v4_provider_capacity_leases
      where job_id like $1
    `, [`${idPrefix}%`]);
    await pool.query(`
      delete from public.v4_queue_kick_leases
      where scope like $1
    `, [`${idPrefix}%`]);
    await pool.query(`
      delete from public.job_attempt_events
      where tenant_id = any($1::text[])
    `, [[tenantId, crossTenantId]]);
    await pool.query(`
      delete from public.v4_recognition_jobs
      where tenant_id = any($1::text[])
    `, [[tenantId, crossTenantId]]);
    await pool.query(`
      delete from public.v4_recognition_batches
      where tenant_id = any($1::text[])
    `, [[tenantId, crossTenantId]]);
    await pool.query(`
      delete from public.tenants
      where id = any($1::text[])
    `, [[tenantId, crossTenantId]]);
    await pool.query("commit");
  } catch (error) {
    await pool.query("rollback").catch(() => null);
    throw error;
  }
}

let createdTenant = false;
let testFailure = null;
let testSummary = null;
let cleanupCompleted = false;

try {
  await preflight();
  await pool.query(`
    insert into public.tenants (id, name, plan, status)
    values
      ($1, $3, 'pilot', 'ACTIVE'),
      ($2, $4, 'pilot', 'ACTIVE')
  `, [
    tenantId,
    crossTenantId,
    `Track C PostgreSQL reliability ${runSuffix}`,
    `Track C PostgreSQL cross-tenant sentinel ${runSuffix}`
  ]);
  createdTenant = true;

  await createBatch(mainBatchId, 1_000, "one_thousand_job_claim_and_completion");
  const inserted = await pool.query(`
    insert into public.v4_recognition_jobs (
      id,
      schema_version,
      batch_id,
      tenant_id,
      job_type,
      provider_id,
      status,
      priority,
      lane,
      payload,
      max_attempts,
      not_before,
      created_at,
      updated_at
    )
    select
      $1 || '_main_' || pg_catalog.lpad(series.job_no::text, 4, '0'),
      'v4-recognition-session-v1',
      $2,
      $3,
      'FINAL_ASSISTED_TITLE',
      'openai_legacy',
      'QUEUED',
      100,
      'background',
      pg_catalog.jsonb_build_object(
        'integration_test', true,
        'ordinal', series.job_no,
        'run_suffix', $4::text
      ),
      4,
      pg_catalog.clock_timestamp() - interval '1 second',
      pg_catalog.clock_timestamp() + (series.job_no * interval '1 microsecond'),
      pg_catalog.clock_timestamp()
    from pg_catalog.generate_series(1, 1000) as series(job_no)
    returning id
  `, [idPrefix, mainBatchId, tenantId, runSuffix]);
  assert.equal(inserted.rows.length, 1_000, "all 1000 jobs must be durably inserted");

  const persisted = await pool.query(`
    select
      count(*) as job_count,
      count(*) filter (where status = 'QUEUED') as queued_count,
      count(distinct id) as distinct_job_count
    from public.v4_recognition_jobs
    where tenant_id = $1
      and batch_id = $2
  `, [tenantId, mainBatchId]);
  assert.equal(count(persisted.rows[0].job_count), 1_000);
  assert.equal(count(persisted.rows[0].queued_count), 1_000);
  assert.equal(count(persisted.rows[0].distinct_job_count), 1_000);

  const claimedIds = [];
  let claimWave = 0;
  while (claimedIds.length < 1_000) {
    const remaining = 1_000 - claimedIds.length;
    const workerCount = Math.min(8, Math.ceil(remaining / 25));
    const claims = await Promise.all(Array.from({ length: workerCount }, (_, workerOffset) => (
      claimJobs({
        limit: Math.min(25, remaining),
        workerId: `${idPrefix}_main_worker_${claimWave}_${workerOffset}`,
        leaseSeconds: 300,
        lane: "background"
      })
    )));
    const waveRows = claims.flat();
    assert.ok(waveRows.length > 0, `claim wave ${claimWave} must make progress`);
    for (const row of waveRows) {
      assert.equal(row.tenant_id, tenantId);
      assert.equal(row.status, "RUNNING");
      assert.equal(row.canonical_state, "RUNNING");
      assert.equal(row.attempt_count, 1);
      claimedIds.push(row.id);
    }
    claimWave += 1;
  }
  assert.equal(claimedIds.length, 1_000);
  assert.equal(new Set(claimedIds).size, 1_000, "concurrent claims must never return a job twice");
  assert.ok(claimedIds.every((id) => id.startsWith(`${idPrefix}_main_`)));
  assert.deepEqual(
    new Set(claimedIds),
    new Set(inserted.rows.map((row) => row.id)),
    "the claimed set must exactly equal the persisted set"
  );
  assert.equal((await claimJobs({
    limit: 25,
    workerId: `${idPrefix}_duplicate_probe`,
    lane: "background"
  })).length, 0, "no live lease may be claimed twice");
  const mainAttemptEvents = await pool.query(`
    select
      count(*) as event_count,
      count(distinct job_id) as distinct_job_count,
      count(*) filter (where attempt_no = 1) as first_attempt_count
    from public.job_attempt_events
    where tenant_id = $1
      and batch_id = $2
      and event_type = 'ATTEMPT_STARTED'
  `, [tenantId, mainBatchId]);
  assert.equal(count(mainAttemptEvents.rows[0].event_count), 1_000);
  assert.equal(count(mainAttemptEvents.rows[0].distinct_job_count), 1_000);
  assert.equal(count(mainAttemptEvents.rows[0].first_attempt_count), 1_000);

  const completedIds = await completeClaimedJobs(claimedIds);
  assert.equal(completedIds.length, 1_000, "all claimed jobs must complete exactly once");
  const completion = await pool.query(`
    select
      count(*) as job_count,
      count(*) filter (where status = 'L2_READY') as completed_count,
      count(*) filter (where canonical_state = 'SUCCESS') as success_count,
      count(*) filter (where attempt_count = 1) as single_attempt_count,
      count(*) filter (where lease_owner is not null or lease_expires_at is not null) as leaked_lease_count
    from public.v4_recognition_jobs
    where tenant_id = $1
      and batch_id = $2
  `, [tenantId, mainBatchId]);
  assert.equal(count(completion.rows[0].job_count), 1_000);
  assert.equal(count(completion.rows[0].completed_count), 1_000);
  assert.equal(count(completion.rows[0].success_count), 1_000);
  assert.equal(count(completion.rows[0].single_attempt_count), 1_000);
  assert.equal(count(completion.rows[0].leaked_lease_count), 0);

  // A wake is a hint, not ownership. Repeating the same wake scope must be
  // idempotent while the first kick lease is live.
  const wakeScope = `${idPrefix}_duplicate_wake`;
  const firstWake = await pool.query(`
    select public.try_acquire_v4_queue_kick($1, $2, 30000) as acquired
  `, [wakeScope, `${idPrefix}_wake_a`]);
  const duplicateWake = await pool.query(`
    select public.try_acquire_v4_queue_kick($1, $2, 30000) as acquired
  `, [wakeScope, `${idPrefix}_wake_b`]);
  assert.equal(firstWake.rows[0]?.acquired, true, "the first wake must acquire its dedup lease");
  assert.equal(duplicateWake.rows[0]?.acquired, false, "a duplicate wake must be deduplicated");

  // Model an HTTP response disappearing after the claim transaction commits:
  // ignore the RPC response and recover the exact live ownership by worker id.
  await createBatch(responseLossBatchId, 1, "claim_response_loss_recovery");
  await insertJob({ id: responseLossJobId, batchId: responseLossBatchId, priority: 0 });
  const responseLossWorker = `${idPrefix}_response_loss_worker`;
  await claimJobsWithCapacity({
    limit: 1,
    workerId: responseLossWorker,
    leaseSeconds: 300,
    lane: "background",
    providerCapacity: 2
  });
  const recoveredAfterResponseLoss = await pool.query(`
    select id, lease_owner, status
    from public.v4_recognition_jobs
    where tenant_id = $1
      and lease_owner = $2
      and lease_expires_at > pg_catalog.clock_timestamp()
  `, [tenantId, responseLossWorker]);
  assert.deepEqual(recoveredAfterResponseLoss.rows.map((row) => row.id), [responseLossJobId]);
  assert.equal(recoveredAfterResponseLoss.rows[0]?.status, "RUNNING");
  assert.deepEqual(await completeClaimedJobs([responseLossJobId], responseLossWorker), [responseLossJobId]);
  assert.equal(await releaseCapacity([responseLossJobId], responseLossWorker), 1);

  // Exercise the real provider-capacity lease table independently of the 1000
  // row claim-throughput test. All slots must be reusable and empty afterward.
  const capacityJobIds = Array.from({ length: 8 }, (_, index) => `${idPrefix}_capacity_${index + 1}`);
  await createBatch(capacityBatchId, capacityJobIds.length, "capacity_slot_release");
  for (const jobId of capacityJobIds) await insertJob({ id: jobId, batchId: capacityBatchId });
  const capacityWorker = `${idPrefix}_capacity_worker`;
  const capacityClaims = await claimJobsWithCapacity({
    limit: capacityJobIds.length,
    workerId: capacityWorker,
    lane: "background",
    providerCapacity: capacityJobIds.length
  });
  assert.equal(capacityClaims.length, capacityJobIds.length);
  assert.equal(new Set(capacityClaims.map((row) => row.id)).size, capacityJobIds.length);
  assert.deepEqual(await completeClaimedJobs(capacityJobIds, capacityWorker), capacityJobIds);
  assert.equal(await releaseCapacity(capacityJobIds, capacityWorker), capacityJobIds.length);
  const liveCapacitySlots = await pool.query(`
    select count(*) as live_count
    from public.v4_provider_capacity_leases
    where job_id like $1
  `, [`${idPrefix}%`]);
  assert.equal(count(liveCapacitySlots.rows[0].live_count), 0, "all capacity slots must be released");

  // Tenant-scoped claims must not observe or mutate a queued job belonging to
  // another tenant.
  await createBatch(crossTenantBatchId, 1, "cross_tenant_isolation", crossTenantId);
  await insertJob({
    id: crossTenantJobId,
    batchId: crossTenantBatchId,
    priority: 0,
    jobTenantId: crossTenantId
  });
  assert.equal((await claimJobsWithCapacity({
    limit: 1,
    workerId: `${idPrefix}_wrong_tenant_worker`,
    lane: "background",
    claimTenantId: tenantId,
    providerCapacity: 2
  })).length, 0, "a tenant-scoped worker must not claim another tenant's job");
  const crossTenantWorker = `${idPrefix}_cross_tenant_worker`;
  const crossTenantClaim = await claimJobsWithCapacity({
    limit: 1,
    workerId: crossTenantWorker,
    lane: "background",
    claimTenantId: crossTenantId,
    providerCapacity: 2
  });
  assert.deepEqual(crossTenantClaim.map((row) => row.id), [crossTenantJobId]);
  assert.deepEqual(await completeClaimedJobs([crossTenantJobId], crossTenantWorker), []);
  const crossTenantCompletion = await pool.query(`
    update public.v4_recognition_jobs
    set status = 'L2_READY',
        result = pg_catalog.jsonb_build_object('ok', true, 'integration_test', true),
        stage_result = pg_catalog.jsonb_build_object('ok', true, 'integration_test', true),
        completed_at = pg_catalog.clock_timestamp(),
        lease_owner = null,
        lease_expires_at = null,
        updated_at = pg_catalog.clock_timestamp()
    where id = $1 and tenant_id = $2 and lease_owner = $3 and status = 'RUNNING'
    returning id
  `, [crossTenantJobId, crossTenantId, crossTenantWorker]);
  assert.deepEqual(crossTenantCompletion.rows.map((row) => row.id), [crossTenantJobId]);
  assert.equal(await releaseCapacity([crossTenantJobId], crossTenantWorker), 1);

  await createBatch(leaseBatchId, 1, "expired_lease_reclaim");
  await insertJob({ id: leaseJobId, batchId: leaseBatchId, priority: 0 });
  const firstLease = await claimJobs({
    limit: 1,
    workerId: `${idPrefix}_lease_original`,
    leaseSeconds: 30,
    lane: "background"
  });
  assert.equal(firstLease.length, 1);
  assert.equal(firstLease[0].id, leaseJobId);
  assert.equal(firstLease[0].attempt_count, 1);
  assert.equal(
    await heartbeatJob(leaseJobId, `${idPrefix}_lease_wrong_owner`),
    false,
    "a non-owner must not extend a live lease"
  );
  assert.equal(
    await heartbeatJob(leaseJobId, `${idPrefix}_lease_original`),
    true,
    "the active owner must extend an unexpired RUNNING lease"
  );
  await pool.query(`
    update public.v4_recognition_jobs
    set lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second',
        updated_at = pg_catalog.clock_timestamp()
    where id = $1
  `, [leaseJobId]);
  assert.equal(
    await heartbeatJob(leaseJobId, `${idPrefix}_lease_original`),
    false,
    "an expired owner must not revive its lease"
  );
  const reclaimWorkers = [`${idPrefix}_lease_reclaimer_a`, `${idPrefix}_lease_reclaimer_b`];
  const reclaimedClaims = (await Promise.all(reclaimWorkers.map((workerId) => claimJobs({
    limit: 1,
    workerId,
    leaseSeconds: 300,
    lane: "background"
  })))).flat();
  assert.equal(reclaimedClaims.length, 1, "one expired lease must be reclaimed by exactly one worker");
  assert.equal(reclaimedClaims[0].id, leaseJobId);
  assert.equal(reclaimedClaims[0].attempt_count, 2);
  assert.notEqual(reclaimedClaims[0].lease_owner, `${idPrefix}_lease_original`);
  assert.equal(
    await heartbeatJob(leaseJobId, `${idPrefix}_lease_original`),
    false,
    "the stale owner must not extend a reclaimed lease"
  );
  assert.equal(
    await heartbeatJob(leaseJobId, reclaimedClaims[0].lease_owner),
    true,
    "the current owner must retain its live lease"
  );
  const staleCompletion = await completeClaimedJobs([leaseJobId], `${idPrefix}_lease_original`);
  assert.equal(staleCompletion.length, 0, "the stale lease owner must not complete a reclaimed job");
  const reclaimedCompletion = await completeClaimedJobs([leaseJobId], reclaimedClaims[0].lease_owner);
  assert.deepEqual(reclaimedCompletion, [leaseJobId]);
  assert.equal(
    await heartbeatJob(leaseJobId, reclaimedClaims[0].lease_owner),
    false,
    "a completed job must not accept a heartbeat"
  );
  const leaseEvents = await pool.query(`
    select count(*) as attempt_started_count,
           count(distinct attempt_no) as distinct_attempt_count
    from public.job_attempt_events
    where tenant_id = $1
      and job_id = $2
      and event_type = 'ATTEMPT_STARTED'
  `, [tenantId, leaseJobId]);
  assert.equal(count(leaseEvents.rows[0].attempt_started_count), 2);
  assert.equal(count(leaseEvents.rows[0].distinct_attempt_count), 2);

  await createBatch(retryBatchId, 1, "retry_backoff_and_manual_rerun");
  await insertJob({ id: retryJobId, batchId: retryBatchId, priority: 0, lane: "interactive" });
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const workerId = `${idPrefix}_retry_worker_${attempt}`;
    const retryClaim = await claimJobs({
      limit: 1,
      workerId,
      leaseSeconds: 300,
      lane: "interactive"
    });
    assert.equal(retryClaim.length, 1, `retry attempt ${attempt} must be claimable`);
    assert.equal(retryClaim[0].id, retryJobId);
    assert.equal(retryClaim[0].attempt_count, attempt);
    const failed = await failClaimedJob({ jobId: retryJobId, workerId, attempt });
    if (attempt <= expectedRetryDelaysMs.length) {
      assert.equal(failed.status, "RETRYING");
      assert.equal(failed.canonical_state, "RETRYABLE_FAILED");
      assert.equal(failed.retry_count, attempt);
      assert.ok(failed.next_retry_at);
      assert.equal(failed.completed_at, null);
      await pool.query(`
        update public.v4_recognition_jobs
        set not_before = pg_catalog.clock_timestamp() - interval '1 second',
            updated_at = pg_catalog.clock_timestamp()
        where id = $1
      `, [retryJobId]);
    } else {
      assert.equal(failed.status, "FAILED");
      assert.equal(failed.canonical_state, "FAILED_FINAL");
      assert.equal(failed.retry_count, 3);
      assert.equal(failed.next_retry_at, null);
      assert.ok(failed.completed_at);
    }
    assert.equal(failed.error_type, "PROVIDER_TIMEOUT");
    assert.equal(failed.last_error, `integration timeout attempt ${attempt}`);
  }

  const retryEvents = await pool.query(`
    select attempt_no, event_type, retry_delay_ms, canonical_status, error_code
    from public.job_attempt_events
    where tenant_id = $1
      and job_id = $2
      and event_type in ('RETRY_SCHEDULED', 'FAILED_FINAL')
    order by attempt_no asc, occurred_at asc
  `, [tenantId, retryJobId]);
  assert.deepEqual(
    retryEvents.rows.filter((row) => row.event_type === "RETRY_SCHEDULED").map((row) => count(row.retry_delay_ms)),
    expectedRetryDelaysMs
  );
  assert.equal(retryEvents.rows.at(-1)?.event_type, "FAILED_FINAL");
  assert.equal(retryEvents.rows.at(-1)?.canonical_status, "FAILED_FINAL");
  assert.equal(retryEvents.rows.at(-1)?.error_code, "PROVIDER_TIMEOUT");

  const manualRetry = await pool.query(`
    update public.v4_recognition_jobs jobs
    set status = 'RETRYING',
        lane = 'interactive',
        priority = 0,
        max_attempts = greatest(jobs.max_attempts, jobs.attempt_count + 2),
        not_before = pg_catalog.clock_timestamp(),
        started_at = null,
        completed_at = null,
        lease_owner = null,
        lease_expires_at = null,
        result = '{}'::jsonb,
        stage_result = '{}'::jsonb,
        error = coalesce(jobs.error, '{}'::jsonb) || pg_catalog.jsonb_build_object(
          'manual_retry', pg_catalog.jsonb_build_object(
            'requested_at', pg_catalog.clock_timestamp(),
            'requested_by_user_id', $3::text,
            'previous_status', 'FAILED',
            'previous_attempt_count', jobs.attempt_count
          )
        ),
        timing = pg_catalog.jsonb_build_object(
          'manual_retry_requested_at', pg_catalog.clock_timestamp(),
          'previous_attempt_timing', coalesce(jobs.timing, '{}'::jsonb)
        ),
        queue_tags = (
          coalesce(jobs.queue_tags, '{}'::jsonb)
            - 'provider_capacity_slot'
            - 'provider_key_slot'
            - 'provider_capacity_lease_owner'
            - 'provider_capacity_leased_at'
        ) || pg_catalog.jsonb_build_object(
          'manual_retry_requested_at', pg_catalog.clock_timestamp(),
          'manual_retry_requested_by_user_id', $3::text,
          'manual_retry_count', coalesce((jobs.queue_tags ->> 'manual_retry_count')::integer, 0) + 1,
          'manual_retry_queue_policy', 'interactive_priority_zero',
          'manual_retry_user_initiated', true
        ),
        updated_at = pg_catalog.clock_timestamp()
    where jobs.id = $1
      and jobs.tenant_id = $2
      and jobs.status = 'FAILED'
    returning
      jobs.id,
      jobs.status,
      jobs.canonical_state,
      jobs.attempt_count,
      jobs.max_attempts,
      jobs.retry_count,
      jobs.next_retry_at,
      jobs.queue_tags
  `, [retryJobId, tenantId, `${idPrefix}_manual_operator`]);
  assert.equal(manualRetry.rows.length, 1);
  assert.equal(manualRetry.rows[0].status, "RETRYING");
  assert.equal(manualRetry.rows[0].canonical_state, "RETRYABLE_FAILED");
  assert.equal(manualRetry.rows[0].attempt_count, 4);
  assert.equal(manualRetry.rows[0].max_attempts, 6);
  assert.equal(manualRetry.rows[0].retry_count, 4);
  assert.ok(manualRetry.rows[0].next_retry_at);
  assert.equal(manualRetry.rows[0].queue_tags.manual_retry_count, 1);

  const manualWorker = `${idPrefix}_manual_worker`;
  const manualClaim = await claimJobs({
    limit: 1,
    workerId: manualWorker,
    leaseSeconds: 300,
    lane: "interactive"
  });
  assert.equal(manualClaim.length, 1);
  assert.equal(manualClaim[0].id, retryJobId);
  assert.equal(manualClaim[0].attempt_count, 5);
  assert.deepEqual(await completeClaimedJobs([retryJobId], manualWorker), [retryJobId]);
  const manualSuccess = await pool.query(`
    select status, canonical_state, attempt_count, retry_count, lease_owner, lease_expires_at
    from public.v4_recognition_jobs
    where id = $1
  `, [retryJobId]);
  assert.equal(manualSuccess.rows[0].status, "L2_READY");
  assert.equal(manualSuccess.rows[0].canonical_state, "SUCCESS");
  assert.equal(manualSuccess.rows[0].attempt_count, 5);
  assert.equal(manualSuccess.rows[0].retry_count, 4);
  assert.equal(manualSuccess.rows[0].lease_owner, null);
  assert.equal(manualSuccess.rows[0].lease_expires_at, null);

  testSummary = {
    ok: true,
    skipped: false,
    scope: "postgres_queue_reliability",
    database_round_trip: true,
    main_jobs: {
      persisted: 1_000,
      claimed: claimedIds.length,
      distinct_claims: new Set(claimedIds).size,
      completed: count(completion.rows[0].completed_count),
      success: count(completion.rows[0].success_count),
      durable_attempt_events: count(mainAttemptEvents.rows[0].event_count),
      claim_waves: claimWave
    },
    lease_expiry: {
      reclaimed_exactly_once: true,
      atomic_execution_fence_verified: true,
      expired_owner_revival_rejected: true,
      stale_owner_completion_rejected: true,
      attempts: 2
    },
    retry: {
      schedule_ms: expectedRetryDelaysMs,
      failed_final_after_attempts: 4,
      manual_rerun_attempt: 5,
      manual_rerun_status: manualSuccess.rows[0].canonical_state
    },
    invariants: {
      terminal_jobs: 1_000,
      lost_jobs: 0,
      duplicate_results: 0,
      cross_tenant_claims: 0,
      duplicate_wake_deduplicated: true,
      response_loss_recovered: true,
      capacity_slots_released: true,
      external_provider_calls: 0
    }
  };
} catch (error) {
  testFailure = error;
  console.error(error?.stack || error);
  process.exitCode = 1;
} finally {
  if (createdTenant) {
    try {
      await cleanup();
      cleanupCompleted = true;
    } catch (cleanupError) {
      console.error(`Track C PostgreSQL reliability cleanup failed: ${cleanupError?.message || cleanupError}`);
      if (!testFailure) process.exitCode = 1;
    }
  }
  await pool.end().catch(() => null);
}

if (!testFailure && process.exitCode !== 1 && testSummary) {
  const report = {
    ...testSummary,
    cleanup: cleanupCompleted ? "completed" : "not_required"
  };
  if (reportPath) await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
