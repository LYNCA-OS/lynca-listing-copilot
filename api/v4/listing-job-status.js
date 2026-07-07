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
    select: "id,status,final_title,provider_result_summary,updated_at,failure_reason",
    search: {
      id: `in.(${sessionIds.map((id) => `"${id.replaceAll('"', '\\"')}"`).join(",")})`,
      limit: String(sessionIds.length)
    }
  });
  if (!result.ok) return {};
  return Object.fromEntries(result.rows.map((row) => [row.id, row]));
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
      return {
        job_id: job.id,
        batch_id: job.batch_id,
        asset_id: job.asset_id,
        recognition_session_id: job.recognition_session_id,
        status: job.status,
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
