// COS-53 clauses 1-2: recognition begins while the original is still uploading.
//
// The contract is asserted on the source of `api/csm-listing-title-ingest.js`
// because the behaviour that matters is a SEQUENCE -- what is persisted, what
// is waited for, and in which order -- and the failure mode is silent. A build
// that stores the downscale as the record, or that waits for the originals
// before calling the model, passes every unit test and loses either the
// original or the entire point.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../api/csm-listing-title-ingest.js", import.meta.url), "utf8");

// The mode is opt-in and named by the client, never inferred from image size.
assert.match(source, /metadata\.recognitionInputOnly === true/);
assert.match(source, /metadata\.recognition_input_only === true/);

// The inline bytes must declare themselves derived. Without this a caller could
// claim derived input while shipping originals, and the row afterwards could
// not tell the two paths apart.
assert.match(source, /images\.some\(\(image\) => image\.role !== "readability_derived"\)/);
assert.match(source, /ingest_recognition_input_role_invalid/);

// The count of ORIGINALS is declared, not taken from the inline images -- the
// inline images are downscales and there may be a different number of them.
assert.match(source, /expectedOriginalCount: declaredOriginalCount/);
assert.match(source, /ingest_expected_original_count_invalid/);

// NOTHING from the body is persisted in this mode. The originals are the
// record and they are arriving on the client's own connection.
assert.match(source, /derivedInline\s*\n\s*\?\s*awaitClientUploadedOriginals/);

// The wait is bounded. An unbounded wait on a client upload holds a serverless
// function open until the platform kills it, which loses the run and the
// evidence of why.
assert.match(source, /deadlineMs = 90_000/);
assert.match(source, /ingest_original_upload_timeout/);

// Only "not there yet" is retried. A tenant, path or hash failure is a
// decision and must surface at once rather than being polled for 90 seconds.
assert.match(source, /if \(error\?\.retryable !== true\) throw error;/);

// The originals go through the ordinary canonical read -- same verification,
// same lineage, same invariant. Nothing is declared or trusted early.
assert.match(source, /readCanonicalListingImageReferences\(\{ tenantId, assetId, env, fetchImpl \}\)/);

// The session and CSM rows still wait for storage, so a run is never persisted
// against originals that never landed.
assert.match(source, /persistPath: async \(args\) => \{\s*\n\s*await storagePromise;/);

// COS-53 clause 4: the run states what it read.
assert.match(source, /recognition_input: derivedInline \? "readability_derived_inline" : "original_inline"/);

console.log("COS-53 inline recognition input tests passed");
