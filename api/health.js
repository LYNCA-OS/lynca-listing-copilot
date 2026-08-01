import {
  CSM_PROVIDER_AUTHORITY_LIMITS
} from "../lib/listing/thin/csm-provider-admission-authority.mjs";
import {
  CSM_THIN_RUNTIME_CONTRACT,
  csmRetiredCapabilitiesDisabled,
  enabledExactly
} from "../lib/listing/thin/csm-runtime-contract.mjs";

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
  const providerConfigured = Boolean(String(process.env.OPENAI_API_KEY || "").trim());
  const retiredCapabilitiesDisabled = csmRetiredCapabilitiesDisabled(process.env);
  const ready = persistenceConfigured && providerConfigured && retiredCapabilitiesDisabled;

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
      git_commit_sha: process.env.VERCEL_GIT_COMMIT_SHA || null,
      environment: process.env.VERCEL_ENV || null
    },
    runtime: {
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
