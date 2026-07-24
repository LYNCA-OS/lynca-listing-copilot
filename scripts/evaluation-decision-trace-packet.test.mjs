#!/usr/bin/env node

import assert from "node:assert/strict";
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
  }
}, payload);

assert.equal(packet.provider_observation_fields.year, "2025");
assert.equal(packet.retrieval.top_k[0].source_trust, "OFFICIAL");
assert.equal(packet.application[0].action, "BLOCK");
assert.equal(packet.resolver.dropped[0].field, "subject");
assert.equal(classifyEvaluationMissingField(packet, "manufacturer"), "PROVIDER_NOT_OBSERVED");
assert.equal(classifyEvaluationMissingField({ ...packet, provider_observation_fields: { manufacturer: "Topps" }, normalization: { output: {} } }, "manufacturer"), "NORMALIZATION_DROPPED");
assert.equal(classifyEvaluationMissingField(packet, "year"), "CATALOG_NOT_RETRIEVED");
assert.equal(JSON.stringify(packet).includes("complete natural language response"), false);
assert.equal(buildEvaluationDecisionTracePacket({}, {}), null);

console.log("evaluation decision trace packet tests passed");
