import { buildV4CandidateControlPlaneTrace } from "./candidates/control-plane-adapter.mjs";
import { buildV4FieldEvidenceRows, buildV4FieldGraph, buildV4FieldStates, buildV4ResolvedFields } from "./evidence/field-evidence.mjs";
import { buildV4QualityLedger } from "./quality-ledger/quality-ledger.mjs";
import { buildV4WriterDraft } from "./renderer/writer-draft.mjs";
import { classifyV4Segment } from "./segments/segment-classifier.mjs";
import { withV4Version } from "./schema/version.mjs";
import { v4SessionStatuses } from "./session/status.mjs";
import { buildV4TitleStageState } from "./stages/title-stages.mjs";

function normalizeTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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
  const resolvedFields = buildV4ResolvedFields(result);
  const finalTitle = normalizeTitle(result.final_title || result.rendered_title || result.title);
  const writerDraft = buildV4WriterDraft(result);
  const candidateTrace = buildV4CandidateControlPlaneTrace(result);
  const fieldStates = buildV4FieldStates(result, payload);
  const fieldGraph = buildV4FieldGraph(result, payload);
  const segment = classifyV4Segment(resolvedFields, payload);
  const qualityLedger = buildV4QualityLedger({ sessionId, result, routePlan, persistence });
  const failed = String(result.confidence || "").toUpperCase() === "FAILED" || !finalTitle;
  const titleStageState = buildV4TitleStageState({
    result,
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
    provider_result: {
      provider: result.provider || result.provider_id || null,
      model: result.model || result.model_id || result.provider_model || null,
      confidence: result.confidence || null,
      provider_error_type: result.provider_error_type || result.provider_error_code || null,
      token_diagnostics: result.provider_token_diagnostics || result.provider_usage || null,
      timing: result.timing || result.timings || null,
      fast_scout: fastScoutSummary(result)
    },
    legacy_v2_result: result,
    v4_persistence: persistence
  });
}

export function buildV4PersistenceRows({ sessionId, result = {}, payload = {} } = {}) {
  return {
    fieldEvidenceRows: buildV4FieldEvidenceRows({ sessionId, result, payload }),
    candidateTrace: buildV4CandidateControlPlaneTrace(result)
  };
}
