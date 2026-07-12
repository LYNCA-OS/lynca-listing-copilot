// Provider result metadata shaping — extracted from the v2 monolith
// (docs/REFORM_PLAN.md R1, step "provider stage"). Copied verbatim and
// delegated; behavior must stay bit-identical.
import { providerMetadata } from "../providers/provider-contract.mjs";

export function withProviderMetadata(result, providerResult, selection) {
  const providerId = providerResult.provider || selection?.provider_id || result.source;

  return {
    ...result,
    ...providerMetadata({
      provider: providerId,
      modelId: providerResult.model_id || selection?.model_id
    }),
    source: providerId,
    provider_response_id: providerResult.response_id || null,
    provider_finish_reason: providerResult.finish_reason || null,
    provider_parse_source: providerResult.parse_source || null,
    provider_response_profile: providerResult.response_profile || "standard",
    provider_image_detail: providerResult.image_detail || "high",
    provider_text_verbosity: providerResult.text_verbosity || null,
    provider_latency_ms: providerResult.latency_ms ?? null,
    provider_recognition_status: providerResult.recognition_status || providerResult.parsed?.recognition_status || null,
    provider_error_type: providerResult.error_type || providerResult.parsed?.error_type || null,
    provider_token_diagnostics: providerResult.token_diagnostics || null,
    provider_initial_token_diagnostics: providerResult.initial_token_diagnostics || null,
    provider_rate_limit_diagnostics: providerResult.rate_limit_diagnostics || null,
    provider_initial_rate_limit_diagnostics: providerResult.initial_rate_limit_diagnostics || null,
    provider_request_diagnostics: providerResult.provider_request_diagnostics || null,
    provider_initial_request_diagnostics: providerResult.provider_initial_request_diagnostics || null,
    provider_key_pool_size: Number(providerResult.provider_key_pool_size || 0) || null,
    provider_key_slot: Number(providerResult.provider_key_slot || 0) || null,
    provider_key_source: providerResult.provider_key_source || null,
    provider_key_rotation_attempted: providerResult.provider_key_rotation_attempted === true,
    provider_key_rotation_attempts: Number(providerResult.provider_key_rotation_attempts || 0),
    provider_transient_retry_attempted: providerResult.transient_retry_attempted === true,
    provider_transient_retry_attempts: Number(providerResult.transient_retry_attempts || 0),
    provider_truncation_retry_attempted: providerResult.truncation_retry_attempted === true,
    provider_truncation_retry_attempts: Number(providerResult.truncation_retry_attempts || 0),
    format_error_type: providerResult.format_error_type || null,
    format_repair_attempted: providerResult.format_repair_attempted === true,
    local_json_repair_success: providerResult.local_json_repair_success === true,
    text_repair_success: providerResult.text_repair_success === true,
    native_schema_valid: providerResult.native_schema_valid === true,
    fallback_provider_id: providerResult.fallback_provider_id || null,
    fallback_reason: providerResult.fallback_reason || null,
    usage: providerResult.usage || null,
    explicit_emergency: Boolean(selection?.explicit_emergency)
  };
}

export function safeProviderDiagnostics(details = {}) {
  if (!details || typeof details !== "object") return undefined;
  const allowedKeys = [
    "format_error_type",
    "format_repair_attempted",
    "local_json_repair_success",
    "text_repair_success",
    "native_schema_valid",
    "token_diagnostics",
    "initial_token_diagnostics",
    "transient_retry_attempted",
    "transient_retry_attempts",
    "truncation_retry_attempted",
    "truncation_retry_attempts",
    "empty_retry_attempted",
    "empty_retry_attempts",
    "request_summary",
    "schema_errors",
    "local_repair_error",
    "text_repair_error"
  ];
  const output = {};
  allowedKeys.forEach((key) => {
    if (details[key] !== undefined) output[key] = details[key];
  });
  return Object.keys(output).length ? output : undefined;
}

export function mergeUsage(providerUsage, completionUsage, {
  providerCalls = 0
} = {}) {
  const base = providerUsage && typeof providerUsage === "object" && !Array.isArray(providerUsage)
    ? providerUsage
    : {};
  const baseProviderCalls = Number.isFinite(Number(base.provider_calls))
    ? Number(base.provider_calls)
    : providerCalls;

  return {
    ...base,
    provider_calls: baseProviderCalls + Number(completionUsage?.provider_calls || 0),
    retrieval_calls: Number(base.retrieval_calls || 0) + Number(completionUsage?.retrieval_calls || 0),
    latency_ms: Number(base.latency_ms || 0) + Number(completionUsage?.latency_ms || 0),
    estimated_cost_usd: Number(base.estimated_cost_usd || 0) + Number(completionUsage?.estimated_cost_usd || 0),
    resolution_rounds: Number(base.resolution_rounds || 0) + Number(completionUsage?.resolution_rounds || 0)
  };
}
