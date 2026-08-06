#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createTenantTokenPool } from "../lib/listing/thin/tenant-token-pool.mjs";

const source = await readFile(
  new URL("../lib/listing/thin/tenant-token-pool.mjs", import.meta.url),
  "utf8"
);
assert.doesNotMatch(
  source,
  /(?:listing-job|provider-status|cloud\s*run|recognition-worker|vector|ocr)/i,
  "the capacity primitive must not depend on a legacy execution path"
);

function job(tenantId, id, tokenWeight = 1, operationKey = `operation:${tenantId}:${id}`) {
  return { tenantId, jobId: `job:${tenantId}:${id}`, operationKey, tokenWeight, payload: { id } };
}

function gate() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

const turn = () => new Promise((resolve) => setImmediate(resolve));

// Admission must come from an explicit measurement or an external derivation;
// there is no inherited provider concurrency constant.
assert.throws(
  () => createTenantTokenPool({ execute: async () => ({ ok: true }) }),
  /invalid_target_inflight_tokens/
);
{
  let derivations = 0;
  const pool = createTenantTokenPool({
    deriveTargetInflightTokens: () => {
      derivations += 1;
      return 12;
    },
    execute: async () => ({ ok: true })
  });
  assert.equal(derivations, 1);
  assert.equal(pool.snapshot().target_inflight_tokens, 12);
}

// Token packing is work-conserving, an idle tenant's share is borrowed, and an
// optional per-tenant active cap remains authoritative.
{
  const releases = new Map();
  const running = new Set();
  let activeTokens = 0;
  let maximumTokens = 0;
  const pool = createTenantTokenPool({
    targetInflightTokens: 12,
    maximumActiveJobs: 10,
    tenantPolicies: {
      a: { weight: 1, maxActiveJobs: 1 },
      b: { weight: 1 }
    },
    execute: async ({ jobId, tokenWeight }) => {
      const pending = gate();
      releases.set(jobId, pending.release);
      running.add(jobId);
      activeTokens += tokenWeight;
      maximumTokens = Math.max(maximumTokens, activeTokens);
      await pending.promise;
      activeTokens -= tokenWeight;
      running.delete(jobId);
      return jobId;
    }
  });
  const inputs = [job("a", 1, 4), job("a", 2, 4), ...Array.from({ length: 4 }, (_, i) => job("b", i, 2))];
  const promises = inputs.map((input) => pool.enqueue(input));
  await turn();
  assert.equal(pool.snapshot().active_tokens, 12, "all packable token capacity must be used");
  assert.equal(pool.snapshot().active_jobs, 5);
  assert.equal([...running].filter((id) => id.startsWith("job:a:")).length, 1, "tenant cap must hold");
  assert.equal([...running].filter((id) => id.startsWith("job:b:")).length, 4, "tenant B borrows idle capacity");
  for (const release of [...releases.values()]) release();
  await turn();
  releases.get("job:a:2")?.();
  await Promise.all(promises);
  await pool.whenIdle();
  assert.equal(maximumTokens, 12);
}

// Cancellation only affects queued work. Both job and operation aliases are
// stable dedupe identities and never spend a second execution.
{
  const firstGate = gate();
  let calls = 0;
  const pool = createTenantTokenPool({
    targetInflightTokens: 1,
    maximumInflightTokens: 2,
    maximumActiveJobs: 1,
    execute: async ({ jobId }) => {
      calls += 1;
      if (jobId === "job:a:first") await firstGate.promise;
      return jobId;
    }
  });
  const first = pool.enqueue(job("a", "first"));
  const queuedInput = job("a", "queued");
  const queued = pool.enqueue(queuedInput);
  const queuedRejection = assert.rejects(
    queued,
    (error) => error.code === "TENANT_TOKEN_JOB_CANCELLED"
  );
  await turn();
  assert.equal(pool.cancelQueued(queuedInput.operationKey), true);
  assert.equal(pool.enqueue(queuedInput), queued, "job duplicate must return the settled operation promise");
  assert.equal(
    pool.enqueue({ ...queuedInput, jobId: "job:a:queued-alias" }),
    queued,
    "operation duplicate must return the same promise"
  );
  assert.equal(pool.cancelQueued("job:a:first"), false, "running work is not a queued cancellation");
  await queuedRejection;
  firstGate.release();
  await first;
  await pool.whenIdle();
  assert.equal(calls, 1);
  assert.throws(
    () => pool.enqueue({ ...queuedInput, tokenWeight: 2 }),
    (error) => error.code === "TENANT_TOKEN_JOB_CONFLICT"
  );
  assert.throws(
    () => pool.enqueue({ ...queuedInput, jobId: "job:a:conflict", tokenWeight: 2 }),
    (error) => error.code === "TENANT_TOKEN_OPERATION_CONFLICT"
  );
}

// A 429 performs one AIMD decrease per cooldown window. Its retry is automatic,
// bounded, and lower priority than fresh work without being starved.
{
  let clock = 10_000;
  const order = [];
  const capacityChanges = [];
  const pool = createTenantTokenPool({
    targetInflightTokens: 4,
    maximumInflightTokens: 8,
    minimumInflightTokens: 1,
    aimdIncreaseTokens: 1,
    aimdDecreaseCooldownMs: 1_000,
    now: () => clock,
    maximumActiveJobs: 1,
    maxFreshBeforeRetry: 3,
    retryDelayMs: () => 0,
    sleep: async () => {},
    onCapacityChange: (event) => capacityChanges.push(event),
    execute: async ({ jobId, attempt }) => {
      order.push(`${jobId}:${attempt}`);
      if (jobId === "job:a:retry" && attempt === 1) throw Object.assign(new Error("busy"), { status: 429 });
      return jobId;
    }
  });
  const promises = ["retry", "fresh-1", "fresh-2", "fresh-3"].map((id) => pool.enqueue(job("a", id)));
  await Promise.all(promises);
  assert.deepEqual(order, [
    "job:a:retry:1",
    "job:a:fresh-1:1",
    "job:a:fresh-2:1",
    "job:a:retry:2",
    "job:a:fresh-3:1"
  ]);
  assert.equal(pool.snapshot().target_inflight_tokens, 2);
  assert.equal(capacityChanges.filter(({ reason }) => reason === "rate_limit").length, 1);
  pool.reportRateLimit();
  assert.equal(pool.snapshot().target_inflight_tokens, 2, "same-window 429s must coalesce");
  clock += 1_000;
  pool.reportStableWindow();
  assert.equal(pool.snapshot().target_inflight_tokens, 3);
}

{
  let calls = 0;
  const pool = createTenantTokenPool({
    targetInflightTokens: 2,
    maximumActiveJobs: 1,
    maxAttempts: 3,
    retryDelayMs: () => 0,
    sleep: async () => {},
    execute: async () => {
      calls += 1;
      throw Object.assign(new Error("still busy"), { status: 503 });
    }
  });
  await assert.rejects(pool.enqueue(job("a", "bounded-retry")), /still busy/);
  assert.equal(calls, 3, "a transient failure must have a finite amplification factor");
  await pool.whenIdle();
}

// Counterexample: a fragmented 10-token window used to deep-scan past a
// 10-token fair head and run all 200 later 1-token packets first. Tenant-head
// WFQ plus bounded reservation must stop that stream and let the head run as
// soon as the blocker releases.
{
  const blocker = gate();
  const dispatches = [];
  const pool = createTenantTokenPool({
    targetInflightTokens: 10,
    maximumActiveJobs: 10,
    maximumHeadBypasses: 8,
    tenantPolicies: {
      blocker: { weight: 1 },
      large: { weight: 1 },
      small: { weight: 1 }
    },
    execute: async ({ jobId }) => {
      dispatches.push(jobId);
      if (jobId === "job:blocker:hold") await blocker.promise;
      return jobId;
    }
  });
  const promises = [pool.enqueue(job("blocker", "hold", 1))];
  await turn();
  promises.push(pool.enqueue(job("large", "head-10", 10)));
  for (let index = 0; index < 200; index += 1) {
    promises.push(pool.enqueue(job("small", index, 1)));
  }
  await turn();
  await turn();
  assert.equal(dispatches.includes("job:large:head-10"), false);
  assert.equal(
    dispatches.filter((id) => id.startsWith("job:small:")).length <= 20,
    true,
    "reservation must prevent all 200 small packets bypassing the fair head"
  );
  blocker.release();
  await turn();
  assert.equal(dispatches.includes("job:large:head-10"), true);
  await Promise.all(promises);
  await pool.whenIdle();
  assert.equal(
    dispatches.indexOf("job:large:head-10") < dispatches.indexOf("job:small:199"),
    true
  );
}

// A fully idle boundary starts a new virtual epoch. Historical service from
// the prior epoch must not let a newly created tenant consume ten turns before
// an existing equal-weight tenant receives service.
{
  const secondEpoch = [];
  let epoch = 1;
  const pool = createTenantTokenPool({
    targetInflightTokens: 1,
    maximumActiveJobs: 1,
    tenantPolicies: { established: { weight: 1 } },
    execute: async ({ tenantId, jobId }) => {
      if (epoch === 2) secondEpoch.push(tenantId);
      return jobId;
    }
  });
  await Promise.all(Array.from({ length: 20 }, (_, index) => (
    pool.enqueue(job("established", `history-${index}`))
  )));
  await pool.whenIdle();
  epoch = 2;
  const promises = [];
  for (let index = 0; index < 10; index += 1) promises.push(pool.enqueue(job("new", `new-${index}`)));
  for (let index = 0; index < 10; index += 1) promises.push(pool.enqueue(job("established", `next-${index}`)));
  await Promise.all(promises);
  assert.equal(secondEpoch.slice(0, 10).filter((tenant) => tenant === "new").length, 5);
  assert.equal(secondEpoch.some((tenant, index) => tenant === secondEpoch[index - 1]), false);
}

// Retry share protects fresh backlog, not empty air. Once no fresh packet is
// queued, five 2-token retries may borrow the full 10-token provider window.
{
  const releases = [];
  const attempts = new Map();
  const pool = createTenantTokenPool({
    targetInflightTokens: 10,
    maximumActiveJobs: 10,
    retryTokenFraction: 0.2,
    maxFreshBeforeRetry: 1,
    maxAttempts: 2,
    retryDelayMs: () => 0,
    sleep: async () => {},
    execute: async ({ operationKey, attempt }) => {
      attempts.set(operationKey, attempt);
      if (attempt === 1) throw Object.assign(new Error("retry me"), { status: 503 });
      const pending = gate();
      releases.push(pending.release);
      await pending.promise;
      return operationKey;
    }
  });
  const promises = Array.from({ length: 5 }, (_, index) => pool.enqueue(job("retry", index, 2)));
  for (let index = 0; index < 8; index += 1) await turn();
  assert.equal(pool.snapshot().queued_fresh_jobs, 0);
  assert.equal(pool.snapshot().active_retry_jobs, 5);
  assert.equal(pool.snapshot().active_retry_tokens, 10);
  for (const release of releases) release();
  await Promise.all(promises);
  await pool.whenIdle();
  assert.equal([...attempts.values()].every((attempt) => attempt === 2), true);
}

// Deterministic 4,000-job simulation. All operations enter the global backlog,
// while only the much smaller provider window executes. Fairness is measured
// in admitted tokens, not request counts; after B empties, A borrows the window.
{
  const dispatches = [];
  const executions = new Map();
  let activeJobs = 0;
  let activeTokens = 0;
  let maximumJobs = 0;
  let maximumTokens = 0;
  const pool = createTenantTokenPool({
    targetInflightTokens: 300,
    maximumActiveJobs: 100,
    tenantPolicies: {
      a: { weight: 1 },
      b: { weight: 3 }
    },
    execute: async ({ tenantId, jobId, tokenWeight, operationKey }) => {
      activeJobs += 1;
      activeTokens += tokenWeight;
      maximumJobs = Math.max(maximumJobs, activeJobs);
      maximumTokens = Math.max(maximumTokens, activeTokens);
      dispatches.push({ tenantId, tokenWeight });
      executions.set(operationKey, (executions.get(operationKey) || 0) + 1);
      await new Promise((resolve) => queueMicrotask(resolve));
      activeJobs -= 1;
      activeTokens -= tokenWeight;
      return jobId;
    }
  });

  const inputs = [];
  for (let index = 0; index < 2_400; index += 1) {
    if (index < 1_600) inputs.push(job("a", index, (index % 5) + 1));
    inputs.push(job("b", index, (index % 5) + 1));
  }
  assert.equal(inputs.length, 4_000);
  const promises = inputs.map((input) => pool.enqueue(input));
  for (let index = 0; index < 50; index += 1) {
    assert.equal(pool.enqueue(inputs[index]), promises[index], "duplicate intake must share the original promise");
  }
  assert.equal(
    pool.enqueue({ ...inputs[0], jobId: "job:a:operation-alias" }),
    promises[0],
    "a second job alias for the same operation must not execute"
  );
  assert.deepEqual(
    {
      admitted: pool.snapshot().global_admitted_operations,
      backlog: pool.snapshot().global_backlog_jobs,
      active: pool.snapshot().provider_window_active_jobs
    },
    { admitted: 4_000, backlog: 4_000, active: 0 },
    "global admission must retain all 4,000 jobs before the provider window drains"
  );
  await Promise.all(promises);
  await pool.whenIdle();

  assert.equal(dispatches.length, 4_000);
  assert.equal(executions.size, 4_000);
  assert.equal([...executions.values()].every((count) => count === 1), true, "no operation may execute twice");
  assert.equal(maximumJobs <= 100, true);
  assert.equal(maximumTokens <= 300, true);
  assert.equal(maximumJobs, 100, "the provider window should reach its configured job guard");
  assert.equal(maximumTokens, 300, "the provider window should conserve all packable token capacity");

  let prefixATokens = 0;
  let prefixBTokens = 0;
  for (const entry of dispatches.slice(0, 2_000)) {
    if (entry.tenantId === "a") prefixATokens += entry.tokenWeight;
    else prefixBTokens += entry.tokenWeight;
  }
  const fairRatio = prefixBTokens / prefixATokens;
  assert.equal(fairRatio > 2.8 && fairRatio < 3.2, true, `weighted token ratio drifted: ${fairRatio}`);
  const lastB = dispatches.findLastIndex(({ tenantId }) => tenantId === "b");
  assert.equal(lastB < dispatches.length - 100, true, "tenant A should borrow capacity after B empties");
  assert.equal(dispatches.slice(lastB + 1).every(({ tenantId }) => tenantId === "a"), true);
  assert.deepEqual(pool.snapshot(), {
    global_admitted_operations: 4_000,
    global_backlog_jobs: 0,
    provider_window_target_tokens: 300,
    provider_window_max_active_jobs: 100,
    provider_window_active_jobs: 0,
    provider_window_active_tokens: 0,
    provider_window_reserved_head_jobs: 0,
    provider_window_reserved_head_tokens: 0,
    provider_window_minimum_fresh_head_tokens: null,
    target_inflight_tokens: 300,
    maximum_inflight_tokens: 300,
    active_jobs: 0,
    active_tokens: 0,
    active_retry_jobs: 0,
    active_retry_tokens: 0,
    queued_jobs: 0,
    queued_fresh_jobs: 0,
    queued_retry_jobs: 0,
    waiting_retries: 0,
    tenants: 2,
    operations: 4_000,
    completed: 4_000,
    failed: 0,
    cancelled: 0
  });
}

process.stdout.write("tenant token pool: ok\n");
