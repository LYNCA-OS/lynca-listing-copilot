#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  buildEvaluationDecisionTracePacket,
  classifyEvaluationMissingField,
  evaluationTraceEnabled
} from "../lib/listing/evaluation/evaluation-decision-trace-packet.mjs";
import {
  applyRecognitionBenchmarkProfile,
  recognitionBenchmarkProfileIds
} from "../lib/listing/evaluation/recognition-benchmark-profile.mjs";

const payload = {
  provider_options: {
    recognition_benchmark_profile: "cold_algorithm_benchmark",
    trace_level: "evaluation"
  }
};
const constraintSnapshotHash = "b".repeat(64);
const forwardEnumerationCandidatePacket = {
  enumerator_version: "constraint-enumerator-v3",
  constraint_snapshot_version: "constraint-model-test-v1",
  constraint_snapshot_source_sha256: constraintSnapshotHash
};
assert.equal(evaluationTraceEnabled(payload), true);
assert.equal(applyRecognitionBenchmarkProfile({}, {
  profile: recognitionBenchmarkProfileIds.COLD_ALGORITHM
}).trace_level, "evaluation");
assert.equal(evaluationTraceEnabled({ provider_options: { recognition_benchmark_profile: "production_workload_benchmark", trace_level: "evaluation" } }), false);

const packet = buildEvaluationDecisionTracePacket({
  raw_provider_fields: { year: "2025", subject: "Test Player", ignored: "UNKNOWN" },
  raw_observed_fields: { year: "2025", subject: "Test Player" },
  resolved_fields: { year: "2025" },
  rendered_fields: { fields: { year: "2025" } },
  renderer: "deterministic",
  renderer_version: "v1",
  usage: { provider_calls: 1 },
  provider_call_skipped: false,
  knowledge_first_route_shadow: {
    route: "TARGETED_VISUAL_ASSIST",
    provider_aux_route_shadow: {
      schema_version: "provider-aux-route-shadow-v1",
      route: "TARGETED_MODEL_ASSIST",
      production_effect: "SHADOW_ONLY",
      title_effect: "NONE"
    }
  },
  retrieval: { query_fields: { year: "2025" } },
  candidate_control_plane_trace: {
    candidate_application_trace: [{
      candidate_id: "candidate-1",
      rank: 1,
      source: "official_catalog",
      source_trust: "OFFICIAL",
      selected: false,
      rejection_reasons: ["subject conflict"],
      blocked_fields: ["subject"]
    }]
  },
  recognition_preflight_diagnostics: {
    run: true,
    decision_reason: "preingestion_bundle_has_no_publishable_evidence",
    outcome_reason: null,
    shadow_only: true,
    skipped: false,
    worker_call_count: 1,
    evidence_field_count: 4,
    worker_execution_ms: 8400,
    join_wait_ms: 12,
    worker_finished_before_provider: true,
    worker_error_code: null
  }
}, payload);

assert.equal(packet.provider_observation_fields.year, "2025");
assert.equal(packet.schema_version, "evaluation-decision-trace-packet-v9");
assert.equal(packet.replay_snapshot.schema_version, "evaluation-replay-snapshot-v4");
assert.match(packet.replay_snapshot.versions.targeted_assist_nuisance_fingerprint, /^[0-9a-f]{64}$/);
assert.equal(
  packet.replay_snapshot.versions.targeted_assist_nuisance_contract,
  "targeted-assist-nuisance-fingerprint-v1"
);
assert.equal(packet.replay_snapshot.status, "PARTIAL");
assert.ok(packet.replay_snapshot.missing_components.includes("pipeline_fingerprint"));
assert.deepEqual(packet.replay_snapshot.provider_fields, { year: "2025", subject: "Test Player", ignored: "UNKNOWN" });
assert.equal(packet.replay_snapshot.normalization.decisions.find((row) => row.field === "ignored")?.decision, "DROP");
assert.deepEqual(packet.field_lineage.find((row) => row.field === "year")?.provider.values, ["2025"]);
assert.equal(packet.field_lineage.find((row) => row.field === "year")?.final_title_span.matched, false);
assert.equal(packet.retrieval.top_k[0].source_trust, "OFFICIAL");
assert.equal(packet.application[0].action, "BLOCK");
assert.equal(packet.resolver.dropped[0].field, "subject");
assert.equal(packet.recognition_preflight.shadow_only, true);
assert.equal(packet.recognition_preflight.worker_call_count, 1);
assert.equal(packet.recognition_preflight.evidence_field_count, 4);
assert.equal(packet.recognition_preflight.worker_execution_ms, 8400);
assert.equal(packet.provider_aux_route.route, "TARGETED_MODEL_ASSIST");
assert.equal(packet.provider_aux_route.observed_production_action, "RUN_FULL_PROVIDER");
assert.equal(packet.provider_aux_route.observed_provider_calls, 1);
assert.equal(packet.provider_aux_route.observed_provider_call_skipped, false);
assert.equal(classifyEvaluationMissingField(packet, "manufacturer"), "PROVIDER_NOT_OBSERVED");
assert.equal(classifyEvaluationMissingField({ ...packet, provider_observation_fields: { manufacturer: "Topps" }, normalization: { output: {} } }, "manufacturer"), "NORMALIZATION_DROPPED");
assert.equal(classifyEvaluationMissingField(packet, "year"), "CATALOG_NOT_RETRIEVED");
assert.equal(JSON.stringify(packet).includes("complete natural language response"), false);
assert.equal(JSON.stringify(packet).includes("raw_model_response"), false);
assert.equal(buildEvaluationDecisionTracePacket({}, {}), null);

const previousGitCommitSha = process.env.GIT_COMMIT_SHA;
const previousVercelGitCommitSha = process.env.VERCEL_GIT_COMMIT_SHA;
process.env.GIT_COMMIT_SHA = "d".repeat(40);
process.env.VERCEL_GIT_COMMIT_SHA = "d".repeat(40);
const deploymentPacket = buildEvaluationDecisionTracePacket({}, payload);
if (previousGitCommitSha === undefined) delete process.env.GIT_COMMIT_SHA;
else process.env.GIT_COMMIT_SHA = previousGitCommitSha;
if (previousVercelGitCommitSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
else process.env.VERCEL_GIT_COMMIT_SHA = previousVercelGitCommitSha;
assert.equal(deploymentPacket.deployment_git_sha, "d".repeat(40));

const targetedPayload = {
  provider_options: applyRecognitionBenchmarkProfile({}, {
    profile: recognitionBenchmarkProfileIds.COLD_TARGETED_ASSIST
  })
};
assert.equal(evaluationTraceEnabled(targetedPayload), true);
const targetedPacket = buildEvaluationDecisionTracePacket({
  raw_provider_fields: { year: "2024", players: ["Test Player"], set: "Test Insert" },
  usage: { provider_calls: 1 },
  provider_call_skipped: false,
  provider_call_ledger: [{
    logical_stage: "TARGETED_VISUAL_OBSERVATION",
    attempt: 1,
    started_at: "2026-07-29T00:00:00.000Z",
    completed_at: "2026-07-29T00:00:01.500Z",
    provider_calls: 1,
    output_tokens: 54
  }],
  targeted_assist_execution: {
    enabled: true,
    final_observation_owner: "TARGETED_VISUAL_OBSERVATION",
    fallback_reason_code: null,
    provider_call_ledger: [{
      logical_stage: "TARGETED_VISUAL_OBSERVATION",
      attempt: 1,
      started_at: "2026-07-29T00:00:00.000Z",
      completed_at: "2026-07-29T00:00:01.500Z",
      provider_calls: 1,
      output_tokens: 54
    }]
  },
  knowledge_first_route_shadow: {
    route: "TARGETED_VISUAL_ASSIST",
    provider_aux_route_shadow: {
      schema_version: "provider-aux-route-shadow-v2",
      route: "TARGETED_MODEL_ASSIST",
      production_effect: "SHADOW_ONLY",
      title_effect: "NONE"
    }
  }
}, targetedPayload);
assert.equal(targetedPacket.benchmark_profile, recognitionBenchmarkProfileIds.COLD_TARGETED_ASSIST);
assert.equal(targetedPacket.targeted_assist_execution.final_observation_owner, "TARGETED_VISUAL_OBSERVATION");
assert.equal(targetedPacket.provider_aux_route.observed_production_action, "RUN_TARGETED_VISUAL_PROVIDER");
assert.equal(targetedPacket.provider_aux_route.observed_targeted_visual_provider_calls, 1);
assert.equal(targetedPacket.provider_aux_route.observed_full_provider_calls, 0);
assert.equal(JSON.stringify(targetedPacket).includes("raw model prose"), false);

const completeReplayPacket = buildEvaluationDecisionTracePacket({
  raw_provider_fields: { year: "2025", players: ["Test Player"] },
  raw_provider_field_evidence: [],
  raw_observed_fields: { year: "2025", players: ["Test Player"] },
  normalized_evidence: {
    year: {
      value: "2025",
      normalized_value: "2025",
      status: "CONFIRMED",
      candidates: [{
        value: "2025",
        confidence: 0.95,
        sources: [{ source_type: "OCR", observed_text: "2025" }]
      }],
      sources: [{ source_type: "OCR", observed_text: "2025" }]
    }
  },
  resolved_fields: { year: "2025", players: ["Test Player"] },
  rendered_fields: { fields: { year: "2025", players: ["Test Player"] } },
  final_title: "2025 Test Player",
  renderer_version: "renderer-v1",
  normalization_version: "normalization-v1",
  resolver_version: "resolver-v1",
  identity_cache: { recognition_pipeline_fingerprint: "a".repeat(64) },
  effective_terminal_renderer_inputs: {
    max_title_length: 80,
    serial_numerator_verified: null,
    trust_resolved_print_run_without_evidence: true,
    source: "v4_result_adapter"
  },
  retrieval_application: {
    enabled: false,
    decisions: []
  },
  forward_enumeration_trace: [{ field: "product", status: "UNKNOWN", rule_id: "set_not_in_model" }],
  forward_enumeration_candidate_packet: forwardEnumerationCandidatePacket
}, payload);
assert.equal(completeReplayPacket.replay_snapshot.status, "COMPLETE");
assert.equal(completeReplayPacket.replay_snapshot.versions.recognition_pipeline_fingerprint, "a".repeat(64));
assert.equal(completeReplayPacket.replay_snapshot.derivation_provenance[0].status, "UNKNOWN");
assert.equal(completeReplayPacket.replay_snapshot.effective_terminal_renderer_inputs.serial_numerator_verified, null);
assert.equal(
  completeReplayPacket.replay_snapshot.normalized_evidence.year.candidates[0].sources[0].source_type,
  "OCR"
);

const missingReplayEvidenceArrays = buildEvaluationDecisionTracePacket({
  raw_provider_fields: { year: "2025", players: ["Test Player"] },
  raw_observed_fields: { year: "2025", players: ["Test Player"] },
  normalized_evidence: completeReplayPacket.replay_snapshot.normalized_evidence,
  resolved_fields: { year: "2025", players: ["Test Player"] },
  rendered_fields: { fields: { year: "2025", players: ["Test Player"] } },
  final_title: "2025 Test Player",
  renderer_version: "renderer-v1",
  normalization_version: "normalization-v1",
  resolver_version: "resolver-v1",
  identity_cache: { recognition_pipeline_fingerprint: "a".repeat(64) },
  effective_terminal_renderer_inputs: {
    max_title_length: 80,
    serial_numerator_verified: null,
    trust_resolved_print_run_without_evidence: true
  },
  retrieval_application: { enabled: false, decisions: [] },
  forward_enumeration_candidate_packet: forwardEnumerationCandidatePacket
}, payload);
assert.equal(missingReplayEvidenceArrays.replay_snapshot.status, "PARTIAL");
assert.ok(missingReplayEvidenceArrays.replay_snapshot.missing_components.includes("provider_field_evidence"));
assert.ok(missingReplayEvidenceArrays.replay_snapshot.missing_components.includes("derivation_provenance"));

const productionCandidateTrace = buildEvaluationDecisionTracePacket({
  source_feedback_id: "feedback-current-card",
  raw_provider_fields: { year: "2025" },
  raw_observed_fields: { year: "2025" },
  resolved_fields: { year: "2025" },
  rendered_fields: { fields: { year: "2025" } },
  final_title: "2025 Topps Test Player",
  l2_candidate_debug: {
    selected_candidate_id: "catalog-1",
    candidate_application_trace: [{
      candidate_id: "catalog-1",
      candidate_lane: "catalog",
      source_type: "INTERNAL_APPROVED_HISTORY",
      source_trust: "APPROVED_REFERENCE",
      source_feedback_id_sha256: crypto.createHash("sha256").update("feedback-other-card").digest("hex")
    }],
    retrieval_application: {
      decisions: [{
        candidate_id: "catalog-1",
        field: "year",
        candidate_value: "2025",
        decision: "SUPPORT",
        reason: "selected_identity_matches_current_field"
      }]
    }
  }
}, payload);
assert.equal(productionCandidateTrace.retrieval.candidate_count, 1);
assert.equal(productionCandidateTrace.retrieval.top_k[0].selected, true);
assert.equal(
  productionCandidateTrace.self_retrieval_exclusion.source_feedback_id_sha256,
  crypto.createHash("sha256").update("feedback-current-card").digest("hex")
);
assert.equal(productionCandidateTrace.self_retrieval_exclusion.top_k_checked_count, 1);
assert.equal(productionCandidateTrace.self_retrieval_exclusion.all_candidate_count, 1);
assert.equal(productionCandidateTrace.self_retrieval_exclusion.all_candidates_checked_count, 1);
assert.equal(productionCandidateTrace.self_retrieval_exclusion.candidate_check_truncated, false);
assert.equal(productionCandidateTrace.self_retrieval_exclusion.candidate_source_id_observable_count, 1);
assert.equal(productionCandidateTrace.self_retrieval_exclusion.unobservable_reviewed_candidate_count, 0);
assert.equal(productionCandidateTrace.self_retrieval_exclusion.same_source_candidate_count, 0);
assert.equal(JSON.stringify(productionCandidateTrace).includes("feedback-current-card"), false);
assert.equal(productionCandidateTrace.field_lineage.find((row) => row.field === "year")?.retrieval.decisions[0].value, "2025");
assert.equal(productionCandidateTrace.field_lineage.find((row) => row.field === "year")?.final_title_span.matched, true);

const sameSourceCandidateTrace = buildEvaluationDecisionTracePacket({
  source_feedback_id: "feedback-current-card",
  candidate_application_trace: [{
    candidate_id: "self-row",
    candidate_lane: "catalog",
    source_type: "INTERNAL_CORRECTED_TITLE",
    source_feedback_id_sha256: crypto.createHash("sha256").update("feedback-current-card").digest("hex")
  }]
}, payload);
assert.equal(sameSourceCandidateTrace.self_retrieval_exclusion.same_source_candidate_count, 1);
assert.deepEqual(sameSourceCandidateTrace.self_retrieval_exclusion.same_source_candidate_ids, ["self-row"]);

const nativeCoreCandidateTrace = buildEvaluationDecisionTracePacket({
  raw_provider_fields: { year: "2025" },
  raw_observed_fields: { year: "2025" },
  resolved_fields: { year: "2025" },
  rendered_fields: { fields: { year: "2025" } },
  final_title: "2025 Topps Test Player",
  selected_candidate_decision: { selected_candidate_id: "catalog-native-1" },
  candidate_application_trace: [{
    candidate_id: "catalog-native-1",
    candidate_lane: "catalog",
    source_type: "INTERNAL_APPROVED_HISTORY",
    source_trust: "APPROVED_REFERENCE"
  }],
  retrieval_application: {
    decisions: [{
      candidate_id: "catalog-native-1",
      field: "year",
      candidate_value: "2025",
      decision: "SUPPORT",
      reason: "selected_identity_matches_current_field"
    }]
  }
}, payload);
assert.equal(nativeCoreCandidateTrace.retrieval.candidate_count, 1);
assert.equal(nativeCoreCandidateTrace.retrieval.top_k[0].selected, true);
assert.equal(nativeCoreCandidateTrace.field_lineage.find((row) => row.field === "year")?.retrieval.decisions[0].value, "2025");

console.log("evaluation decision trace packet tests passed");
