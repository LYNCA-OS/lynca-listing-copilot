#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readCanonicalListingImageReferences } from "../lib/listing/storage/canonical-image-references.mjs";
import {
  durableSourceFingerprint,
  login,
  materializeSmokeSourceImagesForAssetReuse,
  prepareDurableSmokeItem,
  readVerifiedAssetCache,
  writeVerifiedAssetCache
} from "./v4-ebay-smoke.mjs";

export const TARGETED_ASSIST_ASSET_PREPARATION_COHORT_SIZE = 10;
export const TARGETED_ASSIST_ASSET_PREPARATION_TOTAL = 20;
export const TARGETED_ASSIST_CANONICAL_VERIFY_MAX_ATTEMPTS = 3;
export const TARGETED_ASSIST_CACHE_WRITE_MAX_ATTEMPTS = 3;

const forbiddenPreparationApiPaths = new Set([
  "/api/listing-copilot-title",
  "/api/listing-preingest",
  "/api/v4/fast-scout-prewarm",
  "/api/v4/listing-copilot-title",
  "/api/v4/listing-job-enqueue",
  "/api/v4/listing-job-pump",
  "/api/v4/listing-job-worker",
  "/api/v4/listing-preingest",
  "/api/v4/listing-preingest-worker"
]);
const forbiddenPreparationProviderHosts = new Set([
  "api.anthropic.com",
  "api.openai.com",
  "generativelanguage.googleapis.com",
  "vision.googleapis.com"
]);

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? fallback : fallback;
}

export function createPreparationOnlyFetch(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("targeted_asset_preparation_fetch_missing");
  let requestCount = 0;
  const guardedFetch = async (input, init) => {
    const rawUrl = typeof input === "string" || input instanceof URL
      ? String(input)
      : String(input?.url || "");
    const url = new URL(rawUrl, "https://preparation.invalid");
    if (
      forbiddenPreparationApiPaths.has(url.pathname)
      || forbiddenPreparationProviderHosts.has(url.hostname.toLowerCase())
    ) {
      const error = new Error(`targeted_asset_preparation_forbidden_network_call:${url.hostname}${url.pathname}`);
      error.code = "targeted_asset_preparation_forbidden_network_call";
      throw error;
    }
    requestCount += 1;
    return fetchImpl(input, init);
  };
  Object.defineProperty(guardedFetch, "requestCount", {
    enumerable: true,
    get: () => requestCount
  });
  return guardedFetch;
}

function datasetItems(dataset = {}) {
  if (Array.isArray(dataset)) return dataset;
  return dataset.items || dataset.records || dataset.results || [];
}

function expectedOriginalCount(item = {}) {
  return (Array.isArray(item.images) ? item.images : []).slice(0, 2).length;
}

function canonicalPrimaryImages(canonical = {}) {
  return (Array.isArray(canonical.images) ? canonical.images : [])
    .filter((image) => image?.derived !== true);
}

function normalizedSha256List(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((value) => cleanText(value).toLowerCase())
    .filter((value) => /^[a-f0-9]{64}$/.test(value))
    .sort();
}

function staleCacheError(code) {
  const error = new Error(code);
  error.code = code;
  error.stale_cache_entry = true;
  return error;
}

function assertCacheEntryContract(entry, { fingerprint, item } = {}) {
  if (!entry || typeof entry !== "object") throw staleCacheError("targeted_asset_cache_entry_missing");
  if (cleanText(entry.fingerprint) !== cleanText(fingerprint)) {
    throw staleCacheError("targeted_asset_cache_fingerprint_mismatch");
  }
  for (const field of ["asset_id", "tenant_id", "image_generation_id"]) {
    if (!cleanText(entry[field])) throw staleCacheError(`targeted_asset_cache_${field}_missing`);
  }
  if (cleanText(entry.image_generation_id) !== cleanText(entry.asset_id)) {
    throw staleCacheError("targeted_asset_cache_generation_mismatch");
  }
  const expectedCount = expectedOriginalCount(item);
  if (!expectedCount || Number(entry.image_count) !== expectedCount) {
    throw staleCacheError("targeted_asset_cache_image_count_mismatch");
  }
  return entry;
}

export function assertCanonicalPreparedAsset({ canonical, entry, fingerprint, item } = {}) {
  assertCacheEntryContract(entry, { fingerprint, item });
  const assetId = cleanText(entry.asset_id);
  const tenantId = cleanText(entry.tenant_id);
  if (
    cleanText(canonical?.asset_id) !== assetId
    || cleanText(canonical?.image_generation_id) !== assetId
    || cleanText(canonical?.tenant_id) !== tenantId
  ) {
    throw staleCacheError("targeted_asset_cache_canonical_identity_mismatch");
  }
  const expectedCount = expectedOriginalCount(item);
  const primaryImages = canonicalPrimaryImages(canonical);
  if (
    Number(canonical?.expected_original_count) !== expectedCount
    || primaryImages.length !== expectedCount
  ) {
    throw staleCacheError("targeted_asset_cache_canonical_image_count_mismatch");
  }
  if (primaryImages.some((image) => (
    image?.storage_verified !== true
    || image?.storageUploaded !== true
    || cleanText(image?.asset_id) !== assetId
    || cleanText(image?.image_generation_id) !== assetId
    || !/^[a-f0-9]{64}$/.test(cleanText(image?.content_sha256).toLowerCase())
  ))) {
    throw staleCacheError("targeted_asset_cache_canonical_verification_incomplete");
  }
  const canonicalHashes = normalizedSha256List(primaryImages.map((image) => image.content_sha256));
  const declaredHashes = normalizedSha256List((item.images || []).slice(0, 2).map((image) => (
    image.content_sha256 || image.contentSha256
  )));
  if (
    declaredHashes.length
    && (declaredHashes.length !== expectedCount || JSON.stringify(declaredHashes) !== JSON.stringify(canonicalHashes))
  ) {
    throw staleCacheError("targeted_asset_cache_source_hash_mismatch");
  }
  const hasCachedHashes = entry.canonical_primary_content_sha256 !== undefined;
  const cachedHashes = normalizedSha256List(entry.canonical_primary_content_sha256);
  if (
    hasCachedHashes
    && (cachedHashes.length !== expectedCount || JSON.stringify(cachedHashes) !== JSON.stringify(canonicalHashes))
  ) {
    throw staleCacheError("targeted_asset_cache_canonical_hash_mismatch");
  }
  if (
    cleanText(entry.canonical_image_set_sha256)
    && cleanText(entry.canonical_image_set_sha256) !== cleanText(canonical.image_set_sha256)
  ) {
    throw staleCacheError("targeted_asset_cache_canonical_set_mismatch");
  }
  if (!/^[a-f0-9]{64}$/.test(cleanText(canonical.image_set_sha256).toLowerCase())) {
    throw staleCacheError("targeted_asset_cache_canonical_set_missing");
  }
  return Object.freeze({
    canonical_image_set_sha256: cleanText(canonical.image_set_sha256),
    canonical_primary_content_sha256: canonicalHashes,
    expected_original_count: expectedCount
  });
}

function isCanonicalInfrastructureFailure(error) {
  const code = cleanText(error?.code || error?.message).toLowerCase();
  return !code
    || Number(error?.statusCode) >= 500
    || code.includes("verification_read_failed")
    || code.includes("asset_read_failed");
}

async function defaultSleep(ms) {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export async function verifyCanonicalPreparedAsset({
  entry,
  fingerprint,
  item,
  canonicalVerifierImpl = readCanonicalListingImageReferences,
  canonicalVerifyMaxAttempts = TARGETED_ASSIST_CANONICAL_VERIFY_MAX_ATTEMPTS,
  env = process.env,
  fetchImpl = globalThis.fetch,
  sleepImpl = defaultSleep
} = {}) {
  assertCacheEntryContract(entry, { fingerprint, item });
  const maxAttempts = Math.max(1, Math.trunc(Number(canonicalVerifyMaxAttempts) || 1));
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const canonical = await canonicalVerifierImpl({
        tenantId: entry.tenant_id,
        assetId: entry.asset_id,
        env,
        fetchImpl
      });
      return {
        canonical,
        contract: assertCanonicalPreparedAsset({ canonical, entry, fingerprint, item }),
        attempts: attempt
      };
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < maxAttempts && error?.retryable === true;
      if (!shouldRetry) break;
      await sleepImpl(Math.min(250, 25 * (2 ** (attempt - 1))));
    }
  }
  throw lastError;
}

async function persistCacheWithRetry({
  cachePath,
  entries,
  writeCacheImpl,
  maxAttempts = TARGETED_ASSIST_CACHE_WRITE_MAX_ATTEMPTS,
  sleepImpl = defaultSleep
}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await writeCacheImpl(cachePath, entries);
      return attempt;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await sleepImpl(Math.min(250, 25 * (2 ** (attempt - 1))));
    }
  }
  throw lastError;
}

function normalizedCohorts(cohorts = []) {
  const rows = cohorts.map((cohort) => ({
    cohort: cleanText(cohort?.cohort).toUpperCase(),
    items: Array.isArray(cohort?.items) ? cohort.items : []
  }));
  if (
    rows.length !== 2
    || rows[0].cohort !== "FAMILIAR"
    || rows[1].cohort !== "UNSEEN"
    || rows.some((cohort) => cohort.items.length !== TARGETED_ASSIST_ASSET_PREPARATION_COHORT_SIZE)
  ) {
    throw new Error("targeted_asset_preparation_requires_familiar10_and_unseen10");
  }
  return rows;
}

export async function materializeTargetedAssistVerifiedAssets({
  cohorts = [],
  baseUrl,
  username,
  password,
  cachePath,
  sourceStorageUrl = "",
  sourceStorageServiceRoleKey = "",
  sourceMaterializationDir = "/tmp/targeted-assist-source-images",
  requestTimeoutMs = 90_000,
  env = process.env,
  fetchImpl = globalThis.fetch,
  loginImpl = login,
  readCacheImpl = readVerifiedAssetCache,
  writeCacheImpl = writeVerifiedAssetCache,
  fingerprintImpl = durableSourceFingerprint,
  materializeSourcesImpl = materializeSmokeSourceImagesForAssetReuse,
  prepareItemImpl = prepareDurableSmokeItem,
  canonicalVerifierImpl = readCanonicalListingImageReferences,
  sleepImpl = defaultSleep,
  nowImpl = () => new Date()
} = {}) {
  const fixedCohorts = normalizedCohorts(cohorts);
  if (!cleanText(baseUrl) || !cleanText(username) || !cleanText(password) || !cleanText(cachePath)) {
    throw new Error("targeted_asset_preparation_connection_inputs_missing");
  }
  const preparationFetch = createPreparationOnlyFetch(fetchImpl);
  const cookie = await loginImpl({ baseUrl, username, password, fetchImpl: preparationFetch });
  let cacheEntries = await readCacheImpl(cachePath);
  if (!(cacheEntries instanceof Map)) cacheEntries = new Map(Object.entries(cacheEntries || {}));
  const results = [];
  const expectedFingerprints = new Set();
  let cacheWriteAttempts = 0;

  for (const cohort of fixedCohorts) {
    for (let index = 0; index < cohort.items.length; index += 1) {
      const item = cohort.items[index];
      const fingerprint = await fingerprintImpl(item, index);
      if (expectedFingerprints.has(fingerprint)) {
        throw new Error(`targeted_asset_preparation_duplicate_fingerprint:${cohort.cohort}:${index + 1}`);
      }
      expectedFingerprints.add(fingerprint);
      const initialEntry = cacheEntries.get(fingerprint) || null;
      let reusableEntry = null;
      let staleReason = null;
      let initialCanonicalAttempts = 0;

      if (initialEntry) {
        try {
          const verified = await verifyCanonicalPreparedAsset({
            entry: initialEntry,
            fingerprint,
            item,
            canonicalVerifierImpl,
            env,
            fetchImpl: preparationFetch,
            sleepImpl
          });
          reusableEntry = initialEntry;
          initialCanonicalAttempts = verified.attempts;
        } catch (error) {
          if (isCanonicalInfrastructureFailure(error)) throw error;
          staleReason = cleanText(error?.code || error?.message) || "targeted_asset_cache_stale";
          cacheEntries.delete(fingerprint);
          cacheWriteAttempts += await persistCacheWithRetry({
            cachePath,
            entries: cacheEntries,
            writeCacheImpl,
            sleepImpl
          });
        }
      }

      const validatedEntries = reusableEntry
        ? new Map([[fingerprint, reusableEntry]])
        : new Map();
      const [materializedItem] = await materializeSourcesImpl([item], {
        assetCacheEntries: validatedEntries,
        supabaseUrl: sourceStorageUrl,
        serviceRoleKey: sourceStorageServiceRoleKey,
        outputDirectory: resolve(sourceMaterializationDir, cohort.cohort.toLowerCase()),
        fetchImpl: preparationFetch
      });
      const prepared = await prepareItemImpl({
        item: materializedItem,
        index,
        baseUrl,
        cookie,
        requestTimeoutMs,
        sourceFingerprint: fingerprint,
        cachedAssetEntry: reusableEntry,
        fetchImpl: preparationFetch
      });
      if (
        reusableEntry
        && (
          prepared?.preparation_diagnostics?.asset_cache_hit !== true
          || prepared?.preparation_diagnostics?.upload_skipped_due_to_verified_asset_cache !== true
        )
      ) {
        throw new Error(`targeted_asset_preparation_reuse_failed:${cohort.cohort}:${index + 1}`);
      }
      if (!prepared?.asset_cache_entry?.asset_id) {
        throw new Error(`targeted_asset_preparation_entry_missing:${cohort.cohort}:${index + 1}`);
      }

      const finalVerification = await verifyCanonicalPreparedAsset({
        entry: prepared.asset_cache_entry,
        fingerprint,
        item: materializedItem,
        canonicalVerifierImpl,
        env,
        fetchImpl: preparationFetch,
        sleepImpl
      });
      const verifiedAt = nowImpl().toISOString();
      const durableEntry = {
        ...prepared.asset_cache_entry,
        fingerprint,
        image_count: finalVerification.contract.expected_original_count,
        canonical_image_set_sha256: finalVerification.contract.canonical_image_set_sha256,
        canonical_primary_content_sha256: finalVerification.contract.canonical_primary_content_sha256,
        canonical_verified_at: verifiedAt
      };
      cacheEntries.set(fingerprint, durableEntry);
      cacheWriteAttempts += await persistCacheWithRetry({
        cachePath,
        entries: cacheEntries,
        writeCacheImpl,
        sleepImpl
      });
      results.push({
        cohort: cohort.cohort,
        item_index: index,
        fingerprint,
        source_asset_id: cleanText(prepared.source_asset_id || durableEntry.source_asset_id) || null,
        source_feedback_id: cleanText(durableEntry.source_feedback_id || item.source_feedback_id) || null,
        asset_id: durableEntry.asset_id,
        tenant_id: durableEntry.tenant_id,
        cache_entry_reused: reusableEntry !== null,
        stale_entry_replaced: staleReason !== null,
        stale_reason: staleReason,
        canonical_verify_attempts: initialCanonicalAttempts + finalVerification.attempts,
        canonical_image_set_sha256: durableEntry.canonical_image_set_sha256,
        preparation_diagnostics: prepared.preparation_diagnostics || null
      });
    }
  }

  if (
    results.length !== TARGETED_ASSIST_ASSET_PREPARATION_TOTAL
    || expectedFingerprints.size !== TARGETED_ASSIST_ASSET_PREPARATION_TOTAL
  ) {
    throw new Error("targeted_asset_preparation_coverage_incomplete");
  }
  const persistedPayload = await readCacheImpl(cachePath);
  const persistedEntries = persistedPayload instanceof Map
    ? persistedPayload
    : new Map(Object.entries(persistedPayload || {}));
  for (const fingerprint of expectedFingerprints) {
    const entry = persistedEntries.get(fingerprint);
    if (
      !entry
      || cleanText(entry.fingerprint) !== fingerprint
      || !cleanText(entry.canonical_verified_at)
      || !/^[a-f0-9]{64}$/.test(cleanText(entry.canonical_image_set_sha256).toLowerCase())
    ) {
      throw new Error(`targeted_asset_preparation_cache_readback_failed:${fingerprint}`);
    }
  }
  return Object.freeze({
    schema_version: "targeted-assist-verified-asset-preparation-v1",
    prepared_item_count: results.length,
    verified_cache_entry_count: expectedFingerprints.size,
    reused_verified_entry_count: results.filter((row) => row.cache_entry_reused).length,
    uploaded_verified_entry_count: results.filter((row) => !row.cache_entry_reused).length,
    stale_entry_replaced_count: results.filter((row) => row.stale_entry_replaced).length,
    cache_write_attempts: cacheWriteAttempts,
    preparation_network_request_count: preparationFetch.requestCount,
    zero_enqueue_or_provider_calls: true,
    all_assets_uploaded_and_canonically_verified: true,
    cache_path: resolve(cachePath),
    results
  });
}

export async function materializeTargetedAssistVerifiedAssetsFromDatasets({
  familiarDataset,
  unseenDataset,
  ...options
} = {}) {
  if (!familiarDataset || !unseenDataset) {
    throw new Error("targeted_asset_preparation_dataset_paths_missing");
  }
  const [familiar, unseen] = await Promise.all([
    readFile(resolve(familiarDataset), "utf8").then(JSON.parse),
    readFile(resolve(unseenDataset), "utf8").then(JSON.parse)
  ]);
  return materializeTargetedAssistVerifiedAssets({
    ...options,
    cohorts: [
      { cohort: "FAMILIAR", items: datasetItems(familiar) },
      { cohort: "UNSEEN", items: datasetItems(unseen) }
    ]
  });
}

export async function main(argv = process.argv.slice(2)) {
  const reportPath = resolve(argValue(
    argv,
    "--report",
    "/tmp/targeted-assist-asset-preparation.json"
  ));
  const result = await materializeTargetedAssistVerifiedAssetsFromDatasets({
    familiarDataset: argValue(argv, "--familiar-dataset"),
    unseenDataset: argValue(argv, "--unseen-dataset"),
    baseUrl: cleanText(argValue(argv, "--base-url", process.env.API_BASE_URL)).replace(/\/+$/, ""),
    username: cleanText(argValue(argv, "--username", process.env.METAVERSE_USERNAME)),
    password: cleanText(argValue(argv, "--password", process.env.METAVERSE_PASSWORD)),
    cachePath: argValue(argv, "--verified-asset-cache"),
    sourceStorageUrl: cleanText(argValue(argv, "--source-storage-url", process.env.SUPABASE_URL)),
    sourceStorageServiceRoleKey: cleanText(argValue(
      argv,
      "--source-storage-service-role-key",
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )),
    sourceMaterializationDir: argValue(
      argv,
      "--source-materialization-dir",
      "/tmp/targeted-assist-source-images"
    ),
    requestTimeoutMs: Math.max(20_000, Number(argValue(argv, "--request-timeout-ms", "90000")) || 90_000)
  });
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
