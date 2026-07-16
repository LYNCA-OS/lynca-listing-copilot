import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import assignmentHandler from "../api/v4/listing-job-assign.js";
import feedbackHandler from "../api/v4/listing-feedback.js";
import retryHandler from "../api/v4/listing-job-retry.js";
import { cookieName, createListingSessionToken } from "../lib/listing-session.mjs";

const [assignmentSource, assignmentServiceSource, feedbackSource, queueSource, tenantFoundationSql] = await Promise.all([
  readFile(new URL("../api/v4/listing-job-assign.js", import.meta.url), "utf8"),
  readFile(new URL("../lib/listing/v4/jobs/job-assignment.mjs", import.meta.url), "utf8"),
  readFile(new URL("../api/v4/listing-feedback.js", import.meta.url), "utf8"),
  readFile(new URL("../lib/listing/v4/jobs/production-job-queue.mjs", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20260715065803_track_c_tenant_foundation_expand.sql", import.meta.url), "utf8")
]);

assert.match(assignmentSource, /TENANT_PERMISSIONS\.ASSIGN_TASK/);
assert.match(assignmentSource, /requireActiveTenantMember\(\{/);
assert.match(assignmentSource, /tenantId: context\.tenantId/);
assert.doesNotMatch(assignmentSource, /tenantId: payload\.(?:tenant_id|tenantId)/);
assert.match(assignmentServiceSource, /fn: "assign_v4_recognition_job"/);
assert.doesNotMatch(assignmentServiceSource, /patchV4Row/, "session and paired-job assignment must remain one database transaction");
assert.match(feedbackSource, /assignedUserId: ownedSession\.session\.assigned_to_user_id/);
const assignmentRpcStart = tenantFoundationSql.indexOf("create or replace function public.assign_v4_recognition_job(");
const assignmentRpcEnd = tenantFoundationSql.indexOf("create or replace function public.track_c_ops_snapshot(", assignmentRpcStart);
assert.ok(assignmentRpcStart >= 0 && assignmentRpcEnd > assignmentRpcStart, "missing atomic assignment RPC");
const assignmentRpcSql = tenantFoundationSql.slice(assignmentRpcStart, assignmentRpcEnd);
assert.match(assignmentRpcSql, /security definer/);
assert.match(assignmentRpcSql, /member\.status = 'ACTIVE'[\s\S]*app_user\.status = 'ACTIVE'[\s\S]*tenant\.status = 'ACTIVE'/);
assert.match(assignmentRpcSql, /if v_batch_id is null[\s\S]*related_batch_missing/);
assert.match(assignmentRpcSql, /if v_session_id is null[\s\S]*related_session_missing/);
assert.match(assignmentRpcSql, /from public\.v4_recognition_sessions[\s\S]*for update/);
assert.match(assignmentRpcSql, /from public\.v4_recognition_jobs[\s\S]*order by jobs\.id[\s\S]*for update/);
assert.doesNotMatch(assignmentRpcSql, /update public\.v4_recognition_batches[\s\S]*set assigned_to_user_id/, "a batch can contain independently assigned card sessions");
assert.match(assignmentRpcSql, /update public\.v4_recognition_sessions[\s\S]*set assigned_to_user_id = p_assigned_to_user_id/);
assert.match(assignmentRpcSql, /update public\.v4_recognition_jobs[\s\S]*recognition_session_id = v_session_id/);
assert.match(assignmentRpcSql, /'assigned_job_count', v_write_count/);
assert.doesNotMatch(assignmentRpcSql, /set\s+(?:operator_id|created_by_user_id)\s*=/, "assignment must not rewrite audit identity");
assert.match(assignmentRpcSql, /revoke all on function public\.assign_v4_recognition_job\(text, text, text\)[\s\S]*from public, anon, authenticated/);
assert.match(assignmentRpcSql, /grant execute on function public\.assign_v4_recognition_job\(text, text, text\)[\s\S]*to service_role/);
assert.match(tenantFoundationSql, /coalesce\([\s\S]*sessions\.assigned_to_user_id,[\s\S]*sessions\.created_by_user_id,[\s\S]*sessions\.operator_id[\s\S]*\)\s*= p_operator_id/);
const retryFunctionSource = queueSource.slice(queueSource.indexOf("export async function retryV4RecognitionJob"));
assert.doesNotMatch(retryFunctionSource, /operator_id:\s*`eq\./, "team retry must not require the original operator");
assert.match(retryFunctionSource, /tenant_id:\s*`eq\.\$\{normalizedTenantId\}`/);

const originalEnv = {
  METAVERSE_AUTH_SECRET: process.env.METAVERSE_AUTH_SECRET,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  API_RATE_LIMIT_DISABLED: process.env.API_RATE_LIMIT_DISABLED,
  V4_QUEUE_AUTOKICK_ENABLED: process.env.V4_QUEUE_AUTOKICK_ENABLED
};
const originalFetch = globalThis.fetch;
process.env.METAVERSE_AUTH_SECRET = "v4-assignment-api-test-secret";
process.env.SUPABASE_URL = "https://assignment-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_assignment_test";
process.env.API_RATE_LIMIT_DISABLED = "true";
process.env.V4_QUEUE_AUTOKICK_ENABLED = "false";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function authMembership({ userId, role, tenantId = "tenant_a" }) {
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

function targetMembership({ userId = "user_writer", status = "ACTIVE", tenantId = "tenant_a" } = {}) {
  return {
    tenant_id: tenantId,
    user_id: userId,
    role: "WRITER",
    status,
    disabled_at: status === "ACTIVE" ? null : "2026-07-15T08:00:00.000Z",
    created_at: "2026-07-15T07:00:00.000Z",
    updated_at: "2026-07-15T07:00:00.000Z",
    user: {
      id: userId,
      email: `${userId}@example.test`,
      status: "ACTIVE",
      disabled_at: null,
      auth_user_id: `auth_${userId}`
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

async function callPost(handler, { userId, payload, url }) {
  const req = new EventEmitter();
  req.method = "POST";
  req.url = url;
  req.headers = {
    cookie: sessionCookie({ userId }),
    "x-request-id": `req-${userId}-${Date.now()}`
  };
  const res = responseRecorder();
  const running = handler(req, res);
  setTimeout(() => {
    req.emit("data", JSON.stringify(payload ?? {}));
    req.emit("end");
  }, 0);
  await running;
  return {
    statusCode: res.statusCode || 200,
    body: JSON.parse(res.body || "null")
  };
}

function scenarioFetch({
  actorUserId,
  actorRole,
  targetStatus = "ACTIVE",
  targetExists = true,
  sessionAssignee = "user_writer",
  assignmentResult = {
    saved: true,
    job_id: "job_target",
    batch_id: "batch_target",
    recognition_session_id: "session_target",
    assigned_to_user_id: "user_writer"
  },
  calls = []
} = {}) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method, body });

    if (["/rest/v1/request_logs", "/rest/v1/error_logs", "/rest/v1/production_events"].includes(url.pathname)) {
      return jsonResponse([], 201);
    }
    if (url.pathname === "/rest/v1/tenant_members") {
      assert.equal(url.searchParams.get("tenant_id"), "eq.tenant_a");
      const select = url.searchParams.get("select") || "";
      if (select.includes("tenant:tenants")) {
        assert.equal(url.searchParams.get("user_id"), `eq.${actorUserId}`);
        return jsonResponse([authMembership({ userId: actorUserId, role: actorRole })]);
      }
      assert.equal(url.searchParams.get("user_id"), "eq.user_writer");
      return jsonResponse(targetExists
        ? [targetMembership({ userId: "user_writer", status: targetStatus })]
        : []);
    }
    if (url.pathname === "/rest/v1/rpc/assign_v4_recognition_job") {
      assert.equal(method, "POST");
      assert.deepEqual(body, {
        p_tenant_id: "tenant_a",
        p_job_id: "job_target",
        p_assigned_to_user_id: "user_writer"
      });
      assert.ok(!Object.hasOwn(body, "p_operator_id"));
      return jsonResponse(assignmentResult);
    }
    if (url.pathname === "/rest/v1/v4_recognition_sessions") {
      assert.equal(method, "GET");
      assert.equal(url.searchParams.get("tenant_id"), "eq.tenant_a");
      return jsonResponse([{
        id: "session_target",
        tenant_id: "tenant_a",
        operator_id: "user_manager",
        created_by_user_id: "user_manager",
        assigned_to_user_id: sessionAssignee,
        status: "WRITER_REVIEW",
        l2_status: "READY",
        l2_title: "2025 Example Card",
        final_title: "2025 Example Card",
        provider_result_summary: {}
      }]);
    }
    if (url.pathname === "/rest/v1/rpc/persist_v4_writer_feedback_transaction") {
      assert.equal(body.p_tenant_id, "tenant_a");
      assert.equal(body.p_session_id, "session_target");
      assert.equal(body.p_operator_id, actorUserId, "feedback must preserve the acting Writer identity");
      return jsonResponse({
        saved: true,
        tenant_id: "tenant_a",
        recognition_session_id: "session_target",
        feedback_event_id: body.p_feedback_event.id,
        learning_event_id: body.p_learning_event.id
      });
    }
    if (url.pathname === "/rest/v1/v4_recognition_jobs") {
      assert.equal(url.searchParams.get("tenant_id"), "eq.tenant_a");
      const job = {
        id: "job_target",
        tenant_id: "tenant_a",
        batch_id: "batch_target",
        recognition_session_id: "session_target",
        operator_id: "user_owner",
        assigned_to_user_id: "user_writer",
        asset_id: "asset_target",
        status: "FAILED",
        lane: "background",
        priority: 100,
        attempt_count: 3,
        max_attempts: 3,
        queue_tags: {},
        error: {},
        timing: {}
      };
      if (method === "PATCH") {
        assert.equal(url.searchParams.has("operator_id"), false, "team retry CAS must not bind the original operator");
        assert.equal(url.searchParams.get("status"), "eq.FAILED");
        assert.equal(body.queue_tags.manual_retry_requested_by_user_id, actorUserId);
        return jsonResponse([{ ...job, ...body }]);
      }
      return jsonResponse([job]);
    }
    throw new Error(`unexpected fetch ${method} ${url.pathname}`);
  };
}

try {
  for (const [actorUserId, actorRole] of [["user_manager", "MANAGER"], ["user_owner", "OWNER"]]) {
    const calls = [];
    globalThis.fetch = scenarioFetch({ actorUserId, actorRole, calls });
    const result = await callPost(assignmentHandler, {
      userId: actorUserId,
      url: "/api/v4/listing-job-assign",
      payload: { job_id: "job_target", assigned_to_user_id: "user_writer" }
    });
    assert.equal(result.statusCode, 200, `${actorRole} should assign team work`);
    assert.equal(result.body.assignment.assigned_to_user_id, "user_writer");
    assert.equal(calls.filter(({ url }) => url.pathname === "/rest/v1/rpc/assign_v4_recognition_job").length, 1);
  }

  {
    const calls = [];
    globalThis.fetch = scenarioFetch({ actorUserId: "user_writer", actorRole: "WRITER", calls });
    const result = await callPost(assignmentHandler, {
      userId: "user_writer",
      url: "/api/v4/listing-job-assign",
      payload: { job_id: "job_target", assigned_to_user_id: "user_writer" }
    });
    assert.equal(result.statusCode, 403, "Writer cannot assign tasks");
    assert.equal(calls.some(({ url }) => url.pathname === "/rest/v1/rpc/assign_v4_recognition_job"), false);
  }

  for (const scenario of [
    { targetStatus: "DISABLED", targetExists: true },
    { targetStatus: "ACTIVE", targetExists: false }
  ]) {
    const calls = [];
    globalThis.fetch = scenarioFetch({
      actorUserId: "user_manager",
      actorRole: "MANAGER",
      ...scenario,
      calls
    });
    const result = await callPost(assignmentHandler, {
      userId: "user_manager",
      url: "/api/v4/listing-job-assign",
      payload: { job_id: "job_target", assigned_to_user_id: "user_writer" }
    });
    assert.equal(result.statusCode, 404, "inactive and cross-tenant targets share a non-disclosing result");
    assert.equal(calls.some(({ url }) => url.pathname === "/rest/v1/rpc/assign_v4_recognition_job"), false);
  }

  {
    const calls = [];
    globalThis.fetch = scenarioFetch({ actorUserId: "user_manager", actorRole: "MANAGER", calls });
    const result = await callPost(assignmentHandler, {
      userId: "user_manager",
      url: "/api/v4/listing-job-assign",
      payload: {
        tenant_id: "tenant_b",
        job_id: "job_target",
        assigned_to_user_id: "user_writer"
      }
    });
    assert.equal(result.statusCode, 400);
    assert.equal(calls.some(({ url }) => url.pathname === "/rest/v1/rpc/assign_v4_recognition_job"), false);
  }

  {
    const calls = [];
    globalThis.fetch = scenarioFetch({ actorUserId: "user_writer", actorRole: "WRITER", calls });
    const result = await callPost(feedbackHandler, {
      userId: "user_writer",
      url: "/api/v4/listing-feedback",
      payload: {
        recognition_session_id: "session_target",
        action: "ACCEPT",
        ai_generated_title: "2025 Example Card"
      }
    });
    assert.equal(result.statusCode, 200, "the persisted assignee can submit feedback even when the creator differs");
    assert.equal(calls.filter(({ url }) => url.pathname === "/rest/v1/rpc/persist_v4_writer_feedback_transaction").length, 1);
  }

  {
    const calls = [];
    globalThis.fetch = scenarioFetch({ actorUserId: "user_manager", actorRole: "MANAGER", calls });
    const result = await callPost(feedbackHandler, {
      userId: "user_manager",
      url: "/api/v4/listing-feedback",
      payload: { recognition_session_id: "session_target", action: "ACCEPT", ai_generated_title: "Example" }
    });
    assert.equal(result.statusCode, 404, "Manager feedback denial stays non-enumerating");
    assert.equal(calls.some(({ url }) => url.pathname === "/rest/v1/rpc/persist_v4_writer_feedback_transaction"), false);
  }

  {
    const calls = [];
    globalThis.fetch = scenarioFetch({ actorUserId: "user_owner", actorRole: "OWNER", calls });
    const result = await callPost(feedbackHandler, {
      userId: "user_owner",
      url: "/api/v4/listing-feedback",
      payload: { recognition_session_id: "session_target", action: "ACCEPT", ai_generated_title: "Example" }
    });
    assert.equal(result.statusCode, 200, "Owner retains the explicit tenant-wide override");
    assert.equal(calls.filter(({ url }) => url.pathname === "/rest/v1/rpc/persist_v4_writer_feedback_transaction").length, 1);
  }

  {
    const calls = [];
    globalThis.fetch = scenarioFetch({
      actorUserId: "user_writer",
      actorRole: "WRITER",
      sessionAssignee: "another_writer",
      calls
    });
    const result = await callPost(feedbackHandler, {
      userId: "user_writer",
      url: "/api/v4/listing-feedback",
      payload: { recognition_session_id: "session_target", action: "ACCEPT", ai_generated_title: "Example" }
    });
    assert.equal(result.statusCode, 404);
    assert.equal(calls.some(({ url }) => url.pathname === "/rest/v1/rpc/persist_v4_writer_feedback_transaction"), false);
  }

  for (const [actorUserId, actorRole] of [["user_manager", "MANAGER"], ["user_owner", "OWNER"]]) {
    const calls = [];
    globalThis.fetch = scenarioFetch({ actorUserId, actorRole, calls });
    const result = await callPost(retryHandler, {
      userId: actorUserId,
      url: "/api/v4/listing-job-retry",
      payload: { job_id: "job_target" }
    });
    assert.equal(result.statusCode, 200, `${actorRole} can retry another team member's same-tenant job`);
    assert.equal(result.body.job.status, "RETRYING");
    const patch = calls.find(({ url, method }) => url.pathname === "/rest/v1/v4_recognition_jobs" && method === "PATCH");
    assert.ok(patch);
    assert.equal(patch.url.searchParams.has("operator_id"), false);
  }

  {
    const calls = [];
    globalThis.fetch = scenarioFetch({ actorUserId: "user_writer", actorRole: "WRITER", calls });
    const result = await callPost(retryHandler, {
      userId: "user_writer",
      url: "/api/v4/listing-job-retry",
      payload: { job_id: "job_target" }
    });
    assert.equal(result.statusCode, 403, "Writer cannot invoke tenant-wide manual retry");
    assert.equal(calls.some(({ url }) => url.pathname === "/rest/v1/v4_recognition_jobs"), false);
  }
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log("V4 assignment, assigned feedback, and team retry API tests passed.");
