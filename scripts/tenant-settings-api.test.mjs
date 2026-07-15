import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import handler from "../api/v4/tenant-settings.js";
import { cookieName, createListingSessionToken } from "../lib/listing-session.mjs";

const originalFetch = globalThis.fetch;
const originalEnv = {
  METAVERSE_AUTH_SECRET: process.env.METAVERSE_AUTH_SECRET,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
};
process.env.METAVERSE_AUTH_SECRET = "tenant-settings-test-secret";
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "tenant-settings-service-role";

function cookie(userId) {
  return `${cookieName}=${createListingSessionToken({
    userId,
    tenantId: "tenant_a",
    email: `${userId}@example.test`,
    sessionVersion: 1
  }, process.env.METAVERSE_AUTH_SECRET)}`;
}

function responseRecorder() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = String(value); },
    end(value = "") { this.body = String(value || ""); }
  };
}

async function callPatch(userId, payload) {
  const req = new EventEmitter();
  req.method = "PATCH";
  req.url = "/api/v4/tenant-settings";
  req.headers = { cookie: cookie(userId), "x-request-id": `req-${userId}` };
  const res = responseRecorder();
  const running = handler(req, res);
  setTimeout(() => {
    req.emit("data", JSON.stringify(payload));
    req.emit("end");
  }, 0);
  await running;
  return { statusCode: res.statusCode, body: JSON.parse(res.body || "null") };
}

function membership(role, userId) {
  return {
    tenant_id: "tenant_a",
    user_id: userId,
    role,
    status: "ACTIVE",
    disabled_at: null,
    user: { id: userId, email: `${userId}@example.test`, status: "ACTIVE", session_version: 1, disabled_at: null },
    tenant: { id: "tenant_a", name: "Tenant A", plan: "pilot", status: "ACTIVE", disabled_at: null }
  };
}

try {
  for (const [role, userId, expectedStatus] of [["MANAGER", "user_manager", 403], ["WRITER", "user_writer", 403]]) {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/rest/v1/tenant_members") return new Response(JSON.stringify([membership(role, userId)]), { status: 200 });
      if (["/rest/v1/request_logs", "/rest/v1/error_logs", "/rest/v1/production_events"].includes(url.pathname)) {
        return new Response("[]", { status: 201 });
      }
      throw new Error(`non-owner reached tenant settings storage: ${url.pathname}`);
    };
    const denied = await callPatch(userId, { name: "Forbidden" });
    assert.equal(denied.statusCode, expectedStatus);
  }

  let tenantPatchUrl = null;
  let tenantPatchBody = null;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/tenant_members") {
      return new Response(JSON.stringify([membership("OWNER", "user_owner")]), { status: 200 });
    }
    if (url.pathname === "/rest/v1/tenants" && init.method === "PATCH") {
      assert.equal(init.headers.authorization, undefined, "opaque Supabase service keys must not be sent as Bearer tokens");
      tenantPatchUrl = url;
      tenantPatchBody = JSON.parse(init.body);
      return new Response(JSON.stringify([{
        id: "tenant_a",
        name: tenantPatchBody.name,
        plan: "pilot",
        status: "ACTIVE",
        settings: tenantPatchBody.settings
      }]), { status: 200 });
    }
    if (["/rest/v1/request_logs", "/rest/v1/error_logs", "/rest/v1/production_events"].includes(url.pathname)) {
      return new Response("[]", { status: 201 });
    }
    throw new Error(`unexpected tenant settings fetch: ${url.pathname}`);
  };

  const saved = await callPatch("user_owner", {
    tenant_id: "tenant_b",
    plan: "enterprise",
    name: "Tenant A Renamed",
    settings: {
      default_export_format: "xlsx",
      require_writer_review: true,
      recognition_mode: "accuracy",
      timezone: "Asia/Shanghai"
    }
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.body.tenant.id, "tenant_a");
  assert.equal(tenantPatchUrl.searchParams.get("id"), "eq.tenant_a");
  assert.equal(tenantPatchBody.name, "Tenant A Renamed");
  assert.equal(tenantPatchBody.settings.recognition_mode, "accuracy");
  assert.equal(Object.hasOwn(tenantPatchBody, "plan"), false, "Owner settings API cannot alter billing plan");
  assert.equal(Object.hasOwn(tenantPatchBody, "tenant_id"), false, "payload tenant_id cannot choose the write scope");
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log("tenant settings API tests passed");
