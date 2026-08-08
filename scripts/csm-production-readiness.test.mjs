#!/usr/bin/env node

import assert from "node:assert/strict";

import { checkCsmThinProductionReadiness } from "./check-csm-thin-production-readiness.mjs";
import {
  CSM_PRODUCT_PROJECTION_READINESS_RPC,
  CSM_PRODUCT_PROJECTION_VERSION,
  THIN_REGISTRY_RELEASE_CONTRACT
} from "../lib/listing/thin/csm-supabase-writer.mjs";
import { CSM_PROVIDER_AUTHORITY_LIMITS } from "../lib/listing/thin/csm-provider-admission-authority.mjs";
import { CSM_THIN_RUNTIME_CONTRACT } from "../lib/listing/thin/csm-runtime-contract.mjs";

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

const calls = [];
const fetchImpl = async (url, init = {}) => {
  const parsed = new URL(String(url));
  calls.push({ pathname: parsed.pathname, init });
  if (parsed.pathname.endsWith("/csm_registry_releases")) {
    return response([{
      ...THIN_REGISTRY_RELEASE_CONTRACT,
      registry_payload: { mode: "local_sem_and_composer_only", external_catalog: false }
    }]);
  }
  if (parsed.pathname.endsWith("/persist_csm_stage_packet_v1")) {
    return response({ ok: false, code: "missing_csm_stage_row_identity" });
  }
  if (parsed.pathname.endsWith("/listing_assets")) return response([]);
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
  if (parsed.pathname.endsWith("/check_csm_thin_provider_pacer_v1")) {
    return response({
      ok: true,
      code: "pacer_ready",
      max_active: CSM_PROVIDER_AUTHORITY_LIMITS.maximumActiveAttempts,
      max_active_tokens: CSM_PROVIDER_AUTHORITY_LIMITS.maximumActiveEstimatedTokens,
      baseline_working_max_active: CSM_PROVIDER_AUTHORITY_LIMITS.baselineWorkingActiveAttempts,
      effective_max_active: CSM_PROVIDER_AUTHORITY_LIMITS.baselineWorkingActiveAttempts,
      pacer_tokens_per_second: CSM_PROVIDER_AUTHORITY_LIMITS.pacerEstimatedTokensPerSecond,
      pacer_burst_tokens: CSM_PROVIDER_AUTHORITY_LIMITS.pacerBurstEstimatedTokens,
      token_window_target: CSM_PROVIDER_AUTHORITY_LIMITS.targetEstimatedTokensPerWindow,
      token_window_hard_limit: CSM_PROVIDER_AUTHORITY_LIMITS.hardTokensPerWindow
    });
  }
  throw new Error(`unexpected_request:${parsed.pathname}`);
};

const ready = await checkCsmThinProductionReadiness({ env: ENV, fetchImpl });
assert.equal(ready.ok, true);
assert.equal(ready.active_path, "CSM_THIN_DIRECT");
assert.equal(ready.model, "gpt-5.6-luna");
// `low` since 2026-08-03 (founder). Asserted against the runtime contract so
// the readiness probe and the endpoint can never disagree about the tier.
assert.equal(ready.reasoning_effort, CSM_THIN_RUNTIME_CONTRACT.reasoningEffort);
assert.deepEqual(calls.map(({ pathname }) => pathname), [
  "/rest/v1/csm_registry_releases",
  "/rest/v1/rpc/persist_csm_stage_packet_v1",
  `/rest/v1/rpc/${CSM_PRODUCT_PROJECTION_READINESS_RPC}`,
  "/rest/v1/listing_assets",
  "/rest/v1/rpc/lookup_csm_thin_provider_operation_v1",
  "/rest/v1/rpc/check_csm_thin_provider_pacer_v1"
]);
assert.ok(calls.every(({ init }) => init.headers.apikey === ENV.SUPABASE_SECRET_KEY));
assert.equal(ready.listing_asset_owner_ready, true);

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

console.log("CSM production readiness tests passed");
