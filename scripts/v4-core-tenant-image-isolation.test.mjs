import assert from "node:assert/strict";
import {
  callRecognitionCoreWithGpt5EmptyRetry
} from "../api/v4/listing-copilot-title.js";
import { preingestionOcrScopeFromPayload } from "../api/listing-copilot-title.js";
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

  const tenantAAssetId = "asset_11111111-1111-4111-8111-111111111111";
  const tenantBAssetId = "asset_22222222-2222-4222-8222-222222222222";
  const tenantBDescriptor = {
    tenantId: "tenant_b",
    objectPath: `tenants/tenant_b/listing-assets/2026-07-17/${tenantBAssetId}/front.jpg`,
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

  const leaseExpiresAt = new Date(Date.now() + 60_000).toISOString();
  const scoped = scopeV4RecognitionPayloadFromFencedJob({
    id: "job_a",
    lease_owner: "worker_a",
    lease_expires_at: leaseExpiresAt,
    status: "RUNNING",
    recognition_session_id: "session_a",
    tenant_id: "tenant_a",
    operator_id: "user_a",
    asset_id: tenantAAssetId,
    job_type: "ASSISTED_DRAFT",
    payload: {
      tenant_id: "tenant_b",
      tenantId: "tenant_b",
      operator_id: "user_b",
      operatorId: "user_b",
      created_by_user_id: "user_b",
      assigned_to_user_id: "user_b",
      recognition_session_id: "session_b",
      recognitionSessionId: "session_b_camel",
      asset_id: tenantBAssetId,
      assetId: tenantBAssetId,
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
      }],
      preingestion_bundle_id: "bundle_b_leaked",
      preingestionBundle: { tenant_id: "tenant_b" },
      preingestionSummary: { forged: true },
      preingestionEvidencePatches: [{ forged: true }]
    }
  });

  assert.equal(scoped.tenant_id, "tenant_a");
  assert.equal(scoped.operator_id, "user_a");
  assert.equal(scoped.created_by_user_id, "user_a");
  assert.equal(scoped.assigned_to_user_id, "user_a");
  assert.equal(scoped.asset_id, tenantAAssetId);
  assert.equal(Object.hasOwn(scoped, "tenantId"), false);
  assert.equal(Object.hasOwn(scoped, "assetId"), false);
  assert.equal(scoped.recognition_session_id, "session_a");
  assert.equal(Object.hasOwn(scoped, "recognitionSessionId"), false);
  assert.equal(Object.hasOwn(scoped, "preingestion_bundle_id"), false);
  assert.equal(Object.hasOwn(scoped, "preingestionBundle"), false);
  assert.equal(Object.hasOwn(scoped, "preingestionSummary"), false);
  assert.equal(Object.hasOwn(scoped, "preingestionEvidencePatches"), false);

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

  const workerScoped = scopeV4RecognitionPayloadFromFencedJob({
    id: "job_worker",
    lease_owner: "worker_track_c",
    lease_expires_at: leaseExpiresAt,
    status: "RUNNING",
    recognition_session_id: "session_a_persisted",
    tenant_id: "tenant_a",
    operator_id: "user_creator_a",
    asset_id: tenantAAssetId,
    job_type: "ASSISTED_DRAFT",
    payload: {
      tenant_id: "tenant_b",
      asset_id: tenantBAssetId,
      recognition_session_id: "session_b_forged"
    }
  });
  assert.equal(workerScoped.tenant_id, "tenant_a");
  assert.equal(workerScoped.asset_id, tenantAAssetId);
  assert.equal(workerScoped.recognition_session_id, "session_a_persisted");
  assert.equal(workerScoped.v4_origin_tenant_id, "tenant_a");
  assert.equal(workerScoped.v4_origin_operator_id, "user_creator_a");

  assert.deepEqual(preingestionOcrScopeFromPayload({
    tenant_id: workerScoped.tenant_id,
    asset_id: workerScoped.asset_id,
    preingestion_bundle_id: "bundle_tenant_a"
  }), {
    tenantId: "tenant_a",
    assetId: tenantAAssetId,
    bundleId: "bundle_tenant_a"
  });
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log("V4-to-core tenant image isolation tests passed");
