import assert from "node:assert/strict";
import { CSM_THIN_RUNTIME_CONTRACT } from "../lib/listing/thin/csm-runtime-contract.mjs";
import { readFile, readdir } from "node:fs/promises";

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
  buildCsmCheckpointReceipt,
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
  buildLunaDirectOperationKey,
  buildLunaDirectPayloadHash
} from "../lib/listing/thin/luna-direct-dispatcher.mjs";
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
  image_references: [{
    image_id: "image-1",
    image_role: "front_original",
    bucket: "cards",
    object_path: "tenant-1/a.jpg",
    content_sha256: IMAGE_HASH,
    derived: false,
    source_image_id: null,
    source_region: null,
    crop_metadata: null
  }],
  images: [{
    image_id: "image-1",
    objectPath: "tenant-1/a.jpg",
    bucket: "cards",
    storageRole: "image_1_original",
    size: 1_024,
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
  return {
    title,
    fields: { low_confidence: [] },
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
  assert.deepEqual(events, ["readiness", "images", "sign", "model_and_csm", "session", "persist_csm"]);
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
      client_upload_bytes: 11_238_422,
      not_a_client_key: 5,
      client_negative_ms: -1
    },
    callProvider: async () => ({ ok: true }),
    dependencies: successfulDependencies({ events: [], authority: passthroughAuthority({ events: [] }) })
  });
  assert.equal(withClient.latency_stages_ms.client_preparation_ms, 8_400);
  assert.equal(withClient.latency_stages_ms.client_sha256_ms, 610);
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

// The formal session is not pre-provider work. It may only be created after
// the paid result has crossed the authority's durable settle boundary.
{
  let authoritySettled = false;
  const authority = passthroughAuthority();
  authority.runAttempt = async ({ queuedAttempt, execute }) => {
    await queuedAttempt;
    const result = await execute();
    authoritySettled = true;
    return result;
  };
  const dependencies = successfulDependencies({ authority });
  dependencies.createSession = async () => {
    assert.equal(authoritySettled, true, "recognition session must follow durable provider settle");
    return { persistence: { recognition_session: { saved: true } } };
  };
  const result = await runDirectCsmAsset({
    tenantId: "tenant-1",
    userId: "user-1",
    assetId: "asset-1",
    intentId: "session-after-provider-checkpoint",
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
    model: "gpt-5.6-luna", reasoning_effort: CSM_THIN_RUNTIME_CONTRACT.reasoningEffort, detail: "high",
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

// A derived inline request may settle a displayable provider checkpoint before
// originals finish uploading. The existing direct endpoint then finalizes that
// same operation from verified originals without a second provider boundary.
{
  let durable = null;
  let prepareCalls = 0;
  let sessionCalls = 0;
  let persistCalls = 0;
  let lastSessionPayload = null;
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
  const derivedLedger = [{
    image_role: "front_original",
    read: "readability_derived_inline",
    bytes: 240_000,
    original_bytes: null,
    derived_available: true,
    derived_bytes: 240_000,
    source_image_id: "image-1",
    transform_version: "readability-downscale-v1",
    lane_version: "csm-derived-checkpoint-v1",
    content_sha256: "d".repeat(64),
    original_content_sha256: IMAGE_HASH
  }];
  const checkpoint = await runDirectCsmAsset({
    tenantId: "tenant-1",
    userId: "user-1",
    assetId: "asset-1",
    intentId: "derived-checkpoint",
    checkpointOnly: true,
    dependencies: {
      checkReadiness: async () => ({ ready: true }),
      readImages: async () => ({ asset_id: "asset-1", images: [], image_references: [] }),
      imageFingerprints: [`sha256:${IMAGE_HASH}`],
      recognitionImages: [{
        objectPath: "inline-derived/front",
        bytes: Buffer.from("derived-front")
      }],
      recognitionInput: derivedLedger,
      operationScope: "derived_checkpoint",
      laneVersion: "csm-derived-checkpoint-v1",
      signImage: async () => "data:image/jpeg;base64,ZGVyaXZlZA==",
      preparePath: async ({ recognitionSessionId }) => {
        prepareCalls += 1;
        return preparedResult(recognitionSessionId, "Checkpoint title");
      },
      createSession: async () => {
        sessionCalls += 1;
        throw new Error("checkpoint_must_not_create_session");
      },
      persistPath: async () => {
        persistCalls += 1;
        throw new Error("checkpoint_must_not_persist_csm");
      },
      providerAdmission: authority
    }
  });
  assert.equal(checkpoint.title, "Checkpoint title");
  assert.equal(checkpoint.trace_status, "CHECKPOINTED");
  assert.equal(checkpoint.checkpoint_state, "STAGED");
  assert.match(checkpoint.pending_recognition_session_id, /^csmsess_[0-9a-f]{40}$/);
  assert.equal(checkpoint.provider_calls, 1);
  assert.equal(checkpoint.provider_replayed, false);
  assert.equal(checkpoint.checkpoint_receipt.schema_version, "csm-checkpoint-receipt-v1");
  assert.equal(checkpoint.checkpoint_receipt.task.asset_id, "asset-1");
  assert.equal(checkpoint.checkpoint_receipt.task.intent_id, "derived-checkpoint");
  assert.deepEqual(checkpoint.checkpoint_receipt.task.image_fingerprints, [`sha256:${IMAGE_HASH}`]);
  assert.equal(checkpoint.checkpoint_receipt.task.reasoning_effort, CSM_THIN_RUNTIME_CONTRACT.reasoningEffort);
  assert.equal(checkpoint.checkpoint_receipt.task.operation_scope, "derived_checkpoint");
  assert.equal(sessionCalls, 0);
  assert.equal(persistCalls, 0);
  assert.deepEqual(durable.csm_persistence_checkpoint.recognition_input, derivedLedger);

  const finalizeDependencies = successfulDependencies({ authority });
  finalizeDependencies.preparePath = async () => {
    prepareCalls += 1;
    throw new Error("finalize_must_not_prepare_or_call_provider");
  };
  finalizeDependencies.createSession = async ({ payload }) => {
    sessionCalls += 1;
    lastSessionPayload = payload;
    return { persistence: { recognition_session: { saved: true } } };
  };
  finalizeDependencies.persistPath = async ({ prepared }) => {
    persistCalls += 1;
    return {
      ...prepared,
      csm_persistence: { ok: true, atomic: true, session: { saved: true } }
    };
  };
  const finalized = await runDirectCsmAsset({
    tenantId: "tenant-1",
    userId: "user-1",
    assetId: "asset-1",
    intentId: "derived-checkpoint",
    checkpointRequired: true,
    checkpointReceipt: checkpoint.checkpoint_receipt,
    dependencies: finalizeDependencies
  });
  assert.equal(finalized.title, "Checkpoint title");
  assert.equal(finalized.provider_calls, 0, "checkpoint finalization is provider-incapable");
  assert.equal(finalized.provider_replayed, true);
  assert.equal(prepareCalls, 1, "the provider/prepare boundary runs exactly once");
  assert.equal(sessionCalls, 1, "the formal session exists only during finalize");
  assert.equal(persistCalls, 1);

  let tamperedReceiptProviderCalls = 0;
  const tamperedReceipt = structuredClone(checkpoint.checkpoint_receipt);
  tamperedReceipt.task.prompt_version = `${tamperedReceipt.task.prompt_version}-tampered`;
  await assert.rejects(
    runDirectCsmAsset({
      tenantId: "tenant-1",
      userId: "user-1",
      assetId: "asset-1",
      intentId: "derived-checkpoint",
      checkpointRequired: true,
      checkpointReceipt: tamperedReceipt,
      callProvider: async () => { tamperedReceiptProviderCalls += 1; },
      dependencies: finalizeDependencies
    }),
    (error) => error.code === "csm_persistence_checkpoint_invalid"
      && error.detail === "checkpoint_receipt_mismatch",
    "a tampered receipt must fail before lookup, session or provider"
  );
  assert.equal(tamperedReceiptProviderCalls, 0);
  assert.equal(sessionCalls, 1);
  assert.equal(persistCalls, 1);

  const sourceMismatchDurable = structuredClone(durable);
  sourceMismatchDurable.csm_persistence_checkpoint.recognition_input[0].source_image_id = "other-image";
  let sourceMismatchProviderCalls = 0;
  const sourceMismatchDependencies = {
    ...finalizeDependencies,
    providerAdmission: passthroughAuthority({
      lookup: async () => ({ status: "found", latestAttempt: 1, result: sourceMismatchDurable })
    })
  };
  await assert.rejects(
    runDirectCsmAsset({
      tenantId: "tenant-1",
      userId: "user-1",
      assetId: "asset-1",
      intentId: "derived-checkpoint",
      checkpointRequired: true,
      checkpointReceipt: checkpoint.checkpoint_receipt,
      callProvider: async () => { sourceMismatchProviderCalls += 1; },
      dependencies: sourceMismatchDependencies
    }),
    (error) => error.code === "csm_recognition_input_source_mismatch",
    "the checkpoint slot must still name the verified original image id"
  );
  assert.equal(sourceMismatchProviderCalls, 0);
  assert.equal(sessionCalls, 1, "source mismatch must precede formal session creation");
  assert.equal(persistCalls, 1);
  assert.deepEqual(lastSessionPayload.image_references, canonicalImages().image_references,
    "the formal session uses the final verified originals, never inline derived bytes");
  assert.deepEqual(lastSessionPayload.recognition_input, derivedLedger,
    "the formal session preserves what the paid attempt actually read");

  const mismatched = canonicalImages();
  mismatched.images = mismatched.images.map((image) => ({
    ...image,
    content_sha256: "e".repeat(64)
  }));
  const mismatchDependencies = {
    ...finalizeDependencies,
    readImages: async () => mismatched,
    createSession: async () => {
      sessionCalls += 1;
      throw new Error("hash_mismatch_must_precede_session");
    }
  };
  await assert.rejects(
    runDirectCsmAsset({
      tenantId: "tenant-1",
      userId: "user-1",
      assetId: "asset-1",
      intentId: "derived-checkpoint",
      checkpointRequired: true,
      checkpointReceipt: checkpoint.checkpoint_receipt,
      dependencies: mismatchDependencies
    }),
    (error) => error.code === "csm_persistence_checkpoint_invalid"
      && error.detail === "receipt_request_identity_mismatch",
    "a changed original fingerprint must fail closed against the durable checkpoint"
  );
  assert.equal(prepareCalls, 1);
  assert.equal(sessionCalls, 1);
  assert.equal(persistCalls, 1);

  let missingCheckpointProviderCalls = 0;
  const missingCheckpointReceipt = buildCsmCheckpointReceipt({
    tenantId: "tenant-1",
    taskIdentity: {
      asset_id: "asset-1",
      intent_id: "checkpoint-does-not-exist",
      model: "gpt-5.6-luna",
      reasoning_effort: CSM_THIN_RUNTIME_CONTRACT.reasoningEffort,
      detail: "high",
      prompt_version: CSM_DIRECT_PROMPT_VERSION,
      image_fingerprints: [`sha256:${IMAGE_HASH}`]
    }
  });
  await assert.rejects(
    runDirectCsmAsset({
      tenantId: "tenant-1",
      userId: "user-1",
      assetId: "asset-1",
      intentId: "checkpoint-does-not-exist",
      checkpointRequired: true,
      checkpointReceipt: missingCheckpointReceipt,
      callProvider: async () => { missingCheckpointProviderCalls += 1; },
      dependencies: successfulDependencies({
        authority: passthroughAuthority({ lookup: async () => ({ status: "not_found" }) })
      })
    }),
    (error) => error.code === "csm_checkpoint_not_found"
      && error.statusCode === 409
      && error.provider_attempt_started === false,
    "checkpoint-required finalize must be provider-incapable when no checkpoint exists"
  );
  assert.equal(missingCheckpointProviderCalls, 0);
}

// The receipt addresses the exact historical task. A deployment may change the
// current prompt constant before originals finish, yet finalize must replay the
// old operation and remain physically incapable of a new provider call.
{
  const historicalTask = {
    asset_id: "asset-1",
    intent_id: "cross-deploy-finalize",
    model: "gpt-5.6-luna",
    reasoning_effort: "none",
    detail: "high",
    prompt_version: "csm-canonical-fields-v0-cross-deploy",
    image_fingerprints: [`sha256:${IMAGE_HASH}`]
  };
  assert.notEqual(historicalTask.prompt_version, CSM_DIRECT_PROMPT_VERSION);
  assert.notEqual(historicalTask.reasoning_effort, CSM_THIN_RUNTIME_CONTRACT.reasoningEffort);
  const receipt = buildCsmCheckpointReceipt({ tenantId: "tenant-1", taskIdentity: historicalTask });
  const sessionId = deterministicCsmSessionId(receipt.operation_key);
  const historicalCheckpoint = buildCsmPersistenceCheckpoint({
    prepared: preparedResult(sessionId, "Historical prompt title"),
    tenantId: "tenant-1",
    operationKey: receipt.operation_key,
    payloadHash: receipt.payload_sha256,
    recognitionSessionId: sessionId,
    recognitionInput: [{
      image_role: "front_original",
      read: "readability_derived_inline",
      bytes: 240_000,
      original_bytes: null,
      derived_available: true,
      derived_bytes: 240_000,
      source_image_id: "image-1"
    }],
    taskIdentity: historicalTask
  });
  let providerCalls = 0;
  let persistedPrompt = null;
  let persistedEffort = null;
  let sessionProvider = null;
  let sessionEffort = null;
  const dependencies = successfulDependencies({
    authority: passthroughAuthority({
      lookup: async ({ operationKey, payloadHash }) => {
        assert.equal(operationKey, receipt.operation_key);
        assert.equal(payloadHash, receipt.payload_sha256);
        return { status: "found", latestAttempt: 1, result: historicalCheckpoint };
      }
    })
  });
  dependencies.preparePath = async () => {
    providerCalls += 1;
    throw new Error("cross_deploy_finalize_must_not_prepare");
  };
  dependencies.createSession = async ({ payload }) => {
    sessionProvider = payload.provider;
    sessionEffort = payload.reasoning_effort;
    return { persistence: { recognition_session: { saved: true } } };
  };
  dependencies.persistPath = async ({ prepared, promptVersion, effort }) => {
    persistedPrompt = promptVersion;
    persistedEffort = effort;
    return {
      ...prepared,
      csm_persistence: { ok: true, atomic: true, session: { saved: true } }
    };
  };
  const finalized = await runDirectCsmAsset({
    tenantId: "tenant-1",
    userId: "user-1",
    assetId: "asset-1",
    intentId: "cross-deploy-finalize",
    checkpointRequired: true,
    checkpointReceipt: receipt,
    callProvider: async () => { providerCalls += 1; },
    dependencies
  });
  assert.equal(finalized.title, "Historical prompt title");
  assert.equal(finalized.provider_calls, 0);
  assert.equal(finalized.provider_replayed, true);
  assert.equal(providerCalls, 0);
  assert.equal(sessionProvider, historicalTask.model);
  assert.equal(sessionEffort, historicalTask.reasoning_effort);
  assert.equal(persistedPrompt, historicalTask.prompt_version);
  assert.equal(persistedEffort, historicalTask.reasoning_effort);
}

// The preview response can disappear after the paid result settles. A later
// deployment may change model, prompt and effort, but the recognition-only lane
// first looks up the stable asset/original identity and returns the old receipt.
{
  const historicalTask = {
    asset_id: "asset-1",
    intent_id: "response-lost-preview",
    model: "gpt-5.5-luna",
    reasoning_effort: "none",
    detail: "high",
    prompt_version: "csm-canonical-fields-v0-response-lost",
    image_fingerprints: [`sha256:${IMAGE_HASH}`],
    operation_scope: "derived_checkpoint",
    lane_version: "csm-derived-checkpoint-v1"
  };
  const historicalReceipt = buildCsmCheckpointReceipt({
    tenantId: "tenant-1",
    taskIdentity: historicalTask
  });
  const historicalSessionId = deterministicCsmSessionId(historicalReceipt.operation_key);
  const historicalCheckpoint = buildCsmPersistenceCheckpoint({
    prepared: preparedResult(historicalSessionId, "Recovered lost preview"),
    tenantId: "tenant-1",
    operationKey: historicalReceipt.operation_key,
    payloadHash: historicalReceipt.payload_sha256,
    recognitionSessionId: historicalSessionId,
    recognitionInput: [{
      image_role: "front_original",
      read: "readability_derived_inline",
      bytes: 210_000,
      original_bytes: null,
      derived_available: true,
      derived_bytes: 210_000,
      source_image_id: "image-1"
    }],
    taskIdentity: historicalTask
  });
  let providerCalls = 0;
  let enqueueCalls = 0;
  const authority = passthroughAuthority({
    lookup: async ({ operationKey, payloadHash }) => {
      assert.equal(operationKey, historicalReceipt.operation_key);
      assert.equal(payloadHash, historicalReceipt.payload_sha256);
      return { status: "found", latestAttempt: 1, result: historicalCheckpoint };
    }
  });
  authority.enqueueAttempt = async () => {
    enqueueCalls += 1;
    throw new Error("stable_preview_replay_must_not_enqueue");
  };
  const retriedPreview = await runDirectCsmAsset({
    tenantId: "tenant-1",
    userId: "user-1",
    assetId: "asset-1",
    intentId: "response-lost-preview",
    checkpointOnly: true,
    callProvider: async () => { providerCalls += 1; },
    dependencies: {
      checkReadiness: async () => ({ ready: true }),
      readImages: async () => canonicalImages(),
      signImage: async () => {
        providerCalls += 1;
        throw new Error("stable_preview_replay_must_not_sign");
      },
      preparePath: async () => {
        providerCalls += 1;
        throw new Error("stable_preview_replay_must_not_prepare");
      },
      createSession: async () => { throw new Error("stable_preview_must_not_create_session"); },
      persistPath: async () => { throw new Error("stable_preview_must_not_persist"); },
      operationScope: "derived_checkpoint",
      laneVersion: "csm-derived-checkpoint-v1",
      providerAdmission: authority
    }
  });
  assert.equal(retriedPreview.title, "Recovered lost preview");
  assert.equal(retriedPreview.provider_calls, 0);
  assert.equal(retriedPreview.provider_replayed, true);
  assert.deepEqual(retriedPreview.checkpoint_receipt, historicalReceipt);
  assert.equal(providerCalls, 0);
  assert.equal(enqueueCalls, 0);
  assert.notEqual(
    retriedPreview.checkpoint_receipt.task.prompt_version,
    CSM_DIRECT_PROMPT_VERSION,
    "the retry returns the historical runtime receipt, not the new deployment runtime"
  );

  for (const status of ["pending", "ambiguous", "conflict"]) {
    let blockedProviderCalls = 0;
    await assert.rejects(
      runDirectCsmAsset({
        tenantId: "tenant-1",
        userId: "user-1",
        assetId: "asset-1",
        intentId: `stable-${status}`,
        checkpointOnly: true,
        callProvider: async () => { blockedProviderCalls += 1; },
        dependencies: {
          ...successfulDependencies({
            authority: passthroughAuthority({ lookup: async () => ({ status }) })
          }),
          operationScope: "derived_checkpoint",
          laneVersion: "csm-derived-checkpoint-v1"
        }
      }),
      (error) => error.code === `csm_checkpoint_${status}`
        && error.provider_attempt_started === false
        && error.retryable === (status !== "conflict"),
      `a stable ${status} operation must fail closed rather than enqueue a second provider call`
    );
    assert.equal(blockedProviderCalls, 0);
  }

  let failedAutomaticProviderCalls = 0;
  let failedAutomaticEnqueueCalls = 0;
  const failedAutomaticAuthority = passthroughAuthority({
    lookup: async () => ({
      status: "failed",
      latestAttempt: 2,
      result: { code: "provider_failed" }
    })
  });
  failedAutomaticAuthority.enqueueAttempt = async () => {
    failedAutomaticEnqueueCalls += 1;
    throw new Error("failed_preview_must_wait_for_writer_retry");
  };
  await assert.rejects(
    runDirectCsmAsset({
      tenantId: "tenant-1",
      userId: "user-1",
      assetId: "asset-1",
      intentId: "stable-failed-automatic",
      checkpointOnly: true,
      callProvider: async () => { failedAutomaticProviderCalls += 1; },
      dependencies: {
        ...successfulDependencies({ authority: failedAutomaticAuthority }),
        operationScope: "derived_checkpoint",
        laneVersion: "csm-derived-checkpoint-v1"
      }
    }),
    (error) => error.code === "csm_checkpoint_failed"
      && error.statusCode === 409
      && error.retryable === true
      && error.provider_attempt_started === false,
    "FAILED preview is retryable for the writer but may not buy another attempt automatically"
  );
  assert.equal(failedAutomaticProviderCalls, 0);
  assert.equal(failedAutomaticEnqueueCalls, 0);

  const explicitRetryEvents = [];
  let explicitRetryPrepareCalls = 0;
  const failedRetryAuthority = passthroughAuthority({
    events: explicitRetryEvents,
    lookup: async () => ({
      status: "failed",
      latestAttempt: 2,
      result: { code: "provider_failed" }
    })
  });
  const explicitRetryDependencies = successfulDependencies({ authority: failedRetryAuthority });
  explicitRetryDependencies.operationScope = "derived_checkpoint";
  explicitRetryDependencies.laneVersion = "csm-derived-checkpoint-v1";
  explicitRetryDependencies.preparePath = async ({ recognitionSessionId }) => {
    explicitRetryPrepareCalls += 1;
    return preparedResult(recognitionSessionId, "Writer retry title");
  };
  const explicitRetry = await runDirectCsmAsset({
    tenantId: "tenant-1",
    userId: "user-1",
    assetId: "asset-1",
    intentId: "stable-failed-explicit",
    checkpointOnly: true,
    manualRetry: true,
    dependencies: explicitRetryDependencies
  });
  assert.equal(explicitRetry.title, "Writer retry title");
  assert.equal(explicitRetry.trace_status, "CHECKPOINTED");
  assert.equal(explicitRetry.provider_calls, 1);
  assert.equal(explicitRetryPrepareCalls, 1);
  assert.equal(explicitRetryEvents[0].type, "enqueue");
  assert.equal(explicitRetryEvents[0].metadata.attempt, 3);
  assert.equal(explicitRetryEvents[0].metadata.attemptClass, "retry");
}

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
  assert.equal(events.filter((event) => event === "session").length, 3,
    "each persistence finalize may idempotently prove the deterministic session, but never rerun Luna");
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
    model: "gpt-5.6-luna", reasoning_effort: CSM_THIN_RUNTIME_CONTRACT.reasoningEffort, detail: "high",
    prompt_version: CSM_DIRECT_PROMPT_VERSION,
    estimated_tokens: CSM_DIRECT_ESTIMATED_TOKENS,
    image_fingerprints: [`sha256:${IMAGE_HASH}`]
  };
  const operationKey = buildLunaDirectOperationKey(task);
  const sessionId = deterministicCsmSessionId(operationKey);
  const checkpoint = buildCsmPersistenceCheckpoint({
    prepared: preparedResult(sessionId), tenantId: "tenant-1", operationKey,
    payloadHash: buildLunaDirectPayloadHash(task), recognitionSessionId: sessionId,
    recognitionInput: [{
      image_role: "front_original", read: "original", bytes: 1_024,
      original_bytes: 1_024, derived_available: false, derived_bytes: null,
      source_image_id: "image-1"
    }],
    taskIdentity: {
      asset_id: "asset-1",
      intent_id: "bound-intent",
      model: "gpt-5.6-luna",
      reasoning_effort: CSM_THIN_RUNTIME_CONTRACT.reasoningEffort,
      detail: "high",
      prompt_version: CSM_DIRECT_PROMPT_VERSION,
      image_fingerprints: [`sha256:${IMAGE_HASH}`]
    }
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
