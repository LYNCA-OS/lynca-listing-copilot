import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const result = spawnSync(process.execPath, ["scripts/build-public-browser-sdk.mjs", "--check"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  encoding: "utf8"
});

assert.equal(result.status, 0, result.stderr || result.stdout || "public browser SDK check failed");

const [sourceSdk, publicSdk] = await Promise.all([
  import("../lib/listing/client/listing-copilot-sdk.mjs"),
  import("../app/listing-copilot-sdk.mjs")
]);
const frozenIntakeExports = [
  "SIGNED_UPLOAD_URL_GENERATION_LIMIT",
  "WRITER_IMAGE_INTAKE_CONTRACT_VERSION",
  "INTAKE_PREVIEW_CARD_WINDOW",
  "claimNextBatchAsset",
  "fetchWithBoundedRetry",
  "shouldRefreshSignedUpload",
  "startNonBlockingDerivedUpload",
  "summarizeDerivedUploadOutcomes",
  "windowIntakePreviewGroups"
];
for (const exportName of frozenIntakeExports) {
  assert.equal(typeof publicSdk[exportName], typeof sourceSdk[exportName], `public SDK export drifted: ${exportName}`);
}
assert.equal(publicSdk.WRITER_IMAGE_INTAKE_CONTRACT_VERSION, "writer-image-intake-v1");
console.log("public browser SDK tests passed");
