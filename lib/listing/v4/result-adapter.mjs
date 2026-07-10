import { buildV4CandidateControlPlaneTrace } from "./candidates/control-plane-adapter.mjs";
import { buildV4FieldEvidenceRows, buildV4FieldGraph, buildV4FieldStates, buildV4ResolvedFields } from "./evidence/field-evidence.mjs";
import { buildV4QualityLedger } from "./quality-ledger/quality-ledger.mjs";
import { renderListingPresentation } from "../renderer/listing-renderer.mjs";
import { buildV4WriterDraft } from "./renderer/writer-draft.mjs";
import { classifyV4Segment } from "./segments/segment-classifier.mjs";
import { withV4Version } from "./schema/version.mjs";
import { v4SessionStatuses } from "./session/status.mjs";
import { buildV4TitleStageState } from "./stages/title-stages.mjs";

function normalizeTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hasResolvedValue(value) {
  if (Array.isArray(value)) return value.some(hasResolvedValue);
  if (value && typeof value === "object") return Object.values(value).some(hasResolvedValue);
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function recoverTitleFromResolvedFields({
  result = {},
  payload = {},
  resolvedFields = {}
} = {}) {
  const existingTitle = normalizeTitle(result.final_title || result.rendered_title || result.title);
  if (existingTitle) return { result, finalTitle: existingTitle, recovered: false };
  if (!resolvedFields || typeof resolvedFields !== "object" || Array.isArray(resolvedFields)) {
    return { result, finalTitle: "", recovered: false };
  }
  if (!Object.values(resolvedFields).some(hasResolvedValue)) {
    return { result, finalTitle: "", recovered: false };
  }

  const presentation = renderListingPresentation({
    resolved: resolvedFields,
    evidence: result.normalized_evidence || result.evidence || result.provider_evidence || {},
    maxLength: payload.maxTitleLength || payload.max_title_length || result.max_title_length || 80
  });
  const recoveredTitle = normalizeTitle(presentation.final_title || presentation.rendered_title);
  if (!recoveredTitle) return { result, finalTitle: "", recovered: false };

  return {
    result: {
      ...result,
      confidence: String(result.confidence || "").toUpperCase() === "FAILED" ? "LOW" : result.confidence,
      title: recoveredTitle,
      final_title: recoveredTitle,
      rendered_title: recoveredTitle,
      title_recovered_from_v4_field_graph: true,
      title_recovery_source: "v4_resolved_fields",
      renderer_version: presentation.renderer_version || result.renderer_version || null,
      title_length_policy: presentation.title_length_policy || result.title_length_policy || null
    },
    finalTitle: recoveredTitle,
    recovered: true
  };
}

export function prepareV4PresentationResult({ result = {}, payload = {} } = {}) {
  const resolvedFields = buildV4ResolvedFields(result);
  const recovery = recoverTitleFromResolvedFields({ result, payload, resolvedFields });
  return {
    result: recovery.result,
    resolvedFields,
    finalTitle: recovery.finalTitle,
    recovered: recovery.recovered
  };
}

function sidecarStatus(result = {}) {
  const sidecars = result.workflow_sidecars || {};
  return Object.fromEntries(
    Object.entries(sidecars).map(([name, value]) => [name, {
      status: value?.status || value?.state || (value ? "AVAILABLE" : "NOT_RUN"),
      durable: value?.durable ?? null
    }])
  );
}

function fastScoutSummary(result = {}) {
  const scout = result.fast_scout;
  if (!scout || typeof scout !== "object") return null;
  return {
    status: scout.status || null,
    latency_ms: scout.latency_ms ?? null,
    image_detail: scout.image_detail || null,
    input_image_count: Number(scout.input_image_count || 0) || null,
    input_images: Array.isArray(scout.input_images)
      ? scout.input_images.map((image) => ({
        image_id: image.image_id || null,
        role: image.role || null,
        width: image.width ?? null,
        height: image.height ?? null
      }))
      : [],
    cache_hit: scout.cache_hit === true
  };
}

export function adaptV2ResultToV4({
  sessionId,
  result = {},
  payload = {},
  routePlan = {},
  persistence = {}
} = {}) {
  const prepared = prepareV4PresentationResult({ result, payload });
  const resolvedFields = prepared.resolvedFields;
  const adaptedResult = prepared.result;
  const finalTitle = prepared.finalTitle;
  const writerDraft = buildV4WriterDraft(adaptedResult);
  const candidateTrace = buildV4CandidateControlPlaneTrace(adaptedResult);
  const fieldStates = buildV4FieldStates(adaptedResult, payload);
  const fieldGraph = buildV4FieldGraph(adaptedResult, payload);
  const segment = classifyV4Segment(resolvedFields, payload);
  const qualityLedger = buildV4QualityLedger({ sessionId, result: adaptedResult, routePlan, persistence });
  const failed = String(adaptedResult.confidence || "").toUpperCase() === "FAILED" || !finalTitle;
  const titleStageState = buildV4TitleStageState({
    result: adaptedResult,
    routePlan,
    writerDraft,
    resolvedFields,
    fieldStates
  });

  return withV4Version({
    ok: !failed,
    recognition_session_id: sessionId,
    status: failed ? v4SessionStatuses.FAILED : v4SessionStatuses.DRAFT_READY,
    route_plan: routePlan,
    segment,
    title_stage: titleStageState.title_stage,
    final_title: finalTitle,
    writer_safe_draft: titleStageState.writer_safe_draft,
    assisted_draft: titleStageState.assisted_draft,
    assisted_draft_status: titleStageState.assisted_draft_status,
    assisted_draft_pending_modules: titleStageState.assisted_draft_pending_modules,
    pending_modules: titleStageState.pending_modules,
    background_modules: titleStageState.background_modules,
    blocking_modules: titleStageState.blocking_modules,
    review_required_fields: titleStageState.review_required_fields,
    title_stage_reason: titleStageState.title_stage_reason,
    l1_return_reason: titleStageState.l1_return_reason,
    full_assist_continued_after_l1: titleStageState.full_assist_continued_after_l1,
    title_stage_readiness: titleStageState.readiness,
    module_speed_metrics: titleStageState.module_speed_metrics,
    writer_draft: writerDraft,
    resolved_fields: resolvedFields,
    field_states: fieldStates,
    internal_field_graph: fieldGraph,
    candidate_control_plane_trace: candidateTrace,
    catalog_activation_funnel: candidateTrace.catalog_activation_funnel || {},
    vector_activation_funnel: candidateTrace.vector_activation_funnel || {},
    preingestion_bundle_id: payload.preingestion_bundle_id || payload.preingestionBundleId || result.preingestion_bundle_id || null,
    production_quality_ledger_id: qualityLedger.id,
    workflow_sidecars_status: sidecarStatus(result),
    failure_reason: failed ? String(adaptedResult.reason || adaptedResult.provider_error_type || adaptedResult.provider_error_code || "recognition_result_empty").slice(0, 500) : null,
    provider_result: {
      provider: adaptedResult.provider || adaptedResult.provider_id || null,
      model: adaptedResult.model || adaptedResult.model_id || adaptedResult.provider_model || null,
      confidence: adaptedResult.confidence || null,
      provider_error_type: adaptedResult.provider_error_type || adaptedResult.provider_error_code || null,
      token_diagnostics: adaptedResult.provider_token_diagnostics || adaptedResult.provider_usage || null,
      rate_limit_diagnostics: adaptedResult.provider_rate_limit_diagnostics || null,
      request_diagnostics: adaptedResult.provider_request_diagnostics || null,
      initial_token_diagnostics: adaptedResult.provider_initial_token_diagnostics || null,
      initial_rate_limit_diagnostics: adaptedResult.provider_initial_rate_limit_diagnostics || null,
      initial_request_diagnostics: adaptedResult.provider_initial_request_diagnostics || null,
      key_pool_size: Number(adaptedResult.provider_key_pool_size || 0) || null,
      key_slot: Number(adaptedResult.provider_key_slot || 0) || null,
      key_source: adaptedResult.provider_key_source || null,
      key_rotation_attempted: adaptedResult.provider_key_rotation_attempted === true,
      key_rotation_attempts: Number(adaptedResult.provider_key_rotation_attempts || 0),
      timing: adaptedResult.timing || adaptedResult.timings || null,
      fast_scout: fastScoutSummary(adaptedResult),
      title_recovered_from_v4_field_graph: prepared.recovered === true,
      gpt5_empty_result_retry_attempted: adaptedResult.gpt5_empty_result_retry_attempted === true,
      gpt5_empty_result_retry_success: adaptedResult.gpt5_empty_result_retry_success === true,
      gpt5_empty_result_retry_status_code: adaptedResult.gpt5_empty_result_retry_status_code ?? null,
      gpt5_empty_result_retry_key_slot: Number(adaptedResult.gpt5_empty_result_retry_key_slot || 0) || null,
      failure_reason: failed ? String(adaptedResult.reason || adaptedResult.provider_error_type || adaptedResult.provider_error_code || "recognition_result_empty").slice(0, 500) : null
    },
    legacy_v2_result: adaptedResult,
    v4_persistence: persistence
  });
}

export function buildV4PersistenceRows({ sessionId, result = {}, payload = {} } = {}) {
  return {
    fieldEvidenceRows: buildV4FieldEvidenceRows({ sessionId, result, payload }),
    candidateTrace: buildV4CandidateControlPlaneTrace(result)
  };
}
