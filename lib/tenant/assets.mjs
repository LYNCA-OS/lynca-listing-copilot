import { randomUUID } from "node:crypto";
import { writeV4Row } from "../listing/v4/session/supabase-rest.mjs";

const assetIdPattern = /^[a-zA-Z0-9._:-]{1,160}$/;

export function normalizeListingAssetId(value) {
  const assetId = String(value || "").trim();
  if (!assetIdPattern.test(assetId)) throw new TypeError("invalid_listing_asset_id");
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
  const normalizedTenantId = String(tenantId || "").trim();
  if (!/^tenant_[a-z0-9][a-z0-9_-]{0,62}$/i.test(normalizedTenantId)) {
    throw new TypeError("invalid_listing_asset_tenant_id");
  }
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

export async function createTenantListingAsset({
  tenantId,
  clientAssetRef = null,
  captureProfileId = null,
  category = null,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const candidateId = String(clientAssetRef || "").trim();
  const normalizedCandidate = candidateId && assetIdPattern.test(candidateId)
    ? candidateId
    : `asset_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  return ensureTenantListingAsset({
    tenantId,
    assetId: normalizedCandidate,
    captureProfileId,
    category,
    env,
    fetchImpl
  });
}
