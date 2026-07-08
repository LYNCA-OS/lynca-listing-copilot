import { waitUntil } from "@vercel/functions";
import v2ListingHandler from "../listing-copilot-title.js";
import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { getSessionFromRequest, operatorIdFromRequest } from "../../lib/listing-session.mjs";
import { runV4FastScoutObservation } from "../../lib/listing/v4/fast-scout/fast-scout-observation.mjs";
import { maybeFinalizeL1FromExactAnchor } from "../../lib/listing/v4/fast-scout/exact-anchor-finalize.mjs";
import { planV4RecognitionRoute } from "../../lib/listing/v4/route-planner/route-planner.mjs";
import { adaptV2ResultToV4, buildV4PersistenceRows } from "../../lib/listing/v4/result-adapter.mjs";
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
  persistV4QualityLedger,
  updateV4RecognitionSession
} from "../../lib/listing/v4/session/session-store.mjs";
import { v4SessionStatuses } from "../../lib/listing/v4/session/status.mjs";
import { callJsonHandler, readJsonPayload, sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import { isV4WorkerRequest } from "../../lib/listing/v4/jobs/worker-auth.mjs";

function titleFromResult(result = {}) {
  return result.final_title || result.rendered_title || result.title || null;
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
    l1_internal_scout: scout,
    legacy_v2_result: legacy
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
  return {
    provider_latency_ms: result.provider_latency_ms ?? null,
    provider_prompt_mode: result.provider_prompt_mode || null,
    provider_prompt_chars: Number.isFinite(Number(result.provider_prompt_chars)) ? Number(result.provider_prompt_chars) : null,
    provider_input_image_count: Number.isFinite(Number(result.provider_input_image_count)) ? Number(result.provider_input_image_count) : null,
    provider_image_detail: result.provider_image_detail || null,
    provider_finish_reason: result.provider_finish_reason || null,
    provider_token_diagnostics: result.provider_token_diagnostics || null,
    provider_initial_token_diagnostics: result.provider_initial_token_diagnostics || null,
    provider_rate_limit_diagnostics: result.provider_rate_limit_diagnostics || null,
    provider_initial_rate_limit_diagnostics: result.provider_initial_rate_limit_diagnostics || null,
    provider_request_diagnostics: result.provider_request_diagnostics || null,
    provider_initial_request_diagnostics: result.provider_initial_request_diagnostics || null,
    provider_truncation_retry_attempted: result.provider_truncation_retry_attempted === true,
    provider_truncation_retry_attempts: Number(result.provider_truncation_retry_attempts || 0),
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
  if (String(env.ENABLE_V4_FAST_SCOUT_L1 || "false").toLowerCase() !== "true") return false;
  if (payload.v4_worker_synchronous === true || payload.v4_force_l2_direct === true || payload.disable_fast_scout_l1 === true) return false;
  return Array.isArray(payload.images) && payload.images.length > 0;
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

function v2PayloadFor({
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
  extraProviderSummary = {}
} = {}) {
  const l1Stage = result.title_stage === v4TitleStages.L1_INTERNAL_SCOUT;
  const rows = buildV4PersistenceRows({ sessionId, result, payload });
  const fieldEvidence = await persistV4FieldEvidence({ sessionId, rows: rows.fieldEvidenceRows });
  const candidateTrace = await persistV4CandidateTrace({ sessionId, trace: rows.candidateTrace });
  const catalogPromptCount = catalogPromptCountFromTrace(rows.candidateTrace);
  const catalogGap = l1Stage
    ? { saved: false, skipped: true, reason: "internal_scout_not_catalog_gap" }
    : catalogPromptCount === 0
    ? await persistV4CatalogGap({
      gap: {
        id: `${sessionId}_catalog_gap`,
        recognition_session_id: sessionId,
        asset_id: payload.asset_id || payload.assetId || null,
        gap_type: catalogGapTypeFromTrace(rows.candidateTrace),
        observed_fields: resolvedFromResult(result),
        candidate_snapshot: {
          candidate_activation_funnel: rows.candidateTrace.candidate_activation_funnel,
          catalog_activation_funnel: rows.candidateTrace.catalog_activation_funnel,
          vector_activation_funnel: rows.candidateTrace.vector_activation_funnel,
          low_margin_safe_field_application: rows.candidateTrace.low_margin_safe_field_application || null,
          selected_candidate_verifier: rows.candidateTrace.selected_candidate_verifier || null
        },
        draft_title: titleFromResult(result)
      }
    })
    : { saved: false, skipped: true, reason: "catalog_prompt_candidate_available" };
  if (l1Stage) {
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
  const status = result.confidence === "FAILED" ? v4SessionStatuses.FAILED : v4SessionStatuses.DRAFT_READY;
  const l2Title = titleFromResult(result);
  const sessionPatch = {
    status,
    field_states: rows.fieldEvidenceRows,
    route: routePlan.route,
    route_plan: routePlan,
    candidate_control_plane_trace: rows.candidateTrace,
    provider_result_summary: {
      provider: result.provider || result.provider_id || null,
      confidence: result.confidence || null,
      title_stage: result.title_stage || null,
      assisted_draft_status: result.assisted_draft_status || extraProviderSummary.assisted_draft_status || null,
      provider_error_type: result.provider_error_type || result.provider_error_code || null,
      ...providerRuntimeSummary(result),
      ...extraProviderSummary
    }
  };
  sessionPatch.final_title = l2Title;
  sessionPatch.l2_status = status === v4SessionStatuses.FAILED ? "FAILED" : "READY";
  sessionPatch.l2_title = l2Title;
  sessionPatch.l2_ready_at = new Date().toISOString();
  sessionPatch.l2_route = routePlan.route || null;
  sessionPatch.l2_timing = result.timing || result.timings || {};
  sessionPatch.resolved_fields = resolvedFromResult(result);
  const sessionUpdate = await updateV4RecognitionSession({
    sessionId,
    patch: sessionPatch
  });
  const partialPersistence = {
    create_session: createResult.persistence?.recognition_session || createResult.persistence || null,
    update_session: sessionUpdate,
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
  const v2Payload = v2PayloadFor({
    payload: l2Payload,
    sessionId,
    routePlan,
    providerOptions,
    titleStageTarget: v4TitleStages.L2_ASSISTED_DRAFT
  });
  const v2Response = await callJsonHandler(v2ListingHandler, {
    method: "POST",
    headers,
    payload: v2Payload
  });
  if (v2Response.statusCode < 200 || v2Response.statusCode >= 300 || !v2Response.body) {
    await updateV4RecognitionSession({
      sessionId,
      patch: {
        provider_result_summary: {
          assisted_draft_status: "FAILED",
          failure_reason: `v2_handler_failed_${v2Response.statusCode}`,
          l1_already_returned: true
        }
      }
    });
    return null;
  }
  const result = {
    ...v2Response.body,
    title_stage: v4TitleStages.L2_ASSISTED_DRAFT,
    assisted_draft_status: "READY",
    l1_return_reason: "background_assisted_draft_ready",
    full_assist_continued_after_l1: false
  };
  return persistPipelineResult({
    sessionId,
    result,
    payload: v2Payload,
    routePlan,
    createResult,
    extraProviderSummary: { assisted_draft_status: "READY" }
  });
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
      // Exact-anchor finalize: a unique strict-tier catalog hit lets L1 emit
      // the writer-visible title now (~2-3s); L2 stays on as verification.
      const finalize = await maybeFinalizeL1FromExactAnchor({
        scoutResult: fastScoutResult,
        env: process.env,
        fetchImpl: globalThis.fetch,
        timeoutMs: Number(process.env.V4_EXACT_ANCHOR_FINALIZE_TIMEOUT_MS || 1500)
      }).catch(() => ({ finalized: false, reason: "finalize_error" }));
      const finalized = finalize?.finalized === true;
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
      const l1Payload = v2PayloadFor({
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
      const writerResponse = writerPendingL1Response(v4Response, l1Result);
      const l1PersistencePromise = createResultPromise.then((createResult) => persistPipelineResult({
        sessionId,
        result: l1Result,
        payload: l1Payload,
        routePlan,
        createResult,
        extraProviderSummary: {
          assisted_draft_status: "PENDING",
          l1_return_barrier_version: l1ReturnBarrierVersion
        }
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

  const forceL2Direct = payload.v4_worker_synchronous === true || payload.v4_force_l2_direct === true;

  // L2-direct short-circuit: even when the fast-scout L1 response is skipped
  // (queue workers, forced L2), a unique strict-tier catalog hit lets us skip
  // the 30-40s full observation entirely - the scout runs from cache/prewarm,
  // the finalize race is bounded, and anything short of a unique exact-code
  // agreement falls through to the normal L2 call unchanged.
  if (forceL2Direct && Array.isArray(payload.images) && payload.images.length > 0
    && payload.disable_exact_anchor_finalize !== true) {
    try {
      const scoutResult = await runV4FastScoutObservation({
        payload,
        env: process.env,
        fetchImpl: globalThis.fetch,
        requestContext: openAiRequestContextFromV4Payload(payload, {
          providerCallPurpose: "l2_direct_exact_anchor_scout",
          titleStage: v4TitleStages.L1_INTERNAL_SCOUT
        })
      });
      const finalize = await maybeFinalizeL1FromExactAnchor({
        scoutResult,
        env: process.env,
        fetchImpl: globalThis.fetch,
        timeoutMs: Number(process.env.V4_EXACT_ANCHOR_FINALIZE_TIMEOUT_MS || 1500)
      });
      if (finalize?.finalized === true) {
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
          full_assist_continued_after_l1: false
        };
        const finalizedResponse = await persistPipelineResult({
          sessionId,
          result: finalizedResult,
          payload,
          routePlan,
          createResult,
          extraProviderSummary: { assisted_draft_status: "READY", exact_anchor_finalized: true }
        });
        sendJson(res, 200, writerFinalizedL2ExactAnchorResponse(finalizedResponse, finalizedResult, finalize));
        return;
      }
    } catch (error) {
      console.error("[v4-listing] exact anchor finalize (L2-direct) failed", error);
    }
  }

  const progressiveProviderOptions = forceL2Direct
    ? providerOptionsForV4BackgroundL2({ payload, routePlan })
    : providerOptionsForV4ProgressiveL1({ payload, routePlan });
  const v2Payload = v2PayloadFor({
    payload,
    sessionId,
    routePlan,
    providerOptions: progressiveProviderOptions,
    titleStageTarget: forceL2Direct ? v4TitleStages.L2_ASSISTED_DRAFT : progressiveProviderOptions.v4_title_stage_target
  });
  const v2Response = await callJsonHandler(v2ListingHandler, {
    method: "POST",
    headers: req.headers,
    payload: v2Payload
  });

  if (v2Response.statusCode < 200 || v2Response.statusCode >= 300 || !v2Response.body) {
    await updateV4RecognitionSession({
      sessionId,
      patch: {
        status: v4SessionStatuses.FAILED,
        failure_reason: `v2_handler_failed_${v2Response.statusCode}`
      }
    });
    sendJson(res, v2Response.statusCode || 500, withV4Version({
      ok: false,
      recognition_session_id: sessionId,
      message: v2Response.body?.message || "V4 recognition failed before provider result.",
      v4_persistence: { create_session: createResult.persistence.recognition_session }
    }));
    return;
  }

  const v4Response = await persistPipelineResult({
    sessionId,
    result: v2Response.body,
    payload: v2Payload,
    routePlan,
    createResult
  });

  sendJson(res, 200, v4Response);
}
