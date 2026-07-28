import assert from "node:assert/strict";

import { terminalEvaluationDecisionTracePacket } from "../api/v4/listing-copilot-title.js";
import { identityResolverPolicyVersion } from "../lib/identity-resolution/listing-resolution-gate.mjs";

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
  raw_observed_fields: {
    year: "2025",
    manufacturer: "Panini",
    players: ["Test Player"]
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

console.log("v4 terminal evaluation trace tests passed");
