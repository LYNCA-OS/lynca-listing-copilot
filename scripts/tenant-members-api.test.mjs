import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import tenantMembersHandler from "../api/v4/tenant-members.js";
import { cookieName, createListingSessionToken } from "../lib/listing-session.mjs";

const source = await readFile(new URL("../api/v4/tenant-members.js", import.meta.url), "utf8");
assert.match(source, /requireTenantAccess\(req,/);
assert.match(source, /TENANT_PERMISSIONS\.MANAGE_MEMBERS/);
assert.match(source, /tenantId: context\.tenantId/);
assert.doesNotMatch(source, /tenantId: payload\.(?:tenant_id|tenantId)/);
assert.match(source, /instrumentProductionRequest/);

const originalEnv = {
  METAVERSE_AUTH_SECRET: process.env.METAVERSE_AUTH_SECRET,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  API_RATE_LIMIT_DISABLED: process.env.API_RATE_LIMIT_DISABLED
};
const originalFetch = globalThis.fetch;
process.env.METAVERSE_AUTH_SECRET = "tenant-members-api-test-secret";
process.env.SUPABASE_URL = "https://tenant-members-test.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_server_only_test";
process.env.API_RATE_LIMIT_DISABLED = "true";

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
      auth_user_id: `00000000-0000-4000-8000-${userId.padEnd(12, "0").slice(0, 12)}`
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

function memberRow({
  userId,
  email = `${userId}@example.test`,
  role = "WRITER",
  status = "ACTIVE",
  tenantId = "tenant_a",
  updatedAt = "2026-07-15T07:00:00.000Z"
}) {
  return {
    tenant_id: tenantId,
    user_id: userId,
    role,
    status,
    disabled_at: status === "ACTIVE" ? null : "2026-07-15T06:00:00.000Z",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: updatedAt,
    user: {
      id: userId,
      email,
      status: "ACTIVE",
      disabled_at: null,
      auth_user_id: "00000000-0000-4000-8000-000000000999"
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

async function callHandler({ method = "GET", userId, payload, url = "/api/v4/tenant-members" }) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = {
    cookie: sessionCookie({ userId }),
    "x-request-id": `req-${method.toLowerCase()}-${userId}`
  };
  const res = responseRecorder();
  const running = tenantMembersHandler(req, res);
  if (method !== "GET") {
    setTimeout(() => {
      req.emit("data", JSON.stringify(payload ?? {}));
      req.emit("end");
    }, 0);
  }
  await running;
  return {
    statusCode: res.statusCode || 200,
    body: JSON.parse(res.body || "null"),
    headers: res.headers
  };
}

function tenantFetch({
  actorRole = "OWNER",
  actorUserId = "user_owner",
  members = [],
  directoryUsers = [],
  calls = []
} = {}) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method, body, headers: init.headers });
    assert.equal(init.headers.apikey, process.env.SUPABASE_SERVICE_ROLE_KEY);
    assert.equal(init.headers.authorization, undefined, "opaque service keys must never be sent as Bearer JWTs");

    if (["/rest/v1/request_logs", "/rest/v1/error_logs"].includes(url.pathname)) return jsonResponse([], 201);

    if (url.pathname === "/rest/v1/users") {
      const id = String(url.searchParams.get("id") || "").replace(/^eq\./, "");
      const email = String(url.searchParams.get("email") || "").replace(/^eq\./, "");
      return jsonResponse(directoryUsers.filter((user) => (!id || user.id === id) && (!email || user.email === email)));
    }

    if (url.pathname !== "/rest/v1/tenant_members") throw new Error(`unexpected path ${url.pathname}`);
    const select = url.searchParams.get("select") || "";
    if (select.includes("tenant:tenants")) {
      assert.equal(url.searchParams.get("tenant_id"), "eq.tenant_a");
      assert.equal(url.searchParams.get("user_id"), `eq.${actorUserId}`);
      return jsonResponse([authMembership({ userId: actorUserId, role: actorRole })]);
    }

    if (method === "POST") {
      assert.equal(body.tenant_id, "tenant_a", "every member write must use the trusted tenant");
      const created = memberRow({ userId: body.user_id, role: body.role, status: body.status });
      members.push(created);
      return jsonResponse([created], 201);
    }
    assert.equal(url.searchParams.get("tenant_id"), "eq.tenant_a", "every member query must be scoped by trusted tenant");
    assert.ok(!String(input).includes("tenant_b"), "forged/cross-tenant identifiers must never become tenant filters");
    if (method === "PATCH") {
      const targetUserId = String(url.searchParams.get("user_id") || "").replace(/^eq\./, "");
      const target = members.find((member) => member.tenant_id === "tenant_a" && member.user_id === targetUserId);
      if (!target) return jsonResponse([]);
      Object.assign(target, body);
      target.user = target.user || {
        id: target.user_id,
        email: `${target.user_id}@example.test`,
        status: "ACTIVE",
        disabled_at: null,
        auth_user_id: "00000000-0000-4000-8000-000000000999"
      };
      return jsonResponse([target]);
    }

    let rows = members.filter((member) => member.tenant_id === "tenant_a");
    const userId = String(url.searchParams.get("user_id") || "").replace(/^eq\./, "");
    const email = String(url.searchParams.get("user.email") || "").replace(/^eq\./, "");
    if (userId) rows = rows.filter((member) => member.user_id === userId);
    if (email) rows = rows.filter((member) => member.user.email === email);
    if (url.searchParams.get("role") === "eq.OWNER") {
      rows = rows.filter((member) => member.role === "OWNER" && member.status === "ACTIVE" && !member.disabled_at);
      return jsonResponse(rows.map((member) => ({
        tenant_id: member.tenant_id,
        user_id: member.user_id,
        user: { id: member.user_id, status: "ACTIVE", disabled_at: null }
      })).slice(0, 2));
    }
    return jsonResponse(rows);
  };
}

try {
  // Managers can inspect their own tenant team, while a forged query tenant is ignored.
  {
    const calls = [];
    globalThis.fetch = tenantFetch({
      actorRole: "MANAGER",
      actorUserId: "user_manager",
      members: [
        memberRow({ userId: "user_owner", role: "OWNER" }),
        memberRow({ userId: "user_writer", role: "WRITER" })
      ],
      calls
    });
    const result = await callHandler({
      method: "GET",
      userId: "user_manager",
      url: "/api/v4/tenant-members?tenant_id=tenant_b"
    });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body.members.map((member) => member.user_id), ["user_owner", "user_writer"]);
    assert.ok(result.body.members.every((member) => !("auth_user_id" in member)), "Auth UUIDs are never exposed");
    assert.ok(calls.every(({ url }) => !url.searchParams.has("tenant_b")));
  }

  // A Writer cannot write membership data.
  {
    const calls = [];
    globalThis.fetch = tenantFetch({ actorRole: "WRITER", actorUserId: "user_writer", calls });
    const result = await callHandler({
      method: "POST",
      userId: "user_writer",
      payload: { email: "new@example.test", role: "WRITER" }
    });
    assert.equal(result.statusCode, 403);
    assert.equal(calls.filter(({ url }) => url.pathname === "/rest/v1/users").length, 0);
  }

  // Payload tenant selection is rejected before any directory lookup or write.
  {
    const calls = [];
    globalThis.fetch = tenantFetch({ calls });
    const result = await callHandler({
      method: "POST",
      userId: "user_owner",
      payload: { tenant_id: "tenant_b", email: "new@example.test", role: "WRITER" }
    });
    assert.equal(result.statusCode, 400);
    assert.equal(result.body.error_code, "INVALID_MEMBER_REQUEST");
    assert.equal(calls.filter(({ url }) => url.pathname === "/rest/v1/users").length, 0);
    assert.equal(calls.filter(({ url, method }) => url.pathname === "/rest/v1/tenant_members" && method === "POST").length, 0);
  }

  // An Owner can add one existing, active, auth-linked app user by email.
  {
    const calls = [];
    const members = [memberRow({ userId: "user_owner", role: "OWNER" })];
    globalThis.fetch = tenantFetch({
      members,
      directoryUsers: [{
        id: "user_new",
        email: "new@example.test",
        status: "ACTIVE",
        disabled_at: null,
        auth_user_id: "00000000-0000-4000-8000-000000000123"
      }],
      calls
    });
    const result = await callHandler({
      method: "POST",
      userId: "user_owner",
      payload: { email: "new@example.test", role: "WRITER" }
    });
    assert.equal(result.statusCode, 201);
    assert.equal(result.body.member.user_id, "user_new");
    assert.equal(result.body.member.role, "WRITER");
    const insert = calls.find(({ url, method }) => url.pathname === "/rest/v1/tenant_members" && method === "POST");
    assert.equal(insert.body.tenant_id, "tenant_a");
    assert.equal(insert.body.user_id, "user_new");
  }

  // A global app user id alone cannot be used as an email-discovery oracle.
  {
    const calls = [];
    globalThis.fetch = tenantFetch({ calls });
    const result = await callHandler({
      method: "POST",
      userId: "user_owner",
      payload: { user_id: "user_foreign", role: "WRITER" }
    });
    assert.equal(result.statusCode, 400);
    assert.equal(result.body.error_code, "INVALID_MEMBER_REQUEST");
    assert.equal(calls.filter(({ url }) => url.pathname === "/rest/v1/users").length, 0);
  }

  // The only active Owner cannot be disabled or downgraded.
  {
    const calls = [];
    globalThis.fetch = tenantFetch({
      members: [memberRow({ userId: "user_owner", role: "OWNER" })],
      calls
    });
    const result = await callHandler({
      method: "PATCH",
      userId: "user_owner",
      payload: { user_id: "user_owner", role: "MANAGER" }
    });
    assert.equal(result.statusCode, 409);
    assert.equal(result.body.error_code, "LAST_ACTIVE_OWNER_REQUIRED");
    assert.equal(calls.filter(({ method }) => method === "PATCH").length, 0);
  }

  // A version-checked demotion is allowed when another active Owner remains,
  // and the invariant is checked again after the write.
  {
    const calls = [];
    globalThis.fetch = tenantFetch({
      members: [
        memberRow({ userId: "user_owner", role: "OWNER" }),
        memberRow({ userId: "user_owner_two", role: "OWNER" })
      ],
      calls
    });
    const result = await callHandler({
      method: "PATCH",
      userId: "user_owner",
      payload: { user_id: "user_owner", role: "MANAGER" }
    });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.member.role, "MANAGER");
    const mutation = calls.find(({ url, method }) => url.pathname === "/rest/v1/tenant_members" && method === "PATCH");
    assert.equal(mutation.url.searchParams.get("tenant_id"), "eq.tenant_a");
    assert.equal(mutation.url.searchParams.get("role"), "eq.OWNER");
    assert.equal(mutation.url.searchParams.get("status"), "eq.ACTIVE");
    assert.match(mutation.url.searchParams.get("updated_at"), /^eq\.2026-07-15/);
    assert.equal(calls.filter(({ url, method }) => method === "GET" && url.searchParams.get("role") === "eq.OWNER").length, 2);
  }

  // A cross-tenant target is indistinguishable from a missing tenant-local member.
  {
    const calls = [];
    globalThis.fetch = tenantFetch({
      members: [
        memberRow({ userId: "user_owner", role: "OWNER" }),
        memberRow({ userId: "user_foreign", role: "WRITER", tenantId: "tenant_b" })
      ],
      calls
    });
    const result = await callHandler({
      method: "PATCH",
      userId: "user_owner",
      payload: { user_id: "user_foreign", role: "MANAGER" }
    });
    assert.equal(result.statusCode, 404);
    assert.equal(result.body.error_code, "MEMBER_NOT_FOUND");
    assert.ok(calls.every(({ url }) => url.searchParams.get("tenant_id") !== "eq.tenant_b"));
  }
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log("tenant members API tests passed");
