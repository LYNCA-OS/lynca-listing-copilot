export const LUNA_EXPLICIT_CACHE_PREREGISTRATION = Object.freeze({
  id: "luna-explicit-cache-prereg-2026-08-09-v1",
  registered_at: "2026-08-09",
  evidence_scope: "CACHE_TRANSPORT_ONLY_NO_ACCURACY_OR_PROMOTION_CLAIM",
  provider_calls_if_authorized: 3,
  provider_calls_currently_allowed: 0,
  provider_retries: 0,
  execution_authorized_by_default: false,
  paid_execution_state: "HOLD_DURABLE_SINGLE_USE_AUTHORITY_REQUIRED",
  durable_single_use_authority_required: true,
  durable_single_use_authority_available: false,
  production_enabled: false,
  sequence: Object.freeze([
    "same_card_cold",
    "same_card_warm",
    "cross_card_warm"
  ]),
  frozen_contract: Object.freeze({
    screen_version: "luna-explicit-cache-screen-v1",
    cache_policy_id: "openai-gpt-5.6-explicit-prefix-cache-v1",
    cache_policy_sha256: "4bd24b43ac143df254b25bfc9ced1528a55ff60f08e71e7c74fc4612010877ac",
    cache_transport_shape_sha256: "61297aab9318fc4c86dd97dd348df1c17661c140325e8664f2ea9a0f86050143",
    semantic_step_contract_sha256: "f0cc3cd6298f3b0c03d1e7a0aff97f60ab95220ac53f66f9ff11501cfbc72a4b",
    stable_prefix_sha256: "f14c18ceb882c8ad47aa946cb728690deac368405ccbf5465a7f5eadf9990f9b",
    semantic_contract_sha256: "63045a2ed07f90f7221ba9e1a226eae53f40ff63ce986c287dee694566aa249d",
    prompt_sha256: "fa248c5cd3b0f52bfa3554bbe96d4a84d80de94f6cc3e003494e09d75793efc7",
    schema_sha256: "ec1f0851a88c41a73858fc657cc6f7611d030b3fdaf08ae9e0d390fde5be3197",
    model: "gpt-5.6-luna",
    reasoning_effort: "low",
    image_detail: "high",
    max_output_tokens: 8192
  }),
  hard_gates: Object.freeze({
    production_semantic_request_equal_after_cache_strip: true,
    minimum_cacheable_prefix_tokens: 1024,
    cold_cached_tokens: 0,
    cold_cache_write_tokens_minimum: 1024,
    same_card_cached_tokens_minimum: 1024,
    same_card_cache_write_tokens: 0,
    cross_card_cached_tokens_minimum: 1024,
    cross_card_cache_write_tokens: 0,
    provider_failures: 0,
    request_failures: 0,
    missing_usage_receipt_policy: "STOP",
    provider_transport_failure_policy: "AMBIGUOUS_PROVIDER_OUTCOME_NO_RETRY",
    exact_preview_identity_binding: Object.freeze([
      "environment",
      "region",
      "deployment_id",
      "deployment_hostname",
      "release_git_sha"
    ]),
    any_failed_gate_policy: "STOP_BEFORE_NEXT_REQUEST"
  })
});

export function assertLunaExplicitCachePreregisteredContract(actual) {
  if (JSON.stringify(actual) !== JSON.stringify(
    LUNA_EXPLICIT_CACHE_PREREGISTRATION.frozen_contract
  )) {
    throw new Error("luna_explicit_cache_contract_not_preregistered");
  }
  return true;
}
