import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import handler from "../api/listing-copilot-title.js";
import {
  clearInFlightIdentityRequestsForTests,
  inFlightIdentityRequestStats
} from "../lib/listing/cache/inflight-identity-request.mjs";

process.env.METAVERSE_AUTH_SECRET = "test-secret";
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.LISTING_APPROVED_MEMORY_ENABLED = "false";
process.env.LISTING_IDENTITY_CACHE_READ_ENABLED = "false";
process.env.LISTING_IDENTITY_CACHE_WRITE_ENABLED = "false";
process.env.LISTING_IDENTITY_INFLIGHT_DEDUP_ENABLED = "true";
process.env.ENABLE_RECOGNITION_WORKER = "true";
process.env.RECOGNITION_WORKER_URL = "https://recognition.internal";
process.env.RECOGNITION_WORKER_TOKEN = "worker-token";
process.env.DEFAULT_VISION_PROVIDER = "agnes";
process.env.ENABLE_AGNES_PROVIDER = "true";
process.env.AGNES_API_KEY = "test-agnes-key";
delete process.env.OPENAI_API_KEY;
delete process.env.OPENAI_LISTING_MODEL;

clearInFlightIdentityRequestsForTests();

function sign(value) {
  return crypto.createHmac("sha256", process.env.METAVERSE_AUTH_SECRET).update(value).digest("hex");
}

function sessionCookie() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 60000 })).toString("base64url");
  return `lynca_metaverse_session=${payload}.${sign(payload)}`;
}

function makeImage({ id, role, objectPath, contentSha256 }) {
  return {
    id,
    storageRole: role,
    objectPath,
    bucket: "listing-card-images",
    originalType: "image/jpeg",
    originalSize: 12345,
    originalWidth: 900,
    originalHeight: 1260,
    contentSha256,
    storageVerified: true
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  };
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function callTitleApi(payload) {
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

const images = [
  makeImage({
    id: "front",
    role: "front_original",
    objectPath: "listing-assets/2026-06-23/asset-inflight/front.jpg",
    contentSha256: "e".repeat(64)
  }),
  makeImage({
    id: "back",
    role: "back_original",
    objectPath: "listing-assets/2026-06-23/asset-inflight/back.jpg",
    contentSha256: "f".repeat(64)
  })
];

const recognitionPayload = {
  asset_id: "asset-inflight",
  rectification: {},
  image_quality: {},
  regions: [],
  ocr_evidence: {
    status: "OK",
    items: []
  },
  evidence_fusion: {
    status: "OK",
    items: [
      { field: "year", value: "2024", confidence: 0.96, image_id: "front", role: "front_original", source_type: "CARD_FRONT", observed_text: "2024 Topps Chrome Shohei Ohtani" },
      { field: "product", value: "Topps Chrome", confidence: 0.96, image_id: "front", role: "front_original", source_type: "CARD_FRONT", observed_text: "Topps Chrome" },
      { field: "subject", value: "Shohei Ohtani", confidence: 0.96, image_id: "front", role: "front_original", source_type: "CARD_FRONT", observed_text: "Shohei Ohtani" },
      { field: "serial_number", value: "31/50", confidence: 0.95, image_id: "front", role: "front_original", source_type: "CARD_FRONT", observed_text: "31/50" },
      { field: "serial_number", value: "31/50", confidence: 0.94, image_id: "back", role: "back_original", source_type: "CARD_BACK", observed_text: "31/50" }
    ],
    resolved_fields: {
      year: "2024",
      product: "Topps Chrome",
      players: ["Shohei Ohtani"],
      serial_number: "31/50"
    },
    field_candidates: {},
    conflicts: []
  },
  visual_features: {},
  processing: {
    pipeline_version: "recognition-worker-contract-v1",
    model_versions: { ocr: "mock" },
    latency_ms: 33
  }
};

let recognitionCalls = 0;
let signedUrlCalls = 0;
let verificationCalls = 0;
globalThis.fetch = async (url, options = {}) => {
  const requestUrl = new URL(String(url));

  if (requestUrl.host === "supabase.test" && requestUrl.pathname.endsWith("/listing_image_verifications")) {
    verificationCalls += 1;
    const objectPath = requestUrl.searchParams.get("object_path")?.replace(/^eq\./, "");
    const image = images.find((item) => item.objectPath === objectPath);
    assert.ok(image, `unexpected verification object path ${objectPath}`);
    return jsonResponse([
      {
        object_path: image.objectPath,
        bucket: image.bucket,
        content_type: image.originalType,
        size: image.originalSize,
        width: image.originalWidth,
        height: image.originalHeight,
        content_sha256: image.contentSha256,
        object_verified: true,
        content_hash_verified: true,
        dimension_source: "upload",
        verified_at: "2026-06-23T00:00:00.000Z",
        updated_at: "2026-06-23T00:00:00.000Z"
      }
    ]);
  }

  if (requestUrl.host === "supabase.test" && requestUrl.pathname.includes("/storage/v1/object/sign/")) {
    signedUrlCalls += 1;
    const objectPath = decodeURIComponent(requestUrl.pathname.split("/listing-card-images/")[1] || "");
    assert.ok(images.some((image) => image.objectPath === objectPath), `unexpected signed URL path ${objectPath}`);
    return jsonResponse({
      signedURL: `/object/sign/listing-card-images/${objectPath}?token=read`
    });
  }

  if (requestUrl.host === "recognition.internal" && requestUrl.pathname === "/v1/analyze-card-images") {
    recognitionCalls += 1;
    await delay(60);
    return jsonResponse(recognitionPayload);
  }

  throw new Error(`Unexpected remote call: ${requestUrl.href}`);
};

const payload = {
  assetId: "asset-inflight",
  mode: "single",
  images,
  resolutionMap: {},
  maxTitleLength: 80
};

const [first, second] = await Promise.all([
  callTitleApi(payload),
  callTitleApi(payload)
]);
const responses = [first.body, second.body];
const owner = responses.find((body) => body.identity_inflight?.coalesced === false);
const reused = responses.find((body) => body.identity_inflight?.coalesced === true);

assert.equal(first.statusCode, 200);
assert.equal(second.statusCode, 200);
assert.equal(first.body.identity_resolution_status, "CONFIRMED");
assert.equal(second.body.identity_resolution_status, "CONFIRMED");
assert.ok(owner, "one request should execute the identity pipeline");
assert.ok(reused, "one request should reuse the in-flight identity result");
assert.equal(recognitionCalls, 1);
assert.equal(signedUrlCalls, 2);
assert.equal(verificationCalls, 6);
assert.equal(reused.usage.recognition_worker_calls, 0);
assert.equal(reused.usage.coalesced_recognition_worker_calls_avoided, 1);
assert.equal(reused.usage.provider_calls, 0);
assert.equal(reused.usage.estimated_cost_usd, 0);
assert.equal(first.body.final_title, second.body.final_title);
assert.ok(reused.resolution_trace.some((entry) => entry.decision === "reuse_inflight_identity_request"));
assert.equal(inFlightIdentityRequestStats().active, 0);

console.log("in-flight identity request coalescing tests passed");
