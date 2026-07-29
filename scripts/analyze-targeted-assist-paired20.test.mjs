import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  analyzeTargetedAssistPairs,
  assertTargetedAssistPair
} from "./analyze-targeted-assist-paired20.mjs";
import { recognitionBenchmarkProfileIds } from "../lib/listing/evaluation/recognition-benchmark-profile.mjs";
import {
  evaluationDecisionTraceSchemaVersion,
  evaluationReplaySnapshotSchemaVersion
} from "../lib/listing/evaluation/evaluation-decision-trace-packet.mjs";
import { providerAuxRouteReplayInputHash } from "../lib/listing/v4/route-planner/provider-aux-route-shadow.mjs";

const at = (offset) => new Date(Date.parse("2026-07-29T00:00:00.000Z") + offset).toISOString();
const deploymentGitSha = "d".repeat(40);
const versions = {
  recognition_pipeline_fingerprint: "pipeline-v1",
  targeted_assist_nuisance_fingerprint: "f".repeat(64),
  targeted_assist_nuisance_contract: "targeted-assist-nuisance-fingerprint-v1",
  evidence_schema: "evidence-v1",
  normalization: "normalizer-v1",
  candidate_policy: "candidate-v1",
  constraint_snapshot: "catalog-v1",
  constraint_snapshot_sha256: "a".repeat(64),
  constraint_enumerator: "enumerator-v1",
  resolver: "resolver-v1",
  renderer: "renderer-v1"
};
const replayInput = {
  evidence_document: { evidence: { year: { value: "2023" } } },
  forward_enumeration_trace: [],
  usable_image_count: 2,
  exact_anchor_shadow: null,
  higher_authority_route: null,
  evidence_availability_manifest: [{ field: "year", available_at: "2026-07-29T00:00:00.000Z" }]
};
const preproviderSnapshotHash = providerAuxRouteReplayInputHash(replayInput);
const providerAuxRoute = {
  schema_version: "provider-aux-route-shadow-v1",
  preprovider_snapshot_hash: preproviderSnapshotHash,
  route_input_hash: "c".repeat(64),
  trace_completeness: "COMPLETE",
  source_availability: "COMPLETE",
  decision_evidence_cutoff_at: at(0),
  route_decided_at: at(0),
  first_provider_call_started_at: at(0),
  decision_frozen_before_provider: true,
  provider_derived_field_count: 0,
  post_cutoff_evidence_count: 0,
  evidence_availability_manifest: replayInput.evidence_availability_manifest,
  replay_input: replayInput
};

function durableAssetId(index) {
  return `asset_00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

function sha256(index, prefix) {
  return `${prefix.repeat(62)}${Number(index + 1).toString(16).padStart(2, "0")}`;
}

function immutableImageEvidence(index) {
  const assetId = durableAssetId(index);
  const sourceFingerprint = sha256(index, "1");
  return {
    asset_id: assetId,
    source_fingerprint: sourceFingerprint,
    image_generation_id: assetId,
    canonical_image_set_sha256: sha256(index, "2"),
    canonical_primary_content_sha256: [sha256(index, "3"), sha256(index, "4")],
    preparation_diagnostics: { source_fingerprint: sourceFingerprint }
  };
}

const sourceId = (index) => `feedback-${index}`;
const sourceHash = (index) => crypto.createHash("sha256").update(sourceId(index)).digest("hex");

function selfRetrievalTrace(index) {
  return {
    retrieval: {
      top_k: [],
      candidate_count: 0
    },
    self_retrieval_exclusion: {
      required: true,
      source_feedback_id_sha256: sourceHash(index),
      top_k_checked_count: 0,
      all_candidate_count: 0,
      all_candidates_checked_count: 0,
      candidate_check_truncated: false,
      candidate_source_id_observable_count: 0,
      unobservable_reviewed_candidate_count: 0,
      same_source_candidate_count: 0,
      same_source_candidate_ids: []
    }
  };
}

function finalScoring(score = 0.9, {
  catastrophic = false,
  criticalFabrication = false
} = {}) {
  return {
    policy_fair_token_recall: score,
    critical_title_guard: {
      schema_version: "title-critical-guard-v1",
      evaluation_scope: "OFFLINE_POST_PREDICTION_ONLY",
      runtime_chain_effect: "NONE",
      reviewed_title_ground_truth: true,
      complete: true,
      critical_coverage_complete: true,
      required_coverage: {
        subject: true,
        product_or_manufacturer: true,
        year_or_card_number: true
      },
      evaluated_fields: ["product", "subject"],
      mismatch_count: catastrophic || criticalFabrication ? 1 : 0,
      mismatches: catastrophic || criticalFabrication
        ? [{ field: "product", reason: "CONFLICTING_IDENTITY_FIELD" }]
        : [],
      catastrophic,
      critical_fabrication: criticalFabrication
    }
  };
}

function baseline(index, score = 0.9, providerLatencyMs = 4_500) {
  return {
    ...immutableImageEvidence(index),
    sealed_label_key: `label-${index}`,
    source_feedback_id: sourceId(index),
    recognition_benchmark_profile: recognitionBenchmarkProfileIds.COLD_ALGORITHM,
    attempt_count: 1,
    retry_attempt_history: [],
    retry_error_codes: [],
    identity_cache: { cache_hit: false, provider_call_skipped: false },
    identity_cache_hit: false,
    provider_call_skipped: false,
    usage: { provider_calls: 1 },
    provider_calls: 1,
    provider_latency_ms: providerLatencyMs,
    vector_self_exclusion_query_attempted: true,
    vector_self_exclusion_filter_active: true,
    vector_self_exclusion_requested_source_count: 1,
    vector_self_exclusion_source_ids_sha256: sourceHash(index),
    ok: true,
    writer_ready: true,
    l2_ready: true,
    final_title: `Baseline title ${index}`,
    reference_title_is_reviewed_ground_truth: true,
    final_scoring: finalScoring(score),
    evaluation_decision_trace_packet: {
      schema_version: evaluationDecisionTraceSchemaVersion,
      trace_level: "evaluation",
      ...selfRetrievalTrace(index),
      deployment_git_sha: deploymentGitSha,
      benchmark_profile: recognitionBenchmarkProfileIds.COLD_ALGORITHM,
      provider_aux_route: structuredClone(providerAuxRoute),
      replay_snapshot: {
        schema_version: evaluationReplaySnapshotSchemaVersion,
        status: "COMPLETE",
        missing_components: [],
        versions: { ...versions, recognition_pipeline_fingerprint: "a".repeat(64) }
      }
    }
  };
}

function candidate(index, { score = 0.9, fallback = false } = {}) {
  const ledger = [{
    logical_stage: "TARGETED_VISUAL_OBSERVATION",
    attempt: 1,
    started_at: at(0),
    completed_at: at(1_800),
    latency_ms: 1_800,
    provider_calls: 1,
    output_tokens: 72,
    status: "COMPLETED",
    prompt_revision: "targeted-visual-read-only-v2",
    schema_revision: "targeted-visual-sparse-v2"
  }];
  if (fallback) ledger.push({
    logical_stage: "FULL_PROVIDER_OBSERVATION",
    attempt: 1,
    started_at: at(1_800),
    completed_at: at(6_300),
    latency_ms: 4_500,
    provider_calls: 1,
    output_tokens: 120,
    status: "COMPLETED"
  });
  return {
    ...immutableImageEvidence(index),
    sealed_label_key: `label-${index}`,
    source_feedback_id: sourceId(index),
    recognition_benchmark_profile: recognitionBenchmarkProfileIds.COLD_TARGETED_ASSIST,
    attempt_count: 1,
    retry_attempt_history: [],
    retry_error_codes: [],
    identity_cache: { cache_hit: false, provider_call_skipped: false },
    identity_cache_hit: false,
    provider_call_skipped: false,
    usage: { provider_calls: fallback ? 2 : 1 },
    provider_calls: fallback ? 2 : 1,
    vector_self_exclusion_query_attempted: true,
    vector_self_exclusion_filter_active: true,
    vector_self_exclusion_requested_source_count: 1,
    vector_self_exclusion_source_ids_sha256: sourceHash(index),
    provider_call_ledger: ledger,
    targeted_assist_execution: {
      final_observation_owner: fallback ? "FULL_PROVIDER_OBSERVATION" : "TARGETED_VISUAL_OBSERVATION",
      fallback_reason_code: fallback ? "TARGETED_REQUESTED_FIELD_MISSING" : null,
      provider_call_ledger: ledger
    },
    ok: true,
    writer_ready: true,
    l2_ready: true,
    final_title: `Candidate title ${index}`,
    reference_title_is_reviewed_ground_truth: true,
    final_scoring: finalScoring(score),
    evaluation_decision_trace_packet: {
      schema_version: evaluationDecisionTraceSchemaVersion,
      trace_level: "evaluation",
      ...selfRetrievalTrace(index),
      deployment_git_sha: deploymentGitSha,
      benchmark_profile: recognitionBenchmarkProfileIds.COLD_TARGETED_ASSIST,
      provider_aux_route: structuredClone(providerAuxRoute),
      replay_snapshot: {
        schema_version: evaluationReplaySnapshotSchemaVersion,
        status: "COMPLETE",
        missing_components: [],
        versions: { ...versions, recognition_pipeline_fingerprint: "b".repeat(64) }
      }
    }
  };
}

function directFullCandidate(index, { score = 0.9, latencyMs = 4_500 } = {}) {
  const fullLedger = [{
    logical_stage: "FULL_PROVIDER_OBSERVATION",
    attempt: 1,
    started_at: at(0),
    completed_at: at(latencyMs),
    latency_ms: latencyMs,
    provider_calls: 1,
    output_tokens: 120,
    status: "COMPLETED"
  }];
  const row = candidate(index, { score });
  row.usage.provider_calls = 1;
  row.provider_calls = 1;
  row.provider_call_ledger = fullLedger;
  row.targeted_assist_execution = {
    final_observation_owner: "FULL_PROVIDER_OBSERVATION",
    fallback_reason_code: null,
    provider_call_ledger: fullLedger
  };
  return row;
}

assert.equal(assertTargetedAssistPair(baseline(1), candidate(1)), true);
const lazyVectorBaseline = baseline(1);
lazyVectorBaseline.vector_self_exclusion_query_attempted = false;
lazyVectorBaseline.vector_runtime_status = "UNAVAILABLE";
lazyVectorBaseline.vector_runtime_unavailable_reasons = ["vector_lazy_provider_catalog_anchor"];
lazyVectorBaseline.l2_vector_raw_candidate_count = 0;
const lazyVectorCandidate = candidate(1);
lazyVectorCandidate.vector_self_exclusion_query_attempted = false;
lazyVectorCandidate.vector_runtime_status = "UNAVAILABLE";
lazyVectorCandidate.vector_runtime_unavailable_reasons = "vector_lazy_provider_catalog_anchor";
lazyVectorCandidate.l2_vector_raw_candidate_count = 0;
assert.equal(
  assertTargetedAssistPair(lazyVectorBaseline, lazyVectorCandidate),
  true,
  "a reason-coded lazy vector skip with zero vector candidates is a complete self-exclusion proof"
);
const staleTraceSchema = candidate(1);
staleTraceSchema.evaluation_decision_trace_packet.schema_version = "evaluation-decision-trace-packet-v8";
assert.throws(() => assertTargetedAssistPair(baseline(1), staleTraceSchema), /evaluation_trace_contract_incomplete/);
const partialReplay = candidate(1);
partialReplay.evaluation_decision_trace_packet.replay_snapshot.status = "PARTIAL";
partialReplay.evaluation_decision_trace_packet.replay_snapshot.missing_components = ["provider_field_evidence"];
assert.throws(() => assertTargetedAssistPair(baseline(1), partialReplay), /evaluation_trace_contract_incomplete/);
const staleReplaySchema = candidate(1);
staleReplaySchema.evaluation_decision_trace_packet.replay_snapshot.schema_version = "evaluation-replay-snapshot-v3";
assert.throws(() => assertTargetedAssistPair(baseline(1), staleReplaySchema), /evaluation_trace_contract_incomplete/);
const missingDeploymentSha = candidate(1);
missingDeploymentSha.evaluation_decision_trace_packet.deployment_git_sha = null;
assert.throws(() => assertTargetedAssistPair(baseline(1), missingDeploymentSha), /deployment_git_sha_incomplete_or_mismatch/);
const mismatchedDeploymentSha = candidate(1);
mismatchedDeploymentSha.evaluation_decision_trace_packet.deployment_git_sha = "e".repeat(40);
assert.throws(() => assertTargetedAssistPair(baseline(1), mismatchedDeploymentSha), /deployment_git_sha_incomplete_or_mismatch/);
assert.throws(() => assertTargetedAssistPair(baseline(1), candidate(2)), /identity_mismatch/);
const differentAsset = candidate(1);
differentAsset.asset_id = durableAssetId(99);
differentAsset.image_generation_id = durableAssetId(99);
assert.throws(() => assertTargetedAssistPair(baseline(1), differentAsset), /immutable_image_input_mismatch/);
const emptyImageEvidence = candidate(1);
emptyImageEvidence.source_fingerprint = "";
emptyImageEvidence.preparation_diagnostics.source_fingerprint = "";
assert.throws(() => assertTargetedAssistPair(baseline(1), emptyImageEvidence), /immutable_image_input_incomplete/);
const sourceFingerprintMismatch = candidate(1);
sourceFingerprintMismatch.source_fingerprint = sha256(99, "5");
sourceFingerprintMismatch.preparation_diagnostics.source_fingerprint = sourceFingerprintMismatch.source_fingerprint;
assert.throws(() => assertTargetedAssistPair(baseline(1), sourceFingerprintMismatch), /immutable_image_input_mismatch/);
const imageSetMismatch = candidate(1);
imageSetMismatch.canonical_image_set_sha256 = sha256(99, "6");
assert.throws(() => assertTargetedAssistPair(baseline(1), imageSetMismatch), /immutable_image_input_mismatch/);
const contentHashMismatch = candidate(1);
contentHashMismatch.canonical_primary_content_sha256 = [sha256(99, "7"), sha256(99, "8")];
assert.throws(() => assertTargetedAssistPair(baseline(1), contentHashMismatch), /immutable_image_input_mismatch/);
const invalidGeneration = candidate(1);
invalidGeneration.image_generation_id = "generation-not-durable";
assert.throws(() => assertTargetedAssistPair(baseline(1), invalidGeneration), /immutable_image_input_incomplete/);
const versionMismatch = candidate(1);
versionMismatch.evaluation_decision_trace_packet.replay_snapshot.versions = {
  ...versionMismatch.evaluation_decision_trace_packet.replay_snapshot.versions,
  renderer: "renderer-v2"
};
assert.throws(() => assertTargetedAssistPair(baseline(1), versionMismatch), /stable_version_mismatch/);
const incompleteVersion = candidate(1);
incompleteVersion.evaluation_decision_trace_packet.replay_snapshot.versions = {
  ...incompleteVersion.evaluation_decision_trace_packet.replay_snapshot.versions,
  constraint_snapshot_sha256: null
};
assert.throws(() => assertTargetedAssistPair(baseline(1), incompleteVersion), /version_vector_incomplete/);
const nuisanceMismatch = candidate(1);
nuisanceMismatch.evaluation_decision_trace_packet.replay_snapshot.versions = {
  ...nuisanceMismatch.evaluation_decision_trace_packet.replay_snapshot.versions,
  targeted_assist_nuisance_fingerprint: "e".repeat(64)
};
assert.throws(() => assertTargetedAssistPair(baseline(1), nuisanceMismatch), /stable_version_mismatch/);
const nuisanceMissing = candidate(1);
nuisanceMissing.evaluation_decision_trace_packet.replay_snapshot.versions = {
  ...nuisanceMissing.evaluation_decision_trace_packet.replay_snapshot.versions,
  targeted_assist_nuisance_fingerprint: null
};
assert.throws(() => assertTargetedAssistPair(baseline(1), nuisanceMissing), /version_vector_incomplete/);

const failedTerminal = candidate(1);
failedTerminal.ok = false;
failedTerminal.writer_ready = false;
failedTerminal.l2_ready = false;
failedTerminal.final_title = "";
assert.throws(() => assertTargetedAssistPair(baseline(1), failedTerminal), /terminal_writer_ready_result_required/);

const missingBaselineProfile = baseline(1);
delete missingBaselineProfile.recognition_benchmark_profile;
assert.throws(() => assertTargetedAssistPair(missingBaselineProfile, candidate(1)), /baseline_result_profile_mismatch/);

const missingBaselineTraceProfile = baseline(1);
delete missingBaselineTraceProfile.evaluation_decision_trace_packet.benchmark_profile;
assert.throws(() => assertTargetedAssistPair(missingBaselineTraceProfile, candidate(1)), /baseline_trace_profile_mismatch/);

const missingCriticalGuard = candidate(1);
delete missingCriticalGuard.final_scoring.critical_title_guard;
assert.throws(() => assertTargetedAssistPair(baseline(1), missingCriticalGuard), /critical_guard_incomplete/);

const hiddenBaselineRetry = baseline(1);
hiddenBaselineRetry.gpt5_empty_result_retry_attempted = true;
assert.throws(() => assertTargetedAssistPair(hiddenBaselineRetry, candidate(1)), /implicit_provider_retry_forbidden/);
const hiddenCandidateRetry = candidate(1);
hiddenCandidateRetry.gpt5_empty_result_retry_attempted = true;
assert.throws(() => assertTargetedAssistPair(baseline(1), hiddenCandidateRetry), /implicit_provider_retry_forbidden/);

const missingPreproviderInput = candidate(1);
delete missingPreproviderInput.evaluation_decision_trace_packet.provider_aux_route;
assert.throws(() => assertTargetedAssistPair(baseline(1), missingPreproviderInput), /preprovider_input_incomplete/);
const mismatchedPreproviderInput = candidate(1);
mismatchedPreproviderInput.evaluation_decision_trace_packet.provider_aux_route.route_input_hash = "d".repeat(64);
assert.throws(() => assertTargetedAssistPair(baseline(1), mismatchedPreproviderInput), /preprovider_input_mismatch/);
const latePreproviderDecision = candidate(1);
latePreproviderDecision.evaluation_decision_trace_packet.provider_aux_route.route_decided_at = at(1);
assert.throws(() => assertTargetedAssistPair(baseline(1), latePreproviderDecision), /preprovider_input_incomplete/);
const unstampedPreproviderDecision = candidate(1);
unstampedPreproviderDecision.evaluation_decision_trace_packet.provider_aux_route.decision_frozen_before_provider = null;
assert.throws(() => assertTargetedAssistPair(baseline(1), unstampedPreproviderDecision), /preprovider_input_incomplete/);

const mismatchedSelfRetrievalSource = candidate(1);
mismatchedSelfRetrievalSource.source_feedback_id = "different-feedback-id";
assert.throws(() => assertTargetedAssistPair(baseline(1), mismatchedSelfRetrievalSource), /self_retrieval_source_mismatch/);

const missingSelfRetrievalProof = candidate(1);
missingSelfRetrievalProof.vector_self_exclusion_filter_active = false;
assert.throws(() => assertTargetedAssistPair(baseline(1), missingSelfRetrievalProof), /self_retrieval_exclusion_incomplete/);

const missingSelfRetrievalSourceBaseline = baseline(1);
const missingSelfRetrievalSourceCandidate = candidate(1);
delete missingSelfRetrievalSourceBaseline.source_feedback_id;
delete missingSelfRetrievalSourceCandidate.source_feedback_id;
assert.throws(() => assertTargetedAssistPair(
  missingSelfRetrievalSourceBaseline,
  missingSelfRetrievalSourceCandidate,
  { requireSelfRetrievalExclusion: true }
), /self_retrieval_exclusion_incomplete/);
assert.equal(assertTargetedAssistPair(
  missingSelfRetrievalSourceBaseline,
  missingSelfRetrievalSourceCandidate,
  { requireSelfRetrievalExclusion: false }
), true, "independent unseen rows may legitimately have no reviewed-source id");

const sameSourceCandidateLeaked = candidate(1);
sameSourceCandidateLeaked.evaluation_decision_trace_packet.retrieval = {
  top_k: [{
    candidate_id: "same-source-row",
    source: "INTERNAL_CORRECTED_TITLE",
    source_feedback_id_sha256: sourceHash(1)
  }],
  candidate_count: 1
};
sameSourceCandidateLeaked.evaluation_decision_trace_packet.self_retrieval_exclusion = {
  ...sameSourceCandidateLeaked.evaluation_decision_trace_packet.self_retrieval_exclusion,
  top_k_checked_count: 1,
  all_candidate_count: 1,
  all_candidates_checked_count: 1,
  candidate_source_id_observable_count: 1,
  same_source_candidate_count: 1,
  same_source_candidate_ids: ["same-source-row"]
};
assert.throws(() => assertTargetedAssistPair(baseline(1), sameSourceCandidateLeaked), /self_retrieval_exclusion_incomplete/);

const reviewedCandidateWithoutSourceProof = candidate(1);
reviewedCandidateWithoutSourceProof.evaluation_decision_trace_packet.retrieval = {
  top_k: [{ candidate_id: "opaque-reviewed-row", source: "INTERNAL_CORRECTED_TITLE" }],
  candidate_count: 1
};
reviewedCandidateWithoutSourceProof.evaluation_decision_trace_packet.self_retrieval_exclusion = {
  ...reviewedCandidateWithoutSourceProof.evaluation_decision_trace_packet.self_retrieval_exclusion,
  top_k_checked_count: 1,
  all_candidate_count: 1,
  all_candidates_checked_count: 1,
  unobservable_reviewed_candidate_count: 1
};
assert.throws(() => assertTargetedAssistPair(baseline(1), reviewedCandidateWithoutSourceProof), /self_retrieval_exclusion_incomplete/);

const truncatedCandidateExclusionAudit = candidate(1);
truncatedCandidateExclusionAudit.evaluation_decision_trace_packet.self_retrieval_exclusion = {
  ...truncatedCandidateExclusionAudit.evaluation_decision_trace_packet.self_retrieval_exclusion,
  all_candidate_count: 201,
  all_candidates_checked_count: 200,
  candidate_check_truncated: true
};
assert.throws(() => assertTargetedAssistPair(baseline(1), truncatedCandidateExclusionAudit), /self_retrieval_exclusion_incomplete/);

const pairs = Array.from({ length: 10 }, (_, index) => ({
  baseline: baseline(index),
  candidate: candidate(index)
}));
const report = analyzeTargetedAssistPairs(pairs, { cohort: "unseen" });
assert.equal(report.cohort, "UNSEEN");
assert.equal(report.pair_count, 10);
assert.equal(report.routing.targeted_attempted_count, 10);
assert.equal(report.routing.targeted_safe_success_count, 10);
assert.equal(report.routing.full_provider_avoided_count, 10);
assert.equal(report.provider_work.baseline_total_ms, 45_000);
assert.equal(report.provider_work.candidate_total_ms, 18_000);
assert.equal(report.provider_work.net_savings_ms, 27_000);
assert.equal(report.provider_work.all_pairs_net_savings_ms, 27_000);
assert.equal(report.routing.safe_success_rate_above_break_even, true);
assert.equal(report.targeted_output_tokens.max, 72);
assert.equal(report.targeted_output_tokens.ledger_coverage_complete, true);
assert.equal(report.accuracy.critical_regression_count, 0);
assert.equal(report.accuracy.candidate_critical_failure_count, 0);
assert.equal(report.gate.decision, "PASS_COHORT_ONLY");

const oneFallback = [...pairs];
oneFallback[0] = { baseline: baseline(0), candidate: candidate(0, { fallback: true }) };
const fallbackReport = analyzeTargetedAssistPairs(oneFallback, { cohort: "familiar" });
assert.equal(fallbackReport.routing.fallback_count, 1);
assert.equal(fallbackReport.routing.fallback_reason_counts.TARGETED_REQUESTED_FIELD_MISSING, 1);
assert.equal(fallbackReport.provider_work.net_savings_ms, 22_500);

const oneUnpaidTarget = pairs.map((pair) => structuredClone(pair));
oneUnpaidTarget[0] = { baseline: baseline(0), candidate: candidate(0, { fallback: true }) };
oneUnpaidTarget[0].candidate.provider_call_ledger[0].provider_calls = 0;
oneUnpaidTarget[0].candidate.provider_call_ledger[0].status = "FAILED";
oneUnpaidTarget[0].candidate.targeted_assist_execution.provider_call_ledger = oneUnpaidTarget[0].candidate.provider_call_ledger;
oneUnpaidTarget[0].candidate.usage.provider_calls = 1;
oneUnpaidTarget[0].candidate.provider_calls = 1;
const unpaidTargetReport = analyzeTargetedAssistPairs(oneUnpaidTarget, { cohort: "unseen" });
assert.equal(unpaidTargetReport.routing.targeted_planned_count, 10);
assert.equal(unpaidTargetReport.routing.targeted_attempted_count, 9);

const regressed = pairs.map((pair, index) => ({
  baseline: pair.baseline,
  candidate: candidate(index, { score: 0.8 })
}));
const noGo = analyzeTargetedAssistPairs(regressed, { cohort: "unseen" });
assert.equal(noGo.gate.decision, "NO_GO");
assert.ok(noGo.gate.reasons.includes("TOKEN_RECALL_REGRESSION"));

const critical = pairs.map((pair) => structuredClone(pair));
critical[0].candidate.final_scoring = finalScoring(0.9, {
  catastrophic: true,
  criticalFabrication: true
});
const criticalNoGo = analyzeTargetedAssistPairs(critical, { cohort: "unseen" });
assert.equal(criticalNoGo.accuracy.critical_regression_count, 1);
assert.equal(criticalNoGo.accuracy.candidate_critical_failure_count, 1);
assert.ok(criticalNoGo.gate.reasons.includes("CRITICAL_REGRESSION"));
assert.ok(criticalNoGo.gate.reasons.includes("CANDIDATE_CRITICAL_FAILURE"));

const duplicateKeys = pairs.map((pair) => structuredClone(pair));
duplicateKeys[1].baseline.sealed_label_key = duplicateKeys[0].baseline.sealed_label_key;
duplicateKeys[1].candidate.sealed_label_key = duplicateKeys[0].candidate.sealed_label_key;
assert.throws(() => analyzeTargetedAssistPairs(duplicateKeys), /pair_keys_not_unique/);

const missingLatency = pairs.map((pair) => structuredClone(pair));
missingLatency[0].candidate.provider_call_ledger[0].latency_ms = null;
missingLatency[0].candidate.targeted_assist_execution.provider_call_ledger = missingLatency[0].candidate.provider_call_ledger;
assert.throws(() => analyzeTargetedAssistPairs(missingLatency), /call_ledger_incomplete/);

const wholeJobRetry = pairs.map((pair) => structuredClone(pair));
wholeJobRetry[0].candidate.attempt_count = 2;
wholeJobRetry[0].candidate.retry_attempt_history = [{ code: "QUEUE_LEASE_LOST" }];
wholeJobRetry[0].candidate.retry_error_codes = ["QUEUE_LEASE_LOST"];
assert.throws(() => analyzeTargetedAssistPairs(wholeJobRetry), /job_attempt_count_expected_1/);

const allFallback = Array.from({ length: 10 }, (_, index) => ({
  baseline: baseline(index),
  candidate: candidate(index, { fallback: true })
}));
const allFallbackReport = analyzeTargetedAssistPairs(allFallback, { cohort: "unseen" });
assert.equal(allFallbackReport.routing.targeted_safe_success_count, 0);
assert.ok(allFallbackReport.gate.reasons.includes("TARGETED_SAFE_SUCCESS_ZERO"));

// Direct-full timing drift must not subsidize a losing targeted route. These
// five eligible pairs lose 9 seconds, while the five direct-full controls gain
// 45 seconds. The all-pairs total is positive, but the route gate stays NO_GO.
const directFullSubsidy = Array.from({ length: 10 }, (_, index) => {
  if (index < 5) {
    return {
      baseline: baseline(index, 0.9, 3_600),
      candidate: candidate(index, { fallback: index !== 0 })
    };
  }
  return {
    baseline: baseline(index, 0.9, 13_500),
    candidate: directFullCandidate(index)
  };
});
const directFullSubsidyReport = analyzeTargetedAssistPairs(directFullSubsidy, { cohort: "unseen" });
assert.equal(directFullSubsidyReport.provider_work.all_pairs_net_savings_ms, 36_000);
assert.equal(directFullSubsidyReport.provider_work.net_savings_ms, -9_000);
assert.equal(directFullSubsidyReport.gate.decision, "NO_GO");
assert.ok(directFullSubsidyReport.gate.reasons.includes("NO_TARGETED_ELIGIBLE_PROVIDER_WORK_SAVING"));
assert.ok(directFullSubsidyReport.gate.reasons.includes("TARGETED_SAFE_SUCCESS_BELOW_BREAK_EVEN"));

const missingTokenLedger = pairs.map((pair) => structuredClone(pair));
for (let index = 1; index < missingTokenLedger.length; index += 1) {
  missingTokenLedger[index].candidate.provider_call_ledger[0].output_tokens = null;
  missingTokenLedger[index].candidate.targeted_assist_execution.provider_call_ledger = missingTokenLedger[index].candidate.provider_call_ledger;
}
const missingTokenReport = analyzeTargetedAssistPairs(missingTokenLedger, { cohort: "unseen" });
assert.equal(missingTokenReport.targeted_output_tokens.observed_ledger_count, 1);
assert.equal(missingTokenReport.targeted_output_tokens.ledger_coverage_complete, false);
assert.equal(missingTokenReport.targeted_output_tokens.within_150_token_budget, false);
assert.equal(missingTokenReport.gate.decision, "NO_GO");
assert.ok(missingTokenReport.gate.reasons.includes("TARGETED_OUTPUT_TOKEN_LEDGER_INCOMPLETE"));

console.log("targeted assist paired20 analyzer tests passed");
