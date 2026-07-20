import assert from "node:assert/strict";
import handler from "../api/listing-provider-status.js";
import { createListingSessionToken } from "../lib/listing-session.mjs";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
process.env.METAVERSE_AUTH_SECRET = "test-secret";
process.env.ENABLE_OPENAI_PROVIDER = "true";
process.env.ALLOW_EXPLICIT_OPENAI_RETRY = "true";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.OPENAI_API_KEY_POOL = "test-openai-key,test-openai-key-2";
process.env.OPENAI_PER_KEY_STABLE_CONCURRENCY = "2";
process.env.OPENAI_LISTING_MODEL = "gpt-5-mini";
process.env.V4_ULTRA_FAST_IMAGE_DETAIL = "high";
process.env.V4_ULTRA_FAST_TEXT_VERBOSITY = "medium";
process.env.V4_ULTRA_FAST_SERVICE_TIER = "priority";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.SUPABASE_SECRET_KEY = "test-auth-secret-key";
process.env.LISTING_IMAGE_BUCKET = "listing-card-images";
process.env.V4_JOB_WORKER_SECRET = "test-worker-secret";
process.env.V4_INTERNAL_BASE_URL = "https://listing.internal.test";
process.env.VECTOR_INDEX_READY = "true";
process.env.ENABLE_VECTOR_RETRIEVAL = "false";
process.env.VECTOR_RETRIEVAL_MODE = "off";
process.env.VECTOR_WORKER_URL = "https://vector.worker.test";
process.env.VECTOR_WORKER_TOKEN = "test-vector-token";
process.env.ENABLE_RECOGNITION_WORKER = "true";
process.env.RECOGNITION_WORKER_URL = "https://recognition.worker.test";
process.env.RECOGNITION_WORKER_TOKEN = "test-recognition-token";
process.env.ENABLE_PADDLE_OCR_FIELD_VERIFIER = "true";
process.env.PADDLE_OCR_WORKER_URL = "https://recognition.worker.test";
process.env.PADDLE_OCR_WORKER_TOKEN = "test-recognition-token";
process.env.PREINGESTION_OCR_STAGE_CAPACITY_CONTROL_ENABLED = "true";
process.env.RETRIEVAL_CATALOG_STAGE_CAPACITY_CONTROL_ENABLED = "true";
process.env.VECTOR_QUERY_STAGE_CAPACITY_CONTROL_ENABLED = "true";
let membershipRole = "OWNER";
globalThis.fetch = async (url) => {
  const parsed = new URL(String(url));
  if (parsed.pathname.endsWith("/tenant_members")) {
    return {
      ok: true,
      status: 200,
      json: async () => [{
        tenant_id: "tenant_alpha",
        user_id: "user_alpha",
        role: membershipRole,
        status: "ACTIVE",
        disabled_at: null,
        user: {
          id: "user_alpha",
          email: "owner@example.test",
          status: "ACTIVE",
          session_version: 1,
          disabled_at: null,
          auth_user_id: "auth_alpha"
        },
        tenant: {
          id: "tenant_alpha",
          name: "Tenant Alpha",
          plan: "pilot",
          status: "ACTIVE",
          disabled_at: null
        }
      }],
      text: async () => "[]"
    };
  }
  return {
    ok: true,
    status: 200,
    json: async () => [],
    text: async () => parsed.pathname.endsWith("/readyz")
      ? JSON.stringify({
        status: "ready",
        visual_embeddings_enabled: true,
        visual_embedding_preload_enabled: true,
        visual_embedding_preload_status: { status: "READY" },
        visual_embedding_model_id: "google/siglip2-base-patch16-384",
        visual_embedding_model_revision: "f775b65a79762255128c981547af89addcfe0f88"
      })
      : "[]"
  };
};

function sessionCookie() {
  const token = createListingSessionToken({
    user_id: "user_alpha",
    tenant_id: "tenant_alpha",
    email: "owner@example.test",
    session_version: 1
  }, process.env.METAVERSE_AUTH_SECRET);
  return `lynca_metaverse_session=${token}`;
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
assert.equal(response.body.storage.bucket, "listing-card-images");
assert.equal(response.body.storage.max_upload_bytes, 25 * 1024 * 1024);
assert.equal(response.body.storage.max_image_dimension_pixels, 12000);
assert.equal(response.body.storage.max_image_total_pixels, 50000000);
assert.doesNotMatch(JSON.stringify(response.body.storage), /test-service-role/);
assert.equal(response.body.workflow_readiness.can_run_cloud_recognition, true);
assert.equal(response.body.workflow_readiness.components.some((item) => item.id === "vision_provider"), true);
assert.equal(response.body.workflow_readiness.components.find((item) => item.id === "production_queue")?.status, "READY");
const visionReadiness = response.body.workflow_readiness.components.find((item) => item.id === "vision_provider");
assert.equal(visionReadiness.details.model_id, "gpt-5-mini");
assert.equal(visionReadiness.details.image_detail, "high");
assert.equal(visionReadiness.details.text_verbosity, "medium");
assert.equal(visionReadiness.details.service_tier, "priority");
const vectorReadiness = response.body.workflow_readiness.components.find((item) => item.id === "vector_retrieval");
assert.equal(vectorReadiness.status, "READY");
assert.equal(vectorReadiness.details.index_ready, true);
assert.equal(vectorReadiness.details.index_state, "READY");
assert.equal(vectorReadiness.details.environment_default_enabled, false);
assert.equal(vectorReadiness.details.production_request_enabled, true);
assert.equal(vectorReadiness.details.default_enabled, true);
assert.equal(vectorReadiness.details.online_retrieval_default_enabled, true);
assert.equal(vectorReadiness.details.request_override_supported, true);
assert.equal(vectorReadiness.details.runtime_ready, true);
assert.equal(vectorReadiness.details.preload_status, "READY");
assert.equal(vectorReadiness.details.prompt_influence_by_default, true);
assert.equal(vectorReadiness.details.assist_ready, true);
assert.equal(vectorReadiness.details.participation_state, "ASSIST_ACTIVE");
assert.equal(response.body.execution_control.distributed_provider_capacity_enabled, true);
assert.equal(response.body.execution_control.provider_done_capacity_handoff_enabled, true);
assert.equal(response.body.execution_control.global_fair_drain_enabled, true);
assert.equal(response.body.execution_control.queue_kick_dedup_ms, 1200);
assert.equal(response.body.execution_control.provider_key_pool_size, 2);
assert.equal(response.body.execution_control.per_key_stable_concurrency, 2);
assert.equal(response.body.execution_control.global_provider_concurrency, 2, "multiple keys must not silently exceed the measured production knee");
assert.deepEqual(response.body.execution_control.recognition_worker, { enabled: true, configured: true });
assert.deepEqual(response.body.execution_control.paddle_ocr_verifier, { enabled: true, configured: true });
assert.equal(response.body.execution_control.stage_capacity.paddle_ocr.capacity_control_enabled, true);
assert.equal(response.body.execution_control.stage_capacity.paddle_ocr.global_capacity, 8);
assert.equal(response.body.execution_control.stage_capacity.paddle_ocr.per_asset_capacity, 1);
assert.equal(response.body.execution_control.stage_capacity.paddle_ocr.per_asset_batch_size, 3);
assert.equal(response.body.execution_control.stage_capacity.paddle_ocr.anchor_concurrency, 8);
assert.equal(response.body.execution_control.stage_capacity.paddle_ocr.detail_concurrency, 2);
assert.equal(response.body.execution_control.stage_capacity.catalog.capacity_control_enabled, true);
assert.equal(response.body.execution_control.stage_capacity.catalog.global_capacity, 1);
assert.equal(response.body.execution_control.stage_capacity.catalog.query_concurrency, 4);
assert.equal(response.body.execution_control.stage_capacity.vector.capacity_control_enabled, true);
assert.equal(response.body.execution_control.stage_capacity.vector.global_capacity, 3);
assert.equal(response.body.execution_control.stage_capacity.vector.index_concurrency, 2);
assert.doesNotMatch(JSON.stringify(response.body.execution_control), /test-openai-key/);
assert.doesNotMatch(JSON.stringify(response.body.workflow_readiness), /test-openai-key|test-service-role|example\.supabase/);
assert.doesNotMatch(JSON.stringify(response.body.workflow_readiness), /test-vector-token|vector\.worker\.test/);

membershipRole = "WRITER";
response = await callStatus();
assert.equal(response.statusCode, 200);
assert.equal(response.body.default_provider, "openai_legacy");
assert.equal(response.body.storage.configured, true);
assert.equal(response.body.providers[0].selectable, true);
assert.equal(response.body.workflow_readiness.can_run_cloud_recognition, true);
assert.equal("execution_control" in response.body, false, "Writer must not receive provider capacity controls");
assert.equal("deployment" in response.body, false, "Writer must not receive deployment diagnostics");
assert.equal("components" in response.body.workflow_readiness, false, "Writer readiness must be summary-only");
assert.equal("blockers" in response.body.workflow_readiness, false, "Writer readiness must omit infrastructure blockers");
assert.equal("bucket" in response.body.storage, false, "Writer storage DTO must omit internal bucket names");
assert.equal("missing" in response.body.storage, false);
assert.equal("key_pool_size" in response.body.providers[0], false);
assert.equal("recommended_concurrency" in response.body.providers[0], false);

membershipRole = "MANAGER";
response = await callStatus();
assert.equal(response.statusCode, 200);
assert.equal(response.body.execution_control.provider_key_pool_size, 2, "Manager may view tenant operations diagnostics");
membershipRole = "OWNER";

delete process.env.V4_INTERNAL_BASE_URL;
response = await callStatus();
assert.equal(response.body.workflow_readiness.can_run_cloud_recognition, false);
assert.equal(response.body.workflow_readiness.blockers.includes("production_queue"), true);
assert.equal(response.body.workflow_readiness.components.find((item) => item.id === "production_queue")?.status, "NOT_CONFIGURED");
process.env.V4_INTERNAL_BASE_URL = "https://listing.internal.test";
response = await callStatus();
assert.equal(response.body.workflow_readiness.can_run_cloud_recognition, true);

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

process.env.PREINGESTION_OCR_STAGE_CAPACITY_CONTROL_ENABLED = "false";
response = await callStatus();
assert.equal(response.body.execution_control.stage_capacity.paddle_ocr.capacity_control_enabled, false);
process.env.PREINGESTION_OCR_STAGE_CAPACITY_CONTROL_ENABLED = "true";

process.env.RETRIEVAL_CATALOG_STAGE_CAPACITY_CONTROL_ENABLED = "false";
process.env.VECTOR_QUERY_STAGE_CAPACITY_CONTROL_ENABLED = "false";
response = await callStatus();
assert.equal(response.body.execution_control.stage_capacity.catalog.capacity_control_enabled, false);
assert.equal(response.body.execution_control.stage_capacity.vector.capacity_control_enabled, false);
process.env.RETRIEVAL_CATALOG_STAGE_CAPACITY_CONTROL_ENABLED = "true";
process.env.VECTOR_QUERY_STAGE_CAPACITY_CONTROL_ENABLED = "true";

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
process.env.ENABLE_OPENAI_PROVIDER = "false";
response = await callStatus();
assert.deepEqual(response.body.providers.map((provider) => provider.id), []);
assert.equal(response.body.default_provider, "");

process.env.ENABLE_OPENAI_PROVIDER = "true";
process.env.ALLOW_EXPLICIT_OPENAI_RETRY = "false";
response = await callStatus();
assert.equal(response.body.default_provider, "openai_legacy");
openai = response.body.providers.find((provider) => provider.id === "openai_legacy");
assert.equal(openai.selectable, true);
assert.equal(openai.disabled_reason, null);

process.env.PROVIDER_STATUS_READINESS_TIMEOUT_MS = "100";
process.env.VECTOR_WORKER_URL = "https://slow-vector.worker.test";
const fastFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const parsed = new URL(String(url));
  if (parsed.pathname.endsWith("/tenant_members")) return fastFetch(url, init);
  return new Promise((resolve, reject) => {
    const signal = init.signal;
    if (signal?.aborted) {
      reject(signal.reason || new Error("aborted"));
      return;
    }
    signal?.addEventListener("abort", () => {
      reject(signal.reason || new Error("aborted"));
    }, { once: true });
  });
};
const slowReadinessStartedAt = Date.now();
response = await callStatus();
assert.ok(Date.now() - slowReadinessStartedAt < 1000, "provider bootstrap must not inherit a slow deep-audit tail");
assert.equal(response.statusCode, 200);
assert.equal(response.body.storage.configured, true);
assert.equal(response.body.workflow_readiness.can_run_cloud_recognition, true);
assert.equal(response.body.workflow_readiness.diagnostics_deferred, true);
assert.equal(response.body.workflow_readiness.diagnostics_reason, "deep_diagnostics_timeout");
globalThis.fetch = fastFetch;
delete process.env.PROVIDER_STATUS_READINESS_TIMEOUT_MS;

Object.keys(process.env).forEach((key) => {
  if (!(key in originalEnv)) delete process.env[key];
});
Object.assign(process.env, originalEnv);
globalThis.fetch = originalFetch;

console.log("provider status tests passed");
