import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { CSM_THIN_RUNTIME_CONTRACT } from "../lib/listing/thin/csm-runtime-contract.mjs";
import { readFile, readdir } from "node:fs/promises";
import { buildAccuracyLossLedger } from "../lib/listing/thin/accuracy-loss-ledger.mjs";

import {
  CSM_DIRECT_ESTIMATED_TOKENS,
  CSM_DIRECT_CLAIM_POLL_MS,
  CSM_DIRECT_CLAIM_TIMEOUT_MS,
  CSM_DIRECT_LOCAL_FALLBACK_CONCURRENCY,
  CSM_DIRECT_MAX_ATTEMPTS,
  CSM_DIRECT_PROVIDER_TIMEOUT_MS,
  CSM_PERSISTENCE_READINESS_CACHE_TTL_MS,
  CSM_DIRECT_PROMPT_VERSION,
  CSM_PERSISTENCE_CHECKPOINT_DERIVED_VERSION,
  CSM_PERSISTENCE_CHECKPOINT_DERIVED_VERIFIED_ORIGINAL_VERSION,
  CSM_PERSISTENCE_CHECKPOINT_ORDINARY_EXECUTION_VERSION,
  CSM_PERSISTENCE_CHECKPOINT_ORDINARY_EXECUTION_VERIFIED_ORIGINAL_VERSION,
  CSM_PERSISTENCE_CHECKPOINT_VERSION,
  buildProviderFailureReceipt,
  buildCsmDirectFailureResponse,
  buildCsmPersistenceCheckpoint,
  checkCsmDirectPreSpendReadiness,
  checkCachedCsmPersistenceReadiness,
  createResponsesProviderCaller,
  deterministicProviderClientRequestId,
  deterministicCsmSessionId,
  resetCsmPersistenceReadinessCache,
  runDirectCsmAsset,
  selectCsmPostObservationResolutionContract,
  publicPersistedResult,
  validateCsmPersistenceCheckpoint
} from "../api/csm-listing-title.js";
import {
  buildLegacyCurrentLunaDirectPayloadHash,
  buildLegacyLowLunaDirectPayloadHash,
  buildLunaDirectOperationKey,
  buildLunaDirectPayloadHash
} from "../lib/listing/thin/luna-direct-dispatcher.mjs";
import {
  buildCsmModelExecutionContract,
  buildCsmModelExecutionContractSha256,
  buildCsmModelProfile,
  csmExecutionContractImageUrls,
  CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
  CSM_ACTIVE_MODEL_PROFILE,
  CSM_NEUTRAL_PROMPT_STYLE_VERSION,
  CSM_ORIGINAL_INLINE_TRANSPORT_PROFILE,
  CSM_STAGED_TRANSPORT_PROFILE,
  sha256ExecutionContractValue
} from "../lib/listing/thin/csm-model-execution-contract.mjs";
import { resolveCsmProviderAdapter } from "../lib/listing/thin/csm-provider-adapter.mjs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeCanonicalFieldsForStoredOutput } from "../lib/listing/thin/csm-replay.mjs";
import { finishCanonicalFields } from "../lib/listing/thin/thin-listing-path.mjs";
import * as providerResponseAttestation from "../lib/listing/thin/provider-response-attestation.mjs";
import { buildCsmIngestFailureResponse } from "../api/csm-listing-title-ingest.js";
import {
  computePostObservationResolutionContractSha256,
  EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY,
  EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID,
  EXTERNAL_IDENTITY_RESOLUTION_CONTRACT,
  EXTERNAL_IDENTITY_SUPPORT_PACK,
  resolveExternalIdentitySupport
} from "../lib/listing/knowledge/csm-external-identity-support.mjs";
import {
  STAGED_RECOGNITION_LANE_VERSION,
  bindStagedSessionToVerifiedCanonical
} from "../lib/listing/thin/staged-recognition-input.mjs";
import {
  CSM_SESSION_SCHEMA_VERSION,
  buildCsmRecognitionSessionRow,
  createCsmRecognitionSession
} from "../lib/listing/thin/csm-session-store.mjs";
import {
  CSM_PRODUCT_PROJECTION_READINESS_RPC,
  CSM_PRODUCT_PROJECTION_VERSION,
  THIN_EXTERNAL_IDENTITY_REGISTRY_PAYLOAD_CONTRACT,
  THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT,
  THIN_REGISTRY_RELEASE_CONTRACT
} from "../lib/listing/thin/csm-supabase-writer.mjs";
import {
  buildCsmStageRows,
  computeCsmPacketHashes,
  CSM_STAGE_LEGACY_CONTRACT_VERSION,
  EBAY_PROFILE_VERSION,
  THIN_COMPOSER_VERSION_V2
} from "../lib/listing/thin/csm-persistence.mjs";
import {
  CSM_PROJECTION_ACTIVATION
} from "../lib/listing/thin/csm-projection-activation.mjs";
import {
  composeLyncaStandardNameForProfile,
  LYNCA_STANDARD_PROFILE_VERSION_V2
} from "../lib/listing/thin/canonical-naming-adapter.mjs";
import {
  COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT,
  resolveVerifiedOriginalObservation,
  VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID
} from "../lib/listing/thin/verified-original-observation-support.mjs";
import {
  WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT
} from "./materialize-writer-journey-source.mjs";
import {
  CSM_PROVIDER_AUTHORITY_LIMITS,
  CSM_PROVIDER_AUTHORITY_RECEIPT_VERSION,
  CSM_PROVIDER_AUTHORITY_RPCS
} from "../lib/listing/thin/csm-provider-admission-authority.mjs";
import {
  configuredInternalServiceSecret,
  internalServiceSecretHeader,
  isInternalServiceRequest
} from "../lib/internal-service-auth.mjs";
import { readSupabaseRows } from "../lib/supabase-rest.mjs";

const source = await readFile(new URL("../api/csm-listing-title.js", import.meta.url), "utf8");
const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
assert.deepEqual(Object.keys(providerResponseAttestation).sort(), [
  "providerReasoningEffortReceipt",
  "providerResponseAttestation",
  "providerUsageReceipt"
], "provider response attestation must expose only live receipt normalizers");

// Archived de55 bytes remain selected by their stored v2/eBay tuple, while a
// fresh default write must project Activation A. Neither proof consults a
// mutable current tuple for the historical arm.
{
  const fields = parseCanonicalFields({
    year: "2025",
    manufacturer: "Topps",
    product: "Chrome",
    set: "",
    subjects: ["Victor Wembanyama"],
    team: "Spurs",
    card_name: "",
    release_variant: "",
    surface_color: "Gold",
    parallel_family: "Refractor",
    parallel_exact: "",
    descriptive_rarity: "",
    card_number: "221",
    serial: "17/50",
    attributes: ["RC"],
    grading_info: {
      company: "PSA", card_grade: "9", auto_grade: "10",
      grade_type: "CARD_AND_AUTO"
    },
    grammar: "standard",
    lot_count: "",
    language: "",
    ip: "",
    unreadable: [],
    low_confidence: []
  }).fields;
  const storedV2 = composeCanonicalFieldsForStoredOutput(fields, {
    composer_version: THIN_COMPOSER_VERSION_V2,
    marketplace_profile_version: EBAY_PROFILE_VERSION,
    marketplace: "EBAY"
  });
  const historical = {
    title: storedV2.title,
    fields,
    field_defects: [],
    unreadable_fields: storedV2.unreadable,
    low_confidence_fields: storedV2.low_confidence,
    grammar: storedV2.grammar,
    brackets: storedV2.brackets,
    dropped_brackets: storedV2.dropped,
    suppressed_brackets: storedV2.suppressed,
    restored_brackets: storedV2.restored,
    truncated: storedV2.truncated,
    input_empty_fields: storedV2.input_empty_fields,
    normalization_reasons: storedV2.normalization_reasons,
    character_budget: storedV2.character_budget,
    length: storedV2.length,
    composer_version: THIN_COMPOSER_VERSION_V2,
    marketplace_profile_version: EBAY_PROFILE_VERSION
  };
  const historicalRows = buildCsmStageRows({
    tenantId: "tenant-byte-probe",
    recognitionSessionId: "session-byte-probe-plain",
    fields,
    composed: historical,
    title: historical.title,
    contractVersion: CSM_STAGE_LEGACY_CONTRACT_VERSION
  });
  assert.equal(
    createHash("sha256").update(JSON.stringify(publicPersistedResult({
      ...historical,
      csm_rows: historicalRows
    }))).digest("hex"),
    "d81a24258f96b6a083dff3bd3053babe1f69dec8e9e1c8ed4f3d60f630258bbd",
    "the complete dormant v2 public result must remain byte-identical to de55"
  );
  const active = finishCanonicalFields(fields);
  const historicalActive = { ...active };
  delete historicalActive.publication_coverage;
  const activeRows = buildCsmStageRows({
    tenantId: "tenant-byte-probe",
    recognitionSessionId: "session-byte-probe-plain",
    fields: active.fields,
    composed: historicalActive,
    title: active.title,
    contractVersion: CSM_STAGE_LEGACY_CONTRACT_VERSION
  });
  assert.equal(
    createHash("sha256").update(JSON.stringify(publicPersistedResult({
      ...active,
      csm_rows: activeRows
    }))).digest("hex"),
    "096e2bc743311f788f6eec817c110694eb6f4c817ab57844c236ca2241edbc32",
    "the complete active CNL v0.2 public result must remain byte-identical"
  );
}
const CURRENT_DIRECT_EXECUTION_SHA256 = buildCsmModelExecutionContractSha256({
  model: CSM_THIN_RUNTIME_CONTRACT.model,
  requestedEffort: CSM_THIN_RUNTIME_CONTRACT.reasoningEffort,
  imageDetail: "high",
  semanticPromptVersion: CSM_DIRECT_PROMPT_VERSION,
  transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
  imageUrls: csmExecutionContractImageUrls(1)
});
const CURRENT_STAGED_EXECUTION_SHA256 = buildCsmModelExecutionContractSha256({
  model: CSM_THIN_RUNTIME_CONTRACT.model,
  requestedEffort: CSM_THIN_RUNTIME_CONTRACT.reasoningEffort,
  imageDetail: "high",
  semanticPromptVersion: CSM_DIRECT_PROMPT_VERSION,
  transportProfile: CSM_STAGED_TRANSPORT_PROFILE,
  imageUrls: csmExecutionContractImageUrls(1)
});
const CURRENT_ORIGINAL_INLINE_EXECUTION_SHA256 = buildCsmModelExecutionContractSha256({
  model: CSM_THIN_RUNTIME_CONTRACT.model,
  requestedEffort: CSM_THIN_RUNTIME_CONTRACT.reasoningEffort,
  imageDetail: "high",
  semanticPromptVersion: CSM_DIRECT_PROMPT_VERSION,
  transportProfile: CSM_ORIGINAL_INLINE_TRANSPORT_PROFILE,
  imageUrls: csmExecutionContractImageUrls(1)
});

async function readModuleTree(directory) {
  const modules = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) modules.push(...await readModuleTree(target));
    else if (entry.name.endsWith(".mjs") || entry.name.endsWith(".js")) {
      modules.push({ file: target.pathname, source: await readFile(target, "utf8") });
    }
  }
  return modules;
}

async function readLocalDependencyClosure(entry) {
  const modules = new Map();
  const visit = async (target) => {
    if (modules.has(target.href)) return;
    const moduleSource = await readFile(target, "utf8");
    modules.set(target.href, { file: target.pathname, source: moduleSource });
    const specifiers = [
      ...moduleSource.matchAll(/\b(?:import|export)\s+(?:[^;]*?\sfrom\s+)?["'](\.{1,2}\/[^"']+)["']/g),
      ...moduleSource.matchAll(/\bimport\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)
    ].map((match) => match[1]);
    for (const specifier of new Set(specifiers)) {
      await visit(new URL(specifier, target));
    }
  };
  await visit(entry);
  return [...modules.values()];
}

assert.doesNotMatch(source, /from\s+["'][^"']*(?:listing-job|recognition-worker|vector)[^"']*["']/i,
  "the direct CSM endpoint must not import or invoke queue, Cloud Run worker, or vector paths");
for (const module of [
  { file: "api/csm-listing-title.js", source },
  ...await readModuleTree(new URL("../lib/listing/thin/", import.meta.url))
]) {
  assert.doesNotMatch(
    module.source,
    /(?:from\s+|import\s*\()\s*["'][^"']*(?:listing\/v4|\/v4\/|\.\.\/v4\/)[^"']*["']/,
    `${module.file} must not import the retired V4 code path`
  );
}
const activeDependencyClosure = await readLocalDependencyClosure(
  new URL("../api/csm-listing-title.js", import.meta.url)
);
assert.deepEqual(
  activeDependencyClosure
    .map(({ file }) => file)
    .filter((file) => file.includes("/lib/listing/v4/")),
  [],
  "the active CSM endpoint's transitive local dependency graph must not enter the retired V4 tree"
);
assert.doesNotMatch(source, /cloud_run_calls|vector_calls|generic_ocr_calls/,
  "static zero counters must not masquerade as runtime probes");
assert.doesNotMatch(source, /buildLegacy(?:Current|Low)LunaDirectPayloadHash/,
  "portable recovery must not enumerate a finite set of historical profile hashes");
assert.match(source, /lookupOperationResultByKey/,
  "ordinary payload conflicts must recover through the stable tenant operation identity");
assert.match(source, /publicPersistedResult\(settled, executionOrigin, canonicalAssetId\)/,
  "an exact direct replay must return the tenant-scoped canonical asset identity");
assert.match(source, /publicPersistedResult\(persistedWithLatency, executionOrigin, canonicalAssetId\)/,
  "a fresh direct result must return the tenant-scoped canonical asset identity");
for (const transportOwner of [
  /api\.openai\.com/,
  /OPENAI_API_KEY/,
  /lynca_operation_sha256/,
  /lynca_payload_sha256/,
  /authorization:\s*`Bearer/
]) {
  assert.doesNotMatch(source, transportOwner,
    "provider endpoint, auth and dispatch envelope must live in the resolved adapter");
}
assert.match(source, /providerCaller \|\|= createResponsesProviderCaller\(/,
  "the paid production path must use the single exported provider caller seam");
assert.equal([...source.matchAll(/activeProviderAdapter\.createCaller\(/g)].length, 1,
  "only createResponsesProviderCaller may invoke the active adapter caller");
assert.equal(vercel.functions["api/csm-listing-title.js"].maxDuration, 300);
assert.deepEqual(vercel.regions, ["sin1"]);
for (const functionPath of [
  "api/csm-listing-title.js",
  "api/listing-asset-create.js",
  "api/listing-image-upload-url.js",
  "api/listing-image-verify-upload.js"
]) {
  assert.deepEqual(vercel.functions[functionPath].regions, ["sin1"]);
}
assert.equal(CSM_DIRECT_LOCAL_FALLBACK_CONCURRENCY, 6);
assert.equal(CSM_DIRECT_CLAIM_POLL_MS, 1_000);
assert.equal(CSM_DIRECT_CLAIM_TIMEOUT_MS, 145_000);
assert.equal(CSM_DIRECT_PROVIDER_TIMEOUT_MS, 120_000);
assert.equal(CSM_DIRECT_MAX_ATTEMPTS, 3);
assert.equal(CSM_DIRECT_ESTIMATED_TOKENS, 6_500);
assert.match(CSM_DIRECT_PROMPT_VERSION, /^csm-canonical-fields-v\d+$/);
assert.equal(CSM_PERSISTENCE_READINESS_CACHE_TTL_MS, 30_000);
assert.equal(deterministicCsmSessionId("operation-a"), deterministicCsmSessionId("operation-a"));
assert.notEqual(deterministicCsmSessionId("operation-a"), deterministicCsmSessionId("operation-b"));

{
  const malformedProviderResponse = Object.assign(
    new Error("canonical_path_provider_contract_failed: invalid_json"),
    {
      status: 502,
      statusCode: 502,
      provider_attempt_started: true,
      definitive_response: true,
      retryable: false,
      provider_error_code: "invalid_json"
    }
  );
  const failure = buildCsmDirectFailureResponse(malformedProviderResponse);
  assert.equal(failure.status, 502);
  assert.equal(failure.body.retryable, false,
    "an explicit definitive failure must not be reopened by the handler's 5xx default");
  assert.equal(failure.body.route, "CSM_THIN_DIRECT");
  assert.equal(Object.hasOwn(failure.body, "cloud_run_calls"), false);
  assert.equal(Object.hasOwn(failure.body, "vector_calls"), false);
  assert.equal(failure.body.provider_failure_receipt.outcome, "definitive_response");
  assert.equal(failure.body.latency_stages_ms !== undefined, true,
    "the existing receipt body is preserved without a fallback route or second request");

  assert.equal(buildCsmDirectFailureResponse(Object.assign(new Error("unknown"), {
    statusCode: 503
  })).body.retryable, true, "unclassified 5xx failures retain the safe default");
  assert.equal(buildCsmDirectFailureResponse(Object.assign(new Error("explicit"), {
    statusCode: 400, retryable: true
  })).body.retryable, true, "an explicit retryable classification remains authoritative");

  assert.equal(buildCsmIngestFailureResponse(malformedProviderResponse).body.retryable, false,
    "ingest must preserve an explicit definitive failure instead of reopening direct fallback");
  assert.equal(buildCsmIngestFailureResponse(Object.assign(new Error("unknown"), {
    statusCode: 503
  })).body.retryable, true, "an unclassified ingest 503 retains the safe retry default");
  assert.equal(buildCsmIngestFailureResponse(Object.assign(new Error("explicit"), {
    statusCode: 400, retryable: true
  })).body.retryable, true, "an explicit retryable ingest classification remains authoritative");
  const stagedFailure = buildCsmIngestFailureResponse(Object.assign(new Error("response_lost"), {
    statusCode: 503,
    staged_resume_checkpoint_available: true
  }), { stagedResumeReceipt: `stgr_${"a".repeat(64)}` });
  assert.equal(stagedFailure.body.recovery_action, "STAGED_RESUME_ONLY");
  assert.equal(stagedFailure.body.staged_resume_receipt, `stgr_${"a".repeat(64)}`);
  const stagedPreProviderFailure = buildCsmIngestFailureResponse(Object.assign(new Error("readiness"), {
    statusCode: 503,
    provider_attempt_started: false,
    recovery_action: "STAGED_FRESH_RETRY"
  }), { stagedResumeReceipt: `stgr_${"a".repeat(64)}` });
  assert.equal(stagedPreProviderFailure.body.recovery_action, "STAGED_FRESH_RETRY");
  assert.equal(stagedPreProviderFailure.body.provider_attempt_started, false);
  assert.equal(stagedPreProviderFailure.body.staged_resume_receipt, undefined,
    "a pre-provider failure must not claim that a durable checkpoint exists");
  const claimedPreProviderFailure = buildCsmIngestFailureResponse(Object.assign(new Error("claim_failed"), {
    statusCode: 503,
    provider_attempt_started: false,
    retryable: true
  }), { stagedResumeReceipt: `stgr_${"a".repeat(64)}` });
  assert.equal(claimedPreProviderFailure.body.recovery_action, undefined,
    "a generic pre-request failure may already own a FAILED authority operation and must not loop as fresh");
  const stagedIdentityDrift = buildCsmIngestFailureResponse(Object.assign(
    new Error("staged_verified_original_identity_mismatch"),
    { statusCode: 409, retryable: false, recovery_action: "STAGED_RESUME_ONLY" }
  ), { stagedResumeReceipt: `stgr_${"a".repeat(64)}` });
  assert.equal(stagedIdentityDrift.status, 409);
  assert.equal(stagedIdentityDrift.body.retryable, true);
  assert.equal(stagedIdentityDrift.body.recovery_action, "INPUT_REBIND",
    "verified original drift must move to a new immutable asset, not resume the old checkpoint");
  assert.equal(stagedIdentityDrift.body.staged_resume_receipt, undefined);
}

{
  const receipt = buildProviderFailureReceipt({
    provider_attempt_started: true,
    ambiguous: false,
    status: 400,
    provider_request_id: "req-provider-400",
    provider_client_request_id: "lynca-client-400",
    provider_error_code: "invalid_image",
    provider_error_type: "invalid_request_error",
    provider_error_param: "input[0].content[1]",
    provider_ms: 12_345,
    latency_stages_ms: { signed_url_ms: 220, provider_ms: 12_345, unsafe: "drop" }
  });
  assert.deepEqual(receipt, {
    schema_version: "csm-provider-failure-receipt-v1",
    stage: "provider_attempt",
    outcome: "definitive_response",
    http_status: 400,
    provider_request_id: "req-provider-400",
    provider_client_request_id: "lynca-client-400",
    provider_error_code: "invalid_image",
    provider_error_type: "invalid_request_error",
    provider_error_param: "input[0].content[1]",
    provider_ms: 12_345,
    latency_stages_ms: { signed_url_ms: 220, provider_ms: 12_345 }
  });
  assert.equal(buildProviderFailureReceipt({ provider_attempt_started: false }), null);
}

{
  resetCsmPersistenceReadinessCache();
  let clockMs = 1_000;
  let persistenceProbes = 0;
  let providerProbes = 0;
  const checkReadiness = () => checkCsmDirectPreSpendReadiness({
    checkPersistence: async () => ({ ready: ++persistenceProbes > 0 }),
    checkProviderAuthority: async () => ({ ready: ++providerProbes > 0 })
  });
  const options = {
    env: { SUPABASE_URL: "https://project.supabase.co", CSM_PERSISTENCE_ENABLED: "1" },
    checkReadiness,
    now: () => clockMs
  };
  const burst = await Promise.all(Array.from({ length: 120 }, () => (
    checkCachedCsmPersistenceReadiness(options)
  )));
  assert.equal(persistenceProbes, 1, "one warm instance must coalesce persistence readiness");
  assert.equal(providerProbes, 1, "one warm instance must coalesce authority/pacer readiness");
  assert.ok(burst.every((item) => item.ready === true));
  clockMs += CSM_PERSISTENCE_READINESS_CACHE_TTL_MS + 1;
  await checkCachedCsmPersistenceReadiness(options);
  assert.equal(persistenceProbes, 2, "persistence must be revalidated after the short TTL");
  assert.equal(providerProbes, 2, "authority/pacer must be revalidated after the short TTL");

  resetCsmPersistenceReadinessCache();
  let pacerProbes = 0;
  const failThenHeal = () => checkCsmDirectPreSpendReadiness({
    checkPersistence: async () => ({ ready: true }),
    checkProviderAuthority: async () => ({
      ready: ++pacerProbes > 1,
      reason: "provider_pacer_probe_contract_mismatch"
    })
  });
  assert.equal((await checkCachedCsmPersistenceReadiness({
    ...options, checkReadiness: failThenHeal
  })).ready, false);
  assert.equal((await checkCachedCsmPersistenceReadiness({
    ...options, checkReadiness: failThenHeal
  })).ready, true);
  assert.equal(pacerProbes, 2, "a failed pacer probe must not be cached and must heal immediately");
  resetCsmPersistenceReadinessCache();
}

// The default cached preflight is the integration boundary: seven global
// probes are shared by the whole warm-instance burst, a stale pacer fails
// closed, and fixing it is visible immediately because failures are uncached.
{
  resetCsmPersistenceReadinessCache();
  let clockMs = 10_000;
  let pacerReady = true;
  const calls = [];
  const env = {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_test",
    CSM_PERSISTENCE_ENABLED: "true"
  };
  const fetchImpl = async (url) => {
    const pathname = new URL(String(url)).pathname;
    calls.push(pathname);
    if (pathname.endsWith("/csm_registry_releases")) {
      return new Response(JSON.stringify([
        {
          ...THIN_REGISTRY_RELEASE_CONTRACT,
          registry_payload: { mode: "local_sem_and_composer_only", external_catalog: false }
        },
        {
          ...THIN_EXTERNAL_IDENTITY_REGISTRY_RELEASE_CONTRACT,
          registry_payload: THIN_EXTERNAL_IDENTITY_REGISTRY_PAYLOAD_CONTRACT
        }
      ]));
    }
    if (pathname.endsWith("/csm_resolution_reviews")) {
      return new Response(JSON.stringify([]));
    }
    if (pathname.endsWith("/persist_csm_stage_packet_v1")) {
      return new Response(JSON.stringify({ code: "missing_csm_stage_row_identity" }));
    }
    if (pathname.endsWith(`/${CSM_PRODUCT_PROJECTION_READINESS_RPC}`)) {
      return new Response(JSON.stringify({
        ok: true,
        code: "csm_product_projection_ready",
        version: CSM_PRODUCT_PROJECTION_VERSION
      }));
    }
    if (pathname.endsWith(`/${CSM_PROVIDER_AUTHORITY_RPCS.lookup}`)) {
      return new Response(JSON.stringify({ ok: true, code: "not_found", found: false }));
    }
    if (pathname.endsWith(`/${CSM_PROVIDER_AUTHORITY_RPCS.lookupByKey}`)) {
      return new Response(JSON.stringify({
        ok: true, code: "not_found", status_code: 200, found: false
      }));
    }
    if (pathname.endsWith(`/${CSM_PROVIDER_AUTHORITY_RPCS.pacerReadiness}`)) {
      return new Response(JSON.stringify({
        ok: true,
        code: "pacer_ready",
        max_active: CSM_PROVIDER_AUTHORITY_LIMITS.maximumActiveAttempts,
        max_active_tokens: CSM_PROVIDER_AUTHORITY_LIMITS.maximumActiveEstimatedTokens,
        baseline_working_max_active: pacerReady
          ? CSM_PROVIDER_AUTHORITY_LIMITS.baselineWorkingActiveAttempts
          : CSM_PROVIDER_AUTHORITY_LIMITS.maximumActiveAttempts,
        effective_max_active: CSM_PROVIDER_AUTHORITY_LIMITS.baselineWorkingActiveAttempts,
        pacer_tokens_per_second: CSM_PROVIDER_AUTHORITY_LIMITS.pacerEstimatedTokensPerSecond,
        pacer_burst_tokens: CSM_PROVIDER_AUTHORITY_LIMITS.pacerBurstEstimatedTokens,
        token_window_target: CSM_PROVIDER_AUTHORITY_LIMITS.targetEstimatedTokensPerWindow,
        token_window_hard_limit: CSM_PROVIDER_AUTHORITY_LIMITS.hardTokensPerWindow
      }));
    }
    throw new Error(`unexpected_readiness_probe:${pathname}`);
  };
  const options = { env, fetchImpl, now: () => clockMs };
  const burst = await Promise.all(Array.from({ length: 120 }, () => (
    checkCachedCsmPersistenceReadiness(options)
  )));
  assert.ok(burst.every(({ ready }) => ready === true));
  assert.equal(calls.length, 7, "120 cards must share one seven-probe pre-spend receipt");
  await checkCachedCsmPersistenceReadiness(options);
  assert.equal(calls.length, 7, "a successful receipt must be reused inside its TTL");
  clockMs += CSM_PERSISTENCE_READINESS_CACHE_TTL_MS + 1;
  await checkCachedCsmPersistenceReadiness(options);
  assert.equal(calls.length, 14, "all seven probes must refresh after cache expiry");

  resetCsmPersistenceReadinessCache();
  pacerReady = false;
  const failed = await checkCachedCsmPersistenceReadiness(options);
  assert.equal(failed.ready, false);
  assert.equal(failed.reason, "provider_pacer_probe_contract_mismatch");
  pacerReady = true;
  const healed = await checkCachedCsmPersistenceReadiness(options);
  assert.equal(healed.ready, true, "pacer recovery must not wait for a failure TTL");
  assert.equal(calls.length, 28, "failure and immediate recovery each require one seven-probe receipt");
  resetCsmPersistenceReadinessCache();
}

{
  const operationKey = "luna-direct:v2:trace-operation";
  const payloadHash = "f".repeat(64);
  const clientRequestId = deterministicProviderClientRequestId({
    operationKey, payloadHash, attempt: 2
  });
  assert.equal(clientRequestId, deterministicProviderClientRequestId({
    operationKey, payloadHash, attempt: 2
  }));
  assert.notEqual(clientRequestId, deterministicProviderClientRequestId({
    operationKey, payloadHash, attempt: 3
  }));
  let request = null;
  const call = createResponsesProviderCaller({
    env: { OPENAI_API_KEY: "test-key" }, operationKey, payloadHash, attempt: 2,
    fetchImpl: async (url, init) => {
      request = { url, init, rawBody: init.body, body: JSON.parse(init.body) };
      return new Response('{"id":"resp_trace"}', { status: 200 });
    }
  });
  await call({ model: "gpt-5.6-luna", metadata: { existing: "kept" } });
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.init.method, "POST");
  assert.equal(new Headers(request.init.headers).get("authorization"), "Bearer test-key");
  assert.equal(new Headers(request.init.headers).get("content-type"), "application/json");
  assert.equal(new Headers(request.init.headers).get("x-client-request-id"), clientRequestId);
  assert.equal(
    createHash("sha256").update(request.rawBody).digest("hex"),
    "42735d23c487398755c2fbc25ff18264c7d19319c8d97fcbe1e9f03f09865bbd",
    "moving dispatch into the adapter must not change OpenAI request bytes"
  );
  assert.equal(request.body.store, true);
  assert.equal(request.body.metadata.existing, "kept");
  assert.match(request.body.metadata.lynca_operation_sha256, /^[0-9a-f]{64}$/);
  assert.equal(request.body.metadata.lynca_payload_sha256, payloadHash);
  assert.equal(request.body.metadata.lynca_attempt, "2");

  const activeAdapter = resolveCsmProviderAdapter(CSM_THIN_RUNTIME_CONTRACT.provider);
  assert.equal(typeof activeAdapter.createCaller, "function");
  assert.equal(activeAdapter.contract.transport.endpoint, request.url);
  assert.equal(activeAdapter.contract.transport.api_key_env, "OPENAI_API_KEY");
  let adapterRequest = null;
  await activeAdapter.createCaller({
    env: { OPENAI_API_KEY: "test-key" },
    operationKey,
    payloadHash,
    attempt: 2,
    clientRequestId,
    timeoutMs: CSM_DIRECT_PROVIDER_TIMEOUT_MS,
    fetchImpl: async (url, init) => {
      adapterRequest = { url, init };
      return new Response('{"id":"resp_trace"}', { status: 200 });
    }
  })({ model: "gpt-5.6-luna", metadata: { existing: "kept" } });
  assert.equal(adapterRequest.url, request.url);
  assert.equal(adapterRequest.init.body, request.rawBody);
  assert.deepEqual(adapterRequest.init.headers, request.init.headers);
  assert.throws(
    () => resolveCsmProviderAdapter("future-provider"),
    /unsupported_csm_provider:future-provider/,
    "an unknown provider must fail before caller creation or fetch"
  );
}

assert.equal(internalServiceSecretHeader, "x-lynca-worker-secret");
assert.equal(
  configuredInternalServiceSecret({ LYNCA_INTERNAL_SERVICE_SECRET: "neutral-secret" }),
  "neutral-secret"
);
assert.equal(isInternalServiceRequest({
  headers: new Headers({ [internalServiceSecretHeader]: "neutral-secret" })
}, { LYNCA_INTERNAL_SERVICE_SECRET: "neutral-secret" }), true);
assert.equal(isInternalServiceRequest({
  headers: { [internalServiceSecretHeader]: "wrong" }
}, { LYNCA_INTERNAL_SERVICE_SECRET: "neutral-secret" }), false);

{
  let attempts = 0;
  const result = await readSupabaseRows({
    table: "listing_assets",
    select: "id,tenant_id",
    search: { tenant_id: "eq.tenant-1" },
    attempts: 2,
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_test"
    },
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("fetch failed");
      return new Response('[{"id":"asset-1","tenant_id":"tenant-1"}]', { status: 200 });
    }
  });
  assert.equal(attempts, 2, "the neutral product read must retain transient transport retry");
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].tenant_id, "tenant-1");
}

const IMAGE_HASH = "a".repeat(64);
const HISTORICAL_EXTERNAL_IDENTITY_V1_CONTRACT = Object.freeze({
  schema_version: "csm-post-observation-resolution-contract.v1",
  contract_id: "lynca.csm.post-observation.external-identity.v1",
  support_pack_sha256: "f8d94d725140118e3a1e91ae758ebbe9e9c10cbd517a010b7b5f2d64a5dc28d2",
  resolver_version: "thin-path-exact-external-identity-v2",
  conflict_policy_version: "exact-unique-or-original-set-visible-conflict-wins-v2",
  composer_version: "thin-marketplace-composer-v3-verified-external-identity",
  marketplace_profile_version: "ebay-verified-external-identity-v1",
  registry_release_id: "registry_thin_external_identity_high_risers_v1",
  matching: "exact_unique_four_anchor_or_verified_original_set",
  visible_conflict_policy: "abstain",
  physical_copy_fields: "immutable",
  provider_calls_added: 0,
  contract_sha256: "e0b2e3463e8dc13f33d5ca2dbb3739b6e07c7b02f820901b4961ed83d0d945df"
});
assert.equal(
  computePostObservationResolutionContractSha256(HISTORICAL_EXTERNAL_IDENTITY_V1_CONTRACT),
  HISTORICAL_EXTERNAL_IDENTITY_V1_CONTRACT.contract_sha256
);
const ordinaryTask = (intentId, overrides = {}) => ({
  tenant_id: "tenant-1",
  intent_id: intentId,
  asset_id: "asset-1",
  model: CSM_THIN_RUNTIME_CONTRACT.model,
  detail: "high",
  reasoning_effort: CSM_THIN_RUNTIME_CONTRACT.reasoningEffort,
  prompt_version: CSM_DIRECT_PROMPT_VERSION,
  estimated_tokens: CSM_DIRECT_ESTIMATED_TOKENS,
  image_fingerprints: [`sha256:${IMAGE_HASH}`],
  recognition_fingerprints: [`sha256:${IMAGE_HASH}`],
  execution_contract_sha256: CURRENT_DIRECT_EXECUTION_SHA256,
  resolution_contract_sha256: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.contract_sha256,
  ...overrides
});
const canonicalImages = () => ({
  asset_id: "asset-1",
  image_generation_id: "asset-1",
  image_set_sha256: "b".repeat(64),
  expected_original_count: 1,
  image_references: [{ objectPath: "tenant-1/a.jpg", content_sha256: IMAGE_HASH }],
  images: [{
    objectPath: "tenant-1/a.jpg",
    bucket: "cards",
    size: 1_000,
    storageRole: "image_1_original",
    derived: false,
    content_sha256: IMAGE_HASH
  }]
});

const activeVerifiedProjection = structuredClone(CSM_PROJECTION_ACTIVATION);
const dormantProjection = structuredClone(CSM_PROJECTION_ACTIVATION);
dormantProjection.active_writer.standard = {
  composer_version: THIN_COMPOSER_VERSION_V2,
  marketplace_profile_version: EBAY_PROFILE_VERSION
};
dormantProjection.active_writer.verified_original_observation_overlay = null;
const subsetAOriginalSha256 = WRITER_JOURNEY_STANDARD_P0_SOURCE_CONTRACT.images
  .map(({ content_sha256 }) => content_sha256);

assert.equal(selectCsmPostObservationResolutionContract({
  originalImageSha256: subsetAOriginalSha256
}).resolution_contract_sha256, COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT.contract_sha256,
"Activation A must select the exact verified overlay by default");
const activeVerifiedSelection = selectCsmPostObservationResolutionContract({
  originalImageSha256: subsetAOriginalSha256,
  projectionActivation: activeVerifiedProjection
});
assert.equal(activeVerifiedSelection.mode,
  "EXTERNAL_AND_VERIFIED_ORIGINAL_CLOSED_PROJECTION");
assert.equal(activeVerifiedSelection.resolution_contract_sha256,
  COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT.contract_sha256);
assert.equal(selectCsmPostObservationResolutionContract({
  originalImageSha256: ["1".repeat(64), "2".repeat(64)],
  projectionActivation: activeVerifiedProjection
}).resolution_contract_sha256, EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.contract_sha256,
"an active overlay must still use the external-only contract for an unmatched set");
for (const mixed of [
  {
    ...activeVerifiedProjection,
    active_writer: {
      ...activeVerifiedProjection.active_writer,
      verified_original_observation_overlay: null
    }
  },
  {
    ...dormantProjection,
    active_writer: {
      ...dormantProjection.active_writer,
      verified_original_observation_overlay: VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID
    }
  }
]) {
  assert.throws(() => selectCsmPostObservationResolutionContract({
    originalImageSha256: subsetAOriginalSha256,
    projectionActivation: mixed
  }), (error) => error.code === "csm_projection_activation_invalid"
    && error.retryable === false,
  "mixed writer/overlay activation must fail before any provider boundary");
}

function verifiedOriginalCheckpointFixture() {
  const observed = {
    year: "2025", ip: "", language: "", manufacturer: "Topps", product: "Chrome",
    set: "", subjects: ["Cooper Flagg"], team: "Mavericks", card_name: "",
    release_variant: "", surface_color: "Gold", parallel_family: "Refractor",
    parallel_exact: "Gold Refractor", print_finish: "Gold Refractor",
    descriptive_rarity: "", card_number: "251", serial: "30/50", attributes: ["RC"],
    components: ["RC"], search_optimization: [], grading_info: null, grade: "",
    grammar: "standard", lot_count: "", special_stamp: "", description: "",
    unreadable: [], low_confidence: []
  };
  const externalIdentityContext = { originalImageSha256: subsetAOriginalSha256 };
  const verified = resolveVerifiedOriginalObservation(observed, externalIdentityContext);
  assert.equal(verified?.receipt?.status, "APPLIED");
  const external = resolveExternalIdentitySupport(verified.fields, { externalIdentityContext });
  assert.equal(external.status, "ABSTAINED");
  const composed = composeLyncaStandardNameForProfile(verified.fields, {
    marketplaceProfileVersion: LYNCA_STANDARD_PROFILE_VERSION_V2
  });
  const recognitionSessionId = "session-active-verified-original";
  const rows = buildCsmStageRows({
    tenantId: "tenant-1",
    recognitionSessionId,
    fields: verified.fields,
    observedFields: observed,
    externalIdentitySupport: external.receipt,
    verifiedOriginalObservationSupport: verified.receipt,
    composed,
    title: composed.title
  });
  const result = {
    title: composed.title,
    fields: verified.fields,
    observed_fields: observed,
    field_defects: [],
    sanitised: false,
    grammar: composed.grammar,
    brackets: composed.brackets,
    dropped_brackets: composed.dropped,
    suppressed_brackets: composed.suppressed,
    restored_brackets: composed.restored,
    truncated: composed.truncated,
    input_empty_fields: composed.input_empty_fields,
    normalization_reasons: composed.normalization_reasons,
    character_budget: composed.character_budget,
    length: composed.length,
    external_identity_support: external.receipt,
    verified_original_observation_support: verified.receipt,
    resolution_contract_sha256:
      COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT.contract_sha256,
    resolution_contract: COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT,
    execution_contract_sha256: "d".repeat(64),
    csm_rows: rows
  };
  result.accuracy_loss_ledger = buildAccuracyLossLedger({
    rawProviderOutput: JSON.stringify(observed),
    result
  });
  return {
    prepared: result,
    recognitionSessionId,
    originalSetSha256: verified.receipt.original_set_sha256
  };
}

function resealVerifiedOriginalPrepared(prepared) {
  const rows = prepared.csm_rows;
  rows.resolution.recognition_packet_sha256 = computeCsmPacketHashes(rows)
    .csm_recognition_packet_sha256;
  rows.output.resolution_packet_sha256 = computeCsmPacketHashes(rows)
    .csm_resolution_packet_sha256;
  rows.session_hashes = computeCsmPacketHashes(rows);
  prepared.accuracy_loss_ledger = buildAccuracyLossLedger({
    rawProviderOutput: JSON.stringify(prepared.observed_fields),
    result: prepared
  });
  return prepared;
}

{
  const fixture = verifiedOriginalCheckpointFixture();
  const activePublic = publicPersistedResult(fixture.prepared);
  assert.deepEqual(activePublic.fields.search_optimization, [],
    "the active CNL tuple keeps its versioned independent search lane");
  assert.equal(
    activePublic.csm_rows.output.marketplace_profile_version,
    LYNCA_STANDARD_PROFILE_VERSION_V2,
    "only a registered CNL tuple exposes its marketplace profile publicly"
  );
  const args = {
    prepared: fixture.prepared,
    tenantId: "tenant-1",
    operationKey: "csm-active-verified-original",
    payloadHash: "e".repeat(64),
    recognitionSessionId: fixture.recognitionSessionId,
    executionContractSha256: fixture.prepared.execution_contract_sha256,
    resolutionContractSha256:
      COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT.contract_sha256,
    originalSetSha256: fixture.originalSetSha256,
    projectionActivation: activeVerifiedProjection
  };
  const checkpoint = buildCsmPersistenceCheckpoint(args);
  assert.equal(checkpoint.csm_persistence_checkpoint.schema_version,
    CSM_PERSISTENCE_CHECKPOINT_ORDINARY_EXECUTION_VERIFIED_ORIGINAL_VERSION);
  assert.equal(checkpoint.csm_persistence_checkpoint.external_identity_receipt.status,
    "ABSTAINED");
  assert.equal(
    checkpoint.csm_persistence_checkpoint.verified_original_observation_receipt.release_id,
    VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID
  );
  assert.equal(validateCsmPersistenceCheckpoint(checkpoint, {
    tenantId: args.tenantId,
    operationKey: args.operationKey,
    payloadHash: args.payloadHash,
    recognitionSessionId: args.recognitionSessionId,
    executionContractSha256: args.executionContractSha256,
    resolutionContractSha256: args.resolutionContractSha256,
    originalSetSha256: args.originalSetSha256
  }).title, fixture.prepared.title);

  const derived = buildCsmPersistenceCheckpoint({ ...args, operationScope: "derived_checkpoint" });
  assert.equal(derived.csm_persistence_checkpoint.schema_version,
    CSM_PERSISTENCE_CHECKPOINT_DERIVED_VERIFIED_ORIGINAL_VERSION);

  const tampered = structuredClone(checkpoint);
  tampered.csm_persistence_checkpoint.verified_original_observation_receipt
    .observed_fields_sha256 = "0".repeat(64);
  assert.throws(() => validateCsmPersistenceCheckpoint(tampered, {
    tenantId: args.tenantId,
    operationKey: args.operationKey,
    payloadHash: args.payloadHash,
    recognitionSessionId: args.recognitionSessionId,
    executionContractSha256: args.executionContractSha256,
    resolutionContractSha256: args.resolutionContractSha256,
    originalSetSha256: args.originalSetSha256
  }), (error) => error.detail === "verified_original_observation_receipt_mismatch");
  assert.throws(() => buildCsmPersistenceCheckpoint({
    ...args,
    projectionActivation: dormantProjection
  }), (error) => error.detail === "verified_original_observation_release_not_active");
  assert.throws(() => validateCsmPersistenceCheckpoint(checkpoint, {
    tenantId: args.tenantId,
    operationKey: args.operationKey,
    payloadHash: args.payloadHash,
    recognitionSessionId: args.recognitionSessionId,
    executionContractSha256: args.executionContractSha256,
    resolutionContractSha256: args.resolutionContractSha256,
    originalSetSha256: "f".repeat(64)
  }), (error) => error.code === "csm_persistence_checkpoint_invalid");

  const buildFrom = (prepared, overrides = {}) => buildCsmPersistenceCheckpoint({
    ...args,
    prepared,
    ...overrides
  });
  const externalAppliedOverlap = structuredClone(fixture.prepared);
  externalAppliedOverlap.external_identity_support.status = "APPLIED";
  assert.throws(() => buildFrom(externalAppliedOverlap), (error) =>
    error.detail === "combined_external_identity_must_abstain",
  "a combined checkpoint must reject external APPLIED before receipt normalization");

  const storedExternalOverlap = structuredClone(fixture.prepared);
  storedExternalOverlap.csm_rows.output.structured_output.external_identity_support = {
    status: "APPLIED"
  };
  resealVerifiedOriginalPrepared(storedExternalOverlap);
  assert.throws(() => buildFrom(storedExternalOverlap), (error) =>
    error.detail === "combined_external_identity_rows_unexpected",
  "a resealed combined packet may not carry a stored external projection");

  for (const field of ["observed_fields", "fields"]) {
    const resultDrift = structuredClone(fixture.prepared);
    resultDrift[field].team = "Transplanted Team";
    resultDrift.accuracy_loss_ledger = buildAccuracyLossLedger({
      rawProviderOutput: JSON.stringify(resultDrift.observed_fields),
      result: resultDrift
    });
    assert.throws(() => buildFrom(resultDrift), (error) =>
      error.detail === "verified_original_observation_receipt_invalid",
    `the private receipt must bind ${field} even after ledger reseal`);
  }

  const transplantedReceipt = resolveVerifiedOriginalObservation(
    fixture.prepared.observed_fields,
    { originalImageSha256: [
      "88debfceb73ee0bf048e92462e50d599df7a865a5e95ee361cdd76219a82f21c",
      "a431abc8e498856de4a37e1b61937cee68652448e9b465c9bed96dfd1ec048e5"
    ] }
  );
  assert.equal(transplantedReceipt?.receipt?.record_id, "subset-a-b");
  const overlayTransplant = structuredClone(fixture.prepared);
  overlayTransplant.verified_original_observation_support =
    transplantedReceipt.receipt;
  overlayTransplant.csm_rows.output.structured_output
    .verified_original_observation_support = transplantedReceipt.receipt;
  resealVerifiedOriginalPrepared(overlayTransplant);
  assert.throws(() => buildFrom(overlayTransplant, {
    originalSetSha256: transplantedReceipt.receipt.original_set_sha256
  }), (error) => error.detail === "verified_original_observation_receipt_invalid",
  "a valid receipt from another reviewed set may not be transplanted and resealed");

  const tupleTampered = structuredClone(fixture.prepared);
  tupleTampered.csm_rows.output.marketplace_profile_version =
    "lynca-standard-name-v0.1";
  resealVerifiedOriginalPrepared(tupleTampered);
  assert.throws(() => buildFrom(tupleTampered), (error) =>
    error.detail === "verified_original_observation_output_tuple_mismatch",
  "the first overlay release is bound to the v3/v0.2 replay tuple");

  const packetTampered = structuredClone(fixture.prepared);
  const supportEvidence = packetTampered.csm_rows.evidence.find((row) =>
    row.source_ref?.support_type === "EXACT_VERIFIED_ORIGINAL_CLOSED_PROJECTION"
  );
  assert.ok(supportEvidence);
  packetTampered.csm_rows.evidence = packetTampered.csm_rows.evidence.filter(
    (row) => row.id !== supportEvidence.id
  );
  packetTampered.csm_rows.links = packetTampered.csm_rows.links.filter(
    (row) => row.evidence_observation_id !== supportEvidence.id
  );
  resealVerifiedOriginalPrepared(packetTampered);
  assert.throws(() => buildFrom(packetTampered), (error) =>
    error.detail === "verified_original_observation_replay_packet_invalid",
  "recomputing packet hashes cannot repair missing overlay lineage");

  for (const [label, mutate] of [
    ["session packet hash", (prepared) => {
      prepared.csm_rows.session_hashes.csm_marketplace_packet_sha256 = "0".repeat(64);
    }],
    ["embedded recognition hash", (prepared) => {
      prepared.csm_rows.resolution.recognition_packet_sha256 = "0".repeat(64);
    }]
  ]) {
    const hashTampered = structuredClone(fixture.prepared);
    mutate(hashTampered);
    assert.throws(() => buildFrom(hashTampered), (error) =>
      error.detail === "verified_original_observation_replay_packet_invalid",
    `a valid-looking but stale ${label} cannot be signed into a checkpoint`);
  }

  assert.throws(() => buildFrom(fixture.prepared, {
    recognitionSessionId: "transplanted-session"
  }), (error) => error.detail === "prepared_result_mismatch",
  "a complete valid packet cannot be checkpointed under another session");
}

// The production API, not a client payload, derives the reviewed identity
// context from tenant-scoped verified originals and carries only its set digest
// through dispatch/checkpoint identity. The provider still sees one ordinary
// image request and no tool/hash side channel.
{
  const originalSha256 = [
    "8641baae2722318061dc7d9431e8764e4fe72d809bf1d668294c823c1105811a",
    "7551abbd6a90f94771396eb46f726f20c49b0745d23db4f82a8db5c82296ca01"
  ];
  const originalSetSha256 =
    "61ee1d99b10690cf5877e9b5f08b53ba98051a3961d0a9e5c04f9e8e130db159";
  const canonical = {
    asset_id: "asset-1",
    image_generation_id: "asset-1",
    image_set_sha256: "e".repeat(64),
    expected_original_count: 2,
    image_references: originalSha256.map((content_sha256, index) => ({
      image_id: `original-${index + 1}`,
      image_role: index === 0 ? "front_original" : "back_original",
      bucket: "cards",
      object_path: `tenant-1/asset-1/original-${index + 1}.jpg`,
      content_sha256,
      derived: false
    })),
    images: originalSha256.map((content_sha256, index) => ({
      image_id: `original-${index + 1}`,
      objectPath: `tenant-1/asset-1/original-${index + 1}.jpg`,
      bucket: "cards",
      size: 1_000 + index,
      storageRole: index === 0 ? "image_1_original" : "image_2_original",
      derived: false,
      content_sha256
    }))
  };
  const observed = {
    year: "1996-97", manufacturer: "Topps", product: "Stadium Club",
    set: "High Risers", subjects: ["Michael Jordan"], team: "Chicago Bulls",
    card_name: "", release_variant: "", surface_color: "", parallel_family: "",
    parallel_exact: "", descriptive_rarity: "", card_number: "", serial: "",
    attributes: [], grade: "", grammar: "standard", lot_count: "",
    unreadable: [], low_confidence: []
  };
  let providerCalls = 0;
  let providerWire = "";
  let persistenceInput = null;
  const dependencies = successfulDependencies({
    authority: passthroughAuthority({ shallowWrapAfterSettle: true })
  });
  dependencies.readImages = async () => canonical;
  dependencies.signImage = async ({ objectPath }) => `https://signed.invalid/${objectPath}`;
  dependencies.createSession = async () => ({
    persistence: { recognition_session: { saved: true } }
  });
  delete dependencies.preparePath;
  dependencies.persistPath = async ({ prepared }) => {
    persistenceInput = prepared;
    return {
      ...prepared,
      csm_persistence: { ok: true, atomic: true, session: { saved: true } }
    };
  };
  const result = await runDirectCsmAsset({
    tenantId: "tenant-1",
    userId: "user-1",
    assetId: "asset-1",
    intentId: "verified-original-set-identity",
    callProvider: async (request) => {
      providerCalls += 1;
      providerWire = JSON.stringify(request);
      return new Response(JSON.stringify({
        id: "resp_verified_original_set",
        model: "gpt-5.6-luna-2026-08-01",
        status: "completed",
        output_text: JSON.stringify(observed),
        reasoning: { effort: CSM_THIN_RUNTIME_CONTRACT.reasoningEffort },
        usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 }
      }), {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "req_verified_original_set" }
      });
    },
    dependencies
  });
  assert.equal(providerCalls, 1);
  assert.equal(Object.hasOwn(JSON.parse(providerWire), "tools"), false);
  for (const hidden of [...originalSha256, originalSetSha256]) {
    assert.doesNotMatch(providerWire, new RegExp(hidden));
  }
  assert.equal(
    result.title,
    "1996-97 Topps Stadium Club High Risers #HR14 Michael Jordan Chicago Bulls"
  );
  assert.equal(result.external_identity_support, undefined);
  assert.equal(Object.hasOwn(result.fields, "search_optimization"), false,
    "the dormant bridge must preserve the de55 legacy field key set");
  assert.deepEqual(Object.keys(result.csm_rows).sort(), ["output", "resolution"]);
  assert.deepEqual(Object.keys(result.csm_rows.resolution).sort(), [
    "contract_version", "recognition_session_id", "resolver_version"
  ]);
  assert.deepEqual(Object.keys(result.csm_rows.output).sort(), [
    "composer_version", "contract_version"
  ]);
  for (const hidden of [...originalSha256, originalSetSha256]) {
    assert.doesNotMatch(JSON.stringify(result), new RegExp(hidden),
      "the browser result must not carry private original identity");
  }
  assert.doesNotMatch(JSON.stringify(result), /original_set_sha256|source_ref/);
  assert.equal(
    persistenceInput.csm_persistence_checkpoint.external_identity_receipt.original_set_sha256,
    originalSetSha256
  );
  assert.equal(
    persistenceInput.csm_persistence_checkpoint.external_identity_receipt.request_original_set_sha256,
    originalSetSha256
  );
  const checkpointMarker = persistenceInput.csm_persistence_checkpoint;
  assert.equal(validateCsmPersistenceCheckpoint(persistenceInput, {
    tenantId: "tenant-1",
    operationKey: checkpointMarker.operation_key,
    payloadHash: checkpointMarker.payload_sha256,
    recognitionSessionId: checkpointMarker.recognition_session_id,
    executionContractSha256: persistenceInput.execution_contract_sha256,
    resolutionContractSha256: persistenceInput.resolution_contract_sha256,
    originalSetSha256
  }).title, result.title);
  const identityReceiptTampered = structuredClone(persistenceInput);
  identityReceiptTampered.csm_persistence_checkpoint.external_identity_receipt.original_set_sha256 =
    "f".repeat(64);
  assert.throws(() => validateCsmPersistenceCheckpoint(identityReceiptTampered, {
    tenantId: "tenant-1",
    operationKey: checkpointMarker.operation_key,
    payloadHash: checkpointMarker.payload_sha256,
    recognitionSessionId: checkpointMarker.recognition_session_id,
    executionContractSha256: persistenceInput.execution_contract_sha256,
    resolutionContractSha256: persistenceInput.resolution_contract_sha256,
    originalSetSha256
  }), (error) => error.code === "csm_persistence_checkpoint_invalid"
    && error.detail === "external_identity_receipt_mismatch");
  assert.equal(result.csm_persistence_checkpoint, undefined);
}

// A v2 deployment must recover a paid v1 terminal checkpoint by its stored
// release contract. Re-validating it against today's active v2 constants would
// strand a correct historical result after every detachable-pack upgrade.
{
  const originalSha256 = [
    "8641baae2722318061dc7d9431e8764e4fe72d809bf1d668294c823c1105811a",
    "7551abbd6a90f94771396eb46f726f20c49b0745d23db4f82a8db5c82296ca01"
  ];
  const originalSetSha256 =
    "61ee1d99b10690cf5877e9b5f08b53ba98051a3961d0a9e5c04f9e8e130db159";
  const canonical = {
    asset_id: "asset-1",
    image_generation_id: "asset-1",
    image_set_sha256: "e".repeat(64),
    expected_original_count: 2,
    image_references: originalSha256.map((content_sha256, index) => ({
      image_id: `historical-original-${index + 1}`,
      image_role: index === 0 ? "front_original" : "back_original",
      bucket: "cards",
      object_path: `tenant-1/asset-1/historical-original-${index + 1}.jpg`,
      content_sha256,
      derived: false
    })),
    images: originalSha256.map((content_sha256, index) => ({
      image_id: `historical-original-${index + 1}`,
      objectPath: `tenant-1/asset-1/historical-original-${index + 1}.jpg`,
      bucket: "cards",
      size: 1_000 + index,
      storageRole: index === 0 ? "image_1_original" : "image_2_original",
      derived: false,
      content_sha256
    }))
  };
  const executionContract = buildCsmModelExecutionContract({
    profile: CSM_ACTIVE_MODEL_PROFILE,
    semanticPromptVersion: CSM_DIRECT_PROMPT_VERSION,
    transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
    imageUrls: csmExecutionContractImageUrls(2)
  });
  const executionContractSha256 = sha256ExecutionContractValue(executionContract);
  const historicalPayloadHash = "9".repeat(64);
  const releaseV1 = EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY.releases
    .registry_thin_external_identity_high_risers_v1;
  let historicalCheckpoint = null;
  let providerBoundaryCalls = 0;
  let recoveredOperationKey = "";

  const authority = {
    globallyEnforced: true,
    lookupOperationResult: async () => ({ status: "not_found" }),
    enqueueAttempt: async ({ operationKey }) => {
      recoveredOperationKey = operationKey;
      throw Object.assign(new Error("operation_payload_conflict"), {
        code: "operation_payload_conflict",
        statusCode: 409,
        retryable: false,
        provider_attempt_started: false
      });
    },
    lookupOperationResultByKey: async ({ operationKey }) => {
      assert.equal(operationKey, recoveredOperationKey);
      const recognitionSessionId = deterministicCsmSessionId(operationKey);
      const prepared = {
        ...preparedResult(recognitionSessionId, "Historical v1 title"),
        external_identity_support: {
          ...releaseV1.receipt,
          status: "ABSTAINED",
          reason: "CONFLICTING_OBSERVATION"
        },
        resolution_contract_sha256: HISTORICAL_EXTERNAL_IDENTITY_V1_CONTRACT.contract_sha256,
        resolution_contract: HISTORICAL_EXTERNAL_IDENTITY_V1_CONTRACT,
        execution_contract_sha256: executionContractSha256,
        execution_contract: executionContract
      };
      historicalCheckpoint = {
        ...prepared,
        csm_persistence_checkpoint: {
          schema_version: CSM_PERSISTENCE_CHECKPOINT_ORDINARY_EXECUTION_VERSION,
          state: "PERSISTENCE_PENDING",
          tenant_id: "tenant-1",
          operation_key: operationKey,
          payload_sha256: historicalPayloadHash,
          recognition_session_id: recognitionSessionId,
          recognition_session_deferred: false,
          execution_contract_sha256: executionContractSha256,
          external_identity_receipt: {
            schema_version: "csm-external-identity-checkpoint-receipt.v1",
            status: "ABSTAINED",
            request_original_set_sha256: originalSetSha256,
            pack_id: releaseV1.receipt.pack_id,
            pack_version: releaseV1.receipt.pack_version,
            pack_sha256: releaseV1.receipt.pack_sha256,
            index_id: releaseV1.receipt.index_id,
            index_version: releaseV1.receipt.index_version,
            index_sha256: releaseV1.receipt.index_sha256,
            registry_release_id: releaseV1.receipt.registry_release_id,
            resolution_contract_sha256: releaseV1.receipt.resolution_contract_sha256,
            reason: "CONFLICTING_OBSERVATION"
          },
          packet_hashes: prepared.csm_rows.session_hashes,
          accuracy_loss_ledger_version: prepared.accuracy_loss_ledger.version,
          accuracy_loss_ledger_sha256: prepared.accuracy_loss_ledger.ledger_sha256
        }
      };
      return {
        status: "found",
        payloadHash: historicalPayloadHash,
        result: historicalCheckpoint,
        latestAttempt: 1
      };
    },
    runAttempt: async ({ queuedAttempt, execute }) => {
      await queuedAttempt;
      return execute();
    }
  };
  const dependencies = successfulDependencies({ authority });
  dependencies.readImages = async () => canonical;
  dependencies.signImage = async () => { providerBoundaryCalls += 1; };
  dependencies.preparePath = async () => { providerBoundaryCalls += 1; };

  const recovered = await runDirectCsmAsset({
    tenantId: "tenant-1",
    userId: "user-1",
    assetId: "asset-1",
    intentId: "historical-v1-external-recovery",
    callProvider: async () => { providerBoundaryCalls += 1; },
    dependencies
  });
  assert.equal(recovered.title, "Historical v1 title");
  assert.equal(recovered.execution_origin, "HISTORICAL_KEY_RECOVERY");
  assert.equal(providerBoundaryCalls, 0);

  const unknownRelease = structuredClone(historicalCheckpoint);
  unknownRelease.external_identity_support.registry_release_id = "unknown_release";
  assert.throws(() => validateCsmPersistenceCheckpoint(unknownRelease, {
    tenantId: "tenant-1",
    operationKey: recoveredOperationKey,
    payloadHash: historicalPayloadHash,
    recognitionSessionId: deterministicCsmSessionId(recoveredOperationKey),
    executionContractSha256,
    resolutionContractSha256: HISTORICAL_EXTERNAL_IDENTITY_V1_CONTRACT.contract_sha256,
    originalSetSha256
  }), (error) => error.code === "csm_persistence_checkpoint_invalid"
    && error.detail === "external_identity_registry_release_unsupported");
}

// The active session root has a CSM contract even while its physical table
// retains the historical name. Duplicate creation is accepted only after a
// tenant-scoped read proves the immutable identity is exact.
{
  const env = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_test"
  };
  const payload = {
    asset_id: "asset-1",
    client_asset_ref: "asset-1",
    images: canonicalImages().image_references,
    image_references: canonicalImages().image_references,
    image_generation_id: "asset-1",
    image_set_sha256: "b".repeat(64),
    expected_original_count: 1,
    provider: "gpt-5.6-luna",
    mode: "csm_thin_direct"
  };
  const input = {
    sessionId: "csmsess_contract",
    payload,
    routePlan: { route: "CSM_THIN_DIRECT", route_reason: "cloud_run_retired" },
    tenantId: "tenant-1",
    userId: "user-1",
    operatorId: "user-1"
  };
  const row = buildCsmRecognitionSessionRow(input);
  assert.equal(CSM_SESSION_SCHEMA_VERSION, "csm-recognition-session-v1");
  assert.equal(row.schema_version, CSM_SESSION_SCHEMA_VERSION);
  assert.equal(row.tenant_id, "tenant-1");
  assert.equal(row.user_id, "user-1");
  assert.equal(row.route, "CSM_THIN_DIRECT");

  let stored = null;
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (init.method === "POST") {
      stored = JSON.parse(init.body);
      return new Response(JSON.stringify([stored]), { status: 201 });
    }
    return new Response(JSON.stringify([stored]), { status: 200 });
  };
  const created = await createCsmRecognitionSession({ ...input, env, fetchImpl });
  assert.equal(created.persistence.recognition_session.saved, true);
  assert.equal(created.persistence.recognition_session.verified_after_write, true);
  assert.equal(requests.length, 1, "a represented insert is verified without a read-back round trip");
  assert.equal(requests[0].init.headers.apikey, "sb_secret_test");
  assert.equal(requests[0].init.headers.authorization, undefined);

  const conflict = await createCsmRecognitionSession({
    ...input,
    env,
    fetchImpl: async (_url, init = {}) => init.method === "POST"
      ? new Response("[]", { status: 201 })
      : new Response(JSON.stringify([{ ...stored, user_id: "other-user" }]), { status: 200 })
  });
  assert.equal(conflict.persistence.recognition_session.saved, false);
  assert.equal(
    conflict.persistence.recognition_session.error,
    "csm_recognition_session_post_write_identity_conflict"
  );

  const expandedPayload = {
    ...payload,
    images: [...payload.images, {
      image_id: "front-name-crop",
      image_role: "nameplate_crop",
      object_path: "tenant-1/front-name-crop.jpg",
      content_sha256: "c".repeat(64),
      derived: true,
      source_image_id: "front"
    }],
    image_references: [...payload.image_references, {
      image_id: "front-name-crop",
      image_role: "nameplate_crop",
      object_path: "tenant-1/front-name-crop.jpg",
      content_sha256: "c".repeat(64),
      derived: true,
      source_image_id: "front"
    }],
    image_set_sha256: "d".repeat(64)
  };
  let replayWrites = 0;
  const replay = await createCsmRecognitionSession({
    ...input,
    payload: expandedPayload,
    reuseExistingSnapshot: true,
    env,
    fetchImpl: async (_url, init = {}) => {
      if (init.method === "POST") replayWrites += 1;
      return new Response(JSON.stringify([stored]), { status: 200 });
    }
  });
  assert.equal(replay.persistence.recognition_session.saved, true);
  assert.equal(replay.persistence.recognition_session.reused_existing_snapshot, true);
  assert.equal(replayWrites, 0,
    "checkpoint resume must read and reuse the first durable snapshot without touching the insert trigger");
  assert.deepEqual(replay.row.identity_snapshot.image_references, stored.identity_snapshot.image_references,
    "a later support crop must not rewrite the paid session's original-only identity");

  let raceRead = 0;
  let raceWrites = 0;
  const readInsertRace = await createCsmRecognitionSession({
    ...input,
    payload: expandedPayload,
    reuseExistingSnapshot: true,
    env,
    fetchImpl: async (_url, init = {}) => {
      if (init.method === "POST") {
        raceWrites += 1;
        return new Response("[]", { status: 201 });
      }
      raceRead += 1;
      return new Response(JSON.stringify(raceRead === 1 ? [] : [stored]), { status: 200 });
    }
  });
  assert.equal(raceWrites, 1);
  assert.equal(readInsertRace.persistence.recognition_session.saved, true);
  assert.equal(readInsertRace.persistence.recognition_session.reused_existing_snapshot, true,
    "a first writer winning between replay read and insert must remain authoritative");
  assert.deepEqual(readInsertRace.row.identity_snapshot.image_references, stored.identity_snapshot.image_references);

  const changedOriginal = await createCsmRecognitionSession({
    ...input,
    payload: {
      ...expandedPayload,
      images: expandedPayload.images.map((image, index) => index === 0
        ? { ...image, content_sha256: "9".repeat(64) }
        : image),
      image_references: expandedPayload.image_references.map((image, index) => index === 0
        ? { ...image, content_sha256: "9".repeat(64) }
        : image)
    },
    reuseExistingSnapshot: true,
    env,
    fetchImpl: async () => new Response(JSON.stringify([stored]), { status: 200 })
  });
  assert.equal(changedOriginal.persistence.recognition_session.saved, false);
  assert.equal(
    changedOriginal.persistence.recognition_session.error,
    "csm_recognition_session_existing_owner_conflict",
    "first-write-wins may ignore later support crops, never a changed original identity"
  );
}

function providerAuthorityReceipt(metadata, overrides = {}) {
  return Object.freeze({
    schema_version: CSM_PROVIDER_AUTHORITY_RECEIPT_VERSION,
    operation_key_sha256: createHash("sha256").update(metadata.operationKey).digest("hex"),
    attempt: metadata.attempt,
    attempt_class: metadata.attemptClass,
    estimated_tokens: metadata.estimatedTokens,
    claim_code: "admitted",
    settle_code: "settled",
    operation_status: "SUCCEEDED",
    ...overrides
  });
}

function passthroughAuthority({
  events = [],
  lookup = async () => ({ status: "not_found" }),
  lookupByKey = async () => ({ status: "not_found" }),
  shallowWrapAfterSettle = false
} = {}) {
  return {
    globallyEnforced: true,
    lookupOperationResult: lookup,
    lookupOperationResultByKey: lookupByKey,
    enqueueAttempt: async (metadata) => {
      events.push({ type: "enqueue", metadata });
      return metadata;
    },
    runAttempt: async ({ queuedAttempt, execute }) => {
      const metadata = await queuedAttempt;
      events.push({ type: "claim", metadata });
      const result = await execute();
      if (shallowWrapAfterSettle && result && typeof result === "object" && !Array.isArray(result)) {
        // Mirror Production authority: settlement keeps the nested checkpoint
        // but returns a fresh top-level receipt with authority timing attached.
        return {
          ...result,
          provider_authority_receipt: providerAuthorityReceipt(metadata),
          latency_stages_ms: {
            ...(result.latency_stages_ms && typeof result.latency_stages_ms === "object"
              ? result.latency_stages_ms
              : {}),
            authority_claim_ms: 0,
            authority_settle_ms: 0,
            authority_enqueue_ms: 0
          }
        };
      }
      return result;
    }
  };
}

function preparedResult(recognitionSessionId, title = "Test title") {
  const rawProviderOutput = "{}";
  const ledgerResult = {
    title,
    fields: { low_confidence: [] },
    field_defects: [],
    sanitised: false,
    brackets: [],
    dropped_brackets: [],
    suppressed_brackets: [],
    restored_brackets: [],
    truncated: false,
    input_empty_fields: [],
    normalization_reasons: [],
    character_budget: 80,
    length: title.length
  };
  const accuracyLossLedger = buildAccuracyLossLedger({
    rawProviderOutput,
    result: ledgerResult
  });
  return {
    ...ledgerResult,
    external_identity_support: {
      schema_version: EXTERNAL_IDENTITY_REPLAY_COMPATIBILITY_REGISTRY.releases[
        EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID
      ].receipt.schema_version,
      status: "ABSTAINED",
      reason: "NO_EXACT_MATCH",
      pack_id: EXTERNAL_IDENTITY_SUPPORT_PACK.pack_id,
      pack_version: EXTERNAL_IDENTITY_SUPPORT_PACK.pack_version,
      pack_sha256: EXTERNAL_IDENTITY_SUPPORT_PACK.pack_sha256,
      index_id: EXTERNAL_IDENTITY_SUPPORT_PACK.index_id,
      index_version: EXTERNAL_IDENTITY_SUPPORT_PACK.index_version,
      index_sha256: EXTERNAL_IDENTITY_SUPPORT_PACK.index_sha256,
      registry_release_id: EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID,
      resolution_contract_sha256: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.contract_sha256
    },
    resolution_contract_sha256: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.contract_sha256,
    resolution_contract: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT,
    accuracy_loss_ledger: accuracyLossLedger,
    input_tokens: 4_000,
    output_tokens: 120,
    csm_rows: {
      resolution: {
        tenant_id: "tenant-1",
        recognition_session_id: recognitionSessionId
      },
      output: { title },
      session_hashes: {
        csm_recognition_packet_sha256: "1".repeat(64),
        csm_resolution_packet_sha256: "2".repeat(64),
        csm_marketplace_packet_sha256: "3".repeat(64)
      }
    }
  };
}

function successfulDependencies({
  events = [],
  authority,
  signedUrl = "https://signed.invalid/a.jpg",
  transportProfile = CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE
} = {}) {
  return {
    transportProfile,
    checkReadiness: async () => { events.push("readiness"); return { ready: true }; },
    readImages: async () => { events.push("images"); return canonicalImages(); },
    signImage: async () => { events.push("sign"); return signedUrl; },
    createSession: async ({ routePlan, sessionId, payload }) => {
      events.push("session");
      assert.deepEqual(routePlan, { route: "CSM_THIN_DIRECT", route_reason: "cloud_run_retired" });
      assert.match(sessionId, /^csmsess_[0-9a-f]{40}$/);
      assert.deepEqual(payload.image_references, canonicalImages().image_references);
      assert.equal(payload.image_generation_id, "asset-1");
      assert.equal(payload.image_set_sha256, "b".repeat(64));
      assert.equal(payload.expected_original_count, 1);
      return { persistence: { recognition_session: { saved: true } } };
    },
    preparePath: async (input) => {
      events.push("model_and_csm");
      assert.equal(input.model, "gpt-5.6-luna");
      // The endpoint reads CSM_THIN_RUNTIME_CONTRACT.reasoningEffort, `low`
      // since 2026-08-03. Assert against the contract rather than a literal so
      // the tier can only change in one place.
      assert.equal(input.effort, CSM_THIN_RUNTIME_CONTRACT.reasoningEffort);
      assert.equal(input.transportProfile, transportProfile);
      assert.deepEqual(input.imageUrls, [signedUrl]);
      return {
        ...preparedResult(input.recognitionSessionId),
        execution_contract_sha256: buildCsmModelExecutionContractSha256({
          provider: input.provider,
          model: input.model,
          requestedEffort: input.effort,
          imageDetail: input.imageDetail,
          maxOutputTokens: input.maxOutputTokens,
          semanticPromptVersion: input.promptVersion,
          transportProfile: input.transportProfile,
          imageUrls: input.imageUrls
        })
      };
    },
    persistPath: async ({ prepared }) => {
      events.push("persist_csm");
      return {
        ...prepared,
        csm_persistence: { ok: true, atomic: true, session: { saved: true } }
      };
    },
    providerAdmission: authority
  };
}

function stagedSuccessfulDependencies(options = {}) {
  return {
    ...successfulDependencies({
      ...options,
      transportProfile: CSM_STAGED_TRANSPORT_PROFILE
    }),
    chooseRecognitionImages: ({ originals }) => ({
      images: originals,
      read: originals.map((image, index) => ({
        image_role: index === 0 ? "front_original" : "back_original",
        read: "readability_derived",
        bytes: Number(image.size),
        original_bytes: Number(image.size),
        derived_available: true,
        derived_bytes: Number(image.size)
      }))
    })
  };
}

// COS-49: a terminal Lot refusal happens only after durable settlement and
// atomic persistence. Resume reads the same authority receipt, spends zero
// provider calls, and returns the same nonretryable review-required error.
for (const [failureCode, terminal] of [
  ["LOT_QUANTITY_UNRESOLVED", {
    lot_quantity_unresolved: true, lot_single_card: false,
    lot_unshared_attributes: [], publishable: false,
    failure_code: "LOT_QUANTITY_UNRESOLVED"
  }],
  ["LOT_SINGLE_CARD", {
    lot_quantity_unresolved: false, lot_single_card: true,
    lot_unshared_attributes: [], publishable: false,
    failure_code: "LOT_SINGLE_CARD"
  }]
]) {
  let durable = null;
  let providerCalls = 0;
  let persistenceCalls = 0;
  const authority = passthroughAuthority({
    shallowWrapAfterSettle: true,
    lookup: async () => durable
      ? { status: "found", result: durable }
      : { status: "not_found" }
  });
  const dependencies = successfulDependencies({ authority });
  dependencies.preparePath = async (input) => {
    providerCalls += 1;
    return {
      ...preparedResult(input.recognitionSessionId, "Diagnostic Lot title"),
      grammar: "lot",
      lot_quantity_unresolved: terminal.lot_quantity_unresolved,
      lot_single_card: terminal.lot_single_card,
      lot_unshared_attributes: terminal.lot_unshared_attributes,
      lot_publishable: false,
      lot_publication_failure_code: failureCode,
      csm_rows: {
        ...preparedResult(input.recognitionSessionId).csm_rows,
        output: {
          title: "Diagnostic Lot title",
          structured_output: {
            lot_count: failureCode === "LOT_SINGLE_CARD" ? "1" : "",
            lot_terminal: terminal
          }
        }
      },
      execution_contract_sha256: buildCsmModelExecutionContractSha256({
        provider: input.provider,
        model: input.model,
        requestedEffort: input.effort,
        imageDetail: input.imageDetail,
        maxOutputTokens: input.maxOutputTokens,
        semanticPromptVersion: input.promptVersion,
        transportProfile: input.transportProfile,
        imageUrls: input.imageUrls
      })
    };
  };
  dependencies.persistPath = async ({ prepared }) => {
    persistenceCalls += 1;
    durable = {
      ...prepared,
      csm_persistence: { ok: true, atomic: true, session: { saved: true } }
    };
    return durable;
  };
  const request = {
    tenantId: "tenant-1", userId: "user-1", assetId: "asset-1",
    intentId: `terminal-${failureCode.toLowerCase()}`, dependencies
  };
  let first;
  await assert.rejects(runDirectCsmAsset(request), (error) => {
    first = error;
    return error.code === failureCode
      && error.statusCode === 409
      && error.retryable === false
      && error.review_required === true
      && error.trace_status === "PERSISTED_REVIEW_REQUIRED"
      && /^csmsess_[0-9a-f]{40}$/.test(error.recognition_session_id);
  });
  assert.equal(providerCalls, 1);
  assert.equal(persistenceCalls, 1);
  assert.deepEqual(durable.csm_rows.output.structured_output.lot_terminal, terminal);

  await assert.rejects(runDirectCsmAsset({ ...request, resumeOnly: true }), (error) => (
    error.code === failureCode
      && error.recognition_session_id === first.recognition_session_id
      && error.review_required === true
      && error.retryable === false
  ));
  assert.equal(providerCalls, 1, "terminal Lot resume must add zero provider calls");
  assert.equal(persistenceCalls, 1, "already-persisted terminal Lot must add zero writes");
  const response = buildCsmDirectFailureResponse(first);
  assert.equal(response.status, 409);
  assert.equal(response.body.error_type, "CSM_REVIEW_REQUIRED");
  assert.equal(response.body.trace_status, "PERSISTED_REVIEW_REQUIRED");
  assert.equal(response.body.review_required, true);
}

// Ordinary integrated ingest sends original bytes as data URLs. Its task,
// prepared packet and checkpoint must bind that lane instead of inheriting the
// direct signed-URL or staged-derived receipt.
{
  const events = [];
  const authorityEvents = [];
  const task = ordinaryTask("original-inline-transport", {
    execution_contract_sha256: CURRENT_ORIGINAL_INLINE_EXECUTION_SHA256
  });
  const result = await runDirectCsmAsset({
    tenantId: "tenant-1",
    userId: "user-1",
    assetId: "asset-1",
    intentId: task.intent_id,
    dependencies: successfulDependencies({
      events,
      authority: passthroughAuthority({ events: authorityEvents }),
      signedUrl: "data:image/jpeg;base64,original",
      transportProfile: CSM_ORIGINAL_INLINE_TRANSPORT_PROFILE
    })
  });
  assert.equal(result.title, "Test title");
  assert.equal(
    authorityEvents[0].metadata.payloadHash,
    buildLunaDirectPayloadHash(task)
  );
  assert.equal(
    result.execution_contract_sha256,
    CURRENT_ORIGINAL_INLINE_EXECUTION_SHA256
  );

  let paidBoundaryCalls = 0;
  await assert.rejects(runDirectCsmAsset({
    tenantId: "tenant-1",
    userId: "user-1",
    assetId: "asset-1",
    intentId: "original-inline-derived-counterexample",
    dependencies: {
      ...successfulDependencies({
        authority: {
          globallyEnforced: true,
          enqueueAttempt: async () => { paidBoundaryCalls += 1; },
          runAttempt: async () => { paidBoundaryCalls += 1; }
        },
        transportProfile: CSM_ORIGINAL_INLINE_TRANSPORT_PROFILE
      }),
      chooseRecognitionImages: ({ originals }) => ({
        images: originals,
        read: [{
          image_role: "front_original",
          read: "readability_derived",
          bytes: 500,
          original_bytes: 1_000,
          derived_available: true,
          derived_bytes: 500
        }]
      })
    }
  }), /original_inline_transport_source_mismatch/);
  assert.equal(paidBoundaryCalls, 0);
}

// Staged large-image input decouples provider pixels from paid-operation
// identity without weakening either boundary: the dispatcher hashes the
// original bytes, while signing and the provider see only the bounded derived
// image. A fallback/finalize over verified originals therefore addresses the
// exact same durable checkpoint and cannot buy another model call.
{
  const originalHash = "c".repeat(64);
  const derivedHash = "d".repeat(64);
  const originalCanonical = {
    asset_id: "asset-1",
    image_generation_id: "asset-1",
    image_set_sha256: "e".repeat(64),
    expected_original_count: 1,
    image_references: [{ object_path: "staged-unverified/front.jpg", content_sha256: originalHash }],
    images: [{
      image_id: "front",
      objectPath: "staged-unverified/front.jpg",
      bucket: "staged-unverified",
      storageRole: "image_1_original",
      size: 7_000_000,
      derived: false,
      content_sha256: originalHash
    }]
  };
  const derived = {
    image_id: "front-recognition",
    objectPath: "inline/front-recognition.jpg",
    bucket: "inline",
    size: 700_000,
    derived: true,
    content_sha256: derivedHash
  };
  const authorityEvents = [];
  const signedPaths = [];
  const authority = passthroughAuthority({ events: authorityEvents });
  const originalManifestSha256 = "f".repeat(64);
  const task = {
    tenant_id: "tenant-1",
    intent_id: "staged-identity",
    asset_id: "asset-1",
    model: "gpt-5.6-luna",
    detail: "high",
    reasoning_effort: CSM_THIN_RUNTIME_CONTRACT.reasoningEffort,
    prompt_version: CSM_DIRECT_PROMPT_VERSION,
    estimated_tokens: CSM_DIRECT_ESTIMATED_TOKENS,
    image_fingerprints: [`sha256:${originalHash}`],
    operation_scope: "derived_checkpoint",
    lane_version: STAGED_RECOGNITION_LANE_VERSION,
    original_manifest_sha256: originalManifestSha256,
    recognition_fingerprints: [`sha256:${derivedHash}`],
    execution_contract_sha256: CURRENT_STAGED_EXECUTION_SHA256,
    resolution_contract_sha256: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.contract_sha256
  };
  const result = await runDirectCsmAsset({
    tenantId: "tenant-1",
    userId: "user-1",
    assetId: "asset-1",
    intentId: "staged-identity",
    dependencies: {
      checkReadiness: async () => ({ ready: true }),
      readImages: async () => originalCanonical,
      chooseRecognitionImages: () => ({
        images: [derived],
        read: [{
          image_role: "front_original",
          read: "readability_derived",
          bytes: derived.size,
          original_bytes: originalCanonical.images[0].size,
          derived_available: true,
          derived_bytes: derived.size
        }]
      }),
      transportProfile: CSM_STAGED_TRANSPORT_PROFILE,
      operationScope: "derived_checkpoint",
      laneVersion: STAGED_RECOGNITION_LANE_VERSION,
      originalManifestSha256,
      signImage: async ({ objectPath }) => {
        signedPaths.push(objectPath);
        return "data:image/jpeg;base64,derived";
      },
      createSession: async () => ({ persistence: { recognition_session: { saved: true } } }),
      preparePath: async ({ recognitionSessionId, imageUrls, transportProfile }) => {
        assert.deepEqual(imageUrls, ["data:image/jpeg;base64,derived"]);
        assert.equal(transportProfile, CSM_STAGED_TRANSPORT_PROFILE);
        return {
          ...preparedResult(recognitionSessionId, "Staged title"),
          execution_contract_sha256: CURRENT_STAGED_EXECUTION_SHA256
        };
      },
      persistPath: async ({ prepared }) => ({
        ...prepared,
        csm_persistence: { ok: true, atomic: true, session: { saved: true } }
      }),
      providerAdmission: authority
    }
  });
  assert.equal(result.title, "Staged title");
  assert.deepEqual(signedPaths, [derived.objectPath]);
  assert.equal(authorityEvents[0].metadata.payloadHash, buildLunaDirectPayloadHash(task));
  assert.notEqual(
    authorityEvents[0].metadata.payloadHash,
    buildLunaDirectPayloadHash({ ...task, image_fingerprints: [`sha256:${derivedHash}`] })
  );
  const futureProfile = buildCsmModelProfile({
    id: "future-neutral-profile-v1",
    provider: "openai",
    accountScope: "lynca-primary",
    model: "future-model",
    promptStyleVersion: CSM_NEUTRAL_PROMPT_STYLE_VERSION,
    optimizationPack: null,
    reasoningEffort: "future-effort",
    imageDetail: task.detail,
    maxOutputTokens: CSM_THIN_RUNTIME_CONTRACT.maxOutputTokens,
    estimatedTokensPerAttempt: CSM_THIN_RUNTIME_CONTRACT.estimatedTokensPerAttempt,
    providerTimeoutMs: CSM_THIN_RUNTIME_CONTRACT.providerTimeoutMs,
    capabilities: CSM_ACTIVE_MODEL_PROFILE.capabilities
  });
  const futureExecutionSha256 = buildCsmModelExecutionContractSha256({
    profile: futureProfile,
    semanticPromptVersion: CSM_DIRECT_PROMPT_VERSION,
    transportProfile: CSM_STAGED_TRANSPORT_PROFILE,
    imageUrls: csmExecutionContractImageUrls(1)
  });
  assert.equal(
    buildLunaDirectOperationKey(task),
    buildLunaDirectOperationKey({
      ...task,
      model: "future-model",
      reasoning_effort: "future-effort",
      prompt_version: CSM_DIRECT_PROMPT_VERSION,
      execution_contract_sha256: futureExecutionSha256
    }),
    "a profile change stays inside the same staged user operation"
  );
  assert.notEqual(
    buildLunaDirectPayloadHash(task),
    buildLunaDirectPayloadHash({
      ...task,
      model: "future-model",
      reasoning_effort: "future-effort",
      prompt_version: CSM_DIRECT_PROMPT_VERSION,
      execution_contract_sha256: futureExecutionSha256
    }),
    "but the changed paid execution must conflict instead of replaying the old checkpoint"
  );
}

// A staged resume receipt is provider-incapable. It may recreate the deferred
// formal session and persist an already-paid checkpoint, but even a missing
// checkpoint may not enqueue, sign, prepare, or call the model.
{
  const originalManifestSha256 = "9".repeat(64);
  const task = {
    tenant_id: "tenant-1", intent_id: "resume-only", asset_id: "asset-1",
    model: CSM_THIN_RUNTIME_CONTRACT.model, detail: "high",
    reasoning_effort: CSM_THIN_RUNTIME_CONTRACT.reasoningEffort,
    prompt_version: CSM_DIRECT_PROMPT_VERSION,
    estimated_tokens: CSM_DIRECT_ESTIMATED_TOKENS,
    image_fingerprints: [`sha256:${IMAGE_HASH}`],
    operation_scope: "derived_checkpoint",
    lane_version: STAGED_RECOGNITION_LANE_VERSION,
    original_manifest_sha256: originalManifestSha256,
    recognition_fingerprints: [`sha256:${IMAGE_HASH}`],
    execution_contract_sha256: CURRENT_STAGED_EXECUTION_SHA256,
    resolution_contract_sha256: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.contract_sha256
  };
  const operationKey = buildLunaDirectOperationKey(task);
  const payloadHash = buildLunaDirectPayloadHash(task);
  const sessionId = deterministicCsmSessionId(operationKey);
  const recognitionInput = [{
    image_role: "front_original",
    read: "readability_derived",
    bytes: 700_000,
    original_bytes: 7_000_000,
    derived_available: true,
    derived_bytes: 700_000,
    source_image_id: "front",
    transform_version: "readability-downscale-v1",
    lane_version: STAGED_RECOGNITION_LANE_VERSION,
    content_sha256: "d".repeat(64),
    original_content_sha256: IMAGE_HASH
  }];
  const checkpoint = buildCsmPersistenceCheckpoint({
    prepared: {
      ...preparedResult(sessionId, "Resume-only title"),
      execution_contract_sha256: task.execution_contract_sha256,
      model: task.model,
      requested_effort: task.reasoning_effort,
      image_detail: task.detail,
      prompt_version: task.prompt_version
    },
    tenantId: "tenant-1",
    operationKey,
    payloadHash,
    recognitionSessionId: sessionId,
    recognitionSessionDeferred: true,
    recognitionInput,
    executionContractSha256: task.execution_contract_sha256,
    resolutionContractSha256: task.resolution_contract_sha256,
    operationScope: "derived_checkpoint"
  });
  assert.equal(
    checkpoint.csm_persistence_checkpoint.schema_version,
    CSM_PERSISTENCE_CHECKPOINT_DERIVED_VERSION
  );
  assert.equal(
    checkpoint.csm_persistence_checkpoint.execution_contract_sha256,
    task.execution_contract_sha256
  );
  assert.equal(validateCsmPersistenceCheckpoint(checkpoint, {
    tenantId: "tenant-1",
    operationKey,
    payloadHash,
    recognitionSessionId: sessionId,
    executionContractSha256: task.execution_contract_sha256,
    resolutionContractSha256: task.resolution_contract_sha256,
    operationScope: "derived_checkpoint"
  }).title, checkpoint.title);
  assert.throws(() => validateCsmPersistenceCheckpoint(checkpoint, {
    tenantId: "tenant-1",
    operationKey,
    payloadHash,
    recognitionSessionId: sessionId,
    executionContractSha256: "e".repeat(64),
    operationScope: "derived_checkpoint"
  }), (error) => error.code === "csm_persistence_checkpoint_invalid"
    && error.detail === "execution_contract_sha256_mismatch");
  assert.throws(() => validateCsmPersistenceCheckpoint(checkpoint, {
    tenantId: "tenant-1", operationKey, payloadHash, recognitionSessionId: sessionId,
    executionContractSha256: task.execution_contract_sha256
  }), (error) => error.code === "csm_persistence_checkpoint_invalid"
    && error.detail === "marker_missing",
  "an ordinary resume may not adopt a staged checkpoint version");
  const missingExecutionReceipt = structuredClone(checkpoint);
  delete missingExecutionReceipt.csm_persistence_checkpoint.execution_contract_sha256;
  assert.throws(() => validateCsmPersistenceCheckpoint(missingExecutionReceipt, {
    tenantId: "tenant-1",
    operationKey,
    payloadHash,
    recognitionSessionId: sessionId,
    executionContractSha256: task.execution_contract_sha256,
    operationScope: "derived_checkpoint"
  }), (error) => error.code === "csm_persistence_checkpoint_invalid"
    && error.detail === "execution_contract_sha256_mismatch");
  let lookups = 0;
  const events = [];
  let sessionPayload = null;
  let persistRuntime = null;
  const authority = {
    globallyEnforced: true,
    lookupOperationResult: async ({ operationKey: actualOperationKey, payloadHash: actualPayloadHash }) => {
      lookups += 1;
      assert.equal(actualOperationKey, operationKey);
      assert.equal(actualPayloadHash, payloadHash,
        "resume lookup identity must survive the current deployment runtime");
      return { status: "found", result: checkpoint };
    },
    enqueueAttempt: async () => { throw new Error("resume_must_not_enqueue"); },
    runAttempt: async () => { throw new Error("resume_must_not_run"); }
  };
  const dependencies = stagedSuccessfulDependencies({ events, authority });
  dependencies.operationScope = "derived_checkpoint";
  dependencies.laneVersion = STAGED_RECOGNITION_LANE_VERSION;
  dependencies.originalManifestSha256 = originalManifestSha256;
  dependencies.createSession = async ({ payload, reuseExistingSnapshot }) => {
    events.push("session");
    assert.equal(reuseExistingSnapshot, true,
      "a paid checkpoint resume must reuse the first durable session snapshot");
    sessionPayload = payload;
    return { persistence: { recognition_session: { saved: true } } };
  };
  dependencies.persistPath = async (args) => {
    events.push("persist_csm");
    persistRuntime = args;
    return {
      ...args.prepared,
      csm_persistence: { ok: true, atomic: true, session: { saved: true } }
    };
  };
  const resumed = await runDirectCsmAsset({
    tenantId: "tenant-1", userId: "user-1", assetId: "asset-1",
    intentId: "resume-only", resumeOnly: true,
    dependencies
  });
  assert.equal(resumed.title, "Resume-only title");
  assert.equal(lookups, 1);
  assert.deepEqual(events, ["readiness", "images", "session", "persist_csm"]);
  assert.equal(sessionPayload.provider, task.model);
  assert.deepEqual(sessionPayload.recognition_input, recognitionInput);
  assert.equal(persistRuntime.model, task.model);
  assert.equal(persistRuntime.effort, task.reasoning_effort);
  assert.equal(persistRuntime.promptVersion, task.prompt_version);
  assert.doesNotMatch(JSON.stringify(checkpoint), /staged-unverified/,
    "authority checkpoints and marketplace output may not persist placeholder paths");

  let enqueueCalls = 0;
  await assert.rejects(runDirectCsmAsset({
    tenantId: "tenant-1", userId: "user-1", assetId: "asset-1",
    intentId: "resume-missing", resumeOnly: true,
    dependencies: {
      ...stagedSuccessfulDependencies({
        authority: {
          globallyEnforced: true,
          lookupOperationResult: async () => ({ status: "not_found" }),
          enqueueAttempt: async () => { enqueueCalls += 1; },
          runAttempt: async () => { enqueueCalls += 1; }
        }
      }),
      operationScope: "derived_checkpoint",
      laneVersion: STAGED_RECOGNITION_LANE_VERSION,
      originalManifestSha256,
      signImage: async () => { throw new Error("resume_must_not_sign"); },
      preparePath: async () => { throw new Error("resume_must_not_prepare"); }
    }
  }), (error) => error.code === "csm_resume_not_found"
    && error.retryable === true
    && error.provider_attempt_started === false
    && error.recovery_action === "STAGED_FRESH_RETRY");
  assert.equal(enqueueCalls, 0);

  const historicalStagedProfile = buildCsmModelProfile({
    id: "historical-staged-profile-v1",
    provider: "openai",
    accountScope: "historical-account-scope",
    model: "historical-staged-model",
    promptStyleVersion: CSM_NEUTRAL_PROMPT_STYLE_VERSION,
    optimizationPack: null,
    reasoningEffort: "low",
    imageDetail: "original",
    maxOutputTokens: CSM_THIN_RUNTIME_CONTRACT.maxOutputTokens,
    estimatedTokensPerAttempt: CSM_THIN_RUNTIME_CONTRACT.estimatedTokensPerAttempt,
    providerTimeoutMs: CSM_THIN_RUNTIME_CONTRACT.providerTimeoutMs,
    capabilities: CSM_ACTIVE_MODEL_PROFILE.capabilities
  });
  const historicalStagedContract = structuredClone(buildCsmModelExecutionContract({
    profile: historicalStagedProfile,
    semanticPromptVersion: CSM_DIRECT_PROMPT_VERSION,
    transportProfile: CSM_STAGED_TRANSPORT_PROFILE,
    imageUrls: csmExecutionContractImageUrls(1)
  }));
  historicalStagedContract.provider_adapter_version = "historical-openai-adapter-v1";
  historicalStagedContract.provider_adapter_sha256 = "8".repeat(64);
  historicalStagedContract.request_builder_version = "historical-request-builder-v1";
  historicalStagedContract.response_parser_version = "historical-response-parser-v1";
  const historicalStagedExecutionSha256 = sha256ExecutionContractValue(
    historicalStagedContract
  );
  const historicalStagedTask = {
    ...task,
    model: historicalStagedContract.model,
    detail: historicalStagedContract.image_detail,
    reasoning_effort: historicalStagedContract.requested_effort,
    prompt_version: historicalStagedContract.semantic_prompt_version,
    lane_version: "readability-derived-inline-v1",
    execution_contract_sha256: historicalStagedExecutionSha256
  };
  assert.equal(buildLunaDirectOperationKey(historicalStagedTask), operationKey);
  const historicalStagedPayloadHash = buildLunaDirectPayloadHash(historicalStagedTask);
  assert.notEqual(historicalStagedPayloadHash, payloadHash);
  const historicalStagedPrepared = {
    ...preparedResult(sessionId, "Historical staged title"),
    provider: historicalStagedContract.provider,
    requested_model: historicalStagedContract.model,
    model: historicalStagedContract.model,
    requested_effort: historicalStagedContract.requested_effort,
    image_detail: historicalStagedContract.image_detail,
    prompt_version: historicalStagedContract.semantic_prompt_version,
    max_output_tokens: historicalStagedContract.max_output_tokens,
    model_profile_id: historicalStagedContract.model_profile_id,
    optimization_pack_id: historicalStagedContract.optimization_pack_id,
    optimization_pack_sha256: historicalStagedContract.optimization_pack_sha256,
    provider_adapter_version: historicalStagedContract.provider_adapter_version,
    request_builder_version: historicalStagedContract.request_builder_version,
    response_parser_version: historicalStagedContract.response_parser_version,
    execution_contract_sha256: historicalStagedExecutionSha256,
    execution_contract: historicalStagedContract
  };
  const historicalStagedCheckpoint = buildCsmPersistenceCheckpoint({
    prepared: historicalStagedPrepared,
    tenantId: "tenant-1",
    operationKey,
    payloadHash: historicalStagedPayloadHash,
    recognitionSessionId: sessionId,
    recognitionInput,
    executionContractSha256: historicalStagedExecutionSha256,
    operationScope: "derived_checkpoint"
  });
  let profileConflictBoundaryCalls = 0;
  const profileConflictEvents = [];
  const profileConflictResult = await runDirectCsmAsset({
    tenantId: "tenant-1", userId: "user-1", assetId: "asset-1",
    intentId: task.intent_id, resumeOnly: true,
    dependencies: {
      ...stagedSuccessfulDependencies({
        events: profileConflictEvents,
        authority: {
          globallyEnforced: true,
          lookupOperationResult: async () => {
            throw Object.assign(new Error("operation_payload_conflict"), {
              code: "operation_payload_conflict",
              statusCode: 409,
              retryable: false,
              provider_attempt_started: false
            });
          },
          lookupOperationResultByKey: async () => ({
            status: "found",
            payloadHash: historicalStagedPayloadHash,
            result: historicalStagedCheckpoint,
            latestAttempt: 1
          }),
          enqueueAttempt: async () => { profileConflictBoundaryCalls += 1; },
          runAttempt: async () => { profileConflictBoundaryCalls += 1; }
        }
      }),
      operationScope: "derived_checkpoint",
      laneVersion: STAGED_RECOGNITION_LANE_VERSION,
      originalManifestSha256,
      signImage: async () => { profileConflictBoundaryCalls += 1; },
      preparePath: async () => { profileConflictBoundaryCalls += 1; }
    }
  });
  assert.equal(profileConflictResult.title, "Historical staged title");
  assert.equal(profileConflictBoundaryCalls, 0,
    "a staged execution-contract conflict must recover without sign or provider work");
  assert.deepEqual(profileConflictEvents, ["readiness", "images", "persist_csm"]);

  let initialProfileConflictBoundaryCalls = 0;
  const initialProfileConflictEvents = [];
  const initialProfileConflictAuthorityEvents = [];
  const initialProfileConflictResult = await runDirectCsmAsset({
    tenantId: "tenant-1", userId: "user-1", assetId: "asset-1",
    intentId: task.intent_id,
    dependencies: {
      ...stagedSuccessfulDependencies({
        events: initialProfileConflictEvents,
        authority: {
          globallyEnforced: true,
          enqueueAttempt: async () => {
            initialProfileConflictAuthorityEvents.push("enqueue_conflict");
            throw Object.assign(new Error("operation_payload_conflict"), {
              code: "operation_payload_conflict",
              statusCode: 409,
              retryable: false,
              provider_attempt_started: false
            });
          },
          runAttempt: async ({ queuedAttempt }) => {
            initialProfileConflictAuthorityEvents.push("run_without_execute");
            return queuedAttempt;
          },
          lookupOperationResultByKey: async () => {
            initialProfileConflictAuthorityEvents.push("lookup_by_key");
            return {
              status: "found",
              payloadHash: historicalStagedPayloadHash,
              result: historicalStagedCheckpoint,
              latestAttempt: 1
            };
          }
        }
      }),
      operationScope: "derived_checkpoint",
      laneVersion: STAGED_RECOGNITION_LANE_VERSION,
      originalManifestSha256,
      signImage: async () => { initialProfileConflictBoundaryCalls += 1; },
      preparePath: async () => { initialProfileConflictBoundaryCalls += 1; }
    }
  });
  assert.equal(initialProfileConflictResult.title, "Historical staged title");
  assert.equal(initialProfileConflictBoundaryCalls, 0);
  assert.deepEqual(initialProfileConflictAuthorityEvents, [
    "enqueue_conflict", "run_without_execute", "lookup_by_key"
  ]);
  assert.deepEqual(initialProfileConflictEvents, ["readiness", "images", "persist_csm"]);

  for (const historicalStatus of ["pending", "ambiguous", "failed", "cancelled", "not_found"]) {
    let forbiddenHistoricalBoundaryCalls = 0;
    await assert.rejects(runDirectCsmAsset({
      tenantId: "tenant-1", userId: "user-1", assetId: "asset-1",
      intentId: task.intent_id, resumeOnly: true,
      dependencies: {
        ...stagedSuccessfulDependencies({
          authority: {
            globallyEnforced: true,
            lookupOperationResult: async () => {
              throw Object.assign(new Error("operation_payload_conflict"), {
                code: "operation_payload_conflict",
                statusCode: 409,
                retryable: false,
                provider_attempt_started: false
              });
            },
            lookupOperationResultByKey: async () => ({ status: historicalStatus }),
            enqueueAttempt: async () => { forbiddenHistoricalBoundaryCalls += 1; },
            runAttempt: async () => { forbiddenHistoricalBoundaryCalls += 1; }
          }
        }),
        operationScope: "derived_checkpoint",
        laneVersion: STAGED_RECOGNITION_LANE_VERSION,
        originalManifestSha256,
        signImage: async () => { forbiddenHistoricalBoundaryCalls += 1; },
        preparePath: async () => { forbiddenHistoricalBoundaryCalls += 1; }
      }
    }), (error) => error.code === `csm_legacy_payload_${historicalStatus}`
      && error.statusCode === 409
      && error.recovery_action === "STAGED_RESUME_ONLY"
      && error.provider_attempt_started === false);
    assert.equal(forbiddenHistoricalBoundaryCalls, 0,
      `historical staged ${historicalStatus} must remain provider-incapable`);
  }

  for (const status of ["pending", "ambiguous", "failed"]) {
    let forbiddenBoundaryCalls = 0;
    await assert.rejects(runDirectCsmAsset({
      tenantId: "tenant-1", userId: "user-1", assetId: "asset-1",
      intentId: `resume-${status}`, resumeOnly: true,
      dependencies: {
        ...stagedSuccessfulDependencies({
          authority: {
            globallyEnforced: true,
            lookupOperationResult: async () => ({ status }),
            enqueueAttempt: async () => { forbiddenBoundaryCalls += 1; },
            runAttempt: async () => { forbiddenBoundaryCalls += 1; }
          }
        }),
        operationScope: "derived_checkpoint",
        laneVersion: STAGED_RECOGNITION_LANE_VERSION,
        originalManifestSha256,
        signImage: async () => { forbiddenBoundaryCalls += 1; },
        preparePath: async () => { forbiddenBoundaryCalls += 1; }
      }
    }), (error) => error.code === `csm_resume_${status}`
      && error.recovery_action === "STAGED_RESUME_ONLY"
      && error.provider_attempt_started === false
      && error.retryable === ["pending", "ambiguous"].includes(status));
    assert.equal(forbiddenBoundaryCalls, 0,
      `${status} resume lookup must not enqueue, sign, prepare, or call provider`);
  }

  for (const providerAttemptStarted of [false, true, undefined]) {
    const dispatchFailure = Object.assign(new Error("durable_dispatch_response_lost"), {
      retryable: true,
      ...(providerAttemptStarted === undefined ? {} : { provider_attempt_started: providerAttemptStarted })
    });
    await assert.rejects(runDirectCsmAsset({
      tenantId: "tenant-1", userId: "user-1", assetId: "asset-1",
      intentId: `dispatch-throw-${String(providerAttemptStarted)}`,
      dependencies: {
        ...stagedSuccessfulDependencies({ authority: passthroughAuthority() }),
        operationScope: "derived_checkpoint",
        laneVersion: STAGED_RECOGNITION_LANE_VERSION,
        originalManifestSha256,
        createDispatcher: () => ({
          enqueue: async () => { throw dispatchFailure; },
          manualRetry: async () => { throw new Error("unexpected_manual_retry"); }
        })
      }
    }), (error) => error === dispatchFailure
      && error.recovery_action === "STAGED_RESUME_ONLY",
    "after durable dispatch is touched, uncertainty always recovers through lookup-only");
  }
}

// Normal compressed-image recovery keeps the first durable session snapshot.
// A support crop may have appeared after that insert and before the HTTP
// response was lost, but replay uses the already-paid checkpoint, performs no
// provider work, and never tries to rebuild the same session ID from the newer
// canonical projection.
{
  const originalCanonical = canonicalImages();
  const supportCropReference = {
    image_id: "front-name-crop",
    image_role: "nameplate_crop",
    bucket: "cards",
    object_path: "tenant-1/front-name-crop.jpg",
    content_sha256: "e".repeat(64),
    derived: true,
    source_image_id: "front",
    source_region: "nameplate"
  };
  const expandedCanonical = {
    ...originalCanonical,
    image_set_sha256: "f".repeat(64),
    image_references: [...originalCanonical.image_references, supportCropReference],
    images: [...originalCanonical.images, {
      image_id: supportCropReference.image_id,
      objectPath: supportCropReference.object_path,
      bucket: supportCropReference.bucket,
      size: 200,
      storageRole: supportCropReference.image_role,
      derived: true,
      source_image_id: "front",
      content_sha256: supportCropReference.content_sha256
    }]
  };
  const task = ordinaryTask("normal-response-loss");
  const operationKey = buildLunaDirectOperationKey(task);
  const payloadHash = buildLunaDirectPayloadHash(task);
  const sessionId = deterministicCsmSessionId(operationKey);
  const recognitionInput = [{
    image_role: "front_original",
    read: "original",
    bytes: 1_000,
    original_bytes: 1_000,
    derived_available: false,
    derived_bytes: null
  }];
  const checkpoint = buildCsmPersistenceCheckpoint({
    prepared: {
      ...preparedResult(sessionId, "Recovered normal title"),
      execution_contract_sha256: task.execution_contract_sha256,
      model: task.model,
      requested_effort: task.reasoning_effort,
      image_detail: task.detail,
      prompt_version: task.prompt_version
    },
    tenantId: "tenant-1",
    operationKey,
    payloadHash,
    recognitionSessionId: sessionId,
    recognitionSessionDeferred: true,
    recognitionInput,
    executionContractSha256: task.execution_contract_sha256,
    resolutionContractSha256: task.resolution_contract_sha256
  });
  const firstSession = buildCsmRecognitionSessionRow({
    sessionId,
    tenantId: "tenant-1",
    userId: "user-1",
    operatorId: "user-1",
    routePlan: { route: "CSM_THIN_DIRECT", route_reason: "cloud_run_retired" },
    payload: {
      asset_id: "asset-1",
      client_asset_ref: "asset-1",
      images: originalCanonical.image_references,
      image_references: originalCanonical.image_references,
      image_generation_id: originalCanonical.image_generation_id,
      image_set_sha256: originalCanonical.image_set_sha256,
      expected_original_count: originalCanonical.expected_original_count,
      recognition_input: recognitionInput,
      provider: task.model,
      mode: "csm_thin_direct"
    }
  });
  let sessionWrites = 0;
  let providerCalls = 0;
  let persistenceCalls = 0;
  const events = [];
  const result = await runDirectCsmAsset({
    tenantId: "tenant-1",
    userId: "user-1",
    assetId: "asset-1",
    intentId: task.intent_id,
    dependencies: {
      checkReadiness: async () => { events.push("readiness"); return { ready: true }; },
      readImages: async () => { events.push("images-expanded"); return expandedCanonical; },
      signImage: async () => { throw new Error("checkpoint_resume_must_not_sign"); },
      createSession: async (args) => {
        events.push("reuse-first-session");
        return createCsmRecognitionSession({
          ...args,
          env: {
            SUPABASE_URL: "https://example.supabase.co",
            SUPABASE_SECRET_KEY: "sb_secret_test"
          },
          fetchImpl: async (_url, init = {}) => {
            if (init.method === "POST") sessionWrites += 1;
            return new Response(JSON.stringify([firstSession]), { status: 200 });
          }
        });
      },
      preparePath: async () => { providerCalls += 1; throw new Error("checkpoint_resume_must_not_prepare"); },
      persistPath: async ({ prepared }) => {
        events.push("persist");
        persistenceCalls += 1;
        return {
          ...prepared,
          csm_persistence: { ok: true, atomic: true, session: { saved: true } }
        };
      },
      createDispatcher: () => ({
        enqueue: async () => checkpoint,
        manualRetry: async () => { throw new Error("unexpected_manual_retry"); }
      }),
      providerAdmission: passthroughAuthority()
    }
  });
  assert.equal(result.title, "Recovered normal title");
  assert.deepEqual(events, ["readiness", "images-expanded", "reuse-first-session", "persist"]);
  assert.equal(providerCalls, 0);
  assert.equal(sessionWrites, 0,
    "resume must not issue a latest-canonical insert for an existing deterministic session");
  assert.equal(persistenceCalls, 1);
}

// Upload failure after provider settlement is the critical staged-lane loss
// case. The first request leaves only the durable provider checkpoint; the
// resume request may finish the verified-original session and CSM persistence,
// but it must not sign or call the provider again.
{
  const originalHash = "6".repeat(64);
  const derivedHash = "7".repeat(64);
  const originalManifestSha256 = "8".repeat(64);
  const identityCanonical = {
    asset_id: "asset-1",
    image_generation_id: "asset-1",
    image_set_sha256: "9".repeat(64),
    expected_original_count: 1,
    image_references: [{
      image_id: "front",
      image_role: "front_original",
      bucket: "staged-unverified",
      object_path: "staged-unverified/front",
      content_sha256: originalHash,
      derived: false
    }],
    images: [{
      image_id: "front",
      objectPath: "staged-unverified/front",
      bucket: "staged-unverified",
      storageRole: "image_1_original",
      size: 7_000_000,
      derived: false,
      content_sha256: originalHash
    }]
  };
  const verifiedCanonical = {
    tenant_id: "tenant-1",
    asset_id: "asset-1",
    image_generation_id: "asset-1",
    image_set_sha256: "a".repeat(64),
    expected_original_count: 1,
    images: [{
      image_id: "front",
      storageRole: "image_1_original",
      size: 7_000_000,
      content_sha256: originalHash,
      derived: false
    }],
    image_references: [{
      image_id: "front",
      image_role: "front_original",
      bucket: "listing-images",
      object_path: "tenants/tenant-1/listing-assets/2026-08-09/asset-1/front.jpg",
      content_sha256: originalHash,
      derived: false
    }]
  };
  const recognitionInput = [{
    image_role: "front_original",
    read: "readability_derived",
    bytes: 700_000,
    original_bytes: 7_000_000,
    derived_available: true,
    derived_bytes: 700_000,
    source_image_id: "front",
    transform_version: "readability-downscale-v1",
    lane_version: STAGED_RECOGNITION_LANE_VERSION,
    content_sha256: derivedHash,
    original_content_sha256: originalHash
  }];
  let durableCheckpoint = null;
  let deferredSessionArgs = null;
  let uploadReady = false;
  let providerCalls = 0;
  let formalSessionCreates = 0;
  let persistenceCalls = 0;
  let resumedSessionPayload = null;
  const authority = {
    globallyEnforced: true,
    lookupOperationResult: async () => durableCheckpoint
      ? { status: "found", result: durableCheckpoint }
      : { status: "not_found" },
    enqueueAttempt: async (metadata) => metadata,
    runAttempt: async ({ queuedAttempt, execute }) => {
      await queuedAttempt;
      durableCheckpoint = await execute();
      return durableCheckpoint;
    }
  };
  const dependencies = {
    checkReadiness: async () => ({ ready: true }),
    readImages: async () => identityCanonical,
    chooseRecognitionImages: () => ({
      images: [{
        image_id: "front-recognition",
        objectPath: "inline/front-recognition.jpg",
        bucket: "inline",
        size: 700_000,
        derived: true,
        content_sha256: derivedHash
      }],
      read: recognitionInput
    }),
    transportProfile: CSM_STAGED_TRANSPORT_PROFILE,
    operationScope: "derived_checkpoint",
    laneVersion: STAGED_RECOGNITION_LANE_VERSION,
    originalManifestSha256,
    deferRecognitionSessionUntilPersistence: true,
    signImage: async () => "data:image/jpeg;base64,derived",
    createSession: async (args) => {
      deferredSessionArgs = args;
      return { persistence: { recognition_session: { saved: true, deferred: true } } };
    },
    preparePath: async ({ recognitionSessionId }) => {
      providerCalls += 1;
      return {
        ...preparedResult(recognitionSessionId, "Recovered staged title"),
        execution_contract_sha256: CURRENT_STAGED_EXECUTION_SHA256,
        model: "model-before-deployment-drift",
        requested_effort: "effort-before-deployment-drift",
        image_detail: "high",
        prompt_version: "prompt-before-deployment-drift"
      };
    },
    persistPath: async ({ prepared, model, effort, promptVersion }) => {
      persistenceCalls += 1;
      if (!uploadReady) {
        throw Object.assign(new Error("staged_original_upload_timeout:not_ready"), {
          code: "staged_original_upload_timeout",
          statusCode: 504,
          retryable: true
        });
      }
      const bound = bindStagedSessionToVerifiedCanonical({
        deferredSessionArgs,
        verifiedCanonical,
        recognitionRead: prepared.csm_persistence_checkpoint.recognition_input
      });
      formalSessionCreates += 1;
      resumedSessionPayload = bound.payload;
      assert.equal(model, "model-before-deployment-drift");
      assert.equal(effort, "effort-before-deployment-drift");
      assert.equal(promptVersion, "prompt-before-deployment-drift");
      return {
        ...prepared,
        csm_persistence: { ok: true, atomic: true, session: { saved: true } }
      };
    },
    providerAdmission: authority
  };

  await assert.rejects(
    runDirectCsmAsset({
      tenantId: "tenant-1", userId: "user-1", assetId: "asset-1",
      intentId: "staged-upload-loss", dependencies
    }),
    (error) => error.code === "staged_original_upload_timeout"
      && error.retryable === true
  );
  assert.equal(providerCalls, 1);
  assert.equal(formalSessionCreates, 0,
    "an unverified upload may not create the formal recognition session");
  assert.ok(durableCheckpoint?.csm_persistence_checkpoint,
    "provider settlement must leave a stable persistence checkpoint");

  uploadReady = true;
  const resumed = await runDirectCsmAsset({
    tenantId: "tenant-1", userId: "user-1", assetId: "asset-1",
    intentId: "staged-upload-loss", resumeOnly: true, dependencies
  });
  assert.equal(resumed.title, "Recovered staged title");
  assert.equal(providerCalls, 1,
    "upload recovery and deployment-drift replay must add zero provider calls");
  assert.equal(persistenceCalls, 2);
  assert.equal(formalSessionCreates, 1);
  assert.deepEqual(resumedSessionPayload.images, verifiedCanonical.image_references);
  assert.deepEqual(resumedSessionPayload.image_references, verifiedCanonical.image_references);
  assert.equal(resumedSessionPayload.image_set_sha256, verifiedCanonical.image_set_sha256);
  assert.deepEqual(resumedSessionPayload.recognition_input, recognitionInput);
  assert.doesNotMatch(JSON.stringify(resumedSessionPayload), /staged-unverified/);
}

let paidCalls = 0;
await assert.rejects(
  runDirectCsmAsset({
    tenantId: "tenant-1",
    userId: "user-1",
    assetId: "asset-1",
    intentId: "intent-1",
    callProvider: async () => { paidCalls += 1; },
    dependencies: {
      checkReadiness: async () => ({ ready: false, reason: "registry_missing" }),
      readImages: async () => { throw new Error("must_not_read_images"); }
    }
  }),
  /csm_persistence_not_ready:registry_missing/,
  "an unavailable CSM trace store must fail before image reads and model spend"
);
assert.equal(paidCalls, 0, "readiness failure must incur zero paid provider calls");

await assert.rejects(
  runDirectCsmAsset({
    tenantId: "tenant-1",
    userId: "user-1",
    assetId: "asset-1",
    intentId: "staged-readiness",
    callProvider: async () => { paidCalls += 1; },
    dependencies: {
      transportProfile: CSM_STAGED_TRANSPORT_PROFILE,
      operationScope: "derived_checkpoint",
      laneVersion: STAGED_RECOGNITION_LANE_VERSION,
      originalManifestSha256: "f".repeat(64),
      checkReadiness: async () => ({ ready: false, reason: "registry_missing" }),
      readImages: async () => { throw new Error("must_not_read_images"); }
    }
  }),
  (error) => error.recovery_action === "STAGED_FRESH_RETRY"
    && error.provider_attempt_started === false
    && error.retryable === true,
  "only the explicit pre-authority readiness boundary may direct a fresh staged retry"
);
assert.equal(paidCalls, 0);

await assert.rejects(
  runDirectCsmAsset({
    tenantId: "tenant-1",
    userId: "user-1",
    assetId: "asset-1",
    intentId: "intent-1",
    callProvider: async () => { paidCalls += 1; },
    dependencies: {
      checkReadiness: () => checkCsmDirectPreSpendReadiness({
        checkPersistence: async () => ({ ready: true }),
        checkProviderAuthority: async () => ({
          ready: false,
          reason: "provider_pacer_probe_contract_mismatch"
        })
      }),
      readImages: async () => { throw new Error("must_not_read_images"); }
    }
  }),
  /csm_persistence_not_ready:provider_pacer_probe_contract_mismatch/,
  "a stale provider pacer must fail before image reads and model spend"
);
assert.equal(paidCalls, 0, "a failed provider pacer preflight must incur zero paid calls");

// The durable attempt is enqueued before a signed URL exists. Its payload hash
// uses the verified content digest, while the session ID is derived from the
// stable operation key. URL rotation therefore cannot manufacture new work.
{
  const events = [];
  const authorityEvents = [];
  const authority = passthroughAuthority({ events: authorityEvents });
  const result = await runDirectCsmAsset({
    tenantId: "tenant-1",
    userId: "user-1",
    assetId: "asset-1",
    intentId: "intent-1",
    imageDetail: "original",
    callProvider: async () => { paidCalls += 1; return { ok: true }; },
    dependencies: successfulDependencies({ events, authority })
  });

  assert.equal(result.title, "Test title");
  assert.equal(result.execution_origin, "EXACT_REPLAY",
    "reaching an injected preparation seam without invoking its provider caller is not fresh");
  assert.equal(paidCalls, 0,
    "a synthetic preparation seam must not be mistaken for a provider attempt");
  assert.deepEqual(events, ["readiness", "images", "sign", "session", "model_and_csm", "persist_csm"]);
  assert.ok(result.latency_stages_ms.preflight_ms >= 0);
  assert.ok(result.latency_stages_ms.image_manifest_ms >= 0);
  assert.ok(result.latency_stages_ms.signed_url_ms >= 0);
  assert.ok(result.latency_stages_ms.recognition_session_ms >= 0);
  assert.ok(result.latency_stages_ms.provider_prepare_ms >= 0);
  assert.ok(result.latency_stages_ms.authority_dispatch_ms >= 0);
  assert.ok(result.latency_stages_ms.csm_persistence_ms >= 0);

  let freshProviderCalls = 0;
  const freshDependencies = successfulDependencies({
    authority: passthroughAuthority({ shallowWrapAfterSettle: true })
  });
  const syntheticPrepare = freshDependencies.preparePath;
  freshDependencies.preparePath = async (input) => {
    await input.callProvider({ type: "provider-boundary-test" });
    return syntheticPrepare(input);
  };
  freshDependencies.persistPath = async ({ prepared }) => {
    assert.equal(prepared.execution_origin, undefined,
      "delivery provenance stays HTTP-only and cannot rewrite the durable owner receipt");
    return {
      ...prepared,
      csm_persistence: { ok: true, atomic: true, session: { saved: true } }
    };
  };
  const fresh = await runDirectCsmAsset({
    tenantId: "tenant-1", userId: "user-1", assetId: "asset-1", intentId: "fresh-origin",
    callProvider: async () => { freshProviderCalls += 1; return { ok: true }; },
    dependencies: freshDependencies
  });
  assert.equal(freshProviderCalls, 1, "fresh origin requires exactly one current provider invocation");
  assert.equal(fresh.execution_origin, "FRESH_CURRENT");
  assert.deepEqual(fresh.provider_authority_receipt, {
    schema_version: CSM_PROVIDER_AUTHORITY_RECEIPT_VERSION,
    operation_key_sha256: createHash("sha256")
      .update(buildLunaDirectOperationKey(ordinaryTask("fresh-origin")))
      .digest("hex"),
    attempt: 1,
    attempt_class: "fresh",
    estimated_tokens: 6_500,
    claim_code: "admitted",
    settle_code: "settled",
    operation_status: "SUCCEEDED"
  }, "fresh HTTP delivery must project the database claim reservation");

  // A provider request may have started while the authority reconciles an
  // uncertain outcome.  A distinct settled object is intentionally not
  // promoted to fresh: only the exact checkpoint built by this request earns
  // that claim.
  let ambiguousProviderCalls = 0;
  const ambiguousDependencies = successfulDependencies({ authority: passthroughAuthority() });
  const ambiguousPrepare = ambiguousDependencies.preparePath;
  ambiguousDependencies.preparePath = async (input) => {
    await input.callProvider({ type: "provider-boundary-test" });
    return ambiguousPrepare(input);
  };
  ambiguousDependencies.createDispatcher = ({ executeTask }) => ({
    enqueue: async (task) => {
      const metadata = {
        operationKey: buildLunaDirectOperationKey(task),
        attempt: 1,
        attemptClass: "fresh",
        estimatedTokens: task.estimated_tokens
      };
      return {
        ...structuredClone(await executeTask({
          ...task,
          operation_key: metadata.operationKey,
          payload_hash: buildLunaDirectPayloadHash(task),
          attempt: metadata.attempt
        })),
        provider_authority_receipt: providerAuthorityReceipt(metadata)
      };
    },
    manualRetry: async () => { throw new Error("unexpected_manual_retry"); }
  });
  const ambiguousRecovery = await runDirectCsmAsset({
    tenantId: "tenant-1", userId: "user-1", assetId: "asset-1", intentId: "ambiguous-origin",
    callProvider: async () => { ambiguousProviderCalls += 1; return { ok: true }; },
    dependencies: ambiguousDependencies
  });
  assert.equal(ambiguousProviderCalls, 1,
    "ambiguous recovery may reconcile one started provider call, never purchase another");
  assert.equal(ambiguousRecovery.execution_origin, "AMBIGUOUS_PROVIDER_RECOVERY");
  assert.equal(ambiguousRecovery.provider_authority_receipt, undefined,
    "an ambiguous recovered object cannot inherit a fresh authority receipt");

  // The client's own stages must reach the record through THIS endpoint, not
  // only through ingest. Six production cards on 2026-08-06 recorded ten server
  // stages and zero client stages, so 6.1-9.6s of measured server work sat
  // against a writer-observed ~23s with the larger half unattributable. The
  // helper was private to the ingest handler, and the writer flow calls this
  // one.
  const withClient = await runDirectCsmAsset({
    tenantId: "tenant-1", userId: "user-1", assetId: "asset-1", intentId: "intent-2",
    imageDetail: "original",
    clientTiming: {
      client_preparation_ms: 8_400,
      client_sha256_ms: 610,
      client_staged_transform_ms: 9_999_999,
      client_upload_bytes: 11_238_422,
      not_a_client_key: 5,
      client_negative_ms: -1
    },
    callProvider: async () => ({ ok: true }),
    dependencies: successfulDependencies({ events: [], authority: passthroughAuthority({ events: [] }) })
  });
  assert.equal(withClient.latency_stages_ms.client_preparation_ms, 8_400);
  assert.equal(withClient.latency_stages_ms.client_sha256_ms, 610);
  assert.equal(withClient.latency_stages_ms.client_staged_transform_ms, 3_600_000,
    "untrusted client transform durations must retain the one-hour shape ceiling");
  // A byte count is not a duration. An hour-in-milliseconds ceiling silently
  // rewrote this exact upload to 3,600,000 and stored it as a size.
  assert.equal(withClient.latency_stages_ms.client_upload_bytes, 11_238_422);
  assert.equal(withClient.latency_stages_ms.not_a_client_key, undefined, "only client_ keys are accepted");
  assert.equal(withClient.latency_stages_ms.client_negative_ms, undefined, "negative values are refused");
  // Server stages still land alongside them.
  assert.ok(withClient.latency_stages_ms.provider_prepare_ms >= 0);

  // The ingest endpoint must pass client timings INTO the run, not merge them
  // onto the reply afterwards.
  //
  // This is the defect class, not just one line. `runDirectCsmAsset` writes
  // latency_stages_ms to the session itself, so anything merged after it
  // returns decorates the HTTP response and never reaches a column. Three
  // consecutive production batches recorded ten server stages and no client
  // stages for exactly this reason, and the absence was misdiagnosed twice
  // before the ordering was checked -- once as the client not sending, once as
  // the request taking the other endpoint. That second conclusion came from
  // "the row carries no ingest_ keys", which proves nothing: those keys are
  // added after the row is written too.
  const ingestSource = await readFile(new URL("../api/csm-listing-title-ingest.js", import.meta.url), "utf8");
  const callIndex = ingestSource.indexOf("runDirectCsmAsset({");
  assert.ok(callIndex > -1, "the ingest endpoint runs the direct asset path");
  const callBlock = ingestSource.slice(callIndex, ingestSource.indexOf("dependencies:", callIndex));
  assert.match(callBlock, /clientTiming:/,
    "client timings must be an argument to the run, since the run is what persists them");
  const dependencyBlock = ingestSource.slice(
    ingestSource.indexOf("dependencies:", callIndex),
    ingestSource.indexOf("const verifications", callIndex)
  );
  assert.match(dependencyBlock, /synchronizeBeforePersistence:/,
    "staged original verification must be a separately timed pre-persistence stage");
  const persistBlock = dependencyBlock.slice(dependencyBlock.indexOf("persistPath:"));
  assert.doesNotMatch(persistBlock, /await ensureStagedOriginals\(\)/,
    "csm_persistence_ms must not absorb the original-upload synchronization wait");
  assert.ok(result.latency_stages_ms.request_total_ms >= 0);
  assert.equal(result.provider_attempt_number, 1);
  assert.equal(result.provider_retry_count, 0);
  assert.equal(authorityEvents[0].type, "enqueue");
  assert.equal(authorityEvents[0].metadata.attempt, 1);
  assert.equal(authorityEvents[0].metadata.attemptClass, "fresh");
  assert.equal(authorityEvents[0].metadata.estimatedTokens, CSM_DIRECT_ESTIMATED_TOKENS);
  assert.match(authorityEvents[0].metadata.payloadHash, /^[0-9a-f]{64}$/);
  assert.equal(paidCalls, 0, "the injected CSM seam must not accidentally call the real provider");
}


// A slow original upload can be the staged route's critical path, but it is not
// CSM persistence. Deterministic time proves the two stages remain independent
// in both the persisted prepared packet and the response receipt.
{
  let clockMs = 10_000;
  const events = [];
  const dependencies = successfulDependencies({
    events,
    authority: passthroughAuthority()
  });
  dependencies.now = () => clockMs;
  dependencies.synchronizeBeforePersistence = async ({ prepared }) => {
    events.push("original_sync");
    assert.equal(prepared.latency_stages_ms.staged_original_sync_ms, undefined);
    clockMs += 9_000;
  };
  dependencies.persistPath = async ({ prepared }) => {
    events.push("persist_csm");
    assert.equal(prepared.latency_stages_ms.staged_original_sync_ms, 9_000,
      "the server-owned sync measurement must reach the persisted packet");
    clockMs += 700;
    return {
      ...prepared,
      csm_persistence: { ok: true, atomic: true, session: { saved: true } }
    };
  };
  const result = await runDirectCsmAsset({
    tenantId: "tenant-1",
    userId: "user-1",
    assetId: "asset-1",
    intentId: "independent-original-sync-timing",
    dependencies
  });
  assert.deepEqual(events, [
    "readiness", "images", "sign", "session", "model_and_csm", "original_sync", "persist_csm"
  ]);
  assert.equal(result.latency_stages_ms.staged_original_sync_ms, 9_000);
  assert.equal(result.latency_stages_ms.csm_persistence_ms, 700,
    "the persistence stage must exclude the preceding original sync wait");
  assert.equal(result.latency_stages_ms.request_total_ms, 9_700);
}

// Signed image reads and the durable recognition-session write are independent
// pre-provider work. They must start together so writer-visible latency pays
// for the slower boundary once instead of summing two network round trips.
{
  let sessionStarted = false;
  const authority = passthroughAuthority();
  const dependencies = successfulDependencies({ authority });
  dependencies.signImage = async () => {
    await Promise.resolve();
    assert.equal(sessionStarted, true, "recognition session creation must overlap signed URL creation");
    return "https://signed.invalid/a.jpg";
  };
  dependencies.createSession = async () => {
    sessionStarted = true;
    return { persistence: { recognition_session: { saved: true } } };
  };
  const result = await runDirectCsmAsset({
    tenantId: "tenant-1",
    userId: "user-1",
    assetId: "asset-1",
    intentId: "parallel-pre-provider-boundaries",
    dependencies
  });
  assert.equal(result.title, "Test title");
  assert.equal(result.asset_id, "asset-1",
    "the public direct result must bind the canonical asset used for recognition");
}

// A tenant-scoped manifest is the response authority. A mismatched manifest
// identity must stop before signing or provider use rather than echoing the
// client's requested asset into a successful direct response.
{
  const events = [];
  const dependencies = successfulDependencies({ events, authority: passthroughAuthority() });
  dependencies.readImages = async () => {
    events.push("images");
    return { ...canonicalImages(), asset_id: "asset-other" };
  };
  await assert.rejects(runDirectCsmAsset({
    tenantId: "tenant-1",
    userId: "user-1",
    assetId: "asset-1",
    intentId: "canonical-asset-mismatch",
    dependencies
  }), (error) => error.message === "canonical_asset_identity_mismatch"
    && error.statusCode === 409
    && error.retryable === false);
  assert.deepEqual(events, ["readiness", "images"]);
}

// A manual retry first resolves durable state. FAILED N becomes RETRY N+1;
// SUCCEEDED returns the stored result without signing or another provider call.
{
  const events = [];
  const authorityEvents = [];
  const failedAuthority = passthroughAuthority({
    events: authorityEvents,
    lookup: async () => ({ status: "failed", latestAttempt: 2, result: { code: "rate_limited" } })
  });
  const retried = await runDirectCsmAsset({
    tenantId: "tenant-1", userId: "user-1", assetId: "asset-1", intentId: "intent-1",
    manualRetry: true,
    dependencies: successfulDependencies({ events, authority: failedAuthority })
  });
  assert.equal(retried.title, "Test title");
  assert.equal(authorityEvents[0].metadata.attempt, 3);
  assert.equal(authorityEvents[0].metadata.attemptClass, "retry");

  const storedTask = ordinaryTask("intent-1");
  const storedSessionId = deterministicCsmSessionId(buildLunaDirectOperationKey(storedTask));
  const stored = {
    title: "Stored title",
    asset_id: "untrusted-stored-asset",
    csm_rows: { resolution: { recognition_session_id: storedSessionId } },
    csm_persistence: { ok: true, atomic: true, session: { saved: true } },
    provider_authority_receipt: providerAuthorityReceipt({
      operationKey: buildLunaDirectOperationKey(storedTask),
      attempt: 1,
      attemptClass: "fresh",
      estimatedTokens: CSM_DIRECT_ESTIMATED_TOKENS
    })
  };
  const replayEvents = [];
  const replayAuthority = passthroughAuthority({
    lookup: async () => ({ status: "found", latestAttempt: 1, result: stored })
  });
  const replay = await runDirectCsmAsset({
    tenantId: "tenant-1", userId: "user-1", assetId: "asset-1", intentId: "intent-1",
    manualRetry: true,
    dependencies: successfulDependencies({ events: replayEvents, authority: replayAuthority })
  });
  const { provider_authority_receipt: _storedAuthorityReceipt, ...publicStored } = stored;
  assert.deepEqual(replay, {
    ...publicStored,
    asset_id: "asset-1",
    execution_origin: "EXACT_REPLAY"
  });
  assert.equal(replay.provider_authority_receipt, undefined,
    "an exact replay must not present the original request's claim as current");
  assert.equal(stored.execution_origin, undefined,
    "serving a replay must not rewrite its durable historical receipt");
  assert.deepEqual(replayEvents, ["readiness", "images"],
    "an exact durable success must replay before signing or model execution");
}

// An unresolved ambiguous operation is never turned into a blind retry.
await assert.rejects(
  runDirectCsmAsset({
    tenantId: "tenant-1", userId: "user-1", assetId: "asset-1", intentId: "intent-1",
    manualRetry: true,
    dependencies: successfulDependencies({
      authority: passthroughAuthority({ lookup: async () => ({ status: "ambiguous" }) })
    })
  }),
  (error) => error.message === "csm_operation_ambiguous" && error.statusCode === 409,
  "the writer retry action must fail closed after an ambiguous provider boundary"
);

await assert.rejects(
  runDirectCsmAsset({
    tenantId: "tenant-1", userId: "user-1", assetId: "asset-1", intentId: "intent-1",
    dependencies: {
      ...successfulDependencies({ authority: passthroughAuthority() }),
      persistPath: async ({ prepared }) => ({
        ...prepared,
        csm_persistence: { ok: false, code: "immutable_session_conflict", statusCode: 409 }
      })
    }
  }),
  (error) => error.message === "immutable_session_conflict" && error.statusCode === 409,
  "even an injected path cannot turn persistence failure into a usable response"
);

await assert.rejects(
  runDirectCsmAsset({
    tenantId: "tenant-1", userId: "user-1", assetId: "asset-1", intentId: "intent-1",
    dependencies: {
      ...successfulDependencies({ authority: passthroughAuthority() }),
      persistPath: async ({ prepared }) => ({
        ...prepared,
        csm_persistence: { ok: true, atomic: false, session: { saved: true } }
      })
    }
  }),
  (error) => error.message === "csm_persistence_incomplete" && error.statusCode === 503,
  "the API must reject a successful-looking non-atomic transport"
);

// The paid result is settled as a tenant/operation/payload-bound checkpoint
// before CSM persistence. Both an ordinary request replay and the writer's
// manual retry can only re-run persistence; neither reaches prepare/model.
{
  let durable = null;
  let prepareCalls = 0;
  let persistCalls = 0;
  const events = [];
  const authority = passthroughAuthority({
    lookup: async () => durable
      ? { status: "found", latestAttempt: 1, result: durable }
      : { status: "not_found" }
  });
  authority.runAttempt = async ({ queuedAttempt, execute }) => {
    await queuedAttempt;
    if (durable) return durable;
    durable = await execute();
    return durable;
  };
  const dependencies = successfulDependencies({ events, authority });
  dependencies.preparePath = async ({ recognitionSessionId }) => {
    prepareCalls += 1;
    return {
      ...preparedResult(recognitionSessionId, "Resume title"),
      execution_contract_sha256: CURRENT_DIRECT_EXECUTION_SHA256
    };
  };
  dependencies.persistPath = async ({ prepared }) => {
    persistCalls += 1;
    if (persistCalls < 3) {
      throw Object.assign(new Error("csm_atomic_rpc_failed"), {
        code: "csm_atomic_rpc_failed", statusCode: 503
      });
    }
    return {
      ...prepared,
      csm_persistence: { ok: true, atomic: true, session: { saved: true } }
    };
  };

  const input = {
    tenantId: "tenant-1", userId: "user-1", assetId: "asset-1", intentId: "resume-intent",
    dependencies
  };
  await assert.rejects(runDirectCsmAsset(input), /csm_atomic_rpc_failed/);
  assert.equal(durable.csm_persistence_checkpoint.state, "PERSISTENCE_PENDING");
  assert.equal(durable.csm_persistence_checkpoint.tenant_id, "tenant-1");
  assert.match(durable.csm_persistence_checkpoint.payload_sha256, /^[0-9a-f]{64}$/);

  await assert.rejects(runDirectCsmAsset(input), /csm_atomic_rpc_failed/,
    "an ordinary HTTP retry must replay the durable checkpoint");
  const resumed = await runDirectCsmAsset({ ...input, manualRetry: true });
  assert.equal(resumed.title, "Resume title");
  assert.equal(resumed.csm_persistence_checkpoint, undefined,
    "the internal resume binding must not escape the public result");
  assert.equal(prepareCalls, 1, "persistence retries must never call the model/prepare boundary twice");
  assert.equal(persistCalls, 3);
  assert.equal(events.filter((event) => event === "sign").length, 1);
  assert.equal(events.filter((event) => event === "session").length, 1);
}

// The integrated ingest path deliberately defers its formal CSM session until
// Storage verifies the original bytes. If a cold retry receives the already
// paid checkpoint, executeTask does not run, so it must recreate that deferred
// boundary from the checkpoint before persistence rather than fail forever.
{
  const task = ordinaryTask("deferred-session-resume");
  const operationKey = buildLunaDirectOperationKey(task);
  const payloadHash = buildLunaDirectPayloadHash(task);
  const sessionId = deterministicCsmSessionId(operationKey);
  const durable = buildCsmPersistenceCheckpoint({
    prepared: {
      ...preparedResult(sessionId, "Deferred resume title"),
      execution_contract_sha256: task.execution_contract_sha256
    },
    tenantId: "tenant-1",
    operationKey,
    payloadHash,
    recognitionSessionId: sessionId,
    executionContractSha256: task.execution_contract_sha256,
    resolutionContractSha256: task.resolution_contract_sha256
  });
  const events = [];
  const authority = passthroughAuthority();
  authority.runAttempt = async ({ queuedAttempt }) => {
    await queuedAttempt;
    return durable;
  };
  const dependencies = successfulDependencies({ events, authority });
  dependencies.deferRecognitionSessionUntilPersistence = true;
  dependencies.createSession = async () => {
    events.push("session");
    return { persistence: { recognition_session: { saved: true, deferred: true } } };
  };
  const resumed = await runDirectCsmAsset({
    tenantId: "tenant-1", userId: "user-1", assetId: "asset-1",
    intentId: "deferred-session-resume", dependencies
  });
  assert.equal(resumed.title, "Deferred resume title");
  assert.deepEqual(events, ["readiness", "images", "session", "persist_csm"]);
  assert.ok(resumed.latency_stages_ms.recognition_session_replay_ms >= 0);
}

// The immediately previous effort+originals payload remains recoverable under
// the exact same operation key. Recovery is lookup-only and does not touch the
// signing, session, or provider boundaries.
{
  const task = ordinaryTask("legacy-current-hash-resume");
  const operationKey = buildLunaDirectOperationKey(task);
  const legacyPayloadHash = buildLegacyCurrentLunaDirectPayloadHash(task);
  const sessionId = deterministicCsmSessionId(operationKey);
  const durable = buildCsmPersistenceCheckpoint({
    prepared: preparedResult(sessionId, "Previous paid title"),
    tenantId: "tenant-1",
    operationKey,
    payloadHash: legacyPayloadHash,
    recognitionSessionId: sessionId
  });
  const mislabeledLegacy = {
    ...durable,
    execution_contract_sha256: task.execution_contract_sha256
  };
  assert.throws(() => validateCsmPersistenceCheckpoint(mislabeledLegacy, {
    tenantId: "tenant-1",
    operationKey,
    payloadHash: legacyPayloadHash,
    recognitionSessionId: sessionId
  }), (error) => error.code === "csm_persistence_checkpoint_invalid"
    && error.detail === "legacy_result_contains_execution_contract");
  const events = [];
  let lookups = 0;
  const authority = {
    globallyEnforced: true,
    lookupOperationResultByKey: async ({ operationKey: actualOperationKey }) => {
      lookups += 1;
      assert.equal(actualOperationKey, operationKey);
      return {
        status: "found", payloadHash: legacyPayloadHash,
        result: durable, latestAttempt: 1
      };
    },
    enqueueAttempt: async () => { throw new Error("legacy_must_not_enqueue"); },
    runAttempt: async () => { throw new Error("legacy_must_not_run"); }
  };
  const dependencies = successfulDependencies({ events, authority });
  dependencies.createDispatcher = () => ({
    enqueue: async () => {
      throw Object.assign(new Error("operation_payload_conflict"), {
        code: "operation_payload_conflict",
        provider_attempt_started: false
      });
    },
    manualRetry: async () => { throw new Error("unexpected_manual_retry"); }
  });
  const resumed = await runDirectCsmAsset({
    tenantId: "tenant-1", userId: "user-1", assetId: "asset-1",
    intentId: task.intent_id, dependencies
  });
  assert.equal(resumed.title, "Previous paid title");
  assert.equal(lookups, 1);
  assert.deepEqual(events, ["readiness", "images", "persist_csm"]);
}

// Older cross-deployment compatibility: if the immediately previous hash
// conflicts, inspect the exact pre-effort low hash next. A found paid
// checkpoint resumes persistence without signing or executing the provider.
{
  const task = ordinaryTask("legacy-hash-resume");
  const operationKey = buildLunaDirectOperationKey(task);
  const currentPayloadHash = buildLunaDirectPayloadHash(task);
  const legacyPayloadHash = buildLegacyLowLunaDirectPayloadHash(task);
  assert.notEqual(currentPayloadHash, legacyPayloadHash);
  const sessionId = deterministicCsmSessionId(operationKey);
  const durable = buildCsmPersistenceCheckpoint({
    prepared: preparedResult(sessionId, "Legacy paid title"),
    tenantId: "tenant-1",
    operationKey,
    payloadHash: legacyPayloadHash,
    recognitionSessionId: sessionId
  });
  const authorityEvents = [];
  const authority = {
    globallyEnforced: true,
    enqueueAttempt: async (metadata) => {
      authorityEvents.push({ type: "enqueue", payloadHash: metadata.payloadHash });
      throw Object.assign(new Error("operation_payload_conflict"), {
        code: "operation_payload_conflict",
        statusCode: 409,
        retryable: false,
        provider_attempt_started: false
      });
    },
    runAttempt: async ({ queuedAttempt }) => {
      authorityEvents.push({ type: "run" });
      await queuedAttempt;
      throw new Error("unreachable");
    },
    lookupOperationResultByKey: async ({ operationKey: actualOperationKey }) => {
      authorityEvents.push({ type: "lookup_by_key", operationKey: actualOperationKey });
      assert.equal(actualOperationKey, operationKey);
      return {
        status: "found", payloadHash: legacyPayloadHash,
        result: durable, latestAttempt: 1
      };
    }
  };
  const events = [];
  const resumed = await runDirectCsmAsset({
    tenantId: "tenant-1", userId: "user-1", assetId: "asset-1",
    intentId: "legacy-hash-resume",
    dependencies: successfulDependencies({ events, authority })
  });
  assert.equal(resumed.title, "Legacy paid title");
  assert.deepEqual(authorityEvents, [
    { type: "enqueue", payloadHash: currentPayloadHash },
    { type: "run" },
    { type: "lookup_by_key", operationKey }
  ]);
  assert.deepEqual(events, ["readiness", "images", "persist_csm"],
    "legacy recovery must perform zero sign, zero session recreation and zero provider work");
}

// Portable recovery is not a finite allowlist of Luna payload hashes. A future
// profile's execution-bound checkpoint keeps the same stable operation key and
// is recovered by key only. Its embedded historical contract validates against
// its own SHA, never against today's active profile or adapter registry.
{
  const task = ordinaryTask("portable-future-profile-resume");
  const operationKey = buildLunaDirectOperationKey(task);
  const futureProfile = buildCsmModelProfile({
    id: "future-neutral-profile-v1",
    provider: "openai",
    accountScope: "future-account-scope",
    model: "future-model",
    promptStyleVersion: CSM_NEUTRAL_PROMPT_STYLE_VERSION,
    optimizationPack: null,
    reasoningEffort: "low",
    imageDetail: "high",
    maxOutputTokens: CSM_THIN_RUNTIME_CONTRACT.maxOutputTokens,
    estimatedTokensPerAttempt: CSM_THIN_RUNTIME_CONTRACT.estimatedTokensPerAttempt,
    providerTimeoutMs: CSM_THIN_RUNTIME_CONTRACT.providerTimeoutMs,
    capabilities: CSM_ACTIVE_MODEL_PROFILE.capabilities
  });
  const futureContractOptions = {
    profile: futureProfile,
    semanticPromptVersion: CSM_DIRECT_PROMPT_VERSION,
    transportProfile: CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE,
    imageUrls: csmExecutionContractImageUrls(1)
  };
  const futureExecutionContract = structuredClone(
    buildCsmModelExecutionContract(futureContractOptions)
  );
  futureExecutionContract.provider_adapter_version = "future-openai-adapter-v9";
  futureExecutionContract.provider_adapter_sha256 = "9".repeat(64);
  futureExecutionContract.request_builder_version = "future-request-builder-v4";
  futureExecutionContract.response_parser_version = "future-response-parser-v3";
  const futureExecutionSha256 = sha256ExecutionContractValue(futureExecutionContract);
  const historicalTask = {
    ...task,
    model: futureProfile.model,
    reasoning_effort: futureProfile.reasoning_effort,
    execution_contract_sha256: futureExecutionSha256
  };
  assert.equal(buildLunaDirectOperationKey(historicalTask), operationKey);
  const historicalPayloadHash = buildLunaDirectPayloadHash(historicalTask);
  assert.notEqual(historicalPayloadHash, buildLunaDirectPayloadHash(task));
  const sessionId = deterministicCsmSessionId(operationKey);
  const historicalPrepared = {
    ...preparedResult(sessionId, "Portable historical title"),
    provider: futureExecutionContract.provider,
    requested_model: futureExecutionContract.model,
    model: futureExecutionContract.model,
    requested_effort: futureExecutionContract.requested_effort,
    image_detail: futureExecutionContract.image_detail,
    prompt_version: futureExecutionContract.semantic_prompt_version,
    max_output_tokens: futureExecutionContract.max_output_tokens,
    model_profile_id: futureExecutionContract.model_profile_id,
    provider_adapter_version: futureExecutionContract.provider_adapter_version,
    request_builder_version: futureExecutionContract.request_builder_version,
    response_parser_version: futureExecutionContract.response_parser_version,
    optimization_pack_id: futureExecutionContract.optimization_pack_id,
    optimization_pack_sha256: futureExecutionContract.optimization_pack_sha256,
    execution_contract_sha256: futureExecutionSha256,
    execution_contract: futureExecutionContract
  };
  const durable = buildCsmPersistenceCheckpoint({
    prepared: historicalPrepared,
    tenantId: "tenant-1",
    operationKey,
    payloadHash: historicalPayloadHash,
    recognitionSessionId: sessionId,
    executionContractSha256: futureExecutionSha256
  });
  durable.provider_authority_receipt = providerAuthorityReceipt({
    operationKey,
    attempt: 1,
    attemptClass: "fresh",
    estimatedTokens: CSM_DIRECT_ESTIMATED_TOKENS
  });
  const authorityEvents = [];
  const authority = {
    globallyEnforced: true,
    enqueueAttempt: async () => {
      authorityEvents.push("enqueue_conflict");
      throw Object.assign(new Error("operation_payload_conflict"), {
        code: "operation_payload_conflict", provider_attempt_started: false
      });
    },
    runAttempt: async ({ queuedAttempt }) => {
      authorityEvents.push("run_without_execute");
      await queuedAttempt;
    },
    lookupOperationResultByKey: async ({ operationKey: actualOperationKey }) => {
      authorityEvents.push("lookup_by_key");
      assert.equal(actualOperationKey, operationKey);
      return {
        status: "found",
        payloadHash: historicalPayloadHash,
        result: durable,
        latestAttempt: 1
      };
    }
  };
  const events = [];
  const resumed = await runDirectCsmAsset({
    tenantId: "tenant-1", userId: "user-1", assetId: "asset-1",
    intentId: task.intent_id,
    dependencies: successfulDependencies({ events, authority })
  });
  assert.equal(resumed.title, "Portable historical title");
  assert.equal(resumed.execution_origin, "HISTORICAL_KEY_RECOVERY");
  assert.equal(resumed.provider_authority_receipt, undefined,
    "historical key recovery cannot relabel an old claim as current admission");
  assert.deepEqual(authorityEvents, [
    "enqueue_conflict", "run_without_execute", "lookup_by_key"
  ]);
  assert.deepEqual(events, ["readiness", "images", "persist_csm"],
    "portable recovery must perform zero sign/session/provider work");

  const tampered = structuredClone(durable);
  tampered.execution_contract.model = "tampered-model";
  let persistenceCalls = 0;
  const tamperedDependencies = successfulDependencies({
    authority: {
      ...authority,
      lookupOperationResultByKey: async () => ({
        status: "found",
        payloadHash: historicalPayloadHash,
        result: tampered,
        latestAttempt: 1
      })
    }
  });
  tamperedDependencies.persistPath = async () => {
    persistenceCalls += 1;
    throw new Error("tampered_history_must_not_persist");
  };
  await assert.rejects(runDirectCsmAsset({
    tenantId: "tenant-1", userId: "user-1", assetId: "asset-1",
    intentId: task.intent_id,
    dependencies: tamperedDependencies
  }), (error) => error.code === "csm_persistence_checkpoint_invalid"
    && error.detail === "historical_execution_receipt_invalid");
  assert.equal(persistenceCalls, 0);
}

// Pending/ambiguous legacy operations remain provider-incapable and retryable;
// FAILED has no paid success checkpoint and stays terminal. None may reach the
// signing/model boundary.
for (const legacyStatus of ["pending", "ambiguous", "failed", "cancelled"]) {
  let lookupCalls = 0;
  let prepareCalls = 0;
  const authority = {
    globallyEnforced: true,
    enqueueAttempt: async () => {
      throw Object.assign(new Error("operation_payload_conflict"), {
        code: "operation_payload_conflict", provider_attempt_started: false
      });
    },
    runAttempt: async ({ queuedAttempt }) => queuedAttempt,
    lookupOperationResultByKey: async () => {
      lookupCalls += 1;
      return { status: legacyStatus };
    }
  };
  const dependencies = successfulDependencies({ authority });
  dependencies.preparePath = async () => { prepareCalls += 1; throw new Error("must_not_prepare"); };
  await assert.rejects(
    runDirectCsmAsset({
      tenantId: "tenant-1", userId: "user-1", assetId: "asset-1",
      intentId: `legacy-${legacyStatus}`, dependencies
    }),
    (error) => error.code === `csm_legacy_payload_${legacyStatus}`
      && error.retryable === ["pending", "ambiguous"].includes(legacyStatus)
      && error.provider_attempt_started === false
  );
  assert.equal(lookupCalls, 1);
  assert.equal(prepareCalls, 0);
}

// A healthy current-hash request does not pay a compatibility lookup RTT.
{
  let lookupCalls = 0;
  const events = [];
  const authority = passthroughAuthority({
    lookup: async () => { lookupCalls += 1; return { status: "not_found" }; }
  });
  await runDirectCsmAsset({
    tenantId: "tenant-1", userId: "user-1", assetId: "asset-1",
    intentId: "current-hash-clean-path",
    dependencies: successfulDependencies({ events, authority })
  });
  assert.equal(lookupCalls, 0, "the compatibility branch must add zero RTT to the current path");
  assert.equal(events.filter((event) => event === "model_and_csm").length, 1,
    "a fresh intent buys exactly one paid execution");
}

// An old persistence-shaped FAILED record has no recoverable provider output.
// It must remain failed closed rather than turning the writer button into a
// second paid attempt.
await assert.rejects(
  runDirectCsmAsset({
    tenantId: "tenant-1", userId: "user-1", assetId: "asset-1", intentId: "legacy-persist-failure",
    manualRetry: true,
    dependencies: successfulDependencies({
      authority: passthroughAuthority({
        lookup: async () => ({
          status: "failed", latestAttempt: 1,
          result: { failure_phase: "CSM_PERSISTENCE" }
        })
      })
    })
  }),
  (error) => error.code === "csm_persistence_checkpoint_missing" && error.statusCode === 409
);

// Checkpoint bindings are not advisory: changing operation or payload identity
// makes a stored result unusable before any persistence write.
{
  const task = ordinaryTask("bound-intent");
  const operationKey = buildLunaDirectOperationKey(task);
  const sessionId = deterministicCsmSessionId(operationKey);
  const checkpoint = buildCsmPersistenceCheckpoint({
    prepared: {
      ...preparedResult(sessionId),
      execution_contract_sha256: task.execution_contract_sha256
    },
    tenantId: "tenant-1", operationKey,
    payloadHash: buildLunaDirectPayloadHash(task), recognitionSessionId: sessionId,
    executionContractSha256: task.execution_contract_sha256,
    resolutionContractSha256: task.resolution_contract_sha256
  });
  assert.equal(
    checkpoint.csm_persistence_checkpoint.schema_version,
    CSM_PERSISTENCE_CHECKPOINT_ORDINARY_EXECUTION_VERSION
  );
  assert.equal(
    Object.hasOwn(checkpoint.csm_persistence_checkpoint, "execution_contract_sha256"),
    true,
    "new ordinary checkpoints must bind the complete paid execution"
  );
  assert.throws(() => validateCsmPersistenceCheckpoint(checkpoint, {
    tenantId: "tenant-1",
    operationKey,
    payloadHash: buildLunaDirectPayloadHash(task),
    recognitionSessionId: sessionId,
    executionContractSha256: task.execution_contract_sha256,
    operationScope: "derived_checkpoint"
  }), (error) => error.code === "csm_persistence_checkpoint_invalid"
    && error.detail === "marker_missing",
  "a staged resume may not adopt an ordinary execution-bound checkpoint");

  const executionTampered = structuredClone(checkpoint);
  executionTampered.execution_contract_sha256 = "e".repeat(64);
  let providerBoundaryCalls = 0;
  let writerCalls = 0;
  const tamperDependencies = successfulDependencies({
    authority: passthroughAuthority({
      lookup: async () => ({ status: "found", result: executionTampered })
    })
  });
  tamperDependencies.preparePath = async () => {
    providerBoundaryCalls += 1;
    throw new Error("tampered_checkpoint_must_not_prepare");
  };
  tamperDependencies.persistPath = async () => {
    writerCalls += 1;
    throw new Error("tampered_checkpoint_must_not_write");
  };
  await assert.rejects(runDirectCsmAsset({
    tenantId: "tenant-1", userId: "user-1", assetId: "asset-1",
    intentId: task.intent_id, manualRetry: true, dependencies: tamperDependencies
  }), (error) => error.code === "csm_persistence_checkpoint_invalid"
    && error.detail === "result_execution_contract_sha256_mismatch");
  assert.equal(providerBoundaryCalls, 0);
  assert.equal(writerCalls, 0);

  assert.throws(() => buildCsmPersistenceCheckpoint({
    prepared: {
      ...preparedResult(sessionId),
      execution_contract_sha256: "e".repeat(64)
    },
    tenantId: "tenant-1",
    operationKey,
    payloadHash: buildLunaDirectPayloadHash(task),
    recognitionSessionId: sessionId,
    executionContractSha256: task.execution_contract_sha256
  }), (error) => error.code === "csm_persistence_checkpoint_invalid"
    && error.detail === "prepared_execution_contract_sha256_mismatch");

  checkpoint.csm_persistence_checkpoint.payload_sha256 = "f".repeat(64);
  await assert.rejects(
    runDirectCsmAsset({
      tenantId: "tenant-1", userId: "user-1", assetId: "asset-1", intentId: "bound-intent",
      manualRetry: true,
      dependencies: successfulDependencies({
        authority: passthroughAuthority({ lookup: async () => ({ status: "found", result: checkpoint }) })
      })
    }),
    (error) => error.code === "csm_persistence_checkpoint_invalid"
  );
}

await assert.rejects(
  runDirectCsmAsset({
    tenantId: "tenant-1", userId: "user-1", assetId: "asset-1", intentId: "",
    dependencies: successfulDependencies({ authority: passthroughAuthority() })
  }),
  (error) => error.message === "missing_intent_id" && error.statusCode === 400
);

console.log("CSM direct API tests passed");
