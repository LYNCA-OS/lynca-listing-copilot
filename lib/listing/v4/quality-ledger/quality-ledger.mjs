import { v4SchemaVersion } from "../schema/version.mjs";

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function buildV4QualityLedger({
  sessionId,
  result = {},
  routePlan = {},
  persistence = {}
} = {}) {
  const tokenDiagnostics = result.provider_token_diagnostics || result.provider_usage || {};
  const timing = result.timing || result.timings || {};
  return {
    id: `${sessionId}_quality`,
    recognition_session_id: sessionId,
    schema_version: v4SchemaVersion,
    route: routePlan.route || null,
    provider: result.provider || result.provider_id || "openai",
    model: result.model || result.model_id || result.provider_model || null,
    status: result.confidence === "FAILED" ? "FAILED" : "DRAFT_READY",
    latency_ms: numberOrNull(timing.total_ms ?? result.total_ms ?? result.latency_ms),
    input_tokens: numberOrNull(tokenDiagnostics.input_tokens ?? tokenDiagnostics.prompt_tokens),
    output_tokens: numberOrNull(tokenDiagnostics.output_tokens ?? tokenDiagnostics.completion_tokens),
    total_tokens: numberOrNull(tokenDiagnostics.total_tokens),
    provider_error_type: result.provider_error_type || result.provider_error_code || null,
    v4_pipeline_contract: result.v4_pipeline_contract || null,
    route_plan: routePlan,
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
    persistence_summary: persistence
  };
}
