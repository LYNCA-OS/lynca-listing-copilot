import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const defaultDatasetPath = "data/recognition/manifests/supabase-feedback-candidates.json";
const defaultOutPath = "data/eval/provider-regression-30/cloud-listing-api-latest.json";
const defaultEnvFilePath = ".env.local";
const providerModes = Object.freeze({
  OPENAI: "openai_legacy",
  GEMINI_ONLY: "gemini"
});

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] || fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function numberArg(argv, name, fallback) {
  const value = Number(argValue(argv, name, ""));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function unquoteEnvValue(value = "") {
  const trimmed = String(value || "").trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/'\\''/g, "'");
  }
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed.slice(1, -1).replace(/\\"/g, "\"");
  }
  return trimmed;
}

async function readEnvFile(path = "") {
  const resolved = resolve(path || "");
  if (!path || !existsSync(resolved)) return {};
  const text = await readFile(resolved, "utf8");
  const parsed = {};
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) return;
    const key = trimmed.slice(0, separator).trim();
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return;
    parsed[key] = unquoteEnvValue(trimmed.slice(separator + 1));
  });
  return parsed;
}

async function runtimeEnvFromFiles(argv = process.argv, env = process.env) {
  if (hasFlag(argv, "--no-env-file")) return { ...env };
  const envFilePath = argValue(argv, "--env-file", env.CLOUD_LISTING_API_ENV_FILE || defaultEnvFilePath);
  const fileEnv = await readEnvFile(envFilePath);
  return {
    ...fileEnv,
    ...env
  };
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function candidateId(item = {}) {
  return item.candidate_id || item.id || item.asset_id || item.source_feedback_id || item.physical_card_id || "";
}

function correctedTitle(item = {}) {
  return normalizeText(
    item.corrected_title
    || item.ground_truth?.corrected_title
    || item.ground_truth?.title
    || item.source_titles?.corrected_title
  );
}

function normalizeProviderMode(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (["openai", "gpt", "gpt-4.1-mini", "openai_legacy"].includes(raw)) return providerModes.OPENAI;
  if (["", "gemini", "gemini-only", "gemini_only"].includes(raw)) return providerModes.GEMINI_ONLY;
  throw new Error(`Unsupported cloud eval provider: ${value}. Use gemini or openai_legacy.`);
}

function cloudProviderForMode(providerMode) {
  return providerMode === providerModes.OPENAI ? providerModes.OPENAI : providerModes.GEMINI_ONLY;
}

function providerOptionsForMode(providerMode) {
  if (providerMode === providerModes.OPENAI) {
    return {
      single_model_fast: true,
      enable_evidence_completion: false,
      enable_gpt_failure_fallback: false,
      enable_gpt_provider_failure_fallback: false,
      enable_gpt_critical_verifier: false,
      enable_gemini_core_field_retry: false
    };
  }

  return {
    single_model_fast: true,
    enable_evidence_completion: false,
    enable_gpt_failure_fallback: false,
    enable_gpt_provider_failure_fallback: false,
    enable_gpt_critical_verifier: false,
    enable_gemini_core_field_retry: true
  };
}

function imageInputs(item = {}) {
  return (Array.isArray(item.images) ? item.images : [])
    .filter((image) => image?.bucket && image?.object_path)
    .slice(0, 2)
    .map((image, index) => ({
      id: image.image_id || `${candidateId(item)}_${index + 1}`,
      image_id: image.image_id || `${candidateId(item)}_${index + 1}`,
      name: `${image.role || `image_${index + 1}`}:${candidateId(item)}`,
      bucket: image.bucket,
      object_path: image.object_path,
      role: image.role || (index === 0 ? "front_original" : "back_original"),
      capture_angle: image.capture_angle || (index === 0 ? "front" : "back")
    }));
}

function verificationCacheKey(image = {}) {
  return `${image.bucket || ""}:${image.object_path || image.objectPath || ""}`;
}

function titleTokens(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function titleComparison(referenceTitle, predictionTitle) {
  const reference = new Set(titleTokens(referenceTitle));
  const predicted = new Set(titleTokens(predictionTitle));
  if (!reference.size) return null;
  const overlap = [...reference].filter((token) => predicted.has(token)).length;
  return {
    token_recall: Number((overlap / reference.size).toFixed(6)),
    exact: normalizeText(referenceTitle).toLowerCase() === normalizeText(predictionTitle).toLowerCase()
  };
}

const reviewedFields = Object.freeze([
  "subject",
  "year",
  "product_or_set",
  "card_type",
  "variant_or_parallel",
  "collector_number",
  "serial_number",
  "grade"
]);

function reviewedGroundTruth(item = {}) {
  return item.reviewed_ground_truth
    || item.ground_truth?.reviewed_fields
    || item.ground_truth?.fields
    || item.reviewed_fields
    || null;
}

function evidenceValue(field = {}) {
  if (!field || typeof field !== "object" || Array.isArray(field)) return field;
  return field.normalized_value
    ?? field.normalizedValue
    ?? field.resolved_value
    ?? field.value
    ?? null;
}

function layerValue(layer = {}, fieldName = "") {
  if (!layer || typeof layer !== "object") return null;
  const direct = (key) => evidenceValue(layer[key]);
  if (fieldName === "subject") {
    return direct("players") ?? direct("player") ?? direct("subject") ?? direct("character");
  }
  if (fieldName === "product_or_set") {
    return direct("product") ?? direct("set") ?? direct("product_or_set");
  }
  if (fieldName === "variant_or_parallel") {
    return direct("parallel_exact") ?? direct("parallel") ?? direct("variant_or_parallel") ?? direct("variation");
  }
  if (fieldName === "grade") {
    const company = direct("grade_company");
    const grade = direct("card_grade") ?? direct("grade");
    if (company && grade) return `${company} ${grade}`;
    return grade ?? company ?? null;
  }
  return direct(fieldName);
}

function hasLayerValue(layer = {}, fieldName = "") {
  const value = layerValue(layer, fieldName);
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function layerCompleteness(layer = {}) {
  if (!layer || typeof layer !== "object") return null;
  const present = reviewedFields.filter((field) => hasLayerValue(layer, field));
  return {
    present_count: present.length,
    denominator: reviewedFields.length,
    ratio: Number((present.length / reviewedFields.length).toFixed(6)),
    present_fields: present,
    missing_fields: reviewedFields.filter((field) => !present.includes(field))
  };
}

function renderedFieldLayer(data = {}) {
  return data.rendered_fields || {
    title: normalizeText(data.final_title || data.title || data.rendered_title),
    rendered_title: normalizeText(data.rendered_title || data.final_title || data.title),
    modules: data.modules || null,
    module_order: data.module_order || null,
    title_render_source: data.title_render_source || null
  };
}

function resultBreakpoints(data = {}, item = {}) {
  const rawProviderFields = data.raw_provider_fields || data.provider_fields || data.fields || null;
  const normalizedEvidence = data.normalized_evidence || data.evidence || null;
  const resolvedFields = data.resolved_fields || data.resolved || null;
  const renderedFields = renderedFieldLayer(data);
  const reviewed = reviewedGroundTruth(item);
  return {
    raw_provider_fields: rawProviderFields,
    normalized_evidence: normalizedEvidence,
    resolved_fields: resolvedFields,
    rendered_fields: renderedFields,
    reviewed_ground_truth: reviewed,
    completeness: {
      raw_provider_fields: layerCompleteness(rawProviderFields),
      normalized_evidence: layerCompleteness(normalizedEvidence),
      resolved_fields: layerCompleteness(resolvedFields),
      rendered_fields: layerCompleteness(renderedFields),
      reviewed_ground_truth: layerCompleteness(reviewed)
    }
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function writeJson(path, value) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

function protectionHeaders(bypassSecret = "") {
  return bypassSecret
    ? { "x-vercel-protection-bypass": bypassSecret }
    : {};
}

export function validateProtectionBypassSecret({ bypassSecret = "", env = {} } = {}) {
  const secret = String(bypassSecret || "").trim();
  if (!secret) return;

  if (secret.startsWith("sb_secret_")) {
    throw new Error("Cloud eval misconfigured: VERCEL_AUTOMATION_BYPASS_SECRET looks like a Supabase secret key.");
  }

  const supabaseSecrets = [
    env.SUPABASE_SERVICE_ROLE_KEY,
    env.SUPABASE_SECRET_KEY
  ].map((value) => String(value || "").trim()).filter(Boolean);

  if (supabaseSecrets.includes(secret)) {
    throw new Error("Cloud eval misconfigured: VERCEL_AUTOMATION_BYPASS_SECRET matches a Supabase service/secret key.");
  }
}

async function fetchWithTimeout(fetchImpl, url, init = {}, timeoutMs = 120_000, label = "Cloud request") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || 120_000));
  try {
    return await fetchImpl(url, {
      ...init,
      signal: init.signal || controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(`${label} timed out after ${Math.max(1, Number(timeoutMs) || 120_000)}ms.`);
      timeoutError.code = "cloud_request_timeout";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function login({ baseUrl, username, password, bypassSecret = "", requestTimeoutMs = 120_000, fetchImpl = globalThis.fetch }) {
  const response = await fetchWithTimeout(fetchImpl, `${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json", ...protectionHeaders(bypassSecret) },
    body: JSON.stringify({ username, password })
  }, requestTimeoutMs, "Cloud login");
  const setCookie = response.headers.get("set-cookie") || "";
  if (!response.ok || !setCookie) {
    const text = await response.text().catch(() => "");
    throw new Error(`Cloud login failed: HTTP ${response.status} ${text.slice(0, 160)}`);
  }
  return setCookie.split(";")[0];
}

async function preflightCloudApi({
  baseUrl,
  cookie,
  bypassSecret = "",
  requestTimeoutMs = 120_000,
  fetchImpl = globalThis.fetch
}) {
  const response = await fetchWithTimeout(fetchImpl, `${baseUrl}/api/listing-provider-status`, {
    method: "GET",
    headers: {
      cookie,
      ...protectionHeaders(bypassSecret)
    }
  }, requestTimeoutMs, "Cloud provider-status preflight");
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  const trimmedText = text.trim();
  const looksJson = contentType.includes("json") || /^[{[]/.test(trimmedText);
  let data = null;
  if (looksJson) {
    try {
      data = JSON.parse(trimmedText || "{}");
    } catch {
      data = null;
    }
  }

  if (contentType.includes("text/html") || /^<!doctype html|<html[\s>]/i.test(trimmedText)) {
    throw new Error("Cloud preflight failed: Vercel protection bypass did not produce an application JSON response.");
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(`Cloud preflight failed: application auth rejected provider-status request with HTTP ${response.status}.`);
  }

  if (!response.ok || !data) {
    throw new Error(`Cloud preflight failed: provider-status returned HTTP ${response.status} ${trimmedText.slice(0, 160)}`);
  }

  return {
    ok: true,
    http_status: response.status,
    provider_count: Array.isArray(data.providers || data.available_providers)
      ? (data.providers || data.available_providers).length
      : null,
    default_provider: data.default_provider || data.defaultProvider || null
  };
}

async function verifyExistingImage({
  baseUrl,
  cookie,
  image,
  bypassSecret = "",
  requestTimeoutMs = 120_000,
  verificationCache,
  fetchImpl = globalThis.fetch
}) {
  const cacheKey = verificationCacheKey(image);
  if (verificationCache?.has(cacheKey)) return verificationCache.get(cacheKey);

  const requestBody = JSON.stringify({
    object_path: image.object_path,
    bucket: image.bucket,
    image_id: image.image_id,
    asset_id: image.id,
    role: image.role
  });
  async function requestVerification(path) {
    const response = await fetchWithTimeout(fetchImpl, `${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        ...protectionHeaders(bypassSecret)
      },
      body: requestBody
    }, requestTimeoutMs, "Cloud image verification");
    const text = await response.text();
    const contentType = response.headers.get("content-type") || "";
    const trimmedText = text.trim();
    const data = contentType.includes("json") || /^[{[]/.test(trimmedText)
      ? JSON.parse(trimmedText || "{}")
      : {};
    return { response, data, contentType, text };
  }

  let verificationResponse = await requestVerification("/api/listing-image-verify-existing");
  if (
    verificationResponse.response.ok &&
    verificationResponse.contentType.includes("text/html") &&
    !verificationResponse.data.ok
  ) {
    verificationResponse = await requestVerification("/api/listing-image-verify-existing.js");
  }
  const { response, data } = verificationResponse;
  if (!response.ok || data.ok !== true || !data.verification?.verification_token) {
    throw new Error(`Cloud image verification failed: HTTP ${response.status} ${String(data.message || "").slice(0, 180)}`);
  }

  const verification = data.verification;
  const verifiedImage = {
    ...image,
    objectPath: verification.object_path,
    object_path: verification.object_path,
    bucket: verification.bucket,
    storageVerified: true,
    storage_verified: true,
    storageVerificationToken: verification.verification_token,
    storage_verification_token: verification.verification_token,
    contentType: verification.content_type,
    content_type: verification.content_type,
    originalType: verification.content_type,
    original_type: verification.content_type,
    size: verification.size,
    originalSize: verification.size,
    original_size: verification.size,
    width: verification.width,
    originalWidth: verification.width,
    original_width: verification.width,
    height: verification.height,
    originalHeight: verification.height,
    original_height: verification.height,
    contentSha256: verification.content_sha256 || "",
    content_sha256: verification.content_sha256 || ""
  };
  verificationCache?.set(cacheKey, verifiedImage);
  return verifiedImage;
}

async function verifiedImageInputs({
  baseUrl,
  cookie,
  item,
  bypassSecret = "",
  requestTimeoutMs = 120_000,
  verificationCache,
  fetchImpl = globalThis.fetch
}) {
  const images = imageInputs(item);
  return Promise.all(images.map((image) => verifyExistingImage({
    baseUrl,
    cookie,
    image,
    bypassSecret,
    requestTimeoutMs,
    verificationCache,
    fetchImpl
  })));
}

async function callListingApi({
  baseUrl,
  cookie,
  item,
  providerMode,
  bypassSecret = "",
  requestTimeoutMs = 120_000,
  verificationCache,
  maxTitleLength = 80,
  fetchImpl = globalThis.fetch
}) {
  const provider = cloudProviderForMode(providerMode);
  const images = await verifiedImageInputs({
    baseUrl,
    cookie,
    item,
    bypassSecret,
    requestTimeoutMs,
    verificationCache,
    fetchImpl
  });
  const payload = {
    provider,
    provider_id: provider,
    provider_eval_mode: providerMode,
    provider_options: providerOptionsForMode(providerMode),
    explicitEmergency: provider === providerModes.OPENAI,
    explicit_emergency: provider === providerModes.OPENAI,
    maxTitleLength,
    captureProfileId: "cloud_eval",
    category: item.category || "",
    images
  };
  const response = await fetchWithTimeout(fetchImpl, `${baseUrl}/api/listing-copilot-title`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      ...protectionHeaders(bypassSecret)
    },
    body: JSON.stringify(payload)
  }, requestTimeoutMs, "Cloud title API");
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = {
      confidence: "FAILED",
      reason: text.slice(0, 240),
      provider_error_code: "invalid_json_response"
    };
  }
  return {
    http_status: response.status,
    data
  };
}

function summarize(results = [], elapsedMs = 0) {
  const attempted = results.length;
  const providerErrors = results.filter((item) => item.status === "provider_error").length;
  const evaluated = results.filter((item) => item.status === "evaluated").length;
  const fallbackCount = results.filter((item) => item.fallback_provider_id).length;
  const criticalFailed = results.filter((item) => item.provider_error_code || item.confidence === "FAILED").length;
  const averageRecallValues = results
    .map((item) => item.corrected_title_comparison?.token_recall)
    .filter((value) => Number.isFinite(value));
  const elapsedValues = results
    .map((item) => item.timing?.total_ms ?? item.elapsed_ms)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  const completenessAverage = (layerName) => {
    const values = results
      .map((item) => item.breakpoints?.completeness?.[layerName]?.ratio)
      .filter((value) => Number.isFinite(value));
    return values.length
      ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6))
      : null;
  };
  const percentile = (p) => {
    if (!elapsedValues.length) return null;
    const index = Math.min(elapsedValues.length - 1, Math.max(0, Math.ceil(elapsedValues.length * p) - 1));
    return Math.round(elapsedValues[index]);
  };
  return {
    attempted_count: attempted,
    evaluated_count: evaluated,
    provider_error_count: providerErrors,
    provider_success_rate: attempted ? Number((evaluated / attempted).toFixed(6)) : null,
    fallback_count: fallbackCount,
    failed_count: criticalFailed,
    corrected_title_token_recall_avg: averageRecallValues.length
      ? Number((averageRecallValues.reduce((sum, value) => sum + value, 0) / averageRecallValues.length).toFixed(6))
      : null,
    elapsed_ms: Math.max(0, Math.round(elapsedMs)),
    attempted_cards_per_minute: elapsedMs > 0 ? Number((attempted / (elapsedMs / 60000)).toFixed(6)) : null,
    evaluated_cards_per_minute: elapsedMs > 0 ? Number((evaluated / (elapsedMs / 60000)).toFixed(6)) : null,
    per_card_latency_ms: {
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99)
    },
    breakpoint_completeness_avg: {
      raw_provider_fields: completenessAverage("raw_provider_fields"),
      normalized_evidence: completenessAverage("normalized_evidence"),
      resolved_fields: completenessAverage("resolved_fields"),
      rendered_fields: completenessAverage("rendered_fields"),
      reviewed_ground_truth: completenessAverage("reviewed_ground_truth")
    }
  };
}

export async function evaluateCloudListingApi({
  dataset,
  baseUrl,
  provider,
  limit = 1,
  concurrency = 1,
  username,
  password,
  bypassSecret = "",
  requestTimeoutMs = 120_000,
  maxTitleLength = 80,
  skipPreflight = false,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!baseUrl) throw new Error("Cloud base URL is required.");
  if (!username || !password) throw new Error("METAVERSE_USERNAME and METAVERSE_PASSWORD are required.");
  if (typeof fetchImpl !== "function") throw new Error("fetch is required.");
  const providerMode = normalizeProviderMode(provider);

  const limitCount = Math.max(0, Math.trunc(Number(limit) || 0));
  const selected = (Array.isArray(dataset?.items) ? dataset.items : [])
    .filter((item) => imageInputs(item).length > 0)
    .slice(0, limitCount);
  const cookie = await login({ baseUrl, username, password, bypassSecret, requestTimeoutMs, fetchImpl });
  const cloudPreflight = skipPreflight
    ? { ok: true, skipped: true }
    : await preflightCloudApi({ baseUrl, cookie, bypassSecret, requestTimeoutMs, fetchImpl });
  const verificationCache = new Map();
  const startedAt = Date.now();
  const results = [];
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(Math.trunc(Number(concurrency) || 1), selected.length || 1));

  async function worker() {
    while (cursor < selected.length) {
      const index = cursor;
      cursor += 1;
      const item = selected[index];
      const referenceTitle = correctedTitle(item);
      const started = Date.now();
      try {
        const response = await callListingApi({
          baseUrl,
          cookie,
          item,
          providerMode,
          bypassSecret,
          requestTimeoutMs,
          verificationCache,
          maxTitleLength,
          fetchImpl
        });
        const data = response.data || {};
        const providerError = response.http_status >= 400
          || data.confidence === "FAILED"
          || data.provider_error_code
          || data.provider_error_type;
        const breakpoints = resultBreakpoints(data, item);
        results[index] = {
          candidate_id: candidateId(item),
          provider: providerMode,
          requested_cloud_provider: cloudProviderForMode(providerMode),
          status: providerError ? "provider_error" : "evaluated",
          http_status: response.http_status,
          title: normalizeText(data.final_title || data.title || data.rendered_title),
          confidence: data.confidence || "",
          provider_id: data.provider || data.source || null,
          model_id: data.model_id || data.provider_model_id || null,
          fallback_provider_id: data.fallback_provider_id || null,
          fallback_reason: data.fallback_reason || null,
          format_error_type: data.format_error_type || null,
          provider_error_code: data.provider_error_code || data.provider_error_type || null,
          provider_error_details: data.provider_error_details || null,
          reason: providerError ? normalizeText(data.reason).slice(0, 240) : "",
          publication_gate: data.publication_gate || null,
          raw_provider_fields: breakpoints.raw_provider_fields,
          normalized_evidence: breakpoints.normalized_evidence,
          resolved_fields: breakpoints.resolved_fields,
          rendered_fields: breakpoints.rendered_fields,
          reviewed_ground_truth: breakpoints.reviewed_ground_truth,
          breakpoints,
          fields: data.fields || null,
          resolved: data.resolved || null,
          identity_resolution_status: data.identity_resolution_status || null,
          provider_recognition_status: data.provider_recognition_status || null,
          provider_parse_source: data.provider_parse_source || null,
          native_schema_valid: data.native_schema_valid === true,
          format_repair_attempted: data.format_repair_attempted === true,
          local_json_repair_success: data.local_json_repair_success === true,
          text_repair_success: data.text_repair_success === true,
          gemini_core_field_retry: data.gemini_core_field_retry || null,
          writer_review_ready: data.writer_review_ready === true || data.publication_gate?.writer_review_ready === true,
          corrected_title_reference: referenceTitle,
          corrected_title_comparison: titleComparison(referenceTitle, data.final_title || data.title || data.rendered_title),
          timing: data.timing || null,
          elapsed_ms: Date.now() - started
        };
      } catch (error) {
        results[index] = {
          candidate_id: candidateId(item),
          provider: providerMode,
          requested_cloud_provider: cloudProviderForMode(providerMode),
          status: "provider_error",
          provider_error_code: error.code || "cloud_eval_error",
          error: normalizeText(error.message).slice(0, 240),
          elapsed_ms: Date.now() - started
        };
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  const elapsedMs = Date.now() - startedAt;
  return {
    schema_version: "cloud-listing-api-eval-v1",
    status: "completed",
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    provider: providerMode,
    requested_cloud_provider: cloudProviderForMode(providerMode),
    target_count: selected.length,
    configured_concurrency: workerCount,
    cloud_preflight: cloudPreflight,
    ...summarize(results, elapsedMs),
    results
  };
}

export async function main(argv = process.argv, env = process.env) {
  const runtimeEnv = await runtimeEnvFromFiles(argv, env);
  const datasetPath = argValue(argv, "--dataset", runtimeEnv.SUPABASE_FEEDBACK_CANDIDATES_PATH || defaultDatasetPath);
  const outPath = argValue(argv, "--out", runtimeEnv.CLOUD_LISTING_API_EVAL_OUT || defaultOutPath);
  const baseUrl = argValue(argv, "--base-url", runtimeEnv.CLOUD_LISTING_API_BASE_URL || "");
  const provider = argValue(argv, "--provider", runtimeEnv.CLOUD_LISTING_API_PROVIDER || "gemini");
  const limit = numberArg(argv, "--limit", Number(runtimeEnv.CLOUD_LISTING_API_EVAL_LIMIT || 1));
  const concurrency = numberArg(argv, "--concurrency", Number(runtimeEnv.CLOUD_LISTING_API_EVAL_CONCURRENCY || 1));
  const failOnProviderError = hasFlag(argv, "--fail-on-provider-error");
  const skipPreflight = hasFlag(argv, "--skip-cloud-preflight");
  const requestTimeoutMs = numberArg(argv, "--request-timeout-ms", Number(runtimeEnv.CLOUD_LISTING_API_REQUEST_TIMEOUT_MS || 120_000));
  const bypassSecret = argValue(argv, "--bypass-secret", runtimeEnv.VERCEL_AUTOMATION_BYPASS_SECRET || "");
  validateProtectionBypassSecret({ bypassSecret, env: runtimeEnv });
  const report = await evaluateCloudListingApi({
    dataset: await readJson(datasetPath),
    baseUrl: baseUrl.replace(/\/+$/, ""),
    provider,
    limit,
    concurrency,
    username: runtimeEnv.METAVERSE_USERNAME,
    password: runtimeEnv.METAVERSE_PASSWORD,
    bypassSecret,
    requestTimeoutMs,
    skipPreflight
  });
  if (outPath) await writeJson(outPath, report);
  process.stdout.write([
    `cloud listing api eval ${report.status}`,
    `base_url: ${report.base_url}`,
    `provider: ${report.provider}`,
    `attempted_count: ${report.attempted_count}`,
    `evaluated_count: ${report.evaluated_count}`,
    `provider_error_count: ${report.provider_error_count}`,
    `provider_success_rate: ${report.provider_success_rate}`,
    `fallback_count: ${report.fallback_count}`,
    `corrected_title_token_recall_avg: ${report.corrected_title_token_recall_avg}`,
    `attempted_cards_per_minute: ${report.attempted_cards_per_minute}`,
    `evaluated_cards_per_minute: ${report.evaluated_cards_per_minute}`,
    `per_card_latency_ms_p50: ${report.per_card_latency_ms?.p50 ?? "n/a"}`,
    `per_card_latency_ms_p95: ${report.per_card_latency_ms?.p95 ?? "n/a"}`,
    `raw_field_completeness_avg: ${report.breakpoint_completeness_avg?.raw_provider_fields ?? "n/a"}`,
    `normalized_evidence_completeness_avg: ${report.breakpoint_completeness_avg?.normalized_evidence ?? "n/a"}`,
    `resolved_field_completeness_avg: ${report.breakpoint_completeness_avg?.resolved_fields ?? "n/a"}`
  ].join("\n") + "\n");
  return failOnProviderError && report.provider_error_count > 0 ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(`Cloud listing API eval failed: ${error.message}`);
    process.exit(1);
  }
}
