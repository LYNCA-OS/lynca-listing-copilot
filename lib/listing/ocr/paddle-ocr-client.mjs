import {
  normalizeOcrRequest,
  normalizePaddleOcrResponse,
  ocrResultToEvidencePatch,
  validateOcrRequest
} from "./ocr-contract.mjs";

export const paddleOcrEndpointPath = "/v1/ocr-field";
export const visionOcrBatchEndpointPath = "/v1/ocr-fields-batch";

export class PaddleOcrClientError extends Error {
  constructor(message, {
    code = "paddle_ocr_error",
    status = null,
    retryable = false,
    details = {}
  } = {}) {
    super(message);
    this.name = "PaddleOcrClientError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function boolFromEnv(env = {}, name = "", fallback = false) {
  const raw = env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return !["0", "false", "no", "off", "disabled"].includes(String(raw).trim().toLowerCase());
}

function intFromEnv(env = {}, name = "", fallback) {
  const number = Number(env[name]);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
}

function optionalFiniteNumber(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function trimTrailingSlash(value = "") {
  return String(value || "").replace(/\/+$/, "");
}

function splitUrls(value = "") {
  return String(value || "")
    .split(",")
    .map((part) => trimTrailingSlash(part.trim()))
    .filter(Boolean);
}

function endpointUrl(baseUrl = "", endpointPath = paddleOcrEndpointPath) {
  const base = trimTrailingSlash(baseUrl);
  if (!base) return "";
  if (/\/v\d+\//.test(base) || base.endsWith(endpointPath)) return base;
  return `${base}${endpointPath}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

export function paddleOcrConfig(env = process.env) {
  const urls = splitUrls(env.PADDLE_OCR_WORKER_URLS || env.PADDLEOCR_WORKER_URLS || env.OCR_WORKER_URLS || env.RECOGNITION_WORKER_URLS);
  const url = normalizeText(env.PADDLE_OCR_WORKER_URL || env.PADDLEOCR_WORKER_URL || env.OCR_WORKER_URL || env.RECOGNITION_WORKER_URL);
  const workerUrls = urls.length ? urls : (url ? [url] : []);
  const token = normalizeText(env.PADDLE_OCR_WORKER_TOKEN || env.PADDLE_OCR_API_KEY || env.PADDLEOCR_API_KEY || env.OCR_WORKER_TOKEN || env.OCR_WORKER_API_KEY || env.RECOGNITION_WORKER_TOKEN);
  const enabled = boolFromEnv(env, "ENABLE_PADDLE_OCR_FIELD_VERIFIER", boolFromEnv(env, "ENABLE_PADDLEOCR_FIELD_VERIFIER", false));
  return {
    enabled,
    configured: workerUrls.length > 0,
    url: workerUrls[0] || "",
    urls: workerUrls,
    token,
    timeout_ms: intFromEnv(env, "PADDLE_OCR_TIMEOUT_MS", intFromEnv(env, "OCR_WORKER_TIMEOUT_MS", 15000)),
    request_max_attempts: Math.min(3, intFromEnv(env, "PADDLE_OCR_REQUEST_MAX_ATTEMPTS", 2)),
    retry_base_ms: intFromEnv(env, "PADDLE_OCR_RETRY_BASE_MS", 200),
    model_id: normalizeText(env.PADDLE_OCR_MODEL_ID) || "paddleocr",
    model_revision: normalizeText(env.PADDLE_OCR_MODEL_REVISION) || "unknown",
    reason: !enabled ? "feature_disabled" : !workerUrls.length ? "paddle_ocr_worker_url_missing" : ""
  };
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    throw new PaddleOcrClientError("PaddleOCR worker returned an empty response.", {
      code: "paddle_ocr_empty_response",
      status: response.status,
      retryable: response.status >= 500
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new PaddleOcrClientError("PaddleOCR worker returned non-JSON response.", {
      code: "paddle_ocr_non_json_response",
      status: response.status,
      retryable: response.status >= 500,
      details: { response_excerpt: text.slice(0, 240) }
    });
  }
}

function publicRequestForError(request = {}) {
  return {
    ...request,
    image_url: request.image_url ? "[redacted-url]" : request.image_url
  };
}

export function createPaddleOcrClient({
  env = process.env,
  fetchImpl = globalThis.fetch,
  endpointPath = paddleOcrEndpointPath
} = {}) {
  const config = paddleOcrConfig(env);
  let nextWorkerIndex = 0;

  function selectWorkerUrl() {
    if (!config.urls.length) return "";
    const selected = config.urls[nextWorkerIndex % config.urls.length];
    nextWorkerIndex += 1;
    return selected;
  }

  async function verifyCrop(input = {}) {
    if (!config.enabled) {
      throw new PaddleOcrClientError("PaddleOCR field verifier is disabled.", {
        code: "paddle_ocr_disabled",
        status: 503,
        retryable: false,
        details: { reason: config.reason }
      });
    }
    if (!config.configured) {
      throw new PaddleOcrClientError("PaddleOCR worker URL is not configured.", {
        code: "paddle_ocr_not_configured",
        status: 503,
        retryable: false,
        details: { reason: config.reason }
      });
    }
    if (typeof fetchImpl !== "function") {
      throw new PaddleOcrClientError("fetch is unavailable for PaddleOCR worker calls.", {
        code: "paddle_ocr_fetch_unavailable",
        status: 503,
        retryable: false
      });
    }

    const request = normalizeOcrRequest(input);
    const requestErrors = validateOcrRequest(request);
    if (requestErrors.length) {
      throw new PaddleOcrClientError("PaddleOCR request contract validation failed.", {
        code: "paddle_ocr_request_invalid",
        status: 400,
        retryable: false,
        details: { validation_errors: requestErrors, request: publicRequestForError(request) }
      });
    }

    for (let attempt = 1; attempt <= config.request_max_attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeout_ms);
      const startedAt = Date.now();
      try {
        const headers = {
          "content-type": "application/json"
        };
        if (config.token) headers.authorization = `Bearer ${config.token}`;
        const selectedWorkerUrl = selectWorkerUrl();
        const response = await fetchImpl(endpointUrl(selectedWorkerUrl, endpointPath), {
          method: "POST",
          headers,
          body: JSON.stringify(request),
          signal: controller.signal
        });

        if (!response.ok) {
          const body = await response.text();
          throw new PaddleOcrClientError(`PaddleOCR worker HTTP ${response.status}.`, {
            code: "paddle_ocr_http_error",
            status: response.status,
            retryable: response.status === 429 || response.status >= 500,
            details: {
              response_excerpt: body.slice(0, 240),
              request: publicRequestForError(request)
            }
          });
        }

        const payload = await parseJsonResponse(response);
        const endedAt = Date.now();
        const normalized = normalizePaddleOcrResponse({
          model_id: config.model_id,
          model_revision: config.model_revision,
          ...payload
        }, request, { startedAt, endedAt });
        return {
          ...normalized,
          ocr_backend: normalizeText(payload.ocr_backend || payload.backend || payload.vision_provider || payload.provider) || null,
          worker_reason: normalizeText(payload.reason || payload.error) || null,
          backend_telemetry: payload.backend_telemetry && typeof payload.backend_telemetry === "object"
            ? payload.backend_telemetry
            : null,
          // Worker-level fallback telemetry is intentionally outside the
          // evidence contract. Preserve it so orchestration can distinguish
          // one in-memory two-pass OCR call from two network requests.
          inline_full_image_fallback_evaluated: payload.inline_full_image_fallback_evaluated === true,
          inline_full_image_fallback_used: payload.inline_full_image_fallback_used === true,
          inline_full_image_fallback_target_found: payload.inline_full_image_fallback_target_found === true,
          inline_full_image_fallback_status: normalizeText(payload.inline_full_image_fallback_status) || null,
          inline_grade_component_fallback_used: payload.inline_grade_component_fallback_used === true,
          inline_grade_component_fallback_kind: normalizeText(payload.inline_grade_component_fallback_kind) || null,
          inline_grade_component_fallback_target_found: payload.inline_grade_component_fallback_target_found === true,
          inline_grade_component_fallback_latency_ms: optionalFiniteNumber(payload.inline_grade_component_fallback_latency_ms),
          primary_ocr_latency_ms: optionalFiniteNumber(payload.primary_ocr_latency_ms),
          fallback_ocr_latency_ms: optionalFiniteNumber(payload.fallback_ocr_latency_ms),
          vision_unit_count: optionalFiniteNumber(payload.vision_unit_count),
          vision_cost_estimate: optionalFiniteNumber(payload.vision_cost_estimate),
          serial_consensus: payload.serial_consensus && typeof payload.serial_consensus === "object"
            ? payload.serial_consensus
            : null,
          worker_attempt_count: attempt,
          worker_url_index: Math.max(0, (nextWorkerIndex - 1) % config.urls.length),
          evidence_patch: ocrResultToEvidencePatch(normalized, {
            imageId: request.metadata?.image_id || request.metadata?.imageId || null,
            cropId: request.metadata?.crop_id || request.metadata?.cropId || null
          })
        };
      } catch (error) {
        const normalizedError = error?.name === "AbortError"
          ? new PaddleOcrClientError("PaddleOCR worker request timed out.", {
            code: "paddle_ocr_timeout",
            status: 504,
            retryable: true,
            details: { timeout_ms: config.timeout_ms, request: publicRequestForError(request) }
          })
          : error instanceof PaddleOcrClientError
            ? error
            : new PaddleOcrClientError("PaddleOCR worker network error.", {
              code: "paddle_ocr_network_error",
              status: 503,
              retryable: true,
              details: { message: error?.message || String(error), request: publicRequestForError(request) }
            });
        if (attempt < config.request_max_attempts && normalizedError.retryable) {
          await delay(Math.min(1_500, config.retry_base_ms * attempt));
          continue;
        }
        throw normalizedError;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new PaddleOcrClientError("PaddleOCR worker attempts exhausted.", {
      code: "paddle_ocr_attempts_exhausted",
      status: 503,
      retryable: true
    });
  }

  async function verifyCrops(inputs = []) {
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 8) {
      throw new PaddleOcrClientError("Vision OCR batch must contain 1 to 8 field requests.", {
        code: "paddle_ocr_batch_invalid",
        status: 400,
        retryable: false
      });
    }
    if (!config.enabled || !config.configured || typeof fetchImpl !== "function") {
      throw new PaddleOcrClientError("Vision OCR batch worker is unavailable.", {
        code: !config.enabled ? "paddle_ocr_disabled" : "paddle_ocr_not_configured",
        status: 503,
        retryable: false,
        details: { reason: config.reason }
      });
    }
    const requests = inputs.map((input) => normalizeOcrRequest(input));
    const validationErrors = requests.flatMap((request, index) => (
      validateOcrRequest(request).map((error) => ({ ...error, path: `requests[${index}].${error.path}` }))
    ));
    if (validationErrors.length) {
      throw new PaddleOcrClientError("Vision OCR batch contract validation failed.", {
        code: "paddle_ocr_batch_invalid",
        status: 400,
        retryable: false,
        details: { validation_errors: validationErrors }
      });
    }

    for (let attempt = 1; attempt <= config.request_max_attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeout_ms);
      const startedAt = Date.now();
      try {
        const headers = { "content-type": "application/json" };
        if (config.token) headers.authorization = `Bearer ${config.token}`;
        const selectedWorkerUrl = selectWorkerUrl();
        const response = await fetchImpl(endpointUrl(selectedWorkerUrl, visionOcrBatchEndpointPath), {
          method: "POST",
          headers,
          body: JSON.stringify({ requests }),
          signal: controller.signal
        });
        if (!response.ok) {
          const body = await response.text();
          throw new PaddleOcrClientError(`Vision OCR batch worker HTTP ${response.status}.`, {
            code: "paddle_ocr_http_error",
            status: response.status,
            retryable: response.status === 429 || response.status >= 500,
            details: { response_excerpt: body.slice(0, 240) }
          });
        }
        const payload = await parseJsonResponse(response);
        if (!Array.isArray(payload.results) || payload.results.length !== requests.length) {
          throw new PaddleOcrClientError("Vision OCR batch response count mismatch.", {
            code: "paddle_ocr_batch_response_invalid",
            status: 502,
            retryable: true
          });
        }
        const endedAt = Date.now();
        return payload.results.map((item, index) => {
          const request = requests[index];
          const normalized = normalizePaddleOcrResponse({
            model_id: config.model_id,
            model_revision: config.model_revision,
            ...item
          }, request, { startedAt, endedAt });
          return {
            ...normalized,
            vision_unit_count: optionalFiniteNumber(item.vision_unit_count),
            vision_cost_estimate: optionalFiniteNumber(item.vision_cost_estimate),
            serial_consensus: item.serial_consensus && typeof item.serial_consensus === "object"
              ? item.serial_consensus
              : null,
            worker_attempt_count: attempt,
            worker_url_index: Math.max(0, (nextWorkerIndex - 1) % config.urls.length),
            evidence_patch: ocrResultToEvidencePatch(normalized, {
              imageId: request.metadata?.image_id || request.metadata?.imageId || null,
              cropId: request.metadata?.crop_id || request.metadata?.cropId || null
            })
          };
        });
      } catch (error) {
        const normalizedError = error?.name === "AbortError"
          ? new PaddleOcrClientError("Vision OCR batch request timed out.", {
            code: "paddle_ocr_timeout",
            status: 504,
            retryable: true,
            details: { timeout_ms: config.timeout_ms }
          })
          : error instanceof PaddleOcrClientError
            ? error
            : new PaddleOcrClientError("Vision OCR batch network error.", {
              code: "paddle_ocr_network_error",
              status: 503,
              retryable: true,
              details: { message: error?.message || String(error) }
            });
        // Mixed-version rollout safety: the Vercel client can reach the old
        // single-field worker for a few minutes while Cloud Run converges.
        if (attempt === 1 && [404, 405].includes(normalizedError.status)) {
          return Promise.all(inputs.map((input) => verifyCrop(input)));
        }
        if (attempt < config.request_max_attempts && normalizedError.retryable) {
          await delay(Math.min(1_500, config.retry_base_ms * attempt));
          continue;
        }
        throw normalizedError;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new PaddleOcrClientError("Vision OCR batch attempts exhausted.", {
      code: "paddle_ocr_attempts_exhausted",
      status: 503,
      retryable: true
    });
  }

  return {
    config,
    configured: config.enabled && config.configured,
    verifyCrop,
    verifyCrops
  };
}
