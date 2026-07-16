import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import handler from "../api/listing-preingest.js";
import v4Handler, { v4PreingestionResponseStatus } from "../api/v4/listing-preingest.js";
import { cookieName, createListingSessionToken } from "../lib/listing-session.mjs";

process.env.METAVERSE_AUTH_SECRET = "test-secret";
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
process.env.LISTING_IMAGE_BUCKET = "listing-card-images";
process.env.LISTING_IMAGE_SIGNED_URL_TTL_SECONDS = "600";
const assetId = "asset_22222222-2222-4222-8222-222222222222";
const missingAssetId = "asset_33333333-3333-4333-8333-333333333333";

assert.equal(v4PreingestionResponseStatus(200, false), 503);
assert.equal(v4PreingestionResponseStatus(201, false), 503);
assert.equal(v4PreingestionResponseStatus(200, true), 200);
assert.equal(v4PreingestionResponseStatus(404, false), 404);
assert.equal(v4PreingestionResponseStatus(undefined, false), 500);

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

async function callApi(payload, targetHandler = handler) {
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
  const promise = targetHandler(req, res);
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
const v4BundleWrites = [];
let failV4BundleWrite = false;
let bundleWrite = null;
let jobsWrite = null;
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
    return jsonResponse(verificationRows);
  }

  if (parsed.pathname.endsWith("/listing_assets")) {
    assert.equal(init.method, undefined);
    assert.equal(parsed.searchParams.get("tenant_id"), "eq.tenant_a");
    const requestedAssetId = parsed.searchParams.get("id")?.slice(3) || "";
    return jsonResponse(requestedAssetId === assetId
      ? [{ tenant_id: "tenant_a", id: assetId }]
      : []);
  }

  if (parsed.pathname.endsWith("/image_derived_assets")) {
    return jsonResponse([]);
  }

  if (parsed.pathname.includes("/storage/v1/object/sign/")) {
    return jsonResponse({
      signedURL: "/object/sign/listing-card-images/read-token"
    });
  }

  if (parsed.pathname.endsWith("/v4_preingestion_bundles")) {
    const row = JSON.parse(init.body);
    v4BundleWrites.push({
      row,
      onConflict: parsed.searchParams.get("on_conflict")
    });
    if (failV4BundleWrite) return jsonResponse({ message: "temporary V4 write failure" }, 503);
    return jsonResponse([row], 201);
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
    jobsWrite = JSON.parse(init.body);
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify(jobsWrite)
    };
  }

  throw new Error(`Unexpected fetch ${parsed.href}`);
};

const result = await callApi({
  asset_id: assetId,
  requested_fields: ["serial_number", "grade_label"],
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

assert.equal(result.statusCode, 200);
assert.equal(result.body.ok, true);
assert.equal(result.body.bundle_id, bundleWrite.bundle_id);
assert.equal(result.body.saved, true);
assert.equal(result.body.preprocessing_summary.image_count, 2);
assert.equal(result.body.signed_read_url_count, 2);
assert.ok(result.body.worker_jobs_enqueued >= 2);
assert.equal(bundleWrite.asset_id, assetId);
assert.equal(bundleWrite.tenant_id, "tenant_a");
assert.equal(bundleWrite.images.length, 2);
assert.equal(bundleWrite.initial_evidence.print_run_candidate.value, "#/3");
assert.equal(bundleWrite.evidence_patches[0].value, "2/3");
assert.equal(JSON.stringify(bundleWrite).includes("read-token"), false, "signed read URLs must not be written to Supabase");
assert.ok(Array.isArray(jobsWrite));
// Consumerless job types default OFF; only OCR crop jobs are enqueued.
assert.ok(jobsWrite.every((job) => job.job_type === "ocr_crop_verification"));
assert.ok(jobsWrite.every((job) => job.tenant_id === "tenant_a"));
assert.equal(new Set(jobsWrite.map((job) => job.job_key)).size, jobsWrite.length);

// Re-ingestion refreshes crops and images but must retain computed OCR evidence.
const secondResult = await callApi({
  asset_id: assetId,
  requested_fields: ["serial_number", "grade_label"]
});
assert.equal(secondResult.statusCode, 200);
assert.equal(bundleWrite.evidence_patches.length, 1);
assert.equal(bundleWrite.evidence_patches[0].value, "2/3");

const signedCallsBeforeFastPath = calls.filter((call) => call.path.includes("/storage/v1/object/sign/")).length;
const fastPreingestResult = await callApi({
  asset_id: assetId,
  requested_fields: ["serial_number"],
  verify_signed_read_urls: false
});
assert.equal(fastPreingestResult.statusCode, 200);
assert.equal(fastPreingestResult.body.signed_read_url_count, 0);
assert.equal(
  calls.filter((call) => call.path.includes("/storage/v1/object/sign/")).length,
  signedCallsBeforeFastPath,
  "verified uploads must be able to skip redundant pre-ingestion signing"
);

// A failed delegated v2 request must never turn a client-supplied id into a
// cross-tenant V4 shadow write.
const v4WritesBeforeFailure = v4BundleWrites.length;
const failedV4Result = await callApi({
  asset_id: missingAssetId,
  preingestion_bundle_id: "tenant_b_private_bundle"
}, v4Handler);
assert.equal(failedV4Result.statusCode, 404);
assert.equal(failedV4Result.body.ok, false);
assert.equal(failedV4Result.body.code, "listing_asset_not_found");
assert.equal(failedV4Result.body.v4_preingestion_bundle_id, null);
assert.equal(v4BundleWrites.length, v4WritesBeforeFailure);

// Positive control: a durable server bundle is shadowed only after v2 reports
// a successful save, and the tenant is part of the conflict target.
const successfulV4Result = await callApi({
  asset_id: assetId,
  preingestion_bundle_id: "tenant_b_private_bundle",
  requested_fields: ["serial_number"],
  verify_signed_read_urls: false
}, v4Handler);
assert.equal(successfulV4Result.statusCode, 200);
assert.equal(successfulV4Result.body.ok, true);
assert.equal(successfulV4Result.body.saved, true);
assert.notEqual(successfulV4Result.body.bundle_id, "tenant_b_private_bundle");
assert.equal(successfulV4Result.body.v4_preingestion_bundle_id, successfulV4Result.body.bundle_id);
assert.equal(v4BundleWrites.length, v4WritesBeforeFailure + 1);
assert.equal(v4BundleWrites.at(-1).row.id, successfulV4Result.body.bundle_id);
assert.equal(v4BundleWrites.at(-1).row.tenant_id, "tenant_a");
assert.equal(v4BundleWrites.at(-1).onConflict, "tenant_id,id");

// A successful v2 save is not a successful V4 contract until its durable
// shadow exists. Preserve the server bundle evidence but return a retryable
// failure and do not advertise a usable V4 bundle id.
failV4BundleWrite = true;
const failedV4Persistence = await callApi({
  asset_id: assetId,
  requested_fields: ["serial_number"],
  verify_signed_read_urls: false
}, v4Handler);
failV4BundleWrite = false;
assert.equal(failedV4Persistence.statusCode, 503);
assert.equal(failedV4Persistence.body.ok, false);
assert.equal(failedV4Persistence.body.saved, true);
assert.equal(failedV4Persistence.body.bundle_id, bundleWrite.bundle_id);
assert.equal(failedV4Persistence.body.v4_preingestion_bundle_id, null);
assert.equal(failedV4Persistence.body.v4_persistence.preingestion_bundle.saved, false);

const missing = await callApi({ asset_id: "" });
assert.equal(missing.statusCode, 400);
assert.equal(missing.body.ok, false);

const nonDurable = await callApi({ asset_id: "asset-1" });
assert.equal(nonDurable.statusCode, 400);
assert.equal(nonDurable.body.code, "invalid_durable_listing_asset_id");

console.log("listing preingest api tests passed");
