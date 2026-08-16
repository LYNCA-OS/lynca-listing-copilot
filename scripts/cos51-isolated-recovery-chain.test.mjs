import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

import { handleManualRecoveryRequest } from "../api/listing-manual-recovery.js";
import {
  manualRecoveryDelivers,
  MANUAL_RECOVERY_SOURCES
} from "../lib/listing/recovery/manual-recovery-record.mjs";
import {
  createListingImageSignedUpload,
  STORAGE_OBJECT_ALREADY_EXISTS,
  verifyExistingListingImageObject,
  verifyListingImageUploadedObject
} from "../lib/listing/storage/supabase-image-storage.mjs";

// A complete COS-51 rehearsal with no browser, credentials, database, network,
// or mutable Production state. Two cards cover both collision branches:
//
//   matching bytes  -> verify/reuse -> sessionless manual save -> advance
//   different bytes -> fail closed  -> successor rebind -> reject -> advance
//
// All external boundaries are injected below. Any accidental un-injected fetch
// therefore fails the test instead of escaping to a real service.

const liveReproductionSource = readFileSync(
  new URL("./reproduce-cos51-storage-collision.mjs", import.meta.url),
  "utf8"
);
assert.match(liveReproductionSource, /expectedOriginalCount:\s*1/,
  "the live isolated fixture must create the one-image asset it declares");
assert.match(liveReproductionSource,
  /mismatched\.status\s*===\s*409[\s\S]*existing_object_content_hash_mismatch[\s\S]*retryable\s*===\s*false/,
  "the live mismatch receipt must be an exact fail-closed 409 contract");
assert.match(liveReproductionSource,
  /content_hash_matches_expected\s*===\s*true[\s\S]*verification_record\?\.saved\s*===\s*true[\s\S]*verification_record\?\.durable\s*===\s*true/,
  "the live reuse receipt must prove the complete hash and durable record");

const tenantId = "tenant_cos51_isolated";
const operatorId = "writer_cos51_isolated";
const matchingAssetId = "asset_51000000-0000-4000-8000-000000000001";
const mismatchedAssetId = "asset_51000000-0000-4000-8000-000000000002";
const reboundAssetId = "asset_51000000-0000-4000-8000-000000000003";
const fixedNow = new Date("2026-08-15T00:00:00.000Z");
const env = {
  SUPABASE_URL: "https://cos51-isolated.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "isolated-test-key",
  LISTING_IMAGE_BUCKET: "listing-card-images",
  LISTING_IMAGE_VERIFICATION_SECRET: "isolated-verification-secret"
};

const imageBytes = Buffer.concat([
  Buffer.from("89504e470d0a1a0a0000000d49484452000004b0000003840802000000", "hex"),
  Buffer.alloc(70 * 1024)
]);
const imageSha256 = crypto.createHash("sha256").update(imageBytes).digest("hex");
const otherSha256 = crypto.createHash("sha256").update(Buffer.concat([
  imageBytes,
  Buffer.from("different")
])).digest("hex");
const signatureHex = imageBytes.subarray(0, 32).toString("hex");

function storageObjectResponse(bytes) {
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": "image/png",
      "content-length": String(bytes.length)
    }
  });
}

async function collide(assetId, imageId) {
  let error = null;
  try {
    await createListingImageSignedUpload({
      tenantId,
      assetId,
      imageId,
      role: "front_original",
      fileName: "front.png",
      contentType: "image/png",
      size: imageBytes.length,
      width: 1200,
      height: 900,
      signatureHex,
      contentSha256: imageSha256,
      now: fixedNow,
      env,
      fetchImpl: async () => new Response(JSON.stringify({
        statusCode: "400",
        error: "Duplicate",
        message: "The resource already exists"
      }), {
        status: 400,
        headers: { "content-type": "application/json" }
      })
    });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, "the isolated fixture must enter the collision path");
  assert.equal(error.code, STORAGE_OBJECT_ALREADY_EXISTS);
  assert.equal(error.statusCode, 409);
  assert.equal(error.recovery_action, "VERIFY_EXISTING_OR_INPUT_REBIND");
  assert.match(error.object_path, new RegExp(`^tenants/${tenantId}/`));
  return error;
}

const matchingCollision = await collide(matchingAssetId, "matching-front");
let matchingRead = null;
const matchingVerification = await verifyExistingListingImageObject({
  tenantId,
  objectPath: matchingCollision.object_path,
  bucket: matchingCollision.bucket,
  expectedContentSha256: imageSha256,
  env,
  fetchImpl: async (input, init = {}) => {
    matchingRead = { input: String(input), init };
    return storageObjectResponse(imageBytes);
  }
});
assert.equal(matchingRead.init.headers.range, undefined,
  "hash-bound collision recovery must read the complete existing object");
assert.equal(matchingVerification.read_whole_object, true);
assert.equal(matchingVerification.content_sha256, imageSha256);
assert.equal(matchingVerification.content_hash_verified, true);
assert.equal(matchingVerification.content_hash_matches_expected, true);

const mismatchedCollision = await collide(mismatchedAssetId, "mismatched-front");
const mismatchedVerification = await verifyExistingListingImageObject({
  tenantId,
  objectPath: mismatchedCollision.object_path,
  bucket: mismatchedCollision.bucket,
  expectedContentSha256: otherSha256,
  env,
  fetchImpl: async () => storageObjectResponse(imageBytes)
});
assert.equal(mismatchedVerification.read_whole_object, true);
assert.equal(mismatchedVerification.content_sha256, imageSha256);
assert.equal(mismatchedVerification.content_hash_verified, false);
assert.equal(mismatchedVerification.content_hash_matches_expected, false,
  "different bytes must never be reusable under the collided identity");

let reboundSignRequest = null;
const reboundUpload = await createListingImageSignedUpload({
  tenantId,
  assetId: reboundAssetId,
  imageId: "mismatched-front",
  role: "front_original",
  fileName: "front.png",
  contentType: "image/png",
  size: imageBytes.length,
  width: 1200,
  height: 900,
  signatureHex,
  contentSha256: imageSha256,
  now: fixedNow,
  env,
  fetchImpl: async (input, init = {}) => {
    reboundSignRequest = { input: String(input), init };
    const pathname = new URL(String(input)).pathname.replace("/storage/v1", "");
    return new Response(JSON.stringify({ url: `${pathname}?token=isolated` }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
});
assert.equal(JSON.parse(reboundSignRequest.init.body).upsert, false,
  "rebind must preserve immutable originals rather than overwrite the collision");
assert.notEqual(reboundUpload.object_path, mismatchedCollision.object_path);
assert.match(reboundUpload.object_path, new RegExp(`/${reboundAssetId}/`),
  "INPUT_REBIND must move to a successor durable asset identity");

const reboundVerification = await verifyListingImageUploadedObject({
  tenantId,
  objectPath: reboundUpload.object_path,
  contentType: "image/png",
  size: imageBytes.length,
  width: 1200,
  height: 900,
  signatureHex,
  contentSha256: imageSha256,
  env,
  fetchImpl: async () => storageObjectResponse(imageBytes)
});
assert.equal(reboundVerification.content_hash_verified, true);
assert.equal(reboundVerification.content_sha256, imageSha256);

const durableAssets = new Set([matchingAssetId, reboundAssetId]);
const recoveryRows = new Map();
const recoveryDependencies = {
  assertAsset: async ({ tenantId: requestedTenant, assetId, requireDurable }) => {
    assert.equal(requestedTenant, tenantId);
    assert.equal(requireDurable, true);
    assert.ok(durableAssets.has(assetId), "manual recovery must bind a current durable asset");
    return { ok: true, row: { id: assetId, tenant_id: tenantId } };
  },
  insertRow: async ({ row, upsert }) => {
    assert.equal(upsert, false, "the manual-recovery ledger must stay append-only");
    if (recoveryRows.has(row.id)) return { saved: false, row: null, error: "duplicate" };
    const saved = structuredClone(row);
    recoveryRows.set(row.id, saved);
    return { saved: true, row: saved };
  },
  readRows: async ({ search }) => {
    const id = String(search.id || "").replace(/^eq\./, "");
    const row = recoveryRows.get(id);
    return {
      ok: true,
      rows: row
        && search.tenant_id === `eq.${row.tenant_id}`
        && search.operator_id === `eq.${row.operator_id}`
        ? [structuredClone(row)]
        : []
    };
  }
};

const queue = ["matching-save", "mismatch-rebind-reject"];
async function persistSessionlessDecisionAndAdvance(expectedCard, payload, dependencies = recoveryDependencies) {
  assert.equal(queue[0], expectedCard, "the isolated queue must preserve card order");
  assert.ok(!("recognition_session_id" in payload),
    "a recognition failure has no session and must use the manual ledger");
  const result = await handleManualRecoveryRequest({
    tenantId,
    operatorId,
    payload,
    dependencies
  });
  assert.ok(result.record?.id, "advance requires a durable record acknowledgement");
  queue.shift();
  return result;
}

const savedPayload = {
  manual_recovery_submission_id: "51000000-0000-4000-8000-000000000011",
  client_occurred_at: "2026-08-15T00:01:00.000Z",
  asset_id: matchingAssetId,
  client_asset_ref: "matching-save",
  manual_title: "2024 Topps Chrome Shohei Ohtani Refractor",
  source: MANUAL_RECOVERY_SOURCES.SAVED,
  failure_code: STORAGE_OBJECT_ALREADY_EXISTS,
  failure_stage: "recognition"
};
const saved = await persistSessionlessDecisionAndAdvance("matching-save", savedPayload);
assert.equal(saved.replayed, false);
assert.equal(manualRecoveryDelivers(saved.record), true);
assert.deepEqual(queue, ["mismatch-rebind-reject"]);

// A lost HTTP response may replay the same append-only decision, but it cannot
// create a second row or change the already-advanced queue.
const savedReplay = await handleManualRecoveryRequest({
  tenantId,
  operatorId,
  payload: savedPayload,
  dependencies: recoveryDependencies
});
assert.equal(savedReplay.replayed, true);
assert.equal(recoveryRows.size, 1);
assert.deepEqual(queue, ["mismatch-rebind-reject"]);

const rejected = await persistSessionlessDecisionAndAdvance("mismatch-rebind-reject", {
  manual_recovery_submission_id: "51000000-0000-4000-8000-000000000012",
  client_occurred_at: "2026-08-15T00:02:00.000Z",
  asset_id: reboundAssetId,
  client_asset_ref: "mismatch-rebind-reject",
  source: MANUAL_RECOVERY_SOURCES.REJECTED,
  failure_code: STORAGE_OBJECT_ALREADY_EXISTS,
  failure_stage: "recognition"
});
assert.equal(rejected.record.manual_title, "");
assert.equal(manualRecoveryDelivers(rejected.record), false,
  "a persisted rejection advances the decision queue without inventing a delivered title");
assert.deepEqual(queue, []);
assert.equal(recoveryRows.size, 2);

// The queue helper above advances only after handleManualRecoveryRequest returns.
// Prove the inverse explicitly: an absent write and absent readback keep the card.
queue.push("unacknowledged-save");
await assert.rejects(
  persistSessionlessDecisionAndAdvance("unacknowledged-save", {
    ...savedPayload,
    manual_recovery_submission_id: "51000000-0000-4000-8000-000000000013"
  }, {
    ...recoveryDependencies,
    insertRow: async () => ({ saved: false, row: null, error: "isolated outage" }),
    readRows: async () => ({ ok: false, rows: [], error: "isolated outage" })
  }),
  /manual_recovery_not_persisted/
);
assert.deepEqual(queue, ["unacknowledged-save"],
  "a failed persistence acknowledgement must never advance the writer queue");

process.stdout.write("COS-51 isolated collision recovery chain: ok\n");
