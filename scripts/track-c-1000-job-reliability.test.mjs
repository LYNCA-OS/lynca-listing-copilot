#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  planV4JobRetry,
  v4CanonicalJobStates,
  v4JobRetryPolicy
} from "../lib/listing/v4/jobs/job-retry-policy.mjs";

const terminalStates = new Set([
  v4CanonicalJobStates.SUCCESS,
  v4CanonicalJobStates.FAILED_FINAL
]);

function expectedFailures(jobNumber) {
  if (jobNumber % 23 === 0) return { permanent: true, count: 1 };
  if (jobNumber % 10 === 0) return { permanent: false, count: 4 };
  return { permanent: false, count: jobNumber % 4 };
}

function createJob(index) {
  return {
    id: `soak_job_${String(index).padStart(4, "0")}`,
    index,
    state: v4CanonicalJobStates.QUEUED,
    attemptCount: 0,
    readyAtSeconds: 0,
    terminalWrites: 0,
    retryDelays: [],
    transitions: [v4CanonicalJobStates.QUEUED],
    failurePlan: expectedFailures(index)
  };
}

function runScheduler(jobs) {
  let processedAttempts = 0;
  while ([...jobs.values()].some((job) => !terminalStates.has(job.state))) {
    const next = [...jobs.values()]
      .filter((job) => job.state === v4CanonicalJobStates.QUEUED)
      .sort((left, right) => left.readyAtSeconds - right.readyAtSeconds || left.id.localeCompare(right.id))[0];
    assert.ok(next, "every non-terminal job must remain schedulable");

    next.state = v4CanonicalJobStates.RUNNING;
    next.transitions.push(next.state);
    next.attemptCount += 1;
    processedAttempts += 1;

    const shouldFail = next.failurePlan.permanent
      ? next.attemptCount === 1
      : next.attemptCount <= next.failurePlan.count;
    if (!shouldFail) {
      next.state = v4CanonicalJobStates.SUCCESS;
      next.terminalWrites += 1;
      next.transitions.push(next.state);
      continue;
    }

    const plan = planV4JobRetry({
      attemptCount: next.attemptCount,
      maxAttempts: v4JobRetryPolicy.maxAttempts,
      error: next.failurePlan.permanent
        ? { code: "INVALID_PAYLOAD" }
        : { code: "PROVIDER_TIMEOUT" }
    });
    if (plan.shouldRetry) {
      next.state = v4CanonicalJobStates.RETRYABLE_FAILED;
      next.transitions.push(next.state);
      next.retryDelays.push(plan.retryDelaySeconds);
      next.readyAtSeconds += plan.retryDelaySeconds;
      next.state = v4CanonicalJobStates.QUEUED;
      next.transitions.push(next.state);
      continue;
    }

    next.state = v4CanonicalJobStates.FAILED_FINAL;
    next.terminalWrites += 1;
    next.transitions.push(next.state);
  }
  return processedAttempts;
}

const jobs = new Map(Array.from({ length: 1_000 }, (_, offset) => {
  const job = createJob(offset + 1);
  return [job.id, job];
}));
const processedAttempts = runScheduler(jobs);

assert.equal(jobs.size, 1_000);
assert.equal([...jobs.values()].filter((job) => terminalStates.has(job.state)).length, 1_000);
assert.ok([...jobs.values()].every((job) => job.terminalWrites === 1), "each job must have exactly one terminal write");
assert.ok([...jobs.values()].every((job) => job.attemptCount >= 1 && job.attemptCount <= 4));
assert.ok([...jobs.values()].every((job) => job.retryDelays.every((delay, index) => delay === [10, 30, 120][index])));
assert.ok(processedAttempts >= 1_000 && processedAttempts <= 4_000);

const failed = [...jobs.values()].filter((job) => job.state === v4CanonicalJobStates.FAILED_FINAL);
assert.ok(failed.length > 0, "the soak must exercise bounded final failure");
const rerun = failed[0];
rerun.state = v4CanonicalJobStates.QUEUED;
rerun.attemptCount = 0;
rerun.readyAtSeconds = 0;
rerun.terminalWrites = 0;
rerun.retryDelays = [];
rerun.transitions.push("MANUAL_RERUN", v4CanonicalJobStates.QUEUED);
rerun.failurePlan = { permanent: false, count: 0 };
runScheduler(new Map([[rerun.id, rerun]]));
assert.equal(rerun.state, v4CanonicalJobStates.SUCCESS);
assert.equal(rerun.attemptCount, 1);
assert.equal(rerun.terminalWrites, 1);

console.log(JSON.stringify({
  ok: true,
  scope: "deterministic_state_machine_and_scheduler_model",
  external_provider_calls: 0,
  jobs: jobs.size,
  processed_attempts: processedAttempts,
  successful: [...jobs.values()].filter((job) => job.state === v4CanonicalJobStates.SUCCESS).length,
  failed_final_before_manual_rerun: failed.length,
  retry_schedule_seconds: v4JobRetryPolicy.backoffSeconds,
  manual_rerun_verified: true
}, null, 2));
