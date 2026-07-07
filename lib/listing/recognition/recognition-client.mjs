import { createUnavailableRecognitionResponse, recognitionEndpointPath, validateRecognitionRequest, validateRecognitionResponse } from "./recognition-contract.mjs";
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
