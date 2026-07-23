import assert from "node:assert/strict";
import {
  createDurableListingAssetId,
  createTenantListingAsset,
  ensureTenantListingAsset,
  ensureTenantListingAssets,
  isDurableListingAssetId,
  normalizeListingAssetId
} from "../lib/tenant/assets.mjs";

const firstDeterministicId = createDurableListingAssetId({
  tenantId: "tenant_alpha",
  clientAssetRef: "writer-upload:stable-001"
});
assert.equal(
  firstDeterministicId,
  createDurableListingAssetId({ tenantId: "tenant_alpha", clientAssetRef: "writer-upload:stable-001" }),
  "the same tenant idempotency key must always materialize the same durable asset"
);
assert.equal(isDurableListingAssetId(firstDeterministicId), true);
assert.notEqual(
  firstDeterministicId,
  createDurableListingAssetId({ tenantId: "tenant_alpha", clientAssetRef: "writer-upload:stable-002" })
);
assert.notEqual(
  firstDeterministicId,
  createDurableListingAssetId({ tenantId: "tenant_beta", clientAssetRef: "writer-upload:stable-001" })
);

const createdAssetWrites = [];
const createdAsset = await createTenantListingAsset({
  tenantId: "tenant_alpha",
  clientAssetRef: "writer-upload:stable-001",
  expectedOriginalCount: 2,
  env: {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role"
  },
  fetchImpl: async (url, init) => {
    createdAssetWrites.push({ url: new URL(url), init, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify([{
        asset_id: firstDeterministicId,
        tenant_id: "tenant_alpha",
        image_generation_id: firstDeterministicId,
        expected_original_count: 2,
        inserted: true,
        conflict: false
      }])
    };
  }
});
assert.equal(createdAsset.asset_id, firstDeterministicId);
assert.equal(createdAsset.reused, false);
assert.equal(createdAsset.materialization_mode, "atomic_rpc");
assert.equal(createdAssetWrites.length, 1);
assert.equal(createdAssetWrites[0].url.pathname, "/rest/v1/rpc/materialize_listing_asset_idempotent");
assert.deepEqual(createdAssetWrites[0].body, {
  p_id: firstDeterministicId,
  p_tenant_id: "tenant_alpha",
  p_expected_original_count: 2,
  p_capture_profile_id: null,
  p_category: null
});

const existingAssetRow = {
  id: firstDeterministicId,
  tenant_id: "tenant_alpha",
  image_generation_id: firstDeterministicId,
  expected_original_count: 2,
  image_set_state: "INCOMPLETE",
  image_set_sha256: null
};
const reuseAssetCalls = [];
const reusedAsset = await createTenantListingAsset({
  tenantId: "tenant_alpha",
  clientAssetRef: "writer-upload:stable-001",
  expectedOriginalCount: 2,
  env: {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role"
  },
  fetchImpl: async (url, init = {}) => {
    reuseAssetCalls.push({ url: new URL(url), init });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify([{
        asset_id: existingAssetRow.id,
        tenant_id: existingAssetRow.tenant_id,
        image_generation_id: existingAssetRow.image_generation_id,
        expected_original_count: existingAssetRow.expected_original_count,
        inserted: false,
        conflict: false
      }])
    };
  }
});
assert.equal(reusedAsset.asset_id, firstDeterministicId);
assert.equal(reusedAsset.reused, true);
assert.equal(reuseAssetCalls.length, 1, "idempotent reuse must remain one atomic database round trip");

const compatibilityFallbackCalls = [];
const compatibilityFallback = await createTenantListingAsset({
  tenantId: "tenant_alpha",
  clientAssetRef: "writer-upload:stable-001",
  expectedOriginalCount: 2,
  env: {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role"
  },
  fetchImpl: async (url, init = {}) => {
    const parsed = new URL(url);
    compatibilityFallbackCalls.push(parsed.pathname);
    if (parsed.pathname.includes("/rpc/")) {
      return {
        ok: false,
        status: 404,
        text: async () => JSON.stringify({
          code: "PGRST202",
          message: "Could not find materialize_listing_asset_idempotent in the schema cache"
        })
      };
    }
    const body = JSON.parse(init.body);
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify([body])
    };
  }
});
assert.equal(compatibilityFallback.materialization_mode, "schema_compatibility_fallback");
assert.equal(compatibilityFallback.reused, false);
assert.deepEqual(compatibilityFallbackCalls, [
  "/rest/v1/rpc/materialize_listing_asset_idempotent",
  "/rest/v1/listing_assets"
]);

let nonSchemaFailureCalls = 0;
await assert.rejects(
  () => createTenantListingAsset({
    tenantId: "tenant_alpha",
    clientAssetRef: "writer-upload:stable-001",
    expectedOriginalCount: 2,
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role"
    },
    fetchImpl: async () => {
      nonSchemaFailureCalls += 1;
      return {
        ok: false,
        status: 503,
        text: async () => JSON.stringify({ code: "PGRST000", message: "database unavailable" })
      };
    }
  }),
  /listing_asset_create_failed/,
  "database failures must fail closed instead of multiplying load through the compatibility path"
);
assert.equal(nonSchemaFailureCalls, 1);

await assert.rejects(
  () => createTenantListingAsset({
    tenantId: "tenant_alpha",
    clientAssetRef: "writer-upload:stable-001",
    expectedOriginalCount: 1,
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role"
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([{
        asset_id: existingAssetRow.id,
        tenant_id: existingAssetRow.tenant_id,
        image_generation_id: existingAssetRow.image_generation_id,
        expected_original_count: existingAssetRow.expected_original_count,
        inserted: false,
        conflict: true
      }])
    })
  }),
  /listing_asset_idempotency_conflict/,
  "an idempotency key must never silently change the immutable image count"
);

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
