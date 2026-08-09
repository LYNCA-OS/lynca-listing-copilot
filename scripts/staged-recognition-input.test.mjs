import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  STAGED_RECOGNITION_ROLE,
  STAGED_RECOGNITION_LANE_VERSION,
  assertStagedResumeReceipt,
  assertStagedVerifiedOriginals,
  bindStagedSessionToVerifiedCanonical,
  buildStagedIdentityCanonical,
  buildStagedRecognitionContract,
  buildStagedRecognitionSelection,
  buildStagedResumeReceipt,
  waitForStagedVerifiedOriginals
} from "../lib/listing/thin/staged-recognition-input.mjs";

const ORIGINAL_HASH = "a".repeat(64);
function stagedJpeg(width = 1200, height = 1600) {
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0x00, 0xff, 0xd9
  ]);
}
const DERIVED_BYTES = stagedJpeg();
const DERIVED_HASH = createHash("sha256").update(DERIVED_BYTES).digest("hex");
const original = {
  imageId: "image-front",
  storageFirst: true,
  role: "image_1_original",
  contentType: "image/jpeg",
  bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
  size: 7_000_000,
  width: 3024,
  height: 4032,
  contentSha256: ORIGINAL_HASH
};
const inline = {
  imageId: "image-front-recognition",
  sourceImageId: original.imageId,
  role: STAGED_RECOGNITION_ROLE,
  bytes: DERIVED_BYTES,
  size: DERIVED_BYTES.length,
  width: 1200,
  height: 1600,
  contentType: "image/jpeg",
  contentSha256: DERIVED_HASH
};
const metadata = {
  recognitionInputOnly: true,
  laneVersion: STAGED_RECOGNITION_LANE_VERSION,
  expectedOriginalCount: 1,
  originalImages: [original]
};

const appSource = await readFile(new URL("../app/listing-copilot.js", import.meta.url), "utf8");
const verifiedSetMigration = await readFile(new URL(
  "../supabase/migrations/20260717192000_atomic_enqueue_verified_image_set_v2.sql",
  import.meta.url
), "utf8");
assert.match(appSource, /image\.storageFirst !== true\s*\|\| source !== image\.sourceFile/,
  "only exact browser-decodable Storage originals may produce a staged downscale");
assert.doesNotMatch(appSource, /asset\.images\.(?:push|unshift|splice)\([^)]*stagedRecognition/,
  "recognition-only images must never enter the rendered/exported asset image list");
assert.match(verifiedSetMigration,
  /new\.identity_snapshot -> 'image_references' is distinct from v_set -> 'image_references'/,
  "the production session trigger requires the full canonical verified set");
assert.match(verifiedSetMigration,
  /new\.identity_snapshot ->> 'image_set_sha256'.*v_set ->> 'image_set_sha256'/s,
  "the staged session may not replace the DB canonical hash with an original-only projection");

const contract = buildStagedRecognitionContract({
  metadata,
  inlineImages: [inline],
  bodyBytes: inline.size
});
assert.deepEqual(contract.originalFingerprints, [`sha256:${ORIGINAL_HASH}`]);
assert.equal(contract.inlineBytes, inline.size);
assert.equal(contract.originalBytes, original.size);
const resumeReceipt = buildStagedResumeReceipt({
  tenantId: "tenant-1", assetId: "asset-1", intentId: "intent-1", contract
});
assert.match(resumeReceipt, /^stgr_[0-9a-f]{64}$/);
assert.equal(assertStagedResumeReceipt({
  receipt: resumeReceipt,
  tenantId: "tenant-1", assetId: "asset-1", intentId: "intent-1", contract
}), resumeReceipt);
assert.throws(() => assertStagedResumeReceipt({
  receipt: resumeReceipt,
  tenantId: "tenant-1", assetId: "asset-1", intentId: "other", contract
}), /staged_resume_receipt_invalid/);

// Provider pixels and provider identity are intentionally different objects:
// the model reads the bounded JPEG, while the operation remains keyed to the
// durable original. This is what makes a later finalize/replay the same paid
// task rather than an operation_payload_conflict.
const identity = buildStagedIdentityCanonical({
  tenantId: "tenant-1",
  assetId: "asset-1",
  contract
});
assert.doesNotMatch(JSON.stringify(identity), /staged-unverified/,
  "even the in-memory authority view must not manufacture a persistable placeholder path");
const inlineCanonical = [{
  id: inline.imageId,
  image_id: inline.imageId,
  objectPath: "inline/recognition.jpg",
  object_path: "inline/recognition.jpg",
  size: inline.size
}];
const recognition = buildStagedRecognitionSelection({ contract, inlineImages: inlineCanonical });
assert.equal(identity.images[0].content_sha256, ORIGINAL_HASH);
assert.equal(recognition.images[0].image_id, inline.imageId);
assert.equal(recognition.read[0].read, STAGED_RECOGNITION_ROLE);

const verifiedCanonical = {
  tenant_id: "tenant-1",
  asset_id: "asset-1",
  image_generation_id: "asset-1",
  expected_original_count: 1,
  image_set_sha256: "c".repeat(64),
  images: [{
    image_id: original.imageId,
    storageRole: original.role,
    size: original.size,
    content_sha256: ORIGINAL_HASH,
    derived: false
  }],
  image_references: [{
    image_id: original.imageId,
    image_role: "front_original",
    bucket: "listing-images",
    object_path: "tenants/tenant-1/listing-assets/2026-08-09/asset-1/front.jpg",
    content_sha256: ORIGINAL_HASH,
    derived: false
  }]
};
const verifiedOriginals = assertStagedVerifiedOriginals({ contract, canonical: verifiedCanonical });
assert.deepEqual(verifiedOriginals.images, verifiedCanonical.images);
assert.deepEqual(verifiedOriginals.image_references, verifiedCanonical.image_references);
assert.match(verifiedOriginals.image_set_sha256, /^[0-9a-f]{64}$/);

const rebound = bindStagedSessionToVerifiedCanonical({
  deferredSessionArgs: {
    sessionId: "csmsess_test",
    payload: {
      image_references: identity.image_references,
      recognition_input: [{ read: "unverified_placeholder" }]
    }
  },
  verifiedCanonical: verifiedOriginals,
  recognitionRead: recognition.read
});
assert.deepEqual(rebound.payload.image_references, verifiedOriginals.image_references,
  "the formal session may contain only the verified original references");
assert.deepEqual(rebound.payload.images, verifiedOriginals.image_references);
assert.equal(rebound.payload.image_set_sha256, verifiedOriginals.image_set_sha256);
assert.deepEqual(rebound.payload.recognition_input, recognition.read,
  "the session still records the exact derived bytes read by the model");
assert.doesNotMatch(JSON.stringify(rebound.payload), /staged-unverified/);

// Polling is a post-provider synchronization boundary, not an upload retry.
// Only the retryable incomplete-set state is polled; identity mismatches fail
// closed immediately.
{
  let reads = 0;
  let clock = 0;
  const readBudgets = [];
  const result = await waitForStagedVerifiedOriginals({
    tenantId: "tenant-1",
    assetId: "asset-1",
    contract,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    readCanonical: async ({ timeoutMs, attempts }) => {
      reads += 1;
      readBudgets.push({ timeoutMs, attempts });
      if (reads < 3) throw Object.assign(new Error("not_ready"), { retryable: true });
      return verifiedCanonical;
    }
  });
  assert.deepEqual(result.images, verifiedOriginals.images);
  assert.deepEqual(result.image_references, verifiedOriginals.image_references);
  assert.equal(result.image_set_sha256, verifiedOriginals.image_set_sha256);
  assert.equal(reads, 3);
  assert.equal(clock, 750);
  assert.deepEqual(readBudgets.map(({ attempts }) => attempts), [1, 1, 1]);
  assert.ok(readBudgets.every(({ timeoutMs }) => timeoutMs <= 2_000),
    "each canonical read must fit inside the staged post-provider deadline");
}

await assert.rejects(
  () => waitForStagedVerifiedOriginals({
    tenantId: "tenant-1",
    assetId: "asset-1",
    contract,
    readCanonical: async () => {
      throw Object.assign(new Error("tenant_mismatch"), { retryable: false });
    }
  }),
  /tenant_mismatch/
);

// Counterexamples that used to turn a downscale experiment into a correctness
// regression are rejected before authority/provider dispatch.
for (const [name, input, pattern] of [
  ["small originals use the existing fast ingest", {
    metadata: { ...metadata, originalImages: [{ ...original, size: 2_000_000 }] },
    inlineImages: [inline], bodyBytes: inline.size
  }, /staged_originals_fast_ingest_eligible/],
  ["derived bytes must be smaller", {
    metadata, inlineImages: [{ ...inline, size: original.size }], bodyBytes: original.size
  }, /staged_recognition_not_smaller/],
  ["every derived image names its original", {
    metadata, inlineImages: [{ ...inline, sourceImageId: "other" }], bodyBytes: inline.size
  }, /staged_recognition_source_mismatch/],
  ["the body must exactly match the manifest", {
    metadata, inlineImages: [inline], bodyBytes: inline.size + 1
  }, /staged_recognition_body_size_mismatch/],
  ["HEIC fallback bytes cannot be downscaled again", {
    metadata: { ...metadata, originalImages: [{ ...original, contentType: "image/heic" }] },
    inlineImages: [inline], bodyBytes: inline.size
  }, /staged_original_content_type_invalid/],
  ["a transformed fallback cannot claim the storage-first lane", {
    metadata: { ...metadata, originalImages: [{ ...original, storageFirst: false }] },
    inlineImages: [inline], bodyBytes: inline.size
  }, /staged_original_not_storage_first/],
  [">25MB fallback bytes cannot masquerade as originals", {
    metadata: { ...metadata, originalImages: [{ ...original, size: 26 * 1024 * 1024 }] },
    inlineImages: [inline], bodyBytes: inline.size
  }, /staged_original_too_large/],
  ["a different transform lane cannot adopt an old checkpoint", {
    metadata: { ...metadata, laneVersion: "readability-derived-inline-v3" },
    inlineImages: [inline], bodyBytes: inline.size
  }, /staged_lane_version_invalid/]
]) {
  assert.throws(() => buildStagedRecognitionContract(input), pattern, name);
}

assert.throws(() => buildStagedRecognitionContract({
  metadata,
  inlineImages: [{
    ...inline,
    bytes: Uint8Array.from([0xff, 0xd8, 0x00, 0x00]),
    size: 4,
    contentSha256: createHash("sha256").update(Uint8Array.from([0xff, 0xd8, 0x00, 0x00])).digest("hex")
  }],
  bodyBytes: 4
}), /staged_recognition_jpeg_invalid/, "truncated JPEG bytes must fail before provider authority");

const wrongDimensions = stagedJpeg(800, 600);
assert.throws(() => buildStagedRecognitionContract({
  metadata,
  inlineImages: [{
    ...inline,
    bytes: wrongDimensions,
    size: wrongDimensions.length,
    contentSha256: createHash("sha256").update(wrongDimensions).digest("hex")
  }],
  bodyBytes: wrongDimensions.length
}), /staged_recognition_dimensions_mismatch/,
"declared dimensions may not bypass the encoded 1600px boundary");

let sessionCreates = 0;
let persists = 0;
for (const [name, imagePatch] of [
  ["hash", { content_sha256: "d".repeat(64) }],
  ["role", { storageRole: "image_2_original" }],
  ["size", { size: original.size + 1 }]
]) {
  assert.throws(
    () => {
      const canonical = assertStagedVerifiedOriginals({
        contract,
        canonical: {
          ...verifiedCanonical,
          images: [{ ...verifiedCanonical.images[0], ...imagePatch }]
        }
      });
      sessionCreates += 1;
      bindStagedSessionToVerifiedCanonical({
        deferredSessionArgs: rebound,
        verifiedCanonical: canonical,
        recognitionRead: recognition.read
      });
      persists += 1;
    },
    (error) => error.code === "staged_verified_original_identity_mismatch"
      && error.statusCode === 409
      && error.retryable === false,
    `a verified original ${name} drift must fail before session/persistence`
  );
}
assert.equal(sessionCreates, 0);
assert.equal(persists, 0);

const withNonblockingDerived = assertStagedVerifiedOriginals({
  contract,
  canonical: {
    ...verifiedCanonical,
    image_set_sha256: "f".repeat(64),
    images: [...verifiedCanonical.images, {
      image_id: "front-crop",
      storageRole: "barcode_crop",
      size: 100_000,
      content_sha256: "e".repeat(64),
      derived: true
    }],
    image_references: [...verifiedCanonical.image_references, {
      image_id: "front-crop",
      image_role: "barcode_crop",
      bucket: "listing-images",
      object_path: "tenants/tenant-1/listing-assets/2026-08-09/asset-1/front-crop.jpg",
      content_sha256: "e".repeat(64),
      derived: true
    }]
  }
});
assert.equal(withNonblockingDerived.images.length, 2);
assert.equal(withNonblockingDerived.image_references.length, 2);
assert.equal(withNonblockingDerived.image_set_sha256, "f".repeat(64));
const derivedSession = bindStagedSessionToVerifiedCanonical({
  deferredSessionArgs: rebound,
  verifiedCanonical: withNonblockingDerived,
  recognitionRead: recognition.read
});
assert.deepEqual(derivedSession.payload.image_references, withNonblockingDerived.image_references,
  "a valid nonblocking derived crop stays in the DB-exact formal session set");
assert.equal(derivedSession.payload.image_set_sha256, withNonblockingDerived.image_set_sha256);
assert.deepEqual(derivedSession.payload.recognition_input, recognition.read,
  "recognition_input separately records that the model read ephemeral staged bytes");

console.log("staged recognition input contract tests passed");
