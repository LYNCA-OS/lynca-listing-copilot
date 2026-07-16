import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import handler from "../api/listing-preingest.js";

process.env.METAVERSE_AUTH_SECRET = "test-secret";
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
process.env.LISTING_IMAGE_BUCKET = "listing-card-images";
process.env.LISTING_IMAGE_SIGNED_URL_TTL_SECONDS = "600";

function sign(value) {
  return crypto.createHmac("sha256", process.env.METAVERSE_AUTH_SECRET).update(value).digest("hex");
}

function sessionCookie() {
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({
    user: "tester",
    sid: crypto.randomUUID(),
    iat: now,
    exp: now + 60000
  })).toString("base64url");
  return `lynca_metaverse_session=${payload}.${sign(payload)}`;
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
  queueMicrotask(() => {
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
    object_path: "listing-assets/2026-07-06/asset-pre/front.jpg",
    bucket: "listing-card-images",
    asset_id: "asset-pre",
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
    object_path: "listing-assets/2026-07-06/asset-pre/back.jpg",
    bucket: "listing-card-images",
    asset_id: "asset-pre",
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

  if (parsed.pathname.endsWith("/listing_image_verifications")) {
    assert.equal(parsed.searchParams.get("asset_id"), "eq.asset-pre");
    return jsonResponse(verificationRows);
  }

  if (parsed.pathname.endsWith("/image_derived_assets")) {
    return jsonResponse([]);
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
  asset_id: "asset-pre",
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
assert.equal(bundleWrite.asset_id, "asset-pre");
assert.equal(bundleWrite.images.length, 2);
assert.equal(bundleWrite.initial_evidence.print_run_candidate.value, "#/3");
assert.equal(bundleWrite.evidence_patches[0].value, "2/3");
assert.equal(JSON.stringify(bundleWrite).includes("read-token"), false, "signed read URLs must not be written to Supabase");
assert.ok(Array.isArray(jobsWrite));
// Consumerless job types default OFF; only OCR crop jobs are enqueued.
assert.ok(jobsWrite.every((job) => job.job_type === "ocr_crop_verification"));
assert.equal(new Set(jobsWrite.map((job) => job.job_key)).size, jobsWrite.length);

// Re-ingestion refreshes crops and images but must retain computed OCR evidence.
const secondResult = await callApi({
  asset_id: "asset-pre",
  requested_fields: ["serial_number", "grade_label"]
});
assert.equal(secondResult.statusCode, 200);
assert.equal(bundleWrite.evidence_patches.length, 1);
assert.equal(bundleWrite.evidence_patches[0].value, "2/3");

const signedCallsBeforeFastPath = calls.filter((call) => call.path.includes("/storage/v1/object/sign/")).length;
const fastPreingestResult = await callApi({
  asset_id: "asset-pre",
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

const missing = await callApi({ asset_id: "" });
assert.equal(missing.statusCode, 400);
assert.equal(missing.body.ok, false);

console.log("listing preingest api tests passed");
