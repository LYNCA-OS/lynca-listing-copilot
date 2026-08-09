import assert from "node:assert/strict";
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
  buildProviderFailureReceipt,
  buildCsmDirectFailureResponse,
  buildCsmPersistenceCheckpoint,
  checkCsmDirectPreSpendReadiness,
  checkCachedCsmPersistenceReadiness,
  createResponsesProviderCaller,
  deterministicProviderClientRequestId,
  deterministicCsmSessionId,
  resetCsmPersistenceReadinessCache,
  runDirectCsmAsset
} from "../api/csm-listing-title.js";
import {
  buildLegacyLowLunaDirectPayloadHash,
  buildLunaDirectOperationKey,
  buildLunaDirectPayloadHash
} from "../lib/listing/thin/luna-direct-dispatcher.mjs";
import { buildCsmIngestFailureResponse } from "../api/csm-listing-title-ingest.js";
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
  THIN_REGISTRY_RELEASE_CONTRACT
} from "../lib/listing/thin/csm-supabase-writer.mjs";
import {
  CSM_PROVIDER_AUTHORITY_LIMITS,
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
assert.match(source, /cloud_run_calls:\s*0/, "the endpoint must make its zero Cloud Run boundary observable");
assert.match(source, /vector_calls:\s*0/, "the endpoint must make its zero vector boundary observable");
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
assert.equal(CSM_DIRECT_ESTIMATED_TOKENS, 5_300);
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
  assert.equal(failure.body.cloud_run_calls, 0);
  assert.equal(failure.body.vector_calls, 0);
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

// The default cached preflight is the integration boundary: five global
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
      return new Response(JSON.stringify([{
        ...THIN_REGISTRY_RELEASE_CONTRACT,
        registry_payload: { mode: "local_sem_and_composer_only", external_catalog: false }
      }]));
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
  assert.equal(calls.length, 5, "120 cards must share one five-probe pre-spend receipt");
  await checkCachedCsmPersistenceReadiness(options);
  assert.equal(calls.length, 5, "a successful receipt must be reused inside its TTL");
  clockMs += CSM_PERSISTENCE_READINESS_CACHE_TTL_MS + 1;
  await checkCachedCsmPersistenceReadiness(options);
  assert.equal(calls.length, 10, "all five probes must refresh after cache expiry");

  resetCsmPersistenceReadinessCache();
  pacerReady = false;
  const failed = await checkCachedCsmPersistenceReadiness(options);
  assert.equal(failed.ready, false);
  assert.equal(failed.reason, "provider_pacer_probe_contract_mismatch");
  pacerReady = true;
  const healed = await checkCachedCsmPersistenceReadiness(options);
  assert.equal(healed.ready, true, "pacer recovery must not wait for a failure TTL");
  assert.equal(calls.length, 20, "failure and immediate recovery each require one five-probe receipt");
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
      request = { url, init, body: JSON.parse(init.body) };
      return new Response('{"id":"resp_trace"}', { status: 200 });
    }
  });
  await call({ model: "gpt-5.6-luna", metadata: { existing: "kept" } });
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(new Headers(request.init.headers).get("x-client-request-id"), clientRequestId);
  assert.equal(request.body.store, true);
  assert.equal(request.body.metadata.existing, "kept");
  assert.match(request.body.metadata.lynca_operation_sha256, /^[0-9a-f]{64}$/);
  assert.equal(request.body.metadata.lynca_payload_sha256, payloadHash);
  assert.equal(request.body.metadata.lynca_attempt, "2");
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
}

function passthroughAuthority({ events = [], lookup = async () => ({ status: "not_found" }) } = {}) {
  return {
    globallyEnforced: true,
    lookupOperationResult: lookup,
    enqueueAttempt: async (metadata) => {
      events.push({ type: "enqueue", metadata });
      return metadata;
    },
    runAttempt: async ({ queuedAttempt, execute }) => {
      const metadata = await queuedAttempt;
      events.push({ type: "claim", metadata });
      return execute();
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

function successfulDependencies({ events = [], authority, signedUrl = "https://signed.invalid/a.jpg" } = {}) {
  return {
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
      assert.deepEqual(input.imageUrls, [signedUrl]);
      return preparedResult(input.recognitionSessionId);
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
    original_manifest_sha256: originalManifestSha256
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
      operationScope: "derived_checkpoint",
      laneVersion: STAGED_RECOGNITION_LANE_VERSION,
      originalManifestSha256,
      signImage: async ({ objectPath }) => {
        signedPaths.push(objectPath);
        return "data:image/jpeg;base64,derived";
      },
      createSession: async () => ({ persistence: { recognition_session: { saved: true } } }),
      preparePath: async ({ recognitionSessionId, imageUrls }) => {
        assert.deepEqual(imageUrls, ["data:image/jpeg;base64,derived"]);
        return preparedResult(recognitionSessionId, "Staged title");
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
  assert.equal(
    buildLunaDirectPayloadHash(task),
    buildLunaDirectPayloadHash({
      ...task,
      model: "future-model",
      reasoning_effort: "future-effort",
      prompt_version: "future-prompt"
    }),
    "a response-loss resume must survive model, effort and prompt deployment drift"
  );
}

// A staged resume receipt is provider-incapable. It may recreate the deferred
// formal session and persist an already-paid checkpoint, but even a missing
// checkpoint may not enqueue, sign, prepare, or call the model.
{
  const originalManifestSha256 = "9".repeat(64);
  const task = {
    tenant_id: "tenant-1", intent_id: "resume-only", asset_id: "asset-1",
    model: "gpt-staged-old", detail: "high",
    reasoning_effort: "old-effort",
    prompt_version: "old-prompt",
    estimated_tokens: CSM_DIRECT_ESTIMATED_TOKENS,
    image_fingerprints: [`sha256:${IMAGE_HASH}`],
    operation_scope: "derived_checkpoint",
    lane_version: STAGED_RECOGNITION_LANE_VERSION,
    original_manifest_sha256: originalManifestSha256
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
    recognitionInput
  });
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
  const dependencies = successfulDependencies({ events, authority });
  dependencies.operationScope = "derived_checkpoint";
  dependencies.laneVersion = STAGED_RECOGNITION_LANE_VERSION;
  dependencies.originalManifestSha256 = originalManifestSha256;
  dependencies.createSession = async ({ payload }) => {
    events.push("session");
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
      ...successfulDependencies({
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

  for (const status of ["pending", "ambiguous", "failed"]) {
    let forbiddenBoundaryCalls = 0;
    await assert.rejects(runDirectCsmAsset({
      tenantId: "tenant-1", userId: "user-1", assetId: "asset-1",
      intentId: `resume-${status}`, resumeOnly: true,
      dependencies: {
        ...successfulDependencies({
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
        ...successfulDependencies({ authority: passthroughAuthority() }),
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
  assert.deepEqual(events, ["readiness", "images", "sign", "session", "model_and_csm", "persist_csm"]);
  assert.ok(result.latency_stages_ms.preflight_ms >= 0);
  assert.ok(result.latency_stages_ms.image_manifest_ms >= 0);
  assert.ok(result.latency_stages_ms.signed_url_ms >= 0);
  assert.ok(result.latency_stages_ms.recognition_session_ms >= 0);
  assert.ok(result.latency_stages_ms.provider_prepare_ms >= 0);
  assert.ok(result.latency_stages_ms.authority_dispatch_ms >= 0);
  assert.ok(result.latency_stages_ms.csm_persistence_ms >= 0);

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

  const storedTask = {
    tenant_id: "tenant-1", intent_id: "intent-1", asset_id: "asset-1",
    model: "gpt-5.6-luna", detail: "high",
    reasoning_effort: CSM_THIN_RUNTIME_CONTRACT.reasoningEffort,
    prompt_version: CSM_DIRECT_PROMPT_VERSION,
    estimated_tokens: CSM_DIRECT_ESTIMATED_TOKENS,
    image_fingerprints: [`sha256:${IMAGE_HASH}`]
  };
  const storedSessionId = deterministicCsmSessionId(buildLunaDirectOperationKey(storedTask));
  const stored = {
    title: "Stored title",
    csm_rows: { resolution: { recognition_session_id: storedSessionId } },
    csm_persistence: { ok: true, atomic: true, session: { saved: true } }
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
  assert.deepEqual(replay, stored);
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
    return preparedResult(recognitionSessionId, "Resume title");
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
  const task = {
    tenant_id: "tenant-1", intent_id: "deferred-session-resume", asset_id: "asset-1",
    model: "gpt-5.6-luna", detail: "high",
    reasoning_effort: CSM_THIN_RUNTIME_CONTRACT.reasoningEffort,
    prompt_version: CSM_DIRECT_PROMPT_VERSION,
    estimated_tokens: CSM_DIRECT_ESTIMATED_TOKENS,
    image_fingerprints: [`sha256:${IMAGE_HASH}`]
  };
  const operationKey = buildLunaDirectOperationKey(task);
  const payloadHash = buildLunaDirectPayloadHash(task);
  const sessionId = deterministicCsmSessionId(operationKey);
  const durable = buildCsmPersistenceCheckpoint({
    prepared: preparedResult(sessionId, "Deferred resume title"),
    tenantId: "tenant-1",
    operationKey,
    payloadHash,
    recognitionSessionId: sessionId
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

// Cross-deployment compatibility: the operation key did not change when
// effort entered payload identity. Only an explicit current-hash conflict may
// trigger one lookup of the exact pre-change low-effort hash. A found paid
// checkpoint resumes persistence without signing or executing the provider.
{
  const task = {
    tenant_id: "tenant-1", intent_id: "legacy-hash-resume", asset_id: "asset-1",
    model: "gpt-5.6-luna", detail: "high",
    reasoning_effort: CSM_THIN_RUNTIME_CONTRACT.reasoningEffort,
    prompt_version: CSM_DIRECT_PROMPT_VERSION,
    estimated_tokens: CSM_DIRECT_ESTIMATED_TOKENS,
    image_fingerprints: [`sha256:${IMAGE_HASH}`]
  };
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
    lookupOperationResult: async ({ payloadHash }) => {
      authorityEvents.push({ type: "lookup", payloadHash });
      return { status: "found", result: durable, latestAttempt: 1 };
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
    { type: "lookup", payloadHash: legacyPayloadHash }
  ]);
  assert.deepEqual(events, ["readiness", "images", "persist_csm"],
    "legacy recovery must perform zero sign, zero session recreation and zero provider work");
}

// Pending/ambiguous legacy operations remain provider-incapable and retryable;
// FAILED has no paid success checkpoint and stays terminal. None may reach the
// signing/model boundary.
for (const legacyStatus of ["pending", "ambiguous", "failed"]) {
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
    lookupOperationResult: async () => {
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
  const authority = passthroughAuthority({
    lookup: async () => { lookupCalls += 1; return { status: "not_found" }; }
  });
  await runDirectCsmAsset({
    tenantId: "tenant-1", userId: "user-1", assetId: "asset-1",
    intentId: "current-hash-clean-path",
    dependencies: successfulDependencies({ authority })
  });
  assert.equal(lookupCalls, 0, "the compatibility branch must add zero RTT to the current path");
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
  const task = {
    tenant_id: "tenant-1", intent_id: "bound-intent", asset_id: "asset-1",
    model: "gpt-5.6-luna", detail: "high",
    reasoning_effort: CSM_THIN_RUNTIME_CONTRACT.reasoningEffort,
    prompt_version: CSM_DIRECT_PROMPT_VERSION,
    estimated_tokens: CSM_DIRECT_ESTIMATED_TOKENS,
    image_fingerprints: [`sha256:${IMAGE_HASH}`]
  };
  const operationKey = buildLunaDirectOperationKey(task);
  const sessionId = deterministicCsmSessionId(operationKey);
  const checkpoint = buildCsmPersistenceCheckpoint({
    prepared: preparedResult(sessionId), tenantId: "tenant-1", operationKey,
    payloadHash: buildLunaDirectPayloadHash(task), recognitionSessionId: sessionId
  });
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
