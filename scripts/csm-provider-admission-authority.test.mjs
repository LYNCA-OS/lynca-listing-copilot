#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  CSM_PROVIDER_AUTHORITY_LIMITS,
  CSM_PROVIDER_AUTHORITY_RPC_TIMEOUT_MS,
  CSM_PROVIDER_AUTHORITY_RPCS,
  checkCsmProviderAdmissionReadiness,
  createCsmSupabaseProviderAdmissionAuthority
} from "../lib/listing/thin/csm-provider-admission-authority.mjs";
import { CSM_THIN_RUNTIME_CONTRACT } from "../lib/listing/thin/csm-runtime-contract.mjs";

const ENV = {
  SUPABASE_URL: "https://authority.example.test/",
  SUPABASE_SECRET_KEY: "sb_secret_test_not_real"
};
const HASH = "a".repeat(64);

assert.equal(
  CSM_PROVIDER_AUTHORITY_RPCS.pacerReadiness,
  "check_csm_thin_provider_pacer_v1"
);

function pacerReceipt(overrides = {}) {
  return {
    ok: true,
    code: "pacer_ready",
    max_active: CSM_PROVIDER_AUTHORITY_LIMITS.maximumActiveAttempts,
    max_active_tokens: CSM_PROVIDER_AUTHORITY_LIMITS.maximumActiveEstimatedTokens,
    baseline_working_max_active: CSM_PROVIDER_AUTHORITY_LIMITS.baselineWorkingActiveAttempts,
    effective_max_active: CSM_PROVIDER_AUTHORITY_LIMITS.baselineWorkingActiveAttempts,
    pacer_tokens_per_second: CSM_PROVIDER_AUTHORITY_LIMITS.pacerEstimatedTokensPerSecond,
    pacer_burst_tokens: CSM_PROVIDER_AUTHORITY_LIMITS.pacerBurstEstimatedTokens,
    token_window_target: CSM_PROVIDER_AUTHORITY_LIMITS.targetEstimatedTokensPerWindow,
    token_window_hard_limit: CSM_PROVIDER_AUTHORITY_LIMITS.hardTokensPerWindow,
    ...overrides
  };
}

function metadata(overrides = {}) {
  return {
    tenantId: "tenant-a",
    operationKey: "luna-direct:v2:operation-a",
    payloadHash: HASH,
    attempt: 1,
    attemptClass: "fresh",
    estimatedTokens: 5_258,
    ...overrides
  };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function fakeRpc(responses = {}) {
  const calls = [];
  const queues = Object.fromEntries(Object.entries(responses).map(([name, values]) => [
    name,
    Array.isArray(values) ? [...values] : [values]
  ]));
  return {
    calls,
    fetchImpl: async (rawUrl, init = {}) => {
      const name = new URL(rawUrl).pathname.split("/").pop();
      calls.push({ name, init, body: JSON.parse(init.body) });
      const next = queues[name]?.shift();
      if (next instanceof Error) throw next;
      if (typeof next === "function") return next({ name, init, calls });
      return jsonResponse(next ?? { ok: false, code: `unexpected_${name}`, status_code: 500 });
    }
  };
}

function authority(store, overrides = {}) {
  return createCsmSupabaseProviderAdmissionAuthority({
    env: ENV,
    fetchImpl: store.fetchImpl,
    workerId: "worker-test",
    leaseSeconds: 30,
    maximumProviderDurationMs: 1_000,
    claimPollMs: 1,
    claimTimeoutMs: 100,
    sleep: async () => {},
    setIntervalImpl: () => ({ unref() {} }),
    clearIntervalImpl: () => {},
    ...overrides
  });
}

// The request preflight verifies both the durable authority family and the
// exact global pacer contract. A stale/partial pacer migration fails closed.
{
  const readyStore = fakeRpc({
    [CSM_PROVIDER_AUTHORITY_RPCS.lookup]: {
      ok: true, code: "not_found", found: false
    },
    [CSM_PROVIDER_AUTHORITY_RPCS.pacerReadiness]: pacerReceipt()
  });
  assert.deepEqual(await checkCsmProviderAdmissionReadiness({
    env: ENV, fetchImpl: readyStore.fetchImpl
  }), { ready: true, reason: null });
  assert.deepEqual(readyStore.calls.map(({ name }) => name), [
    CSM_PROVIDER_AUTHORITY_RPCS.lookup,
    CSM_PROVIDER_AUTHORITY_RPCS.pacerReadiness
  ]);
  assert.deepEqual(readyStore.calls[1].body, {
    p_provider: "openai",
    p_account_scope: "lynca-primary",
    p_model: "gpt-5.6-luna"
  });

  const stalePacerStore = fakeRpc({
    [CSM_PROVIDER_AUTHORITY_RPCS.lookup]: {
      ok: true, code: "not_found", found: false
    },
    [CSM_PROVIDER_AUTHORITY_RPCS.pacerReadiness]: pacerReceipt({
      baseline_working_max_active: 120
    })
  });
  assert.deepEqual(await checkCsmProviderAdmissionReadiness({
    env: ENV, fetchImpl: stalePacerStore.fetchImpl
  }), { ready: false, reason: "provider_pacer_probe_contract_mismatch" });
}

assert.deepEqual(CSM_PROVIDER_AUTHORITY_LIMITS, {
  maximumActiveAttempts: 120,
  maximumActiveEstimatedTokens: 440_000,
  baselineWorkingActiveAttempts: 43,
  pacerEstimatedTokensPerSecond: 60_000,
  pacerBurstEstimatedTokens: 65_200,
  retryFractionWhileFreshQueued: 0.2,
  rollingWindowSeconds: 60,
  targetRequestsPerWindow: 4_500,
  hardRequestsPerWindow: 5_000,
  targetEstimatedTokensPerWindow: 3_600_000,
  hardTokensPerWindow: 4_000_000
});
assert.equal(
  CSM_PROVIDER_AUTHORITY_LIMITS.pacerEstimatedTokensPerSecond
    * CSM_PROVIDER_AUTHORITY_LIMITS.rollingWindowSeconds,
  CSM_PROVIDER_AUTHORITY_LIMITS.targetEstimatedTokensPerWindow,
  "the smooth pacer must converge exactly to the 60-second token target"
);
assert.equal(
  Math.floor(
    CSM_PROVIDER_AUTHORITY_LIMITS.pacerBurstEstimatedTokens
      / CSM_THIN_RUNTIME_CONTRACT.estimatedTokensPerAttempt
  ),
  12,
  "the lossless bucket must not raise the twelve-attempt microburst ceiling"
);
function saturatedPacerTicks(burstTokens, ticks) {
  const counts = [];
  let balance = 0;
  for (let tick = 0; tick < ticks; tick += 1) {
    balance = Math.min(
      burstTokens,
      balance + CSM_PROVIDER_AUTHORITY_LIMITS.pacerEstimatedTokensPerSecond
    );
    const admitted = Math.floor(
      balance / CSM_THIN_RUNTIME_CONTRACT.estimatedTokensPerAttempt
    );
    balance -= admitted * CSM_THIN_RUNTIME_CONTRACT.estimatedTokensPerAttempt;
    counts.push(admitted);
  }
  return { counts, balance, total: counts.reduce((sum, value) => sum + value, 0) };
}
const clippedTwelveQuantumBucket = saturatedPacerTicks(63_600, 4);
assert.deepEqual(clippedTwelveQuantumBucket.counts, [11, 11, 11, 12]);
assert.equal(
  clippedTwelveQuantumBucket.total
    * CSM_THIN_RUNTIME_CONTRACT.estimatedTokensPerAttempt / 4,
  59_625,
  "a twelve-quantum bucket clips carry before consumption and undershoots 60k/s"
);
const losslessDiscreteCycle = saturatedPacerTicks(
  CSM_PROVIDER_AUTHORITY_LIMITS.pacerBurstEstimatedTokens,
  53
);
assert.equal(losslessDiscreteCycle.total, 600);
assert.equal(Math.max(...losslessDiscreteCycle.counts), 12);
assert.equal(losslessDiscreteCycle.balance, 0);
assert.equal(
  Math.floor(
    CSM_PROVIDER_AUTHORITY_LIMITS.pacerEstimatedTokensPerSecond * 60
      / CSM_THIN_RUNTIME_CONTRACT.estimatedTokensPerAttempt
  ),
  679
);
assert.equal(
  Math.floor(
    CSM_PROVIDER_AUTHORITY_LIMITS.maximumActiveEstimatedTokens
      / CSM_THIN_RUNTIME_CONTRACT.estimatedTokensPerAttempt
  ),
  83
);

// One logical request is durably enqueued, waits until its global scheduler
// turn, executes once, then releases count and token capacity through settle.
{
  const store = fakeRpc({
    [CSM_PROVIDER_AUTHORITY_RPCS.enqueue]: {
      ok: true, code: "enqueued", status_code: 201, replayed: false
    },
    [CSM_PROVIDER_AUTHORITY_RPCS.claim]: [
      { ok: true, code: "not_scheduler_turn", admitted: false, retry_after_ms: 1 },
      {
        ok: true, code: "admitted", admitted: true,
        lease_fence: 7, lease_expires_at: "2026-08-01T10:00:30Z"
      }
    ],
    [CSM_PROVIDER_AUTHORITY_RPCS.settle]: {
      ok: true, code: "settled", status_code: 200, operation_status: "SUCCEEDED"
    }
  });
  const admission = authority(store);
  let executions = 0;
  const result = await admission.runAttempt({
    queuedAttempt: admission.enqueueAttempt(metadata()),
    execute: async () => {
      executions += 1;
      return {
        title: "2023 Panini Prizm Victor Wembanyama RC #136",
        input_tokens: 4_000,
        output_tokens: 120
      };
    }
  });
  assert.equal(admission.globallyEnforced, true);
  assert.equal(executions, 1);
  assert.equal(result.title, "2023 Panini Prizm Victor Wembanyama RC #136");
  assert.deepEqual(store.calls.map(({ name }) => name), [
    CSM_PROVIDER_AUTHORITY_RPCS.enqueue,
    CSM_PROVIDER_AUTHORITY_RPCS.claim,
    CSM_PROVIDER_AUTHORITY_RPCS.claim,
    CSM_PROVIDER_AUTHORITY_RPCS.settle
  ]);
  assert.deepEqual(store.calls[0].body, {
    p_tenant_id: "tenant-a",
    p_operation_key: "luna-direct:v2:operation-a",
    p_payload_sha256: HASH,
    p_provider: "openai",
    p_account_scope: "lynca-primary",
    p_model: "gpt-5.6-luna",
    p_attempt_no: 1,
    p_attempt_class: "fresh",
    p_estimated_tokens: 5_258,
    p_tenant_weight: 1,
    p_not_before: null,
    p_queue_owner: "worker-test",
    p_queue_ttl_seconds: 300
  });
  assert.equal(store.calls[0].init.headers.apikey, ENV.SUPABASE_SECRET_KEY);
  assert.equal(store.calls[0].init.headers.authorization, undefined,
    "a modern secret key must not be copied into a bearer header");
  assert.ok(store.calls.every(({ init }) => init.signal instanceof AbortSignal),
    "every authority RPC must carry a bounded abort signal");
  assert.equal(store.calls.at(-1).body.p_lease_fence, 7);
  assert.equal(store.calls.at(-1).body.p_outcome, "SUCCEEDED");
  assert.equal(store.calls.at(-1).body.p_actual_tokens, 4_120,
    "settle must replace the rolling-window estimate with observed usage");
}

// A PostgREST socket that never answers is a bounded, classified transport
// failure before the provider boundary. It must not turn into an unbounded
// function invocation or an ambiguous paid attempt.
{
  const calls = [];
  const admission = authority({
    calls,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      return new Promise((resolve, reject) => {
        const holdOpen = setTimeout(() => reject(new Error("abort_signal_did_not_fire")), 100);
        init.signal.addEventListener("abort", () => {
          clearTimeout(holdOpen);
          reject(init.signal.reason);
        }, { once: true });
      });
    }
  }, { rpcTimeoutMs: 5 });
  await assert.rejects(
    admission.enqueueAttempt(metadata()),
    (error) => error.code === "CSM_PROVIDER_AUTHORITY_TIMEOUT"
      && error.retryable === true
      && error.ambiguous === false
      && error.provider_attempt_started === false
  );
  assert.equal(calls.length, 1);
  assert.equal(CSM_PROVIDER_AUTHORITY_RPC_TIMEOUT_MS, 5_000);
}

// A completed exact replay returns the stored result without another claim or
// provider call.
{
  const store = fakeRpc({
    [CSM_PROVIDER_AUTHORITY_RPCS.enqueue]: {
      ok: true, code: "exact_replay", replayed: true,
      operation_status: "SUCCEEDED", attempt_state: "SUCCEEDED",
      result: { title: "stored" }
    }
  });
  const admission = authority(store);
  let executed = false;
  const result = await admission.runAttempt({
    queuedAttempt: admission.enqueueAttempt(metadata()),
    execute: async () => {
      executed = true;
      return { title: "wrong" };
    }
  });
  assert.equal(executed, false);
  assert.deepEqual(result, { title: "stored" });
  assert.deepEqual(store.calls.map(({ name }) => name), [CSM_PROVIDER_AUTHORITY_RPCS.enqueue]);
}

// A scheduler retry-after value cannot sleep beyond the claim wall-clock
// deadline. One 1s server hint under a 50ms budget is clipped to 50ms, after
// which cleanup runs instead of extending the request.
{
  const store = fakeRpc({
    [CSM_PROVIDER_AUTHORITY_RPCS.enqueue]: { ok: true, code: "enqueued" },
    [CSM_PROVIDER_AUTHORITY_RPCS.claim]: {
      ok: true, code: "not_scheduler_turn", admitted: false, retry_after_ms: 1_000
    },
    [CSM_PROVIDER_AUTHORITY_RPCS.cancel]: {
      ok: true, code: "cancel_requested", operation_status: "CANCELLED", running_attempts: 0
    }
  });
  let clockMs = 0;
  const delays = [];
  const admission = authority(store, {
    claimPollMs: 10,
    claimTimeoutMs: 50,
    now: () => clockMs,
    sleep: async (delayMs) => {
      delays.push(delayMs);
      clockMs += delayMs;
    }
  });
  await assert.rejects(
    admission.runAttempt({
      queuedAttempt: admission.enqueueAttempt(metadata()),
      execute: async () => ({ title: "must not run" })
    }),
    (error) => error.code === "CSM_PROVIDER_CLAIM_TIMEOUT"
  );
  assert.deepEqual(delays, [50]);
  assert.deepEqual(store.calls.map(({ name }) => name), [
    CSM_PROVIDER_AUTHORITY_RPCS.enqueue,
    CSM_PROVIDER_AUTHORITY_RPCS.claim,
    CSM_PROVIDER_AUTHORITY_RPCS.cancel
  ]);
}

// If the claim transaction committed but its HTTP receipt was lost, the same
// authority worker retries the claim and receives the existing fence. It must
// execute exactly once rather than abandoning the lease or creating a second
// physical attempt.
{
  const store = fakeRpc({
    [CSM_PROVIDER_AUTHORITY_RPCS.enqueue]: {
      ok: true, code: "enqueued", status_code: 201, replayed: false
    },
    [CSM_PROVIDER_AUTHORITY_RPCS.claim]: [
      new TypeError("claim response lost"),
      {
        ok: true, code: "claim_receipt_replayed", admitted: true, replayed: true,
        lease_fence: 11, lease_expires_at: "2026-08-01T10:00:30Z"
      }
    ],
    [CSM_PROVIDER_AUTHORITY_RPCS.settle]: {
      ok: true, code: "settled", status_code: 200, operation_status: "SUCCEEDED"
    }
  });
  const admission = authority(store);
  let executions = 0;
  const result = await admission.runAttempt({
    queuedAttempt: admission.enqueueAttempt(metadata()),
    execute: async () => { executions += 1; return { title: "one call" }; }
  });
  assert.equal(result.title, "one call");
  assert.equal(executions, 1);
  assert.deepEqual(store.calls.map(({ name }) => name), [
    CSM_PROVIDER_AUTHORITY_RPCS.enqueue,
    CSM_PROVIDER_AUTHORITY_RPCS.claim,
    CSM_PROVIDER_AUTHORITY_RPCS.claim,
    CSM_PROVIDER_AUTHORITY_RPCS.settle
  ]);
  assert.equal(store.calls.at(-1).body.p_lease_fence, 11);
}

// A provider 429 is a settled safe failure. The dispatcher may decide to
// enqueue attempt N+1; the authority never manufactures that retry itself.
{
  const store = fakeRpc({
    [CSM_PROVIDER_AUTHORITY_RPCS.enqueue]: { ok: true, code: "enqueued" },
    [CSM_PROVIDER_AUTHORITY_RPCS.claim]: {
      ok: true, admitted: true, lease_fence: 2, lease_expires_at: "2026-08-01T10:00:30Z"
    },
    [CSM_PROVIDER_AUTHORITY_RPCS.settle]: { ok: true, code: "settled" }
  });
  const admission = authority(store);
  const providerError = Object.assign(new Error("rate limited"), {
    status: 429,
    retryable: true,
    response: { status: 429, headers: new Headers({ "retry-after": "2" }) }
  });
  await assert.rejects(
    admission.runAttempt({
      queuedAttempt: admission.enqueueAttempt(metadata()),
      execute: async () => { throw providerError; }
    }),
    (error) => error.status === 429
      && error.retryable === true
      && error.ambiguous === false
      && error.provider_attempt_started === true
  );
  assert.equal(store.calls.at(-1).body.p_outcome, "RATE_LIMITED");
  assert.equal(store.calls.at(-1).body.p_result.retry_after_ms, 2_000);
}

// Replaying an already FAILED physical attempt does not poll forever. A new
// process must look up latest_attempt_no and durably enqueue N+1 as RETRY.
{
  const store = fakeRpc({
    [CSM_PROVIDER_AUTHORITY_RPCS.enqueue]: {
      ok: true, code: "exact_replay", replayed: true,
      operation_status: "FAILED", attempt_state: "FAILED",
      latest_attempt_no: 1, result: { status: 429 }
    }
  });
  const admission = authority(store);
  await assert.rejects(
    admission.runAttempt({
      queuedAttempt: admission.enqueueAttempt(metadata()),
      execute: async () => ({ title: "must not run" })
    }),
    (error) => error.code === "operation_previous_attempt_failed"
      && error.provider_attempt_started === false
      && error.latest_attempt === 1
  );
  assert.deepEqual(store.calls.map(({ name }) => name), [CSM_PROVIDER_AUTHORITY_RPCS.enqueue]);
}

// A live process that gives up before admission best-effort cancels its own
// queued row. Process death is independently covered by the SQL queue TTL.
{
  const store = fakeRpc({
    [CSM_PROVIDER_AUTHORITY_RPCS.enqueue]: { ok: true, code: "enqueued" },
    [CSM_PROVIDER_AUTHORITY_RPCS.claim]: {
      ok: true, code: "not_scheduler_turn", admitted: false, retry_after_ms: 1
    },
    [CSM_PROVIDER_AUTHORITY_RPCS.cancel]: {
      ok: true, code: "cancel_requested", operation_status: "CANCELLED", running_attempts: 0
    }
  });
  const admission = authority(store, {
    claimTimeoutMs: 1,
    sleep: () => new Promise((resolve) => setTimeout(resolve, 2))
  });
  await assert.rejects(
    admission.runAttempt({
      queuedAttempt: admission.enqueueAttempt(metadata()),
      execute: async () => ({ title: "must not run" })
    }),
    (error) => error.code === "CSM_PROVIDER_CLAIM_TIMEOUT"
      && error.provider_attempt_started === false
  );
  assert.deepEqual(store.calls.map(({ name }) => name), [
    CSM_PROVIDER_AUTHORITY_RPCS.enqueue,
    CSM_PROVIDER_AUTHORITY_RPCS.claim,
    CSM_PROVIDER_AUTHORITY_RPCS.cancel
  ]);
}

// A replay can race the original worker's terminal settle. FAILED/CANCELLED
// are terminal immediately; only QUEUED/RUNNING remain pending.
for (const terminal of ["FAILED", "CANCELLED"]) {
  const store = fakeRpc({
    [CSM_PROVIDER_AUTHORITY_RPCS.enqueue]: {
      ok: true, code: "exact_replay", replayed: true,
      operation_status: "RUNNING", attempt_state: "RUNNING",
      latest_attempt_no: 2, latest_attempt_state: "RUNNING"
    },
    [CSM_PROVIDER_AUTHORITY_RPCS.claim]: {
      ok: false, code: "attempt_not_queued", status_code: 409
    },
    [CSM_PROVIDER_AUTHORITY_RPCS.lookup]: {
      ok: true, found: true, operation_status: terminal,
      latest_attempt_no: 2, latest_attempt_state: terminal,
      result: terminal === "FAILED" ? { status: 429 } : null
    }
  });
  const admission = authority(store);
  await assert.rejects(
    admission.runAttempt({
      queuedAttempt: admission.enqueueAttempt(metadata({ attempt: 2, attemptClass: "retry" })),
      execute: async () => ({ title: "must not run" })
    }),
    (error) => error.code === (terminal === "FAILED"
      ? "operation_previous_attempt_failed"
      : "operation_cancelled")
      && error.latestAttempt === 2
      && error.provider_attempt_started === false
  );
  assert.deepEqual(store.calls.map(({ name }) => name), [
    CSM_PROVIDER_AUTHORITY_RPCS.enqueue,
    CSM_PROVIDER_AUTHORITY_RPCS.claim,
    CSM_PROVIDER_AUTHORITY_RPCS.lookup
  ]);
}

// A failure inside the claimed execution closure can still be explicitly
// pre-provider (for example, immutable session creation). Settle the durable
// attempt, but preserve that fact for the dispatcher so it cannot invent an
// ambiguous paid boundary.
{
  const store = fakeRpc({
    [CSM_PROVIDER_AUTHORITY_RPCS.enqueue]: { ok: true, code: "enqueued" },
    [CSM_PROVIDER_AUTHORITY_RPCS.claim]: {
      ok: true, admitted: true, lease_fence: 29, lease_expires_at: "2026-08-01T10:00:30Z"
    },
    [CSM_PROVIDER_AUTHORITY_RPCS.settle]: { ok: true, code: "settled" }
  });
  const admission = authority(store);
  const preProviderError = Object.assign(new Error("csm_recognition_session_not_persisted"), {
    statusCode: 503,
    before_request: true,
    safe_to_retry: true,
    provider_attempt_started: false
  });
  await assert.rejects(
    admission.runAttempt({
      queuedAttempt: admission.enqueueAttempt(metadata()),
      execute: async () => { throw preProviderError; }
    }),
    (error) => error.ambiguous === false && error.provider_attempt_started === false
  );
  assert.equal(store.calls.at(-1).body.p_outcome, "FAILED");
}

// A post-send timeout is persisted AMBIGUOUS and fails closed. It cannot be
// admitted as an automatic retry by the migration's predecessor rule.
{
  const store = fakeRpc({
    [CSM_PROVIDER_AUTHORITY_RPCS.enqueue]: { ok: true, code: "enqueued" },
    [CSM_PROVIDER_AUTHORITY_RPCS.claim]: {
      ok: true, admitted: true, lease_fence: 3, lease_expires_at: "2026-08-01T10:00:30Z"
    },
    [CSM_PROVIDER_AUTHORITY_RPCS.settle]: { ok: true, code: "settled" }
  });
  const admission = authority(store);
  const providerError = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
  await assert.rejects(
    admission.runAttempt({
      queuedAttempt: admission.enqueueAttempt(metadata()),
      execute: async () => { throw providerError; }
    }),
    (error) => error.ambiguous === true && error.provider_attempt_started === true
  );
  assert.equal(store.calls.at(-1).body.p_outcome, "AMBIGUOUS");
}

// AbortSignal.timeout() uses a DOMException named TimeoutError rather than an
// ETIMEDOUT code. This is the concrete timeout shape used by the direct API.
{
  const store = fakeRpc({
    [CSM_PROVIDER_AUTHORITY_RPCS.enqueue]: { ok: true, code: "enqueued" },
    [CSM_PROVIDER_AUTHORITY_RPCS.claim]: {
      ok: true, admitted: true, lease_fence: 31, lease_expires_at: "2026-08-01T10:00:30Z"
    },
    [CSM_PROVIDER_AUTHORITY_RPCS.settle]: { ok: true, code: "settled" }
  });
  const admission = authority(store);
  const providerError = new DOMException(
    "The operation was aborted due to timeout",
    "TimeoutError"
  );
  await assert.rejects(
    admission.runAttempt({
      queuedAttempt: admission.enqueueAttempt(metadata()),
      execute: async () => { throw providerError; }
    }),
    (error) => error.ambiguous === true && error.provider_attempt_started === true
  );
  assert.equal(store.calls.at(-1).body.p_outcome, "AMBIGUOUS");
}

// Losing the settle response after a successful provider call never becomes
// a blind retry. The caller must resolve the persisted operation first.
{
  const store = fakeRpc({
    [CSM_PROVIDER_AUTHORITY_RPCS.enqueue]: { ok: true, code: "enqueued" },
    [CSM_PROVIDER_AUTHORITY_RPCS.claim]: {
      ok: true, admitted: true, lease_fence: 4, lease_expires_at: "2026-08-01T10:00:30Z"
    },
    [CSM_PROVIDER_AUTHORITY_RPCS.settle]: new TypeError("response lost")
  });
  const admission = authority(store);
  await assert.rejects(
    admission.runAttempt({
      queuedAttempt: admission.enqueueAttempt(metadata()),
      execute: async () => ({ title: "provider completed" })
    }),
    (error) => error.code === "CSM_PROVIDER_SETTLE_UNCERTAIN"
      && error.ambiguous === true
      && error.provider_attempt_started === true
  );
  assert.equal(store.calls.filter(({ name }) => name === CSM_PROVIDER_AUTHORITY_RPCS.settle).length, 1);
}

// Heartbeat, lookup and cancellation remain explicit fenced RPCs. Cancelling
// a running operation does not locally pretend that provider capacity is free.
{
  const store = fakeRpc({
    [CSM_PROVIDER_AUTHORITY_RPCS.heartbeat]: { ok: true, code: "heartbeat" },
    [CSM_PROVIDER_AUTHORITY_RPCS.lookup]: [
      {
        ok: true, found: true, operation_status: "SUCCEEDED",
        latest_attempt_no: 2, latest_attempt_state: "SUCCEEDED",
        result: { title: "saved" }
      },
      {
        ok: true, found: true, operation_status: "AMBIGUOUS",
        latest_attempt_no: 3, latest_attempt_state: "AMBIGUOUS",
        result: null
      }
    ],
    [CSM_PROVIDER_AUTHORITY_RPCS.cancel]: {
      ok: true, code: "cancel_requested", operation_status: "CANCEL_REQUESTED", running_attempts: 1
    }
  });
  const admission = authority(store);
  await admission.heartbeatAttempt({
    ...metadata(), provider: "openai", accountScope: "lynca-primary", model: "gpt-5.6-luna",
    leaseFence: 9
  });
  assert.equal(store.calls[0].body.p_lease_fence, 9);
  assert.deepEqual(await admission.lookupOperationResult(metadata()), {
    status: "found", result: { title: "saved" },
    latestAttempt: 2, latestAttemptState: "SUCCEEDED"
  });
  assert.deepEqual(await admission.lookupOperationResult(metadata()), {
    status: "ambiguous", operationStatus: "AMBIGUOUS",
    latestAttempt: 3, latestAttemptState: "AMBIGUOUS"
  });
  const cancelled = await admission.cancelOperation(metadata());
  assert.equal(cancelled.operation_status, "CANCEL_REQUESTED");
  assert.equal(store.calls.at(-1).body.p_payload_sha256, HASH);
}

console.log("CSM provider admission authority adapter tests passed");
