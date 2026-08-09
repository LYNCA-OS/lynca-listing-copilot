import {
  CSM_PROVIDER_AUTHORITY_LIMITS
} from "../lib/listing/thin/csm-provider-admission-authority.mjs";
import {
  CSM_THIN_RUNTIME_CONTRACT,
  csmRetiredCapabilitiesDisabled,
  enabledExactly
} from "../lib/listing/thin/csm-runtime-contract.mjs";
import {
  csmExecutionContractImageUrls,
  compileCsmModelExecution,
  CSM_ACTIVE_MODEL_PROFILE
} from "../lib/listing/thin/csm-model-execution-contract.mjs";
import { resolveCsmProviderAdapter } from "../lib/listing/thin/csm-provider-adapter.mjs";
import {
  CSM_STAGED_TRANSPORT_PROFILE
} from "../lib/listing/thin/staged-recognition-input.mjs";

const activeExecution = compileCsmModelExecution({
  imageUrls: csmExecutionContractImageUrls(1)
});
const activeExecutionContractSha256ByImageCount = Object.freeze(Object.fromEntries(
  [1, 2].map((count) => [String(count), compileCsmModelExecution({
    imageUrls: csmExecutionContractImageUrls(count)
  }).execution_contract_sha256])
));
const activeProviderAdapter = resolveCsmProviderAdapter(CSM_ACTIVE_MODEL_PROFILE.provider);

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, message: "Method not allowed" }));
    return;
  }

  const persistenceConfigured = enabledExactly(process.env.CSM_PERSISTENCE_ENABLED)
    && Boolean(String(process.env.SUPABASE_URL || "").trim())
    && Boolean(String(
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || ""
    ).trim());
  const providerConfigured = activeProviderAdapter.configured(process.env);
  const retiredCapabilitiesDisabled = csmRetiredCapabilitiesDisabled(process.env);
  const ready = persistenceConfigured && providerConfigured && retiredCapabilitiesDisabled;
  const releaseGitSha = String(
    process.env.LYNCA_RELEASE_GIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || ""
  ).trim() || null;
  const releaseGitRef = String(
    process.env.LYNCA_RELEASE_GIT_REF || process.env.VERCEL_GIT_COMMIT_REF || ""
  ).trim() || null;

  // Liveness stays 200 so operators can distinguish a running deployment
  // from a configured-and-ready one. Release gates must assert `ready=true`.
  res.statusCode = 200;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify({
    ok: true,
    ready,
    service: "lynca-listing-copilot",
    active_path: CSM_THIN_RUNTIME_CONTRACT.route,
    model: CSM_THIN_RUNTIME_CONTRACT.model,
    reasoning_effort: CSM_THIN_RUNTIME_CONTRACT.reasoningEffort,
    deployment: {
      git_commit_sha: releaseGitSha,
      git_commit_ref: releaseGitRef,
      environment: process.env.VERCEL_ENV || null
    },
    runtime: {
      model_profile_id: CSM_ACTIVE_MODEL_PROFILE.id,
      optimization_pack: {
        id: activeExecution.execution_contract.optimization_pack_id,
        sha256: activeExecution.execution_contract.optimization_pack_sha256
      },
      provider_adapter_version: activeProviderAdapter.contract.id,
      request_builder_version: activeProviderAdapter.contract.request_builder_version,
      execution_contract_sha256_by_image_count: activeExecutionContractSha256ByImageCount,
      max_output_tokens: CSM_ACTIVE_MODEL_PROFILE.max_output_tokens,
      provider_timeout_ms: CSM_ACTIVE_MODEL_PROFILE.provider_timeout_ms,
      transport_profile: CSM_STAGED_TRANSPORT_PROFILE,
      persistence_configured: persistenceConfigured,
      provider_configured: providerConfigured,
      retired_capabilities_disabled: retiredCapabilitiesDisabled,
      cloud_run_calls: 0,
      vector_calls: 0,
      generic_ocr_calls: 0
    },
    capacity: {
      scheduler_attempt_slots: CSM_PROVIDER_AUTHORITY_LIMITS.maximumActiveAttempts,
      maximum_active_estimated_tokens: CSM_PROVIDER_AUTHORITY_LIMITS.maximumActiveEstimatedTokens,
      baseline_working_attempts: CSM_PROVIDER_AUTHORITY_LIMITS.baselineWorkingActiveAttempts,
      pacer_estimated_tokens_per_second: CSM_PROVIDER_AUTHORITY_LIMITS.pacerEstimatedTokensPerSecond,
      pacer_burst_estimated_tokens: CSM_PROVIDER_AUTHORITY_LIMITS.pacerBurstEstimatedTokens,
      estimated_tokens_per_attempt: CSM_THIN_RUNTIME_CONTRACT.estimatedTokensPerAttempt,
      steady_reserved_attempts_per_minute: Math.floor(
        CSM_PROVIDER_AUTHORITY_LIMITS.pacerEstimatedTokensPerSecond * 60
          / CSM_THIN_RUNTIME_CONTRACT.estimatedTokensPerAttempt
      ),
      effective_reserved_attempt_ceiling: Math.floor(
        CSM_PROVIDER_AUTHORITY_LIMITS.maximumActiveEstimatedTokens
          / CSM_THIN_RUNTIME_CONTRACT.estimatedTokensPerAttempt
      )
    },
    timestamp: new Date().toISOString()
  }));
}
