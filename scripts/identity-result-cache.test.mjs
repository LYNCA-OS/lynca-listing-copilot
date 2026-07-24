import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runNativeV4Recognition } from "../lib/listing/v4/pipeline/native-recognition-core.mjs";
import {
  buildIdentityResultCacheKey,
  buildTenantScopedIdentityInFlightKey,
  identityResultCacheRecordToListingResult,
  identityResultToCacheRow,
  isCacheableIdentityResult,
  readIdentityResultCacheRecord,
  saveIdentityResultCacheRecord
} from "../lib/listing/cache/identity-result-cache.mjs";

process.env.METAVERSE_AUTH_SECRET = "test-secret";
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.LISTING_APPROVED_MEMORY_ENABLED = "false";
process.env.LISTING_IDENTITY_CACHE_READ_ENABLED = "true";
process.env.LISTING_IDENTITY_CACHE_WRITE_ENABLED = "false";
process.env.DEFAULT_VISION_PROVIDER = "openai_legacy";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.OPENAI_LISTING_MODEL = "gpt-4.1-mini-2025-04-14";

const tenantId = "tenant-cache";
const secondTenantId = "tenant-cache-second";
const userId = "user-cache";
const assetId = "asset_22222222-2222-4222-8222-222222222222";
const secondAssetId = "asset_44444444-4444-4444-8444-444444444444";

function makeImage({
  id,
  role,
  objectPath,
  contentSha256
}) {
  return {
    id,
    assetId,
    storageRole: role,
    objectPath,
    bucket: "listing-card-images",
    originalType: "image/jpeg",
    originalSize: 12345,
    originalWidth: 900,
    originalHeight: 1260,
    contentSha256,
    storageVerified: true
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  };
}

async function callTitleApi(payload) {
  return runNativeV4Recognition({
    payload
  });
}

const images = [
  makeImage({
    id: "front",
    role: "front_original",
    objectPath: `tenants/${tenantId}/listing-assets/2026-06-23/${assetId}/front.jpg`,
    contentSha256: "c".repeat(64)
  }),
  makeImage({
    id: "back",
    role: "back_original",
    objectPath: `tenants/${tenantId}/listing-assets/2026-06-23/${assetId}/back.jpg`,
    contentSha256: "d".repeat(64)
  })
];
const payload = {
  assetId,
  tenant_id: tenantId,
  mode: "single",
  images,
  resolutionMap: {},
  maxTitleLength: 80
};
const secondImages = images.map((image) => ({
  ...image,
  assetId: secondAssetId,
  objectPath: image.objectPath
    .replace(`tenants/${tenantId}/`, `tenants/${secondTenantId}/`)
    .replace(assetId, secondAssetId)
}));
const secondPayload = {
  ...payload,
  assetId: secondAssetId,
  tenant_id: secondTenantId,
  images: secondImages
};
const key = buildIdentityResultCacheKey(payload);
const secondTenantKey = buildIdentityResultCacheKey(secondPayload);
assert.equal(key.ok, true);
assert.equal(secondTenantKey.ok, true);
assert.equal(secondTenantKey.cache_key, key.cache_key, "identical verified content must reuse one global result across tenants");
assert.match(key.cache_key, /^[0-9a-f]{64}$/);
assert.match(key.image_generation_hash, /^[0-9a-f]{64}$/);
assert.match(key.version_fingerprint, /^[0-9a-f]{64}$/);
assert.equal(key.tenant_id, tenantId);
assert.equal(key.result_version.model_revision, "gpt-4.1-mini-2025-04-14");
assert.equal(key.result_version.sem_version, "linear-cos-10-23-v25");
assert.equal(key.result_version.renderer_version, "renderer-v3-scg");

const noTenantKey = buildIdentityResultCacheKey({ images });
assert.equal(noTenantKey.ok, true);
assert.equal(noTenantKey.cache_key, key.cache_key);
assert.notEqual(
  buildTenantScopedIdentityInFlightKey(payload),
  buildTenantScopedIdentityInFlightKey(secondPayload),
  "unfinished in-flight results remain tenant scoped"
);

const catalogRevisionKey = buildIdentityResultCacheKey(payload, {
  ...process.env,
  LISTING_CATALOG_SNAPSHOT_VERSION: "catalog-snapshot-test-v2"
});
assert.notEqual(catalogRevisionKey.cache_key, key.cache_key);
assert.notEqual(catalogRevisionKey.version_fingerprint, key.version_fingerprint);

const modelRevisionKey = buildIdentityResultCacheKey(payload, {
  ...process.env,
  OPENAI_LISTING_MODEL: "gpt-5-mini"
});
assert.notEqual(modelRevisionKey.cache_key, key.cache_key);
assert.notEqual(modelRevisionKey.version_fingerprint, key.version_fingerprint);

const noHashKey = buildIdentityResultCacheKey({
  images: [{ ...images[0], contentSha256: "" }]
});
assert.equal(noHashKey.ok, false);
assert.equal(noHashKey.reason, "content_hash_required");

const confirmedResult = {
  final_title: "2025 Topps Chrome Cooper Flagg Gold Refractor 31/50 RC PSA 10",
  provider: "openai_legacy",
  identity_resolution_status: "CONFIRMED",
  ambiguity_status: "CONFIRMED",
  resolved: {
    year: "2025",
    manufacturer: "Topps",
    product: "Topps Chrome",
    players: ["Cooper Flagg"],
    parallel: "Gold Refractor",
    serial_number: "31/50",
    grade_company: "PSA",
    card_grade: "10",
    grade_type: "CARD_ONLY"
  },
  fields: {
    year: "2025",
    brand: "Topps",
    product: "Topps Chrome",
    player: "Cooper Flagg",
    serial_number: "31/50",
    grade_company: "PSA",
    grade: "10"
  },
  evidence: {
    players: {
      value: ["Cooper Flagg"],
      confidence: 0.92,
      sources: [{
        source_type: "CARD_FRONT_PRINTED_TEXT",
        observed_text: "Cooper Flagg",
        tenant_id: tenantId,
        asset_id: assetId,
        object_path: images[0].objectPath,
        signed_url: `https://supabase.test/storage/v1/object/sign/${images[0].objectPath}?token=private`
      }]
    }
  },
  field_states: [
    { field: "players", resolved_value: ["Cooper Flagg"], resolution_confidence: 0.92 }
  ],
  conflict_map: [],
  resolution_trace: [
    {
      phase: "solver",
      step: "select_identity",
      decision: "confirmed"
    }
  ],
  confidence_report: {
    global_confidence: 0.91
  }
};
assert.equal(isCacheableIdentityResult(confirmedResult).ok, true);
assert.equal(isCacheableIdentityResult({ ...confirmedResult, identity_resolution_status: "ABSTAIN" }).ok, true);
assert.equal(isCacheableIdentityResult({
  ...confirmedResult,
  identity_resolution_status: "ABSTAIN",
  ambiguity_status: "AMBIGUOUS"
}).reason, "cacheable_terminal_l2_draft");
assert.equal(isCacheableIdentityResult({
  ...confirmedResult,
  identity_resolution_status: "ABSTAIN",
  resolved: {},
  unresolved: ["Identity resolution abstain"]
}).reason, "cacheable_terminal_l2_draft");
assert.equal(isCacheableIdentityResult({
  ...confirmedResult,
  identity_resolution_status: "ABSTAIN",
  technical_failure: true
}).reason, "technical_failure_not_cacheable");
assert.equal(isCacheableIdentityResult({
  ...confirmedResult,
  identity_resolution_status: "ABSTAIN",
  assisted_draft_status: "FAILED"
}).reason, "failed_draft_not_cacheable");
assert.equal(isCacheableIdentityResult({ ...confirmedResult, identity_resolution_status: "RESOLVED" }).reason, "resolved_cache_write_disabled");

const built = identityResultToCacheRow({
  result: confirmedResult,
  payload,
  now: new Date("2026-06-23T10:00:00.000Z")
});
assert.equal(built.ok, true);
assert.equal(built.row.cache_key, key.cache_key);
assert.equal(Object.hasOwn(built.row, "tenant_id"), false);
assert.equal(built.row.image_generation_hash, key.image_generation_hash);
assert.equal(built.row.version_fingerprint, key.version_fingerprint);
assert.deepEqual(built.row.result_version, key.result_version);
assert.equal(built.row.identity_status, "CONFIRMED");
assert.equal(built.row.image_fingerprints.length, 2);
assert.equal(built.row.image_fingerprints.every((item) => !Object.hasOwn(item, "object_path")), true);
assert.equal(built.row.final_title, confirmedResult.final_title);
assert.equal(built.row.resolution_trace.length, 0);
assert.deepEqual(built.row.evidence_snapshot, {});
assert.equal(built.row.identity_resolution, null);
assert.doesNotMatch(JSON.stringify(built.row), /tenant-cache|listing-assets|signedUrl|signed_url|asset_222/);

const cachedResult = identityResultCacheRecordToListingResult({
  record: built.row,
  payload,
  latencyMs: 12
});
assert.equal(cachedResult.source, "internal_identity_result_cache");
assert.equal(cachedResult.provider, "internal_identity_result_cache");
assert.equal(cachedResult.identity_cache.cache_hit, true);
assert.equal(cachedResult.identity_cache.provider_call_skipped, true);
assert.equal(cachedResult.identity_cache.cached_result_version_match, true);
assert.equal(cachedResult.identity_cache.cache_scope, "global_verified_content");
assert.equal(Object.hasOwn(cachedResult.identity_cache, "tenant_id"), false);
assert.equal(cachedResult.usage.provider_calls, 0);
assert.equal(cachedResult.usage.recognition_worker_calls, 0);
assert.equal(cachedResult.resolution_trace[0].phase, "identity_result_cache");
assert.equal(cachedResult.resolution_trace.length, 1);
assert.match(cachedResult.final_title, /2025 Topps Chrome Cooper Flagg/);

const fetchCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const requestUrl = new URL(String(url));
  const table = requestUrl.pathname.split("/").at(-1);
  fetchCalls.push({
    table,
    url: requestUrl.href,
    method: options.method || "GET",
    body: options.body ? JSON.parse(options.body) : null
  });

  if (table === "listing_image_verifications") {
    const objectPath = requestUrl.searchParams.get("object_path")?.replace(/^eq\./, "");
    const image = [...images, ...secondImages].find((item) => item.objectPath === objectPath);
    assert.ok(image, `unexpected verification object path ${objectPath}`);
    const requestTenantId = objectPath.startsWith(`tenants/${secondTenantId}/`) ? secondTenantId : tenantId;
    const requestAssetId = requestTenantId === secondTenantId ? secondAssetId : assetId;
    return jsonResponse([
      {
        tenant_id: requestTenantId,
        object_path: image.objectPath,
        bucket: image.bucket,
        asset_id: requestAssetId,
        content_type: image.originalType,
        size: image.originalSize,
        width: image.originalWidth,
        height: image.originalHeight,
        content_sha256: image.contentSha256,
        object_verified: true,
        content_hash_verified: true,
        dimension_source: "upload",
        verified_at: "2026-06-23T00:00:00.000Z",
        updated_at: "2026-06-23T00:00:00.000Z"
      }
    ]);
  }

  if (table === "listing_identity_resolution_cache") {
    if ((options.method || "GET") === "POST") {
      return jsonResponse([{ ...options.body, cache_key: key.cache_key }]);
    }
    assert.equal(requestUrl.searchParams.get("cache_key"), `eq.${key.cache_key}`);
    assert.equal(requestUrl.searchParams.get("cache_status"), "eq.active");
    return jsonResponse([built.row]);
  }

  throw new Error(`Unexpected remote call: ${requestUrl.href}`);
};

const read = await readIdentityResultCacheRecord({ cacheKey: key.cache_key });
assert.equal(read.hit, true);
assert.equal(read.record.cache_key, key.cache_key);

let mismatchProbeCount = 0;
const mismatch = await readIdentityResultCacheRecord({
  cacheKey: "e".repeat(64),
  imageGenerationHash: key.image_generation_hash,
  expectedVersion: { fingerprint: "f".repeat(64) },
  fetchImpl: async (url) => {
    const requestUrl = new URL(String(url));
    mismatchProbeCount += 1;
    if (requestUrl.searchParams.has("cache_key")) return jsonResponse([]);
    assert.equal(requestUrl.searchParams.has("tenant_id"), false);
    assert.equal(requestUrl.searchParams.get("image_generation_hash"), `eq.${key.image_generation_hash}`);
    return jsonResponse([{
      cache_key: key.cache_key,
      version_fingerprint: key.version_fingerprint,
      result_version: key.result_version,
      updated_at: "2026-06-23T10:00:00.000Z"
    }]);
  }
});
assert.equal(mismatchProbeCount, 2);
assert.equal(mismatch.hit, false);
assert.equal(mismatch.reason, "cached_result_version_mismatch");
assert.equal(mismatch.cached_result_version_match, false);

process.env.LISTING_IDENTITY_CACHE_WRITE_ENABLED = "true";
const saved = await saveIdentityResultCacheRecord({
  result: confirmedResult,
  payload,
  cacheKey: key.cache_key,
  imageFingerprints: key.image_fingerprints,
  now: new Date("2026-06-23T10:00:00.000Z")
});
assert.equal(saved.saved, true);
assert.equal(saved.cache_key, key.cache_key);

process.env.LISTING_IDENTITY_CACHE_WRITE_ENABLED = "false";
fetchCalls.length = 0;
const response = await callTitleApi(secondPayload);
assert.equal(response.statusCode, 200);
assert.equal(response.body.source, "internal_identity_result_cache");
assert.equal(response.body.provider, "internal_identity_result_cache");
assert.equal(response.body.identity_cache.cache_hit, true);
assert.equal(response.body.identity_cache.provider_call_skipped, true);
assert.equal(response.body.identity_cache.cached_result_version_match, true);
assert.equal(response.body.identity_cache.cache_scope, "global_verified_content");
assert.equal(Object.hasOwn(response.body.identity_cache, "tenant_id"), false);
assert.equal(response.body.identity_cache.cache_key, key.cache_key);
assert.equal(response.body.asset_id, secondAssetId);
assert.equal(response.body.usage.provider_calls, 0);
assert.equal(response.body.usage.recognition_worker_calls, 0);
assert.match(response.body.final_title, /2025 Topps Chrome Cooper Flagg/);
assert.deepEqual(fetchCalls.map((call) => call.table), [
  "listing_image_verifications",
  "listing_image_verifications",
  "listing_identity_resolution_cache"
]);

const migration = await readFile("supabase/migrations/20260623_listing_identity_result_cache.sql", "utf8");
assert.match(migration, /create table if not exists public\.listing_identity_resolution_cache/i);
assert.match(migration, /resolution_trace jsonb not null default '\[\]'::jsonb/i);
assert.match(migration, /alter table public\.listing_identity_resolution_cache enable row level security/i);
assert.match(migration, /grant select, insert, update, delete on table public\.listing_identity_resolution_cache to service_role/i);
assert.match(migration, /revoke all on table public\.listing_identity_resolution_cache from anon, authenticated/i);
assert.doesNotMatch(migration, /grant\s+[^;]*\s+to\s+(anon|authenticated)/i);
assert.match(migration, /Not a training table/i);

const versionMigration = await readFile("supabase/migrations/20260724_listing_identity_cache_version_contract.sql", "utf8");
assert.doesNotMatch(versionMigration, /add column if not exists tenant_scope text/i);
assert.match(versionMigration, /add column if not exists image_generation_hash text/i);
assert.match(versionMigration, /add column if not exists version_fingerprint text/i);
assert.match(versionMigration, /add column if not exists result_version jsonb/i);
assert.match(versionMigration, /listing_identity_resolution_cache_generation_version_idx/i);

const terminalL2Migration = await readFile("supabase/migrations/20260724_listing_identity_cache_terminal_l2.sql", "utf8");
assert.match(terminalL2Migration, /drop constraint if exists listing_identity_resolution_cache_identity_status_check/i);
assert.match(terminalL2Migration, /identity_status in \('CONFIRMED', 'RESOLVED', 'ABSTAIN'\)/i);

const globalScopeMigration = await readFile("supabase/migrations/20260724224500_listing_identity_cache_global_scope_v1.sql", "utf8");
assert.match(globalScopeMigration, /drop column if exists tenant_id cascade/i);
assert.match(globalScopeMigration, /listing_identity_resolution_cache_global_generation_version_idx/i);
assert.match(globalScopeMigration, /Tenant ids, object paths, signed URLs, asset ids, and user data are forbidden/i);

console.log("identity result cache tests passed");
