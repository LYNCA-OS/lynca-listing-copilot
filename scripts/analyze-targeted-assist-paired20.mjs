#!/usr/bin/env node

import crypto from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import {
  assertColdAlgorithmBenchmarkResult,
  assertColdTargetedAssistBenchmarkResult,
  recognitionBenchmarkProfileIds
} from "../lib/listing/evaluation/recognition-benchmark-profile.mjs";
import {
  candidateSourceRequiresFeedbackIdentity,
  evaluationDecisionTraceSchemaVersion,
  evaluationReplaySnapshotSchemaVersion
} from "../lib/listing/evaluation/evaluation-decision-trace-packet.mjs";
import { providerAuxRouteReplayInputHash } from "../lib/listing/v4/route-planner/provider-aux-route-shadow.mjs";

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sha256(value) {
  const text = cleanText(value);
  return text ? crypto.createHash("sha256").update(text).digest("hex") : null;
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mean(values = []) {
  const valid = values.map(finite).filter((value) => value !== null);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function percentile(values = [], p = 0.5) {
  const valid = values.map(finite).filter((value) => value !== null).sort((a, b) => a - b);
  if (!valid.length) return null;
  const index = Math.min(valid.length - 1, Math.max(0, Math.ceil(valid.length * p) - 1));
  return valid[index];
}

function ledger(row = {}) {
  const direct = row.provider_call_ledger;
  const nested = row.targeted_assist_execution?.provider_call_ledger;
  return Array.isArray(direct) ? direct : Array.isArray(nested) ? nested : [];
}

function stageRows(row = {}, stage = "") {
  return ledger(row).filter((entry) => cleanText(entry?.logical_stage) === stage);
}

function stageValue(row = {}, stage = "", key = "latency_ms") {
  const values = stageRows(row, stage).map((entry) => finite(entry?.[key])).filter((value) => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function providerWork(row = {}) {
  const typed = ledger(row).map((entry) => finite(entry?.latency_ms)).filter((value) => value !== null);
  if (typed.length) return typed.reduce((sum, value) => sum + value, 0);
  return finite(row.provider_latency_ms ?? row.provider_diagnostics?.provider_latency_ms);
}

function score(row = {}) {
  return finite(row.final_scoring?.policy_fair_token_recall);
}

function terminalResultReady(row = {}) {
  return row.ok === true
    && row.writer_ready === true
    && row.l2_ready === true
    && Boolean(cleanText(row.final_title));
}

function deploymentGitSha(row = {}) {
  return cleanText(row.evaluation_decision_trace_packet?.deployment_git_sha).toLowerCase();
}

function sameDeploymentGitSha(baseline = {}, candidate = {}) {
  const left = deploymentGitSha(baseline);
  const right = deploymentGitSha(candidate);
  return /^[0-9a-f]{40}$/.test(left) && left === right;
}

function criticalGuard(row = {}) {
  return row.final_scoring?.critical_title_guard || null;
}

function criticalGuardComplete(row = {}) {
  const guard = criticalGuard(row);
  return row.reference_title_is_reviewed_ground_truth === true
    && guard?.schema_version === "title-critical-guard-v1"
    && guard?.evaluation_scope === "OFFLINE_POST_PREDICTION_ONLY"
    && guard?.runtime_chain_effect === "NONE"
    && guard?.reviewed_title_ground_truth === true
    && guard?.complete === true
    && guard?.critical_coverage_complete === true
    && Array.isArray(guard?.evaluated_fields)
    && guard.evaluated_fields.length > 0
    && Array.isArray(guard?.mismatches)
    && Number.isInteger(guard?.mismatch_count)
    && guard.mismatch_count === guard.mismatches.length
    && typeof guard?.catastrophic === "boolean"
    && typeof guard?.critical_fabrication === "boolean";
}

function providerAuxRoute(row = {}) {
  return row.evaluation_decision_trace_packet?.provider_aux_route || null;
}

function timestampMs(value) {
  const parsed = Date.parse(cleanText(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function providerAuxDecisionFrozenBeforeProvider(route = {}) {
  const cutoffMs = timestampMs(route.decision_evidence_cutoff_at);
  const decidedMs = timestampMs(route.route_decided_at);
  const providerStartedMs = timestampMs(route.first_provider_call_started_at);
  return route.decision_frozen_before_provider === true
    && cutoffMs !== null
    && decidedMs !== null
    && providerStartedMs !== null
    && cutoffMs <= decidedMs
    && decidedMs <= providerStartedMs;
}

function providerAuxInputComplete(row = {}) {
  const route = providerAuxRoute(row);
  return Boolean(
    route
    && /^[0-9a-f]{64}$/i.test(cleanText(route.preprovider_snapshot_hash))
    && /^[0-9a-f]{64}$/i.test(cleanText(route.route_input_hash))
    && route.trace_completeness === "COMPLETE"
    && route.source_availability === "COMPLETE"
    && providerAuxDecisionFrozenBeforeProvider(route)
    && Number(route.provider_derived_field_count || 0) === 0
    && Number(route.post_cutoff_evidence_count || 0) === 0
    && Array.isArray(route.evidence_availability_manifest)
    && route.replay_input
    && providerAuxRouteReplayInputHash(route.replay_input) === route.preprovider_snapshot_hash
  );
}

function sameProviderAuxInput(baseline = {}, candidate = {}) {
  const left = providerAuxRoute(baseline);
  const right = providerAuxRoute(candidate);
  return left.preprovider_snapshot_hash === right.preprovider_snapshot_hash
    && left.route_input_hash === right.route_input_hash
    && JSON.stringify(left.evidence_availability_manifest) === JSON.stringify(right.evidence_availability_manifest);
}

function sourceFeedbackId(row = {}) {
  return cleanText(row.source_feedback_id || row.sourceFeedbackId);
}

function selfRetrievalExclusionComplete(row = {}, { required = false } = {}) {
  const sourceId = sourceFeedbackId(row);
  if (!sourceId) return required !== true;
  const expectedHash = sha256(sourceId);
  const packet = row.evaluation_decision_trace_packet || {};
  const exclusion = packet.self_retrieval_exclusion || {};
  const topK = Array.isArray(packet.retrieval?.top_k) ? packet.retrieval.top_k : [];
  const candidateCount = Number(packet.retrieval?.candidate_count);
  const unobservableReviewedCandidates = topK.filter((candidate) => (
    candidateSourceRequiresFeedbackIdentity(candidate)
    && !/^[0-9a-f]{64}$/i.test(cleanText(candidate.source_feedback_id_sha256))
  ));
  const vectorUnavailableReasons = (Array.isArray(row.vector_runtime_unavailable_reasons)
    ? row.vector_runtime_unavailable_reasons
    : [row.vector_runtime_unavailable_reasons])
    .map(cleanText)
    .filter(Boolean);
  const vectorExecutionValid = row.vector_self_exclusion_query_attempted === true
    || (
      row.vector_self_exclusion_query_attempted === false
      && row.vector_runtime_status === "UNAVAILABLE"
      && vectorUnavailableReasons.length === 1
      && vectorUnavailableReasons[0] === "vector_lazy_provider_catalog_anchor"
      && Number(row.l2_vector_raw_candidate_count || 0) === 0
    );
  return vectorExecutionValid
    && row.vector_self_exclusion_filter_active === true
    && Number(row.vector_self_exclusion_requested_source_count) === 1
    && cleanText(row.vector_self_exclusion_source_ids_sha256).toLowerCase() === expectedHash
    && exclusion.required === true
    && cleanText(exclusion.source_feedback_id_sha256).toLowerCase() === expectedHash
    && Number(exclusion.top_k_checked_count) === candidateCount
    && candidateCount === topK.length
    && Number(exclusion.all_candidate_count) === Number(exclusion.all_candidates_checked_count)
    && exclusion.candidate_check_truncated === false
    && Number(exclusion.unobservable_reviewed_candidate_count) === 0
    && Number(exclusion.same_source_candidate_count) === 0
    && Array.isArray(exclusion.same_source_candidate_ids)
    && exclusion.same_source_candidate_ids.length === 0
    && unobservableReviewedCandidates.length === 0
    && topK.every((candidate) => (
      cleanText(candidate.source_feedback_id_sha256).toLowerCase() !== expectedHash
    ));
}

function sameSelfRetrievalSource(baseline = {}, candidate = {}) {
  return sourceFeedbackId(baseline) === sourceFeedbackId(candidate);
}

function evaluationTraceContractComplete(row = {}) {
  const packet = row.evaluation_decision_trace_packet || {};
  const replay = packet.replay_snapshot || {};
  return packet.schema_version === evaluationDecisionTraceSchemaVersion
    && packet.trace_level === "evaluation"
    && replay.schema_version === evaluationReplaySnapshotSchemaVersion
    && replay.status === "COMPLETE"
    && Array.isArray(replay.missing_components)
    && replay.missing_components.length === 0;
}

const DURABLE_ASSET_ID_PATTERN = /^asset_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

function normalizedSha256List(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) return null;
  const hashes = value.map((entry) => cleanText(entry).toLowerCase());
  if (hashes.some((entry) => !SHA256_PATTERN.test(entry))) return null;
  return [...hashes].sort();
}

function immutableImageInput(row = {}) {
  const cacheEntry = row.asset_cache_entry && typeof row.asset_cache_entry === "object"
    ? row.asset_cache_entry
    : {};
  return {
    asset_id: cleanText(row.asset_id),
    source_fingerprint: cleanText(
      row.source_fingerprint
      || row.preparation_diagnostics?.source_fingerprint
      || cacheEntry.fingerprint
    ).toLowerCase(),
    image_generation_id: cleanText(row.image_generation_id || cacheEntry.image_generation_id),
    canonical_image_set_sha256: cleanText(
      row.canonical_image_set_sha256 || cacheEntry.canonical_image_set_sha256
    ).toLowerCase(),
    canonical_primary_content_sha256: normalizedSha256List(
      row.canonical_primary_content_sha256 || cacheEntry.canonical_primary_content_sha256
    )
  };
}

function immutableImageInputComplete(row = {}) {
  const input = immutableImageInput(row);
  return DURABLE_ASSET_ID_PATTERN.test(input.asset_id)
    && SHA256_PATTERN.test(input.source_fingerprint)
    && DURABLE_ASSET_ID_PATTERN.test(input.image_generation_id)
    && input.image_generation_id === input.asset_id
    && SHA256_PATTERN.test(input.canonical_image_set_sha256)
    && Array.isArray(input.canonical_primary_content_sha256);
}

function sameImmutableImageInput(baseline = {}, candidate = {}) {
  const left = immutableImageInput(baseline);
  const right = immutableImageInput(candidate);
  return left.asset_id === right.asset_id
    && left.source_fingerprint === right.source_fingerprint
    && left.image_generation_id === right.image_generation_id
    && left.canonical_image_set_sha256 === right.canonical_image_set_sha256
    && JSON.stringify(left.canonical_primary_content_sha256) === JSON.stringify(right.canonical_primary_content_sha256);
}

function pairKey(row = {}) {
  return cleanText(
    row.sealed_label_key
    || row.source_feedback_id
    || row.source_asset_id
    || row.physical_card_id
    || row.asset_id
  );
}

function versionVector(row = {}) {
  const versions = row.evaluation_decision_trace_packet?.replay_snapshot?.versions || {};
  return {
    recognition_pipeline_fingerprint: versions.recognition_pipeline_fingerprint
      || row.recognition_pipeline_fingerprint
      || row.identity_cache_version_fingerprint
      || null,
    targeted_assist_nuisance_fingerprint: versions.targeted_assist_nuisance_fingerprint || null,
    targeted_assist_nuisance_contract: versions.targeted_assist_nuisance_contract || null,
    evidence_schema: versions.evidence_schema || row.evidence_schema_version || null,
    normalization: versions.normalization || row.normalization_version || null,
    candidate_policy: versions.candidate_policy || row.candidate_policy_version || null,
    constraint_snapshot: versions.constraint_snapshot || null,
    constraint_snapshot_sha256: versions.constraint_snapshot_sha256 || null,
    constraint_enumerator: versions.constraint_enumerator || null,
    resolver: versions.resolver || row.resolver_version || null,
    renderer: versions.renderer || row.renderer_version || null
  };
}

function sameStableVersions(left = {}, right = {}) {
  const leftVector = versionVector(left);
  const rightVector = versionVector(right);
  if (leftVector.targeted_assist_nuisance_contract !== "targeted-assist-nuisance-fingerprint-v1"
    || rightVector.targeted_assist_nuisance_contract !== "targeted-assist-nuisance-fingerprint-v1") return false;
  if (leftVector.targeted_assist_nuisance_fingerprint !== rightVector.targeted_assist_nuisance_fingerprint) return false;
  const stableOwnerFields = [
    "evidence_schema",
    "normalization",
    "candidate_policy",
    "constraint_snapshot",
    "constraint_snapshot_sha256",
    "constraint_enumerator",
    "resolver",
    "renderer"
  ];
  return stableOwnerFields.every((field) => leftVector[field] === rightVector[field]);
}

function stableVersionVectorComplete(row = {}) {
  const vector = versionVector(row);
  const complete = [
    "recognition_pipeline_fingerprint",
    "targeted_assist_nuisance_fingerprint",
    "targeted_assist_nuisance_contract",
    "evidence_schema",
    "normalization",
    "candidate_policy",
    "constraint_snapshot",
    "constraint_snapshot_sha256",
    "constraint_enumerator",
    "resolver",
    "renderer"
  ].every((field) => cleanText(vector[field]));
  return complete
    && /^[0-9a-f]{64}$/i.test(cleanText(vector.recognition_pipeline_fingerprint))
    && /^[0-9a-f]{64}$/i.test(cleanText(vector.targeted_assist_nuisance_fingerprint))
    && vector.targeted_assist_nuisance_contract === "targeted-assist-nuisance-fingerprint-v1";
}

export function assertTargetedAssistPair(baseline = {}, candidate = {}, {
  requireSelfRetrievalExclusion = false
} = {}) {
  assertColdAlgorithmBenchmarkResult(baseline);
  assertColdTargetedAssistBenchmarkResult(candidate);
  if (baseline.recognition_benchmark_profile !== recognitionBenchmarkProfileIds.COLD_ALGORITHM) {
    throw new Error("targeted_pair_baseline_result_profile_mismatch");
  }
  if (candidate.recognition_benchmark_profile !== recognitionBenchmarkProfileIds.COLD_TARGETED_ASSIST) {
    throw new Error("targeted_pair_candidate_result_profile_mismatch");
  }
  if (!terminalResultReady(baseline) || !terminalResultReady(candidate)) {
    throw new Error("targeted_pair_terminal_writer_ready_result_required");
  }
  if (!evaluationTraceContractComplete(baseline) || !evaluationTraceContractComplete(candidate)) {
    throw new Error("targeted_pair_evaluation_trace_contract_incomplete");
  }
  if (!sameDeploymentGitSha(baseline, candidate)) {
    throw new Error("targeted_pair_deployment_git_sha_incomplete_or_mismatch");
  }
  if (pairKey(baseline) === "" || pairKey(baseline) !== pairKey(candidate)) {
    throw new Error(`targeted_pair_identity_mismatch_${pairKey(baseline) || "empty"}_${pairKey(candidate) || "empty"}`);
  }
  if (!immutableImageInputComplete(baseline) || !immutableImageInputComplete(candidate)) {
    throw new Error("targeted_pair_immutable_image_input_incomplete");
  }
  if (!sameImmutableImageInput(baseline, candidate)) {
    throw new Error("targeted_pair_immutable_image_input_mismatch");
  }
  if (!stableVersionVectorComplete(baseline) || !stableVersionVectorComplete(candidate)) {
    throw new Error("targeted_pair_stable_version_vector_incomplete");
  }
  if (!sameStableVersions(baseline, candidate)) throw new Error("targeted_pair_stable_version_mismatch");
  if (score(baseline) === null || score(candidate) === null) throw new Error("targeted_pair_score_missing");
  if (!criticalGuardComplete(baseline) || !criticalGuardComplete(candidate)) {
    throw new Error("targeted_pair_critical_guard_incomplete");
  }
  if (!providerAuxInputComplete(baseline) || !providerAuxInputComplete(candidate)) {
    throw new Error("targeted_pair_preprovider_input_incomplete");
  }
  if (!sameProviderAuxInput(baseline, candidate)) {
    throw new Error("targeted_pair_preprovider_input_mismatch");
  }
  if (!sameSelfRetrievalSource(baseline, candidate)) {
    throw new Error("targeted_pair_self_retrieval_source_mismatch");
  }
  if (!selfRetrievalExclusionComplete(baseline, { required: requireSelfRetrievalExclusion })
    || !selfRetrievalExclusionComplete(candidate, { required: requireSelfRetrievalExclusion })) {
    throw new Error("targeted_pair_self_retrieval_exclusion_incomplete");
  }
  if (providerWork(baseline) === null || providerWork(candidate) === null) {
    throw new Error("targeted_pair_provider_work_missing");
  }
  if (baseline.evaluation_decision_trace_packet?.benchmark_profile !== recognitionBenchmarkProfileIds.COLD_ALGORITHM) {
    throw new Error("targeted_pair_baseline_trace_profile_mismatch");
  }
  if (candidate.evaluation_decision_trace_packet?.benchmark_profile !== recognitionBenchmarkProfileIds.COLD_TARGETED_ASSIST) {
    throw new Error("targeted_pair_candidate_trace_profile_mismatch");
  }
  return true;
}

function reasonCounts(rows = []) {
  return rows.reduce((counts, row) => {
    const reason = cleanText(row.targeted_assist_execution?.fallback_reason_code) || "NONE";
    counts[reason] = Number(counts[reason] || 0) + 1;
    return counts;
  }, {});
}

function criticalFailure(row = {}) {
  const guard = criticalGuard(row);
  return guard?.catastrophic === true || guard?.critical_fabrication === true;
}

function criticalRegression(baseline = {}, candidate = {}) {
  return criticalFailure(candidate) && !criticalFailure(baseline);
}

export function analyzeTargetedAssistPairs(pairs = [], { cohort = "UNSPECIFIED" } = {}) {
  const normalizedCohort = cleanText(cohort).toUpperCase() || "UNSPECIFIED";
  const normalized = (Array.isArray(pairs) ? pairs : []).map((pair, index) => {
    const baseline = pair?.baseline || {};
    const candidate = pair?.candidate || {};
    assertTargetedAssistPair(baseline, candidate, {
      requireSelfRetrievalExclusion: normalizedCohort === "FAMILIAR"
    });
    return {
      index,
      pair_key: pairKey(baseline),
      baseline,
      candidate,
      baseline_score: score(baseline),
      candidate_score: score(candidate),
      baseline_work_ms: providerWork(baseline),
      candidate_work_ms: providerWork(candidate)
    };
  });
  const pairKeys = normalized.map((row) => row.pair_key);
  if (normalized.length !== 10) throw new Error(`targeted_pair_count_expected_10_received_${normalized.length}`);
  if (new Set(pairKeys).size !== pairKeys.length) throw new Error("targeted_pair_keys_not_unique");
  const candidates = normalized.map((row) => row.candidate);
  const targetedPlanned = candidates.filter((row) => stageRows(row, "TARGETED_VISUAL_OBSERVATION").length === 1);
  const targetedAttempted = candidates.filter((row) => (
    stageRows(row, "TARGETED_VISUAL_OBSERVATION").length === 1
    && Number(stageRows(row, "TARGETED_VISUAL_OBSERVATION")[0]?.provider_calls) === 1
  ));
  const targetedSuccess = candidates.filter((row) => (
    row.targeted_assist_execution?.final_observation_owner === "TARGETED_VISUAL_OBSERVATION"
  ));
  const fallbacks = candidates.filter((row) => stageRows(row, "FULL_PROVIDER_OBSERVATION").length === 1
    && stageRows(row, "TARGETED_VISUAL_OBSERVATION").length === 1);
  const directFull = candidates.filter((row) => stageRows(row, "FULL_PROVIDER_OBSERVATION").length === 1
    && stageRows(row, "TARGETED_VISUAL_OBSERVATION").length === 0);
  const baselineWork = normalized.map((row) => row.baseline_work_ms);
  const candidateWork = normalized.map((row) => row.candidate_work_ms);
  const allPairsNetSavingsMs = baselineWork.reduce((sum, value) => sum + Number(value || 0), 0)
    - candidateWork.reduce((sum, value) => sum + Number(value || 0), 0);
  // Direct-full rows are a deployment-drift control, not evidence that the
  // targeted route saved work. Compute route ROI only over matched pairs where
  // the planner actually selected TARGETED_VISUAL_OBSERVATION.
  const targetedEligiblePairs = normalized.filter((row) => (
    stageRows(row.candidate, "TARGETED_VISUAL_OBSERVATION").length === 1
  ));
  const eligibleBaselineWork = targetedEligiblePairs.map((row) => row.baseline_work_ms);
  const eligibleCandidateWork = targetedEligiblePairs.map((row) => row.candidate_work_ms);
  const eligibleNetSavingsMs = eligibleBaselineWork.reduce((sum, value) => sum + value, 0)
    - eligibleCandidateWork.reduce((sum, value) => sum + value, 0);
  const targetedLatencies = targetedAttempted
    .map((row) => stageValue(row, "TARGETED_VISUAL_OBSERVATION"));
  const meanTargetedLatencyMs = mean(targetedLatencies);
  const meanEligibleBaselineFullMs = mean(eligibleBaselineWork);
  const breakEvenSafeSuccessRate = meanTargetedLatencyMs === null
    || meanEligibleBaselineFullMs === null
    || meanEligibleBaselineFullMs <= 0
    ? null
    : meanTargetedLatencyMs / meanEligibleBaselineFullMs;
  const observedSafeSuccessRate = targetedAttempted.length
    ? targetedSuccess.length / targetedAttempted.length
    : null;
  const targetedOutputTokens = targetedAttempted
    .map((row) => stageValue(row, "TARGETED_VISUAL_OBSERVATION", "output_tokens"));
  const targetedOutputTokenCoverageCount = targetedOutputTokens.filter((value) => value !== null && value >= 0).length;
  const targetedOutputTokenLedgerComplete = targetedOutputTokenCoverageCount === targetedAttempted.length
    && targetedAttempted.length > 0;
  const observedTargetedOutputTokens = targetedOutputTokens.filter((value) => value !== null && value >= 0);
  const baselineScore = mean(normalized.map((row) => row.baseline_score));
  const candidateScore = mean(normalized.map((row) => row.candidate_score));
  const report = {
    schema_version: "targeted-assist-paired20-report-v1",
    cohort: normalizedCohort,
    pair_count: normalized.length,
    pair_keys: normalized.map((row) => row.pair_key),
    accuracy: {
      baseline_token_recall: baselineScore,
      candidate_token_recall: candidateScore,
      delta: baselineScore === null || candidateScore === null ? null : candidateScore - baselineScore,
      candidate_critical_failure_count: candidates.filter(criticalFailure).length,
      critical_regression_count: normalized.filter((row) => criticalRegression(row.baseline, row.candidate)).length
    },
    routing: {
      targeted_planned_count: targetedPlanned.length,
      targeted_attempted_count: targetedAttempted.length,
      targeted_safe_success_count: targetedSuccess.length,
      targeted_safe_success_rate_given_attempt: observedSafeSuccessRate,
      break_even_safe_success_rate: breakEvenSafeSuccessRate,
      safe_success_rate_above_break_even: observedSafeSuccessRate !== null
        && breakEvenSafeSuccessRate !== null
        && observedSafeSuccessRate > breakEvenSafeSuccessRate,
      fallback_count: fallbacks.length,
      fallback_rate_given_attempt: targetedAttempted.length ? fallbacks.length / targetedAttempted.length : null,
      direct_full_provider_count: directFull.length,
      full_provider_avoided_count: targetedSuccess.length,
      fallback_reason_counts: reasonCounts(fallbacks)
    },
    provider_work: {
      baseline_p50_ms: percentile(baselineWork, 0.5),
      baseline_p95_ms: percentile(baselineWork, 0.95),
      candidate_p50_ms: percentile(candidateWork, 0.5),
      candidate_p95_ms: percentile(candidateWork, 0.95),
      targeted_p50_ms: percentile(targetedAttempted.map((row) => stageValue(row, "TARGETED_VISUAL_OBSERVATION")), 0.5),
      targeted_p95_ms: percentile(targetedAttempted.map((row) => stageValue(row, "TARGETED_VISUAL_OBSERVATION")), 0.95),
      fallback_full_p50_ms: percentile(fallbacks.map((row) => stageValue(row, "FULL_PROVIDER_OBSERVATION")), 0.5),
      fallback_full_p95_ms: percentile(fallbacks.map((row) => stageValue(row, "FULL_PROVIDER_OBSERVATION")), 0.95),
      baseline_total_ms: baselineWork.reduce((sum, value) => sum + Number(value || 0), 0),
      candidate_total_ms: candidateWork.reduce((sum, value) => sum + Number(value || 0), 0),
      all_pairs_net_savings_ms: allPairsNetSavingsMs,
      targeted_eligible_pair_count: targetedEligiblePairs.length,
      targeted_eligible_baseline_total_ms: eligibleBaselineWork.reduce((sum, value) => sum + value, 0),
      targeted_eligible_candidate_total_ms: eligibleCandidateWork.reduce((sum, value) => sum + value, 0),
      net_savings_ms: eligibleNetSavingsMs
    },
    targeted_output_tokens: {
      expected_ledger_count: targetedAttempted.length,
      observed_ledger_count: targetedOutputTokenCoverageCount,
      ledger_coverage_complete: targetedOutputTokenLedgerComplete,
      p50: percentile(observedTargetedOutputTokens, 0.5),
      p95: percentile(observedTargetedOutputTokens, 0.95),
      max: observedTargetedOutputTokens.length ? Math.max(...observedTargetedOutputTokens) : null,
      within_150_token_budget: targetedOutputTokenLedgerComplete
        && Math.max(...observedTargetedOutputTokens) <= 150
    },
    gate: {
      decision: "NOT_PROVEN",
      reasons: []
    },
    pairs: normalized.map((row) => ({
      pair_key: row.pair_key,
      baseline_score: row.baseline_score,
      candidate_score: row.candidate_score,
      score_delta: row.candidate_score - row.baseline_score,
      baseline_provider_work_ms: row.baseline_work_ms,
      candidate_provider_work_ms: row.candidate_work_ms,
      final_observation_owner: row.candidate.targeted_assist_execution?.final_observation_owner || null,
      fallback_reason_code: row.candidate.targeted_assist_execution?.fallback_reason_code || null
    }))
  };
  const reasons = [];
  if (targetedSuccess.length < 1) reasons.push("TARGETED_SAFE_SUCCESS_ZERO");
  if (targetedAttempted.length < 5) reasons.push("TARGETED_DENOMINATOR_BELOW_5");
  if (report.accuracy.critical_regression_count > 0) reasons.push("CRITICAL_REGRESSION");
  if (report.accuracy.candidate_critical_failure_count > 0) reasons.push("CANDIDATE_CRITICAL_FAILURE");
  if (report.accuracy.delta === null || report.accuracy.delta < 0) reasons.push("TOKEN_RECALL_REGRESSION");
  if (eligibleNetSavingsMs <= 0) reasons.push("NO_TARGETED_ELIGIBLE_PROVIDER_WORK_SAVING");
  if (!report.routing.safe_success_rate_above_break_even) reasons.push("TARGETED_SAFE_SUCCESS_BELOW_BREAK_EVEN");
  if (!targetedOutputTokenLedgerComplete) reasons.push("TARGETED_OUTPUT_TOKEN_LEDGER_INCOMPLETE");
  if (!report.targeted_output_tokens.within_150_token_budget) reasons.push("TARGETED_OUTPUT_TOKEN_BUDGET_FAILED");
  report.gate.reasons = reasons;
  report.gate.decision = reasons.length ? "NO_GO" : "PASS_COHORT_ONLY";
  return report;
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? fallback : fallback;
}

export async function main(argv = process.argv.slice(2)) {
  const input = argValue(argv, "--input");
  const out = argValue(argv, "--out");
  const cohort = argValue(argv, "--cohort", "UNSPECIFIED");
  if (!input) throw new Error("--input is required");
  const payload = JSON.parse(await readFile(input, "utf8"));
  const report = analyzeTargetedAssistPairs(payload.pairs || payload, { cohort });
  if (out) await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export const __targetedAssistPaired20TestHooks = Object.freeze({
  ledger,
  pairKey,
  percentile,
  providerWork,
  sameStableVersions,
  score,
  deploymentGitSha,
  sameDeploymentGitSha,
  criticalGuard,
  criticalGuardComplete,
  providerAuxInputComplete,
  providerAuxRoute,
  sameProviderAuxInput,
  sameSelfRetrievalSource,
  selfRetrievalExclusionComplete,
  evaluationTraceContractComplete,
  stableVersionVectorComplete,
  stageRows,
  stageValue,
  terminalResultReady,
  versionVector
});
