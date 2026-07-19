import assert from "node:assert/strict";
import { createListingSessionToken, cookieName } from "../lib/listing-session.mjs";
import jobStatusHandler from "../api/v4/listing-job-status.js";
import sessionStatusHandler from "../api/v4/listing-session-status.js";

const originalEnv = {
  METAVERSE_AUTH_SECRET: process.env.METAVERSE_AUTH_SECRET,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  API_RATE_LIMIT_DISABLED: process.env.API_RATE_LIMIT_DISABLED
};
const originalFetch = globalThis.fetch;

process.env.METAVERSE_AUTH_SECRET = "writer-api-boundary-secret";
process.env.SUPABASE_URL = "https://writer-boundary.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_writer_boundary";
process.env.API_RATE_LIMIT_DISABLED = "true";

let membershipRole = "WRITER";

const sessionRow = {
  id: "session_writer",
  tenant_id: "tenant_a",
  operator_id: "manager_a",
  created_by_user_id: "manager_a",
  assigned_to_user_id: "writer_a",
  status: "L2_READY",
  final_title: "2024 Topps Chrome Test Player",
  l1_status: "READY",
  l1_ready_at: "2026-07-15T00:00:02.000Z",
  l1_route: "internal_scout",
  l1_timing: { provider_ms: 100 },
  l2_status: "READY",
  l2_title: "2024 Topps Chrome Test Player",
  l2_ready_at: "2026-07-15T00:00:05.000Z",
  l2_route: "provider_route",
  l2_timing: { provider_ms: 900 },
  provider_result_summary: {
    assisted_draft_status: "READY",
    recognition_clock_started_at: "2026-07-15T00:00:03.000Z",
    recognition_clock_source: "gpt_provider_request",
    provider_key_pool_size: 12,
    provider_key_slot: 7,
    provider_rate_limit_diagnostics: { remaining: 99 },
    catalog_stage_capacity: { global_capacity: 8 },
    provider_capacity_stage_handoff: { lease_owner: "internal-worker" }
  },
  candidate_control_plane_trace: { internal_candidate_ids: ["secret-candidate"] },
  request_summary: { provider: "internal-provider" },
  resolved_fields: { year: "2024", players: ["Test Player"] },
  field_states: { year: { display_status: "NORMAL" } },
  failure_reason: null,
  updated_at: "2026-07-15T00:00:05.000Z"
};

const jobRow = {
  id: "job_writer",
  tenant_id: "tenant_a",
  batch_id: "batch_a",
  operator_id: "manager_a",
  asset_id: "asset_a",
  recognition_session_id: "session_writer",
  lane: "interactive",
  job_type: "FINAL_ASSISTED_TITLE",
  status: "L2_READY",
  canonical_state: "SUCCESS",
  retry_count: 1,
  attempt_count: 2,
  max_attempts: 4,
  priority: 10,
  queue_tags: {
    provider_capacity_slot: 3,
    provider_key_slot: 7,
    provider_capacity: 12,
    provider_key_count: 12,
    provider_per_key_concurrency: 2,
    provider_key_assignment: "internal-key-7",
    provider_capacity_lease_owner: "internal-worker",
    provider_capacity_leased_at: "2026-07-15T00:00:03.000Z"
  },
  timing: { raw_provider_timing: { secret: true } },
  error: { message: "internal upstream error", code: "INTERNAL_PROVIDER_ERROR" },
  result: { internal_provider_response: "private" },
  last_error: "internal upstream error",
  error_type: "INTERNAL_PROVIDER_ERROR",
  created_at: "2026-07-15T00:00:00.000Z",
  updated_at: "2026-07-15T00:00:05.000Z",
  started_at: "2026-07-15T00:00:03.000Z",
  completed_at: "2026-07-15T00:00:05.000Z",
  lease_expires_at: "2026-07-15T00:02:03.000Z"
};

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function membershipRow() {
  return {
    tenant_id: "tenant_a",
    user_id: "writer_a",
    role: membershipRole,
    status: "ACTIVE",
    disabled_at: null,
    user: {
      id: "writer_a",
      email: "writer@example.test",
      status: "ACTIVE",
      session_version: 1,
      disabled_at: null,
      auth_user_id: "auth_writer_a"
    },
    tenant: {
      id: "tenant_a",
      name: "Tenant A",
      plan: "pilot",
      status: "ACTIVE",
      disabled_at: null
    }
  };
}

function sessionCookie() {
  const token = createListingSessionToken({
    userId: "writer_a",
    tenantId: "tenant_a",
    email: "writer@example.test",
    sessionVersion: 1
  }, process.env.METAVERSE_AUTH_SECRET);
  return `${cookieName}=${token}`;
}

function responseRecorder() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = String(value);
    },
    end(value = "") {
      this.body = String(value || "");
    }
  };
}

async function callGet(handler, url) {
  const req = {
    method: "GET",
    url,
    headers: { cookie: sessionCookie(), "x-request-id": `req-${membershipRole.toLowerCase()}` }
  };
  const res = responseRecorder();
  await handler(req, res);
  return { statusCode: res.statusCode, body: JSON.parse(res.body || "null") };
}

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.pathname === "/rest/v1/tenant_members") return jsonResponse([membershipRow()]);
  if (["/rest/v1/request_logs", "/rest/v1/error_logs", "/rest/v1/production_events"].includes(url.pathname)) {
    return jsonResponse([], 201);
  }
  assert.equal(url.searchParams.get("tenant_id"), "eq.tenant_a", "service-role status reads must remain tenant-scoped");
  if (url.pathname === "/rest/v1/v4_recognition_jobs") return jsonResponse([jobRow]);
  if (url.pathname === "/rest/v1/v4_recognition_sessions") return jsonResponse([sessionRow]);
  throw new Error(`unexpected fetch ${url.pathname}`);
};

try {
  membershipRole = "WRITER";
  const writerSession = await callGet(
    sessionStatusHandler,
    "/api/v4/listing-session-status?session_id=session_writer&include_related_counts=true"
  );
  assert.equal(writerSession.statusCode, 200);
  assert.equal(writerSession.body.related_counts_included, false, "Writer cannot request operational row counts");
  assert.equal(writerSession.body.session.final_title, sessionRow.final_title);
  assert.deepEqual(writerSession.body.session.resolved_fields, sessionRow.resolved_fields);
  assert.equal("tenant_id" in writerSession.body.session, false);
  assert.equal("operator_id" in writerSession.body.session, false);
  assert.equal("request_summary" in writerSession.body.session, false);
  assert.equal("candidate_control_plane_trace" in writerSession.body.session, false);
  assert.equal("provider_key_pool_size" in writerSession.body.session.provider_result_summary, false);
  assert.equal("provider_rate_limit_diagnostics" in writerSession.body.session.provider_result_summary, false);

  const writerJobs = await callGet(jobStatusHandler, "/api/v4/listing-job-status?job_id=job_writer");
  assert.equal(writerJobs.statusCode, 200);
  const writerJob = writerJobs.body.jobs[0];
  assert.equal(writerJob.job_id, "job_writer");
  assert.equal(writerJob.l2_title, sessionRow.final_title);
  assert.equal(writerJob.writer_view_model.schema_version, "writer-job-view-v1");
  assert.equal(writerJob.writer_view_model.title.value, sessionRow.final_title);
  assert.deepEqual(writerJob.writer_view_model.actions, ["ACCEPT", "EDIT", "REJECT"]);
  for (const hiddenField of [
    "tenant_id",
    "asset_id",
    "internal_status",
    "end_to_end_node_ledger",
    "attempt_count",
    "retry_count",
    "canonical_state",
    "last_error",
    "error_type",
    "execution_control",
    "lease_expires_at",
    "error",
    "result"
  ]) {
    assert.equal(hiddenField in writerJob, false, `Writer job DTO must omit ${hiddenField}`);
  }
  assert.deepEqual(Object.keys(writerJob.timing).sort(), [
    "time_to_l2_ready_ms",
    "worker_processing_ms",
    "worker_queue_wait_ms",
    "writer_visible_recognition_ms"
  ]);
  assert.equal("provider_key_slot" in writerJob.session.provider_result_summary, false);
  assert.equal("candidate_control_plane_trace" in writerJob.session, false);
  assert.equal(writerJob.failure, null, "successful writer jobs must not expose stale internal errors");

  jobRow.status = "FAILED";
  jobRow.error = {
    message: "private upstream path and provider detail",
    code: "STALE_IMAGE_GENERATION",
    retryable: false,
    recovery_action: "INPUT_REBIND"
  };
  sessionRow.status = "FAILED";
  sessionRow.failure_reason = "private upstream path and provider detail";
  const failedWriterJobs = await callGet(jobStatusHandler, "/api/v4/listing-job-status?job_id=job_writer");
  const failedWriterJob = failedWriterJobs.body.jobs[0];
  assert.equal(failedWriterJob.failure.code, "STALE_IMAGE_GENERATION");
  assert.equal(failedWriterJob.failure.recovery_action, "INPUT_REBIND");
  assert.match(failedWriterJob.failure.message, /重新绑定当前图片/);
  assert.doesNotMatch(JSON.stringify(failedWriterJob), /private upstream path|provider detail/);
  assert.equal("error" in failedWriterJob, false);

  jobRow.error = {
    message: "legacy row without recovery action",
    code: "CANONICAL_IMAGE_GENERATION_MISSING",
    retryable: true
  };
  const legacyFailedWriterJobs = await callGet(jobStatusHandler, "/api/v4/listing-job-status?job_id=job_writer");
  assert.equal(legacyFailedWriterJobs.body.jobs[0].failure.recovery_action, "INPUT_REBIND");
  assert.match(legacyFailedWriterJobs.body.jobs[0].failure.message, /重新绑定当前图片/);

  jobRow.error = null;
  jobRow.error_type = "CANONICAL_IMAGE_GENERATION_MISSING";
  const legacyErrorTypeOnlyJobs = await callGet(jobStatusHandler, "/api/v4/listing-job-status?job_id=job_writer");
  assert.equal(legacyErrorTypeOnlyJobs.body.jobs[0].failure.code, "CANONICAL_IMAGE_GENERATION_MISSING");
  assert.equal(legacyErrorTypeOnlyJobs.body.jobs[0].failure.recovery_action, "INPUT_REBIND");
  assert.match(legacyErrorTypeOnlyJobs.body.jobs[0].failure.message, /重新绑定当前图片/);

  jobRow.status = "L2_READY";
  jobRow.error_type = "INTERNAL_PROVIDER_ERROR";
  jobRow.error = { message: "internal upstream error", code: "INTERNAL_PROVIDER_ERROR" };
  sessionRow.status = "L2_READY";
  sessionRow.failure_reason = null;

  membershipRole = "MANAGER";
  const managerSession = await callGet(sessionStatusHandler, "/api/v4/listing-session-status?session_id=session_writer");
  assert.equal(managerSession.statusCode, 200);
  assert.equal(managerSession.body.session.tenant_id, "tenant_a");
  assert.equal(managerSession.body.session.provider_result_summary.provider_key_pool_size, 12);

  const managerJobs = await callGet(jobStatusHandler, "/api/v4/listing-job-status?job_id=job_writer");
  assert.equal(managerJobs.statusCode, 200);
  const managerJob = managerJobs.body.jobs[0];
  assert.equal(managerJob.writer_view_model.schema_version, "writer-job-view-v1");
  assert.equal(managerJob.tenant_id, "tenant_a");
  assert.equal(managerJob.retry_count, 1);
  assert.equal(managerJob.execution_control.provider_key_slot, 7);
  assert.ok(managerJob.end_to_end_node_ledger);
  assert.equal(managerJob.session.provider_result_summary.provider_key_pool_size, 12);
} finally {
  globalThis.fetch = originalFetch;
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

console.log("Writer API data boundary tests passed.");
