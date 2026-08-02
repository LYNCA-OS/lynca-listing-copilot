#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildLunaDirectOperationKey,
  buildLunaDirectPayloadHash,
  classifyLunaDirectFailure,
  createLunaDirectDispatcher,
  lunaRetryDelayMs,
  retryAfterMs
} from "../lib/listing/thin/luna-direct-dispatcher.mjs";

const dispatcherSource = await readFile(
  new URL("../lib/listing/thin/luna-direct-dispatcher.mjs", import.meta.url),
  "utf8"
);
assert.doesNotMatch(
  dispatcherSource,
  /(?:listing-job|provider-status|cloud\s*run|recognition-worker|vector|ocr)/i,
  "the Luna dispatcher must remain an isolated direct path"
);

function task(assetId, overrides = {}) {
  return {
    tenant_id: "tenant-1",
    intent_id: "intent-1",
    asset_id: assetId,
    model: "gpt-5.6-luna",
    detail: "high",
    prompt_version: "csm-canonical-v1",
    estimated_tokens: 5_262,
    image_urls: [`https://example.test/${assetId}.jpg`],
    ...overrides
  };
}

const TEST_ONLY_SINGLE_PROCESS_ADMISSION = Object.freeze({
  enqueueAttempt: async (metadata) => metadata,
  runAttempt: async ({ queuedAttempt, execute }) => {
    await queuedAttempt;
    return execute();
  }
});

function createTestDispatcher(options) {
  return createLunaDirectDispatcher({
    providerAdmission: TEST_ONLY_SINGLE_PROCESS_ADMISSION,
    ...options
  });
}

function gate() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

assert.throws(
  () => createLunaDirectDispatcher({ executeTask: async () => ({ ok: true }) }),
  /invalid_csm_direct_concurrency/,
  "production capacity must be supplied by the Luna pool, never inherited from a legacy default"
);
assert.throws(
  () => createLunaDirectDispatcher({
    csmDirectConcurrency: 1,
    executeTask: async () => ({ ok: true })
  }),
  /missing_luna_global_attempt_admission/,
  "a dispatcher may not bypass the per-physical-attempt global capacity boundary"
);

// The idempotency identity is stable, ignores unrelated payload members, and
// changes whenever tenant scope or an execution-defining field changes.
{
  const first = buildLunaDirectOperationKey(task("asset-1"));
  const same = buildLunaDirectOperationKey({ ...task("asset-1"), image_urls: ["https://rotated.test/front.jpg"] });
  assert.equal(first, same);
  assert.match(first, /^luna-direct:v2:[0-9a-f]{64}$/);
  for (const change of [
    { tenant_id: "tenant-2" },
    { intent_id: "intent-2" },
    { asset_id: "asset-2" },
    { model: "gpt-5.6-luna-next" },
    { detail: "original" },
    { prompt_version: "csm-canonical-v2" }
  ]) {
    assert.notEqual(buildLunaDirectOperationKey(task("asset-1", change)), first);
  }
  assert.equal(
    buildLunaDirectOperationKey(task("asset-1", { detail: " HIGH " })),
    first,
    "detail normalization must not create a second operation"
  );
  assert.equal(buildLunaDirectPayloadHash(task("asset-1")).length, 64);
  assert.notEqual(
    buildLunaDirectPayloadHash(task("asset-1")),
    buildLunaDirectPayloadHash({ ...task("asset-1"), image_urls: ["https://rotated.test/front.jpg"] })
  );
}

// Only the explicitly transient HTTP statuses and recognizable network
// failures retry. A generic application error and HTTP 500 fail immediately.
{
  for (const status of [429, 502, 503, 504]) {
    assert.equal(classifyLunaDirectFailure({ status }).retryable, true);
  }
  assert.equal(classifyLunaDirectFailure({ status: 502 }).ambiguous, true);
  assert.equal(classifyLunaDirectFailure({ status: 503 }).ambiguous, true);
  assert.equal(classifyLunaDirectFailure({ status: 504 }).ambiguous, true);
  assert.equal(classifyLunaDirectFailure({ status: 503, safe_to_retry: true }).ambiguous, false);
  for (const status of [400, 408, 500]) {
    assert.equal(classifyLunaDirectFailure({ status }).retryable, false);
  }
  assert.deepEqual(
    classifyLunaDirectFailure(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } })),
    { retryable: true, ambiguous: true, kind: "network", status: null }
  );
  assert.deepEqual(
    classifyLunaDirectFailure(Object.assign(new Error("connect refused"), { code: "ECONNREFUSED" })),
    { retryable: true, ambiguous: false, kind: "network", status: null }
  );
  assert.equal(classifyLunaDirectFailure(Object.assign(new Error("socket timed out"), { code: "ETIMEDOUT" })).ambiguous, true);
  assert.equal(classifyLunaDirectFailure(new TypeError("bad application value")).retryable, false);
}

// Retry-After is a floor, exponential delay is bounded, and injected jitter is
// deterministic in tests. The dispatcher never retries earlier than the
// server's bounded Retry-After instruction.
{
  const nowMs = Date.parse("2026-08-01T00:00:00Z");
  assert.equal(retryAfterMs({ headers: { "Retry-After": "2" } }, { nowMs }), 2_000);
  assert.equal(
    retryAfterMs({ headers: new Headers({ "retry-after": "Sat, 01 Aug 2026 00:00:03 GMT" }) }, { nowMs }),
    3_000
  );
  assert.equal(lunaRetryDelayMs({
    error: { headers: { "retry-after": "2" } }, failedAttempt: 1,
    baseDelayMs: 100, maxDelayMs: 5_000, jitterRatio: 0.2, random: () => 0.5, nowMs
  }), 2_200);
  assert.equal(lunaRetryDelayMs({
    error: {}, failedAttempt: 9, baseDelayMs: 100, maxDelayMs: 1_000,
    jitterRatio: 1, random: () => 1, nowMs
  }), 1_000);
}

// Retry uses one operation key, honors Retry-After, and never detours through a
// second execution function.
{
  const calls = [];
  const sleeps = [];
  const admissionEvents = [];
  const dispatcher = createTestDispatcher({
    csmDirectConcurrency: 9,
    maxAttempts: 2,
    jitterRatio: 0,
    sleep: async (delayMs) => {
      sleeps.push(delayMs);
      admissionEvents.push(`sleep:${delayMs}`);
    },
    providerAdmission: {
      enqueueAttempt: async (metadata) => {
        admissionEvents.push(`enqueue:${metadata.attemptClass}:${metadata.attempt}`);
        return metadata;
      },
      runAttempt: async ({ queuedAttempt, execute }) => {
        const metadata = await queuedAttempt;
        admissionEvents.push(`claim:${metadata.attempt}`);
        try {
          return await execute();
        } finally {
          admissionEvents.push(`settle:${metadata.attempt}`);
        }
      }
    },
    executeTask: async (payload) => {
      calls.push(payload);
      return calls.length === 1
        ? new Response("busy", { status: 429, headers: { "retry-after": "2" } })
        : { title: "recovered" };
    }
  });
  const result = await dispatcher.enqueue(task("retry-after"));
  assert.deepEqual(result, { title: "recovered" });
  assert.equal(dispatcher.csmDirectConcurrency, 9, "direct concurrency must not inherit an old provider cap");
  assert.deepEqual(sleeps, [2_000]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].operation_key, calls[1].operation_key);
  assert.equal(calls[0].manual_retry, false);
  assert.equal(calls[1].attempt, 2);
  assert.equal(calls[0].tenant_id, "tenant-1");
  assert.equal(calls[0].estimated_tokens, 5_262);
  assert.deepEqual(calls.map(({ attempt_class }) => attempt_class), ["fresh", "retry"]);
  assert.deepEqual(admissionEvents, [
    "enqueue:fresh:1", "claim:1", "settle:1", "sleep:2000",
    "enqueue:retry:2", "claim:2", "settle:2"
  ]);
}

// Appended assets join the live queue; duplicate intake returns the exact same
// promise; only the configured number of provider calls can be active.
{
  const releases = new Map();
  let active = 0;
  let maximumActive = 0;
  const started = [];
  const durableQueued = [];
  const durableClaims = [];
  const dispatcher = createTestDispatcher({
    csmDirectConcurrency: 2,
    providerAdmission: {
      enqueueAttempt: async (metadata) => {
        durableQueued.push(metadata.operationKey);
        return metadata;
      },
      runAttempt: async ({ queuedAttempt, execute }) => {
        const metadata = await queuedAttempt;
        durableClaims.push(metadata.operationKey);
        return execute();
      }
    },
    executeTask: async (payload) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      started.push(payload.asset_id);
      const pending = gate();
      releases.set(payload.asset_id, pending.release);
      await pending.promise;
      active -= 1;
      return { asset_id: payload.asset_id };
    }
  });

  const first = dispatcher.enqueue(task("append-1"));
  const duplicate = dispatcher.enqueue(task("append-1"));
  assert.equal(duplicate, first);
  const appended = dispatcher.append([task("append-2"), task("append-3"), task("append-4")]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["append-1", "append-2"]);
  assert.equal(durableQueued.length, 4, "all eligible backlog must reach global WFQ at intake");
  assert.equal(durableClaims.length, 2, "only local active slots may seek a physical-attempt lease");
  releases.get("append-1")();
  releases.get("append-2")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["append-1", "append-2", "append-3", "append-4"]);
  releases.get("append-3")();
  releases.get("append-4")();
  await Promise.all([first, ...appended]);
  await dispatcher.whenIdle();
  assert.equal(maximumActive, 2);
  assert.deepEqual(dispatcher.snapshot(), {
    csm_direct_concurrency: 2,
    globally_enforced_admission: false,
    queued: 0,
    active: 0,
    waiting_retries: 0,
    operations: 4
  });
}

// With a durable global authority, the local integer is not a second provider
// cap: every eligible entry seeks a claim, while the authority alone grants at
// most c120 atomically and can therefore see the actual global fair head.
{
  const claims = [];
  const claimGate = gate();
  const dispatcher = createTestDispatcher({
    csmDirectConcurrency: 2,
    providerAdmission: {
      globallyEnforced: true,
      enqueueAttempt: async (metadata) => metadata,
      runAttempt: async ({ queuedAttempt, execute }) => {
        const metadata = await queuedAttempt;
        claims.push(metadata.operationKey);
        await claimGate.promise;
        return execute();
      }
    },
    executeTask: async ({ asset_id }) => ({ asset_id })
  });
  const promises = dispatcher.append(Array.from({ length: 6 }, (_, index) => task(`global-${index}`)));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(claims.length, 6);
  assert.equal(dispatcher.snapshot().active, 6);
  claimGate.release();
  await Promise.all(promises);
}

// One intent/asset pair cannot silently split into two prompt/model operations.
{
  const dispatcher = createTestDispatcher({
    csmDirectConcurrency: 1,
    executeTask: async () => ({ ok: true })
  });
  await dispatcher.enqueue(task("conflict"));
  assert.throws(
    () => dispatcher.enqueue(task("conflict", { prompt_version: "csm-canonical-v2" })),
    (error) => error.code === "LUNA_DIRECT_ASSET_OPERATION_CONFLICT"
  );
}

// Non-transient failures do not auto-retry. The writer's manual action invokes
// the same executeTask path with the same operation key rather than a second
// recovery route.
{
  const calls = [];
  const directTaskPath = async (payload) => {
    calls.push(payload);
    if (calls.length === 1) return new Response("invalid", { status: 400 });
    return { title: "manual recovery" };
  };
  const dispatcher = createTestDispatcher({
    csmDirectConcurrency: 1,
    executeTask: directTaskPath,
    maxAttempts: 5
  });
  await assert.rejects(dispatcher.enqueue(task("manual")), /luna_direct_http_400/);
  assert.equal(calls.length, 1);
  const recovered = await dispatcher.manualRetry(task("manual"));
  assert.deepEqual(recovered, { title: "manual recovery" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].operation_key, calls[1].operation_key);
  assert.equal(calls[1].manual_retry, true);
  assert.equal(calls[1].attempt, 2);
  assert.equal(calls[1].attempt_class, "retry");
}

// A timeout is ambiguous: without a result lookup, neither auto retry nor a
// later manual click can resubmit it. This is deliberately fail-closed until a
// real server-side idempotency/result lookup exists.
{
  let calls = 0;
  const dispatcher = createTestDispatcher({
    csmDirectConcurrency: 1,
    maxAttempts: 4,
    executeTask: async () => {
      calls += 1;
      throw Object.assign(new Error("provider timed out"), { code: "ETIMEDOUT" });
    }
  });
  await assert.rejects(
    dispatcher.enqueue(task("ambiguous-closed")),
    (error) => error.code === "LUNA_DIRECT_IDEMPOTENCY_LOOKUP_UNAVAILABLE"
  );
  assert.equal(calls, 1);
  await assert.rejects(
    dispatcher.manualRetry(task("ambiguous-closed")),
    (error) => error.code === "LUNA_DIRECT_IDEMPOTENCY_LOOKUP_UNAVAILABLE"
  );
  assert.equal(calls, 1, "manual retry must look up the prior ambiguous operation before resubmitting");
}

// A definitive not_found lookup permits resubmission; a found lookup returns
// the durable result without spending a second provider call.
{
  let calls = 0;
  const operationKeys = [];
  const dispatcher = createTestDispatcher({
    csmDirectConcurrency: 1,
    maxAttempts: 2,
    jitterRatio: 0,
    sleep: async () => {},
    lookupOperationResult: async (payload) => {
      operationKeys.push(payload.operation_key);
      return { status: "not_found" };
    },
    executeTask: async (payload) => {
      calls += 1;
      operationKeys.push(payload.operation_key);
      if (calls === 1) throw Object.assign(new Error("headers timeout"), { code: "UND_ERR_HEADERS_TIMEOUT" });
      return { title: "safe retry" };
    }
  });
  assert.deepEqual(await dispatcher.enqueue(task("ambiguous-not-found")), { title: "safe retry" });
  assert.equal(calls, 2);
  assert.equal(new Set(operationKeys).size, 1);
}

{
  let calls = 0;
  const dispatcher = createTestDispatcher({
    csmDirectConcurrency: 1,
    maxAttempts: 2,
    lookupOperationResult: async () => ({ status: "found", result: { title: "already committed" } }),
    executeTask: async () => {
      calls += 1;
      throw Object.assign(new Error("gateway timeout"), { status: 504 });
    }
  });
  assert.deepEqual(await dispatcher.enqueue(task("ambiguous-found")), { title: "already committed" });
  assert.equal(calls, 1);
}

process.stdout.write("luna direct dispatcher: ok\n");
