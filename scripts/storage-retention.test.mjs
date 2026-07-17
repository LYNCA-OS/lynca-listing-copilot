import assert from "node:assert/strict";
import {
  datePrefixFromListingImageObjectPath,
  listingImageRetentionCutoffDate,
  planListingImageRetentionCleanup,
  runListingImageRetentionCleanup,
  summarizeListingImageRetentionCleanup
} from "../lib/listing/storage/storage-retention.mjs";
import { buildListingImageObjectPath } from "../lib/listing/storage/supabase-image-storage.mjs";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
  LISTING_IMAGE_BUCKET: "listing-card-images",
  LISTING_IMAGE_RETENTION_DAYS: "30",
  LISTING_IMAGE_RETENTION_DELETE_BATCH_SIZE: "2"
};

assert.equal(
  listingImageRetentionCutoffDate({
    retentionDays: 30,
    now: new Date("2026-06-22T12:00:00.000Z")
  }),
  "2026-05-23"
);
assert.equal(
  datePrefixFromListingImageObjectPath("listing-assets/2026-05-20/asset-1/front_original-front.jpg"),
  "2026-05-20"
);
const tenantScopedObjectPath = buildListingImageObjectPath({
  tenantId: "tenant_alpha",
  assetId: "asset_123",
  imageId: "front",
  role: "front_original",
  fileName: "front.jpg",
  contentType: "image/jpeg",
  now: new Date("2026-05-20T00:00:00.000Z")
});
assert.equal(
  tenantScopedObjectPath,
  "tenants/tenant_alpha/listing-assets/2026-05-20/asset_123/front_original-front.jpg"
);
assert.equal(datePrefixFromListingImageObjectPath(tenantScopedObjectPath), "2026-05-20");
assert.equal(
  datePrefixFromListingImageObjectPath("tenants/tenant_alpha/exports/2026-05-20/file.xlsx"),
  ""
);
assert.equal(
  datePrefixFromListingImageObjectPath("tenants/tenant.alpha/listing-assets/2026-05-20/file.jpg"),
  ""
);
assert.equal(
  datePrefixFromListingImageObjectPath(" tenants/tenant_alpha/listing-assets/2026-05-20/file.jpg"),
  ""
);
assert.equal(datePrefixFromListingImageObjectPath("../listing-assets/2026-05-20/file.jpg"), "");

let called = false;
const skipped = await planListingImageRetentionCleanup({
  env: {
    ...env,
    LISTING_IMAGE_RETENTION_DAYS: ""
  },
  fetchImpl: async () => {
    called = true;
    return {};
  }
});
assert.equal(skipped.skipped, true);
assert.equal(skipped.enabled, false);
assert.equal(called, false);

const noOpCalls = [];
const noOp = await runListingImageRetentionCleanup({
  env,
  fetchImpl: async (_url, init = {}) => {
    const body = JSON.parse(init.body || "{}");
    noOpCalls.push({ method: init.method, prefix: body.prefix || null });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify([])
    };
  },
  now: new Date("2026-06-22T12:00:00.000Z"),
  dryRun: false
});
assert.equal(noOp.dry_run, false, "an applied zero-object cleanup must not be reported as a dry run");
assert.equal(noOp.object_count, 0);
assert.equal(noOp.deleted_count, 0);
assert.deepEqual(noOpCalls.map((call) => call.prefix), ["listing-assets", "tenants"]);
assert.equal(noOpCalls.some((call) => call.method === "DELETE"), false);

await assert.rejects(
  planListingImageRetentionCleanup({
    env,
    fetchImpl: async (_url, init = {}) => {
      const prefix = JSON.parse(init.body || "{}").prefix;
      if (prefix === "listing-assets") return listResponse([]);
      if (prefix === "tenants") return listResponse([{ name: "tenant_alpha" }]);
      if (prefix === "tenants/tenant_alpha/listing-assets") {
        return {
          ok: false,
          status: 503,
          text: async () => JSON.stringify({ message: "temporary tenant listing failure" })
        };
      }
      throw new Error(`Unexpected prefix ${prefix}`);
    },
    now: new Date("2026-06-22T12:00:00.000Z")
  }),
  /Supabase storage list failed: 503 temporary tenant listing failure/,
  "a tenant subtree listing failure must fail the whole plan instead of returning a partial cleanup"
);

const calls = [];
let deleteResponseLimit = Number.POSITIVE_INFINITY;
function listResponse(rows) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(rows)
  };
}

function verificationRowsFromRequest(url, body = {}) {
  const parsed = new URL(String(url));
  const tenantId = String(parsed.searchParams.get("tenant_id") || "").replace(/^eq\./, "");
  const bucket = String(parsed.searchParams.get("bucket") || "").replace(/^eq\./, "");
  const pathFilter = String(parsed.searchParams.get("object_path") || "");
  const objectPaths = pathFilter.slice(4, -1).split(",").filter(Boolean);
  return objectPaths.map((objectPath) => ({
    tenant_id: tenantId,
    bucket,
    object_path: objectPath,
    object_verified: body.object_verified,
    canonical_eligible: body.canonical_eligible
  }));
}

function retentionFetch(url, init = {}) {
  calls.push({
    url,
    method: init.method,
    headers: init.headers,
    body: init.body ? JSON.parse(init.body) : null
  });

  if (init.method === "DELETE") {
    const prefixes = JSON.parse(init.body || "{}").prefixes || [];
    return Promise.resolve({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(prefixes
        .slice(0, deleteResponseLimit)
        .map((name) => ({ name })))
    });
  }

  if (init.method === "PATCH") {
    return Promise.resolve(listResponse(verificationRowsFromRequest(url, JSON.parse(init.body || "{}"))));
  }

  const prefix = JSON.parse(init.body).prefix;
  if (prefix === "listing-assets") {
    return Promise.resolve(listResponse([
      { name: "2026-05-20" },
      { name: "2026-05-23" },
      { name: "2026-06-01" },
      { name: "not-a-date" }
    ]));
  }

  if (prefix === "listing-assets/2026-05-20") {
    return Promise.resolve(listResponse([
      { name: "asset-old" },
      { name: "asset-empty" }
    ]));
  }

  if (prefix === "listing-assets/2026-05-20/asset-old") {
    return Promise.resolve(listResponse([
      {
        name: "front_original-front.jpg",
        id: "object-1",
        metadata: { size: 1000 },
        created_at: "2026-05-20T00:00:00.000Z"
      },
      {
        name: "serial_crop-serial.png",
        id: "object-2",
        metadata: { size: 500 },
        created_at: "2026-05-20T00:00:00.000Z"
      }
    ]));
  }

  if (prefix === "listing-assets/2026-05-20/asset-empty") {
    return Promise.resolve(listResponse([]));
  }

  if (prefix === "tenants") {
    return Promise.resolve(listResponse([
      { name: "tenant_beta" },
      { name: "tenant_alpha" },
      { name: "tenant.bad" },
      { name: "../escape" },
      { name: "tenant_shadow " },
      { name: "tenant_file", id: "object-at-tenant-root", metadata: { size: 1 } }
    ]));
  }

  if (prefix === "tenants/tenant_alpha/listing-assets") {
    return Promise.resolve(listResponse([
      { name: "2026-05-20" },
      { name: "2026-05-23" },
      { name: "2026-06-01" }
    ]));
  }

  if (prefix === "tenants/tenant_alpha/listing-assets/2026-05-20") {
    return Promise.resolve(listResponse([
      { name: "asset-alpha" },
      { name: "asset-shadow " }
    ]));
  }

  if (prefix === "tenants/tenant_alpha/listing-assets/2026-05-20/asset-alpha") {
    return Promise.resolve(listResponse([
      {
        name: "front_original-front.jpg",
        id: "tenant-alpha-object-1",
        metadata: { size: 1200 },
        created_at: "2026-05-20T00:00:00.000Z"
      },
      {
        name: "back_original-back.jpg",
        id: "tenant-alpha-object-2",
        metadata: { size: 1100 },
        created_at: "2026-05-20T00:00:00.000Z"
      },
      {
        name: "front_original-front.jpg ",
        id: "normalization-alias-object",
        metadata: { size: 1 },
        created_at: "2026-05-20T00:00:00.000Z"
      }
    ]));
  }

  if (prefix === "tenants/tenant_beta/listing-assets") {
    return Promise.resolve(listResponse([
      { name: "2026-05-20" },
      { name: "2026-06-01" }
    ]));
  }

  if (prefix === "tenants/tenant_beta/listing-assets/2026-05-20") {
    return Promise.resolve(listResponse([{ name: "asset-beta" }]));
  }

  if (prefix === "tenants/tenant_beta/listing-assets/2026-05-20/asset-beta") {
    return Promise.resolve(listResponse([
      {
        name: "front_original-front.jpg",
        id: "tenant-beta-object-1",
        metadata: { size: 900 },
        created_at: "2026-05-20T00:00:00.000Z"
      }
    ]));
  }

  throw new Error(`Unexpected prefix ${prefix}`);
}

const plan = await planListingImageRetentionCleanup({
  env,
  fetchImpl: retentionFetch,
  now: new Date("2026-06-22T12:00:00.000Z")
});
assert.equal(plan.enabled, true);
assert.equal(plan.cutoff_date, "2026-05-23");
assert.deepEqual(plan.scanned_layouts, ["legacy", "tenant_scoped"]);
assert.equal(plan.scanned_tenant_count, 2);
assert.equal(plan.ignored_tenant_entry_count, 4);
assert.deepEqual(plan.expired_prefixes, [
  "listing-assets/2026-05-20",
  "tenants/tenant_alpha/listing-assets/2026-05-20",
  "tenants/tenant_beta/listing-assets/2026-05-20"
]);
assert.deepEqual(plan.objects.map((object) => object.object_path), [
  "listing-assets/2026-05-20/asset-old/front_original-front.jpg",
  "listing-assets/2026-05-20/asset-old/serial_crop-serial.png",
  "tenants/tenant_alpha/listing-assets/2026-05-20/asset-alpha/front_original-front.jpg",
  "tenants/tenant_alpha/listing-assets/2026-05-20/asset-alpha/back_original-back.jpg",
  "tenants/tenant_beta/listing-assets/2026-05-20/asset-beta/front_original-front.jpg"
]);
assert.equal(plan.object_count, 5);
assert.equal(
  calls.some((call) => call.body?.prefix?.includes("2026-06-01")),
  false,
  "current tenant objects must not be traversed or scheduled for deletion"
);
assert.equal(
  calls.some((call) => /tenant\.bad|escape|tenant_shadow|tenant_file|asset-shadow/.test(call.body?.prefix || "")),
  false,
  "invalid tenant entries, file rows, and normalization aliases must not enter a retention subtree"
);
assert.equal(JSON.stringify(plan).includes("test-service-role"), false);

const dryRun = await runListingImageRetentionCleanup({
  env,
  fetchImpl: retentionFetch,
  now: new Date("2026-06-22T12:00:00.000Z"),
  dryRun: true
});
assert.equal(dryRun.dry_run, true);
assert.equal(dryRun.deleted_count, 0);
assert.equal(dryRun.object_count, 5);
assert.equal(calls.some((call) => call.method === "DELETE"), false);

const appliedCallStart = calls.length;
const applied = await runListingImageRetentionCleanup({
  env,
  fetchImpl: retentionFetch,
  now: new Date("2026-06-22T12:00:00.000Z"),
  dryRun: false
});
assert.equal(applied.dry_run, false);
assert.equal(applied.object_count, 5);
assert.equal(applied.deleted_count, 5);
assert.equal(applied.verification_invalidation_confirmed, true);
assert.equal(applied.verification_invalidated_count, 5);
const appliedCalls = calls.slice(appliedCallStart);
const firstPatchIndex = appliedCalls.findIndex((call) => call.method === "PATCH");
const firstDeleteIndex = appliedCalls.findIndex((call) => call.method === "DELETE");
const lastDeleteIndex = appliedCalls.findLastIndex((call) => call.method === "DELETE");
assert.ok(firstPatchIndex >= 0 && firstPatchIndex < firstDeleteIndex);
assert.ok(
  appliedCalls.slice(firstPatchIndex, firstDeleteIndex).every((call) => call.method === "PATCH"),
  "verification records must be invalidated before the first Storage delete"
);
assert.ok(
  appliedCalls.slice(lastDeleteIndex + 1).every((call) => call.method === "PATCH"),
  "verification records must be invalidated again after the final Storage delete"
);
const verificationCalls = appliedCalls.filter((call) => call.method === "PATCH");
assert.equal(verificationCalls.length, 6);
verificationCalls.forEach((call) => {
  const url = new URL(String(call.url));
  assert.equal(url.pathname, "/rest/v1/listing_image_verifications");
  assert.match(url.searchParams.get("tenant_id") || "", /^eq\.(?:tenant_legacy|tenant_alpha|tenant_beta)$/);
  assert.equal(url.searchParams.get("bucket"), "eq.listing-card-images");
  assert.match(url.searchParams.get("object_path") || "", /^in\.\((?:listing-assets|tenants\/)/);
  assert.equal(call.headers.apikey, "test-service-role");
  assert.equal(call.headers.authorization, undefined);
  assert.equal(call.headers.prefer, "return=representation");
  assert.equal(call.body.object_verified, false);
  assert.equal(call.body.canonical_eligible, false);
});
const deleteCalls = calls.filter((call) => call.method === "DELETE");
assert.equal(deleteCalls.length, 3);
deleteCalls.forEach((call) => {
  assert.match(call.url, /\/storage\/v1\/object\/listing-card-images$/);
  assert.equal(call.headers.apikey, "test-service-role");
  assert.equal(call.headers.authorization, undefined, "opaque Supabase service keys must not be sent as JWT bearer tokens");
});
assert.deepEqual(deleteCalls.flatMap((call) => call.body.prefixes), [
  "listing-assets/2026-05-20/asset-old/front_original-front.jpg",
  "listing-assets/2026-05-20/asset-old/serial_crop-serial.png",
  "tenants/tenant_alpha/listing-assets/2026-05-20/asset-alpha/front_original-front.jpg",
  "tenants/tenant_alpha/listing-assets/2026-05-20/asset-alpha/back_original-back.jpg",
  "tenants/tenant_beta/listing-assets/2026-05-20/asset-beta/front_original-front.jpg"
]);

calls.length = 0;
deleteResponseLimit = 1;
const partiallyConfirmed = await runListingImageRetentionCleanup({
  env,
  fetchImpl: retentionFetch,
  now: new Date("2026-06-22T12:00:00.000Z"),
  dryRun: false
});
assert.equal(partiallyConfirmed.object_count, 5);
assert.equal(
  partiallyConfirmed.deleted_count,
  3,
  "deleted_count must come from Supabase's confirmed FileObject rows, not the number requested"
);
assert.deepEqual(partiallyConfirmed.deleted_objects, [
  "listing-assets/2026-05-20/asset-old/front_original-front.jpg",
  "tenants/tenant_alpha/listing-assets/2026-05-20/asset-alpha/front_original-front.jpg",
  "tenants/tenant_beta/listing-assets/2026-05-20/asset-beta/front_original-front.jpg"
]);
deleteResponseLimit = Number.POSITIVE_INFINITY;

calls.length = 0;
await assert.rejects(
  runListingImageRetentionCleanup({
    env,
    fetchImpl: async (url, init = {}) => {
      if (init.method === "PATCH") {
        calls.push({ url, method: init.method, body: JSON.parse(init.body || "{}") });
        return {
          ok: false,
          status: 503,
          text: async () => JSON.stringify({ message: "verification store unavailable" })
        };
      }
      return retentionFetch(url, init);
    },
    now: new Date("2026-06-22T12:00:00.000Z"),
    dryRun: false
  }),
  /Supabase verification invalidation failed: 503 verification store unavailable/,
  "Storage deletion must not begin when verification invalidation cannot be confirmed"
);
assert.equal(calls.some((call) => call.method === "DELETE"), false);

const outOfScopeCalls = [];
await assert.rejects(
  runListingImageRetentionCleanup({
    env,
    fetchImpl: async (_url, init = {}) => {
      const body = JSON.parse(init.body || "{}");
      outOfScopeCalls.push({ method: init.method, prefix: body.prefix || null });
      if (body.prefix === "listing-assets") return listResponse([{ name: "2026-05-20" }]);
      if (body.prefix === "tenants") return listResponse([]);
      if (body.prefix === "listing-assets/2026-05-20") return listResponse([{ name: "asset-old" }]);
      if (body.prefix === "listing-assets/2026-05-20/asset-old") {
        return listResponse([{
          name: "front,bad.jpg",
          id: "out-of-scope-object",
          metadata: { size: 10 }
        }]);
      }
      throw new Error(`Unexpected request for ${body.prefix || init.method}`);
    },
    now: new Date("2026-06-22T12:00:00.000Z"),
    dryRun: false
  }),
  /Listing image retention encountered an out-of-scope object path/,
  "retention must reject non-canonical path characters before mutating verification or Storage"
);
assert.equal(outOfScopeCalls.some((call) => call.method === "PATCH" || call.method === "DELETE"), false);

calls.length = 0;
await assert.rejects(
  runListingImageRetentionCleanup({
    env,
    fetchImpl: async (url, init = {}) => {
      if (init.method === "DELETE") {
        calls.push({ url, method: init.method, body: JSON.parse(init.body || "{}") });
        return {
          ok: false,
          status: 503,
          text: async () => JSON.stringify({ message: "storage unavailable" })
        };
      }
      return retentionFetch(url, init);
    },
    now: new Date("2026-06-22T12:00:00.000Z"),
    dryRun: false
  }),
  /Verification records were invalidated first; retry cleanup/,
  "a failed Storage deletion must leave a clear, recoverable invalidated state"
);
assert.ok(calls.findIndex((call) => call.method === "PATCH") < calls.findIndex((call) => call.method === "DELETE"));

calls.length = 0;
let patchCount = 0;
await assert.rejects(
  runListingImageRetentionCleanup({
    env,
    fetchImpl: async (url, init = {}) => {
      if (init.method === "PATCH" && ++patchCount > 3) {
        calls.push({ url, method: init.method, body: JSON.parse(init.body || "{}") });
        return {
          ok: false,
          status: 503,
          text: async () => JSON.stringify({ message: "final invalidation unavailable" })
        };
      }
      return retentionFetch(url, init);
    },
    now: new Date("2026-06-22T12:00:00.000Z"),
    dryRun: false
  }),
  /Supabase verification invalidation failed: 503 final invalidation unavailable/,
  "cleanup must not report success if the post-delete invalidation cannot be confirmed"
);
assert.ok(calls.some((call) => call.method === "DELETE"));

calls.length = 0;
await assert.rejects(
  runListingImageRetentionCleanup({
    env,
    fetchImpl: async (url, init = {}) => {
      if (init.method === "PATCH") {
        const body = JSON.parse(init.body || "{}");
        calls.push({ url, method: init.method, body });
        return listResponse(verificationRowsFromRequest(url, {
          ...body,
          object_verified: true
        }));
      }
      return retentionFetch(url, init);
    },
    now: new Date("2026-06-22T12:00:00.000Z"),
    dryRun: false
  }),
  /Supabase verification invalidation could not be confirmed/,
  "a response that still reports object_verified=true must fail closed"
);
assert.equal(calls.some((call) => call.method === "DELETE"), false);

const summary = summarizeListingImageRetentionCleanup(applied);
assert.deepEqual(summary, {
  enabled: true,
  skipped: false,
  reason: null,
  dry_run: false,
  retention_days: 30,
  cutoff_date: "2026-05-23",
  bucket: "listing-card-images",
  scanned_layouts: ["legacy", "tenant_scoped"],
  scanned_tenant_count: 2,
  ignored_tenant_entry_count: 4,
  expired_prefixes: [
    "listing-assets/2026-05-20",
    "tenants/tenant_alpha/listing-assets/2026-05-20",
    "tenants/tenant_beta/listing-assets/2026-05-20"
  ],
  object_count: 5,
  verification_invalidation_confirmed: true,
  verification_invalidated_count: 5,
  deleted_count: 5
});
assert.equal(JSON.stringify(summary).includes("test-service-role"), false);

console.log("storage retention tests passed");
