import assert from "node:assert/strict";
import {
  listingImageVerificationRecordFromResult,
  readListingImageVerificationRecord,
  saveListingImageVerificationRecord
} from "../lib/listing/storage/storage-verification-store.mjs";

const env = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role"
};
const tenantId = "tenant_legacy";

const verification = {
  tenant_id: tenantId,
  object_path: "tenants/tenant_legacy/listing-assets/2026-06-22/asset-1/front_original-front.png",
  bucket: "listing-card-images",
  content_type: "image/png",
  size: 2048,
  width: 1200,
  height: 900,
  content_sha256: "d".repeat(64),
  object_verified: true,
  content_hash_verified: true,
  dimension_source: "object_bytes",
  verified_at: "2026-06-22T12:00:00.000Z"
};

const row = listingImageVerificationRecordFromResult({
  verification,
  assetId: "asset-1",
  imageId: "front",
  role: "front_original",
  now: new Date("2026-06-22T12:01:00.000Z")
});
assert.deepEqual(row, {
  tenant_id: tenantId,
  object_path: verification.object_path,
  bucket: verification.bucket,
  asset_id: "asset-1",
  image_id: "front",
  storage_role: "front_original",
  content_type: "image/png",
  size: 2048,
  width: 1200,
  height: 900,
  content_sha256: "d".repeat(64),
  object_verified: true,
  content_hash_verified: true,
  dimension_source: "object_bytes",
  verified_at: "2026-06-22T12:00:00.000Z",
  updated_at: "2026-06-22T12:01:00.000Z"
});
assert.throws(
  () => listingImageVerificationRecordFromResult({
    verification: {
      ...verification,
      object_path: "../secret.png"
    }
  }),
  /Invalid listing image object path/
);
assert.throws(
  () => listingImageVerificationRecordFromResult({
    verification: {
      ...verification,
      object_path: "listing-assets/2026-06-22/asset-1/front.png"
    },
    assetId: "asset-1"
  }),
  /must belong to the signed tenant/
);
assert.throws(
  () => listingImageVerificationRecordFromResult({
    verification,
    assetId: "asset-other"
  }),
  /does not match asset_id/
);

const calls = [];
let storedRow = null;
const fetchImpl = async (url, init = {}) => {
  const parsed = new URL(String(url));
  const method = init.method || "GET";
  calls.push({
    path: parsed.pathname,
    search: Object.fromEntries(parsed.searchParams.entries()),
    method,
    headers: init.headers,
    body: init.body ? JSON.parse(init.body) : null
  });

  if (parsed.pathname === "/rest/v1/listing_assets" && method === "GET") {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify([{ tenant_id: tenantId, id: "asset-1" }])
    };
  }

  if (method === "POST") {
    storedRow = JSON.parse(init.body);
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify([storedRow])
    };
  }

  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(storedRow ? [storedRow] : [])
  };
};

const saveResult = await saveListingImageVerificationRecord({
  verification,
  assetId: "asset-1",
  imageId: "front",
  role: "front_original",
  env,
  fetchImpl,
  now: new Date("2026-06-22T12:01:00.000Z")
});
assert.equal(saveResult.saved, true);
assert.equal(saveResult.durable, true);
assert.equal(calls[0].path, "/rest/v1/listing_assets");
assert.equal(calls[0].method, "GET");
assert.equal(calls[0].search.tenant_id, `eq.${tenantId}`);
assert.equal(calls[0].search.id, "eq.asset-1");
assert.equal(calls[0].search.limit, "2");
assert.equal(calls[1].path, "/rest/v1/listing_image_verifications");
assert.equal(calls[1].search.on_conflict, "tenant_id,object_path");
assert.equal(calls[1].headers.apikey, "test-service-role");
assert.equal(calls[1].headers.authorization, undefined);
assert.equal(calls[1].body.object_path, verification.object_path);

const readResult = await readListingImageVerificationRecord({
  tenantId,
  assetId: "asset-1",
  objectPath: verification.object_path,
  bucket: verification.bucket,
  contentType: verification.content_type,
  size: verification.size,
  width: verification.width,
  height: verification.height,
  env,
  fetchImpl
});
assert.equal(readResult.verified, true);
assert.equal(readResult.durable, true);
assert.equal(calls[2].search.object_path, `eq.${verification.object_path}`);
assert.equal(calls[2].search.tenant_id, `eq.${tenantId}`);
assert.equal(calls[2].search.asset_id, "eq.asset-1");
assert.equal(calls[2].search.limit, "1");

const mismatch = await readListingImageVerificationRecord({
  tenantId,
  assetId: "asset-1",
  objectPath: verification.object_path,
  bucket: verification.bucket,
  contentType: verification.content_type,
  size: verification.size + 1,
  width: verification.width,
  height: verification.height,
  env,
  fetchImpl
});
assert.equal(mismatch.verified, false);
assert.equal(mismatch.reason, "verification_record_mismatch");
await assert.rejects(
  () => readListingImageVerificationRecord({
    tenantId: "tenant_other",
    objectPath: verification.object_path,
    bucket: verification.bucket,
    contentType: verification.content_type,
    size: verification.size,
    width: verification.width,
    height: verification.height,
    env,
    fetchImpl
  }),
  /must belong to the signed tenant/
);

const missing = await readListingImageVerificationRecord({
  tenantId,
  objectPath: "tenants/tenant_legacy/listing-assets/2026-06-22/missing/front.jpg",
  bucket: verification.bucket,
  contentType: verification.content_type,
  size: verification.size,
  width: verification.width,
  height: verification.height,
  env,
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify([])
  })
});
assert.equal(missing.verified, false);
assert.equal(missing.reason, "verification_record_missing");

const disabledSave = await saveListingImageVerificationRecord({
  verification,
  env: {},
  fetchImpl
});
assert.equal(disabledSave.saved, false);
assert.equal(disabledSave.reason, "supabase_not_configured");

assert.equal(JSON.stringify(saveResult).includes("test-service-role"), false);
assert.equal(JSON.stringify(readResult).includes("test-service-role"), false);

console.log("storage verification record tests passed");
