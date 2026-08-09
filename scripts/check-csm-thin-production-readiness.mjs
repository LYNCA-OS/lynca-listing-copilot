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
  CSM_PROVIDER_AUTHORITY_RPCS,
  CSM_PROVIDER_AUTHORITY_SCOPE,
  csmProviderPacerReadinessMatches
} from "../lib/listing/thin/csm-provider-admission-authority.mjs";

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
  // The application reads and writes durable ownership before allowing
  // assigned-scope recovery. Probe the deployed schema explicitly so a code
  // release cannot get ahead of its additive database migration.
  const assetOwnerResponse = await fetchImpl(
    `${baseUrl}/rest/v1/listing_assets?select=owner_user_id&limit=0`,
    {
      headers: supabaseServiceHeaders(serviceKey(env)),
      redirect: "error"
    }
  );
  if (!assetOwnerResponse.ok) {
    throw readinessError("listing_asset_owner_not_ready", String(assetOwnerResponse.status));
  }
  const response = await fetchImpl(
    `${baseUrl}/rest/v1/rpc/${CSM_PROVIDER_AUTHORITY_RPCS.lookup}`,
    {
      method: "POST",
      headers: supabaseServiceHeaders(serviceKey(env), { "content-type": "application/json" }),
      redirect: "error",
      body: JSON.stringify({
        p_tenant_id: "__csm_readiness__",
        p_operation_key: "__csm_readiness__",
        p_payload_sha256: LOOKUP_HASH
      })
    }
  );
  const authority = await response.json().catch(() => null);
  if (!response.ok || authority?.ok !== true || authority?.code !== "not_found") {
    throw readinessError("csm_provider_authority_not_ready", String(response.status));
  }

  const operationKeyRecoveryResponse = await fetchImpl(
    `${baseUrl}/rest/v1/rpc/${CSM_PROVIDER_AUTHORITY_RPCS.lookupByKey}`,
    {
      method: "POST",
      headers: supabaseServiceHeaders(serviceKey(env), { "content-type": "application/json" }),
      redirect: "error",
      body: JSON.stringify({
        p_tenant_id: "__csm_readiness__",
        p_operation_key: "__csm_readiness__"
      })
    }
  );
  const operationKeyRecovery = await operationKeyRecoveryResponse.json().catch(() => null);
  if (!operationKeyRecoveryResponse.ok
      || operationKeyRecovery?.ok !== true
      || operationKeyRecovery?.code !== "not_found"
      || Number(operationKeyRecovery?.status_code) !== 200
      || operationKeyRecovery?.found !== false
      || Object.hasOwn(operationKeyRecovery || {}, "payload_sha256")
      || Object.hasOwn(operationKeyRecovery || {}, "result")) {
    throw readinessError(
      "csm_provider_operation_key_recovery_not_ready",
      String(operationKeyRecoveryResponse.status)
    );
  }

  const pacerResponse = await fetchImpl(
    `${baseUrl}/rest/v1/rpc/${CSM_PROVIDER_AUTHORITY_RPCS.pacerReadiness}`,
    {
      method: "POST",
      headers: supabaseServiceHeaders(serviceKey(env), { "content-type": "application/json" }),
      redirect: "error",
      body: JSON.stringify({
        p_provider: CSM_PROVIDER_AUTHORITY_SCOPE.provider,
        p_account_scope: CSM_PROVIDER_AUTHORITY_SCOPE.accountScope,
        p_model: CSM_PROVIDER_AUTHORITY_SCOPE.model
      })
    }
  );
  const pacer = await pacerResponse.json().catch(() => null);
  const pacerReady = pacerResponse.ok && csmProviderPacerReadinessMatches(pacer);
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
    listing_asset_owner_ready: true,
    durable_provider_authority_ready: true,
    durable_provider_operation_key_recovery_ready: true,
    durable_provider_pacer_ready: true,
    retired_capabilities_disabled: true
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
