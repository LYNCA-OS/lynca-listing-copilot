#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { supabaseServiceHeaders } from "../lib/supabase-service-headers.mjs";
import {
  CSM_RETIRED_RUNTIME_DISABLE_FLAGS,
  CSM_RETIRED_RUNTIME_FLAGS,
  CSM_THIN_RUNTIME_CONTRACT,
  csmRetiredCapabilitiesDisabled,
  enabledExactly
} from "../lib/listing/thin/csm-runtime-contract.mjs";
import {
  checkCsmPersistenceReadiness,
  isCsmPersistenceConfigured
} from "../lib/listing/thin/csm-supabase-writer.mjs";
import {
  CSM_PROVIDER_AUTHORITY_LIMITS,
  CSM_PROVIDER_AUTHORITY_RPCS,
  CSM_PROVIDER_AUTHORITY_SCOPE
} from "../lib/listing/thin/csm-provider-admission-authority.mjs";

const LOOKUP_RPC = "lookup_csm_thin_provider_operation_v1";
const LOOKUP_HASH = "0".repeat(64);

function serviceKey(env) {
  return String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "").trim();
}

function readinessError(code, detail = null) {
  return Object.assign(new Error(detail ? `${code}:${detail}` : code), { code, detail });
}

export async function checkCsmThinProductionReadiness({
  env = process.env,
  fetchImpl = globalThis.fetch,
  requireProviderKey = true
} = {}) {
  if (!enabledExactly(env.CSM_PERSISTENCE_ENABLED)) {
    throw readinessError("csm_persistence_flag_disabled");
  }
  if (!isCsmPersistenceConfigured(env)) throw readinessError("csm_persistence_unconfigured");
  if (requireProviderKey && !String(env.OPENAI_API_KEY || "").trim()) {
    throw readinessError("luna_provider_unconfigured");
  }
  if (!csmRetiredCapabilitiesDisabled(env)) {
    const enabled = CSM_RETIRED_RUNTIME_FLAGS.filter((name) => enabledExactly(env[name]));
    const notDisabled = CSM_RETIRED_RUNTIME_DISABLE_FLAGS.filter(
      (name) => !enabledExactly(env[name])
    );
    throw readinessError(
      "retired_capability_enabled",
      [...enabled, ...notDisabled].join(",")
    );
  }

  const persistence = await checkCsmPersistenceReadiness({ env, fetchImpl });
  if (persistence.ready !== true) {
    throw readinessError("csm_persistence_not_ready", persistence.reason || "unknown");
  }

  const baseUrl = String(env.SUPABASE_URL).replace(/\/+$/, "");
  const response = await fetchImpl(`${baseUrl}/rest/v1/rpc/${LOOKUP_RPC}`, {
    method: "POST",
    headers: supabaseServiceHeaders(serviceKey(env), { "content-type": "application/json" }),
    body: JSON.stringify({
      p_tenant_id: "__csm_readiness__",
      p_operation_key: "__csm_readiness__",
      p_payload_sha256: LOOKUP_HASH
    })
  });
  const authority = await response.json().catch(() => null);
  if (!response.ok || authority?.ok !== true || authority?.code !== "not_found") {
    throw readinessError("csm_provider_authority_not_ready", String(response.status));
  }

  const pacerResponse = await fetchImpl(
    `${baseUrl}/rest/v1/rpc/${CSM_PROVIDER_AUTHORITY_RPCS.pacerReadiness}`,
    {
      method: "POST",
      headers: supabaseServiceHeaders(serviceKey(env), { "content-type": "application/json" }),
      body: JSON.stringify({
        p_provider: CSM_PROVIDER_AUTHORITY_SCOPE.provider,
        p_account_scope: CSM_PROVIDER_AUTHORITY_SCOPE.accountScope,
        p_model: CSM_PROVIDER_AUTHORITY_SCOPE.model
      })
    }
  );
  const pacer = await pacerResponse.json().catch(() => null);
  const pacerReady = pacerResponse.ok
    && pacer?.ok === true
    && pacer?.code === "pacer_ready"
    && Number(pacer.max_active) === CSM_PROVIDER_AUTHORITY_LIMITS.maximumActiveAttempts
    && Number(pacer.max_active_tokens) === CSM_PROVIDER_AUTHORITY_LIMITS.maximumActiveEstimatedTokens
    && Number(pacer.baseline_working_max_active)
      === CSM_PROVIDER_AUTHORITY_LIMITS.baselineWorkingActiveAttempts
    && Number(pacer.effective_max_active) >= 1
    && Number(pacer.effective_max_active)
      <= CSM_PROVIDER_AUTHORITY_LIMITS.baselineWorkingActiveAttempts
    && Number(pacer.pacer_tokens_per_second)
      === CSM_PROVIDER_AUTHORITY_LIMITS.pacerEstimatedTokensPerSecond
    && Number(pacer.pacer_burst_tokens)
      === CSM_PROVIDER_AUTHORITY_LIMITS.pacerBurstEstimatedTokens
    && Number(pacer.token_window_target)
      === CSM_PROVIDER_AUTHORITY_LIMITS.targetEstimatedTokensPerWindow
    && Number(pacer.token_window_hard_limit)
      === CSM_PROVIDER_AUTHORITY_LIMITS.hardTokensPerWindow;
  if (!pacerReady) {
    throw readinessError("csm_provider_pacer_not_ready", String(pacerResponse.status));
  }

  return Object.freeze({
    ok: true,
    active_path: CSM_THIN_RUNTIME_CONTRACT.route,
    model: CSM_THIN_RUNTIME_CONTRACT.model,
    reasoning_effort: CSM_THIN_RUNTIME_CONTRACT.reasoningEffort,
    provider_configuration_checked: requireProviderKey,
    csm_registry_and_atomic_persistence_ready: true,
    durable_provider_authority_ready: true,
    durable_provider_pacer_ready: true,
    retired_capabilities_disabled: true,
    cloud_run_calls: 0,
    vector_calls: 0,
    generic_ocr_calls: 0
  });
}

function outputPath(argv) {
  const index = argv.indexOf("--out");
  return index >= 0 ? String(argv[index + 1] || "").trim() : "";
}

async function main() {
  const result = await checkCsmThinProductionReadiness({
    requireProviderKey: !process.argv.slice(2).includes("--database-only")
  });
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  const destination = outputPath(process.argv.slice(2));
  if (destination) await writeFile(destination, serialized, { mode: 0o600 });
  process.stdout.write(serialized);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      code: error?.code || "csm_readiness_failed",
      // Only a phase/status contract label is emitted; no request headers or
      // response bodies are ever included in CI output.
      detail: error?.detail || null
    }));
    process.exitCode = 1;
  });
}
