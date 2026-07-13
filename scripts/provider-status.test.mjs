import assert from "node:assert/strict";
import crypto from "node:crypto";
import handler from "../api/listing-provider-status.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
process.env.METAVERSE_AUTH_SECRET = "test-secret";
process.env.ENABLE_GPT41_EMERGENCY_PROVIDER = "true";
process.env.ALLOW_EXPLICIT_GPT41_RETRY = "true";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.OPENAI_API_KEY_POOL = "test-openai-key,test-openai-key-2";
process.env.OPENAI_PER_KEY_STABLE_CONCURRENCY = "2";
process.env.OPENAI_LISTING_MODEL = "gpt-4.1-mini-2025-04-14";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.LISTING_IMAGE_BUCKET = "listing-card-images";
process.env.VECTOR_INDEX_READY = "true";
process.env.ENABLE_VECTOR_RETRIEVAL = "false";
process.env.VECTOR_RETRIEVAL_MODE = "off";
process.env.VECTOR_WORKER_URL = "https://vector.worker.test";
process.env.VECTOR_WORKER_TOKEN = "test-vector-token";
globalThis.fetch = async (url) => ({
  ok: true,
  status: 200,
  text: async () => String(url).endsWith("/readyz")
    ? JSON.stringify({
      status: "ready",
      visual_embeddings_enabled: true,
      visual_embedding_preload_enabled: true,
      visual_embedding_preload_status: { status: "READY" },
      visual_embedding_model_id: "google/siglip2-base-patch16-384",
      visual_embedding_model_revision: "f775b65a79762255128c981547af89addcfe0f88"
    })
    : "[]"
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
assert.equal(response.body.storage.max_upload_bytes, 25 * 1024 * 1024);
assert.equal(response.body.storage.max_image_dimension_pixels, 12000);
assert.equal(response.body.storage.max_image_total_pixels, 50000000);
assert.doesNotMatch(JSON.stringify(response.body.storage), /test-service-role/);
assert.equal(response.body.workflow_readiness.can_run_cloud_recognition, true);
assert.equal(response.body.workflow_readiness.components.some((item) => item.id === "vision_provider"), true);
const visionReadiness = response.body.workflow_readiness.components.find((item) => item.id === "vision_provider");
assert.equal(visionReadiness.details.model_id, "gpt-4.1-mini-2025-04-14");
const vectorReadiness = response.body.workflow_readiness.components.find((item) => item.id === "vector_retrieval");
assert.equal(vectorReadiness.status, "READY");
assert.equal(vectorReadiness.details.index_ready, true);
assert.equal(vectorReadiness.details.default_enabled, false);
assert.equal(vectorReadiness.details.request_override_supported, true);
assert.equal(vectorReadiness.details.runtime_ready, true);
assert.equal(vectorReadiness.details.preload_status, "READY");
assert.equal(vectorReadiness.details.prompt_influence_by_default, false);
assert.equal(response.body.execution_control.distributed_provider_capacity_enabled, true);
assert.equal(response.body.execution_control.provider_done_capacity_handoff_enabled, true);
assert.equal(response.body.execution_control.global_fair_drain_enabled, true);
assert.equal(response.body.execution_control.queue_kick_dedup_ms, 1200);
assert.equal(response.body.execution_control.provider_key_pool_size, 2);
assert.equal(response.body.execution_control.per_key_stable_concurrency, 2);
assert.equal(response.body.execution_control.global_provider_concurrency, 2, "multiple keys must not silently exceed the measured production knee");
assert.equal(response.body.execution_control.stage_capacity.paddle_ocr.capacity_control_enabled, false);
assert.equal(response.body.execution_control.stage_capacity.paddle_ocr.global_capacity, 8);
assert.equal(response.body.execution_control.stage_capacity.paddle_ocr.anchor_concurrency, 4);
assert.equal(response.body.execution_control.stage_capacity.paddle_ocr.detail_concurrency, 1);
assert.equal(response.body.execution_control.stage_capacity.catalog.capacity_control_enabled, false);
assert.equal(response.body.execution_control.stage_capacity.catalog.global_capacity, 4);
assert.equal(response.body.execution_control.stage_capacity.catalog.query_concurrency, 4);
assert.equal(response.body.execution_control.stage_capacity.vector.capacity_control_enabled, false);
assert.equal(response.body.execution_control.stage_capacity.vector.global_capacity, 4);
assert.equal(response.body.execution_control.stage_capacity.vector.index_concurrency, 2);
assert.doesNotMatch(JSON.stringify(response.body.execution_control), /test-openai-key/);
assert.doesNotMatch(JSON.stringify(response.body.workflow_readiness), /test-openai-key|test-service-role|example\.supabase/);
assert.doesNotMatch(JSON.stringify(response.body.workflow_readiness), /test-vector-token|vector\.worker\.test/);

process.env.V4_PROVIDER_DONE_CAPACITY_HANDOFF_ENABLED = "false";
response = await callStatus();
assert.equal(response.body.execution_control.provider_done_capacity_handoff_enabled, false);
delete process.env.V4_PROVIDER_DONE_CAPACITY_HANDOFF_ENABLED;

let openai = response.body.providers.find((provider) => provider.id === "openai_legacy");
assert.deepEqual(response.body.providers.map((provider) => provider.id), ["openai_legacy"]);
assert.equal(openai.selectable, true);
assert.equal(openai.role, "primary");
assert.deepEqual(openai.roles, ["primary"]);
assert.equal(openai.requires_explicit_retry, false);

process.env.PREINGESTION_OCR_STAGE_CAPACITY_CONTROL_ENABLED = "true";
response = await callStatus();
assert.equal(response.body.execution_control.stage_capacity.paddle_ocr.capacity_control_enabled, true);
delete process.env.PREINGESTION_OCR_STAGE_CAPACITY_CONTROL_ENABLED;

process.env.RETRIEVAL_CATALOG_STAGE_CAPACITY_CONTROL_ENABLED = "true";
process.env.VECTOR_QUERY_STAGE_CAPACITY_CONTROL_ENABLED = "true";
response = await callStatus();
assert.equal(response.body.execution_control.stage_capacity.catalog.capacity_control_enabled, true);
assert.equal(response.body.execution_control.stage_capacity.vector.capacity_control_enabled, true);
delete process.env.RETRIEVAL_CATALOG_STAGE_CAPACITY_CONTROL_ENABLED;
delete process.env.VECTOR_QUERY_STAGE_CAPACITY_CONTROL_ENABLED;

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
