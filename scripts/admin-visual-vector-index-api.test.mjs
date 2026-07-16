import assert from "node:assert/strict";
import adminIndexHandler from "../api/admin-index-visual-vector-seed.js";

function mockReq({
  method = "POST",
  body = {},
  headers = {}
} = {}) {
  return {
    method,
    headers,
    body
  };
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[String(key).toLowerCase()] = value;
    },
    end(value = "") {
      this.body = String(value);
    }
  };
}

process.env.LYNCA_PLATFORM_ADMIN_SECRET = "test-admin-token";
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.LISTING_IMAGE_BUCKET = "listing-feedback-images";
process.env.RECOGNITION_WORKER_URL = "https://recognition.test";
process.env.RECOGNITION_WORKER_TOKEN = "recognition-token";
process.env.VECTOR_QUERY_TIMEOUT_MS = "1000";

const unauthorizedReq = mockReq({
  headers: { "x-lynca-platform-admin-secret": "wrong" }
});
const unauthorizedRes = mockRes();
await adminIndexHandler(unauthorizedReq, unauthorizedRes);
assert.equal(unauthorizedRes.statusCode, 401);
assert.equal(JSON.parse(unauthorizedRes.body).error, "unauthorized");

const originalFetch = globalThis.fetch;
const fetchCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const requestUrl = String(url);
  const body = options.body ? JSON.parse(options.body) : null;
  fetchCalls.push({ url: requestUrl, method: options.method || "GET", body });
  if (requestUrl.includes("/storage/v1/object/sign/")) {
    return new Response(JSON.stringify({ signedURL: "https://signed.test/image.jpg?token=read" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
  if (requestUrl.includes("/v1/embed-images")) {
    const embeddings = (Array.isArray(body?.images) ? body.images : []).map((image, index) => ({
      image_id: image.image_id,
      role: image.role || (index === 0 ? "front_global" : "back_global"),
      dimensions: 768,
      embedding: [index === 0 ? 1 : 0, index === 1 ? 1 : 0, ...Array.from({ length: 766 }, () => 0)]
    }));
    return new Response(JSON.stringify({
      status: "completed",
      model_id: "google/siglip2-base-patch16-384",
      model_revision: "test-revision",
      preprocessing_version: "card-rectification-v1",
      latency_ms: 12,
      embeddings
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
  return new Response(JSON.stringify([]), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
};

const authorizedReq = mockReq({
  headers: { "x-lynca-platform-admin-secret": "test-admin-token" },
  body: {
    dry_run: true,
    offset: 2,
    limit: 3,
    concurrency: 1
  }
});
const authorizedRes = mockRes();
try {
  await adminIndexHandler(authorizedReq, authorizedRes);
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal(authorizedRes.statusCode, 200);
const data = JSON.parse(authorizedRes.body);
assert.equal(data.ok, true);
assert.equal(data.auth_mode, "platform_admin_secret");
assert.equal(data.dry_run, true);
assert.equal(data.retrieval_status, "approved");
assert.equal(data.retrieval_enabled, true);
assert.equal(data.summary.offset, 2);
assert.equal(data.summary.requested_items, 3);
assert.equal(data.summary.next_offset, 5);
assert.ok(fetchCalls.some((call) => call.url.includes("/rest/v1/rpc/match_card_image_embeddings")));
assert.ok(fetchCalls.some((call) => call.url.includes("/v1/embed-images")));

console.log("admin visual vector index api tests passed");
