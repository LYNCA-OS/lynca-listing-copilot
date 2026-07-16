import assert from "node:assert/strict";
import {
  datePrefixFromListingImageObjectPath,
  listingImageRetentionCutoffDate,
  planListingImageRetentionCleanup,
  runListingImageRetentionCleanup,
  summarizeListingImageRetentionCleanup
} from "../lib/listing/storage/storage-retention.mjs";

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

const calls = [];
function listResponse(rows) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(rows)
  };
}

function retentionFetch(url, init = {}) {
  calls.push({
    url,
    method: init.method,
    headers: init.headers,
    body: init.body ? JSON.parse(init.body) : null
  });

  if (init.method === "DELETE") {
    return Promise.resolve({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([])
    });
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

  throw new Error(`Unexpected prefix ${prefix}`);
}

const plan = await planListingImageRetentionCleanup({
  env,
  fetchImpl: retentionFetch,
  now: new Date("2026-06-22T12:00:00.000Z")
});
assert.equal(plan.enabled, true);
assert.equal(plan.cutoff_date, "2026-05-23");
assert.deepEqual(plan.expired_prefixes, ["listing-assets/2026-05-20"]);
assert.deepEqual(plan.objects.map((object) => object.object_path), [
  "listing-assets/2026-05-20/asset-old/front_original-front.jpg",
  "listing-assets/2026-05-20/asset-old/serial_crop-serial.png"
]);
assert.equal(JSON.stringify(plan).includes("test-service-role"), false);

const dryRun = await runListingImageRetentionCleanup({
  env,
  fetchImpl: retentionFetch,
  now: new Date("2026-06-22T12:00:00.000Z"),
  dryRun: true
});
assert.equal(dryRun.dry_run, true);
assert.equal(dryRun.deleted_count, 0);
assert.equal(calls.some((call) => call.method === "DELETE"), false);

const applied = await runListingImageRetentionCleanup({
  env,
  fetchImpl: retentionFetch,
  now: new Date("2026-06-22T12:00:00.000Z"),
  dryRun: false
});
assert.equal(applied.dry_run, false);
assert.equal(applied.deleted_count, 2);
const deleteCall = calls.find((call) => call.method === "DELETE");
assert.ok(deleteCall);
assert.match(deleteCall.url, /\/storage\/v1\/object\/listing-card-images$/);
assert.deepEqual(deleteCall.body.prefixes, [
  "listing-assets/2026-05-20/asset-old/front_original-front.jpg",
  "listing-assets/2026-05-20/asset-old/serial_crop-serial.png"
]);
assert.equal(deleteCall.headers.apikey, "test-service-role");
assert.equal(deleteCall.headers.authorization, undefined, "opaque Supabase service keys must not be sent as JWT bearer tokens");

const summary = summarizeListingImageRetentionCleanup(applied);
assert.deepEqual(summary, {
  enabled: true,
  skipped: false,
  reason: null,
  dry_run: false,
  retention_days: 30,
  cutoff_date: "2026-05-23",
  bucket: "listing-card-images",
  expired_prefixes: ["listing-assets/2026-05-20"],
  object_count: 2,
  deleted_count: 2
});
assert.equal(JSON.stringify(summary).includes("test-service-role"), false);

console.log("storage retention tests passed");
