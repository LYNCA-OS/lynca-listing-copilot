import assert from "node:assert/strict";
import { callRecognitionCoreWithGpt5EmptyRetry } from "../api/v4/listing-copilot-title.js";
import { scopeV4RecognitionPayloadFromFencedJob } from "../lib/listing/v4/session/trusted-session-identity.mjs";
import { createListingImageVerificationToken } from "../lib/listing/storage/supabase-image-storage.mjs";

const originalFetch = globalThis.fetch;
const trackedEnv = [
  "OPENAI_API_KEY",
  "LISTING_IMAGE_VERIFICATION_SECRET",
  "LISTING_PRE_PROVIDER_RESCAN_GATE_ENABLED",
  "RECOGNITION_WORKER_URL",
  "RECOGNITION_WORKER_TOKEN",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY"
];
const originalEnv = Object.fromEntries(trackedEnv.map((key) => [key, process.env[key]]));

try {
  process.env.OPENAI_API_KEY = "sk-test-tenant-image-isolation";
  process.env.LISTING_IMAGE_VERIFICATION_SECRET = "track-c-image-verification-secret";
  process.env.LISTING_PRE_PROVIDER_RESCAN_GATE_ENABLED = "false";
  delete process.env.RECOGNITION_WORKER_URL;
  delete process.env.RECOGNITION_WORKER_TOKEN;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const tenantBDescriptor = {
    tenantId: "tenant_b",
    objectPath: "tenants/tenant_b/listing-assets/asset_b/front.jpg",
    bucket: "listing-card-images",
    contentType: "image/jpeg",
    size: 120_000,
    width: 1200,
    height: 1680
  };
  const tenantBToken = createListingImageVerificationToken({
    ...tenantBDescriptor,
    env: process.env
  });

  const scoped = scopeV4RecognitionPayloadFromFencedJob({
    id: "job_tenant_image_isolation",
    tenant_id: "tenant_a",
    operator_id: "user_a",
    created_by_user_id: "user_creator_a",
    assigned_to_user_id: "user_writer_a",
    recognition_session_id: "session_a_persisted",
    asset_id: "asset_11111111-1111-4111-8111-111111111111",
    status: "RUNNING",
    lease_owner: "worker_track_c",
    lease_expires_at: "2099-01-01T00:00:00.000Z",
    job_type: "FINAL_ASSISTED_TITLE",
    lane: "background",
    payload: {
      tenant_id: "tenant_b",
      tenantId: "tenant_b",
      operator_id: "user_b",
      operatorId: "user_b",
      created_by_user_id: "user_b",
      assigned_to_user_id: "user_b",
      recognition_session_id: "session_b",
      recognitionSessionId: "session_b_camel",
      asset_id: "asset_22222222-2222-4222-8222-222222222222",
      assetId: "asset_b_forged",
      client_asset_ref: "client-asset-a",
      preingestion_bundle_id: "bundle_b_forged",
      provider: "openai_legacy",
      provider_options: {
        disable_approved_identity_memory: true,
        disable_identity_result_cache: true,
        enable_catalog_assist: false,
        enable_hybrid_retrieval: false,
        enable_advanced_retrieval: false,
        enable_vector_assist: false,
        enable_vector_retrieval: false
      },
      images: [{
        id: "front",
        role: "front_original",
        object_path: tenantBDescriptor.objectPath,
        bucket: tenantBDescriptor.bucket,
        content_type: tenantBDescriptor.contentType,
        size: tenantBDescriptor.size,
        width: tenantBDescriptor.width,
        height: tenantBDescriptor.height,
        storage_verified: true,
        storage_verification_token: tenantBToken
      }]
    }
  });

  assert.equal(scoped.tenant_id, "tenant_a");
  assert.equal(scoped.operator_id, "user_a");
  assert.equal(scoped.created_by_user_id, "user_creator_a");
  assert.equal(scoped.assigned_to_user_id, "user_writer_a");
  assert.equal(scoped.asset_id, "asset_11111111-1111-4111-8111-111111111111");
  assert.equal(scoped.recognition_session_id, "session_a_persisted");
  assert.equal(Object.hasOwn(scoped, "tenantId"), false);
  assert.equal(Object.hasOwn(scoped, "assetId"), false);
  assert.equal(Object.hasOwn(scoped, "recognitionSessionId"), false);
  assert.equal(Object.hasOwn(scoped, "preingestion_bundle_id"), false);

  const externalCalls = [];
  globalThis.fetch = async (input) => {
    externalCalls.push(String(input));
    throw new Error("cross-tenant image must be rejected before any external call");
  };
  const response = await callRecognitionCoreWithGpt5EmptyRetry({
    payload: scoped,
    headers: { "x-request-id": "req-v4-core-tenant-image" }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.confidence, "FAILED");
  assert.match(response.body.reason, /different tenant|does not match image metadata/i);
  assert.deepEqual(externalCalls, [], "V4-to-core bridge must reject the foreign image before storage/provider access");

  const forwardedSignal = new AbortController().signal;
  let observedSignal = null;
  const injected = await callRecognitionCoreWithGpt5EmptyRetry({
    payload: { model: "gpt-5-mini" },
    signal: forwardedSignal,
    coreRunner: async ({ requestContext }) => {
      observedSignal = requestContext.signal;
      return { statusCode: 200, body: { title: "Injected result" } };
    }
  });
  assert.equal(injected.body.title, "Injected result");
  assert.equal(observedSignal, forwardedSignal, "the worker lease signal must reach the recognition core");

  const retryAbort = new AbortController();
  let runnerCalls = 0;
  const abortedRetry = await callRecognitionCoreWithGpt5EmptyRetry({
    payload: { model: "gpt-5-mini" },
    signal: retryAbort.signal,
    coreRunner: async () => {
      runnerCalls += 1;
      retryAbort.abort({ code: "QUEUE_LEASE_LOST", retryable: false });
      return { statusCode: 200, body: { confidence: "FAILED" } };
    }
  });
  assert.equal(runnerCalls, 1, "an aborted lease must suppress the paid empty-result retry");
  assert.equal(abortedRetry.statusCode, 409);
  assert.equal(abortedRetry.body.error_code, "QUEUE_LEASE_LOST");
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log("V4-to-core tenant image isolation tests passed");
