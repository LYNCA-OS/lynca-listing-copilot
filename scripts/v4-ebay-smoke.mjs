import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchWithBoundedRetry } from "../lib/listing/client/bounded-fetch.mjs";
import { fairTokenRecall, policyFairTokenRecall } from "./evaluate-cloud-listing-api.mjs";
import {
  assertEvaluationSampleProvenance,
  evaluationItemSetSha256,
  normalizeEvaluationSampleMode
} from "../lib/listing/evaluation/sample-policy.mjs";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export const durableUploadResilienceContract = Object.freeze({
  verification_timeout_ms: 20_000,
  verification_max_attempts: 3,
  preparation_recovery_rounds: 1,
  preparation_recovery_concurrency: 1
});

export const verifiedAssetCacheContract = Object.freeze({
  schema_version: "listing-verified-asset-cache-v1",
  modes: ["disabled", "reuse", "refresh"]
});

function deploymentProtectionHeaders(env = process.env) {
  const bypassSecret = cleanText(env.VERCEL_AUTOMATION_BYPASS_SECRET);
  return bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : {};
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] || fallback;
}

export function numberArg(argv, name, fallback) {
  const rawValue = argValue(argv, name, null);
  if (rawValue === null || String(rawValue).trim() === "") return fallback;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

export function providerDoneHandoffOverride(argv = []) {
  const enabled = hasFlag(argv, "--provider-done-handoff");
  const disabled = hasFlag(argv, "--no-provider-done-handoff");
  if (enabled && disabled) {
    throw new Error("provider handoff flags are mutually exclusive");
  }
  if (enabled) return true;
  if (disabled) return false;
  return null;
}

export function ultraFastL2Override(argv = []) {
  const enabled = hasFlag(argv, "--ultra-fast-l2");
  const disabled = hasFlag(argv, "--no-ultra-fast-l2");
  if (enabled && disabled) {
    throw new Error("ultra-fast L2 flags are mutually exclusive");
  }
  if (enabled) return true;
  if (disabled) return false;
  return null;
}

export function fastInitialPromptOverride(argv = []) {
  const enabled = hasFlag(argv, "--fast-initial-prompt");
  const disabled = hasFlag(argv, "--full-listing-prompt");
  if (enabled && disabled) {
    throw new Error("provider prompt mode flags are mutually exclusive");
  }
  if (enabled) return true;
  if (disabled) return false;
  return null;
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function writeJson(path, value) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

function normalizeVerifiedAssetCacheMode(value = "disabled") {
  const mode = cleanText(value).toLowerCase() || "disabled";
  if (!verifiedAssetCacheContract.modes.includes(mode)) {
    throw new Error(`unsupported verified asset cache mode: ${mode}`);
  }
  return mode;
}

export async function readVerifiedAssetCache(path = "") {
  if (!cleanText(path)) return new Map();
  try {
    const payload = JSON.parse(await readFile(resolve(path), "utf8"));
    if (payload.schema_version !== verifiedAssetCacheContract.schema_version) {
      throw new Error("unsupported verified asset cache schema");
    }
    return new Map(Object.entries(payload.entries || {}));
  } catch (error) {
    if (error?.code === "ENOENT") return new Map();
    throw error;
  }
}

export async function writeVerifiedAssetCache(path = "", entries = new Map()) {
  if (!cleanText(path)) return;
  const output = resolve(path);
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify({
    schema_version: verifiedAssetCacheContract.schema_version,
    updated_at: new Date().toISOString(),
    entries: Object.fromEntries([...entries.entries()].sort(([left], [right]) => left.localeCompare(right)))
  }, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, output);
}

async function writeText(path, value) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, String(value || ""));
}

function loadDatasetItems(dataset) {
  if (Array.isArray(dataset)) return dataset;
  return dataset.items || dataset.records || dataset.results || dataset.cards || [];
}

async function readDataset(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function readSealedLabels(path) {
  const byCaseId = new Map();
  if (!path) return byCaseId;
  const text = await readFile(resolve(path), "utf8").catch(() => "");
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.case_id) byCaseId.set(row.case_id, row);
      if (row.key) byCaseId.set(row.key, row);
    } catch {
      // Ignore bad sealed-label rows; smoke should still run.
    }
  }
  return byCaseId;
}

function candidateId(item = {}, index = 0) {
  return cleanText(item.asset_id || item.candidate_id || item.id || item.physical_card_id || `v4-ebay-smoke-${index + 1}`);
}

export function smokeTenantId({ batchId = "", tenantPrefix = "", tenantCount = 1, index = 0 } = {}) {
  const count = Math.max(1, Math.trunc(Number(tenantCount) || 1));
  const slot = (Math.max(0, Math.trunc(Number(index) || 0)) % count) + 1;
  const prefix = cleanText(tenantPrefix) || cleanText(batchId) || "v4-smoke";
  return count === 1 ? prefix : `${prefix}-tenant-${slot}`;
}

function itemImages(item = {}) {
  return (Array.isArray(item.images) ? item.images : [])
    .filter((image) => image?.bucket && image?.object_path)
    .slice(0, 2)
    .map((image, index) => ({
      id: image.image_id || `${candidateId(item)}_${index + 1}`,
      image_id: image.image_id || `${candidateId(item)}_${index + 1}`,
      name: `${image.role || `image_${index + 1}`}:${candidateId(item)}`,
      bucket: image.bucket,
      object_path: image.object_path,
      role: image.role || `image_${index + 1}_original`,
      capture_angle: image.capture_angle || `image_${index + 1}`,
      width: image.width || null,
      height: image.height || null
    }));
}

function smokeUploadSources(item = {}, index = 0) {
  return (Array.isArray(item.images) ? item.images : [])
    .filter((image) => cleanText(image?.local_path || image?.localPath))
    .slice(0, 2)
    .map((image, imageIndex) => ({
      ...image,
      id: image.image_id || `${candidateId(item, index)}_${imageIndex + 1}`,
      image_id: image.image_id || `${candidateId(item, index)}_${imageIndex + 1}`,
      local_path: cleanText(image.local_path || image.localPath),
      storage_role: `image_${imageIndex + 1}_original`,
      capture_angle: `image_${imageIndex + 1}`
    }));
}

export async function durableSourceFingerprint(item = {}, index = 0) {
  const sources = (Array.isArray(item.images) ? item.images : []).slice(0, 2);
  if (!sources.length) {
    throw new Error(`smoke_images_missing:${candidateId(item, index)}`);
  }
  const images = [];
  for (const image of sources) {
    const immutableSourceLocator = `${cleanText(image.bucket)}:${cleanText(image.object_path || image.objectPath)}`;
    const hasImmutableSourceLocator = immutableSourceLocator !== ":";
    const declaredSha256 = cleanText(image.content_sha256 || image.contentSha256).toLowerCase();
    const contentSha256 = hasImmutableSourceLocator
      ? null
      : /^[a-f0-9]{64}$/.test(declaredSha256)
        ? declaredSha256
        : cleanText(image.local_path || image.localPath)
          ? crypto.createHash("sha256").update(await readFile(resolve(image.local_path || image.localPath))).digest("hex")
          : null;
    if (!contentSha256 && !hasImmutableSourceLocator) {
      throw new Error(`smoke_image_fingerprint_missing:${cleanText(image.image_id) || candidateId(item, index)}`);
    }
    images.push({
      image_id: cleanText(image.image_id),
      role: cleanText(image.storage_role || image.role),
      content_sha256: contentSha256,
      immutable_source_locator: hasImmutableSourceLocator ? immutableSourceLocator : null,
      width: Number(image.width) || null,
      height: Number(image.height) || null
    });
  }
  const stableSourceId = cleanText(
    item.source_feedback_id
    || item.source_record_id
    || item.physical_card_id
    || item.source_asset_id
    || candidateId(item, index)
  );
  return crypto.createHash("sha256").update(JSON.stringify({
    stable_source_id: stableSourceId,
    images
  })).digest("hex");
}

function reusableAssetEntry(entry = {}, { fingerprint = "", sourceAssetId = "" } = {}) {
  if (!entry || typeof entry !== "object") return null;
  if (
    cleanText(entry.fingerprint) !== cleanText(fingerprint)
    || !cleanText(entry.asset_id)
    || !cleanText(entry.tenant_id)
    || !cleanText(entry.image_generation_id)
  ) return null;
  // A manifest-local asset id is allowed to change between random draws. The
  // fingerprint already binds the stable source identity and immutable image
  // locators/content, so source_asset_id is diagnostic rather than identity.
  if (!cleanText(sourceAssetId)) return null;
  return entry;
}

function smokeClientAssetRef(item = {}, index = 0) {
  const sourceHash = crypto.createHash("sha256")
    .update(candidateId(item, index))
    .digest("hex")
    .slice(0, 16);
  return `v4-smoke:${sourceHash}:${crypto.randomUUID()}`;
}

function inferredImageContentType(image = {}, bytes = Buffer.alloc(0)) {
  const explicit = cleanText(image.content_type || image.contentType).toLowerCase();
  if (explicit) return explicit;
  if (bytes.subarray(0, 3).toString("hex") === "ffd8ff") return "image/jpeg";
  if (bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "image/png";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  throw new Error(`smoke_image_content_type_unknown:${cleanText(image.local_path)}`);
}

async function createDurableSmokeAsset({
  baseUrl,
  cookie,
  item,
  index,
  requestTimeoutMs,
  fetchImpl = globalThis.fetch
}) {
  const sources = smokeUploadSources(item, index);
  if (!sources.length) {
    throw new Error(`smoke_local_images_missing:${candidateId(item, index)}`);
  }
  const clientAssetRef = smokeClientAssetRef(item, index);
  const response = await postJson({
    baseUrl,
    path: "/api/listing-asset-create",
    cookie,
    payload: {
      client_asset_ref: clientAssetRef,
      capture_profile_id: "v4_ebay_blind_smoke",
      category: item.category || "collectible_card",
      expected_original_count: sources.length
    },
    requestTimeoutMs,
    fetchImpl,
    maxAttempts: 5
  });
  if (!response.ok || response.data?.ok !== true || !cleanText(response.data?.asset_id)) {
    throw new Error(`smoke_asset_create_failed:${response.http_status}:${cleanText(response.data?.message).slice(0, 180)}`);
  }
  if (cleanText(response.data?.client_asset_ref) !== clientAssetRef) {
    throw new Error("smoke_asset_client_ref_mismatch");
  }
  return {
    asset_id: response.data.asset_id,
    tenant_id: response.data.tenant_id,
    image_generation_id: response.data.image_generation_id || response.data.asset_id,
    client_asset_ref: clientAssetRef,
    sources,
    smoke_asset_create_attempts: response.attempts,
    smoke_asset_create_recovered_by_retry: response.retried === true
  };
}

async function uploadDurableSmokeImage({
  baseUrl,
  cookie,
  asset,
  image,
  requestTimeoutMs,
  fetchImpl = globalThis.fetch
}) {
  const bytes = await readFile(resolve(image.local_path));
  const contentType = inferredImageContentType(image, bytes);
  const contentSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const signatureHex = bytes.subarray(0, 32).toString("hex");
  const width = Number(image.width);
  const height = Number(image.height);
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error(`smoke_image_dimensions_missing:${image.image_id}`);
  }
  const fileName = basename(image.local_path) || `${image.image_id}.jpg`;
  const signed = await postJson({
    baseUrl,
    path: "/api/listing-image-upload-url",
    cookie,
    payload: {
      assetId: asset.asset_id,
      clientAssetRef: asset.client_asset_ref,
      imageId: image.image_id,
      role: image.storage_role,
      fileName,
      contentType,
      size: bytes.byteLength,
      width,
      height,
      signatureHex,
      contentSha256
    },
    requestTimeoutMs,
    fetchImpl,
    maxAttempts: 5
  });
  const upload = signed.data?.upload || {};
  if (!signed.ok || signed.data?.ok !== true || !cleanText(upload.signed_upload_url)) {
    throw new Error(`smoke_upload_sign_failed:${signed.http_status}:${cleanText(signed.data?.message).slice(0, 180)}`);
  }
  if (
    cleanText(signed.data?.asset_id) !== asset.asset_id
    || cleanText(signed.data?.client_asset_ref) !== asset.client_asset_ref
    || cleanText(upload.tenant_id) !== asset.tenant_id
    || cleanText(upload.image_id) !== image.image_id
    || cleanText(upload.storage_role) !== image.storage_role
  ) {
    throw new Error("smoke_upload_identity_mismatch");
  }

  const put = await fetchWithBoundedRetry(upload.signed_upload_url, {
    method: "PUT",
    headers: { "content-type": upload.content_type || contentType },
    body: bytes
  }, {
    fetchImpl,
    timeoutMs: Math.min(30_000, requestTimeoutMs),
    maxAttempts: 5,
    retryNetworkErrors: true,
    maxDelayMs: 1500
  });

  const verification = await postJson({
    baseUrl,
    path: "/api/listing-image-verify-upload",
    cookie,
    payload: {
      assetId: asset.asset_id,
      imageId: image.image_id,
      role: image.storage_role,
      fileName,
      objectPath: upload.object_path,
      contentType: upload.content_type || contentType,
      size: bytes.byteLength,
      width,
      height,
      signatureHex,
      contentSha256
    },
    requestTimeoutMs: Math.min(
      requestTimeoutMs,
      durableUploadResilienceContract.verification_timeout_ms
    ),
    fetchImpl,
    maxAttempts: durableUploadResilienceContract.verification_max_attempts
  });
  const verified = verification.data?.verification || {};
  if (!verification.ok || verification.data?.ok !== true || !cleanText(verified.verification_token)) {
    const putStatus = put.response?.status ?? "unknown";
    throw new Error(`smoke_upload_verify_failed:put_${putStatus}:verify_${verification.http_status}:${cleanText(verification.data?.message).slice(0, 180)}`);
  }
  if (!put.response?.ok && verified.object_verified !== true) {
    throw new Error(`smoke_storage_put_failed:${put.response?.status || "unknown"}`);
  }

  return {
    id: image.image_id,
    image_id: image.image_id,
    name: fileName,
    role: image.storage_role,
    storageRole: image.storage_role,
    storage_role: image.storage_role,
    capture_angle: image.capture_angle,
    objectPath: verified.object_path,
    object_path: verified.object_path,
    bucket: verified.bucket,
    storageVerified: true,
    storage_verified: true,
    storageVerificationToken: verified.verification_token,
    storage_verification_token: verified.verification_token,
    contentType: verified.content_type,
    content_type: verified.content_type,
    originalType: verified.content_type,
    original_type: verified.content_type,
    size: verified.size,
    originalSize: verified.size,
    original_size: verified.size,
    width: verified.width,
    originalWidth: verified.width,
    original_width: verified.width,
    height: verified.height,
    originalHeight: verified.height,
    original_height: verified.height,
    contentSha256: verified.content_sha256 || contentSha256,
    content_sha256: verified.content_sha256 || contentSha256,
    storageAssetId: asset.asset_id,
    storage_asset_id: asset.asset_id,
    storageTenantId: asset.tenant_id,
    storage_tenant_id: asset.tenant_id,
    smoke_upload_sign_attempts: signed.attempts,
    smoke_upload_sign_latency_ms: signed.latency_ms,
    smoke_storage_put_attempts: put.attempts,
    smoke_storage_put_latency_ms: put.elapsed_ms,
    smoke_upload_verify_attempts: verification.attempts,
    smoke_upload_verify_latency_ms: verification.latency_ms,
    smoke_upload_verify_server_timing: verification.data?.verification_timing || null,
    smoke_upload_recovered_by_retry: signed.retried === true || verification.retried === true
  };
}

export async function prepareDurableSmokeItem({
  item = {},
  index = 0,
  baseUrl,
  cookie,
  requestTimeoutMs,
  sourceFingerprint = "",
  cachedAssetEntry = null,
  fetchImpl = globalThis.fetch
}) {
  const sourceAssetId = candidateId(item, index);
  const fingerprint = cleanText(sourceFingerprint) || await durableSourceFingerprint(item, index);
  const cached = reusableAssetEntry(cachedAssetEntry, { fingerprint, sourceAssetId });
  if (cached) {
    return {
      source_asset_id: sourceAssetId,
      asset: {
        asset_id: cached.asset_id,
        tenant_id: cached.tenant_id,
        image_generation_id: cached.image_generation_id,
        client_asset_ref: null,
        sources: []
      },
      item: {
        ...item,
        asset_id: cached.asset_id,
        image_generation_id: cached.image_generation_id,
        source_feedback_id: item.source_feedback_id || sourceAssetId
      },
      // Pre-ingest and enqueue reconstruct canonical references server-side
      // from this already verified asset generation.
      images: [],
      asset_cache_entry: cached,
      preparation_diagnostics: {
        asset_cache_hit: true,
        upload_skipped_due_to_verified_asset_cache: true,
        source_fingerprint: fingerprint,
        asset_create_attempts: 0,
        upload_sign_attempts: 0,
        upload_sign_max_latency_ms: 0,
        storage_put_attempts: 0,
        storage_put_max_latency_ms: 0,
        upload_verify_attempts: 0,
        upload_verify_max_latency_ms: 0,
        upload_verify_server_timings: [],
        recovered_by_retry: false
      }
    };
  }
  const asset = await createDurableSmokeAsset({
    baseUrl,
    cookie,
    item,
    index,
    requestTimeoutMs,
    fetchImpl
  });
  const verified = await mapWithConcurrency(asset.sources, Math.min(2, asset.sources.length), (image) => (
    uploadDurableSmokeImage({
      baseUrl,
      cookie,
      image,
      asset,
      requestTimeoutMs,
      fetchImpl
    })
  ));
  return {
    source_asset_id: sourceAssetId,
    asset,
    item: {
      ...item,
      asset_id: asset.asset_id,
      image_generation_id: asset.image_generation_id,
      source_feedback_id: item.source_feedback_id || sourceAssetId
    },
    images: verified,
    asset_cache_entry: {
      fingerprint,
      source_asset_id: sourceAssetId,
      source_feedback_id: cleanText(item.source_feedback_id || item.source_record_id) || null,
      asset_id: asset.asset_id,
      tenant_id: asset.tenant_id,
      image_generation_id: asset.image_generation_id,
      image_count: verified.length,
      verified_at: new Date().toISOString()
    },
    preparation_diagnostics: {
      asset_cache_hit: false,
      upload_skipped_due_to_verified_asset_cache: false,
      source_fingerprint: fingerprint,
      asset_create_attempts: Number(asset.smoke_asset_create_attempts || 1),
      upload_sign_attempts: verified.reduce((sum, image) => sum + Number(image.smoke_upload_sign_attempts || 1), 0),
      upload_sign_max_latency_ms: Math.max(...verified.map((image) => Number(image.smoke_upload_sign_latency_ms || 0))),
      storage_put_attempts: verified.reduce((sum, image) => sum + Number(image.smoke_storage_put_attempts || 1), 0),
      storage_put_max_latency_ms: Math.max(...verified.map((image) => Number(image.smoke_storage_put_latency_ms || 0))),
      upload_verify_attempts: verified.reduce((sum, image) => sum + Number(image.smoke_upload_verify_attempts || 1), 0),
      upload_verify_max_latency_ms: Math.max(...verified.map((image) => Number(image.smoke_upload_verify_latency_ms || 0))),
      upload_verify_server_timings: verified.map((image) => image.smoke_upload_verify_server_timing).filter(Boolean),
      recovered_by_retry: asset.smoke_asset_create_recovered_by_retry === true
        || verified.some((image) => image.smoke_upload_recovered_by_retry === true)
    }
  };
}

export function payloadForItem(item = {}, index = 0, images = itemImages(item), {
  forceL2Direct = false,
  modelOverride = "",
  enableL1 = false,
  compactL2 = false,
  ultraFastL2 = null,
  fastInitialPrompt = null,
  ultraSparseTransport = false,
  providerDoneHandoff = null,
  ultraFastImageDetail = "auto",
  ultraFastServiceTier = "",
  disableIdentityCache = false,
  coldStartBlind = false
} = {}) {
  const providerOptions = {
    enable_catalog_assist: true,
    enable_vector_retrieval: true,
    vector_retrieval_mode: "assist",
    vector_query_timeout_ms: 20000,
    enable_v4_progressive_l1: true,
    cloud_eval_blind_to_corrected_title_hint: true,
    corrected_title_as_temporary_gt: false,
    send_corrected_title_hint_to_cloud: false
  };
  if (modelOverride) providerOptions.openai_listing_model_override = modelOverride;
  if (compactL2) providerOptions.v4_compact_l2_prompt = true;
  if (typeof ultraFastL2 === "boolean") {
    providerOptions.v4_ultra_fast_l2 = ultraFastL2;
  }
  if (typeof fastInitialPrompt === "boolean") {
    providerOptions.enable_fast_initial_provider_prompt = fastInitialPrompt;
  }
  if (ultraFastL2 === true) {
    if (ultraSparseTransport) providerOptions.v4_ultra_sparse_transport = true;
    providerOptions.v4_ultra_fast_image_detail = ["low", "auto", "high"].includes(cleanText(ultraFastImageDetail).toLowerCase())
      ? cleanText(ultraFastImageDetail).toLowerCase()
      : "auto";
    if (["auto", "default", "flex", "priority"].includes(cleanText(ultraFastServiceTier).toLowerCase())) {
      providerOptions.v4_ultra_fast_service_tier = cleanText(ultraFastServiceTier).toLowerCase();
    }
  }
  if (typeof providerDoneHandoff === "boolean") {
    providerOptions.v4_provider_done_capacity_handoff = providerDoneHandoff;
  }
  if (disableIdentityCache) providerOptions.disable_identity_result_cache = true;
  if (coldStartBlind) {
    providerOptions.cold_start_blind = true;
    providerOptions.enable_cold_start_blind = true;
  }
  return {
    asset_id: candidateId(item, index),
    image_generation_id: cleanText(item.image_generation_id) || candidateId(item, index),
    source_feedback_id: item.source_feedback_id || item.source_record_id || null,
    physical_card_id: item.physical_card_id || candidateId(item, index),
    category: item.category || "collectible_card",
    maxTitleLength: 80,
    captureProfileId: "v4_ebay_blind_smoke",
    provider: "openai_legacy",
    provider_id: "openai_legacy",
    vision_provider: "openai_legacy",
    provider_options: providerOptions,
    ...(enableL1 ? { v4_force_fast_scout_l1: true } : {}),
    ...(forceL2Direct
      ? {
        force_l2_only: true,
        v4_worker_synchronous: true,
        v4_force_l2_direct: true,
        disable_fast_scout_l1: true
      }
      : {}),
    images
  };
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

export async function login({ baseUrl, username, password, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(`${baseUrl}/api/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...deploymentProtectionHeaders()
    },
    body: JSON.stringify({ username, password })
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`login failed HTTP ${response.status}: ${JSON.stringify(payload || {}).slice(0, 200)}`);
  }
  const cookie = cleanText(response.headers.get("set-cookie")).split(";")[0];
  if (!cookie) throw new Error("login did not return a session cookie");
  return cookie;
}

async function postJson({
  baseUrl,
  path,
  cookie,
  payload,
  requestTimeoutMs,
  fetchImpl = globalThis.fetch,
  maxAttempts = 1
}) {
  const started = Date.now();
  try {
    const request = await fetchWithBoundedRetry(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...deploymentProtectionHeaders(),
        // undici 的 keep-alive 套接字一旦僵死会级联拖垮后续同源请求
        //（表现为成串的 45s request_timeout）；烟测逐请求关闭连接复用。
        connection: "close",
        cookie
      },
      body: JSON.stringify(payload)
    }, {
      fetchImpl,
      timeoutMs: requestTimeoutMs,
      maxAttempts,
      retryNetworkErrors: true,
      maxDelayMs: 2000
    });
    const response = request.response;
    const data = await readJsonResponse(response);
    return {
      ok: response.ok,
      http_status: response.status,
      latency_ms: Date.now() - started,
      attempts: request.attempts,
      retried: request.retried === true,
      data
    };
  } catch (error) {
    if (error?.code === "CLIENT_FETCH_TIMEOUT") {
      error.message = `request_timeout:${path}`;
    }
    throw error;
  }
}

async function getJson({ baseUrl, path, cookie, requestTimeoutMs, fetchImpl = globalThis.fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`request_timeout:${path.split("?")[0]}`)), requestTimeoutMs);
  const started = Date.now();
  try {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: "GET",
      headers: {
        connection: "close",
        cookie,
        ...deploymentProtectionHeaders()
      },
      signal: controller.signal
    });
    const data = await readJsonResponse(response);
    return {
      ok: response.ok,
      http_status: response.status,
      latency_ms: Date.now() - started,
      data
    };
  } finally {
    clearTimeout(timer);
  }
}

async function preingestItem({
  baseUrl,
  cookie,
  assetId,
  images,
  source = "v4_ebay_smoke_preingestion",
  requestTimeoutMs,
  fetchImpl = globalThis.fetch
}) {
  const payload = {
    asset_id: assetId,
    assetId,
    images,
    source: cleanText(source) || "v4_ebay_smoke_preingestion",
    requested_fields: [
      "serial_number",
      "collector_number",
      "checklist_code",
      "grade_label",
      "year_product",
      "subject",
      "surface"
    ],
    enqueue_workers: true,
    enqueue_ocr: true,
    enqueue_embeddings: false,
    enqueue_surface: false,
    enqueue_quality: false,
    verify_signed_read_urls: false
  };
  const response = await postJson({
    baseUrl,
    path: "/api/v4/listing-preingest",
    cookie,
    payload,
    requestTimeoutMs,
    fetchImpl,
    maxAttempts: 5
  });
  const bundleId = response.data?.bundle_id || response.data?.v4_preingestion_bundle_id || null;
  return {
    ok: response.ok && response.data?.ok !== false && Boolean(bundleId),
    http_status: response.http_status,
    latency_ms: response.latency_ms,
    bundle_id: bundleId,
    bundle_status: response.data?.bundle_status || null,
    worker_jobs_enqueued: response.data?.worker_jobs_enqueued ?? null,
    signed_read_url_count: response.data?.signed_read_url_count ?? null,
    signed_read_url_error_count: response.data?.signed_read_url_error_count ?? null,
    preprocessing_summary: response.data?.preprocessing_summary || null,
    error: response.ok && response.data?.ok !== false ? null : response.data
  };
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, Math.max(0, Number(ms) || 0)));
}

export async function mapWithConcurrency(items = [], concurrency = 1, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(items.length, Math.max(1, concurrency)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export function createConcurrencyGate(limit = 1) {
  const capacity = Math.max(1, Math.trunc(Number(limit) || 1));
  let active = 0;
  const waiters = [];
  const release = () => {
    active = Math.max(0, active - 1);
    const next = waiters.shift();
    if (next) next();
  };
  return async (task) => {
    if (active >= capacity) await new Promise((resolveWaiter) => waiters.push(resolveWaiter));
    active += 1;
    try {
      return await task();
    } finally {
      release();
    }
  };
}

const openAiRateLimitHeaderNames = Object.freeze([
  "x-ratelimit-limit-requests",
  "x-ratelimit-remaining-requests",
  "x-ratelimit-limit-tokens",
  "x-ratelimit-remaining-tokens",
  "x-ratelimit-reset-requests",
  "x-ratelimit-reset-tokens"
]);
const openAiProviderPoolDiagnosticNames = Object.freeze([
  "provider_key_pool_size",
  "provider_key_slot",
  "provider_key_source",
  "provider_key_rotation_attempted",
  "provider_key_rotation_attempts"
]);

export function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function batchStatusResponseDisposition(response = {}) {
  if (response.ok === true) return "ok";
  const status = Number(response.http_status || 0);
  const message = cleanText(response.data?.message || response.data?.error || response.data?.error_code).toLowerCase();
  if (response.data?.retryable === true || status === 408 || status === 429 || status >= 500 || status === 0) {
    return "retry";
  }
  // Compatibility with the previous deployment, which exposed transient
  // PostgREST read failures as HTTP 400 before the API contract was corrected.
  if (status === 400 && (message.includes("unable to read v4 jobs") || message.includes("postgrest"))) {
    return "retry";
  }
  return "fatal";
}

function serializableError(value, fallback = "unknown_error") {
  if (typeof value === "string") return cleanText(value) || fallback;
  if (value instanceof Error) return cleanText(value.message || value.name) || fallback;
  if (value && typeof value === "object") {
    const direct = cleanText(value.message || value.error || value.error_code || value.code);
    if (direct) return direct;
    try {
      const encoded = JSON.stringify(value);
      if (encoded && encoded !== "{}") return encoded.slice(0, 500);
    } catch {
      // Fall through to the stable fallback.
    }
  }
  return fallback;
}

function objectOrNull(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function providerDiagnosticsFromSummary(summary = {}) {
  const source = objectOrNull(summary) || {};
  const request = objectOrNull(source.provider_request_diagnostics)
    || objectOrNull(source.request_diagnostics)
    || {};
  const token = objectOrNull(source.provider_token_diagnostics)
    || objectOrNull(source.token_diagnostics)
    || objectOrNull(source.usage)
    || {};
  const rateLimit = objectOrNull(source.provider_rate_limit_diagnostics)
    || objectOrNull(source.rate_limit_diagnostics)
    || request;
  const output = {
    provider_response_profile: source.provider_response_profile || request.provider_response_profile || null,
    provider_prompt_mode: source.provider_prompt_mode || request.provider_prompt_mode || null,
    provider_prompt_chars: numberOrNull(source.provider_prompt_chars ?? request.provider_prompt_chars),
    input_tokens: numberOrNull(token.input_tokens ?? request.input_tokens),
    output_tokens: numberOrNull(token.output_tokens ?? request.output_tokens),
    total_tokens: numberOrNull(token.total_tokens),
    provider_latency_ms: numberOrNull(source.provider_latency_ms ?? request.provider_latency_ms ?? source.usage?.latency_ms),
    response_status: source.provider_finish_reason || token.response_status || request.response_status || null,
    incomplete_reason: token.incomplete_reason || null,
    output_cap: numberOrNull(token.output_cap),
    output_utilization: numberOrNull(token.output_utilization)
  };
  for (const field of openAiProviderPoolDiagnosticNames) {
    output[field] = source[field] ?? request[field] ?? null;
  }
  for (const header of openAiRateLimitHeaderNames) {
    output[header] = rateLimit?.[header] ?? request?.[header] ?? null;
  }
  return output;
}

function providerDiagnosticsFromApiData(data = {}) {
  const providerResult = objectOrNull(data.provider_result) || {};
  return providerDiagnosticsFromSummary({
    provider_latency_ms: data.provider_latency_ms ?? providerResult.provider_latency_ms ?? providerResult.fast_scout?.latency_ms,
    provider_response_profile: data.provider_response_profile || providerResult.provider_response_profile || null,
    provider_prompt_mode: data.provider_prompt_mode || providerResult.provider_prompt_mode || null,
    provider_prompt_chars: data.provider_prompt_chars ?? providerResult.provider_prompt_chars ?? null,
    provider_finish_reason: data.provider_finish_reason || providerResult.provider_finish_reason || null,
    provider_token_diagnostics: data.provider_token_diagnostics || providerResult.token_diagnostics || null,
    provider_rate_limit_diagnostics: data.provider_rate_limit_diagnostics || providerResult.rate_limit_diagnostics || null,
    provider_request_diagnostics: data.provider_request_diagnostics || providerResult.request_diagnostics || null,
    usage: data.usage || providerResult.usage || null
  });
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return "";
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function firstArray(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return value;
  }
  return [];
}

function vectorRuntimeFromSummary(...sources) {
  const flattened = Object.assign({}, ...sources.filter((source) => source && typeof source === "object"));
  const vectorContext = sources
    .map((source) => source?.candidate_context?.vector)
    .find((value) => value && typeof value === "object") || {};
  const vectorSignal = vectorContext.signal || {};
  const providerMetadata = vectorContext.provider_metadata || {};
  const unavailableReasons = firstArray(
    flattened.vector_runtime_unavailable_reasons,
    vectorSignal.unavailable_reasons,
    flattened.runtime_unavailable_reasons,
    vectorContext.runtime_unavailable_reasons
  );
  return {
    vector_runtime_status: firstNonEmptyString(flattened.vector_runtime_status, flattened.runtime_status, vectorSignal.status, vectorContext.runtime_status) || null,
    vector_runtime_status_code: firstPresent(flattened.vector_runtime_status_code, flattened.runtime_status_code, vectorSignal.status_code, vectorContext.runtime_status_code),
    vector_runtime_unavailable_reasons: unavailableReasons.length
      ? unavailableReasons.join("; ")
      : firstNonEmptyString(flattened.vector_runtime_unavailable_reasons, flattened.runtime_unavailable_reasons),
    vector_worker_status: firstNonEmptyString(flattened.vector_worker_status, flattened.worker_status, vectorContext.worker_status) || null,
    vector_worker_reason: firstNonEmptyString(flattened.vector_worker_reason, flattened.worker_reason, vectorContext.worker_reason),
    vector_worker_feature_count: firstPresent(flattened.vector_worker_feature_count, flattened.worker_feature_count, vectorContext.worker_feature_count),
    vector_worker_latency_ms: firstPresent(flattened.vector_worker_latency_ms, flattened.worker_latency_ms, vectorContext.worker_latency_ms),
    vector_worker_attempt_count: firstPresent(flattened.vector_worker_attempt_count, flattened.worker_attempt_count, vectorContext.worker_attempt_count),
    vector_query_embedding_role: firstNonEmptyString(flattened.vector_query_embedding_role, flattened.query_embedding_role, vectorContext.query_embedding_role, providerMetadata.query_embedding_role),
    vector_role_agnostic_fallback_used: flattened.vector_role_agnostic_fallback_used === true
      || flattened.role_agnostic_fallback_used === true
      || vectorContext.role_agnostic_fallback_used === true
      || providerMetadata.role_agnostic_fallback_used === true,
    vector_role_agnostic_fallback_reason: firstNonEmptyString(
      flattened.vector_role_agnostic_fallback_reason,
      flattened.role_agnostic_fallback_reason,
      vectorContext.role_agnostic_fallback_reason,
      providerMetadata.role_agnostic_fallback_reason
    ),
    vector_returned_row_count: firstPresent(flattened.vector_returned_row_count, flattened.returned_row_count, vectorContext.returned_row_count, providerMetadata.returned_row_count),
    vector_self_excluded_count: firstPresent(flattened.vector_self_excluded_count, flattened.self_excluded_count, vectorContext.self_excluded_count, providerMetadata.self_excluded_count),
    vector_self_exclusion_query_attempted: flattened.vector_self_exclusion_query_attempted === true
      || flattened.self_exclusion_query_attempted === true
      || vectorContext.self_exclusion_query_attempted === true,
    vector_self_exclusion_filter_active: flattened.vector_self_exclusion_filter_active === true
      || flattened.self_exclusion_filter_active === true
      || vectorContext.self_exclusion_filter_active === true,
    vector_self_exclusion_requested_source_count: firstPresent(
      flattened.vector_self_exclusion_requested_source_count,
      flattened.self_exclusion_requested_source_count,
      vectorContext.self_exclusion_requested_source_count,
      providerMetadata.source_feedback_exclusion_count
    ),
    vector_self_exclusion_source_ids_sha256: firstNonEmptyString(
      flattened.vector_self_exclusion_source_ids_sha256,
      flattened.self_exclusion_source_ids_sha256,
      vectorContext.self_exclusion_source_ids_sha256
    ) || null
  };
}

function sessionL2Summary(statusPayload = {}) {
  const session = statusPayload.session || {};
  const summary = session.provider_result_summary || {};
  const trace = session.candidate_control_plane_trace || {};
  const catalogFunnel = trace.catalog_activation_funnel || {};
  const vectorFunnel = trace.vector_activation_funnel || {};
  const providerDiagnostics = providerDiagnosticsFromSummary(summary);
  const vectorRuntime = vectorRuntimeFromSummary(summary, vectorFunnel);
  return {
    session_status: session.status || null,
    l2_status: session.l2_status || null,
    assisted_draft_status: summary.assisted_draft_status || null,
    writer_review_required: session.writer_review_required === true || summary.writer_review_required === true,
    writer_review_reason: session.writer_review_reason || summary.writer_review_reason || null,
    title: session.final_title || summary.final_title || null,
    resolved_fields: session.resolved_fields && typeof session.resolved_fields === "object" ? session.resolved_fields : {},
    field_states: session.field_states && typeof session.field_states === "object" ? session.field_states : {},
    title_length_policy: summary.title_length_policy || null,
    title_render_source: summary.title_render_source || null,
    route: session.route || null,
    prompt_candidate_count: Number(catalogFunnel.prompt_candidate_count || 0)
      + Number(vectorFunnel.prompt_candidate_count || 0),
    catalog_raw_candidate_count: Number(catalogFunnel.raw_candidate_count || 0),
    catalog_approved_candidate_count: Number(catalogFunnel.approved_candidate_count || 0),
    catalog_conflict_blocked_count: Number(catalogFunnel.conflict_blocked_count || 0),
    catalog_prompt_candidate_count: Number(catalogFunnel.prompt_candidate_count || 0),
    catalog_provider_prompt_candidate_count: Number(catalogFunnel.provider_prompt_candidate_count || 0),
    catalog_post_observation_blocked_count: Number(catalogFunnel.post_observation_blocked_count || 0),
    catalog_evidence_support_field_count: Number(catalogFunnel.evidence_support_field_count || 0),
    catalog_participation_level: catalogFunnel.participation_level || null,
    catalog_pre_observation_query_attempted: catalogFunnel.pre_observation_query_attempted ?? null,
    catalog_post_observation_query_attempted: catalogFunnel.post_observation_query_attempted ?? null,
    vector_raw_candidate_count: Number(vectorFunnel.raw_candidate_count || 0),
    vector_approved_candidate_count: Number(vectorFunnel.approved_candidate_count || 0),
    vector_conflict_blocked_count: Number(vectorFunnel.conflict_blocked_count || 0),
    vector_prompt_candidate_count: Number(vectorFunnel.prompt_candidate_count || 0),
    vector_provider_prompt_candidate_count: Number(vectorFunnel.provider_prompt_candidate_count || 0),
    vector_post_observation_blocked_count: Number(vectorFunnel.post_observation_blocked_count || 0),
    vector_evidence_support_field_count: Number(vectorFunnel.evidence_support_field_count || 0),
    vector_participation_level: vectorFunnel.participation_level || null,
    vector_pre_observation_query_attempted: vectorFunnel.pre_observation_query_attempted ?? null,
    vector_post_observation_query_attempted: vectorFunnel.post_observation_query_attempted ?? null,
    ...vectorRuntime,
    catalog_stage_capacity: summary.catalog_stage_capacity || null,
    vector_stage_capacity: summary.vector_stage_capacity || null,
    preingestion_ocr_rendezvous: summary.preingestion_ocr_rendezvous || null,
    preingestion_evidence_refresh: summary.preingestion_evidence_refresh || null,
    preingestion_retrieval_refresh: summary.preingestion_retrieval_refresh || null,
    preingestion_retrieval_anchor_fields: Array.isArray(summary.preingestion_retrieval_anchor_fields)
      ? summary.preingestion_retrieval_anchor_fields
      : [],
    serial_numerator_verified: summary.serial_numerator_verified ?? null,
    pipeline_node_ledger: statusPayload.end_to_end_node_ledger || summary.pipeline_node_ledger || null,
    noncritical_persistence_status: summary.noncritical_persistence_status || null,
    noncritical_persistence_summary: summary.noncritical_persistence_summary || null,
    provider_diagnostics: providerDiagnostics,
    provider_response_profile: providerDiagnostics.provider_response_profile || summary.provider_response_profile || null,
    provider_prompt_mode: providerDiagnostics.provider_prompt_mode || summary.provider_prompt_mode || null,
    provider_prompt_chars: providerDiagnostics.provider_prompt_chars ?? summary.provider_prompt_chars ?? null,
    provider_image_detail: summary.provider_image_detail || null,
    provider_text_verbosity: summary.provider_text_verbosity || null,
    provider_requested_service_tier: summary.provider_requested_service_tier || null,
    provider_service_tier: summary.provider_service_tier || null,
    identity_cache_hit: summary.identity_cache_hit === true,
    identity_cache_read_bypassed: summary.identity_cache_read_bypassed === true,
    identity_cache_write_reason: summary.identity_cache_write_reason || null,
    v4_l2_timing: summary.v4_l2_timing || null,
    v4_pipeline_contract: summary.v4_pipeline_contract || null,
    strategy_replay_trace: summary.strategy_replay_trace || null,
    input_tokens: providerDiagnostics.input_tokens,
    output_tokens: providerDiagnostics.output_tokens,
    total_tokens: providerDiagnostics.total_tokens,
    provider_latency_ms: providerDiagnostics.provider_latency_ms,
    "x-ratelimit-limit-requests": providerDiagnostics["x-ratelimit-limit-requests"],
    "x-ratelimit-remaining-requests": providerDiagnostics["x-ratelimit-remaining-requests"],
    "x-ratelimit-limit-tokens": providerDiagnostics["x-ratelimit-limit-tokens"],
    "x-ratelimit-remaining-tokens": providerDiagnostics["x-ratelimit-remaining-tokens"],
    "x-ratelimit-reset-requests": providerDiagnostics["x-ratelimit-reset-requests"],
    "x-ratelimit-reset-tokens": providerDiagnostics["x-ratelimit-reset-tokens"],
    related_counts: statusPayload.related_counts || {}
  };
}

function jobL2Summary(statusPayload = {}) {
  const job = (statusPayload.jobs || [])[0] || {};
  const session = job.session || {};
  const summary = session.provider_result_summary || {};
  const trace = session.candidate_control_plane_trace || {};
  const catalogFunnel = trace.catalog_activation_funnel || {};
  const vectorFunnel = trace.vector_activation_funnel || {};
  const providerDiagnostics = providerDiagnosticsFromSummary(summary);
  const vectorRuntime = vectorRuntimeFromSummary(summary, vectorFunnel);
  return {
    session_status: session.status || job.internal_status || null,
    l2_status: session.l2_status || job.l2_status || null,
    assisted_draft_status: summary.assisted_draft_status || null,
    writer_review_required: session.writer_review_required === true
      || summary.writer_review_required === true
      || job.display_status === "WRITER_REVIEW",
    writer_review_reason: session.writer_review_reason || summary.writer_review_reason || null,
    title: session.final_title
      || session.l2_title
      || summary.final_title
      || summary.writer_safe_draft
      || job.display_title
      || job.writer_display_title
      || null,
    resolved_fields: session.resolved_fields && typeof session.resolved_fields === "object" ? session.resolved_fields : {},
    field_states: session.field_states && typeof session.field_states === "object" ? session.field_states : {},
    title_length_policy: summary.title_length_policy || null,
    title_render_source: summary.title_render_source || null,
    route: session.l2_route || job.l2_route || null,
    job_status: job.status || null,
    attempt_count: job.attempt_count ?? null,
    retry_attempt_history: Array.isArray(job.error?.attempt_history) ? job.error.attempt_history : [],
    retry_error_codes: Array.isArray(job.error?.attempt_history)
      ? job.error.attempt_history.map((entry) => cleanText(entry?.code)).filter(Boolean)
      : [],
    completion_payload_sanitized_nul_count: job.timing?.completion_payload_sanitized_nul_count ?? 0,
    job_id: job.job_id || null,
    recognition_session_id: job.recognition_session_id || null,
    job_created_at: job.created_at || null,
    job_started_at: job.started_at || null,
    job_completed_at: job.completed_at || null,
    paired_l1_wait_ms: job.timing?.paired_l1_wait_ms ?? null,
    scheduler_queue_wait_ms: job.timing?.scheduler_queue_wait_ms ?? job.timing?.worker_queue_wait_ms ?? null,
    worker_queue_wait_ms: job.timing?.worker_queue_wait_ms ?? null,
    worker_processing_ms: job.timing?.worker_processing_ms ?? null,
    time_to_l2_ready_ms: job.timing?.time_to_l2_ready_ms ?? null,
    recognition_started_at: job.recognition_started_at || null,
    recognition_start_source: job.recognition_start_source || null,
    writer_visible_recognition_ms: job.timing?.writer_visible_recognition_ms ?? null,
    writer_ready_capacity_release: job.timing?.writer_ready_capacity_release || null,
    writer_ready_capacity_refill: job.timing?.writer_ready_capacity_refill
      || job.timing?.writer_ready_capacity_release?.refill
      || summary.writer_ready_capacity_refill
      || null,
    writer_ready_capacity_release_mode: job.timing?.writer_ready_capacity_release?.release_boundary
      || summary.writer_ready_capacity_release_mode
      || null,
    provider_capacity_stage_handoff: summary.provider_capacity_stage_handoff || null,
    provider_capacity_slot: job.execution_control?.provider_capacity_slot ?? null,
    provider_key_slot: job.execution_control?.provider_key_slot ?? null,
    provider_capacity: job.execution_control?.provider_capacity ?? null,
    provider_key_count: job.execution_control?.provider_key_count ?? null,
    provider_key_assignment: job.execution_control?.provider_key_assignment || null,
    prompt_candidate_count: Number(catalogFunnel.prompt_candidate_count || 0)
      + Number(vectorFunnel.prompt_candidate_count || 0),
    catalog_raw_candidate_count: Number(catalogFunnel.raw_candidate_count || 0),
    catalog_approved_candidate_count: Number(catalogFunnel.approved_candidate_count || 0),
    catalog_conflict_blocked_count: Number(catalogFunnel.conflict_blocked_count || 0),
    catalog_prompt_candidate_count: Number(catalogFunnel.prompt_candidate_count || 0),
    catalog_evidence_support_field_count: Number(catalogFunnel.evidence_support_field_count || 0),
    catalog_participation_level: catalogFunnel.participation_level || null,
    catalog_pre_observation_query_attempted: catalogFunnel.pre_observation_query_attempted ?? null,
    catalog_post_observation_query_attempted: catalogFunnel.post_observation_query_attempted ?? null,
    vector_raw_candidate_count: Number(vectorFunnel.raw_candidate_count || 0),
    vector_approved_candidate_count: Number(vectorFunnel.approved_candidate_count || 0),
    vector_conflict_blocked_count: Number(vectorFunnel.conflict_blocked_count || 0),
    vector_prompt_candidate_count: Number(vectorFunnel.prompt_candidate_count || 0),
    vector_evidence_support_field_count: Number(vectorFunnel.evidence_support_field_count || 0),
    vector_participation_level: vectorFunnel.participation_level || null,
    vector_pre_observation_query_attempted: vectorFunnel.pre_observation_query_attempted ?? null,
    vector_post_observation_query_attempted: vectorFunnel.post_observation_query_attempted ?? null,
    ...vectorRuntime,
    catalog_stage_capacity: summary.catalog_stage_capacity || null,
    vector_stage_capacity: summary.vector_stage_capacity || null,
    preingestion_ocr_rendezvous: summary.preingestion_ocr_rendezvous || null,
    preingestion_evidence_refresh: summary.preingestion_evidence_refresh || null,
    preingestion_retrieval_refresh: summary.preingestion_retrieval_refresh || null,
    preingestion_retrieval_anchor_fields: Array.isArray(summary.preingestion_retrieval_anchor_fields)
      ? summary.preingestion_retrieval_anchor_fields
      : [],
    serial_numerator_verified: summary.serial_numerator_verified ?? null,
    pipeline_node_ledger: job.end_to_end_node_ledger || summary.pipeline_node_ledger || null,
    noncritical_persistence_status: summary.noncritical_persistence_status || null,
    noncritical_persistence_summary: summary.noncritical_persistence_summary || null,
    provider_diagnostics: providerDiagnostics,
    provider_response_profile: providerDiagnostics.provider_response_profile || summary.provider_response_profile || null,
    provider_prompt_mode: providerDiagnostics.provider_prompt_mode || summary.provider_prompt_mode || null,
    provider_prompt_chars: providerDiagnostics.provider_prompt_chars ?? summary.provider_prompt_chars ?? null,
    provider_image_detail: summary.provider_image_detail || null,
    provider_text_verbosity: summary.provider_text_verbosity || null,
    provider_requested_service_tier: summary.provider_requested_service_tier || null,
    provider_service_tier: summary.provider_service_tier || null,
    identity_cache_hit: summary.identity_cache_hit === true,
    identity_cache_read_bypassed: summary.identity_cache_read_bypassed === true,
    identity_cache_write_reason: summary.identity_cache_write_reason || null,
    v4_l2_timing: summary.v4_l2_timing || null,
    v4_pipeline_contract: summary.v4_pipeline_contract || null,
    strategy_replay_trace: summary.strategy_replay_trace || null,
    input_tokens: providerDiagnostics.input_tokens,
    output_tokens: providerDiagnostics.output_tokens,
    total_tokens: providerDiagnostics.total_tokens,
    provider_latency_ms: providerDiagnostics.provider_latency_ms,
    "x-ratelimit-limit-requests": providerDiagnostics["x-ratelimit-limit-requests"],
    "x-ratelimit-remaining-requests": providerDiagnostics["x-ratelimit-remaining-requests"],
    "x-ratelimit-limit-tokens": providerDiagnostics["x-ratelimit-limit-tokens"],
    "x-ratelimit-remaining-tokens": providerDiagnostics["x-ratelimit-remaining-tokens"],
    "x-ratelimit-reset-requests": providerDiagnostics["x-ratelimit-reset-requests"],
    "x-ratelimit-reset-tokens": providerDiagnostics["x-ratelimit-reset-tokens"]
  };
}

export function summaryHasVisibleL2Title(summary = {}) {
  return Boolean(summary.session_status !== "FAILED"
    && summary.l2_status === "READY"
    && cleanText(summary.title));
}

export function summaryRequiresWriterReview(summary = {}) {
  return Boolean(
    summary.l2_status === "READY"
    && (
      summary.session_status === "WRITER_REVIEW"
      || summary.assisted_draft_status === "REVIEW_REQUIRED"
      || summary.writer_review_required === true
    )
  );
}

function activeJobStatus(status = "") {
  return ["QUEUED", "RUNNING", "RETRYING"].includes(String(status || "").toUpperCase());
}

function terminalJobStatus(status = "") {
  return ["FAILED", "CANCELLED"].includes(String(status || "").toUpperCase());
}

function persistenceTerminalForJob(job = {}) {
  if (terminalJobStatus(job.status)) return true;
  const status = cleanText(job.session?.provider_result_summary?.noncritical_persistence_status).toUpperCase();
  return ["COMPLETED", "PARTIAL", "FAILED"].includes(status);
}

export function compactCandidateTrace(trace = {}) {
  const rows = Array.isArray(trace.candidate_application_trace)
    ? trace.candidate_application_trace
    : Array.isArray(trace.candidate_application_trace_rows)
      ? trace.candidate_application_trace_rows
      : [];
  const retrievalApplication = trace.retrieval_application && typeof trace.retrieval_application === "object"
    ? trace.retrieval_application
    : {};
  const retrievalDecisions = Array.isArray(retrievalApplication.decisions)
    ? retrievalApplication.decisions
    : [];
  return {
    schema_version: trace.schema_version || null,
    candidate_observation_snapshot: trace.candidate_observation_snapshot || {},
    participation_level: trace.participation_level || null,
    decision_eligible_candidate_count: Number(trace.decision_eligible_candidate_count || 0),
    decision_eligible_candidate_ids: Array.isArray(trace.decision_eligible_candidate_ids)
      ? trace.decision_eligible_candidate_ids
      : [],
    shadow_only_candidate_count: Number(trace.shadow_only_candidate_count || 0),
    shadow_only_candidate_ids: Array.isArray(trace.shadow_only_candidate_ids)
      ? trace.shadow_only_candidate_ids
      : [],
    selected_candidate_id: trace.selected_candidate_decision?.selected_candidate_id || trace.selected_candidate_id || "",
    selection_margin: trace.selected_candidate_decision?.selection_margin ?? null,
    selected_reason_codes: trace.selected_candidate_decision?.selected_reason_codes || [],
    rejected_candidate_reasons: trace.selected_candidate_decision?.rejected_candidate_reasons || [],
    selected_candidate_safe_field_application: trace.selected_candidate_safe_field_application || null,
    low_margin_safe_field_application: trace.low_margin_safe_field_application || null,
    applied_field_count: Number(trace.applied_field_count || 0),
    applied_fields: Array.isArray(trace.applied_fields) ? trace.applied_fields : [],
    blocked_field_count: Number(trace.blocked_field_count || 0),
    blocked_fields: Array.isArray(trace.blocked_fields) ? trace.blocked_fields : [],
    catalog_activation_funnel: trace.catalog_activation_funnel || {},
    vector_activation_funnel: trace.vector_activation_funnel || {},
    retrieval_application: {
      schema_version: retrievalApplication.schema_version || null,
      enabled: retrievalApplication.enabled === true,
      owner: retrievalApplication.owner || null,
      selected_candidate_id: retrievalApplication.selected_candidate_id || "",
      low_margin_candidate_id: retrievalApplication.low_margin_candidate_id || "",
      candidate_count: Number(retrievalApplication.candidate_count || 0),
      field_evidence_count: Number(retrievalApplication.field_evidence_count || 0),
      identity_evidence_count: Number(retrievalApplication.identity_evidence_count || 0),
      decision_counts: retrievalApplication.decision_counts || {},
      resolver_consumed: retrievalApplication.resolver_consumed === true,
      resolved_change_count: Number(retrievalApplication.resolved_change_count || 0),
      title_changed: retrievalApplication.title_changed === true,
      decisions: retrievalDecisions.slice(0, 120).map((row) => ({
        candidate_id: row.candidate_id || "",
        candidate_identity_id: row.candidate_identity_id || "",
        candidate_lane: row.candidate_lane || "",
        field: row.field || row.resolver_field || "",
        resolver_field: row.resolver_field || row.field || "",
        old_value: row.old_value ?? null,
        candidate_value: row.candidate_value ?? null,
        resolver_value: row.resolver_value ?? null,
        final_value: row.final_value ?? null,
        confidence: Number(row.confidence || 0),
        source: row.source || row.source_type || "",
        source_type: row.source_type || "",
        source_trust: row.source_trust || "",
        permission: row.permission || null,
        decision: row.decision || "",
        reason: row.reason || "",
        applied_to_final: row.applied_to_final === true,
        supported_final: row.supported_final === true,
        outcome: row.outcome || ""
      }))
    },
    candidate_application_trace: rows.map((row) => ({
      candidate_id: row.candidate_id || "",
      candidate_identity_id: row.candidate_identity_id || "",
      candidate_lane: row.candidate_lane || "",
      provider_id: row.provider_id || "",
      source_type: row.source_type || "",
      source_trust: row.source_trust || "",
      participation_level: row.participation_level || "",
      provider_prompt_eligible: row.provider_prompt_eligible === true,
      live_anchor_eligible: row.live_anchor_eligible === true,
      live_evidence_eligible: row.live_evidence_eligible === true,
      prompt_eligible: row.prompt_eligible === true,
      decision_eligible: row.decision_eligible === true,
      shadow_only_reason: row.shadow_only_reason || "",
      match_level: row.match_level || "",
      blocked_fields: row.blocked_fields || [],
      support_only_fields: row.support_only_fields || [],
      can_apply_fields: row.can_apply_fields || [],
      anchor_agreement: row.anchor_agreement || null
    }))
  };
}

export function batchPollWaitBudgetMs({
  requestedWaitMs = 18_000,
  itemCount = 0,
  providerConcurrency = 1
} = {}) {
  const requested = Math.max(0, Math.trunc(Number(requestedWaitMs) || 0));
  const count = Math.max(0, Math.trunc(Number(itemCount) || 0));
  const capacity = Math.max(1, Math.trunc(Number(providerConcurrency) || 1));
  if (!count) return requested;
  const waves = Math.max(1, Math.ceil(count / capacity));
  const estimated = 30_000 + waves * 45_000;
  return Math.max(requested, Math.min(30 * 60_000, estimated));
}

async function pollSessionStatus({
  baseUrl,
  cookie,
  sessionId,
  waitMs = 18000,
  intervalMs = 1500,
  requestTimeoutMs = 30000
}) {
  if (!sessionId) return { polls: 0, ready: false, summary: null, last: null };
  const started = Date.now();
  let polls = 0;
  let last = null;
  while (Date.now() - started <= waitMs) {
    polls += 1;
    last = await getJson({
      baseUrl,
      path: `/api/v4/listing-session-status?recognition_session_id=${encodeURIComponent(sessionId)}&include_related_counts=true`,
      cookie,
      requestTimeoutMs
    });
    const summary = sessionL2Summary(last.data || {});
    const candidateDebug = compactCandidateTrace(last.data?.session?.candidate_control_plane_trace || {});
    if (summaryHasVisibleL2Title(summary)) {
      return { polls, ready: true, summary, candidateDebug, last, elapsed_ms: Date.now() - started };
    }
    if (summaryRequiresWriterReview(summary)) {
      return { polls, ready: false, review_required: true, terminal: true, summary, candidateDebug, last, elapsed_ms: Date.now() - started };
    }
    if (summary.session_status === "FAILED" || summary.assisted_draft_status === "FAILED" || summary.assisted_draft_status === "TIMEOUT") {
      return { polls, ready: false, summary, candidateDebug, last, elapsed_ms: Date.now() - started };
    }
    if (!summary.assisted_draft_status && summary.session_status === "DRAFT_READY") {
      return { polls, ready: false, summary, candidateDebug, last, elapsed_ms: Date.now() - started };
    }
    await delay(intervalMs);
  }
  return {
    polls,
    ready: false,
    summary: sessionL2Summary(last?.data || {}),
    candidateDebug: compactCandidateTrace(last?.data?.session?.candidate_control_plane_trace || {}),
    last,
    elapsed_ms: Date.now() - started
  };
}

async function pollJobStatus({
  baseUrl,
  cookie,
  jobId,
  waitMs = 18000,
  intervalMs = 1500,
  requestTimeoutMs = 30000
}) {
  if (!jobId) return { polls: 0, ready: false, summary: null, last: null };
  const started = Date.now();
  let polls = 0;
  let last = null;
  while (Date.now() - started <= waitMs) {
    polls += 1;
    last = await getJson({
      baseUrl,
      path: `/api/v4/listing-job-status?job_ids=${encodeURIComponent(jobId)}&limit=1`,
      cookie,
      requestTimeoutMs
    });
    const summary = jobL2Summary(last.data || {});
    const candidateDebug = compactCandidateTrace(last.data?.jobs?.[0]?.session?.candidate_control_plane_trace || {});
    if (summaryHasVisibleL2Title(summary)) {
      return { polls, ready: true, summary, candidateDebug, last, elapsed_ms: Date.now() - started };
    }
    if (summaryRequiresWriterReview(summary)) {
      return { polls, ready: false, review_required: true, terminal: true, summary, candidateDebug, last, elapsed_ms: Date.now() - started };
    }
    if (terminalJobStatus(summary.job_status)
      || (!activeJobStatus(summary.job_status) && (summary.assisted_draft_status === "FAILED" || summary.assisted_draft_status === "TIMEOUT"))) {
      return { polls, ready: false, summary, candidateDebug, last, elapsed_ms: Date.now() - started };
    }
    await delay(intervalMs);
  }
  return {
    polls,
    ready: false,
    summary: jobL2Summary(last?.data || {}),
    candidateDebug: compactCandidateTrace(last?.data?.jobs?.[0]?.session?.candidate_control_plane_trace || {}),
    last,
    elapsed_ms: Date.now() - started
  };
}

function persistenceStatusIsTerminal(value) {
  return ["COMPLETED", "PARTIAL", "FAILED"].includes(cleanText(value).toUpperCase());
}

export function mergeJobDiagnosticsIntoResult(row = {}, statusPayload = {}) {
  const job = (statusPayload.jobs || [])[0] || {};
  const summary = jobL2Summary(statusPayload);
  const candidateDebug = compactCandidateTrace(job.session?.candidate_control_plane_trace || {});
  const providerDiagnostics = objectOrNull(summary.provider_diagnostics)
    || providerDiagnosticsFromSummary(summary);
  const terminalTitleReady = summaryHasVisibleL2Title(summary);
  const terminalWriterReview = summaryRequiresWriterReview(summary);
  const terminalWriterReady = terminalTitleReady || terminalWriterReview;
  return compactObject({
    ...row,
    ok: terminalWriterReady ? true : row.ok,
    writer_ready: terminalWriterReady ? true : row.writer_ready,
    l2_ready: terminalWriterReady ? true : row.l2_ready,
    writer_review_required: terminalWriterReview ? true : row.writer_review_required,
    final_title: terminalTitleReady ? cleanText(summary.title) : row.final_title,
    error: terminalWriterReady ? null : row.error,
    session_status: summary.session_status || row.session_status || null,
    l2_status: summary.l2_status || row.l2_status || null,
    assisted_draft_status: summary.assisted_draft_status || row.assisted_draft_status || null,
    l2_route: summary.route || row.l2_route || null,
    recognition_session_id: row.recognition_session_id || summary.recognition_session_id || null,
    job_status: summary.job_status || row.job_status || null,
    attempt_count: summary.attempt_count ?? row.attempt_count ?? null,
    retry_attempt_history: summary.retry_attempt_history?.length
      ? summary.retry_attempt_history
      : row.retry_attempt_history || [],
    retry_error_codes: summary.retry_error_codes?.length
      ? summary.retry_error_codes
      : row.retry_error_codes || [],
    completion_payload_sanitized_nul_count: summary.completion_payload_sanitized_nul_count
      ?? row.completion_payload_sanitized_nul_count
      ?? 0,
    worker_queue_wait_ms: summary.worker_queue_wait_ms ?? row.worker_queue_wait_ms ?? null,
    paired_l1_wait_ms: summary.paired_l1_wait_ms ?? row.paired_l1_wait_ms ?? null,
    scheduler_queue_wait_ms: summary.scheduler_queue_wait_ms ?? row.scheduler_queue_wait_ms ?? null,
    worker_processing_ms: summary.worker_processing_ms ?? row.worker_processing_ms ?? null,
    time_to_l2_ready_ms: summary.time_to_l2_ready_ms ?? row.time_to_l2_ready_ms ?? null,
    recognition_started_at: summary.recognition_started_at || row.recognition_started_at || null,
    recognition_start_source: summary.recognition_start_source || row.recognition_start_source || null,
    writer_visible_recognition_ms: summary.writer_visible_recognition_ms ?? row.writer_visible_recognition_ms ?? null,
    writer_ready_capacity_release: summary.writer_ready_capacity_release || row.writer_ready_capacity_release || null,
    writer_ready_capacity_refill: summary.writer_ready_capacity_refill
      || summary.writer_ready_capacity_release?.refill
      || row.writer_ready_capacity_refill
      || row.writer_ready_capacity_release?.refill
      || null,
    writer_ready_capacity_release_mode: summary.writer_ready_capacity_release_mode || row.writer_ready_capacity_release_mode || null,
    provider_capacity_stage_handoff: summary.provider_capacity_stage_handoff || row.provider_capacity_stage_handoff || null,
    provider_capacity_slot: summary.provider_capacity_slot ?? row.provider_capacity_slot ?? null,
    provider_key_slot: summary.provider_key_slot ?? row.provider_key_slot ?? null,
    provider_capacity: summary.provider_capacity ?? row.provider_capacity ?? null,
    provider_key_count: summary.provider_key_count ?? row.provider_key_count ?? null,
    provider_key_assignment: summary.provider_key_assignment || row.provider_key_assignment || null,
    resolved_fields: Object.keys(summary.resolved_fields || {}).length ? summary.resolved_fields : row.resolved_fields,
    field_states: Object.keys(summary.field_states || {}).length ? summary.field_states : row.field_states,
    title_length_policy: summary.title_length_policy || row.title_length_policy || null,
    title_render_source: summary.title_render_source || row.title_render_source || null,
    l2_catalog_raw_candidate_count: summary.catalog_raw_candidate_count ?? row.l2_catalog_raw_candidate_count ?? null,
    l2_catalog_approved_candidate_count: summary.catalog_approved_candidate_count ?? row.l2_catalog_approved_candidate_count ?? null,
    l2_catalog_conflict_blocked_count: summary.catalog_conflict_blocked_count ?? row.l2_catalog_conflict_blocked_count ?? null,
    l2_catalog_prompt_candidate_count: summary.catalog_prompt_candidate_count ?? row.l2_catalog_prompt_candidate_count ?? null,
    l2_catalog_provider_prompt_candidate_count: summary.catalog_provider_prompt_candidate_count
      ?? row.l2_catalog_provider_prompt_candidate_count
      ?? null,
    l2_catalog_post_observation_blocked_count: summary.catalog_post_observation_blocked_count
      ?? row.l2_catalog_post_observation_blocked_count
      ?? null,
    l2_catalog_evidence_support_field_count: summary.catalog_evidence_support_field_count ?? row.l2_catalog_evidence_support_field_count ?? null,
    l2_catalog_participation_level: summary.catalog_participation_level || row.l2_catalog_participation_level || null,
    l2_vector_raw_candidate_count: summary.vector_raw_candidate_count ?? row.l2_vector_raw_candidate_count ?? null,
    l2_vector_approved_candidate_count: summary.vector_approved_candidate_count ?? row.l2_vector_approved_candidate_count ?? null,
    l2_vector_conflict_blocked_count: summary.vector_conflict_blocked_count ?? row.l2_vector_conflict_blocked_count ?? null,
    l2_vector_prompt_candidate_count: summary.vector_prompt_candidate_count ?? row.l2_vector_prompt_candidate_count ?? null,
    l2_vector_provider_prompt_candidate_count: summary.vector_provider_prompt_candidate_count
      ?? row.l2_vector_provider_prompt_candidate_count
      ?? null,
    l2_vector_post_observation_blocked_count: summary.vector_post_observation_blocked_count
      ?? row.l2_vector_post_observation_blocked_count
      ?? null,
    l2_vector_evidence_support_field_count: summary.vector_evidence_support_field_count ?? row.l2_vector_evidence_support_field_count ?? null,
    l2_vector_participation_level: summary.vector_participation_level || row.l2_vector_participation_level || null,
    l2_candidate_debug: candidateDebug,
    vector_runtime_status: summary.vector_runtime_status || row.vector_runtime_status || null,
    vector_runtime_status_code: summary.vector_runtime_status_code ?? row.vector_runtime_status_code ?? null,
    vector_runtime_unavailable_reasons: summary.vector_runtime_unavailable_reasons || row.vector_runtime_unavailable_reasons || null,
    vector_worker_status: summary.vector_worker_status || row.vector_worker_status || null,
    vector_worker_reason: summary.vector_worker_reason || row.vector_worker_reason || null,
    vector_worker_feature_count: summary.vector_worker_feature_count ?? row.vector_worker_feature_count ?? null,
    vector_worker_latency_ms: summary.vector_worker_latency_ms ?? row.vector_worker_latency_ms ?? null,
    vector_worker_attempt_count: summary.vector_worker_attempt_count ?? row.vector_worker_attempt_count ?? null,
    preingestion_ocr_rendezvous: summary.preingestion_ocr_rendezvous || row.preingestion_ocr_rendezvous || null,
    preingestion_evidence_refresh: summary.preingestion_evidence_refresh || row.preingestion_evidence_refresh || null,
    preingestion_retrieval_refresh: summary.preingestion_retrieval_refresh || row.preingestion_retrieval_refresh || null,
    preingestion_retrieval_anchor_fields: summary.preingestion_retrieval_anchor_fields?.length
      ? summary.preingestion_retrieval_anchor_fields
      : row.preingestion_retrieval_anchor_fields,
    serial_numerator_verified: summary.serial_numerator_verified ?? row.serial_numerator_verified ?? null,
    pipeline_node_ledger: summary.pipeline_node_ledger || row.pipeline_node_ledger || null,
    noncritical_persistence_status: summary.noncritical_persistence_status || row.noncritical_persistence_status || null,
    noncritical_persistence_summary: summary.noncritical_persistence_summary || row.noncritical_persistence_summary || null,
    provider_diagnostics: providerDiagnostics,
    v4_l2_timing: summary.v4_l2_timing || row.v4_l2_timing || null,
    v4_pipeline_contract: summary.v4_pipeline_contract || row.v4_pipeline_contract || null,
    strategy_replay_trace: summary.strategy_replay_trace || row.strategy_replay_trace || null,
    input_tokens: providerDiagnostics.input_tokens ?? row.input_tokens ?? null,
    output_tokens: providerDiagnostics.output_tokens ?? row.output_tokens ?? null,
    total_tokens: providerDiagnostics.total_tokens ?? row.total_tokens ?? null,
    provider_latency_ms: providerDiagnostics.provider_latency_ms ?? row.provider_latency_ms ?? null,
    provider_key_pool_size: providerDiagnostics.provider_key_pool_size ?? row.provider_key_pool_size ?? null,
    provider_key_slot: providerDiagnostics.provider_key_slot ?? summary.provider_key_slot ?? row.provider_key_slot ?? null,
    provider_key_source: providerDiagnostics.provider_key_source || row.provider_key_source || null,
    provider_key_rotation_attempted: providerDiagnostics.provider_key_rotation_attempted ?? row.provider_key_rotation_attempted ?? null,
    provider_key_rotation_attempts: providerDiagnostics.provider_key_rotation_attempts ?? row.provider_key_rotation_attempts ?? null,
    response_status: providerDiagnostics.response_status || row.response_status || null,
    "x-ratelimit-limit-requests": providerDiagnostics["x-ratelimit-limit-requests"] ?? row["x-ratelimit-limit-requests"] ?? null,
    "x-ratelimit-remaining-requests": providerDiagnostics["x-ratelimit-remaining-requests"] ?? row["x-ratelimit-remaining-requests"] ?? null,
    "x-ratelimit-limit-tokens": providerDiagnostics["x-ratelimit-limit-tokens"] ?? row["x-ratelimit-limit-tokens"] ?? null,
    "x-ratelimit-remaining-tokens": providerDiagnostics["x-ratelimit-remaining-tokens"] ?? row["x-ratelimit-remaining-tokens"] ?? null,
    "x-ratelimit-reset-requests": providerDiagnostics["x-ratelimit-reset-requests"] ?? row["x-ratelimit-reset-requests"] ?? null,
    "x-ratelimit-reset-tokens": providerDiagnostics["x-ratelimit-reset-tokens"] ?? row["x-ratelimit-reset-tokens"] ?? null,
    diagnostic_job_updated_at: job.updated_at || null
  });
}

async function readSettledJobDiagnostics({
  baseUrl,
  cookie,
  jobId,
  requestTimeoutMs,
  attempts = 45
}) {
  let last = null;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      last = await getJson({
        baseUrl,
        path: `/api/v4/listing-job-status?job_ids=${encodeURIComponent(jobId)}&limit=1`,
        cookie,
        requestTimeoutMs: Math.min(requestTimeoutMs, 45000)
      });
    } catch (error) {
      lastError = serializableError(error, "job_diagnostics_request_failed");
      await delay(1000);
      continue;
    }
    if (!last.ok) {
      lastError = serializableError(last.data, `job_diagnostics_http_${last.http_status || "unknown"}`);
      if (batchStatusResponseDisposition(last) === "fatal") break;
      await delay(1000);
      continue;
    }
    const summary = jobL2Summary(last.data || {});
    if (summary.pipeline_node_ledger
      && persistenceStatusIsTerminal(summary.noncritical_persistence_status)
      && !activeJobStatus(summary.job_status)) {
      return { ok: true, response: last, attempts: attempt, error: null };
    }
    if (attempt < attempts) await delay(1000);
  }
  return {
    ok: Boolean(last?.ok),
    response: last,
    attempts,
    error: lastError || (last?.ok ? "job_diagnostics_not_settled" : "job_diagnostics_unavailable")
  };
}

export async function hydrateV4JobDiagnostics({
  results = [],
  baseUrl,
  cookie,
  requestTimeoutMs = 90000,
  concurrency = 4
} = {}) {
  const startedAt = Date.now();
  let requestedCount = 0;
  let hydratedCount = 0;
  let failedCount = 0;
  const hydrated = await mapWithConcurrency(results, Math.max(1, concurrency), async (row) => {
    const retryHistoryMissing = Number(row.attempt_count || 0) > 1
      && (!Array.isArray(row.retry_attempt_history) || row.retry_attempt_history.length === 0);
    const queueControlDiagnosticsMissing = !row.provider_capacity_slot
      || !row.provider_key_slot
      || !row.provider_key_assignment
      || !row.writer_ready_capacity_release_mode;
    const candidateDiagnosticsMissing = row.l2_candidate_debug?.decision_eligible_candidate_count === undefined
      || !Array.isArray(row.l2_candidate_debug?.candidate_application_trace);
    if (!row.job_id || (row.pipeline_node_ledger
      && persistenceStatusIsTerminal(row.noncritical_persistence_status)
      && !retryHistoryMissing
      && !queueControlDiagnosticsMissing
      && !candidateDiagnosticsMissing)) return row;
    requestedCount += 1;
    const diagnostics = await readSettledJobDiagnostics({
      baseUrl,
      cookie,
      jobId: row.job_id,
      requestTimeoutMs
    });
    if (!diagnostics.response?.data) {
      failedCount += 1;
      return { ...row, diagnostic_hydration_error: diagnostics.error };
    }
    const next = mergeJobDiagnosticsIntoResult(row, diagnostics.response.data);
    if (next.pipeline_node_ledger) hydratedCount += 1;
    else failedCount += 1;
    return {
      ...next,
      diagnostic_hydration_attempts: diagnostics.attempts,
      diagnostic_hydration_error: diagnostics.error
    };
  });
  return {
    results: hydrated,
    metrics: {
      requested_count: requestedCount,
      hydrated_count: hydratedCount,
      failed_count: failedCount,
      duration_ms: Date.now() - startedAt,
      excluded_from_recognition_wall_time: true
    }
  };
}

function titleTokens(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function rawTokenRecall(referenceTitle = "", predictionTitle = "") {
  const reference = new Set(titleTokens(referenceTitle));
  if (!reference.size) return null;
  const predicted = new Set(titleTokens(predictionTitle));
  const overlap = [...reference].filter((token) => predicted.has(token)).length;
  return Number((overlap / reference.size).toFixed(6));
}

function serialMatches(value = "") {
  return [...String(value || "").matchAll(/(?<![\d.])0*(\d+)\s*\/\s*(\d+)\b/g)].map((match) => ({
    exact: `${Number(match[1])}/${Number(match[2])}`,
    denominator: String(Number(match[2]))
  }));
}

function serialTitleAnalysis(referenceTitle = "", predictionTitle = "") {
  const reference = serialMatches(referenceTitle);
  const prediction = serialMatches(predictionTitle);
  const exactSet = new Set(prediction.map((item) => item.exact));
  const denominatorSet = new Set(prediction.map((item) => item.denominator));
  for (const match of String(predictionTitle || "").matchAll(/(?:^|\s)#?\/\s*0*(\d+)\b/g)) {
    denominatorSet.add(String(Number(match[1])));
  }
  const details = reference.map((serial) => {
    const exact = exactSet.has(serial.exact);
    const denominator = denominatorSet.has(serial.denominator);
    return {
      reference_serial: serial.exact,
      numerical_rarity: `/${serial.denominator}`,
      exact_match: exact,
      denominator_match: denominator,
      numerator_omitted: !exact && denominator,
      missing: !exact && !denominator
    };
  });
  return {
    reference_serial_count: reference.length,
    prediction_serial_count: prediction.length,
    exact_match_count: details.filter((item) => item.exact_match).length,
    denominator_match_count: details.filter((item) => item.denominator_match).length,
    numerator_omission_count: details.filter((item) => item.numerator_omitted).length,
    missing_count: details.filter((item) => item.missing).length,
    details
  };
}

function scoreTitles(referenceTitle = "", predictionTitle = "") {
  return {
    raw_token_recall: rawTokenRecall(referenceTitle, predictionTitle),
    fair_token_recall: fairTokenRecall(referenceTitle, predictionTitle),
    policy_fair_token_recall: policyFairTokenRecall(referenceTitle, predictionTitle),
    serial_number_title_analysis: serialTitleAnalysis(referenceTitle, predictionTitle)
  };
}

function metricNumber(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function quantile(values, q) {
  const clean = values.map(metricNumber).filter((value) => value !== null).sort((a, b) => a - b);
  if (!clean.length) return null;
  const index = Math.min(clean.length - 1, Math.max(0, Math.ceil(clean.length * q) - 1));
  return clean[index];
}

function average(values) {
  const clean = values.map(metricNumber).filter((value) => value !== null);
  if (!clean.length) return null;
  return Number((clean.reduce((sum, value) => sum + value, 0) / clean.length).toFixed(6));
}

function countPass(values, threshold) {
  return values.map(metricNumber).filter((value) => value !== null && value >= threshold).length;
}

function identifierIntegrity(values = []) {
  const normalized = values.map(cleanText).filter(Boolean);
  const uniqueCount = new Set(normalized).size;
  return {
    present_count: normalized.length,
    unique_count: uniqueCount,
    duplicate_count: Math.max(0, normalized.length - uniqueCount)
  };
}

function compactObject(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function resultTitle(response = {}) {
  return cleanText(response.final_title || response.writer_safe_draft || response.title || "");
}

function cacheStatusFromResponse(data = {}) {
  const fastScout = data.provider_result?.fast_scout || null;
  const explicitBlocking = data.fast_scout_blocking_call_used;
  return {
    cache_hit: data.fast_scout_cache_hit === true || fastScout?.cache_hit === true,
    cache_status: data.fast_scout_cache_status || (fastScout?.cache_hit ? "HIT" : null),
    prewarmer_used: data.fast_scout_prewarmer_used === true,
    blocking_call_used: explicitBlocking === true || (explicitBlocking !== false && Boolean(fastScout))
  };
}

async function runOne({
  item,
  index,
  baseUrl,
  cookie,
  prewarm,
  prewarmCacheOnly = true,
  queueMode = false,
  forceL2Direct = false,
  modelOverride = "",
  enableL1 = false,
  compactL2 = false,
  ultraFastL2 = null,
  fastInitialPrompt = null,
  ultraSparseTransport = false,
  providerDoneHandoff = null,
  ultraFastImageDetail = "auto",
  ultraFastServiceTier = "",
  disableIdentityCache = false,
  coldStartBlind = false,
  usePreingestion = false,
  preingestionSource = "v4_ebay_smoke_preingestion",
  speculative = false,
  thinkMs = 6000,
  l2WaitMs,
  requestTimeoutMs
}) {
  const sourceAssetId = candidateId(item, index);
  const effectiveL2WaitMs = batchPollWaitBudgetMs({
    requestedWaitMs: l2WaitMs,
    itemCount: 1,
    providerConcurrency: 1
  });
  const preparedItem = await prepareDurableSmokeItem({
    item,
    index,
    baseUrl,
    cookie,
    requestTimeoutMs: Math.min(requestTimeoutMs, 45000)
  });
  const runtimeItem = preparedItem.item;
  const id = preparedItem.asset.asset_id;
  const images = preparedItem.images;
  const payload = payloadForItem(runtimeItem, index, images, {
    forceL2Direct,
    modelOverride,
    enableL1,
    compactL2,
    ultraFastL2,
    fastInitialPrompt,
    ultraSparseTransport,
    providerDoneHandoff,
    ultraFastImageDetail,
    ultraFastServiceTier,
    disableIdentityCache,
    coldStartBlind
  });
  const prewarmPromise = prewarm
    ? postJson({
      baseUrl,
      path: "/api/v4/fast-scout-prewarm",
      cookie,
      payload: {
        ...payload,
        v4_fast_scout_cache_only: prewarmCacheOnly
      },
      requestTimeoutMs
    }).catch((error) => ({
      ok: false,
      http_status: null,
      latency_ms: null,
      data: {
        ok: false,
        prewarm_status: "REQUEST_FAILED",
        message: String(error?.message || error || "fast_scout_prewarm_failed").slice(0, 240)
      }
    }))
    : Promise.resolve(null);
  let preingestionResult = null;
  if (usePreingestion) {
    try {
      preingestionResult = await preingestItem({
        baseUrl,
        cookie,
        assetId: id,
        images,
        source: preingestionSource,
        requestTimeoutMs: Math.min(requestTimeoutMs, 45000)
      });
      if (preingestionResult.ok && preingestionResult.bundle_id) {
        payload.preingestion_bundle_id = preingestionResult.bundle_id;
        payload.preingestionBundleId = preingestionResult.bundle_id;
        payload.preingestion_bundle_status = preingestionResult.bundle_status;
        payload.preingestion_summary = preingestionResult.preprocessing_summary;
      }
    } catch (error) {
      preingestionResult = {
        ok: false,
        http_status: null,
        latency_ms: null,
        bundle_id: null,
        bundle_status: "preingestion_request_failed",
        worker_jobs_enqueued: null,
        signed_read_url_count: null,
        signed_read_url_error_count: null,
        preprocessing_summary: null,
        error: { message: String(error.message || error).slice(0, 240) }
      };
    }
  }
  const sealedKey = item.sealed_eval_label_ref?.key || "";
  // The recognition phase never loads or reads the sealed seller title. Local
  // scoring is attached only after every prediction has been frozen.
  const sellerTitle = "";
  const prewarmResult = await prewarmPromise;

  if (queueMode && speculative) {
    // 复刻新前端“识别前移”行为：图片/证据包就绪（=preingest 完成）的时刻 T0，
    // preingest 与缓存探针已并行完成，提交受全局容量控制的隐藏 L1 + 最终 L2；
    // 模拟写手思考 thinkMs 后在 T1“点击”，此后测的才是写手感知延迟。
    const batchId = `smoke-v4-spec-${Date.now()}-${index}`;
    const queuedPayload = {
      ...payload,
      force_l2_only: !enableL1,
      create_l1_job: enableL1,
      create_l2_job: true,
      disable_fast_scout_l1: !enableL1,
      v4_force_l2_direct: !enableL1,
      client_speculative: true
    };
    const t0 = Date.now();
    const enqueue = await postJson({
      baseUrl,
      path: "/api/v4/listing-job-enqueue",
      cookie,
      payload: {
        batch_id: batchId,
        tenant_id: batchId,
        priority: 100,
        jobs: [{
          asset_id: id,
          image_generation_id: payload.image_generation_id,
          force_l2_only: !enableL1,
          create_l1_job: enableL1,
          create_l2_job: true,
          payload: queuedPayload
        }]
      },
      requestTimeoutMs: Math.min(requestTimeoutMs, 45000),
      maxAttempts: 5
    });
    const speculativeSetupMs = Date.now() - t0;

    // 写手思考时间：L2 在后台跑，OCR 证据 patch 持续回灌 bundle。
    const remainingThinkMs = Math.max(0, thinkMs - speculativeSetupMs);
    if (remainingThinkMs > 0) await delay(remainingThinkMs);

    const job = (enqueue.data?.jobs || []).find((entry) => entry?.ok && entry.job_type === "FINAL_ASSISTED_TITLE")
      || (enqueue.data?.jobs || []).find((entry) => entry?.ok)
      || {};

    // T1 = “点击”时刻：此刻起才是写手感知延迟。
    const clickAt = Date.now();
    const l2 = await pollJobStatus({
      baseUrl,
      cookie,
      jobId: job.job_id,
      waitMs: effectiveL2WaitMs,
      requestTimeoutMs: Math.min(requestTimeoutMs, 45000)
    });
    const l2ElapsedFromClickMs = Date.now() - clickAt;
    const l2Terminal = Boolean(l2.ready || l2.review_required);
    const l2DoneBeforeClick = l2Terminal && l2.polls <= 1;
    const finalTitle = cleanText(l2.summary?.title || "");
    const finalScore = scoreTitles(sellerTitle, finalTitle);
    const finalProviderDiagnostics = objectOrNull(l2.summary?.provider_diagnostics)
      || providerDiagnosticsFromSummary(l2.summary || {});
    const writerReady = Boolean(l2Terminal || finalTitle);
    const preL2AnchorFastLaneHit = l2.summary?.v4_l2_timing?.pre_l2_full_l2_skipped === true;
    const exactScoutFastLaneHit = (
      l2.summary?.v4_l2_timing?.exact_anchor_scout_status === "CACHE_HIT"
      && Number(l2.summary?.v4_l2_timing?.exact_anchor_finalize_ms || 0) > 0
      && Number(l2.summary?.worker_processing_ms || 0) < 5000
    );
    const fastLaneHit = preL2AnchorFastLaneHit || exactScoutFastLaneHit;
    // 感知延迟：点击时若最终 L2 已可见则为 0；否则等到 L2 就绪为止。
    // 未就绪时置 undefined（而非 null），避免 quantile 把 Number(null)=0 计入。
    const perceivedTitleMs = l2DoneBeforeClick ? 0 : (l2Terminal ? l2ElapsedFromClickMs : undefined);
    return compactObject({
      asset_id: id,
      source_asset_id: sourceAssetId,
      sealed_label_key: sealedKey || null,
      seller_title_visible_to_model: false,
      seller_title_used_for_local_eval_only: Boolean(sellerTitle),
      seller_title: sellerTitle,
      image_count: payload.images.length,
      preingestion_used: usePreingestion,
      preingestion_ok: preingestionResult?.ok ?? null,
      preingestion_http_status: preingestionResult?.http_status ?? null,
      preingestion_latency_ms: preingestionResult?.latency_ms ?? null,
      preingestion_bundle_id: preingestionResult?.bundle_id || null,
      preingestion_bundle_status: preingestionResult?.bundle_status || null,
      preingestion_worker_jobs_enqueued: preingestionResult?.worker_jobs_enqueued ?? null,
      preingestion_error: preingestionResult?.error ? JSON.stringify(preingestionResult.error).slice(0, 500) : null,
      queue_mode: true,
      speculative_mode: true,
      think_ms: thinkMs,
      job_id: job.job_id || null,
      http_status: enqueue.http_status,
      ok: writerReady,
      l1_ok: prewarmResult?.data?.ok === true,
      writer_ready: writerReady,
      writer_review_required: l2.review_required === true,
      error: enqueue.ok ? null : enqueue.data,
      l1_wall_latency_ms: prewarmResult?.latency_ms ?? null,
      speculative_setup_ms: speculativeSetupMs,
      speculative_l1_http_status: prewarmResult?.http_status ?? null,
      speculative_l1_title: "",
      speculative_l1_title_render_source: null,
      speculative_l1_title_stage: "L1_INTERNAL_SCOUT",
      speculative_l1_fast_lane_hit: fastLaneHit,
      speculative_l1_exact_anchor: null,
      speculative_l1_scoring: null,
      l2_done_before_click: l2DoneBeforeClick,
      perceived_title_ms: perceivedTitleMs,
      route: l2.summary?.route || null,
      title_stage: preL2AnchorFastLaneHit
        ? "PRE_L2_ANCHOR_FINALIZED"
        : exactScoutFastLaneHit
          ? "SPEC_L2_EXACT_ANCHOR"
          : "V4_QUEUE_L2",
      recognition_session_id: job.recognition_session_id || l2.summary?.recognition_session_id || null,
      l1_title: "",
      l2_ready: l2Terminal,
      l2_poll_count: l2.polls,
      l2_poll_elapsed_ms: l2.elapsed_ms ?? null,
      time_to_writer_ready_ms: l2Terminal ? (Date.now() - t0) : null,
      worker_queue_wait_ms: l2.summary?.worker_queue_wait_ms ?? null,
      paired_l1_wait_ms: l2.summary?.paired_l1_wait_ms ?? null,
      scheduler_queue_wait_ms: l2.summary?.scheduler_queue_wait_ms ?? l2.summary?.worker_queue_wait_ms ?? null,
      worker_processing_ms: l2.summary?.worker_processing_ms ?? null,
      time_to_l2_ready_ms: l2.summary?.time_to_l2_ready_ms ?? null,
      l2_status: l2.summary,
      l2_candidate_debug: l2.candidateDebug || {},
      final_title: finalTitle,
      provider_diagnostics: finalProviderDiagnostics,
      v4_l2_timing: l2.summary?.v4_l2_timing || null,
      v4_pipeline_contract: l2.summary?.v4_pipeline_contract || null,
      strategy_replay_trace: l2.summary?.strategy_replay_trace || null,
      pre_l2_anchor_fast_lane_hit: preL2AnchorFastLaneHit,
      pre_l2_anchor_route: l2.summary?.v4_l2_timing?.pre_l2_anchor_route || null,
      pre_l2_anchor_finalize_reason: l2.summary?.v4_l2_timing?.pre_l2_anchor_finalize_reason || null,
      pre_l2_anchor_probe_ms: l2.summary?.v4_l2_timing?.pre_l2_anchor_probe_ms ?? null,
      pre_l2_anchor_patch_count: l2.summary?.v4_l2_timing?.pre_l2_anchor_patch_count ?? null,
      pre_l2_anchor_candidate_count: l2.summary?.v4_l2_timing?.pre_l2_anchor_candidate_count ?? null,
      pre_l2_anchor_direct_candidate_count: l2.summary?.v4_l2_timing?.pre_l2_anchor_direct_candidate_count ?? null,
      pre_l2_anchor_type_breakdown: l2.summary?.v4_l2_timing?.pre_l2_anchor_type_breakdown || {},
      pre_l2_anchor_lookup_attempted: l2.summary?.v4_l2_timing?.pre_l2_anchor_lookup_attempted === true,
      pre_l2_anchor_catalog_candidate_count: l2.summary?.v4_l2_timing?.pre_l2_anchor_catalog_candidate_count ?? null,
      pre_l2_anchor_trusted_candidate_count: l2.summary?.v4_l2_timing?.pre_l2_anchor_trusted_candidate_count ?? null,
      pre_l2_anchor_eligible_candidate_count: l2.summary?.v4_l2_timing?.pre_l2_anchor_eligible_candidate_count ?? null,
      fast_scout_cache_hit: exactScoutFastLaneHit,
      fast_scout_cache_status: l2.summary?.v4_l2_timing?.exact_anchor_scout_status || null,
      fast_scout_prewarmer_used: prewarmResult?.data?.ok === true,
      fast_scout_blocking_call_used: false,
      prewarm_status: prewarmResult?.data?.prewarm_status || null,
      prewarm_http_status: prewarmResult?.http_status ?? null,
      prewarm_latency_ms: prewarmResult?.latency_ms ?? null,
      prewarm_cache_hit: prewarmResult?.data?.fast_scout_cache_hit ?? null,
      prewarm_cache_status: prewarmResult?.data?.fast_scout_cache_status || null,
      final_scoring: finalScore,
      l2_catalog_raw_candidate_count: l2.summary?.catalog_raw_candidate_count ?? null,
      l2_catalog_approved_candidate_count: l2.summary?.catalog_approved_candidate_count ?? null,
      l2_catalog_conflict_blocked_count: l2.summary?.catalog_conflict_blocked_count ?? null,
      l2_catalog_prompt_candidate_count: l2.summary?.catalog_prompt_candidate_count ?? null,
      l2_catalog_evidence_support_field_count: l2.summary?.catalog_evidence_support_field_count ?? null,
      l2_catalog_participation_level: l2.summary?.catalog_participation_level ?? null,
      l2_vector_raw_candidate_count: l2.summary?.vector_raw_candidate_count ?? null,
      l2_vector_approved_candidate_count: l2.summary?.vector_approved_candidate_count ?? null,
      l2_vector_conflict_blocked_count: l2.summary?.vector_conflict_blocked_count ?? null,
      l2_vector_prompt_candidate_count: l2.summary?.vector_prompt_candidate_count ?? null,
      l2_vector_evidence_support_field_count: l2.summary?.vector_evidence_support_field_count ?? null,
      l2_vector_participation_level: l2.summary?.vector_participation_level ?? null,
      vector_runtime_status: l2.summary?.vector_runtime_status ?? null,
      vector_runtime_status_code: l2.summary?.vector_runtime_status_code ?? null,
      vector_runtime_unavailable_reasons: l2.summary?.vector_runtime_unavailable_reasons ?? null,
      vector_worker_status: l2.summary?.vector_worker_status ?? null,
      vector_worker_reason: l2.summary?.vector_worker_reason ?? null,
      vector_worker_feature_count: l2.summary?.vector_worker_feature_count ?? null,
      vector_worker_latency_ms: l2.summary?.vector_worker_latency_ms ?? null,
      vector_worker_attempt_count: l2.summary?.vector_worker_attempt_count ?? null,
      catalog_stage_capacity: l2.summary?.catalog_stage_capacity || null,
      vector_stage_capacity: l2.summary?.vector_stage_capacity || null,
      preingestion_ocr_rendezvous: l2.summary?.preingestion_ocr_rendezvous || null,
      preingestion_evidence_refresh: l2.summary?.preingestion_evidence_refresh || null,
      preingestion_retrieval_refresh: l2.summary?.preingestion_retrieval_refresh || null,
      preingestion_retrieval_anchor_fields: l2.summary?.preingestion_retrieval_anchor_fields || [],
      serial_numerator_verified: l2.summary?.serial_numerator_verified ?? null,
      pipeline_node_ledger: l2.summary?.pipeline_node_ledger || null,
      noncritical_persistence_status: l2.summary?.noncritical_persistence_status || null,
      noncritical_persistence_summary: l2.summary?.noncritical_persistence_summary || null,
      attempt_count: l2.summary?.attempt_count ?? null,
      retry_attempt_history: l2.summary?.retry_attempt_history || [],
      retry_error_codes: l2.summary?.retry_error_codes || [],
      completion_payload_sanitized_nul_count: l2.summary?.completion_payload_sanitized_nul_count ?? 0,
      job_status: l2.summary?.job_status || null,
      input_tokens: finalProviderDiagnostics.input_tokens,
      output_tokens: finalProviderDiagnostics.output_tokens,
      total_tokens: finalProviderDiagnostics.total_tokens,
      provider_latency_ms: finalProviderDiagnostics.provider_latency_ms,
      provider_key_pool_size: finalProviderDiagnostics.provider_key_pool_size,
      provider_key_slot: finalProviderDiagnostics.provider_key_slot,
      provider_key_source: finalProviderDiagnostics.provider_key_source,
      provider_key_rotation_attempted: finalProviderDiagnostics.provider_key_rotation_attempted,
      provider_key_rotation_attempts: finalProviderDiagnostics.provider_key_rotation_attempts,
      response_status: finalProviderDiagnostics.response_status,
      incomplete_reason: finalProviderDiagnostics.incomplete_reason,
      output_cap: finalProviderDiagnostics.output_cap,
      output_utilization: finalProviderDiagnostics.output_utilization,
      "x-ratelimit-limit-requests": finalProviderDiagnostics["x-ratelimit-limit-requests"],
      "x-ratelimit-remaining-requests": finalProviderDiagnostics["x-ratelimit-remaining-requests"],
      "x-ratelimit-limit-tokens": finalProviderDiagnostics["x-ratelimit-limit-tokens"],
      "x-ratelimit-remaining-tokens": finalProviderDiagnostics["x-ratelimit-remaining-tokens"],
      "x-ratelimit-reset-requests": finalProviderDiagnostics["x-ratelimit-reset-requests"],
      "x-ratelimit-reset-tokens": finalProviderDiagnostics["x-ratelimit-reset-tokens"]
    });
  }

  if (queueMode) {
    const batchId = `smoke-v4-${Date.now()}-${index}`;
    const queuedPayload = {
      ...payload,
      force_l2_only: true,
      create_l1_job: false,
      create_l2_job: true,
      disable_fast_scout_l1: true,
      v4_force_l2_direct: true
    };
    const enqueue = await postJson({
      baseUrl,
      path: "/api/v4/listing-job-enqueue",
      cookie,
      payload: {
        batch_id: batchId,
        tenant_id: batchId,
        priority: 100,
        jobs: [{
          asset_id: id,
          image_generation_id: payload.image_generation_id,
          force_l2_only: true,
          create_l1_job: false,
          create_l2_job: true,
          payload: queuedPayload
        }]
      },
      requestTimeoutMs: Math.min(requestTimeoutMs, 45000),
      maxAttempts: 5
    });
    const job = (enqueue.data?.jobs || []).find((entry) => entry?.ok && entry.job_type === "FINAL_ASSISTED_TITLE")
      || (enqueue.data?.jobs || []).find((entry) => entry?.ok)
      || {};
    const l2 = await pollJobStatus({
      baseUrl,
      cookie,
      jobId: job.job_id,
      waitMs: effectiveL2WaitMs,
      requestTimeoutMs: Math.min(requestTimeoutMs, 45000)
    });
    const finalTitle = cleanText(l2.summary?.title || "");
    const finalScore = scoreTitles(sellerTitle, finalTitle);
    const finalProviderDiagnostics = objectOrNull(l2.summary?.provider_diagnostics)
      || providerDiagnosticsFromSummary(l2.summary || {});
    const l2Terminal = Boolean(l2.ready || l2.review_required);
    const writerReady = Boolean(l2Terminal || finalTitle);
    return compactObject({
      asset_id: id,
      source_asset_id: sourceAssetId,
      sealed_label_key: sealedKey || null,
      seller_title_visible_to_model: false,
      seller_title_used_for_local_eval_only: Boolean(sellerTitle),
      seller_title: sellerTitle,
      image_count: payload.images.length,
      preingestion_used: usePreingestion,
      preingestion_ok: preingestionResult?.ok ?? null,
      preingestion_http_status: preingestionResult?.http_status ?? null,
      preingestion_latency_ms: preingestionResult?.latency_ms ?? null,
      preingestion_bundle_id: preingestionResult?.bundle_id || null,
      preingestion_bundle_status: preingestionResult?.bundle_status || null,
      preingestion_worker_jobs_enqueued: preingestionResult?.worker_jobs_enqueued ?? null,
      preingestion_signed_read_url_count: preingestionResult?.signed_read_url_count ?? null,
      preingestion_signed_read_url_error_count: preingestionResult?.signed_read_url_error_count ?? null,
      preingestion_error: preingestionResult?.error ? JSON.stringify(preingestionResult.error).slice(0, 500) : null,
      queue_mode: true,
      job_id: job.job_id || null,
      http_status: enqueue.http_status,
      ok: writerReady,
      l1_ok: Boolean(enqueue.ok && enqueue.data?.ok !== false),
      writer_ready: writerReady,
      writer_review_required: l2.review_required === true,
      error: enqueue.ok ? null : enqueue.data,
      l1_wall_latency_ms: enqueue.latency_ms,
      l1_internal_scout_ms: null,
      l1_time_to_safe_draft_ms: null,
      route: l2.summary?.route || null,
      title_stage: "V4_QUEUE_L2",
      recognition_session_id: job.recognition_session_id || l2.summary?.recognition_session_id || null,
      l1_title: "",
      l2_ready: l2Terminal,
      l2_poll_count: l2.polls,
      l2_poll_elapsed_ms: l2.elapsed_ms ?? null,
      time_to_writer_ready_ms: l2Terminal ? enqueue.latency_ms + Number(l2.elapsed_ms || 0) : null,
      worker_queue_wait_ms: l2.summary?.worker_queue_wait_ms ?? null,
      worker_processing_ms: l2.summary?.worker_processing_ms ?? null,
      time_to_l2_ready_ms: l2.summary?.time_to_l2_ready_ms ?? null,
      l2_status: l2.summary,
      l2_candidate_debug: l2.candidateDebug || {},
      final_title: finalTitle,
      fast_scout_cache_hit: null,
      fast_scout_cache_status: null,
      fast_scout_prewarmer_used: prewarmResult?.data?.ok === true,
      fast_scout_blocking_call_used: false,
      prewarm_status: prewarmResult?.data?.prewarm_status || null,
      force_l2_direct: true,
      prewarm_latency_ms: prewarmResult?.latency_ms || null,
      prewarm_cache_hit: prewarmResult?.data?.fast_scout_cache_hit ?? null,
      prewarm_cache_status: prewarmResult?.data?.fast_scout_cache_status || null,
      catalog_prompt_candidate_count: 0,
      vector_prompt_candidate_count: 0,
      provider_prompt_candidate_count: 0,
      l2_catalog_raw_candidate_count: l2.summary?.catalog_raw_candidate_count ?? null,
      l2_catalog_approved_candidate_count: l2.summary?.catalog_approved_candidate_count ?? null,
      l2_catalog_conflict_blocked_count: l2.summary?.catalog_conflict_blocked_count ?? null,
      l2_catalog_prompt_candidate_count: l2.summary?.catalog_prompt_candidate_count ?? null,
      l2_catalog_evidence_support_field_count: l2.summary?.catalog_evidence_support_field_count ?? null,
      l2_catalog_participation_level: l2.summary?.catalog_participation_level ?? null,
      l2_catalog_pre_observation_query_attempted: l2.summary?.catalog_pre_observation_query_attempted ?? null,
      l2_catalog_post_observation_query_attempted: l2.summary?.catalog_post_observation_query_attempted ?? null,
      l2_vector_raw_candidate_count: l2.summary?.vector_raw_candidate_count ?? null,
      l2_vector_approved_candidate_count: l2.summary?.vector_approved_candidate_count ?? null,
      l2_vector_conflict_blocked_count: l2.summary?.vector_conflict_blocked_count ?? null,
      l2_vector_prompt_candidate_count: l2.summary?.vector_prompt_candidate_count ?? null,
      l2_vector_evidence_support_field_count: l2.summary?.vector_evidence_support_field_count ?? null,
      l2_vector_participation_level: l2.summary?.vector_participation_level ?? null,
      l2_vector_pre_observation_query_attempted: l2.summary?.vector_pre_observation_query_attempted ?? null,
      l2_vector_post_observation_query_attempted: l2.summary?.vector_post_observation_query_attempted ?? null,
      vector_runtime_status: l2.summary?.vector_runtime_status ?? null,
      vector_runtime_status_code: l2.summary?.vector_runtime_status_code ?? null,
      vector_runtime_unavailable_reasons: l2.summary?.vector_runtime_unavailable_reasons ?? null,
      vector_worker_status: l2.summary?.vector_worker_status ?? null,
      vector_worker_reason: l2.summary?.vector_worker_reason ?? null,
      vector_worker_feature_count: l2.summary?.vector_worker_feature_count ?? null,
      vector_worker_latency_ms: l2.summary?.vector_worker_latency_ms ?? null,
      vector_worker_attempt_count: l2.summary?.vector_worker_attempt_count ?? null,
      catalog_stage_capacity: l2.summary?.catalog_stage_capacity || null,
      vector_stage_capacity: l2.summary?.vector_stage_capacity || null,
      vector_query_embedding_role: l2.summary?.vector_query_embedding_role ?? null,
      vector_role_agnostic_fallback_used: l2.summary?.vector_role_agnostic_fallback_used ?? null,
      vector_role_agnostic_fallback_reason: l2.summary?.vector_role_agnostic_fallback_reason ?? null,
      vector_returned_row_count: l2.summary?.vector_returned_row_count ?? null,
      vector_self_excluded_count: l2.summary?.vector_self_excluded_count ?? null,
      vector_self_exclusion_query_attempted: l2.summary?.vector_self_exclusion_query_attempted === true,
      vector_self_exclusion_filter_active: l2.summary?.vector_self_exclusion_filter_active === true,
      vector_self_exclusion_requested_source_count: l2.summary?.vector_self_exclusion_requested_source_count ?? null,
      vector_self_exclusion_source_ids_sha256: l2.summary?.vector_self_exclusion_source_ids_sha256 ?? null,
      provider_diagnostics: finalProviderDiagnostics,
      v4_l2_timing: l2.summary?.v4_l2_timing || null,
      v4_pipeline_contract: l2.summary?.v4_pipeline_contract || null,
      strategy_replay_trace: l2.summary?.strategy_replay_trace || null,
      input_tokens: finalProviderDiagnostics.input_tokens,
      output_tokens: finalProviderDiagnostics.output_tokens,
      total_tokens: finalProviderDiagnostics.total_tokens,
      provider_latency_ms: finalProviderDiagnostics.provider_latency_ms,
      provider_key_pool_size: finalProviderDiagnostics.provider_key_pool_size,
      provider_key_slot: finalProviderDiagnostics.provider_key_slot,
      provider_key_source: finalProviderDiagnostics.provider_key_source,
      provider_key_rotation_attempted: finalProviderDiagnostics.provider_key_rotation_attempted,
      provider_key_rotation_attempts: finalProviderDiagnostics.provider_key_rotation_attempts,
      response_status: finalProviderDiagnostics.response_status,
      incomplete_reason: finalProviderDiagnostics.incomplete_reason,
      output_cap: finalProviderDiagnostics.output_cap,
      output_utilization: finalProviderDiagnostics.output_utilization,
      "x-ratelimit-limit-requests": finalProviderDiagnostics["x-ratelimit-limit-requests"],
      "x-ratelimit-remaining-requests": finalProviderDiagnostics["x-ratelimit-remaining-requests"],
      "x-ratelimit-limit-tokens": finalProviderDiagnostics["x-ratelimit-limit-tokens"],
      "x-ratelimit-remaining-tokens": finalProviderDiagnostics["x-ratelimit-remaining-tokens"],
      "x-ratelimit-reset-requests": finalProviderDiagnostics["x-ratelimit-reset-requests"],
      "x-ratelimit-reset-tokens": finalProviderDiagnostics["x-ratelimit-reset-tokens"],
      l1_scoring: scoreTitles(sellerTitle, ""),
      final_scoring: finalScore,
      item_web_url: null
    });
  }

  const l1 = await postJson({
    baseUrl,
    path: "/api/v4/listing-copilot-title",
    cookie,
    payload,
    requestTimeoutMs
  });
  const data = l1.data || {};
  const l1ProviderDiagnostics = providerDiagnosticsFromApiData(data);
  const sessionId = data.recognition_session_id || null;
  const l2 = forceL2Direct
    ? {
      polls: 0,
      ready: Boolean(data.ok && data.writer_review_required !== true),
      review_required: data.ok === true && data.writer_review_required === true,
      terminal: Boolean(data.ok),
      elapsed_ms: 0,
      summary: {
        assisted_draft_status: data.assisted_draft_status || (data.ok ? "READY" : "FAILED"),
        session_status: data.status || null,
        l2_status: data.ok ? "READY" : "FAILED",
        writer_review_required: data.writer_review_required === true,
        writer_review_reason: data.writer_review_reason || null,
        title: resultTitle(data),
        route: data.route_plan?.route || data.route || null,
        catalog_raw_candidate_count: Number(data.catalog_activation_funnel?.raw_candidate_count || data.provider_result?.candidate_control_plane_trace?.catalog_activation_funnel?.raw_candidate_count || 0),
        catalog_approved_candidate_count: Number(data.catalog_activation_funnel?.approved_candidate_count || data.provider_result?.candidate_control_plane_trace?.catalog_activation_funnel?.approved_candidate_count || 0),
        catalog_conflict_blocked_count: Number(data.catalog_activation_funnel?.conflict_blocked_count || data.provider_result?.candidate_control_plane_trace?.catalog_activation_funnel?.conflict_blocked_count || 0),
        catalog_prompt_candidate_count: Number(data.catalog_activation_funnel?.prompt_candidate_count || data.provider_result?.candidate_control_plane_trace?.catalog_activation_funnel?.prompt_candidate_count || 0),
        catalog_evidence_support_field_count: Number(data.catalog_activation_funnel?.evidence_support_field_count || data.provider_result?.candidate_control_plane_trace?.catalog_activation_funnel?.evidence_support_field_count || 0),
        vector_raw_candidate_count: Number(data.vector_activation_funnel?.raw_candidate_count || data.provider_result?.candidate_control_plane_trace?.vector_activation_funnel?.raw_candidate_count || 0),
        vector_approved_candidate_count: Number(data.vector_activation_funnel?.approved_candidate_count || data.provider_result?.candidate_control_plane_trace?.vector_activation_funnel?.approved_candidate_count || 0),
        vector_conflict_blocked_count: Number(data.vector_activation_funnel?.conflict_blocked_count || data.provider_result?.candidate_control_plane_trace?.vector_activation_funnel?.conflict_blocked_count || 0),
        vector_prompt_candidate_count: Number(data.vector_activation_funnel?.prompt_candidate_count || data.provider_result?.candidate_control_plane_trace?.vector_activation_funnel?.prompt_candidate_count || 0),
        vector_evidence_support_field_count: Number(data.vector_activation_funnel?.evidence_support_field_count || data.provider_result?.candidate_control_plane_trace?.vector_activation_funnel?.evidence_support_field_count || 0),
        ...vectorRuntimeFromSummary(
          data.provider_result || {},
          data.provider_result_summary || {},
          data.provider_result?.candidate_control_plane_trace?.vector_activation_funnel || {},
          data.candidate_control_plane_trace?.vector_activation_funnel || {},
          data.vector_activation_funnel || {},
          data
        ),
        preingestion_ocr_rendezvous: data.provider_result?.preingestion_ocr_rendezvous
          || data.provider_result_summary?.preingestion_ocr_rendezvous
          || data.preingestion_ocr_rendezvous
          || null,
        preingestion_evidence_refresh: data.provider_result?.preingestion_evidence_refresh
          || data.provider_result_summary?.preingestion_evidence_refresh
          || data.preingestion_evidence_refresh
          || null,
        serial_numerator_verified: data.provider_result?.serial_numerator_verified
          ?? data.provider_result_summary?.serial_numerator_verified
          ?? data.serial_numerator_verified
          ?? null,
        provider_diagnostics: l1ProviderDiagnostics,
        input_tokens: l1ProviderDiagnostics.input_tokens,
        output_tokens: l1ProviderDiagnostics.output_tokens,
        total_tokens: l1ProviderDiagnostics.total_tokens,
        provider_latency_ms: l1ProviderDiagnostics.provider_latency_ms,
        "x-ratelimit-limit-requests": l1ProviderDiagnostics["x-ratelimit-limit-requests"],
        "x-ratelimit-remaining-requests": l1ProviderDiagnostics["x-ratelimit-remaining-requests"],
        "x-ratelimit-limit-tokens": l1ProviderDiagnostics["x-ratelimit-limit-tokens"],
        "x-ratelimit-remaining-tokens": l1ProviderDiagnostics["x-ratelimit-remaining-tokens"],
        "x-ratelimit-reset-requests": l1ProviderDiagnostics["x-ratelimit-reset-requests"],
        "x-ratelimit-reset-tokens": l1ProviderDiagnostics["x-ratelimit-reset-tokens"]
      },
      candidateDebug: compactCandidateTrace(data.provider_result?.candidate_control_plane_trace || data.candidate_control_plane_trace || {})
    }
    : await pollSessionStatus({
      baseUrl,
      cookie,
      sessionId,
      waitMs: effectiveL2WaitMs,
      requestTimeoutMs: Math.min(requestTimeoutMs, 45000)
    });
  const l1Title = resultTitle(data);
  const l2Title = cleanText(l2.summary?.title || "");
  const finalTitle = l2Title || l1Title;
  const l1Score = scoreTitles(sellerTitle, l1Title);
  const finalScore = scoreTitles(sellerTitle, finalTitle);
  const fastScout = data.provider_result?.fast_scout || {};
  const l2ProviderDiagnostics = objectOrNull(l2.summary?.provider_diagnostics)
    || providerDiagnosticsFromSummary(l2.summary || {});
  const finalProviderDiagnostics = l2ProviderDiagnostics.input_tokens !== null
    || l2ProviderDiagnostics.output_tokens !== null
    || l2ProviderDiagnostics.provider_latency_ms !== null
    ? l2ProviderDiagnostics
    : l1ProviderDiagnostics;
  const cache = cacheStatusFromResponse(data);
  const l1InternalScoutMs = cache.blocking_call_used || cache.cache_hit
    ? (cache.cache_hit
      ? l1.latency_ms
      : (data.module_speed_metrics?.time_to_l1_internal_scout_ms || data.module_speed_metrics?.time_to_l1_safe_draft_ms || l1.latency_ms))
    : null;
  const l1Ok = Boolean(l1.ok && data.ok);
  const l2Terminal = Boolean(l2.ready || l2.review_required);
  const writerReady = Boolean(l2Terminal || cleanText(finalTitle));
  return compactObject({
    asset_id: id,
    sealed_label_key: sealedKey || null,
    seller_title_visible_to_model: false,
    seller_title_used_for_local_eval_only: Boolean(sellerTitle),
    seller_title: sellerTitle,
    image_count: payload.images.length,
    preingestion_used: usePreingestion,
    preingestion_ok: preingestionResult?.ok ?? null,
    preingestion_http_status: preingestionResult?.http_status ?? null,
    preingestion_latency_ms: preingestionResult?.latency_ms ?? null,
    preingestion_bundle_id: preingestionResult?.bundle_id || null,
    preingestion_bundle_status: preingestionResult?.bundle_status || null,
    preingestion_worker_jobs_enqueued: preingestionResult?.worker_jobs_enqueued ?? null,
    preingestion_signed_read_url_count: preingestionResult?.signed_read_url_count ?? null,
    preingestion_signed_read_url_error_count: preingestionResult?.signed_read_url_error_count ?? null,
    preingestion_error: preingestionResult?.error ? JSON.stringify(preingestionResult.error).slice(0, 500) : null,
    http_status: l1.http_status,
    ok: writerReady,
    l1_ok: l1Ok,
    writer_ready: writerReady,
    writer_review_required: l2.review_required === true,
    error: l1.ok ? null : data,
    l1_wall_latency_ms: l1.latency_ms,
    l1_internal_scout_ms: l1InternalScoutMs,
    l1_time_to_safe_draft_ms: cache.blocking_call_used || cache.cache_hit
      ? (cache.cache_hit ? l1.latency_ms : (data.module_speed_metrics?.time_to_l1_safe_draft_ms || null))
      : null,
    cached_fast_scout_source_latency_ms: fastScout.latency_ms ?? data.provider_result?.timing?.fast_scout_latency_ms ?? null,
    route: data.route_plan?.route || null,
    title_stage: data.title_stage || null,
    recognition_session_id: sessionId,
    l1_title: l1Title,
    l2_ready: l2Terminal,
    l2_poll_count: l2.polls,
    l2_poll_elapsed_ms: l2.elapsed_ms ?? null,
    time_to_writer_ready_ms: forceL2Direct
      ? l1.latency_ms
      : (l2Terminal ? l1.latency_ms + Number(l2.elapsed_ms || 0) : null),
    l2_status: l2.summary,
    l2_candidate_debug: l2.candidateDebug || {},
    final_title: finalTitle,
    resolved_fields: l2.summary?.resolved_fields || data.resolved_fields || {},
    field_states: l2.summary?.field_states || data.field_states || {},
    title_length_policy: l2.summary?.title_length_policy || data.provider_result?.title_length_policy || null,
    title_render_source: l2.summary?.title_render_source || data.provider_result?.title_render_source || null,
    l1_return_reason: data.l1_return_reason || null,
    l1_return_barrier_version: data.l1_return_barrier_version || null,
    l1_blocking_modules: data.l1_blocking_modules || data.blocking_modules || [],
    l1_deferred_modules: data.l1_deferred_modules || data.background_modules || [],
    deferred_persistence_status: data.deferred_persistence_status || null,
    l2_background_status: data.l2_background_status || null,
    time_after_l1_spent_on_persistence_ms: data.time_after_l1_spent_on_persistence_ms ?? null,
    fast_scout_cache_hit: cache.cache_hit,
    fast_scout_cache_status: cache.cache_status,
    fast_scout_prewarmer_used: cache.prewarmer_used,
    fast_scout_blocking_call_used: cache.blocking_call_used,
    fast_scout_input_image_count: fastScout.input_image_count || null,
    fast_scout_input_roles: (fastScout.input_images || []).map((image) => image.role).filter(Boolean),
    prewarm_status: prewarmResult?.data?.prewarm_status || null,
    force_l2_direct: forceL2Direct,
    prewarm_latency_ms: prewarmResult?.latency_ms || null,
    prewarm_cache_hit: prewarmResult?.data?.fast_scout_cache_hit ?? null,
    prewarm_cache_status: prewarmResult?.data?.fast_scout_cache_status || null,
    catalog_prompt_candidate_count: Number(data.catalog_activation_funnel?.prompt_candidate_count || 0),
    vector_prompt_candidate_count: Number(data.vector_activation_funnel?.prompt_candidate_count || 0),
    provider_prompt_candidate_count: Number(data.provider_result?.prompt_candidate_count || 0),
    l2_catalog_raw_candidate_count: l2.summary?.catalog_raw_candidate_count ?? null,
    l2_catalog_approved_candidate_count: l2.summary?.catalog_approved_candidate_count ?? null,
    l2_catalog_conflict_blocked_count: l2.summary?.catalog_conflict_blocked_count ?? null,
    l2_catalog_prompt_candidate_count: l2.summary?.catalog_prompt_candidate_count ?? null,
    l2_catalog_evidence_support_field_count: l2.summary?.catalog_evidence_support_field_count ?? null,
    l2_catalog_participation_level: l2.summary?.catalog_participation_level ?? null,
    l2_catalog_pre_observation_query_attempted: l2.summary?.catalog_pre_observation_query_attempted ?? null,
    l2_catalog_post_observation_query_attempted: l2.summary?.catalog_post_observation_query_attempted ?? null,
    l2_vector_raw_candidate_count: l2.summary?.vector_raw_candidate_count ?? null,
    l2_vector_approved_candidate_count: l2.summary?.vector_approved_candidate_count ?? null,
    l2_vector_conflict_blocked_count: l2.summary?.vector_conflict_blocked_count ?? null,
    l2_vector_prompt_candidate_count: l2.summary?.vector_prompt_candidate_count ?? null,
    l2_vector_evidence_support_field_count: l2.summary?.vector_evidence_support_field_count ?? null,
    l2_vector_participation_level: l2.summary?.vector_participation_level ?? null,
    l2_vector_pre_observation_query_attempted: l2.summary?.vector_pre_observation_query_attempted ?? null,
    l2_vector_post_observation_query_attempted: l2.summary?.vector_post_observation_query_attempted ?? null,
    vector_runtime_status: l2.summary?.vector_runtime_status ?? null,
    vector_runtime_status_code: l2.summary?.vector_runtime_status_code ?? null,
    vector_runtime_unavailable_reasons: l2.summary?.vector_runtime_unavailable_reasons ?? null,
    vector_worker_status: l2.summary?.vector_worker_status ?? null,
    vector_worker_reason: l2.summary?.vector_worker_reason ?? null,
    vector_worker_feature_count: l2.summary?.vector_worker_feature_count ?? null,
    vector_worker_latency_ms: l2.summary?.vector_worker_latency_ms ?? null,
    vector_worker_attempt_count: l2.summary?.vector_worker_attempt_count ?? null,
    catalog_stage_capacity: l2.summary?.catalog_stage_capacity || null,
    vector_stage_capacity: l2.summary?.vector_stage_capacity || null,
    vector_query_embedding_role: l2.summary?.vector_query_embedding_role ?? null,
    vector_role_agnostic_fallback_used: l2.summary?.vector_role_agnostic_fallback_used ?? null,
    vector_role_agnostic_fallback_reason: l2.summary?.vector_role_agnostic_fallback_reason ?? null,
    vector_returned_row_count: l2.summary?.vector_returned_row_count ?? null,
    vector_self_excluded_count: l2.summary?.vector_self_excluded_count ?? null,
    vector_self_exclusion_query_attempted: l2.summary?.vector_self_exclusion_query_attempted === true,
    vector_self_exclusion_filter_active: l2.summary?.vector_self_exclusion_filter_active === true,
    vector_self_exclusion_requested_source_count: l2.summary?.vector_self_exclusion_requested_source_count ?? null,
    vector_self_exclusion_source_ids_sha256: l2.summary?.vector_self_exclusion_source_ids_sha256 ?? null,
    preingestion_ocr_rendezvous: l2.summary?.preingestion_ocr_rendezvous || null,
    preingestion_evidence_refresh: l2.summary?.preingestion_evidence_refresh || null,
    serial_numerator_verified: l2.summary?.serial_numerator_verified ?? null,
    pipeline_node_ledger: l2.summary?.pipeline_node_ledger || null,
    noncritical_persistence_status: l2.summary?.noncritical_persistence_status || null,
    noncritical_persistence_summary: l2.summary?.noncritical_persistence_summary || null,
    provider_diagnostics: finalProviderDiagnostics,
    identity_cache_hit: l2.summary?.identity_cache_hit === true,
    identity_cache_read_bypassed: l2.summary?.identity_cache_read_bypassed === true,
    identity_cache_write_reason: l2.summary?.identity_cache_write_reason || null,
    l1_provider_diagnostics: l1ProviderDiagnostics,
    l2_provider_diagnostics: l2ProviderDiagnostics,
    v4_l2_timing: l2.summary?.v4_l2_timing || null,
    v4_pipeline_contract: l2.summary?.v4_pipeline_contract || null,
    input_tokens: finalProviderDiagnostics.input_tokens,
    output_tokens: finalProviderDiagnostics.output_tokens,
    total_tokens: finalProviderDiagnostics.total_tokens,
    provider_latency_ms: finalProviderDiagnostics.provider_latency_ms,
    response_status: finalProviderDiagnostics.response_status,
    incomplete_reason: finalProviderDiagnostics.incomplete_reason,
    output_cap: finalProviderDiagnostics.output_cap,
    output_utilization: finalProviderDiagnostics.output_utilization,
    "x-ratelimit-limit-requests": finalProviderDiagnostics["x-ratelimit-limit-requests"],
    "x-ratelimit-remaining-requests": finalProviderDiagnostics["x-ratelimit-remaining-requests"],
    "x-ratelimit-limit-tokens": finalProviderDiagnostics["x-ratelimit-limit-tokens"],
    "x-ratelimit-remaining-tokens": finalProviderDiagnostics["x-ratelimit-remaining-tokens"],
    "x-ratelimit-reset-requests": finalProviderDiagnostics["x-ratelimit-reset-requests"],
    "x-ratelimit-reset-tokens": finalProviderDiagnostics["x-ratelimit-reset-tokens"],
    l1_scoring: l1Score,
    final_scoring: finalScore,
    item_web_url: null
  });
}

async function enqueueSpeculativeItem({
  item,
  index,
  batchId,
  tenantId,
  baseUrl,
  cookie,
  prewarm,
  prewarmCacheOnly,
  modelOverride,
  enableL1,
  compactL2,
  ultraFastL2,
  fastInitialPrompt,
  ultraSparseTransport,
  providerDoneHandoff,
  ultraFastImageDetail,
  ultraFastServiceTier,
  disableIdentityCache,
  coldStartBlind,
  usePreingestion,
  preingestionSource,
  requestTimeoutMs,
  verificationCache,
  sourceFingerprint = "",
  cachedAssetEntry = null,
  enqueueGate = async (task) => task()
}) {
  const sourceAssetId = candidateId(item, index);
  let id = sourceAssetId;
  let preparedItem = null;
  const startedAt = Date.now();
  try {
    preparedItem = await prepareDurableSmokeItem({
      item,
      index,
      baseUrl,
      cookie,
      requestTimeoutMs: Math.min(requestTimeoutMs, 45000),
      sourceFingerprint,
      cachedAssetEntry
    });
    id = preparedItem.asset.asset_id;
    const runtimeItem = preparedItem.item;
    const images = preparedItem.images;
    const payload = payloadForItem(runtimeItem, index, images, {
      modelOverride,
      enableL1,
      compactL2,
      ultraFastL2,
      fastInitialPrompt,
      ultraSparseTransport,
      providerDoneHandoff,
      ultraFastImageDetail,
      ultraFastServiceTier,
      disableIdentityCache,
      coldStartBlind
    });
    const prewarmPromise = prewarm
      ? postJson({
        baseUrl,
        path: "/api/v4/fast-scout-prewarm",
        cookie,
        payload: { ...payload, v4_fast_scout_cache_only: prewarmCacheOnly },
        requestTimeoutMs
      }).catch((error) => ({
        ok: false,
        http_status: null,
        latency_ms: null,
        data: { ok: false, prewarm_status: "REQUEST_FAILED", message: cleanText(error?.message).slice(0, 240) }
      }))
      : Promise.resolve(null);

    let preingestionResult = null;
    if (usePreingestion) {
      try {
        preingestionResult = await preingestItem({
          baseUrl,
          cookie,
          assetId: id,
          images,
          source: preingestionSource,
          requestTimeoutMs: Math.min(requestTimeoutMs, 45000)
        });
        if (preingestionResult.ok && preingestionResult.bundle_id) {
          payload.preingestion_bundle_id = preingestionResult.bundle_id;
          payload.preingestionBundleId = preingestionResult.bundle_id;
          payload.preingestion_bundle_status = preingestionResult.bundle_status;
          payload.preingestion_summary = preingestionResult.preprocessing_summary;
        }
      } catch (error) {
        preingestionResult = {
          ok: false,
          bundle_status: "preingestion_request_failed",
          error: { message: cleanText(error?.message || error).slice(0, 240) }
        };
      }
    }
    const prewarmResult = await prewarmPromise;
    const queuedPayload = {
      ...payload,
      force_l2_only: !enableL1,
      create_l1_job: enableL1,
      create_l2_job: true,
      disable_fast_scout_l1: !enableL1,
      v4_force_l2_direct: !enableL1,
      client_speculative: true
    };
    const enqueueStartedAt = Date.now();
    const enqueue = await enqueueGate(() => postJson({
      baseUrl,
      path: "/api/v4/listing-job-enqueue",
      cookie,
      payload: {
        batch_id: batchId,
        tenant_id: tenantId || batchId,
        priority: 100,
        jobs: [{
          asset_id: id,
          image_generation_id: payload.image_generation_id,
          force_l2_only: !enableL1,
          create_l1_job: enableL1,
          create_l2_job: true,
          payload: queuedPayload
        }]
      },
      requestTimeoutMs: Math.min(requestTimeoutMs, 45000),
      maxAttempts: 5
    }));
    const job = (enqueue.data?.jobs || []).find((entry) => entry?.ok && entry.job_type === "FINAL_ASSISTED_TITLE")
      || (enqueue.data?.jobs || []).find((entry) => entry?.ok)
      || {};
    const l1Job = (enqueue.data?.jobs || []).find((entry) => entry?.ok && entry.job_type === "FAST_SCOUT_DRAFT") || null;
    if (!enqueue.ok || !job.job_id) {
      const queueEntryError = (enqueue.data?.jobs || []).find((entry) => entry?.error)?.error || "";
      throw new Error(`queue_enqueue_failed:${enqueue.http_status}:${cleanText(enqueue.data?.message || enqueue.data?.error || queueEntryError).slice(0, 160)}`);
    }
    const canonicalBatchId = cleanText(enqueue.data?.batch_id) || batchId;
    return {
      asset_id: id,
      source_asset_id: sourceAssetId,
      source_feedback_id: runtimeItem.source_feedback_id || null,
      index,
      item,
      batch_id: canonicalBatchId,
      client_batch_token: batchId,
      tenant_id: cleanText(job.tenant_id) || tenantId || batchId,
      client_tenant_label: tenantId || batchId,
      job,
      l1_job: l1Job,
      enqueue,
      enqueue_latency_ms: Date.now() - enqueueStartedAt,
      preparation_latency_ms: Date.now() - startedAt,
      preparation_diagnostics: preparedItem.preparation_diagnostics || null,
      asset_cache_entry: preparedItem.asset_cache_entry || null,
      enqueue_attempts: Number(enqueue.attempts || 1),
      enqueue_recovered_by_retry: enqueue.retried === true,
      preingestion: preingestionResult,
      prewarm: prewarmResult,
      error: null
    };
  } catch (error) {
    return {
      asset_id: id,
      source_asset_id: sourceAssetId,
      source_feedback_id: item.source_feedback_id || item.source_record_id || null,
      index,
      item,
      batch_id: batchId,
      tenant_id: tenantId || batchId,
      job: null,
      enqueue: null,
      enqueue_latency_ms: null,
      preparation_latency_ms: Date.now() - startedAt,
      preparation_diagnostics: preparedItem?.preparation_diagnostics || null,
      asset_cache_entry: preparedItem?.asset_cache_entry || null,
      enqueue_attempts: null,
      enqueue_recovered_by_retry: false,
      preingestion: null,
      prewarm: null,
      error: cleanText(error?.message || error || "batch_enqueue_failed").slice(0, 240)
    };
  }
}

export function canonicalBatchIdForPoll(prepared = [], fallbackBatchId = "") {
  const canonicalIds = [...new Set((Array.isArray(prepared) ? prepared : [])
    .filter((row) => Boolean(row?.job?.job_id))
    .map((row) => cleanText(row?.batch_id))
    .filter(Boolean))];
  // Streaming enqueue intentionally creates one deterministic server batch per
  // asset. A shared batch id is only available when the server received all
  // cards atomically; otherwise the status endpoint is queried by job ids.
  if (canonicalIds.length > 1) return null;
  return canonicalIds[0] || cleanText(fallbackBatchId);
}

async function pollBatchJobs({
  baseUrl,
  cookie,
  batchId,
  expectedJobIds = [],
  waitMs,
  requestTimeoutMs,
  progress = false
}) {
  const expected = new Set(expectedJobIds.filter(Boolean));
  const jobsById = new Map();
  const startedAt = Date.now();
  let polls = 0;
  let last = null;
  let fatalError = null;
  let lastError = null;
  let transientErrorCount = 0;
  let consecutiveErrors = 0;
  let maxConsecutiveErrors = 0;
  const httpStatusBreakdown = {};
  let writerReadyAt = null;
  while (Date.now() - startedAt <= waitMs) {
    polls += 1;
    try {
      last = await getJson({
        baseUrl,
        path: batchId
          ? `/api/v4/listing-job-status?batch_id=${encodeURIComponent(batchId)}&limit=200`
          : `/api/v4/listing-job-status?job_ids=${encodeURIComponent([...expected].join(","))}&limit=200`,
        cookie,
        requestTimeoutMs: Math.min(requestTimeoutMs, 45000)
      });
    } catch (error) {
      lastError = serializableError(error, "batch_status_request_failed");
      transientErrorCount += 1;
      consecutiveErrors += 1;
      maxConsecutiveErrors = Math.max(maxConsecutiveErrors, consecutiveErrors);
      await delay(1500);
      continue;
    }
    const httpStatus = String(last.http_status ?? "unknown");
    httpStatusBreakdown[httpStatus] = (httpStatusBreakdown[httpStatus] || 0) + 1;
    if (!last.ok) {
      consecutiveErrors += 1;
      maxConsecutiveErrors = Math.max(maxConsecutiveErrors, consecutiveErrors);
      lastError = serializableError(last.data, `batch_status_http_${last.http_status || "unknown"}`);
      const disposition = batchStatusResponseDisposition(last);
      if (disposition === "fatal") {
        fatalError = `batch_status_http_${last.http_status || "unknown"}:${lastError}`;
        break;
      }
      transientErrorCount += 1;
      await delay(1500);
      continue;
    } else {
      consecutiveErrors = 0;
      lastError = null;
    }
    for (const job of last.data?.jobs || []) {
      if (job?.job_id) jobsById.set(job.job_id, job);
    }
    const completedCount = [...expected].filter((jobId) => {
      const job = jobsById.get(jobId);
      return job && (job.status === "L2_READY" || terminalJobStatus(job.status) || job.display_status === "FINAL_READY");
    }).length;
    const writerReadyComplete = completedCount === expected.size;
    if (progress && (polls === 1 || polls % 20 === 0 || writerReadyComplete)) {
      process.stderr.write(
        `v4 ebay smoke batch poll ready=${completedCount}/${expected.size} polls=${polls} elapsed=${Date.now() - startedAt}ms\n`
      );
    }
    if (writerReadyComplete && writerReadyAt === null) writerReadyAt = Date.now();
    const persistenceComplete = writerReadyComplete && [...expected].every((jobId) => persistenceTerminalForJob(jobsById.get(jobId)));
    if (persistenceComplete || (writerReadyAt !== null && Date.now() - writerReadyAt >= 8_000)) break;
    const elapsed = Date.now() - startedAt;
    await delay(elapsed < 30_000 ? 800 : elapsed < 180_000 ? 1500 : 2500);
  }
  return {
    jobsById,
    polls,
    elapsed_ms: Date.now() - startedAt,
    completed_count: [...expected].filter((jobId) => {
      const job = jobsById.get(jobId);
      return job && (job.status === "L2_READY" || terminalJobStatus(job.status) || job.display_status === "FINAL_READY");
    }).length,
    expected_count: expected.size,
    http_status_breakdown: httpStatusBreakdown,
    max_consecutive_errors: maxConsecutiveErrors,
    transient_error_count: transientErrorCount,
    last_error: lastError,
    fatal_error: fatalError,
    last
  };
}

async function loadExistingBatchJobs({
  baseUrl,
  cookie,
  batchId,
  requestTimeoutMs,
  attempts = 6
}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response;
    try {
      response = await getJson({
        baseUrl,
        path: `/api/v4/listing-job-status?batch_id=${encodeURIComponent(batchId)}&limit=200`,
        cookie,
        requestTimeoutMs: Math.min(requestTimeoutMs, 45000)
      });
    } catch (error) {
      lastError = serializableError(error, "resume_batch_status_request_failed");
      await delay(Math.min(3000, 500 * attempt));
      continue;
    }
    if (response.ok) return response.data?.jobs || [];
    lastError = serializableError(response.data, `resume_batch_status_http_${response.http_status || "unknown"}`);
    if (batchStatusResponseDisposition(response) === "fatal") break;
    await delay(Math.min(3000, 500 * attempt));
  }
  throw new Error(`resume_batch_unavailable:${lastError || batchId}`);
}

export function resultFromBatchJob(prepared = {}, batchPoll = {}, thinkMs = 0) {
  if (prepared.error || !prepared.job?.job_id) {
    return {
      asset_id: prepared.asset_id,
      source_asset_id: prepared.source_asset_id || null,
      source_feedback_id: prepared.source_feedback_id || prepared.item?.source_feedback_id || null,
      expected_tenant_id: prepared.tenant_id || null,
      observed_tenant_id: null,
      tenant_isolation_measured: false,
      tenant_isolation_valid: null,
      ok: false,
      writer_ready: false,
      error: prepared.error || "missing_final_job",
      final_title: "",
      l1_title: "",
      queue_mode: true,
      speculative_mode: true,
      batch_poll_mode: true,
      preparation_latency_ms: prepared.preparation_latency_ms ?? null,
      enqueue_latency_ms: prepared.enqueue_latency_ms ?? null,
      preparation_diagnostics: prepared.preparation_diagnostics || null,
      preparation_cache_hit: prepared.preparation_diagnostics?.asset_cache_hit === true,
      upload_skipped_due_to_verified_asset_cache: prepared.preparation_diagnostics?.upload_skipped_due_to_verified_asset_cache === true,
      enqueue_attempts: prepared.enqueue_attempts ?? null,
      enqueue_recovered_by_retry: prepared.enqueue_recovered_by_retry === true
    };
  }
  const jobRow = batchPoll.jobsById.get(prepared.job.job_id) || null;
  const l1JobRow = prepared.l1_job?.job_id
    ? batchPoll.jobsById.get(prepared.l1_job.job_id) || null
    : null;
  const summary = jobL2Summary({ jobs: jobRow ? [jobRow] : [] });
  const expectedTenantId = cleanText(prepared.tenant_id);
  const observedTenantId = cleanText(jobRow?.tenant_id);
  const tenantIsolationMeasured = Boolean(expectedTenantId && observedTenantId);
  const providerDiagnostics = objectOrNull(summary.provider_diagnostics)
    || providerDiagnosticsFromSummary(summary);
  const finalTitle = cleanText(summary.title || "");
  const titleReady = summaryHasVisibleL2Title(summary);
  const writerReviewRequired = summaryRequiresWriterReview(summary);
  const ready = titleReady || writerReviewRequired;
  const timeToReady = numberOrNull(summary.time_to_l2_ready_ms);
  const preL2AnchorFastLaneHit = summary.v4_l2_timing?.pre_l2_full_l2_skipped === true;
  const exactScoutFastLaneHit = (
    summary.v4_l2_timing?.exact_anchor_scout_status === "CACHE_HIT"
    && Number(summary.v4_l2_timing?.exact_anchor_finalize_ms || 0) > 0
    && Number(summary.worker_processing_ms || 0) < 5000
  );
  const fastLaneHit = preL2AnchorFastLaneHit || exactScoutFastLaneHit;
  const preingestion = prepared.preingestion || {};
  const prewarm = prepared.prewarm || {};
  return compactObject({
    asset_id: prepared.asset_id,
    source_asset_id: prepared.source_asset_id || null,
    source_feedback_id: prepared.source_feedback_id || prepared.item?.source_feedback_id || null,
    sealed_label_key: prepared.item?.sealed_eval_label_ref?.key || null,
    seller_title_visible_to_model: false,
    seller_title_used_for_local_eval_only: false,
    seller_title: "",
    image_count: itemImages(prepared.item).length,
    preingestion_used: Boolean(prepared.preingestion),
    preingestion_ok: preingestion.ok ?? null,
    preingestion_http_status: preingestion.http_status ?? null,
    preingestion_latency_ms: preingestion.latency_ms ?? null,
    preingestion_bundle_id: preingestion.bundle_id || null,
    preingestion_bundle_status: preingestion.bundle_status || null,
    preingestion_worker_jobs_enqueued: preingestion.worker_jobs_enqueued ?? null,
    preingestion_error: preingestion.error ? JSON.stringify(preingestion.error).slice(0, 500) : null,
    queue_mode: true,
    speculative_mode: true,
    batch_poll_mode: true,
    batch_id: prepared.batch_id,
    tenant_id: prepared.tenant_id || jobRow?.tenant_id || null,
    expected_tenant_id: expectedTenantId || null,
    observed_tenant_id: observedTenantId || null,
    tenant_isolation_measured: tenantIsolationMeasured,
    tenant_isolation_valid: tenantIsolationMeasured ? expectedTenantId === observedTenantId : null,
    job_id: prepared.job.job_id,
    recognition_session_id: prepared.job.recognition_session_id || summary.recognition_session_id || null,
    job_created_at: summary.job_created_at || null,
    job_started_at: summary.job_started_at || null,
    job_completed_at: summary.job_completed_at || null,
    http_status: prepared.enqueue?.http_status ?? null,
    ok: ready,
    l1_ok: l1JobRow ? l1JobRow.status === "L1_READY" : null,
    l1_job_id: prepared.l1_job?.job_id || null,
    l1_job_status: l1JobRow?.status || null,
    writer_ready: ready,
    writer_review_required: writerReviewRequired,
    error: ready
      ? null
      : serializableError(jobRow?.error || batchPoll.fatal_error || batchPoll.last_error || summary.job_status, "batch_poll_timeout"),
    preparation_latency_ms: prepared.preparation_latency_ms ?? null,
    enqueue_latency_ms: prepared.enqueue_latency_ms ?? null,
    preparation_diagnostics: prepared.preparation_diagnostics || null,
    preparation_cache_hit: prepared.preparation_diagnostics?.asset_cache_hit === true,
    upload_skipped_due_to_verified_asset_cache: prepared.preparation_diagnostics?.upload_skipped_due_to_verified_asset_cache === true,
    preparation_recovered_by_retry: prepared.preparation_diagnostics?.recovered_by_retry === true,
    enqueue_attempts: prepared.enqueue_attempts ?? null,
    enqueue_recovered_by_retry: prepared.enqueue_recovered_by_retry === true,
    enqueue_persistence_mode: prepared.enqueue?.data?.persistence_mode || null,
    l1_wall_latency_ms: prewarm.latency_ms ?? null,
    l2_ready: ready,
    l2_poll_count: batchPoll.polls,
    l2_poll_elapsed_ms: batchPoll.elapsed_ms,
    time_to_writer_ready_ms: timeToReady,
    perceived_title_ms: timeToReady === null ? undefined : Math.max(0, timeToReady - Math.max(0, thinkMs)),
    l2_done_before_click: timeToReady !== null ? timeToReady <= Math.max(0, thinkMs) : false,
    worker_queue_wait_ms: summary.worker_queue_wait_ms ?? null,
    paired_l1_wait_ms: summary.paired_l1_wait_ms ?? null,
    scheduler_queue_wait_ms: summary.scheduler_queue_wait_ms ?? null,
    recognition_started_at: summary.recognition_started_at || null,
    recognition_start_source: summary.recognition_start_source || summary.timing?.recognition_start_source || null,
    writer_visible_recognition_ms: summary.timing?.writer_visible_recognition_ms
      ?? summary.writer_visible_recognition_ms
      ?? null,
    worker_processing_ms: summary.worker_processing_ms ?? null,
    time_to_l2_ready_ms: timeToReady,
    writer_ready_capacity_release: summary.writer_ready_capacity_release || null,
    writer_ready_capacity_refill: summary.writer_ready_capacity_refill
      || summary.writer_ready_capacity_release?.refill
      || null,
    writer_ready_capacity_release_mode: summary.writer_ready_capacity_release_mode || null,
    provider_capacity_stage_handoff: summary.provider_capacity_stage_handoff || null,
    provider_capacity_slot: summary.provider_capacity_slot ?? null,
    provider_key_slot: summary.provider_key_slot ?? null,
    provider_capacity: summary.provider_capacity ?? null,
    provider_key_count: summary.provider_key_count ?? null,
    provider_key_assignment: summary.provider_key_assignment || null,
    l2_status: summary,
    l2_candidate_debug: compactCandidateTrace(jobRow?.session?.candidate_control_plane_trace || {}),
    final_title: finalTitle,
    resolved_fields: summary.resolved_fields || {},
    field_states: summary.field_states || {},
    title_length_policy: summary.title_length_policy || null,
    title_render_source: summary.title_render_source || null,
    pre_l2_anchor_fast_lane_hit: preL2AnchorFastLaneHit,
    pre_l2_anchor_route: summary.v4_l2_timing?.pre_l2_anchor_route || null,
    pre_l2_anchor_finalize_reason: summary.v4_l2_timing?.pre_l2_anchor_finalize_reason || null,
    pre_l2_anchor_probe_ms: summary.v4_l2_timing?.pre_l2_anchor_probe_ms ?? null,
    pre_l2_anchor_patch_count: summary.v4_l2_timing?.pre_l2_anchor_patch_count ?? null,
    pre_l2_anchor_candidate_count: summary.v4_l2_timing?.pre_l2_anchor_candidate_count ?? null,
    pre_l2_anchor_direct_candidate_count: summary.v4_l2_timing?.pre_l2_anchor_direct_candidate_count ?? null,
    pre_l2_anchor_type_breakdown: summary.v4_l2_timing?.pre_l2_anchor_type_breakdown || {},
    pre_l2_anchor_lookup_attempted: summary.v4_l2_timing?.pre_l2_anchor_lookup_attempted === true,
    pre_l2_anchor_catalog_candidate_count: summary.v4_l2_timing?.pre_l2_anchor_catalog_candidate_count ?? null,
    pre_l2_anchor_trusted_candidate_count: summary.v4_l2_timing?.pre_l2_anchor_trusted_candidate_count ?? null,
    pre_l2_anchor_eligible_candidate_count: summary.v4_l2_timing?.pre_l2_anchor_eligible_candidate_count ?? null,
    l1_title: "",
    route: summary.route || null,
    title_stage: preL2AnchorFastLaneHit
      ? "PRE_L2_ANCHOR_FINALIZED"
      : exactScoutFastLaneHit
        ? "SPEC_L2_EXACT_ANCHOR"
        : "V4_QUEUE_L2",
    speculative_l1_fast_lane_hit: fastLaneHit,
    fast_scout_cache_hit: exactScoutFastLaneHit,
    fast_scout_cache_status: summary.v4_l2_timing?.exact_anchor_scout_status || null,
    fast_scout_prewarmer_used: prewarm.data?.ok === true,
    fast_scout_blocking_call_used: false,
    prewarm_status: prewarm.data?.prewarm_status || null,
    prewarm_http_status: prewarm.http_status ?? null,
    prewarm_latency_ms: prewarm.latency_ms ?? null,
    l2_catalog_raw_candidate_count: summary.catalog_raw_candidate_count ?? null,
    l2_catalog_approved_candidate_count: summary.catalog_approved_candidate_count ?? null,
    l2_catalog_conflict_blocked_count: summary.catalog_conflict_blocked_count ?? null,
    l2_catalog_prompt_candidate_count: summary.catalog_prompt_candidate_count ?? null,
    l2_catalog_evidence_support_field_count: summary.catalog_evidence_support_field_count ?? null,
    l2_catalog_participation_level: summary.catalog_participation_level ?? null,
    l2_vector_raw_candidate_count: summary.vector_raw_candidate_count ?? null,
    l2_vector_approved_candidate_count: summary.vector_approved_candidate_count ?? null,
    l2_vector_conflict_blocked_count: summary.vector_conflict_blocked_count ?? null,
    l2_vector_prompt_candidate_count: summary.vector_prompt_candidate_count ?? null,
    l2_vector_evidence_support_field_count: summary.vector_evidence_support_field_count ?? null,
    l2_vector_participation_level: summary.vector_participation_level ?? null,
    vector_runtime_status: summary.vector_runtime_status ?? null,
    vector_runtime_status_code: summary.vector_runtime_status_code ?? null,
    vector_runtime_unavailable_reasons: summary.vector_runtime_unavailable_reasons ?? null,
    vector_worker_status: summary.vector_worker_status ?? null,
    vector_worker_reason: summary.vector_worker_reason ?? null,
    vector_worker_feature_count: summary.vector_worker_feature_count ?? null,
    vector_worker_latency_ms: summary.vector_worker_latency_ms ?? null,
    vector_worker_attempt_count: summary.vector_worker_attempt_count ?? null,
    vector_query_embedding_role: summary.vector_query_embedding_role ?? null,
    vector_role_agnostic_fallback_used: summary.vector_role_agnostic_fallback_used ?? null,
    vector_role_agnostic_fallback_reason: summary.vector_role_agnostic_fallback_reason ?? null,
    vector_returned_row_count: summary.vector_returned_row_count ?? null,
    vector_self_excluded_count: summary.vector_self_excluded_count ?? null,
    vector_self_exclusion_query_attempted: summary.vector_self_exclusion_query_attempted === true,
    vector_self_exclusion_filter_active: summary.vector_self_exclusion_filter_active === true,
    vector_self_exclusion_requested_source_count: summary.vector_self_exclusion_requested_source_count ?? null,
    vector_self_exclusion_source_ids_sha256: summary.vector_self_exclusion_source_ids_sha256 ?? null,
    catalog_stage_capacity: summary.catalog_stage_capacity || null,
    vector_stage_capacity: summary.vector_stage_capacity || null,
    preingestion_ocr_rendezvous: summary.preingestion_ocr_rendezvous || null,
    preingestion_evidence_refresh: summary.preingestion_evidence_refresh || null,
    preingestion_retrieval_refresh: summary.preingestion_retrieval_refresh || null,
    preingestion_retrieval_anchor_fields: summary.preingestion_retrieval_anchor_fields || [],
    serial_numerator_verified: summary.serial_numerator_verified ?? null,
    pipeline_node_ledger: summary.pipeline_node_ledger || null,
    noncritical_persistence_status: summary.noncritical_persistence_status || null,
    noncritical_persistence_summary: summary.noncritical_persistence_summary || null,
    provider_diagnostics: providerDiagnostics,
    provider_response_profile: providerDiagnostics.provider_response_profile || summary.provider_response_profile || null,
    provider_prompt_mode: providerDiagnostics.provider_prompt_mode || summary.provider_prompt_mode || null,
    provider_prompt_chars: providerDiagnostics.provider_prompt_chars ?? summary.provider_prompt_chars ?? null,
    provider_image_detail: summary.provider_image_detail || null,
    provider_text_verbosity: summary.provider_text_verbosity || null,
    provider_requested_service_tier: summary.provider_requested_service_tier || null,
    provider_service_tier: summary.provider_service_tier || null,
    identity_cache_hit: summary.identity_cache_hit === true,
    identity_cache_read_bypassed: summary.identity_cache_read_bypassed === true,
    identity_cache_write_reason: summary.identity_cache_write_reason || null,
    v4_l2_timing: summary.v4_l2_timing || null,
    v4_pipeline_contract: summary.v4_pipeline_contract || null,
    strategy_replay_trace: summary.strategy_replay_trace || null,
    input_tokens: providerDiagnostics.input_tokens,
    output_tokens: providerDiagnostics.output_tokens,
    total_tokens: providerDiagnostics.total_tokens,
    provider_latency_ms: providerDiagnostics.provider_latency_ms,
    provider_key_pool_size: providerDiagnostics.provider_key_pool_size,
    provider_key_slot: providerDiagnostics.provider_key_slot,
    provider_key_source: providerDiagnostics.provider_key_source,
    provider_key_rotation_attempted: providerDiagnostics.provider_key_rotation_attempted,
    provider_key_rotation_attempts: providerDiagnostics.provider_key_rotation_attempts,
    attempt_count: jobRow?.attempt_count ?? null,
    job_status: jobRow?.status || null,
    response_status: providerDiagnostics.response_status,
    incomplete_reason: providerDiagnostics.incomplete_reason,
    output_cap: providerDiagnostics.output_cap,
    output_utilization: providerDiagnostics.output_utilization,
    "x-ratelimit-limit-requests": providerDiagnostics["x-ratelimit-limit-requests"],
    "x-ratelimit-remaining-requests": providerDiagnostics["x-ratelimit-remaining-requests"],
    "x-ratelimit-limit-tokens": providerDiagnostics["x-ratelimit-limit-tokens"],
    "x-ratelimit-remaining-tokens": providerDiagnostics["x-ratelimit-remaining-tokens"],
    "x-ratelimit-reset-requests": providerDiagnostics["x-ratelimit-reset-requests"],
    "x-ratelimit-reset-tokens": providerDiagnostics["x-ratelimit-reset-tokens"]
  });
}

function predictionHash(results = []) {
  const frozen = results.map((row) => ({
    asset_id: row.asset_id || null,
    recognition_session_id: row.recognition_session_id || null,
    final_title: cleanText(row.final_title),
    ok: row.ok === true,
    error: row.error || null
  }));
  return crypto.createHash("sha256").update(JSON.stringify(frozen)).digest("hex");
}

function sealedLabelForItem(item = {}, index = 0, sealedLabels = new Map()) {
  const id = candidateId(item, index);
  const sealedKey = item.sealed_eval_label_ref?.key || "";
  return sealedLabels.get(sealedKey)
    || sealedLabels.get(id.replace(/^ebay_image_only_/, ""))
    || sealedLabels.get(item.source_record?.case_id)
    || null;
}

export function attachPostRecognitionScoring(results = [], items = [], sealedLabels = new Map(), offset = 0) {
  return results.map((row, localIndex) => {
    const item = items[localIndex] || {};
    const label = sealedLabelForItem(item, offset + localIndex, sealedLabels) || {};
    const sellerTitle = cleanText(label.title || "");
    const reviewedTitle = cleanText(label.reviewed_title || label.corrected_title || "");
    const reviewedTitleGroundTruth = Boolean(
      reviewedTitle
      && label.policy?.reviewed_title_is_ground_truth === true
      && label.policy?.model_prompt_visible !== true
    );
    const referenceTitle = reviewedTitle || sellerTitle;
    const referenceTitleType = reviewedTitleGroundTruth
      ? "REVIEWED_INTERNAL_TITLE"
      : sellerTitle
        ? "MARKETPLACE_WEAK_LABEL"
        : "NONE";
    return {
      ...row,
      sealed_label_key: item.sealed_eval_label_ref?.key || label.key || row.sealed_label_key || null,
      seller_title_used_for_local_eval_only: Boolean(sellerTitle),
      seller_title: sellerTitle,
      reviewed_title_used_for_local_eval_only: Boolean(reviewedTitle),
      reviewed_title: reviewedTitle,
      reference_title: referenceTitle,
      reference_title_type: referenceTitleType,
      reference_title_is_reviewed_ground_truth: reviewedTitleGroundTruth,
      l1_scoring: scoreTitles(referenceTitle, row.l1_title || ""),
      final_scoring: scoreTitles(referenceTitle, row.final_title || ""),
      item_web_url: label.item_web_url || null
    };
  });
}

export function summarizePipelineNodeLedgers(results = []) {
  const rows = results.filter((item) => item.pipeline_node_ledger && typeof item.pipeline_node_ledger === "object");
  const fieldQualityCheckIds = new Set([
    "critical_field_flow_has_no_silent_drop",
    "terminal_critical_field_flow_has_no_silent_drop",
    "field_flow_has_no_cross_bracket_composite_migration",
    "v4_normal_field_state_has_canonical_value",
    "resolved_grade_score_has_company",
    "direct_grade_company_reaches_resolution",
    "direct_card_grade_reaches_resolution",
    "resolved_grade_is_rendered"
  ]);
  const allAnomalies = rows.flatMap((item) => (
    Array.isArray(item.pipeline_node_ledger.reconciliation?.anomalies)
      ? item.pipeline_node_ledger.reconciliation.anomalies
      : []
  ));
  const errorAnomalies = allAnomalies.filter((anomaly) => cleanText(anomaly?.severity).toUpperCase() === "ERROR");
  const declaredErrorCount = rows.reduce(
    (sum, item) => sum + Number(item.pipeline_node_ledger.reconciliation?.error_count || 0),
    0
  );
  const unclassifiedErrorCount = Math.max(0, declaredErrorCount - errorAnomalies.length);
  const fieldQualityErrorCount = errorAnomalies.filter((anomaly) => fieldQualityCheckIds.has(cleanText(anomaly?.check_id))).length;
  const transportErrorCount = errorAnomalies.length - fieldQualityErrorCount + unclassifiedErrorCount;
  const nodeMap = new Map();
  for (const item of rows) {
    for (const node of Array.isArray(item.pipeline_node_ledger.nodes) ? item.pipeline_node_ledger.nodes : []) {
      const nodeId = cleanText(node.node_id) || "unknown";
      const aggregate = nodeMap.get(nodeId) || {
        node_id: nodeId,
        card_count: 0,
        expected_count: 0,
        duration_values: [],
        input_count_total: 0,
        output_count_total: 0,
        status_breakdown: {}
      };
      aggregate.card_count += 1;
      if (node.expected === true) aggregate.expected_count += 1;
      if (Number.isFinite(Number(node.duration_ms))) aggregate.duration_values.push(Number(node.duration_ms));
      aggregate.input_count_total += Number(node.input_count || 0);
      aggregate.output_count_total += Number(node.output_count || 0);
      const status = cleanText(node.status).toUpperCase() || "UNKNOWN";
      aggregate.status_breakdown[status] = (aggregate.status_breakdown[status] || 0) + 1;
      nodeMap.set(nodeId, aggregate);
    }
  }
  const nodeMetrics = [...nodeMap.values()].map((item) => ({
    node_id: item.node_id,
    card_count: item.card_count,
    expected_count: item.expected_count,
    duration_p50_ms: quantile(item.duration_values, 0.5),
    duration_p95_ms: quantile(item.duration_values, 0.95),
    input_count_total: item.input_count_total,
    output_count_total: item.output_count_total,
    status_breakdown: item.status_breakdown
  }));
  const fieldFlowRows = rows.filter((item) => (
    item.pipeline_node_ledger.field_flow
    && typeof item.pipeline_node_ledger.field_flow === "object"
  ));
  const terminalDropRows = fieldFlowRows.flatMap((item) => {
    const fieldRows = Array.isArray(item.pipeline_node_ledger.field_flow?.fields)
      ? item.pipeline_node_ledger.field_flow.fields
      : [];
    return fieldRows
      .filter((field) => field.disposition === "UNEXPLAINED_TERMINAL_DROP")
      .map((field) => ({
        asset_id: item.asset_id || null,
        field_group: cleanText(field.field_group) || "unknown",
        raw_provider_present: field.raw_provider_present === true,
        evidence_present: field.evidence_present === true,
        resolved_present: field.resolved_present === true,
        rendered_present: field.rendered_present === true,
        terminal_resolved_present: field.terminal_resolved_present === true,
        terminal_drop_reason: field.terminal_drop_reason || null
      }));
  });
  const terminalDropFieldBreakdown = terminalDropRows.reduce((counts, item) => {
    counts[item.field_group] = (counts[item.field_group] || 0) + 1;
    return counts;
  }, {});
  const terminalDropCards = new Map();
  for (const item of terminalDropRows) {
    const key = item.asset_id || "unknown";
    const fields = terminalDropCards.get(key) || [];
    fields.push(item);
    terminalDropCards.set(key, fields);
  }
  const terminalGradeRows = fieldFlowRows
    .map((item) => item.pipeline_node_ledger.field_flow?.grade_atomic?.terminal)
    .filter((item) => item && typeof item === "object");
  const terminalGradeAtomic = {
    observed_count: terminalGradeRows.length,
    grade_company_present_count: terminalGradeRows.filter((item) => item.grade_company === true).length,
    card_grade_present_count: terminalGradeRows.filter((item) => item.card_grade === true).length,
    auto_grade_present_count: terminalGradeRows.filter((item) => item.auto_grade === true).length,
    company_without_score_count: terminalGradeRows.filter((item) => (
      item.grade_company === true && item.card_grade !== true && item.auto_grade !== true
    )).length,
    score_without_company_count: terminalGradeRows.filter((item) => (
      item.grade_company !== true && (item.card_grade === true || item.auto_grade === true)
    )).length
  };
  return {
    schema_version: "pipeline-node-ledger-summary-v2",
    ledger_present_count: rows.length,
    ledger_missing_count: results.length - rows.length,
    field_flow_present_count: fieldFlowRows.length,
    field_flow_missing_count: rows.length - fieldFlowRows.length,
    unexplained_terminal_drop_count: terminalDropRows.length,
    unexplained_terminal_drop_card_count: terminalDropCards.size,
    unexplained_terminal_drop_field_breakdown: terminalDropFieldBreakdown,
    unexplained_terminal_drop_examples: [...terminalDropCards.entries()].slice(0, 20).map(([assetId, fields]) => ({
      asset_id: assetId === "unknown" ? null : assetId,
      fields
    })),
    terminal_grade_atomic: terminalGradeAtomic,
    anomaly_card_count: rows.filter((item) => Number(item.pipeline_node_ledger.reconciliation?.anomaly_count || 0) > 0).length,
    anomaly_count: rows.reduce((sum, item) => sum + Number(item.pipeline_node_ledger.reconciliation?.anomaly_count || 0), 0),
    error_count: declaredErrorCount,
    transport_error_count: transportErrorCount,
    field_quality_error_count: fieldQualityErrorCount,
    warning_count: rows.reduce((sum, item) => sum + Number(item.pipeline_node_ledger.reconciliation?.warning_count || 0), 0),
    missing_required_node_count: rows.reduce((sum, item) => sum + Number(item.pipeline_node_ledger.coverage?.missing_required_node_count || 0), 0),
    node_metrics: nodeMetrics,
    anomaly_examples: rows
      .filter((item) => Number(item.pipeline_node_ledger.reconciliation?.anomaly_count || 0) > 0)
      .slice(0, 20)
      .map((item) => ({
        asset_id: item.asset_id || null,
        anomalies: (item.pipeline_node_ledger.reconciliation?.anomalies || []).map((anomaly) => ({
          check_id: anomaly.check_id || null,
          severity: anomaly.severity || null,
          expected: anomaly.expected ?? null,
          actual: anomaly.actual ?? null,
          detail: anomaly.detail || null
        }))
      }))
  };
}

export function summarizeV4PipelineContracts(results = []) {
  const rows = results.filter((item) => (
    item.v4_pipeline_contract
    && typeof item.v4_pipeline_contract === "object"
  ));
  const countValues = (values = []) => values.reduce((counts, value) => {
    const key = cleanText(value) || "missing";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const bridgedStageBreakdown = {};
  const violationCodeBreakdown = {};
  const completedActionBreakdown = {};
  let bridgedStageCount = 0;
  let violationCount = 0;
  for (const item of rows) {
    const contract = item.v4_pipeline_contract;
    const bridgedStages = Array.isArray(contract.bridged_stages) ? contract.bridged_stages : [];
    bridgedStageCount += bridgedStages.length;
    for (const stageId of bridgedStages) {
      const key = cleanText(stageId) || "unknown";
      bridgedStageBreakdown[key] = (bridgedStageBreakdown[key] || 0) + 1;
    }
    const violations = Array.isArray(contract.violations) ? contract.violations : [];
    violationCount += violations.length;
    for (const violation of violations) {
      const key = cleanText(violation?.code) || "UNKNOWN";
      violationCodeBreakdown[key] = (violationCodeBreakdown[key] || 0) + 1;
    }
    const completedActions = Array.isArray(contract.shadow_recognition_policy?.state?.completed_actions)
      ? contract.shadow_recognition_policy.state.completed_actions
      : [];
    for (const action of completedActions) {
      const key = cleanText(action) || "UNKNOWN";
      completedActionBreakdown[key] = (completedActionBreakdown[key] || 0) + 1;
    }
  }
  const shadowRows = rows.filter((item) => (
    item.v4_pipeline_contract.shadow_recognition_policy?.schema_version
      === "v4-shadow-recognition-policy-audit-v1"
  ));
  const terminalStopRows = shadowRows.filter((item) => (
    item.v4_pipeline_contract.shadow_recognition_policy?.decision?.current_stop_risk?.safe_to_stop === true
  ));
  const expensiveActions = new Set([
    "RUN_GPT_OBSERVATION",
    "RUN_VECTOR_RETRIEVAL",
    "RUN_FOCUSED_VERIFIER",
    "RUN_EXTERNAL_RETRIEVAL"
  ]);
  const terminalSafeAfterExpensiveActionCount = terminalStopRows.filter((item) => (
    (item.v4_pipeline_contract.shadow_recognition_policy?.state?.completed_actions || [])
      .some((action) => expensiveActions.has(action))
  )).length;
  return {
    schema_version: "v4-pipeline-contract-summary-v1",
    contract_present_count: rows.length,
    contract_missing_count: Math.max(0, results.length - rows.length),
    measurement_rate: results.length ? Number((rows.length / results.length).toFixed(6)) : null,
    contract_status_breakdown: countValues(rows.map((item) => item.v4_pipeline_contract.contract_status)),
    heuristic_version_breakdown: countValues(rows.map((item) => item.v4_pipeline_contract.candidate_heuristic_version)),
    migration_complete_count: rows.filter((item) => item.v4_pipeline_contract.migration_complete === true).length,
    bridged_stage_card_count: rows.filter((item) => Number(item.v4_pipeline_contract.bridged_stage_count || 0) > 0).length,
    bridged_stage_count: bridgedStageCount,
    bridged_stage_breakdown: bridgedStageBreakdown,
    violation_card_count: rows.filter((item) => (item.v4_pipeline_contract.violations || []).length > 0).length,
    violation_count: violationCount,
    violation_code_breakdown: violationCodeBreakdown,
    shadow_policy_snapshot_count: shadowRows.length,
    shadow_policy_missing_count: Math.max(0, rows.length - shadowRows.length),
    shadow_policy_can_execute_count: shadowRows.filter((item) => (
      item.v4_pipeline_contract.shadow_recognition_policy?.can_execute === true
    )).length,
    hard_invariant_feasible_count: shadowRows.filter((item) => (
      item.v4_pipeline_contract.shadow_recognition_policy?.state?.invariants?.feasible === true
    )).length,
    hard_invariant_incomplete_count: shadowRows.filter((item) => (
      item.v4_pipeline_contract.shadow_recognition_policy?.state?.invariants?.complete !== true
    )).length,
    hard_invariant_failed_count: shadowRows.filter((item) => {
      const invariants = item.v4_pipeline_contract.shadow_recognition_policy?.state?.invariants;
      return invariants?.complete === true && invariants?.feasible !== true;
    }).length,
    shadow_next_action_breakdown: countValues(shadowRows.map((item) => (
      item.v4_pipeline_contract.shadow_recognition_policy?.decision?.next_action
    ))),
    current_safe_to_stop_count: terminalStopRows.length,
    current_deep_review_count: shadowRows.filter((item) => (
      item.v4_pipeline_contract.shadow_recognition_policy?.decision?.next_action
        === "ROUTE_TO_WRITER_REVIEW"
    )).length,
    specialized_verification_needed_count: shadowRows.filter((item) => (
      item.v4_pipeline_contract.shadow_recognition_policy?.decision?.next_action
        === "RUN_FOCUSED_VERIFIER"
    )).length,
    invalid_input_reject_count: shadowRows.filter((item) => (
      item.v4_pipeline_contract.shadow_recognition_policy?.decision?.next_action
        === "REJECT_INVALID_INPUT"
    )).length,
    completed_action_breakdown: completedActionBreakdown,
    completed_action_count: Object.values(completedActionBreakdown)
      .reduce((sum, count) => sum + count, 0),
    terminal_safe_after_expensive_action_count: terminalSafeAfterExpensiveActionCount,
    terminal_safe_after_expensive_action_note: "Terminal-state diagnostic only; it does not prove an earlier action was wasteful.",
    global_risk_p50: quantile(shadowRows.map((item) => (
      item.v4_pipeline_contract.shadow_recognition_policy?.decision?.current_stop_risk?.global_risk
    )), 0.5),
    global_risk_p95: quantile(shadowRows.map((item) => (
      item.v4_pipeline_contract.shadow_recognition_policy?.decision?.current_stop_risk?.global_risk
    )), 0.95),
    critical_risk_p50: quantile(shadowRows.map((item) => (
      item.v4_pipeline_contract.shadow_recognition_policy?.decision?.current_stop_risk?.critical_field_risk
    )), 0.5),
    critical_risk_p95: quantile(shadowRows.map((item) => (
      item.v4_pipeline_contract.shadow_recognition_policy?.decision?.current_stop_risk?.critical_field_risk
    )), 0.95)
  };
}

const evaluationGradeCompanyPattern = "PSA|BGS|BECKETT|CGC|SGC|TAG|CCIC|GTBC|BGN";

function referenceGradeExpectation(item = {}) {
  const reference = cleanText(item.reference_title || item.reviewed_title || item.seller_title);
  if (!reference) return null;
  const match = reference.match(new RegExp(
    `\\b(${evaluationGradeCompanyPattern})\\s+(?:(?:GEM|MINT|PRISTINE|NM-MT|NM|MT)\\s+)*(\\d{1,2}(?:\\.\\d)?|AUTH(?:ENTIC)?)\\b`,
    "i"
  ));
  if (!match) return null;
  return {
    company: cleanText(match[1]).toUpperCase() === "BECKETT" ? "BGS" : cleanText(match[1]).toUpperCase(),
    grade: cleanText(match[2]).toUpperCase().replace(/^AUTHENTIC$/, "AUTH")
  };
}

function gradeExpectationPreserved(item = {}, expectation = null) {
  if (!expectation) return null;
  const fields = item.resolved_fields && typeof item.resolved_fields === "object"
    ? item.resolved_fields
    : {};
  const fieldCompanyRaw = cleanText(fields.grade_company).toUpperCase();
  const fieldCompany = fieldCompanyRaw === "BECKETT" ? "BGS" : fieldCompanyRaw;
  const fieldGrade = cleanText(fields.card_grade || fields.grade).toUpperCase().replace(/^AUTHENTIC$/, "AUTH");
  if (fieldCompany === expectation.company && fieldGrade === expectation.grade) return true;
  const title = cleanText(item.final_title).toUpperCase().replace(/BECKETT/g, "BGS");
  if (!title) return false;
  const escapedGrade = expectation.grade.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${expectation.company}\\s+(?:(?:GEM|MINT|PRISTINE|NM-MT|NM|MT)\\s+)*${escapedGrade}\\b`, "i")
    .test(title);
}

function positionCohortMetrics(rows = []) {
  const ocrRows = rows.filter((item) => Number(item.preingestion_ocr_rendezvous?.job_count || 0) > 0);
  const gradeOcrRows = rows.filter((item) => Number(item.preingestion_ocr_rendezvous?.grade_label_job_count || 0) > 0);
  const gradeReferenceRows = rows
    .map((item) => ({ item, expectation: referenceGradeExpectation(item) }))
    .filter((entry) => entry.expectation);
  const gradePreservedCount = gradeReferenceRows.filter(({ item, expectation }) => (
    gradeExpectationPreserved(item, expectation) === true
  )).length;
  return {
    attempted_count: rows.length,
    technical_success_count: rows.filter((item) => item.ok === true).length,
    technical_success_rate: rows.length
      ? Number((rows.filter((item) => item.ok === true).length / rows.length).toFixed(6))
      : null,
    writer_ready_count: rows.filter((item) => item.writer_ready === true).length,
    writer_ready_p95_ms: quantile(rows.map((item) => item.time_to_writer_ready_ms), 0.95),
    scheduler_queue_wait_p95_ms: quantile(rows.map((item) => item.scheduler_queue_wait_ms ?? item.worker_queue_wait_ms), 0.95),
    ocr_attempted_count: ocrRows.length,
    ocr_terminal_count: ocrRows.filter((item) => item.preingestion_ocr_rendezvous?.terminal === true).length,
    ocr_terminal_rate: ocrRows.length
      ? Number((ocrRows.filter((item) => item.preingestion_ocr_rendezvous?.terminal === true).length / ocrRows.length).toFixed(6))
      : null,
    ocr_capacity_wait_p95_ms: quantile(rows.map((item) => (
      item.preingestion_ocr_rendezvous?.execution_summary?.capacity_wait_p95_ms
    )), 0.95),
    grade_ocr_card_count: gradeOcrRows.length,
    grade_ocr_succeeded_card_count: gradeOcrRows.filter((item) => (
      Number(item.preingestion_ocr_rendezvous?.grade_label_succeeded_count || 0) > 0
    )).length,
    grade_ocr_succeeded_rate: gradeOcrRows.length
      ? Number((gradeOcrRows.filter((item) => (
        Number(item.preingestion_ocr_rendezvous?.grade_label_succeeded_count || 0) > 0
      )).length / gradeOcrRows.length).toFixed(6))
      : null,
    grade_reference_expected_count: gradeReferenceRows.length,
    grade_reference_preserved_count: gradePreservedCount,
    grade_reference_omission_count: Math.max(0, gradeReferenceRows.length - gradePreservedCount),
    grade_reference_preservation_rate: gradeReferenceRows.length
      ? Number((gradePreservedCount / gradeReferenceRows.length).toFixed(6))
      : null
  };
}

function nullableDelta(next, previous) {
  const nextValue = numberOrNull(next);
  const previousValue = numberOrNull(previous);
  return nextValue === null || previousValue === null
    ? null
    : Number((nextValue - previousValue).toFixed(6));
}

function latestOcrExecutionNumber(results = [], field = "") {
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const value = numberOrNull(results[index]?.preingestion_ocr_rendezvous?.execution_summary?.[field]);
    if (value !== null) return value;
  }
  return null;
}

export function summarizeBatchPositionFairness(results = []) {
  const splitIndex = Math.ceil(results.length / 2);
  const frontHalf = positionCohortMetrics(results.slice(0, splitIndex));
  const backHalf = positionCohortMetrics(results.slice(splitIndex));
  return {
    schema_version: "batch-position-fairness-v1",
    split_index: splitIndex,
    front_half: frontHalf,
    back_half: backHalf,
    back_minus_front: {
      technical_success_rate: nullableDelta(backHalf.technical_success_rate, frontHalf.technical_success_rate),
      writer_ready_p95_ms: nullableDelta(backHalf.writer_ready_p95_ms, frontHalf.writer_ready_p95_ms),
      scheduler_queue_wait_p95_ms: nullableDelta(backHalf.scheduler_queue_wait_p95_ms, frontHalf.scheduler_queue_wait_p95_ms),
      ocr_terminal_rate: nullableDelta(backHalf.ocr_terminal_rate, frontHalf.ocr_terminal_rate),
      ocr_capacity_wait_p95_ms: nullableDelta(backHalf.ocr_capacity_wait_p95_ms, frontHalf.ocr_capacity_wait_p95_ms),
      grade_ocr_succeeded_rate: nullableDelta(backHalf.grade_ocr_succeeded_rate, frontHalf.grade_ocr_succeeded_rate),
      grade_reference_preservation_rate: nullableDelta(
        backHalf.grade_reference_preservation_rate,
        frontHalf.grade_reference_preservation_rate
      )
    }
  };
}

export function summarize(results = [], { runWallMs = null } = {}) {
  const l1Raw = results.map((item) => item.l1_scoring?.raw_token_recall);
  const l1Fair = results.map((item) => item.l1_scoring?.fair_token_recall);
  const l1Policy = results.map((item) => item.l1_scoring?.policy_fair_token_recall);
  const finalRaw = results.map((item) => item.final_scoring?.raw_token_recall);
  const finalFair = results.map((item) => item.final_scoring?.fair_token_recall);
  const finalPolicy = results.map((item) => item.final_scoring?.policy_fair_token_recall);
  const countBy = (field) => results.reduce((acc, item) => {
    const key = cleanText(item[field] ?? "missing") || "missing";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const queueResults = results.filter((item) => item.queue_mode === true);
  const assetIntegrity = identifierIntegrity(results.map((item) => item.asset_id));
  const jobIntegrity = identifierIntegrity(queueResults.map((item) => item.job_id));
  const successfulQueueResults = queueResults.filter((item) => item.ok === true);
  const successfulNonterminalJobCount = successfulQueueResults.filter((item) => (
    cleanText(item.job_status).toUpperCase() !== "L2_READY"
  )).length;
  const writerVisibleRecognitionMeasuredCount = results.filter((item) => (
    numberOrNull(item.writer_visible_recognition_ms) !== null
  )).length;
  const batchPositionFairness = summarizeBatchPositionFairness(results);
  const allPositionMetrics = positionCohortMetrics(results);
  const tenantIsolationMeasured = results.filter((item) => item.tenant_isolation_measured === true);
  const tenantIsolationViolationCount = tenantIsolationMeasured.filter((item) => item.tenant_isolation_valid !== true).length;
  const tenantRows = new Map();
  for (const item of results) {
    const tenantId = cleanText(item.tenant_id || item.batch_id) || "unknown";
    const current = tenantRows.get(tenantId) || {
      tenant_id: tenantId,
      assigned_count: 0,
      completed_count: 0,
      queue_wait_values: [],
      writer_ready_values: []
    };
    current.assigned_count += 1;
    if (item.ok === true && item.writer_ready === true) current.completed_count += 1;
    const queueWait = numberOrNull(item.scheduler_queue_wait_ms ?? item.worker_queue_wait_ms);
    const writerReady = numberOrNull(item.time_to_writer_ready_ms);
    if (queueWait !== null) current.queue_wait_values.push(queueWait);
    if (writerReady !== null) current.writer_ready_values.push(writerReady);
    tenantRows.set(tenantId, current);
  }
  const tenantService = [...tenantRows.values()].map((tenant) => ({
    tenant_id: tenant.tenant_id,
    assigned_count: tenant.assigned_count,
    completed_count: tenant.completed_count,
    completion_rate: tenant.assigned_count > 0
      ? Number((tenant.completed_count / tenant.assigned_count).toFixed(6))
      : null,
    queue_wait_p50_ms: quantile(tenant.queue_wait_values, 0.5),
    queue_wait_p95_ms: quantile(tenant.queue_wait_values, 0.95),
    queue_wait_max_ms: quantile(tenant.queue_wait_values, 1),
    writer_ready_p95_ms: quantile(tenant.writer_ready_values, 0.95)
  })).sort((left, right) => left.tenant_id.localeCompare(right.tenant_id));
  return {
    attempted_count: results.length,
    ok_count: results.filter((item) => item.ok).length,
    title_ready_count: results.filter((item) => item.ok === true && cleanText(item.final_title)).length,
    writer_review_required_count: results.filter((item) => item.ok === true && item.writer_review_required === true).length,
    technical_failure_count: results.filter((item) => item.ok !== true).length,
    policy_below_0_72_count: results.filter((item) => Number(item.final_scoring?.policy_fair_token_recall || 0) < 0.72).length,
    // Kept for existing report consumers; this is a technical completion
    // failure count, not an accuracy-policy failure count.
    final_failure_count: results.filter((item) => item.ok !== true).length,
    production_integrity: {
      asset_id_present_count: assetIntegrity.present_count,
      asset_id_unique_count: assetIntegrity.unique_count,
      duplicate_asset_id_count: assetIntegrity.duplicate_count,
      queue_result_count: queueResults.length,
      job_id_present_count: jobIntegrity.present_count,
      job_id_unique_count: jobIntegrity.unique_count,
      duplicate_job_id_count: jobIntegrity.duplicate_count,
      missing_job_id_count: Math.max(0, queueResults.length - jobIntegrity.present_count),
      successful_nonterminal_job_count: successfulNonterminalJobCount,
      provider_capacity_release_count: results.filter((item) => (
        item.writer_ready_capacity_release?.released === true
      )).length,
      provider_capacity_release_missing_count: results.filter((item) => (
        item.queue_mode === true && item.ok === true && !item.writer_ready_capacity_release_mode
      )).length,
      provider_capacity_refill_missing_count: results.filter((item) => (
        item.writer_ready_capacity_release?.released === true
        && item.writer_ready_capacity_refill?.triggered !== true
      )).length,
      tenant_isolation_measured_count: tenantIsolationMeasured.length,
      tenant_isolation_measurement_rate: results.length
        ? Number((tenantIsolationMeasured.length / results.length).toFixed(6))
        : null,
      tenant_isolation_violation_count: tenantIsolationViolationCount,
      tenant_count: tenantService.length,
      tenant_service: tenantService
    },
    batch_position_fairness: batchPositionFairness,
    retry_card_count: results.filter((item) => Number(item.attempt_count || 0) > 1).length,
    retry_attempt_count: results.reduce((sum, item) => sum + Math.max(0, Number(item.attempt_count || 0) - 1), 0),
    retry_error_code_breakdown: results.reduce((counts, item) => {
      for (const code of Array.isArray(item.retry_error_codes) ? item.retry_error_codes : []) {
        const key = cleanText(code) || "UNKNOWN";
        counts[key] = (counts[key] || 0) + 1;
      }
      return counts;
    }, {}),
    completion_write_retry_count: results.filter((item) =>
      (item.retry_error_codes || []).some((code) => cleanText(code).toUpperCase() === "QUEUE_COMPLETION_WRITE_FAILED")
    ).length,
    completion_payload_sanitized_nul_count: results.reduce((sum, item) =>
      sum + Number(item.completion_payload_sanitized_nul_count || 0), 0),
    run_wall_ms: runWallMs,
    completed_cards_per_minute: Number.isFinite(Number(runWallMs)) && Number(runWallMs) > 0
      ? Number((results.filter((item) => item.ok).length * 60000 / Number(runWallMs)).toFixed(3))
      : null,
    l2_ready_count: results.filter((item) => item.l2_ready).length,
    fast_scout_cache_hit_count: results.filter((item) => item.fast_scout_cache_hit).length,
    fast_scout_blocking_call_count: results.filter((item) => item.fast_scout_blocking_call_used).length,
    prewarm_cache_hit_count: results.filter((item) => item.prewarm_cache_hit === true).length,
    preingestion_used_count: results.filter((item) => item.preingestion_used === true).length,
    preingestion_ok_count: results.filter((item) => item.preingestion_ok === true).length,
    preingestion_p50_ms: quantile(results.map((item) => item.preingestion_latency_ms), 0.5),
    preingestion_p95_ms: quantile(results.map((item) => item.preingestion_latency_ms), 0.95),
    preingestion_worker_jobs_enqueued_count: results.reduce((sum, item) => sum + Number(item.preingestion_worker_jobs_enqueued || 0), 0),
    l1_p50_ms: quantile(results.map((item) => item.l1_wall_latency_ms), 0.5),
    l1_p95_ms: quantile(results.map((item) => item.l1_wall_latency_ms), 0.95),
    l1_internal_scout_p50_ms: quantile(results.map((item) => item.l1_internal_scout_ms), 0.5),
    l1_internal_scout_p95_ms: quantile(results.map((item) => item.l1_internal_scout_ms), 0.95),
    l1_safe_draft_p50_ms: quantile(results.map((item) => item.l1_time_to_safe_draft_ms), 0.5),
    l1_safe_draft_p95_ms: quantile(results.map((item) => item.l1_time_to_safe_draft_ms), 0.95),
    writer_ready_p50_ms: quantile(results.map((item) => item.time_to_writer_ready_ms), 0.5),
    writer_ready_p95_ms: quantile(results.map((item) => item.time_to_writer_ready_ms), 0.95),
    writer_ready_p99_ms: quantile(results.map((item) => item.time_to_writer_ready_ms), 0.99),
    prewarm_p50_ms: quantile(results.map((item) => item.prewarm_latency_ms), 0.5),
    prewarm_p95_ms: quantile(results.map((item) => item.prewarm_latency_ms), 0.95),
    queue_mode_count: results.filter((item) => item.queue_mode === true).length,
    speculative_count: results.filter((item) => item.speculative_mode === true).length,
    speculative_fast_lane_hit_count: results.filter((item) => item.speculative_l1_fast_lane_hit === true).length,
    pre_l2_anchor_fast_lane_hit_count: results.filter((item) => item.pre_l2_anchor_fast_lane_hit === true).length,
    pre_l2_anchor_route_breakdown: countBy("pre_l2_anchor_route"),
    pre_l2_anchor_finalize_reason_breakdown: countBy("pre_l2_anchor_finalize_reason"),
    pre_l2_anchor_probe_p50_ms: quantile(results.map((item) => item.pre_l2_anchor_probe_ms), 0.5),
    pre_l2_anchor_probe_p95_ms: quantile(results.map((item) => item.pre_l2_anchor_probe_ms), 0.95),
    pre_l2_anchor_patch_count: results.reduce((sum, item) => sum + Number(item.pre_l2_anchor_patch_count || 0), 0),
    pre_l2_anchor_candidate_count: results.reduce((sum, item) => sum + Number(item.pre_l2_anchor_candidate_count || 0), 0),
    pre_l2_anchor_direct_candidate_count: results.reduce((sum, item) => sum + Number(item.pre_l2_anchor_direct_candidate_count || 0), 0),
    pre_l2_anchor_lookup_attempted_count: results.filter((item) => item.pre_l2_anchor_lookup_attempted === true).length,
    pre_l2_anchor_catalog_candidate_count: results.reduce((sum, item) => sum + Number(item.pre_l2_anchor_catalog_candidate_count || 0), 0),
    pre_l2_anchor_trusted_candidate_count: results.reduce((sum, item) => sum + Number(item.pre_l2_anchor_trusted_candidate_count || 0), 0),
    pre_l2_anchor_eligible_candidate_count: results.reduce((sum, item) => sum + Number(item.pre_l2_anchor_eligible_candidate_count || 0), 0),
    pre_l2_anchor_type_breakdown: results.reduce((totals, item) => {
      for (const [type, count] of Object.entries(item.pre_l2_anchor_type_breakdown || {})) {
        totals[type] = Number(totals[type] || 0) + Number(count || 0);
      }
      return totals;
    }, {}),
    speculative_l2_done_before_click_count: results.filter((item) => item.l2_done_before_click === true).length,
    perceived_title_p50_ms: quantile(results.map((item) => item.perceived_title_ms), 0.5),
    perceived_title_p95_ms: quantile(results.map((item) => item.perceived_title_ms), 0.95),
    perceived_title_p99_ms: quantile(results.map((item) => item.perceived_title_ms), 0.99),
    preparation_p50_ms: quantile(results.map((item) => item.preparation_latency_ms), 0.5),
    preparation_p95_ms: quantile(results.map((item) => item.preparation_latency_ms), 0.95),
    preparation_recovered_by_retry_count: results.filter((item) => item.preparation_recovered_by_retry === true).length,
    preparation_retry_attempt_count: results.reduce((sum, item) => {
      const diagnostics = item.preparation_diagnostics || {};
      return sum
        + Math.max(0, Number(diagnostics.asset_create_attempts || 1) - 1)
        + Math.max(0, Number(diagnostics.upload_sign_attempts || 0) - Number(item.image_count || 0))
        + Math.max(0, Number(diagnostics.upload_verify_attempts || 0) - Number(item.image_count || 0));
    }, 0),
    enqueue_p50_ms: quantile(results.map((item) => item.enqueue_latency_ms), 0.5),
    enqueue_p95_ms: quantile(results.map((item) => item.enqueue_latency_ms), 0.95),
    enqueue_recovered_by_retry_count: results.filter((item) => item.enqueue_recovered_by_retry === true).length,
    enqueue_retry_attempt_count: results.reduce((sum, item) => (
      sum + Math.max(0, Number(item.enqueue_attempts || 1) - 1)
    ), 0),
    speculative_setup_p50_ms: quantile(results.map((item) => item.speculative_setup_ms), 0.5),
    worker_queue_wait_p50_ms: quantile(results.map((item) => item.worker_queue_wait_ms), 0.5),
    worker_queue_wait_p95_ms: quantile(results.map((item) => item.worker_queue_wait_ms), 0.95),
    worker_queue_wait_p99_ms: quantile(results.map((item) => item.worker_queue_wait_ms), 0.99),
    paired_l1_wait_p50_ms: quantile(results.map((item) => item.paired_l1_wait_ms), 0.5),
    paired_l1_wait_p95_ms: quantile(results.map((item) => item.paired_l1_wait_ms), 0.95),
    scheduler_queue_wait_p50_ms: quantile(results.map((item) => item.scheduler_queue_wait_ms), 0.5),
    scheduler_queue_wait_p95_ms: quantile(results.map((item) => item.scheduler_queue_wait_ms), 0.95),
    scheduler_queue_wait_p99_ms: quantile(results.map((item) => item.scheduler_queue_wait_ms), 0.99),
    writer_visible_recognition_p50_ms: quantile(results.map((item) => item.writer_visible_recognition_ms), 0.5),
    writer_visible_recognition_p95_ms: quantile(results.map((item) => item.writer_visible_recognition_ms), 0.95),
    writer_visible_recognition_p99_ms: quantile(results.map((item) => item.writer_visible_recognition_ms), 0.99),
    writer_visible_recognition_measured_count: writerVisibleRecognitionMeasuredCount,
    writer_visible_recognition_measurement_rate: results.length
      ? Number((writerVisibleRecognitionMeasuredCount / results.length).toFixed(6))
      : null,
    recognition_start_source_breakdown: countBy("recognition_start_source"),
    worker_processing_p50_ms: quantile(results.map((item) => item.worker_processing_ms), 0.5),
    worker_processing_p95_ms: quantile(results.map((item) => item.worker_processing_ms), 0.95),
    worker_processing_p99_ms: quantile(results.map((item) => item.worker_processing_ms), 0.99),
    writer_ready_capacity_atomic_count: results.filter((item) => (
      item.writer_ready_capacity_release?.released === true
      && item.writer_ready_capacity_release_mode === "writer_ready_atomic"
    )).length,
    provider_done_capacity_release_count: results.filter((item) => (
      item.writer_ready_capacity_release?.released === true
      && item.writer_ready_capacity_release_mode === "provider_done"
    )).length,
    writer_ready_capacity_fallback_count: results.filter((item) => (
      item.writer_ready_capacity_release_mode === "worker_tail_fallback"
      || item.writer_ready_capacity_release?.released === false
    )).length,
    writer_ready_capacity_release_missing_count: results.filter((item) => !item.writer_ready_capacity_release_mode).length,
    provider_capacity_handoff_overlap_count: results.filter((item) => (
      item.provider_capacity_stage_handoff?.overlapped_after_initial_provider === true
    )).length,
    provider_capacity_handoff_overlap_window_p50_ms: quantile(
      results.map((item) => item.provider_capacity_stage_handoff?.overlap_window_ms),
      0.5
    ),
    provider_capacity_handoff_overlap_window_p95_ms: quantile(
      results.map((item) => item.provider_capacity_stage_handoff?.overlap_window_ms),
      0.95
    ),
    provider_capacity_handoff_join_wait_p50_ms: quantile(
      results.map((item) => item.provider_capacity_stage_handoff?.join_wait_ms),
      0.5
    ),
    provider_capacity_handoff_join_wait_p95_ms: quantile(
      results.map((item) => item.provider_capacity_stage_handoff?.join_wait_ms),
      0.95
    ),
    writer_ready_capacity_refill_triggered_count: results.filter((item) => item.writer_ready_capacity_refill?.triggered === true).length,
    writer_ready_capacity_refill_missing_count: results.filter((item) => (
      item.writer_ready_capacity_release?.released === true
      && item.writer_ready_capacity_refill?.triggered !== true
    )).length,
    provider_key_assignment_breakdown: countBy("provider_key_assignment"),
    job_status_breakdown: countBy("job_status"),
    l1_job_status_breakdown: countBy("l1_job_status"),
    enqueue_persistence_mode_breakdown: countBy("enqueue_persistence_mode"),
    catalog_prompt_candidate_count: results.reduce((sum, item) => sum + Number(item.catalog_prompt_candidate_count || 0), 0),
    vector_prompt_candidate_count: results.reduce((sum, item) => sum + Number(item.vector_prompt_candidate_count || 0), 0),
    l2_catalog_raw_candidate_count: results.reduce((sum, item) => sum + Number(item.l2_catalog_raw_candidate_count || 0), 0),
    l2_catalog_approved_candidate_count: results.reduce((sum, item) => sum + Number(item.l2_catalog_approved_candidate_count || 0), 0),
    l2_catalog_conflict_blocked_count: results.reduce((sum, item) => sum + Number(item.l2_catalog_conflict_blocked_count || 0), 0),
    l2_catalog_prompt_candidate_count: results.reduce((sum, item) => sum + Number(item.l2_catalog_prompt_candidate_count || 0), 0),
    l2_catalog_evidence_support_field_count: results.reduce((sum, item) => sum + Number(item.l2_catalog_evidence_support_field_count || 0), 0),
    l2_vector_raw_candidate_count: results.reduce((sum, item) => sum + Number(item.l2_vector_raw_candidate_count || 0), 0),
    l2_vector_approved_candidate_count: results.reduce((sum, item) => sum + Number(item.l2_vector_approved_candidate_count || 0), 0),
    l2_vector_conflict_blocked_count: results.reduce((sum, item) => sum + Number(item.l2_vector_conflict_blocked_count || 0), 0),
    l2_vector_prompt_candidate_count: results.reduce((sum, item) => sum + Number(item.l2_vector_prompt_candidate_count || 0), 0),
    l2_vector_evidence_support_field_count: results.reduce((sum, item) => sum + Number(item.l2_vector_evidence_support_field_count || 0), 0),
    vector_runtime_status_breakdown: countBy("vector_runtime_status"),
    vector_runtime_status_code_breakdown: countBy("vector_runtime_status_code"),
    vector_worker_status_breakdown: countBy("vector_worker_status"),
    vector_worker_retry_card_count: results.filter((item) => Number(item.vector_worker_attempt_count || 0) > 1).length,
    vector_worker_attempt_count: results.reduce((sum, item) => sum + Number(item.vector_worker_attempt_count || 0), 0),
    vector_role_agnostic_fallback_count: results.filter((item) => item.vector_role_agnostic_fallback_used === true).length,
    evidence_stage_capacity: {
      catalog: {
        controlled_count: results.filter((item) => item.catalog_stage_capacity?.coordinated === true).length,
        acquired_count: results.filter((item) => item.catalog_stage_capacity?.acquired === true).length,
        deferred_count: results.filter((item) => (
          item.catalog_stage_capacity?.coordinated === true
          && item.catalog_stage_capacity?.acquired !== true
        )).length,
        release_missing_count: results.filter((item) => (
          item.catalog_stage_capacity?.coordinated === true
          && item.catalog_stage_capacity?.acquired === true
          && item.catalog_stage_capacity?.released !== true
        )).length,
        wait_p50_ms: quantile(results.map((item) => item.catalog_stage_capacity?.wait_ms), 0.5),
        wait_p95_ms: quantile(results.map((item) => item.catalog_stage_capacity?.wait_ms), 0.95)
      },
      vector: {
        controlled_count: results.filter((item) => item.vector_stage_capacity?.coordinated === true).length,
        acquired_count: results.filter((item) => item.vector_stage_capacity?.acquired === true).length,
        deferred_count: results.filter((item) => (
          item.vector_stage_capacity?.coordinated === true
          && item.vector_stage_capacity?.acquired !== true
        )).length,
        release_missing_count: results.filter((item) => (
          item.vector_stage_capacity?.coordinated === true
          && item.vector_stage_capacity?.acquired === true
          && item.vector_stage_capacity?.released !== true
        )).length,
        wait_p50_ms: quantile(results.map((item) => item.vector_stage_capacity?.wait_ms), 0.5),
        wait_p95_ms: quantile(results.map((item) => item.vector_stage_capacity?.wait_ms), 0.95)
      }
    },
    preingestion_ocr: {
      status_breakdown: results.reduce((counts, item) => {
        const key = cleanText(item.preingestion_ocr_rendezvous?.status || "missing") || "missing";
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, {}),
      terminal_count: results.filter((item) => item.preingestion_ocr_rendezvous?.terminal === true).length,
      timeout_count: results.filter((item) => item.preingestion_ocr_rendezvous?.status === "TIMEOUT").length,
      job_count: results.reduce((sum, item) => sum + Number(item.preingestion_ocr_rendezvous?.job_count || 0), 0),
      patch_count: results.reduce((sum, item) => sum + Number(item.preingestion_ocr_rendezvous?.patch_count || 0), 0),
      serial_patch_count: results.reduce((sum, item) => sum + Number(item.preingestion_ocr_rendezvous?.serial_patch_count || 0), 0),
      grade_label_job_count: results.reduce((sum, item) => sum + Number(item.preingestion_ocr_rendezvous?.grade_label_job_count || 0), 0),
      grade_label_succeeded_count: results.reduce((sum, item) => sum + Number(item.preingestion_ocr_rendezvous?.grade_label_succeeded_count || 0), 0),
      grade_reference_expected_count: allPositionMetrics.grade_reference_expected_count,
      grade_reference_preserved_count: allPositionMetrics.grade_reference_preserved_count,
      grade_reference_omission_count: allPositionMetrics.grade_reference_omission_count,
      grade_reference_preservation_rate: allPositionMetrics.grade_reference_preservation_rate,
      elapsed_since_preingestion_p50_ms: quantile(results.map((item) => item.preingestion_ocr_rendezvous?.waited_ms), 0.5),
      elapsed_since_preingestion_p95_ms: quantile(results.map((item) => item.preingestion_ocr_rendezvous?.waited_ms), 0.95),
      critical_path_wait_p50_ms: quantile(results.map((item) => item.preingestion_ocr_rendezvous?.post_provider_wait_ms ?? 0), 0.5),
      critical_path_wait_p95_ms: quantile(results.map((item) => item.preingestion_ocr_rendezvous?.post_provider_wait_ms ?? 0), 0.95),
      stage_capacity_control_enabled_count: results.filter((item) => (
        item.preingestion_ocr_rendezvous?.execution_summary?.capacity_control_enabled === true
      )).length,
      stage_global_capacity_latest: latestOcrExecutionNumber(results, "global_capacity"),
      per_asset_capacity_latest: latestOcrExecutionNumber(results, "per_asset_capacity"),
      per_asset_batch_size_latest: latestOcrExecutionNumber(results, "per_asset_batch_size"),
      anchor_concurrency_latest: latestOcrExecutionNumber(results, "anchor_concurrency"),
      detail_concurrency_latest: latestOcrExecutionNumber(results, "detail_concurrency"),
      claimed_asset_count: results.reduce((sum, item) => (
        sum + Number(item.preingestion_ocr_rendezvous?.execution_summary?.claimed_asset_count || 0)
      ), 0),
      max_claimed_jobs_per_asset: Math.max(0, ...results.map((item) => (
        Number(item.preingestion_ocr_rendezvous?.execution_summary?.max_claimed_jobs_per_asset || 0)
      ))),
      first_wave_fairness_satisfied_count: results.filter((item) => (
        item.preingestion_ocr_rendezvous?.execution_summary?.first_wave_fairness_satisfied === true
      )).length,
      first_wave_fairness_violation_count: results.filter((item) => (
        item.preingestion_ocr_rendezvous?.execution_summary?.first_wave_fairness_satisfied === false
      )).length,
      lane_capacity_unused: results.reduce((sum, item) => (
        sum + Number(item.preingestion_ocr_rendezvous?.execution_summary?.lane_capacity_unused || 0)
      ), 0),
      lane_allocation_violation_count: results.filter((item) => (
        item.preingestion_ocr_rendezvous?.execution_summary?.lane_allocation_within_global_capacity === false
      )).length,
      anchor_job_count: results.reduce((sum, item) => (
        sum + Number(item.preingestion_ocr_rendezvous?.execution_summary?.anchor_job_count || 0)
      ), 0),
      detail_job_count: results.reduce((sum, item) => (
        sum + Number(item.preingestion_ocr_rendezvous?.execution_summary?.detail_job_count || 0)
      ), 0),
      stage_capacity_deferred_count: results.reduce((sum, item) => (
        sum + Number(item.preingestion_ocr_rendezvous?.execution_summary?.capacity_deferred_count || 0)
      ), 0),
      stage_capacity_acquire_attempt_count: results.reduce((sum, item) => (
        sum + Number(item.preingestion_ocr_rendezvous?.execution_summary?.capacity_acquire_attempt_count || 0)
      ), 0),
      peak_local_active_p50: quantile(results.map((item) => (
        item.preingestion_ocr_rendezvous?.execution_summary?.peak_local_active
      )), 0.5),
      peak_local_active_p95: quantile(results.map((item) => (
        item.preingestion_ocr_rendezvous?.execution_summary?.peak_local_active
      )), 0.95),
      stage_capacity_wait_p50_ms: quantile(results.map((item) => (
        item.preingestion_ocr_rendezvous?.execution_summary?.capacity_wait_p50_ms
      )), 0.5),
      stage_capacity_wait_p95_ms: quantile(results.map((item) => (
        item.preingestion_ocr_rendezvous?.execution_summary?.capacity_wait_p95_ms
      )), 0.95),
      worker_duration_p50_ms: quantile(results.map((item) => (
        item.preingestion_ocr_rendezvous?.execution_summary?.duration_p50_ms
      )), 0.5),
      worker_duration_p95_ms: quantile(results.map((item) => (
        item.preingestion_ocr_rendezvous?.execution_summary?.duration_p95_ms
      )), 0.95),
      worker_timeout_count: results.reduce((sum, item) => (
        sum + Number(item.preingestion_ocr_rendezvous?.execution_summary?.timeout_count || 0)
      ), 0),
      grade_component_fallback_count: results.reduce((sum, item) => (
        sum + Number(item.preingestion_ocr_rendezvous?.execution_summary?.grade_component_fallback_count || 0)
      ), 0),
      grade_component_fallback_target_found_count: results.reduce((sum, item) => (
        sum + Number(item.preingestion_ocr_rendezvous?.execution_summary?.grade_component_fallback_target_found_count || 0)
      ), 0),
      grade_component_fallback_latency_ms: results.reduce((sum, item) => (
        sum + Number(item.preingestion_ocr_rendezvous?.execution_summary?.grade_component_fallback_latency_ms || 0)
      ), 0),
      evidence_refresh_added_patch_count: results.reduce((sum, item) => sum + Number(item.preingestion_evidence_refresh?.added_patch_count || 0), 0),
      serial_numerator_verified_count: results.filter((item) => item.serial_numerator_verified === true).length,
      serial_numerator_rejected_count: results.filter((item) => item.serial_numerator_verified === false).length
    },
    pipeline_node_observability: summarizePipelineNodeLedgers(results),
    v4_pipeline_contract_observability: summarizeV4PipelineContracts(results),
    provider_diagnostics: {
      input_tokens_total: results.reduce((sum, item) => sum + Number(item.input_tokens || 0), 0),
      output_tokens_total: results.reduce((sum, item) => sum + Number(item.output_tokens || 0), 0),
      total_tokens_total: results.reduce((sum, item) => sum + Number(item.total_tokens || 0), 0),
      provider_latency_p50_ms: quantile(results.map((item) => item.provider_latency_ms), 0.5),
      provider_latency_p95_ms: quantile(results.map((item) => item.provider_latency_ms), 0.95),
      response_profile_breakdown: results.reduce((counts, item) => {
        const key = cleanText(item.provider_response_profile || "missing") || "missing";
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, {}),
      prompt_mode_breakdown: results.reduce((counts, item) => {
        const key = cleanText(item.provider_prompt_mode || "missing") || "missing";
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, {}),
      image_detail_breakdown: results.reduce((counts, item) => {
        const key = cleanText(item.provider_image_detail || "missing") || "missing";
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, {}),
      text_verbosity_breakdown: results.reduce((counts, item) => {
        const key = cleanText(item.provider_text_verbosity || "missing") || "missing";
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, {}),
      requested_service_tier_breakdown: results.reduce((counts, item) => {
        const key = cleanText(item.provider_requested_service_tier || "missing") || "missing";
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, {}),
      service_tier_breakdown: results.reduce((counts, item) => {
        const key = cleanText(item.provider_service_tier || "missing") || "missing";
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, {}),
      prompt_chars_p50: quantile(results.map((item) => item.provider_prompt_chars), 0.5),
      prompt_chars_p95: quantile(results.map((item) => item.provider_prompt_chars), 0.95),
      key_pool_size_latest: [...results].reverse().find((item) => item.provider_key_pool_size)?.provider_key_pool_size || null,
      key_slots_used: [...new Set(results.map((item) => item.provider_key_slot).filter((value) => value !== null && value !== undefined && value !== ""))],
      key_rotation_attempt_count: results.reduce((sum, item) => sum + Number(item.provider_key_rotation_attempts || 0), 0),
      key_rotation_card_count: results.filter((item) => item.provider_key_rotation_attempted === true).length,
      diagnostics_missing_count: results.filter((item) => item.input_tokens === null && item.output_tokens === null && item.provider_latency_ms === null).length,
      latest_remaining_requests: [...results].reverse().find((item) => item["x-ratelimit-remaining-requests"])?.["x-ratelimit-remaining-requests"] || null,
      latest_remaining_tokens: [...results].reverse().find((item) => item["x-ratelimit-remaining-tokens"])?.["x-ratelimit-remaining-tokens"] || null
    },
    l1_accuracy_proxy: {
      note: "L1 is internal scout only; use final_accuracy_proxy for writer-visible title quality.",
      writer_visible_title_count: results.filter((item) => cleanText(item.l1_title)).length,
      raw_token_recall_avg: average(l1Raw),
      fair_token_recall_avg: average(l1Fair),
      policy_fair_token_recall_avg: average(l1Policy),
      raw_pass_at_0_72: countPass(l1Raw, 0.72),
      fair_pass_at_0_72: countPass(l1Fair, 0.72),
      policy_fair_pass_at_0_72: countPass(l1Policy, 0.72),
      policy_fair_pass_at_0_80: countPass(l1Policy, 0.8)
    },
    final_accuracy_proxy: {
      raw_token_recall_avg: average(finalRaw),
      fair_token_recall_avg: average(finalFair),
      policy_fair_token_recall_avg: average(finalPolicy),
      raw_pass_at_0_72: countPass(finalRaw, 0.72),
      fair_pass_at_0_72: countPass(finalFair, 0.72),
      policy_fair_pass_at_0_72: countPass(finalPolicy, 0.72),
      policy_fair_pass_at_0_80: countPass(finalPolicy, 0.8)
    },
    accuracy_reference: {
      reviewed_title_ground_truth_count: results.filter((item) => item.reference_title_is_reviewed_ground_truth === true).length,
      marketplace_weak_label_count: results.filter((item) => item.reference_title_type === "MARKETPLACE_WEAK_LABEL").length,
      missing_reference_count: results.filter((item) => !cleanText(item.reference_title)).length,
      all_attempts_have_reviewed_title_ground_truth: results.length > 0
        && results.every((item) => item.reference_title_is_reviewed_ground_truth === true)
    },
    reviewed_title_policy_acceptance: {
      eligible: results.length > 0
        && results.every((item) => item.reference_title_is_reviewed_ground_truth === true),
      correct: countPass(finalPolicy, 0.72),
      total: results.length,
      rate: results.length > 0
        && results.every((item) => item.reference_title_is_reviewed_ground_truth === true)
        ? Number((countPass(finalPolicy, 0.72) / results.length).toFixed(6))
        : null,
      threshold: 0.72,
      boundary: "reviewed title-level acceptance; not field-level card exact"
    },
    serial_title_analysis: {
      reference_serial_cards: results.filter((item) => item.final_scoring?.serial_number_title_analysis?.reference_serial_count > 0).length,
      exact_match_count: results.reduce((sum, item) => sum + Number(item.final_scoring?.serial_number_title_analysis?.exact_match_count || 0), 0),
      denominator_match_count: results.reduce((sum, item) => sum + Number(item.final_scoring?.serial_number_title_analysis?.denominator_match_count || 0), 0),
      numerator_omission_count: results.reduce((sum, item) => sum + Number(item.final_scoring?.serial_number_title_analysis?.numerator_omission_count || 0), 0),
      missing_count: results.reduce((sum, item) => sum + Number(item.final_scoring?.serial_number_title_analysis?.missing_count || 0), 0)
    }
  };
}

function tsvEscape(value) {
  return String(value ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

export function perCardTsv(results = []) {
  const columns = [
    "asset_id",
    "ok",
    "l1_ok",
    "l1_job_status",
    "writer_ready",
    "writer_review_required",
    "preingestion_used",
    "preingestion_ok",
    "preingestion_http_status",
    "preingestion_ms",
    "preingestion_bundle_id",
    "preingestion_bundle_status",
    "preingestion_worker_jobs",
    "preingestion_signed_urls",
    "preingestion_signed_url_errors",
    "preingestion_error",
    "l1_ms",
    "l1_internal_scout_ms",
    "l1_safe_ms",
    "cache",
    "l2_ready",
    "writer_ready_ms",
    "queue_mode",
    "batch_poll_mode",
    "batch_id",
    "tenant_id",
    "preparation_ms",
    "enqueue_ms",
    "enqueue_persistence_mode",
    "worker_queue_wait_ms",
    "paired_l1_wait_ms",
    "scheduler_queue_wait_ms",
    "recognition_started_at",
    "recognition_start_source",
    "writer_visible_recognition_ms",
    "worker_processing_ms",
    "l1_policy_fair",
    "final_policy_fair",
    "catalog_prompt",
    "vector_prompt",
    "l2_catalog_raw",
    "l2_catalog_approved",
    "l2_catalog_blocked",
    "l2_catalog_prompt",
    "l2_vector_raw",
    "l2_vector_approved",
    "l2_vector_blocked",
    "l2_vector_prompt",
    "vector_status",
    "vector_status_code",
    "vector_unavailable_reasons",
    "vector_worker_status",
    "vector_worker_reason",
    "vector_worker_feature_count",
    "vector_worker_latency_ms",
    "vector_worker_attempt_count",
    "vector_query_embedding_role",
    "vector_role_fallback",
    "vector_role_fallback_reason",
    "vector_returned_rows",
    "vector_self_excluded",
    "vector_self_exclusion_query_attempted",
    "vector_self_exclusion_filter_active",
    "vector_self_exclusion_requested_source_count",
    "vector_self_exclusion_source_ids_sha256",
    "node_ledger_present",
    "node_anomaly_count",
    "node_error_count",
    "node_warning_count",
    "missing_required_node_count",
    "unexplained_resolution_drop_fields",
    "unexplained_terminal_drop_fields",
    "v4_pipeline_contract_present",
    "v4_pipeline_contract_status",
    "v4_pipeline_bridged_stage_count",
    "v4_pipeline_bridged_stages",
    "v4_pipeline_violation_count",
    "v4_pipeline_migration_complete",
    "shadow_policy_present",
    "shadow_policy_can_execute",
    "shadow_policy_observation_point",
    "shadow_hard_invariants_feasible",
    "shadow_hard_invariants_complete",
    "shadow_next_action",
    "shadow_stop_safe",
    "shadow_global_risk",
    "shadow_critical_risk",
    "shadow_direct_conflict_count",
    "shadow_completed_actions",
    "shadow_feasible_actions",
    "provider_response_profile",
    "provider_prompt_mode",
    "provider_prompt_chars",
    "input_tokens",
    "output_tokens",
    "total_tokens",
    "provider_latency_ms",
    "provider_key_pool_size",
    "provider_key_slot",
    "provider_key_source",
    "provider_key_rotation_attempted",
    "provider_key_rotation_attempts",
    "x-ratelimit-limit-requests",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-limit-tokens",
    "x-ratelimit-remaining-tokens",
    "x-ratelimit-reset-requests",
    "x-ratelimit-reset-tokens",
    "l1_title",
    "final_title",
    "reference_title_type",
    "reference_title_is_reviewed_ground_truth",
    "reference_title",
    "seller_title"
  ];
  const rows = results.map((item) => [
    item.asset_id,
    item.ok,
    item.l1_ok,
    item.l1_job_status,
    item.writer_ready,
    item.writer_review_required,
    item.preingestion_used,
    item.preingestion_ok,
    item.preingestion_http_status,
    item.preingestion_latency_ms,
    item.preingestion_bundle_id,
    item.preingestion_bundle_status,
    item.preingestion_worker_jobs_enqueued,
    item.preingestion_signed_read_url_count,
    item.preingestion_signed_read_url_error_count,
    item.preingestion_error,
    item.l1_wall_latency_ms,
    item.l1_internal_scout_ms,
    item.l1_time_to_safe_draft_ms,
    item.fast_scout_cache_status,
    item.l2_ready,
    item.time_to_writer_ready_ms,
    item.queue_mode,
    item.batch_poll_mode,
    item.batch_id,
    item.tenant_id,
    item.preparation_latency_ms,
    item.enqueue_latency_ms,
    item.enqueue_persistence_mode,
    item.worker_queue_wait_ms,
    item.paired_l1_wait_ms,
    item.scheduler_queue_wait_ms,
    item.recognition_started_at,
    item.recognition_start_source,
    item.writer_visible_recognition_ms,
    item.worker_processing_ms,
    item.l1_scoring?.policy_fair_token_recall,
    item.final_scoring?.policy_fair_token_recall,
    item.catalog_prompt_candidate_count,
    item.vector_prompt_candidate_count,
    item.l2_catalog_raw_candidate_count,
    item.l2_catalog_approved_candidate_count,
    item.l2_catalog_conflict_blocked_count,
    item.l2_catalog_prompt_candidate_count,
    item.l2_vector_raw_candidate_count,
    item.l2_vector_approved_candidate_count,
    item.l2_vector_conflict_blocked_count,
    item.l2_vector_prompt_candidate_count,
    item.vector_runtime_status,
    item.vector_runtime_status_code,
    item.vector_runtime_unavailable_reasons,
    item.vector_worker_status,
    item.vector_worker_reason,
    item.vector_worker_feature_count,
    item.vector_worker_latency_ms,
    item.vector_worker_attempt_count,
    item.vector_query_embedding_role,
    item.vector_role_agnostic_fallback_used,
    item.vector_role_agnostic_fallback_reason,
    item.vector_returned_row_count,
    item.vector_self_excluded_count,
    item.vector_self_exclusion_query_attempted,
    item.vector_self_exclusion_filter_active,
    item.vector_self_exclusion_requested_source_count,
    item.vector_self_exclusion_source_ids_sha256,
    Boolean(item.pipeline_node_ledger),
    item.pipeline_node_ledger?.reconciliation?.anomaly_count ?? null,
    item.pipeline_node_ledger?.reconciliation?.error_count ?? null,
    item.pipeline_node_ledger?.reconciliation?.warning_count ?? null,
    item.pipeline_node_ledger?.coverage?.missing_required_node_count ?? null,
    item.pipeline_node_ledger?.field_flow?.unexplained_resolution_drop_fields || [],
    item.pipeline_node_ledger?.field_flow?.unexplained_terminal_drop_fields || [],
    Boolean(item.v4_pipeline_contract),
    item.v4_pipeline_contract?.contract_status ?? null,
    item.v4_pipeline_contract?.bridged_stage_count ?? null,
    item.v4_pipeline_contract?.bridged_stages || [],
    item.v4_pipeline_contract?.violations?.length ?? null,
    item.v4_pipeline_contract?.migration_complete ?? null,
    Boolean(item.v4_pipeline_contract?.shadow_recognition_policy),
    item.v4_pipeline_contract?.shadow_recognition_policy?.can_execute ?? null,
    item.v4_pipeline_contract?.shadow_recognition_policy?.observation_point ?? null,
    item.v4_pipeline_contract?.shadow_recognition_policy?.state?.invariants?.feasible ?? null,
    item.v4_pipeline_contract?.shadow_recognition_policy?.state?.invariants?.complete ?? null,
    item.v4_pipeline_contract?.shadow_recognition_policy?.decision?.next_action ?? null,
    item.v4_pipeline_contract?.shadow_recognition_policy?.decision?.current_stop_risk?.safe_to_stop ?? null,
    item.v4_pipeline_contract?.shadow_recognition_policy?.decision?.current_stop_risk?.global_risk ?? null,
    item.v4_pipeline_contract?.shadow_recognition_policy?.decision?.current_stop_risk?.critical_field_risk ?? null,
    item.v4_pipeline_contract?.shadow_recognition_policy?.decision?.current_stop_risk?.direct_conflict_count ?? null,
    item.v4_pipeline_contract?.shadow_recognition_policy?.state?.completed_actions || [],
    item.v4_pipeline_contract?.shadow_recognition_policy?.decision?.feasible_actions || [],
    item.provider_response_profile,
    item.provider_prompt_mode,
    item.provider_prompt_chars,
    item.input_tokens,
    item.output_tokens,
    item.total_tokens,
    item.provider_latency_ms,
    item.provider_key_pool_size,
    item.provider_key_slot,
    item.provider_key_source,
    item.provider_key_rotation_attempted,
    item.provider_key_rotation_attempts,
    item["x-ratelimit-limit-requests"],
    item["x-ratelimit-remaining-requests"],
    item["x-ratelimit-limit-tokens"],
    item["x-ratelimit-remaining-tokens"],
    item["x-ratelimit-reset-requests"],
    item["x-ratelimit-reset-tokens"],
    item.l1_title,
    item.final_title,
    item.reference_title_type,
    item.reference_title_is_reviewed_ground_truth,
    item.reference_title,
    item.seller_title
  ].map(tsvEscape).join("\t"));
  return `${columns.join("\t")}\n${rows.join("\n")}\n`;
}

export async function runV4EbaySmoke({
  datasetPath,
  sealedLabelsPath,
  baseUrl,
  username,
  password,
  limit = 10,
  offset = 0,
  prewarm = false,
  prewarmCacheOnly = true,
  queueMode = false,
  forceL2Direct = false,
  modelOverride = "",
  enableL1 = false,
  compactL2 = false,
  ultraFastL2 = null,
  fastInitialPrompt = null,
  ultraSparseTransport = false,
  providerDoneHandoff = null,
  ultraFastImageDetail = "auto",
  ultraFastServiceTier = "",
  disableIdentityCache = false,
  usePreingestion = false,
  preingestionSource = "v4_ebay_smoke_preingestion",
  speculative = false,
  thinkMs = 6000,
  l2WaitMs = 18000,
  requestTimeoutMs = 90000,
  concurrency = 2,
  submissionConcurrency = null,
  preparationConcurrency = null,
  tenantCount = 1,
  tenantPrefix = "",
  batchPoll = true,
  batchId = "",
  resumeBatchId = "",
  evaluationSampleMode = "UNSPECIFIED",
  coldStartBlind = false,
  verifiedAssetCachePath = "",
  verifiedAssetCacheMode = "disabled",
  outPath = "",
  progress = true
} = {}) {
  if (!datasetPath) throw new Error("--dataset is required");
  if (!baseUrl) throw new Error("--base-url is required");
  if (!username || !password) throw new Error("--username and --password are required");
  const normalizedSampleMode = normalizeEvaluationSampleMode(evaluationSampleMode);
  const normalizedTenantCount = Math.max(1, Math.min(50, Math.trunc(Number(tenantCount) || 1)));
  const normalizedSubmissionConcurrency = Math.max(
    1,
    Math.min(24, Math.trunc(Number(submissionConcurrency ?? concurrency) || 1))
  );
  const normalizedPreparationConcurrency = Math.max(
    1,
    Math.min(24, Math.trunc(Number(preparationConcurrency ?? 3) || 1))
  );
  const normalizedVerifiedAssetCacheMode = normalizeVerifiedAssetCacheMode(verifiedAssetCacheMode);
  if (normalizedVerifiedAssetCacheMode !== "disabled" && !cleanText(verifiedAssetCachePath)) {
    throw new Error("verifiedAssetCachePath is required when verified asset cache is enabled");
  }
  const dataset = await readDataset(datasetPath);
  const datasetSamplePolicy = Array.isArray(dataset) ? null : dataset.evaluation_sample_policy || null;
  const sampleProvenance = assertEvaluationSampleProvenance({
    requestedMode: normalizedSampleMode,
    datasetPolicy: datasetSamplePolicy
  });
  const items = loadDatasetItems(dataset).slice(Math.max(0, offset), Math.max(0, offset) + Math.max(1, limit));
  if (!items.length) throw new Error("dataset slice has no items");
  const assetCacheEntries = normalizedVerifiedAssetCacheMode === "disabled"
    ? new Map()
    : await readVerifiedAssetCache(verifiedAssetCachePath);
  const cookie = await login({ baseUrl, username, password });
  let executionControlSnapshot = null;
  let executionControlError = null;
  try {
    const statusResponse = await getJson({
      baseUrl,
      path: "/api/listing-provider-status",
      cookie,
      requestTimeoutMs: Math.min(requestTimeoutMs, 30_000)
    });
    if (statusResponse.ok && statusResponse.data?.execution_control) {
      const control = statusResponse.data.execution_control;
      executionControlSnapshot = {
        provider_key_pool_size: control.provider_key_pool_size ?? null,
        per_key_stable_concurrency: control.per_key_stable_concurrency ?? null,
        global_provider_concurrency: control.global_provider_concurrency ?? null,
        queue_submission_concurrency: control.queue_submission_concurrency ?? null,
        stage_capacity: control.stage_capacity || null
      };
    } else {
      executionControlError = `provider_status_http_${statusResponse.http_status || "unknown"}`;
    }
  } catch (error) {
    executionControlError = cleanText(error?.message || error).slice(0, 200) || "provider_status_unavailable";
  }
  const runStartedAt = Date.now();
  let recognitionResults = [];
  let batchPollMetrics = null;
  let sharedBatchId = null;
  const batchPollProviderConcurrency = Math.max(
    1,
    Math.trunc(Number(executionControlSnapshot?.global_provider_concurrency) || Number(concurrency) || 1)
  );
  const effectiveBatchPollWaitMs = batchPollWaitBudgetMs({
    requestedWaitMs: l2WaitMs,
    itemCount: items.length,
    providerConcurrency: batchPollProviderConcurrency
  });
  if (queueMode && speculative && batchPoll) {
    sharedBatchId = cleanText(resumeBatchId) || cleanText(batchId) || `smoke-v4-batch-${Date.now()}`;
    let prepared;
    if (resumeBatchId) {
      const existingJobs = await loadExistingBatchJobs({
        baseUrl,
        cookie,
        batchId: sharedBatchId,
        requestTimeoutMs
      });
      const finalJobsByAsset = new Map(existingJobs
        .filter((job) => job.job_type === "FINAL_ASSISTED_TITLE")
        .map((job) => [job.asset_id, job]));
      prepared = items.map((item, localIndex) => {
        const index = offset + localIndex;
        const assetId = candidateId(item, index);
        const job = finalJobsByAsset.get(assetId) || null;
        return {
          asset_id: assetId,
          index,
          item,
          batch_id: sharedBatchId,
          tenant_id: job?.tenant_id || smokeTenantId({
            batchId: sharedBatchId,
            tenantPrefix,
            tenantCount: normalizedTenantCount,
            index: localIndex
          }),
          job,
          l1_job: null,
          enqueue: null,
          enqueue_latency_ms: null,
          preparation_latency_ms: null,
          preingestion: null,
          prewarm: null,
          error: job ? null : "resume_batch_job_missing"
        };
      });
      if (progress) process.stderr.write(`v4 ebay smoke resume batch=${sharedBatchId} matched=${prepared.filter((row) => row.job).length}/${items.length}\n`);
    } else {
      const verificationCache = new Map();
      const enqueueGate = createConcurrencyGate(normalizedSubmissionConcurrency);
      const sourceFingerprints = await Promise.all(items.map((item, localIndex) => (
        durableSourceFingerprint(item, offset + localIndex)
      )));
      const prepareOne = async (item, localIndex, { recovery = false } = {}) => {
        const index = offset + localIndex;
        const sourceFingerprint = sourceFingerprints[localIndex];
        const cachedAssetEntry = !recovery && normalizedVerifiedAssetCacheMode === "reuse"
          ? assetCacheEntries.get(sourceFingerprint) || null
          : null;
        if (progress) process.stderr.write(`v4 ebay smoke ${recovery ? "recover" : "enqueue"} ${localIndex + 1}/${items.length} asset=${candidateId(item, index)} batch=${sharedBatchId}\n`);
        const row = await enqueueSpeculativeItem({
          item,
          index,
          batchId: sharedBatchId,
          tenantId: smokeTenantId({
            batchId: sharedBatchId,
            tenantPrefix,
            tenantCount: normalizedTenantCount,
            index: localIndex
          }),
          baseUrl,
          cookie,
          prewarm,
          prewarmCacheOnly,
          modelOverride,
          enableL1,
          compactL2,
          ultraFastL2,
          fastInitialPrompt,
          ultraSparseTransport,
          providerDoneHandoff,
          ultraFastImageDetail,
          ultraFastServiceTier,
          disableIdentityCache,
          coldStartBlind,
          usePreingestion,
          preingestionSource,
          requestTimeoutMs,
          verificationCache,
          sourceFingerprint,
          cachedAssetEntry,
          enqueueGate
        });
        row.preparation_recovery_attempted = recovery;
        if (progress) process.stderr.write(`  enqueued=${Boolean(row.job?.job_id)} prepare=${row.preparation_latency_ms}ms error=${row.error || "none"}\n`);
        return row;
      };
      prepared = await mapWithConcurrency(items, normalizedPreparationConcurrency, (item, localIndex) => (
        prepareOne(item, localIndex)
      ));
      const failedIndexes = prepared
        .map((row, localIndex) => row?.job?.job_id ? null : localIndex)
        .filter((localIndex) => localIndex !== null);
      if (failedIndexes.length && durableUploadResilienceContract.preparation_recovery_rounds > 0) {
        for (const localIndex of failedIndexes) {
          if (prepared[localIndex]?.preparation_diagnostics?.asset_cache_hit === true) {
            assetCacheEntries.delete(sourceFingerprints[localIndex]);
          }
        }
        if (progress) process.stderr.write(`v4 ebay smoke bounded recovery missing=${failedIndexes.length}/${items.length}\n`);
        const recoveredRows = await mapWithConcurrency(
          failedIndexes,
          durableUploadResilienceContract.preparation_recovery_concurrency,
          (localIndex) => prepareOne(items[localIndex], localIndex, { recovery: true })
        );
        failedIndexes.forEach((localIndex, recoveryIndex) => {
          prepared[localIndex] = recoveredRows[recoveryIndex];
        });
      }
      if (normalizedVerifiedAssetCacheMode !== "disabled") {
        for (const row of prepared) {
          const entry = row?.asset_cache_entry;
          if (entry?.fingerprint && entry?.asset_id) assetCacheEntries.set(entry.fingerprint, entry);
        }
        await writeVerifiedAssetCache(verifiedAssetCachePath, assetCacheEntries);
      }
    }
    sharedBatchId = canonicalBatchIdForPoll(prepared, sharedBatchId);
    batchPollMetrics = await pollBatchJobs({
      baseUrl,
      cookie,
      batchId: sharedBatchId,
      expectedJobIds: prepared.map((row) => row.job?.job_id).filter(Boolean),
      waitMs: effectiveBatchPollWaitMs,
      requestTimeoutMs,
      progress
    });
    recognitionResults = prepared.map((row) => resultFromBatchJob(row, batchPollMetrics, thinkMs));
  } else {
    recognitionResults = await mapWithConcurrency(items, normalizedSubmissionConcurrency, async (item, localIndex) => {
      const index = offset + localIndex;
      if (progress) process.stderr.write(`v4 ebay smoke ${localIndex + 1}/${items.length} asset=${candidateId(item, index)} prewarm=${prewarm} preingestion=${usePreingestion} queue=${queueMode} force_l2_direct=${forceL2Direct}\n`);
      try {
        const row = await runOne({
          item,
          index,
          baseUrl,
          cookie,
          prewarm,
          prewarmCacheOnly,
          queueMode,
          forceL2Direct,
          modelOverride,
          enableL1,
          compactL2,
          ultraFastL2,
          fastInitialPrompt,
          ultraSparseTransport,
          providerDoneHandoff,
          ultraFastImageDetail,
          ultraFastServiceTier,
          disableIdentityCache,
          coldStartBlind,
          usePreingestion,
          preingestionSource,
          speculative,
          thinkMs,
          l2WaitMs,
          requestTimeoutMs
        });
        if (progress) process.stderr.write(`  ok=${row.ok} l1=${row.l1_wall_latency_ms}ms cache=${row.fast_scout_cache_status || "n/a"} title=${row.final_title}\n`);
        return row;
      } catch (error) {
        return {
          asset_id: candidateId(item, index),
          ok: false,
          writer_ready: false,
          error: String(error?.message || error || "run_one_failed").slice(0, 240),
          final_title: "",
          final_scoring: null
        };
      }
    });
  }
  const recognitionRunWallMs = Date.now() - runStartedAt;
  const diagnosticHydration = queueMode
    ? await hydrateV4JobDiagnostics({
      results: recognitionResults,
      baseUrl,
      cookie,
      requestTimeoutMs,
      concurrency: Math.min(4, normalizedSubmissionConcurrency)
    })
    : {
      results: recognitionResults,
      metrics: {
        requested_count: 0,
        hydrated_count: 0,
        failed_count: 0,
        duration_ms: 0,
        excluded_from_recognition_wall_time: true
      }
    };
  recognitionResults = diagnosticHydration.results;
  const predictionsSha256 = predictionHash(recognitionResults);
  const sealedLabels = await readSealedLabels(sealedLabelsPath);
  const results = attachPostRecognitionScoring(recognitionResults, items, sealedLabels, offset);
  const allReviewedTitleGroundTruth = results.length > 0
    && results.every((row) => row.reference_title_is_reviewed_ground_truth === true);
  const observedUltraFastL2Count = results.filter((item) => item.provider_prompt_mode === "v4_ultra_fast_l2").length;
  const report = {
    schema_version: "v4-ebay-smoke-v1",
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    dataset_path: datasetPath,
    sealed_labels_path: sealedLabelsPath || null,
    limit,
    offset,
    concurrency,
    submission_concurrency: normalizedSubmissionConcurrency,
    preparation_concurrency: normalizedPreparationConcurrency,
    verified_asset_cache: {
      mode: normalizedVerifiedAssetCacheMode,
      path: cleanText(verifiedAssetCachePath) ? resolve(verifiedAssetCachePath) : null,
      hit_count: results.filter((item) => item.preparation_cache_hit === true).length,
      miss_count: results.filter((item) => item.preparation_cache_hit !== true).length,
      upload_skipped_count: results.filter((item) => item.upload_skipped_due_to_verified_asset_cache === true).length
    },
    durable_upload_resilience_contract: durableUploadResilienceContract,
    provider_concurrency: numberOrNull(executionControlSnapshot?.global_provider_concurrency),
    execution_control_snapshot: executionControlSnapshot,
    execution_control_error: executionControlError,
    tenant_count: normalizedTenantCount,
    tenant_prefix: cleanText(tenantPrefix) || null,
    batch_poll_enabled: Boolean(queueMode && speculative && batchPoll),
    shared_batch_id: sharedBatchId,
    resumed_batch_id: resumeBatchId || null,
    batch_poll_metrics: batchPollMetrics ? {
      requested_wait_ms: l2WaitMs,
      effective_wait_ms: effectiveBatchPollWaitMs,
      provider_concurrency: batchPollProviderConcurrency,
      estimated_provider_waves: Math.ceil(items.length / batchPollProviderConcurrency),
      polls: batchPollMetrics.polls,
      elapsed_ms: batchPollMetrics.elapsed_ms,
      completed_count: batchPollMetrics.completed_count,
      expected_count: batchPollMetrics.expected_count,
      http_status_breakdown: batchPollMetrics.http_status_breakdown,
      max_consecutive_errors: batchPollMetrics.max_consecutive_errors,
      transient_error_count: batchPollMetrics.transient_error_count,
      last_error: batchPollMetrics.last_error,
      fatal_error: batchPollMetrics.fatal_error
    } : null,
    run_wall_ms: recognitionRunWallMs,
    diagnostic_hydration: diagnosticHydration.metrics,
    prewarm_enabled: prewarm,
    compact_l2_enabled: compactL2,
    ultra_fast_l2_override: ultraFastL2,
    fast_initial_prompt_override: fastInitialPrompt,
    ultra_fast_l2_observed_count: observedUltraFastL2Count,
    ultra_fast_l2_effective: observedUltraFastL2Count === results.length
      ? true
      : observedUltraFastL2Count === 0
        ? false
        : "mixed",
    ultra_fast_l2_enabled: observedUltraFastL2Count === results.length
      ? true
      : observedUltraFastL2Count === 0
        ? false
        : null,
    ultra_sparse_transport_enabled: ultraSparseTransport,
    provider_done_capacity_handoff_override: providerDoneHandoff,
    ultra_fast_image_detail: ultraFastL2 === true ? ultraFastImageDetail : null,
    ultra_fast_service_tier: ultraFastL2 === true ? ultraFastServiceTier || null : null,
    identity_cache_disabled: disableIdentityCache,
    prewarm_cache_only: prewarm ? prewarmCacheOnly : null,
    queue_mode: queueMode,
    speculative_mode: speculative,
    think_ms: speculative ? thinkMs : null,
    force_l2_direct: forceL2Direct,
    l1_explicitly_enabled: enableL1,
    preingestion_enabled: usePreingestion,
    preingestion_source: usePreingestion ? preingestionSource : null,
    model_override: modelOverride || null,
    cold_start_blind: coldStartBlind === true,
    predictions_sha256: predictionsSha256,
    evaluation_sample_policy: {
      mode: normalizedSampleMode,
      sample_reuse_permitted: ["FIXED_REGRESSION", "PAIRED_ABLATION", "CONCURRENCY_FRESH"].includes(normalizedSampleMode),
      generalization_claim_permitted: ["FRESH_GENERALIZATION", "CONCURRENCY_FRESH"].includes(normalizedSampleMode),
      same_sample_required: ["PAIRED_ABLATION", "CONCURRENCY_FRESH"].includes(normalizedSampleMode),
      reuse_reason: datasetSamplePolicy?.reuse_reason || null,
      reuse_scope_id: datasetSamplePolicy?.reuse_scope_id || null,
      reuse_policy_complete: datasetSamplePolicy?.reuse_policy_complete === true,
      provenance_required: sampleProvenance.required,
      provenance_verified: sampleProvenance.verified,
      evaluated_item_count: items.length,
      evaluated_item_ids_sha256: evaluationItemSetSha256(items.map((item, index) => {
        const sealedLabel = sealedLabelForItem(item, offset + index, sealedLabels);
        return sealedLabel?.item_id
          || item.source_feedback_id
          || item.source_record?.sealed_eval_label_key
          || candidateId(item, offset + index);
      })),
      dataset_provenance: datasetSamplePolicy
    },
    blind_policy: {
      seller_title_visible_to_model: false,
      seller_title_used_for_local_eval_only: true,
      seller_title_is_ground_truth: false,
      reviewed_title_visible_to_model: false,
      recognition_phase_loaded_sealed_labels: false,
      predictions_frozen_before_scoring: true
    },
    accuracy_policy: {
      corrected_title_is_reviewed_title_ground_truth: allReviewedTitleGroundTruth,
      corrected_title_as_reviewed_title_gt: allReviewedTitleGroundTruth,
      reviewed_title_ground_truth_count: results.filter((row) => row.reference_title_is_reviewed_ground_truth === true).length,
      marketplace_title_is_weak_label_only: results.some((row) => row.reference_title_type === "MARKETPLACE_WEAK_LABEL"),
      field_ground_truth_available: false,
      title_acceptance_threshold: 0.72
    },
    summary: summarize(results, { runWallMs: recognitionRunWallMs }),
    results
  };
  if (outPath) {
    await writeJson(outPath, report);
    await writeText(outPath.replace(/\.json$/i, ".tsv"), perCardTsv(results));
  }
  return report;
}

export async function hydrateV4SmokeReport({
  report = {},
  baseUrl,
  username,
  password,
  requestTimeoutMs = 90000,
  concurrency = 4
} = {}) {
  if (!baseUrl) throw new Error("baseUrl is required");
  if (!username || !password) throw new Error("username and password are required");
  const cookie = await login({ baseUrl, username, password });
  const hydration = await hydrateV4JobDiagnostics({
    results: Array.isArray(report.results) ? report.results : [],
    baseUrl,
    cookie,
    requestTimeoutMs,
    concurrency
  });
  return {
    ...report,
    generated_at: new Date().toISOString(),
    diagnostic_hydration: hydration.metrics,
    summary: summarize(hydration.results, { runWallMs: report.run_wall_ms ?? report.summary?.run_wall_ms ?? null }),
    results: hydration.results
  };
}

export async function main(argv = process.argv, env = process.env) {
  const stamp = nowStamp();
  const outPath = argValue(argv, "--out", `data/eval/workflow-sidecar-smoke/v4-ebay-smoke-${stamp}.json`);
  const report = await runV4EbaySmoke({
    datasetPath: argValue(argv, "--dataset", env.V4_EBAY_SMOKE_DATASET || "data/eval/ebay-reference/ebay-c100-cloud-eval-dataset-20260707.json"),
    sealedLabelsPath: argValue(argv, "--sealed-labels", env.V4_EBAY_SMOKE_SEALED_LABELS || "data/eval/ebay-reference/ebay-c100-sealed-labels-20260707.jsonl"),
    baseUrl: cleanText(argValue(argv, "--base-url", env.V4_EBAY_SMOKE_BASE_URL || env.API_BASE_URL || "https://listing.lyncafei.team")).replace(/\/+$/, ""),
    username: cleanText(argValue(argv, "--username", env.METAVERSE_USERNAME || "")),
    password: cleanText(argValue(argv, "--password", env.METAVERSE_PASSWORD || "")),
    limit: Math.max(1, Math.trunc(numberArg(argv, "--limit", 10))),
    offset: Math.max(0, Math.trunc(numberArg(argv, "--offset", 0))),
    prewarm: hasFlag(argv, "--prewarm"),
    prewarmCacheOnly: !hasFlag(argv, "--paid-prewarm"),
    queueMode: hasFlag(argv, "--queue"),
    forceL2Direct: hasFlag(argv, "--force-l2-direct"),
    enableL1: hasFlag(argv, "--enable-l1"),
    compactL2: hasFlag(argv, "--compact-l2"),
    ultraFastL2: ultraFastL2Override(argv),
    fastInitialPrompt: fastInitialPromptOverride(argv),
    ultraSparseTransport: hasFlag(argv, "--ultra-sparse-v2"),
    providerDoneHandoff: providerDoneHandoffOverride(argv),
    ultraFastImageDetail: cleanText(argValue(argv, "--ultra-image-detail", "auto")).toLowerCase(),
    ultraFastServiceTier: cleanText(argValue(argv, "--ultra-service-tier", "")).toLowerCase(),
    disableIdentityCache: hasFlag(argv, "--disable-identity-cache"),
    usePreingestion: hasFlag(argv, "--use-preingestion"),
    preingestionSource: cleanText(argValue(argv, "--preingestion-source", "v4_ebay_smoke_preingestion")),
    speculative: hasFlag(argv, "--speculative"),
    thinkMs: Math.max(0, Math.trunc(numberArg(argv, "--think-ms", 6000))),
    modelOverride: cleanText(argValue(argv, "--model", env.V4_EBAY_SMOKE_MODEL_OVERRIDE || "")),
    l2WaitMs: Math.max(0, Math.trunc(numberArg(argv, "--l2-wait-ms", 18000))),
    requestTimeoutMs: Math.max(10000, Math.trunc(numberArg(argv, "--request-timeout-ms", 90000))),
    concurrency: Math.max(1, Math.trunc(numberArg(argv, "--concurrency", 2))),
    submissionConcurrency: argv.some((arg) => arg === "--submission-concurrency" || arg.startsWith("--submission-concurrency="))
      ? Math.max(1, Math.trunc(numberArg(argv, "--submission-concurrency", 2)))
      : null,
    preparationConcurrency: Math.max(1, Math.trunc(numberArg(argv, "--preparation-concurrency", 2))),
    tenantCount: Math.max(1, Math.trunc(numberArg(argv, "--tenant-count", 1))),
    tenantPrefix: cleanText(argValue(argv, "--tenant-prefix", "")),
    batchPoll: !hasFlag(argv, "--per-card-poll"),
    resumeBatchId: cleanText(argValue(argv, "--resume-batch-id", "")),
    evaluationSampleMode: cleanText(argValue(argv, "--sample-mode", "UNSPECIFIED")),
    coldStartBlind: hasFlag(argv, "--cold-start-blind"),
    verifiedAssetCachePath: cleanText(argValue(argv, "--verified-asset-cache", "")),
    verifiedAssetCacheMode: cleanText(argValue(argv, "--verified-asset-cache-mode", "disabled")),
    outPath,
    progress: !hasFlag(argv, "--quiet")
  });
  process.stdout.write([
    `v4 ebay smoke completed`,
    `report_json: ${resolve(outPath)}`,
    `report_tsv: ${resolve(outPath.replace(/\.json$/i, ".tsv"))}`,
    `attempted: ${report.summary.attempted_count}`,
    `ok: ${report.summary.ok_count}`,
    `title_ready: ${report.summary.title_ready_count}`,
    `writer_review_required: ${report.summary.writer_review_required_count}`,
    `l2_ready: ${report.summary.l2_ready_count}`,
    `l1_p50_ms: ${report.summary.l1_p50_ms}`,
    `l1_p95_ms: ${report.summary.l1_p95_ms}`,
    `preingestion_enabled: ${report.preingestion_enabled}`,
    `submission_concurrency: ${report.submission_concurrency}`,
    `preparation_concurrency: ${report.preparation_concurrency}`,
    `provider_concurrency: ${report.provider_concurrency ?? "unknown"}`,
    `compact_l2_enabled: ${report.compact_l2_enabled}`,
    `preingestion_ok: ${report.summary.preingestion_ok_count}/${report.summary.preingestion_used_count}`,
    `preingestion_p50_ms: ${report.summary.preingestion_p50_ms}`,
    `preingestion_p95_ms: ${report.summary.preingestion_p95_ms}`,
    `preingestion_worker_jobs_enqueued: ${report.summary.preingestion_worker_jobs_enqueued_count}`,
    `writer_ready_p50_ms: ${report.summary.writer_ready_p50_ms}`,
    `writer_ready_p95_ms: ${report.summary.writer_ready_p95_ms}`,
    `writer_visible_recognition_p50_ms: ${report.summary.writer_visible_recognition_p50_ms}`,
    `writer_visible_recognition_p95_ms: ${report.summary.writer_visible_recognition_p95_ms}`,
    `recognition_start_sources: ${JSON.stringify(report.summary.recognition_start_source_breakdown)}`,
    `speculative: ${report.summary.speculative_count}`,
    `speculative_fast_lane_hits: ${report.summary.speculative_fast_lane_hit_count}`,
    `pre_l2_anchor_fast_lane_hits: ${report.summary.pre_l2_anchor_fast_lane_hit_count}`,
    `pre_l2_anchor_probe_p50_ms: ${report.summary.pre_l2_anchor_probe_p50_ms}`,
    `pre_l2_anchor_probe_p95_ms: ${report.summary.pre_l2_anchor_probe_p95_ms}`,
    `pre_l2_anchor_patches: ${report.summary.pre_l2_anchor_patch_count}`,
    `pre_l2_anchor_candidates: ${report.summary.pre_l2_anchor_candidate_count} (direct=${report.summary.pre_l2_anchor_direct_candidate_count})`,
    `pre_l2_anchor_lookups: ${report.summary.pre_l2_anchor_lookup_attempted_count}`,
    `pre_l2_anchor_catalog_candidates: ${report.summary.pre_l2_anchor_catalog_candidate_count} (trusted=${report.summary.pre_l2_anchor_trusted_candidate_count}, eligible=${report.summary.pre_l2_anchor_eligible_candidate_count})`,
    `pre_l2_anchor_types: ${JSON.stringify(report.summary.pre_l2_anchor_type_breakdown)}`,
    `speculative_l2_done_before_click: ${report.summary.speculative_l2_done_before_click_count}`,
    `perceived_title_p50_ms: ${report.summary.perceived_title_p50_ms}`,
    `perceived_title_p95_ms: ${report.summary.perceived_title_p95_ms}`,
    `fast_scout_cache_hit_count: ${report.summary.fast_scout_cache_hit_count}`,
    `provider_input_tokens_total: ${report.summary.provider_diagnostics.input_tokens_total}`,
    `provider_output_tokens_total: ${report.summary.provider_diagnostics.output_tokens_total}`,
    `provider_latency_p50_ms: ${report.summary.provider_diagnostics.provider_latency_p50_ms}`,
    `provider_latency_p95_ms: ${report.summary.provider_diagnostics.provider_latency_p95_ms}`,
    `final_policy_fair_avg: ${report.summary.final_accuracy_proxy.policy_fair_token_recall_avg}`,
    `final_policy_fair_pass@0.72: ${report.summary.final_accuracy_proxy.policy_fair_pass_at_0_72}/${report.summary.attempted_count}`,
    `final_policy_fair_pass@0.80: ${report.summary.final_accuracy_proxy.policy_fair_pass_at_0_80}/${report.summary.attempted_count}`
  ].join("\n") + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`v4 ebay smoke failed: ${error.message}`);
    process.exit(1);
  });
}
