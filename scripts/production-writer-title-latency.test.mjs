#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { CSM_ACTIVE_MODEL_PROFILE } from "../lib/listing/thin/csm-model-profile.mjs";
import {
  buildWriterEditableTitleLatencyReceipt,
  evaluateWriterEditableTitleLatencyOptimizationGate,
  summarizeWriterEditableTitleLatency,
  WRITER_EDITABLE_TITLE_LATENCY_LIMITS
} from "./production-writer-title-latency.mjs";

const sampleHash = (value) => createHash("sha256").update(value).digest("hex");

function receipt({ id, latencyMs, lane = "NORMAL" }) {
  const uploadStartedAtMs = 1_000_000;
  const responsePart = Math.max(0, latencyMs - 250);
  return buildWriterEditableTitleLatencyReceipt({
    caseId: id,
    lane,
    sampleIdSha256: sampleHash(id),
    uploadStartedAtMs,
    recognitionResponseAtMs: uploadStartedAtMs + responsePart,
    titleEditableAtMs: uploadStartedAtMs + latencyMs,
    executionOrigin: "FRESH_CURRENT",
    providerAttemptNumber: 1,
    providerRetryCount: 0
  });
}

assert.equal(CSM_ACTIVE_MODEL_PROFILE.reasoning_effort, "low");
assert.equal(CSM_ACTIVE_MODEL_PROFILE.image_detail, "high");

const within = receipt({ id: "within", latencyMs: 7_500 });
assert.equal(within.upload_to_recognition_response_ms, 7_250);
assert.equal(within.recognition_response_to_editable_title_ms, 250);
assert.equal(within.upload_to_editable_title_ms, 7_500);
assert.equal(within.classification, "WITHIN_DIAGNOSTIC_TARGET");
assert.equal(within.hard_limit_ms,
  WRITER_EDITABLE_TITLE_LATENCY_LIMITS.normal_single_case_hard_ms);
assert.equal(receipt({ id: "normal-boundary", latencyMs: 20_000 }).hard_limit_passed, true);
assert.equal(receipt({ id: "normal-over", latencyMs: 20_001 }).hard_limit_passed, false);
assert.equal(receipt({
  id: "large-boundary", latencyMs: 30_000, lane: "LARGE_STAGED_TRANSPORT"
}).hard_limit_passed, true);
assert.equal(receipt({
  id: "large-over", latencyMs: 30_001, lane: "LARGE_STAGED_TRANSPORT"
}).hard_limit_passed, false);

assert.throws(() => buildWriterEditableTitleLatencyReceipt({
  caseId: "replayed",
  lane: "NORMAL",
  sampleIdSha256: sampleHash("replayed"),
  uploadStartedAtMs: 1,
  recognitionResponseAtMs: 2,
  titleEditableAtMs: 3,
  executionOrigin: "REPLAYED",
  providerAttemptNumber: 1,
  providerRetryCount: 0
}), /writer_title_latency_execution_origin/);
assert.throws(() => buildWriterEditableTitleLatencyReceipt({
  caseId: "retry",
  lane: "NORMAL",
  sampleIdSha256: sampleHash("retry"),
  uploadStartedAtMs: 1,
  recognitionResponseAtMs: 2,
  titleEditableAtMs: 3,
  executionOrigin: "FRESH_CURRENT",
  providerAttemptNumber: 1,
  providerRetryCount: 1
}), /writer_title_latency_attempt_contract/);

const smoke = summarizeWriterEditableTitleLatency([
  receipt({ id: "smoke-1", latencyMs: 6_000 }),
  receipt({ id: "smoke-2", latencyMs: 7_000 }),
  receipt({ id: "smoke-3", latencyMs: 10_000 }),
  receipt({ id: "smoke-4", latencyMs: 11_000, lane: "LARGE_STAGED_TRANSPORT" })
]);
assert.equal(smoke.sample_count, 4);
assert.equal(smoke.p50_ms, 7_000);
assert.equal(smoke.p95_ms, 11_000);
assert.equal(smoke.diagnostic_only, true,
  "a four-case Writer Journey smoke must not trigger an optimization decision");
assert.equal(smoke.optimization_sample_eligible, false);
assert.equal(smoke.hard_limit_passed, true);

const cohort = (prefix, latencyMs) => ({
  cohort_id: prefix,
  receipts: Array.from({ length: 30 }, (_, index) => receipt({
    id: `${prefix}-${index}`,
    latencyMs
  }))
});
const slowA = cohort("slow-a", 8_001);
const slowB = cohort("slow-b", 12_001);
const gate = evaluateWriterEditableTitleLatencyOptimizationGate([slowA, slowB]);
assert.equal(gate.evidence_eligible, true);
assert.equal(gate.cohorts_non_overlapping, true);
assert.equal(gate.optimization_required, true);
assert.equal(gate.optimization_policy, "QUALITY_PRESERVING_ONLY");

const fast = cohort("fast", 7_000);
assert.equal(
  evaluateWriterEditableTitleLatencyOptimizationGate([slowA, fast]).optimization_required,
  false,
  "both independent cohorts must breach a diagnostic threshold"
);
const overlapping = {
  ...slowB,
  receipts: [slowA.receipts[0], ...slowB.receipts.slice(1)]
};
const overlapGate = evaluateWriterEditableTitleLatencyOptimizationGate([slowA, overlapping]);
assert.equal(overlapGate.cohorts_non_overlapping, false);
assert.equal(overlapGate.evidence_eligible, false);
assert.equal(overlapGate.optimization_required, false);
assert.throws(() => evaluateWriterEditableTitleLatencyOptimizationGate([
  summarizeWriterEditableTitleLatency(slowA.receipts, { cohortId: "slow-a" }),
  summarizeWriterEditableTitleLatency(slowB.receipts, { cohortId: "slow-b" })
]), /writer_title_latency_gate_cohorts_invalid/,
"the optimization gate must reject summaries and recompute percentiles from raw receipts");

const handEditedReceipt = {
  ...slowB.receipts[0],
  upload_to_editable_title_ms: 1,
  classification: "WITHIN_DIAGNOSTIC_TARGET"
};
assert.throws(() => evaluateWriterEditableTitleLatencyOptimizationGate([
  slowA,
  { ...slowB, receipts: [handEditedReceipt, ...slowB.receipts.slice(1)] }
]), /writer_title_latency_gate_cohorts_invalid/,
"the gate must reject a hand-edited receipt whose latency partition no longer reconciles");

process.stdout.write("Writer editable-title latency contract: ok\n");
