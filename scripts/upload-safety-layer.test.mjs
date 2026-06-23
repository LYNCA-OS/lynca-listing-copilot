import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile("app/index.html", "utf8");
const js = await readFile("app/listing-copilot.js", "utf8");

[
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
].forEach((format) => {
  assert.match(html, new RegExp(format.replace(".", "\\."), "i"), `${format} upload should be accepted`);
});

[
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
].forEach((mime) => {
  assert.match(js, new RegExp(mime.replace("/", "\\/")), `${mime} should be supported by upload filtering`);
});

assert.match(js, /canvas\.toDataURL\("image\/jpeg"/, "images should be normalized to JPEG");
assert.match(js, /IMAGE_MAX_EDGE\s*=\s*1400/, "long edge should be capped at 1400px");
assert.match(js, /IMAGE_INITIAL_QUALITY\s*=\s*0\.82/, "initial adaptive quality should stay in the requested range");
assert.match(js, /IMAGE_MIN_QUALITY\s*=\s*0\.72/, "normal adaptive quality should stay in the requested range");
assert.match(js, /heicUnsupportedMessage\s*=/, "HEIC unsupported fallback message should be defined");
assert.match(js, /当前浏览器暂不支持 HEIC\/HEIF 预览/, "HEIC fallback should be clear Chinese copy");
assert.match(js, /MAX_ASSET_REQUEST_BYTES/, "asset request body safety threshold should exist");
assert.match(js, /ensureSafeAssetPayload/, "oversized assets should be recompressed before API request");
assert.match(js, /originalWidth/, "original source width should be preserved for storage dimension validation");
assert.match(js, /originalHeight/, "original source height should be preserved for storage dimension validation");
assert.match(js, /storageDimensionsForImage/, "storage uploads should include validated image dimensions");
assert.match(js, /fileSignatureHex/, "storage uploads should read first-byte file signatures");
assert.match(js, /signatureHex/, "signed upload requests should include file signature metadata");
assert.match(js, /listing-image-verify-upload/, "storage uploads should be server-verified after the direct PUT");
assert.match(js, /Storage upload verification failed/, "storage verification failures should block provider requests");
assert.match(js, /图片过大，已自动压缩用于识别/, "oversized image compression status should be visible");
assert.match(js, /正在优化图片…/, "upload optimization status should be visible");
assert.match(js, /图片已优化，开始识别…/, "recognition start status should be visible");
assert.match(js, /for \(const file of imageFiles\)/, "files should be processed sequentially to preserve upload order");
assert.match(js, /state\.files = images/, "optimized images should preserve upload order in state");
assert.match(js, /state\.files\.slice\(index, index \+ 2\)/, "front/back pairing should remain upload-order based");

console.log("upload safety layer tests passed");
