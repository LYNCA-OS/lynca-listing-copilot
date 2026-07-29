#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  analyzeSameAssetStability as analyzeSameAssetStabilityRaw,
  sameAssetStabilityPlanSha256
} from "./analyze-same-asset-stability.mjs";
import {
  TARGETED_ASSIST_PAIRED_COHORT_SHA256,
  TARGETED_ASSIST_PAIRED_LABEL_SHA256
} from "./run-targeted-assist-paired-eval.mjs";

const hex = (character, length = 64) => character.repeat(length);

const planFixture = {
  schema_version: "same-asset-stability-execution-plan-v1",
  execution_mode: "EXECUTE_AUTHORIZED",
  execution_id: "same-asset-execution-test",
  cohort: "development",
  frozen_cohort: "FAMILIAR",
  frozen_cohort_proof: {
    cohort: "FAMILIAR",
    item_count: 10,
    selected_item_ids_sha256: TARGETED_ASSIST_PAIRED_COHORT_SHA256.FAMILIAR,
    sealed_labels_sha256: TARGETED_ASSIST_PAIRED_LABEL_SHA256.FAMILIAR,
    evaluation_partition: "development"
  },
  dataset_item_count: 10,
  dataset_sha256: hex("6"),
  sealed_labels_sha256: hex("7"),
  selected_item_id: "development-card-fixed",
  selected_item_index: 0,
  selected_item_sha256: hex("8"),
  planned_runs: 30,
  planned_job_runs: 30,
  asset_cache_proof: {
    fingerprint: hex("d"),
    asset_id: "asset-fixed",
    image_generation_id: "asset-fixed",
    canonical_image_set_sha256: hex("a"),
    canonical_primary_content_sha256: [hex("b"), hex("c")]
  }
};
const planSha256 = sameAssetStabilityPlanSha256(planFixture);
const analyzeSameAssetStability = (reports, options = {}) => analyzeSameAssetStabilityRaw(reports, {
  plan: planFixture,
  ...options
});

function row(index, overrides = {}) {
  const providerEvidence = [
    { field: "year", value: "2025", source_image_id: "image-front" },
    { field: "players", value: ["Test Player"], source_image_id: "image-front" }
  ];
  return {
    same_asset_execution_id: planFixture.execution_id,
    same_asset_plan_sha256: planSha256,
    same_asset_dataset_sha256: planFixture.dataset_sha256,
    same_asset_sealed_labels_sha256: planFixture.sealed_labels_sha256,
    same_asset_selected_item_id: planFixture.selected_item_id,
    asset_id: "asset-fixed",
    image_generation_id: "asset-fixed",
    canonical_image_set_sha256: hex("a"),
    canonical_primary_content_sha256: [hex("b"), hex("c")],
    source_fingerprint: hex("d"),
    runner_attempt: index + 1,
    job_id: `job-${index}`,
    recognition_session_id: `session-${index}`,
    job_created_at: new Date(Date.UTC(2026, 6, 29, 0, 0, index)).toISOString(),
    ok: true,
    writer_ready: true,
    l2_ready: true,
    final_title: "2025 Test Player",
    recognition_benchmark_profile: "cold_algorithm_benchmark",
    identity_cache_hit: false,
    identity_cache_read_bypassed: true,
    provider_call_skipped: false,
    provider_calls: 1,
    attempt_count: 1,
    retry_attempt_history: [],
    retry_error_codes: [],
    provider_transient_retry_attempted: false,
    provider_output_cap_downgrade_attempted: false,
    provider_truncation_retry_attempted: false,
    provider_key_rotation_attempted: false,
    gpt5_empty_result_retry_attempted: false,
    vector_worker_status: "VECTOR_RETRIEVAL_UNAVAILABLE",
    vector_worker_reason: "vector_retrieval_disabled_empty_index",
    preingestion_ocr_rendezvous: {
      post_provider_wait_ms: 1_900,
      critical_fields_settled: false,
      target_fields_settled: false,
      critical_field_wait: {
        should_wait: true,
        wait_budget_ms: 2_000,
        wait_budget_ceiling_ms: 2_000,
        wait_budget_uncapped_ms: 8_000,
        target_fields: ["serial_number"],
        reasons: ["provider_left_print_run_unresolved"],
        state_known: true,
        state_configured: true,
        serial_active_count: 1,
        grade_label_active_count: 0,
        grade_incomplete: false,
        grade_completely_missing: true,
        grade_unresolved: false,
        slab_likely: false,
        ocr_signal_fields: [],
        ocr_signal_conflicting_fields: [],
        base_wait_budget_ms: 0,
        targeted_wait_budget_ms: 8_000
      }
    },
    identity_resolution_status: "RESOLVED",
    ambiguity_status: "CLEAR",
    field_states: { year: { state: "VALUE", value: "2025" } },
    evaluation_decision_trace_packet: {
      schema_version: "evaluation-decision-trace-packet-v10",
      deployment_git_sha: hex("e", 40),
      benchmark_profile: "cold_algorithm_benchmark",
      trace_level: "evaluation",
      provider_request_identity: {
        schema_version: "openai-provider-request-identity-v1",
        status: "COMPLETE",
        requested_model_id: "gpt-5-mini",
        response_model_id: "gpt-5-mini-2026-07-01",
        provider_prompt_sha256: hex("1"),
        provider_prompt_utf8_bytes: 12000,
        provider_input_image_count: 2,
        provider_ordered_image_content_sha256: hex("2"),
        provider_image_manifest_complete: true,
        provider_image_declared_content_mismatch_count: 0,
        provider_request_controls_sha256: hex("3"),
        provider_request_fingerprint: hex("4"),
        provider_http_request_count: 1,
        provider_http_request_started_at: new Date(Date.UTC(2026, 6, 29, 0, 0, index)).toISOString(),
        provider_http_request_completed_at: new Date(Date.UTC(2026, 6, 29, 0, 0, index, 500)).toISOString(),
        response_profile: "standard",
        image_detail: "high",
        requested_service_tier: null,
        max_output_tokens: 128000,
        reasoning_effort: "minimal",
        temperature: null,
        text_verbosity: "medium"
      },
      replay_snapshot: {
        schema_version: "evaluation-replay-snapshot-v4",
        status: "COMPLETE",
        missing_components: [],
        provider_fields: { year: "2025", players: ["Test Player"] },
        provider_field_evidence: providerEvidence,
        observed_fields: { year: "2025", players: ["Test Player"] },
        resolved_fields: { year: "2025", players: ["Test Player"] },
        rendered_fields: { year: "2025", players: ["Test Player"] },
        final_title: "2025 Test Player",
        effective_terminal_renderer_inputs: {
          max_title_length: 80,
          serial_numerator_verified: null,
          trust_resolved_print_run_without_evidence: false
        },
        renderer_inputs: { max_title_length: 80 },
        versions: {
          recognition_pipeline_fingerprint: hex("5"),
          catalog_snapshot: "catalog-snapshot-42"
        }
      },
      provider_observation: {
        recognition_status: "CONFIRMED",
        fields: { year: "2025", players: ["Test Player"] },
        field_evidence: providerEvidence,
        field_evidence_count: providerEvidence.length,
        field_evidence_truncated: false,
        unresolved: [],
        unresolved_count: 0,
        unresolved_truncated: false
      },
      normalization: {
        input: { year: "2025", players: ["Test Player"] },
        output: { year: "2025", players: ["Test Player"] },
        decisions: [
          { field: "year", decision: "PRESERVE", reason: "NORMALIZATION_COMPLETED" },
          { field: "players", decision: "PRESERVE", reason: "NORMALIZATION_COMPLETED" }
        ]
      },
      retrieval: { query: { year: "2025" }, top_k: [], candidate_count: 0 },
      selection: { selected_candidate_id: null, selected_rank: null, rejection_reasons: [] },
      application: [],
      resolver: {
        before: { year: "2025", players: ["Test Player"] },
        after: { year: "2025", players: ["Test Player"] },
        dropped: []
      },
      renderer: {
        renderer: "deterministic",
        renderer_version: "renderer-v1",
        included_fields: ["year", "players"],
        dropped_fields: [],
        module_order: ["year", "subject"]
      }
    },
    ...overrides
  };
}

const stableRows = Array.from({ length: 30 }, (_, index) => row(index));
const reportsFor = (rows) => rows.map((item) => ({ results: [item] }));
const stableReports = reportsFor(stableRows);
const stable = analyzeSameAssetStability(stableReports);
assert.equal(stable.validity.status, "VALID");
assert.equal(stable.execution_plan.plan_sha256, planSha256);
assert.equal(stable.validity.completed_attempts, 30);
assert.equal(stable.validity.legal_runs, 30);
assert.equal(stable.validity.experiment_window_ms, 29_500);
assert.equal(stable.stage_distributions.provider_observation.bounded_exact.unique_fingerprint_count, 1);
assert.equal(stable.stage_distributions.provider_observation.exact, undefined);
assert.equal(stable.stage_distributions.provider_observation.projection_contract, "PERSISTED_TRACE_BOUNDED_PROJECTION");
assert.equal(stable.stage_distributions.final_title.exact.pairwise.comparisons, 435);
assert.equal(stable.stage_distributions.final_title.projection_contract, "EXACT_FINAL_TITLE_STRING");
assert.equal(stable.stage_distributions.final_title.exact.pairwise.agreement, 1);
assert.equal(stable.stage_distributions.final_title.exact.independent_pairs.pairs, 15);
assert.equal(stable.first_divergence_classification.NO_SEMANTIC_DIVERGENCE, 435);
assert.equal(stable.interpretation.model_nondeterminism_claim_permitted, false);
assert.deepEqual(stable.nuisance_variables.provider_key_slots, { UNKNOWN: 30 });
assert.equal(stable.nuisance_variables.signed_url_identity_recorded, false);
assert.equal(stable.frozen_input.runtime_policy_state.status, "COMPLETE");
assert.equal(stable.frozen_input.runtime_policy_state.vector_worker.status, "VECTOR_RETRIEVAL_UNAVAILABLE");
assert.deepEqual(stable.frozen_input.runtime_policy_state.ocr_rendezvous.wait_budgets, {
  capped_ms: 2_000,
  uncapped_ms: 8_000,
  ceiling_ms: 2_000,
  base_ms: 0,
  targeted_ms: 8_000
});

const unbound = analyzeSameAssetStabilityRaw(stableReports);
assert.equal(unbound.validity.status, "INVALID");
assert.equal(unbound.scope, "UNBOUND_REPEATABILITY_INPUT");

const reorderedEvidenceRows = stableRows.map((item, index) => {
  if (index !== 0) return item;
  const clone = structuredClone(item);
  clone.evaluation_decision_trace_packet.provider_observation.field_evidence.reverse();
  return clone;
});
const reordered = analyzeSameAssetStability(reportsFor(reorderedEvidenceRows));
assert.equal(reordered.validity.status, "VALID");
assert.equal(reordered.stage_distributions.provider_observation.bounded_exact.unique_fingerprint_count, 2);
assert.equal(reordered.stage_distributions.provider_observation.semantic.unique_fingerprint_count, 1);

const providerDriftRows = stableRows.map((item, index) => {
  if (index < 20) return item;
  const clone = structuredClone(item);
  clone.evaluation_decision_trace_packet.provider_observation.fields.product = "Phoenix";
  return clone;
});
const providerDrift = analyzeSameAssetStability(reportsFor(providerDriftRows));
assert.equal(providerDrift.validity.status, "VALID");
assert.equal(providerDrift.stage_distributions.provider_observation.semantic.unique_fingerprint_count, 2);
assert.equal(providerDrift.first_divergence_classification.provider_observation, 200);
assert.equal(providerDrift.first_divergence_classification.NO_SEMANTIC_DIVERGENCE, 235);

const partial = analyzeSameAssetStability(reportsFor(stableRows.slice(0, 29)));
assert.equal(partial.validity.status, "PARTIAL");
assert.equal(partial.validity.completed_attempts, 29);

assert.throws(
  () => analyzeSameAssetStability([{ results: [stableRows[0]] }], { expectedRuns: 1 }),
  /expected runs are frozen at 30/
);

const truncatedObservationRows = structuredClone(stableRows);
truncatedObservationRows[0].evaluation_decision_trace_packet.provider_observation.field_evidence_truncated = true;
const truncatedObservation = analyzeSameAssetStability(reportsFor(truncatedObservationRows));
assert.equal(truncatedObservation.validity.status, "INVALID");
assert.ok(truncatedObservation.validity.errors.some((error) => (
  error.code === "PROVIDER_OBSERVATION_TRACE_TRUNCATED_OR_UNPROVEN"
)));

const inputDriftRows = structuredClone(stableRows);
inputDriftRows[29].evaluation_decision_trace_packet.provider_request_identity.provider_prompt_sha256 = hex("6");
const inputDrift = analyzeSameAssetStability(reportsFor(inputDriftRows));
assert.equal(inputDrift.validity.status, "INVALID");
assert.ok(inputDrift.validity.errors.some((error) => error.code === "GLOBAL_PROMPT_SHA256_MISMATCH"));

const vectorRuntimeDriftRows = structuredClone(stableRows);
vectorRuntimeDriftRows[29].vector_worker_status = "OK";
vectorRuntimeDriftRows[29].vector_worker_reason = "";
const vectorRuntimeDrift = analyzeSameAssetStability(reportsFor(vectorRuntimeDriftRows));
assert.equal(vectorRuntimeDrift.validity.status, "INVALID");
assert.ok(vectorRuntimeDrift.validity.errors.some((error) => (
  error.code === "GLOBAL_VECTOR_WORKER_STATUS_MISMATCH"
)));
assert.ok(vectorRuntimeDrift.validity.errors.some((error) => (
  error.code === "GLOBAL_VECTOR_WORKER_REASON_MISMATCH"
)));

const ocrDecisionDriftRows = structuredClone(stableRows);
ocrDecisionDriftRows[29].preingestion_ocr_rendezvous.critical_field_wait.target_fields = [];
ocrDecisionDriftRows[29].preingestion_ocr_rendezvous.critical_field_wait.reasons = [];
const ocrDecisionDrift = analyzeSameAssetStability(reportsFor(ocrDecisionDriftRows));
assert.equal(ocrDecisionDrift.validity.status, "INVALID");
assert.ok(ocrDecisionDrift.validity.errors.some((error) => (
  error.code === "GLOBAL_OCR_CRITICAL_FIELD_DECISION_MISMATCH"
)));

const ocrBudgetDriftRows = structuredClone(stableRows);
ocrBudgetDriftRows[29].preingestion_ocr_rendezvous.critical_field_wait.wait_budget_ms = 1_500;
ocrBudgetDriftRows[29].preingestion_ocr_rendezvous.critical_field_wait.wait_budget_uncapped_ms = 7_500;
const ocrBudgetDrift = analyzeSameAssetStability(reportsFor(ocrBudgetDriftRows));
assert.equal(ocrBudgetDrift.validity.status, "INVALID");
assert.ok(ocrBudgetDrift.validity.errors.some((error) => (
  error.code === "GLOBAL_OCR_WAIT_BUDGET_CAPPED_MS_MISMATCH"
)));
assert.ok(ocrBudgetDrift.validity.errors.some((error) => (
  error.code === "GLOBAL_OCR_WAIT_BUDGET_UNCAPPED_MS_MISMATCH"
)));

const missingPolicyTelemetryRows = structuredClone(stableRows);
delete missingPolicyTelemetryRows[0].preingestion_ocr_rendezvous.critical_field_wait.wait_budget_ceiling_ms;
const missingPolicyTelemetry = analyzeSameAssetStability(reportsFor(missingPolicyTelemetryRows));
assert.equal(missingPolicyTelemetry.validity.status, "INVALID");
assert.ok(missingPolicyTelemetry.validity.errors.some((error) => (
  error.code === "RUNTIME_POLICY_STATE_INCOMPLETE"
  && error.details.missing_components.includes("wait_budget_ceiling")
)));

const planBindingDriftRows = structuredClone(stableRows);
planBindingDriftRows[29].same_asset_execution_id = "different-execution";
const planBindingDrift = analyzeSameAssetStability(reportsFor(planBindingDriftRows));
assert.equal(planBindingDrift.validity.status, "INVALID");
assert.ok(planBindingDrift.validity.errors.some((error) => (
  error.code === "PLAN_BINDING_SAME_ASSET_EXECUTION_ID_MISMATCH"
)));

const retryRows = structuredClone(stableRows);
retryRows[3].provider_transient_retry_attempted = true;
retryRows[3].evaluation_decision_trace_packet.provider_request_identity.provider_http_request_count = 2;
const retry = analyzeSameAssetStability(reportsFor(retryRows));
assert.equal(retry.validity.status, "INVALID");
assert.ok(retry.validity.errors.some((error) => error.code === "cold_algorithm_implicit_provider_retry_forbidden"));
assert.ok(retry.validity.errors.some((error) => error.code === "PROVIDER_HTTP_REQUEST_COUNT_NOT_ONE"));

const duplicateSessionRows = structuredClone(stableRows);
duplicateSessionRows[1].recognition_session_id = duplicateSessionRows[0].recognition_session_id;
const duplicateSession = analyzeSameAssetStability(reportsFor(duplicateSessionRows));
assert.equal(duplicateSession.validity.status, "INVALID");
assert.ok(duplicateSession.validity.errors.some((error) => error.code === "SESSION_IDS_NOT_UNIQUE"));

const flattenedConcurrent = analyzeSameAssetStability([{ results: stableRows }]);
assert.equal(flattenedConcurrent.validity.status, "INVALID");
assert.ok(flattenedConcurrent.validity.errors.some((error) => error.code === "ONE_REPORT_PER_RUN_REQUIRED"));

const overlappingRows = structuredClone(stableRows);
overlappingRows[1].evaluation_decision_trace_packet.provider_request_identity.provider_http_request_started_at = (
  overlappingRows[0].evaluation_decision_trace_packet.provider_request_identity.provider_http_request_started_at
);
const overlapping = analyzeSameAssetStability(reportsFor(overlappingRows));
assert.equal(overlapping.validity.status, "INVALID");
assert.ok(overlapping.validity.errors.some((error) => error.code === "SEQUENTIAL_SINGLE_FLIGHT_PROVIDER_OVERLAP"));

console.log("same asset stability analyzer tests passed");
