const rateLimitHeaderNames = Object.freeze([
  "x-ratelimit-limit-requests",
  "x-ratelimit-remaining-requests",
  "x-ratelimit-limit-tokens",
  "x-ratelimit-remaining-tokens",
  "x-ratelimit-reset-requests",
  "x-ratelimit-reset-tokens"
]);

function cleanText(value) {
  return String(value ?? "").trim();
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") {
    const value = headers.get(name);
    return value === null || value === undefined ? null : cleanText(value);
  }
  const lower = String(name || "").toLowerCase();
  const value = headers[name] ?? headers[lower];
  if (Array.isArray(value)) return cleanText(value[0]);
  return value === null || value === undefined ? null : cleanText(value);
}

function optionalNumber(value, { min = Number.NEGATIVE_INFINITY } = {}) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min ? number : null;
}

function compactContext(context = {}) {
  const allowed = [
    "job_id",
    "job_type",
    "lane",
    "recognition_session_id",
    "asset_id",
    "worker_id",
    "title_stage",
    "provider_call_purpose",
    "v4_force_l2_direct",
    "disable_fast_scout_l1",
    "v4_queue_l1_only"
  ];
  return Object.fromEntries(allowed
    .map((key) => [key, context?.[key]])
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
    .map(([key, value]) => [key, typeof value === "boolean" ? value : String(value).slice(0, 160)]));
}

export function openAiRateLimitDiagnostics(headers) {
  return Object.fromEntries(rateLimitHeaderNames.map((name) => [
    name,
    headerValue(headers, name)
  ]));
}

export function openAiProviderRequestDiagnostics({
  provider = "openai_legacy",
  modelId = "",
  phase = "request",
  attempt = 1,
  responseStatus = "",
  tokenDiagnostics = {},
  rateLimitDiagnostics = {},
  providerLatencyMs = null,
  keyPoolSize = 0,
  keySlot = null,
  requestContext = {}
} = {}) {
  return {
    event: "openai_provider_request_diagnostics",
    provider,
    model_id: modelId || null,
    phase,
    attempt: Number.isFinite(Number(attempt)) ? Number(attempt) : null,
    provider_key_pool_size: Number.isFinite(Number(keyPoolSize)) ? Number(keyPoolSize) : 0,
    provider_key_slot: optionalNumber(keySlot, { min: 1 }),
    "x-ratelimit-limit-requests": rateLimitDiagnostics["x-ratelimit-limit-requests"] || null,
    "x-ratelimit-remaining-requests": rateLimitDiagnostics["x-ratelimit-remaining-requests"] || null,
    "x-ratelimit-limit-tokens": rateLimitDiagnostics["x-ratelimit-limit-tokens"] || null,
    "x-ratelimit-remaining-tokens": rateLimitDiagnostics["x-ratelimit-remaining-tokens"] || null,
    "x-ratelimit-reset-requests": rateLimitDiagnostics["x-ratelimit-reset-requests"] || null,
    "x-ratelimit-reset-tokens": rateLimitDiagnostics["x-ratelimit-reset-tokens"] || null,
    input_tokens: optionalNumber(tokenDiagnostics.input_tokens, { min: 0 }),
    output_tokens: optionalNumber(tokenDiagnostics.output_tokens, { min: 0 }),
    requested_output_cap: optionalNumber(tokenDiagnostics.requested_output_cap, { min: 1 }),
    output_cap: optionalNumber(tokenDiagnostics.output_cap, { min: 1 }),
    model_output_token_cap: optionalNumber(tokenDiagnostics.model_output_token_cap, { min: 1 }),
    output_cap_clamped: typeof tokenDiagnostics.output_cap_clamped === "boolean" ? tokenDiagnostics.output_cap_clamped : null,
    provider_latency_ms: optionalNumber(providerLatencyMs, { min: 0 }),
    response_status: responseStatus || tokenDiagnostics.response_status || null,
    ...compactContext(requestContext)
  };
}

export function logOpenAiProviderRequestDiagnostics(diagnostics = {}, logger = console) {
  const output = diagnostics.event === "openai_provider_request_diagnostics"
    ? diagnostics
    : openAiProviderRequestDiagnostics(diagnostics);
  const logLine = JSON.stringify(output);
  if (typeof logger?.info === "function") {
    logger.info("[openai_provider_request_diagnostics]", logLine);
  } else if (typeof logger?.log === "function") {
    logger.log("[openai_provider_request_diagnostics]", logLine);
  }
  return output;
}
