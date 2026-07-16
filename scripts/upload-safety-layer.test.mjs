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
assert.match(js, /点击生成标题后开始识别/, "status copy should explain recognition does not start before the user clicks generate");
assert.match(js, /图片正在后台准备/, "status copy should explain cloud image preparation may happen before recognition");
assert.match(js, /PREINGEST_API_ENDPOINT/, "background pre-ingestion endpoint should be wired for prepared assets");
assert.match(js, /backgroundPreparationRunId/, "background preparation should be guarded against stale file batches");
assert.match(js, /保留主图，缩减辅助局部图/, "oversized request fallback status should be visible without implying low-quality main-image recognition");
assert.match(js, /正在读取本地图片预览，尚未开始识别…/, "local preview preparation status should be visible before recognition starts");
assert.match(js, /0% · 图片已准备，开始识别…/, "recognition start status should include progress");
assert.match(js, /setStatus\("正在读取本地图片预览，尚未开始识别…",\s*\{\s*busy:\s*true\s*\}\)/, "preview preparation should render as an active waiting state");
assert.match(js, /setStatus\("0% · 图片已准备，开始识别…",\s*\{\s*busy:\s*true\s*\}\)/, "recognition start should render as an active waiting state");
assert.match(js, /const IMAGE_PREPROCESS_CONCURRENCY\s*=\s*4/, "image preprocessing should use a bounded concurrency pool");
assert.match(js, /const STORAGE_UPLOAD_CONCURRENCY\s*=\s*3/, "storage upload should use a bounded per-asset concurrency pool");
assert.match(js, /const MAX_BACKGROUND_PREP_WORKERS\s*=\s*4/, "background preparation should use its own bounded worker pool");
assert.match(js, /const backgroundWorkerCount\s*=\s*MAX_BACKGROUND_PREP_WORKERS/, "background preparation must remain bounded independently of provider capacity");
assert.match(js, /if \(asset\.preingestionPromise\) return asset\.preingestionPromise/, "pre-ingestion must deduplicate concurrent background and click-path preparation");
assert.match(js, /const PREINGEST_REQUEST_TIMEOUT_MS\s*=\s*20000/, "pre-ingestion must have a bounded timeout instead of hanging the card indefinitely");
assert.match(js, /settleRequiredPreingestion\(asset\)/, "queue submission must rendezvous with the existing evidence bundle before paid recognition");
assert.match(js, /client_required_preingestion_wait_ms/, "pre-ingestion rendezvous latency must be observable per card");
assert.match(js, /const MAX_CONCURRENT_WORKERS\s*=\s*6/, "queue submission workers must have a browser-side safety cap");
assert.match(js, /async function mapWithConcurrency/, "bounded image preprocessing helper should exist");
assert.match(js, /results\[index\]\s*=\s*await worker\(source\[index\], index\)/, "concurrent preprocessing should preserve input order in results");
assert.match(js, /mapWithConcurrency\(imageFiles,\s*IMAGE_PREPROCESS_CONCURRENCY/, "file preprocessing should use bounded concurrency");
assert.match(js, /mapWithConcurrency\(images,\s*STORAGE_UPLOAD_CONCURRENCY/, "storage uploads should not run serially for every original and crop image");
assert.match(js, /uploadAssetImage\(asset, image, imageIndex\)/, "bounded storage upload workers should preserve image role assignment");
assert.match(js, /state\.files = images/, "optimized images should preserve upload order in state");
assert.match(js, /state\.files\.slice\(index, index \+ 2\)/, "two-image pairing should remain upload-order based");

console.log("upload safety layer tests passed");
