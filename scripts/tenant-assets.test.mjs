import assert from "node:assert/strict";
import {
  createIdempotentListingAssetId,
  createTenantListingAsset,
  ensureTenantListingAsset,
  ensureTenantListingAssets,
  isDurableListingAssetId,
  normalizeListingAssetId
} from "../lib/tenant/assets.mjs";

const writes = [];
const saved = await ensureTenantListingAsset({
  tenantId: "tenant_alpha",
  assetId: "asset_001",
  expectedOriginalCount: 2,
  env: {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role"
  },
  fetchImpl: async (url, init) => {
    writes.push({ url: new URL(url), body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify([{ id: "asset_001", tenant_id: "tenant_alpha" }])
    };
  }
});

assert.equal(saved.saved, true);
assert.equal(writes[0].url.pathname, "/rest/v1/listing_assets");
assert.equal(writes[0].url.searchParams.get("on_conflict"), "tenant_id,id");
assert.deepEqual(writes[0].body, {
  id: "asset_001",
  tenant_id: "tenant_alpha",
  image_generation_id: "asset_001",
  expected_original_count: 2,
  image_set_state: "INCOMPLETE"
});

await assert.rejects(
  () => ensureTenantListingAsset({
    tenantId: "tenant_beta",
    assetId: "asset_001",
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role"
    },
    fetchImpl: async () => ({
      ok: false,
      status: 409,
      text: async () => JSON.stringify({ code: "23505", message: "listing_assets_pkey" })
    })
  }),
  /listing_asset_create_failed/
);

assert.equal(normalizeListingAssetId(" asset_ok "), "asset_ok");
assert.throws(() => normalizeListingAssetId("../../other-tenant"), /invalid_listing_asset_id/);

const idempotencyKey = "11111111-2222-4333-8444-555555555555";
const stableAssetId = createIdempotentListingAssetId({
  tenantId: "tenant_alpha",
  idempotencyKey
});
assert.equal(isDurableListingAssetId(stableAssetId), true);
assert.equal(
  createIdempotentListingAssetId({ tenantId: "tenant_alpha", idempotencyKey }),
  stableAssetId,
  "a lost create response must replay the same durable root"
);
assert.notEqual(
  createIdempotentListingAssetId({ tenantId: "tenant_beta", idempotencyKey }),
  stableAssetId,
  "idempotency is tenant-scoped"
);
assert.throws(
  () => createIdempotentListingAssetId({ tenantId: "tenant_alpha", idempotencyKey: "asset-1" }),
  /invalid_listing_asset_idempotency_key/
);

const replayedCreates = [];
for (let attempt = 0; attempt < 2; attempt += 1) {
  replayedCreates.push(await createTenantListingAsset({
    tenantId: "tenant_alpha",
    clientAssetRef: "asset-1",
    idempotencyKey,
    expectedOriginalCount: 2,
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role"
    },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify([body])
      };
    }
  }));
}
assert.equal(replayedCreates[0].asset_id, replayedCreates[1].asset_id);
assert.equal(replayedCreates[0].idempotency_key, idempotencyKey);

const bulkWrites = [];
const bulk = await ensureTenantListingAssets({
  tenantId: "tenant_alpha",
  assetIds: ["asset_001", "asset_001", "asset_002"],
  env: {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role"
  },
  fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body);
    bulkWrites.push(body);
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify([body])
    };
  }
});
assert.deepEqual(bulk.asset_ids, ["asset_001", "asset_002"]);
assert.equal(bulkWrites.length, 2, "bulk root materialization must deduplicate asset IDs");

console.log("tenant asset tests passed");
