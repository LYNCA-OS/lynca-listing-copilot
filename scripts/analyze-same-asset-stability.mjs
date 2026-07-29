#!/usr/bin/env node

import crypto from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertColdAlgorithmBenchmarkResult,
  recognitionBenchmarkProfileIds
} from "../lib/listing/evaluation/recognition-benchmark-profile.mjs";
import {
  evaluationDecisionTraceSchemaVersion,
  evaluationReplaySnapshotSchemaVersion
} from "../lib/listing/evaluation/evaluation-decision-trace-packet.mjs";
import { openAiProviderRequestIdentitySchemaVersion } from "../lib/listing/providers/provider-request-identity.mjs";
import {
  TARGETED_ASSIST_PAIRED_COHORT_SHA256,
  TARGETED_ASSIST_PAIRED_LABEL_SHA256
} from "./run-targeted-assist-paired-eval.mjs";

export const sameAssetStabilitySchemaVersion = "same-asset-cold-stability-v1";
export const sameAssetRuntimePolicyStateSchemaVersion = "same-asset-runtime-policy-state-v1";
export const SAME_ASSET_STABILITY_EXPECTED_RUNS = 30;
const sha256Pattern = /^[0-9a-f]{64}$/i;
const gitShaPattern = /^[0-9a-f]{40}$/i;

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stableValue(value, { semantic = false } = {}) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return semantic ? cleanText(value) : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const rows = value.map((item) => stableValue(item, { semantic }));
    return semantic
      ? rows.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
      : rows;
  }
  if (typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [
      key,
      stableValue(value[key], { semantic })
    ]));
  }
  return String(value);
}

function fingerprint(value, options = {}) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(stableValue(value, options)))
    .digest("hex");
}

export function sameAssetStabilityPlanSha256(plan = {}) {
  return fingerprint(plan);
}

function modeStats(values = []) {
  const counts = new Map();
  for (const value of values) counts.set(value, Number(counts.get(value) || 0) + 1);
  const ranked = [...counts.entries()].sort((left, right) => (
    right[1] - left[1] || left[0].localeCompare(right[0])
  ));
  const modal = ranked[0] || [null, 0];
  return {
    sample_count: values.length,
    unique_fingerprint_count: counts.size,
    modal_fingerprint: modal[0],
    modal_count: modal[1],
    modal_share: values.length ? modal[1] / values.length : null,
    distribution: ranked.map(([sha256, count]) => ({ sha256, count }))
  };
}

function frequency(values = []) {
  const counts = new Map();
  for (const value of values) {
    const key = value === null || value === undefined || value === "" ? "UNKNOWN" : String(value);
    counts.set(key, Number(counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function numericSummary(values = []) {
  const valid = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  return {
    count: valid.length,
    p50: percentile(valid, 0.5),
    p95: percentile(valid, 0.95),
    min: valid[0] ?? null,
    max: valid.at(-1) ?? null
  };
}

function durationOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : null;
}

function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

function sortedTextList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => cleanText(value))
    .filter(Boolean))].sort();
}

// This projection is deliberately derived from the persisted smoke result,
// not from the analyzer's local environment. N=30 runs against a remote
// immutable deployment, so local env values are not evidence of the policy
// that actually executed.
export function buildSameAssetRuntimePolicyState(row = {}) {
  const rendezvous = object(row.preingestion_ocr_rendezvous);
  const critical = object(rendezvous.critical_field_wait);
  const vectorWorkerStatus = cleanText(row.vector_worker_status) || null;
  const vectorWorkerReason = cleanText(row.vector_worker_reason) || null;
  const criticalDecision = {
    should_wait: booleanOrNull(critical.should_wait),
    target_fields: sortedTextList(critical.target_fields),
    reasons: sortedTextList(critical.reasons),
    state_known: booleanOrNull(critical.state_known),
    state_configured: booleanOrNull(critical.state_configured),
    serial_active_count: durationOrNull(critical.serial_active_count),
    grade_label_active_count: durationOrNull(critical.grade_label_active_count),
    slab_likely: booleanOrNull(critical.slab_likely),
    grade_incomplete: booleanOrNull(critical.grade_incomplete),
    grade_completely_missing: booleanOrNull(critical.grade_completely_missing),
    grade_unresolved: booleanOrNull(critical.grade_unresolved),
    ocr_signal_fields: sortedTextList(critical.ocr_signal_fields),
    ocr_signal_conflicting_fields: sortedTextList(critical.ocr_signal_conflicting_fields)
  };
  const waitBudgets = {
    capped_ms: durationOrNull(critical.wait_budget_ms),
    uncapped_ms: durationOrNull(critical.wait_budget_uncapped_ms),
    ceiling_ms: durationOrNull(critical.wait_budget_ceiling_ms),
    base_ms: durationOrNull(critical.base_wait_budget_ms),
    targeted_ms: durationOrNull(critical.targeted_wait_budget_ms)
  };
  const required = {
    vector_worker_status: Boolean(vectorWorkerStatus),
    critical_should_wait: typeof criticalDecision.should_wait === "boolean",
    critical_target_fields: Array.isArray(critical.target_fields),
    critical_reasons: Array.isArray(critical.reasons),
    critical_state_known: typeof criticalDecision.state_known === "boolean",
    critical_state_configured: typeof criticalDecision.state_configured === "boolean",
    critical_serial_active_count: criticalDecision.serial_active_count !== null,
    critical_grade_label_active_count: criticalDecision.grade_label_active_count !== null,
    critical_slab_likely: typeof criticalDecision.slab_likely === "boolean",
    critical_grade_incomplete: typeof criticalDecision.grade_incomplete === "boolean",
    critical_grade_completely_missing: typeof criticalDecision.grade_completely_missing === "boolean",
    critical_grade_unresolved: typeof criticalDecision.grade_unresolved === "boolean",
    critical_ocr_signal_fields: Array.isArray(critical.ocr_signal_fields),
    critical_ocr_signal_conflicting_fields: Array.isArray(critical.ocr_signal_conflicting_fields),
    capped_wait_budget: waitBudgets.capped_ms !== null,
    uncapped_wait_budget: waitBudgets.uncapped_ms !== null,
    wait_budget_ceiling: waitBudgets.ceiling_ms !== null,
    base_wait_budget: waitBudgets.base_ms !== null,
    targeted_wait_budget: waitBudgets.targeted_ms !== null
  };
  const missingComponents = Object.entries(required)
    .filter(([, present]) => !present)
    .map(([name]) => name);
  return {
    schema_version: sameAssetRuntimePolicyStateSchemaVersion,
    status: missingComponents.length ? "PARTIAL" : "COMPLETE",
    missing_components: missingComponents,
    vector_worker: {
      status: vectorWorkerStatus,
      reason: vectorWorkerReason
    },
    ocr_rendezvous: {
      critical_field_decision: criticalDecision,
      wait_budgets: waitBudgets,
      post_provider_wait_ms: durationOrNull(rendezvous.post_provider_wait_ms),
      critical_fields_settled: booleanOrNull(rendezvous.critical_fields_settled),
      target_fields_settled: booleanOrNull(rendezvous.target_fields_settled)
    }
  };
}

function runtimePolicyState(row = {}) {
  return buildSameAssetRuntimePolicyState(row);
}

function pairwiseAgreement(values = []) {
  let comparisons = 0;
  let agreements = 0;
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      comparisons += 1;
      if (values[left] === values[right]) agreements += 1;
    }
  }
  return {
    comparisons,
    agreements,
    agreement: comparisons ? agreements / comparisons : null
  };
}

function lcg(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function percentile(values = [], p = 0.5) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[position];
}

function bootstrapPairwiseAgreement(values = [], samples = 1000, seed = 1) {
  if (values.length < 2 || samples < 1) return { samples: 0, lower_95: null, upper_95: null };
  const random = lcg(seed);
  const estimates = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const draw = Array.from({ length: values.length }, () => values[Math.floor(random() * values.length)]);
    estimates.push(pairwiseAgreement(draw).agreement);
  }
  return {
    samples,
    seed,
    lower_95: percentile(estimates, 0.025),
    upper_95: percentile(estimates, 0.975)
  };
}

function wilson(successes, trials, z = 1.959963984540054) {
  if (!trials) return { lower_95: null, upper_95: null };
  const rate = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const center = (rate + (z * z) / (2 * trials)) / denominator;
  const radius = (z / denominator) * Math.sqrt((rate * (1 - rate) / trials) + (z * z) / (4 * trials * trials));
  return {
    lower_95: Math.max(0, center - radius),
    upper_95: Math.min(1, center + radius)
  };
}

function independentPairAgreement(values = []) {
  const pairCount = Math.floor(values.length / 2);
  let agreements = 0;
  for (let index = 0; index < pairCount; index += 1) {
    if (values[index * 2] === values[index * 2 + 1]) agreements += 1;
  }
  return {
    predeclared_pairing: "RUN_01_02__RUN_03_04__CONTIGUOUS_NON_OVERLAPPING",
    pairs: pairCount,
    agreements,
    agreement: pairCount ? agreements / pairCount : null,
    ...wilson(agreements, pairCount)
  };
}

function historicalIdentityProjection(row = {}) {
  const fields = object(row.evaluation_decision_trace_packet?.replay_snapshot?.resolved_fields);
  return {
    year: fields.year ?? fields.season ?? fields.product_year ?? null,
    manufacturer: fields.manufacturer ?? fields.brand ?? null,
    product: fields.product ?? fields.product_line ?? null,
    set: fields.set ?? fields.insert ?? fields.subset ?? null,
    subject: fields.players ?? fields.player ?? fields.subjects ?? fields.subject ?? fields.character ?? null,
    card_name: fields.card_name ?? fields.official_card_type ?? fields.insert ?? null,
    card_number: fields.collector_number ?? fields.checklist_code ?? fields.card_number ?? fields.tcg_card_number ?? null,
    print_finish: fields.print_finish ?? fields.parallel_exact ?? fields.parallel_family ?? fields.surface_color ?? null,
    grade: fields.card_grade ?? fields.grade ?? null
  };
}

function stagePayloads(row = {}) {
  const packet = object(row.evaluation_decision_trace_packet);
  const replay = object(packet.replay_snapshot);
  const observation = Object.keys(object(packet.provider_observation)).length
    ? packet.provider_observation
    : {
        fields: packet.provider_observation_fields || replay.provider_fields || {},
        field_evidence: replay.provider_field_evidence || [],
        unresolved: [],
        recognition_status: null
      };
  return {
    provider_observation: observation,
    normalization: packet.normalization || replay.normalization || {},
    retrieval_selection_application: {
      retrieval: packet.retrieval || {},
      selection: packet.selection || {},
      application: packet.application || []
    },
    resolver: {
      trace: packet.resolver || {},
      resolved_fields: replay.resolved_fields || {},
      identity_resolution_status: row.identity_resolution_status ?? null,
      ambiguity_status: row.ambiguity_status ?? null,
      field_states: row.field_states || {}
    },
    renderer_input: {
      resolved_fields: replay.resolved_fields || {},
      effective_terminal_renderer_inputs: replay.effective_terminal_renderer_inputs || {},
      renderer_inputs: replay.renderer_inputs || {}
    },
    renderer_output: {
      trace: packet.renderer || {},
      rendered_fields: replay.rendered_fields || {}
    },
    historical_identity_key: historicalIdentityProjection(row),
    final_title: row.final_title || replay.final_title || ""
  };
}

function stageFingerprints(rows = []) {
  const stageNames = Object.keys(stagePayloads(rows[0] || {}));
  return Object.fromEntries(stageNames.map((stage, stageIndex) => {
    const payloads = rows.map((row) => stagePayloads(row)[stage]);
    const exact = payloads.map((payload) => fingerprint(payload));
    const semantic = payloads.map((payload) => fingerprint(payload, { semantic: true }));
    return [stage, {
      exact: {
        ...modeStats(exact),
        pairwise: pairwiseAgreement(exact),
        bootstrap_95: bootstrapPairwiseAgreement(exact, 1000, 20260729 + stageIndex),
        independent_pairs: independentPairAgreement(exact)
      },
      semantic: {
        ...modeStats(semantic),
        pairwise: pairwiseAgreement(semantic),
        bootstrap_95: bootstrapPairwiseAgreement(semantic, 1000, 20261729 + stageIndex),
        independent_pairs: independentPairAgreement(semantic)
      },
      fingerprints: { exact, semantic }
    }];
  }));
}

function conditionalDrift(stages = {}) {
  const sequence = [
    "provider_observation",
    "normalization",
    "retrieval_selection_application",
    "resolver",
    "renderer_input",
    "renderer_output",
    "final_title"
  ];
  const output = {};
  for (let index = 1; index < sequence.length; index += 1) {
    const previous = stages[sequence[index - 1]]?.fingerprints?.semantic || [];
    const current = stages[sequence[index]]?.fingerprints?.semantic || [];
    let conditionedPairs = 0;
    let divergentPairs = 0;
    for (let left = 0; left < current.length; left += 1) {
      for (let right = left + 1; right < current.length; right += 1) {
        if (previous[left] !== previous[right]) continue;
        conditionedPairs += 1;
        if (current[left] !== current[right]) divergentPairs += 1;
      }
    }
    output[`${sequence[index]}_given_${sequence[index - 1]}_equal`] = {
      conditioned_pairs: conditionedPairs,
      divergent_pairs: divergentPairs,
      divergence_rate: conditionedPairs ? divergentPairs / conditionedPairs : null
    };
  }
  return output;
}

function firstDivergence(stages = {}) {
  const sequence = [
    "provider_observation",
    "normalization",
    "retrieval_selection_application",
    "resolver",
    "renderer_input",
    "renderer_output",
    "final_title"
  ];
  const counts = new Map();
  const runCount = stages[sequence[0]]?.fingerprints?.semantic?.length || 0;
  for (let left = 0; left < runCount; left += 1) {
    for (let right = left + 1; right < runCount; right += 1) {
      const first = sequence.find((stage) => (
        stages[stage].fingerprints.semantic[left] !== stages[stage].fingerprints.semantic[right]
      )) || "NO_SEMANTIC_DIVERGENCE";
      counts.set(first, Number(counts.get(first) || 0) + 1);
    }
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function addError(errors, code, runIndex = null, details = null) {
  errors.push({ code, run_index: runIndex, details });
}

function validateRun(row = {}, index = 0) {
  const errors = [];
  try {
    assertColdAlgorithmBenchmarkResult(row);
  } catch (error) {
    addError(errors, cleanText(error?.message || "cold_algorithm_contract_failed"), index);
  }
  if (row.recognition_benchmark_profile !== recognitionBenchmarkProfileIds.COLD_ALGORITHM) {
    addError(errors, "COLD_ALGORITHM_PROFILE_REQUIRED", index);
  }
  if (row.identity_cache_read_bypassed !== true) addError(errors, "IDENTITY_CACHE_READ_NOT_BYPASSED", index);
  if (row.ok !== true || row.writer_ready !== true || row.l2_ready !== true || !cleanText(row.final_title)) {
    addError(errors, "TERMINAL_L2_NOT_READY", index);
  }
  const packet = object(row.evaluation_decision_trace_packet);
  const replay = object(packet.replay_snapshot);
  const request = object(packet.provider_request_identity);
  const observation = object(packet.provider_observation);
  if (packet.schema_version !== evaluationDecisionTraceSchemaVersion || packet.trace_level !== "evaluation") {
    addError(errors, "EVALUATION_TRACE_CONTRACT_INVALID", index);
  }
  if (replay.schema_version !== evaluationReplaySnapshotSchemaVersion
    || replay.status !== "COMPLETE"
    || !Array.isArray(replay.missing_components)
    || replay.missing_components.length !== 0) {
    addError(errors, "REPLAY_SNAPSHOT_NOT_COMPLETE", index);
  }
  if (request.schema_version !== openAiProviderRequestIdentitySchemaVersion || request.status !== "COMPLETE") {
    addError(errors, "PROVIDER_REQUEST_IDENTITY_NOT_COMPLETE", index);
  }
  if (observation.field_evidence_truncated !== false || observation.unresolved_truncated !== false) {
    addError(errors, "PROVIDER_OBSERVATION_TRACE_TRUNCATED_OR_UNPROVEN", index);
  }
  if (!cleanText(observation.recognition_status)
    || Number(observation.field_evidence_count) !== (Array.isArray(observation.field_evidence) ? observation.field_evidence.length : -1)
    || Number(observation.unresolved_count) !== (Array.isArray(observation.unresolved) ? observation.unresolved.length : -1)) {
    addError(errors, "PROVIDER_OBSERVATION_TRACE_INCOMPLETE", index);
  }
  for (const [field, pattern] of [
    ["provider_prompt_sha256", sha256Pattern],
    ["provider_ordered_image_content_sha256", sha256Pattern],
    ["provider_request_controls_sha256", sha256Pattern],
    ["provider_request_fingerprint", sha256Pattern]
  ]) {
    if (!pattern.test(cleanText(request[field]))) addError(errors, `PROVIDER_REQUEST_${field.toUpperCase()}_INVALID`, index);
  }
  if (request.provider_image_manifest_complete !== true) addError(errors, "PROVIDER_IMAGE_MANIFEST_INCOMPLETE", index);
  if (Number(request.provider_image_declared_content_mismatch_count || 0) !== 0) {
    addError(errors, "PROVIDER_IMAGE_DECLARED_CONTENT_MISMATCH", index);
  }
  if (Number(request.provider_http_request_count) !== 1) addError(errors, "PROVIDER_HTTP_REQUEST_COUNT_NOT_ONE", index);
  const providerStartedAt = Date.parse(request.provider_http_request_started_at || "");
  const providerCompletedAt = Date.parse(request.provider_http_request_completed_at || "");
  if (!Number.isFinite(providerStartedAt) || !Number.isFinite(providerCompletedAt)
    || providerCompletedAt < providerStartedAt) {
    addError(errors, "PROVIDER_HTTP_INTERVAL_INVALID", index);
  }
  if (!Number.isInteger(Number(request.provider_prompt_utf8_bytes)) || Number(request.provider_prompt_utf8_bytes) < 1) {
    addError(errors, "PROVIDER_PROMPT_BYTE_LENGTH_INVALID", index);
  }
  if (!Number.isInteger(Number(request.provider_input_image_count)) || Number(request.provider_input_image_count) < 1) {
    addError(errors, "PROVIDER_INPUT_IMAGE_COUNT_INVALID", index);
  }
  if (!cleanText(request.requested_model_id) || !cleanText(request.response_model_id)) {
    addError(errors, "PROVIDER_MODEL_IDENTITY_INCOMPLETE", index);
  }
  if (!gitShaPattern.test(cleanText(packet.deployment_git_sha))) addError(errors, "DEPLOYMENT_GIT_SHA_INVALID", index);
  const versions = object(replay.versions);
  if (!sha256Pattern.test(cleanText(versions.recognition_pipeline_fingerprint))) {
    addError(errors, "PIPELINE_FINGERPRINT_INVALID", index);
  }
  if (!cleanText(versions.catalog_snapshot) || cleanText(versions.catalog_snapshot).startsWith("catalog-revision-unavailable:")) {
    addError(errors, "CATALOG_SNAPSHOT_REVISION_UNAVAILABLE", index);
  }
  if (!cleanText(row.job_id) || !cleanText(row.recognition_session_id)) addError(errors, "JOB_OR_SESSION_ID_MISSING", index);
  if (!cleanText(row.asset_id) || !cleanText(row.image_generation_id)) addError(errors, "ASSET_IDENTITY_MISSING", index);
  if (!sha256Pattern.test(cleanText(row.canonical_image_set_sha256))) addError(errors, "CANONICAL_IMAGE_SET_SHA_INVALID", index);
  if (!sha256Pattern.test(cleanText(row.source_fingerprint))) addError(errors, "SOURCE_FINGERPRINT_INVALID", index);
  if (!Array.isArray(row.canonical_primary_content_sha256)
    || row.canonical_primary_content_sha256.length < 1
    || row.canonical_primary_content_sha256.some((value) => !sha256Pattern.test(cleanText(value)))) {
    addError(errors, "CANONICAL_PRIMARY_CONTENT_SHA_INVALID", index);
  }
  const projectedRuntimePolicy = runtimePolicyState(row);
  if (projectedRuntimePolicy.status !== "COMPLETE") {
    addError(errors, "RUNTIME_POLICY_STATE_INCOMPLETE", index, {
      missing_components: projectedRuntimePolicy.missing_components
    });
  }
  if (row.same_asset_runtime_policy_state !== undefined
    && JSON.stringify(stableValue(row.same_asset_runtime_policy_state))
      !== JSON.stringify(stableValue(projectedRuntimePolicy))) {
    addError(errors, "RUNTIME_POLICY_STATE_PROJECTION_MISMATCH", index);
  }
  return errors;
}

function validateExecutionPlan(plan = {}) {
  const errors = [];
  const cohort = cleanText(plan.frozen_cohort).toUpperCase();
  const proof = object(plan.frozen_cohort_proof);
  const asset = object(plan.asset_cache_proof);
  if (plan.schema_version !== "same-asset-stability-execution-plan-v1") addError(errors, "EXECUTION_PLAN_SCHEMA_INVALID");
  if (plan.execution_mode !== "EXECUTE_AUTHORIZED") addError(errors, "EXECUTION_PLAN_NOT_AUTHORIZED");
  if (!cleanText(plan.execution_id)) addError(errors, "EXECUTION_ID_MISSING");
  if (cleanText(plan.cohort).toLowerCase() !== "development") addError(errors, "PLAN_DEVELOPMENT_COHORT_REQUIRED");
  if (!Object.hasOwn(TARGETED_ASSIST_PAIRED_COHORT_SHA256, cohort)) addError(errors, "PLAN_FROZEN_COHORT_INVALID");
  if (cleanText(proof.evaluation_partition).toLowerCase() !== "development") {
    addError(errors, "PLAN_DEVELOPMENT_PROOF_MISSING");
  }
  if (Number(proof.item_count) !== 10 || Number(plan.dataset_item_count) !== 10) {
    addError(errors, "PLAN_FROZEN_COHORT_SIZE_INVALID");
  }
  if (cleanText(proof.selected_item_ids_sha256) !== TARGETED_ASSIST_PAIRED_COHORT_SHA256[cohort]) {
    addError(errors, "PLAN_FROZEN_COHORT_HASH_MISMATCH");
  }
  if (cleanText(proof.sealed_labels_sha256) !== TARGETED_ASSIST_PAIRED_LABEL_SHA256[cohort]) {
    addError(errors, "PLAN_FROZEN_LABEL_HASH_MISMATCH");
  }
  for (const [field, value] of [
    ["dataset_sha256", plan.dataset_sha256],
    ["sealed_labels_sha256", plan.sealed_labels_sha256],
    ["selected_item_sha256", plan.selected_item_sha256],
    ["asset_source_fingerprint", asset.fingerprint],
    ["asset_canonical_image_set_sha256", asset.canonical_image_set_sha256]
  ]) {
    if (!sha256Pattern.test(cleanText(value))) addError(errors, `PLAN_${field.toUpperCase()}_INVALID`);
  }
  if (!cleanText(plan.selected_item_id) || !Number.isInteger(Number(plan.selected_item_index))) {
    addError(errors, "PLAN_SELECTED_ITEM_MEMBERSHIP_INVALID");
  }
  if (!cleanText(asset.asset_id) || !cleanText(asset.image_generation_id)
    || cleanText(asset.asset_id) !== cleanText(asset.image_generation_id)) {
    addError(errors, "PLAN_CANONICAL_ASSET_IDENTITY_INVALID");
  }
  if (!Array.isArray(asset.canonical_primary_content_sha256)
    || asset.canonical_primary_content_sha256.length < 1
    || asset.canonical_primary_content_sha256.some((value) => !sha256Pattern.test(cleanText(value)))) {
    addError(errors, "PLAN_CANONICAL_PRIMARY_HASHES_INVALID");
  }
  if (Number(plan.planned_runs) !== SAME_ASSET_STABILITY_EXPECTED_RUNS
    || Number(plan.planned_job_runs) !== SAME_ASSET_STABILITY_EXPECTED_RUNS) {
    addError(errors, "PLAN_RUN_COUNT_INVALID");
  }
  return errors;
}

function validateRunPlanBinding(row = {}, plan = {}, planSha256 = "", index = 0) {
  const errors = [];
  const asset = object(plan.asset_cache_proof);
  const exactFields = [
    ["same_asset_execution_id", plan.execution_id],
    ["same_asset_plan_sha256", planSha256],
    ["same_asset_dataset_sha256", plan.dataset_sha256],
    ["same_asset_sealed_labels_sha256", plan.sealed_labels_sha256],
    ["same_asset_selected_item_id", plan.selected_item_id],
    ["asset_id", asset.asset_id],
    ["image_generation_id", asset.image_generation_id],
    ["source_fingerprint", asset.fingerprint],
    ["canonical_image_set_sha256", asset.canonical_image_set_sha256]
  ];
  for (const [field, expected] of exactFields) {
    if (cleanText(row[field]) !== cleanText(expected)) {
      addError(errors, `PLAN_BINDING_${field.toUpperCase()}_MISMATCH`, index);
    }
  }
  if (JSON.stringify(row.canonical_primary_content_sha256 || null)
    !== JSON.stringify(asset.canonical_primary_content_sha256 || null)) {
    addError(errors, "PLAN_BINDING_CANONICAL_PRIMARY_CONTENT_MISMATCH", index);
  }
  return errors;
}

function uniqueProjection(rows = [], project) {
  return [...new Set(rows.map((row) => JSON.stringify(project(row))))];
}

function globalInput(rows = []) {
  const first = rows[0] || {};
  const packet = object(first.evaluation_decision_trace_packet);
  const replay = object(packet.replay_snapshot);
  const request = object(packet.provider_request_identity);
  const runtimePolicy = runtimePolicyState(first);
  return {
    asset_id: first.asset_id || null,
    image_generation_id: first.image_generation_id || null,
    canonical_image_set_sha256: first.canonical_image_set_sha256 || null,
    canonical_primary_content_sha256: first.canonical_primary_content_sha256 || null,
    source_fingerprint: first.source_fingerprint || null,
    deployment_git_sha: packet.deployment_git_sha || null,
    recognition_pipeline_fingerprint: replay.versions?.recognition_pipeline_fingerprint || null,
    catalog_snapshot_revision: replay.versions?.catalog_snapshot || null,
    requested_model_id: request.requested_model_id || null,
    response_model_id: request.response_model_id || null,
    prompt_utf8_sha256: request.provider_prompt_sha256 || null,
    prompt_utf8_bytes: request.provider_prompt_utf8_bytes ?? null,
    request_controls_sha256: request.provider_request_controls_sha256 || null,
    ordered_provider_images_sha256: request.provider_ordered_image_content_sha256 || null,
    provider_request_fingerprint: request.provider_request_fingerprint || null,
    response_profile: request.response_profile || null,
    image_detail: request.image_detail || null,
    max_output_tokens: request.max_output_tokens ?? null,
    reasoning_effort: request.reasoning_effort || null,
    temperature: request.temperature ?? null,
    text_verbosity: request.text_verbosity || null,
    requested_service_tier: request.requested_service_tier || null,
    runtime_policy_state: runtimePolicy
  };
}

export function flattenSameAssetReports(reports = []) {
  return reports.flatMap((report) => Array.isArray(report?.results) ? report.results : []);
}

function reportAndScheduleErrors(reports = [], expectedRuns = SAME_ASSET_STABILITY_EXPECTED_RUNS) {
  const errors = [];
  if (reports.length > expectedRuns) {
    addError(errors, "PLANNED_REPORT_COUNT_EXCEEDED", null, { expected: expectedRuns, observed: reports.length });
  }
  const intervals = [];
  reports.forEach((report, reportIndex) => {
    const rows = Array.isArray(report?.results) ? report.results : [];
    if (rows.length !== 1) {
      addError(errors, "ONE_REPORT_PER_RUN_REQUIRED", reportIndex, { result_count: rows.length });
      return;
    }
    const row = rows[0];
    if (Number(row.runner_attempt) !== reportIndex + 1) {
      addError(errors, "RUNNER_ATTEMPT_SEQUENCE_INVALID", reportIndex, {
        expected: reportIndex + 1,
        observed: row.runner_attempt ?? null
      });
    }
    const request = object(row.evaluation_decision_trace_packet?.provider_request_identity);
    const startedAt = Date.parse(request.provider_http_request_started_at || "");
    const completedAt = Date.parse(request.provider_http_request_completed_at || "");
    if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) {
      addError(errors, "PROVIDER_INTERVAL_INVALID", reportIndex);
      return;
    }
    intervals.push({ reportIndex, startedAt, completedAt });
  });
  for (let index = 1; index < intervals.length; index += 1) {
    const previous = intervals[index - 1];
    const current = intervals[index];
    if (current.startedAt < previous.completedAt) {
      addError(errors, "SEQUENTIAL_SINGLE_FLIGHT_PROVIDER_OVERLAP", current.reportIndex, {
        previous_report_index: previous.reportIndex,
        overlap_ms: previous.completedAt - current.startedAt
      });
    }
  }
  return errors;
}

export function analyzeSameAssetStability(reports = [], {
  plan = null,
  expectedRuns = SAME_ASSET_STABILITY_EXPECTED_RUNS,
  maximumWindowMs = 3_600_000
} = {}) {
  if (Number(expectedRuns) !== SAME_ASSET_STABILITY_EXPECTED_RUNS) {
    throw new Error(`same-asset stability expected runs are frozen at ${SAME_ASSET_STABILITY_EXPECTED_RUNS}`);
  }
  const rows = flattenSameAssetReports(reports);
  const planObject = object(plan);
  const planSha256 = sameAssetStabilityPlanSha256(planObject);
  const errors = [
    ...validateExecutionPlan(planObject),
    ...reportAndScheduleErrors(reports, expectedRuns),
    ...rows.flatMap((row, index) => [
      ...validateRun(row, index),
      ...validateRunPlanBinding(row, planObject, planSha256, index)
    ])
  ];
  const globalFields = {
    asset_identity: (row) => [row.asset_id, row.image_generation_id, row.canonical_image_set_sha256],
    source_fingerprint: (row) => row.source_fingerprint,
    canonical_primary_content: (row) => row.canonical_primary_content_sha256,
    deployment_git_sha: (row) => row.evaluation_decision_trace_packet?.deployment_git_sha,
    recognition_pipeline_fingerprint: (row) => row.evaluation_decision_trace_packet?.replay_snapshot?.versions?.recognition_pipeline_fingerprint,
    catalog_snapshot_revision: (row) => row.evaluation_decision_trace_packet?.replay_snapshot?.versions?.catalog_snapshot,
    requested_model_id: (row) => row.evaluation_decision_trace_packet?.provider_request_identity?.requested_model_id,
    response_model_id: (row) => row.evaluation_decision_trace_packet?.provider_request_identity?.response_model_id,
    prompt_sha256: (row) => row.evaluation_decision_trace_packet?.provider_request_identity?.provider_prompt_sha256,
    prompt_utf8_bytes: (row) => row.evaluation_decision_trace_packet?.provider_request_identity?.provider_prompt_utf8_bytes,
    request_controls_sha256: (row) => row.evaluation_decision_trace_packet?.provider_request_identity?.provider_request_controls_sha256,
    ordered_provider_images_sha256: (row) => row.evaluation_decision_trace_packet?.provider_request_identity?.provider_ordered_image_content_sha256,
    provider_request_fingerprint: (row) => row.evaluation_decision_trace_packet?.provider_request_identity?.provider_request_fingerprint,
    vector_worker_status: (row) => runtimePolicyState(row).vector_worker.status,
    vector_worker_reason: (row) => runtimePolicyState(row).vector_worker.reason,
    ocr_critical_field_decision: (row) => runtimePolicyState(row).ocr_rendezvous.critical_field_decision,
    ocr_wait_budget_capped_ms: (row) => runtimePolicyState(row).ocr_rendezvous.wait_budgets.capped_ms,
    ocr_wait_budget_uncapped_ms: (row) => runtimePolicyState(row).ocr_rendezvous.wait_budgets.uncapped_ms,
    ocr_wait_budget_ceiling_ms: (row) => runtimePolicyState(row).ocr_rendezvous.wait_budgets.ceiling_ms,
    ocr_wait_budget_base_ms: (row) => runtimePolicyState(row).ocr_rendezvous.wait_budgets.base_ms,
    ocr_wait_budget_targeted_ms: (row) => runtimePolicyState(row).ocr_rendezvous.wait_budgets.targeted_ms
  };
  for (const [name, project] of Object.entries(globalFields)) {
    const values = uniqueProjection(rows, project);
    if (values.length !== 1) addError(errors, `GLOBAL_${name.toUpperCase()}_MISMATCH`, null, { unique_count: values.length });
  }
  const jobIds = rows.map((row) => cleanText(row.job_id)).filter(Boolean);
  const sessionIds = rows.map((row) => cleanText(row.recognition_session_id)).filter(Boolean);
  if (new Set(jobIds).size !== rows.length) addError(errors, "JOB_IDS_NOT_UNIQUE");
  if (new Set(sessionIds).size !== rows.length) addError(errors, "SESSION_IDS_NOT_UNIQUE");
  const timestamps = rows.map((row) => Date.parse(row.job_created_at || "")).filter(Number.isFinite);
  const providerCompletedTimestamps = rows.map((row) => Date.parse(
    row.evaluation_decision_trace_packet?.provider_request_identity?.provider_http_request_completed_at || ""
  )).filter(Number.isFinite);
  if (timestamps.length !== rows.length || providerCompletedTimestamps.length !== rows.length) {
    addError(errors, "JOB_CREATED_AT_INCOMPLETE");
  } else if (Math.max(...providerCompletedTimestamps) - Math.min(...timestamps) > maximumWindowMs) {
    addError(errors, "EXPERIMENT_WINDOW_EXCEEDED", null, {
      observed_ms: Math.max(...providerCompletedTimestamps) - Math.min(...timestamps),
      maximum_ms: maximumWindowMs
    });
  }

  let status = "VALID";
  if (rows.length < expectedRuns && errors.length === 0) status = "PARTIAL";
  if (rows.length > expectedRuns) addError(errors, "PLANNED_RUN_COUNT_EXCEEDED", null, { expected: expectedRuns, observed: rows.length });
  if (errors.length > 0) status = "INVALID";
  const stages = stageFingerprints(rows);
  const report = {
    schema_version: sameAssetStabilitySchemaVersion,
    generated_at: new Date().toISOString(),
    scope: errors.some((error) => error.code.startsWith("EXECUTION_PLAN_") || error.code.startsWith("PLAN_"))
      ? "UNBOUND_REPEATABILITY_INPUT"
      : "ONE_PREDECLARED_DEVELOPMENT_ASSET_REPEATABILITY_ONLY",
    execution_plan: {
      execution_id: cleanText(planObject.execution_id) || null,
      plan_sha256: planSha256,
      frozen_cohort: cleanText(planObject.frozen_cohort).toUpperCase() || null,
      selected_item_id: cleanText(planObject.selected_item_id) || null,
      dataset_sha256: cleanText(planObject.dataset_sha256) || null,
      sealed_labels_sha256: cleanText(planObject.sealed_labels_sha256) || null
    },
    validity: {
      status,
      planned_attempts: expectedRuns,
      completed_attempts: rows.length,
      legal_runs: Math.max(0, rows.length - new Set(errors.map((error) => error.run_index).filter(Number.isInteger)).size),
      experiment_window_ms: timestamps.length === rows.length
        && providerCompletedTimestamps.length === rows.length && timestamps.length
        ? Math.max(...providerCompletedTimestamps) - Math.min(...timestamps)
        : null,
      maximum_window_ms: maximumWindowMs,
      errors
    },
    frozen_input: globalInput(rows),
    stage_distributions: Object.fromEntries(Object.entries(stages).map(([name, stage]) => {
      const exactDistribution = { ...stage.exact, fingerprints: undefined };
      return [name, name === "final_title" ? {
        projection_contract: "EXACT_FINAL_TITLE_STRING",
        exact: exactDistribution,
        semantic: { ...stage.semantic, fingerprints: undefined }
      } : {
        projection_contract: "PERSISTED_TRACE_BOUNDED_PROJECTION",
        bounded_exact: exactDistribution,
        semantic: { ...stage.semantic, fingerprints: undefined }
      }];
    })),
    conditional_drift: conditionalDrift(stages),
    first_divergence_classification: firstDivergence(stages),
    nuisance_variables: {
      provider_key_slots: frequency(rows.map((row) => row.provider_key_slot)),
      provider_service_tiers: frequency(rows.map((row) => row.provider_service_tier)),
      provider_latency_ms: numericSummary(rows.map((row) => row.provider_latency_ms)),
      worker_processing_ms: numericSummary(rows.map((row) => row.worker_processing_ms)),
      ocr_post_provider_wait_ms: numericSummary(rows.map((row) => (
        runtimePolicyState(row).ocr_rendezvous.post_provider_wait_ms
      ))),
      ocr_critical_fields_settled: frequency(rows.map((row) => (
        runtimePolicyState(row).ocr_rendezvous.critical_fields_settled
      ))),
      ocr_target_fields_settled: frequency(rows.map((row) => (
        runtimePolicyState(row).ocr_rendezvous.target_fields_settled
      ))),
      signed_url_identity_recorded: false
    },
    interpretation: {
      provider_observation_divergence_label: "PROVIDER_OR_TRANSPORT_DRIFT",
      model_nondeterminism_claim_permitted: false,
      accuracy_claim_permitted: false,
      global_stability_claim_permitted: false,
      cache_approval_claim_permitted: false,
      provider_request_identity_fingerprints_are_exact_for_the_final_request_boundary: true,
      intermediate_stage_fingerprints_are_bounded_to_the_persisted_trace_projection: true,
      downstream_pipeline_drift_is_proven_only_when_upstream_semantic_fingerprint_is_equal: true
    },
    limitations: [
      "A single asset measures repeatability for that asset only; it does not estimate population accuracy or global stability.",
      "A stable requested/response model alias cannot expose an unannounced hosted model revision.",
      "Signed URL bytes are intentionally excluded; the ordered manifest hashes verified image content instead.",
      "Intermediate bounded-exact distributions compare persisted Trace projections, not full in-memory stage objects.",
      "All 435 run pairs are dependent and are not treated as 435 independent Bernoulli samples.",
      "Only the 15 predeclared non-overlapping pairs receive Wilson intervals."
    ]
  };
  return report;
}

function argValues(argv, name) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name && argv[index + 1]) values.push(argv[index + 1]);
  }
  return values;
}

function argValue(argv, name, fallback = "") {
  return argValues(argv, name)[0] || fallback;
}

export async function main(argv = process.argv.slice(2)) {
  const inputs = argValues(argv, "--input");
  if (!inputs.length) throw new Error("at least one --input smoke report is required");
  const planPath = argValue(argv, "--plan", "");
  if (!planPath) throw new Error("--plan is required to bind the frozen Development asset");
  const reports = await Promise.all(inputs.map(async (path) => JSON.parse(await readFile(resolve(path), "utf8"))));
  const plan = JSON.parse(await readFile(resolve(planPath), "utf8"));
  const expectedRuns = Math.max(1, Math.trunc(Number(argValue(
    argv,
    "--expected-runs",
    String(SAME_ASSET_STABILITY_EXPECTED_RUNS)
  )) || SAME_ASSET_STABILITY_EXPECTED_RUNS));
  const report = analyzeSameAssetStability(reports, { plan, expectedRuns });
  const outPath = argValue(argv, "--out", "");
  if (outPath) await writeFile(resolve(outPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.validity.status === "VALID" ? 0 : 1;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
