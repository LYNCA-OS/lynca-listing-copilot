import { enforceApiRateLimit } from "../../lib/api-rate-limit.mjs";
import { getSessionFromRequest } from "../../lib/listing-session.mjs";
import { readV4RecognitionJobs } from "../../lib/listing/v4/jobs/production-job-queue.mjs";
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
    select: "id,status,final_title,l1_status,l1_title,l1_ready_at,l1_route,l1_timing,l2_status,l2_title,l2_ready_at,l2_route,l2_timing,provider_result_summary,updated_at,failure_reason",
    search: {
      id: `in.(${sessionIds.map((id) => `"${id.replaceAll('"', '\\"')}"`).join(",")})`,
      limit: String(sessionIds.length)
    }
  });
  if (!result.ok) return {};
  return Object.fromEntries(result.rows.map((row) => [row.id, row]));
}

function displayStateForSession(session = null) {
  if (!session) {
    return {
      display_status: "PENDING",
      display_title: "",
      title_stage: "PENDING",
      current_best_title: "",
      is_final: false,
      can_writer_start: false,
      pending_modules: ["fast_scout_draft", "final_assisted_title"],
      background_modules: ["final_assisted_title"]
    };
  }
  const l2Ready = session.l2_status === "READY" && (session.l2_title || session.final_title);
  const title = l2Ready
    ? (session.l2_title || session.final_title || "")
    : "";
  if (l2Ready) {
    return {
      display_status: "FINAL_READY",
      display_title: title,
      title_stage: "L2_ASSISTED_DRAFT",
      current_best_title: title,
      is_final: true,
      can_writer_start: true,
      pending_modules: [],
      background_modules: []
    };
  }
  if (session.l1_status === "READY") {
    return {
      display_status: "PROCESSING_FINAL",
      display_title: "",
      title_stage: "L1_INTERNAL_SCOUT",
      current_best_title: "",
      is_final: false,
      can_writer_start: false,
      pending_modules: ["final_assisted_title"],
      background_modules: ["final_assisted_title"]
    };
  }
  return {
    display_status: session.failure_reason ? "FAILED" : "PENDING",
    display_title: "",
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
  const result = await readV4RecognitionJobs({ batchId, jobIds, limit: Number(queryParam(req, "limit") || 200) });
  if (!result.ok) {
    sendJson(res, 400, withV4Version({ ok: false, message: result.error || "Unable to read V4 jobs." }));
    return;
  }
  const sessions = await readSessionsForJobs(result.rows);
  sendJson(res, 200, withV4Version({
    ok: true,
    batch_id: batchId || null,
    job_count: result.rows.length,
    jobs: result.rows.map((job) => {
      const session = sessions[job.recognition_session_id] || null;
      const display = displayStateForSession(session);
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
        display_status: display.display_status,
        display_title: display.display_title,
        title_stage: display.title_stage,
        current_best_title: display.current_best_title,
        is_final: display.is_final,
        can_writer_start: display.can_writer_start,
        pending_modules: display.pending_modules,
        background_modules: display.background_modules,
        l1_status: session?.l1_status || "PENDING",
        l1_title: session?.l1_title || "",
        l2_status: session?.l2_status || "PENDING",
        l2_title: session?.l2_title || "",
        timing: {
          time_to_l1_ready_ms: elapsedMs(job.created_at, session?.l1_ready_at),
          time_to_l2_ready_ms: elapsedMs(job.created_at, session?.l2_ready_at),
          worker_queue_wait_ms: elapsedMs(job.created_at, job.started_at),
          worker_processing_ms: elapsedMs(job.started_at, job.completed_at)
        },
        attempt_count: job.attempt_count,
        max_attempts: job.max_attempts,
        priority: job.priority,
        created_at: job.created_at,
        updated_at: job.updated_at,
        started_at: job.started_at,
        completed_at: job.completed_at,
        lease_expires_at: job.lease_expires_at,
        error: job.error,
        result: job.result,
        session
      };
    })
  }));
}
