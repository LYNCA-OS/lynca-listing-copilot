import assert from "node:assert/strict";
import {
  SIGNED_UPLOAD_URL_GENERATION_LIMIT,
  WRITER_IMAGE_INTAKE_CONTRACT_VERSION,
  shouldRefreshSignedUpload
} from "../lib/listing/client/upload-recovery-policy.mjs";

assert.equal(WRITER_IMAGE_INTAKE_CONTRACT_VERSION, "writer-image-intake-v1");
assert.equal(SIGNED_UPLOAD_URL_GENERATION_LIMIT, 2);
assert.equal(shouldRefreshSignedUpload({ generation: 1, networkError: true }), true);
assert.equal(shouldRefreshSignedUpload({ generation: 2, networkError: true }), false);
for (const status of [401, 403, 408, 425, 429, 500, 502, 503, 504]) {
  assert.equal(shouldRefreshSignedUpload({ generation: 1, status }), true, `status ${status} must obtain one fresh signed URL`);
}
for (const status of [400, 404, 409, 413, 422]) {
  assert.equal(shouldRefreshSignedUpload({ generation: 1, status }), false, `status ${status} must fail without blind replay`);
}

console.log("upload recovery policy tests passed");
