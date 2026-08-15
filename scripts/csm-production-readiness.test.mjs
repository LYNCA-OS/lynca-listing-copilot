#!/usr/bin/env node

import assert from "node:assert/strict";

import { checkCsmThinProductionReadiness } from "./check-csm-thin-production-readiness.mjs";
import {
  CSM_PRODUCT_PROJECTION_READINESS_RPC,
  CSM_PRODUCT_PROJECTION_VERSION,
  THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_PAYLOAD_CONTRACT,
  THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_RELEASE_CONTRACT,
  THIN_EXTERNAL_IDENTITY_REGISTRY_PAYLOAD_CONTRACT,
  THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT,
  THIN_REGISTRY_RELEASE_CONTRACT,
  THIN_TCG_GRAMMAR_CONTEXT_REGISTRY_PAYLOAD_CONTRACT,
  THIN_TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE_CONTRACT
} from "../lib/listing/thin/csm-supabase-writer.mjs";
import {
  CSM_PROVIDER_AUTHORITY_LIMITS,
  CSM_PROVIDER_AUTHORITY_RPCS
} from "../lib/listing/thin/csm-provider-admission-authority.mjs";
import { CSM_THIN_RUNTIME_CONTRACT } from "../lib/listing/thin/csm-runtime-contract.mjs";
import {
  EXTERNAL_IDENTITY_RELEASE_CONTRACT,
  externalIdentityReleaseContractForRegistryRelease
} from "../lib/listing/knowledge/csm-external-identity-support.mjs";
import {
  CSM_PROJECTION_ACTIVATION,
  CSM_WRITER_PROJECTION_CONTRACTS
} from "../lib/listing/thin/csm-projection-activation.mjs";
import {
  TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE,
  TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT
} from "../lib/listing/thin/tcg-grammar-context-authority.mjs";

const ENV = {
  CSM_PERSISTENCE_ENABLED: "true",
  OPENAI_API_KEY: "sk-test-not-real",
  SUPABASE_URL: "https://project.example.test",
  SUPABASE_SECRET_KEY: "sb_secret_test_not_real",
  V4_QUEUE_PUMP_DISABLED: "true",
  ENABLE_RECOGNITION_WORKER: "false",
  ENABLE_PADDLE_OCR_FIELD_VERIFIER: "false",
  ENABLE_VISUAL_VECTOR_RETRIEVAL: "false"
};

function response(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function pacerReceipt(overrides = {}) {
  return {
    ok: true,
    code: "pacer_ready",
    max_active: CSM_PROVIDER_AUTHORITY_LIMITS.maximumActiveAttempts,
    max_active_tokens: CSM_PROVIDER_AUTHORITY_LIMITS.maximumActiveEstimatedTokens,
    baseline_working_max_active: CSM_PROVIDER_AUTHORITY_LIMITS.baselineWorkingActiveAttempts,
    effective_max_active: CSM_PROVIDER_AUTHORITY_LIMITS.baselineWorkingActiveAttempts,
    pacer_tokens_per_second: CSM_PROVIDER_AUTHORITY_LIMITS.pacerEstimatedTokensPerSecond,
    pacer_burst_tokens: CSM_PROVIDER_AUTHORITY_LIMITS.pacerBurstEstimatedTokens,
    token_window_target: CSM_PROVIDER_AUTHORITY_LIMITS.targetEstimatedTokensPerWindow,
    token_window_hard_limit: CSM_PROVIDER_AUTHORITY_LIMITS.hardTokensPerWindow,
    ...overrides
  };
}

const calls = [];
const fetchImpl = async (url, init = {}) => {
  const parsed = new URL(String(url));
  calls.push({ pathname: parsed.pathname, init });
  if (parsed.pathname.endsWith("/csm_registry_releases")) {
    return response([
      {
        ...THIN_REGISTRY_RELEASE_CONTRACT,
        registry_payload: { mode: "local_sem_and_composer_only", external_catalog: false }
      },
      {
        ...THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT,
        registry_payload: THIN_EXTERNAL_IDENTITY_REGISTRY_PAYLOAD_CONTRACT
      },
      {
        ...THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_RELEASE_CONTRACT,
        registry_payload: THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_PAYLOAD_CONTRACT
      },
      {
        ...THIN_TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE_CONTRACT,
        registry_payload: THIN_TCG_GRAMMAR_CONTEXT_REGISTRY_PAYLOAD_CONTRACT
      }
    ]);
  }
  if (parsed.pathname.endsWith("/persist_csm_stage_packet_v1")) {
    return response({ ok: false, code: "missing_csm_stage_row_identity" });
  }
  if (parsed.pathname.endsWith("/listing_assets")) return response([]);
  if (parsed.pathname.endsWith("/csm_resolution_reviews")) return response([]);
  if (parsed.pathname.endsWith(`/${CSM_PRODUCT_PROJECTION_READINESS_RPC}`)) {
    return response({
      ok: true,
      code: "csm_product_projection_ready",
      version: CSM_PRODUCT_PROJECTION_VERSION
    });
  }
  if (parsed.pathname.endsWith("/lookup_csm_thin_provider_operation_v1")) {
    return response({ ok: true, code: "not_found", found: false });
  }
  if (parsed.pathname.endsWith(`/${CSM_PROVIDER_AUTHORITY_RPCS.lookupByKey}`)) {
    return response({
      ok: true,
      code: "not_found",
      status_code: 200,
      found: false
    });
  }
  if (parsed.pathname.endsWith("/check_csm_thin_provider_pacer_v1")) {
    return response(pacerReceipt());
  }
  throw new Error(`unexpected_request:${parsed.pathname}`);
};

function fetchWithPacer(overrides, observedScopes = []) {
  return async (url, init = {}) => {
    if (String(url).endsWith("/check_csm_thin_provider_pacer_v1")) {
      observedScopes.push(JSON.parse(init.body));
      return response(pacerReceipt(overrides));
    }
    return fetchImpl(url, init);
  };
}

function fetchWithExternalRegistryPayload(registryPayload) {
  return async (url, init = {}) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith("/csm_registry_releases")) {
      return response([
        {
          ...THIN_REGISTRY_RELEASE_CONTRACT,
          registry_payload: { mode: "local_sem_and_composer_only", external_catalog: false }
        },
        {
          ...THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT,
          registry_payload: registryPayload
        },
        {
          ...THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_RELEASE_CONTRACT,
          registry_payload: THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_PAYLOAD_CONTRACT
        },
        {
          ...THIN_TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE_CONTRACT,
          registry_payload: THIN_TCG_GRAMMAR_CONTEXT_REGISTRY_PAYLOAD_CONTRACT
        }
      ]);
    }
    return fetchImpl(url, init);
  };
}

function fetchWithForwardRegistryPayload(registryPayload) {
  return async (url, init = {}) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith("/csm_registry_releases")) {
      return response([
        {
          ...THIN_REGISTRY_RELEASE_CONTRACT,
          registry_payload: { mode: "local_sem_and_composer_only", external_catalog: false }
        },
        {
          ...THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT,
          registry_payload: THIN_EXTERNAL_IDENTITY_REGISTRY_PAYLOAD_CONTRACT
        },
        {
          ...THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_RELEASE_CONTRACT,
          registry_payload: registryPayload
        },
        {
          ...THIN_TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE_CONTRACT,
          registry_payload: THIN_TCG_GRAMMAR_CONTEXT_REGISTRY_PAYLOAD_CONTRACT
        }
      ]);
    }
    return fetchImpl(url, init);
  };
}

function fetchWithTcgGrammarContextRegistryPayload(registryPayload) {
  return async (url, init = {}) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith("/csm_registry_releases")) {
      return response([
        {
          ...THIN_REGISTRY_RELEASE_CONTRACT,
          registry_payload: { mode: "local_sem_and_composer_only", external_catalog: false }
        },
        {
          ...THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT,
          registry_payload: THIN_EXTERNAL_IDENTITY_REGISTRY_PAYLOAD_CONTRACT
        },
        {
          ...THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_RELEASE_CONTRACT,
          registry_payload: THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_PAYLOAD_CONTRACT
        },
        {
          ...THIN_TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE_CONTRACT,
          registry_payload: registryPayload
        }
      ]);
    }
    return fetchImpl(url, init);
  };
}

const ready = await checkCsmThinProductionReadiness({ env: ENV, fetchImpl });
const activeExternalIdentityRelease = externalIdentityReleaseContractForRegistryRelease(
  CSM_PROJECTION_ACTIVATION.active_writer.external_identity.registry_release_id
);
assert.equal(ready.ok, true);
assert.equal(ready.active_path, "CSM_THIN_DIRECT");
assert.equal(ready.model, "gpt-5.6-luna");
// `low` since 2026-08-03 (founder). Asserted against the runtime contract so
// the readiness probe and the endpoint can never disagree about the tier.
assert.equal(ready.reasoning_effort, CSM_THIN_RUNTIME_CONTRACT.reasoningEffort);
assert.deepEqual(ready.external_identity, activeExternalIdentityRelease,
  "database readiness must attest the same external identity release advertised by health");
assert.deepEqual(ready.tcg_grammar_context, {
  registry_release_id: TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.release_id,
  registry_content_sha256: TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.content_sha256,
  resolution_contract_sha256: TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT.contract_sha256
}, "readiness evidence must identify the exact dormant-or-active Grammar authority row");
assert.deepEqual(
  externalIdentityReleaseContractForRegistryRelease(
    CSM_WRITER_PROJECTION_CONTRACTS.rollback_compatible.external_identity.registry_release_id
  ),
  EXTERNAL_IDENTITY_RELEASE_CONTRACT,
  "the b159 rollback writer keeps its frozen external-v2 readiness oracle"
);
assert.deepEqual(calls.map(({ pathname }) => pathname), [
  "/rest/v1/csm_registry_releases",
  "/rest/v1/rpc/persist_csm_stage_packet_v1",
  `/rest/v1/rpc/${CSM_PRODUCT_PROJECTION_READINESS_RPC}`,
  "/rest/v1/csm_resolution_reviews",
  "/rest/v1/listing_assets",
  "/rest/v1/rpc/lookup_csm_thin_provider_operation_v1",
  `/rest/v1/rpc/${CSM_PROVIDER_AUTHORITY_RPCS.lookupByKey}`,
  "/rest/v1/rpc/check_csm_thin_provider_pacer_v1"
]);
assert.ok(calls.every(({ init }) => init.headers.apikey === ENV.SUPABASE_SECRET_KEY));
assert.equal(ready.listing_asset_owner_ready, true);
assert.equal(ready.durable_provider_operation_key_recovery_ready, true);
for (const fakeCounter of ["cloud_run_calls", "vector_calls", "generic_ocr_calls"]) {
  assert.equal(Object.hasOwn(ready, fakeCounter), false,
    `${fakeCounter} must not masquerade as a measured runtime counter`);
}
const operationKeyRecoveryCall = calls.find(({ pathname }) => (
  pathname.endsWith(`/${CSM_PROVIDER_AUTHORITY_RPCS.lookupByKey}`)
));
assert.deepEqual(JSON.parse(operationKeyRecoveryCall.init.body), {
  p_tenant_id: "__csm_readiness__",
  p_operation_key: "__csm_readiness__"
});

for (const field of ["pack_id", "pack_version", "index_id"]) {
  await assert.rejects(
    checkCsmThinProductionReadiness({
      env: ENV,
      fetchImpl: fetchWithExternalRegistryPayload({
        ...THIN_EXTERNAL_IDENTITY_REGISTRY_PAYLOAD_CONTRACT,
        [field]: `${THIN_EXTERNAL_IDENTITY_REGISTRY_PAYLOAD_CONTRACT[field]}-drift`
      })
    }),
    (error) => error.code === "csm_persistence_not_ready"
      && error.detail === "registry_release_contract_mismatch",
    `database readiness must fail closed when external identity ${field} drifts`
  );
}

await assert.rejects(
  checkCsmThinProductionReadiness({
    env: ENV,
    fetchImpl: fetchWithExternalRegistryPayload({
      ...THIN_EXTERNAL_IDENTITY_REGISTRY_PAYLOAD_CONTRACT,
      unrecognized_future_control: true
    })
  }),
  (error) => error.code === "csm_persistence_not_ready"
    && error.detail === "registry_release_contract_mismatch",
  "database readiness must reject extra external identity Registry payload keys"
);

await assert.rejects(
  checkCsmThinProductionReadiness({
    env: ENV,
    fetchImpl: fetchWithForwardRegistryPayload({
      ...THIN_EXTERNAL_IDENTITY_FORWARD_REGISTRY_PAYLOAD_CONTRACT,
      resolution_contract_sha256: "0".repeat(64)
    })
  }),
  (error) => error.code === "csm_persistence_not_ready"
    && error.detail === "registry_release_contract_mismatch",
  "database readiness must fail closed when the v3 forward-reader row drifts"
);

await assert.rejects(
  checkCsmThinProductionReadiness({
    env: ENV,
    fetchImpl: fetchWithTcgGrammarContextRegistryPayload({
      ...THIN_TCG_GRAMMAR_CONTEXT_REGISTRY_PAYLOAD_CONTRACT,
      resolution_contract_sha256: "0".repeat(64)
    })
  }),
  (error) => error.code === "csm_persistence_not_ready"
    && error.detail === "registry_release_contract_mismatch",
  "database readiness must fail closed when the v4 Grammar registry row drifts"
);

const databaseOnlyScopes = [];
const databaseOnlyReady = await checkCsmThinProductionReadiness({
  env: { ...ENV, OPENAI_API_KEY: "" },
  fetchImpl: fetchWithPacer({}, databaseOnlyScopes),
  requireProviderKey: false
});
assert.equal(databaseOnlyReady.ok, true);
assert.equal(databaseOnlyReady.provider_configuration_checked, false);
assert.deepEqual(databaseOnlyScopes, [{
  p_provider: "openai",
  p_account_scope: "lynca-primary",
  p_model: "gpt-5.6-luna"
}], "database-only readiness must retain the exact Production scope");

for (const pacer_burst_tokens of [65_200, 65_999, 66_001]) {
  await assert.rejects(
    checkCsmThinProductionReadiness({
      env: { ...ENV, OPENAI_API_KEY: "" },
      fetchImpl: fetchWithPacer({ pacer_burst_tokens }),
      requireProviderKey: false
    }),
    (error) => error.code === "csm_provider_pacer_not_ready",
    `database-only readiness must reject non-contract burst ${pacer_burst_tokens}`
  );
}

await assert.rejects(
  checkCsmThinProductionReadiness({
    env: { ...ENV, OPENAI_API_KEY: "" },
    fetchImpl: fetchWithPacer({
      pacer_burst_tokens: 66_000,
      max_active_tokens: CSM_PROVIDER_AUTHORITY_LIMITS.maximumActiveEstimatedTokens - 1
    }),
    requireProviderKey: false
  }),
  (error) => error.code === "csm_provider_pacer_not_ready",
  "the exact burst contract must not relax another database limit"
);

await assert.rejects(
  checkCsmThinProductionReadiness({
    env: ENV,
    fetchImpl: async (url, init) => {
      if (String(url).includes("/listing_assets?")) return response({ code: "42703" }, 400);
      return fetchImpl(url, init);
    }
  }),
  (error) => error.code === "listing_asset_owner_not_ready"
);

await assert.rejects(
  checkCsmThinProductionReadiness({
    env: ENV,
    fetchImpl: async (url, init) => {
      if (String(url).includes("/csm_resolution_reviews?")) {
        return response({ code: "42703" }, 400);
      }
      return fetchImpl(url, init);
    }
  }),
  (error) => error.code === "csm_persistence_not_ready"
    && error.detail === "review_measurement_schema_probe_400",
  "Production readiness must fail before deployment when review v2 columns are absent"
);

await assert.rejects(
  checkCsmThinProductionReadiness({
    env: ENV,
    fetchImpl: async (url, init) => {
      if (String(url).endsWith(`/${CSM_PRODUCT_PROJECTION_READINESS_RPC}`)) {
        return response({
          ok: false,
          code: "csm_product_projection_not_ready",
          version: CSM_PRODUCT_PROJECTION_VERSION
        });
      }
      return fetchImpl(url, init);
    }
  }),
  (error) => error.code === "csm_persistence_not_ready"
    && /product_projection_probe_contract_mismatch/.test(error.message)
);
await assert.rejects(
  checkCsmThinProductionReadiness({
    env: { ...ENV, ENABLE_PADDLE_OCR_FIELD_VERIFIER: "true" }, fetchImpl
  }),
  (error) => error.code === "retired_capability_enabled"
    && /ENABLE_PADDLE_OCR_FIELD_VERIFIER/.test(error.message)
);
await assert.rejects(
  checkCsmThinProductionReadiness({
    env: { ...ENV, V4_QUEUE_PUMP_DISABLED: "false" }, fetchImpl
  }),
  (error) => error.code === "retired_capability_enabled"
    && /V4_QUEUE_PUMP_DISABLED/.test(error.message)
);
await assert.rejects(
  checkCsmThinProductionReadiness({
    env: { ...ENV, CSM_PERSISTENCE_ENABLED: "false" }, fetchImpl
  }),
  (error) => error.code === "csm_persistence_flag_disabled"
);
await assert.rejects(
  checkCsmThinProductionReadiness({ env: { ...ENV, OPENAI_API_KEY: "" }, fetchImpl }),
  (error) => error.code === "luna_provider_unconfigured"
);
await assert.rejects(
  checkCsmThinProductionReadiness({
    env: ENV,
    fetchImpl: async (url, init) => {
      if (String(url).endsWith("/check_csm_thin_provider_pacer_v1")) {
        return response({ ok: true, code: "pacer_ready", baseline_working_max_active: 120 });
      }
      return fetchImpl(url, init);
    }
  }),
  (error) => error.code === "csm_provider_pacer_not_ready"
);

await assert.rejects(
  checkCsmThinProductionReadiness({
    env: ENV,
    fetchImpl: async (url, init) => {
      if (String(url).endsWith(`/${CSM_PROVIDER_AUTHORITY_RPCS.lookupByKey}`)) {
        return response({ code: "PGRST202" }, 404);
      }
      return fetchImpl(url, init);
    }
  }),
  (error) => error.code === "csm_provider_operation_key_recovery_not_ready"
);

const validOperationKeyRecoveryReceipt = {
  ok: true,
  code: "not_found",
  status_code: 200,
  found: false
};
for (const invalidReceipt of [
  { ...validOperationKeyRecoveryReceipt, code: "found_non_success" },
  { ...validOperationKeyRecoveryReceipt, status_code: 201 },
  { ...validOperationKeyRecoveryReceipt, found: true },
  { ...validOperationKeyRecoveryReceipt, payload_sha256: "0".repeat(64) },
  { ...validOperationKeyRecoveryReceipt, result: {} }
]) {
  await assert.rejects(
    checkCsmThinProductionReadiness({
      env: ENV,
      fetchImpl: async (url, init) => {
        if (String(url).endsWith(`/${CSM_PROVIDER_AUTHORITY_RPCS.lookupByKey}`)) {
          return response(invalidReceipt);
        }
        return fetchImpl(url, init);
      }
    }),
    (error) => error.code === "csm_provider_operation_key_recovery_not_ready"
  );
}

console.log("CSM production readiness tests passed");
