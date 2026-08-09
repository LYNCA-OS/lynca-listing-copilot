#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { buildCanonicalFieldsRequest, extractCanonicalPayload } from "../lib/listing/thin/canonical-fields.mjs";
import { finishCanonicalTitle } from "../lib/listing/thin/thin-listing-path.mjs";

export const DEFAULT_CONCURRENCY_LEVELS = Object.freeze([2, 4, 6, 10]);
const DIRECT_ENDPOINT_PATH = "/api/csm-listing-title";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const PROVIDER_TEXT_CONTROL_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["control"],
  properties: { control: { type: "string", enum: ["ok"] } }
});
export const SWEEP_EXECUTION_MODES = Object.freeze({
  MOCK: "MOCK_NO_NETWORK",
  ENDPOINT: "CSM_DIRECT_ENDPOINT",
  PROVIDER_DIRECT: "OPENAI_PROVIDER_DIRECT",
  SIGNING_ONLY: "SUPABASE_SIGNING_ONLY",
  PROVIDER_DIRECT_PRESIGNED: "OPENAI_PROVIDER_DIRECT_PRESIGNED",
  PROVIDER_TEXT_CONTROL: "OPENAI_PROVIDER_TEXT_CONTROL"
});
export const DEFAULT_REQUEST_TIMEOUTS_MS = Object.freeze({
  endpoint: 135_000,
  image_signing: 15_000,
  openai_provider: 125_000
});

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function percentile(values, fraction) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

const RATE_LIMIT_HEADERS = Object.freeze([
  "x-ratelimit-limit-requests",
  "x-ratelimit-remaining-requests",
  "x-ratelimit-reset-requests",
  "x-ratelimit-limit-tokens",
  "x-ratelimit-remaining-tokens",
  "x-ratelimit-reset-tokens",
  "retry-after"
]);

function responseRateLimits(response) {
  return Object.fromEntries(RATE_LIMIT_HEADERS.map((name) => [
    name,
    response?.headers?.get?.(name) ?? null
  ]));
}

function positiveTimeoutMs(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function timeoutFailure(stage, timeoutMs) {
  return Object.assign(new Error(`${stage}_timeout`), {
    code: "REQUEST_TIMEOUT",
    timed_out: true,
    timeout_stage: stage,
    timeout_ms: timeoutMs
  });
}

function safeDiagnosticText(value, maxLength = 160) {
  if (value === null || value === undefined || value === "") return null;
  return String(value)
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|sb_secret|sb_publishable)-?[A-Za-z0-9_.-]{8,}\b/gi, "[redacted-secret]")
    .replace(/\b(authorization|apikey|x-api-key)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .slice(0, maxLength);
}

function safeDiagnosticIdentifier(value) {
  const text = safeDiagnosticText(value, 64);
  return text ? text.replace(/[^A-Za-z0-9_.-]/g, "_") : null;
}

function safeNetworkErrorFields(source) {
  return {
    name: safeDiagnosticIdentifier(source?.name),
    code: safeDiagnosticIdentifier(source?.code),
    message: safeDiagnosticText(source?.message)
  };
}

function networkErrorTelemetry(error) {
  const cause = error?.cause;
  const looksLikeFetchFailure = error?.name === "TypeError"
    && /fetch|network|socket|connect/i.test(String(error?.message || ""));
  if (!cause && !looksLikeFetchFailure) return null;
  return safeNetworkErrorFields(cause || error);
}

async function withRequestTimeout({ stage, timeoutMs, run }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(timeoutFailure(stage, timeoutMs)), timeoutMs);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      throw timeoutFailure(stage, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function boundaryForExecutionMode(executionMode) {
  if (executionMode === SWEEP_EXECUTION_MODES.ENDPOINT) {
    return {
      kind: "CSM_DIRECT_HTTP_ENDPOINT",
      endpoint_path: DIRECT_ENDPOINT_PATH,
      provider_url: null,
      supabase_image_signing: null,
      signing_phase: "INSIDE_ENDPOINT_UNOBSERVED",
      provider_phase: "INSIDE_ENDPOINT_UNOBSERVED",
      csm_endpoint_orchestration: true,
      cloud_run_calls: 0,
      vector_calls: 0,
      ocr_calls: 0
    };
  }
  if (executionMode === SWEEP_EXECUTION_MODES.PROVIDER_DIRECT) {
    return {
      kind: "PROVIDER_DIRECT_WITH_SUPABASE_SIGNING",
      endpoint_path: null,
      provider_url: OPENAI_RESPONSES_URL,
      supabase_image_signing: true,
      signing_phase: "TIMED_SWEEP",
      provider_phase: "TIMED_SWEEP",
      csm_endpoint_orchestration: false,
      cloud_run_calls: 0,
      vector_calls: 0,
      ocr_calls: 0
    };
  }
  if (executionMode === SWEEP_EXECUTION_MODES.SIGNING_ONLY) {
    return {
      kind: "SUPABASE_SIGNING_ONLY",
      endpoint_path: null,
      provider_url: null,
      supabase_image_signing: true,
      signing_phase: "TIMED_SWEEP",
      provider_phase: "NOT_CALLED",
      provider_calls_per_card: 0,
      csm_endpoint_orchestration: false,
      cloud_run_calls: 0,
      vector_calls: 0,
      ocr_calls: 0
    };
  }
  if (executionMode === SWEEP_EXECUTION_MODES.PROVIDER_DIRECT_PRESIGNED) {
    return {
      kind: "PROVIDER_DIRECT_WITH_PRESIGNED_IMAGES",
      endpoint_path: null,
      provider_url: OPENAI_RESPONSES_URL,
      supabase_image_signing: true,
      signing_phase: "PREFLIGHT_OUTSIDE_TIMED_SWEEP",
      provider_phase: "TIMED_SWEEP",
      csm_endpoint_orchestration: false,
      cloud_run_calls: 0,
      vector_calls: 0,
      ocr_calls: 0
    };
  }
  if (executionMode === SWEEP_EXECUTION_MODES.PROVIDER_TEXT_CONTROL) {
    return {
      kind: "TEXT_ONLY_NO_IMAGE_FETCH",
      endpoint_path: null,
      provider_url: OPENAI_RESPONSES_URL,
      supabase_image_signing: false,
      signing_phase: "NOT_CALLED",
      provider_phase: "TIMED_SWEEP",
      input_modality: "TEXT_ONLY",
      image_fetch_calls_per_card: 0,
      card_recognition_quality_evidence: false,
      csm_endpoint_orchestration: false,
      cloud_run_calls: 0,
      vector_calls: 0,
      ocr_calls: 0
    };
  }
  if (executionMode === SWEEP_EXECUTION_MODES.MOCK) {
    return {
      kind: "MOCK_NO_NETWORK",
      endpoint_path: null,
      provider_url: null,
      supabase_image_signing: false,
      signing_phase: "NOT_CALLED",
      provider_phase: "NOT_CALLED",
      csm_endpoint_orchestration: false,
      cloud_run_calls: 0,
      vector_calls: 0,
      ocr_calls: 0
    };
  }
  throw new Error(`unsupported_sweep_execution_mode:${executionMode}`);
}

function timingSummary(cards, field) {
  const values = cards.map((card) => finiteNumber(card[field])).filter((value) => value !== null);
  return {
    observed_count: values.length,
    p50_ms: percentile(values, 0.50),
    p95_ms: percentile(values, 0.95),
    max_ms: values.length ? Math.max(...values) : null
  };
}

function rateLimitSummary(cards, resource) {
  const header = (kind) => `x-ratelimit-${kind}-${resource}`;
  const limits = cards.map((card) => finiteNumber(card.rate_limit_headers?.[header("limit")]))
    .filter((value) => value !== null);
  const remaining = cards.map((card) => finiteNumber(card.rate_limit_headers?.[header("remaining")]))
    .filter((value) => value !== null);
  const resets = [...new Set(cards.map((card) => card.rate_limit_headers?.[header("reset")]).filter(Boolean))];
  return {
    observed_limits: [...new Set(limits)].sort((a, b) => a - b),
    minimum_remaining: remaining.length ? Math.min(...remaining) : null,
    observed_resets: resets
  };
}

function timeoutSummary(cards) {
  const timedOut = cards.filter((card) => card.timed_out === true);
  const byStage = {};
  for (const card of timedOut) {
    const stage = String(card.timeout_stage || "unknown");
    byStage[stage] = (byStage[stage] || 0) + 1;
  }
  return {
    count: timedOut.length,
    rate: cards.length ? Number((timedOut.length / cards.length).toFixed(6)) : 0,
    by_stage: byStage
  };
}

function networkErrorSummary(cards) {
  const errors = cards.map((card) => card.network_error).filter(Boolean);
  const countBy = (field) => {
    const counts = new Map();
    for (const error of errors) {
      const value = String(error[field] || "unknown");
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    return Object.fromEntries(counts);
  };
  return {
    count: errors.length,
    by_code: countBy("code"),
    by_message: countBy("message")
  };
}

export async function mapConcurrent(items, concurrency, worker, { shouldStop = () => false } = {}) {
  const width = Math.max(1, Math.trunc(Number(concurrency) || 1));
  const output = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    while (cursor < items.length) {
      if (shouldStop()) return;
      const index = cursor++;
      output[index] = await worker(items[index], index);
    }
  }));
  return output;
}

export function estimateCardCost(card, pricing = {}) {
  const inputTokens = card.inputTokens ?? card.input_tokens;
  const outputTokens = card.outputTokens ?? card.output_tokens;
  const inputRate = finiteNumber(pricing.inputUsdPerMillion);
  const outputRate = finiteNumber(pricing.outputUsdPerMillion);
  if (inputRate === null && outputRate === null) return null;
  return Number((((inputRate || 0) * (finiteNumber(inputTokens) || 0)
    + (outputRate || 0) * (finiteNumber(outputTokens) || 0)) / 1_000_000).toFixed(8));
}

export function summarizeLevel({ concurrency, cards, wallMs }) {
  const attempted = cards.length;
  const succeeded = cards.filter((card) => card.ok).length;
  const http429Count = cards.filter((card) => card.http_429).length;
  const knownCosts = cards.map((card) => card.estimated_cost_usd).filter((value) => value !== null);
  const knownProviderCalls = cards.map((card) => card.provider_call_count).filter((value) => value !== null);
  const safeWallMs = Math.max(1, Number(wallMs) || 1);
  return {
    concurrency,
    attempted_count: attempted,
    succeeded_count: succeeded,
    failed_count: attempted - succeeded,
    throughput_cards_per_minute: Number((succeeded * 60_000 / safeWallMs).toFixed(4)),
    attempted_requests_per_second: Number((attempted * 1_000 / safeWallMs).toFixed(4)),
    wall_ms: safeWallMs,
    latency_p50_ms: percentile(cards.map((card) => card.latency_ms), 0.50),
    latency_p95_ms: percentile(cards.map((card) => card.latency_ms), 0.95),
    http_429_count: http429Count,
    http_429_rate: attempted ? Number((http429Count / attempted).toFixed(6)) : 0,
    retry_after_values: [...new Set(cards.map((card) => card.retry_after).filter(Boolean))],
    timeouts: timeoutSummary(cards),
    network_errors: networkErrorSummary(cards),
    failure_rate: attempted ? Number(((attempted - succeeded) / attempted).toFixed(6)) : 0,
    http_attempt_count: cards.reduce((sum, card) => sum + (finiteNumber(card.http_attempt_count) || 0), 0),
    image_signing_call_count: cards.reduce((sum, card) => sum + (finiteNumber(card.image_signing_call_count) || 0), 0),
    provider_call_count: knownProviderCalls.length === cards.length
      ? knownProviderCalls.reduce((sum, value) => sum + value, 0)
      : null,
    input_tokens: cards.reduce((sum, card) => sum + (finiteNumber(card.input_tokens) || 0), 0),
    output_tokens: cards.reduce((sum, card) => sum + (finiteNumber(card.output_tokens) || 0), 0),
    estimated_cost_usd: knownCosts.length === cards.length
      ? Number(knownCosts.reduce((sum, value) => sum + value, 0).toFixed(8))
      : null,
    stage_latency: {
      image_signing: timingSummary(cards, "image_signing_ms"),
      openai_provider: timingSummary(cards, "openai_provider_ms"),
      composer: timingSummary(cards, "composer_ms")
    },
    rate_limits: {
      requests: rateLimitSummary(cards, "requests"),
      tokens: rateLimitSummary(cards, "tokens")
    },
    cards
  };
}

export function chooseConcurrency(levels, { plateauFraction = 0.95 } = {}) {
  const ordered = [...levels].sort((a, b) => a.concurrency - b.concurrency);
  let previous = null;
  let bestFailureRate = Infinity;
  let best429Rate = Infinity;
  const assessed = ordered.map((level) => {
    const stable = level.failure_rate <= bestFailureRate && level.http_429_rate <= best429Rate;
    const row = {
      concurrency: level.concurrency,
      stable,
      marginal_throughput_gain: previous && previous.throughput_cards_per_minute > 0
        ? Number(((level.throughput_cards_per_minute / previous.throughput_cards_per_minute) - 1).toFixed(6))
        : null
    };
    bestFailureRate = Math.min(bestFailureRate, level.failure_rate);
    best429Rate = Math.min(best429Rate, level.http_429_rate);
    previous = level;
    return row;
  });
  const stableLevels = ordered.filter((level, index) => assessed[index].stable);
  if (!stableLevels.length) return { selected_concurrency: null, reason: "NO_STABLE_LEVEL", assessed };
  const maxThroughput = Math.max(...stableLevels.map((level) => level.throughput_cards_per_minute));
  const threshold = maxThroughput * Math.min(1, Math.max(0, plateauFraction));
  const selected = stableLevels.find((level) => level.throughput_cards_per_minute >= threshold);
  return {
    selected_concurrency: selected.concurrency,
    reason: "MINIMUM_STABLE_CONCURRENCY_WITHIN_PLATEAU",
    plateau_fraction: plateauFraction,
    stable_max_throughput_cards_per_minute: maxThroughput,
    throughput_threshold_cards_per_minute: Number(threshold.toFixed(4)),
    assessed
  };
}

export async function runConcurrencySweep({
  assets,
  levels = DEFAULT_CONCURRENCY_LEVELS,
  requestCard,
  executionMode = SWEEP_EXECUTION_MODES.MOCK,
  requestTimeoutsMs = null,
  pricing = {},
  now = () => performance.now(),
  cooldownMs = 0,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}) {
  if (!Array.isArray(assets) || !assets.length) throw new Error("assets_required");
  if (typeof requestCard !== "function") throw new Error("request_card_required");
  const reports = [];
  let fatal = null;
  for (const [levelIndex, concurrency] of levels.entries()) {
    const startedAt = now();
    const cards = (await mapConcurrent(assets, concurrency, async (asset, index) => {
      const requestStartedAt = now();
      try {
        const result = await requestCard(asset, { concurrency, index });
        if (result.fail_fast === true && !fatal) {
          fatal = {
            status: finiteNumber(result.status),
            error: String(result.error || "fatal_request_error").slice(0, 240),
            concurrency,
            asset_id: String(asset.asset_id || asset.assetId || asset.id || asset)
          };
        }
        const latencyMs = Math.max(0, Math.round(now() - requestStartedAt));
        const card = {
          asset_id: String(asset.asset_id || asset.assetId || asset.id || asset),
          ok: result.ok === true,
          status: finiteNumber(result.status),
          latency_ms: finiteNumber(result.latency_ms) ?? latencyMs,
          http_429: Number(result.status) === 429 || result.http_429 === true,
          http_attempt_count: finiteNumber(result.http_attempt_count) ?? 1,
          image_signing_call_count: finiteNumber(result.image_signing_call_count),
          provider_call_count: finiteNumber(result.provider_call_count),
          input_tokens: finiteNumber(result.input_tokens),
          output_tokens: finiteNumber(result.output_tokens),
          cloud_run_calls: finiteNumber(result.cloud_run_calls),
          vector_calls: finiteNumber(result.vector_calls),
          ocr_calls: finiteNumber(result.ocr_calls),
          image_signing_ms: finiteNumber(result.image_signing_ms),
          openai_provider_ms: finiteNumber(result.openai_provider_ms),
          composer_ms: finiteNumber(result.composer_ms),
          rate_limit_headers: result.rate_limit_headers || null,
          retry_after: result.retry_after ?? result.rate_limit_headers?.["retry-after"] ?? null,
          timed_out: result.timed_out === true,
          timeout_stage: result.timeout_stage || null,
          timeout_ms: finiteNumber(result.timeout_ms),
          network_error: result.network_error ? safeNetworkErrorFields(result.network_error) : null,
          fail_fast: result.fail_fast === true,
          error: result.error ? safeDiagnosticText(result.error, 240) : null
        };
        card.estimated_cost_usd = result.estimated_cost_usd ?? estimateCardCost(card, pricing);
        return card;
      } catch (error) {
        return {
          asset_id: String(asset.asset_id || asset.assetId || asset.id || asset),
          ok: false,
          status: finiteNumber(error?.status),
          latency_ms: Math.max(0, Math.round(now() - requestStartedAt)),
          http_429: Number(error?.status) === 429,
          http_attempt_count: finiteNumber(error?.http_attempt_count) ?? 1,
          image_signing_call_count: finiteNumber(error?.image_signing_call_count),
          provider_call_count: finiteNumber(error?.provider_call_count),
          input_tokens: null,
          output_tokens: null,
          estimated_cost_usd: null,
          cloud_run_calls: null,
          vector_calls: null,
          ocr_calls: null,
          image_signing_ms: finiteNumber(error?.image_signing_ms),
          openai_provider_ms: finiteNumber(error?.openai_provider_ms),
          composer_ms: null,
          rate_limit_headers: error?.rate_limit_headers || null,
          retry_after: error?.retry_after ?? error?.rate_limit_headers?.["retry-after"] ?? null,
          timed_out: error?.timed_out === true,
          timeout_stage: error?.timeout_stage || null,
          timeout_ms: finiteNumber(error?.timeout_ms),
          network_error: networkErrorTelemetry(error),
          error: safeDiagnosticText(error?.message || error, 240)
        };
      }
    }, { shouldStop: () => fatal !== null })).filter(Boolean);
    reports.push(summarizeLevel({ concurrency, cards, wallMs: Math.max(1, now() - startedAt) }));
    if (fatal) break;
    if (cooldownMs > 0 && levelIndex < levels.length - 1) await wait(cooldownMs);
  }
  const screeningResult = chooseConcurrency(reports);
  const textControl = executionMode === SWEEP_EXECUTION_MODES.PROVIDER_TEXT_CONTROL;
  return {
    schema_version: "csm-direct-concurrency-sweep-v2",
    study_phase: "SCREEN",
    production_recommendation: false,
    execution_mode: executionMode,
    evidence_scope: textControl ? "OPENAI_TEXT_NETWORK_CONTROL_ONLY" : "CONCURRENCY_SCREEN",
    card_recognition_quality_evidence: textControl ? false : null,
    boundary: boundaryForExecutionMode(executionMode),
    request_timeouts_ms: requestTimeoutsMs,
    cards_per_level: assets.length,
    cooldown_between_levels_ms: cooldownMs,
    terminated_early: fatal !== null,
    fail_fast: fatal,
    selection_rule: textControl
      ? "Network control only: identify text-request behavior at each tested concurrency; do not use it as card-quality or production-concurrency evidence."
      : "Screen only: identify the smallest stable concurrency within 95% of this screen's maximum throughput; failure and HTTP 429 rates must not regress versus any lower concurrency.",
    levels: reports,
    screening_result: screeningResult,
    recommendation: textControl
      ? {
        status: "NETWORK_CONTROL_ONLY_NOT_A_PRODUCTION_RECOMMENDATION",
        production_concurrency: null,
        screen_candidate_concurrency: null,
        network_control_candidate_concurrency: screeningResult.selected_concurrency,
        required_followup: "Compare with image-bearing provider-direct results; this text control cannot establish card accuracy or production concurrency."
      }
      : {
        status: "NOT_A_PRODUCTION_RECOMMENDATION",
        production_concurrency: null,
        screen_candidate_concurrency: screeningResult.selected_concurrency,
        required_followup: "Repeat the candidate and adjacent levels on a larger hosted sample and stability soak before changing production concurrency."
      }
  };
}

export function createDirectEndpointRequester({
  endpoint,
  authorization,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_REQUEST_TIMEOUTS_MS.endpoint
}) {
  const url = new URL(endpoint);
  if (url.pathname.replace(/\/+$/, "") !== DIRECT_ENDPOINT_PATH) {
    throw new Error(`real_mode_requires_direct_endpoint:${DIRECT_ENDPOINT_PATH}`);
  }
  return async (asset) => {
    const effectiveTimeoutMs = positiveTimeoutMs(timeoutMs, DEFAULT_REQUEST_TIMEOUTS_MS.endpoint);
    let fetchStarted = false;
    let response;
    let payload;
    try {
      ({ response, payload } = await withRequestTimeout({
        stage: "csm_direct_endpoint",
        timeoutMs: effectiveTimeoutMs,
        run: async (signal) => {
          fetchStarted = true;
          const response = await fetchImpl(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(authorization ? { authorization } : {})
            },
            body: JSON.stringify({ asset_id: String(asset.asset_id || asset.assetId || asset.id || asset) }),
            signal
          });
          let payload = {};
          try { payload = await response.json(); } catch { payload = {}; }
          return { response, payload };
        }
      }));
    } catch (error) {
      const networkError = networkErrorTelemetry(error);
      if (error?.timed_out !== true && !networkError) throw error;
      return {
        ok: false,
        status: null,
        http_attempt_count: fetchStarted ? 1 : 0,
        provider_call_count: null,
        timed_out: error?.timed_out === true,
        timeout_stage: error?.timeout_stage || null,
        timeout_ms: finiteNumber(error?.timeout_ms),
        network_error: networkError,
        error: error?.timed_out ? error.code : "NETWORK_ERROR"
      };
    }
    if (payload.cloud_run_calls != null && Number(payload.cloud_run_calls) !== 0) throw new Error("cloud_run_boundary_violated");
    if (payload.vector_calls != null && Number(payload.vector_calls) !== 0) throw new Error("vector_boundary_violated");
    const rateLimitHeaders = responseRateLimits(response);
    return {
      ok: response.ok && payload.ok !== false,
      status: response.status,
      http_attempt_count: 1,
      provider_call_count: finiteNumber(payload.provider_calls)
        ?? (response.status === 429 ? 0 : (response.ok ? 1 : null)),
      input_tokens: payload.input_tokens,
      output_tokens: payload.output_tokens,
      cloud_run_calls: finiteNumber(payload.cloud_run_calls),
      vector_calls: finiteNumber(payload.vector_calls),
      ocr_calls: finiteNumber(payload.ocr_calls),
      rate_limit_headers: rateLimitHeaders,
      retry_after: rateLimitHeaders["retry-after"],
      error: response.ok ? null : payload.code || payload.message || `HTTP ${response.status}`
    };
  };
}

export function createSupabaseSigningRequester({
  supabaseUrl,
  serviceKey,
  fetchImpl = globalThis.fetch,
  now = () => performance.now(),
  signingTimeoutMs = DEFAULT_REQUEST_TIMEOUTS_MS.image_signing
} = {}) {
  const baseUrl = String(supabaseUrl || "").replace(/\/+$/, "");
  if (!baseUrl || !serviceKey) throw new Error("supabase_signing_credentials_required");
  return async (asset) => {
    const signingStartedAt = now();
    const images = (asset.images || []).slice(0, 2);
    let fetchStartedCount = 0;
    const signImage = async (image) => {
      const bucket = String(image.bucket || "").trim();
      const objectPath = String(image.object_path || image.objectPath || "").trim();
      if (!bucket || !objectPath) return null;
      const effectiveTimeoutMs = positiveTimeoutMs(signingTimeoutMs, DEFAULT_REQUEST_TIMEOUTS_MS.image_signing);
      return withRequestTimeout({
        stage: "supabase_image_signing",
        timeoutMs: effectiveTimeoutMs,
        run: async (signal) => {
          fetchStartedCount += 1;
          const signed = await fetchImpl(`${baseUrl}/storage/v1/object/sign/${bucket}/${objectPath}`, {
            method: "POST",
            headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
            body: JSON.stringify({ expiresIn: 3600 }),
            signal
          });
          if (!signed.ok) throw Object.assign(new Error("image_sign_failed"), { status: signed.status });
          const body = await signed.json();
          return `${baseUrl}/storage/v1${body.signedURL || body.signedUrl}`;
        }
      });
    };
    let imageUrls;
    try {
      imageUrls = (await Promise.all(images.map(signImage))).filter(Boolean);
    } catch (error) {
      const networkError = networkErrorTelemetry(error);
      return {
        ok: false, status: finiteNumber(error?.status), provider_call_count: 0,
        http_attempt_count: fetchStartedCount,
        image_signing_call_count: fetchStartedCount,
        image_signing_ms: Math.max(0, now() - signingStartedAt),
        openai_provider_ms: null, composer_ms: null,
        cloud_run_calls: 0, vector_calls: 0, ocr_calls: 0,
        timed_out: error?.timed_out === true,
        timeout_stage: error?.timeout_stage || null,
        timeout_ms: finiteNumber(error?.timeout_ms),
        network_error: networkError,
        error: error?.timed_out ? error.code : networkError ? "NETWORK_ERROR" : "image_sign_failed"
      };
    }
    const imageSigningMs = Math.max(0, now() - signingStartedAt);
    if (!imageUrls.length) return {
      ok: false, status: 422, provider_call_count: 0,
      http_attempt_count: 0, image_signing_call_count: 0,
      image_signing_ms: imageSigningMs, openai_provider_ms: null, composer_ms: null,
      cloud_run_calls: 0, vector_calls: 0, ocr_calls: 0,
      error: "asset_images_missing"
    };
    return {
      ok: true, status: 200, provider_call_count: 0,
      http_attempt_count: fetchStartedCount,
      image_signing_call_count: fetchStartedCount,
      image_signing_ms: imageSigningMs, openai_provider_ms: null, composer_ms: null,
      cloud_run_calls: 0, vector_calls: 0, ocr_calls: 0,
      signed_image_urls: imageUrls,
      error: null
    };
  };
}

export function createPresignedProviderRequester({
  apiKey,
  model = "gpt-5.6-luna",
  effort = "none",
  imageDetail = "high",
  fetchImpl = globalThis.fetch,
  now = () => performance.now(),
  providerTimeoutMs = DEFAULT_REQUEST_TIMEOUTS_MS.openai_provider
} = {}) {
  if (!apiKey) throw new Error("provider_direct_credentials_required");
  if (!/^sk-[A-Za-z0-9_-]{16,509}$/.test(String(apiKey))) throw new Error("openai_api_key_invalid_shape");
  return async (asset) => {
    const imageUrls = (asset.pre_signed_image_urls || asset.signed_image_urls || asset.image_urls || asset.imageUrls || [])
      .map((value) => String(value || "").trim()).filter(Boolean).slice(0, 2);
    if (!imageUrls.length) return {
      ok: false, status: 422, provider_call_count: 0, http_attempt_count: 0,
      image_signing_call_count: 0, image_signing_ms: 0, openai_provider_ms: null, composer_ms: null,
      cloud_run_calls: 0, vector_calls: 0, ocr_calls: 0,
      error: "presigned_asset_images_missing"
    };
    const providerStartedAt = now();
    const effectiveProviderTimeoutMs = positiveTimeoutMs(providerTimeoutMs, DEFAULT_REQUEST_TIMEOUTS_MS.openai_provider);
    let fetchStarted = false;
    let response;
    let body;
    try {
      ({ response, body } = await withRequestTimeout({
        stage: "openai_provider",
        timeoutMs: effectiveProviderTimeoutMs,
        run: async (signal) => {
          fetchStarted = true;
          const response = await fetchImpl(OPENAI_RESPONSES_URL, {
            method: "POST",
            headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
            body: JSON.stringify(buildCanonicalFieldsRequest({ imageUrls, model, effort, imageDetail })),
            signal
          });
          const body = await response.json().catch(() => ({}));
          return { response, body };
        }
      }));
    } catch (error) {
      const providerMs = Math.max(0, now() - providerStartedAt);
      const networkError = networkErrorTelemetry(error);
      if (error?.timed_out !== true && !networkError) {
        throw Object.assign(error, {
          http_attempt_count: fetchStarted ? 1 : 0,
          provider_call_count: fetchStarted ? 1 : 0,
          image_signing_ms: 0,
          openai_provider_ms: providerMs
        });
      }
      return {
        ok: false, status: null, provider_call_count: fetchStarted ? 1 : 0,
        http_attempt_count: fetchStarted ? 1 : 0,
        image_signing_call_count: 0, image_signing_ms: 0, openai_provider_ms: providerMs, composer_ms: null,
        cloud_run_calls: 0, vector_calls: 0, ocr_calls: 0,
        timed_out: error?.timed_out === true,
        timeout_stage: error?.timeout_stage || null,
        timeout_ms: finiteNumber(error?.timeout_ms),
        network_error: networkError,
        rate_limit_headers: null, retry_after: null,
        error: error?.timed_out ? error.code : "NETWORK_ERROR"
      };
    }
    const providerMs = Math.max(0, now() - providerStartedAt);
    const rateLimitHeaders = responseRateLimits(response);
    if (!response.ok || body.error) {
      return {
        ok: false, status: response.status, provider_call_count: 1, http_attempt_count: 1,
        image_signing_call_count: 0,
        input_tokens: body?.usage?.input_tokens ?? null,
        output_tokens: body?.usage?.output_tokens ?? null,
        image_signing_ms: 0, openai_provider_ms: providerMs, composer_ms: null,
        cloud_run_calls: 0, vector_calls: 0, ocr_calls: 0,
        rate_limit_headers: rateLimitHeaders,
        retry_after: rateLimitHeaders["retry-after"],
        fail_fast: response.status === 401 || response.status === 403,
        error: body?.error?.message || `provider_http_${response.status}`
      };
    }
    const composerStartedAt = now();
    const finished = finishCanonicalTitle(extractCanonicalPayload(body));
    const composerMs = Math.max(0, now() - composerStartedAt);
    return {
      ok: Boolean(finished.title), status: response.status, provider_call_count: 1, http_attempt_count: 1,
      image_signing_call_count: 0,
      input_tokens: body?.usage?.input_tokens ?? null,
      output_tokens: body?.usage?.output_tokens ?? null,
      cloud_run_calls: 0, vector_calls: 0, ocr_calls: 0,
      image_signing_ms: 0, openai_provider_ms: providerMs, composer_ms: composerMs,
      rate_limit_headers: rateLimitHeaders,
      retry_after: rateLimitHeaders["retry-after"],
      error: finished.title ? null : "canonical_output_empty"
    };
  };
}

export function buildProviderTextControlRequest({ model, effort = "none" } = {}) {
  return {
    model,
    max_output_tokens: 128,
    reasoning: { effort },
    text: {
      format: {
        type: "json_schema",
        name: "concurrency_text_control",
        strict: true,
        schema: PROVIDER_TEXT_CONTROL_SCHEMA
      }
    },
    input: [{
      role: "user",
      content: [{ type: "input_text", text: 'Return exactly {"control":"ok"}.' }]
    }]
  };
}

function responseOutputText(body) {
  if (typeof body?.output_text === "string") return body.output_text;
  for (const item of body?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

export function createProviderTextControlRequester({
  apiKey,
  model = "gpt-5.6-luna",
  effort = "none",
  fetchImpl = globalThis.fetch,
  now = () => performance.now(),
  providerTimeoutMs = DEFAULT_REQUEST_TIMEOUTS_MS.openai_provider
} = {}) {
  if (!apiKey) throw new Error("provider_direct_credentials_required");
  if (!/^sk-[A-Za-z0-9_-]{16,509}$/.test(String(apiKey))) throw new Error("openai_api_key_invalid_shape");
  const requestBody = buildProviderTextControlRequest({ model, effort });
  return async () => {
    const providerStartedAt = now();
    const effectiveProviderTimeoutMs = positiveTimeoutMs(providerTimeoutMs, DEFAULT_REQUEST_TIMEOUTS_MS.openai_provider);
    let fetchStarted = false;
    let response;
    let body;
    try {
      ({ response, body } = await withRequestTimeout({
        stage: "openai_provider",
        timeoutMs: effectiveProviderTimeoutMs,
        run: async (signal) => {
          fetchStarted = true;
          const response = await fetchImpl(OPENAI_RESPONSES_URL, {
            method: "POST",
            headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
            body: JSON.stringify(requestBody),
            signal
          });
          const body = await response.json().catch(() => ({}));
          return { response, body };
        }
      }));
    } catch (error) {
      const providerMs = Math.max(0, now() - providerStartedAt);
      const networkError = networkErrorTelemetry(error);
      if (error?.timed_out !== true && !networkError) {
        throw Object.assign(error, {
          http_attempt_count: fetchStarted ? 1 : 0,
          provider_call_count: fetchStarted ? 1 : 0,
          openai_provider_ms: providerMs
        });
      }
      return {
        ok: false, status: null,
        provider_call_count: fetchStarted ? 1 : 0,
        http_attempt_count: fetchStarted ? 1 : 0,
        image_signing_call_count: 0, image_signing_ms: 0,
        openai_provider_ms: providerMs, composer_ms: null,
        cloud_run_calls: 0, vector_calls: 0, ocr_calls: 0,
        timed_out: error?.timed_out === true,
        timeout_stage: error?.timeout_stage || null,
        timeout_ms: finiteNumber(error?.timeout_ms),
        network_error: networkError,
        rate_limit_headers: null, retry_after: null,
        error: error?.timed_out ? error.code : "NETWORK_ERROR"
      };
    }
    const providerMs = Math.max(0, now() - providerStartedAt);
    const rateLimitHeaders = responseRateLimits(response);
    if (!response.ok || body.error) {
      return {
        ok: false, status: response.status, provider_call_count: 1, http_attempt_count: 1,
        image_signing_call_count: 0,
        input_tokens: body?.usage?.input_tokens ?? null,
        output_tokens: body?.usage?.output_tokens ?? null,
        image_signing_ms: 0, openai_provider_ms: providerMs, composer_ms: null,
        cloud_run_calls: 0, vector_calls: 0, ocr_calls: 0,
        rate_limit_headers: rateLimitHeaders,
        retry_after: rateLimitHeaders["retry-after"],
        fail_fast: response.status === 401 || response.status === 403,
        error: body?.error?.message || `provider_http_${response.status}`
      };
    }
    let validControl = false;
    try {
      validControl = JSON.parse(responseOutputText(body))?.control === "ok";
    } catch {
      validControl = false;
    }
    return {
      ok: validControl, status: response.status, provider_call_count: 1, http_attempt_count: 1,
      image_signing_call_count: 0,
      input_tokens: body?.usage?.input_tokens ?? null,
      output_tokens: body?.usage?.output_tokens ?? null,
      cloud_run_calls: 0, vector_calls: 0, ocr_calls: 0,
      image_signing_ms: 0, openai_provider_ms: providerMs, composer_ms: null,
      rate_limit_headers: rateLimitHeaders,
      retry_after: rateLimitHeaders["retry-after"],
      error: validControl ? null : "text_control_output_invalid"
    };
  };
}

export function createDirectProviderRequester(options = {}) {
  if (!options.supabaseUrl || !options.serviceKey || !options.apiKey) {
    throw new Error("provider_direct_credentials_required");
  }
  const signAsset = createSupabaseSigningRequester(options);
  const requestProvider = createPresignedProviderRequester(options);
  return async (asset) => {
    const signed = await signAsset(asset);
    if (!signed.ok) return signed;
    const provider = await requestProvider({ ...asset, pre_signed_image_urls: signed.signed_image_urls });
    return {
      ...provider,
      http_attempt_count: (finiteNumber(signed.http_attempt_count) || 0)
        + (finiteNumber(provider.http_attempt_count) || 0),
      image_signing_call_count: finiteNumber(signed.image_signing_call_count) || 0,
      image_signing_ms: finiteNumber(signed.image_signing_ms)
    };
  };
}

export async function preSignAssets({
  assets,
  signAsset,
  concurrency = 4,
  now = () => performance.now()
}) {
  if (!Array.isArray(assets) || !assets.length) throw new Error("assets_required");
  if (typeof signAsset !== "function") throw new Error("sign_asset_required");
  const startedAt = now();
  const results = await mapConcurrent(assets, concurrency, async (asset) => {
    let result;
    try {
      result = await signAsset(asset);
    } catch (error) {
      result = {
        ok: false,
        status: finiteNumber(error?.status),
        provider_call_count: 0,
        image_signing_call_count: finiteNumber(error?.image_signing_call_count),
        timed_out: error?.timed_out === true,
        timeout_stage: error?.timeout_stage || null,
        timeout_ms: finiteNumber(error?.timeout_ms),
        network_error: networkErrorTelemetry(error),
        error: safeDiagnosticText(error?.message || error, 240)
      };
    }
    return { asset, result };
  });
  const failures = results.filter(({ result }) => !result.ok).map(({ asset, result }) => ({
    asset_id: String(asset.asset_id || asset.assetId || asset.id || asset),
    status: finiteNumber(result.status),
    timed_out: result.timed_out === true,
    timeout_stage: result.timeout_stage || null,
    timeout_ms: finiteNumber(result.timeout_ms),
    network_error: result.network_error ? safeNetworkErrorFields(result.network_error) : null,
    error: safeDiagnosticText(result.error || "image_sign_failed", 240)
  }));
  const signedAssets = results.filter(({ result }) => result.ok).map(({ asset, result }) => ({
    ...asset,
    pre_signed_image_urls: result.signed_image_urls
  }));
  const cards = results.map(({ result }) => result);
  return {
    signed_assets: signedAssets,
    report: {
      phase: "PREFLIGHT_OUTSIDE_TIMED_SWEEP",
      concurrency: Math.max(1, Math.trunc(Number(concurrency) || 1)),
      attempted_asset_count: assets.length,
      succeeded_asset_count: signedAssets.length,
      failed_asset_count: failures.length,
      wall_ms: Math.max(0, now() - startedAt),
      image_signing_call_count: cards.reduce(
        (sum, card) => sum + (finiteNumber(card.image_signing_call_count) || 0), 0
      ),
      provider_call_count: 0,
      timeouts: timeoutSummary(cards),
      network_errors: networkErrorSummary(cards),
      failures
    }
  };
}

export async function runPresignedProviderSweep({
  assets,
  levels = DEFAULT_CONCURRENCY_LEVELS,
  signAsset,
  requestCard,
  preflightConcurrency = 4,
  requestTimeoutsMs = null,
  pricing = {},
  now = () => performance.now(),
  cooldownMs = 0,
  wait
}) {
  const preflight = await preSignAssets({ assets, signAsset, concurrency: preflightConcurrency, now });
  if (preflight.report.failed_asset_count > 0) {
    return {
      schema_version: "csm-direct-concurrency-sweep-v2",
      study_phase: "PREFLIGHT_FAILED",
      production_recommendation: false,
      execution_mode: SWEEP_EXECUTION_MODES.PROVIDER_DIRECT_PRESIGNED,
      boundary: boundaryForExecutionMode(SWEEP_EXECUTION_MODES.PROVIDER_DIRECT_PRESIGNED),
      request_timeouts_ms: requestTimeoutsMs,
      cards_per_level: assets.length,
      cooldown_between_levels_ms: cooldownMs,
      terminated_early: true,
      fail_fast: { error: "PRESIGN_PREFLIGHT_FAILED", failed_asset_count: preflight.report.failed_asset_count },
      preflight: preflight.report,
      selection_rule: "No timed provider sweep is valid until every asset is pre-signed exactly once.",
      levels: [],
      screening_result: null,
      recommendation: {
        status: "PREFLIGHT_FAILED",
        production_concurrency: null,
        screen_candidate_concurrency: null,
        required_followup: "Fix the signing failures, then rerun the complete preflight before any provider request."
      }
    };
  }
  const report = await runConcurrencySweep({
    assets: preflight.signed_assets,
    levels,
    requestCard,
    executionMode: SWEEP_EXECUTION_MODES.PROVIDER_DIRECT_PRESIGNED,
    requestTimeoutsMs,
    pricing,
    now,
    cooldownMs,
    ...(wait ? { wait } : {})
  });
  return { ...report, preflight: preflight.report };
}

function argValue(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}

async function readAssets(path) {
  const text = await readFile(path, "utf8");
  if (path.endsWith(".jsonl")) return text.split("\n").filter((line) => line.trim()).map(JSON.parse);
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : parsed.assets || parsed.items || [];
}

function createMockRequester() {
  let active = 0;
  return async (asset) => {
    active += 1;
    const delay = 8 + Math.max(0, active - 6) * 5;
    await new Promise((resolve) => setTimeout(resolve, delay));
    active -= 1;
    return {
      ok: true, status: 200, provider_call_count: 1,
      input_tokens: 1000, output_tokens: 120, cloud_run_calls: 0, vector_calls: 0
    };
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const real = argv.includes("--real");
  const providerDirect = argv.includes("--provider-direct");
  const signingOnly = argv.includes("--signing-only");
  const providerDirectPresigned = argv.includes("--provider-direct-presigned");
  const providerTextControl = argv.includes("--provider-text-control");
  const requestedRealModes = [
    real, providerDirect, signingOnly, providerDirectPresigned, providerTextControl
  ].filter(Boolean).length;
  if (requestedRealModes > 1) throw new Error("choose_one_real_mode");
  const realExecution = requestedRealModes === 1;
  const levels = String(argValue(argv, "--levels", DEFAULT_CONCURRENCY_LEVELS.join(",")))
    .split(",").map(Number).filter((value) => Number.isInteger(value) && value > 0);
  const assetsPath = argValue(argv, "--assets");
  const allAssets = assetsPath
    ? await readAssets(assetsPath)
    : Array.from({ length: Number(argValue(argv, "--mock-cards", 24)) || 24 }, (_, index) => ({ asset_id: `mock-${index + 1}` }));
  const limitRaw = argValue(argv, "--limit");
  const limit = limitRaw === null ? null : Math.trunc(Number(limitRaw));
  if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) throw new Error("--limit must be a positive integer");
  const selectedAssets = limit === null ? allAssets : allAssets.slice(0, limit);
  const assets = providerTextControl
    ? selectedAssets.map((asset) => ({
      asset_id: String(asset?.asset_id || asset?.assetId || asset?.id || asset)
    }))
    : selectedAssets;
  if (realExecution && !assetsPath && !providerTextControl) {
    throw new Error("real execution requires --assets <json-or-jsonl>");
  }
  const endpoint = argValue(argv, "--endpoint", env.CSM_DIRECT_BENCHMARK_ENDPOINT);
  if (real && !endpoint) throw new Error("--real requires --endpoint or CSM_DIRECT_BENCHMARK_ENDPOINT");
  const authorization = argValue(argv, "--authorization", env.CSM_DIRECT_BENCHMARK_AUTHORIZATION);
  const endpointTimeoutMs = positiveTimeoutMs(
    argValue(argv, "--endpoint-timeout-ms", env.CSM_DIRECT_ENDPOINT_TIMEOUT_MS),
    DEFAULT_REQUEST_TIMEOUTS_MS.endpoint
  );
  const signingTimeoutMs = positiveTimeoutMs(
    argValue(argv, "--signing-timeout-ms", env.CSM_SIGNING_TIMEOUT_MS),
    DEFAULT_REQUEST_TIMEOUTS_MS.image_signing
  );
  const providerTimeoutMs = positiveTimeoutMs(
    argValue(argv, "--provider-timeout-ms", env.CSM_PROVIDER_TIMEOUT_MS),
    DEFAULT_REQUEST_TIMEOUTS_MS.openai_provider
  );
  const preflightConcurrency = Math.max(1, Math.trunc(Number(
    argValue(argv, "--preflight-concurrency", env.CSM_PRESIGN_PREFLIGHT_CONCURRENCY || 4)
  ) || 4));
  const executionMode = real
    ? SWEEP_EXECUTION_MODES.ENDPOINT
    : providerDirect
      ? SWEEP_EXECUTION_MODES.PROVIDER_DIRECT
      : signingOnly
        ? SWEEP_EXECUTION_MODES.SIGNING_ONLY
        : providerDirectPresigned
          ? SWEEP_EXECUTION_MODES.PROVIDER_DIRECT_PRESIGNED
          : providerTextControl
            ? SWEEP_EXECUTION_MODES.PROVIDER_TEXT_CONTROL
            : SWEEP_EXECUTION_MODES.MOCK;
  const supabaseSigningOptions = {
    supabaseUrl: env.SUPABASE_URL,
    serviceKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
    signingTimeoutMs
  };
  const providerOptions = {
    apiKey: env.OPENAI_API_KEY,
    model: argValue(argv, "--model", "gpt-5.6-luna"),
    effort: argValue(argv, "--effort", "none"),
    imageDetail: argValue(argv, "--image-detail", "high"),
    providerTimeoutMs
  };
  const signAsset = providerDirectPresigned
    ? createSupabaseSigningRequester(supabaseSigningOptions)
    : null;
  const requestCard = real
    ? createDirectEndpointRequester({ endpoint, authorization, timeoutMs: endpointTimeoutMs })
    : providerDirect
      ? createDirectProviderRequester({
        ...supabaseSigningOptions,
        ...providerOptions
      })
      : signingOnly
        ? createSupabaseSigningRequester(supabaseSigningOptions)
        : providerDirectPresigned
          ? createPresignedProviderRequester(providerOptions)
          : providerTextControl
            ? createProviderTextControlRequester(providerOptions)
            : createMockRequester();
  // The production endpoint currently has a minute-window limiter. Independent
  // levels need independent windows; otherwise a fast c2 run consumes c4's
  // budget and manufactures a false concurrency regression.
  const cooldownMs = Math.max(0, Number(argValue(argv, "--cooldown-ms", real ? 61_000 : 0)) || 0);
  const requestTimeoutsMs = real
    ? { endpoint: endpointTimeoutMs }
    : signingOnly
      ? { image_signing: signingTimeoutMs }
      : (providerDirect || providerDirectPresigned)
        ? { image_signing: signingTimeoutMs, openai_provider: providerTimeoutMs }
        : providerTextControl
          ? { openai_provider: providerTimeoutMs }
          : null;
  const pricing = {
    inputUsdPerMillion: argValue(argv, "--input-usd-per-million", env.CSM_INPUT_USD_PER_1M),
    outputUsdPerMillion: argValue(argv, "--output-usd-per-million", env.CSM_OUTPUT_USD_PER_1M)
  };
  const report = providerDirectPresigned
    ? await runPresignedProviderSweep({
      assets,
      levels,
      signAsset,
      requestCard,
      preflightConcurrency,
      requestTimeoutsMs,
      cooldownMs,
      pricing
    })
    : await runConcurrencySweep({
      assets,
      levels,
      requestCard,
      executionMode,
      requestTimeoutsMs,
      cooldownMs,
      pricing
    });
  const output = `${JSON.stringify(report, null, 2)}\n`;
  const outPath = argValue(argv, "--out");
  if (outPath) await writeFile(outPath, output);
  process.stdout.write(output);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
