#!/usr/bin/env node

import assert from "node:assert/strict";
import { analyzeFixed20ColdBenchmark } from "./analyze-fixed20-cold-benchmark.mjs";
import {
  evaluationDecisionTraceSchemaVersion,
  evaluationReplaySnapshotSchemaVersion
} from "../lib/listing/evaluation/evaluation-decision-trace-packet.mjs";

const expectedGitSha = "0123456789abcdef0123456789abcdef01234567";

const results = Array.from({ length: 20 }, (_, index) => ({
  job_id: `job-${index}`,
  ok: true,
  identity_cache_hit: false,
  provider_call_skipped: false,
  provider_calls: 1,
  attempt_count: 1,
  retry_attempt_history: [],
  retry_error_codes: [],
  recognition_benchmark_profile: "cold_algorithm_benchmark",
  reference_title: "2025 Topps Chrome Test Player #1 Gold /50",
  final_title: "2025 Topps Chrome Test Player #1 Gold /50",
  evaluation_decision_trace_packet: {
    schema_version: evaluationDecisionTraceSchemaVersion,
    trace_level: "evaluation",
    benchmark_profile: "cold_algorithm_benchmark",
    deployment_git_sha: expectedGitSha,
    replay_snapshot: {
      schema_version: evaluationReplaySnapshotSchemaVersion,
      status: "COMPLETE",
      missing_components: []
    },
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
assert.equal(audit.expected_recognition_benchmark_profile, "cold_algorithm_benchmark");
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

const retriedJob = analyzeFixed20ColdBenchmark({
  summary: { ok_count: 20, l2_ready_count: 20, technical_failure_count: 0 },
  results: results.map((row, index) => index === 0
    ? {
        ...row,
        attempt_count: 2,
        retry_attempt_history: [{ code: "PROVIDER_TIMEOUT" }],
        retry_error_codes: ["PROVIDER_TIMEOUT"]
      }
    : row)
});
assert.equal(retriedJob.passed, false);
assert.equal(retriedJob.cache_violation_count, 1);

const targetedAssistResults = results.map((row, index) => {
  const targeted = {
    logical_stage: "TARGETED_VISUAL_OBSERVATION",
    attempt: 1,
    started_at: "2026-07-29T00:00:00.000Z",
    completed_at: "2026-07-29T00:00:01.500Z",
    latency_ms: 1500,
    provider_calls: 1,
    status: "COMPLETED",
    prompt_revision: "targeted-visual-read-only-v2",
    schema_revision: "targeted-visual-sparse-v2"
  };
  const full = {
    logical_stage: "FULL_PROVIDER_OBSERVATION",
    attempt: 1,
    started_at: "2026-07-29T00:00:01.500Z",
    completed_at: "2026-07-29T00:00:06.000Z",
    latency_ms: 4500,
    provider_calls: 1,
    status: "COMPLETED"
  };
  const fallback = index === 0;
  const providerCallLedger = fallback ? [targeted, full] : [targeted];
  return {
    ...row,
    provider_calls: fallback ? 2 : 1,
    recognition_benchmark_profile: "cold_targeted_assist_benchmark",
    evaluation_decision_trace_packet: {
      ...row.evaluation_decision_trace_packet,
      benchmark_profile: "cold_targeted_assist_benchmark"
    },
    provider_call_ledger: providerCallLedger,
    targeted_assist_execution: {
      final_observation_owner: fallback ? "FULL_PROVIDER_OBSERVATION" : "TARGETED_VISUAL_OBSERVATION",
      fallback_reason_code: fallback ? "TARGETED_REQUESTED_FIELD_MISSING" : null,
      provider_call_ledger: providerCallLedger
    }
  };
});
const targetedAssistAudit = analyzeFixed20ColdBenchmark({
  summary: { ok_count: 20, l2_ready_count: 20, technical_failure_count: 0 },
  results: targetedAssistResults
}, {
  expectedProfile: "cold_targeted_assist_benchmark",
  expectedGitSha
});
assert.equal(targetedAssistAudit.passed, true);
assert.equal(targetedAssistAudit.expected_recognition_benchmark_profile, "cold_targeted_assist_benchmark");
assert.equal(targetedAssistAudit.expected_deployment_git_sha, expectedGitSha);
assert.throws(() => analyzeFixed20ColdBenchmark({
  summary: { ok_count: 20, l2_ready_count: 20, technical_failure_count: 0 },
  results: targetedAssistResults
}, { expectedProfile: "cold_targeted_assist_benchmark" }), /fixed20_expected_git_sha_required_or_invalid/);
const mixedDeployment = analyzeFixed20ColdBenchmark({
  summary: { ok_count: 20, l2_ready_count: 20, technical_failure_count: 0 },
  results: targetedAssistResults.map((row, index) => index === 0
    ? {
        ...row,
        evaluation_decision_trace_packet: {
          ...row.evaluation_decision_trace_packet,
          deployment_git_sha: "f".repeat(40)
        }
      }
    : row)
}, {
  expectedProfile: "cold_targeted_assist_benchmark",
  expectedGitSha
});
assert.equal(mixedDeployment.passed, false);
assert.equal(mixedDeployment.integrity.deployment_git_sha_exact, false);
assert.throws(
  () => analyzeFixed20ColdBenchmark({}, { expectedProfile: "production_workload_benchmark" }),
  /unsupported_fixed20_benchmark_profile/
);

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
