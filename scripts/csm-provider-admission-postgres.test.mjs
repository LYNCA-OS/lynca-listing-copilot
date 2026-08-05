#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const root = new URL("..", import.meta.url).pathname;
const migrations = [
  "20260801101152_csm_thin_provider_admission_v1.sql",
  "20260801115421_csm_thin_provider_pacer_v1.sql"
].map((name) => join(
  root,
  "infrastructure/supabase-production/supabase/migrations",
  name
));
const dataDir = mkdtempSync(join(tmpdir(), "lynca-csm-authority-pg-"));
// Keep the Unix socket below PostgreSQL's path limit on macOS. The generated
// per-user tmp path is safe for PGDATA but too long once `.s.PGSQL.<port>` is
// appended.
const socketDir = mkdtempSync("/tmp/lynca-csm-authority-socket-");
const port = 55_000 + (process.pid % 5_000);
let started = false;
const execFileAsync = promisify(execFile);

function command(name, args, options = {}) {
  const output = execFileSync(name, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture === false ? "ignore" : ["ignore", "pipe", "pipe"]
  });
  return String(output ?? "").trim();
}

function sql(statement) {
  return command("psql", [
    "-h", socketDir, "-p", String(port), "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-Atqc", statement
  ]);
}

function json(statement) {
  return JSON.parse(sql(statement));
}

async function jsonAsync(statement) {
  const { stdout } = await execFileAsync("psql", [
    "-h", socketDir, "-p", String(port), "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-Atqc", statement
  ], { cwd: root, encoding: "utf8" });
  return JSON.parse(stdout.trim());
}

function literal(value) {
  if (value === null) return "null";
  return `'${String(value).replaceAll("'", "''")}'`;
}

const scope = ["openai", "lynca-primary", "gpt-5.6-luna"];
const hash = (character) => character.repeat(64);

function enqueue({
  tenant, operation, payload = hash("a"), attempt = 1,
  attemptClass = "FRESH", tokens = 1_000, owner = "worker-a", weight = 1
}) {
  return json(`select public.enqueue_csm_thin_provider_attempt_v1(
    ${literal(tenant)}, ${literal(operation)}, ${literal(payload)},
    ${literal(scope[0])}, ${literal(scope[1])}, ${literal(scope[2])},
    ${attempt}, ${literal(attemptClass)}, ${tokens}, ${weight}, null,
    ${literal(owner)}, 300
  )::text`);
}

function claimStatement({ tenant, operation, attempt = 1, owner = "worker-a", lease = 180 }) {
  return `select public.claim_csm_thin_provider_attempt_v1(
    ${literal(scope[0])}, ${literal(scope[1])}, ${literal(scope[2])},
    ${literal(tenant)}, ${literal(operation)}, ${attempt}, ${literal(owner)}, ${lease}
  )::text`;
}

function openPacerForIndependentInvariant() {
  sql(`update public.csm_thin_provider_scopes
    set pacer_available_tokens = pacer_burst_tokens,
        pacer_refilled_at = pg_catalog.clock_timestamp()`);
}

function claim(input, { respectPacer = false } = {}) {
  // Most pre-existing assertions isolate fencing, fairness or token-wall
  // behavior. Open the new time gate for those independent invariants; the
  // dedicated pacer block below exercises the serialized clock itself.
  if (!respectPacer) openPacerForIndependentInvariant();
  return json(claimStatement(input));
}

async function claimUntilAdmissionBoundary(input) {
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const result = await jsonAsync(claimStatement(input));
    if (result.admitted === true || ["pacer_limited", "capacity_full"].includes(result.code)) {
      return result;
    }
  }
  throw new Error(`claim_did_not_reach_admission_boundary:${input.operation}`);
}

function settle({
  tenant, operation, attempt = 1, owner = "worker-a", fence = 1,
  outcome = "SUCCEEDED", result = {}, actualTokens = null
}) {
  return json(`select public.settle_csm_thin_provider_attempt_v1(
    ${literal(scope[0])}, ${literal(scope[1])}, ${literal(scope[2])},
    ${literal(tenant)}, ${literal(operation)}, ${attempt}, ${literal(owner)}, ${fence},
    ${literal(outcome)}, ${literal(JSON.stringify(result))}::jsonb,
    ${actualTokens === null ? "null" : actualTokens}
  )::text`);
}

function cancel({ tenant, operation, payload = hash("a") }) {
  return json(`select public.cancel_csm_thin_provider_operation_v1(
    ${literal(scope[0])}, ${literal(scope[1])}, ${literal(scope[2])},
    ${literal(tenant)}, ${literal(operation)}, ${literal(payload)}
  )::text`);
}

for (const binary of ["initdb", "pg_ctl", "psql"]) {
  try {
    command(binary, ["--version"]);
  } catch {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(socketDir, { recursive: true, force: true });
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      reason: `${binary} is not available`,
      scope: "csm_provider_admission_postgres"
    }));
    process.exit(0);
  }
}

try {
  command("initdb", ["-D", dataDir, "-A", "trust", "-U", "postgres"], { capture: false });
  command("pg_ctl", [
    "-D", dataDir, "-o", `-p ${port} -k ${socketDir}`,
    "-l", join(dataDir, "server.log"), "-w", "start"
  ], { capture: false });
  started = true;
  sql("create role anon; create role authenticated; create role service_role");
  for (const migration of migrations) {
    command("psql", [
      "-h", socketDir, "-p", String(port), "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-f", migration
    ], { capture: false });
  }

  // The tables are opaque even to service_role; the six definer RPCs are its
  // only interface. RLS is both enabled and forced.
  assert.equal(sql(`select pg_catalog.bool_and(c.relrowsecurity and c.relforcerowsecurity)
    from pg_catalog.pg_class c
    where c.oid in (
      'public.csm_thin_provider_scopes'::regclass,
      'public.csm_thin_provider_operations'::regclass,
      'public.csm_thin_provider_attempts'::regclass
    )`), "t");
  assert.equal(sql(`select has_table_privilege(
    'service_role', 'public.csm_thin_provider_attempts', 'SELECT'
  )`), "f");
  assert.equal(sql(`select has_function_privilege(
    'service_role',
    'public.claim_csm_thin_provider_attempt_v1(text,text,text,text,text,integer,text,integer)',
    'EXECUTE'
  )`), "t");
  assert.equal(sql(`select has_function_privilege(
    'anon',
    'public.claim_csm_thin_provider_attempt_v1(text,text,text,text,text,integer,text,integer)',
    'EXECUTE'
  )`), "f");
  assert.equal(sql(`select has_function_privilege(
    'service_role',
    'public.check_csm_thin_provider_pacer_v1(text,text,text)',
    'EXECUTE'
  )`), "t");
  assert.equal(sql(`select has_function_privilege(
    'anon',
    'public.check_csm_thin_provider_pacer_v1(text,text,text)',
    'EXECUTE'
  )`), "f");
  assert.equal(sql(`select pg_catalog.count(*) from pg_catalog.pg_indexes
    where schemaname = 'public' and indexname like 'csm_thin_provider_%_idx'`), "4");
  assert.equal(sql(`select max_active || ':' || max_active_tokens || ':'
      || baseline_working_max_active || ':' || pacer_tokens_per_second || ':'
      || pacer_burst_tokens || ':'
      || effective_max_active
    from public.csm_thin_provider_scopes`), "120:440000:43:60000:65200:43");
  const pacerReadiness = json(`select public.check_csm_thin_provider_pacer_v1(
    ${literal(scope[0])}, ${literal(scope[1])}, ${literal(scope[2])}
  )::text`);
  assert.equal(pacerReadiness.code, "pacer_ready");
  assert.equal(pacerReadiness.baseline_working_max_active, 43);
  assert.equal(pacerReadiness.pacer_tokens_per_second, 60_000);
  assert.equal(pacerReadiness.pacer_burst_tokens, 65_200);

  // Exercise PostgreSQL's timestamp epoch extraction and NUMERIC refill math,
  // not only a JavaScript approximation. The minimum lossless bucket retains
  // every sub-5,300 carry: 53 exact one-second ticks admit 600 reservations,
  // never more than twelve in one tick, and end at zero balance.
  assert.equal(sql(`with recursive pacer(tick, balance, admitted_total, tick_max) as (
      select 0, 0::numeric(20,6), 0::bigint, 0::integer
      union all
      select pacer.tick + 1,
        (step.refilled - step.admitted * 5300)::numeric(20,6),
        pacer.admitted_total + step.admitted,
        greatest(pacer.tick_max, step.admitted)
      from pacer
      cross join lateral (
        select refilled,
          pg_catalog.floor(refilled / 5300)::integer as admitted
        from (
          select least(
            65200::numeric(20,6),
            pacer.balance + extract(epoch from (
              ('2026-08-01 00:00:00+00'::timestamptz
                + (pacer.tick + 1) * interval '1 second')
              - ('2026-08-01 00:00:00+00'::timestamptz
                + pacer.tick * interval '1 second')
            )) * 60000
          )::numeric(20,6) as refilled
        ) refill
      ) step
      where pacer.tick < 53
    )
    select admitted_total || ':' || tick_max || ':' || balance
    from pacer where tick = 53`), "600:12:0.000000");

  // SCFQ/WFQ uses dominant count/token cost: the smaller tenant head wins,
  // yet the target-specific claimant can only admit its own selected row.
  assert.equal(enqueue({ tenant: "tenant-a", operation: "op-big", tokens: 300_000 }).code, "enqueued");
  assert.equal(enqueue({ tenant: "tenant-b", operation: "op-small", tokens: 100_000, owner: "worker-b" }).code, "enqueued");
  assert.equal(claim({ tenant: "tenant-a", operation: "op-big" }).code, "not_scheduler_turn");
  const smallLease = claim({ tenant: "tenant-b", operation: "op-small", owner: "worker-b" });
  assert.equal(smallLease.admitted, true);
  const recoveredSmallLease = claim({
    tenant: "tenant-b", operation: "op-small", owner: "worker-b"
  });
  assert.equal(recoveredSmallLease.code, "claim_receipt_replayed");
  assert.equal(recoveredSmallLease.lease_fence, smallLease.lease_fence);
  assert.equal(sql(`select active_count from public.csm_thin_provider_scopes`), "1",
    "replaying one worker's lost receipt must not reserve capacity twice");
  assert.equal(settle({
    tenant: "tenant-b", operation: "op-small", owner: "worker-b", fence: 999,
    actualTokens: 500
  }).code, "lease_fence_conflict");
  assert.equal(sql(`select active_count from public.csm_thin_provider_scopes`), "1",
    "a stale fence must not release capacity");
  assert.equal(settle({
    tenant: "tenant-b", operation: "op-small", owner: "worker-b",
    fence: smallLease.lease_fence, actualTokens: 500
  }).code, "settled");
  const bigLease = claim({ tenant: "tenant-a", operation: "op-big" });
  assert.equal(bigLease.admitted, true);
  settle({ tenant: "tenant-a", operation: "op-big", fence: bigLease.lease_fence, actualTokens: 1_000 });
  assert.equal(enqueue({
    tenant: "tenant-a", operation: "op-big", payload: hash("b"), tokens: 300_000
  }).code, "operation_payload_conflict");

  // Two independent PostgreSQL sessions race claims whose combined token
  // weight exceeds 440k. The scope-row lock makes the admission/counter change
  // atomic: never two provider leases.
  enqueue({ tenant: "tenant-p1", operation: "op-parallel-1", tokens: 300_000, owner: "worker-p1" });
  enqueue({ tenant: "tenant-p2", operation: "op-parallel-2", tokens: 300_000, owner: "worker-p2" });
  openPacerForIndependentInvariant();
  const parallelClaims = await Promise.all([
    jsonAsync(claimStatement({
      tenant: "tenant-p1", operation: "op-parallel-1", owner: "worker-p1"
    })),
    jsonAsync(claimStatement({
      tenant: "tenant-p2", operation: "op-parallel-2", owner: "worker-p2"
    }))
  ]);
  assert.equal(parallelClaims.filter(({ admitted }) => admitted === true).length, 1);
  assert.equal(sql(`select active_count || ':' || active_tokens
    from public.csm_thin_provider_scopes`), "1:300000");
  const parallelWinner = parallelClaims[0].admitted
    ? { tenant: "tenant-p1", operation: "op-parallel-1", owner: "worker-p1", lease: parallelClaims[0] }
    : { tenant: "tenant-p2", operation: "op-parallel-2", owner: "worker-p2", lease: parallelClaims[1] };
  const parallelLoser = parallelWinner.operation === "op-parallel-1"
    ? { tenant: "tenant-p2", operation: "op-parallel-2", owner: "worker-p2" }
    : { tenant: "tenant-p1", operation: "op-parallel-1", owner: "worker-p1" };
  const tokenWallBlocked = claim(parallelLoser);
  assert.equal(tokenWallBlocked.code, "capacity_full",
    "opening the time gate must not bypass the independent 440k active-token wall");
  settle({
    tenant: parallelWinner.tenant, operation: parallelWinner.operation,
    owner: parallelWinner.owner, fence: parallelWinner.lease.lease_fence,
    actualTokens: 100
  });
  cancel(parallelLoser);

  // Exact rolling-window accounting reserves the estimate at claim and then
  // replaces it with observed usage. The 9k second call fits only because the
  // first 6k reservation was corrected to 1k.
  sql(`update public.csm_thin_provider_attempts
    set started_at = pg_catalog.clock_timestamp() - interval '61 seconds'
    where started_at is not null`);
  sql(`update public.csm_thin_provider_scopes
    set token_window_target = 10000, request_window_target = 100,
        pacer_tokens_per_second = 166`);
  enqueue({ tenant: "tenant-c", operation: "op-refund", tokens: 6_000, owner: "worker-c" });
  const refundLease = claim({ tenant: "tenant-c", operation: "op-refund", owner: "worker-c" });
  settle({
    tenant: "tenant-c", operation: "op-refund", owner: "worker-c",
    fence: refundLease.lease_fence, actualTokens: 1_000,
    result: { input_tokens: 900, output_tokens: 100 }
  });
  enqueue({ tenant: "tenant-d", operation: "op-window-full", tokens: 9_000, owner: "worker-d" });
  const fullLease = claim({ tenant: "tenant-d", operation: "op-window-full", owner: "worker-d" });
  assert.equal(fullLease.admitted, true);
  settle({
    tenant: "tenant-d", operation: "op-window-full", owner: "worker-d",
    fence: fullLease.lease_fence, actualTokens: 9_000
  });
  enqueue({ tenant: "tenant-e", operation: "op-window-blocked", tokens: 1, owner: "worker-e" });
  const windowBlocked = claim({ tenant: "tenant-e", operation: "op-window-blocked", owner: "worker-e" });
  assert.equal(windowBlocked.code, "rolling_window_limited");
  assert.ok(windowBlocked.retry_after_ms > 0);
  sql(`update public.csm_thin_provider_attempts
    set started_at = pg_catalog.clock_timestamp() - interval '61 seconds'
    where operation_key in ('op-refund', 'op-window-full')`);
  const afterWindow = claim({ tenant: "tenant-e", operation: "op-window-blocked", owner: "worker-e" });
  assert.equal(afterWindow.admitted, true, "expired charges must leave the exact 60-second window");
  settle({
    tenant: "tenant-e", operation: "op-window-blocked", owner: "worker-e",
    fence: afterWindow.lease_fence, actualTokens: 1
  });

  // The scope-row lock is also the pacer serialization point. Thirteen
  // independent PostgreSQL sessions race a 65,200-token lossless bucket. It
  // still holds only twelve whole 5,300-token starts; no concurrent transaction
  // can overspend it.
  sql(`update public.csm_thin_provider_attempts
    set started_at = pg_catalog.clock_timestamp() - interval '61 seconds'
    where started_at is not null`);
  sql(`update public.csm_thin_provider_scopes
    set token_window_target = 3600000,
        request_window_target = 4500,
        pacer_tokens_per_second = 1,
        effective_max_active = 43,
        effective_max_active_tokens = 440000,
        aimd_cooldown_until = null,
        pacer_available_tokens = 65200,
        pacer_refilled_at = pg_catalog.clock_timestamp()`);
  const pacedTasks = Array.from({ length: 13 }, (_, offset) => {
    const index = offset + 1;
    return {
      tenant: `tenant-pace-${index}`,
      operation: `op-pace-${index}`,
      owner: `worker-pace-${index}`
    };
  });
  for (const task of pacedTasks) enqueue({ ...task, tokens: 5_300 });
  const pacedRace = await Promise.all(pacedTasks.map(claimUntilAdmissionBoundary));
  assert.equal(pacedRace.filter(({ admitted }) => admitted === true).length, 12,
    "the serialized 65,200-token bucket must admit exactly twelve 5,300-token starts");
  const pacedBlockedIndex = pacedRace.findIndex(({ code }) => code === "pacer_limited");
  assert.ok(pacedBlockedIndex >= 0);
  const pacedBlockedTask = pacedTasks[pacedBlockedIndex];
  assert.equal(sql(`select active_count from public.csm_thin_provider_scopes`), "12");

  // One elapsed second at the production 60k refill rate is enough for eleven
  // starts (58.3k) and carries 1.7k forward. The blocked thirteenth task now
  // starts without resetting the independent active count/token walls.
  sql(`update public.csm_thin_provider_scopes
    set pacer_tokens_per_second = 60000,
        pacer_available_tokens = 0,
        pacer_refilled_at = pg_catalog.clock_timestamp() - interval '1 second'`);
  const pacedRefilledLease = claim(pacedBlockedTask, { respectPacer: true });
  assert.equal(pacedRefilledLease.admitted, true);
  assert.ok(Number(pacedRefilledLease.pacer_available_tokens) >= 54_700
    && Number(pacedRefilledLease.pacer_available_tokens) <= 59_900);
  for (let index = 0; index < pacedRace.length; index += 1) {
    const lease = pacedRace[index];
    if (lease.admitted !== true) continue;
    settle({ ...pacedTasks[index], fence: lease.lease_fence, actualTokens: 100 });
  }
  settle({ ...pacedBlockedTask, fence: pacedRefilledLease.lease_fence, actualTokens: 100 });

  // Pacing controls start rate; the separate normal working window controls
  // tail-latency accumulation. It stops at 43 while the immutable absolute
  // authority remains 120 attempts / 440k active tokens.
  const workingLeases = [];
  for (let index = 1; index <= 44; index += 1) {
    const tenant = `tenant-working-${index}`;
    const operation = `op-working-${index}`;
    const owner = `worker-working-${index}`;
    enqueue({ tenant, operation, tokens: 1_000, owner });
    const result = claim({ tenant, operation, owner });
    if (index <= 43) {
      assert.equal(result.admitted, true);
      workingLeases.push({ tenant, operation, owner, fence: result.lease_fence });
    } else {
      assert.equal(result.code, "capacity_full");
    }
  }
  assert.equal(sql(`select active_count from public.csm_thin_provider_scopes`), "43");
  assert.equal(sql(`select max_active || ':' || max_active_tokens
    from public.csm_thin_provider_scopes`), "120:440000");
  for (const running of workingLeases) {
    settle({ ...running, actualTokens: 100 });
  }
  cancel({ tenant: "tenant-working-44", operation: "op-working-44" });

  // A RUNNING lease may already have crossed the paid provider boundary. If it
  // expires, claim's scope-locked sweep must release counters but fail closed as
  // AMBIGUOUS. The same operation can never enqueue a retry and pay a second time.
  const expiredRunning = {
    tenant: "tenant-expired-running",
    operation: "op-expired-running",
    owner: "worker-expired-running"
  };
  enqueue({ ...expiredRunning, tokens: 5_300 });
  const expiredRunningLease = claim(expiredRunning);
  assert.equal(expiredRunningLease.admitted, true);
  assert.equal(sql(`select active_count || ':' || active_tokens
    from public.csm_thin_provider_scopes`), "1:5300");
  sql(`update public.csm_thin_provider_attempts
    set lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
    where tenant_id = 'tenant-expired-running'
      and operation_key = 'op-expired-running' and attempt_no = 1`);
  assert.equal(claim(expiredRunning).code, "attempt_not_queued");
  assert.equal(sql(`select status from public.csm_thin_provider_operations
    where tenant_id = 'tenant-expired-running'
      and operation_key = 'op-expired-running'`), "AMBIGUOUS");
  assert.equal(sql(`select state from public.csm_thin_provider_attempts
    where tenant_id = 'tenant-expired-running'
      and operation_key = 'op-expired-running' and attempt_no = 1`), "LEASE_EXPIRED");
  assert.equal(sql(`select active_count || ':' || active_tokens
    from public.csm_thin_provider_scopes`), "0:0");
  const expiredRetry = enqueue({
    ...expiredRunning,
    attempt: 2,
    attemptClass: "RETRY",
    tokens: 5_300
  });
  assert.equal(expiredRetry.ok, false);
  assert.equal(expiredRetry.code, "operation_terminal");
  assert.equal(expiredRetry.operation_status, "AMBIGUOUS");
  assert.equal(sql(`select count(*) from public.csm_thin_provider_attempts
    where tenant_id = 'tenant-expired-running'
      and operation_key = 'op-expired-running'`), "1");
  assert.equal(sql(`select active_count || ':' || active_tokens
    from public.csm_thin_provider_scopes`), "0:0");

  // A dead queued owner, including a reserved fair head, is reclaimed as a
  // safe failure. It never blocks a live waiter and never becomes AMBIGUOUS.
  sql(`update public.csm_thin_provider_attempts
    set started_at = pg_catalog.clock_timestamp() - interval '61 seconds'
    where started_at is not null`);
  sql(`update public.csm_thin_provider_scopes
    set token_window_target = 3600000, request_window_target = 4500,
        pacer_tokens_per_second = 60000`);
  enqueue({ tenant: "tenant-dead", operation: "op-dead", tokens: 400_000, owner: "worker-dead" });
  enqueue({ tenant: "tenant-live", operation: "op-live", tokens: 1_000, owner: "worker-live" });
  sql(`update public.csm_thin_provider_attempts
    set queue_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
    where tenant_id = 'tenant-dead' and operation_key = 'op-dead'`);
  sql(`update public.csm_thin_provider_scopes
    set reservation_tenant_id = 'tenant-dead',
        reservation_operation_key = 'op-dead', reservation_attempt_no = 1`);
  const liveLease = claim({ tenant: "tenant-live", operation: "op-live", owner: "worker-live" });
  assert.equal(liveLease.admitted, true);
  assert.equal(sql(`select status from public.csm_thin_provider_operations
    where tenant_id = 'tenant-dead' and operation_key = 'op-dead'`), "FAILED");
  assert.equal(sql(`select state from public.csm_thin_provider_attempts
    where tenant_id = 'tenant-dead' and operation_key = 'op-dead'`), "FAILED");
  settle({
    tenant: "tenant-live", operation: "op-live", owner: "worker-live",
    fence: liveLease.lease_fence, actualTokens: 100
  });

  // No fresh backlog: a 100k retry borrows otherwise idle capacity even though
  // it exceeds the 20% retry token share. With fresh backlog, it waits.
  enqueue({ tenant: "tenant-r", operation: "op-retry", tokens: 100_000, owner: "worker-r" });
  let lease = claim({ tenant: "tenant-r", operation: "op-retry", owner: "worker-r" });
  settle({
    tenant: "tenant-r", operation: "op-retry", owner: "worker-r",
    fence: lease.lease_fence, outcome: "FAILED", actualTokens: 100
  });
  enqueue({
    tenant: "tenant-r", operation: "op-retry", attempt: 2,
    attemptClass: "RETRY", tokens: 100_000, owner: "worker-r"
  });
  lease = claim({ tenant: "tenant-r", operation: "op-retry", attempt: 2, owner: "worker-r" });
  assert.equal(lease.admitted, true, "retry must borrow idle when no fresh row is ready");
  settle({
    tenant: "tenant-r", operation: "op-retry", attempt: 2, owner: "worker-r",
    fence: lease.lease_fence, actualTokens: 100
  });

  enqueue({ tenant: "tenant-r2", operation: "op-retry-capped", tokens: 100_000, owner: "worker-r2" });
  lease = claim({ tenant: "tenant-r2", operation: "op-retry-capped", owner: "worker-r2" });
  settle({
    tenant: "tenant-r2", operation: "op-retry-capped", owner: "worker-r2",
    fence: lease.lease_fence, outcome: "FAILED", actualTokens: 100
  });
  enqueue({
    tenant: "tenant-r2", operation: "op-retry-capped", attempt: 2,
    attemptClass: "RETRY", tokens: 100_000, owner: "worker-r2"
  });
  enqueue({ tenant: "tenant-f", operation: "op-fresh", tokens: 1_000, owner: "worker-f" });
  const retryCapped = claim({
    tenant: "tenant-r2", operation: "op-retry-capped", attempt: 2, owner: "worker-r2"
  });
  assert.equal(retryCapped.admitted, false);
  const freshLease = claim({ tenant: "tenant-f", operation: "op-fresh", owner: "worker-f" });
  assert.equal(freshLease.admitted, true);
  settle({
    tenant: "tenant-f", operation: "op-fresh", owner: "worker-f",
    fence: freshLease.lease_fence, actualTokens: 100
  });
  const borrowedAfterFresh = claim({
    tenant: "tenant-r2", operation: "op-retry-capped", attempt: 2, owner: "worker-r2"
  });
  assert.equal(borrowedAfterFresh.admitted, true);
  settle({
    tenant: "tenant-r2", operation: "op-retry-capped", attempt: 2, owner: "worker-r2",
    fence: borrowedAfterFresh.lease_fence, actualTokens: 100
  });

  // A burst of shared 429 signals halves the effective windows exactly once
  // per cooldown epoch; one stable second then grows them additively, but the
  // count window can never recover above the 43-attempt working baseline. Hard
  // 120/440k authority values never change.
  enqueue({ tenant: "tenant-aimd", operation: "op-aimd", owner: "worker-aimd" });
  enqueue({ tenant: "tenant-aimd-2", operation: "op-aimd-2", owner: "worker-aimd-2" });
  const aimdLease = claim({ tenant: "tenant-aimd", operation: "op-aimd", owner: "worker-aimd" });
  const aimdLease2 = claim({
    tenant: "tenant-aimd-2", operation: "op-aimd-2", owner: "worker-aimd-2"
  });
  settle({
    tenant: "tenant-aimd", operation: "op-aimd", owner: "worker-aimd",
    fence: aimdLease.lease_fence, outcome: "RATE_LIMITED", actualTokens: 0,
    result: { status: 429, retry_after_ms: 1000 }
  });
  assert.equal(sql(`select effective_max_active || ':' || effective_max_active_tokens
    from public.csm_thin_provider_scopes`), "21:220000");
  settle({
    tenant: "tenant-aimd-2", operation: "op-aimd-2", owner: "worker-aimd-2",
    fence: aimdLease2.lease_fence, outcome: "RATE_LIMITED", actualTokens: 0,
    result: { status: 429, retry_after_ms: 3000 }
  });
  assert.equal(sql(`select effective_max_active || ':' || effective_max_active_tokens
    from public.csm_thin_provider_scopes`), "21:220000",
  "a second in-flight 429 may extend cooldown but must not halve twice");
  enqueue({ tenant: "tenant-after-429", operation: "op-after-429", owner: "worker-after-429" });
  assert.equal(claim({
    tenant: "tenant-after-429", operation: "op-after-429", owner: "worker-after-429"
  }).code, "aimd_cooldown");
  sql(`update public.csm_thin_provider_scopes
    set aimd_cooldown_until = pg_catalog.clock_timestamp() - interval '1 second',
        aimd_last_increase_at = pg_catalog.clock_timestamp() - interval '2 seconds'`);
  const recoveryLease = claim({
    tenant: "tenant-after-429", operation: "op-after-429", owner: "worker-after-429"
  });
  settle({
    tenant: "tenant-after-429", operation: "op-after-429", owner: "worker-after-429",
    fence: recoveryLease.lease_fence, actualTokens: 100
  });
  assert.equal(sql(`select effective_max_active || ':' || effective_max_active_tokens
    from public.csm_thin_provider_scopes`), "22:231000");
  assert.equal(sql(`select max_active || ':' || max_active_tokens
    from public.csm_thin_provider_scopes`), "120:440000");

  // Cancel does not release a running provider call. Only its fenced settle
  // decrements the authoritative count/token counters.
  enqueue({ tenant: "tenant-cancel", operation: "op-cancel", owner: "worker-cancel" });
  const cancelLease = claim({ tenant: "tenant-cancel", operation: "op-cancel", owner: "worker-cancel" });
  const cancelled = cancel({ tenant: "tenant-cancel", operation: "op-cancel" });
  assert.equal(cancelled.operation_status, "CANCEL_REQUESTED");
  assert.equal(sql(`select active_count from public.csm_thin_provider_scopes`), "1");
  settle({
    tenant: "tenant-cancel", operation: "op-cancel", owner: "worker-cancel",
    fence: cancelLease.lease_fence, actualTokens: 100
  });
  assert.equal(sql(`select active_count from public.csm_thin_provider_scopes`), "0");
  assert.equal(sql(`select status from public.csm_thin_provider_operations
    where tenant_id = 'tenant-cancel' and operation_key = 'op-cancel'`), "CANCELLED");

  console.log("CSM provider admission PostgreSQL tests passed");
} finally {
  if (started) {
    try {
      command("pg_ctl", ["-D", dataDir, "-m", "immediate", "-w", "stop"], { capture: false });
    } catch {
      // Preserve the original assertion failure.
    }
  }
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(socketDir, { recursive: true, force: true });
}
