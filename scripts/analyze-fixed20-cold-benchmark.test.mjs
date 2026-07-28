#!/usr/bin/env node

import assert from "node:assert/strict";
import { analyzeFixed20ColdBenchmark } from "./analyze-fixed20-cold-benchmark.mjs";

const results = Array.from({ length: 20 }, (_, index) => ({
  job_id: `job-${index}`,
  ok: true,
  identity_cache_hit: false,
  provider_call_skipped: false,
  provider_calls: 1,
  recognition_benchmark_profile: "cold_algorithm_benchmark",
  reference_title: "2025 Topps Chrome Test Player #1 Gold /50",
  final_title: "2025 Topps Chrome Test Player #1 Gold /50",
  evaluation_decision_trace_packet: {
    trace_level: "evaluation",
    stage_execution: Object.fromEntries([
      "provider_observation",
      "normalization",
      "retrieval",
      "selection",
      "application",
      "resolver",
      "renderer"
    ].map((stage) => [stage, { status: "RAN", reason_code: "TEST_TRACE" }])),
    provider_observation_fields: { year: "2025" },
    normalization: { output: { year: "2025" } },
    retrieval: { top_k: [] }
  },
  provider_capacity_timeline: {
    provider_slot_held_before_provider_ms: 100,
    prepared_waiting_for_provider_ms: 50,
    provider_execution_ms: 1000,
    provider_slot_release_ms: 10
  }
}));

const audit = analyzeFixed20ColdBenchmark({
  summary: { ok_count: 20, l2_ready_count: 20, technical_failure_count: 0 },
  results
});
assert.equal(audit.passed, true);
assert.equal(audit.evaluation_trace_count, 20);
assert.equal(audit.evaluation_stage_trace_complete_count, 20);
assert.equal(audit.provider_capacity_timing.provider_execution_ms.total_ms, 20000);

const reconstructed = analyzeFixed20ColdBenchmark({
  summary: { ok_count: 20, l2_ready_count: 20, technical_failure_count: 0 },
  results: results.map((row) => ({
    ...row,
    provider_capacity_timeline: {
      provider_capacity_acquired_at: "2026-07-24T00:00:00.000Z",
      provider_capacity_released_at: "2026-07-24T00:00:02.100Z",
      provider_slot_held_before_provider_ms: null,
      provider_execution_ms: null
    },
    provider_slot_timing: {
      queued_at: "2026-07-24T00:00:00.100Z",
      started_at: "2026-07-24T00:00:00.500Z",
      completed_at: "2026-07-24T00:00:02.000Z",
      execution_ms: 1500
    }
  }))
});
assert.equal(reconstructed.provider_capacity_timing.provider_slot_held_before_provider_ms.p50_ms, 500);
assert.equal(reconstructed.provider_capacity_timing.prepared_waiting_for_provider_ms.p50_ms, 400);
assert.equal(reconstructed.provider_capacity_timing.provider_execution_ms.p50_ms, 1500);
assert.equal(reconstructed.provider_capacity_timing.provider_slot_release_ms.p50_ms, 100);

const invalid = analyzeFixed20ColdBenchmark({
  summary: { ok_count: 20, l2_ready_count: 20, technical_failure_count: 0 },
  results: results.map((row, index) => index === 0 ? { ...row, provider_calls: 0 } : row)
});
assert.equal(invalid.passed, false);
assert.equal(invalid.cache_violation_count, 1);

const missingStage = analyzeFixed20ColdBenchmark({
  summary: { ok_count: 20, l2_ready_count: 20, technical_failure_count: 0 },
  results: results.map((row, index) => index === 0
    ? {
      ...row,
      evaluation_decision_trace_packet: {
        ...row.evaluation_decision_trace_packet,
        stage_execution: {
          ...row.evaluation_decision_trace_packet.stage_execution,
          retrieval: { status: "TRACE_MISSING", reason_code: "RETRIEVAL_TRACE_NOT_PERSISTED" }
        }
      }
    }
    : row)
});
assert.equal(missingStage.passed, false);
assert.equal(missingStage.evaluation_stage_trace_complete_count, 19);

const ranEmptyRetrieval = analyzeFixed20ColdBenchmark({
  summary: { ok_count: 20, l2_ready_count: 20, technical_failure_count: 0 },
  results: results.map((row) => ({
    ...row,
    evaluation_decision_trace_packet: {
      ...row.evaluation_decision_trace_packet,
      stage_execution: {
        ...row.evaluation_decision_trace_packet.stage_execution,
        retrieval: { status: "RAN_EMPTY", reason_code: "RETRIEVAL_EXECUTED_NO_CANDIDATES" }
      },
      retrieval: { queries: ["no-match"], top_k: [], execution_status: "RAN_EMPTY" }
    }
  }))
});
assert.equal(ranEmptyRetrieval.passed, true);
assert.equal(ranEmptyRetrieval.evaluation_stage_trace_complete_count, 20);

console.log("fixed 20 cold benchmark audit tests passed");
