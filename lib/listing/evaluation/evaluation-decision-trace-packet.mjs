import crypto from "node:crypto";

import { recognitionBenchmarkProfileIds } from "./recognition-benchmark-profile.mjs";
import { withObservedProviderAuxRoute } from "../v4/route-planner/provider-aux-route-shadow.mjs";
import {
  buildTargetedAssistEvaluationNuisanceFingerprint,
  targetedAssistNuisanceFingerprintContractVersion
} from "../cache/identity-cache-version-contract.mjs";
import {
  buildVerifiedCurrentImageManifest,
  currentImageManifestMatches
} from "../evidence/current-image-manifest.mjs";
import {
  buildCandidatePreApplicationReplayManifest,
  candidateObservationEvidenceSnapshotSchemaVersion,
  candidatePreApplicationEvidenceSnapshotMatches
} from "../candidates/candidate-selection-pass.mjs";

export const evaluationDecisionTraceSchemaVersion = "evaluation-decision-trace-packet-v12";
export const evaluationReplaySnapshotSchemaVersion = "evaluation-replay-snapshot-v6";

const feedbackIdentitySourceTypes = new Set([
  "INTERNAL_APPROVED_HISTORY",
  "INTERNAL_CORRECTED_TITLE",
  "REVIEWED_INTERNAL",
  "WRITER_FINAL"
]);

export function candidateSourceRequiresFeedbackIdentity(candidate = {}) {
  const sourceType = cleanText(candidate.source_type || candidate.source, 80).toUpperCase();
  return feedbackIdentitySourceTypes.has(sourceType)
    || /(?:^|_)(?:REVIEWED|CORRECTED|WRITER)(?:_|$)/.test(sourceType);
}

const canonicalFieldAliases = Object.freeze({
  year: ["year", "printed_year", "release_year", "season", "product_year", "title_year"],
  manufacturer: ["manufacturer", "brand"],
  product: ["product", "product_line"],
  set: ["set", "subset"],
  subject: ["players", "player", "subjects", "subject", "character"],
  card_name: ["card_name", "official_card_type", "card_type", "insert"],
  card_number: ["card_number", "collector_number", "checklist_code", "tcg_card_number"],
  descriptive_rarity: ["descriptive_rarity", "rarity", "ssp", "case_hit"],
  numerical_rarity: ["numerical_rarity", "print_run_number", "serial_number", "numbered_to"],
  release_variant: ["release_variant", "variation", "design_variation"],
  print_finish: ["print_finish", "product_finish", "parallel", "parallel_exact", "parallel_family", "surface_color"],
  special_stamp: ["special_stamp", "first_bowman"],
  grading_info: ["grading_info", "grade_company", "card_grade", "grade", "auto_grade", "grade_type"],
  search_optimization: ["search_optimization", "observable_components", "rc", "auto", "patch", "relic", "jersey", "sketch", "redemption", "team"]
});

const missingFieldCategories = Object.freeze({
  PROVIDER_NOT_OBSERVED: "PROVIDER_NOT_OBSERVED",
  NORMALIZATION_DROPPED: "NORMALIZATION_DROPPED",
  CATALOG_NOT_RETRIEVED: "CATALOG_NOT_RETRIEVED"
});

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, max = 160) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function compactValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.slice(0, 12).map(compactValue).filter((item) => item !== null);
  if (typeof value === "object") return null;
  return cleanText(value);
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isoTimestampOrNull(value) {
  const timestamp = cleanText(value, 40);
  return timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : null;
}

function compactFields(fields = {}) {
  return Object.fromEntries(Object.entries(object(fields))
    .map(([key, value]) => [normalizedTraceKey(key), compactValue(value)])
    .filter(([key, value]) => evaluationFieldKeyAllowed(key) && value !== null));
}

function sha256(value) {
  const text = cleanText(value, 500);
  return text ? crypto.createHash("sha256").update(text).digest("hex") : null;
}

function sameFieldProjection(left = {}, right = {}) {
  const leftKeys = Object.keys(object(left)).sort();
  const rightKeys = Object.keys(object(right)).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((field, index) => (
      field === rightKeys[index]
      && JSON.stringify(left[field]) === JSON.stringify(right[field])
    ));
}

export function normalizationProjectionComplete(normalization = {}, providerFields = {}, observedFields = {}) {
  const decisions = array(normalization.decisions);
  const decisionByField = new Map();
  for (const row of decisions) {
    const field = cleanText(row?.field, 80);
    const decision = cleanText(row?.decision, 40).toUpperCase();
    if (!field || decisionByField.has(field)) return false;
    decisionByField.set(field, decision);
  }
  const input = object(normalization.input);
  const output = object(normalization.output);
  const requiredFields = new Set([
    ...Object.keys(input),
    ...Object.keys(output)
  ]);
  const expectedDecision = (field) => {
    const inInput = Object.hasOwn(input, field);
    const inOutput = Object.hasOwn(output, field);
    if (inInput && !inOutput) return "DROP";
    if (!inInput && inOutput) return "DERIVE";
    return JSON.stringify(input[field]) === JSON.stringify(output[field])
      ? "PRESERVE"
      : "NORMALIZE";
  };
  return sameFieldProjection(input, providerFields)
    && sameFieldProjection(output, observedFields)
    && decisionByField.size === requiredFields.size
    && [...requiredFields].every((field) => decisionByField.get(field) === expectedDecision(field));
}

const forbiddenNaturalLanguageTraceKeys = new Set([
  "natural_language_response",
  "natural_language_model_response",
  "natural_language_output",
  "natural_language_content",
  "raw_text",
  "visible_text",
  "observed_text",
  "provider_raw_response",
  "provider_content",
  "model_response_text",
  "provider_response",
  "model_response",
  "raw_response",
  "raw_output",
  "output_text",
  "response_text",
  "assistant_message",
  "completion",
  "content",
  "messages",
  "prompt",
  "response",
  "text",
  "answer",
  "analysis",
  "reasoning",
  "explanation",
  "description"
]);

const typedTraceStructuralKeys = new Set([
  "schema_version", "adapter_version", "executor_version", "owner", "enabled", "mode", "route",
  "status", "status_code", "execution_status", "reason", "reason_code", "decision", "action",
  "field", "field_name", "fields", "value", "normalized_value", "resolved_value", "candidates",
  "sources", "source", "source_type", "source_trust", "source_ref", "trust", "trust_tier",
  "confidence", "conflicts", "unresolved", "unresolved_reason", "rejection_reasons", "metadata",
  "provenance", "normalization", "input", "output", "decisions", "trace", "policy", "evidence",
  "evidence_document", "evidence_kind", "observed_fields", "resolved", "raw_observed_fields",
  "raw_provider_fields", "normalized_evidence", "raw_provider_field_evidence", "rendered_fields",
  "identity_evidence_items", "field_support", "field_actions", "permission", "participation_level",
  "selected", "selected_rank", "rank", "score", "scores", "margin", "query", "query_fields",
  "top_k", "unavailable", "available", "eligible", "evaluated", "required", "complete", "valid",
  "direct_observation", "directly_observed", "visible_marker", "signature_visible", "text_visible",
  "side", "capture_role", "region", "source_region", "source_inference_method", "crop_lineage",
  "derived", "images", "image_count", "image_set_fingerprint", "current_image_context",
  "current_image_set_fingerprint", "tenant_id", "asset_id", "image_generation_id", "image_id",
  "source_image_id", "source_crop_id", "derived_image_id", "object_path", "source_object_path",
  "derived_object_path", "content_sha256", "source_content_sha256", "derived_content_sha256",
  "current_image_manifest_fingerprint", "storage_verified", "crop_id", "crop_role", "source_side",
  "transform_version", "candidate_id", "identity_id", "candidate_identity_id", "source_feedback_id_sha256",
  "rule_id", "version", "source_sha256", "constraint_snapshot_version", "constraint_snapshot_source_sha256",
  "enumerator_version", "model_id", "prompt_revision", "schema_revision", "response_hash", "input_hash",
  "preprovider_snapshot_hash", "logical_stage", "attempt", "started_at", "completed_at", "latency_ms",
  "timeout_ms", "provider_calls", "retrieval_calls", "input_tokens", "output_tokens", "total_tokens",
  "estimated_cost_usd", "cost_configured", "fallback", "call_attempted", "accounting_complete",
  "provider_call_ledger", "paid_provider_calls", "retry_attempted", "full_provider_fallback_attempted",
  "final_observation_owner", "fallback_reason_code", "provider_timing_authority", "targeted_error",
  "production_default", "world_knowledge_paid_calls", "full_provider_role", "production_effect",
  "title_effect", "resolver_effect", "candidate_authority", "candidate_status", "candidate_error",
  "candidate_snapshot", "candidate_decision_trace", "candidate_title_delta", "baseline_title",
  "baseline_snapshot", "baseline_unchanged", "execution_error", "observation_completion_error",
  "candidate_count", "evidence_count", "observed_count", "truncated", "source_kinds", "missing_components",
  "status_reason", "reason_per_field", "applied_fields", "blocked_fields", "direct_conflicts",
  "anchor_agreement", "source_url", "source_id", "bracket", "modality", "normalization_version",
  "outcome", "supporting_evidence_ids", "contradicting_evidence_ids", "derived_field", "kind", "canonical",
  "bbox", "state", "line_id", "image_sha256", "can_generate_title", "can_resolve_identity",
  "can_override_resolver", "plan", "production_action", "counterfactual_action",
  "shadow_only", "run", "skipped", "worker_finished_before_provider", "job_observability",
  "metrics", "nodes", "node_id", "replay_manifest", "candidate_pre_application_replay_manifest",
  "authority_scope", "snapshot_content_sha256",
  "crop_policy_version", "normalized_bounds"
]);

const typedTraceFieldKeys = new Set([
  ...Object.values(canonicalFieldAliases).flat(),
  "multi_card", "card_count", "lot_type", "card_type", "official_card_type",
  "parallel", "parallel_exact", "parallel_family", "surface_color", "variation",
  "rc", "first_bowman", "auto", "patch", "relic", "jersey", "sketch", "redemption",
  "one_of_one", "grade", "grade_company", "card_grade", "auto_grade", "grade_type",
  "cert_number", "condition", "raw_condition", "defects", "team", "sport", "category", "ip_sport"
]);
const typedTraceTechnicalSuffix = /(?:^|_)(?:id|ids|sha256|hash|fingerprint|version|status|code|reason|count|total|rate|ms|at|rank|score|margin|enabled|eligible|required|allowed|blocked|verified|selected|attempted|truncated|skipped|calls|decision|permission|effect|authority|role|type|field|fields|value|values|action)$/;

function normalizedTraceKey(value) {
  return cleanText(value, 100)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function evaluationFieldKeyAllowed(key) {
  return typedTraceFieldKeys.has(normalizedTraceKey(key));
}

function naturalLanguageTraceKey(key) {
  if (!key) return true;
  if (forbiddenNaturalLanguageTraceKeys.has(key) || key.includes("natural_language")) return true;
  if (/(?:^|_)(?:prompt|messages?|completion|assistant_message|raw_response|raw_output|output_text|response_text|model_response|provider_response|answer|analysis|reasoning|explanation|description)(?:_|$)/.test(key)) {
    return !/(?:hash|sha256|status|code|version)$/.test(key);
  }
  return false;
}

function typedTraceKeyAllowed(key) {
  return !naturalLanguageTraceKey(key)
    && (typedTraceStructuralKeys.has(key)
      || typedTraceFieldKeys.has(key)
      || typedTraceTechnicalSuffix.test(key));
}

const fieldValueKeys = new Set([
  "value", "normalized_value", "resolved_value", "canonical", "observed_value",
  "candidate_value", "old_value", "final_value"
]);
const titleValueKeys = new Set(["baseline_title", "candidate_title_delta"]);
const codeValueKey = /(?:^|_)(?:status|code|reason|decision|action|mode|route|source|trust|permission|role|type|field|outcome|effect|authority|version|owner)$/;
const idValueKey = /(?:^|_)(?:id|ids|sha256|hash|fingerprint)$/;
function boundedCode(value, max = 160) {
  const output = cleanText(value, max);
  return /^[\p{L}\p{N}][\p{L}\p{N}._:/+-]{0,159}$/u.test(output) ? output : null;
}

function boundedFieldValue(value) {
  const output = cleanText(value, 96);
  if (!output || output.length > 96 || output.split(/\s+/).length > 16) return null;
  if (/[{}<>]|(?:^|\s)(?:system|assistant|developer)\s*:/iu.test(output)) return null;
  return output;
}

function replayString(value, context = {}) {
  const key = context.key || "";
  if (context.inside_metadata && fieldValueKeys.has(key)) return null;
  if (context.inside_metadata && ["reason", "unresolved"].includes(key)) return null;
  if (context.inside_unresolved) {
    if (["field", "field_name", "unresolved"].includes(key)) {
      const field = normalizedTraceKey(value);
      return typedTraceFieldKeys.has(field) ? field : null;
    }
    if (key === "reason_code" || key === "status" || key === "code") return boundedCode(value);
    return null;
  }
  if (titleValueKeys.has(key)) return cleanText(value, 80) || null;
  if (fieldValueKeys.has(key)) {
    if (!context.field && context.region_evidence !== true) return null;
    return boundedFieldValue(value);
  }
  if (typedTraceFieldKeys.has(key)) return boundedFieldValue(value);
  if (key === "object_path" || key.endsWith("_object_path")) {
    const path = cleanText(value, 500);
    return /^(?:tenants\/|listing-assets\/)[^\s]{1,480}$/.test(path) ? path : null;
  }
  if (key === "source_url") {
    const url = cleanText(value, 500);
    return /^(?:https?|supabase):\/\/[^\s]{1,480}$/i.test(url) ? url : null;
  }
  if (key.endsWith("_at")) return isoTimestampOrNull(value);
  if (idValueKey.test(key)) return boundedCode(value, 200);
  if (codeValueKey.test(key) || key === "logical_stage" || key === "model_id") {
    return boundedCode(value);
  }
  return boundedCode(value);
}

// The evaluation packet has one schema-aware projector. Generic JSON replay is
// intentionally unsupported: a value is retained only when its path supplies
// a typed field, enum/code, identifier, timestamp, or bounded title contract.
function replayValue(value, depth = 0, context = {}) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return replayString(value, context);
  if (depth >= 7) return null;
  if (Array.isArray(value)) {
    return value.slice(0, 120)
      .map((item) => replayValue(item, depth + 1, context))
      .filter((item) => item !== null);
  }
  if (typeof value !== "object") return null;
  const normalizedEntries = Object.entries(value).slice(0, 160)
    .map(([key, item]) => [normalizedTraceKey(key), item])
    .filter(([key]) => typedTraceKeyAllowed(key));
  const explicitField = normalizedEntries
    .filter(([key]) => key === "field" || key === "field_name" || key === "derived_field" || key === "claim_field")
    .map(([, item]) => normalizedTraceKey(item))
    .find((field) => typedTraceFieldKeys.has(field));
  const objectField = explicitField || context.field || null;
  const regionEvidence = context.region_evidence === true
    || normalizedEntries.some(([key]) => key === "evidence_id" || key === "line_id");
  return Object.fromEntries(normalizedEntries
    .map(([key, item]) => {
      const childField = typedTraceFieldKeys.has(key) ? key : objectField;
      const insideMetadata = context.inside_metadata === true || key === "metadata";
      const insideUnresolved = context.inside_unresolved === true || key === "unresolved";
      return [key, replayValue(item, depth + 1, {
        key,
        field: insideMetadata ? null : childField,
        inside_metadata: insideMetadata,
        inside_unresolved: insideUnresolved,
        region_evidence: regionEvidence
      })];
    })
    .filter(([key, item]) => key && item !== null));
}

function secondLookTraceValue(value) {
  return replayValue(value);
}

function secondLookError(error = {}) {
  const source = object(error);
  if (!Object.keys(source).length) return null;
  return {
    code: cleanText(source.code, 120) || null,
    message_present: Boolean(cleanText(source.message, 1)),
    message_sha256: sha256(source.message)
  };
}

function secondLookLedgerRow(row = {}) {
  return {
    logical_stage: cleanText(row.logical_stage, 120) || null,
    attempt: finiteOrNull(row.attempt),
    started_at: isoTimestampOrNull(row.started_at),
    completed_at: isoTimestampOrNull(row.completed_at),
    latency_ms: finiteOrNull(row.latency_ms),
    timeout_ms: finiteOrNull(row.timeout_ms),
    provider_calls: finiteOrNull(row.provider_calls),
    input_tokens: finiteOrNull(row.input_tokens),
    output_tokens: finiteOrNull(row.output_tokens),
    total_tokens: finiteOrNull(row.total_tokens),
    image_count: finiteOrNull(row.image_count),
    model_id: cleanText(row.model_id, 120) || null,
    prompt_revision: cleanText(row.prompt_revision, 120) || null,
    schema_revision: cleanText(row.schema_revision, 120) || null,
    status: cleanText(row.status, 40) || null,
    reason_code: cleanText(row.reason_code, 120) || null,
    fallback: row.fallback === true,
    call_attempted: typeof row.call_attempted === "boolean" ? row.call_attempted : null,
    accounting_complete: row.accounting_complete === true,
    estimated_cost_usd: finiteOrNull(row.estimated_cost_usd),
    cost_configured: typeof row.cost_configured === "boolean" ? row.cost_configured : null
  };
}

function targetedAssistExecutionTrace(execution = {}, ledger = []) {
  const source = object(execution);
  if (!Object.keys(source).length) return null;
  return {
    owner: cleanText(source.owner, 120) || null,
    executor_version: cleanText(source.executor_version, 120) || null,
    production_default: cleanText(source.production_default, 40) || null,
    world_knowledge_paid_calls: cleanText(source.world_knowledge_paid_calls, 40) || null,
    full_provider_role: cleanText(source.full_provider_role, 80) || null,
    enabled: source.enabled === true,
    route: cleanText(source.route, 80) || null,
    final_observation_owner: cleanText(source.final_observation_owner, 120) || null,
    fallback_reason_code: cleanText(source.fallback_reason_code, 120) || null,
    targeted_error: Object.keys(object(source.targeted_error)).length
      ? { code: cleanText(source.targeted_error.code, 120) || null }
      : null,
    provider_timing_authority: cleanText(source.provider_timing_authority, 80) || null,
    provider_call_ledger: array(ledger).map(secondLookLedgerRow)
  };
}

function secondLookShadowTrace(shadow = {}) {
  const source = object(shadow);
  if (!Object.keys(source).length) return null;
  return replayValue({
    owner: cleanText(source.owner, 120) || null,
    schema_version: cleanText(source.schema_version, 120) || null,
    enabled: source.enabled === true,
    execution_status: cleanText(source.execution_status, 40) || null,
    reason_code: cleanText(source.reason_code, 120) || null,
    execution_error: secondLookError(source.execution_error),
    plan: secondLookTraceValue(source.plan),
    provider_call_ledger: array(source.provider_call_ledger).map(secondLookLedgerRow),
    paid_provider_calls: finiteOrNull(source.paid_provider_calls),
    retry_attempted: source.retry_attempted === true,
    full_provider_fallback_attempted: source.full_provider_fallback_attempted === true,
    evidence_document: secondLookTraceValue(source.evidence_document),
    observed_fields: array(source.observed_fields).map((field) => cleanText(field, 80)).filter(Boolean),
    response_hash: cleanText(source.response_hash, 160) || null,
    model_id: cleanText(source.model_id, 120) || null,
    natural_language_model_response_persisted: false,
    observation_completion_error: secondLookError(source.observation_completion_error),
    baseline_title: cleanText(source.baseline_title, 240) || null,
    baseline_snapshot: secondLookTraceValue(source.baseline_snapshot),
    baseline_unchanged: source.baseline_unchanged === true,
    candidate_status: cleanText(source.candidate_status, 40) || null,
    candidate_error: secondLookError(source.candidate_error),
    candidate_snapshot: secondLookTraceValue(source.candidate_snapshot),
    candidate_decision_trace: secondLookTraceValue(source.candidate_decision_trace),
    candidate_title_delta: cleanText(source.candidate_title_delta, 40) || null,
    production_effect: cleanText(source.production_effect, 40) || null,
    title_effect: cleanText(source.title_effect, 40) || null,
    resolver_effect: cleanText(source.resolver_effect, 40) || null,
    candidate_authority: cleanText(source.candidate_authority, 40) || null
  });
}

function regionEvidenceFromPayload(payload = {}) {
  const patches = [
    ...Object.values(object(payload.preingestion_initial_evidence)),
    ...array(payload.preingestion_evidence_patches)
  ];
  const packets = patches
    .map((patch) => object(patch?.provenance).region_evidence)
    .filter((packet) => packet && typeof packet === "object" && Array.isArray(packet.evidence));
  if (!packets.length) return null;
  const seen = new Set();
  const evidence = [];
  let observedCount = 0;
  for (const packet of packets) {
    for (const entry of packet.evidence) {
      observedCount += 1;
      const id = cleanText(entry?.evidence_id, 180);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (evidence.length < 120) evidence.push(entry);
    }
  }
  return {
    schema_version: cleanText(packets[0]?.schema_version, 120) || null,
    adapter_version: cleanText(packets[0]?.adapter_version, 120) || null,
    source_kinds: [...new Set(packets.map((packet) => cleanText(packet.source_kind, 80)).filter(Boolean))],
    evidence,
    evidence_count: seen.size,
    observed_count: observedCount,
    truncated: seen.size > evidence.length,
    policy: replayValue(packets[0]?.policy || {})
  };
}

function currentImageContextForReplay(payload = {}) {
  return buildVerifiedCurrentImageManifest(payload);
}

function providerAuxRouteTrace(result = {}) {
  const shadow = result.knowledge_first_route_shadow?.provider_aux_route_shadow;
  if (!shadow) return null;
  const observed = withObservedProviderAuxRoute(shadow, {
    providerCalls: result.usage?.provider_calls,
    providerCallSkipped: typeof result.provider_call_skipped === "boolean"
      ? result.provider_call_skipped
      : null,
    targetedAssistExecution: result.targeted_assist_execution || null,
    providerCallLedger: array(result.provider_call_ledger
      || result.targeted_assist_execution?.provider_call_ledger),
    // The ordinary full-provider arm has no targeted executor ledger;
    // its typed slot start is the authoritative equivalent.
    providerStartedAt: result.provider_slot_timing?.started_at
      || result.provider_capacity_timeline?.provider_started_at
      || null
  });
  const trace = replayValue(observed);
  const input = object(observed?.replay_input);
  if (!trace || !Object.keys(input).length) return trace;
  // The route hash covers an explicit six-field contract. Generic replay
  // projection drops nulls, so preserve the two nullable members here or the
  // persisted input can no longer reproduce its own pre-provider hash.
  trace.replay_input = {
    evidence_document: replayValue(input.evidence_document) || {},
    forward_enumeration_trace: replayValue(array(input.forward_enumeration_trace)) || [],
    usable_image_count: Number(input.usable_image_count || 0),
    exact_anchor_shadow: input.exact_anchor_shadow && typeof input.exact_anchor_shadow === "object"
      ? {
          evaluated: input.exact_anchor_shadow.evaluated === true,
          eligible: input.exact_anchor_shadow.eligible === true,
          reason: cleanText(input.exact_anchor_shadow.reason, 120) || null
        }
      : null,
    higher_authority_route: cleanText(input.higher_authority_route, 120) || null,
    evidence_availability_manifest: replayValue(array(input.evidence_availability_manifest)) || []
  };
  return trace;
}

function buildReplaySnapshot(result = {}, payload = {}) {
  const targetedAssistNuisance = buildTargetedAssistEvaluationNuisanceFingerprint(payload);
  const providerFields = compactFields(result.raw_provider_fields || {});
  const providerFieldEvidence = Array.isArray(result.raw_provider_field_evidence)
    ? result.raw_provider_field_evidence
    : Array.isArray(result.field_evidence) ? result.field_evidence : null;
  const derivationProvenance = Array.isArray(result.forward_enumeration_trace)
    ? result.forward_enumeration_trace
    : Array.isArray(result.derivation_provenance) ? result.derivation_provenance : null;
  const forwardEnumerationPacket = object(result.forward_enumeration_candidate_packet);
  const observedFields = compactFields(result.raw_observed_fields || result.evidence_fields || {});
  const resolvedFields = compactFields(result.resolved_fields || result.resolved || {});
  const renderedFields = compactFields(result.rendered_fields?.fields || result.rendered_fields || {});
  const finalTitle = cleanText(result.final_title || result.title, 240) || null;
  const fingerprint = cleanText(
    result.recognition_pipeline_fingerprint
    || result.identity_cache?.recognition_pipeline_fingerprint
    || result.identity_cache?.version_fingerprint,
    160
  ) || null;
  const effectiveTerminalRendererInputs = object(result.effective_terminal_renderer_inputs);
  const semanticRetrievalApplication = object(
    result.l2_candidate_debug?.retrieval_application
    || result.retrieval_application
    || result.candidate_control_plane_trace?.retrieval_application
  );
  const normalization = normalizationTrace(result);
  const regionEvidence = regionEvidenceFromPayload(payload);
  const currentImageContext = currentImageContextForReplay(payload);
  const preApplicationEvidenceSnapshot = object(
    result.candidate_pre_application_evidence_snapshot
    || result.l2_candidate_debug?.candidate_pre_application_evidence_snapshot
  );
  const candidateContextBinding = currentImageManifestMatches(
    object(preApplicationEvidenceSnapshot.current_image_context),
    currentImageContext
  );
  const candidateSnapshotBinding = candidatePreApplicationEvidenceSnapshotMatches(
    preApplicationEvidenceSnapshot,
    currentImageContext
  );
  const candidateReplayManifest = buildCandidatePreApplicationReplayManifest(
    preApplicationEvidenceSnapshot,
    currentImageContext
  );
  const required = {
    provider_fields: Object.keys(providerFields).length > 0,
    provider_field_evidence: Array.isArray(providerFieldEvidence),
    current_image_context: currentImageContext.status === "COMPLETE",
    candidate_pre_application_evidence_snapshot:
      cleanText(preApplicationEvidenceSnapshot.schema_version, 120) === candidateObservationEvidenceSnapshotSchemaVersion
      && preApplicationEvidenceSnapshot.status === "COMPLETE"
      && candidateSnapshotBinding.valid === true
      && candidateReplayManifest !== null
      && candidateContextBinding.valid === true
      && cleanText(preApplicationEvidenceSnapshot.tenant_id, 160) === currentImageContext.tenant_id
      && cleanText(preApplicationEvidenceSnapshot.asset_id, 160) === currentImageContext.asset_id
      && cleanText(preApplicationEvidenceSnapshot.image_generation_id, 160) === currentImageContext.image_generation_id
      && cleanText(preApplicationEvidenceSnapshot.current_image_set_fingerprint, 160)
        === currentImageContext.image_set_fingerprint,
    observed_fields: Object.keys(observedFields).length > 0,
    normalized_evidence: Object.keys(object(result.normalized_evidence || result.evidence)).length > 0,
    resolved_fields: Object.keys(resolvedFields).length > 0,
    rendered_fields: Object.keys(renderedFields).length > 0,
    final_title: Boolean(finalTitle),
    renderer_version: Boolean(cleanText(result.renderer_version, 120)),
    normalization_version: Boolean(cleanText(result.normalization_version, 120)),
    candidate_policy_version: Boolean(cleanText(result.candidate_policy_version, 120)),
    resolver_version: Boolean(cleanText(result.identity_resolution_version || result.resolver_version, 120)),
    pipeline_fingerprint: Boolean(fingerprint),
    effective_terminal_renderer_inputs: Object.hasOwn(effectiveTerminalRendererInputs, "serial_numerator_verified")
      && Object.hasOwn(effectiveTerminalRendererInputs, "trust_resolved_print_run_without_evidence"),
    normalization_projection: normalizationProjectionComplete(normalization, providerFields, observedFields),
    semantic_retrieval_application: typeof semanticRetrievalApplication.enabled === "boolean"
      && Array.isArray(semanticRetrievalApplication.decisions),
    derivation_provenance: Array.isArray(derivationProvenance),
    constraint_snapshot_version: Boolean(cleanText(forwardEnumerationPacket.constraint_snapshot_version, 160)),
    constraint_snapshot_source_sha256: Boolean(cleanText(forwardEnumerationPacket.constraint_snapshot_source_sha256, 160)),
    constraint_enumerator_version: Boolean(cleanText(forwardEnumerationPacket.enumerator_version, 160))
  };
  const missing = Object.entries(required).filter(([, present]) => !present).map(([name]) => name);
  const providerOptions = object(payload.provider_options || payload.providerOptions);
  // `null` is a real third state here: current-image OCR neither verified nor
  // rejected the serial numerator. The generic bounded projector intentionally
  // drops nulls, so serialize this contract explicitly instead.
  const replayTerminalRendererInputs = {
    max_title_length: Number(
      effectiveTerminalRendererInputs.max_title_length
      || payload.maxTitleLength
      || payload.max_title_length
      || result.max_title_length
      || 80
    ),
    serial_numerator_verified: Object.hasOwn(effectiveTerminalRendererInputs, "serial_numerator_verified")
      ? effectiveTerminalRendererInputs.serial_numerator_verified
      : null,
    trust_resolved_print_run_without_evidence:
      effectiveTerminalRendererInputs.trust_resolved_print_run_without_evidence === true,
    source: cleanText(effectiveTerminalRendererInputs.source, 120) || null
  };
  return {
    schema_version: evaluationReplaySnapshotSchemaVersion,
    status: missing.length ? "PARTIAL" : "COMPLETE",
    missing_components: missing,
    provider_fields: providerFields,
    provider_field_evidence: replayValue(providerFieldEvidence || []),
    current_image_context: currentImageContext,
    candidate_pre_application_evidence_snapshot: replayValue(preApplicationEvidenceSnapshot),
    candidate_pre_application_replay_manifest: replayValue(candidateReplayManifest),
    region_evidence: replayValue(regionEvidence),
    observed_fields: observedFields,
    normalized_evidence: replayValue(result.normalized_evidence || result.evidence || {}),
    normalization: replayValue(normalization),
    resolved_fields: resolvedFields,
    rendered_fields: renderedFields,
    final_title: finalTitle,
    derivation_provenance: replayValue(derivationProvenance || []),
    semantic_retrieval_application: replayValue(semanticRetrievalApplication),
    effective_terminal_renderer_inputs: replayTerminalRendererInputs,
    versions: {
      recognition_pipeline_fingerprint: fingerprint,
      targeted_assist_nuisance_fingerprint: targetedAssistNuisance.fingerprint,
      targeted_assist_nuisance_contract: targetedAssistNuisanceFingerprintContractVersion,
      provider_model: cleanText(result.model || result.model_id || result.provider_model, 120) || null,
      provider_prompt: cleanText(result.provider_prompt_version || result.prompt_version, 120) || null,
      evidence_schema: cleanText(result.evidence_schema_version, 120) || null,
      region_evidence_adapter: cleanText(regionEvidence?.adapter_version, 120) || null,
      normalization: cleanText(result.normalization_version, 120) || null,
      candidate_policy: cleanText(result.candidate_policy_version, 120) || null,
      catalog_snapshot: cleanText(
        result.identity_cache?.result_version?.owner_versions?.catalog
        || result.active_catalog_snapshot_revision,
        160
      ) || null,
      constraint_snapshot: cleanText(forwardEnumerationPacket.constraint_snapshot_version, 160) || null,
      constraint_snapshot_sha256: cleanText(forwardEnumerationPacket.constraint_snapshot_source_sha256, 160) || null,
      constraint_enumerator: cleanText(forwardEnumerationPacket.enumerator_version, 160) || null,
      resolver: cleanText(result.identity_resolution_version || result.resolver_version, 120) || null,
      renderer: cleanText(result.renderer_version, 120) || null
    },
    renderer_inputs: {
      max_title_length: Number(payload.maxTitleLength || payload.max_title_length || result.max_title_length || 80),
      serial_numerator_verified: result.serial_numerator_verified ?? null,
      marketplace_profile: cleanText(providerOptions.marketplace_profile || payload.marketplace_profile, 120) || null,
      language_profile: cleanText(providerOptions.language_profile || payload.language_profile, 120) || null,
      title_profile: cleanText(providerOptions.title_profile || payload.title_profile, 120) || null
    }
  };
}

function reasonCode(value, fallback = null) {
  const token = cleanText(value, 120).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return token || fallback;
}

function candidateInputRows(result = {}) {
  const persistedControl = object(result.candidate_control_plane_trace);
  const adaptedControl = object(result.l2_candidate_debug);
  // In the native core the authoritative candidate fields still live directly
  // on the result. `l2_candidate_debug` is built later by the V4 persistence
  // adapter, so evaluation tracing must not wait for that downstream view.
  const control = Object.keys(persistedControl).length
    ? persistedControl
    : Object.keys(adaptedControl).length ? adaptedControl : result;
  const applicationRows = array(control.candidate_application_trace || control.candidate_application_trace_rows);
  const retrieval = object(result.retrieval);
  const retrievalCandidates = array(retrieval.candidates || retrieval.results || retrieval.matches);
  return {
    control,
    rows: applicationRows.length ? applicationRows : retrievalCandidates
  };
}

function candidateRows(result = {}, limit = 20) {
  const { control, rows } = candidateInputRows(result);
  const selectedId = cleanText(
    control.selected_candidate_id || control.selected_candidate_decision?.selected_candidate_id,
    180
  );
  const decisionRows = array(control.retrieval_application?.decisions);
  return rows.slice(0, Math.max(0, Number(limit) || 0)).map((candidate, index) => {
    const row = object(candidate);
    const actions = array(row.field_actions || row.actions).slice(0, 40).map((action) => {
      const item = object(action);
      return {
        field: cleanText(item.field || item.field_name, 80) || null,
        action: reasonCode(item.action || item.decision, "SUPPORT"),
        reason: reasonCode(item.reason_code || item.reason || item.block_reason, "UNSPECIFIED"),
        value: compactValue(item.value ?? item.candidate_value)
      };
    });
    for (const field of array(row.applied_fields)) actions.push({ field: cleanText(field, 80), action: "APPLY", reason: "APPLIED" });
    for (const field of array(row.supported_fields)) actions.push({ field: cleanText(field, 80), action: "SUPPORT", reason: "SUPPORTED_ONLY" });
    for (const field of array(row.blocked_fields)) actions.push({ field: cleanText(field, 80), action: "BLOCK", reason: reasonCode(row.block_reason, "BLOCKED") });
    for (const decision of decisionRows.filter((item) => cleanText(item?.candidate_id, 180) === cleanText(row.candidate_id || row.id || row.identity_id, 180))) {
      actions.push({
        field: cleanText(decision.field || decision.resolver_field, 80) || null,
        action: reasonCode(decision.decision, "SUPPORT"),
        reason: reasonCode(decision.reason, "UNSPECIFIED"),
        value: compactValue(decision.candidate_value)
      });
    }
    const candidateId = cleanText(row.candidate_id || row.id || row.identity_id, 180) || null;
    const sourceFeedbackIdHash = cleanText(row.source_feedback_id_sha256, 64)
      || sha256(
        row.source_feedback_id
        || row.reference_metadata?.source_feedback_id
        || row.metadata?.source_feedback_id
      );
    return {
      candidate_id: candidateId,
      rank: Number.isFinite(Number(row.rank)) ? Number(row.rank) : index + 1,
      // Semantic source authority must win over the transport/provider lane.
      // Otherwise a reviewed row carried by postgres_hybrid can look like a
      // generic provider row and evade the source-identity completeness gate.
      source: cleanText(row.source_type || row.source || row.provider_id || row.candidate_lane, 80) || null,
      source_type: cleanText(row.source_type || row.reference_metadata?.source_type, 80) || null,
      provider_id: cleanText(row.provider_id || row.reference_metadata?.provider, 80) || null,
      source_trust: cleanText(row.source_trust || row.trust_tier || row.authority_tier, 80) || null,
      source_feedback_id_sha256: /^[0-9a-f]{64}$/i.test(sourceFeedbackIdHash)
        ? sourceFeedbackIdHash.toLowerCase()
        : null,
      score: Number.isFinite(Number(row.score ?? row.total_score)) ? Number(row.score ?? row.total_score) : null,
      selected: row.selected === true || row.selection_status === "SELECTED" || Boolean(selectedId && selectedId === candidateId),
      rejection_reasons: array(row.rejection_reasons || row.reason_codes)
        .map((value) => reasonCode(value)).filter(Boolean).slice(0, 20),
      field_actions: actions.slice(0, 40)
    };
  });
}

function stageValues(fields = {}, aliases = []) {
  const values = aliases.flatMap((alias) => {
    const value = object(fields)[alias];
    return Array.isArray(value) ? value : value === null || value === undefined || value === "" ? [] : [value];
  }).map(compactValue).filter((value) => value !== null);
  return [...new Map(values.map((value) => [JSON.stringify(value), value])).values()].slice(0, 12);
}

function comparable(value) {
  return cleanText(value, 240).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function titleContainsValue(title, value) {
  const haystack = ` ${comparable(title)} `;
  const needle = comparable(value);
  return needle.length >= 2 && haystack.includes(` ${needle} `);
}

function buildFieldLineage(result = {}, candidates = []) {
  const provider = object(result.raw_provider_fields);
  const normalized = object(result.raw_observed_fields || result.evidence_fields);
  const resolved = object(result.resolved_fields || result.resolved);
  const rendered = object(result.rendered_fields?.fields || result.rendered_fields);
  const finalTitle = cleanText(result.final_title || result.title || result.model_title_suggestion, 240);
  return Object.entries(canonicalFieldAliases).map(([field, aliases]) => {
    const providerValues = stageValues(provider, aliases);
    const normalizedValues = stageValues(normalized, aliases);
    const resolverValues = stageValues(resolved, aliases);
    const rendererValues = stageValues(rendered, aliases);
    const candidateDecisions = candidates.flatMap((candidate) => candidate.field_actions
      .filter((action) => aliases.includes(action.field) || action.field === field)
      .map((action) => ({
        candidate_id: candidate.candidate_id,
        selected: candidate.selected,
        action: action.action,
        reason: action.reason,
        value: action.value ?? null
      }))).slice(0, 40);
    const finalMatchedValues = [...rendererValues, ...resolverValues]
      .filter((value) => typeof value !== "boolean" && titleContainsValue(finalTitle, value));
    const normalizedPresent = normalizedValues.length > 0;
    const resolvedPresent = resolverValues.length > 0;
    const renderedPresent = rendererValues.length > 0;
    return {
      field,
      provider: {
        owner: "PROVIDER_OBSERVATION",
        version: cleanText(result.provider_prompt_version || result.prompt_version || result.model_id, 120) || null,
        values: providerValues,
        decision: providerValues.length ? "OBSERVED" : "NOT_OBSERVED",
        reason: providerValues.length ? "PROVIDER_FIELD_EMITTED" : "PROVIDER_FIELD_ABSENT"
      },
      normalization: {
        owner: "EVIDENCE_NORMALIZER",
        version: cleanText(result.evidence_schema_version || result.normalization_version, 120) || null,
        values: normalizedValues,
        decision: providerValues.length && !normalizedPresent ? "DROP" : normalizedPresent ? "PRESERVE_OR_NORMALIZE" : "NOT_OBSERVED",
        reason: providerValues.length && !normalizedPresent
          ? "NORMALIZED_EMPTY_OR_UNSUPPORTED"
          : normalizedPresent ? "NORMALIZATION_COMPLETED" : "NO_PROVIDER_INPUT"
      },
      retrieval: {
        owner: "CANDIDATE_CONTROL_PLANE",
        version: cleanText(result.candidate_policy_version || result.l2_candidate_debug?.schema_version, 120) || null,
        decisions: candidateDecisions
      },
      resolver: {
        owner: "IDENTITY_RESOLVER",
        version: cleanText(result.identity_resolution_version || result.resolver_version, 120) || null,
        values: resolverValues,
        decision: normalizedPresent && !resolvedPresent ? "DROP" : resolvedPresent ? "RETAIN_OR_ADD" : "NO_VALUE",
        reason: normalizedPresent && !resolvedPresent ? "RESOLVER_NOT_PRESERVED" : resolvedPresent ? "RESOLVER_OUTPUT_PRESENT" : "NO_NORMALIZED_VALUE"
      },
      renderer: {
        owner: "DETERMINISTIC_RENDERER",
        version: cleanText(result.renderer_version, 120) || null,
        values: rendererValues,
        decision: resolvedPresent && !renderedPresent ? "DROP" : renderedPresent ? "INCLUDE" : "NO_VALUE",
        reason: resolvedPresent && !renderedPresent ? "RENDERER_NOT_INCLUDED" : renderedPresent ? "RENDERER_MODULE_PRESENT" : "NO_RESOLVED_VALUE"
      },
      final_title_span: {
        owner: "FINAL_TITLE_SPAN_MATCHER",
        version: "final-title-span-v1",
        matched: finalMatchedValues.length > 0,
        matched_values: finalMatchedValues,
        decision: finalMatchedValues.length ? "MATCH" : "NO_MATCH",
        reason: finalMatchedValues.length ? "FIELD_VALUE_PRESENT_IN_FINAL_TITLE" : "FIELD_VALUE_NOT_FOUND_IN_FINAL_TITLE"
      }
    };
  });
}

function normalizationTrace(result = {}) {
  const input = compactFields(result.raw_provider_fields || {});
  const output = compactFields(result.raw_observed_fields || result.evidence_fields || {});
  const explicitRejections = new Map(array(result.provider_field_rejections).map((item) => {
    const row = object(item);
    return [cleanText(row.field || row.field_name, 80), reasonCode(row.reason_code || row.reason, "PROVIDER_FIELD_REJECTED")];
  }));
  const fields = [...new Set([...Object.keys(input), ...Object.keys(output)])].sort();
  return {
    input,
    output,
    decisions: fields.map((field) => ({
      field,
      decision: !(field in output)
        ? "DROP"
        : !(field in input)
          ? "DERIVE"
          : JSON.stringify(input[field]) === JSON.stringify(output[field])
            ? "PRESERVE"
            : "NORMALIZE",
      reason: !(field in output)
        ? explicitRejections.get(field) || "NORMALIZED_EMPTY_OR_UNSUPPORTED"
        : !(field in input)
          ? "NORMALIZER_DERIVED"
          : "NORMALIZATION_COMPLETED"
    }))
  };
}

function resolutionTrace(result = {}) {
  const before = compactFields(result.evidence_fields || result.raw_observed_fields || {});
  const after = compactFields(result.resolved_fields || result.resolved || {});
  const dropped = Object.keys(before).filter((field) => !(field in after)).map((field) => {
    const matching = array(result.resolution_trace).find((entry) => cleanText(entry?.field, 80) === field);
    return { field, reason: reasonCode(matching?.reason_code || matching?.decision || matching?.reason, "RESOLVER_NOT_PRESERVED") };
  });
  return { before, after, dropped };
}

function rendererTrace(result = {}) {
  const resolved = compactFields(result.resolved_fields || result.resolved || {});
  const rendered = compactFields(result.rendered_fields?.fields || result.rendered_fields || {});
  const included = Object.keys(resolved).filter((field) => field in rendered);
  const dropped = Object.keys(resolved).filter((field) => !(field in rendered))
    .map((field) => ({ field, reason: "RENDERER_NOT_INCLUDED" }));
  return {
    renderer: cleanText(result.renderer, 80) || null,
    renderer_version: cleanText(result.renderer_version, 120) || null,
    included_fields: included,
    dropped_fields: dropped,
    module_order: array(result.module_order).map((value) => cleanText(value, 80)).filter(Boolean).slice(0, 30)
  };
}

function providerRequestIdentityTrace(result = {}) {
  const identity = object(result.provider_request_identity);
  if (!Object.keys(identity).length) return null;
  return {
    schema_version: cleanText(identity.schema_version, 120) || null,
    status: cleanText(identity.status, 40) || null,
    requested_model_id: cleanText(identity.requested_model_id, 120) || null,
    response_model_id: cleanText(identity.response_model_id, 120) || null,
    provider_prompt_sha256: cleanText(identity.provider_prompt_sha256, 64).toLowerCase() || null,
    provider_prompt_utf8_bytes: finiteOrNull(identity.provider_prompt_utf8_bytes),
    provider_input_image_count: finiteOrNull(identity.provider_input_image_count),
    provider_ordered_image_content_sha256: cleanText(
      identity.provider_ordered_image_content_sha256,
      64
    ).toLowerCase() || null,
    provider_image_manifest_complete: identity.provider_image_manifest_complete === true,
    provider_image_declared_content_mismatch_count: finiteOrNull(
      identity.provider_image_declared_content_mismatch_count
    ),
    provider_request_controls_sha256: cleanText(identity.provider_request_controls_sha256, 64).toLowerCase() || null,
    provider_request_fingerprint: cleanText(identity.provider_request_fingerprint, 64).toLowerCase() || null,
    provider_http_request_budget: finiteOrNull(identity.provider_http_request_budget),
    provider_http_request_budget_enforced: identity.provider_http_request_budget_enforced === true,
    provider_http_retry_policy: cleanText(identity.provider_http_retry_policy, 40) || null,
    provider_http_request_count: finiteOrNull(identity.provider_http_request_count),
    provider_http_request_started_at: isoTimestampOrNull(identity.provider_http_request_started_at),
    provider_http_request_completed_at: isoTimestampOrNull(identity.provider_http_request_completed_at),
    response_profile: cleanText(identity.response_profile, 80) || null,
    image_detail: cleanText(identity.image_detail, 20) || null,
    requested_service_tier: cleanText(identity.requested_service_tier, 40) || null,
    max_output_tokens: finiteOrNull(identity.max_output_tokens),
    reasoning_effort: cleanText(identity.reasoning_effort, 40) || null,
    temperature: finiteOrNull(identity.temperature),
    text_verbosity: cleanText(identity.text_verbosity, 40) || null
  };
}

function preingestionOcrTrace(result = {}) {
  const ocrNode = array(result.pipeline_node_ledger?.nodes)
    .find((node) => cleanText(node?.node_id, 80) === "preingestion_ocr");
  const metrics = object(ocrNode?.metrics);
  const sourceJobs = array(metrics.job_observability);
  if (!sourceJobs.length) return null;
  return {
    schema_version: "preingestion-ocr-lineage-trace-v1",
    job_observability: sourceJobs.slice(0, 32).map((job) => ({
      job_id: cleanText(job?.job_id, 160) || null,
      crop_role: cleanText(job?.crop_role, 80) || null,
      source_image_id: cleanText(job?.source_image_id, 160) || null,
      source_side: cleanText(job?.source_side, 20).toLowerCase() || null,
      source_region: cleanText(job?.source_region, 120) || null,
      status: cleanText(job?.status, 40).toUpperCase() || "UNKNOWN"
    })),
    job_observability_count: finiteOrNull(metrics.job_observability_count) ?? sourceJobs.length,
    job_observability_truncated: metrics.job_observability_truncated === true
  };
}

export function evaluationTraceEnabled(payload = {}) {
  const options = object(payload.provider_options || payload.providerOptions);
  const profile = cleanText(options.recognition_benchmark_profile || payload.benchmark_profile || payload.recognition_benchmark_profile);
  const traceLevel = cleanText(options.trace_level || payload.trace_level).toLowerCase();
  return [
    recognitionBenchmarkProfileIds.COLD_ALGORITHM,
    recognitionBenchmarkProfileIds.COLD_TARGETED_ASSIST,
    recognitionBenchmarkProfileIds.COLD_SECOND_LOOK_SHADOW,
    "cold_algorithm",
    "cold_targeted_assist",
    "cold_second_look_shadow"
  ].includes(profile)
    && traceLevel === "evaluation";
}

export function buildEvaluationDecisionTracePacket(result = {}, payload = {}) {
  if (!evaluationTraceEnabled(payload)) return null;
  const options = object(payload.provider_options || payload.providerOptions);
  const benchmarkProfile = cleanText(
    options.recognition_benchmark_profile
    || payload.benchmark_profile
    || payload.recognition_benchmark_profile
  );
  const candidates = candidateRows(result);
  const candidateInputs = candidateInputRows(result).rows;
  const sourceAuditCandidates = candidateRows(result, 200);
  const retrieval = object(result.retrieval);
  const selected = candidates.find((candidate) => candidate.selected) || null;
  const sourceFeedbackId = cleanText(
    result.source_feedback_id
    || result.sourceFeedbackId
    || payload.source_feedback_id
    || payload.sourceFeedbackId,
    500
  );
  const sourceFeedbackIdHash = sha256(sourceFeedbackId);
  const sameSourceCandidates = sourceFeedbackIdHash
    ? sourceAuditCandidates.filter((candidate) => candidate.source_feedback_id_sha256 === sourceFeedbackIdHash)
    : [];
  const unobservableReviewedCandidates = sourceAuditCandidates.filter((candidate) => (
    candidateSourceRequiresFeedbackIdentity(candidate)
    && !candidate.source_feedback_id_sha256
  ));
  return Object.freeze({
    schema_version: evaluationDecisionTraceSchemaVersion,
    // Per-result deployment provenance closes the gap where a production
    // alias could move during a long paired run and later move back.
    deployment_git_sha: /^[0-9a-f]{40}$/i.test(cleanText(
      process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA,
      40
    ))
      ? cleanText(process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA, 40).toLowerCase()
      : null,
    deployment_id: /^dpl_[A-Za-z0-9]+$/.test(cleanText(process.env.VERCEL_DEPLOYMENT_ID, 160))
      ? cleanText(process.env.VERCEL_DEPLOYMENT_ID, 160)
      : null,
    deployment_url: cleanText(process.env.VERCEL_URL, 500).toLowerCase() || null,
    benchmark_profile: benchmarkProfile,
    trace_level: "evaluation",
    replay_snapshot: buildReplaySnapshot(result, payload),
    field_lineage: buildFieldLineage(result, candidates),
    provider_request_identity: providerRequestIdentityTrace(result),
    provider_observation: {
      recognition_status: cleanText(
        result.raw_provider_recognition_status || result.provider_recognition_status,
        40
      ) || null,
      fields: compactFields(result.raw_provider_fields || {}),
      field_evidence: replayValue(result.raw_provider_field_evidence || []),
      field_evidence_count: array(result.raw_provider_field_evidence).length,
      field_evidence_truncated: array(result.raw_provider_field_evidence).length > 120,
      unresolved: replayValue(result.raw_provider_unresolved || []),
      unresolved_count: array(result.raw_provider_unresolved).length,
      unresolved_truncated: array(result.raw_provider_unresolved).length > 120
    },
    provider_observation_fields: compactFields(result.raw_provider_fields || {}),
    region_evidence: replayValue(regionEvidenceFromPayload(payload)),
    preingestion_ocr: preingestionOcrTrace(result),
    normalization: normalizationTrace(result),
    retrieval: {
      query: compactFields(retrieval.query || retrieval.query_fields || result.retrieval_query || {}),
      top_k: candidates,
      candidate_count: candidates.length
    },
    self_retrieval_exclusion: {
      required: Boolean(sourceFeedbackIdHash),
      source_feedback_id_sha256: sourceFeedbackIdHash,
      top_k_checked_count: candidates.length,
      all_candidate_count: candidateInputs.length,
      all_candidates_checked_count: sourceAuditCandidates.length,
      candidate_check_truncated: sourceAuditCandidates.length !== candidateInputs.length,
      candidate_source_id_observable_count: sourceAuditCandidates.filter((candidate) => (
        Boolean(candidate.source_feedback_id_sha256)
      )).length,
      unobservable_reviewed_candidate_count: unobservableReviewedCandidates.length,
      same_source_candidate_count: sameSourceCandidates.length,
      same_source_candidate_ids: sameSourceCandidates.map((candidate) => candidate.candidate_id).filter(Boolean)
    },
    selection: {
      selected_candidate_id: selected?.candidate_id || null,
      selected_rank: selected?.rank || null,
      rejection_reasons: candidates.filter((candidate) => !candidate.selected)
        .flatMap((candidate) => candidate.rejection_reasons).slice(0, 40)
    },
    application: candidates.flatMap((candidate) => candidate.field_actions.map((action) => ({
      candidate_id: candidate.candidate_id,
      ...action
    }))).slice(0, 120),
    recognition_preflight: result.recognition_preflight_diagnostics
      ? replayValue(result.recognition_preflight_diagnostics)
      : null,
    knowledge_first_route: result.knowledge_first_route_shadow
      ? replayValue(result.knowledge_first_route_shadow)
      : null,
    provider_aux_route: providerAuxRouteTrace(result),
    targeted_assist_execution: result.targeted_assist_execution
      ? targetedAssistExecutionTrace(
          result.targeted_assist_execution,
          result.provider_call_ledger || result.targeted_assist_execution.provider_call_ledger
        )
      : null,
    second_look_shadow: secondLookShadowTrace(result.second_look_shadow),
    world_knowledge_shadow_assist: result.world_knowledge_shadow_assist ? {
      schema_version: cleanText(result.world_knowledge_shadow_assist.schema_version, 120) || null,
      mode: cleanText(result.world_knowledge_shadow_assist.mode, 80) || null,
      requested: result.world_knowledge_shadow_assist.requested === true,
      execution_status: cleanText(result.world_knowledge_shadow_assist.execution_status, 40) || null,
      execution_reason: cleanText(result.world_knowledge_shadow_assist.execution_reason, 120) || null,
      paid_provider_calls: Number(result.world_knowledge_shadow_assist.paid_provider_calls || 0),
      resolver_effect: cleanText(result.world_knowledge_shadow_assist.resolver_effect, 40) || null,
      title_effect: cleanText(result.world_knowledge_shadow_assist.title_effect, 40) || null,
      input_hash: cleanText(result.world_knowledge_shadow_assist.input_hash, 80) || null,
      input: replayValue(result.world_knowledge_shadow_assist.input || {}),
      output: null
    } : null,
    resolver: resolutionTrace(result),
    renderer: rendererTrace(result)
  });
}

export function classifyEvaluationMissingField(packet = {}, fieldName = "") {
  const field = cleanText(fieldName, 80);
  if (!field || !Object.hasOwn(object(packet.provider_observation_fields), field)) {
    return missingFieldCategories.PROVIDER_NOT_OBSERVED;
  }
  if (!Object.hasOwn(object(packet.normalization?.output), field)) {
    return missingFieldCategories.NORMALIZATION_DROPPED;
  }
  return missingFieldCategories.CATALOG_NOT_RETRIEVED;
}

export const evaluationMissingFieldCategories = missingFieldCategories;
