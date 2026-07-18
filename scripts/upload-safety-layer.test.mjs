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
assert.match(js, /IMAGE_MAX_EDGE\s*=\s*2200/, "preview/crop long edge should preserve high-resolution card text");
assert.match(js, /IMAGE_INITIAL_QUALITY\s*=\s*0\.9/, "initial adaptive quality should preserve small card text");
assert.match(js, /IMAGE_MIN_QUALITY\s*=\s*0\.78/, "normal adaptive quality should avoid low-quality recompression");
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
assert.match(js, /本地预览已显示；正在校验原图，随后自动上传并启动内部识别/, "status copy should explain immediate preview and upload-triggered recognition");
assert.match(js, /URL\.createObjectURL/, "selected images should receive an immediate local object-URL preview");
assert.match(js, /PREINGEST_API_ENDPOINT/, "background pre-ingestion endpoint should be wired for prepared assets");
assert.match(js, /backgroundPreparationRunId/, "background preparation should be guarded against stale file batches");
assert.match(js, /保留主图，缩减辅助局部图/, "oversized request fallback status should be visible without implying low-quality main-image recognition");
assert.match(js, /本地预览已显示；正在校验原图，随后自动上传并启动内部识别…/, "local preview preparation should announce the automatic recognition handoff");
assert.match(js, /0% · 图片已准备，开始识别…/, "recognition start status should include progress");
assert.match(js, /setStatus\("本地预览已显示；正在校验原图，随后自动上传并启动内部识别…",\s*\{\s*busy:\s*true\s*\}\)/, "preview preparation should render as an active waiting state");
assert.match(js, /setStatus\("0% · 图片已准备，开始识别…",\s*\{\s*busy:\s*true\s*\}\)/, "recognition start should render as an active waiting state");
assert.match(js, /const IMAGE_PREPROCESS_CONCURRENCY\s*=\s*4/, "image preprocessing should use a bounded concurrency pool");
assert.match(js, /const STORAGE_UPLOAD_CONCURRENCY\s*=\s*3/, "storage upload should use a bounded per-asset concurrency pool");
assert.match(js, /const MAX_BACKGROUND_PREP_WORKERS\s*=\s*4/, "background preparation should use its own bounded worker pool");
assert.match(js, /backgroundPreparationActiveCount\s*<\s*MAX_BACKGROUND_PREP_WORKERS/, "background preparation must remain bounded independently of provider capacity");
assert.match(js, /backgroundPreparationActiveCount\s*=\s*Math\.max\(0,\s*backgroundPreparationActiveCount\s*-\s*1\)/, "completed background work should release its preparation slot");
assert.match(js, /drainBackgroundPreparationQueue\(\)/, "released preparation capacity should continue draining the bounded queue");
assert.match(js, /const MAX_CONCURRENT_WORKERS\s*=\s*6/, "queue submission workers must have a browser-side safety cap");
assert.match(js, /async function mapWithConcurrency/, "bounded image preprocessing helper should exist");
assert.match(js, /results\[index\]\s*=\s*await worker\(source\[index\], index\)/, "concurrent preprocessing should preserve input order in results");
assert.match(js, /const groupPreparationConcurrency\s*=\s*state\.mode\s*===\s*"single"/, "file preprocessing should bound card-pair preparation independently of single-image mode");
assert.match(js, /mapWithConcurrency\(fileGroups,\s*groupPreparationConcurrency/, "file-group preprocessing should use bounded concurrency");
assert.match(js, /prepareFileForIntake\(file\)/, "production intake should select the storage-first path before legacy canvas preprocessing");
assert.match(js, /storageFirstAssetImage/, "browser-native originals should have a storage-first intake path");
assert.match(js, /targetedCrops:\s*\[\]/, "storage-first originals should leave crop planning to cloud pre-ingestion");
assert.match(js, /await ensureImageUploadMetadata\(image\)/, "signed upload must wait for lightweight dimensions before validation");
assert.match(js, /compressed\.targetedCrops\s*=\s*buildTargetedCropImages/, "targeted crops should be generated once after final compression");
assert.doesNotMatch(js, /targetedCrops:\s*sourceImage\s*\?\s*buildTargetedCropImages/, "recompression attempts must not regenerate the full crop set");
assert.match(js, /mapWithConcurrency\(entries,\s*STORAGE_UPLOAD_CONCURRENCY/, "each storage upload phase should use bounded concurrency");
assert.match(js, /startNonBlockingDerivedUpload/, "derived crop upload must use the non-blocking upload phase boundary");
assert.match(js, /ensureAssetOriginalImagesUploaded/, "recognition should wait only for canonical originals");
assert.doesNotMatch(js, /await asset\.derivedStorageUploadPromise/, "derived crop completion must never block recognition");
assert.match(js, /uploadAssetImage\(asset, image, imageIndex\)/, "bounded storage upload workers should preserve image role assignment");
assert.match(js, /state\.assets\.sort\(\(left, right\) => left\.index - right\.index\)/, "progressively prepared assets should restore upload order before rendering");
assert.match(js, /state\.files\s*=\s*state\.assets\.flatMap\(\(entry\) => entry\.images\)/, "optimized images should preserve upload order in state");
assert.match(js, /const groupSize\s*=\s*state\.mode\s*===\s*"single"\s*\?\s*1\s*:\s*2/, "two-image pairing should remain upload-order based");

console.log("upload safety layer tests passed");
