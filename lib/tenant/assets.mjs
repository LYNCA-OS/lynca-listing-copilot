import crypto from "node:crypto";
import {
  callV4Rpc,
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

function normalizeExpectedOriginalCount(value, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new TypeError("listing_asset_expected_original_count_required");
    return null;
  }
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 2) {
    throw new TypeError("invalid_listing_asset_expected_original_count");
  }
  return count;
}

function missingAssetMaterializationRpc(error) {
  const message = String(error || "");
  return /(?:404\s+.*PGRST202|PGRST202.*(?:could not find|schema cache)|could not find.*materialize_listing_asset_idempotent.*schema cache)/i.test(message);
}

function normalizedOptionalAssetValue(value) {
  return value ? String(value).slice(0, 160) : null;
}

function assetContractMatches(row = {}, {
  assetId,
  tenantId,
  expectedOriginalCount,
  captureProfileId,
  category
} = {}) {
  return String(row.id || row.asset_id || "") === assetId
    && String(row.tenant_id || "") === tenantId
    && String(row.image_generation_id || "") === assetId
    && Number(row.expected_original_count) === expectedOriginalCount
    && (row.capture_profile_id ?? null) === captureProfileId
    && (row.category ?? null) === category;
}

async function materializeListingAssetWithoutRpc({
  assetId,
  tenantId,
  expectedOriginalCount,
  captureProfileId,
  category,
  env,
  fetchImpl
} = {}) {
  const inserted = await ensureTenantListingAsset({
    tenantId,
    assetId,
    expectedOriginalCount,
    captureProfileId,
    category,
    duplicateResolution: "ignore",
    onConflict: "id",
    env,
    fetchImpl
  });
  const row = inserted.inserted
    ? inserted.row
    : (await readV4Rows({
      table: "listing_assets",
      select: "id,tenant_id,image_generation_id,expected_original_count,capture_profile_id,category",
      search: { id: `eq.${assetId}` },
      env,
      fetchImpl
    })).rows?.[0];
  if (!row) throw new Error("listing_asset_materialization_fallback_missing_row");
  if (!assetContractMatches(row, {
    assetId,
    tenantId,
    expectedOriginalCount,
    captureProfileId,
    category
  })) {
    throw new Error("listing_asset_idempotency_conflict");
  }
  return { inserted: inserted.inserted, row };
}

export function normalizeListingAssetId(value) {
  const assetId = String(value || "").trim();
  if (!assetIdPattern.test(assetId)) throw new TypeError("invalid_listing_asset_id");
  return assetId;
}

export function createDurableListingAssetId({ tenantId = "", clientAssetRef = "" } = {}) {
  const normalizedTenantId = String(tenantId || "").trim();
  const normalizedClientAssetRef = String(clientAssetRef || "").trim();
  if (normalizedTenantId && normalizedClientAssetRef) {
    const bytes = crypto.createHash("sha256")
      .update("lynca-listing-asset-v1\0")
      .update(normalizedTenantId)
      .update("\0")
      .update(normalizedClientAssetRef)
      .digest()
      .subarray(0, 16);
    // RFC 9562-shaped deterministic UUID. Version 8 is reserved for
    // application-defined identifiers; the variant remains RFC-compatible.
    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return `asset_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
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
  expectedOriginalCount = null,
  duplicateResolution = "merge",
  onConflict = "tenant_id,id",
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedTenantId = normalizeTenantId(tenantId);
  const normalizedAssetId = normalizeListingAssetId(assetId);
  const normalizedExpectedOriginalCount = normalizeExpectedOriginalCount(expectedOriginalCount);
  const row = {
    id: normalizedAssetId,
    tenant_id: normalizedTenantId,
    ...(normalizedExpectedOriginalCount ? {
      image_generation_id: normalizedAssetId,
      expected_original_count: normalizedExpectedOriginalCount,
      image_set_state: "INCOMPLETE"
    } : {}),
    ...(captureProfileId ? { capture_profile_id: String(captureProfileId).slice(0, 160) } : {}),
    ...(category ? { category: String(category).slice(0, 160) } : {})
  };
  const result = await writeV4Row({
    table: "listing_assets",
    row,
    upsert: true,
    onConflict,
    duplicateResolution,
    env,
    fetchImpl
  });
  if (!result.saved) {
    throw new Error(`listing_asset_create_failed:${String(result.error || "unknown_error").slice(0, 160)}`);
  }
  return {
    saved: true,
    inserted: Boolean(result.row),
    reused: duplicateResolution === "ignore" && !result.row,
    asset_id: normalizedAssetId,
    tenant_id: normalizedTenantId,
    row: result.row || row
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

export async function createTenantListingAsset({
  tenantId,
  clientAssetRef,
  captureProfileId = null,
  category = null,
  expectedOriginalCount,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const normalizedClientAssetRef = String(clientAssetRef || "").trim().slice(0, 160);
  if (!normalizedClientAssetRef || /[\u0000-\u001f\u007f]/.test(normalizedClientAssetRef)) {
    throw new TypeError("invalid_client_asset_ref");
  }
  const normalizedTenantId = normalizeTenantId(tenantId);
  const assetId = createDurableListingAssetId({
    tenantId: normalizedTenantId,
    clientAssetRef: normalizedClientAssetRef
  });
  const normalizedExpectedOriginalCount = normalizeExpectedOriginalCount(expectedOriginalCount, { required: true });
  const normalizedCaptureProfileId = normalizedOptionalAssetValue(captureProfileId);
  const normalizedCategory = normalizedOptionalAssetValue(category);
  const materialized = await callV4Rpc({
    fn: "materialize_listing_asset_idempotent",
    payload: {
      p_id: assetId,
      p_tenant_id: normalizedTenantId,
      p_expected_original_count: normalizedExpectedOriginalCount,
      p_capture_profile_id: normalizedCaptureProfileId,
      p_category: normalizedCategory
    },
    env,
    fetchImpl
  });
  if (!materialized.ok) {
    if (missingAssetMaterializationRpc(materialized.error)) {
      const fallback = await materializeListingAssetWithoutRpc({
        assetId,
        tenantId: normalizedTenantId,
        expectedOriginalCount: normalizedExpectedOriginalCount,
        captureProfileId: normalizedCaptureProfileId,
        category: normalizedCategory,
        env,
        fetchImpl
      });
      return {
        asset_id: assetId,
        tenant_id: normalizedTenantId,
        image_generation_id: assetId,
        expected_original_count: normalizedExpectedOriginalCount,
        client_asset_ref: normalizedClientAssetRef,
        reused: fallback.inserted !== true,
        materialization_mode: "schema_compatibility_fallback"
      };
    }
    throw new Error(`listing_asset_create_failed:${String(materialized.error || "unknown_error").slice(0, 160)}`);
  }
  const result = materialized.rows?.[0];
  if (!result || String(result.asset_id || "") !== assetId) {
    throw new Error("listing_asset_materialization_invalid_response");
  }
  if (result.conflict === true) throw new Error("listing_asset_idempotency_conflict");
  return {
    asset_id: assetId,
    tenant_id: normalizedTenantId,
    image_generation_id: assetId,
    expected_original_count: normalizedExpectedOriginalCount,
    client_asset_ref: normalizedClientAssetRef,
    reused: result.inserted !== true,
    materialization_mode: "atomic_rpc"
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
    select: "tenant_id,id,image_generation_id,expected_original_count,image_set_state,image_set_sha256",
    search: {
      tenant_id: `eq.${normalizedTenantId}`,
      id: `eq.${normalizedAssetId}`,
      limit: "2"
    },
    env,
    fetchImpl
  });
  if (!result.ok) {
    const error = new Error(`listing_asset_read_failed:${String(result.error || "unknown_error").slice(0, 160)}`);
    // A failed PostgREST read cannot prove that the durable asset is absent.
    // Surface it as retryable; the separate zero/multiple-row branch below is
    // the permanent not-found boundary.
    error.code = "LISTING_ASSET_READ_TEMPORARILY_UNAVAILABLE";
    error.retryable = true;
    error.statusCode = 503;
    throw error;
  }
  if (
    result.rows.length !== 1
    || String(result.rows[0]?.tenant_id || "") !== normalizedTenantId
    || String(result.rows[0]?.id || "") !== normalizedAssetId
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
