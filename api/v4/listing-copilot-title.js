import { waitUntil } from "@vercel/functions";
import { runListingRecognitionCore } from "../listing-copilot-title.js";
import { buildV4PipelineContract } from "../../lib/listing/v4/pipeline/pipeline-contract.mjs";
import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { getSessionFromRequest, operatorIdFromRequest } from "../../lib/listing-session.mjs";
import { runV4FastScoutObservation } from "../../lib/listing/v4/fast-scout/fast-scout-observation.mjs";
import { maybeFinalizeL1FromExactAnchor } from "../../lib/listing/v4/fast-scout/exact-anchor-finalize.mjs";
import { probePreL2Anchors } from "../../lib/listing/v4/anchors/pre-l2-anchor-probe.mjs";
import { planV4RecognitionRoute } from "../../lib/listing/v4/route-planner/route-planner.mjs";
import { applyPreIngestionBundleToPayload } from "../../lib/listing/pipeline/preingestion-evidence.mjs";
import { adaptV2ResultToV4, buildV4PersistenceRows, prepareV4PresentationResult } from "../../lib/listing/v4/result-adapter.mjs";
import { classifyV4ResultOutcome } from "../../lib/listing/v4/result-outcome.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import {
  providerOptionsForV4BackgroundL2,
  providerOptionsForV4ProgressiveL1,
  v4TitleStages
} from "../../lib/listing/v4/stages/title-stages.mjs";
import {
  createV4RecognitionSession,
  createV4SessionId,
  persistV4CandidateTrace,
  persistV4CatalogGap,
  persistV4FieldEvidence,
  persistV4NonCriticalArtifactsAtomic,
  persistV4QualityLedger,
  persistV4WriterReadyAndReleaseCapacity,
  updateV4RecognitionSession,
  updateV4RecognitionSessionWithRetry
} from "../../lib/listing/v4/session/session-store.mjs";
import { v4SessionStatuses } from "../../lib/listing/v4/session/status.mjs";
import { readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import { isV4WorkerRequest } from "../../lib/listing/v4/jobs/worker-auth.mjs";
import { triggerWriterReadyCapacityRefill } from "../../lib/listing/v4/jobs/writer-ready-capacity-refill.mjs";
import { providerModelOverrideFromOptions } from "../../lib/listing/providers/provider-contract.mjs";
import { isGpt5ResponsesModel } from "../../lib/listing/providers/openai-responses-request.mjs";
import { openAiKeyPoolSize } from "../../lib/listing/providers/openai-key-pool.mjs";

function titleFromResult(result = {}) {
  return result.final_title || result.rendered_title || result.title || null;
}

function isFailedResult(result = {}) {
  return classifyV4ResultOutcome(result).technical_failure;
}

function isRetrySuppressedProviderError(result = {}) {
  const code = String(result.provider_error_code || result.provider_error_type || "").toLowerCase();
  if (!code) return false;
  return /auth|permission|quota|rate|unsupported|bad_request|invalid_request|input/.test(code);
}

function shouldRetryGpt5EmptyResult({
  payload = {},
  result = {},
  env = process.env
} = {}) {
  if (!isGpt5ResponsesModel(requestedListingModelFromPayload(payload, env))) return false;
  if (payload.v4_gpt5_empty_result_retry_attempted === true) return false;
  if (titleFromResult(result)) return false;
  if (isInternalScoutResult(result)) return false;
  if (isRetrySuppressedProviderError(result)) return false;
  return true;
}

function withGpt5EmptyRetryMetadata(result = {}, {
  attempted = false,
  success = false,
  retryStatusCode = null,
  retryKeySlot = null
} = {}) {
  if (!attempted) return result;
  return {
    ...result,
    gpt5_empty_result_retry_attempted: true,
    gpt5_empty_result_retry_success: success === true,
    gpt5_empty_result_retry_status_code: retryStatusCode,
    gpt5_empty_result_retry_key_slot: retryKeySlot
  };
}

export function alternateOpenAiKeySlot(payload = {}, env = process.env) {
  const poolSize = openAiKeyPoolSize(env);
  const currentSlot = Number(payload.openai_preferred_key_slot || payload.provider_key_slot_hint || 0);
  if (poolSize <= 1 || !Number.isFinite(currentSlot) || currentSlot < 1 || currentSlot > poolSize) return null;
  return (Math.trunc(currentSlot) % poolSize) + 1;
}

function isInternalScoutResult(result = {}) {
  return result?.title_stage === v4TitleStages.L1_INTERNAL_SCOUT;
}

function buildInternalScoutSummary(response = {}, result = {}) {
  return {
    title: titleFromResult(result) || titleFromResult(response) || "",
    resolved_fields: resolvedFromResult(result),
    confidence: result.confidence || response.provider_result?.confidence || null,
    provider: result.provider || result.provider_id || response.provider_result?.provider || null,
    model: result.model || result.model_id || response.provider_result?.model || null,
    fast_scout: response.provider_result?.fast_scout || result.fast_scout || null,
    timing: response.provider_result?.timing || result.timing || result.timings || null,
    writer_visible: false
  };
}

function hideTitleFields(value = {}) {
  if (!value || typeof value !== "object") return value;
  return {
    ...value,
    title: "",
    final_title: "",
    rendered_title: "",
    model_title_suggestion: "",
    writer_visible: false,
    internal_fast_scout_title: titleFromResult(value) || ""
  };
}

function writerFinalizedL2ExactAnchorResponse(response = {}, result = {}, finalize = {}) {
  const scout = buildInternalScoutSummary(response, result);
  return withV4Version({
    ...response,
    ok: true,
    status: v4SessionStatuses.DRAFT_READY,
    title_stage: v4TitleStages.L2_ASSISTED_DRAFT,
    final_title: finalize.title,
    title: finalize.title,
    rendered_title: finalize.title,
    writer_safe_draft: finalize.title,
    assisted_draft: finalize.title,
    assisted_draft_status: "READY",
    writer_draft: {
      ...(response.writer_draft || {}),
      title: finalize.title,
      display_title: finalize.title,
      status: "READY",
      user_edit_mode: "one_line_title_only",
      structured_fields_visible: false
    },
    title_render_source: "exact_anchor_catalog_finalized",
    title_stage_reason: "Exact printed-code anchor matched exactly one catalog identity with zero contradictions; the catalog-grounded L2 title is writer-visible.",
    l1_return_reason: "l2_direct_exact_anchor_catalog_finalized",
    exact_anchor_finalize: {
      used: true,
      candidate: finalize.candidate || null,
      query_fields: finalize.query_fields || null
    },
    title_stage_readiness: {
      ...(response.title_stage_readiness || {}),
      writer_safe_ready: true,
      writer_visible_title_ready: true,
      internal_scout_ready: true
    },
    l1_internal_scout: { ...scout, writer_visible: false }
  });
}

function writerPendingL1Response(response = {}, result = {}) {
  const scout = buildInternalScoutSummary(response, result);
  // Diagnostic only: expose WHY exact-anchor finalize did not fire so gates
  // can distinguish catalog/RPC transients from code regressions. The writer
  // barrier still hides all title fields below.
  const exactAnchorFinalize = result.exact_anchor_finalize || { used: false, reason: "not_attempted" };
  const legacy = hideTitleFields(response.legacy_v2_result || result || {});
  return withV4Version({
    ...response,
    ok: true,
    status: v4SessionStatuses.OBSERVING,
    title_stage: v4TitleStages.L1_INTERNAL_SCOUT,
    final_title: "",
    title: "",
    rendered_title: "",
    writer_safe_draft: "",
    assisted_draft: null,
    assisted_draft_status: "PENDING",
    writer_draft: {
      ...(response.writer_draft || {}),
      title: "",
      display_title: "正在生成一段式标题",
      status: "PENDING",
      confidence_score: 0,
      actions: [],
      user_edit_mode: "one_line_title_only",
      structured_fields_visible: false
    },
    title_stage_reason: "Fast scout is internal evidence only. Writer-visible one-line title will appear after L2 completes.",
    l1_return_reason: "fast_scout_internal_scout_ready",
    title_stage_readiness: {
      ...(response.title_stage_readiness || {}),
      writer_safe_ready: false,
      writer_visible_title_ready: false,
      internal_scout_ready: Boolean(scout.title || Object.keys(scout.resolved_fields || {}).length)
    },
    exact_anchor_finalize: exactAnchorFinalize,
    l1_internal_scout: scout,
    legacy_v2_result: legacy
  });
}

// Exact-anchor finalize is the one L1 outcome allowed through the writer
// barrier: a unique strictest-tier catalog identity (exact printed code +
// year agreement + zero contradicted anchors) IS the answer, so the writer
// sees the title in the L1 window (~2-3s) while the background L2 run stays
// on as verification and overwrites on completion. Every other L1 result
// stays behind the barrier as internal evidence.
function exactAnchorWriterFastLaneEnabled(env = process.env) {
  return String(env.ENABLE_V4_EXACT_ANCHOR_WRITER_FAST_LANE ?? "true").toLowerCase() !== "false";
}

function writerFinalizedL1Response(response = {}, result = {}) {
  const scout = buildInternalScoutSummary(response, result);
  const title = String(result.final_title || result.title || "").replace(/\s+/g, " ").trim();
  return withV4Version({
    ...response,
    ok: true,
    status: v4SessionStatuses.OBSERVING,
    title_stage: v4TitleStages.L2_ASSISTED_DRAFT,
    final_title: title,
    title,
    rendered_title: title,
    writer_safe_draft: title,
    assisted_draft: null,
    assisted_draft_status: "PENDING",
    title_render_source: "exact_anchor_catalog_finalized",
    resolved_fields: result.resolved_fields || result.resolved || {},
    exact_anchor_finalize: result.exact_anchor_finalize || { used: true },
    writer_draft: {
      ...(response.writer_draft || {}),
      title,
      display_title: title,
      status: "DRAFT_READY",
      confidence_score: 0.9,
      actions: [],
      user_edit_mode: "one_line_title_only",
      structured_fields_visible: true
    },
    title_stage_reason: "Unique exact-anchor catalog identity finalized in the L1 window; background L2 continues as verification and overwrites on completion.",
    l1_return_reason: "exact_anchor_catalog_internal_scout",
    title_stage_readiness: {
      ...(response.title_stage_readiness || {}),
      writer_safe_ready: true,
      writer_visible_title_ready: true,
      internal_scout_ready: true
    },
    l1_internal_scout: scout,
    legacy_v2_result: hideTitleFields(response.legacy_v2_result || result || {})
  });
}

function resolvedFromResult(result = {}) {
  return result.resolved_fields || result.fields || result.resolved || {};
}

function resolvedHintHasValue(value) {
  if (Array.isArray(value)) return value.some(resolvedHintHasValue);
  if (value && typeof value === "object") return Object.values(value).some(resolvedHintHasValue);
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function mergeResolvedHintObjects(...hints) {
  const merged = {};
  for (const hint of hints) {
    if (!hint || typeof hint !== "object" || Array.isArray(hint)) continue;
    for (const [key, value] of Object.entries(hint)) {
      if (!resolvedHintHasValue(value)) continue;
      merged[key] = value;
    }
  }
  return merged;
}

export function backgroundPayloadWithL1ResolvedHint(payload = {}, l1Result = null) {
  const l1Resolved = resolvedFromResult(l1Result || {});
  if (!resolvedHintHasValue(l1Resolved)) return payload;
  const existingHint = mergeResolvedHintObjects(
    payload.resolved || {},
    payload.resolvedHint || {},
    payload.resolved_hint || {}
  );
  const mergedHint = mergeResolvedHintObjects(existingHint, l1Resolved);
  if (!resolvedHintHasValue(mergedHint)) return payload;
  return {
    ...payload,
    resolvedHint: mergedHint,
    resolved_hint: mergedHint,
    l1_fast_scout_resolved_hint: mergedHint,
    l1_fast_scout_title_hint: titleFromResult(l1Result || {}) || "",
    l1_fast_scout_unresolved_hint: Array.isArray(l1Result?.unresolved) ? l1Result.unresolved : [],
    l1_fast_scout_resolved_hint_source: "v4_fast_scout_l1"
  };
}

function catalogPromptCountFromTrace(trace = {}) {
  return Number(trace.catalog_activation_funnel?.prompt_candidate_count || 0);
}

function catalogGapTypeFromTrace(trace = {}) {
  const catalog = trace.catalog_activation_funnel || {};
  const vector = trace.vector_activation_funnel || {};
  const rawCount = Number(catalog.raw_candidate_count || 0) + Number(vector.raw_candidate_count || 0);
  const promptCount = Number(catalog.prompt_candidate_count || 0) + Number(vector.prompt_candidate_count || 0);
  const blockedCount = Number(catalog.conflict_blocked_count || 0) + Number(vector.conflict_blocked_count || 0);
  if (promptCount > 0) return "";
  if (rawCount <= 0) return "CATALOG_COVERAGE_GAP";
  if (blockedCount > 0) return "CANDIDATE_CONFLICT_BLOCKED_GAP";
  return "NO_PROMPT_SAFE_CANDIDATE_GAP";
}

function providerRuntimeSummary(result = {}) {
  const vectorContext = result.candidate_context?.vector || {};
  const vectorProviderMetadata = vectorContext.provider_metadata || {};
  return {
    model: result.model || result.model_id || null,
    provider_latency_ms: result.provider_latency_ms ?? null,
    provider_response_profile: result.provider_response_profile || "standard",
    provider_prompt_mode: result.provider_prompt_mode || null,
    provider_prompt_chars: Number.isFinite(Number(result.provider_prompt_chars)) ? Number(result.provider_prompt_chars) : null,
    provider_text_verbosity: result.provider_text_verbosity || null,
    provider_requested_service_tier: result.provider_requested_service_tier || null,
    provider_service_tier: result.provider_service_tier || null,
    identity_cache_hit: result.identity_cache?.cache_hit === true,
    identity_cache_read_bypassed: result.identity_cache?.read_bypassed === true,
    identity_cache_write_reason: result.identity_cache?.write_reason || null,
    provider_input_image_count: Number.isFinite(Number(result.provider_input_image_count)) ? Number(result.provider_input_image_count) : null,
    provider_image_detail: result.provider_image_detail || null,
    provider_finish_reason: result.provider_finish_reason || null,
    provider_token_diagnostics: result.provider_token_diagnostics || null,
    provider_initial_token_diagnostics: result.provider_initial_token_diagnostics || null,
    provider_rate_limit_diagnostics: result.provider_rate_limit_diagnostics || null,
    provider_initial_rate_limit_diagnostics: result.provider_initial_rate_limit_diagnostics || null,
    provider_request_diagnostics: result.provider_request_diagnostics || null,
    provider_initial_request_diagnostics: result.provider_initial_request_diagnostics || null,
    provider_key_pool_size: Number(result.provider_key_pool_size || 0) || null,
    provider_key_slot: Number(result.provider_key_slot || 0) || null,
    provider_key_source: result.provider_key_source || null,
    provider_key_rotation_attempted: result.provider_key_rotation_attempted === true,
    provider_key_rotation_attempts: Number(result.provider_key_rotation_attempts || 0),
    provider_capacity_stage_handoff: result.provider_capacity_stage_handoff || null,
    provider_truncation_retry_attempted: result.provider_truncation_retry_attempted === true,
    provider_truncation_retry_attempts: Number(result.provider_truncation_retry_attempts || 0),
    gpt5_empty_result_retry_attempted: result.gpt5_empty_result_retry_attempted === true,
    gpt5_empty_result_retry_success: result.gpt5_empty_result_retry_success === true,
    gpt5_empty_result_retry_status_code: result.gpt5_empty_result_retry_status_code ?? null,
    gpt5_empty_result_retry_key_slot: Number(result.gpt5_empty_result_retry_key_slot || 0) || null,
    failure_reason: isFailedResult(result)
      ? String(result.reason || result.provider_error_type || result.provider_error_code || "recognition_result_empty").slice(0, 500)
      : null,
    vector_runtime_status: vectorContext.signal?.status || vectorContext.status || null,
    vector_runtime_status_code: vectorContext.signal?.status_code || null,
    vector_runtime_unavailable_reasons: vectorContext.signal?.unavailable_reasons || [],
    vector_worker_status: vectorContext.worker_status || null,
    vector_worker_reason: vectorContext.worker_reason || "",
    vector_worker_feature_count: vectorContext.worker_feature_count ?? null,
    vector_worker_latency_ms: vectorContext.worker_latency_ms ?? null,
    vector_worker_attempt_count: vectorContext.worker_attempt_count ?? null,
    catalog_stage_capacity: result.catalog_stage_capacity || null,
    vector_stage_capacity: result.vector_worker?.stage_capacity
      || vectorContext.stage_capacity
      || null,
    vector_query_embedding_role: vectorProviderMetadata.query_embedding_role || "",
    vector_role_agnostic_fallback_used: vectorProviderMetadata.role_agnostic_fallback_used === true,
    vector_role_agnostic_fallback_reason: vectorProviderMetadata.role_agnostic_fallback_reason || "",
    vector_returned_row_count: Number.isFinite(Number(vectorProviderMetadata.returned_row_count))
      ? Number(vectorProviderMetadata.returned_row_count)
      : null,
    vector_self_excluded_count: Number.isFinite(Number(vectorProviderMetadata.self_excluded_count))
      ? Number(vectorProviderMetadata.self_excluded_count)
      : null,
    preingestion_ocr_rendezvous: result.preingestion_ocr_rendezvous || null,
    preingestion_evidence_refresh: result.preingestion_evidence_refresh || null,
    preingestion_retrieval_refresh: result.preingestion_retrieval_refresh || null,
    preingestion_retrieval_anchor_fields: Array.isArray(result.preingestion_retrieval_anchor_fields)
      ? result.preingestion_retrieval_anchor_fields
      : [],
    serial_numerator_verified: result.serial_numerator_verified ?? null,
    pipeline_node_ledger: result.pipeline_node_ledger || null,
    v4_pipeline_contract: result.v4_pipeline_contract || null,
    title_length_policy: result.title_length_policy || null,
    title_render_source: result.title_render_source || null,
    model_title_suggestion: result.model_title_suggestion || null,
    title_reconciled_from_v4_field_graph: result.title_reconciled_from_v4_field_graph === true,
    title_reconciliation_reasons: Array.isArray(result.title_reconciliation_reasons)
      ? result.title_reconciliation_reasons
      : [],
    usage: result.usage || null
  };
}

function scheduleV4Background(promise, label = "background task") {
  const guarded = Promise.resolve(promise).catch((error) => {
    console.error(`[v4-listing] ${label} failed`, error);
  });
  if (typeof waitUntil === "function") waitUntil(guarded);
  return guarded;
}

function nonCriticalPersistenceDeferred(payload = {}, env = process.env) {
  if (payload.v4_defer_noncritical_persistence === false || payload.defer_noncritical_persistence === false) return false;
  return String(env.ENABLE_V4_DEFER_NONCRITICAL_PERSISTENCE || "true").toLowerCase() !== "false";
}

function atomicWriterReadyCapacityReleaseEnabled(payload = {}, env = process.env) {
  if (!payload.v4_queue_job_id) return false;
  if (payload.v4_atomic_writer_ready_capacity_release === false) return false;
  return String(env.ENABLE_V4_ATOMIC_WRITER_READY_CAPACITY_RELEASE || "true").toLowerCase() !== "false";
}

function deferredArtifact(reason = "writer_ready_first") {
  return { saved: false, deferred: true, reason };
}

function summarizeNonCriticalPersistence(persistence = {}) {
  const artifactNames = ["field_evidence", "candidate_trace", "catalog_gap", "quality_ledger"];
  const artifacts = Object.fromEntries(artifactNames.map((name) => {
    const value = persistence[name] || {};
    const status = value.saved === true
      ? "SAVED"
      : value.skipped === true
        ? "SKIPPED"
        : value.deferred === true
          ? "DEFERRED"
          : "FAILED";
    return [name, {
      status,
      reason: value.reason || (status === "FAILED" ? value.error || "persistence_failed" : null),
      persistence_mode: value.persistence_mode || null,
      write_attempts: Number(value.write_attempts || 0) || null
    }];
  }));
  const failed = Object.values(artifacts).filter((item) => item.status === "FAILED").length;
  const saved = Object.values(artifacts).filter((item) => item.status === "SAVED").length;
  return {
    status: failed > 0 ? "PARTIAL" : "COMPLETED",
    saved_count: saved,
    failed_count: failed,
    artifact_count: artifactNames.length,
    artifacts,
    latency_ms: Number(persistence.noncritical_persistence_latency_ms || 0) || null
  };
}

async function persistCatalogGapForRows({
  sessionId,
  result = {},
  payload = {},
  rows = {},
  l1Stage = false,
  catalogPromptCount = 0
} = {}) {
  if (l1Stage) return { saved: false, skipped: true, reason: "internal_scout_not_catalog_gap" };
  if (Number(catalogPromptCount || 0) > 0) {
    return { saved: false, skipped: true, reason: "catalog_prompt_candidate_available" };
  }
  return persistV4CatalogGap({
    gap: {
      recognition_session_id: sessionId,
      asset_id: payload.asset_id || payload.assetId || null,
      gap_type: catalogGapTypeFromTrace(rows.candidateTrace),
      observed_fields: resolvedFromResult(result),
      candidate_snapshot: {
        candidate_activation_funnel: rows.candidateTrace.candidate_activation_funnel,
        catalog_activation_funnel: rows.candidateTrace.catalog_activation_funnel,
        vector_activation_funnel: rows.candidateTrace.vector_activation_funnel,
        low_margin_safe_field_application: rows.candidateTrace.low_margin_safe_field_application || null,
        selected_candidate_safe_field_application: rows.candidateTrace.selected_candidate_safe_field_application || null,
        selected_candidate_verifier: rows.candidateTrace.selected_candidate_verifier || null
      },
      draft_title: titleFromResult(result)
    }
  });
}

async function persistV4NonCriticalArtifacts({
  sessionId,
  result = {},
  payload = {},
  routePlan = {},
  createResult = {},
  rows = {},
  status = v4SessionStatuses.DRAFT_READY,
  catalogPromptCount = 0,
  l1Stage = false
} = {}) {
  const startedAt = Date.now();
  const catalogGapInput = l1Stage || Number(catalogPromptCount || 0) > 0
    ? null
    : {
      recognition_session_id: sessionId,
      asset_id: payload.asset_id || payload.assetId || null,
      gap_type: catalogGapTypeFromTrace(rows.candidateTrace),
      observed_fields: resolvedFromResult(result),
      candidate_snapshot: {
        candidate_activation_funnel: rows.candidateTrace.candidate_activation_funnel,
        catalog_activation_funnel: rows.candidateTrace.catalog_activation_funnel,
        vector_activation_funnel: rows.candidateTrace.vector_activation_funnel,
        low_margin_safe_field_application: rows.candidateTrace.low_margin_safe_field_application || null,
        selected_candidate_safe_field_application: rows.candidateTrace.selected_candidate_safe_field_application || null,
        selected_candidate_verifier: rows.candidateTrace.selected_candidate_verifier || null
      },
      draft_title: titleFromResult(result)
    };
  const atomicPersistencePlan = {
    create_session: createResult.persistence?.recognition_session || createResult.persistence || null,
    update_session: deferredArtifact("already_updated_writer_ready_session"),
    field_evidence: deferredArtifact("atomic_noncritical_rpc"),
    candidate_trace: deferredArtifact("atomic_noncritical_rpc"),
    catalog_gap: catalogGapInput
      ? deferredArtifact("atomic_noncritical_rpc")
      : { saved: false, skipped: true, reason: l1Stage ? "internal_scout_not_catalog_gap" : "catalog_prompt_candidate_available" },
    quality_ledger: deferredArtifact("atomic_noncritical_rpc")
  };
  const atomicQualityLedger = {
    ...adaptV2ResultToV4({
      sessionId,
      result,
      payload,
      routePlan,
      persistence: atomicPersistencePlan
    }).provider_result,
    id: `${sessionId}_quality`,
    recognition_session_id: sessionId,
    route: routePlan.route,
    status,
    route_plan: routePlan,
    persistence_summary: {
      mode: "atomic_noncritical_rpc",
      field_evidence_count: rows.fieldEvidenceRows.length,
      catalog_gap_expected: Boolean(catalogGapInput)
    }
  };
  const atomic = await persistV4NonCriticalArtifactsAtomic({
    sessionId,
    fieldEvidenceRows: rows.fieldEvidenceRows,
    candidateTrace: rows.candidateTrace,
    catalogGap: catalogGapInput,
    qualityLedger: atomicQualityLedger
  });
  if (atomic.saved) {
    return {
      create_session: atomicPersistencePlan.create_session,
      update_session: atomicPersistencePlan.update_session,
      field_evidence: {
        saved: true,
        row_count: Number(atomic.transaction?.field_evidence_count || 0),
        write_attempts: atomic.write_attempts,
        persistence_mode: "atomic_noncritical_rpc"
      },
      candidate_trace: {
        saved: atomic.transaction?.candidate_trace_saved === true,
        write_attempts: atomic.write_attempts,
        persistence_mode: "atomic_noncritical_rpc"
      },
      catalog_gap: catalogGapInput
        ? {
          saved: atomic.transaction?.catalog_gap_saved === true,
          write_attempts: atomic.write_attempts,
          persistence_mode: "atomic_noncritical_rpc"
        }
        : atomicPersistencePlan.catalog_gap,
      quality_ledger: {
        saved: atomic.transaction?.quality_ledger_saved === true,
        write_attempts: atomic.write_attempts,
        persistence_mode: "atomic_noncritical_rpc"
      },
      atomic_persistence: atomic,
      noncritical_persistence_latency_ms: Date.now() - startedAt
    };
  }

  // Compatibility fallback keeps the writer loop durable during a rolling
  // deploy or a temporary RPC outage. The writes use return=minimal and the
  // same deterministic ids, so replaying after an ambiguous timeout is safe.
  const [fieldEvidence, candidateTrace, catalogGap] = await Promise.all([
    persistV4FieldEvidence({ sessionId, rows: rows.fieldEvidenceRows }),
    persistV4CandidateTrace({ sessionId, trace: rows.candidateTrace }),
    persistCatalogGapForRows({ sessionId, result, payload, rows, catalogPromptCount })
  ]);
  const partialPersistence = {
    create_session: createResult.persistence?.recognition_session || createResult.persistence || null,
    update_session: deferredArtifact("already_updated_writer_ready_session"),
    field_evidence: fieldEvidence,
    candidate_trace: candidateTrace,
    catalog_gap: catalogGap
  };
  const ledger = await persistV4QualityLedger({
    ledger: {
      ...adaptV2ResultToV4({
        sessionId,
        result,
        payload,
        routePlan,
        persistence: partialPersistence
      }).provider_result,
      id: `${sessionId}_quality`,
      recognition_session_id: sessionId,
      route: routePlan.route,
      status,
      route_plan: routePlan,
      persistence_summary: {
        ...partialPersistence,
        noncritical_persistence_latency_ms: Date.now() - startedAt
      }
    }
  });
  return {
    ...partialPersistence,
    quality_ledger: ledger,
    atomic_persistence: atomic,
    noncritical_persistence_latency_ms: Date.now() - startedAt
  };
}

const l1ReturnBarrierVersion = "v4_l1_return_barrier_2026_07_07";
const l1BlockingModules = Object.freeze([
  "image_access_signed_read_url",
  "fast_scout_or_cached_fast_scout",
  "minimal_resolver_safety_check",
  "deterministic_renderer"
]);
const l1DeferredModules = Object.freeze([
  "recognition_session_persistence",
  "field_evidence_persistence",
  "candidate_trace_persistence",
  "production_quality_ledger",
  "catalog_gap_queue",
  "workflow_sidecars",
  "l2_assisted_draft",
  "vector_retrieval",
  "external_retrieval",
  "full_evidence_persistence"
]);

function addL1ReturnBarrierMetadata(response = {}, fastScout = {}) {
  return withV4Version({
    ...response,
    l1_return_barrier_version: l1ReturnBarrierVersion,
    l1_blocking_modules: [...l1BlockingModules],
    l1_deferred_modules: [...l1DeferredModules],
    deferred_persistence_status: "SCHEDULED",
    l2_background_status: "SCHEDULED",
    time_after_l1_spent_on_persistence_ms: null,
    fast_scout_cache_hit: Boolean(fastScout.cache_hit),
    fast_scout_cache_status: fastScout.cache_status || (fastScout.cache_hit ? "HIT" : "MISS"),
    fast_scout_prewarmer_used: Boolean(fastScout.prewarmer_used),
    fast_scout_blocking_call_used: fastScout.blocking_call_used !== false
  });
}

function canReturnFastScoutL1(payload = {}, env = process.env) {
  const explicitExperiment = payload.v4_force_fast_scout_l1 === true || payload.v4_queue_l1_only === true;
  if (!explicitExperiment && String(env.ENABLE_V4_FAST_SCOUT_L1 || "false").toLowerCase() !== "true") return false;
  if (payload.v4_worker_synchronous === true || payload.v4_force_l2_direct === true || payload.disable_fast_scout_l1 === true) return false;
  if (shouldSkipFastScoutForRequestedModel(payload, env)) return false;
  return Array.isArray(payload.images) && payload.images.length > 0;
}

function requestedListingModelFromPayload(payload = {}, env = process.env) {
  const providerOptions = payload.provider_options || payload.providerOptions || {};
  return providerModelOverrideFromOptions(providerOptions)
    || payload.openai_listing_model_override
    || payload.openaiListingModelOverride
    || payload.openai_model_override
    || payload.model_override
    || payload.modelOverride
    || payload.model
    || env.OPENAI_LISTING_MODEL
    || "";
}

function shouldSkipFastScoutForRequestedModel(payload = {}, env = process.env) {
  const requestedListingModel = requestedListingModelFromPayload(payload, env);
  return isGpt5ResponsesModel(requestedListingModel)
    && String(env.DISABLE_GPT5_FAST_SCOUT_L1 || "false").toLowerCase() === "true"
    && payload.v4_queue_l1_only !== true;
}

function l2ExactAnchorBlockingScoutAllowed(payload = {}, env = process.env) {
  const explicit = payload.v4_l2_exact_anchor_allow_blocking_scout
    ?? payload.l2_exact_anchor_allow_blocking_scout
    ?? payload.provider_options?.v4_l2_exact_anchor_allow_blocking_scout
    ?? payload.providerOptions?.v4_l2_exact_anchor_allow_blocking_scout;
  if (explicit !== undefined && explicit !== null && explicit !== "") {
    return String(explicit).toLowerCase() === "true" || explicit === true;
  }
  return String(env.ENABLE_V4_L2_EXACT_ANCHOR_BLOCKING_SCOUT || "false").toLowerCase() === "true";
}

function l2TimingWithTotal(timing = {}, startedAt = Date.now()) {
  return {
    ...timing,
    handler_total_ms: Date.now() - startedAt
  };
}

function queueL1Only(payload = {}) {
  return payload.v4_queue_l1_only === true || payload.v4_queue_job_type === "FAST_SCOUT_DRAFT";
}

function openAiRequestContextFromV4Payload(payload = {}, {
  providerCallPurpose = "fast_scout",
  titleStage = ""
} = {}) {
  return {
    job_id: payload.v4_queue_job_id || payload.job_id || payload.jobId || "",
    job_type: payload.v4_queue_job_type || payload.job_type || "",
    lane: payload.v4_queue_lane || payload.lane || "",
    recognition_session_id: payload.recognition_session_id || "",
    asset_id: payload.asset_id || payload.assetId || "",
    worker_id: payload.worker_id || payload.workerId || "",
    title_stage: titleStage || payload.v4_title_stage_target || "",
    provider_call_purpose: providerCallPurpose,
    v4_force_l2_direct: payload.v4_force_l2_direct === true,
    disable_fast_scout_l1: payload.disable_fast_scout_l1 === true,
    v4_queue_l1_only: payload.v4_queue_l1_only === true
  };
}

function recognitionPayloadFor({
  payload = {},
  sessionId,
  routePlan,
  providerOptions = {},
  titleStageTarget = v4TitleStages.L1_INTERNAL_SCOUT
} = {}) {
  return {
    ...payload,
    provider: payload.provider || "openai_legacy",
    provider_id: payload.provider_id || payload.provider || "openai_legacy",
    vision_provider: payload.vision_provider || payload.visionProvider || payload.provider_id || payload.provider || "openai_legacy",
    provider_options: providerOptions,
    providerOptions: providerOptions,
    recognition_session_id: sessionId,
    v4_request: true,
    v4_route_plan: routePlan,
    v4_title_stage_target: titleStageTarget
  };
}

async function persistPipelineResult({
  sessionId,
  result = {},
  payload = {},
  routePlan = {},
  createResult = {},
  extraProviderSummary = {},
  requestContext = null
} = {}) {
  result = prepareV4PresentationResult({ result, payload }).result;
  result.v4_pipeline_contract = buildV4PipelineContract({
    payload,
    routePlan,
    result
  });
  const l1Stage = result.title_stage === v4TitleStages.L1_INTERNAL_SCOUT;
  const rows = buildV4PersistenceRows({ sessionId, result, payload });
  const catalogPromptCount = catalogPromptCountFromTrace(rows.candidateTrace);
  if (l1Stage) {
    const fieldEvidence = await persistV4FieldEvidence({ sessionId, rows: rows.fieldEvidenceRows });
    const candidateTrace = await persistV4CandidateTrace({ sessionId, trace: rows.candidateTrace });
    const catalogGap = await persistCatalogGapForRows({
      sessionId,
      result,
      payload,
      rows,
      l1Stage,
      catalogPromptCount
    });
    const l1Title = titleFromResult(result);
    const sessionUpdate = await updateV4RecognitionSession({
      sessionId,
      patch: {
        status: v4SessionStatuses.OBSERVING,
        l1_status: l1Title ? "READY" : "FAILED",
        l1_title: l1Title || null,
        l1_ready_at: new Date().toISOString(),
        l1_route: routePlan.route || null,
        l1_timing: result.timing || result.timings || {},
        field_states: rows.fieldEvidenceRows,
        route: routePlan.route,
        route_plan: routePlan,
        candidate_control_plane_trace: rows.candidateTrace,
        provider_result_summary: {
          provider: result.provider || result.provider_id || null,
          confidence: result.confidence || null,
          title_stage: result.title_stage || null,
          assisted_draft_status: "PENDING",
          l1_already_returned: true,
          l1_visible_to_writer: false,
          l1_return_barrier_version: l1ReturnBarrierVersion,
          ...providerRuntimeSummary(result),
          ...extraProviderSummary
        },
        resolved_fields: resolvedFromResult(result)
      }
    });
    const persistence = {
      create_session: createResult.persistence?.recognition_session || createResult.persistence || null,
      update_session: sessionUpdate,
      field_evidence: fieldEvidence,
      candidate_trace: candidateTrace,
      catalog_gap: catalogGap,
      quality_ledger: { saved: false, skipped: true, reason: "internal_scout_not_production_quality" }
    };
    return adaptV2ResultToV4({
      sessionId,
      result,
      payload,
      routePlan,
      persistence
    });
  }
  const l2Title = titleFromResult(result);
  const outcome = classifyV4ResultOutcome(result);
  const failed = outcome.technical_failure;
  const writerReviewRequired = outcome.writer_review_required;
  const status = failed
    ? v4SessionStatuses.FAILED
    : writerReviewRequired
      ? v4SessionStatuses.WRITER_REVIEW
      : v4SessionStatuses.DRAFT_READY;
  const assistedDraftStatus = failed
    ? "FAILED"
    : writerReviewRequired
      ? "REVIEW_REQUIRED"
      : (result.assisted_draft_status || extraProviderSummary.assisted_draft_status || "READY");
  const deferNonCriticalPersistence = nonCriticalPersistenceDeferred(payload, process.env);
  const sessionPatch = {
    status,
    failure_reason: failed
      ? String(result.reason || result.provider_error_type || result.provider_error_code || "recognition_result_empty").slice(0, 500)
      : null,
    field_states: rows.fieldEvidenceRows,
    route: routePlan.route,
    route_plan: routePlan,
    candidate_control_plane_trace: rows.candidateTrace,
    provider_result_summary: {
      provider: result.provider || result.provider_id || null,
      confidence: result.confidence || null,
      title_stage: result.title_stage || null,
      assisted_draft_status: assistedDraftStatus,
      outcome_type: outcome.outcome,
      writer_review_required: writerReviewRequired,
      writer_review_reason: writerReviewRequired
        ? String(result.reason || "Identity could not be resolved from grounded evidence.").slice(0, 500)
        : null,
      provider_error_type: result.provider_error_type || result.provider_error_code || null,
      noncritical_persistence_status: deferNonCriticalPersistence ? "DEFERRED" : "SYNC",
      writer_ready_persistence_mode: deferNonCriticalPersistence ? "minimal_session_first" : "synchronous_full_persistence",
      ...providerRuntimeSummary(result),
      ...extraProviderSummary
    }
  };
  if (failed) {
    sessionPatch.provider_result_summary.assisted_draft_status = "FAILED";
  }
  sessionPatch.final_title = l2Title;
  sessionPatch.l2_status = status === v4SessionStatuses.FAILED ? "FAILED" : "READY";
  sessionPatch.l2_title = l2Title;
  sessionPatch.l2_ready_at = new Date().toISOString();
  sessionPatch.l2_route = routePlan.route || null;
  sessionPatch.l2_timing = result.timing || result.timings || {};
  sessionPatch.resolved_fields = resolvedFromResult(result);
  const providerStageHandoff = result.provider_capacity_stage_handoff || {};
  const providerStageReleased = providerStageHandoff.released === true;
  const atomicCapacityReleaseEnabled = !providerStageReleased
    && atomicWriterReadyCapacityReleaseEnabled(payload, process.env);
  sessionPatch.provider_result_summary.writer_ready_capacity_release_mode = providerStageReleased
    ? "provider_done"
    : atomicCapacityReleaseEnabled
      ? "writer_ready_atomic"
      : "worker_tail";
  let writerReadyCapacityRelease;
  let writerReadyCapacityRefill;
  let sessionUpdate;
  if (providerStageReleased) {
    writerReadyCapacityRefill = providerStageHandoff.refill?.triggered === true
      ? providerStageHandoff.refill
      : triggerWriterReadyCapacityRefill(requestContext, {
        payload,
        capacityRelease: providerStageHandoff
      });
    sessionPatch.provider_result_summary.writer_ready_capacity_refill = writerReadyCapacityRefill;
    sessionUpdate = await updateV4RecognitionSessionWithRetry({ sessionId, patch: sessionPatch });
    writerReadyCapacityRelease = {
      ...providerStageHandoff,
      saved: sessionUpdate.saved === true,
      already_released_at_provider_done: true,
      release_boundary: "provider_done",
      persistence_mode: "provider_done_capacity_handoff"
    };
  } else {
    writerReadyCapacityRelease = atomicCapacityReleaseEnabled
      ? await persistV4WriterReadyAndReleaseCapacity({
        sessionId,
        patch: sessionPatch,
        jobId: payload.v4_queue_job_id,
        workerId: payload.v4_queue_worker_id || null
      })
      : {
        saved: false,
        released: false,
        skipped: true,
        reason: payload.v4_queue_job_id ? "atomic_writer_ready_capacity_release_disabled" : "not_queue_job",
        release_boundary: "worker_tail"
      };
    if (writerReadyCapacityRelease.saved === true) {
      sessionUpdate = {
        saved: true,
        row: null,
        error: null,
        persistence_mode: "writer_ready_capacity_atomic_rpc",
        sanitized_nul_byte_count: writerReadyCapacityRelease.sanitized_nul_byte_count || 0
      };
    } else {
      if (atomicCapacityReleaseEnabled) {
        sessionPatch.provider_result_summary.writer_ready_capacity_release_mode = "worker_tail_fallback";
        sessionPatch.provider_result_summary.writer_ready_capacity_release_error = String(
          writerReadyCapacityRelease.error || "atomic_writer_ready_capacity_release_failed"
        ).slice(0, 160);
      }
      sessionUpdate = await updateV4RecognitionSession({ sessionId, patch: sessionPatch });
      writerReadyCapacityRelease = {
        ...writerReadyCapacityRelease,
        released: false,
        fallback_required: true,
        release_boundary: "worker_tail_fallback"
      };
    }
    writerReadyCapacityRefill = triggerWriterReadyCapacityRefill(requestContext, {
      payload,
      capacityRelease: writerReadyCapacityRelease
    });
  }
  sessionPatch.provider_result_summary.writer_ready_capacity_refill = writerReadyCapacityRefill;
  if (deferNonCriticalPersistence) {
    const persistence = {
      create_session: createResult.persistence?.recognition_session || createResult.persistence || null,
      update_session: sessionUpdate,
      writer_ready_provider_capacity_release: writerReadyCapacityRelease,
      writer_ready_provider_capacity_refill: writerReadyCapacityRefill,
      field_evidence: deferredArtifact("writer_ready_first"),
      candidate_trace: deferredArtifact("writer_ready_first"),
      catalog_gap: deferredArtifact("writer_ready_first"),
      quality_ledger: deferredArtifact("writer_ready_first")
    };
    const backgroundPersistence = persistV4NonCriticalArtifacts({
      sessionId,
      result,
      payload,
      routePlan,
      createResult,
      rows,
      status,
      catalogPromptCount
    }).then(async (completedPersistence) => {
      const persistenceSummary = summarizeNonCriticalPersistence(completedPersistence);
      const terminalUpdate = await updateV4RecognitionSessionWithRetry({
        sessionId,
        patch: {
          provider_result_summary: {
            ...sessionPatch.provider_result_summary,
            noncritical_persistence_status: persistenceSummary.status,
            noncritical_persistence_summary: persistenceSummary
          }
        }
      });
      if (!terminalUpdate.saved) {
        throw Object.assign(new Error(`noncritical_persistence_status_write_failed:${terminalUpdate.error || "unknown_error"}`), {
          code: "NONCRITICAL_PERSISTENCE_STATUS_WRITE_FAILED"
        });
      }
      return completedPersistence;
    }).catch(async (error) => {
      await updateV4RecognitionSessionWithRetry({
        sessionId,
        patch: {
          provider_result_summary: {
            ...sessionPatch.provider_result_summary,
            noncritical_persistence_status: "FAILED",
            noncritical_persistence_summary: {
              status: "FAILED",
              saved_count: 0,
              failed_count: 4,
              artifact_count: 4,
              reason: String(error?.code || error?.name || "background_persistence_failed").slice(0, 120)
            }
          }
        }
      }).catch((statusError) => {
        console.error("[v4_noncritical_persistence_failure_status_write_failed]", JSON.stringify({
          recognition_session_id: sessionId,
          persistence_error: String(error?.code || error?.name || "background_persistence_failed").slice(0, 120),
          status_write_error: String(statusError?.message || statusError || "status_write_failed").slice(0, 240)
        }));
      });
      throw error;
    });
    scheduleV4Background(backgroundPersistence, "V4 non-critical persistence");
    return adaptV2ResultToV4({
      sessionId,
      result,
      payload,
      routePlan,
      persistence
    });
  }

  const fieldEvidence = await persistV4FieldEvidence({ sessionId, rows: rows.fieldEvidenceRows });
  const candidateTrace = await persistV4CandidateTrace({ sessionId, trace: rows.candidateTrace });
  const catalogGap = await persistCatalogGapForRows({
    sessionId,
    result,
    payload,
    rows,
    catalogPromptCount
  });
  const partialPersistence = {
    create_session: createResult.persistence?.recognition_session || createResult.persistence || null,
    update_session: sessionUpdate,
    writer_ready_provider_capacity_release: writerReadyCapacityRelease,
    writer_ready_provider_capacity_refill: writerReadyCapacityRefill,
    field_evidence: fieldEvidence,
    candidate_trace: candidateTrace,
    catalog_gap: catalogGap
  };
  const ledger = await persistV4QualityLedger({
    ledger: {
      ...adaptV2ResultToV4({
        sessionId,
        result,
        payload,
        routePlan,
        persistence: partialPersistence
      }).provider_result,
      id: `${sessionId}_quality`,
      recognition_session_id: sessionId,
      route: routePlan.route,
      status,
      route_plan: routePlan,
      persistence_summary: partialPersistence
    }
  });
  const persistence = { ...partialPersistence, quality_ledger: ledger };
  const persistenceSummary = summarizeNonCriticalPersistence(persistence);
  const terminalUpdate = await updateV4RecognitionSessionWithRetry({
    sessionId,
    patch: {
      provider_result_summary: {
        ...sessionPatch.provider_result_summary,
        noncritical_persistence_status: persistenceSummary.status,
        noncritical_persistence_summary: persistenceSummary
      }
    }
  });
  if (!terminalUpdate.saved) {
    persistence.terminal_status_write = {
      saved: false,
      error: terminalUpdate.error || "noncritical_persistence_status_write_failed",
      write_attempts: terminalUpdate.write_attempts || 0
    };
  }
  return adaptV2ResultToV4({
    sessionId,
    result,
    payload,
    routePlan,
    persistence
  });
}

async function runBackgroundAssistedDraft({
  sessionId,
  payload = {},
  l1Result = null,
  routePlan = {},
  headers = {},
  createResult = {}
} = {}) {
  await updateV4RecognitionSession({
    sessionId,
    patch: {
      provider_result_summary: {
        assisted_draft_status: "RUNNING",
        l1_already_returned: true
      }
    }
  });
  const l2Payload = backgroundPayloadWithL1ResolvedHint(payload, l1Result);
  const providerOptions = providerOptionsForV4BackgroundL2({ payload: l2Payload, routePlan });
  const recognitionPayload = recognitionPayloadFor({
    payload: l2Payload,
    sessionId,
    routePlan,
    providerOptions,
    titleStageTarget: v4TitleStages.L2_ASSISTED_DRAFT
  });
  const recognitionClockStartedAt = new Date().toISOString();
  const recognitionResponse = await callRecognitionCoreWithGpt5EmptyRetry({
    headers,
    payload: recognitionPayload
  });
  if (recognitionResponse.statusCode < 200 || recognitionResponse.statusCode >= 300 || !recognitionResponse.body) {
    await updateV4RecognitionSession({
      sessionId,
      patch: {
        provider_result_summary: {
          assisted_draft_status: "FAILED",
          failure_reason: `recognition_core_failed_${recognitionResponse.statusCode}`,
          l1_already_returned: true
        }
      }
    });
    return null;
  }
  const result = {
    ...recognitionResponse.body,
    title_stage: v4TitleStages.L2_ASSISTED_DRAFT,
    l1_return_reason: "background_assisted_draft_ready",
    full_assist_continued_after_l1: false
  };
  const outcome = classifyV4ResultOutcome(result);
  result.assisted_draft_status = outcome.technical_failure
    ? "FAILED"
    : outcome.writer_review_required
      ? "REVIEW_REQUIRED"
      : "READY";
  return persistPipelineResult({
    sessionId,
    result,
    payload: recognitionPayload,
    routePlan,
    createResult,
    extraProviderSummary: {
      assisted_draft_status: result.assisted_draft_status,
      recognition_clock_started_at: recognitionClockStartedAt,
      recognition_clock_source: "gpt_provider_request"
    },
    requestContext: { headers }
  });
}

async function callRecognitionCoreWithGpt5EmptyRetry({
  headers = {},
  payload = {}
} = {}) {
  let coreResponse = await runListingRecognitionCore({
    payload,
    requestContext: { headers }
  });

  if (coreResponse.statusCode < 200 || coreResponse.statusCode >= 300 || !coreResponse.body
    || !shouldRetryGpt5EmptyResult({ payload, result: coreResponse.body, env: process.env })) {
    return coreResponse;
  }

  const retryPayload = {
    ...payload,
    v4_gpt5_empty_result_retry_attempted: true,
    provider_options: {
      ...(payload.provider_options || {}),
      gpt5_empty_result_retry: true
    },
    providerOptions: {
      ...(payload.providerOptions || {}),
      gpt5_empty_result_retry: true
    }
  };
  const retryKeySlot = alternateOpenAiKeySlot(payload, process.env);
  if (retryKeySlot) {
    retryPayload.openai_preferred_key_slot = retryKeySlot;
    retryPayload.provider_key_slot_hint = retryKeySlot;
  }
  const retryResponse = await runListingRecognitionCore({
    payload: retryPayload,
    requestContext: { headers }
  });
  const retryPrepared = retryResponse.statusCode >= 200 && retryResponse.statusCode < 300 && retryResponse.body
    ? prepareV4PresentationResult({ result: retryResponse.body, payload: retryPayload })
    : { finalTitle: "" };
  const retrySucceeded = Boolean(retryPrepared.finalTitle);
  if (retrySucceeded) {
    return {
      ...retryResponse,
      body: withGpt5EmptyRetryMetadata(retryPrepared.result, {
        attempted: true,
        success: true,
        retryStatusCode: retryResponse.statusCode || null,
        retryKeySlot
      })
    };
  }

  return {
    ...coreResponse,
    body: withGpt5EmptyRetryMetadata(coreResponse.body, {
      attempted: true,
      success: false,
      retryStatusCode: retryResponse.statusCode || null,
      retryKeySlot
    })
  };
}

function buildFastScoutPendingFailureResponse({
  sessionId,
  routePlan = {},
  createResult = {},
  error
} = {}) {
  return withV4Version({
    ok: false,
    recognition_session_id: sessionId,
    status: v4SessionStatuses.OBSERVING,
    route_plan: routePlan,
    title_stage: v4TitleStages.L0_INSTANT_SKELETON,
    final_title: "",
    writer_safe_draft: "",
    assisted_draft: null,
    assisted_draft_status: "PENDING",
    pending_modules: ["full_assisted_observation"],
    background_modules: routePlan.background_modules || [],
    blocking_modules: routePlan.blocking_modules || [],
    title_stage_reason: "Fast scout failed; full assisted draft is continuing in background.",
    l1_return_reason: "fast_scout_failed_background_assist_started",
    provider_result: {
      provider: "openai_fast_scout",
      confidence: "FAILED",
      provider_error_type: "FAST_SCOUT_FAILED",
      message: String(error?.message || error || "").slice(0, 240)
    },
    v4_persistence: { create_session: createResult.persistence?.recognition_session || createResult.persistence || null }
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }

  const workerAuthorized = isV4WorkerRequest(req, process.env);
  if (!getSessionFromRequest(req) && !workerAuthorized) {
    sendJson(res, 401, withV4Version({ ok: false, message: "Unauthorized" }));
    return;
  }

  if (!workerAuthorized && !enforceApiRateLimit(req, res, {
    scope: "v4_listing_title",
    limit: 120,
    windowMs: 60_000,
    message: "Too many V4 title generation requests. Please try again shortly."
  })) return;

  let payload;
  try {
    payload = await readJsonPayload(req);
  } catch {
    sendJson(res, 400, withV4Version({ ok: false, message: "Invalid request." }));
    return;
  }

  const sessionId = payload.recognition_session_id || createV4SessionId();
  const handlerStartedAt = Date.now();
  let recognitionClockStartedAt = null;
  let recognitionClockSource = null;
  const startRecognitionClock = (source, startedAt = new Date().toISOString()) => {
    if (!recognitionClockStartedAt) {
      recognitionClockStartedAt = startedAt;
      recognitionClockSource = source;
    }
    return recognitionClockStartedAt;
  };
  const l2Timing = {
    pre_l2_bundle_load_ms: null,
    pre_l2_anchor_probe_ms: null,
    pre_l2_anchor_route: null,
    pre_l2_anchor_finalize_reason: null,
    pre_l2_anchor_patch_count: null,
    pre_l2_anchor_candidate_count: null,
    pre_l2_anchor_direct_candidate_count: null,
    pre_l2_anchor_type_breakdown: null,
    pre_l2_anchor_context_dimensions: null,
    pre_l2_anchor_direct_context_dimensions: null,
    pre_l2_anchor_lookup_attempted: false,
    pre_l2_anchor_catalog_candidate_count: null,
    pre_l2_anchor_trusted_candidate_count: null,
    pre_l2_anchor_eligible_candidate_count: null,
    pre_l2_full_l2_skipped: false,
    exact_anchor_scout_attempted: false,
    exact_anchor_scout_status: null,
    exact_anchor_scout_ms: null,
    exact_anchor_finalize_ms: null,
    exact_anchor_finalize_reason: null,
    exact_anchor_lookup_timing: null,
    exact_anchor_blocking_scout_allowed: null,
    recognition_core_ms: null,
    persist_pipeline_ms: null,
    handler_total_ms: null
  };
  const forceL2Direct = payload.v4_worker_synchronous === true || payload.v4_force_l2_direct === true;
  let preL2AnchorProbe = null;
  const preL2AnchorRouterEnabled = String(process.env.ENABLE_V4_PRE_L2_ANCHOR_ROUTER || "true").toLowerCase() !== "false";
  const preingestionBundleId = payload.preingestion_bundle_id || payload.preingestionBundleId || "";
  if (forceL2Direct && preL2AnchorRouterEnabled && preingestionBundleId) {
    const bundleStartedAt = Date.now();
    const controller = new AbortController();
    const timeoutMs = Math.max(100, Math.min(5000, Number(process.env.V4_PRE_L2_ANCHOR_BUNDLE_TIMEOUT_MS || 1200)));
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const bundleApplication = await applyPreIngestionBundleToPayload(payload, {
        fetchImpl: globalThis.fetch,
        signal: controller.signal
      });
      payload.v4_pre_l2_bundle_loaded = bundleApplication?.applied === true;
    } catch (error) {
      payload.pre_l2_anchor_bundle_error = String(error?.message || error || "bundle_load_failed").slice(0, 180);
    } finally {
      clearTimeout(timer);
      l2Timing.pre_l2_bundle_load_ms = Date.now() - bundleStartedAt;
    }

    const probeStartedAt = Date.now();
    preL2AnchorProbe = await probePreL2Anchors({
      payload,
      env: process.env,
      fetchImpl: globalThis.fetch,
      timeoutMs: Math.max(300, Math.min(3000, Number(process.env.V4_PRE_L2_ANCHOR_LOOKUP_TIMEOUT_MS || 1600)))
    });
    l2Timing.pre_l2_anchor_probe_ms = Date.now() - probeStartedAt;
    l2Timing.pre_l2_anchor_route = preL2AnchorProbe?.plan?.route || null;
    l2Timing.pre_l2_anchor_finalize_reason = preL2AnchorProbe?.reason || null;
    l2Timing.pre_l2_anchor_patch_count = preL2AnchorProbe?.metrics?.patch_count ?? null;
    l2Timing.pre_l2_anchor_candidate_count = preL2AnchorProbe?.metrics?.anchor_count ?? null;
    l2Timing.pre_l2_anchor_direct_candidate_count = preL2AnchorProbe?.metrics?.direct_anchor_count ?? null;
    l2Timing.pre_l2_anchor_type_breakdown = preL2AnchorProbe?.metrics?.anchor_type_breakdown || {};
    l2Timing.pre_l2_anchor_context_dimensions = preL2AnchorProbe?.metrics?.context_dimensions ?? null;
    l2Timing.pre_l2_anchor_direct_context_dimensions = preL2AnchorProbe?.metrics?.direct_context_dimensions ?? null;
    l2Timing.pre_l2_anchor_lookup_attempted = preL2AnchorProbe?.metrics?.lookup_attempted === true;
    l2Timing.pre_l2_anchor_catalog_candidate_count = preL2AnchorProbe?.metrics?.catalog_candidate_count ?? null;
    l2Timing.pre_l2_anchor_trusted_candidate_count = preL2AnchorProbe?.metrics?.trusted_candidate_count ?? null;
    l2Timing.pre_l2_anchor_eligible_candidate_count = preL2AnchorProbe?.metrics?.eligible_candidate_count ?? null;
    if (preL2AnchorProbe?.finalized === true) {
      // The writer-visible timer for a no-GPT path starts only after the
      // router has proved that OCR/catalog evidence is sufficient. Queueing,
      // bundle loading and speculative lookup are reported separately.
      startRecognitionClock("deterministic_anchor_finalize");
    }
    payload.v4_anchor_probe = {
      schema_version: preL2AnchorProbe?.schema_version || null,
      plan: preL2AnchorProbe?.plan || null,
      dossier: preL2AnchorProbe?.dossier || null,
      timing: preL2AnchorProbe?.timing || null,
      metrics: preL2AnchorProbe?.metrics || null,
      finalized: preL2AnchorProbe?.finalized === true,
      reason: preL2AnchorProbe?.reason || null
    };
    if (preL2AnchorProbe?.resolved_hint && Object.keys(preL2AnchorProbe.resolved_hint).length) {
      payload = backgroundPayloadWithL1ResolvedHint(payload, {
        resolved_fields: preL2AnchorProbe.resolved_hint,
        title: "",
        unresolved: []
      });
      payload.l1_fast_scout_resolved_hint_source = "v4_pre_l2_anchor_extraction";
    }
  }
  const routePlan = planV4RecognitionRoute(payload, process.env);
  const createResultPromise = createV4RecognitionSession({
    sessionId,
    payload,
    routePlan,
    operatorId: workerAuthorized ? "v4-production-worker" : operatorIdFromRequest(req)
  });
  scheduleV4Background(createResultPromise, "recognition session create");
  const deferredCreateResult = {
    sessionId,
    persistence: { recognition_session: { saved: false, deferred: true } }
  };

  if (canReturnFastScoutL1(payload, process.env)) {
    try {
      const fastScoutStartedAtIso = new Date().toISOString();
      const fastScoutPromise = runV4FastScoutObservation({
        payload,
        env: process.env,
        fetchImpl: globalThis.fetch,
        requestContext: openAiRequestContextFromV4Payload(payload, {
          providerCallPurpose: "fast_scout",
          titleStage: v4TitleStages.L1_INTERNAL_SCOUT
        })
      });
      const fastScoutResult = await fastScoutPromise;
      if (fastScoutResult.fast_scout?.cache_hit !== true) {
        startRecognitionClock("gpt_provider_request", fastScoutStartedAtIso);
      }
      // Exact-anchor finalize: a unique strict-tier catalog hit lets L1 emit
      // the writer-visible title now (~2-3s); L2 stays on as verification.
      const finalizeStartedAtIso = new Date().toISOString();
      const finalize = await maybeFinalizeL1FromExactAnchor({
        scoutResult: fastScoutResult,
        env: process.env,
        fetchImpl: globalThis.fetch,
        timeoutMs: Number(process.env.V4_EXACT_ANCHOR_FINALIZE_TIMEOUT_MS || 2000)
      }).catch(() => ({ finalized: false, reason: "finalize_error" }));
      const finalized = finalize?.finalized === true;
      if (finalized) startRecognitionClock("deterministic_anchor_finalize", finalizeStartedAtIso);
      const l1Result = {
        ...fastScoutResult,
        ...(finalized ? {
          title: finalize.title,
          final_title: finalize.title,
          rendered_title: finalize.title,
          resolved: finalize.resolved_fields,
          resolved_fields: finalize.resolved_fields,
          fields: finalize.resolved_fields,
          title_render_source: "exact_anchor_catalog_finalized",
          exact_anchor_finalize: {
            used: true,
            candidate: finalize.candidate || null,
            query_fields: finalize.query_fields || null
          }
        } : {
          exact_anchor_finalize: { used: false, reason: finalize?.reason || "not_attempted" }
        }),
        title_stage: v4TitleStages.L1_INTERNAL_SCOUT,
        assisted_draft_status: "PENDING",
        l1_return_reason: finalized ? "exact_anchor_catalog_internal_scout" : "fast_scout_internal_scout_ready",
        full_assist_continued_after_l1: true,
        l1_return_barrier_version: l1ReturnBarrierVersion
      };
      const l1Payload = recognitionPayloadFor({
        payload,
        sessionId,
        routePlan,
        providerOptions: providerOptionsForV4ProgressiveL1({ payload, routePlan }),
        titleStageTarget: v4TitleStages.L1_INTERNAL_SCOUT
      });
      const v4Response = addL1ReturnBarrierMetadata(adaptV2ResultToV4({
        sessionId,
        result: l1Result,
        payload: l1Payload,
        routePlan,
        persistence: {
          create_session: deferredCreateResult.persistence.recognition_session,
          l1_persistence: { saved: false, deferred: true }
        }
      }), l1Result.fast_scout || {});
      const writerResponse = finalized && exactAnchorWriterFastLaneEnabled()
        ? writerFinalizedL1Response(v4Response, l1Result)
        : writerPendingL1Response(v4Response, l1Result);
      const l1PersistencePromise = createResultPromise.then((createResult) => persistPipelineResult({
        sessionId,
        result: l1Result,
        payload: l1Payload,
        routePlan,
        createResult,
        extraProviderSummary: {
          assisted_draft_status: "PENDING",
          l1_return_barrier_version: l1ReturnBarrierVersion,
          recognition_clock_started_at: recognitionClockStartedAt,
          recognition_clock_source: recognitionClockSource
        },
        requestContext: req
      }));
      if (queueL1Only(payload)) {
        await l1PersistencePromise;
      } else {
        scheduleV4Background(l1PersistencePromise, "L1 persistence");
        scheduleV4Background(createResultPromise.then((createResult) => runBackgroundAssistedDraft({
          sessionId,
          payload,
          l1Result,
          routePlan,
          headers: req.headers,
          createResult
        })), "background L2 assisted draft");
      }
      sendJson(res, 200, writerResponse);
      return;
    } catch (error) {
      if (queueL1Only(payload)) {
        await createResultPromise.then((createResult) => updateV4RecognitionSession({
          sessionId,
          patch: {
            status: v4SessionStatuses.OBSERVING,
            l1_status: "FAILED",
            provider_result_summary: {
              provider: "openai_fast_scout",
              confidence: "FAILED",
              assisted_draft_status: "PENDING",
              provider_error_type: "FAST_SCOUT_FAILED",
              message: String(error?.message || error || "").slice(0, 240),
              l1_return_barrier_version: l1ReturnBarrierVersion
            }
          }
        }).then(() => createResult));
        sendJson(res, 500, addL1ReturnBarrierMetadata(
          buildFastScoutPendingFailureResponse({ sessionId, routePlan, createResult: deferredCreateResult, error }),
          { cache_hit: false, cache_status: "ERROR", blocking_call_used: true }
        ));
        return;
      }
      scheduleV4Background(createResultPromise.then((createResult) => updateV4RecognitionSession({
        sessionId,
        patch: {
          provider_result_summary: {
            provider: "openai_fast_scout",
            confidence: "FAILED",
            assisted_draft_status: "PENDING",
            provider_error_type: "FAST_SCOUT_FAILED",
            message: String(error?.message || error || "").slice(0, 240),
            l1_return_barrier_version: l1ReturnBarrierVersion
          }
        }
      }).then(() => createResult)), "fast scout failure session update");
      scheduleV4Background(createResultPromise.then((createResult) => runBackgroundAssistedDraft({
        sessionId,
        payload,
        routePlan,
        headers: req.headers,
        createResult
      })), "background L2 assisted draft after fast scout failure");
      sendJson(res, 200, addL1ReturnBarrierMetadata(
        buildFastScoutPendingFailureResponse({ sessionId, routePlan, createResult: deferredCreateResult, error }),
        { cache_hit: false, cache_status: "ERROR", blocking_call_used: true }
      ));
      return;
    }
  }

  const createResult = await createResultPromise;
  await updateV4RecognitionSession({
    sessionId,
    patch: { status: v4SessionStatuses.OBSERVING }
  });

  let l2ScoutResult = null;

  if (forceL2Direct && preL2AnchorProbe?.finalized === true) {
    const finalize = preL2AnchorProbe.finalize;
    startRecognitionClock("deterministic_anchor_finalize");
    l2Timing.pre_l2_full_l2_skipped = true;
    const finalizedResult = {
      title: finalize.title,
      final_title: finalize.title,
      rendered_title: finalize.title,
      resolved: finalize.resolved_fields,
      resolved_fields: finalize.resolved_fields,
      fields: finalize.resolved_fields,
      raw_provider_fields: finalize.resolved_fields,
      confidence: "HIGH",
      recognition_status: "CONFIRMED",
      provider: "v4_anchor_router",
      model: "deterministic_catalog_lookup",
      title_render_source: "pre_l2_anchor_catalog_finalized",
      exact_anchor_finalize: {
        used: true,
        candidate: finalize.candidate || null,
        query_fields: finalize.query_fields || null
      },
      anchor_probe: payload.v4_anchor_probe,
      title_stage: v4TitleStages.L2_ASSISTED_DRAFT,
      assisted_draft_status: "READY",
      l1_return_reason: "pre_l2_anchor_catalog_finalized",
      full_assist_continued_after_l1: false,
      module_speed_metrics: {
        v4_l2_timing: l2TimingWithTotal(l2Timing, handlerStartedAt)
      }
    };
    const persistStartedAt = Date.now();
    const finalizedResponse = await persistPipelineResult({
      sessionId,
      result: finalizedResult,
      payload,
      routePlan,
      createResult,
      extraProviderSummary: {
        assisted_draft_status: "READY",
        exact_anchor_finalized: true,
        pre_l2_anchor_finalized: true,
        recognition_clock_started_at: recognitionClockStartedAt,
        recognition_clock_source: recognitionClockSource,
        v4_l2_timing: l2TimingWithTotal(l2Timing, handlerStartedAt)
      },
      requestContext: req
    });
    l2Timing.persist_pipeline_ms = Date.now() - persistStartedAt;
    finalizedResponse.module_speed_metrics = {
      ...(finalizedResponse.module_speed_metrics || {}),
      v4_l2_timing: l2TimingWithTotal(l2Timing, handlerStartedAt)
    };
    sendJson(res, 200, writerFinalizedL2ExactAnchorResponse(finalizedResponse, finalizedResult, finalize));
    return;
  }

  // L2-direct short-circuit: even when the fast-scout L1 response is skipped
  // (queue workers, forced L2), a unique strict-tier catalog hit lets us skip
  // the 30-40s full observation entirely - the scout runs from cache/prewarm,
  // the finalize race is bounded, and anything short of a unique exact-code
  // agreement falls through to the normal L2 call unchanged.
  if (forceL2Direct && Array.isArray(payload.images) && payload.images.length > 0
    && payload.disable_exact_anchor_finalize !== true) {
    const allowBlockingScout = l2ExactAnchorBlockingScoutAllowed(payload, process.env);
    l2Timing.exact_anchor_scout_attempted = true;
    l2Timing.exact_anchor_blocking_scout_allowed = allowBlockingScout;
    const scoutStartedAt = Date.now();
    const scoutStartedAtIso = new Date().toISOString();
    try {
      const scoutResult = await runV4FastScoutObservation({
        payload,
        env: process.env,
        fetchImpl: globalThis.fetch,
        allowProviderCall: allowBlockingScout,
        requestContext: openAiRequestContextFromV4Payload(payload, {
          providerCallPurpose: "l2_direct_exact_anchor_scout",
          titleStage: v4TitleStages.L1_INTERNAL_SCOUT
        })
      });
      l2ScoutResult = scoutResult;
      if (allowBlockingScout && scoutResult.fast_scout?.cache_hit !== true) {
        startRecognitionClock("gpt_provider_request", scoutStartedAtIso);
      }
      l2Timing.exact_anchor_scout_ms = Date.now() - scoutStartedAt;
      l2Timing.exact_anchor_scout_status = scoutResult.fast_scout?.cache_hit ? "CACHE_HIT" : "PROVIDER_CALL";
      const finalizeStartedAt = Date.now();
      const finalize = await maybeFinalizeL1FromExactAnchor({
        scoutResult,
        env: process.env,
        fetchImpl: globalThis.fetch,
        timeoutMs: Number(process.env.V4_EXACT_ANCHOR_FINALIZE_TIMEOUT_MS || 2000)
      });
      l2Timing.exact_anchor_finalize_ms = Date.now() - finalizeStartedAt;
      l2Timing.exact_anchor_finalize_reason = finalize?.reason || null;
      l2Timing.exact_anchor_lookup_timing = finalize?.lookup_timing || null;
      if (finalize?.finalized === true) {
        // A cache-only scout is still speculative until the unique catalog
        // anchor is confirmed. Start the no-GPT clock at that decision point.
        startRecognitionClock("deterministic_anchor_finalize");
        const finalizedResult = {
          ...scoutResult,
          title: finalize.title,
          final_title: finalize.title,
          rendered_title: finalize.title,
          resolved: finalize.resolved_fields,
          resolved_fields: finalize.resolved_fields,
          fields: finalize.resolved_fields,
          title_render_source: "exact_anchor_catalog_finalized",
          exact_anchor_finalize: {
            used: true,
            candidate: finalize.candidate || null,
            query_fields: finalize.query_fields || null
          },
          title_stage: v4TitleStages.L2_ASSISTED_DRAFT,
          assisted_draft_status: "READY",
          l1_return_reason: "exact_anchor_catalog_finalized",
          full_assist_continued_after_l1: false,
          module_speed_metrics: {
            ...(scoutResult.module_speed_metrics || {}),
            v4_l2_timing: l2TimingWithTotal(l2Timing, handlerStartedAt)
          }
        };
        const persistStartedAt = Date.now();
        const finalizedResponse = await persistPipelineResult({
          sessionId,
          result: finalizedResult,
          payload,
          routePlan,
          createResult,
          extraProviderSummary: {
            assisted_draft_status: "READY",
            exact_anchor_finalized: true,
            recognition_clock_started_at: recognitionClockStartedAt,
            recognition_clock_source: recognitionClockSource,
            v4_l2_timing: l2TimingWithTotal(l2Timing, handlerStartedAt)
          },
          requestContext: req
        });
        l2Timing.persist_pipeline_ms = Date.now() - persistStartedAt;
        finalizedResponse.module_speed_metrics = {
          ...(finalizedResponse.module_speed_metrics || {}),
          v4_l2_timing: l2TimingWithTotal(l2Timing, handlerStartedAt)
        };
        sendJson(res, 200, writerFinalizedL2ExactAnchorResponse(finalizedResponse, finalizedResult, finalize));
        return;
      }
    } catch (error) {
      l2Timing.exact_anchor_scout_ms = Date.now() - scoutStartedAt;
      l2Timing.exact_anchor_scout_status = error?.code === "FAST_SCOUT_CACHE_MISS_PROVIDER_DISABLED"
        ? "CACHE_MISS_PROVIDER_DISABLED"
        : "ERROR";
      if (error?.code !== "FAST_SCOUT_CACHE_MISS_PROVIDER_DISABLED") {
        console.error("[v4-listing] exact anchor finalize (L2-direct) failed", error);
      }
    }
  }

  // Queue workers normally skip the progressive L1 branch, but exact-anchor
  // probing has already loaded the same-image scout from prewarm/cache. Carry
  // that observation into full L2 so the primary model confirms and completes
  // known fields instead of starting from zero. It remains a non-authoritative
  // hint: the L2 prompt requires current-image evidence for every copied value.
  const l2Payload = backgroundPayloadWithL1ResolvedHint(payload, l2ScoutResult);
  const modelRequiresFullL2Options = shouldSkipFastScoutForRequestedModel(l2Payload, process.env);
  const progressiveProviderOptions = forceL2Direct || modelRequiresFullL2Options
    ? providerOptionsForV4BackgroundL2({ payload: l2Payload, routePlan })
    : providerOptionsForV4ProgressiveL1({ payload: l2Payload, routePlan });
  const recognitionPayload = recognitionPayloadFor({
    payload: l2Payload,
    sessionId,
    routePlan,
    providerOptions: progressiveProviderOptions,
    titleStageTarget: forceL2Direct || modelRequiresFullL2Options ? v4TitleStages.L2_ASSISTED_DRAFT : progressiveProviderOptions.v4_title_stage_target
  });
  startRecognitionClock("gpt_provider_request");
  const recognitionCoreStartedAt = Date.now();
  const recognitionResponse = await callRecognitionCoreWithGpt5EmptyRetry({
    headers: req.headers,
    payload: recognitionPayload
  });
  l2Timing.recognition_core_ms = Date.now() - recognitionCoreStartedAt;

  if (recognitionResponse.statusCode < 200 || recognitionResponse.statusCode >= 300 || !recognitionResponse.body) {
    await updateV4RecognitionSession({
      sessionId,
      patch: {
        status: v4SessionStatuses.FAILED,
        failure_reason: `recognition_core_failed_${recognitionResponse.statusCode}`
      }
    });
    sendJson(res, recognitionResponse.statusCode || 500, withV4Version({
      ok: false,
      recognition_session_id: sessionId,
      message: recognitionResponse.body?.message || "V4 recognition failed before provider result.",
      v4_persistence: { create_session: createResult.persistence.recognition_session }
    }));
    return;
  }

  const persistStartedAt = Date.now();
  const v4Response = await persistPipelineResult({
    sessionId,
    result: recognitionResponse.body,
    payload: recognitionPayload,
    routePlan,
    createResult,
    extraProviderSummary: {
      recognition_clock_started_at: recognitionClockStartedAt,
      recognition_clock_source: recognitionClockSource,
      v4_l2_timing: l2TimingWithTotal(l2Timing, handlerStartedAt)
    },
    requestContext: req
  });
  l2Timing.persist_pipeline_ms = Date.now() - persistStartedAt;
  v4Response.module_speed_metrics = {
    ...(v4Response.module_speed_metrics || {}),
    v4_l2_timing: l2TimingWithTotal(l2Timing, handlerStartedAt)
  };

  sendJson(res, 200, withV4Version({
    ...v4Response,
    ...(modelRequiresFullL2Options ? {
      fast_scout_cache_hit: false,
      fast_scout_cache_status: "SKIPPED",
      fast_scout_prewarmer_used: false,
      fast_scout_blocking_call_used: false,
      fast_scout_skip_reason: "model_requires_full_l2"
    } : {})
  }));
}
