import assert from "node:assert/strict";

import {
  providerRuntimeSummary,
  terminalEvaluationDecisionTracePacket
} from "../api/v4/listing-copilot-title.js";
import { identityResolverPolicyVersion } from "../lib/identity-resolution/listing-resolution-gate.mjs";
import { candidateSelectionHeuristicVersion } from "../lib/listing/candidates/candidate-selection-pass.mjs";
import { buildEvaluationDecisionTracePacket } from "../lib/listing/evaluation/evaluation-decision-trace-packet.mjs";
import { __listingCopilotTitleTestHooks } from "../lib/listing/v4/pipeline/native-recognition-core.mjs";

const payload = {
  maxTitleLength: 80,
  provider_options: {
    recognition_benchmark_profile: "cold_algorithm",
    trace_level: "evaluation"
  }
};
const result = {
  provider: "openai_legacy",
  raw_provider_fields: {
    year: "2025",
    manufacturer: "Panini",
    players: ["Test Player"]
  },
  raw_provider_field_evidence: [],
  forward_enumeration_trace: [],
  forward_enumeration_candidate_packet: {
    enumerator_version: "constraint-enumerator-v3",
    constraint_snapshot_version: "constraint-model-test-v1",
    constraint_snapshot_source_sha256: "b".repeat(64)
  },
  raw_observed_fields: {
    year: "2025",
    manufacturer: "Panini",
    players: ["Test Player"]
  },
  normalized_evidence: {
    year: {
      value: "2025",
      normalized_value: "2025",
      status: "CONFIRMED",
      candidates: [{
        value: "2025",
        confidence: 0.99,
        sources: [{ source_type: "OCR", observed_text: "2025" }]
      }],
      sources: [{ source_type: "OCR", observed_text: "2025" }]
    }
  },
  resolved: {
    year: "2025",
    manufacturer: "Panini",
    players: ["Test Player"]
  },
  resolved_fields: {
    year: "2025",
    manufacturer: "Panini",
    players: ["Test Player"]
  },
  rendered_fields: {
    fields: {
      year: "2025",
      manufacturer: "Panini",
      players: ["Test Player"]
    }
  },
  final_title: "stale pre-adapter title",
  evidence: {},
  normalization_version: "test-normalizer-v1",
  candidate_policy_version: candidateSelectionHeuristicVersion,
  resolver_version: identityResolverPolicyVersion,
  renderer_version: "test-renderer-v1",
  recognition_pipeline_fingerprint: "a".repeat(64),
  retrieval_application: {
    enabled: false,
    decisions: []
  },
  knowledge_first_route_shadow: {
    schema_version: "knowledge-first-route-decision-v1",
    production_effect: "SHADOW_ONLY",
    production_action: "RUN_FULL_PROVIDER",
    counterfactual_action: "KNOWLEDGE_ASSIST",
    route: "KNOWLEDGE_ASSIST"
  },
  world_knowledge_shadow_assist: {
    schema_version: "world-knowledge-shadow-assist-v1",
    mode: "POST_OBSERVATION_SHADOW_ONLY",
    requested: true,
    execution_status: "NOT_RUN",
    execution_reason: "separate_shadow_provider_not_implemented",
    paid_provider_calls: 0,
    resolver_effect: "NONE",
    title_effect: "NONE",
    input_hash: "c".repeat(64),
    input: {
      schema_version: "read_only_sparse_v4",
      fields: { year: "2025", manufacturer: "Panini", players: ["Test Player"] },
      unresolved: []
    },
    output: null
  },
  evaluation_decision_trace_packet: { schema_version: "pre-terminal-test" }
};

const packet = terminalEvaluationDecisionTracePacket(result, payload);
assert.equal(packet.replay_snapshot.status, "COMPLETE");
assert.equal(packet.replay_snapshot.final_title, "2025 Panini Test Player");
assert.equal(packet.replay_snapshot.versions.resolver, identityResolverPolicyVersion);
assert.equal(packet.replay_snapshot.versions.candidate_policy, candidateSelectionHeuristicVersion);
assert.notEqual(packet.replay_snapshot.final_title, result.final_title);
assert.equal(packet.knowledge_first_route.production_action, "RUN_FULL_PROVIDER");
assert.equal(packet.knowledge_first_route.counterfactual_action, "KNOWLEDGE_ASSIST");
assert.equal(packet.world_knowledge_shadow_assist.execution_status, "NOT_RUN");
assert.equal(packet.world_knowledge_shadow_assist.paid_provider_calls, 0);
assert.equal(packet.world_knowledge_shadow_assist.resolver_effect, "NONE");
assert.equal(packet.world_knowledge_shadow_assist.title_effect, "NONE");
assert.equal(packet.world_knowledge_shadow_assist.output, null);
assert.equal(terminalEvaluationDecisionTracePacket({}, payload), null);

const productionPayload = {
  provider_options: {
    recognition_benchmark_profile: "production_workload",
    trace_level: "production"
  }
};
const fullCriticalPath = {
  schema_version: "recognition-critical-path-v1",
  scope: "NATIVE_RECOGNITION_CORE",
  path_kind: "FULL_PROVIDER",
  status: "COMPLETE",
  total_wall_ms: 1200,
  unattributed_wall_ms: 5,
  provider_stage_status: "MEASURED",
  provider_active_union_ms: 600,
  provider_internal_gap_ms: 20,
  missing_boundary_ids: [],
  missing_contract_fields: [],
  anomalies: [],
  boundaries: { core_started: { offset_ms: 0 } },
  segments: { core_to_full_path: { duration_ms: 10 } },
  provider_attempts: [{ attempt: 1, execution_ms: 600 }]
};
assert.equal(terminalEvaluationDecisionTracePacket(result, productionPayload), null);
const defaultProductionSummary = providerRuntimeSummary({
  ...result,
  recognition_critical_path: fullCriticalPath,
  provider_call_ledger: []
}, productionPayload);
assert.equal(
  defaultProductionSummary.evaluation_decision_trace_packet,
  null,
  "production summary must not persist a stale evaluation packet from the recognition result"
);
assert.equal(Object.hasOwn(defaultProductionSummary, "targeted_assist_execution"), false);
assert.equal(Object.hasOwn(defaultProductionSummary, "provider_call_ledger"), false);
assert.equal(defaultProductionSummary.recognition_critical_path.provider_attempt_count, 1);
assert.equal(Object.hasOwn(defaultProductionSummary.recognition_critical_path, "boundaries"), false);
assert.equal(Object.hasOwn(defaultProductionSummary.recognition_critical_path, "provider_attempts"), false);

const coldEvaluationSummary = providerRuntimeSummary({
  ...result,
  recognition_critical_path: fullCriticalPath
}, payload);
assert.deepEqual(coldEvaluationSummary.recognition_critical_path.boundaries, fullCriticalPath.boundaries);
assert.equal(coldEvaluationSummary.recognition_critical_path.provider_attempts.length, 1);

const targetedProductionSummary = providerRuntimeSummary({
  ...result,
  provider_transient_retry_attempted: true,
  provider_transient_retry_attempts: 1,
  provider_output_cap_downgrade_attempted: true,
  provider_output_cap_downgrade_attempts: 1,
  targeted_assist_execution: {
    enabled: true,
    final_observation_owner: "TARGETED_VISUAL_OBSERVATION"
  },
  provider_call_ledger: [{ logical_stage: "TARGETED_VISUAL_OBSERVATION", provider_calls: 1 }]
}, productionPayload);
assert.equal(targetedProductionSummary.targeted_assist_execution.enabled, true);
assert.equal(targetedProductionSummary.provider_transient_retry_attempted, true);
assert.equal(targetedProductionSummary.provider_transient_retry_attempts, 1);
assert.equal(targetedProductionSummary.provider_output_cap_downgrade_attempted, true);
assert.equal(targetedProductionSummary.provider_output_cap_downgrade_attempts, 1);
assert.deepEqual(targetedProductionSummary.provider_call_ledger, [{
  logical_stage: "TARGETED_VISUAL_OBSERVATION",
  provider_calls: 1
}]);
const executionOnlySummary = providerRuntimeSummary({
  ...result,
  targeted_assist_execution: { enabled: false },
  provider_call_ledger: []
}, productionPayload);
assert.equal(executionOnlySummary.targeted_assist_execution.enabled, false);
assert.equal(Object.hasOwn(executionOnlySummary, "provider_call_ledger"), false);
const ledgerOnlySummary = providerRuntimeSummary({
  ...result,
  provider_call_ledger: [{ logical_stage: "FULL_PROVIDER_OBSERVATION", provider_calls: 1 }]
}, productionPayload);
assert.equal(Object.hasOwn(ledgerOnlySummary, "targeted_assist_execution"), false);
assert.equal(ledgerOnlySummary.provider_call_ledger.length, 1);
assert.equal(
  __listingCopilotTitleTestHooks.withoutEvaluationDecisionTracePacket(result).evaluation_decision_trace_packet,
  undefined,
  "the native terminal boundary must discard a packet before conditionally rebuilding it"
);

const nativeFinalizedResult = __listingCopilotTitleTestHooks.finalizeDeterministicPresentation({
  ...result,
  final_title: "",
  rendered_fields: {},
  evaluation_decision_trace_packet: undefined
}, payload);
assert.deepEqual(nativeFinalizedResult.effective_terminal_renderer_inputs, {
  max_title_length: 80,
  serial_numerator_verified: null,
  trust_resolved_print_run_without_evidence: true,
  source: "native_core_deterministic_finalizer"
});
const nativeTracePacket = buildEvaluationDecisionTracePacket(nativeFinalizedResult, payload);
assert.equal(nativeTracePacket.replay_snapshot.status, "COMPLETE");
assert.equal(nativeTracePacket.replay_snapshot.effective_terminal_renderer_inputs.serial_numerator_verified, null);
assert.equal(nativeTracePacket.replay_snapshot.effective_terminal_renderer_inputs.trust_resolved_print_run_without_evidence, true);

console.log("v4 terminal evaluation trace tests passed");
