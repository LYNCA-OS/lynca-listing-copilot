import crypto from "node:crypto";
import {
  readV4Rows,
  writeV4Row
} from "../listing/v4/session/supabase-rest.mjs";

const assetIdPattern = /^[a-zA-Z0-9._:-]{1,160}$/;
const durableAssetIdPattern = /^asset_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeTenantId(value) {
  const tenantId = String(value || "").trim();
  if (!/^tenant_[a-z0-9][a-z0-9_-]{0,62}$/i.test(tenantId)) {
    throw new TypeError("invalid_listing_asset_tenant_id");
  }
  return tenantId;
}

export function normalizeListingAssetId(value) {
  const assetId = String(value || "").trim();
  if (!assetIdPattern.test(assetId)) throw new TypeError("invalid_listing_asset_id");
  return assetId;
}

export function createDurableListingAssetId() {
  return `asset_${crypto.randomUUID()}`;
}

export function isDurableListingAssetId(value) {
  return durableAssetIdPattern.test(String(value || "").trim());
}

export function normalizeDurableListingAssetId(value) {
  const assetId = normalizeListingAssetId(value);
  if (!isDurableListingAssetId(assetId)) throw new TypeError("invalid_durable_listing_asset_id");
  return assetId;
}

export async function ensureTenantListingAsset({
  tenantId,
  assetId,
  captureProfileId = null,
  category = null,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedTenantId = normalizeTenantId(tenantId);
  const normalizedAssetId = normalizeListingAssetId(assetId);
  const row = {
    id: normalizedAssetId,
    tenant_id: normalizedTenantId,
    ...(captureProfileId ? { capture_profile_id: String(captureProfileId).slice(0, 160) } : {}),
    ...(category ? { category: String(category).slice(0, 160) } : {})
  };
  const result = await writeV4Row({
    table: "listing_assets",
    row,
    upsert: true,
    onConflict: "tenant_id,id",
    duplicateResolution: "merge",
    env,
    fetchImpl
  });
  if (!result.saved) {
    throw new Error(`listing_asset_create_failed:${String(result.error || "unknown_error").slice(0, 160)}`);
  }
  return { saved: true, asset_id: normalizedAssetId, tenant_id: normalizedTenantId, row: result.row || row };
}

export async function createTenantListingAsset({
  tenantId,
  clientAssetRef,
  captureProfileId = null,
  category = null,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedClientAssetRef = String(clientAssetRef || "").trim().slice(0, 160);
  if (!normalizedClientAssetRef || /[\u0000-\u001f\u007f]/.test(normalizedClientAssetRef)) {
    throw new TypeError("invalid_client_asset_ref");
  }
  const assetId = createDurableListingAssetId();
  await ensureTenantListingAsset({
    tenantId,
    assetId,
    captureProfileId,
    category,
    env,
    fetchImpl
  });
  return {
    asset_id: assetId,
    tenant_id: normalizeTenantId(tenantId),
    client_asset_ref: normalizedClientAssetRef
  };
}

export async function requireTenantListingAsset({
  tenantId,
  assetId,
  requireDurable = false,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedTenantId = normalizeTenantId(tenantId);
  const normalizedAssetId = requireDurable
    ? normalizeDurableListingAssetId(assetId)
    : normalizeListingAssetId(assetId);
  const result = await readV4Rows({
    table: "listing_assets",
    select: "tenant_id,id",
    search: {
      tenant_id: `eq.${normalizedTenantId}`,
      id: `eq.${normalizedAssetId}`,
      limit: "2"
    },
    env,
    fetchImpl
  });
  if (!result.ok) {
    throw new Error(`listing_asset_read_failed:${String(result.error || "unknown_error").slice(0, 160)}`);
  }
  if (
    result.rows.length !== 1 ||
    String(result.rows[0]?.tenant_id || "") !== normalizedTenantId ||
    String(result.rows[0]?.id || "") !== normalizedAssetId
  ) {
    throw new Error("listing_asset_not_found");
  }
  return {
    found: true,
    tenant_id: normalizedTenantId,
    asset_id: normalizedAssetId,
    row: result.rows[0]
  };
}

export async function ensureTenantListingAssets({
  tenantId,
  assetIds = [],
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const uniqueAssetIds = [...new Set((Array.isArray(assetIds) ? assetIds : [])
    .map(normalizeListingAssetId))];
  const rows = await Promise.all(uniqueAssetIds.map((assetId) => ensureTenantListingAsset({
    tenantId,
    assetId,
    env,
    fetchImpl
  })));
  return { saved: true, asset_ids: uniqueAssetIds, rows };
}
