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
import { buildVectorCandidatePacket } from "../lib/listing/retrieval/vector-candidate-packet.mjs";

const payload = {
  provider_options: {
    recognition_benchmark_profile: "cold_algorithm_benchmark",
    trace_level: "evaluation"
  }
};

function candidatePacket(candidates = [], {
  status = null,
  statusCode = null
} = {}) {
  const packet = buildVectorCandidatePacket({ sources: candidates, unavailable: [] }, { limit: 20 });
  if (status) packet.vector_retrieval.status = status;
  if (statusCode) packet.vector_retrieval.status_code = statusCode;
  return packet;
}

function candidatePacketWithRank(candidates = [], rank = 1) {
  const packet = candidatePacket(candidates);
  if (packet.vector_retrieval.candidates[0]) packet.vector_retrieval.candidates[0].rank = rank;
  return packet;
}

function rawRetrieval({
  lane = "catalog",
  candidates = [],
  query = "2025 Topps Chrome Test Player",
  queryCount = 1,
  trace = null
} = {}) {
  const queries = queryCount > 0 ? [{
    query_id: `${lane}-query-1`,
    family: lane === "catalog" ? "catalog_year_product_subject" : "visual_vector",
    provider_id: lane,
    query,
    fields: ["year", "product", "subjects"],
    reason: "evaluation retrieval query",
    embedding: lane === "vector" ? [0.1, 0.2, 0.3] : undefined,
    api_secret: "MUST_NOT_PERSIST"
  }] : [];
  return {
    mode: "internal_only",
    queries,
    sources: candidates,
    query_execution: {
      mode: "sequential",
      concurrency: 1,
      query_count: queryCount
    },
    trace: trace ?? queries.map((row) => ({
      query_id: row.query_id,
      family: row.family,
      provider_id: row.provider_id,
      status: "ok",
      candidate_count: candidates.length,
      latency_ms: 12,
      cache_hit: false
    })),
    unavailable: []
  };
}

function skippedLane(reason) {
  return {
    vector_retrieval: {
      status: "UNAVAILABLE",
      status_code: "VECTOR_RETRIEVAL_UNAVAILABLE",
      candidates: [],
      unavailable: [{ provider_id: "visual_vector", reason }]
    }
  };
}

function catalogRetrievalResult(candidates = [], extra = {}) {
  return {
    catalog_retrieval: rawRetrieval({ lane: "catalog", candidates }),
    catalog_candidate_packet: candidatePacket(candidates),
    vector_retrieval: null,
    vector_candidate_packet: skippedLane("vector_retrieval_disabled"),
    ...extra
  };
}

assert.equal(evaluationTraceEnabled(payload), true);
assert.equal(applyRecognitionBenchmarkProfile({}, {
  profile: recognitionBenchmarkProfileIds.COLD_ALGORITHM
}).trace_level, "evaluation");
assert.equal(evaluationTraceEnabled({
  provider_options: {
    recognition_benchmark_profile: "production_workload_benchmark",
    trace_level: "evaluation"
  }
}), false);

const baseCandidate = {
  candidate_id: "candidate-1",
  candidate_identity_id: "identity-1",
  rank: 1,
  provider_id: "catalog",
  source_type: "OFFICIAL_CHECKLIST",
  source_trust: "OFFICIAL",
  fields: { product: "Different Product" }
};
const packet = buildEvaluationDecisionTracePacket(catalogRetrievalResult([baseCandidate], {
  raw_provider_fields: { year: "2025", subject: "Test Player", ignored: "UNKNOWN" },
  raw_observed_fields: { year: "2025", subject: "Test Player" },
  resolved_fields: { year: "2025" },
  rendered_fields: { fields: { year: "2025" } },
  renderer: "deterministic",
  renderer_version: "v1",
  candidate_application_trace: [{
    candidate_id: "candidate-1",
    candidate_lane: "catalog",
    blocked_fields: ["subject"]
  }],
  retrieval_application: {
    decisions: [{
      candidate_id: "candidate-1",
      candidate_lane: "catalog",
      field: "subject",
      candidate_value: "Wrong Player",
      decision: "BLOCK",
      reason: "subject_conflict"
    }]
  }
}), payload);

assert.equal(packet.provider_observation_fields.year, "2025");
assert.equal(packet.schema_version, "evaluation-decision-trace-packet-v3");
assert.equal(packet.stage_execution.provider_observation.status, "RAN");
assert.equal(packet.stage_execution.retrieval.status, "RAN");
assert.equal(packet.stage_execution.selection.status, "TRACE_MISSING");
assert.deepEqual(packet.field_lineage.find((row) => row.field === "year")?.provider.values, ["2025"]);
assert.equal(packet.field_lineage.find((row) => row.field === "year")?.final_title_span.matched, false);
assert.equal(packet.retrieval.top_k[0].source_trust, "APPROVED_REFERENCE");
assert.equal(packet.retrieval.top_k[0].retrieval_lane, "catalog");
assert.equal(packet.retrieval.top_k[0].retrieval_rank, 1);
assert.equal(packet.application[0].action, "BLOCK");
assert.equal(packet.resolver.dropped[0].field, "subject");
assert.equal(classifyEvaluationMissingField(packet, "manufacturer", "Topps"), "PROVIDER_NOT_OBSERVED");
assert.equal(classifyEvaluationMissingField({
  ...packet,
  provider_observation_fields: { manufacturer: "Topps" },
  normalization: { output: {} }
}, "manufacturer", "Topps"), "NORMALIZATION_DROPPED");
assert.equal(classifyEvaluationMissingField(packet, "year", "2025"), "CATALOG_NOT_RETRIEVED");
assert.equal(classifyEvaluationMissingField(packet, "players", "Test Player"), "CATALOG_NOT_RETRIEVED");
assert.equal(classifyEvaluationMissingField({
  ...packet,
  provider_observation_fields: { parallel: "Gold" },
  normalization: { output: { parallel_exact: "Gold Refractor" } },
  field_lineage: []
}, "print_finish", "Gold Refractor"), "PROVIDER_NOT_OBSERVED");
assert.equal(classifyEvaluationMissingField({
  ...packet,
  provider_observation_fields: { parallel: "Gold Refractor" },
  normalization: { output: { parallel_exact: "Gold Refractor" } },
  field_lineage: []
}, "print_finish", "Gold Refractor"), "CATALOG_NOT_RETRIEVED");
assert.equal(classifyEvaluationMissingField({
  ...packet,
  provider_observation_fields: { grade: "10" },
  normalization: { output: {} },
  field_lineage: []
}, "grading_info", "10"), "NORMALIZATION_DROPPED");
assert.equal(classifyEvaluationMissingField({
  ...packet,
  provider_observation_fields: { product: "Prizm" },
  normalization: { output: { product: "Prizm" } },
  field_lineage: []
}, "product", "Topps Chrome"), "PROVIDER_NOT_OBSERVED", "a wrong same-named value is not GT evidence");
assert.equal(classifyEvaluationMissingField({
  ...packet,
  provider_observation_fields: { product: "Topps Chrome" },
  normalization: { output: { product: "Prizm" } },
  field_lineage: []
}, "product", "Topps Chrome"), "NORMALIZATION_DROPPED", "normalization must preserve the expected GT value, not merely a key");
assert.equal(classifyEvaluationMissingField({}, "product", "Topps Chrome"), "TRACE_MISSING");
assert.equal(classifyEvaluationMissingField(packet, "product"), "UNKNOWN");
assert.equal(JSON.stringify(packet).includes("complete natural language response"), false);
assert.equal(buildEvaluationDecisionTracePacket({}, {}), null);

const applicationCannotManufactureRetrieval = buildEvaluationDecisionTracePacket({
  raw_provider_fields: { year: "2025" },
  raw_observed_fields: { year: "2025" },
  candidate_application_trace: [{
    candidate_id: "application-only",
    candidate_lane: "catalog",
    source_type: "OFFICIAL_CHECKLIST",
    source_trust: "APPROVED_REFERENCE",
    can_apply_fields: ["year"]
  }]
}, payload);
assert.equal(applicationCannotManufactureRetrieval.retrieval.candidate_count, 0);
assert.equal(applicationCannotManufactureRetrieval.application.length, 0);
assert.equal(applicationCannotManufactureRetrieval.stage_execution.retrieval.status, "TRACE_MISSING");

const nativeCandidate = {
  candidate_id: "catalog-native-1",
  candidate_identity_id: "identity-native-1",
  rank: 1,
  provider_id: "catalog",
  source_type: "INTERNAL_APPROVED_HISTORY",
  source_trust: "APPROVED_REFERENCE",
  rerank_score: 0.88,
  fields: {
    year: "2025",
    product: "Topps Chrome",
    subjects: ["Test Player"],
    collector_number: "136",
    parallel_exact: "Gold Refractor",
    serial_number: "12/50",
    grade_company: "PSA",
    cert_number: "MUST_NOT_PERSIST"
  }
};
const nativeCoreCandidateTrace = buildEvaluationDecisionTracePacket(catalogRetrievalResult([nativeCandidate], {
  raw_provider_fields: { year: "2025" },
  raw_observed_fields: { year: "2025" },
  resolved_fields: { year: "2025" },
  rendered_fields: { fields: { year: "2025" } },
  final_title: "2025 Topps Test Player",
  selected_candidate_decision: {
    selected_candidate_id: "catalog-native-1",
    selected_candidate_source: "INTERNAL_APPROVED_HISTORY",
    selection_margin: 0.14,
    selected_reason_codes: ["exact anchor"],
    rejected_candidate_reasons: [{
      candidate_id: "catalog-native-1",
      score: 0.73,
      decision_strength: 1.22,
      reasons: []
    }]
  },
  candidate_application_trace: [{
    candidate_id: "catalog-native-1",
    candidate_lane: "catalog",
    source_type: "INTERNAL_APPROVED_HISTORY",
    source_trust: "APPROVED_REFERENCE"
  }],
  retrieval_application: {
    decisions: [{
      candidate_id: "catalog-native-1",
      candidate_lane: "catalog",
      field: "year",
      candidate_value: "2025",
      decision: "SUPPORT",
      reason: "selected_identity_matches_current_field"
    }]
  }
}), payload);
assert.equal(nativeCoreCandidateTrace.retrieval.candidate_count, 1);
assert.equal(nativeCoreCandidateTrace.retrieval.top_k[0].selected, true);
assert.equal(nativeCoreCandidateTrace.retrieval.top_k[0].candidate_identity_id, "identity-native-1");
assert.equal(nativeCoreCandidateTrace.retrieval.top_k[0].source_type, "INTERNAL_APPROVED_HISTORY");
assert.equal(nativeCoreCandidateTrace.retrieval.top_k[0].identity_fields.collector_number, "136");
assert.equal(nativeCoreCandidateTrace.retrieval.top_k[0].identity_fields.serial_number, undefined);
assert.equal(nativeCoreCandidateTrace.retrieval.top_k[0].identity_fields.grade_company, undefined);
assert.equal(nativeCoreCandidateTrace.retrieval.top_k[0].identity_fields.cert_number, undefined);
assert.equal(nativeCoreCandidateTrace.retrieval.top_k[0].rank_source, "AUTHORITATIVE_RETRIEVAL_PACKET");
const yearRetrievalDecisions = nativeCoreCandidateTrace.field_lineage
  .find((row) => row.field === "year")?.retrieval.decisions;
assert.equal(yearRetrievalDecisions[0].action, "RETRIEVED");
assert.equal(yearRetrievalDecisions[0].value, "2025");
assert.equal(yearRetrievalDecisions[1].action, "SUPPORT");
assert.equal(nativeCoreCandidateTrace.field_lineage.find((row) => row.field === "year")?.final_title_span.matched, true);
assert.equal(classifyEvaluationMissingField(nativeCoreCandidateTrace, "year", "2025"), "CANDIDATE_FIELD_NOT_APPLIED");
assert.equal(JSON.stringify(nativeCoreCandidateTrace).includes("MUST_NOT_PERSIST"), false);

const unselectedCorrectCandidate = buildEvaluationDecisionTracePacket(catalogRetrievalResult([{
  ...nativeCandidate,
  candidate_id: "candidate-authoritative",
  candidate_identity_id: "identity-authoritative",
  fields: { product: "Topps Chrome" }
}], {
  raw_provider_fields: { product: "Topps Chrome" },
  raw_observed_fields: { product: "Topps Chrome" },
  selected_candidate_decision: {
    selected_candidate_id: "candidate-other",
    selection_margin: 0.14,
    rejected_candidate_reasons: [{
      candidate_id: "candidate-authoritative",
      score: 0.73,
      decision_strength: 1.22,
      reasons: ["direct subject conflict"]
    }]
  },
  candidate_application_trace: [{
    candidate_id: "candidate-authoritative",
    candidate_lane: "catalog",
    source_trust: "OFFICIAL_CHECKLIST",
    decision_eligible: false,
    can_apply_fields: ["product"]
  }],
  retrieval_application: {
    decisions: [{
      candidate_id: "candidate-authoritative",
      candidate_lane: "catalog",
      field: "product",
      resolver_field: "product",
      candidate_value: "Topps Chrome",
      decision: "BLOCK",
      reason: "identity_resolution_rejected",
      applied_to_final: false,
      supported_final: false,
      outcome: "NOT_APPLIED"
    }]
  },
  resolved_fields: {},
  rendered_fields: { fields: {} }
}), payload);
const authoritativeCandidate = unselectedCorrectCandidate.retrieval.top_k[0];
assert.equal(authoritativeCandidate.rank, 1);
assert.equal(authoritativeCandidate.score, 0.73);
assert.equal(authoritativeCandidate.decision_strength, 1.22);
assert.deepEqual(authoritativeCandidate.rejection_reasons, ["DIRECT_SUBJECT_CONFLICT"]);
assert.equal(authoritativeCandidate.field_actions[0].action, "BLOCK");
assert.equal(unselectedCorrectCandidate.selection.selection_margin, 0.14);
assert.equal(
  classifyEvaluationMissingField(unselectedCorrectCandidate, "product", "Topps Chrome"),
  "CANDIDATE_NOT_SELECTED",
  "a correct Top-K identity is a downstream selection miss, never catalog-not-retrieved"
);

const sharedCandidateId = "shared-candidate-id";
const duplicateAcrossLanes = buildEvaluationDecisionTracePacket({
  raw_provider_fields: { product: "Topps Chrome" },
  raw_observed_fields: { product: "Topps Chrome" },
  catalog_retrieval: rawRetrieval({ lane: "catalog", candidates: [{ candidate_id: sharedCandidateId }] }),
  catalog_candidate_packet: candidatePacketWithRank([{
    candidate_id: sharedCandidateId,
    candidate_identity_id: "shared-identity",
    rank: 2,
    provider_id: "catalog",
    source_type: "OFFICIAL_CHECKLIST",
    source_trust: "APPROVED_REFERENCE",
    fields: { product: "Topps Chrome" }
  }], 2),
  vector_retrieval: rawRetrieval({ lane: "vector", candidates: [{ candidate_id: sharedCandidateId }] }),
  vector_candidate_packet: candidatePacket([{
    candidate_id: sharedCandidateId,
    candidate_identity_id: "shared-identity",
    rank: 1,
    provider_id: "visual_vector",
    source_type: "VISUAL_VECTOR",
    source_trust: "REFERENCE_CANDIDATE",
    fields: { product: "Topps Chrome" }
  }]),
  selected_candidate_decision: {
    selected_candidate_id: "",
    rejected_candidate_reasons: [{ candidate_id: sharedCandidateId, reasons: ["low margin"] }]
  }
}, payload);
assert.equal(duplicateAcrossLanes.retrieval.top_k.length, 2);
assert.deepEqual(
  duplicateAcrossLanes.retrieval.top_k.map((row) => [row.candidate_trace_key, row.retrieval_rank]),
  [[`catalog:${sharedCandidateId}`, 2], [`vector:${sharedCandidateId}`, 1]],
  "the same candidate id in two lanes must retain both authoritative lane ranks"
);

const packetWithoutRawRetrieval = buildEvaluationDecisionTracePacket({
  raw_provider_fields: { product: "Topps Chrome" },
  raw_observed_fields: { product: "Topps Chrome" },
  catalog_candidate_packet: candidatePacket([nativeCandidate]),
  vector_retrieval: null,
  vector_candidate_packet: skippedLane("vector_retrieval_disabled"),
  selected_candidate_decision: { selected_candidate_id: "" },
  retrieval_application: { decisions: [] }
}, payload);
assert.equal(packetWithoutRawRetrieval.retrieval.candidate_count, 1, "packet candidates remain visible for diagnosis");
assert.equal(packetWithoutRawRetrieval.stage_execution.retrieval.status, "TRACE_MISSING");
assert.equal(packetWithoutRawRetrieval.retrieval.lanes[0].reason_code, "RAW_RETRIEVAL_NOT_PERSISTED");
assert.equal(
  classifyEvaluationMissingField(packetWithoutRawRetrieval, "product", "Topps Chrome"),
  "TRACE_MISSING",
  "a declared packet without query execution payload cannot fake retrieval coverage"
);

const executedEmpty = buildEvaluationDecisionTracePacket({
  raw_provider_fields: { product: "Topps Chrome" },
  raw_observed_fields: { product: "Topps Chrome" },
  catalog_retrieval: rawRetrieval({ lane: "catalog", candidates: [] }),
  catalog_candidate_packet: candidatePacket([]),
  vector_retrieval: null,
  vector_candidate_packet: skippedLane("vector_retrieval_disabled")
}, payload);
assert.equal(executedEmpty.stage_execution.retrieval.status, "RAN_EMPTY");
assert.equal(executedEmpty.retrieval.lanes[0].status, "RAN_EMPTY");
assert.equal(executedEmpty.retrieval.lanes[0].reason_code, "VECTOR_NO_CONFIDENT_MATCH");
assert.equal(classifyEvaluationMissingField(executedEmpty, "product", "Topps Chrome"), "CATALOG_NOT_RETRIEVED");

const anchorPacket = buildEvaluationDecisionTracePacket({
  pre_l2_anchor_late_route_shadow: {
    schema_version: "v4-anchor-route-late-shadow-v1",
    mode: "ROUTE_ONLY_SHADOW",
    strict_post_refresh: {
      plan: { route: "NORMAL_L2", reason: "no_anchor" },
      anchor_count: 0,
      direct_anchor_count: 0,
      input_trace: {
        schema_version: "v4-pre-l2-anchor-input-trace-v1",
        reason_codes: ["NO_CURRENT_CODE_PATCH"],
        raw_value: "MUST NOT PERSIST"
      }
    },
    post_provider_context_counterfactual: {
      plan: { route: "SPORTS_COMPOSITE_LOOKUP", reason: "ready" },
      anchor_count: 3,
      direct_anchor_count: 3,
      provider_context_patch_fields: ["year", "product", "players"],
      input_trace: { reason_codes: ["ANCHOR_ROUTE_READY"] }
    }
  }
}, payload);
assert.equal(anchorPacket.anchor_route_shadow.mode, "ROUTE_ONLY_SHADOW");
assert.equal(anchorPacket.anchor_route_shadow.effects.catalog_lookup, false);
assert.equal(anchorPacket.anchor_route_shadow.post_provider_context_counterfactual.provider_already_called, true);
assert.equal(JSON.stringify(anchorPacket).includes("MUST NOT PERSIST"), false);

console.log("evaluation decision trace packet tests passed");
