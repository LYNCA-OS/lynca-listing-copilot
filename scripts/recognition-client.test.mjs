import assert from "node:assert/strict";
import fs from "node:fs";
import {
  analyzeCardImagesWithRecognitionWorker,
  probeRecognitionWorkerServiceContract
} from "../lib/listing/recognition/recognition-client.mjs";
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

let readyContractBodyConsumed = false;
const readyServiceContract = await probeRecognitionWorkerServiceContract({
  env: {
    ENABLE_RECOGNITION_WORKER: "true",
    RECOGNITION_WORKER_URL: "https://recognition.internal",
    RECOGNITION_WORKER_TOKEN: "worker-token"
  },
  fetchImpl: async (url, init = {}) => {
    if (String(url).endsWith("/readyz")) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          status: "ready",
          pipeline_version: "recognition-worker-contract-v1"
        })
      };
    }
    assert.equal(init.headers.authorization, "Bearer worker-token");
    return {
      ok: false,
      status: 422,
      text: async () => {
        readyContractBodyConsumed = true;
        return JSON.stringify({ detail: [] });
      }
    };
  }
});
assert.equal(readyContractBodyConsumed, true, "the zero-image contract response body must be consumed");
assert.deepEqual(readyServiceContract, {
  ready: true,
  configured: true,
  contract_matches: true,
  auth_verified: true,
  analysis_route_verified: true,
  pipeline_version: "recognition-worker-contract-v1",
  service_role: "RECOGNITION_WORKER",
  reason: null
});

const wrongServiceContract = await probeRecognitionWorkerServiceContract({
  env: {
    ENABLE_RECOGNITION_WORKER: "true",
    RECOGNITION_WORKER_URL: "https://vision-ocr.internal",
    RECOGNITION_WORKER_TOKEN: "worker-token"
  },
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      status: "ready",
      service: "vision-ocr",
      backend: "google_vision"
    })
  })
});
assert.equal(wrongServiceContract.ready, false);
assert.equal(wrongServiceContract.contract_matches, false);
assert.equal(wrongServiceContract.service_role, "VISION_OCR");
assert.equal(wrongServiceContract.reason, "recognition_worker_contract_mismatch");

const wrongTokenServiceContract = await probeRecognitionWorkerServiceContract({
  env: {
    ENABLE_RECOGNITION_WORKER: "true",
    RECOGNITION_WORKER_URL: "https://recognition-auth.internal",
    RECOGNITION_WORKER_TOKEN: "wrong-token"
  },
  fetchImpl: async (url) => String(url).endsWith("/readyz")
    ? { ok: true, status: 200, text: async () => JSON.stringify({ status: "ready", pipeline_version: "recognition-worker-contract-v1" }) }
    : { ok: false, status: 403, text: async () => JSON.stringify({ detail: "invalid bearer token" }) }
});
assert.equal(wrongTokenServiceContract.ready, false);
assert.equal(wrongTokenServiceContract.auth_verified, false);
assert.equal(wrongTokenServiceContract.reason, "recognition_worker_auth_rejected");

const missingAnalysisRouteServiceContract = await probeRecognitionWorkerServiceContract({
  env: {
    ENABLE_RECOGNITION_WORKER: "true",
    RECOGNITION_WORKER_URL: "https://recognition-route-missing.internal",
    RECOGNITION_WORKER_TOKEN: "worker-token"
  },
  fetchImpl: async (url) => String(url).endsWith("/readyz")
    ? { ok: true, status: 200, text: async () => JSON.stringify({ status: "ready", pipeline_version: "recognition-worker-contract-v1" }) }
    : { ok: false, status: 404, text: async () => "not found" }
});
assert.equal(missingAnalysisRouteServiceContract.ready, false);
assert.equal(missingAnalysisRouteServiceContract.analysis_route_verified, false);
assert.equal(missingAnalysisRouteServiceContract.reason, "recognition_worker_analysis_route_missing");

const readinessErrorContract = await probeRecognitionWorkerServiceContract({
  env: {
    ENABLE_RECOGNITION_WORKER: "true",
    RECOGNITION_WORKER_URL: "https://recognition-readiness-error.internal",
    RECOGNITION_WORKER_TOKEN: "worker-token"
  },
  fetchImpl: async () => {
    throw new Error("readiness network failure");
  }
});
assert.equal(readinessErrorContract.reason, "recognition_worker_readiness_error");

const analysisErrorContract = await probeRecognitionWorkerServiceContract({
  env: {
    ENABLE_RECOGNITION_WORKER: "true",
    RECOGNITION_WORKER_URL: "https://recognition-analysis-error.internal",
    RECOGNITION_WORKER_TOKEN: "worker-token"
  },
  fetchImpl: async (url) => {
    if (String(url).endsWith("/readyz")) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          status: "ready",
          pipeline_version: "recognition-worker-contract-v1"
        })
      };
    }
    throw new Error("analysis network failure");
  }
});
assert.equal(analysisErrorContract.reason, "recognition_worker_analysis_error");

function rejectWhenAborted(signal) {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

const readinessTimeoutContract = await probeRecognitionWorkerServiceContract({
  env: {
    ENABLE_RECOGNITION_WORKER: "true",
    RECOGNITION_WORKER_URL: "https://recognition-readiness-timeout.internal",
    RECOGNITION_WORKER_TOKEN: "worker-token"
  },
  fetchImpl: async (_url, init = {}) => rejectWhenAborted(init.signal),
  timeoutMs: 100
});
assert.equal(readinessTimeoutContract.reason, "recognition_worker_readiness_timeout");

const analysisTimeoutContract = await probeRecognitionWorkerServiceContract({
  env: {
    ENABLE_RECOGNITION_WORKER: "true",
    RECOGNITION_WORKER_URL: "https://recognition-analysis-timeout.internal",
    RECOGNITION_WORKER_TOKEN: "worker-token"
  },
  fetchImpl: async (url, init = {}) => String(url).endsWith("/readyz")
    ? {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        status: "ready",
        pipeline_version: "recognition-worker-contract-v1"
      })
    }
    : rejectWhenAborted(init.signal),
  timeoutMs: 100
});
assert.equal(analysisTimeoutContract.reason, "recognition_worker_analysis_timeout");

let coalescedFetchCount = 0;
const coalescedEnv = {
  ENABLE_RECOGNITION_WORKER: "true",
  RECOGNITION_WORKER_URL: "https://recognition-coalesced.internal",
  RECOGNITION_WORKER_TOKEN: "worker-token"
};
const coalescedFetch = async (url) => {
  coalescedFetchCount += 1;
  return String(url).endsWith("/readyz")
    ? { ok: true, status: 200, text: async () => JSON.stringify({ status: "ready", pipeline_version: "recognition-worker-contract-v1" }) }
    : { ok: false, status: 422, text: async () => JSON.stringify({ detail: [] }) };
};
const [coalescedLeft, coalescedRight] = await Promise.all([
  probeRecognitionWorkerServiceContract({ env: coalescedEnv, fetchImpl: coalescedFetch }),
  probeRecognitionWorkerServiceContract({ env: coalescedEnv, fetchImpl: coalescedFetch })
]);
assert.equal(coalescedLeft.ready, true);
assert.equal(coalescedRight.ready, true);
assert.equal(coalescedFetchCount, 2, "concurrent status reads must share one readiness plus one authenticated route probe");

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
