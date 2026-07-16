#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canonicalV4JobState,
  classifyV4JobError,
  planV4JobRetry,
  retryDelaySecondsForAttempt,
  v4CanonicalJobStates,
  v4JobRetryPolicy,
  withCanonicalV4JobState
} from "../lib/listing/v4/jobs/job-retry-policy.mjs";

assert.deepEqual(v4JobRetryPolicy, {
  maxRetries: 3,
  maxAttempts: 4,
  backoffSeconds: [10, 30, 120]
});
assert.equal(retryDelaySecondsForAttempt(1), 10);
assert.equal(retryDelaySecondsForAttempt(2), 30);
assert.equal(retryDelaySecondsForAttempt(3), 120);
assert.equal(retryDelaySecondsForAttempt(4), null);

assert.equal(canonicalV4JobState("QUEUED"), v4CanonicalJobStates.QUEUED);
assert.equal(canonicalV4JobState("RUNNING"), v4CanonicalJobStates.RUNNING);
assert.equal(canonicalV4JobState("L1_READY"), v4CanonicalJobStates.SUCCESS);
assert.equal(canonicalV4JobState("L2_READY"), v4CanonicalJobStates.SUCCESS);
assert.equal(canonicalV4JobState("RETRYING"), v4CanonicalJobStates.RETRYABLE_FAILED);
assert.equal(canonicalV4JobState("FAILED"), v4CanonicalJobStates.FAILED_FINAL);
assert.equal(canonicalV4JobState("CANCELLED"), v4CanonicalJobStates.FAILED_FINAL);
assert.deepEqual(withCanonicalV4JobState({ id: "job-1", status: "RETRYING" }), {
  id: "job-1",
  status: "RETRYING",
  canonical_state: "RETRYABLE_FAILED"
});

assert.equal(classifyV4JobError({ code: "HTTP_429" }).retryable, true);
assert.equal(classifyV4JobError({ http_status: 503 }).retryable, true);
assert.equal(classifyV4JobError({ code: "INVALID_PAYLOAD" }).retryable, false);
assert.equal(classifyV4JobError({ http_status: 422 }).retryable, false);
assert.equal(classifyV4JobError({ message: "provider timed out" }).retryable, true);
assert.equal(
  classifyV4JobError({ code: "INVALID_PAYLOAD", retryable: true }).retryable,
  true,
  "an explicit upstream classification must take precedence"
);

for (const [attemptCount, retryDelaySeconds] of [[1, 10], [2, 30], [3, 120]]) {
  const plan = planV4JobRetry({
    attemptCount,
    maxAttempts: 4,
    error: { code: "PROVIDER_TIMEOUT" }
  });
  assert.equal(plan.shouldRetry, true);
  assert.equal(plan.retryDelaySeconds, retryDelaySeconds);
  assert.equal(plan.finalFailure, false);
}
assert.equal(planV4JobRetry({
  attemptCount: 4,
  maxAttempts: 4,
  error: { code: "PROVIDER_TIMEOUT" }
}).finalFailure, true);
assert.equal(planV4JobRetry({
  attemptCount: 1,
  maxAttempts: 4,
  error: { code: "INVALID_PAYLOAD" }
}).shouldRetry, false);
assert.equal(planV4JobRetry({
  attemptCount: 1,
  maxAttempts: 4,
  error: { code: "PROVIDER_TIMEOUT" },
  forceFinalFailure: true
}).shouldRetry, false);

const migration = readFileSync(
  new URL("../supabase/migrations/20260715065808_track_c_retry_state_machine_hardening.sql", import.meta.url),
  "utf8"
);
assert.match(migration, /alter column max_attempts set default 4/);
assert.match(migration, /add column if not exists canonical_state text generated always as/);
for (const operationalColumn of ["retry_count", "last_error", "error_type", "next_retry_at"]) {
  assert.match(
    migration,
    new RegExp(`add column if not exists ${operationalColumn}\\s`, "i"),
    `missing operational retry column ${operationalColumn}`
  );
}
assert.match(migration, /when status = 'RETRYING' then greatest\(attempt_count, 0\)/);
assert.match(migration, /case when status = 'RETRYING' then not_before else null end/);
assert.match(migration, /create or replace function public\.finalize_exhausted_v4_recognition_jobs\(\)/);
assert.match(migration, /jobs\.status = 'RUNNING'[\s\S]*jobs\.attempt_count >= jobs\.max_attempts/);
assert.match(migration, /'LEASE_EXPIRED_FINALIZED'[\s\S]*'FAILED_FINAL'/);
assert.match(migration, /insert into public\.job_attempt_events/);
assert.doesNotMatch(migration, /create table(?: if not exists)? public\.job_attempt_events/);
assert.ok(
  (migration.match(/jobs\.attempt_count < jobs\.max_attempts/g) || []).length >= 3,
  "selection and both claim updates must enforce the max-attempt boundary"
);
assert.match(migration, /create or replace function public\.fail_v4_recognition_job/);
assert.match(migration, /when 1 then 10[\s\S]*when 2 then 30[\s\S]*when 3 then 120/);
assert.match(migration, /retry_delay_seconds::bigint \* 1000/);
assert.match(migration, /regexp_replace\([\s\S]*\[\^a-zA-Z0-9\]\+/);

for (const rpcName of [
  "finalize_exhausted_v4_recognition_jobs",
  "claim_v4_recognition_jobs",
  "claim_v4_recognition_jobs_with_balanced_capacity",
  "claim_v4_recognition_jobs_with_capacity",
  "fail_v4_recognition_job"
]) {
  const declaration = new RegExp(
    `create or replace function public\\.${rpcName}\\([\\s\\S]*?security invoker[\\s\\S]*?set search_path = ''`,
    "i"
  );
  assert.match(migration, declaration, `${rpcName} must be invoker-safe with an empty search_path`);
  assert.match(
    migration,
    new RegExp(`grant execute on function public\\.${rpcName}`),
    `${rpcName} must have an explicit service-role grant`
  );
}

console.log("job retry policy tests passed");
