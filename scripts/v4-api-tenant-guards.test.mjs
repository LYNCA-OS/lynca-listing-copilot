import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { cookieName, createListingSessionToken } from "../lib/listing-session.mjs";
import sessionStatusHandler from "../api/v4/listing-session-status.js";
import enqueueHandler from "../api/v4/listing-job-enqueue.js";
import exportHandler, { writerExportFailureResponse } from "../api/v4/listing-export-workbook.js";
import feedbackHandler from "../api/v4/listing-feedback.js";
import recognitionHandler from "../api/v4/listing-copilot-title.js";

const apiPaths = [
  "api/v4/listing-job-enqueue.js",
  "api/v4/listing-job-assign.js",
  "api/v4/listing-job-status.js",
  "api/v4/listing-job-retry.js",
  "api/v4/listing-session-status.js",
  "api/v4/listing-feedback.js",
  "api/v4/listing-export-workbook.js",
  "api/v4/listing-job-prewarm.js",
  "api/v4/fast-scout-prewarm.js",
  "api/v4/tenant-settings.js"
];
const sources = Object.fromEntries(await Promise.all(apiPaths.map(async (path) => [path, await readFile(path, "utf8")])));

for (const [path, source] of Object.entries(sources)) {
  assert.match(source, /requireTenantAccess\(req(?:,|\))/, `${path} must derive a trusted membership context`);
  assert.match(source, /publicTenantAuthError\(error\)/, `${path} must return a bounded auth error`);
  assert.doesNotMatch(source, /getSessionFromRequest|operatorIdFromRequest/, `${path} must not use legacy identity as authorization`);
}

const enqueueSource = sources["api/v4/listing-job-enqueue.js"];
assert.match(enqueueSource, /queueJobsRequireCreatePermission\(rawJobs\)[\s\S]*requirePermission\(context, TENANT_PERMISSIONS\.CREATE_JOB\)/);
assert.match(enqueueSource, /permissionContext: context/);
assert.match(enqueueSource, /tenantId = context\.tenantId/);
assert.match(enqueueSource, /operatorId = context\.userId/);
assert.match(enqueueSource, /function withoutClientSessionIdentity\(job = \{\}\)/);
assert.match(enqueueSource, /"tenant_id", "tenantId",[\s\S]*"operator_id", "operatorId",/);
assert.match(enqueueSource, /canonicalizeQueueJobs\(\{[\s\S]*jobs: rawJobs,[\s\S]*tenantId,[\s\S]*fetchImpl: globalThis\.fetch/);
assert.match(enqueueSource, /expandV4RecognitionStageJobs\(\{[\s\S]*jobs: sourceJobs,[\s\S]*operatorId,[\s\S]*tenantId,/);
assert.match(enqueueSource, /enqueueV4RecognitionJobs\(\{[\s\S]*jobs: stageJobs,[\s\S]*operatorId,[\s\S]*tenantId,/);
assert.doesNotMatch(enqueueSource, /const tenantId = payload\.(?:tenant_id|tenantId)/);

const jobStatusSource = sources["api/v4/listing-job-status.js"];
assert.match(jobStatusSource, /readV4RecognitionJobs\(\{[\s\S]*tenantId: context\.tenantId/);
assert.match(jobStatusSource, /tenant_id: `eq\.\$\{tenantId\}`/);
assert.match(jobStatusSource, /assignedUserId: session\?\.assigned_to_user_id/);
assert.match(jobStatusSource, /TENANT_PERMISSIONS\.VIEW_ASSIGNED_TASK/);
for (const retryField of ["retry_count", "canonical_state", "last_error", "error_type", "next_retry_at"]) {
  assert.match(jobStatusSource, new RegExp(`${retryField}:`), `job status must expose ${retryField}`);
}

const retrySource = sources["api/v4/listing-job-retry.js"];
assert.match(retrySource, /TENANT_PERMISSIONS\.RETRY_JOB/);
assert.match(retrySource, /sendJson\(res, 410,[\s\S]*V4_FRESH_ENQUEUE_REQUIRED/);
assert.doesNotMatch(retrySource, /retryV4RecognitionJob|patchV4Row/);

const sessionStatusSource = sources["api/v4/listing-session-status.js"];
assert.match(sessionStatusSource, /readV4SessionStatus\(\{ sessionId, tenantId: context\.tenantId \}\)/);
assert.match(sessionStatusSource, /assignedUserId: status\.session\.assigned_to_user_id/);
assert.match(sessionStatusSource, /tenant_id: `eq\.\$\{context\.tenantId\}`/);

const feedbackSource = sources["api/v4/listing-feedback.js"];
assert.match(feedbackSource, /TENANT_PERMISSIONS\.SUBMIT_FEEDBACK/);
assert.match(feedbackSource, /const tenantId = context\.tenantId/);
assert.match(feedbackSource, /readV4SessionStatus\(\{ sessionId, tenantId \}\)/);
assert.match(feedbackSource, /reviewedSemanticFields: false/);
assert.match(feedbackSource, /sharedPromotion: false/);
assert.match(feedbackSource, /training_eligible: false/);
assert.doesNotMatch(feedbackSource, /upsertCertRegistryEntry|waitUntil\(/, "public tenant feedback must never promote shared registry truth");

const exportSource = sources["api/v4/listing-export-workbook.js"];
assert.match(exportSource, /TENANT_PERMISSIONS\.EXPORT_DATA/);
assert.match(exportSource, /tenant_id: `eq\.\$\{tenantId\}`/);
assert.match(exportSource, /tenantId: context\.tenantId,[\s\S]*exportedBy: context\.userId/);
assert.match(exportSource, /objectPath\.startsWith\(prefix\)/);
const exportLimitFailure = writerExportFailureResponse(Object.assign(new Error("export image budget exceeded"), {
  code: "WRITER_EXPORT_IMAGE_BUDGET_EXCEEDED",
  statusCode: 413,
  retryable: false
}));
assert.equal(exportLimitFailure.status, 413);
assert.equal(exportLimitFailure.body.error_type, "WRITER_EXPORT_IMAGE_BUDGET_EXCEEDED");
assert.equal(exportLimitFailure.body.retryable, false);
const exportTimeoutFailure = writerExportFailureResponse(Object.assign(new Error("export image download timed out"), {
  code: "WRITER_EXPORT_IMAGE_DOWNLOAD_TIMEOUT",
  statusCode: 504,
  retryable: true
}));
assert.equal(exportTimeoutFailure.status, 504);
assert.equal(exportTimeoutFailure.body.error_type, "WRITER_EXPORT_IMAGE_DOWNLOAD_TIMEOUT");
assert.equal(exportTimeoutFailure.body.retryable, true);

const prewarmSource = sources["api/v4/listing-job-prewarm.js"];
assert.match(prewarmSource, /TENANT_PERMISSIONS\.CREATE_JOB/);
assert.match(prewarmSource, /const tenantId = context\.tenantId/);
assert.match(prewarmSource, /readV4RecognitionJobs\(\{[\s\S]*tenantId,/);
assert.doesNotMatch(prewarmSource, /const tenantId = payload\.(?:tenant_id|tenantId)/);

const fastScoutSource = sources["api/v4/fast-scout-prewarm.js"];
assert.match(fastScoutSource, /TENANT_PERMISSIONS\.CREATE_JOB/);
assert.match(fastScoutSource, /\.\.\.payload,[\s\S]*tenant_id: context\.tenantId,[\s\S]*operator_id: context\.userId/);
assert.match(fastScoutSource, /request_id: context\.requestId,[\s\S]*tenant_id: context\.tenantId/);
assert.match(fastScoutSource, /allowProviderCall: false/, "customer fast-scout prewarm must remain cache-only");

const tenantSettingsSource = sources["api/v4/tenant-settings.js"];
assert.match(tenantSettingsSource, /TENANT_PERMISSIONS\.CONFIGURE_TENANT/);
assert.match(tenantSettingsSource, /table: "tenants",[\s\S]*id: context\.tenantId,[\s\S]*requireMatch: true/);
assert.doesNotMatch(tenantSettingsSource, /payload\.(?:tenant_id|tenantId|plan)/);

const recognitionCoreBridgeSource = await readFile("api/v4/listing-copilot-title.js", "utf8");
assert.match(recognitionCoreBridgeSource, /fenceV4RecognitionJobExecution\(\{/);
assert.match(recognitionCoreBridgeSource, /scopeV4RecognitionPayloadFromFencedJob\(fenced\.job\)/);
assert.match(recognitionCoreBridgeSource, /resolveV4WorkerSessionIdentity\(\{/);
assert.match(recognitionCoreBridgeSource, /V4_DURABLE_ENQUEUE_REQUIRED/);
assert.match(recognitionCoreBridgeSource, /V4_WORKER_JOB_LEASE_FENCE_FAILED/);
assert.match(recognitionCoreBridgeSource, /V4_SESSION_STATE_PERSISTENCE_FAILED/);
assert.match(recognitionCoreBridgeSource, /callRecognitionCoreWithGpt5EmptyRetry\(\{[\s\S]*signal: req\.signal/);

const originalEnv = {
  METAVERSE_AUTH_SECRET: process.env.METAVERSE_AUTH_SECRET,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  API_RATE_LIMIT_DISABLED: process.env.API_RATE_LIMIT_DISABLED
};
const originalFetch = globalThis.fetch;
process.env.METAVERSE_AUTH_SECRET = "track-c-api-guard-test-secret";
process.env.SUPABASE_URL = "https://tenant-guard-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_track_c_api_guard_test";
process.env.API_RATE_LIMIT_DISABLED = "true";

function membershipRow({ role, userId = "user_writer", tenantId = "tenant_a" }) {
  return {
    tenant_id: tenantId,
    user_id: userId,
    role,
    status: "ACTIVE",
    disabled_at: null,
    user: {
      id: userId,
      email: `${userId}@example.test`,
      status: "ACTIVE",
      session_version: 1,
      disabled_at: null,
      auth_user_id: `auth_${userId}`
    },
    tenant: {
      id: tenantId,
      name: "Tenant A",
      plan: "pilot",
      status: "ACTIVE",
      disabled_at: null
    }
  };
}

function sessionCookie({ userId, tenantId = "tenant_a" }) {
  const token = createListingSessionToken({
    userId,
    tenantId,
    email: `${userId}@example.test`,
    sessionVersion: 1
  }, process.env.METAVERSE_AUTH_SECRET);
  return `${cookieName}=${token}`;
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function responseRecorder() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[String(key).toLowerCase()] = String(value);
    },
    end(value = "") {
      this.body = String(value || "");
    }
  };
}

async function callGet(handler, { url, headers }) {
  const req = { method: "GET", url, headers };
  const res = responseRecorder();
  await handler(req, res);
  return { statusCode: res.statusCode, body: JSON.parse(res.body || "null") };
}

async function callPost(handler, { headers, payload = {} }) {
  const req = Readable.from([JSON.stringify(payload)]);
  req.method = "POST";
  req.url = "/";
  req.headers = headers;
  const res = responseRecorder();
  await handler(req, res);
  return { statusCode: res.statusCode, body: JSON.parse(res.body || "null") };
}

function mockTenantFetch({
  role,
  userId,
  assignedUserId = userId,
  observedDataUrls = [],
  observedPersistenceCalls = []
}) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/tenant_members") {
      assert.equal(url.searchParams.get("tenant_id"), "eq.tenant_a");
      assert.equal(url.searchParams.get("user_id"), `eq.${userId}`);
      return jsonResponse([membershipRow({ role, userId })]);
    }
    if (["/rest/v1/request_logs", "/rest/v1/error_logs", "/rest/v1/production_events"].includes(url.pathname)) {
      const body = init.body ? JSON.parse(init.body) : {};
      assert.equal(body.tenant_id, "tenant_a", "operational telemetry must inherit trusted tenant context");
      return jsonResponse([], 201);
    }
    if (url.pathname === "/rest/v1/rpc/persist_v4_writer_feedback_transaction") {
      const body = JSON.parse(init.body || "{}");
      observedPersistenceCalls.push(body);
      assert.equal(body.p_tenant_id, "tenant_a");
      assert.equal(body.p_operator_id, userId);
      assert.equal(body.p_feedback_event.tenant_id, "tenant_a");
      assert.equal(body.p_learning_event.tenant_id, "tenant_a");
      return jsonResponse([{
        saved: true,
        status: body.p_session_status,
        feedback_event_id: body.p_feedback_event.id,
        learning_event_id: body.p_learning_event.id,
        writer_final_title: body.p_feedback_event.writer_final_title
      }]);
    }
    observedDataUrls.push(url);
    assert.equal(url.searchParams.get("tenant_id"), "eq.tenant_a", "every service-role data read must carry tenant scope");
    if (url.pathname === "/rest/v1/v4_recognition_sessions") {
      return jsonResponse([{
        id: "session_target",
        tenant_id: "tenant_a",
        operator_id: "user_manager",
        created_by_user_id: "user_manager",
        assigned_to_user_id: assignedUserId,
        status: "WRITER_REVIEW",
        l2_status: "READY",
        l2_title: "Tenant-safe title",
        final_title: "Tenant-safe title",
        provider_result_summary: {
          title_length_policy: { max_length: 80 }
        }
      }]);
    }
    throw new Error(`unexpected fetch ${url.pathname}`);
  };
}

try {
  const observedDataUrls = [];
  globalThis.fetch = mockTenantFetch({
    role: "WRITER",
    userId: "user_writer",
    assignedUserId: "user_writer",
    observedDataUrls
  });
  const assigned = await callGet(sessionStatusHandler, {
    // A forged tenant query parameter cannot change the trusted read scope.
    url: "/api/v4/listing-session-status?session_id=session_target&tenant_id=tenant_b",
    headers: { cookie: sessionCookie({ userId: "user_writer" }), "x-request-id": "req-assigned" }
  });
  assert.equal(assigned.statusCode, 200);
  assert.equal("tenant_id" in assigned.body.session, false, "Writer DTO must not echo internal tenant columns");
  assert.ok(observedDataUrls.every((url) => url.searchParams.get("tenant_id") === "eq.tenant_a"));

  const oversizedFeedbackUrls = [];
  const oversizedPersistenceCalls = [];
  globalThis.fetch = mockTenantFetch({
    role: "WRITER",
    userId: "user_writer",
    assignedUserId: "user_writer",
    observedDataUrls: oversizedFeedbackUrls,
    observedPersistenceCalls: oversizedPersistenceCalls
  });
  const oversizedFeedback = await callPost(feedbackHandler, {
    headers: { cookie: sessionCookie({ userId: "user_writer" }), "x-request-id": "req-oversized-feedback" },
    payload: {
      recognition_session_id: "session_target",
      action: "EDIT",
      writer_final_title: "X".repeat(81)
    }
  });
  assert.equal(oversizedFeedback.statusCode, 400, "oversized listing titles must use the existing invalid-payload response");
  assert.equal(oversizedFeedback.body.error, "feedback_writer_title_exceeds_80_characters");
  assert.equal(oversizedPersistenceCalls.length, 0, "oversized feedback must be rejected before any persistence call");
  assert.equal(oversizedFeedbackUrls.some((url) => /feedback|learning/.test(url.pathname)), false);

  const validPersistenceCalls = [];
  globalThis.fetch = mockTenantFetch({
    role: "WRITER",
    userId: "user_writer",
    assignedUserId: "user_writer",
    observedPersistenceCalls: validPersistenceCalls
  });
  const validFeedback = await callPost(feedbackHandler, {
    headers: { cookie: sessionCookie({ userId: "user_writer" }), "x-request-id": "req-valid-feedback" },
    payload: {
      recognition_session_id: "session_target",
      feedback_submission_id: "submission-valid-title-0001",
      action: "EDIT",
      writer_final_title: "Writer safe title"
    }
  });
  assert.equal(validFeedback.statusCode, 200);
  assert.equal(validFeedback.body.ok, true);
  assert.equal(validFeedback.body.writer_final_title, "Writer safe title");
  assert.deepEqual(validFeedback.body.title_diff.added, ["Writer", "safe"]);
  assert.deepEqual(validFeedback.body.title_diff.removed, ["Tenant-safe"]);
  assert.equal(validPersistenceCalls.length, 1, "valid feedback must retain its single atomic persistence call");
  assert.equal(validPersistenceCalls[0].p_feedback_event.writer_final_title, "Writer safe title");

  globalThis.fetch = mockTenantFetch({
    role: "WRITER",
    userId: "user_writer",
    assignedUserId: "another_writer"
  });
  const crossAssignment = await callGet(sessionStatusHandler, {
    url: "/api/v4/listing-session-status?session_id=session_target",
    headers: { cookie: sessionCookie({ userId: "user_writer" }), "x-request-id": "req-cross-assignment" }
  });
  assert.equal(crossAssignment.statusCode, 404);
  assert.equal(crossAssignment.body.message, "Recognition session not found.");

  globalThis.fetch = mockTenantFetch({ role: "WRITER", userId: "user_writer" });
  const writerEnqueue = await callPost(enqueueHandler, {
    headers: { cookie: sessionCookie({ userId: "user_writer" }), "x-request-id": "req-writer-enqueue" },
    payload: { tenant_id: "tenant_b", operator_id: "owner_b", jobs: [] }
  });
  assert.equal(writerEnqueue.statusCode, 403, "Writer cannot create jobs even with forged tenant/actor fields");

  globalThis.fetch = mockTenantFetch({ role: "MANAGER", userId: "user_manager" });
  const managerDirectRecognition = await callPost(recognitionHandler, {
    headers: { cookie: sessionCookie({ userId: "user_manager" }), "x-request-id": "req-manager-direct-recognition" },
    payload: {
      tenant_id: "tenant_b",
      asset_id: "asset_forged",
      images: [{ url: "https://attacker.example/card.jpg" }]
    }
  });
  assert.equal(managerDirectRecognition.statusCode, 409, "customer recognition must enter through the durable queue");
  assert.equal(managerDirectRecognition.body.error_code, "V4_DURABLE_ENQUEUE_REQUIRED");

  globalThis.fetch = mockTenantFetch({ role: "MANAGER", userId: "user_manager" });
  const managerExport = await callPost(exportHandler, {
    headers: { cookie: sessionCookie({ userId: "user_manager" }), "x-request-id": "req-manager-export" },
    payload: { tenant_id: "tenant_b", rows: [] }
  });
  assert.equal(managerExport.statusCode, 403, "Manager cannot use Owner-only export capability");
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log("V4 API tenant guard tests passed.");
