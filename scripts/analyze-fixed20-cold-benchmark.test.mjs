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
    provider_observation_fields: { year: "2025" },
    normalization: { output: { year: "2025" } }
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
assert.equal(audit.provider_capacity_timing.provider_execution_ms.total_ms, 20000);

const invalid = analyzeFixed20ColdBenchmark({
  summary: { ok_count: 20, l2_ready_count: 20, technical_failure_count: 0 },
  results: results.map((row, index) => index === 0 ? { ...row, provider_calls: 0 } : row)
});
assert.equal(invalid.passed, false);
assert.equal(invalid.cache_violation_count, 1);

console.log("fixed 20 cold benchmark audit tests passed");
