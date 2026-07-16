import { listingImageStorageReadiness } from "./storage-config.mjs";

const storageApiPrefix = "/storage/v1";
const listingAssetsRootPrefix = "listing-assets";
const defaultListPageSize = 1000;
const defaultDeleteBatchSize = 100;
const maxDeleteBatchSize = 500;
const maxListDepth = 6;

function normalizeStorageUrl(url) {
  return String(url || "").replace(/\/+$/, "");
}

function storageHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json"
  };
}

function positiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function retentionDaysFromEnv(env = process.env) {
  const parsed = Number(env.LISTING_IMAGE_RETENTION_DAYS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function assertStorageConfigured(config) {
  if (!config.configured) {
    throw new Error(`Listing image storage is not configured: ${config.missing.join(", ")}`);
  }
}

function readJsonResponse(response, providerLabel) {
  return response.text().then((text) => {
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${providerLabel} returned a non-JSON response.`);
    }
  });
}

function joinStoragePath(...parts) {
  return parts
    .map((part) => String(part || "").replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

function isoDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function listingImageRetentionCutoffDate({
  retentionDays,
  now = new Date()
} = {}) {
  const days = Number(retentionDays);
  if (!Number.isFinite(days) || days <= 0) return "";
  const cutoff = new Date(now.getTime() - Math.trunc(days) * 24 * 60 * 60 * 1000);
  return cutoff.toISOString().slice(0, 10);
}

export function datePrefixFromListingImageObjectPath(objectPath) {
  const match = String(objectPath || "").match(/^listing-assets\/(\d{4}-\d{2}-\d{2})(?:\/|$)/);
  return match?.[1] || "";
}

function isExpiredDatePrefix(datePrefix, cutoffDate) {
  return /^\d{4}-\d{2}-\d{2}$/.test(datePrefix) && datePrefix < cutoffDate;
}

function likelyFolder(row = {}) {
  if (row.id || row.metadata) return false;
  const name = String(row.name || "");
  return Boolean(name) && !/\.[a-z0-9]{2,5}$/i.test(name);
}

async function listStoragePrefix({
  config,
  prefix,
  fetchImpl,
  pageSize
}) {
  const storageUrl = `${normalizeStorageUrl(config.url)}${storageApiPrefix}`;
  const endpoint = `${storageUrl}/object/list/${encodeURIComponent(config.bucket)}`;
  const rows = [];

  for (let offset = 0; ; offset += pageSize) {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: storageHeaders(config.service_role_key),
      body: JSON.stringify({
        prefix,
        limit: pageSize,
        offset,
        sortBy: {
          column: "name",
          order: "asc"
        }
      })
    });
    const payload = await readJsonResponse(response, "Supabase Storage");
    if (!response.ok) {
      throw new Error(`Supabase storage list failed: ${response.status} ${String(payload.message || payload.error || "").slice(0, 180)}`);
    }

    const pageRows = Array.isArray(payload) ? payload : [];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) break;
  }

  return rows;
}

async function listObjectsRecursive({
  config,
  prefix,
  fetchImpl,
  pageSize,
  depth = 0
}) {
  if (depth > maxListDepth) return [];

  const rows = await listStoragePrefix({ config, prefix, fetchImpl, pageSize });
  const objects = [];

  for (const row of rows) {
    const name = String(row?.name || "").trim();
    if (!name || name.includes("..") || name.includes("/")) continue;
    const objectPath = joinStoragePath(prefix, name);

    if (likelyFolder(row)) {
      objects.push(...await listObjectsRecursive({
        config,
        prefix: objectPath,
        fetchImpl,
        pageSize,
        depth: depth + 1
      }));
      continue;
    }

    if (datePrefixFromListingImageObjectPath(objectPath)) {
      objects.push({
        object_path: objectPath,
        name,
        size: Number(row.metadata?.size || row.size || 0) || null,
        created_at: row.created_at || row.createdAt || null,
        updated_at: row.updated_at || row.updatedAt || null
      });
    }
  }

  return objects;
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function deleteStorageObjects({
  config,
  objectPaths,
  fetchImpl,
  deleteBatchSize
}) {
  const storageUrl = `${normalizeStorageUrl(config.url)}${storageApiPrefix}`;
  const endpoint = `${storageUrl}/object/${encodeURIComponent(config.bucket)}`;
  const deleted = [];

  for (const batch of chunk(objectPaths, deleteBatchSize)) {
    const response = await fetchImpl(endpoint, {
      method: "DELETE",
      headers: storageHeaders(config.service_role_key),
      body: JSON.stringify({
        prefixes: batch
      })
    });
    const payload = await readJsonResponse(response, "Supabase Storage");
    if (!response.ok) {
      throw new Error(`Supabase storage retention delete failed: ${response.status} ${String(payload.message || payload.error || "").slice(0, 180)}`);
    }
    deleted.push(...batch);
  }

  return deleted;
}

export async function planListingImageRetentionCleanup({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) {
  const retentionDays = retentionDaysFromEnv(env);
  if (!retentionDays) {
    return {
      enabled: false,
      skipped: true,
      reason: "LISTING_IMAGE_RETENTION_DAYS is not configured",
      retention_days: 0,
      cutoff_date: null,
      bucket: env.LISTING_IMAGE_BUCKET || "listing-card-images",
      expired_prefixes: [],
      object_count: 0,
      objects: []
    };
  }

  const config = listingImageStorageReadiness(env);
  assertStorageConfigured(config);
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is unavailable for listing image retention cleanup.");
  }

  const cutoffDate = listingImageRetentionCutoffDate({ retentionDays, now });
  const pageSize = positiveInteger(env.LISTING_IMAGE_RETENTION_LIST_PAGE_SIZE, defaultListPageSize, {
    min: 1,
    max: 10_000
  });
  const rootRows = await listStoragePrefix({
    config,
    prefix: listingAssetsRootPrefix,
    fetchImpl,
    pageSize
  });
  const expiredDatePrefixes = [...new Set(rootRows
    .map((row) => String(row?.name || "").trim())
    .filter((name) => isExpiredDatePrefix(name, cutoffDate))
    .sort())];
  const expiredPrefixes = expiredDatePrefixes.map((datePrefix) => `${listingAssetsRootPrefix}/${datePrefix}`);
  const objects = [];

  for (const prefix of expiredPrefixes) {
    objects.push(...await listObjectsRecursive({
      config,
      prefix,
      fetchImpl,
      pageSize
    }));
  }

  return {
    enabled: true,
    skipped: false,
    retention_days: retentionDays,
    cutoff_date: cutoffDate,
    bucket: config.bucket,
    expired_prefixes: expiredPrefixes,
    object_count: objects.length,
    objects
  };
}

export async function runListingImageRetentionCleanup({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = new Date(),
  dryRun = true
} = {}) {
  const plan = await planListingImageRetentionCleanup({ env, fetchImpl, now });
  if (plan.skipped) return { ...plan, dry_run: true, deleted_count: 0, deleted_objects: [] };

  const deleteBatchSize = positiveInteger(env.LISTING_IMAGE_RETENTION_DELETE_BATCH_SIZE, defaultDeleteBatchSize, {
    min: 1,
    max: maxDeleteBatchSize
  });
  const objectPaths = plan.objects.map((object) => object.object_path);

  if (dryRun || objectPaths.length === 0) {
    return {
      ...plan,
      dry_run: true,
      delete_batch_size: deleteBatchSize,
      deleted_count: 0,
      deleted_objects: []
    };
  }

  const deletedObjects = await deleteStorageObjects({
    config: listingImageStorageReadiness(env),
    objectPaths,
    fetchImpl,
    deleteBatchSize
  });

  return {
    ...plan,
    dry_run: false,
    delete_batch_size: deleteBatchSize,
    deleted_count: deletedObjects.length,
    deleted_objects: deletedObjects
  };
}

export function summarizeListingImageRetentionCleanup(result = {}) {
  return {
    enabled: Boolean(result.enabled),
    skipped: Boolean(result.skipped),
    reason: result.reason || null,
    dry_run: result.dry_run !== false,
    retention_days: result.retention_days || 0,
    cutoff_date: result.cutoff_date || null,
    bucket: result.bucket || null,
    expired_prefixes: result.expired_prefixes || [],
    object_count: result.object_count || 0,
    deleted_count: result.deleted_count || 0
  };
}
