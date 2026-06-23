import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import handler from "../api/listing-copilot-title.js";
import { glareRoutes } from "../lib/listing/image-quality/quality-gate.mjs";
import { evaluatePreProviderRescanGate } from "../lib/listing/image-quality/pre-provider-rescan-gate.mjs";

process.env.METAVERSE_AUTH_SECRET = "test-secret";
process.env.LISTING_APPROVED_MEMORY_ENABLED = "false";
process.env.LISTING_IDENTITY_CACHE_READ_ENABLED = "false";
process.env.LISTING_IDENTITY_CACHE_WRITE_ENABLED = "false";
process.env.ENABLE_RECOGNITION_WORKER = "true";
process.env.RECOGNITION_WORKER_URL = "https://recognition.internal";
process.env.RECOGNITION_WORKER_TOKEN = "worker-token";
process.env.DEFAULT_VISION_PROVIDER = "agnes";
process.env.ENABLE_AGNES_PROVIDER = "true";
process.env.AGNES_API_KEY = "test-agnes-key";
process.env.LISTING_PRE_PROVIDER_RESCAN_GATE_ENABLED = "true";
delete process.env.OPENAI_API_KEY;
delete process.env.OPENAI_LISTING_MODEL;

function sign(value) {
  return crypto.createHmac("sha256", process.env.METAVERSE_AUTH_SECRET).update(value).digest("hex");
}

function sessionCookie() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 60000 })).toString("base64url");
  return `lynca_metaverse_session=${payload}.${sign(payload)}`;
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

function occludedQuality(region, extra = {}) {
  return {
    capture_profile_id: "standard-card-v1",
    capture_surface_type: extra.capture_surface_type || "UNKNOWN",
    image_quality_degraded: true,
    route: glareRoutes.TARGETED_RESCAN_REQUIRED,
    glare_route: glareRoutes.TARGETED_RESCAN_REQUIRED,
    unresolved_regions: [region],
    critical_region_occlusion: {
      [region]: {
        status: "OCCLUDED",
        glare_score: 0.91,
        readability_score: 0.04
      }
    }
  };
}

const subjectBlocked = evaluatePreProviderRescanGate({
  captureQuality: occludedQuality("subject_name")
});
assert.equal(subjectBlocked.blocked, true);
assert.deepEqual(subjectBlocked.blocking_regions, ["subject_name"]);

const serialOnly = evaluatePreProviderRescanGate({
  captureQuality: occludedQuality("serial_number")
});
assert.equal(serialOnly.blocked, false);
assert.equal(serialOnly.reason, "non_identity_region_occluded");

const slabGradeBlocked = evaluatePreProviderRescanGate({
  captureQuality: occludedQuality("grade_label", { capture_surface_type: "SLAB" })
});
assert.equal(slabGradeBlocked.blocked, true);
assert.deepEqual(slabGradeBlocked.blocking_regions, ["grade_label"]);

const disabled = evaluatePreProviderRescanGate({
  captureQuality: occludedQuality("subject_name"),
  env: { LISTING_PRE_PROVIDER_RESCAN_GATE_ENABLED: "false" }
});
assert.equal(disabled.blocked, false);
assert.equal(disabled.reason, "pre_provider_rescan_gate_disabled");

const fetchCalls = [];
globalThis.fetch = async (url, options = {}) => {
  fetchCalls.push({ url: String(url), method: options.method || "GET" });
  throw new Error(`Unexpected network call: ${url}`);
};

const response = await callTitleApi({
  assetId: "asset-quality-rescan",
  mode: "single",
  maxTitleLength: 80,
  images: [
    {
      id: "front",
      role: "front_original",
      url: "https://example.test/front.jpg",
      imageQuality: occludedQuality("year_product")
    }
  ],
  resolutionMap: {}
});

assert.equal(response.statusCode, 200);
assert.equal(response.body.source, "image_quality_gate");
assert.equal(response.body.provider, "image_quality_gate");
assert.equal(response.body.route, "TARGETED_RESCAN_REQUIRED");
assert.equal(response.body.identity_resolution_status, "ABSTAIN");
assert.equal(response.body.final_title, "");
assert.equal(response.body.usage.provider_calls, 0);
assert.equal(response.body.usage.recognition_worker_calls, 0);
assert.equal(response.body.pre_provider_rescan_gate.blocked, true);
assert.deepEqual(response.body.pre_provider_rescan_gate.blocking_regions, ["year_product"]);
assert.ok(response.body.unresolved.some((item) => /targeted rescan required/i.test(item)));
assert.ok(response.body.resolution_trace.some((entry) => entry.phase === "pre_provider_rescan_gate"));
assert.deepEqual(fetchCalls, []);

console.log("pre-provider rescan gate tests passed");

