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
    normalization: { output: { year: "2025" } },
    knowledge_first_route: {
      production_effect: "SHADOW_ONLY",
      production_action: "RUN_FULL_PROVIDER",
      complete_title_output_allowed: false,
      route: index % 2 === 0 ? "DETERMINISTIC_FINAL" : "KNOWLEDGE_ASSIST",
      model_call_budget: index % 2,
      visual_field_targets: [],
      knowledge_field_targets: index % 2 ? ["product"] : []
    }
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
assert.equal(audit.schema_version, "fixed20-cold-algorithm-audit-v2");
assert.equal(audit.knowledge_first_route.trace_count, 20);
assert.equal(audit.knowledge_first_route.route_counts.DETERMINISTIC_FINAL, 10);
assert.equal(audit.knowledge_first_route.route_counts.KNOWLEDGE_ASSIST, 10);
assert.equal(audit.knowledge_first_route.zero_model_call_count, 10);
assert.equal(audit.knowledge_first_route.targeted_model_assist_count, 10);
assert.equal(audit.knowledge_first_route.knowledge_target_counts.product, 10);
assert.equal(audit.knowledge_first_route.shadow_safety_violation_count, 0);

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

const unsafeRoute = analyzeFixed20ColdBenchmark({
  summary: { ok_count: 20, l2_ready_count: 20, technical_failure_count: 0 },
  results: results.map((row, index) => index === 0
    ? {
      ...row,
      evaluation_decision_trace_packet: {
        ...row.evaluation_decision_trace_packet,
        knowledge_first_route: {
          ...row.evaluation_decision_trace_packet.knowledge_first_route,
          production_action: "SKIP_PROVIDER"
        }
      }
    }
    : row)
});
assert.equal(unsafeRoute.passed, false);
assert.equal(unsafeRoute.knowledge_first_route.shadow_safety_violation_count, 1);

console.log("fixed 20 cold benchmark audit tests passed");
