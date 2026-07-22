import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import handler, { reusablePreingestionBundle } from "../api/listing-preingest.js";
import { cookieName, createListingSessionToken } from "../lib/listing-session.mjs";
import { preingestionOcrJobVersion } from "../lib/listing/preingestion/preingestion-bundle.mjs";

process.env.METAVERSE_AUTH_SECRET = "test-secret";
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
process.env.LISTING_IMAGE_BUCKET = "listing-card-images";
process.env.LISTING_IMAGE_SIGNED_URL_TTL_SECONDS = "600";
process.env.ENABLE_PADDLE_OCR_FIELD_VERIFIER = "true";
process.env.PADDLE_OCR_WORKER_URL = "https://ocr.test";
process.env.PADDLE_OCR_WORKER_TOKEN = "test-ocr-token";
process.env.V4_INTERNAL_BASE_URL = "https://internal.test";
process.env.V4_JOB_WORKER_SECRET = "test-worker-secret";
const assetId = "asset_22222222-2222-4222-8222-222222222222";
const otherAssetId = "asset_33333333-3333-4333-8333-333333333333";

function sessionCookie() {
  const token = createListingSessionToken({
    tenantId: "tenant_a",
    userId: "user_manager",
    email: "manager@example.test",
    sessionVersion: 1
  }, process.env.METAVERSE_AUTH_SECRET);
  return `${cookieName}=${token}`;
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  };
}

async function callApi(payload) {
  const req = new EventEmitter();
  req.method = "POST";
  req.headers = { cookie: sessionCookie() };
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
  const promise = handler(req, res);
  setTimeout(() => {
    req.emit("data", JSON.stringify(payload));
    req.emit("end");
  });
  await promise;
  return {
    statusCode: res.statusCode,
    body: JSON.parse(res.body)
  };
}

const verificationRows = [
  {
    tenant_id: "tenant_a",
    object_path: `tenants/tenant_a/listing-assets/2026-07-06/${assetId}/front.jpg`,
    bucket: "listing-card-images",
    asset_id: assetId,
    image_id: "front",
    storage_role: "front_original",
    image_generation_id: assetId,
    crop_metadata: null,
    canonical_eligible: true,
    content_type: "image/jpeg",
    size: 1200,
    width: 900,
    height: 1260,
    content_sha256: "a".repeat(64),
    object_verified: true,
    content_hash_verified: true,
    dimension_source: "upload",
    verified_at: "2026-07-06T00:00:00.000Z",
    updated_at: "2026-07-06T00:00:00.000Z"
  },
  {
    tenant_id: "tenant_a",
    object_path: `tenants/tenant_a/listing-assets/2026-07-06/${assetId}/back.jpg`,
    bucket: "listing-card-images",
    asset_id: assetId,
    image_id: "back",
    storage_role: "back_original",
    image_generation_id: assetId,
    crop_metadata: null,
    canonical_eligible: true,
    content_type: "image/jpeg",
    size: 1300,
    width: 900,
    height: 1260,
    content_sha256: "b".repeat(64),
    object_verified: true,
    content_hash_verified: true,
    dimension_source: "upload",
    verified_at: "2026-07-06T00:00:00.000Z",
    updated_at: "2026-07-06T00:00:00.000Z"
  }
];

const calls = [];
let bundleWrite = null;
let jobsWrite = null;
let activeVerificationRows = verificationRows;
let listingAssetVisible = true;
globalThis.fetch = async (url, init = {}) => {
  const parsed = new URL(String(url));
  calls.push({
    path: parsed.pathname,
    search: Object.fromEntries(parsed.searchParams.entries()),
    method: init.method || "GET",
    body: init.body ? JSON.parse(init.body) : null
  });

  if (parsed.pathname.endsWith("/tenant_members")) {
    return new Response(JSON.stringify([{
      tenant_id: "tenant_a",
      user_id: "user_manager",
      role: "MANAGER",
      status: "ACTIVE",
      disabled_at: null,
      user: { id: "user_manager", email: "manager@example.test", status: "ACTIVE", session_version: 1, disabled_at: null },
      tenant: { id: "tenant_a", name: "Tenant A", plan: "pilot", status: "ACTIVE", disabled_at: null }
    }]), { status: 200, headers: { "content-type": "application/json" } });
  }

  if (parsed.pathname.endsWith("/listing_image_verifications")) {
    assert.equal(parsed.searchParams.get("asset_id"), `eq.${assetId}`);
    assert.equal(parsed.searchParams.get("tenant_id"), "eq.tenant_a");
    assert.equal(parsed.searchParams.get("image_generation_id"), `eq.${assetId}`);
    assert.equal(parsed.searchParams.get("object_verified"), "eq.true");
    assert.equal(parsed.searchParams.get("canonical_eligible"), "eq.true");
    return jsonResponse(activeVerificationRows);
  }

  if (parsed.pathname.endsWith("/listing_assets")) {
    assert.equal(init.method, undefined);
    assert.equal(parsed.searchParams.get("tenant_id"), "eq.tenant_a");
    assert.equal(parsed.searchParams.get("id"), `eq.${assetId}`);
    return jsonResponse(listingAssetVisible ? [{
      tenant_id: "tenant_a",
      id: assetId,
      image_generation_id: assetId,
      expected_original_count: 2,
      image_set_state: "FINALIZED"
    }] : []);
  }

  if (parsed.pathname.includes("/storage/v1/object/sign/")) {
    return jsonResponse({
      signedURL: "/object/sign/listing-card-images/read-token"
    });
  }

  if (parsed.pathname.endsWith("/preingestion_bundles")) {
    if (!init.method) {
      if (parsed.searchParams.get("select") === "bundle_id") {
        return jsonResponse(bundleWrite ? [{ bundle_id: bundleWrite.bundle_id }] : []);
      }
      return jsonResponse(bundleWrite ? [bundleWrite] : []);
    }
    bundleWrite = JSON.parse(init.body);
    return jsonResponse([bundleWrite], 201);
  }

  if (parsed.pathname.endsWith("/preingestion_jobs")) {
    if (!init.method) {
      return jsonResponse(Array.isArray(jobsWrite) ? jobsWrite : []);
    }
    jobsWrite = JSON.parse(init.body);
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify(jobsWrite)
    };
  }

  if (parsed.pathname.endsWith("/api/v4/listing-preingest-worker")) {
    assert.equal(init.headers["x-lynca-worker-secret"], "test-worker-secret");
    assert.equal(JSON.parse(init.body).anchor_only, true);
    return jsonResponse({ ok: true, claimed: 1, succeeded: 1 });
  }

  throw new Error(`Unexpected fetch ${parsed.href}`);
};

const result = await callApi({
  asset_id: assetId,
  source: "client_defined_untrusted_source",
  requested_fields: ["serial_number", "grade_label"],
  images: [
    {
      asset_id: assetId,
      image_id: "forged-front",
      role: "back_original",
      object_path: verificationRows[0].object_path,
      bucket: "listing-card-images",
      content_sha256: "f".repeat(64),
      width: 1,
      height: 1,
      size: 1,
      object_verified: true,
      content_hash_verified: true
    },
    {
      asset_id: assetId,
      image_id: "legacy-path",
      role: "front_original",
      object_path: `listing-assets/2026-07-06/${assetId}/legacy.jpg`,
      bucket: "listing-card-images",
      content_sha256: "e".repeat(64),
      width: 9999,
      height: 9999,
      object_verified: true,
      content_hash_verified: true
    }
  ],
  initial_evidence: {
    print_run_candidate: {
      value: "#/3",
      source_type: "PREINGESTION_DETERMINISTIC",
      source_image_id: "front",
      confidence: 0.8
    }
  },
  evidence_patches: [{
    field: "serial_number",
    value: "2/3",
    raw_text: "2/3",
    source_type: "OCR",
    source_image_id: "front",
    crop_id: "serial-front",
    confidence: 0.94
  }]
});

assert.equal(result.statusCode, 200, JSON.stringify(result.body));
assert.equal(result.body.ok, true);
assert.equal(result.body.preingestion_cache_hit, false);
assert.equal(result.body.preingestion_cache_reason, "missing_bundle");
assert.equal(result.body.bundle_id, bundleWrite.bundle_id);
assert.equal(result.body.saved, true);
assert.equal(result.body.preprocessing_summary.image_count, 2);
assert.equal(result.body.signed_read_url_count, 2);
assert.ok(result.body.worker_jobs_enqueued >= 2);
for (const phase of [
  "canonical_bundle_lookup_ms",
  "canonical_image_read_ms",
  "signed_read_url_check_ms",
  "existing_bundle_read_ms",
  "current_ocr_jobs_read_ms",
  "bundle_write_ms",
  "worker_job_enqueue_ms",
  "total_ms"
]) {
  assert.equal(Number.isFinite(result.body.preingestion_timing?.[phase]), true, `${phase} must be observable`);
}
assert.equal(result.body.ocr_dispatch_started, true);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.ok(calls.some((call) => call.path.endsWith("/api/v4/listing-preingest-worker")));
assert.equal(bundleWrite.asset_id, assetId);
assert.equal(bundleWrite.tenant_id, "tenant_a");
assert.equal(bundleWrite.source, "listing_preingest_api", "untrusted source names must not create arbitrary bundle lanes");
assert.equal(bundleWrite.images.length, 2);
assert.deepEqual(bundleWrite.images.map((image) => ({
  id: image.image_id,
  role: image.role,
  sha256: image.content_sha256,
  width: image.width,
  height: image.height
})), [
  { id: "front", role: "front_original", sha256: "a".repeat(64), width: 900, height: 1260 },
  { id: "back", role: "back_original", sha256: "b".repeat(64), width: 900, height: 1260 }
], "pre-ingestion must replace, not merge, browser image identity and dimensions");
assert.deepEqual(bundleWrite.initial_evidence, {}, "browser initial evidence must be ignored");
assert.deepEqual(bundleWrite.evidence_patches, [], "browser evidence patches must be ignored");
assert.equal(JSON.stringify(bundleWrite).includes("read-token"), false, "signed read URLs must not be written to Supabase");
assert.equal(calls.some((call) => call.path.endsWith("/image_derived_assets")), false, "legacy non-generation-scoped derived rows must not enter the canonical bundle");
assert.ok(Array.isArray(jobsWrite));
// Consumerless job types default OFF; only OCR crop jobs are enqueued.
assert.ok(jobsWrite.every((job) => job.job_type === "ocr_crop_verification"));
assert.ok(jobsWrite.every((job) => job.tenant_id === "tenant_a"));
assert.equal(new Set(jobsWrite.map((job) => job.job_key)).size, jobsWrite.length);

// Re-ingestion retains only evidence produced by the authenticated OCR worker.
const trustedWorkerPatch = {
  patch_id: "worker-patch",
  field: "serial_number",
  value: "2/3",
  raw_text: "2/3",
  source_type: "OCR",
  source_image_id: "front",
  crop_id: "serial-front",
  confidence: 0.94,
  provenance: {
    generated_by: "preingestion_ocr_worker",
    job_key: `ocr:${preingestionOcrJobVersion}:${bundleWrite.bundle_id}:serial-front`
  }
};
bundleWrite.initial_evidence = {
  print_run_candidate: {
    value: "forged-legacy",
    source_type: "PREINGESTION_DETERMINISTIC",
    source_image_id: "front"
  }
};
bundleWrite.evidence_patches = [
  trustedWorkerPatch,
  {
    ...trustedWorkerPatch,
    patch_id: "browser-forgery",
    value: "999/999",
    provenance: { generated_by: "browser", job_key: "forged" }
  }
];
const secondResult = await callApi({
  asset_id: assetId,
  requested_fields: ["serial_number", "grade_label"],
  initial_evidence: { print_run_candidate: { value: "still-forged" } },
  evidence_patches: [{
    field: "grade_label",
    value: "PRISTINE 10",
    source_type: "OCR",
    source_image_id: "front",
    provenance: {
      generated_by: "preingestion_ocr_worker",
      job_key: `ocr:${preingestionOcrJobVersion}:${bundleWrite.bundle_id}:client-forgery`
    }
  }]
});
assert.equal(secondResult.statusCode, 200);
assert.deepEqual(bundleWrite.initial_evidence, {});
assert.equal(bundleWrite.evidence_patches.length, 1);
assert.equal(bundleWrite.evidence_patches[0].value, "2/3");

const signedCallsBeforeFastPath = calls.filter((call) => call.path.includes("/storage/v1/object/sign/")).length;
const fastPreingestResult = await callApi({
  asset_id: assetId,
  requested_fields: ["serial_number", "grade_label"],
  verify_signed_read_urls: false
});
assert.equal(fastPreingestResult.statusCode, 200);
assert.equal(fastPreingestResult.body.signed_read_url_count, 0);
assert.equal(
  calls.filter((call) => call.path.includes("/storage/v1/object/sign/")).length,
  signedCallsBeforeFastPath,
  "verified uploads must be able to skip redundant pre-ingestion signing"
);

const expectedOcrJobCount = jobsWrite.length;
bundleWrite.quality_summary.ocr_stage_execution = {
  claimed: expectedOcrJobCount,
  succeeded: expectedOcrJobCount,
  failed: 0,
  requeued: 0,
  deferred: 0,
  lease_lost: 0,
  unaccounted_claimed_job_count: 0,
  duplicate_outcome_count: 0,
  all_claimed_jobs_accounted_for: true
};
jobsWrite = jobsWrite.map((job) => ({ ...job, status: "succeeded" }));
const writesBeforeCacheHit = calls.filter((call) => (
  (call.path.endsWith("/preingestion_bundles") || call.path.endsWith("/preingestion_jobs"))
  && call.method === "POST"
)).length;
const signedCallsBeforeCacheHit = calls.filter((call) => call.path.includes("/storage/v1/object/sign/")).length;
const cacheHitResult = await callApi({
  asset_id: assetId,
  requested_fields: ["serial_number", "grade_label"]
});
assert.equal(cacheHitResult.statusCode, 200);
assert.equal(cacheHitResult.body.preingestion_cache_hit, true);
assert.equal(cacheHitResult.body.preingestion_cache_reason, "immutable_bundle_current_ocr_complete");
assert.equal(cacheHitResult.body.worker_jobs_enqueued, 0);
assert.equal(cacheHitResult.body.signed_read_url_check_skipped, true);
assert.equal(
  calls.filter((call) => (
    (call.path.endsWith("/preingestion_bundles") || call.path.endsWith("/preingestion_jobs"))
    && call.method === "POST"
  )).length,
  writesBeforeCacheHit,
  "a fully completed immutable OCR contract must not be written or enqueued again"
);
assert.equal(
  calls.filter((call) => call.path.includes("/storage/v1/object/sign/")).length,
  signedCallsBeforeCacheHit,
  "an immutable cache hit must not repeat signed URL checks"
);
const unsafePartialJobs = reusablePreingestionBundle({
  existingBundle: {
    ...bundleWrite,
    quality_summary: {
      ...bundleWrite.quality_summary,
      ocr_stage_execution: {
        ...bundleWrite.quality_summary.ocr_stage_execution,
        claimed: expectedOcrJobCount - 1,
        succeeded: expectedOcrJobCount - 1
      }
    }
  },
  tenantId: "tenant_a",
  assetId,
  source: "listing_preingest_api",
  images: verificationRows,
  cropPlan: bundleWrite.crop_plan,
  currentOcrJobs: jobsWrite.slice(0, -1),
  enqueueWorkers: true,
  enqueueOcr: true
});
assert.equal(unsafePartialJobs.reusable, false, "partial OCR completion must fail closed");

const missing = await callApi({ asset_id: "" });
assert.equal(missing.statusCode, 400);
assert.equal(missing.body.ok, false);

const nonDurable = await callApi({ asset_id: "asset-1" });
assert.equal(nonDurable.statusCode, 400);
assert.equal(nonDurable.body.code, "invalid_durable_listing_asset_id");

const bundleWritesBeforeScopeFailures = calls.filter((call) => (
  call.path.endsWith("/preingestion_bundles") && call.method === "POST"
)).length;

activeVerificationRows = [{
  ...verificationRows[0],
  image_generation_id: otherAssetId
}, verificationRows[1]];
const crossGeneration = await callApi({
  asset_id: assetId,
  verify_signed_read_urls: false,
  enqueue_workers: false
});
assert.equal(crossGeneration.statusCode, 422);
assert.equal(crossGeneration.body.code, "canonical_image_generation_mismatch");

activeVerificationRows = [{
  ...verificationRows[0],
  tenant_id: "tenant_b"
}, verificationRows[1]];
const crossTenant = await callApi({
  asset_id: assetId,
  verify_signed_read_urls: false,
  enqueue_workers: false
});
assert.equal(crossTenant.statusCode, 422);
assert.equal(crossTenant.body.code, "canonical_image_tenant_mismatch");

activeVerificationRows = [{
  ...verificationRows[0],
  asset_id: otherAssetId
}, verificationRows[1]];
const crossAsset = await callApi({
  asset_id: assetId,
  verify_signed_read_urls: false,
  enqueue_workers: false
});
assert.equal(crossAsset.statusCode, 422);
assert.equal(crossAsset.body.code, "canonical_image_asset_mismatch");

activeVerificationRows = verificationRows;
listingAssetVisible = false;
const tenantScopedAssetMiss = await callApi({
  asset_id: assetId,
  verify_signed_read_urls: false,
  enqueue_workers: false
});
assert.equal(tenantScopedAssetMiss.statusCode, 404);
assert.equal(tenantScopedAssetMiss.body.code, "canonical_listing_asset_not_found");
listingAssetVisible = true;

assert.equal(calls.filter((call) => (
  call.path.endsWith("/preingestion_bundles") && call.method === "POST"
)).length, bundleWritesBeforeScopeFailures, "scope or generation failures must not persist a bundle");

console.log("listing preingest api tests passed");
