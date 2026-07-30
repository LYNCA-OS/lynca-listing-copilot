import {
  evaluationDecisionTraceSchemaVersion,
  evaluationReplaySnapshotSchemaVersion
} from "./evaluation-decision-trace-packet.mjs";
import { recognitionBenchmarkProfileIds } from "./recognition-benchmark-profile.mjs";
import { secondLookPlanInputHash } from "../catalog/second-look-planner.mjs";

const forbiddenPlannerInputKeyPattern = /(?:ground.?truth|reference.?title|candidate.?truth|expected.?title|golden)/i;
const forbiddenPersistedModelTextKeys = new Set([
  "raw_text",
  "visible_text",
  "observed_text",
  "provider_raw_response",
  "provider_content",
  "model_response_text"
]);
const allowedImageIdentitySources = new Set([
  "IMAGE_GENERATION_SHA256",
  "CONTENT_SHA256",
  "IMAGE_SHA256",
  "SOURCE_CONTENT_SHA256",
  "CROP_CONTENT_SHA256"
]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function titleFor(result = {}) {
  return cleanText(result.final_title || result.title || result.rendered_title);
}

function resolverSnapshot(result = {}) {
  return JSON.stringify({
    identity_resolution_status: result.identity_resolution_status ?? null,
    ambiguity_status: result.ambiguity_status ?? null,
    resolved: result.resolved_fields || result.resolved || result.fields || {},
    publication_gate: result.publication_gate || null,
    final_title: titleFor(result)
  });
}

function forbiddenInputKeys(value, path = "replay_input", found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => forbiddenInputKeys(item, `${path}[${index}]`, found));
    return found;
  }
  if (!value || typeof value !== "object") return found;
  for (const [key, item] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (forbiddenPlannerInputKeyPattern.test(key)) found.push(nextPath);
    forbiddenInputKeys(item, nextPath, found);
  }
  return found;
}

function forbiddenPersistedModelText(value, path = "second_look_shadow", found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => forbiddenPersistedModelText(item, `${path}[${index}]`, found));
    return found;
  }
  if (!value || typeof value !== "object") return found;
  for (const [key, item] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (forbiddenPersistedModelTextKeys.has(key)) found.push(nextPath);
    forbiddenPersistedModelText(item, nextPath, found);
  }
  return found;
}

function assertProviderCallLedger(shadowEvaluation = {}) {
  const ledger = Array.isArray(shadowEvaluation.provider_call_ledger)
    ? shadowEvaluation.provider_call_ledger
    : [];
  if (ledger.length !== 1) throw new Error("second_look_offline_call_ledger_expected_one_row");
  const row = ledger[0] || {};
  if (row.logical_stage !== "TARGETED_SECOND_LOOK_CARD_CODE"
    || row.attempt !== 1
    || !["COMPLETED", "FAILED", "SKIPPED"].includes(cleanText(row.status).toUpperCase())
    || !Number.isFinite(Number(row.timeout_ms))
    || Number(row.timeout_ms) < 250
    || Number(row.timeout_ms) > 3_500
    || row.fallback === true
    || typeof row.call_attempted !== "boolean"
    || row.accounting_complete !== true
    || !String(row.started_at || "").trim()
    || !String(row.completed_at || "").trim()
    || !Number.isFinite(Date.parse(row.started_at))
    || !Number.isFinite(Date.parse(row.completed_at))
    || Date.parse(row.started_at) > Date.parse(row.completed_at)) {
    throw new Error("second_look_offline_call_ledger_incomplete");
  }
  const providerCalls = Number(row.provider_calls);
  if (providerCalls !== (row.call_attempted ? 1 : 0)) {
    throw new Error("second_look_offline_call_ledger_count_mismatch");
  }
  if (Number(shadowEvaluation.paid_provider_calls) !== providerCalls) {
    throw new Error("second_look_offline_paid_call_count_mismatch");
  }
  return row;
}

function assertReviewOnlyEvidence(document = {}) {
  for (const [fieldName, field] of Object.entries(object(document.evidence))) {
    if (field?.status !== "REVIEW") throw new Error(`second_look_offline_evidence_not_review_${fieldName}`);
    const sources = [
      ...(Array.isArray(field?.sources) ? field.sources : []),
      ...(Array.isArray(field?.candidates)
        ? field.candidates.flatMap((candidate) => Array.isArray(candidate?.sources) ? candidate.sources : [])
        : [])
    ];
    if (sources.some((source) => (
      cleanText(source?.source_type || source?.source).toUpperCase() !== "VISION_MODEL"
      || source?.direct_observation === true
      || source?.directly_observed === true
    ))) throw new Error(`second_look_offline_direct_truth_forbidden_${fieldName}`);
  }
}

export function assertSecondLookOfflineReplayGate({
  tracePacket = {},
  baselineResult = {},
  replayedBaselineResult = {},
  shadowEvaluation = {},
  expectedDeploymentGitSha = "",
  runtimeProviderCalls = null
} = {}) {
  if (tracePacket.schema_version !== evaluationDecisionTraceSchemaVersion) {
    throw new Error("second_look_offline_trace_schema_mismatch");
  }
  if (tracePacket.benchmark_profile !== recognitionBenchmarkProfileIds.COLD_SECOND_LOOK_SHADOW) {
    throw new Error("second_look_offline_profile_mismatch");
  }
  const replay = object(tracePacket.replay_snapshot);
  if (replay.schema_version !== evaluationReplaySnapshotSchemaVersion
    || replay.status !== "COMPLETE"
    || !Array.isArray(replay.missing_components)
    || replay.missing_components.length) {
    throw new Error("second_look_offline_replay_snapshot_incomplete");
  }
  const expectedSha = cleanText(expectedDeploymentGitSha).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(expectedSha) || tracePacket.deployment_git_sha !== expectedSha) {
    throw new Error("second_look_offline_deployment_sha_mismatch");
  }
  if (!cleanText(replay.versions?.recognition_pipeline_fingerprint)) {
    throw new Error("second_look_offline_pipeline_fingerprint_required");
  }
  if (Number(runtimeProviderCalls) !== 0) throw new Error("second_look_offline_paid_call_forbidden");
  if (titleFor(baselineResult) !== titleFor(replayedBaselineResult)) {
    throw new Error("second_look_offline_baseline_title_mismatch");
  }
  if (resolverSnapshot(baselineResult) !== resolverSnapshot(replayedBaselineResult)) {
    throw new Error("second_look_offline_baseline_resolver_mismatch");
  }
  if (shadowEvaluation.baseline_unchanged !== true
    || shadowEvaluation.baseline_title !== titleFor(baselineResult)) {
    throw new Error("second_look_offline_baseline_mutated");
  }
  const plan = object(shadowEvaluation.plan);
  if (!/^[0-9a-f]{64}$/.test(cleanText(plan.input_hash))
    || plan.input_hash !== secondLookPlanInputHash(plan)) {
    throw new Error("second_look_offline_plan_hash_mismatch");
  }
  const manifest = Array.isArray(plan.replay_input?.image_manifest)
    ? plan.replay_input.image_manifest
    : [];
  if (!manifest.length || manifest.some((image) => (
    !/^[0-9a-f]{64}$/.test(cleanText(image?.identity_sha256))
    || !allowedImageIdentitySources.has(cleanText(image?.identity_source).toUpperCase())
  ))) {
    throw new Error("second_look_offline_immutable_image_manifest_required");
  }
  const forbidden = forbiddenInputKeys(plan.replay_input);
  if (forbidden.length) throw new Error(`second_look_offline_truth_leak_${forbidden[0]}`);
  if (shadowEvaluation.retry_attempted === true || shadowEvaluation.full_provider_fallback_attempted === true) {
    throw new Error("second_look_offline_retry_or_fallback_forbidden");
  }
  assertProviderCallLedger(shadowEvaluation);
  if (shadowEvaluation.natural_language_model_response_persisted !== false
    || forbiddenPersistedModelText(shadowEvaluation).length) {
    throw new Error("second_look_offline_model_natural_language_persistence_forbidden");
  }
  if (shadowEvaluation.production_effect !== "NONE"
    || shadowEvaluation.title_effect !== "NONE"
    || shadowEvaluation.resolver_effect !== "PROPOSAL_ONLY"
    || shadowEvaluation.candidate_authority !== "RESOLVER_ONLY") {
    throw new Error("second_look_offline_authority_boundary_invalid");
  }
  assertReviewOnlyEvidence(shadowEvaluation.evidence_document || {});
  const candidateTitle = cleanText(shadowEvaluation.candidate_snapshot?.final_title);
  if (candidateTitle.length > 80) throw new Error("second_look_offline_candidate_title_over_80");
  return Object.freeze({
    pass: true,
    gate: "SECOND_LOOK_OFFLINE_REPLAY",
    runtime_provider_calls: 0,
    baseline_title_byte_identical: true,
    baseline_resolver_byte_identical: true,
    immutable_input_hash_verified: true,
    critical_regression_count: 0
  });
}

export const __secondLookOfflineReplayGateTestHooks = Object.freeze({
  assertProviderCallLedger,
  forbiddenInputKeys,
  forbiddenPersistedModelText,
  resolverSnapshot
});
