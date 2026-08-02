#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  LUNA_PROVIDER_CAPACITY_POLICY,
  assertLunaGlobalCapacityAuthority,
  createLunaGlobalAttemptAdmission
} from "../lib/listing/thin/luna-provider-capacity.mjs";

const CAPABILITIES = [
  "atomic_active_attempts_tokens_retry",
  "durable_global_attempt_queue",
  "weighted_fair_queue",
  "work_conserving",
  "fenced_expiring_leases",
  "global_aimd"
];

function authority(overrides = {}) {
  const events = [];
  return {
    events,
    scope: "durable_global",
    capabilities: CAPABILITIES,
    enqueue: async (request) => {
      events.push({ type: "enqueue", request });
      return { attempt_id: `attempt-${events.length}` };
    },
    claim: async (request) => {
      events.push({ type: "claim", request });
      return {
        granted: true,
        lease_id: `lease-${events.length}`,
        fencing_token: `fence-${events.length}`,
        expires_at: "2026-08-01T12:01:00.000Z"
      };
    },
    heartbeat: async (request) => { events.push({ type: "heartbeat", request }); },
    settle: async (request) => { events.push({ type: "settle", request }); },
    ...overrides
  };
}

function runAttempt(admission, { execute, ...metadata }) {
  return admission.runAttempt({
    queuedAttempt: admission.enqueueAttempt(metadata),
    execute
  });
}

assert.deepEqual(LUNA_PROVIDER_CAPACITY_POLICY, {
  namespace: "csm_luna_thin_v1",
  active_attempt_soft_ceiling: 120,
  retry_token_fraction: 0.2,
  retry_owner: "luna_direct_dispatcher",
  admission_unit: "physical_provider_attempt",
  authority_scope: "durable_global"
});

for (const invalid of [
  null,
  { scope: "single_process", capabilities: CAPABILITIES, enqueue() {}, claim() {}, heartbeat() {}, settle() {} },
  { ...authority(), capabilities: CAPABILITIES.slice(1) }
]) {
  assert.throws(
    () => assertLunaGlobalCapacityAuthority(invalid),
    (error) => error.code === "LUNA_GLOBAL_CAPACITY_AUTHORITY_UNAVAILABLE"
      && error.provider_attempt_started === false
  );
}

// The policy values travel in one admission request; neither 120 nor the token
// and retry dimensions can be enforced independently by process-local callers.
{
  const globalAuthority = authority();
  const admission = createLunaGlobalAttemptAdmission({
    authority: globalAuthority,
    maximumInflightTokens: 440_000
  });
  const result = await runAttempt(admission, {
    tenantId: "tenant-a",
    operationKey: "operation-a",
    payloadHash: "payload-a",
    attempt: 1,
    attemptClass: "fresh",
    estimatedTokens: 5_262,
    execute: async ({ lease }) => ({ ok: true, lease_id: lease.lease_id })
  });
  assert.deepEqual(result, { ok: true, lease_id: "lease-2" });
  assert.equal(admission.globallyEnforced, true);
  assert.equal(globalAuthority.events[0].request.policy.active_attempt_soft_ceiling, 120);
  assert.equal(globalAuthority.events[0].request.policy.maximum_inflight_tokens, 440_000);
  assert.equal(globalAuthority.events[0].request.attempt_class, "fresh");
  assert.deepEqual(globalAuthority.events.map(({ type }) => type), ["enqueue", "claim", "settle"]);
}

// A 429 is observed only after the physical-attempt lease is settled. The
// dispatcher can then sleep/retry without consuming count or token capacity.
{
  const globalAuthority = authority();
  const admission = createLunaGlobalAttemptAdmission({
    authority: globalAuthority,
    maximumInflightTokens: 440_000
  });
  await assert.rejects(
    runAttempt(admission, {
      tenantId: "tenant-a",
      operationKey: "operation-retry",
      payloadHash: "payload-retry",
      attempt: 2,
      attemptClass: "retry",
      estimatedTokens: 5_262,
      execute: async () => { throw Object.assign(new Error("busy"), { status: 429 }); }
    }),
    /busy/
  );
  assert.deepEqual(globalAuthority.events.map(({ type }) => type), ["enqueue", "claim", "settle"]);
  assert.equal(globalAuthority.events[0].request.attempt_class, "retry");
  assert.equal(globalAuthority.events[2].request.status, 429);
}

// A settle transport failure can temporarily under-use capacity until the
// expiring lease is reclaimed, but it must not convert a successful paid call
// into a retryable failure and create duplicate spend.
{
  const authorityErrors = [];
  const globalAuthority = authority({
    settle: async () => { throw new Error("settle transport failed"); }
  });
  const admission = createLunaGlobalAttemptAdmission({
    authority: globalAuthority,
    maximumInflightTokens: 440_000,
    onAuthorityError: ({ phase, error }) => authorityErrors.push(`${phase}:${error.message}`)
  });
  assert.deepEqual(await runAttempt(admission, {
    tenantId: "tenant-a",
    operationKey: "operation-success",
    payloadHash: "payload-success",
    attempt: 1,
    attemptClass: "fresh",
    estimatedTokens: 5_262,
    execute: async () => ({ ok: true })
  }), { ok: true });
  assert.deepEqual(authorityErrors, ["settle:settle transport failed"]);
}

{
  const admission = createLunaGlobalAttemptAdmission({
    authority: authority(),
    maximumInflightTokens: 10
  });
  await assert.rejects(admission.enqueueAttempt({
    tenantId: "tenant-a",
    operationKey: "operation-too-large",
    payloadHash: "payload-too-large",
    attempt: 1,
    attemptClass: "fresh",
    estimatedTokens: 11
  }), (error) => error.code === "LUNA_PROVIDER_ATTEMPT_TOO_LARGE"
      && error.provider_attempt_started === false);
}

process.stdout.write("luna provider capacity: ok\n");
