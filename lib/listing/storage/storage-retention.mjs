import { supabaseServiceHeaders } from "../../supabase-service-headers.mjs";
import { listingImageStorageReadiness } from "./storage-config.mjs";

const storageApiPrefix = "/storage/v1";
const listingAssetsRootPrefix = "listing-assets";
const tenantObjectsRootPrefix = "tenants";
const tenantIdPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const defaultListPageSize = 1000;
const defaultDeleteBatchSize = 100;
const maxDeleteBatchSize = 500;
const maxListDepth = 6;

function normalizeStorageUrl(url) {
  return String(url || "").replace(/\/+$/, "");
}

function storageHeaders(serviceRoleKey) {
  return supabaseServiceHeaders(serviceRoleKey, {
    "content-type": "application/json"
  });
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

function retentionScopeFromListingImageObjectPath(objectPath) {
  const rawPath = String(objectPath || "");
  const safePath = rawPath.trim();
  if (
    !safePath
    || safePath !== rawPath
    || safePath.startsWith("/")
    || safePath.split("/").some((part) => part === "." || part === "..")
  ) return null;

  const legacy = safePath.match(/^listing-assets\/(\d{4}-\d{2}-\d{2})(?:\/|$)/);
  if (legacy) {
    return {
      layout: "legacy",
      tenant_id: "tenant_legacy",
      date_prefix: legacy[1]
    };
  }

  const tenantScoped = safePath.match(
    /^tenants\/([a-zA-Z0-9_-]{1,128})\/listing-assets\/(\d{4}-\d{2}-\d{2})(?:\/|$)/
  );
  if (!tenantScoped) return null;
  return {
    layout: "tenant_scoped",
    tenant_id: tenantScoped[1],
    date_prefix: tenantScoped[2]
  };
}

export function datePrefixFromListingImageObjectPath(objectPath) {
  return retentionScopeFromListingImageObjectPath(objectPath)?.date_prefix || "";
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

function expiredDatePrefixesFromRows(rows, {
  rootPrefix,
  cutoffDate
} = {}) {
  return [...new Set((Array.isArray(rows) ? rows : [])
    .map((row) => String(row?.name || ""))
    .filter((name) => name === name.trim() && isExpiredDatePrefix(name, cutoffDate))
    .map((datePrefix) => `${rootPrefix}/${datePrefix}`))]
    .sort();
}

function tenantListingAssetRoots(rows = []) {
  const tenantIds = [];
  let ignoredEntryCount = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const rawTenantId = String(row?.name || "");
    const tenantId = rawTenantId.trim();
    if (tenantId !== rawTenantId || !tenantIdPattern.test(tenantId) || !likelyFolder(row)) {
      ignoredEntryCount += 1;
      continue;
    }
    tenantIds.push(tenantId);
  }
  return {
    roots: [...new Set(tenantIds)]
      .sort()
      .map((tenantId) => ({
        tenant_id: tenantId,
        root_prefix: `${tenantObjectsRootPrefix}/${tenantId}/${listingAssetsRootPrefix}`
      })),
    ignored_entry_count: ignoredEntryCount
  };
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
    const rawName = String(row?.name || "");
    const name = rawName.trim();
    if (!name || name !== rawName || name.includes("..") || name.includes("/")) continue;
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
  const deletedObjects = [];
  let deletedCount = 0;

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
    if (!Array.isArray(payload)) {
      throw new Error("Supabase storage retention delete returned an unexpected response.");
    }
    deletedCount += payload.length;
    deletedObjects.push(...payload
      .map((row) => String(row?.name || row?.path || "").trim())
      .filter(Boolean));
  }

  return {
    deleted_count: deletedCount,
    deleted_objects: deletedObjects
  };
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
      scanned_layouts: [],
      scanned_tenant_count: 0,
      ignored_tenant_entry_count: 0,
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
  // The legacy tenant used listing-assets/{date}/..., while every production
  // tenant now writes tenants/{tenant_id}/listing-assets/{date}/.... Scan both
  // roots independently. A failed root or tenant listing rejects the whole
  // plan, so a successful run can never silently mean "legacy only".
  const [legacyRootRows, tenantRootRows] = await Promise.all([
    listStoragePrefix({
      config,
      prefix: listingAssetsRootPrefix,
      fetchImpl,
      pageSize
    }),
    listStoragePrefix({
      config,
      prefix: tenantObjectsRootPrefix,
      fetchImpl,
      pageSize
    })
  ]);
  const tenantRoots = tenantListingAssetRoots(tenantRootRows);
  const expiredPrefixes = expiredDatePrefixesFromRows(legacyRootRows, {
    rootPrefix: listingAssetsRootPrefix,
    cutoffDate
  });
  const tenantScanConcurrency = positiveInteger(
    env.LISTING_IMAGE_RETENTION_TENANT_SCAN_CONCURRENCY,
    4,
    { min: 1, max: 16 }
  );
  for (const rootBatch of chunk(tenantRoots.roots, tenantScanConcurrency)) {
    const batchResults = await Promise.all(rootBatch.map(async (root) => {
      const rows = await listStoragePrefix({
        config,
        prefix: root.root_prefix,
        fetchImpl,
        pageSize
      });
      return expiredDatePrefixesFromRows(rows, {
        rootPrefix: root.root_prefix,
        cutoffDate
      });
    }));
    expiredPrefixes.push(...batchResults.flat());
  }
  expiredPrefixes.sort();
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
    scanned_layouts: ["legacy", "tenant_scoped"],
    scanned_tenant_count: tenantRoots.roots.length,
    ignored_tenant_entry_count: tenantRoots.ignored_entry_count,
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

  if (dryRun) {
    return {
      ...plan,
      dry_run: true,
      delete_batch_size: deleteBatchSize,
      deleted_count: 0,
      deleted_objects: []
    };
  }

  if (objectPaths.length === 0) {
    return {
      ...plan,
      dry_run: false,
      delete_batch_size: deleteBatchSize,
      deleted_count: 0,
      deleted_objects: []
    };
  }

  const deletion = await deleteStorageObjects({
    config: listingImageStorageReadiness(env),
    objectPaths,
    fetchImpl,
    deleteBatchSize
  });

  return {
    ...plan,
    dry_run: false,
    delete_batch_size: deleteBatchSize,
    deleted_count: deletion.deleted_count,
    deleted_objects: deletion.deleted_objects
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
    scanned_layouts: Array.isArray(result.scanned_layouts) ? result.scanned_layouts : [],
    scanned_tenant_count: Number(result.scanned_tenant_count || 0),
    ignored_tenant_entry_count: Number(result.ignored_tenant_entry_count || 0),
    expired_prefixes: result.expired_prefixes || [],
    object_count: result.object_count || 0,
    deleted_count: result.deleted_count || 0
  };
}
