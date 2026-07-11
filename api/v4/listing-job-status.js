import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { getSessionFromRequest } from "../../lib/listing-session.mjs";
import { readV4RecognitionJobs, v4JobStatuses } from "../../lib/listing/v4/jobs/production-job-queue.mjs";
import { buildEndToEndNodeLedger } from "../../lib/listing/v4/jobs/end-to-end-node-observability.mjs";
import { withV4Version } from "../../lib/listing/v4/schema/version.mjs";
import { readV4Rows } from "../../lib/listing/v4/session/supabase-rest.mjs";
import { sendJson } from "../../lib/listing/v4/session/http-handler-utils.mjs";

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

async function readSessionsForJobs(jobs = []) {
  const sessionIds = [...new Set(jobs.map((job) => job.recognition_session_id).filter(Boolean))];
  if (!sessionIds.length) return {};
  const result = await readV4Rows({
    table: "v4_recognition_sessions",
    select: "id,status,final_title,l1_status,l1_ready_at,l1_route,l1_timing,l2_status,l2_title,l2_ready_at,l2_route,l2_timing,provider_result_summary,candidate_control_plane_trace,resolved_fields,field_states,updated_at,failure_reason",
    search: {
      id: `in.(${sessionIds.map((id) => `"${id.replaceAll('"', '\\"')}"`).join(",")})`,
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

function writerSafeSessionStatus(session = null, job = null) {
  if (!session) return null;
  const activeRetry = jobStillActive(job);
  const summary = session.provider_result_summary && typeof session.provider_result_summary === "object"
    ? session.provider_result_summary
    : {};
  const trace = session.candidate_control_plane_trace && typeof session.candidate_control_plane_trace === "object"
    ? session.candidate_control_plane_trace
    : {};
  const l2Ready = session.l2_status === "READY" && (session.final_title || session.l2_title);
  const assistedDraftStatus = activeRetry && !l2Ready
    ? "RUNNING"
    : summary.assisted_draft_status || (l2Ready ? "READY" : null);
  return {
    id: session.id || null,
    status: activeRetry && !l2Ready ? "RUNNING" : session.status || null,
    final_title: l2Ready ? (session.final_title || session.l2_title || "") : "",
    l1_status: session.l1_status || "PENDING",
    l1_title: "",
    l1_ready_at: session.l1_ready_at || null,
    l1_route: session.l1_route || null,
    l1_timing: session.l1_timing || null,
    l2_status: activeRetry && !l2Ready ? "PENDING" : session.l2_status || "PENDING",
    l2_title: l2Ready ? (session.l2_title || session.final_title || "") : "",
    l2_ready_at: session.l2_ready_at || null,
    l2_route: session.l2_route || null,
    l2_timing: session.l2_timing || null,
    provider_result_summary: {
      assisted_draft_status: assistedDraftStatus,
      provider: summary.provider || null,
      model: summary.model || summary.model_id || null,
      confidence: summary.confidence || null,
      provider_latency_ms: summary.provider_latency_ms ?? null,
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
      v4_l2_timing: summary.v4_l2_timing || null
    },
    candidate_control_plane_trace: {
      catalog_activation_funnel: trace.catalog_activation_funnel || {},
      vector_activation_funnel: trace.vector_activation_funnel || {}
    },
    resolved_fields: session.resolved_fields && typeof session.resolved_fields === "object" ? session.resolved_fields : {},
    field_states: session.field_states && typeof session.field_states === "object" ? session.field_states : {},
    updated_at: session.updated_at || null,
    failure_reason: activeRetry && !l2Ready ? null : session.failure_reason || null
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
  const l2Ready = session.l2_status === "READY" && (session.l2_title || session.final_title);
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
  if (req.method !== "GET") {
    sendJson(res, 405, withV4Version({ ok: false, message: "Method not allowed" }));
    return;
  }
  if (!getSessionFromRequest(req)) {
    sendJson(res, 401, withV4Version({ ok: false, message: "Unauthorized" }));
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
  const result = await readV4RecognitionJobs({ batchId, jobIds, limit: Number(queryParam(req, "limit") || 200) });
  if (!result.ok) {
    // A valid status query can fail when PostgREST or its connection pool has a
    // transient read outage. Report service unavailability so every client can
    // retry without mistaking an infrastructure fault for an invalid request.
    sendJson(res, 503, withV4Version({
      ok: false,
      retryable: true,
      error_code: "V4_JOB_STATUS_BACKEND_UNAVAILABLE",
      message: result.error || "Unable to read V4 jobs."
    }));
    return;
  }
  const sessions = await readSessionsForJobs(result.rows);
  sendJson(res, 200, withV4Version({
    ok: true,
    batch_id: batchId || null,
    job_count: result.rows.length,
    jobs: result.rows.map((job) => {
      const session = sessions[job.recognition_session_id] || null;
      const display = displayStateForSession(session, job);
      const pairedL1ReleasedAt = job.queue_tags?.paired_l1_released_at || null;
      const schedulerReadyAt = pairedL1ReleasedAt || job.created_at;
      const timing = {
        ...(job.timing && typeof job.timing === "object" && !Array.isArray(job.timing) ? job.timing : {}),
        time_to_l1_ready_ms: elapsedMs(job.created_at, session?.l1_ready_at),
        time_to_l2_ready_ms: elapsedMs(job.created_at, session?.l2_ready_at),
        paired_l1_wait_ms: elapsedMs(job.created_at, pairedL1ReleasedAt),
        scheduler_queue_wait_ms: elapsedMs(schedulerReadyAt, job.started_at),
        worker_queue_wait_ms: elapsedMs(schedulerReadyAt, job.started_at),
        total_created_to_worker_start_ms: elapsedMs(job.created_at, job.started_at),
        worker_processing_ms: elapsedMs(job.started_at, job.completed_at)
      };
      return {
        job_id: job.id,
        batch_id: job.batch_id,
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
        timing,
        end_to_end_node_ledger: buildEndToEndNodeLedger({ session, job, timing, display }),
        attempt_count: job.attempt_count,
        max_attempts: job.max_attempts,
        priority: job.priority,
        execution_control: {
          provider_capacity_slot: Number(job.queue_tags?.provider_capacity_slot || 0) || null,
          provider_key_slot: Number(job.queue_tags?.provider_key_slot || 0) || null,
          provider_capacity: Number(job.queue_tags?.provider_capacity || 0) || null,
          provider_per_key_concurrency: Number(job.queue_tags?.provider_per_key_concurrency || 0) || null,
          provider_capacity_lease_owner: job.queue_tags?.provider_capacity_lease_owner || null,
          provider_capacity_leased_at: job.queue_tags?.provider_capacity_leased_at || null,
          paired_l1_released_at: pairedL1ReleasedAt
        },
        created_at: job.created_at,
        updated_at: job.updated_at,
        started_at: job.started_at,
        completed_at: job.completed_at,
        lease_expires_at: job.lease_expires_at,
        error: job.error,
        result: job.result,
        session: writerSafeSessionStatus(session, job)
      };
    })
  }));
}
