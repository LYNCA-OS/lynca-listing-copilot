import assert from "node:assert/strict";
import crypto from "node:crypto";
import handler from "../api/listing-provider-status.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
process.env.METAVERSE_AUTH_SECRET = "test-secret";
process.env.ENABLE_GPT41_EMERGENCY_PROVIDER = "true";
process.env.ALLOW_EXPLICIT_GPT41_RETRY = "true";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.OPENAI_LISTING_MODEL = "gpt-4.1-mini-2025-04-14";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.LISTING_IMAGE_BUCKET = "listing-card-images";
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  text: async () => "[]"
});

function sign(value) {
  return crypto.createHmac("sha256", process.env.METAVERSE_AUTH_SECRET).update(value).digest("hex");
}

function sessionCookie() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 60000 })).toString("base64url");
  return `lynca_metaverse_session=${payload}.${sign(payload)}`;
}

async function callStatus() {
  const req = {
    method: "GET",
    headers: { cookie: sessionCookie() }
  };
  const res = {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(value) {
      this.body = value;
    }
  };

  await handler(req, res);
  return {
    statusCode: res.statusCode,
    body: JSON.parse(res.body)
  };
}

let response = await callStatus();
assert.equal(response.statusCode, 200);
assert.equal(response.body.default_provider, "openai_legacy");
assert.equal(response.body.fallback_available, false);
assert.equal(response.body.storage.configured, true);
assert.equal(response.body.storage.max_image_dimension_pixels, 120000);
assert.equal(response.body.storage.max_image_total_pixels, 5000000000);
assert.doesNotMatch(JSON.stringify(response.body.storage), /test-service-role/);
assert.equal(response.body.workflow_readiness.can_run_cloud_recognition, true);
assert.equal(response.body.workflow_readiness.components.some((item) => item.id === "vision_provider"), true);
assert.doesNotMatch(JSON.stringify(response.body.workflow_readiness), /test-openai-key|test-service-role|example\.supabase/);

let openai = response.body.providers.find((provider) => provider.id === "openai_legacy");
assert.deepEqual(response.body.providers.map((provider) => provider.id), ["openai_legacy"]);
assert.equal(openai.selectable, true);
assert.equal(openai.role, "primary");
assert.deepEqual(openai.roles, ["primary"]);
assert.equal(openai.requires_explicit_retry, false);

process.env.ENABLE_EXPERIMENTAL_PROVIDER_UI = "true";
response = await callStatus();
openai = response.body.providers.find((provider) => provider.id === "openai_legacy");
assert.deepEqual(response.body.providers.map((provider) => provider.id), ["openai_legacy"]);
assert.equal(openai.selectable, true);
assert.equal(openai.role, "primary");
assert.deepEqual(openai.roles, ["primary"]);
assert.equal(openai.requires_explicit_retry, false);
delete process.env.ENABLE_EXPERIMENTAL_PROVIDER_UI;

delete process.env.SUPABASE_SERVICE_ROLE_KEY;
response = await callStatus();
openai = response.body.providers.find((provider) => provider.id === "openai_legacy");
assert.equal(response.body.default_provider, "openai_legacy");
assert.equal(response.body.storage.configured, false);
assert.equal(openai.selectable, true);
assert.equal(response.body.workflow_readiness.can_run_cloud_recognition, false);
assert.equal(response.body.workflow_readiness.blockers.includes("image_storage"), true);

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.ENABLE_GPT41_EMERGENCY_PROVIDER = "false";
response = await callStatus();
assert.deepEqual(response.body.providers.map((provider) => provider.id), []);
assert.equal(response.body.default_provider, "");

process.env.ENABLE_GPT41_EMERGENCY_PROVIDER = "true";
process.env.ALLOW_EXPLICIT_GPT41_RETRY = "false";
response = await callStatus();
assert.equal(response.body.default_provider, "openai_legacy");
openai = response.body.providers.find((provider) => provider.id === "openai_legacy");
assert.equal(openai.selectable, true);
assert.equal(openai.disabled_reason, null);

Object.keys(process.env).forEach((key) => {
  if (!(key in originalEnv)) delete process.env[key];
});
Object.assign(process.env, originalEnv);
globalThis.fetch = originalFetch;

console.log("provider status tests passed");
