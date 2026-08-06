#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createTenantTokenPool } from "../lib/listing/thin/tenant-token-pool.mjs";

const JOBS_PER_SEED = 4_000;
const TENANTS_PER_SEED = 40;
const PROVIDER_TOKEN_WINDOW = 440_000;
const PROVIDER_JOB_GUARD = 120;
const RETRY_TOKEN_FRACTION = 0.2;

function integerArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) throw new Error(`invalid_${name.slice(2)}`);
  return value;
}

function textArg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : String(process.argv[index + 1] || "").trim();
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function normal(random) {
  const first = Math.max(Number.EPSILON, random());
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * random());
}

function shuffledIndexes(length, random) {
  const values = Array.from({ length }, (_, index) => index);
  for (let index = length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [values[index], values[swap]] = [values[swap], values[index]];
  }
  return values;
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * fraction))];
}

function rounded(value, digits = 4) {
  return Number(Number(value).toFixed(digits));
}

function tenantPlan() {
  const tenants = [{ id: "tenant-00-whale", kind: "whale", jobs: 1_600, weight: 4 }];
  for (let index = 1; index <= 7; index += 1) {
    tenants.push({ id: `tenant-${String(index).padStart(2, "0")}-medium`, kind: "medium", jobs: 200, weight: 2 });
  }
  for (let index = 8; index < TENANTS_PER_SEED; index += 1) {
    tenants.push({
      id: `tenant-${String(index).padStart(2, "0")}-small`,
      kind: "small",
      jobs: index < 16 ? 32 : 31,
      weight: 1
    });
  }
  assert.equal(tenants.reduce((sum, tenant) => sum + tenant.jobs, 0), JOBS_PER_SEED);
  return tenants;
}

export function buildTenantTokenPoolStressJobs(seed) {
  const random = mulberry32(seed);
  const jobs = [];
  for (const tenant of tenantPlan()) {
    for (let index = 0; index < tenant.jobs; index += 1) {
      const tokenWeight = Math.max(1_200, Math.min(20_000, Math.round(
        5_262 * Math.exp((0.48 * normal(random)) - ((0.48 ** 2) / 2))
      )));
      jobs.push({
        tenantId: tenant.id,
        jobId: `seed-${seed}:job-${jobs.length}`,
        operationKey: `seed-${seed}:operation-${jobs.length}`,
        tokenWeight,
        serviceMs: Math.round(1_000 + (tokenWeight * 0.68) + (random() * 1_000))
      });
    }
  }
  const indexes = shuffledIndexes(jobs.length, random);
  const cancelled = new Set(indexes.slice(0, 40).map((index) => jobs[index].operationKey));
  const eligible = indexes.filter((index) => !cancelled.has(jobs[index].operationKey));
  const eligibleByTenant = new Map();
  for (const index of eligible) {
    const queue = eligibleByTenant.get(jobs[index].tenantId) || [];
    queue.push(jobs[index]);
    eligibleByTenant.set(jobs[index].tenantId, queue);
  }
  const transient503 = new Set();
  const rateLimited429 = new Set();
  for (const [tenantIndex, tenant] of tenantPlan().entries()) {
    const queue = eligibleByTenant.get(tenant.id);
    const failureCount = tenant.kind === "whale"
      ? 6
      : tenant.kind === "medium"
        ? 3
        : tenantIndex < 29 ? 2 : 1;
    for (const candidate of queue.splice(0, failureCount)) transient503.add(candidate.operationKey);
  }
  for (const tenantIndex of [0, 1, 8, 9]) {
    const candidate = eligibleByTenant.get(tenantPlan()[tenantIndex].id).shift();
    rateLimited429.add(candidate.operationKey);
  }
  assert.equal(transient503.size, 80);
  assert.equal(rateLimited429.size, 4);
  return { jobs, cancelled, transient503, rateLimited429 };
}

function tenantPolicies() {
  return Object.fromEntries(tenantPlan().map((tenant) => [tenant.id, { weight: tenant.weight }]));
}

async function flushMicrotasks(rounds = 16) {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

function eventGate() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function weightedFairnessSummary(dispatches, limit = 1_000) {
  const prefix = dispatches.slice(0, limit);
  const tokens = new Map();
  const attempts = new Map();
  const retries = new Map();
  for (const entry of prefix) {
    tokens.set(entry.tenantId, (tokens.get(entry.tenantId) || 0) + entry.tokenWeight);
    attempts.set(entry.tenantId, (attempts.get(entry.tenantId) || 0) + 1);
    if (entry.retry) retries.set(entry.tenantId, (retries.get(entry.tenantId) || 0) + 1);
  }
  const totalTokens = prefix.reduce((sum, entry) => sum + entry.tokenWeight, 0);
  const plan = tenantPlan();
  const totalPolicyWeight = plan.reduce((sum, tenant) => sum + tenant.weight, 0);
  const tenants = plan.map((tenant) => {
    const observed = (tokens.get(tenant.id) || 0) / totalTokens;
    const expected = tenant.weight / totalPolicyWeight;
    return {
      tenant_id: tenant.id,
      policy_weight: tenant.weight,
      attempts: attempts.get(tenant.id) || 0,
      retries: retries.get(tenant.id) || 0,
      observed,
      expected,
      error: Math.abs(observed - expected)
    };
  });
  const maximum = tenants.reduce((result, entry) => entry.error > result.error ? entry : result);
  return {
    maximum,
    meanError: tenants.reduce((sum, entry) => sum + entry.error, 0) / tenants.length,
    retryAttempts: prefix.filter(({ retry }) => retry).length,
    tenants
  };
}

async function measureCleanWeightedFairness(jobs, cancelled) {
  const dispatches = [];
  const pool = createTenantTokenPool({
    targetInflightTokens: PROVIDER_TOKEN_WINDOW,
    maximumInflightTokens: PROVIDER_TOKEN_WINDOW,
    maximumActiveJobs: PROVIDER_JOB_GUARD,
    tenantPolicies: tenantPolicies(),
    execute: async ({ tenantId, tokenWeight }) => {
      dispatches.push({ tenantId, tokenWeight, retry: false });
      await Promise.resolve();
    }
  });
  const promises = jobs.map((job) => pool.enqueue(job));
  const outcomes = promises.map((promise) => promise.catch((error) => error));
  for (const operationKey of cancelled) pool.cancelQueued(operationKey, "clean_shadow_cancellation");
  await Promise.all(outcomes);
  await pool.whenIdle();
  return weightedFairnessSummary(dispatches);
}

export async function runTenantTokenPoolStressSeed(seed) {
  const { jobs, cancelled, transient503, rateLimited429 } = buildTenantTokenPoolStressJobs(seed);
  const cleanFairness = await measureCleanWeightedFairness(jobs, cancelled);
  const jobsByOperation = new Map(jobs.map((job) => [job.operationKey, job]));
  let virtualNow = 0;
  let nextStableWindowAt = 10_000;
  let eventSequence = 0;
  let events = [];
  let externalActiveJobs = 0;
  let externalActiveTokens = 0;
  let maximumActiveJobs = 0;
  let maximumActiveTokens = 0;
  let maximumRetryTokens = 0;
  let workConservingChecks = 0;
  let workConservingViolations = 0;
  let antiStarvationReservationChecks = 0;
  let retryAdmissionShareViolations = 0;
  const capacityChanges = [];
  const attempts = new Map();
  const successfulOperations = new Set();
  const freshDispatches = [];
  const providerDispatches = [];
  const startedByTenant = new Map();
  const activeTokensByTenant = new Map();
  const fairnessTokenTime = new Map();
  let fairnessHorizonMs = null;
  const completionTimes = [];

  let pool;
  pool = createTenantTokenPool({
    targetInflightTokens: PROVIDER_TOKEN_WINDOW,
    maximumInflightTokens: PROVIDER_TOKEN_WINDOW,
    minimumInflightTokens: 110_000,
    maximumActiveJobs: PROVIDER_JOB_GUARD,
    tenantPolicies: tenantPolicies(),
    retryTokenFraction: RETRY_TOKEN_FRACTION,
    maxFreshBeforeRetry: 8,
    maxAttempts: 3,
    aimdDecreaseFactor: 0.5,
    aimdIncreaseTokens: 22_000,
    aimdDecreaseCooldownMs: 5_000,
    now: () => virtualNow,
    retryDelayMs: () => 0,
    sleep: async () => {},
    onCapacityChange: (change) => capacityChanges.push({ at_ms: virtualNow, ...change }),
    execute: ({ tenantId, jobId, operationKey, tokenWeight, attempt, retry }) => {
      const pending = eventGate();
      attempts.set(operationKey, (attempts.get(operationKey) || 0) + 1);
      startedByTenant.set(tenantId, (startedByTenant.get(tenantId) || 0) + (retry ? 0 : 1));
      providerDispatches.push({ tenantId, tokenWeight, retry });
      if (!retry) freshDispatches.push({ tenantId, tokenWeight });
      externalActiveJobs += 1;
      externalActiveTokens += tokenWeight;
      activeTokensByTenant.set(tenantId, (activeTokensByTenant.get(tenantId) || 0) + tokenWeight);
      maximumActiveJobs = Math.max(maximumActiveJobs, externalActiveJobs);
      maximumActiveTokens = Math.max(maximumActiveTokens, externalActiveTokens);

      const snapshot = pool.snapshot();
      assert.equal(snapshot.provider_window_active_jobs <= PROVIDER_JOB_GUARD, true);
      assert.equal(snapshot.provider_window_active_tokens <= PROVIDER_TOKEN_WINDOW, true);
      if (retry) {
        maximumRetryTokens = Math.max(maximumRetryTokens, snapshot.active_retry_tokens);
        const retryLimit = Math.max(
          Math.floor(snapshot.provider_window_target_tokens * RETRY_TOKEN_FRACTION),
          tokenWeight
        );
        if (snapshot.active_retry_tokens > retryLimit) retryAdmissionShareViolations += 1;
      }

      events.push({
        at: virtualNow + jobsByOperation.get(operationKey).serviceMs,
        sequence: eventSequence++,
        tenantId,
        jobId,
        operationKey,
        tokenWeight,
        attempt,
        pending
      });
      return pending.promise;
    }
  });

  const promises = jobs.map((job) => pool.enqueue(job));
  const outcomes = promises.map((promise, index) => promise.then(
    () => ({ status: "completed", operationKey: jobs[index].operationKey, at: virtualNow }),
    (error) => ({ status: error?.code === "TENANT_TOKEN_JOB_CANCELLED" ? "cancelled" : "failed", error, operationKey: jobs[index].operationKey, at: virtualNow })
  ));
  assert.deepEqual(
    {
      admitted: pool.snapshot().global_admitted_operations,
      backlog: pool.snapshot().global_backlog_jobs,
      active: pool.snapshot().provider_window_active_jobs
    },
    { admitted: JOBS_PER_SEED, backlog: JOBS_PER_SEED, active: 0 }
  );

  for (const job of jobs.slice(0, 100)) assert.equal(pool.enqueue(job), promises[jobs.indexOf(job)]);
  assert.equal(
    pool.enqueue({ ...jobs[0], jobId: `${jobs[0].jobId}:alias` }),
    promises[0]
  );
  assert.equal(pool.snapshot().global_admitted_operations, JOBS_PER_SEED);

  for (const operationKey of cancelled) {
    assert.equal(pool.cancelQueued(operationKey, "stress_injected_cancellation"), true);
  }

  function checkWorkConservation() {
    const snapshot = pool.snapshot();
    if (snapshot.queued_fresh_jobs === 0) return;
    workConservingChecks += 1;
    if (snapshot.provider_window_reserved_head_jobs > 0) {
      antiStarvationReservationChecks += 1;
      return;
    }
    const available = snapshot.provider_window_target_tokens - snapshot.provider_window_active_tokens;
    if (
      snapshot.provider_window_active_jobs < PROVIDER_JOB_GUARD
      && snapshot.provider_window_minimum_fresh_head_tokens <= available
    ) workConservingViolations += 1;
  }

  await flushMicrotasks();
  checkWorkConservation();
  while (pool.snapshot().completed + pool.snapshot().failed + pool.snapshot().cancelled < JOBS_PER_SEED) {
    if (events.length === 0) {
      await flushMicrotasks();
      assert.notEqual(events.length, 0, `seed_${seed}_stalled_without_provider_event`);
    }
    events.sort((a, b) => a.at - b.at || a.sequence - b.sequence);
    const nextAt = events[0].at;
    const completing = events.filter((event) => event.at === nextAt);
    events = events.filter((event) => event.at !== nextAt);
    if (fairnessHorizonMs === null) {
      const elapsed = nextAt - virtualNow;
      for (const [tenantId, tokens] of activeTokensByTenant) {
        fairnessTokenTime.set(tenantId, (fairnessTokenTime.get(tenantId) || 0) + (tokens * elapsed));
      }
    }
    virtualNow = nextAt;
    while (virtualNow >= nextStableWindowAt) {
      pool.reportStableWindow();
      nextStableWindowAt += 10_000;
    }
    for (const event of completing) {
      externalActiveJobs -= 1;
      externalActiveTokens -= event.tokenWeight;
      activeTokensByTenant.set(
        event.tenantId,
        (activeTokensByTenant.get(event.tenantId) || 0) - event.tokenWeight
      );
      if (event.attempt === 1 && rateLimited429.has(event.operationKey)) {
        event.pending.reject(Object.assign(new Error("stress_429"), { status: 429 }));
      } else if (event.attempt === 1 && transient503.has(event.operationKey)) {
        event.pending.reject(Object.assign(new Error("stress_503"), { status: 503 }));
      } else {
        successfulOperations.add(event.operationKey);
        event.pending.resolve({ operation_key: event.operationKey });
      }
    }
    await flushMicrotasks();
    if (fairnessHorizonMs === null && freshDispatches.length >= 1_000) fairnessHorizonMs = virtualNow;
    checkWorkConservation();
  }

  const settled = await Promise.all(outcomes);
  await pool.whenIdle();
  const completed = settled.filter(({ status }) => status === "completed");
  const cancelledOutcomes = settled.filter(({ status }) => status === "cancelled");
  const failed = settled.filter(({ status }) => status === "failed");
  for (const outcome of completed) completionTimes.push(outcome.at);
  const expectedAttemptCount = JOBS_PER_SEED - cancelled.size + transient503.size + rateLimited429.size;
  const actualAttemptCount = [...attempts.values()].reduce((sum, count) => sum + count, 0);

  assert.equal(completed.length, JOBS_PER_SEED - cancelled.size);
  assert.equal(cancelledOutcomes.length, cancelled.size);
  assert.equal(failed.length, 0);
  assert.equal(successfulOperations.size, completed.length, "each non-cancelled operation must succeed once");
  assert.equal(actualAttemptCount, expectedAttemptCount, "only injected transient failures may add an attempt");
  assert.equal(maximumActiveJobs <= PROVIDER_JOB_GUARD, true);
  assert.equal(maximumActiveTokens <= PROVIDER_TOKEN_WINDOW, true);
  assert.equal(workConservingViolations, 0);
  assert.equal(retryAdmissionShareViolations, 0);
  assert.equal(startedByTenant.size, TENANTS_PER_SEED, "every tenant must receive provider service");

  assert.notEqual(fairnessHorizonMs, null);
  const totalFairnessTokenTime = [...fairnessTokenTime.values()].reduce((sum, value) => sum + value, 0);
  const plan = tenantPlan();
  const totalPolicyWeight = plan.reduce((sum, tenant) => sum + tenant.weight, 0);
  const occupancyShareErrors = plan.map((tenant) => {
    const observed = (fairnessTokenTime.get(tenant.id) || 0) / totalFairnessTokenTime;
    const expected = tenant.weight / totalPolicyWeight;
    return { tenant_id: tenant.id, observed, expected, error: Math.abs(observed - expected) };
  });
  const occupancyFairnessMax = occupancyShareErrors.reduce((maximum, entry) => entry.error > maximum.error ? entry : maximum);
  const faultPathFairness = weightedFairnessSummary(providerDispatches);
  assert.equal(
    cleanFairness.maximum.error <= 0.01,
    true,
    `seed_${seed}_clean_weighted_fairness_error:${JSON.stringify(cleanFairness.maximum)}`
  );
  assert.equal(
    faultPathFairness.maximum.error <= RETRY_TOKEN_FRACTION,
    true,
    `seed_${seed}_fault_path_fairness_exceeded_retry_share:${JSON.stringify(faultPathFairness.maximum)}`
  );

  const finalBorrowWindow = freshDispatches.slice(-100);
  const finalBorrowTenants = new Set(finalBorrowWindow.map(({ tenantId }) => tenantId));
  const whaleTailShare = finalBorrowWindow.filter(({ tenantId }) => tenantId === "tenant-00-whale").length / 100;
  assert.equal(finalBorrowTenants.size < TENANTS_PER_SEED, true, `seed_${seed}_idle_borrow_missing:${finalBorrowTenants.size}`);

  const tokenWeights = jobs.map(({ tokenWeight }) => tokenWeight);
  return {
    seed,
    admitted_operations: JOBS_PER_SEED,
    completed_operations: completed.length,
    cancelled_operations: cancelledOutcomes.length,
    failed_operations: failed.length,
    duplicate_successful_operations: completed.length - successfulOperations.size,
    provider_attempts: actualAttemptCount,
    injected_503_operations: transient503.size,
    injected_429_operations: rateLimited429.size,
    maximum_active_jobs: maximumActiveJobs,
    maximum_active_tokens: maximumActiveTokens,
    maximum_retry_tokens: maximumRetryTokens,
    work_conserving_checks: workConservingChecks,
    work_conserving_violations: workConservingViolations,
    anti_starvation_reservation_checks: antiStarvationReservationChecks,
    retry_admission_share_violations: retryAdmissionShareViolations,
    served_tenants: startedByTenant.size,
    weighted_fairness_max_error_pp: rounded(cleanFairness.maximum.error * 100),
    weighted_fairness_mean_error_pp: rounded(cleanFairness.meanError * 100),
    weighted_fairness_horizon_ms: fairnessHorizonMs,
    weighted_fairness_prefix_retry_attempts: 0,
    weighted_fairness_max_error_tenant: {
      tenant_id: cleanFairness.maximum.tenant_id,
      observed_share: rounded(cleanFairness.maximum.observed),
      expected_share: rounded(cleanFairness.maximum.expected)
    },
    weighted_fairness_prefix_by_tenant: cleanFairness.tenants.map((tenant) => ({
      tenant_id: tenant.tenant_id,
      policy_weight: tenant.policy_weight,
      attempts: tenant.attempts,
      retries: tenant.retries,
      token_share: rounded(tenant.observed)
    })),
    fault_path_weighted_fairness_max_error_pp: rounded(faultPathFairness.maximum.error * 100),
    fault_path_weighted_fairness_prefix_retry_attempts: faultPathFairness.retryAttempts,
    weighted_occupancy_max_error_pp: rounded(occupancyFairnessMax.error * 100),
    final_borrow_window_tenants: finalBorrowTenants.size,
    whale_tail_borrow_share: rounded(whaleTailShare),
    drain_ms: virtualNow,
    completion_time_ms: {
      p50: percentile(completionTimes, 0.5),
      p95: percentile(completionTimes, 0.95),
      p99: percentile(completionTimes, 0.99)
    },
    token_weight: {
      mean: rounded(tokenWeights.reduce((sum, value) => sum + value, 0) / tokenWeights.length, 2),
      p50: percentile(tokenWeights, 0.5),
      p95: percentile(tokenWeights, 0.95),
      maximum: Math.max(...tokenWeights)
    },
    aimd: {
      capacity_change_count: capacityChanges.length,
      rate_limit_decrease_count: capacityChanges.filter(({ reason }) => reason === "rate_limit").length,
      minimum_target_tokens: Math.min(PROVIDER_TOKEN_WINDOW, ...capacityChanges.map(({ targetTokens }) => targetTokens)),
      final_target_tokens: pool.snapshot().provider_window_target_tokens
    }
  };
}

export async function runTenantTokenPoolStress({ seedCount = 50, firstSeed = 20_260_801 } = {}) {
  const seeds = [];
  for (let index = 0; index < seedCount; index += 1) {
    seeds.push(await runTenantTokenPoolStressSeed(firstSeed + index));
  }
  const drains = seeds.map(({ drain_ms }) => drain_ms);
  const fairnessErrors = seeds.map(({ weighted_fairness_max_error_pp }) => weighted_fairness_max_error_pp);
  const faultPathFairnessErrors = seeds.map(({ fault_path_weighted_fairness_max_error_pp }) => fault_path_weighted_fairness_max_error_pp);
  return {
    schema_version: "tenant-token-pool-stress-v1",
    evidence_boundary: "Deterministic offline scheduler stress only; no network, provider, accuracy, or hosted-capacity claim.",
    configuration: {
      seed_count: seedCount,
      first_seed: firstSeed,
      tenants_per_seed: TENANTS_PER_SEED,
      jobs_per_seed: JOBS_PER_SEED,
      total_admitted_operations: seedCount * JOBS_PER_SEED,
      tenant_mix: { whale: 1, medium: 7, small: 32 },
      provider_execution_window: {
        maximum_active_jobs: PROVIDER_JOB_GUARD,
        initial_and_maximum_tokens: PROVIDER_TOKEN_WINDOW,
        approximate_jobs_at_5262_tokens: Math.floor(PROVIDER_TOKEN_WINDOW / 5_262)
      },
      injected_per_seed: { queued_cancellations: 40, transient_503: 80, rate_limit_429: 4 }
    },
    acceptance: {
      terminal_accounting_exact: seeds.every((seed) => seed.completed_operations + seed.cancelled_operations === JOBS_PER_SEED),
      duplicate_successful_operations: seeds.reduce((sum, seed) => sum + seed.duplicate_successful_operations, 0),
      provider_job_bound_violations: seeds.filter((seed) => seed.maximum_active_jobs > PROVIDER_JOB_GUARD).length,
      provider_token_bound_violations: seeds.filter((seed) => seed.maximum_active_tokens > PROVIDER_TOKEN_WINDOW).length,
      work_conserving_violations: seeds.reduce((sum, seed) => sum + seed.work_conserving_violations, 0),
      retry_admission_share_violations: seeds.reduce((sum, seed) => sum + seed.retry_admission_share_violations, 0),
      starvation_seeds: seeds.filter((seed) => seed.served_tenants !== TENANTS_PER_SEED).length,
      idle_borrow_seeds_with_all_40_tenants_in_final_window: seeds.filter((seed) => seed.final_borrow_window_tenants === TENANTS_PER_SEED).length,
      weighted_fairness_max_error_pp: rounded(Math.max(...fairnessErrors)),
      fault_path_weighted_fairness_max_error_pp: rounded(Math.max(...faultPathFairnessErrors)),
      fault_path_fairness_within_retry_share_bound: faultPathFairnessErrors.every((error) => error <= RETRY_TOKEN_FRACTION * 100)
    },
    aggregate: {
      completed_operations: seeds.reduce((sum, seed) => sum + seed.completed_operations, 0),
      cancelled_operations: seeds.reduce((sum, seed) => sum + seed.cancelled_operations, 0),
      provider_attempts: seeds.reduce((sum, seed) => sum + seed.provider_attempts, 0),
      maximum_active_jobs: Math.max(...seeds.map((seed) => seed.maximum_active_jobs)),
      maximum_active_tokens: Math.max(...seeds.map((seed) => seed.maximum_active_tokens)),
      maximum_retry_tokens: Math.max(...seeds.map((seed) => seed.maximum_retry_tokens)),
      work_conserving_checks: seeds.reduce((sum, seed) => sum + seed.work_conserving_checks, 0),
      anti_starvation_reservation_checks: seeds.reduce((sum, seed) => sum + seed.anti_starvation_reservation_checks, 0),
      weighted_occupancy_max_error_pp: rounded(Math.max(...seeds.map((seed) => seed.weighted_occupancy_max_error_pp))),
      maximum_final_borrow_window_tenants: Math.max(...seeds.map((seed) => seed.final_borrow_window_tenants)),
      mean_token_weight: rounded(seeds.reduce((sum, seed) => sum + seed.token_weight.mean, 0) / seeds.length, 2),
      maximum_p95_token_weight: Math.max(...seeds.map((seed) => seed.token_weight.p95)),
      maximum_token_weight: Math.max(...seeds.map((seed) => seed.token_weight.maximum)),
      aimd_rate_limit_decreases: seeds.reduce((sum, seed) => sum + seed.aimd.rate_limit_decrease_count, 0),
      minimum_aimd_target_tokens: Math.min(...seeds.map((seed) => seed.aimd.minimum_target_tokens))
    },
    drain_time_ms_across_seeds: {
      minimum: Math.min(...drains),
      p50: percentile(drains, 0.5),
      p95: percentile(drains, 0.95),
      maximum: Math.max(...drains)
    },
    seeds
  };
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const seedCount = integerArg("--seeds", 50);
  const firstSeed = integerArg("--first-seed", 20_260_801);
  const outputPath = resolve(textArg(
    "--out",
    "artifacts/tenant-token-pool-stress-2026-08-01.json"
  ));
  const report = await runTenantTokenPoolStress({ seedCount, firstSeed });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });
  process.stdout.write(`${JSON.stringify({ output: outputPath, ...report.acceptance, drain_time_ms_across_seeds: report.drain_time_ms_across_seeds }, null, 2)}\n`);
}
