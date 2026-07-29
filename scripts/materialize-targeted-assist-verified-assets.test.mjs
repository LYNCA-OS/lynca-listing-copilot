import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  assertCanonicalPreparedAsset,
  createPreparationOnlyFetch,
  materializeTargetedAssistVerifiedAssets,
  verifyCanonicalPreparedAsset
} from "./materialize-targeted-assist-verified-assets.mjs";

const sha256 = "a".repeat(64);
const imageSetSha256 = "b".repeat(64);

function item(id) {
  return {
    id,
    images: [{
      image_id: `${id}-front`,
      role: "front_original",
      local_path: `/fixtures/${id}.jpg`,
      content_sha256: sha256
    }]
  };
}

function entry(id, fingerprint = `fp-${id}`) {
  return {
    fingerprint,
    source_asset_id: id,
    asset_id: `asset-${id}`,
    tenant_id: "tenant-test",
    image_generation_id: `asset-${id}`,
    image_count: 1,
    verified_at: "2026-07-29T00:00:00.000Z"
  };
}

function canonicalFor(cacheEntry) {
  return {
    tenant_id: cacheEntry.tenant_id,
    asset_id: cacheEntry.asset_id,
    image_generation_id: cacheEntry.asset_id,
    expected_original_count: 1,
    image_set_sha256: imageSetSha256,
    images: [{
      image_id: `${cacheEntry.source_asset_id}-front`,
      derived: false,
      storage_verified: true,
      storageUploaded: true,
      asset_id: cacheEntry.asset_id,
      image_generation_id: cacheEntry.asset_id,
      content_sha256: sha256
    }]
  };
}

const familiar = Array.from({ length: 10 }, (_, index) => item(`familiar-${index + 1}`));
const unseen = Array.from({ length: 10 }, (_, index) => item(`unseen-${index + 1}`));
const validEntry = entry(familiar[0].id);
const staleEntry = entry(familiar[1].id);
let persisted = new Map([
  [validEntry.fingerprint, validEntry],
  [staleEntry.fingerprint, staleEntry]
]);
let writeCalls = 0;
let failedWriteInjected = false;
const writeSnapshots = [];
const sourceDownloads = [];
const prepareCalls = [];
const canonicalCalls = [];

const report = await materializeTargetedAssistVerifiedAssets({
  cohorts: [
    { cohort: "FAMILIAR", items: familiar },
    { cohort: "UNSEEN", items: unseen }
  ],
  baseUrl: "https://listing.test",
  username: "writer",
  password: "secret",
  cachePath: "/tmp/targeted-assist-assets.test.json",
  loginImpl: async ({ baseUrl, username, password }) => {
    assert.equal(baseUrl, "https://listing.test");
    assert.equal(username, "writer");
    assert.equal(password, "secret");
    return "session=test";
  },
  readCacheImpl: async () => new Map(persisted),
  writeCacheImpl: async (_path, entries) => {
    writeCalls += 1;
    if (!failedWriteInjected) {
      failedWriteInjected = true;
      throw new Error("transient rename failure");
    }
    persisted = new Map(entries);
    writeSnapshots.push(new Map(entries));
  },
  fingerprintImpl: async (sourceItem) => `fp-${sourceItem.id}`,
  materializeSourcesImpl: async ([sourceItem], { assetCacheEntries }) => {
    if (!assetCacheEntries.size) sourceDownloads.push(sourceItem.id);
    return [{ ...sourceItem, materialized: assetCacheEntries.size === 0 }];
  },
  prepareItemImpl: async ({ item: sourceItem, cachedAssetEntry, sourceFingerprint, cookie }) => {
    assert.equal(cookie, "session=test");
    prepareCalls.push({ id: sourceItem.id, cacheHit: Boolean(cachedAssetEntry) });
    const cacheEntry = cachedAssetEntry || entry(sourceItem.id, sourceFingerprint);
    return {
      asset_cache_entry: cacheEntry,
      preparation_diagnostics: {
        asset_cache_hit: Boolean(cachedAssetEntry),
        upload_skipped_due_to_verified_asset_cache: Boolean(cachedAssetEntry)
      }
    };
  },
  canonicalVerifierImpl: async ({ tenantId, assetId }) => {
    canonicalCalls.push(assetId);
    if (assetId === staleEntry.asset_id && canonicalCalls.filter((value) => value === assetId).length === 1) {
      const error = new Error("canonical_listing_asset_not_found");
      error.code = "canonical_listing_asset_not_found";
      error.statusCode = 404;
      error.retryable = false;
      throw error;
    }
    const cacheEntry = [...persisted.values()].find((value) => value.asset_id === assetId)
      || entry(assetId.replace(/^asset-/, ""));
    assert.equal(tenantId, cacheEntry.tenant_id);
    return canonicalFor(cacheEntry);
  },
  sleepImpl: async () => {},
  nowImpl: () => new Date("2026-07-29T01:02:03.000Z")
});

assert.equal(report.prepared_item_count, 20);
assert.equal(report.verified_cache_entry_count, 20);
assert.equal(report.reused_verified_entry_count, 1);
assert.equal(report.uploaded_verified_entry_count, 19);
assert.equal(report.stale_entry_replaced_count, 1);
assert.equal(report.cache_write_attempts, 22, "each item is persisted, stale removal is persisted, and one write retries");
assert.equal(report.preparation_network_request_count, 0);
assert.equal(report.zero_enqueue_or_provider_calls, true);
assert.equal(report.all_assets_uploaded_and_canonically_verified, true);
assert.equal(persisted.size, 20);
assert.equal(writeCalls, 22);
assert.equal(prepareCalls.length, 20);
assert.deepEqual(prepareCalls.filter((call) => call.cacheHit).map((call) => call.id), [familiar[0].id]);
assert.equal(sourceDownloads.includes(familiar[0].id), false, "live-verified cache reuse skips source bytes");
assert.equal(sourceDownloads.includes(familiar[1].id), true, "stale cache entry rematerializes source bytes");
assert.equal(sourceDownloads.length, 19);
assert.ok(
  writeSnapshots.some((snapshot) => !snapshot.has(staleEntry.fingerprint)),
  "stale association is durably removed before replacement upload"
);
for (const cacheEntry of persisted.values()) {
  assert.equal(cacheEntry.canonical_verified_at, "2026-07-29T01:02:03.000Z");
  assert.equal(cacheEntry.canonical_image_set_sha256, imageSetSha256);
  assert.deepEqual(cacheEntry.canonical_primary_content_sha256, [sha256]);
}

let canonicalAttempt = 0;
const retryEntry = entry("retry");
const retried = await verifyCanonicalPreparedAsset({
  entry: retryEntry,
  fingerprint: retryEntry.fingerprint,
  item: item("retry"),
  canonicalVerifierImpl: async () => {
    canonicalAttempt += 1;
    if (canonicalAttempt < 3) {
      const error = new Error("canonical_verified_image_set_incomplete");
      error.code = "canonical_verified_image_set_incomplete";
      error.retryable = true;
      throw error;
    }
    return canonicalFor(retryEntry);
  },
  sleepImpl: async () => {}
});
assert.equal(retried.attempts, 3);

assert.throws(() => assertCanonicalPreparedAsset({
  canonical: { ...canonicalFor(validEntry), image_set_sha256: "" },
  entry: validEntry,
  fingerprint: validEntry.fingerprint,
  item: familiar[0]
}), /canonical_set_missing/);

let infrastructureWrites = 0;
let infrastructureMaterializations = 0;
await assert.rejects(() => materializeTargetedAssistVerifiedAssets({
  cohorts: [
    { cohort: "FAMILIAR", items: familiar },
    { cohort: "UNSEEN", items: unseen }
  ],
  baseUrl: "https://listing.test",
  username: "writer",
  password: "secret",
  cachePath: "/tmp/targeted-assist-assets-infra.test.json",
  loginImpl: async () => "session=test",
  readCacheImpl: async () => new Map([[validEntry.fingerprint, validEntry]]),
  writeCacheImpl: async () => { infrastructureWrites += 1; },
  fingerprintImpl: async (sourceItem) => `fp-${sourceItem.id}`,
  materializeSourcesImpl: async (items) => {
    infrastructureMaterializations += 1;
    return items;
  },
  canonicalVerifierImpl: async () => {
    const error = new Error("canonical_image_verification_read_failed");
    error.code = "canonical_image_verification_read_failed";
    error.statusCode = 503;
    error.retryable = true;
    throw error;
  },
  sleepImpl: async () => {}
}), /canonical_image_verification_read_failed/);
assert.equal(infrastructureWrites, 0, "transient canonical reads must not evict a cache entry");
assert.equal(infrastructureMaterializations, 0, "transient canonical reads must fail before duplicate upload");

const allowedRequests = [];
const guardedFetch = createPreparationOnlyFetch(async (input) => {
  allowedRequests.push(String(input));
  return { ok: true };
});
await guardedFetch("https://listing.test/api/login");
await guardedFetch("https://listing.test/api/listing-asset-create");
await guardedFetch("https://storage.test/storage/v1/object/upload/sign/example");
assert.equal(guardedFetch.requestCount, 3);
assert.equal(allowedRequests.length, 3);
for (const forbiddenUrl of [
  "https://listing.test/api/v4/listing-job-enqueue",
  "https://listing.test/api/v4/listing-copilot-title",
  "https://listing.test/api/listing-preingest",
  "https://api.openai.com/v1/responses"
]) {
  await assert.rejects(() => guardedFetch(forbiddenUrl), /targeted_asset_preparation_forbidden_network_call/);
}
assert.equal(guardedFetch.requestCount, 3, "forbidden calls are rejected before network I/O");

const source = await readFile(new URL("./materialize-targeted-assist-verified-assets.mjs", import.meta.url), "utf8");
assert.doesNotMatch(source, /runV4EbaySmoke|enqueueSpeculativeItem|preingestItem/);

console.log("targeted assist verified asset materializer tests passed");
