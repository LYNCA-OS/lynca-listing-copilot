import { createHash } from "node:crypto";

import {
  createUnavailableRecognitionResponse,
  recognitionEndpointPath,
  recognitionPipelineVersion,
  validateRecognitionRequest,
  validateRecognitionResponse
} from "./recognition-contract.mjs";
import { recognitionContractError, recognitionUnavailable, RecognitionWorkerError } from "./recognition-errors.mjs";
import { recognitionWorkerConfig } from "./recognition-feature-flags.mjs";

function redactSignedUrls(payload = {}) {
  return {
    ...payload,
    images: Array.isArray(payload.images)
      ? payload.images.map((image) => ({
        ...image,
        signed_url: image.signed_url ? "[redacted]" : image.signed_url
      }))
      : payload.images
  };
}

function buildRequest({
  assetId,
  captureProfileId = "",
  images = [],
  requestedFields = [],
  options = {},
  config
}) {
  return {
    asset_id: assetId,
    capture_profile_id: captureProfileId,
    images: images.map((image, index) => ({
      image_id: image.image_id || image.id || `image_${index + 1}`,
      role: image.role || image.storageRole || image.storage_role || `image_${index + 1}_original`,
      signed_url: image.signed_url || image.signedUrl || image.url || image.image_url?.url || ""
    })),
    requested_fields: requestedFields,
    options: {
      run_ocr: options.run_ocr ?? config.run_ocr_default,
      run_visual_embeddings: options.run_visual_embeddings ?? config.run_visual_embeddings_default,
      run_candidate_verification: options.run_candidate_verification ?? config.run_candidate_verification_default
    }
  };
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    throw new RecognitionWorkerError("Recognition worker returned an empty response.", {
      code: "recognition_empty_response",
      status: response.status,
      retryable: response.status >= 500
    });
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new RecognitionWorkerError("Recognition worker returned non-JSON response.", {
      code: "recognition_non_json_response",
      status: response.status,
      retryable: response.status >= 500
    });
  }
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

let capabilityProbeCache = {
  key: "",
  expires_at: 0,
  value: null,
  promise: null
};

function capabilityProbeCacheKey(config = {}) {
  return createHash("sha256")
    .update(JSON.stringify([config.url, config.token]))
    .digest("hex");
}

async function runRecognitionWorkerCapabilityProbe({
  config,
  fetchImpl,
  timeoutMs
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(100, Number(timeoutMs) || 3_000));
  try {
    const readinessResponse = await fetchImpl(`${config.url}/readyz`, { signal: controller.signal });
    const readinessText = await readinessResponse.text();
    let readiness = {};
    try {
      readiness = readinessText ? JSON.parse(readinessText) : {};
    } catch {
      return {
        ready: false,
        configured: true,
        contract_matches: false,
        auth_verified: false,
        analysis_route_verified: false,
        pipeline_version: null,
        service_role: "UNKNOWN",
        reason: "recognition_worker_readiness_non_json"
      };
    }
    const pipelineVersion = cleanText(readiness.pipeline_version) || null;
    const readinessMatches = readinessResponse.ok
      && cleanText(readiness.status).toLowerCase() === "ready"
      && pipelineVersion === recognitionPipelineVersion;
    if (!readinessMatches) {
      return {
        ready: false,
        configured: true,
        contract_matches: false,
        auth_verified: false,
        analysis_route_verified: false,
        pipeline_version: pipelineVersion,
        service_role: cleanText(readiness.service).toUpperCase().replace(/[^A-Z0-9]+/g, "_") || "UNKNOWN",
        reason: pipelineVersion !== recognitionPipelineVersion
          ? "recognition_worker_contract_mismatch"
          : "recognition_worker_not_ready"
      };
    }

    // This intentionally invalid request proves both bearer authorization and
    // ownership of the analysis route without downloading an image, invoking
    // OCR, or calling a paid Provider. The full Worker returns its contract
    // validator's 422; a wrong token returns 403 and the field-only OCR service
    // returns 404.
    const analysisResponse = await fetchImpl(`${config.url}${recognitionEndpointPath}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        asset_id: "recognition_capability_probe",
        images: [],
        requested_fields: [],
        options: {
          run_ocr: false,
          run_visual_embeddings: false,
          run_candidate_verification: false
        }
      }),
      signal: controller.signal
    });
    const analysisRouteVerified = analysisResponse.status === 422;
    return {
      ready: analysisRouteVerified,
      configured: true,
      contract_matches: analysisRouteVerified,
      auth_verified: analysisRouteVerified,
      analysis_route_verified: analysisRouteVerified,
      pipeline_version: pipelineVersion,
      service_role: analysisRouteVerified ? "RECOGNITION_WORKER" : "UNKNOWN",
      reason: analysisRouteVerified
        ? null
        : analysisResponse.status === 403
          ? "recognition_worker_auth_rejected"
          : analysisResponse.status === 404
            ? "recognition_worker_analysis_route_missing"
            : "recognition_worker_analysis_route_unexpected_status"
    };
  } catch (error) {
    return {
      ready: false,
      configured: true,
      contract_matches: false,
      auth_verified: false,
      analysis_route_verified: false,
      pipeline_version: null,
      service_role: "UNAVAILABLE",
      reason: error?.name === "AbortError"
        ? "recognition_worker_readiness_timeout"
        : "recognition_worker_readiness_error"
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeRecognitionWorkerCapability({
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 3_000
} = {}) {
  const config = recognitionWorkerConfig(env);
  if (!config.configured || typeof fetchImpl !== "function") {
    return {
      ready: false,
      configured: config.configured,
      contract_matches: false,
      auth_verified: false,
      analysis_route_verified: false,
      pipeline_version: null,
      service_role: "UNAVAILABLE",
      reason: config.reason || "fetch_unavailable"
    };
  }
  const key = capabilityProbeCacheKey(config);
  const now = Date.now();
  if (capabilityProbeCache.key === key && capabilityProbeCache.value && capabilityProbeCache.expires_at > now) {
    return capabilityProbeCache.value;
  }
  if (capabilityProbeCache.key === key && capabilityProbeCache.promise) return capabilityProbeCache.promise;

  const promise = runRecognitionWorkerCapabilityProbe({ config, fetchImpl, timeoutMs })
    .then((value) => {
      capabilityProbeCache = {
        key,
        expires_at: Date.now() + (value.ready ? 30_000 : 3_000),
        value,
        promise: null
      };
      return value;
    });
  capabilityProbeCache = { key, expires_at: 0, value: null, promise };
  return promise;
}

export async function analyzeCardImagesWithRecognitionWorker({
  assetId,
  captureProfileId = "",
  images = [],
  requestedFields = [],
  options = {},
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const config = recognitionWorkerConfig(env);

  if (!config.enabled) {
    return createUnavailableRecognitionResponse({ assetId, reason: config.reason });
  }

  if (!config.configured) {
    throw recognitionUnavailable(config.reason);
  }

  if (typeof fetchImpl !== "function") {
    throw recognitionUnavailable("fetch_unavailable");
  }

  const request = buildRequest({
    assetId,
    captureProfileId,
    images,
    requestedFields,
    options,
    config
  });
  const requestErrors = validateRecognitionRequest(request);
  if (requestErrors.length) throw recognitionContractError(requestErrors);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeout_ms);

  try {
    const response = await fetchImpl(`${config.url}${recognitionEndpointPath}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(request),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const payload = await response.text();
      throw new RecognitionWorkerError(`Recognition worker HTTP ${response.status}.`, {
        code: "recognition_http_error",
        status: response.status,
        retryable: response.status >= 500,
        details: {
          response_excerpt: payload.slice(0, 240),
          request: redactSignedUrls(request)
        }
      });
    }

    const payload = await parseJsonResponse(response);
    const responseErrors = validateRecognitionResponse(payload);
    if (responseErrors.length) throw recognitionContractError(responseErrors);
    return payload;
  } catch (error) {
    clearTimeout(timeout);
    if (error?.name === "AbortError") {
      throw new RecognitionWorkerError("Recognition worker request timed out.", {
        code: "recognition_timeout",
        status: 504,
        retryable: true
      });
    }
    throw error;
  }
}
