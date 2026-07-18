import assert from "node:assert/strict";
import fs from "node:fs";
import { analyzeCardImagesWithRecognitionWorker } from "../lib/listing/recognition/recognition-client.mjs";
import {
  recognitionImageRoles,
  recognitionRequestedFields,
  validateRecognitionRequest,
  validateRecognitionResponse
} from "../lib/listing/recognition/recognition-contract.mjs";

function pythonSet(name) {
  const source = fs.readFileSync(new URL("../services/recognition-worker/app/contracts.py", import.meta.url), "utf8");
  const match = source.match(new RegExp(`${name}\\s*=\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `missing Python contract set ${name}`);
  return new Set([...match[1].matchAll(/["']([^"']+)["']/g)].map((entry) => entry[1]));
}

const workerImageRoles = pythonSet("IMAGE_ROLES");
const workerRequestedFields = pythonSet("REQUESTED_FIELDS");
assert.deepEqual(
  recognitionImageRoles.filter((role) => !workerImageRoles.has(role)),
  [],
  "the Node client must never emit an image role rejected by the Python worker"
);
assert.deepEqual(
  recognitionRequestedFields.filter((field) => !workerRequestedFields.has(field)),
  [],
  "the Node client must never request a field rejected by the Python worker"
);

const request = {
  asset_id: "asset_1",
  capture_profile_id: "standard",
  images: [
    {
      image_id: "front",
      role: "front_original",
      signed_url: "https://example.supabase.co/storage/v1/object/sign/cards/front.jpg?token=secret"
    }
  ],
  requested_fields: ["serial_number"],
  options: {
    run_ocr: true,
    run_visual_embeddings: false,
    run_candidate_verification: false
  }
};
assert.deepEqual(validateRecognitionRequest(request), []);
assert.ok(validateRecognitionRequest({ ...request, images: [] }).some((error) => error.path === "images"));
assert.deepEqual(validateRecognitionRequest({
  ...request,
  images: [
    { ...request.images[0], image_id: "image_1", role: "image_1_original" },
    { ...request.images[0], image_id: "image_2", role: "image_2_original" }
  ]
}), []);

const responsePayload = {
  asset_id: "asset_1",
  rectification: {},
  image_quality: {},
  regions: [],
  ocr_evidence: {},
  visual_features: {},
  processing: {
    pipeline_version: "recognition-worker-contract-v1",
    model_versions: {},
    latency_ms: 12
  }
};
assert.deepEqual(validateRecognitionResponse(responsePayload), []);

const unavailable = await analyzeCardImagesWithRecognitionWorker({
  assetId: "asset_disabled",
  env: {
    ENABLE_RECOGNITION_WORKER: "false"
  }
});
assert.equal(unavailable.unavailable, true);
assert.equal(unavailable.reason, "feature_disabled");

let capturedRequest = null;
const response = await analyzeCardImagesWithRecognitionWorker({
  assetId: "asset_1",
  images: [
    {
      id: "front",
      role: "front_original",
      signedUrl: "https://example.supabase.co/storage/v1/object/sign/cards/front.jpg?token=secret"
    }
  ],
  requestedFields: ["serial_number"],
  env: {
    ENABLE_RECOGNITION_WORKER: "true",
    RECOGNITION_WORKER_URL: "https://recognition.internal",
    RECOGNITION_WORKER_TOKEN: "worker-token",
    RECOGNITION_WORKER_TIMEOUT_MS: "1000"
  },
  fetchImpl: async (url, init) => {
    capturedRequest = {
      url,
      headers: init.headers,
      body: JSON.parse(init.body)
    };
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify(responsePayload);
      }
    };
  }
});
assert.equal(response.asset_id, "asset_1");
assert.equal(capturedRequest.url, "https://recognition.internal/v1/analyze-card-images");
assert.equal(capturedRequest.headers.authorization, "Bearer worker-token");
assert.equal(capturedRequest.body.images[0].signed_url.includes("token=secret"), true);

await assert.rejects(
  analyzeCardImagesWithRecognitionWorker({
    assetId: "asset_bad",
    images: [{ id: "front", role: "front_original", signedUrl: "" }],
    env: {
      ENABLE_RECOGNITION_WORKER: "true",
      RECOGNITION_WORKER_URL: "https://recognition.internal",
      RECOGNITION_WORKER_TOKEN: "worker-token"
    },
    fetchImpl: async () => responsePayload
  }),
  /contract validation/
);

console.log("recognition client tests passed");
