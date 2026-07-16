import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { bindProductionRequestContext, instrumentProductionRequest } from "../../lib/observability/production-events.mjs";
import { readV4RecognitionJobs, v4JobStatuses } from "../../lib/listing/v4/jobs/production-job-queue.mjs";
import { buildEndToEndNodeLedger } from "../../lib/listing/v4/jobs/end-to-end-node-observability.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { readV4Rows } from "../../lib/listing/v4/session/supabase-rest.mjs";
import { sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";
import { buildRetrievalParticipationSummary } from "../../lib/listing/retrieval/retrieval-participation.mjs";
import {
  hasTenantPermission,
  publicTenantAuthError,
  requirePermission,
  requireTenantAccess,
  TENANT_PERMISSIONS
} from "../../lib/tenant/index.mjs";

function queryParam(req, name) {
  const url = new URL(req.url || "/", "https://local.test");
  return String(url.searchParams.get(name) || "").trim();
}

function splitIds(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 200);
}

async function readSessionsForJobs(jobs = [], tenantId = "") {
  const sessionIds = [...new Set(jobs.map((job) => job.recognition_session_id).filter(Boolean))];
  if (!sessionIds.length) return {};
  const result = await readV4Rows({
    table: "v4_recognition_sessions",
    select: "id,tenant_id,operator_id,created_by_user_id,assigned_to_user_id,status,final_title,l1_status,l1_ready_at,l1_route,l1_timing,l2_status,l2_title,l2_ready_at,l2_route,l2_timing,provider_result_summary,candidate_control_plane_trace,resolved_fields,field_states,updated_at,failure_reason",
    search: {
      id: `in.(${sessionIds.map((id) => `"${id.replaceAll('"', '\\"')}"`).join(",")})`,
      tenant_id: `eq.${tenantId}`,
      limit: String(sessionIds.length)
    }
  });
  if (!result.ok) return {};
  return Object.fromEntries(result.rows.map((row) => [row.id, row]));
}

const activeJobStatuses = new Set([
  v4JobStatuses.QUEUED,
  v4JobStatuses.RETRYING,
  v4JobStatuses.RUNNING
]);

function jobStillActive(job = null) {
  return activeJobStatuses.has(String(job?.status || "").toUpperCase());
}

function operationalSessionStatus(session = null, job = null) {
  if (!session) return null;
  const activeRetry = jobStillActive(job);
  const summary = session.provider_result_summary && typeof session.provider_result_summary === "object"
    ? session.provider_result_summary
    : {};
  const trace = session.candidate_control_plane_trace && typeof session.candidate_control_plane_trace === "object"
    ? session.candidate_control_plane_trace
    : {};
  const l2Ready = session.l2_status === "READY" && Boolean(session.final_title || session.l2_title);
  const writerReviewRequired = !activeRetry
    && session.l2_status === "READY"
    && (
      session.status === "WRITER_REVIEW"
      || summary.writer_review_required === true
      || summary.assisted_draft_status === "REVIEW_REQUIRED"
    );
  const l2Terminal = l2Ready || writerReviewRequired;
  const assistedDraftStatus = activeRetry && !l2Terminal
    ? "RUNNING"
    : summary.assisted_draft_status || (l2Ready ? "READY" : writerReviewRequired ? "REVIEW_REQUIRED" : null);
  const retrievalParticipation = buildRetrievalParticipationSummary({
    catalogFunnel: trace.catalog_activation_funnel || {},
    vectorFunnel: trace.vector_activation_funnel || {},
    candidateApplicationTrace: Array.isArray(trace.candidate_application_trace_rows)
      ? trace.candidate_application_trace_rows
      : [],
    candidateDecisionStage: trace.candidate_decision_stage || {},
    retrievalApplication: trace.retrieval_application || {},
    exactAnchorIdentityDecision: summary.pre_l2_anchor_fast_lane_hit === true
      || summary.v4_l2_timing?.pre_l2_anchor_fast_lane_hit === true
      || summary.v4_l2_timing?.exact_anchor_finalize_reason === "exact_anchor_catalog_finalized"
  });
  return {
    id: session.id || null,
    status: activeRetry && !l2Terminal ? "RUNNING" : session.status || null,
    final_title: l2Ready ? (session.final_title || session.l2_title || "") : "",
    l1_status: session.l1_status || "PENDING",
    l1_title: "",
    l1_ready_at: session.l1_ready_at || null,
    l1_route: session.l1_route || null,
    l1_timing: session.l1_timing || null,
    l2_status: activeRetry && !l2Terminal ? "PENDING" : session.l2_status || "PENDING",
    l2_title: l2Ready ? (session.l2_title || session.final_title || "") : "",
    l2_ready_at: session.l2_ready_at || null,
    l2_route: session.l2_route || null,
    l2_timing: session.l2_timing || null,
    provider_result_summary: {
      assisted_draft_status: assistedDraftStatus,
      outcome_type: summary.outcome_type || null,
      writer_review_required: writerReviewRequired,
      writer_review_reason: summary.writer_review_reason || null,
      provider: summary.provider || null,
      model: summary.model || summary.model_id || null,
      confidence: summary.confidence || null,
      provider_latency_ms: summary.provider_latency_ms ?? null,
      provider_response_profile: summary.provider_response_profile || "standard",
      provider_prompt_mode: summary.provider_prompt_mode || null,
      provider_prompt_chars: Number.isFinite(Number(summary.provider_prompt_chars)) ? Number(summary.provider_prompt_chars) : null,
      provider_image_detail: summary.provider_image_detail || null,
      provider_text_verbosity: summary.provider_text_verbosity || null,
      provider_requested_service_tier: summary.provider_requested_service_tier || null,
      provider_service_tier: summary.provider_service_tier || null,
      identity_cache_hit: summary.identity_cache_hit === true,
      identity_cache_read_bypassed: summary.identity_cache_read_bypassed === true,
      identity_cache_write_reason: summary.identity_cache_write_reason || null,
      provider_finish_reason: summary.provider_finish_reason || null,
      provider_token_diagnostics: summary.provider_token_diagnostics || summary.token_diagnostics || summary.usage || null,
      provider_initial_token_diagnostics: summary.provider_initial_token_diagnostics || summary.initial_token_diagnostics || null,
      provider_rate_limit_diagnostics: summary.provider_rate_limit_diagnostics || summary.rate_limit_diagnostics || null,
      provider_initial_rate_limit_diagnostics: summary.provider_initial_rate_limit_diagnostics || summary.initial_rate_limit_diagnostics || null,
      provider_request_diagnostics: summary.provider_request_diagnostics || summary.request_diagnostics || null,
      provider_initial_request_diagnostics: summary.provider_initial_request_diagnostics || summary.initial_request_diagnostics || null,
      provider_key_pool_size: Number(summary.provider_key_pool_size || summary.key_pool_size || 0) || null,
      provider_key_slot: Number(summary.provider_key_slot || summary.key_slot || 0) || null,
      provider_key_source: summary.provider_key_source || summary.key_source || null,
      provider_key_rotation_attempted: summary.provider_key_rotation_attempted === true || summary.key_rotation_attempted === true,
      provider_key_rotation_attempts: Number(summary.provider_key_rotation_attempts || summary.key_rotation_attempts || 0),
      provider_truncation_retry_attempted: summary.provider_truncation_retry_attempted === true,
      provider_truncation_retry_attempts: Number(summary.provider_truncation_retry_attempts || 0),
      vector_runtime_status: summary.vector_runtime_status || null,
      vector_runtime_status_code: summary.vector_runtime_status_code ?? null,
      vector_runtime_unavailable_reasons: Array.isArray(summary.vector_runtime_unavailable_reasons)
        ? summary.vector_runtime_unavailable_reasons
        : [],
      vector_worker_status: summary.vector_worker_status || null,
      vector_worker_reason: summary.vector_worker_reason || "",
      vector_worker_feature_count: summary.vector_worker_feature_count ?? null,
      vector_worker_latency_ms: summary.vector_worker_latency_ms ?? null,
      vector_worker_attempt_count: summary.vector_worker_attempt_count ?? null,
      catalog_stage_capacity: summary.catalog_stage_capacity || null,
      vector_stage_capacity: summary.vector_stage_capacity || null,
      gpt5_empty_result_retry_attempted: summary.gpt5_empty_result_retry_attempted === true,
      gpt5_empty_result_retry_success: summary.gpt5_empty_result_retry_success === true,
      gpt5_empty_result_retry_status_code: summary.gpt5_empty_result_retry_status_code ?? null,
      gpt5_empty_result_retry_key_slot: Number(summary.gpt5_empty_result_retry_key_slot || 0) || null,
      preingestion_ocr_rendezvous: summary.preingestion_ocr_rendezvous || null,
      preingestion_evidence_refresh: summary.preingestion_evidence_refresh || null,
      preingestion_retrieval_refresh: summary.preingestion_retrieval_refresh || null,
      preingestion_retrieval_anchor_fields: Array.isArray(summary.preingestion_retrieval_anchor_fields)
        ? summary.preingestion_retrieval_anchor_fields
        : [],
      serial_numerator_verified: summary.serial_numerator_verified ?? null,
      pipeline_node_ledger: summary.pipeline_node_ledger || null,
      title_length_policy: summary.title_length_policy || null,
      title_render_source: summary.title_render_source || null,
      title_reconciled_from_v4_field_graph: summary.title_reconciled_from_v4_field_graph === true,
      failure_reason: summary.failure_reason || null,
      noncritical_persistence_status: summary.noncritical_persistence_status || null,
      noncritical_persistence_summary: summary.noncritical_persistence_summary || null,
      writer_ready_persistence_mode: summary.writer_ready_persistence_mode || null,
      provider_capacity_stage_handoff: summary.provider_capacity_stage_handoff || null,
      recognition_clock_started_at: summary.recognition_clock_started_at || null,
      recognition_clock_source: summary.recognition_clock_source || null,
      v4_l2_timing: summary.v4_l2_timing || null,
      v4_pipeline_contract: summary.v4_pipeline_contract || null
    },
    candidate_control_plane_trace: {
      schema_version: trace.schema_version || null,
      candidate_observation_snapshot: trace.candidate_observation_snapshot || {},
      participation_level: trace.participation_level || null,
      decision_eligible_candidate_count: Number(trace.decision_eligible_candidate_count || 0),
      decision_eligible_candidate_ids: Array.isArray(trace.decision_eligible_candidate_ids)
        ? trace.decision_eligible_candidate_ids
        : [],
      field_evidence_eligible_candidate_count: Number(trace.field_evidence_eligible_candidate_count || 0),
      field_evidence_eligible_candidate_ids: Array.isArray(trace.field_evidence_eligible_candidate_ids)
        ? trace.field_evidence_eligible_candidate_ids
        : [],
      shadow_only_candidate_count: Number(trace.shadow_only_candidate_count || 0),
      shadow_only_candidate_ids: Array.isArray(trace.shadow_only_candidate_ids)
        ? trace.shadow_only_candidate_ids
        : [],
      selected_candidate_decision: trace.selected_candidate_decision || null,
      candidate_decision_stage: trace.candidate_decision_stage || null,
      retrieval_application: trace.retrieval_application
        ? {
          ...trace.retrieval_application,
          decisions: Array.isArray(trace.retrieval_application.decisions)
            ? trace.retrieval_application.decisions.slice(0, 80)
            : []
        }
        : null,
      selected_candidate_safe_field_application: trace.selected_candidate_safe_field_application || null,
      low_margin_safe_field_application: trace.low_margin_safe_field_application || null,
      applied_field_count: Number(trace.applied_field_count || 0),
      applied_fields: Array.isArray(trace.applied_fields) ? trace.applied_fields : [],
      blocked_field_count: Number(trace.blocked_field_count || 0),
      blocked_fields: Array.isArray(trace.blocked_fields) ? trace.blocked_fields : [],
      candidate_application_trace_rows: Array.isArray(trace.candidate_application_trace_rows)
        ? trace.candidate_application_trace_rows.slice(0, 20)
        : [],
      catalog_activation_funnel: trace.catalog_activation_funnel || {},
      vector_activation_funnel: trace.vector_activation_funnel || {},
      retrieval_participation: retrievalParticipation
    },
    resolved_fields: session.resolved_fields && typeof session.resolved_fields === "object" ? session.resolved_fields : {},
    field_states: session.field_states && typeof session.field_states === "object" ? session.field_states : {},
    updated_at: session.updated_at || null,
    failure_reason: activeRetry && !l2Ready ? null : session.failure_reason || null
  };
}

function writerSessionStatus(session = null, job = null) {
  if (!session) return null;
  const summary = session.provider_result_summary && typeof session.provider_result_summary === "object"
    ? session.provider_result_summary
    : {};
  const display = displayStateForSession(session, job);
  const finalTitle = session.l2_status === "READY" ? (session.l2_title || session.final_title || "") : "";
  const assistedDraftStatus = display.writer_status === "ASSISTED_READY"
    ? "READY"
    : display.writer_status === "REVIEW_REQUIRED"
      ? "REVIEW_REQUIRED"
      : display.writer_status === "FAILED"
        ? "FAILED"
        : "PENDING";
  return {
    id: session.id || null,
    status: session.status || null,
    final_title: finalTitle,
    l2_status: session.l2_status || "PENDING",
    l2_title: finalTitle,
    l2_ready_at: session.l2_ready_at || null,
    provider_result_summary: {
      assisted_draft_status: assistedDraftStatus,
      writer_review_required: display.writer_status === "REVIEW_REQUIRED",
      writer_review_reason: display.writer_status === "REVIEW_REQUIRED"
        ? summary.writer_review_reason || null
        : null,
      recognition_clock_started_at: summary.recognition_clock_started_at || null,
      recognition_clock_source: summary.recognition_clock_source || null
    },
    resolved_fields: session.resolved_fields && typeof session.resolved_fields === "object" ? session.resolved_fields : {},
    field_states: session.field_states && typeof session.field_states === "object" ? session.field_states : {},
    updated_at: session.updated_at || null,
    failure_reason: session.failure_reason ? "Recognition failed." : null,
    writer_status: display.writer_status,
    writer_display_title: display.writer_display_title,
    display_status: display.display_status,
    title_stage: display.title_stage,
    current_best_title: display.current_best_title,
    is_final: display.is_final,
    can_writer_start: display.can_writer_start
  };
}

function writerTiming(timing = {}) {
  return {
    time_to_l2_ready_ms: timing.time_to_l2_ready_ms ?? null,
    worker_queue_wait_ms: timing.worker_queue_wait_ms ?? null,
    worker_processing_ms: timing.worker_processing_ms ?? null,
    writer_visible_recognition_ms: timing.writer_visible_recognition_ms ?? null
  };
}

function writerJobStatus({ job, session, display, timing }) {
  return {
    job_id: job.id,
    batch_id: job.batch_id,
    recognition_session_id: job.recognition_session_id,
    status: job.status,
    writer_status: display.writer_status,
    writer_display_title: display.writer_display_title,
    display_status: display.display_status,
    display_title: display.display_title,
    title_stage: display.title_stage,
    current_best_title: display.current_best_title,
    is_final: display.is_final,
    can_writer_start: display.can_writer_start,
    pending_modules: display.pending_modules,
    background_modules: display.background_modules,
    l2_status: session?.l2_status || "PENDING",
    l2_title: session?.l2_status === "READY" ? (session?.l2_title || session?.final_title || "") : "",
    l2_ready_at: session?.l2_ready_at || null,
    timing: writerTiming(timing),
    created_at: job.created_at || null,
    updated_at: job.updated_at || null,
    completed_at: job.completed_at || null,
    session: writerSessionStatus(session, job)
  };
}

function displayStateForSession(session = null, job = null) {
  const activeRetry = jobStillActive(job);
  if (!session) {
    return {
      internal_status: "PENDING",
      writer_status: "GENERATING",
      display_status: "PENDING",
      display_title: "",
      writer_display_title: null,
      title_stage: "PENDING",
      current_best_title: "",
      is_final: false,
      can_writer_start: false,
      pending_modules: ["fast_scout_draft", "final_assisted_title"],
      background_modules: ["final_assisted_title"]
    };
  }
  const summary = session.provider_result_summary && typeof session.provider_result_summary === "object"
    ? session.provider_result_summary
    : {};
  const l2Ready = session.l2_status === "READY" && Boolean(session.l2_title || session.final_title);
  const writerReviewRequired = !activeRetry
    && session.l2_status === "READY"
    && (
      session.status === "WRITER_REVIEW"
      || summary.writer_review_required === true
      || summary.assisted_draft_status === "REVIEW_REQUIRED"
    );
  const l2Title = l2Ready
    ? (session.l2_title || session.final_title || "")
    : "";
  if (l2Ready) {
    return {
      internal_status: session.status || "L2_READY",
      writer_status: "ASSISTED_READY",
      display_status: "FINAL_READY",
      display_title: l2Title,
      writer_display_title: l2Title,
      title_stage: "L2_ASSISTED_DRAFT",
      current_best_title: l2Title,
      is_final: true,
      can_writer_start: true,
      pending_modules: [],
      background_modules: []
    };
  }
  if (writerReviewRequired) {
    return {
      internal_status: session.status || "WRITER_REVIEW",
      writer_status: "REVIEW_REQUIRED",
      display_status: "WRITER_REVIEW",
      display_title: "",
      writer_display_title: null,
      title_stage: "L2_ASSISTED_DRAFT",
      current_best_title: "",
      is_final: true,
      can_writer_start: true,
      pending_modules: [],
      background_modules: []
    };
  }
  if (activeRetry) {
    return {
      internal_status: job.status || "RUNNING",
      writer_status: "GENERATING",
      display_status: "PENDING",
      display_title: "",
      writer_display_title: null,
      title_stage: "PENDING",
      current_best_title: "",
      is_final: false,
      can_writer_start: false,
      pending_modules: ["final_assisted_title"],
      background_modules: ["final_assisted_title"]
    };
  }
  return {
    internal_status: session.status || (session.l1_status === "READY" ? "L1_READY" : session.failure_reason ? "FAILED" : "PENDING"),
    writer_status: session.failure_reason ? "FAILED" : "GENERATING",
    display_status: session.failure_reason ? "FAILED" : "PENDING",
    display_title: "",
    writer_display_title: null,
    title_stage: "PENDING",
    current_best_title: "",
    is_final: false,
    can_writer_start: false,
    pending_modules: ["fast_scout_draft", "final_assisted_title"],
    background_modules: ["final_assisted_title"]
  };
}

function elapsedMs(startedAt, finishedAt) {
  const start = Date.parse(startedAt || "");
  const finish = Date.parse(finishedAt || "");
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) return null;
  return finish - start;
}

export default async function handler(req, res) {
  instrumentProductionRequest(req, res, { api: "/api/v4/listing-job-status" });
  if (req.method !== "GET") {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }
  let context;
  try {
    context = await requireTenantAccess(req);
    bindProductionRequestContext(res, context);
  } catch (error) {
    sendJson(res, Number(error?.statusCode || 503), withV4Version(publicTenantAuthError(error)));
    return;
  }
  if (!enforceApiRateLimit(req, res, {
    scope: "v4_listing_job_status",
    limit: 1200,
    windowMs: 60_000,
    message: "Too many V4 job status requests. Please try again shortly."
  })) return;

  const batchId = queryParam(req, "batch_id") || queryParam(req, "batchId");
  const jobIds = splitIds(queryParam(req, "job_ids") || queryParam(req, "jobIds") || queryParam(req, "job_id"));
  if (!batchId && !jobIds.length) {
    sendJson(res, 400, withV4Version({
      ok: false,
      retryable: false,
      error_code: "V4_JOB_STATUS_QUERY_REQUIRED",
      message: "batch_id or job_ids is required."
    }));
    return;
  }
  const result = await readV4RecognitionJobs({
    batchId,
    jobIds,
    tenantId: context.tenantId,
    limit: Number(queryParam(req, "limit") || 200)
  });
  const canViewOperations = hasTenantPermission(context, TENANT_PERMISSIONS.VIEW_TEAM);
  if (!result.ok) {
    // A valid status query can fail when PostgREST or its connection pool has a
    // transient read outage. Report service unavailability so every client can
    // retry without mistaking an infrastructure fault for an invalid request.
    sendJson(res, 503, withV4Version({
      ok: false,
      retryable: true,
      error_code: "V4_JOB_STATUS_BACKEND_UNAVAILABLE",
      message: "Unable to read V4 jobs.",
      ...(canViewOperations ? { diagnostic: result.error || null } : {})
    }));
    return;
  }
  const sessions = await readSessionsForJobs(result.rows, context.tenantId);
  const canViewAll = hasTenantPermission(context, TENANT_PERMISSIONS.VIEW_ALL_WORK);
  const ownedJobs = result.rows.filter((job) => {
    if (canViewAll) return true;
    const operatorId = String(job.operator_id || "").trim();
    const createdByUserId = String(job.created_by_user_id || "").trim();
    const assignedToUserId = String(job.assigned_to_user_id || "").trim();
    if ([operatorId, createdByUserId, assignedToUserId].includes(context.userId)) return true;
    const session = sessions[job.recognition_session_id] || null;
    if (String(session?.operator_id || "").trim() === context.userId
        || String(session?.created_by_user_id || "").trim() === context.userId) return true;
    try {
      requirePermission(context, TENANT_PERMISSIONS.VIEW_ASSIGNED_TASK, {
        assignedUserId: session?.assigned_to_user_id
      });
      return true;
    } catch {
      return false;
    }
  });
  if (!ownedJobs.length) {
    sendJson(res, 404, withV4Version({ ok: false, retryable: false, message: "Recognition jobs not found." }));
    return;
  }
  sendJson(res, 200, withV4Version({
    ok: true,
    batch_id: batchId || null,
    job_count: ownedJobs.length,
    jobs: ownedJobs.map((job) => {
      const session = sessions[job.recognition_session_id] || null;
      const display = displayStateForSession(session, job);
      const providerSummary = session?.provider_result_summary && typeof session.provider_result_summary === "object"
        ? session.provider_result_summary
        : {};
      const pairedL1ReleasedAt = job.queue_tags?.paired_l1_released_at || null;
      const schedulerReadyAt = pairedL1ReleasedAt || job.created_at;
      const recognitionStartedAt = providerSummary.recognition_clock_started_at
        || job.queue_tags?.provider_capacity_leased_at
        || null;
      const recognitionStartSource = providerSummary.recognition_clock_source
        || (job.queue_tags?.provider_capacity_leased_at ? "provider_capacity_lease" : null);
      const recognitionCompletedAt = session?.l2_ready_at || job.completed_at || null;
      const timing = {
        ...(job.timing && typeof job.timing === "object" && !Array.isArray(job.timing) ? job.timing : {}),
        time_to_l1_ready_ms: elapsedMs(job.created_at, session?.l1_ready_at),
        time_to_l2_ready_ms: elapsedMs(job.created_at, session?.l2_ready_at),
        paired_l1_wait_ms: elapsedMs(job.created_at, pairedL1ReleasedAt),
        scheduler_queue_wait_ms: elapsedMs(schedulerReadyAt, job.started_at),
        worker_queue_wait_ms: elapsedMs(schedulerReadyAt, job.started_at),
        total_created_to_worker_start_ms: elapsedMs(job.created_at, job.started_at),
        worker_processing_ms: elapsedMs(job.started_at, job.completed_at),
        writer_visible_recognition_ms: elapsedMs(recognitionStartedAt, recognitionCompletedAt)
      };
      const operationalStatus = {
        job_id: job.id,
        batch_id: job.batch_id,
        tenant_id: job.tenant_id || null,
        asset_id: job.asset_id,
        recognition_session_id: job.recognition_session_id,
        lane: job.lane || null,
        job_type: job.job_type || null,
        parent_job_id: job.parent_job_id || null,
        paired_job_id: job.paired_job_id || null,
        status: job.status,
        internal_status: display.internal_status,
        writer_status: display.writer_status,
        writer_display_title: display.writer_display_title,
        display_status: display.display_status,
        display_title: display.display_title,
        title_stage: display.title_stage,
        current_best_title: display.current_best_title,
        is_final: display.is_final,
        can_writer_start: display.can_writer_start,
        pending_modules: display.pending_modules,
        background_modules: display.background_modules,
        l1_status: session?.l1_status || "PENDING",
        l1_title: "",
        l1_ready_at: session?.l1_ready_at || null,
        l2_status: session?.l2_status || "PENDING",
        l2_title: session?.l2_status === "READY" ? (session?.l2_title || session?.final_title || "") : "",
        l2_ready_at: session?.l2_ready_at || null,
        recognition_started_at: recognitionStartedAt,
        recognition_start_source: recognitionStartSource,
        recognition_completed_at: recognitionCompletedAt,
        timing,
        end_to_end_node_ledger: buildEndToEndNodeLedger({ session, job, timing, display }),
        attempt_count: job.attempt_count,
        max_attempts: job.max_attempts,
        retry_count: Number(job.retry_count ?? Math.max(0, Number(job.attempt_count || 0) - 1)),
        canonical_state: job.canonical_state || null,
        last_error: job.last_error || job.error?.message || null,
        error_type: job.error_type || job.error?.code || null,
        next_retry_at: job.next_retry_at || (job.status === "RETRYING" ? job.not_before : null),
        priority: job.priority,
        execution_control: {
          provider_capacity_slot: Number(job.queue_tags?.provider_capacity_slot || 0) || null,
          provider_key_slot: Number(job.queue_tags?.provider_key_slot || 0) || null,
          provider_capacity: Number(job.queue_tags?.provider_capacity || 0) || null,
          provider_key_count: Number(job.queue_tags?.provider_key_count || 0) || null,
          provider_per_key_concurrency: Number(job.queue_tags?.provider_per_key_concurrency || 0) || null,
          provider_key_assignment: job.queue_tags?.provider_key_assignment || null,
          provider_capacity_lease_owner: job.queue_tags?.provider_capacity_lease_owner || null,
          provider_capacity_leased_at: job.queue_tags?.provider_capacity_leased_at || null,
          scheduling_fairness_scope: job.queue_tags?.scheduling_fairness_scope || null,
          scheduling_fairness_key: job.queue_tags?.scheduling_fairness_key || null,
          paired_l1_released_at: pairedL1ReleasedAt
        },
        created_at: job.created_at,
        updated_at: job.updated_at,
        started_at: job.started_at,
        completed_at: job.completed_at,
        lease_expires_at: job.lease_expires_at,
        error: job.error,
        result: job.result,
        session: operationalSessionStatus(session, job)
      };
      return canViewOperations
        ? operationalStatus
        : writerJobStatus({ job, session, display, timing });
    })
  }));
}
