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
import { rehydrateFieldLineageReport } from "./rehydrate-field-lineage-ledger.mjs";

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
assert.equal(packet.schema_version, "evaluation-decision-trace-packet-v2");
assert.equal(packet.field_lineage_ledger.schema_version, "field-lineage-ledger-v1");
assert.equal(packet.field_lineage_ledger.owner, "EVALUATION_FIELD_LINEAGE");
assert.deepEqual(packet.field_lineage.find((row) => row.field === "year")?.provider.values, ["2025"]);
assert.equal(packet.field_lineage.find((row) => row.field === "year")?.final_title_span.matched, false);
assert.equal(packet.retrieval.top_k[0].source_trust, "OFFICIAL");
assert.equal(packet.application[0].action, "BLOCK");
assert.equal(packet.resolver.dropped[0].field, "subject");
assert.equal(classifyEvaluationMissingField(packet, "manufacturer"), "PROVIDER_NOT_OBSERVED");
assert.equal(classifyEvaluationMissingField({ ...packet, provider_observation_fields: { manufacturer: "Topps" }, normalization: { output: {} } }, "manufacturer"), "NORMALIZATION_DROPPED");
assert.equal(classifyEvaluationMissingField(packet, "year"), "CATALOG_NOT_RETRIEVED");
assert.equal(JSON.stringify(packet).includes("complete natural language response"), false);
assert.equal(buildEvaluationDecisionTracePacket({}, {}), null);

const productionCandidateTrace = buildEvaluationDecisionTracePacket({
  raw_provider_fields: { year: "2025" },
  raw_observed_fields: { year: "2025" },
  resolved_fields: { year: "2025" },
  rendered_fields: { fields: {} },
  final_title: "2025 Topps Test Player",
  l2_candidate_debug: {
    selected_candidate_id: "catalog-1",
    candidate_application_trace: [{
      candidate_id: "catalog-1",
      candidate_lane: "catalog",
      source_type: "INTERNAL_APPROVED_HISTORY",
      source_trust: "APPROVED_REFERENCE"
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
assert.equal(productionCandidateTrace.field_lineage.find((row) => row.field === "year")?.retrieval.decisions[0].value, "2025");
assert.equal(productionCandidateTrace.field_lineage.find((row) => row.field === "year")?.final_title_span.matched, true);
assert.equal(productionCandidateTrace.field_lineage.find((row) => row.field === "year")?.renderer_module.decision, "INCLUDE");
assert.equal(productionCandidateTrace.field_lineage.find((row) => row.field === "year")?.renderer_module.reason, "FINAL_TITLE_SPAN_CONFIRMS_INCLUDE");
assert.equal(productionCandidateTrace.field_lineage.find((row) => row.field === "year")?.candidate_selection.decision, "SELECTED");
assert.equal(productionCandidateTrace.field_lineage.find((row) => row.field === "year")?.candidate_application.decision, "SUPPORT");

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

const rehydrated = rehydrateFieldLineageReport({
  results: [{
    final_title: "2025 Topps Test Player",
    resolved_fields: { year: "2025" },
    l2_candidate_debug: productionCandidateTrace.retrieval.top_k.length ? {
      selected_candidate_id: "catalog-1",
      candidate_application_trace: [{ candidate_id: "catalog-1", selected: true }],
      retrieval_application: { decisions: [{ candidate_id: "catalog-1", field: "year", candidate_value: "2025", decision: "SUPPORT" }] }
    } : {}
  }]
});
assert.equal(rehydrated.field_lineage_rehydration.provider_calls, 0);
assert.equal(rehydrated.field_lineage_rehydration.title_results_changed, false);
assert.equal(rehydrated.results[0].evaluation_decision_trace_packet.field_lineage_ledger.schema_version, "field-lineage-ledger-v1");

console.log("evaluation decision trace packet tests passed");
