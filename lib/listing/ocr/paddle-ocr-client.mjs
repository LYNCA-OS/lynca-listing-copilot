import {
  normalizeOcrRequest,
  normalizePaddleOcrResponse,
  ocrResultToEvidencePatch,
  validateOcrRequest
} from "./ocr-contract.mjs";

export const paddleOcrEndpointPath = "/v1/ocr-field";

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
      clearTimeout(timeout);

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
        worker_url_index: Math.max(0, (nextWorkerIndex - 1) % config.urls.length),
        evidence_patch: ocrResultToEvidencePatch(normalized, {
          imageId: request.metadata?.image_id || request.metadata?.imageId || null,
          cropId: request.metadata?.crop_id || request.metadata?.cropId || null
        })
      };
    } catch (error) {
      clearTimeout(timeout);
      if (error?.name === "AbortError") {
        throw new PaddleOcrClientError("PaddleOCR worker request timed out.", {
          code: "paddle_ocr_timeout",
          status: 504,
          retryable: true,
          details: { timeout_ms: config.timeout_ms, request: publicRequestForError(request) }
        });
      }
      if (error instanceof PaddleOcrClientError) throw error;
      throw new PaddleOcrClientError("PaddleOCR worker network error.", {
        code: "paddle_ocr_network_error",
        status: 503,
        retryable: true,
        details: { message: error?.message || String(error), request: publicRequestForError(request) }
      });
    }
  }

  return {
    config,
    configured: config.enabled && config.configured,
    verifyCrop
  };
}
