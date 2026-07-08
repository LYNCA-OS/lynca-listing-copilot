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
  keySlot = null
} = {}) {
  return {
    event: "openai_provider_request_diagnostics",
    provider,
    model_id: modelId || null,
    phase,
    attempt: Number.isFinite(Number(attempt)) ? Number(attempt) : null,
    provider_key_pool_size: Number.isFinite(Number(keyPoolSize)) ? Number(keyPoolSize) : 0,
    provider_key_slot: Number.isFinite(Number(keySlot)) ? Number(keySlot) : null,
    "x-ratelimit-limit-requests": rateLimitDiagnostics["x-ratelimit-limit-requests"] || null,
    "x-ratelimit-remaining-requests": rateLimitDiagnostics["x-ratelimit-remaining-requests"] || null,
    "x-ratelimit-limit-tokens": rateLimitDiagnostics["x-ratelimit-limit-tokens"] || null,
    "x-ratelimit-remaining-tokens": rateLimitDiagnostics["x-ratelimit-remaining-tokens"] || null,
    "x-ratelimit-reset-requests": rateLimitDiagnostics["x-ratelimit-reset-requests"] || null,
    "x-ratelimit-reset-tokens": rateLimitDiagnostics["x-ratelimit-reset-tokens"] || null,
    input_tokens: Number.isFinite(Number(tokenDiagnostics.input_tokens)) ? Number(tokenDiagnostics.input_tokens) : null,
    output_tokens: Number.isFinite(Number(tokenDiagnostics.output_tokens)) ? Number(tokenDiagnostics.output_tokens) : null,
    provider_latency_ms: Number.isFinite(Number(providerLatencyMs)) ? Number(providerLatencyMs) : null,
    response_status: responseStatus || tokenDiagnostics.response_status || null
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
