#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createTimingContext,
  compactRecognitionCriticalPath,
  markRecognitionBoundary,
  recordProviderAttempt,
  setRecognitionPathIntent,
  setRecognitionPathOutcome,
  snapshotRecognitionCriticalPath
} from "../lib/listing/pipeline/timing.mjs";
import { runTimedProviderCall } from "../lib/listing/pipeline/provider-stage.mjs";
import {
  clearProviderConcurrencyForTests,
  providerConcurrencyStats
} from "../lib/listing/providers/provider-concurrency.mjs";

function context() {
  return createTimingContext({
    asset_id: "asset-critical-path",
    recognition_session_id: "session-critical-path",
    images: [{ image_id: "image-1" }]
  });
}

function at(timingContext, offsetMs) {
  return timingContext.started_at_ms + offsetMs;
}

function completeFullPath(timingContext) {
  setRecognitionPathIntent(timingContext, {
    pathKind: "FULL_PROVIDER",
    providerExpected: true,
    identityCacheStageExpected: true
  });
  markRecognitionBoundary(timingContext, "full_path_started", { atMs: at(timingContext, 10) });
  recordProviderAttempt(timingContext, {
    queuedAtMs: at(timingContext, 20),
    startedAtMs: at(timingContext, 30),
    completedAtMs: at(timingContext, 50)
  });
  markRecognitionBoundary(timingContext, "decision_ready", { atMs: at(timingContext, 60) });
  markRecognitionBoundary(timingContext, "identity_cache_stage_completed", { atMs: at(timingContext, 70) });
  markRecognitionBoundary(timingContext, "core_terminal_ready", { atMs: at(timingContext, 80) });
  markRecognitionBoundary(timingContext, "response_built", { atMs: at(timingContext, 100) });
}

test("complete critical path is non-overlapping and sums to total wall time", () => {
  const timingContext = context();
  completeFullPath(timingContext);
  const snapshot = snapshotRecognitionCriticalPath(timingContext);
  assert.equal(snapshot.status, "COMPLETE");
  assert.equal(snapshot.total_wall_ms, 100);
  assert.equal(snapshot.measured_segment_union_ms, 100);
  assert.equal(snapshot.unattributed_wall_ms, 0);
  assert.equal(snapshot.provider_active_union_ms, 20);
  assert.equal(snapshot.provider_internal_gap_ms, 0);
  assert.equal(snapshot.scope, "NATIVE_RECOGNITION_CORE");
  assert.ok(snapshot.excludes.includes("SESSION_PERSISTENCE"));
  assert.equal(Object.values(snapshot.segments).reduce((sum, segment) => sum + segment.duration_ms, 0), 100);
  assert.equal(Object.isFrozen(snapshot), true);
});

test("duplicate boundaries are first-write-wins and visible as invalid telemetry", () => {
  const timingContext = context();
  setRecognitionPathIntent(timingContext, {
    pathKind: "DETERMINISTIC_FAST_FINAL",
    providerExpected: false,
    identityCacheStageExpected: true
  });
  markRecognitionBoundary(timingContext, "full_path_started", { atMs: at(timingContext, 10) });
  markRecognitionBoundary(timingContext, "full_path_started", { atMs: at(timingContext, 20) });
  const snapshot = snapshotRecognitionCriticalPath(timingContext);
  assert.equal(snapshot.boundaries.full_path_started.offset_ms, 10);
  assert.equal(snapshot.status, "INVALID");
  assert.equal(snapshot.anomalies[0].code, "DUPLICATE_BOUNDARY_IGNORED");
  assert.equal(snapshot.anomalies[0].attempt, null);
});

test("non-monotonic boundaries stay invalid instead of being clamped to zero", () => {
  const timingContext = context();
  setRecognitionPathIntent(timingContext, {
    pathKind: "FULL_PROVIDER",
    providerExpected: true,
    identityCacheStageExpected: false
  });
  markRecognitionBoundary(timingContext, "full_path_started", { atMs: at(timingContext, 50) });
  recordProviderAttempt(timingContext, {
    queuedAtMs: at(timingContext, 40),
    startedAtMs: at(timingContext, 45),
    completedAtMs: at(timingContext, 60)
  });
  markRecognitionBoundary(timingContext, "decision_ready", { atMs: at(timingContext, 70) });
  markRecognitionBoundary(timingContext, "core_terminal_ready", { atMs: at(timingContext, 80) });
  markRecognitionBoundary(timingContext, "response_built", { atMs: at(timingContext, 90) });
  const snapshot = snapshotRecognitionCriticalPath(timingContext);
  assert.equal(snapshot.status, "INVALID");
  assert.equal(snapshot.segments.full_path_to_provider_waiting.status, "INVALID");
  assert.equal(snapshot.segments.full_path_to_provider_waiting.duration_ms, null);
});

test("missing required boundaries are explicit partial telemetry", () => {
  const timingContext = context();
  setRecognitionPathIntent(timingContext, {
    pathKind: "FULL_PROVIDER",
    providerExpected: true,
    identityCacheStageExpected: true
  });
  markRecognitionBoundary(timingContext, "full_path_started", { atMs: at(timingContext, 10) });
  const snapshot = snapshotRecognitionCriticalPath(timingContext);
  assert.equal(snapshot.status, "PARTIAL");
  assert.ok(snapshot.missing_boundary_ids.includes("provider_started"));
  assert.ok(snapshot.missing_boundary_ids.includes("response_built"));
});

test("multiple provider attempts expose active union and internal gaps", () => {
  const timingContext = context();
  setRecognitionPathIntent(timingContext, {
    pathKind: "FULL_PROVIDER",
    providerExpected: true,
    identityCacheStageExpected: false
  });
  markRecognitionBoundary(timingContext, "full_path_started", { atMs: at(timingContext, 10) });
  recordProviderAttempt(timingContext, {
    queuedAtMs: at(timingContext, 20),
    startedAtMs: at(timingContext, 30),
    completedAtMs: at(timingContext, 50)
  });
  recordProviderAttempt(timingContext, {
    queuedAtMs: at(timingContext, 55),
    startedAtMs: at(timingContext, 60),
    completedAtMs: at(timingContext, 90)
  });
  markRecognitionBoundary(timingContext, "decision_ready", { atMs: at(timingContext, 100) });
  markRecognitionBoundary(timingContext, "core_terminal_ready", { atMs: at(timingContext, 110) });
  markRecognitionBoundary(timingContext, "response_built", { atMs: at(timingContext, 120) });
  const snapshot = snapshotRecognitionCriticalPath(timingContext);
  assert.equal(snapshot.provider_attempts.length, 2);
  assert.equal(snapshot.provider_active_union_ms, 50);
  assert.equal(snapshot.provider_envelope_ms, 60);
  assert.equal(snapshot.provider_internal_gap_ms, 10);
});

test("exact replay has no fabricated provider or cache stage", () => {
  const timingContext = context();
  setRecognitionPathIntent(timingContext, {
    pathKind: "EXACT_REPLAY",
    providerExpected: false,
    identityCacheStageExpected: false
  });
  markRecognitionBoundary(timingContext, "decision_ready", { atMs: at(timingContext, 10) });
  markRecognitionBoundary(timingContext, "core_terminal_ready", { atMs: at(timingContext, 20) });
  markRecognitionBoundary(timingContext, "response_built", { atMs: at(timingContext, 30) });
  const snapshot = snapshotRecognitionCriticalPath(timingContext);
  assert.equal(snapshot.status, "COMPLETE");
  assert.equal(snapshot.provider_expected, false);
  assert.equal(snapshot.identity_cache_stage_expected, false);
  assert.equal(snapshot.provider_attempts.length, 0);
  assert.deepEqual(Object.keys(snapshot.segments), [
    "core_to_decision",
    "decision_to_core_terminal",
    "core_terminal_to_response"
  ]);
  assert.equal(snapshot.unattributed_wall_ms, 0);
  assert.equal(snapshot.provider_stage_status, "NOT_APPLICABLE");
  assert.equal(snapshot.provider_active_union_ms, null);
});

test("authoritative full-provider intent cannot be inferred away when instrumentation is missing", () => {
  const timingContext = context();
  setRecognitionPathIntent(timingContext, {
    pathKind: "FULL_PROVIDER",
    providerExpected: true,
    identityCacheStageExpected: true
  });
  markRecognitionBoundary(timingContext, "full_path_started", { atMs: at(timingContext, 10) });
  markRecognitionBoundary(timingContext, "decision_ready", { atMs: at(timingContext, 20) });
  markRecognitionBoundary(timingContext, "core_terminal_ready", { atMs: at(timingContext, 30) });
  markRecognitionBoundary(timingContext, "response_built", { atMs: at(timingContext, 40) });
  const snapshot = snapshotRecognitionCriticalPath(timingContext);
  assert.equal(snapshot.status, "PARTIAL");
  assert.equal(snapshot.provider_expected, true);
  assert.equal(snapshot.identity_cache_stage_expected, true);
  assert.ok(snapshot.missing_boundary_ids.includes("provider_started"));
  assert.ok(snapshot.missing_boundary_ids.includes("identity_cache_stage_completed"));
});

test("unknown route intent stays partial and compact summary omits hot-path detail", () => {
  const timingContext = context();
  markRecognitionBoundary(timingContext, "decision_ready", { atMs: at(timingContext, 10) });
  markRecognitionBoundary(timingContext, "core_terminal_ready", { atMs: at(timingContext, 20) });
  markRecognitionBoundary(timingContext, "response_built", { atMs: at(timingContext, 30) });
  const snapshot = snapshotRecognitionCriticalPath(timingContext);
  assert.equal(snapshot.status, "PARTIAL");
  assert.deepEqual(snapshot.missing_contract_fields, [
    "path_kind",
    "provider_expected",
    "identity_cache_stage_expected"
  ]);
  const compact = compactRecognitionCriticalPath(snapshot);
  assert.equal(compact.total_wall_ms, 30);
  assert.equal("boundaries" in compact, false);
  assert.equal("provider_attempts" in compact, false);
  assert.deepEqual(compactRecognitionCriticalPath(compact), compact);
});

test("missing provider timestamps remain invalid instead of becoming the Unix epoch", () => {
  const timingContext = context();
  setRecognitionPathIntent(timingContext, {
    pathKind: "FULL_PROVIDER",
    providerExpected: true,
    identityCacheStageExpected: true
  });
  const attempt = recordProviderAttempt(timingContext, {
    queuedAtMs: at(timingContext, 10),
    startedAtMs: null,
    completedAtMs: null,
    status: "FAILED"
  });
  assert.equal(attempt.valid, false);
  assert.equal(attempt.started_at, null);
  assert.equal(attempt.completed_at, null);
});

test("failure outcome is explicit and does not alter route intent", () => {
  const timingContext = context();
  setRecognitionPathIntent(timingContext, {
    pathKind: "FULL_PROVIDER",
    providerExpected: true,
    identityCacheStageExpected: true
  });
  setRecognitionPathOutcome(timingContext, { status: "FAILED", reason: "HTTP 520" });
  const snapshot = snapshotRecognitionCriticalPath(timingContext);
  assert.equal(snapshot.path_kind, "FULL_PROVIDER");
  assert.equal(snapshot.termination_status, "FAILED");
  assert.equal(snapshot.termination_reason, "HTTP_520");
  assert.equal(snapshot.status, "PARTIAL");
});

test("provider stage records successful and failed attempts without changing thrown errors", async () => {
  clearProviderConcurrencyForTests();
  const successContext = context();
  const success = await runTimedProviderCall("critical-path-test", successContext, async () => ({ value: 1 }));
  assert.equal(success.value, 1);
  assert.equal(successContext.recognition_critical_path.provider_attempts.length, 1);
  assert.equal(successContext.recognition_critical_path.provider_attempts[0].status, "COMPLETED");

  const failureContext = context();
  const original = Object.assign(new Error("synthetic provider failure"), { code: "SYNTHETIC_PROVIDER_FAILURE" });
  await assert.rejects(
    runTimedProviderCall("critical-path-test", failureContext, async () => { throw original; }),
    (error) => error === original
  );
  assert.equal(failureContext.recognition_critical_path.provider_attempts.length, 1);
  assert.equal(failureContext.recognition_critical_path.provider_attempts[0].status, "FAILED");
  assert.equal(failureContext.recognition_critical_path.provider_attempts[0].error_code, "SYNTHETIC_PROVIDER_FAILURE");
  assert.equal(providerConcurrencyStats()["critical-path-test"].active, 0);
  clearProviderConcurrencyForTests();
});

test("critical path telemetry does not enter Provider scheduling or Queue lease owners", async () => {
  const forbidden = /recognition_critical_path|markRecognitionBoundary|recordProviderAttempt/;
  for (const path of [
    "lib/listing/providers/provider-concurrency.mjs",
    "lib/listing/v4/jobs/provider-capacity-timeline.mjs",
    "lib/listing/v4/jobs/production-job-queue.mjs",
    "api/v4/listing-job-worker.js"
  ]) {
    assert.doesNotMatch(await readFile(path, "utf8"), forbidden, `${path} must retain its existing owner boundary`);
  }
});

console.log("recognition critical path tests passed");
