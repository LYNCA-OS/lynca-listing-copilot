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
  image_references: [{ objectPath: "tenant-1/a.jpg", content_sha256: IMAGE_HASH }],
  images: [{
    objectPath: "tenant-1/a.jpg",
    bucket: "cards",
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
  assert.deepEqual(events, ["readiness", "images", "sign", "session", "model_and_csm", "persist_csm"]);
  assert.ok(result.latency_stages_ms.preflight_ms >= 0);
  assert.ok(result.latency_stages_ms.image_manifest_ms >= 0);
  assert.ok(result.latency_stages_ms.signed_url_ms >= 0);
  assert.ok(result.latency_stages_ms.recognition_session_ms >= 0);
  assert.ok(result.latency_stages_ms.provider_prepare_ms >= 0);
  assert.ok(result.latency_stages_ms.authority_dispatch_ms >= 0);
  assert.ok(result.latency_stages_ms.csm_persistence_ms >= 0);
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
