import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import handler from "../api/listing-provider-status.js";

const originalEnv = { ...process.env };
const tempDir = await mkdtemp(join(tmpdir(), "lynca-provider-status-"));
const smokeReportPath = join(tempDir, "gemini-smoke.json");
process.env.METAVERSE_AUTH_SECRET = "test-secret";
process.env.ENABLE_GEMINI_PROVIDER = "true";
process.env.ENABLE_GPT41_EMERGENCY_PROVIDER = "true";
process.env.ALLOW_EXPLICIT_GPT41_RETRY = "true";
process.env.GEMINI_API_KEY = "test-gemini-key";
process.env.GEMINI_MODEL = "gemini-3.1-flash-lite";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.OPENAI_LISTING_MODEL = "gpt-4.1-mini-2025-04-14";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.LISTING_IMAGE_BUCKET = "listing-card-images";
process.env.GEMINI_SMOKE_REPORT_PATH = smokeReportPath;

await writeFile(smokeReportPath, `${JSON.stringify({
  provider: "gemini",
  status: "passed_with_limitations",
  generated_at: "2026-06-22T11:11:26.235Z",
  capabilities: [
    {
      name: "single_image_json",
      status: "passed",
      required: true,
      details: {
        model_id: "gemini-3.1-flash-lite",
        parse_source: "content",
        finish_reason: "stop",
        image_count: "1",
        provider_calls: "1"
      }
    },
    {
      name: "front_back_multi_image_json",
      status: "passed",
      required: false,
      details: {
        model_id: "gemini-3.1-flash-lite",
        parse_source: "content",
        finish_reason: "stop",
        image_count: "2",
        provider_calls: "1"
      }
    },
    {
      name: "tool_call",
      status: "failed",
      required: false,
      details: {
        error_code: "not_supported",
        message: "should not be surfaced https://example.com/image.jpg sk-secret"
      }
    }
  ]
})}\n`);

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
assert.equal(response.body.default_provider, "gemini");
assert.equal(response.body.storage.configured, true);
assert.equal(response.body.storage.max_image_dimension_pixels, 12000);
assert.equal(response.body.storage.max_image_total_pixels, 50000000);
assert.doesNotMatch(JSON.stringify(response.body.storage), /test-service-role/);

let gemini = response.body.providers.find((provider) => provider.id === "gemini");
let openai = response.body.providers.find((provider) => provider.id === "openai_legacy");
assert.deepEqual(response.body.providers.map((provider) => provider.id), ["gemini", "openai_legacy"]);
assert.equal(gemini.selectable, true);
assert.equal(gemini.requires_storage, false);
assert.equal(gemini.role, "primary");
assert.deepEqual(gemini.roles, ["primary"]);
assert.equal(gemini.model_id, "gemini-3.1-flash-lite");
assert.equal(gemini.smoke.status, "passed_with_limitations");
assert.equal(gemini.smoke.generated_at, "2026-06-22T11:11:26.235Z");
assert.equal(gemini.smoke.json_baseline_verified, true);
assert.equal(gemini.smoke.multi_image_verified, true);
assert.equal(gemini.smoke.tool_call_verified, false);
assert.equal(gemini.smoke.capabilities.length, 3);
assert.equal(gemini.smoke.capabilities.find((capability) => capability.name === "tool_call").details.error_code, "not_supported");
assert.equal(gemini.smoke.capabilities.find((capability) => capability.name === "tool_call").details.message, undefined);
assert.doesNotMatch(JSON.stringify(gemini.smoke), /sk-secret|https:\/\/example\.com/);
assert.equal(openai.selectable, true);
assert.equal(openai.role, "emergency");
assert.deepEqual(openai.roles, ["emergency"]);
assert.equal(openai.requires_explicit_retry, true);

delete process.env.SUPABASE_SERVICE_ROLE_KEY;
response = await callStatus();
gemini = response.body.providers.find((provider) => provider.id === "gemini");
openai = response.body.providers.find((provider) => provider.id === "openai_legacy");
assert.equal(response.body.default_provider, "gemini");
assert.equal(response.body.storage.configured, false);
assert.equal(gemini.selectable, true);
assert.equal(openai.selectable, true);

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.ENABLE_GPT41_EMERGENCY_PROVIDER = "false";
response = await callStatus();
assert.deepEqual(response.body.providers.map((provider) => provider.id), ["gemini"]);

process.env.ENABLE_GPT41_EMERGENCY_PROVIDER = "true";
process.env.ALLOW_EXPLICIT_GPT41_RETRY = "false";
response = await callStatus();
assert.equal(response.body.default_provider, "gemini");
openai = response.body.providers.find((provider) => provider.id === "openai_legacy");
assert.equal(openai.selectable, false);
assert.equal(openai.disabled_reason, "emergency_retry_disabled");

Object.keys(process.env).forEach((key) => {
  if (!(key in originalEnv)) delete process.env[key];
});
Object.assign(process.env, originalEnv);
await rm(tempDir, { recursive: true, force: true });

console.log("provider status tests passed");
