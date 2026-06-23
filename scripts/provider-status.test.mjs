import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import handler from "../api/listing-provider-status.js";

const originalEnv = { ...process.env };
const tempDir = await mkdtemp(join(tmpdir(), "lynca-provider-status-"));
const smokeReportPath = join(tempDir, "agnes-smoke.json");
process.env.METAVERSE_AUTH_SECRET = "test-secret";
process.env.ENABLE_AGNES_PROVIDER = "true";
process.env.ENABLE_GPT41_EMERGENCY_PROVIDER = "true";
process.env.AGNES_API_KEY = "test-agnes-key";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.LISTING_IMAGE_BUCKET = "listing-card-images";
process.env.SMOKE_PROVIDER_REPORT_PATH = smokeReportPath;

await writeFile(smokeReportPath, `${JSON.stringify({
  provider: "agnes",
  status: "passed_with_limitations",
  generated_at: "2026-06-22T11:11:26.235Z",
  capabilities: [
    {
      name: "single_image_json",
      status: "passed",
      required: true,
      details: {
        model_id: "agnes-2.0-flash",
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
        model_id: "agnes-2.0-flash",
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
        error_code: "upstream_error",
        message: "should not be surfaced https://example.com/image.jpg sk-secret"
      }
    },
    {
      name: "error_response",
      status: "passed",
      required: false,
      details: {
        error_code: "upstream_error",
        status: "500"
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
assert.equal(response.body.default_provider, "agnes");
assert.equal(response.body.storage.configured, true);
assert.equal(response.body.storage.max_image_dimension_pixels, 12000);
assert.equal(response.body.storage.max_image_total_pixels, 50000000);
assert.doesNotMatch(JSON.stringify(response.body.storage), /test-service-role/);

let agnes = response.body.providers.find((provider) => provider.id === "agnes");
let openai = response.body.providers.find((provider) => provider.id === "openai_legacy");
assert.equal(agnes.selectable, true);
assert.equal(agnes.requires_storage, true);
assert.equal(agnes.smoke.status, "passed_with_limitations");
assert.equal(agnes.smoke.generated_at, "2026-06-22T11:11:26.235Z");
assert.equal(agnes.smoke.json_baseline_verified, true);
assert.equal(agnes.smoke.multi_image_verified, true);
assert.equal(agnes.smoke.tool_call_verified, false);
assert.equal(agnes.smoke.error_response_verified, true);
assert.equal(agnes.smoke.capabilities.length, 4);
assert.equal(agnes.smoke.capabilities.find((capability) => capability.name === "tool_call").details.error_code, "upstream_error");
assert.equal(agnes.smoke.capabilities.find((capability) => capability.name === "tool_call").details.message, undefined);
assert.doesNotMatch(JSON.stringify(agnes.smoke), /sk-secret|https:\/\/example\.com/);
assert.equal(openai.selectable, true);
assert.equal(openai.requires_explicit_retry, true);

delete process.env.SUPABASE_SERVICE_ROLE_KEY;
response = await callStatus();
agnes = response.body.providers.find((provider) => provider.id === "agnes");
assert.equal(response.body.default_provider, "");
assert.equal(agnes.selectable, false);
assert.equal(agnes.disabled_reason, "storage_not_configured");
assert.equal(response.body.storage.configured, false);

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.ENABLE_GPT41_EMERGENCY_PROVIDER = "false";
response = await callStatus();
openai = response.body.providers.find((provider) => provider.id === "openai_legacy");
assert.equal(openai, undefined);

process.env.ENABLE_GPT41_EMERGENCY_PROVIDER = "true";
process.env.ALLOW_EXPLICIT_GPT41_RETRY = "false";
response = await callStatus();
openai = response.body.providers.find((provider) => provider.id === "openai_legacy");
assert.equal(openai.selectable, false);
assert.equal(openai.disabled_reason, "emergency_retry_disabled");

process.env.ALLOW_EXPLICIT_GPT41_RETRY = "true";
process.env.ENABLE_AGNES_PROVIDER = "false";
response = await callStatus();
agnes = response.body.providers.find((provider) => provider.id === "agnes");
openai = response.body.providers.find((provider) => provider.id === "openai_legacy");
assert.equal(agnes, undefined);
assert.equal(openai.selectable, true);
assert.equal(response.body.default_provider, "");

Object.keys(process.env).forEach((key) => {
  if (!(key in originalEnv)) delete process.env[key];
});
Object.assign(process.env, originalEnv);
await rm(tempDir, { recursive: true, force: true });

console.log("provider status tests passed");
