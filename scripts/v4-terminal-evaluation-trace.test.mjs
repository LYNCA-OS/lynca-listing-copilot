import assert from "node:assert/strict";

import {
  providerRuntimeSummary,
  terminalEvaluationDecisionTracePacket
} from "../api/v4/listing-copilot-title.js";
import { identityResolverPolicyVersion } from "../lib/identity-resolution/listing-resolution-gate.mjs";
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
  world_knowledge: {
    schema_version: "world-knowledge-layer-v2",
    enabled: true,
    proposal_count: 1,
    accepted_count: 1,
    unchecked_count: 0,
    refuted_count: 0,
    invalid_count: 0,
    decisions: [{
      field: "team",
      value: "Example Team",
      basis: "KNOWN",
      disposition: "ACCEPTED",
      checked: true,
      reason: "player_team_year_covered",
      allowed_values: ["Example Team"]
    }]
  },
  evaluation_decision_trace_packet: { schema_version: "pre-terminal-test" }
};

const packet = terminalEvaluationDecisionTracePacket(result, payload);
assert.equal(packet.replay_snapshot.status, "COMPLETE");
assert.equal(packet.replay_snapshot.final_title, "2025 Panini Test Player");
assert.equal(packet.replay_snapshot.versions.resolver, identityResolverPolicyVersion);
assert.notEqual(packet.replay_snapshot.final_title, result.final_title);
assert.equal(packet.knowledge_first_route.production_action, "RUN_FULL_PROVIDER");
assert.equal(packet.knowledge_first_route.counterfactual_action, "KNOWLEDGE_ASSIST");
assert.deepEqual(packet.world_knowledge.decisions[0], {
  field: "team",
  value: "Example Team",
  basis: "KNOWN",
  disposition: "ACCEPTED",
  checked: true,
  reason: "player_team_year_covered",
  allowed_values: ["Example Team"]
});
assert.equal(terminalEvaluationDecisionTracePacket({}, payload), null);

const productionPayload = {
  provider_options: {
    recognition_benchmark_profile: "production_workload",
    trace_level: "production"
  }
};
assert.equal(terminalEvaluationDecisionTracePacket(result, productionPayload), null);
assert.equal(
  providerRuntimeSummary(result, productionPayload).evaluation_decision_trace_packet,
  null,
  "production summary must not persist a stale evaluation packet from the recognition result"
);
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
