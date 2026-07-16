import assert from "node:assert/strict";
import {
  callRecognitionCoreWithGpt5EmptyRetry,
  scopeV4RecognitionPayload,
  validateV4PreingestionBundle
} from "../api/v4/listing-copilot-title.js";
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

  const scoped = scopeV4RecognitionPayload({
    payload: {
      tenant_id: "tenant_b",
      tenantId: "tenant_b",
      operator_id: "user_b",
      operatorId: "user_b",
      created_by_user_id: "user_b",
      assigned_to_user_id: "user_b",
      recognition_session_id: "session_b",
      recognitionSessionId: "session_b_camel",
      asset_id: "asset_a",
      assetId: "asset_b_forged",
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
    },
    context: { tenantId: "tenant_a", userId: "user_a" },
    workerAuthorized: false
  });

  assert.equal(scoped.tenant_id, "tenant_a");
  assert.equal(scoped.operator_id, "user_a");
  assert.equal(scoped.created_by_user_id, "user_a");
  assert.equal(scoped.assigned_to_user_id, "user_a");
  assert.equal(scoped.asset_id, "asset_a");
  assert.equal(Object.hasOwn(scoped, "tenantId"), false);
  assert.equal(Object.hasOwn(scoped, "assetId"), false);
  assert.equal(Object.hasOwn(scoped, "recognition_session_id"), false);
  assert.equal(Object.hasOwn(scoped, "recognitionSessionId"), false);

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

  const workerScoped = scopeV4RecognitionPayload({
    payload: {
      tenant_id: "tenant_b",
      asset_id: "asset_b_forged",
      recognition_session_id: "session_b_forged"
    },
    context: { tenantId: "tenant_a", userId: "worker_track_c" },
    persistedJob: {
      tenant_id: "tenant_a",
      asset_id: "asset_a_persisted",
      recognition_session_id: "session_a_persisted",
      created_by_user_id: "user_creator_a",
      assigned_to_user_id: "user_writer_a"
    },
    workerAuthorized: true
  });
  assert.equal(workerScoped.tenant_id, "tenant_a");
  assert.equal(workerScoped.asset_id, "asset_a_persisted");
  assert.equal(workerScoped.recognition_session_id, "session_a_persisted");
  assert.equal(workerScoped.created_by_user_id, "user_creator_a");
  assert.equal(workerScoped.assigned_to_user_id, "user_writer_a");

  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "track-c-service-role";
  const bundleCalls = [];
  const leakedBundlePayload = {
    tenant_id: "tenant_a",
    asset_id: "shared_asset_id",
    preingestion_bundle_id: "bundle_b_leaked"
  };
  const bundleValidation = await validateV4PreingestionBundle({
    payload: leakedBundlePayload,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      bundleCalls.push(url);
      assert.equal(url.pathname, "/rest/v1/preingestion_bundles");
      assert.equal(url.searchParams.get("tenant_id"), "eq.tenant_a");
      assert.equal(url.searchParams.get("bundle_id"), "eq.bundle_b_leaked");
      return { ok: true, status: 200, text: async () => "[]" };
    }
  });
  assert.equal(bundleValidation.ok, false);
  assert.equal(bundleValidation.statusCode, 404);
  assert.equal(bundleValidation.code, "PREINGESTION_BUNDLE_NOT_FOUND");
  assert.equal(bundleCalls.length, 1);
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log("V4-to-core tenant image isolation tests passed");
